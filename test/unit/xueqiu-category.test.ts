import assert from 'node:assert'
import { setupDom } from '../helpers/dom-env'

setupDom(`
  <main class="stock-timeline">
    <div class="stock-timeline-tabs">
      <a class="active">讨论</a><a>资讯</a>
    </div>
    <div class="status-list"></div>
    <div class="pagination">
      <a class="active">1</a><button class="pagination__next disabled">下一页</button><input>
    </div>
  </main>
`, { url: 'https://xueqiu.com/S/SZ300142' })

const emptyTab = document.createElement('a')
emptyTab.textContent = 'empty'
document.querySelector('.stock-timeline-tabs')!.appendChild(emptyTab)

const renderPosts = (category: string): void => {
  document.querySelector('.status-list')!.innerHTML = Array.from({ length: 10 }, (_, index) => `
    <article class="timeline__item">
      <a class="date-and-source" data-id="${category}-${index}" href="/${category}/${index}">
        5小时前
      </a>
      <p>${category}帖子${index}</p>
    </article>
  `).join('')
}
renderPosts('讨论')

const storage = new Map<string, unknown>([
  ['timeSettings.xueqiu.com', {
    mode: 'cutoff',
    cutoff: Date.now() - 2 * 60 * 60 * 1000,
    strategy: 'hide',
  }],
])
const listeners: Array<(message: unknown, sender: unknown, respond: (value: unknown) => void) => void> = []

;(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    onMessage: { addListener: (listener: typeof listeners[number]) => listeners.push(listener) },
    sendMessage: async () => {},
  },
  storage: {
    onChanged: { addListener: () => {} },
    local: {
      get: async (key: string) => storage.has(key) ? { [key]: storage.get(key) } : {},
      set: async () => {},
    },
  },
}

await import('../../src/content/index.ts')
await new Promise((resolve) => setTimeout(resolve, 500))

const virtualText = (): string => document.querySelector('.tm-virtual-list')?.textContent ?? ''
assert.match(virtualText(), /讨论帖子0/)
assert.doesNotMatch(virtualText(), /资讯帖子0/)

const tabs = [...document.querySelectorAll('.stock-timeline-tabs a')]
tabs[0].classList.remove('active')
tabs[1].classList.add('active')
setTimeout(() => {
  renderPosts('资讯')
  document.querySelector('.pagination')!.outerHTML = `
    <div class="pagination">
      <a class="active">1</a><button class="pagination__next disabled">下一页</button><input>
    </div>`
}, 400)
await new Promise((resolve) => setTimeout(resolve, 1800))

assert.match(virtualText(), /资讯帖子0/, '类别变化后应丢弃旧缓存并为新类别重建虚拟页')
assert.doesNotMatch(virtualText(), /讨论帖子0/)
assert.equal(document.querySelectorAll('.tm-virtual-pagination').length, 1)

tabs[2].click()
assert.equal(document.querySelector('.tm-virtual-pagination'), null, 'inactive category click should stop the old scan immediately')
tabs[1].classList.remove('active')
tabs[2].classList.add('active')
setTimeout(() => {
  const staleList = document.querySelector('.status-list')
  staleList?.setAttribute('data-intermediate', '1')
}, 400)
setTimeout(() => {
  document.querySelector('.status-list')?.remove()
  document.querySelector('.pagination')?.remove()
  const empty = document.createElement('div')
  empty.className = 'empty'
  empty.textContent = 'no content'
  document.querySelector('.stock-timeline')!.appendChild(empty)
}, 1400)
await new Promise((resolve) => setTimeout(resolve, 2800))

assert.equal(document.querySelector('.tm-virtual-pagination'), null, 'empty category should preserve the native empty state')
assert.equal(document.querySelector('.stock-timeline > .empty')?.textContent, 'no content')
assert.doesNotMatch(document.body.textContent ?? '', /原始页面加载失败/)

tabs[0].click()
tabs[2].classList.remove('active')
tabs[0].classList.add('active')
setTimeout(() => {
  document.querySelector('.stock-timeline > .empty')?.remove()
  const list = document.createElement('div')
  list.className = 'status-list'
  const pagination = document.createElement('div')
  pagination.className = 'pagination'
  pagination.innerHTML = '<a class="active">1</a><button class="pagination__next disabled">next</button><input>'
  document.querySelector('.stock-timeline')!.append(list, pagination)
  renderPosts('recovered')
}, 400)
await new Promise((resolve) => setTimeout(resolve, 1800))

assert.match(virtualText(), /recovered/, 'virtual pagination should recover after leaving an empty category')
assert.equal(document.querySelectorAll('.tm-virtual-pagination').length, 1)

;(listeners[0] as (message: unknown) => void)({ type: 'TOGGLE_FILTER' })
await new Promise((resolve) => setTimeout(resolve, 50))
assert.equal(document.querySelector('.tm-virtual-pagination'), null)
assert.equal((document.querySelector('.status-list') as HTMLElement).style.display, '')
assert.equal((document.querySelector('.pagination') as HTMLElement).style.display, '')

console.log('雪球类别切换虚拟分页测试通过')
