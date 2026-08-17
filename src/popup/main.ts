/**
 * Popup 控制面板（P1 完善）
 *
 * 交互（PRD F1/F4）：
 * - 顶部开关：按 Tab 独立，新 Tab 默认开启；域名未设定时间时禁用
 * - 截止/区间模式 + 快捷预设 + 边界校验
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

const cutoffInput = $<HTMLInputElement>('cutoff-input')
const windowStartInput = $<HTMLInputElement>('window-start-input')
const windowEndInput = $<HTMLInputElement>('window-end-input')
const cutoffPanel = $<HTMLDivElement>('cutoff-panel')
const windowPanel = $<HTMLDivElement>('window-panel')
const timeError = $<HTMLParagraphElement>('time-error')
const toggleBtn = $<HTMLButtonElement>('toggle-btn')
const siteEl = $<HTMLDivElement>('site')
const countEl = $<HTMLDivElement>('count')
const authArea = $<HTMLDivElement>('auth-area')
const authBtn = $<HTMLButtonElement>('auth-btn')
const authStatus = $<HTMLParagraphElement>('auth-status')
const settingsBtn = $<HTMLButtonElement>('settings-btn')
const diagnostics = $<HTMLElement>('diagnostics')
const diagnosticsToggle = $<HTMLButtonElement>('diagnostics-toggle')
const diagnosticsDetails = $<HTMLDivElement>('diagnostics-details')
const diagnosticsList = $<HTMLUListElement>('diagnostics-list')
const scopeStatus = $<HTMLParagraphElement>('scope-status')

createIcons({ icons: { Settings } })

let domain = ''
let tabId: number | undefined
let state: ContentState = {
  enabled: true,
  hasSettings: false,
  hasAdapter: false,
  filteredCount: 0,
  unparseableCount: 0,
  diagnostics: [],
}
let eventsBound = false

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
    setTimeControlsDisabled(true)
    authBtn.addEventListener('click', requestAuth)
    return
  }

  // 已授权：读时间设置 + 查询内容脚本状态
  if (isTarget) await ensureContentScriptActive()
  const settings = await getTimeSettings(domain)
  if (settings) {
    syncMode(settings.mode)
    if (settings.cutoff != null) cutoffInput.value = toLocalInputValue(new Date(settings.cutoff))
    if (settings.window?.start != null) {
      windowStartInput.value = toLocalInputValue(new Date(settings.window.start))
    }
    if (settings.window?.end != null) {
      windowEndInput.value = toLocalInputValue(new Date(settings.window.end))
    }
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
    setTimeControlsDisabled(false)
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

  try {
    const current = await chrome.tabs.sendMessage(tabId, { type: 'QUERY_STATE' })
    if (current) return
  } catch {
    // The current page has not received the content script yet.
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
  if (eventsBound) return
  eventsBound = true
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

  document.querySelectorAll<HTMLInputElement>('input[name="time-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      syncMode(currentMode())
      void saveTimeSettings()
    })
  })
  cutoffInput.addEventListener('change', () => void saveTimeSettings())
  windowStartInput.addEventListener('change', () => void saveTimeSettings())
  windowEndInput.addEventListener('change', () => void saveTimeSettings())
  document.querySelectorAll<HTMLButtonElement>('.preset[data-preset]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ts = resolvePreset(btn.dataset.preset ?? '')
      cutoffInput.value = toLocalInputValue(new Date(ts))
      await saveTimeSettings()
    })
  })
  document.querySelectorAll<HTMLButtonElement>('.preset[data-window-preset]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = resolveWindowPreset(btn.dataset.windowPreset ?? '')
      windowStartInput.value = toLocalInputValue(new Date(value.start))
      windowEndInput.value = toLocalInputValue(new Date(value.end))
      await saveTimeSettings()
    })
  })
  document.querySelectorAll<HTMLInputElement>('input[name="strategy"]').forEach((r) => {
    r.addEventListener('change', () => void saveTimeSettings())
  })
  diagnosticsToggle.addEventListener('click', () => {
    const expanded = diagnosticsToggle.getAttribute('aria-expanded') === 'true'
    diagnosticsToggle.setAttribute('aria-expanded', String(!expanded))
    diagnosticsDetails.hidden = expanded
  })
}

async function saveTimeSettings(): Promise<void> {
  if (tabId === undefined) return
  clearTimeError()
  const mode = currentMode()
  let next: TimeSettings
  if (mode === 'window') {
    const start = parseLocalInput(windowStartInput.value)
    const end = parseLocalInput(windowEndInput.value)
    if (start === null || end === null) {
      showTimeError('请同时设置开始时间和结束时间。')
      return
    }
    if (start > end) {
      showTimeError('开始时间不能晚于结束时间。')
      return
    }
    next = { mode, cutoff: null, window: { start, end }, strategy: currentStrategy() }
  } else {
    const cutoff = parseLocalInput(cutoffInput.value)
    if (cutoff === null) {
      showTimeError('请设置截止时间。')
      return
    }
    next = { mode, cutoff, strategy: currentStrategy() }
  }
  await setTimeSettings(domain, next)
  await refreshContentState()
}

function currentMode(): TimeSettings['mode'] {
  return document.querySelector<HTMLInputElement>('input[name="time-mode"]:checked')?.value === 'window'
    ? 'window'
    : 'cutoff'
}

function syncMode(mode: TimeSettings['mode']): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="time-mode"][value="${mode}"]`)
  if (radio) radio.checked = true
  cutoffPanel.hidden = mode !== 'cutoff'
  windowPanel.hidden = mode !== 'window'
  clearTimeError()
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

function resolveWindowPreset(preset: string): { start: number; end: number } {
  const now = new Date()
  const endOfDay = (date: Date): number => {
    const value = new Date(date)
    value.setHours(23, 59, 59, 999)
    return value.getTime()
  }
  const startOfDay = (date: Date): number => {
    const value = new Date(date)
    value.setHours(0, 0, 0, 0)
    return value.getTime()
  }
  if (preset === 'yesterday') {
    const date = new Date(now)
    date.setDate(date.getDate() - 1)
    return { start: startOfDay(date), end: endOfDay(date) }
  }
  if (preset === 'last_3_days') {
    const date = new Date(now)
    date.setDate(date.getDate() - 2)
    return { start: startOfDay(date), end: now.getTime() }
  }
  if (preset === 'this_week') {
    const date = new Date(now)
    const day = date.getDay() || 7
    date.setDate(date.getDate() - day + 1)
    return { start: startOfDay(date), end: now.getTime() }
  }
  return { start: startOfDay(now), end: endOfDay(now) }
}

function render(): void {
  toggleBtn.textContent = state.enabled ? '关闭' : '开启'
  toggleBtn.disabled = !state.hasSettings
  countEl.textContent =
    state.filteredCount > 0
      ? `已过滤: ${state.filteredCount} 条${state.unparseableCount > 0 ? `（${state.unparseableCount} 条无法解析）` : ''}`
      : '已过滤: 0 条'
  diagnostics.hidden = state.diagnostics.length === 0
  diagnosticsList.replaceChildren(
    ...state.diagnostics.map((item) => {
      const li = document.createElement('li')
      li.textContent = `${item.kind === 'comment' ? '评论' : '帖子'}：${item.raw || '无时间文本'}`
      return li
    }),
  )
  const loadedOnly = state.completeness === 'loaded-only'
  const scanMessage = state.scan
    ? scanStatusText(state.scan.state, state.scan.scannedPages, state.scan.maxPages)
    : ''
  scopeStatus.hidden = !loadedOnly && !scanMessage
  scopeStatus.textContent = loadedOnly
    ? `${state.context ? `${state.context}：` : ''}当前类别为智能或热度信息流，仅过滤已加载内容，结果不代表完整时间范围。`
    : scanMessage
}

function scanStatusText(state: NonNullable<ContentState['scan']>['state'], scanned: number, max: number): string {
  if (state === 'loading') return `正在跨页查找，已扫描 ${scanned} 个原生页面。`
  if (state === 'exhausted') return `已扫描 ${scanned} 个原生页面，并到达网站末页。`
  if (state === 'limit') return `已扫描 ${scanned} 个原生页面，达到 ${max} 页安全上限。`
  if (state === 'cancelled') return `扫描已取消，已扫描 ${scanned} 个原生页面。`
  if (state === 'error') return `原生页面加载失败，结果可能不完整；已扫描 ${scanned} 页。`
  return scanned > 0 ? `已扫描 ${scanned} 个原生页面。` : ''
}

function setTimeControlsDisabled(disabled: boolean): void {
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-time-control], input[name="time-mode"], .preset[data-preset], .preset[data-window-preset]')
    .forEach((control) => { control.disabled = disabled })
}

function parseLocalInput(value: string): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function showTimeError(message: string): void {
  timeError.textContent = message
  timeError.hidden = false
}

function clearTimeError(): void {
  timeError.textContent = ''
  timeError.hidden = true
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

init().catch((err) => console.error('[时光机] popup init failed', err))
