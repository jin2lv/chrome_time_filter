import assert from 'node:assert'
import { JSDOM } from 'jsdom'
import { VirtualPaginationController, type PostDecision } from '../../src/content/virtual-pagination'

const dom = new JSDOM(`
  <main class="stock-timeline">
    <div class="status-list"></div>
    <div class="pagination">
      <a class="active">1</a>
      <button class="pagination__next">下一页</button>
    </div>
  </main>
`, { url: 'https://xueqiu.com/S/SZ300142' })

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
})

const pages = [
  [
    ['1', 'new'], ['2', 'old'], ['3', 'new'], ['4', 'old'], ['5', 'bad'],
    ['6', 'new'], ['7', 'old'], ['8', 'new'], ['9', 'old'], ['10', 'new'],
  ],
  [
    ['10', 'old'], ['11', 'old'], ['12', 'new'], ['13', 'old'], ['14', 'new'],
    ['15', 'old'], ['16', 'new'], ['17', 'old'], ['18', 'new'], ['19', 'old'],
  ],
  [
    ['20', 'old'], ['21', 'old'], ['22', 'old'], ['23', 'new'], ['24', 'old'],
    ['25', 'old'], ['26', 'new'], ['27', 'old'], ['28', 'old'], ['29', 'old'],
  ],
]
let sourcePage = 0
let nextClicks = 0

function renderSourcePage(): void {
  const list = document.querySelector('.status-list')!
  list.innerHTML = pages[sourcePage]
    .map(([id, decision]) => `
      <article class="timeline__item" data-decision="${decision}">
        <a class="date-and-source" data-id="${id}" href="/u/${id}">帖子 ${id}</a>
        <button type="button">原生操作</button>
      </article>`)
    .join('')
  document.querySelector('.pagination .active')!.textContent = String(sourcePage + 1)
  const next = document.querySelector('.pagination__next')!
  next.classList.toggle('disabled', sourcePage === pages.length - 1)
}

renderSourcePage()
document.querySelector('.pagination__next')!.addEventListener('click', () => {
  if (sourcePage >= pages.length - 1) return
  nextClicks++
  sourcePage++
  renderSourcePage()
})

const decisions: PostDecision[] = []
const controller = VirtualPaginationController.create({
  config: {
    list_selector: '.stock-timeline > .status-list',
    post_id: { selector: 'a.date-and-source', attr: 'data-id' },
    source_link_selector: 'a.date-and-source',
    native_pagination_selector: '.stock-timeline > .pagination',
    next_selector: '.pagination__next',
    active_page_selector: '.pagination a.active',
    page_size: 10,
    max_source_pages: 200,
    wait_ms: 0,
  },
  postSelector: 'article.timeline__item',
  decide: (post) => {
    const value = post.dataset.decision
    if (value === 'new') return 'filtered'
    if (value === 'bad') return 'unparseable'
    return 'include'
  },
  onDecision: (decision) => decisions.push(decision),
})
assert.ok(controller)
await controller.start()

const virtualItems = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('.tm-virtual-list article.timeline__item'),
]
const itemIds = (): string[] => virtualItems().map(
  (item) => item.querySelector('a')?.getAttribute('data-id') ?? '',
)

assert.equal(nextClicks, 1, '应只扫描到填满首个虚拟页所需的第二个原始页')
assert.equal(virtualItems().length, 10)
assert.deepEqual(itemIds(), ['2', '4', '5', '7', '9', '11', '13', '15', '17', '19'])
assert.equal(itemIds().filter((id) => id === '10').length, 0, '已判定过的重复 ID 不应二次收集')
assert.equal(decisions.filter((value) => value === 'unparseable').length, 1)
assert.equal(virtualItems()[2].querySelector('button')?.getAttribute('aria-disabled'), 'true')
assert.equal(virtualItems()[0].querySelector('a')?.getAttribute('target'), '_blank')

const controls = document.querySelector('.tm-virtual-controls')!
const next = [...controls.querySelectorAll('button')].find((button) => button.textContent === '下一页')!
const previous = [...controls.querySelectorAll('button')].find((button) => button.textContent === '上一页')!
next.click()
await new Promise((resolve) => setTimeout(resolve, 150))

assert.equal(nextClicks, 2, '虚拟下一页才继续扫描，不预取剩余原始页')
assert.deepEqual(itemIds(), ['20', '21', '22', '24', '25', '27', '28', '29'])
assert.match(document.querySelector('.tm-virtual-controls')?.textContent ?? '', /已到末页/)

previous.click()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(nextClicks, 2, '虚拟上一页应直接使用缓存')
assert.deepEqual(itemIds(), ['2', '4', '5', '7', '9', '11', '13', '15', '17', '19'])

controller.destroy()
assert.equal(document.querySelector('.tm-virtual-pagination'), null)
assert.equal((document.querySelector('.status-list') as HTMLElement).style.display, '')
assert.equal((document.querySelector('.pagination') as HTMLElement).style.display, '')

console.log('雪球虚拟分页测试通过')
