/**
 * Popup 控制面板（P1 完善）
 *
 * 交互（PRD F1/F4）：
 * - 顶部开关：按 Tab 独立，新 Tab 默认开启；域名未设定时间时禁用
 * - 截止时间输入 + 快捷预设（1小时前/今日0点/昨日0点）
 * - 过滤策略单选（v0.1 仅隐藏可用，折叠随 P2 解锁）
 * - 当前站点：未授权时提示"点击授权"（optional_host_permissions 按需授权）
 * - 已过滤计数：实时查询 Content Script
 */
import { AdapterManager } from '../adapters'
import { extractDomain, getPrefs, getTimeSettings, setTimeSettings } from '../shared/storage'
import type { ContentState, TimeSettings } from '../shared/types'
import { createIcons, Settings } from 'lucide'

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el as T
}

/** 与 manifest optional_host_permissions 保持同步（xueqiu/同花顺/微博） */

const cutoffInput = $<HTMLInputElement>('cutoff-input')
const toggleBtn = $<HTMLButtonElement>('toggle-btn')
const siteEl = $<HTMLDivElement>('site')
const countEl = $<HTMLDivElement>('count')
const authArea = $<HTMLDivElement>('auth-area')
const authBtn = $<HTMLButtonElement>('auth-btn')
const authStatus = $<HTMLParagraphElement>('auth-status')
const settingsBtn = $<HTMLButtonElement>('settings-btn')

createIcons({ icons: { Settings } })

let domain = ''
let tabId: number | undefined
let state: ContentState = { enabled: true, hasSettings: false, hasAdapter: false, filteredCount: 0, unparseableCount: 0 }

settingsBtn.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage()
})

const CONTENT_SCRIPT_ID = 'tm-main'

/** 选择"目标站点 tab"：优先当前活动 tab；若为扩展页面（如 popup 被钉住）则回退到最近的非扩展 tab */
async function pickTargetTab(): Promise<chrome.tabs.Tab | undefined> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (active?.url && !active.url.startsWith('chrome-extension://')) {
    return active
  }
  const all = await chrome.tabs.query({ currentWindow: true })
  for (let i = all.length - 1; i >= 0; i--) {
    const t = all[i]
    if (t.url && !t.url.startsWith('chrome-extension://') && t.url.startsWith('http')) {
      return t
    }
  }
  return active
}

async function init(): Promise<void> {
  const tab = await pickTargetTab()
  if (!tab?.id || !tab.url) return
  tabId = tab.id
  domain = extractDomain(new URL(tab.url).hostname)

  const isTarget = AdapterManager.hasAdapter(domain)
  const adapter = AdapterManager.getAdapter(domain)
  siteEl.textContent = `${adapter?.name ?? '未知站点'} ${domain}`
  // P2-2：相对时间平台显示精度提示（±5 分钟）
  const hint = document.getElementById('precision-hint')
  if (hint && adapter?.timestamp.type === 'relative') {
    hint.hidden = false
  }

  // 读取全局默认策略并同步到 popup 单选（首次设置时生效）
  const prefs = await getPrefs()
  syncStrategy(prefs.defaultStrategy)

  // 授权检测：目标平台但未授权 → 引导授权
  const authorized = await isAuthorized(domain)
  if (isTarget && !authorized) {
    authArea.hidden = false
    toggleBtn.disabled = true
    cutoffInput.disabled = true
    document
      .querySelectorAll<HTMLButtonElement>('.preset[data-preset]')
      .forEach((button) => (button.disabled = true))
    authBtn.addEventListener('click', requestAuth)
    return
  }

  // 已授权：读时间设置 + 查询内容脚本状态
  if (isTarget) await ensureContentScriptActive()
  const settings = await getTimeSettings(domain)
  if (settings?.cutoff != null) {
    cutoffInput.value = toLocalInputValue(new Date(settings.cutoff))
    syncStrategy(settings.strategy)
  }
  await refreshContentState()
  bindEvents()
}

async function isAuthorized(d: string): Promise<boolean> {
  const origin = `*://${d}/*`
  return chrome.permissions.contains({ origins: [origin] })
}

