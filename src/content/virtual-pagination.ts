import type { PlatformAdapter } from '../shared/types'

type VirtualPaginationConfig = NonNullable<PlatformAdapter['virtual_pagination']>

export type PostDecision = 'include' | 'filtered' | 'unparseable'

interface VirtualPaginationOptions {
  config: VirtualPaginationConfig
  postSelector: string
  decide: (post: HTMLElement) => PostDecision
  onDecision: (decision: PostDecision) => void
}

type ScanState = 'idle' | 'loading' | 'exhausted' | 'limit' | 'cancelled' | 'error'

/**
 * Config-driven lazy scanner that repacks matching native pages into extension-owned pages.
 * Platform DOM knowledge stays in the adapter; this class only manages scanning and rendering.
 */
export class VirtualPaginationController {
  private readonly config: VirtualPaginationConfig
  private readonly postSelector: string
  private readonly decide: VirtualPaginationOptions['decide']
  private readonly onDecision: VirtualPaginationOptions['onDecision']
  private nativeList: HTMLElement
  private readonly root: HTMLElement
  private readonly list: HTMLElement
  private readonly status: HTMLElement
  private readonly previousButton: HTMLButtonElement
  private readonly nextButton: HTMLButtonElement
  private readonly cancelButton: HTMLButtonElement
  private readonly nativeDisplays = new Map<HTMLElement, string>()
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
    return new VirtualPaginationController(options, nativeList, nativePagination)
  }

  private constructor(
    options: VirtualPaginationOptions,
    nativeList: HTMLElement,
    _nativePagination: HTMLElement,
  ) {
    this.config = options.config
    this.postSelector = options.postSelector
    this.decide = options.decide
    this.onDecision = options.onDecision
    this.nativeList = nativeList

    this.root = document.createElement('section')
    this.root.className = 'tm-virtual-pagination'
    this.root.dataset.tmVirtualPagination = '1'
    this.root.style.cssText = 'display:block;width:100%;'

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
  }

  async start(): Promise<void> {
    const ready = await this.goToFirstSourcePage()
    if (!ready || this.destroyed) return
    await this.fillAndRender(0)
  }

  isActive(): boolean {
    return !this.destroyed
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.runId++
    this.root.remove()
    this.nativeDisplays.forEach((display, element) => {
      element.style.display = display
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
      if (!this.nativeDisplays.has(element)) this.nativeDisplays.set(element, element.style.display)
      element.style.display = 'none'
    }
    pagination.insertAdjacentElement('afterend', this.root)
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

  private async loadNextSourcePage(currentRun: number): Promise<boolean> {
    const next = document.querySelector<HTMLElement>(this.config.next_selector)
    if (!next || next.getAttribute('aria-disabled') === 'true' || next.classList.contains('disabled')) {
      this.state = 'exhausted'
      return false
    }
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
    while (Date.now() < deadline && !this.destroyed && currentRun === this.runId) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(50, this.config.wait_ms)))
      const current = this.sourcePageValue()
      const pageReady = expected ? current === expected : current !== previous
      const contentReady = !previousSignature || this.sourcePageSignature() !== previousSignature
      if (pageReady && contentReady) return true
    }
    return false
  }

  private sourcePageSignature(): string {
    const currentList = document.querySelector<HTMLElement>(this.config.list_selector)
    return [...(currentList?.querySelectorAll(this.config.post_id.selector) ?? [])]
      .map((element) => element.getAttribute(this.config.post_id.attr) ?? '')
      .join('|')
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
