/**
 * Content Script — 核心过滤逻辑（P1）
 *
 * 由 background 经 chrome.scripting 动态注册注入（仅已授权域名生效）。
 *
 * 职责：
 * - 读按域名时间设置（timeSettings.<domain>）+ 适配包 + 全局偏好（prefs）
 * - MutationObserver 监听新帖子/评论（无限滚动）
 * - 相对时间戳锚定解析 + 绝对时间解析（含"今天/昨天 HH:mm"）
 * - 截止模式判定：帖子/评论时间 > 截止时间 → 过滤（隐藏/折叠）
 * - 评论无时间戳回退策略（prefs.commentNoTime：全部显示/默认折叠，P2-4）
 * - 过滤计数器上报（SW 更新图标角标）
 * - 适配包失效检测（5s 零匹配 → 提示条，不过滤）
 * - 开关（按 Tab 独立，新 Tab 默认开启）与时间变更消息处理
 */
import { AdapterManager } from '../adapters'
import { VirtualPaginationController, type PostDecision } from './virtual-pagination'
import { extractDomain, getPrefs, getTimeSettings } from '../shared/storage'
import { extractTimestampText, parseTimestamp } from '../shared/time'
import type {
  ContentCompleteness,
  ContentState,
  PlatformAdapter,
  RuntimeMessage,
  TimeDiagnostic,
  TimeSettings,
  ScanProgress,
} from '../shared/types'

// ---------- 状态（按 Tab 实例，不持久化）----------
let enabled = true // 新 Tab 默认开启
let domain = ''
let adapter: PlatformAdapter | null = null
let settings: TimeSettings | null = null
let commentNoTime: 'show' | 'collapse' = 'show' // 评论无时间戳回退（prefs）
let floatingBanner = false // 悬浮提示条开关（prefs，P2-8）
let filteredCount = 0
let unparseableCount = 0
let observer: MutationObserver | null = null
let processed = new WeakSet<Element>()
let mismatchChecked = false
let virtualPagination: VirtualPaginationController | null = null
let virtualContextValue = ''
let virtualRestartTimer: ReturnType<typeof setTimeout> | null = null
let virtualTransitionActive = false
let virtualTransitionId = 0
let lastScanReapplyAt = 0 // 虚拟分页 DOM 未就绪时对 reapplyAll 的节流时间戳
let feedContextValue = ''
let feedRestartTimer: ReturnType<typeof setTimeout> | null = null
let completeness: ContentCompleteness = 'complete'
let diagnostics: TimeDiagnostic[] = []
let scanProgress: ScanProgress | undefined

const FILTERED_FLAG = 'tmFiltered' // dataset camelCase 键（含连字符会抛 SyntaxError）
const FILTERED_ATTR = 'data-tm-filtered' // 对应 DOM 属性（querySelector 用）

// ---------- 核心：过滤判定与应用 ----------

function matchesPostSelectors(el: Element): boolean {
  return !!adapter && adapter.post_selectors.some((s) => el.matches(s))
}

function matchesCommentSelectors(el: Element): boolean {
  return (
    !!adapter &&
    !!adapter.comment_selectors?.length &&
    adapter.comment_selectors.some((s) => el.matches(s))
  )
}

function shouldFilter(timestamp: number): boolean {
  // 截止模式：帖子时间 > 截止时间 → 过滤
  if (!settings) return false
  if (settings.mode === 'window') {
    const w = settings.window
    if (!w || w.start === null || w.end === null) return false
    return timestamp < w.start || timestamp > w.end
  }
  return settings.cutoff !== null && timestamp > settings.cutoff
}

function applyStrategy(el: HTMLElement): void {
  const strategy = settings?.strategy ?? 'hide'
  if (strategy === 'collapse') {
    collapse(el)
  } else {
    hide(el)
  }
}

