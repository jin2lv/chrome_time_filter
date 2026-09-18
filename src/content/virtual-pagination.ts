import type { PlatformAdapter, ScanProgress, VirtualSourceMode } from '../shared/types'

type VirtualPaginationConfig = NonNullable<PlatformAdapter['virtual_pagination']>

export type PostDecision = 'include' | 'filtered' | 'unparseable'

/** 源页推进结果：ok = 已取到新源页；exhausted/error/cancelled 由调用方结束会话 */
type SourceAdvance = 'ok' | 'exhausted' | 'error' | 'cancelled'

interface VirtualPaginationOptions {
  config: VirtualPaginationConfig
  postSelector: string
  decide: (post: HTMLElement) => PostDecision
  onDecision: (decision: PostDecision) => void
  onStateChange?: (progress: ScanProgress) => void
}

type ScanState = 'idle' | 'loading' | 'exhausted' | 'limit' | 'cancelled' | 'error'

/**
 * 原生列表的帖子 ID 签名：用于「类别切换 / 翻页前后内容是否真正变化」的检测。
 * content/index.ts 的类别切换轮询与控制器内部共用同一实现，避免两处漂移。
 */
export function listSignature(
  config: Pick<VirtualPaginationConfig, 'list_selector' | 'post_id'>,
): string {
  const list = document.querySelector(config.list_selector)
  return [...(list?.querySelectorAll(config.post_id.selector) ?? [])]
    .map((element) => element.getAttribute(config.post_id.attr) ?? '')
    .join('|')
}

/**
 * Config-driven lazy scanner that repacks matching native pages into extension-owned pages.
 * Platform DOM knowledge stays in the adapter; this class only manages scanning and rendering.
 *
 * 源页获取有两种策略（适配包 `virtual_pagination.source_mode` 声明）：
 * - `click`（缺省）：点击站内翻页控件、等待列表 DOM 变化（AJAX 翻页，如雪球个股页）
 * - `url`：按 `page_url_pattern` 逐页 fetch 服务端整页并用 DOMParser 解析成离线文档
 *   （URL 翻页平台，如集思录/股吧）。整页 fetch 不改动当前页面，因此缓存、去重集合与
 *   扫描游标可跨页保持；客户端渲染的站点不适用该策略（服务端返回的 HTML 里没有帖子）。
 */
export class VirtualPaginationController {
  private readonly config: VirtualPaginationConfig
  private readonly postSelector: string
  private readonly decide: VirtualPaginationOptions['decide']
  private readonly onDecision: VirtualPaginationOptions['onDecision']
  private readonly onStateChange?: VirtualPaginationOptions['onStateChange']
  private readonly sourceMode: VirtualSourceMode
  private nativeList: HTMLElement
  private readonly root: HTMLElement
  private readonly list: HTMLElement
  private readonly status: HTMLElement
  private readonly previousButton: HTMLButtonElement
  private readonly nextButton: HTMLButtonElement
  private readonly cancelButton: HTMLButtonElement
  private readonly nativeDisplays = new Map<HTMLElement, { value: string; priority: string }>()
  private readonly nativeStyle: HTMLStyleElement
  private readonly nativeVisibilityObserver: MutationObserver
  private readonly nativeDomObserver: MutationObserver
  private readonly cached: HTMLElement[] = []
  private readonly seenIds = new Set<string>()
  private readonly seenSourcePages = new Set<string>()
  /** url 模式：当前已取到的源页码与离线文档（click 模式未使用） */
  private urlPage = 0
  private fetchedDoc: Document | null = null
  private fetchedPageUrl = ''
  private pageIndex = 0
  private scannedSourcePages = 0
  private state: ScanState = 'idle'
  private runId = 0
  private destroyed = false

  static create(options: VirtualPaginationOptions): VirtualPaginationController | null {
    const nativeList = document.querySelector<HTMLElement>(options.config.list_selector)
    const nativePagination = document.querySelector<HTMLElement>(
      options.config.native_pagination_selector,
    )
    if (!nativeList || !nativePagination) return null
    return new VirtualPaginationController(options, nativeList)
  }

