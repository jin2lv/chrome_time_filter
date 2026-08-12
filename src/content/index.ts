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
import { extractDomain, getPrefs, getTimeSettings } from '../shared/storage'
import { extractTimestampText, parseTimestamp } from '../shared/time'
import type {
  ContentState,
  PlatformAdapter,
  RuntimeMessage,
  TimeSettings,
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

function hide(el: HTMLElement): void {
  el.style.display = 'none'
}

/** 折叠：占位条可点击展开（P2 完善交互，P1 提供基本版） */
function collapse(el: HTMLElement): void {
  const ph = document.createElement('div')
  ph.className = 'tm-collapsed'
  ph.textContent = '⏳ 此帖被时光机过滤'
  ph.style.cssText =
    'padding:10px 14px;margin:8px 0;background:rgba(128,128,128,.08);' +
    'border:1px dashed rgba(128,128,128,.4);border-radius:8px;cursor:pointer;' +
    'font-size:13px;color:#888;text-align:center;'
  ph.addEventListener('click', () => {
    el.style.display = ''
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

  const text = extractTimestampText(
    el,
    adapter.timestamp.selector,
    adapter.timestamp.attr,
    adapter.timestamp.date_attr,
    adapter.timestamp.strip_pattern,
  )
  if (!text) {
    unparseableCount++
    report()
    return
  }
  // 时间锚定：首次检测到帖子的时刻为锚点，写入 dataset 以便 reapplyAll 后仍使用原锚点
  const anchor = el.dataset.tmAnchor ? Number(el.dataset.tmAnchor) : Date.now()
  if (!el.dataset.tmAnchor) el.dataset.tmAnchor = String(anchor)
  const parsed = parseTimestamp(text, adapter, anchor)
  if (!parsed) {
    unparseableCount++
    report()
    return
  }
  if (shouldFilter(parsed.timestamp)) {
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
    // 无时间戳 → 按回退策略（默认全部显示；'collapse' 时折叠）
    if (commentNoTime === 'collapse') {
      filteredCount++
      el.dataset[FILTERED_FLAG] = '1'
      applyStrategy(el)
      report()
    }
    return
  }
  // 评论时间锚定：与帖子一致，首次检测时刻持久化
  const anchor = el.dataset.tmAnchor ? Number(el.dataset.tmAnchor) : Date.now()
  if (!el.dataset.tmAnchor) el.dataset.tmAnchor = String(anchor)
  const parsed = parseTimestamp(text, adapter, anchor)
  if (!parsed) {
    if (commentNoTime === 'collapse') {
      filteredCount++
      el.dataset[FILTERED_FLAG] = '1'
      applyStrategy(el)
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
  const posts = document.querySelectorAll(adapter.post_selectors.join(','))
  posts.forEach((el) => processPost(el as HTMLElement))
  if (adapter.comment_selectors?.length) {
    const comments = document.querySelectorAll(adapter.comment_selectors.join(','))
    comments.forEach((el) => processComment(el as HTMLElement))
  }
}

/** 重应用（时间设置变化 / 开关切换）：重置后全量重扫 */
function reapplyAll(): void {
  if (!adapter) return
  // 恢复所有标记元素
  document
    .querySelectorAll(`[${FILTERED_ATTR}="1"]`)
    .forEach((el) => {
      const htmlEl = el as HTMLElement
      htmlEl.style.display = ''
      delete htmlEl.dataset[FILTERED_FLAG]
    })
  // 清除折叠占位条
  document.querySelectorAll('.tm-collapsed').forEach((ph) => ph.remove())
  // 重置 processed 缓存（WeakSet 不可清空，重建以允许重新判定）
  processed = new WeakSet()
  filteredCount = 0
  unparseableCount = 0
  scanExisting()
  report()
}

function report(): void {
  chrome.runtime
    .sendMessage({
      type: 'FILTER_COUNT_UPDATED',
      count: filteredCount,
      unparseable: unparseableCount,
    })
    .catch(() => {})
  updateBanner()
}

// ---------- 悬浮提示条（P2-8）----------

let bannerEl: HTMLElement | null = null

function fmtCutoff(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function updateBanner(): void {
  if (!floatingBanner || settings?.cutoff == null) {
    bannerEl?.remove()
    bannerEl = null
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
    bannerEl.appendChild(close)
    document.body.appendChild(bannerEl)
  }
  const content = document.createElement('div')
  content.textContent =
    `⏳ 时光机已激活 | 截止: ${fmtCutoff(settings.cutoff)} | 已过滤 ${filteredCount} 条` +
    (unparseableCount > 0 ? `（${unparseableCount} 条无法解析）` : '')
  bannerEl.appendChild(content)
  // 保留 [关闭按钮, 最新内容]，移除更早的内容
  while (bannerEl.children.length > 2) bannerEl.removeChild(bannerEl.children[1])
}

// ---------- MutationObserver ----------

function startObserver(): void {
  if (!adapter || observer) return
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (matchesPostSelectors(node)) {
          processPost(node)
          continue
        }
        if (matchesCommentSelectors(node)) {
          processComment(node)
          continue
        }
        if (!node.querySelector) continue
        const postSel = adapter!.post_selectors.join(',')
        if (postSel) {
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
}

// ---------- 适配包失效检测（P1-5）----------

function scheduleMismatchCheck(): void {
  if (!adapter || mismatchChecked) return
  mismatchChecked = true
  setTimeout(() => {
    if (!adapter || !enabled) return
    // 检查所有 post_selectors 是否全部零匹配
    const anyMatch = adapter.post_selectors.some((sel) => document.querySelector(sel) !== null)
    if (!anyMatch) {
      // 5s 零匹配 → 适配包可能失效：不过滤 + 提示条（v0.1 非模态）
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

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  switch (msg.type) {
    case 'TIME_SETTINGS_UPDATED':
      void reloadSettings()
      break
    case 'ADAPTERS_UPDATED':
      // P2-5：远程适配包已更新 → 重新加载并重扫
      void reloadAdapter()
      break
    case 'TOGGLE_FILTER':
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
  reapplyAll()
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
  settings = await getTimeSettings(domain)
  await reloadPrefs()
  scanExisting()
  startObserver()
  scheduleMismatchCheck()
  console.log(
    `[时光机] 已激活: ${adapter.name} | 截止=${settings?.cutoff != null ? new Date(settings.cutoff).toLocaleString() : '未设定'} | 策略=${settings?.strategy ?? 'hide'} | 评论回退=${commentNoTime}`,
  )
}

void init()