function decidePost(el: HTMLElement): PostDecision {
  if (!adapter || !settings || !enabled) return 'include'
  const text = extractTimestampText(
    el,
    adapter.timestamp.selector,
    adapter.timestamp.attr,
    adapter.timestamp.date_attr,
    adapter.timestamp.strip_pattern,
    adapter.timestamp.date_text_selector,
    adapter.timestamp.date_text_scope_selector,
  )
  if (!text) {
    addDiagnostic('post', '未找到时间元素')
    return 'unparseable'
  }
  const anchor = el.dataset.tmAnchor ? Number(el.dataset.tmAnchor) : Date.now()
  if (!el.dataset.tmAnchor) el.dataset.tmAnchor = String(anchor)
  const parsed = parseTimestamp(text, adapter, anchor)
  if (!parsed) {
    addDiagnostic('post', text)
    return 'unparseable'
  }
  return shouldFilter(parsed.timestamp) ? 'filtered' : 'include'
}

/** 隐藏前保存元素原始 display（恢复时还原，避免丢失站点自带 inline 样式） */
function saveOriginalDisplay(el: HTMLElement): void {
  if (el.dataset.tmOrigDisplay !== undefined) return
  const value = el.style.getPropertyValue('display')
  const priority = el.style.getPropertyPriority('display')
  el.dataset.tmOrigDisplay = value
  el.dataset.tmOrigDisplayPriority = priority
}

/** 恢复元素原始 display 并清理标记 */
function restoreOriginalDisplay(el: HTMLElement): void {
  const value = el.dataset.tmOrigDisplay
  if (value !== undefined) {
    const priority = el.dataset.tmOrigDisplayPriority || ''
    if (value) el.style.setProperty('display', value, priority)
    else el.style.removeProperty('display')
    delete el.dataset.tmOrigDisplay
    delete el.dataset.tmOrigDisplayPriority
  } else {
    el.style.display = ''
  }
}

function hide(el: HTMLElement): void {
  saveOriginalDisplay(el)
  el.style.display = 'none'
}

/** 折叠：占位条可点击展开（P2 完善交互，P1 提供基本版） */
function collapse(el: HTMLElement): void {
  saveOriginalDisplay(el)
  const ph = document.createElement('div')
  ph.className = 'tm-collapsed'
  ph.textContent = '⏳ 此帖被时光机过滤'
  ph.style.cssText =
    'padding:10px 14px;margin:8px 0;background:rgba(128,128,128,.08);' +
    'border:1px dashed rgba(128,128,128,.4);border-radius:8px;cursor:pointer;' +
    'font-size:13px;color:#888;text-align:center;'
  ph.addEventListener('click', () => {
    restoreOriginalDisplay(el)
    ph.remove()
  })
  el.parentNode?.insertBefore(ph, el.nextSibling)
  el.style.display = 'none'
}

/** 处理单个帖子：解析时间 → 判定 → 过滤 */
function processPost(el: HTMLElement): void {
  if (!adapter || !settings || !enabled) return
  if (processed.has(el)) return
  processed.add(el)
  if (el.dataset[FILTERED_FLAG] === '1') return

  const decision = decidePost(el)
  if (decision === 'unparseable') {
    unparseableCount++
    report()
    return
  }
  if (decision === 'filtered') {
    filteredCount++
    el.dataset[FILTERED_FLAG] = '1'
    applyStrategy(el)
    report()
  }
}

