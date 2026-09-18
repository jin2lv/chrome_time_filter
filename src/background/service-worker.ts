/**
 * Background Service Worker（P1 完善）
 *
 * 职责：
 * - 动态注册 content script（chrome.scripting，按需授权模型核心）
 * - 监听 storage.onChanged，向对应域名所有 Tab 的 Content Script 广播时间变更
 * - 维护扩展图标角标（过滤计数）
 * - (P2) 快捷键、适配包定时更新
 */
import type { TimeSettings } from '../shared/types'
import { AdapterManager, compareVersions, SUPPORTED_ORIGINS } from '../adapters'
import { validateAdapter } from '../adapters/schema'
import {
  clearRemoteAdapter,
  extractDomain,
  getPrefs,
  getRemoteAdapter,
  setRemoteAdapter,
} from '../shared/storage'
import { CONTENT_SCRIPT_ID, getContentScriptJs } from '../shared/registration'
import type { Adapter } from '../shared/types'

const TIME_SETTINGS_PREFIX = 'timeSettings.'

/**
 * 远程适配包地址（P2-19 真实发布源）
 *
 * 发布流程：`npm run adapters:build`（生成 adapters.json + adapters.json.sha256）→
 * 提交并推送到 main → 可选调用 jsDelivr purge 清除 CDN 缓存（分支引用默认缓存约 12h）：
 * `https://purge.jsdelivr.net/gh/jin2lv/chrome_time_filter@main/adapters.json`
 *
 * 完整性校验：随包发布的 `.sha256` 文件先于解析比对（防传输损坏/被替换；不防发布源被完全劫持，
 * 该威胁模型下依赖 GitHub 账号安全 + HTTPS）。
 */
const REMOTE_ADAPTERS_URL =
  'https://cdn.jsdelivr.net/gh/jin2lv/chrome_time_filter@main/adapters.json'
const REMOTE_CHECKSUM_URL = `${REMOTE_ADAPTERS_URL}.sha256`

const ADAPTERS_ALARM = 'adapters-update'
const ADAPTERS_INTERVAL_MINUTES = 12 * 60 // 每 12h

/**
 * 目标平台域名：由内置适配包派生（见 src/adapters/index.ts 的 SUPPORTED_ORIGINS）。
 * manifest 的 optional_host_permissions 与 web_accessible_resources 在 vite.config.ts
 * 用同一份 SITE_ORIGINS 声明——新增平台时更新适配包注册与 vite.config 两处即可。
 */
const TARGET_MATCHES = SUPPORTED_ORIGINS

/**
 * 注册（或确保已注册）content script；host 授权后才实际注入
 */
export async function ensureContentScriptRegistered(): Promise<void> {
  try {
    const matches: string[] = []
    for (const match of TARGET_MATCHES) {
      if (await chrome.permissions.contains({ origins: [match] })) matches.push(match)
    }
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] })
    if (matches.length === 0) {
      if (existing.length > 0) {
        await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] })
      }
      return
    }
    const js = getContentScriptJs()
    if (js.length === 0) {
      console.warn('[时光机] manifest 缺少 content_scripts 声明，无法注册')
      return
    }
    if (existing.length > 0) {
      await chrome.scripting.updateContentScripts([
        {
          id: CONTENT_SCRIPT_ID,
          matches,
          js,
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ])
      return
    }
    await chrome.scripting.registerContentScripts([
      {
        id: CONTENT_SCRIPT_ID,
        matches,
        // registerContentScripts expects extension-relative file paths, as
        // returned by runtime.getManifest(), not chrome-extension:// URLs.
        js,
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ])
    console.log('[时光机] 动态 content script 已注册:', js)
  } catch (e) {
    console.warn('[时光机] 注册 content script 失败:', (e as Error).message)
  }
}

