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
import { AdapterManager, compareVersions } from '../adapters'
import { validateAdapter } from '../adapters/schema'
import { getPrefs, getRemoteAdapter, setRemoteAdapter } from '../shared/storage'
import type { Adapter } from '../shared/types'

const TIME_SETTINGS_PREFIX = 'timeSettings.'

/** 远程适配包地址（P2-5：发布时替换为真实 repo；拉取失败静默降级内置包） */
const REMOTE_ADAPTERS_URL = 'https://cdn.jsdelivr.net/gh/org/repo@latest/adapters.json'

const ADAPTERS_ALARM = 'adapters-update'
const ADAPTERS_INTERVAL_MINUTES = 12 * 60 // 每 12h

/** 目标平台域名（必须与 optional_host_permissions / web_accessible_resources 严格保持同步） */
const TARGET_MATCHES = [
  '*://xueqiu.com/*',
  '*://t.10jqka.com.cn/*',
  '*://finance.eastmoney.com/*',
  '*://jisilu.cn/*',
  '*://www.jisilu.cn/*',
]

const CONTENT_SCRIPT_ID = 'tm-main'

/**
 * 读取 content script 注入文件（CRXJS 产物为 loader，路径带 hash）。
 * 从 manifest 读取以免疫构建 hash 变化；loader 内部动态 import 实际代码。
 */
function getContentScriptJs(): string[] {
  const manifest = chrome.runtime.getManifest()
  const js = manifest.content_scripts?.[0]?.js
  return js && js.length > 0 ? js : []
}

/** 注册（或确保已注册）content script；host 授权后才实际注入 */
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
  }
  // P1-7：首次安装自动打开引导页（重新安装也触发，便于重复验证）
  if (details.reason === 'install' || details.reason === 'update') {
    console.log('[时光机] onInstalled 触发，准备打开引导页，reason=', details.reason)
    chrome.tabs
      .create({ url: chrome.runtime.getURL('welcome.html') })
      .then(() => console.log('[时光机] 引导页已打开'))
      .catch((e) => console.error('[时光机] 打开引导页失败:', e))
  }
})
chrome.runtime.onStartup.addListener(ensureContentScriptRegistered)
void ensureContentScriptRegistered()

/* ---- P2-5：适配包热更新 ---- */

/**
 * 拉取远程适配包：校验 → 版本对比 → 更新存储并生效。
 * 任何失败（网络/格式/校验）均静默降级，继续使用内置兜底包。
 */
export async function updateAdapters(): Promise<{ updated: boolean; reason?: string }> {
  const prefs = await getPrefs()
  if (!prefs.autoUpdateAdapters) return { updated: false, reason: 'disabled' }
  try {
    const res = await fetch(REMOTE_ADAPTERS_URL, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const pkg = (await res.json()) as Adapter
    const errs = validateAdapter(pkg)
    if (errs) {
      console.warn('[时光机] 远程适配包校验失败，丢弃:', errs)
      return { updated: false, reason: 'invalid' }
    }
    const local = await getRemoteAdapter()
    const localVersion = local?.version ?? '0.0.0'
    if (compareVersions(pkg.version, localVersion) <= 0) {
      return { updated: false, reason: 'no-newer' }
    }
    await setRemoteAdapter(pkg)
    AdapterManager.setRemoteAdapters([pkg])
    // 广播给所有已注入的 content script 重新加载适配包
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (!tab.id || !tab.url || !tab.url.startsWith('http')) continue
      chrome.tabs.sendMessage(tab.id, { type: 'ADAPTERS_UPDATED' }).catch(() => {})
    }
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

/* ---- P2-7：全局快捷键 Ctrl+Shift+T → 切换当前 Tab 过滤开关 ---- */
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

console.log('[时光机] Service Worker 已启动')