/** 处理单条评论：按自身时间戳独立判定（P2-4） */
function processComment(el: HTMLElement): void {
  if (!adapter || !settings || !enabled) return
  if (processed.has(el)) return
  processed.add(el)
  if (el.dataset[FILTERED_FLAG] === '1') return
  if (!adapter.comment_timestamp_selector) return

  const text = extractTimestampText(el, adapter.comment_timestamp_selector)
  if (!text) {
    addDiagnostic('comment', '未找到时间元素')
    unparseableCount++
    // 无时间戳 → 按回退策略（默认全部显示；'collapse' 时折叠）
    if (commentNoTime === 'collapse') {
      filteredCount++
      el.dataset[FILTERED_FLAG] = '1'
      applyStrategy(el)
      report()
    } else {
      report()
    }
    return
  }
  // 评论时间锚定：与帖子一致，首次检测时刻持久化
  const anchor = el.dataset.tmAnchor ? Number(el.dataset.tmAnchor) : Date.now()
  if (!el.dataset.tmAnchor) el.dataset.tmAnchor = String(anchor)
  const parsed = parseTimestamp(text, adapter, anchor)
  if (!parsed) {
    addDiagnostic('comment', text)
    unparseableCount++
    if (commentNoTime === 'collapse') {
      filteredCount++
      el.dataset[FILTERED_FLAG] = '1'
      applyStrategy(el)
      report()
    } else {
      report()
    }
    return
  }
  if (shouldFilter(parsed.timestamp)) {
    filteredCount++
    el.dataset[FILTERED_FLAG] = '1'
    applyStrategy(el)
    report()
  }
}

/** 扫描页面已有帖子 + 评论（初始化 / 重应用） */
function scanExisting(): void {
  if (!adapter) return
  const virtualStarted = startVirtualPagination()
  if (!virtualStarted) {
    const posts = document.querySelectorAll(adapter.post_selectors.join(','))
    posts.forEach((el) => processPost(el as HTMLElement))
  }
  if (adapter.comment_selectors?.length) {
    const comments = document.querySelectorAll(adapter.comment_selectors.join(','))
    comments.forEach((el) => processComment(el as HTMLElement))
  }
}

/** 重应用（时间设置变化 / 开关切换）：重置后全量重扫 */
function reapplyAll(): void {
  if (!adapter) return
  lastScanReapplyAt = Date.now()
  if (virtualRestartTimer) clearTimeout(virtualRestartTimer)
  virtualRestartTimer = null
  virtualTransitionActive = false
  virtualTransitionId++
  virtualPagination?.destroy()
  virtualPagination = null
  virtualContextValue = ''
  // 恢复所有标记元素（还原原始 display）
  document
    .querySelectorAll(`[${FILTERED_ATTR}="1"]`)
    .forEach((el) => {
      const htmlEl = el as HTMLElement
      restoreOriginalDisplay(htmlEl)
      delete htmlEl.dataset[FILTERED_FLAG]
    })
  // 清除折叠占位条
  document.querySelectorAll('.tm-collapsed').forEach((ph) => ph.remove())
  // 重置 processed 缓存（WeakSet 不可清空，重建以允许重新判定）
  processed = new WeakSet()
  filteredCount = 0
  unparseableCount = 0
  diagnostics = []
  scanProgress = undefined
  feedContextValue = currentFeedContext()
  completeness = feedContextValue
    ? adapter.feed_context?.completeness ?? 'loaded-only'
    : 'complete'
  scanExisting()
  report()
}

// ---------- 配置驱动虚拟分页 ----------

function startVirtualPagination(): boolean {
  const config = adapter?.virtual_pagination
  const hasTimeBoundary =
    settings?.mode === 'cutoff'
      ? settings.cutoff !== null
      : settings?.window?.start != null && settings.window.end != null
  if (!config || !settings || !enabled || !hasTimeBoundary) return false
  if (virtualPagination?.isActive()) return true
  virtualContextValue = config.context_selector
    ? document.querySelector(config.context_selector)?.textContent?.trim() ?? ''
    : ''
  if (config.empty_selector && document.querySelector(config.empty_selector)) return false
  virtualPagination = VirtualPaginationController.create({
    config,
    postSelector: adapter!.post_selectors.join(','),
    decide: decidePost,
    onDecision: (decision) => {
      if (decision === 'filtered') filteredCount++
      if (decision === 'unparseable') unparseableCount++
      report()
    },
    onStateChange: (progress) => {
      scanProgress = progress
      completeness = progress.state === 'loading'
        ? 'scanning'
        : progress.state === 'exhausted'
          ? 'exhausted'
          : progress.state === 'error'
            ? 'error'
            : 'complete'
      report()
    },
  })
  void virtualPagination?.start()
  return virtualPagination !== null
}

