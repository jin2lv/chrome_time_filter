import assert from 'node:assert'
import { JSDOM } from 'jsdom'

const dom = new JSDOM(`
  <main>
    <article class="timeline__item" id="before"><a class="date-and-source">2026-08-13 09:29</a></article>
    <article class="timeline__item" id="start"><a class="date-and-source">2026-08-13 09:30</a></article>
    <article class="timeline__item" id="inside"><a class="date-and-source">2026-08-13 11:00</a></article>
    <article class="timeline__item" id="end"><a class="date-and-source">2026-08-13 15:00</a></article>
    <article class="timeline__item" id="after"><a class="date-and-source">2026-08-13 15:01</a></article>
    <article class="timeline__item" id="bad"><a class="date-and-source">3个月前</a></article>
    <div class="comment__item" id="comment-before"><span class="time">2026-08-13 09:29</span></div>
    <div class="comment__item" id="comment-inside"><span class="time">2026-08-13 12:00</span></div>
    <div class="comment__item" id="comment-after"><span class="time">2026-08-13 15:01</span></div>
  </main>
`, { url: 'https://xueqiu.com/statuses/1' })

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
    mode: 'window',
    cutoff: null,
    window: {
      start: new Date('2026-08-13T09:30').getTime(),
      end: new Date('2026-08-13T15:00').getTime(),
    },
    strategy: 'hide',
  }],
  ['prefs', { floatingBanner: true, commentNoTime: 'show' }],
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
await new Promise((resolve) => setTimeout(resolve, 450)) // 覆盖 updateBanner 250ms 节流

const hidden = (id: string): boolean => (document.getElementById(id) as HTMLElement).style.display === 'none'
assert.equal(hidden('before'), true)
assert.equal(hidden('start'), false, '开始边界应保留')
assert.equal(hidden('inside'), false)
assert.equal(hidden('end'), false, '结束边界应保留')
assert.equal(hidden('after'), true)
assert.equal(hidden('bad'), false, '无法解析默认显示')
assert.equal(hidden('comment-before'), true)
assert.equal(hidden('comment-inside'), false)
assert.equal(hidden('comment-after'), true)

const banner = document.querySelector('.tm-banner')
assert.match(banner?.textContent ?? '', /区间:/)
assert.match(banner?.textContent ?? '', /2026-08-13 09:30/)
assert.match(banner?.textContent ?? '', /2026-08-13 15:00/)

let response: unknown
listeners[0]({ type: 'QUERY_STATE' }, {}, (value) => { response = value })
const state = response as { diagnostics: Array<{ raw: string }>; unparseableCount: number }
assert.equal(state.unparseableCount, 1)
assert.ok(state.diagnostics.some((item) => item.raw === '3个月前'))

console.log('普通列表与评论区间过滤测试通过')
