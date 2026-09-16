/**
 * 信息流连续补拉引擎（P2-17 切片 1，承接 P2-15 遗留项）
 *
 * 定位：feed_context 页面（如雪球首页）在时间边界下「仅过滤已加载内容」的体验补强。
 * 用户点击「查找更早的帖子」后按需向下滚动加载更多原生内容，新增帖子由 content script
 * 既有过滤链（MutationObserver → processPost）处理；本引擎只负责「拉」：
 * 滚动节流、新增检测、命中统计、停止条件与可信状态上报。
 *
 * 设计约束：
 * - 手动触发，不自动滚动：仅适配包声明为严格时间排序的上下文（backfill.contexts 白名单）
 *   才挂载入口；热度/智能流保持「仅过滤已加载内容」标注，不做不可信回溯。
 * - 与虚拟分页互斥：调用方（content/index.ts）保证 feed 页不会同时激活两者。
 * - 与虚拟分页共享统一状态契约：ScanProgress（unit: 'screens'）→ Popup/悬浮条按单位渲染；
 *   文案统一由 shared/scan-text.ts 提供（切片 2）。
 * - 获取策略（切片 2）：优先滚动追加；滚动无新增且适配包声明 load_more_selector 时，
 *   自动点击「加载更多」继续拉取；按钮拉取同样计入 max_screens 上限（一次用户可见的拉取 = 1 屏）；
 *   按钮缺失/禁用/不可见时维持「无新增计停滞」语义。
 *   真机取证（2026-09-16）修正：雪球首页 7x24 与关注流均由滚动触发无限加载，
 *   `a.home__timeline__more` 在补拉全程为 display:none，未观测到「滚动转按钮式」；
 *   该选择器按防御性配置声明（可见性门控，不可见时不会点击），按钮式路径待其他平台样本验证。
 * - 已在底部的重复触发（真机 2026-09-16 缺陷，已修）：窗口已处于文档底部时
 *   `scrollTo(bottom)` 为空操作，站点不再懒加载新行 → 连续 end_stall_count 屏被误判为
 *   「已到信息流末页」（且 exhausted 后按钮禁用）。修法见 scrollToFeedEnd()：
 *   已到底则先回退一屏、间隔一拍再滚到底，重新触发站点懒加载。**真机复验待下一设备会话**。
 * - 修改前先读懂 content/index.ts 的 reapplyAll/stopFiltering 对本控制器的生命周期管理。
 */
import type { FeedBackfillConfig, ScanProgress } from '../shared/types'
import type { PostDecision } from './virtual-pagination'

export interface FeedBackfillOptions {
  config: FeedBackfillConfig
  /** 当前信息流上下文（currentFeedContext()）；不在 config.contexts 白名单内则拒绝挂载 */
  currentContext: string
  postSelector: string
  decide: (post: HTMLElement) => PostDecision
  onStateChange?: (progress: ScanProgress) => void
}

type BackfillState = 'idle' | 'loading' | 'exhausted' | 'limit' | 'cancelled'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 判定「已处于文档底部」的容差（px） */
const BOTTOM_EPSILON = 2
/** 已在底部时「回退一屏 → 回到底」之间的间隔上限；实际取 min(该值, scroll_delay_ms) */
const REARM_DELAY_MS = 250

export class FeedBackfillController {
  private readonly config: FeedBackfillConfig
  private readonly postSelector: string
  private readonly decide: FeedBackfillOptions['decide']
  private readonly onStateChange?: FeedBackfillOptions['onStateChange']
  private readonly root: HTMLElement
  private readonly status: HTMLElement
  private readonly actionButton: HTMLButtonElement
  private state: BackfillState = 'idle'
  private screens = 0
  private foundHits = 0
  private runId = 0
  private destroyed = false