// 触发时机：安装/浏览器启动/SW 每次唤醒（幂等）
chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureContentScriptRegistered()
  // P2-5：注册定时更新 alarm（12h）+ 安装时立即尝试一次
  await chrome.alarms.create(ADAPTERS_ALARM, { periodInMinutes: ADAPTERS_INTERVAL_MINUTES })
  if (details.reason === 'install') {
    void updateAdapters()
    // P1-7：仅首次安装自动打开引导页（更新时弹窗会打扰现有用户）
    console.log('[时光机] 首次安装，打开引导页')
    chrome.tabs
      .create({ url: chrome.runtime.getURL('welcome.html') })
      .then(() => console.log('[时光机] 引导页已打开'))
      .catch((e) => console.error('[时光机] 打开引导页失败:', e))
  }
})
chrome.runtime.onStartup.addListener(ensureContentScriptRegistered)
void ensureContentScriptRegistered()

/* ---- P2-5 热更新 / P2-19 发布源安全 ---- */

/** SHA-256（hex）：完整性校验用（P2-19） */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 广播 ADAPTERS_UPDATED：让已注入的 content script 重新加载适配包 */
async function broadcastAdaptersUpdated(): Promise<void> {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !tab.url.startsWith('http')) continue
    chrome.tabs.sendMessage(tab.id, { type: 'ADAPTERS_UPDATED' }).catch(() => {})
  }
}

/**
 * 拉取远程适配包：完整性校验 → 应急停用 → 校验 → 版本对比 → 更新存储并生效。
 * 任何失败（网络/校验和不符/格式）均静默降级，继续使用内置兜底包。
 *
 * 版本回退策略（P2-19）：版本单调（不接受降级）；需要回退时由发布方**递增版本号并发布旧内容**
 * （roll-forward），或对远程包置 `disabled: true` 走应急停用；最终兜底为清空远程包回退内置包。
 */
export async function updateAdapters(): Promise<{ updated: boolean; reason?: string }> {
  const prefs = await getPrefs()
  if (!prefs.autoUpdateAdapters) return { updated: false, reason: 'disabled' }
  try {
    const res = await fetch(REMOTE_ADAPTERS_URL, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()

    // 完整性校验：随包发布的 .sha256 先于解析比对
    const checkRes = await fetch(REMOTE_CHECKSUM_URL, { signal: AbortSignal.timeout(15000) })
    if (!checkRes.ok) throw new Error(`HTTP ${checkRes.status} (checksum)`)
    const expected = (await checkRes.text()).trim().toLowerCase().split(/\s+/)[0]
    const actual = await sha256Hex(text)
    if (!/^[0-9a-f]{64}$/.test(expected) || expected !== actual) {
      console.warn('[时光机] 远程适配包完整性校验失败，丢弃')
      return { updated: false, reason: 'checksum' }
    }

    const pkg = JSON.parse(text) as Adapter
    const errs = validateAdapter(pkg)
    if (errs) {
      console.warn('[时光机] 远程适配包校验失败，丢弃:', errs)
      return { updated: false, reason: 'invalid' }
    }

    // 应急停用（P2-19）：发布方置 disabled 时清空远程包，全体回退内置包
    if (pkg.disabled === true) {
      await clearRemoteAdapter()
      AdapterManager.setRemoteAdapters([])
      await broadcastAdaptersUpdated()
      console.warn('[时光机] 远程适配包已停用，回退内置包')
      return { updated: false, reason: 'kill-switch' }
    }

    const local = await getRemoteAdapter()
    const localVersion = local?.version ?? '0.0.0'
    if (compareVersions(pkg.version, localVersion) <= 0) {
      return { updated: false, reason: 'no-newer' }
    }
    await setRemoteAdapter(pkg)
    AdapterManager.setRemoteAdapters([pkg])
    await broadcastAdaptersUpdated()
    console.log(`[时光机] 适配包已更新至 v${pkg.version}`)
    return { updated: true }
  } catch (e) {
    console.warn('[时光机] 适配包更新失败，使用内置包:', (e as Error).message)
    return { updated: false, reason: 'network' }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ADAPTERS_ALARM) void updateAdapters()
})

/* ---- P2-7：全局快捷键 Alt+Shift+T → 切换当前 Tab 过滤开关（原 Ctrl+Shift+T 与 Chrome「重开标签页」冲突，2026-09-07 更换） ---- */
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-filter') return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url || !tab.url.startsWith('http')) return
  const host = new URL(tab.url).hostname
  // 仅目标平台生效（无适配包时 content script 未激活，静默）
  if (!AdapterManager.hasAdapter(host.replace(/^www\./, ''))) return
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_FILTER' }).catch(() => {})
  // 图标状态由 content script 回发 FILTER_STATE_CHANGED 自动更新
})