function virtualPaginationDomReady(): boolean {
  const config = adapter?.virtual_pagination
  const hasTimeBoundary = settings?.mode === 'cutoff'
    ? settings.cutoff !== null
    : settings?.window?.start != null && settings.window.end != null
  if (!config || !settings || !enabled || !hasTimeBoundary) return false
  if (config.empty_selector && document.querySelector(config.empty_selector)) return false
  return !!document.querySelector(config.list_selector)
    && !!document.querySelector(config.native_pagination_selector)
}

function virtualSourceSignature(): string {
  const config = adapter?.virtual_pagination
  if (!config) return ''
  const list = document.querySelector(config.list_selector)
  return [...(list?.querySelectorAll(config.post_id.selector) ?? [])]
    .map((element) => element.getAttribute(config.post_id.attr) ?? '')
    .join('|')
}

function scheduleVirtualContextRestart(expectedContext = '', domAlreadyChanged = false): void {
  const config = adapter?.virtual_pagination
  if (!config) return
  if (virtualRestartTimer) clearTimeout(virtualRestartTimer)
  const transitionId = ++virtualTransitionId
  const previousContext = virtualContextValue
  const previousList = document.querySelector(config.list_selector)
  const previousPagination = document.querySelector(config.native_pagination_selector)
  const previousEmpty = config.empty_selector
    ? document.querySelector(config.empty_selector)
    : null
  const previousSignature = virtualSourceSignature()
  const stableWait = config.context_wait_ms ?? config.wait_ms ?? 250
  const deadline = Date.now() + Math.max(8000, stableWait * 4)
  let candidateKey = ''
  let candidateSince = 0
  virtualTransitionActive = true
  // 旧会话若继续扫描，会在站点切换类别时点击已经过期的原生分页。
  virtualPagination?.destroy()
  virtualPagination = null
  scanProgress = undefined

  const poll = (): void => {
    if (transitionId !== virtualTransitionId) return
    const currentContext = config.context_selector
      ? document.querySelector(config.context_selector)?.textContent?.trim() ?? ''
      : ''
    const contextReady = expectedContext
      ? currentContext === expectedContext
      : !!currentContext && currentContext !== previousContext
    const empty = config.empty_selector
      ? document.querySelector(config.empty_selector)
      : null
    const list = document.querySelector(config.list_selector)
    const pagination = document.querySelector(config.native_pagination_selector)
    const signature = virtualSourceSignature()
    const nativeChanged = domAlreadyChanged
      || list !== previousList
      || pagination !== previousPagination
      || signature !== previousSignature
    const emptyChanged = domAlreadyChanged || empty !== previousEmpty
    const nextCandidateKey = contextReady && empty && emptyChanged
      ? `empty:${currentContext}:${empty.textContent?.trim() ?? ''}`
      : contextReady && list && pagination && nativeChanged
        ? `list:${currentContext}:${signature}`
        : ''

    if (nextCandidateKey && nextCandidateKey === candidateKey) {
      if (Date.now() - candidateSince >= stableWait) {
        virtualTransitionActive = false
        virtualRestartTimer = null
        reapplyAll()
        return
      }
    } else {
      candidateKey = nextCandidateKey
      candidateSince = nextCandidateKey ? Date.now() : 0
    }

    if (Date.now() >= deadline) {
      virtualTransitionActive = false
      virtualRestartTimer = null
      return
    }
    virtualRestartTimer = setTimeout(poll, Math.max(50, Math.min(config.wait_ms, 150)))
  }
  virtualRestartTimer = setTimeout(poll, Math.max(50, Math.min(config.wait_ms, 150)))
}

function virtualContextChanged(): boolean {
  const selector = adapter?.virtual_pagination?.context_selector
  if (!selector) return false
  const current = document.querySelector(selector)?.textContent?.trim() ?? ''
  if (!current || !virtualContextValue || current === virtualContextValue) return false
  if (!virtualTransitionActive) scheduleVirtualContextRestart(current, true)
  return true
}