  /** 挂载入口：上下文不在白名单内返回 null（由调用方决定是否静默） */
  static mount(options: FeedBackfillOptions): FeedBackfillController | null {
    if (!options.config.contexts.includes(options.currentContext)) return null
    return new FeedBackfillController(options)
  }

  private constructor(options: FeedBackfillOptions) {
    this.config = options.config
    this.postSelector = options.postSelector
    this.decide = options.decide
    this.onStateChange = options.onStateChange

    this.root = document.createElement('div')
    this.root.className = 'tm-backfill-bar'
    this.root.dataset.tmBackfill = '1'
    this.root.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:999997;' +
      'display:flex;align-items:center;gap:10px;background:#fff;color:#333;border-radius:10px;' +
      'padding:8px 14px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.18);border:1px solid #e5e5e5;'

    this.status = document.createElement('span')
    this.status.className = 'tm-backfill-status'
    this.status.style.cssText = 'color:#666;'

    this.actionButton = document.createElement('button')
    this.actionButton.type = 'button'
    this.actionButton.textContent = '查找更早的帖子'
    this.actionButton.style.cssText =
      'border:none;border-radius:6px;background:#2563eb;color:#fff;padding:6px 14px;' +
      'font-size:13px;cursor:pointer;'
    this.actionButton.addEventListener('click', () => {
      if (this.state === 'loading') this.cancel()
      else this.start()
    })

    this.root.append(this.status, this.actionButton)
    document.body.appendChild(this.root)
    this.render()
  }

  isActive(): boolean {
    return !this.destroyed
  }

  getProgress(): ScanProgress {
    return {
      state: this.state,
      scannedPages: this.screens,
      maxPages: this.config.max_screens,
      currentSourcePage: '',
      unit: 'screens',
    }
  }

  start(): void {
    if (this.destroyed || this.state === 'loading') return
    if (this.state === 'exhausted') return // 末页后无更多内容可拉
    this.runId++
    void this.run(this.runId)
  }

  cancel(): void {
    if (this.destroyed || this.state !== 'loading') return
    this.runId++
    this.setState('cancelled')
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.runId++
    this.root.remove()
  }

  private setState(state: BackfillState): void {
    this.state = state
    this.render()
    this.onStateChange?.(this.getProgress())
  }

  private emitProgress(): void {
    this.render()
    this.onStateChange?.(this.getProgress())
  }

  private render(): void {
    const total = `已加载 ${this.screens} 屏`
    if (this.state === 'loading') {
      this.status.textContent = `正在查找更早的帖子（${total} / 上限 ${this.config.max_screens} 屏）`
      this.actionButton.textContent = '取消'
      this.actionButton.disabled = false
    } else if (this.state === 'exhausted') {
      this.status.textContent = `已到信息流末页，共找到 ${this.foundHits} 条符合时间条件（${total}）`
      this.actionButton.textContent = '查找更早的帖子'
      this.actionButton.disabled = true
    } else if (this.state === 'limit') {
      this.status.textContent = `已达到 ${this.config.max_screens} 屏安全上限，共找到 ${this.foundHits} 条符合时间条件`
      this.actionButton.textContent = '继续查找'
      this.actionButton.disabled = false
    } else if (this.state === 'cancelled') {
      this.status.textContent = `补拉已取消，共找到 ${this.foundHits} 条符合时间条件（${total}）`
      this.actionButton.textContent = '继续查找'
      this.actionButton.disabled = false
    } else {
      this.status.textContent =
        this.screens > 0 ? `已找到 ${this.foundHits} 条更早的符合时间条件帖子（${total}）` : ''
      this.actionButton.textContent = this.screens > 0 ? '继续查找' : '查找更早的帖子'
      this.actionButton.disabled = false
    }
  }

  /** 当前帖子元素集合（引用级，用于滚动后 diff 新增） */
  private currentPosts(): Set<HTMLElement> {
    return new Set(document.querySelectorAll<HTMLElement>(this.postSelector))
  }