  private constructor(options: VirtualPaginationOptions, nativeList: HTMLElement) {
    this.config = options.config
    this.postSelector = options.postSelector
    this.decide = options.decide
    this.onDecision = options.onDecision
    this.onStateChange = options.onStateChange
    this.sourceMode = options.config.source_mode ?? 'click'
    this.nativeList = nativeList

    this.root = document.createElement('section')
    this.root.className = 'tm-virtual-pagination'
    this.root.dataset.tmVirtualPagination = '1'
    this.root.style.cssText = 'display:block;width:100%;'

    this.nativeStyle = document.createElement('style')
    this.nativeStyle.textContent = '[data-tm-virtual-native="1"]{display:none!important;}'
    document.documentElement.appendChild(this.nativeStyle)
    this.nativeVisibilityObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const element = mutation.target as HTMLElement
        if (element.dataset.tmVirtualNative !== '1') continue
        if (
          element.style.getPropertyValue('display') !== 'none' ||
          element.style.getPropertyPriority('display') !== 'important'
        ) {
          element.style.setProperty('display', 'none', 'important')
        }
      }
    })
    this.nativeDomObserver = new MutationObserver(() => {
      if (this.destroyed) return
      if (this.config.empty_selector && document.querySelector(this.config.empty_selector)) {
        this.destroy()
        return
      }
      this.bindCurrentNativeDom()
    })

    this.list = document.createElement('div')
    this.list.className = 'tm-virtual-list'

    const controls = document.createElement('nav')
    controls.className = 'tm-virtual-controls'
    controls.setAttribute('aria-label', '时光机分页')
    controls.style.cssText =
      'display:flex;align-items:center;justify-content:center;gap:12px;' +
      'min-height:52px;padding:8px 12px;color:#666;font-size:13px;'

    this.previousButton = this.makeButton('上一页')
    this.nextButton = this.makeButton('下一页')
    this.cancelButton = this.makeButton('取消扫描')
    this.status = document.createElement('span')
    this.status.style.cssText = 'min-width:150px;text-align:center;'

    this.previousButton.addEventListener('click', () => this.showPrevious())
    this.nextButton.addEventListener('click', () => void this.showNext())
    this.cancelButton.addEventListener('click', () => this.cancel())
    this.list.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      if (target.closest('a')) return
      const post = target.closest<HTMLElement>(this.postSelector)
      const href = post?.dataset.tmSourceHref
      if (href) window.open(href, '_blank', 'noopener,noreferrer')
    })
    controls.append(this.previousButton, this.status, this.nextButton, this.cancelButton)
    this.root.append(this.list, controls)

    this.bindCurrentNativeDom()
    // url 模式站点不会替换列表 DOM（无 AJAX 翻页），无需监听原生列表重建
    if (this.sourceMode === 'click' && nativeList.parentElement) {
      this.nativeDomObserver.observe(nativeList.parentElement, { childList: true })
    }
  }

  async start(): Promise<void> {
    const ready = await this.enterFirstSourcePage()
    if (!ready || this.destroyed) return
    await this.fillAndRender(0)
  }

  isActive(): boolean {
    return !this.destroyed
  }

  getProgress(): ScanProgress {
    return {
      state: this.state,
      scannedPages: this.scannedSourcePages,
      maxPages: this.config.max_source_pages,
      currentSourcePage: this.sourcePageValue(),
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.runId++
    this.fetchedDoc = null
    this.nativeVisibilityObserver.disconnect()
    this.nativeDomObserver.disconnect()
    this.root.remove()
    this.nativeStyle.remove()
    this.nativeDisplays.forEach((display, element) => {
      delete element.dataset.tmVirtualNative
      if (display.value) {
        element.style.setProperty('display', display.value, display.priority)
      } else {
        element.style.removeProperty('display')
      }
    })
  }

  private makeButton(label: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.style.cssText =
      'border:1px solid #d8d8d8;background:#fff;color:#333;border-radius:4px;' +
      'padding:6px 12px;cursor:pointer;font-size:13px;'
    return button
  }

  /** 当前源页标识：click 取原生页码文本，url 取已拉取的页码 */
  private sourcePageValue(): string {
    if (this.sourceMode === 'url') {
      return this.urlPage > 0 ? String(this.urlPage) : `source-${this.scannedSourcePages + 1}`
    }
    const activeSelector = this.config.active_page_selector
    return (
      (activeSelector ? document.querySelector(activeSelector)?.textContent?.trim() : '') ??
      `source-${this.scannedSourcePages + 1}`
    )
  }

  /** 当前源页内的帖子元素（按列表顺序）：click 读原生列表，url 读离线文档 */
  private currentSourcePosts(): HTMLElement[] {
    const root: ParentNode | null | undefined =
      this.sourceMode === 'url' ? this.fetchedDoc : this.nativeList
    if (!root) return []
    return [...root.querySelectorAll<HTMLElement>(this.postSelector)]
  }

  /** url 模式下把相对链接按源页 URL 解析为绝对地址（离线文档没有 base URL） */
  private absolutizeLinks(clone: HTMLElement): void {
    if (this.sourceMode !== 'url' || !this.fetchedPageUrl) return
    clone.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
      const raw = anchor.getAttribute('href')
      if (!raw) return
      try {
        anchor.setAttribute('href', new URL(raw, this.fetchedPageUrl).href)
      } catch {
        /* 非法 URL 保持原值 */
      }
    })
  }

  private bindCurrentNativeDom(): boolean {
    const list = document.querySelector<HTMLElement>(this.config.list_selector)
    const pagination = document.querySelector<HTMLElement>(this.config.native_pagination_selector)
    if (!list || !pagination) return false
    this.nativeList = list
    for (const element of [list, pagination]) {
      if (!this.nativeDisplays.has(element)) {
        this.nativeDisplays.set(element, {
          value: element.style.getPropertyValue('display'),
          priority: element.style.getPropertyPriority('display'),
        })
      }
      element.dataset.tmVirtualNative = '1'
      element.style.setProperty('display', 'none', 'important')
      this.nativeVisibilityObserver.observe(element, {
        attributes: true,
        attributeFilter: ['style'],
      })
    }
    if (this.root.previousElementSibling !== pagination) {
      pagination.insertAdjacentElement('afterend', this.root)
    }
    return true
  }

  /** 进入扫描起点：url 模式直接拉取起始页（会话总是从起始页重新聚合） */
  private async enterFirstSourcePage(): Promise<boolean> {
    if (this.sourceMode === 'url') {
      return this.fetchSourcePage(this.config.start_page ?? 1)
    }
    return this.goToFirstSourcePage()
  }

  /** url 模式：按模板解析页码 URL（相对路径按当前 origin 解析） */
  private pageUrl(page: number): string {
    const pattern = this.config.page_url_pattern ?? ''
    const raw = pattern.replaceAll('{page}', String(page))
    try {
      return new URL(raw, location.origin).href
    } catch {
      return raw
    }
  }

  /**
   * url 模式：拉取指定源页并解析为离线文档。
   * 帖子数为 0 视为已到末页（服务端 URL 分页的终止信号）；网络/HTTP 失败置 error。
   */
  private async fetchSourcePage(page: number): Promise<boolean> {
    const url = this.pageUrl(page)
    try {
      const res = await fetch(url, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()
      if (this.destroyed) return false
      const doc = new DOMParser().parseFromString(html, 'text/html')
      if (doc.querySelectorAll(this.postSelector).length === 0) {
        this.state = 'exhausted'
        this.renderControls()
        return false
      }
      this.fetchedDoc = doc
      this.fetchedPageUrl = url
      this.urlPage = page
      return true
    } catch (e) {
      console.warn('[时光机] 源页拉取失败:', (e as Error)?.message)
      this.state = 'error'
      this.renderControls()
      return false
    }
  }

  /**
   * 拉取下一个源页（url 模式）；风控节流复用 next_delay_min/max，
   * 平台适配包应为整页请求声明该间隔。
   */
  private async fetchNextSourcePage(currentRun: number): Promise<SourceAdvance> {
    await new Promise((resolve) => setTimeout(resolve, this.nextPageDelay()))
    if (this.destroyed || currentRun !== this.runId) return 'cancelled'
    const ok = await this.fetchSourcePage(this.urlPage + 1)
    if (this.destroyed || currentRun !== this.runId) return 'cancelled'
    if (ok) return 'ok'
    return this.state === 'exhausted' ? 'exhausted' : 'error'
  }

  private async goToFirstSourcePage(): Promise<boolean> {
    const firstPage = this.config.first_page
    if (!firstPage || this.sourcePageValue() === firstPage.value) return true
    const input = document.querySelector<HTMLInputElement>(firstPage.input_selector)
    if (!input) {
      this.state = 'error'
      this.renderControls()
      return false
    }
    input.focus()
    const previousSignature = this.sourcePageSignature()
    input.value = firstPage.value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }))
    const changed = await this.waitForSourcePage(
      firstPage.value,
      this.runId,
      '',
      previousSignature,
    )
    if (!changed) {
      this.state = 'error'
      this.renderControls()
    }
    return changed
  }

  /**
   * 扫描当前源页；返回本次新增（未见过）的帖子 ID 数。
   * url 模式据此判定末页：服务端翻页到底后会回到同一批内容或返回空列表。
   */
  private scanCurrentSourcePage(): number {
    const pageValue = this.sourcePageValue()
    if (this.seenSourcePages.has(pageValue)) {
      this.state = 'error'
      return 0
    }
    this.seenSourcePages.add(pageValue)
    this.scannedSourcePages++

    let newIds = 0
    this.currentSourcePosts().forEach((post) => {
      const idElement = post.querySelector(this.config.post_id.selector)
      const id = idElement?.getAttribute(this.config.post_id.attr)?.trim()
      if (!id || this.seenIds.has(id)) return
      this.seenIds.add(id)
      newIds++

      const decision = this.decide(post)
      this.onDecision(decision)
      if (decision === 'filtered') return
      this.cached.push(this.cloneForDisplay(post))
    })
    return newIds
  }

  private cloneForDisplay(post: HTMLElement): HTMLElement {
    const clone = post.cloneNode(true) as HTMLElement
    clone.style.display = ''
    clone.style.cursor = 'pointer'
    clone.removeAttribute('data-tm-filtered')
    clone.removeAttribute('data-tm-anchor')
    clone.querySelectorAll<HTMLElement>('*').forEach((el) => {
      el.removeAttribute('id')
      for (const attr of [...el.attributes]) {
        if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name)
      }
    })
    clone.querySelectorAll<HTMLElement>('button,input,textarea,select,[role="button"]').forEach((el) => {
      el.style.pointerEvents = 'none'
      el.setAttribute('aria-disabled', 'true')
    })
    this.absolutizeLinks(clone)
    const source = clone.querySelector<HTMLAnchorElement>(this.config.source_link_selector)
    if (source?.href) {
      source.target = '_blank'
      source.rel = 'noopener noreferrer'
      clone.dataset.tmSourceHref = source.href
    }
    return clone
  }

  private async fillAndRender(targetPage: number): Promise<void> {
    if (this.destroyed) return
    const required = (targetPage + 1) * this.config.page_size
    const currentRun = ++this.runId
    this.state = 'loading'
    this.renderControls()

    if (this.scannedSourcePages === 0) {
      const firstPageIds = this.scanCurrentSourcePage()
      if (this.sourceMode === 'url' && firstPageIds === 0) this.state = 'exhausted'
    }
    while (
      !this.destroyed &&
      currentRun === this.runId &&
      this.cached.length < required
    ) {
      if ((this.state as ScanState) === 'error' || (this.state as ScanState) === 'exhausted') break
      if (this.scannedSourcePages >= this.config.max_source_pages) {
        this.state = 'limit'
        break
      }
      const outcome = await this.advanceSourcePage(currentRun)
      if (outcome !== 'ok') break
      if (!this.bindCurrentNativeDom()) {
        this.state = 'error'
        break
      }
      const newIds = this.scanCurrentSourcePage()
      if ((this.state as ScanState) === 'error') break
      // url 模式：取到的源页没有新帖（翻到底后服务端返回同一批内容）→ 末页
      if (this.sourceMode === 'url' && newIds === 0) {
        this.state = 'exhausted'
        break
      }
    }

    if (this.destroyed || currentRun !== this.runId) return
    if (this.state === 'loading') this.state = 'idle'
    if (targetPage * this.config.page_size < this.cached.length) this.pageIndex = targetPage
    this.renderPage()
  }

  private nextPageDelay(): number {
    const min = this.config.next_delay_min_ms ?? 0
    const max = this.config.next_delay_max_ms ?? min
    if (max <= 0) return 0
    return min + Math.floor(Math.random() * (max - min + 1))
  }

  /** 推进到下一个源页（按适配包声明的策略分派） */
  private async advanceSourcePage(currentRun: number): Promise<SourceAdvance> {
    if (this.sourceMode === 'url') return this.fetchNextSourcePage(currentRun)
    return this.loadNextSourcePage(currentRun)
  }

  private async loadNextSourcePage(currentRun: number): Promise<SourceAdvance> {
    const nextSelector = this.config.next_selector
    const next = nextSelector ? document.querySelector<HTMLElement>(nextSelector) : null
    if (!next || next.getAttribute('aria-disabled') === 'true' || next.classList.contains('disabled')) {
      this.state = 'exhausted'
      return 'exhausted'
    }
    await new Promise((resolve) => setTimeout(resolve, this.nextPageDelay()))
    if (this.destroyed || currentRun !== this.runId) return 'cancelled'
    const previous = this.sourcePageValue()
    const previousSignature = this.sourcePageSignature()
    next.click()
    const changed = await this.waitForSourcePage(null, currentRun, previous, previousSignature)
    if (changed) return 'ok'
    if (this.destroyed || currentRun !== this.runId) return 'cancelled'
    this.state = 'error'
    return 'error'
  }

  private async waitForSourcePage(
    expected: string | null,
    currentRun: number,
    previous = '',
    previousSignature = '',
  ): Promise<boolean> {
    const deadline = Date.now() + 5000
    const stableWait = Math.max(100, this.config.wait_ms)
    let candidateList: Element | null = null
    let candidatePagination: Element | null = null
    let candidatePage = ''
    let candidateSignature = ''
    let candidateSince = 0
    while (Date.now() < deadline && !this.destroyed && currentRun === this.runId) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(50, this.config.wait_ms)))
      if (this.config.empty_selector && document.querySelector(this.config.empty_selector)) {
        this.destroy()
        return false
      }
      const list = document.querySelector(this.config.list_selector)
      const pagination = document.querySelector(this.config.native_pagination_selector)
      const current = this.sourcePageValue()
      const signature = this.sourcePageSignature()
      const pageReady = expected ? current === expected : current !== previous
      const contentReady = !previousSignature || signature !== previousSignature
      if (!list || !pagination || !pageReady || !contentReady) {
        candidateList = null
        candidatePagination = null
        candidateSince = 0
        continue
      }
      if (
        list === candidateList &&
        pagination === candidatePagination &&
        current === candidatePage &&
        signature === candidateSignature
      ) {
        if (Date.now() - candidateSince >= stableWait) return true
        continue
      }
      candidateList = list
      candidatePagination = pagination
      candidatePage = current
      candidateSignature = signature
      candidateSince = Date.now()
    }
    return false
  }

  private sourcePageSignature(): string {
    if (this.sourceMode === 'url') {
      return this.currentSourcePosts()
        .map((post) => post.querySelector(this.config.post_id.selector)?.getAttribute(this.config.post_id.attr) ?? '')
        .join('|')
    }
    return listSignature(this.config)
  }

  private renderPage(): void {
    const start = this.pageIndex * this.config.page_size
    const items = this.cached.slice(start, start + this.config.page_size)
    this.list.replaceChildren(...items.map((item) => item.cloneNode(true)))
    this.renderControls()
  }

  private renderControls(): void {
    const loading = this.state === 'loading'
    this.previousButton.disabled = loading || this.pageIndex === 0
    const hasCachedNext = (this.pageIndex + 1) * this.config.page_size < this.cached.length
    this.nextButton.disabled =
      loading || (!hasCachedNext && ['exhausted', 'limit', 'cancelled', 'error'].includes(this.state))
    this.cancelButton.hidden = !loading

    const page = this.pageIndex + 1
    if (loading) {
      this.status.textContent = `第 ${page} 页 · 正在扫描原始第 ${this.sourcePageValue()} 页…`
    } else if (this.state === 'exhausted') {
      this.status.textContent = `第 ${page} 页 · 已到末页`
    } else if (this.state === 'limit') {
      this.status.textContent = `第 ${page} 页 · 已达 ${this.config.max_source_pages} 页上限`
    } else if (this.state === 'cancelled') {
      this.status.textContent = `第 ${page} 页 · 扫描已取消`
    } else if (this.state === 'error') {
      this.status.textContent = `第 ${page} 页 · 原始页面加载失败`
    } else {
      this.status.textContent = `第 ${page} 页 · 已扫描 ${this.scannedSourcePages} 个原始页`
    }
    this.onStateChange?.(this.getProgress())
  }

  private showPrevious(): void {
    if (this.pageIndex === 0 || this.state === 'loading') return
    this.pageIndex--
    this.renderPage()
  }

  private async showNext(): Promise<void> {
    if (this.state === 'loading') return
    await this.fillAndRender(this.pageIndex + 1)
  }

  private cancel(): void {
    if (this.state !== 'loading') return
    this.runId++
    this.state = 'cancelled'
    this.renderPage()
  }
}