function handleVirtualContextClick(event: Event): void {
  const config = adapter?.virtual_pagination
  const target = event.target
  if (!config?.context_trigger_selector || !(target instanceof Element)) return
  const trigger = target.closest(config.context_trigger_selector)
  if (!trigger) return
  if (config.context_selector && trigger.matches(config.context_selector)) return
  scheduleVirtualContextRestart(trigger.textContent?.trim() ?? '')
}

let lastReportKey = ''

/** 上报过滤状态；内容未变化时跳过（滚动加载中避免逐帖 IPC 与 banner 重建） */
function report(): void {
  const key = [
    filteredCount,
    unparseableCount,
    currentContext(),
    completeness,
    scanProgress?.state ?? '',
    scanProgress?.scannedPages ?? 0,
  ].join('|')
  if (key === lastReportKey) return
  lastReportKey = key
  chrome.runtime
    .sendMessage({
      type: 'FILTER_COUNT_UPDATED',
      count: filteredCount,
      unparseable: unparseableCount,
      context: currentContext(),
      completeness,
      scan: scanProgress,
    })
    .catch(() => {})
  updateBanner()
}

// ---------- 悬浮提示条（P2-8）----------

let bannerEl: HTMLElement | null = null
let bannerTimer: ReturnType<typeof setTimeout> | null = null

