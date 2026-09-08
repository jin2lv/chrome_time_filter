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
import { lastTradingDayRange, lunchReviewRange, tradingSessionRange } from '../shared/trading'
import type { ContentState, PlatformAdapter, TimeSettings } from '../shared/types'
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
const copyDiagnosticsBtn = $<HTMLButtonElement>('copy-diagnostics-btn')
const scopeStatus = $<HTMLParagraphElement>('scope-status')

createIcons({ icons: { Settings } })

let domain = ''
let hostname = ''
let tabId: number | undefined
let adapter: PlatformAdapter | null = null
let settings: TimeSettings | null = null
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
  hostname = new URL(tab.url).hostname
  domain = extractDomain(hostname)

  const isTarget = AdapterManager.hasAdapter(domain)
  adapter = AdapterManager.getAdapter(domain)
  // 截止预设按适配包渲染（授权 early-return 之前调用，未授权态按钮存在且被禁用）
  renderCutoffPresets(adapter)
  siteEl.textContent = `${adapter?.name ?? '未知站点'} ${domain}`
  // P2-2：相对时间平台显示精度提示（±5 分钟）
  const hint = document.getElementById('precision-hint')
  if (hint && adapter?.timestamp.type === 'relative') {
    hint.hidden = false
  }

  // 读取全局默认策略并同步到 popup 单选（首次设置时生效）
  const prefs = await getPrefs()
  syncStrategy(prefs.defaultStrategy)

  // 非目标站点（无适配包）：时间设置无意义，禁用全部时间控件
  if (!isTarget) {
    setTimeControlsDisabled(true)
  }

  // 授权检测：目标平台但未授权 → 引导授权
  const authorized = await isAuthorized()
  if (isTarget && !authorized) {
    authArea.hidden = false
    toggleBtn.disabled = true
    setTimeControlsDisabled(true)
    authBtn.addEventListener('click', requestAuth)
    return
  }

  // 已授权：读时间设置 + 查询内容脚本状态
  if (isTarget) await ensureContentScriptActive()
  await loadSettingsIntoUI()
  await refreshContentState()
  bindEvents()
}

/** 读取存储的时间设置并回显到 Popup 输入（init 与授权成功路径共用） */
async function loadSettingsIntoUI(): Promise<void> {
  settings = await getTimeSettings(domain)
  if (!settings) return
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

/**
 * 授权所需的 origin 列表：以实际 hostname 构造（hostname 带 www 且与 apex 不同时一并请求 apex），
 * 并收敛到 manifest optional_host_permissions 已声明的清单——request 无法授予未声明 origin，
 * 派生超出声明会形成授权死结；全部被过滤时回退 apex。
 */
function authOrigins(): string[] {
  const manifest = chrome.runtime.getManifest() as { optional_host_permissions?: string[] }
  const declared = new Set(manifest.optional_host_permissions ?? [])
  const apexOrigin = `*://${extractDomain(hostname)}/*`
  const origins = [`*://${hostname}/*`, apexOrigin]
  const filtered = origins.filter((origin) => declared.has(origin))
  return filtered.length > 0 ? filtered : [apexOrigin]
}

async function isAuthorized(): Promise<boolean> {
  const origins = authOrigins()
  for (const origin of origins) {
    if (!(await chrome.permissions.contains({ origins: [origin] }))) return false
  }
  return origins.length > 0
}

async function requestAuth(): Promise<void> {
  authBtn.disabled = true
  setAuthStatus('正在请求 Chrome 授权…')
  try {
    const granted = await chrome.permissions.request({ origins: authOrigins() })
    if (!granted) {
      setAuthStatus('浏览器未授予该站点权限，请重试。', true)
      return
    }
    const verified = await isAuthorized()
    if (!verified) {
      setAuthStatus('Chrome 未确认站点权限，请重新加载扩展后重试。', true)
      return
    }
    await ensureContentScriptActive()
    // 与 init 已授权路径同构：重读设置回显、隐藏授权区、刷新内容脚本状态
    authArea.hidden = true
    await loadSettingsIntoUI()
    await refreshContentState()
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
  const matches = authOrigins()
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] })

  if (existing.length > 0) {
    const all = [...new Set([...(existing[0].matches ?? []), ...matches])]
    await chrome.scripting.updateContentScripts([
      { id: CONTENT_SCRIPT_ID, matches: all, js, runAt: 'document_idle', persistAcrossSessions: true },
    ])
  } else {
    await chrome.scripting.registerContentScripts([
      { id: CONTENT_SCRIPT_ID, matches, js, runAt: 'document_idle', persistAcrossSessions: true },
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

/** 向当前 Tab 的 Content Script 查询状态（未注入时 catch 降级）
 * @returns 是否成功查询到 content script（false 表示尚未注入）
 */
async function refreshContentState(): Promise<boolean> {
  if (tabId === undefined) return false
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'QUERY_STATE' })
    if (res) state = res as ContentState
    render()
    return true
  } catch {
    // content script 未注入（授权刚生效需刷新页面）
    render()
    return false
  }
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
  copyDiagnosticsBtn.addEventListener('click', () => void copyDiagnostics())
}