async function requestAuth(): Promise<void> {
  authBtn.disabled = true
  setAuthStatus('正在请求 Chrome 授权…')
  try {
    const granted = await chrome.permissions.request({ origins: [`*://${domain}/*`] })
    if (!granted) {
      setAuthStatus('浏览器未授予该站点权限，请重试。', true)
      return
    }
    const verified = await isAuthorized(domain)
    if (!verified) {
      setAuthStatus('Chrome 未确认站点权限，请重新加载扩展后重试。', true)
      return
    }
    await ensureContentScriptActive()
    setAuthStatus('已授权，过滤脚本已启动。')
    cutoffInput.disabled = false
    document
      .querySelectorAll<HTMLButtonElement>('.preset[data-preset]')
      .forEach((button) => (button.disabled = false))
    bindEvents()
  } catch (error) {
    const detail = error instanceof Error ? `：${error.message}` : ''
    setAuthStatus(`授权请求失败${detail}`, true)
  } finally {
    authBtn.disabled = false
  }
}

function setAuthStatus(message: string, isError = false): void {
  authStatus.textContent = message
  authStatus.hidden = false
  authStatus.classList.toggle('error', isError)
}

function getContentScriptJs(): string[] {
  return chrome.runtime.getManifest().content_scripts?.[0]?.js ?? []
}

async function ensureContentScriptActive(): Promise<void> {
  if (tabId === undefined) return

  try {
    const current = await chrome.tabs.sendMessage(tabId, { type: 'QUERY_STATE' })
    if (current) return
  } catch {
    // The current page has not received the content script yet.
  }

  const js = getContentScriptJs()
  if (js.length === 0) throw new Error('扩展构建中缺少内容脚本')
  const match = `*://${domain}/*`
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] })

  if (existing.length > 0) {
    const matches = [...new Set([...(existing[0].matches ?? []), match])]
    await chrome.scripting.updateContentScripts([
      { id: CONTENT_SCRIPT_ID, matches, js, runAt: 'document_idle', persistAcrossSessions: true },
    ])
  } else {
    await chrome.scripting.registerContentScripts([
      { id: CONTENT_SCRIPT_ID, matches: [match], js, runAt: 'document_idle', persistAcrossSessions: true },
    ])
  }

  await chrome.scripting.executeScript({ target: { tabId }, files: js })
}

/** 向当前 Tab 的 Content Script 查询状态（未注入时 catch 降级） */
async function refreshContentState(): Promise<void> {
  if (tabId === undefined) return
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'QUERY_STATE' })
    if (res) state = res as ContentState
  } catch {
    // content script 未注入（授权刚生效需刷新页面）
  }
  render()
}

function bindEvents(): void {
  toggleBtn.disabled = false
  toggleBtn.addEventListener('click', async () => {
    if (tabId === undefined) return
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_FILTER' })
    } catch {
      /* 未注入 */
    }
    await refreshContentState()
  })

  cutoffInput.addEventListener('change', () => void saveCutoff())
  document.querySelectorAll<HTMLButtonElement>('.preset[data-preset]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ts = resolvePreset(btn.dataset.preset ?? '')
      cutoffInput.value = toLocalInputValue(new Date(ts))
      await saveCutoff(ts)
    })
  })
  document.querySelectorAll<HTMLInputElement>('input[name="strategy"]').forEach((r) => {
    r.addEventListener('change', () => void saveCutoff())
  })
}

async function saveCutoff(explicitTs?: number): Promise<void> {
  if (tabId === undefined) return
  const value = cutoffInput.value
  const ts = explicitTs ?? (value ? new Date(value).getTime() : null)
  if (ts === null || Number.isNaN(ts)) return
  const next: TimeSettings = {
    mode: 'cutoff',
    cutoff: ts,
    strategy: currentStrategy(),
  }
  await setTimeSettings(domain, next)
  await refreshContentState()
}

function currentStrategy(): TimeSettings['strategy'] {
  const checked = document.querySelector<HTMLInputElement>('input[name="strategy"]:checked')
  return (checked?.value as TimeSettings['strategy']) ?? 'hide'
}

function syncStrategy(strategy: TimeSettings['strategy']): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="strategy"][value="${strategy}"]`)
  if (radio) radio.checked = true
}

function resolvePreset(preset: string): number {
  const now = Date.now()
  const dayStart = (): number => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  switch (preset) {
    case '1_hour_ago': return now - 60 * 60 * 1000
    case 'today_midnight': return dayStart()
    case 'yesterday_midnight': return dayStart() - 24 * 60 * 60 * 1000
    default: return now
  }
}

function render(): void {
  const hasCutoff = state.hasSettings
  toggleBtn.textContent = state.enabled ? '关闭' : '开启'
  toggleBtn.disabled = !hasCutoff
  countEl.textContent =
    state.filteredCount > 0
      ? `已过滤: ${state.filteredCount} 条${state.unparseableCount > 0 ? `（${state.unparseableCount} 条无法解析）` : ''}`
      : '已过滤: 0 条'
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

init().catch((err) => console.error('[时光机] popup init failed', err))