function fmtCutoff(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function bannerText(): string {
  const boundary = settings!.mode === 'window'
    ? `区间: ${fmtCutoff(settings!.window!.start!)} 至 ${fmtCutoff(settings!.window!.end!)}`
    : `截止: ${fmtCutoff(settings!.cutoff!)}`
  return (
    `⏳ 时光机已激活 | ${boundary} | 已过滤 ${filteredCount} 条` +
    (unparseableCount > 0 ? `（${unparseableCount} 条无法解析）` : '') +
    (completeness === 'loaded-only' ? ' | 仅过滤已加载内容' : '') +
    (scanProgress ? ` | 已扫描 ${scanProgress.scannedPages} 个原始页` : '')
  )
}

function removeBannerUi(): void {
  bannerEl?.remove()
  bannerEl = null
}

/** 渲染（或移除）悬浮条；高频调用经 250ms 节流合并为一次 DOM 更新 */
function updateBanner(): void {
  if (bannerTimer) return
  bannerTimer = setTimeout(() => {
    bannerTimer = null
    const hasBoundary = settings?.mode === 'window'
      ? settings.window?.start != null && settings.window.end != null
      : settings?.cutoff != null
    if (!floatingBanner || !settings || !hasBoundary) {
      removeBannerUi()
      return
    }
    if (!bannerEl) {
      bannerEl = document.createElement('div')
      bannerEl.className = 'tm-banner'
      bannerEl.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:999998;max-width:320px;' +
        'background:rgba(20,20,20,.88);color:#fff;border-radius:10px;' +
        'padding:10px 14px;font-size:12px;line-height:1.6;box-shadow:0 4px 16px rgba(0,0,0,.25);' +
        'backdrop-filter:blur(4px);'
      const close = document.createElement('button')
      close.textContent = '×'
      close.style.cssText =
        'position:absolute;top:4px;right:6px;background:none;border:none;color:#aaa;' +
        'font-size:14px;cursor:pointer;padding:2px 4px;'
      close.addEventListener('click', () => {
        bannerEl?.remove()
        bannerEl = null
      })
      const content = document.createElement('div')
      content.className = 'tm-banner-content'
      bannerEl.append(close, content)
      document.body.appendChild(bannerEl)
    }
    const content = bannerEl.querySelector<HTMLElement>('.tm-banner-content')
    if (content) content.textContent = bannerText()
  }, 250)
}

// ---------- MutationObserver ----------

function startObserver(): void {
  if (!adapter || observer) return
  observer = new MutationObserver((mutations) => {
    if (virtualContextChanged()) return
    if (feedContextChanged()) return
    // 类别响应可能慢于重启等待窗口；原生列表与分页真正到位后再重建。
    // 节流：create 失败（DOM 未就绪）时避免每批 DOM 变化都触发全量重扫。
    if (
      !virtualTransitionActive &&
      !virtualPagination?.isActive() &&
      virtualContextValue &&
      virtualPaginationDomReady()
    ) {
      const now = Date.now()
      if (now - lastScanReapplyAt >= 500) {
        lastScanReapplyAt = now
        reapplyAll()
      }
      return
    }
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (matchesPostSelectors(node)) {
          if (!virtualTransitionActive && !virtualPagination?.isActive()) processPost(node)
          continue
        }
        if (matchesCommentSelectors(node)) {
          processComment(node)
          continue
        }
        if (!node.querySelector) continue
        const postSel = adapter!.post_selectors.join(',')
        if (postSel && !virtualTransitionActive && !virtualPagination?.isActive()) {
          node.querySelectorAll(postSel).forEach((sub) => processPost(sub as HTMLElement))
        }
        const cmtSel = adapter!.comment_selectors?.join(',')
        if (cmtSel) {
          node.querySelectorAll(cmtSel).forEach((sub) => processComment(sub as HTMLElement))
        }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('click', handleVirtualContextClick, true)
  document.addEventListener('click', handleFeedContextClick, true)
}

function feedContextEnabled(): boolean {
  const config = adapter?.feed_context
  return !!config && config.path_patterns.some((pattern) => new RegExp(pattern).test(location.pathname))
}

function currentFeedContext(): string {
  const config = adapter?.feed_context
  if (!config || !feedContextEnabled()) return ''
  const values = config.active_selectors
    .map((selector) => document.querySelector(selector)?.textContent?.trim() ?? '')
    .filter((value, index, all) => value && all.indexOf(value) === index)
  return values.join(' / ')
}

function currentContext(): string {
  if (virtualContextValue) return virtualContextValue
  return currentFeedContext()
}

function feedContextChanged(): boolean {
  if (!feedContextEnabled()) return false
  const current = currentFeedContext()
  if (!current || !feedContextValue || current === feedContextValue) return false
  scheduleFeedContextRestart()
  return true
}

function handleFeedContextClick(event: Event): void {
  const config = adapter?.feed_context
  const target = event.target
  if (!config || !feedContextEnabled() || !(target instanceof Element)) return
  if (!config.trigger_selectors.some((selector) => target.closest(selector))) return
  scheduleFeedContextRestart()
}

function scheduleFeedContextRestart(): void {
  if (feedRestartTimer) clearTimeout(feedRestartTimer)
  feedRestartTimer = setTimeout(() => {
    feedRestartTimer = null
    const next = currentFeedContext()
    if (next && next !== feedContextValue) reapplyAll()
  }, adapter?.feed_context?.wait_ms ?? 250)
}

function addDiagnostic(kind: TimeDiagnostic['kind'], raw: string): void {
  const normalized = raw.trim().replace(/\s+/g, ' ').slice(0, 80) || '空文本'
  if (diagnostics.some((item) => item.kind === kind && item.raw === normalized)) return
  if (diagnostics.length >= 8) return
  diagnostics.push({
    kind,
    raw: normalized,
    page: location.pathname,
    context: currentContext(),
  })
}

// ---------- 适配包失效检测（P1-5）----------

/** 页面是否命中评论结构（详情评论页是合法过滤目标，失效检测应豁免） */
function hasCommentMatch(): boolean {
  return (
    !!adapter?.comment_selectors?.length &&
    adapter.comment_selectors.some((sel) => document.querySelector(sel) !== null)
  )
}

/** 页面是否为信息流承载页（首页类别上下文 / 虚拟分页列表页），改版时才会反馈为「选择器失效」 */
function isFeedPage(): boolean {
  if (feedContextEnabled()) return true
  const vp = adapter?.virtual_pagination
  if (vp && document.querySelector(vp.list_selector) && document.querySelector(vp.native_pagination_selector)) {
    return true
  }
  return false
}

function scheduleMismatchCheck(): void {
  if (!adapter || mismatchChecked) return
  mismatchChecked = true
  setTimeout(() => {
    if (!adapter || !enabled) return
    // 检查所有 post_selectors 是否全部零匹配
    const anyMatch = adapter.post_selectors.some((sel) => document.querySelector(sel) !== null)
    if (!anyMatch) {
      // 详情/评论页零帖子匹配属正常（评论独立过滤），不视为适配失效
      if (hasCommentMatch()) return
      // 个人主页/搜索/正文等非信息流页面不承载列表，不得弹失效模态
      if (!isFeedPage()) return
      // 5s 零匹配 → 适配包可能失效：不过滤 + 强制模态
      showMismatchBanner(adapter.name)
    }
  }, 5000)
}

/** P2-10：失效检测 → 不可关闭的模态浮层（遮罩 + 卡片 + 刷新按钮） */
function showMismatchBanner(platformName: string): void {
  const overlay = document.createElement('div')
  overlay.className = 'tm-mismatch-modal'
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);' +
    'display:flex;align-items:center;justify-content:center;'
  const card = document.createElement('div')
  card.style.cssText =
    'background:#fff;color:#1f2329;border-radius:14px;max-width:360px;width:88%;' +
    'padding:24px 22px;box-shadow:0 12px 40px rgba(0,0,0,.3);text-align:center;'
  const title = document.createElement('div')
  title.textContent = '⚠️ 时光机需要更新'
  title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:10px;'
  const desc = document.createElement('div')
  desc.textContent = `${platformName} 页面结构可能已变化，过滤已暂停。请点击下方按钮刷新页面重试。`
  desc.style.cssText = 'font-size:13px;color:#4b5563;line-height:1.7;margin-bottom:18px;'
  const btn = document.createElement('button')
  btn.textContent = '刷新重试'
  btn.style.cssText =
    'border:none;border-radius:8px;background:#2563eb;color:#fff;' +
    'padding:9px 28px;font-size:14px;cursor:pointer;'
  btn.addEventListener('click', () => location.reload())
  card.append(title, desc, btn)
  overlay.appendChild(card)
  document.body.appendChild(overlay)
}

// ---------- 消息监听 ----------

/**
 * 站点授权被撤销：停止一切过滤行为、恢复 DOM、断开观察器（幂等，可重复接收）。
 * 由 background 在 permissions.onRemoved 时广播。
 */
function stopFiltering(): void {
  enabled = false
  adapter = null
  settings = null
  observer?.disconnect()
  observer = null
  document.removeEventListener('click', handleVirtualContextClick, true)
  document.removeEventListener('click', handleFeedContextClick, true)
  if (virtualRestartTimer) {
    clearTimeout(virtualRestartTimer)
    virtualRestartTimer = null
  }
  if (feedRestartTimer) {
    clearTimeout(feedRestartTimer)
    feedRestartTimer = null
  }
  if (bannerTimer) {
    clearTimeout(bannerTimer)
    bannerTimer = null
  }
  virtualPagination?.destroy()
  virtualPagination = null
  // 恢复所有被过滤元素与占位条
  document
    .querySelectorAll(`[${FILTERED_ATTR}="1"]`)
    .forEach((el) => {
      const htmlEl = el as HTMLElement
      restoreOriginalDisplay(htmlEl)
      delete htmlEl.dataset[FILTERED_FLAG]
    })
  document.querySelectorAll('.tm-collapsed').forEach((ph) => ph.remove())
  removeBannerUi()
  filteredCount = 0
  unparseableCount = 0
  diagnostics = []
  processed = new WeakSet()
  completeness = 'complete'
  scanProgress = undefined
  virtualContextValue = ''
  feedContextValue = ''
  chrome.runtime
    .sendMessage({ type: 'FILTER_STATE_CHANGED', enabled: false })
    .catch(() => {})
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  switch (msg.type) {
    case 'TIME_SETTINGS_UPDATED':
      void reloadSettings()
      break
    case 'ADAPTERS_UPDATED':
      // P2-5：远程适配包已更新 → 重新加载并重扫
      void reloadAdapter()
      break
    case 'PERMISSION_REVOKED':
      // 授权撤销：清理并停止（页面刷新前不再过滤）
      stopFiltering()
      break
    case 'TOGGLE_FILTER':
      // 无适配包或未设定时间（含 active_paths 白名单外页面）时不响应，避免图标状态与实况脱节
      if (!adapter || !settings) break
      enabled = !enabled
      reapplyAll()
      chrome.runtime
        .sendMessage({ type: 'FILTER_STATE_CHANGED', enabled })
        .catch(() => {})
      break
    case 'QUERY_STATE': {
      const state: ContentState = {
        enabled,
        hasSettings: settings !== null,
        hasAdapter: adapter !== null,
        filteredCount,
        unparseableCount,
        context: currentContext(),
        completeness,
        diagnostics: [...diagnostics],
        scan: scanProgress,
      }
      sendResponse(state)
      break
    }
  }
})

// ---------- 初始化 ----------

async function reloadPrefs(): Promise<void> {
  const prefs = await getPrefs()
  commentNoTime = prefs.commentNoTime
  floatingBanner = prefs.floatingBanner
  updateBanner()
}

async function reloadSettings(): Promise<void> {
  settings = await getTimeSettings(domain)
  await reloadPrefs()
  if (!enabled && !settings) return
  reapplyAll()
}

// P2-8：设置页修改 prefs（悬浮条开关等）后即时生效
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.prefs) return
  void reloadPrefs()
})