  private async run(run: number): Promise<void> {
    this.setState('loading')
    const stallLimit = this.config.end_stall_count ?? 2
    let stalls = 0
    while (!this.destroyed && run === this.runId) {
      if (this.screens >= this.config.max_screens) {
        this.setState('limit')
        return
      }
      const before = this.currentPosts()
      await this.scrollToFeedEnd()
      if (this.destroyed || run !== this.runId) return
      this.screens++
      this.emitProgress()
      await sleep(this.config.scroll_delay_ms)
      if (this.destroyed || run !== this.runId) return

      let { hits, addedCount } = this.diffSince(before)
      this.foundHits += hits

      // 滚动无新增时尝试「加载更多」按钮式获取（切片 2，数据驱动；未声明则维持原语义）
      if (addedCount === 0 && this.canLoadMore()) {
        if (this.screens >= this.config.max_screens) {
          this.setState('limit')
          return
        }
        this.clickLoadMore()
        this.screens++
        this.emitProgress()
        await sleep(this.config.scroll_delay_ms)
        if (this.destroyed || run !== this.runId) return
        const afterClick = this.diffSince(before)
        hits = afterClick.hits
        addedCount = afterClick.addedCount
        this.foundHits += hits
      }

      if (addedCount === 0) {
        stalls++
        if (stalls >= stallLimit) {
          this.setState('exhausted')
          return
        }
      } else {
        stalls = 0
      }
      this.emitProgress()
      if (this.foundHits >= this.config.target_hits) {
        // 目标达成：回到就绪态，用户可再次触发继续向更早回溯
        this.setState('idle')
        return
      }
    }
  }

  /**
   * 滚到信息流末端，触发站点加载更多。
   *
   * 真机缺陷（2026-09-16）：窗口已处于文档底部时 `scrollTo(bottom)` 是空操作，
   * 站点看不到新的滚动便不再懒加载 → 连续 end_stall_count 屏被误判为「已到信息流末页」
   * （实测第 2 屏即误报，且 exhausted 后按钮禁用，用户需切换类目才能重试）。
   * 修法：已到底时先回退一屏、等一拍让站点重新武装懒加载，再滚到底。
   */
  private async scrollToFeedEnd(): Promise<void> {
    const doc = document.documentElement
    const maxTop = doc.scrollHeight - window.innerHeight
    if (maxTop > 0 && window.scrollY >= maxTop - BOTTOM_EPSILON) {
      window.scrollTo({ top: Math.max(0, maxTop - window.innerHeight), behavior: 'instant' })
      // 回退与回到底之间必须留出可观察的间隔，否则两次滚动会被合并成一帧、站点看不到「离开底部」
      await sleep(Math.min(REARM_DELAY_MS, this.config.scroll_delay_ms))
      if (this.destroyed) return
    }
    window.scrollTo({ top: doc.scrollHeight, behavior: 'instant' })
  }

  /** 统计相对快照的新增帖子与其中符合时间条件的数量（判定仅用于命中统计，过滤由 observer 链负责） */
  private diffSince(before: Set<HTMLElement>): { hits: number; addedCount: number } {
    let hits = 0
    let addedCount = 0
    for (const post of this.currentPosts()) {
      if (before.has(post)) continue
      addedCount++
      if (this.decide(post) === 'include') hits++
    }
    return { hits, addedCount }
  }

  /** 「加载更多」按钮是否可点击（存在、可见、未禁用） */
  private canLoadMore(): boolean {
    const selector = this.config.load_more_selector
    if (!selector) return false
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) return false
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false
    const view = el.ownerDocument.defaultView
    const style = view?.getComputedStyle(el)
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false
    return typeof (el as HTMLButtonElement).click === 'function' || el.tagName === 'A'
  }

  private clickLoadMore(): void {
    const el = document.querySelector<HTMLElement>(this.config.load_more_selector ?? '')
    el?.click()
  }
}
