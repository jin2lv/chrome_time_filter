import assert from 'node:assert'
import { JSDOM } from 'jsdom'
import xueqiu from '../../src/adapters/xueqiu.json'
import { validateAdapter } from '../../src/adapters/schema'
import { extractTimestampText, parseTimestamp } from '../../src/shared/time'
import type { Adapter, PlatformAdapter } from '../../src/shared/types'

const pkg = xueqiu as unknown as Adapter
const adapter = pkg.platforms[0] as PlatformAdapter

assert.equal(validateAdapter(pkg), null, '雪球适配包应通过 Schema 校验')
assert.equal(adapter.virtual_pagination?.list_selector, '.stock-timeline > .status-list')
assert.equal(adapter.virtual_pagination?.post_id.selector, 'a.date-and-source')
assert.equal(adapter.virtual_pagination?.post_id.attr, 'data-id')
assert.equal(adapter.virtual_pagination?.source_link_selector, 'a.date-and-source')
assert.equal(adapter.virtual_pagination?.context_selector, '.stock-timeline-tabs a.active')
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

console.log('雪球适配包时间与虚拟分页配置测试通过')
