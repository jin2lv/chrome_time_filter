import assert from 'node:assert'
import { JSDOM } from 'jsdom'

const dom = new JSDOM(`
  <nav class="home-timeline-tabs"><a class="active">关注</a><a>基金</a><a>7x24</a></nav>
  <nav class="timeline__tab__tags"><a class="active">全部</a><a>只看原发</a></nav>
  <main class="status-list">
    <article class="timeline__item" id="follow-new"><a class="date-and-source">5分钟前</a></article>
    <article class="timeline__item" id="follow-old"><a class="date-and-source">5小时前</a></article>
  </main>
`, { url: 'https://xueqiu.com/' })

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  location: dom.window.location,
  MutationObserver: dom.window.MutationObserver,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Event: dom.window.Event,
})

const storage = new Map<string, unknown>([
  ['timeSettings.xueqiu.com', {
    mode: 'cutoff',
    cutoff: Date.now() - 60 * 60 * 1000,
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
    },
  },
}

await import('../../src/content/index.ts')
await new Promise((resolve) => setTimeout(resolve, 100))
assert.equal((document.getElementById('follow-new') as HTMLElement).style.display, 'none')

const primary = [...document.querySelectorAll('.home-timeline-tabs a')]
const secondary = [...document.querySelectorAll('.timeline__tab__tags a')]
primary[1].dispatchEvent(new dom.window.Event('click', { bubbles: true }))
primary[0].classList.remove('active')
primary[1].classList.add('active')
secondary[0].classList.remove('active')
secondary[1].classList.add('active')
document.querySelector('.status-list')!.innerHTML = `
  <article class="timeline__item" id="fund-new"><a class="date-and-source">10分钟前</a></article>
  <article class="timeline__item" id="fund-old"><a class="date-and-source">8小时前</a></article>
`
await new Promise((resolve) => setTimeout(resolve, 500))

assert.equal((document.getElementById('fund-new') as HTMLElement).style.display, 'none')
assert.equal((document.getElementById('fund-old') as HTMLElement).style.display, '')
let response: unknown
listeners[0]({ type: 'QUERY_STATE' }, {}, (value) => { response = value })
const state = response as { context: string; completeness: string; filteredCount: number }
assert.equal(state.context, '基金 / 只看原发')
assert.equal(state.completeness, 'loaded-only')
assert.equal(state.filteredCount, 1, '新类别必须重置旧类别计数')

primary[2].dispatchEvent(new dom.window.Event('click', { bubbles: true }))
primary[1].classList.remove('active')
primary[2].classList.add('active')
secondary[1].classList.remove('active')
document.querySelector('.status-list')!.innerHTML = ''
const now = new Date()
const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
document.body.insertAdjacentHTML('beforeend', `
  <section class="timeline__live" id="live-today">
    <div class="home__timeline-live__hd">今天</div>
    <table><tbody><tr id="live-new"><td>${currentTime}</td><td></td><td>今日快讯</td></tr></tbody></table>
  </section>
  <section class="timeline__live" id="live-yesterday">
    <div class="home__timeline-live__hd">昨天</div>
    <table><tbody><tr id="live-old"><td>${currentTime}</td><td></td><td>昨日快讯</td></tr></tbody></table>
  </section>
`)
await new Promise((resolve) => setTimeout(resolve, 500))

assert.equal((document.getElementById('live-new') as HTMLElement).style.display, 'none')
assert.equal((document.getElementById('live-old') as HTMLElement).style.display, '')
listeners[0]({ type: 'QUERY_STATE' }, {}, (value) => { response = value })
const liveState = response as { context: string; completeness: string; filteredCount: number }
assert.equal(liveState.context, '7x24')
assert.equal(liveState.completeness, 'loaded-only')
assert.equal(liveState.filteredCount, 1, '7x24 上下文必须重置旧类别计数并过滤今日快讯')

console.log('雪球首页一级/二级类别上下文测试通过')