/** 复制脱敏诊断报告：仅平台/适配包版本、模式边界、计数与逐条 {kind, page, context, raw, 回退行为} */
function fmtBoundaryTs(ts: number | null | undefined): string {
  return ts == null ? '-' : new Date(ts).toLocaleString()
}

function copyDiagnostics(): void {
  const adapterVersion = AdapterManager.getPackageFor(domain)?.version ?? '?'
  const boundary = settings?.mode === 'window'
    ? `窗口 ${fmtBoundaryTs(settings.window?.start)} .. ${fmtBoundaryTs(settings.window?.end)}`
    : `截止 ${fmtBoundaryTs(settings?.cutoff)}`
  const lines = [
    `时光机诊断报告 | 平台=${adapter?.name ?? '未知'} | 适配包内置版本=${adapterVersion}`,
    `模式=${settings?.mode ?? '未设定'} | 边界=${boundary}`,
    `已过滤 ${state.filteredCount} 条 | ${state.unparseableCount} 条无法解析`,
    ...state.diagnostics.map(
      (item) =>
        `- ${item.kind === 'post' ? '帖子' : '评论'} | 页面=${item.page ?? '-'} | 上下文=${item.context ?? '-'} | 原始时间=${item.raw || '无时间文本'} | 回退行为=默认显示`,
    ),
  ]
  const text = lines.join('\n')
  navigator.clipboard
    ?.writeText(text)
    .then(() => {
      const original = copyDiagnosticsBtn.textContent
      copyDiagnosticsBtn.textContent = '已复制'
      setTimeout(() => {
        copyDiagnosticsBtn.textContent = original
      }, 1200)
    })
    .catch(() => {
      copyDiagnosticsBtn.textContent = '复制失败'
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
  const queried = await refreshContentState()
  if (!queried) {
    // 设置已写入 storage，但当前页面还没有 content script（如授权后未刷新），给出明确指引
    scopeStatus.hidden = false
    scopeStatus.textContent = '设置已保存。当前页面尚未加载过滤脚本——若刷新页面后仍不生效，请重新授权。'
  }
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

/** 无适配包时的截止预设兜底（与适配包驱动同构） */
const FALLBACK_CUTOFF_PRESETS: { label: string; value: string }[] = [
  { label: '1小时前', value: '1_hour_ago' },
  { label: '今日0点', value: 'today_midnight' },
  { label: '昨日0点', value: 'yesterday_midnight' },
]

/** 按适配包 quick_presets 渲染截止预设按钮；无适配包时用兜底三项 */
function renderCutoffPresets(adapterOrNull: PlatformAdapter | null): void {
  const container = $<HTMLDivElement>('cutoff-presets')
  const presets = adapterOrNull?.quick_presets?.length
    ? adapterOrNull.quick_presets
    : FALLBACK_CUTOFF_PRESETS
  container.replaceChildren(
    ...presets.map((preset) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'preset'
      btn.dataset.preset = preset.value
      btn.textContent = preset.label
      return btn
    }),
  )
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
    case 'today_0915': {
      const d = new Date()
      d.setHours(9, 15, 0, 0)
      return d.getTime()
    }
    case 'today_0930': {
      const d = new Date()
      d.setHours(9, 30, 0, 0)
      return d.getTime()
    }
    case 'yesterday_1500': {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      d.setHours(15, 0, 0, 0)
      return d.getTime()
    }
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
  // 金融场景区间预设（P2-18）：最近一个交易日按工作日处理，不含法定节假日（v1.1 接交易日历）
  if (preset === 'lunch_review') return lunchReviewRange(now)
  if (preset === 'trading_session') return tradingSessionRange(now)
  if (preset === 'trading_day') return lastTradingDayRange(now)
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
      const where = [item.page ? item.page : null, item.context ? `(${item.context})` : null]
        .filter(Boolean)
        .join(' ')
      li.textContent = `${item.kind === 'comment' ? '评论' : '帖子'}${where ? ` ${where}` : ''}：${item.raw || '无时间文本'}`
      return li
    }),
  )
  const loadedOnly = state.completeness === 'loaded-only'
  const scanMessage = state.scan
    ? scanStatusText(state.scan)
    : ''
  scopeStatus.hidden = !loadedOnly && !scanMessage
  scopeStatus.textContent = loadedOnly
    ? `${state.context ? `${state.context}：` : ''}当前类别为智能或热度信息流，仅过滤已加载内容，结果不代表完整时间范围。`
    : scanMessage
}

function scanStatusText(scan: NonNullable<ContentState['scan']>): string {
  const { state, scannedPages: scanned, maxPages: max, unit } = scan
  // 原生页码扫描（个股页）按「原生页面」计数；信息流滚动补拉按「屏」计数（P2-17 切片 1）
  if (unit === 'screens') {
    if (state === 'loading') return `正在查找更早的帖子，已加载 ${scanned} 屏。`
    if (state === 'exhausted') return `已加载 ${scanned} 屏，到达信息流末页。`
    if (state === 'limit') return `已加载 ${scanned} 屏，达到 ${max} 屏安全上限。`
    if (state === 'cancelled') return `补拉已取消，已加载 ${scanned} 屏。`
    return scanned > 0 ? `已加载 ${scanned} 屏。` : ''
  }
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
