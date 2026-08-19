import assert from 'node:assert'
import { JSDOM } from 'jsdom'
import xueqiu from '../../src/adapters/xueqiu.json'
import { validateAdapter } from '../../src/adapters/schema'
import { extractTimestampText, parseTimestamp } from '../../src/shared/time'
import type { Adapter, PlatformAdapter } from '../../src/shared/types'

const pkg = xueqiu as unknown as Adapter
const adapter = pkg.platforms[0] as PlatformAdapter

assert.equal(validateAdapter(pkg), null, '雪球适配包应通过 Schema 校验')
assert.ok(adapter.post_selectors.includes('.timeline__live tr'))
assert.equal(adapter.timestamp.date_text_selector, '.home__timeline-live__hd')
assert.equal(adapter.timestamp.date_text_scope_selector, '.timeline__live')
assert.equal(adapter.virtual_pagination?.list_selector, '.stock-timeline > .status-list')
assert.equal(adapter.virtual_pagination?.post_id.selector, 'a.date-and-source')
assert.equal(adapter.virtual_pagination?.post_id.attr, 'data-id')
assert.equal(adapter.virtual_pagination?.source_link_selector, 'a.date-and-source')
assert.equal(adapter.virtual_pagination?.context_selector, '.stock-timeline-tabs a.active')
assert.equal(adapter.virtual_pagination?.context_trigger_selector, '.stock-timeline-tabs a')
assert.equal(adapter.virtual_pagination?.context_wait_ms, 1000)
assert.equal(adapter.virtual_pagination?.empty_selector, '.stock-timeline > .empty')
assert.equal(adapter.virtual_pagination?.native_pagination_selector, '.stock-timeline > .pagination')
assert.equal(adapter.virtual_pagination?.next_selector, '.pagination__next')
assert.equal(adapter.virtual_pagination?.active_page_selector, '.pagination a.active')
assert.equal(adapter.virtual_pagination?.first_page?.input_selector, '.pagination input')
assert.equal(adapter.virtual_pagination?.first_page?.value, '1')
assert.equal(adapter.virtual_pagination?.page_size, 10)
assert.equal(adapter.virtual_pagination?.max_source_pages, 200)

const dom = new JSDOM(`
  <article class="timeline__item">
    <a class="date-and-source">修改于08-07 15:05<span>· 来自雪球</span></a>
  </article>
`)
const post = dom.window.document.querySelector('article') as HTMLElement
const extracted = extractTimestampText(
  post,
  adapter.timestamp.selector,
  adapter.timestamp.attr,
  adapter.timestamp.date_attr,
  adapter.timestamp.strip_pattern,
)

assert.equal(extracted, '08-07 15:05· 来自雪球')
assert.ok(parseTimestamp(extracted!, adapter, Date.now()), '修改时间应由雪球配置剥离前缀后解析')

const liveDom = new JSDOM(`
  <div class="timeline__live">
    <div class="home__timeline-live__hd">今天</div>
    <table><tbody><tr><td>20:40</td><td></td><td>快讯</td></tr></tbody></table>
  </div>
`)
const liveRow = liveDom.window.document.querySelector('tr') as HTMLElement
const liveText = extractTimestampText(
  liveRow,
  adapter.timestamp.selector,
  adapter.timestamp.attr,
  adapter.timestamp.date_attr,
  adapter.timestamp.strip_pattern,
  adapter.timestamp.date_text_selector,
  adapter.timestamp.date_text_scope_selector,
)
assert.equal(liveText, '今天 20:40')
assert.ok(parseTimestamp(liveText!, adapter, Date.now()), '7x24 分组日期与行内时间应组合解析')

// ---- H3 回归：strip_pattern 必须校验正则合法性（非法正则会中断运行时）----
const badStrip: Adapter = {
  version: '9.9.9',
  platforms: [
    {
      name: '测试',
      domains: ['evil.example.com'],
      post_selectors: ['article'],
      timestamp: { selector: 'time', type: 'absolute', format: 'YYYY-MM-DD HH:mm', strip_pattern: '(unclosed' },
      quick_presets: [{ label: 'x', value: 'y' }],
    },
  ],
}
assert.ok(validateAdapter(badStrip)?.some((e) => e.includes('strip_pattern')), '非法 strip_pattern 应被 schema 拒绝')
const goodStrip: Adapter = {
  version: '9.9.9',
  platforms: [
    {
      name: '测试',
      domains: ['ok.example.com'],
      post_selectors: ['article'],
      timestamp: { selector: 'time', type: 'absolute', format: 'YYYY-MM-DD HH:mm', strip_pattern: '^\\s*修改于\\s*' },
      quick_presets: [{ label: 'x', value: 'y' }],
    },
  ],
}
assert.equal(validateAdapter(goodStrip), null, '合法 strip_pattern 应通过校验')

console.log('雪球适配包时间与虚拟分页配置测试通过')