/* ---- storage.onChanged：跨 Tab 广播时间设置变更 ---- */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return

  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith(TIME_SETTINGS_PREFIX)) continue
    const domain = key.slice(TIME_SETTINGS_PREFIX.length)
    const settings = change.newValue as TimeSettings | undefined
    void broadcastTimeSettings(domain, settings)
  }
})

async function broadcastTimeSettings(
  domain: string,
  settings: TimeSettings | undefined,
): Promise<void> {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue
    let host: string
    try {
      host = new URL(tab.url).hostname
    } catch {
      continue
    }
    if (host !== domain && !host.endsWith('.' + domain)) continue
    chrome.tabs
      .sendMessage(tab.id, { type: 'TIME_SETTINGS_UPDATED', domain, settings })
      .catch(() => {
        /* 页面未注入 content script 时静默忽略 */
      })
  }
}

/* ---- 消息：content script 上报过滤计数 → 图标角标 ---- */
const COLOR_ICONS = {
  16: 'public/icons/icon16.png',
  32: 'public/icons/icon32.png',
  48: 'public/icons/icon48.png',
}
const GRAY_ICONS = {
  16: 'public/icons/icon16-gray.png',
  32: 'public/icons/icon32-gray.png',
  48: 'public/icons/icon48-gray.png',
}

function setTabIcon(tabId: number, enabled: boolean): void {
  chrome.action
    .setIcon({ path: enabled ? COLOR_ICONS : GRAY_ICONS, tabId })
    .catch(() => {})
  if (!enabled) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {})
  }
}

chrome.runtime.onMessage.addListener((msg, sender, _sendResponse) => {
  if (!msg || typeof msg !== 'object') return
  const tabId = sender.tab?.id
  if (tabId === undefined) return

  if (msg.type === 'FILTER_COUNT_UPDATED') {
    const { count, unparseable } = msg
    void (async () => {
      const prefs = await getPrefs()
      const text = prefs.badgeCount && count > 0 ? String(count) : ''
      chrome.action.setBadgeText({ text, tabId }).catch(() => {})
      if (text) {
        chrome.action.setBadgeBackgroundColor({ color: '#e03131', tabId }).catch(() => {})
      }
      if (unparseable > 0) {
        chrome.action
          .setTitle({
            tabId,
            title: `时光机 | 已过滤 ${count} 条（${unparseable} 条无法解析）`,
          })
          .catch(() => {})
      } else {
        chrome.action.setTitle({ tabId, title: '时光机' }).catch(() => {})
      }
    })()
  } else if (msg.type === 'FILTER_STATE_CHANGED') {
    // P1-6：开启彩色图标 / 关闭灰色图标
    setTabIcon(tabId, Boolean(msg.enabled))
  }
})

// Popup grants an optional host permission after the worker may have started.
// Re-run the idempotent registration so the newly granted site is immediately
// eligible for content-script injection after its next page load.
chrome.permissions?.onAdded?.addListener(() => {
  void ensureContentScriptRegistered()
})

// 授权被撤销：收敛注册（去掉已撤销 origin）并向受影响标签页广播停用。
// 已注入的 content script 不会因撤销而自动卸载，必须显式通知其恢复 DOM 并停止过滤。
chrome.permissions?.onRemoved?.addListener((removed) => {
  void ensureContentScriptRegistered()
  const domains = new Set<string>()
  for (const origin of removed?.origins ?? []) {
    try {
      domains.add(extractDomain(new URL(origin.replace('*://', 'https://')).hostname))
    } catch {
      /* 忽略非法 origin */
    }
  }
  if (domains.size === 0) return
  void (async () => {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue
      let host: string
      try {
        host = new URL(tab.url).hostname
      } catch {
        continue
      }
      if (![...domains].some((d) => host === d || host.endsWith('.' + d))) continue
      chrome.tabs.sendMessage(tab.id, { type: 'PERMISSION_REVOKED' }).catch(() => {})
    }
  })()
})

console.log('[时光机] Service Worker 已启动')
