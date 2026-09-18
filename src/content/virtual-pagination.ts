import type { PlatformAdapter, ScanProgress } from '../shared/types'

type VirtualPaginationConfig = NonNullable<PlatformAdapter['virtual_pagination']>

export type PostDecision = 'include' | 'filtered' | 'unparseable'

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
 */
export class VirtualPaginationController {
  private readonly config: VirtualPaginationConfig
  private readonly postSelector: string
  private readonly decide: VirtualPaginationOptions['decide']
  private readonly onDecision: VirtualPaginationOptions['onDecision']
  private readonly onStateChange?: VirtualPaginationOptions['onStateChange']
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
    nativeList.parentElement && this.nativeDomObserver.observe(nativeList.parentElement, {
      childList: true,
    })
  }

  async start(): Promise<void> {
    const ready = await this.goToFirstSourcePage()
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

  private sourcePageValue(): string {
    return (
      document.querySelector(this.config.active_page_selector)?.textContent?.trim() ??
      `source-${this.scannedSourcePages + 1}`
    )
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

  private scanCurrentSourcePage(): void {
    const pageValue = this.sourcePageValue()
    if (this.seenSourcePages.has(pageValue)) {
      this.state = 'error'
      return
    }
    this.seenSourcePages.add(pageValue)
    this.scannedSourcePages++

    this.nativeList.querySelectorAll<HTMLElement>(this.postSelector).forEach((post) => {
      const idElement = post.querySelector(this.config.post_id.selector)
      const id = idElement?.getAttribute(this.config.post_id.attr)?.trim()
      if (!id || this.seenIds.has(id)) return
      this.seenIds.add(id)

      const decision = this.decide(post)
      this.onDecision(decision)
      if (decision === 'filtered') return
      this.cached.push(this.cloneForDisplay(post))
    })
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

    if (this.scannedSourcePages === 0) this.scanCurrentSourcePage()
    while (
      !this.destroyed &&
      currentRun === this.runId &&
      this.cached.length < required
    ) {
      if ((this.state as ScanState) === 'error') break
      if (this.scannedSourcePages >= this.config.max_source_pages) {
        this.state = 'limit'
        break
      }
      const changed = await this.loadNextSourcePage(currentRun)
      if (!changed) break
      if (!this.bindCurrentNativeDom()) {
        this.state = 'error'
        break
      }
      this.scanCurrentSourcePage()
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

  private async loadNextSourcePage(currentRun: number): Promise<boolean> {
    const next = document.querySelector<HTMLElement>(this.config.next_selector)
    if (!next || next.getAttribute('aria-disabled') === 'true' || next.classList.contains('disabled')) {
      this.state = 'exhausted'
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, this.nextPageDelay()))
    if (this.destroyed || currentRun !== this.runId) return false
    const previous = this.sourcePageValue()
    const previousSignature = this.sourcePageSignature()
    next.click()
    const changed = await this.waitForSourcePage(null, currentRun, previous, previousSignature)
    if (changed) return true
    if (!this.destroyed && currentRun === this.runId) this.state = 'error'
    return false
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