/** P2-5：远程适配包更新后重载适配器并重扫 */
async function reloadAdapter(): Promise<void> {
  await AdapterManager.loadRemoteFromStorage()
  adapter = AdapterManager.getAdapter(domain)
  if (!adapter) return
  // 与 init 同样执行白名单判定；页面不在范围内时保持静默退出
  if (!isPathAllowed(adapter)) {
    console.log('[时光机] 页面类型不在适配范围，跳过:', location.pathname)
    adapter = null
    return
  }
  reapplyAll()
}

/** 页面是否在适配包 active_paths 白名单内（未声明时始终允许） */
function isPathAllowed(platform: PlatformAdapter): boolean {
  if (!platform.active_paths?.length) return true
  return platform.active_paths.some((pattern) => {
    try {
      return new RegExp(pattern).test(location.pathname)
    } catch {
      return false
    }
  })
}

async function init(): Promise<void> {
  domain = extractDomain(location.hostname)
  // P2-5：优先加载 storage 中已更新的远程适配包
  await AdapterManager.loadRemoteFromStorage()
  adapter = AdapterManager.getAdapter(domain)
  if (!adapter) {
    console.log('[时光机] 无适配包，跳过:', domain)
    return
  }
  // active_paths 白名单：声明后仅匹配路径启用过滤与失效检测，其他路径静默退出；
  // adapter 置 null 使 reloadSettings/reloadAdapter/reapplyAll 等消息通路同样早退
  if (!isPathAllowed(adapter)) {
    console.log('[时光机] 页面类型不在适配范围，跳过:', location.pathname)
    adapter = null
    return
  }
  settings = await getTimeSettings(domain)
  await reloadPrefs()
  feedContextValue = currentFeedContext()
  completeness = feedContextValue
    ? adapter.feed_context?.completeness ?? 'loaded-only'
    : 'complete'
  scanExisting()
  startObserver()
  scheduleMismatchCheck()
  console.log(
    `[时光机] 已激活: ${adapter.name} | 模式=${settings?.mode ?? '未设定'} | 边界=${settings?.mode === 'window' ? `${settings.window?.start ?? '-'}..${settings.window?.end ?? '-'}` : settings?.cutoff ?? '-'} | 策略=${settings?.strategy ?? 'hide'} | 评论回退=${commentNoTime}`,
  )
}

void init()
