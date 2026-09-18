/**
 * 东方财富股吧 / 天天基金适配包测试（P2-21，2026-09-18 真实浏览器渲染后 DOM 取证驱动）
 * 运行：npx tsx test/unit/guba-fund-adapter.test.ts
 *
 * 覆盖：
 * - 两个适配包通过 schema 校验；同域三个页面类型条目的路由命中（getAdapterFor）
 * - 三个条目各自的时间语义与年份策略（mod_time + descending-list / pub_time + 旧逐帖 / cite.last + descending-list）
 * - fixture 驱动：基金吧总版 cite.last 推断（99% 口径）、cite.date 会整批放弃（0%）
 * - fixture 驱动：天天基金详情内嵌吧帖（:has(td.td05) 排除表头行 + 严格倒序年份推断）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { AdapterManager } from '../../src/adapters'
import { validateAdapter } from '../../src/adapters/schema'
import gubaAdapter from '../../src/adapters/guba.json'
import fundAdapter from '../../src/adapters/fund.json'
import { createYearInferenceState, extractTimestampText, parseTimestamp } from '../../src/shared/time'
import type { Adapter, PlatformAdapter } from '../../src/shared/types'
import { check, finish } from '../helpers/check'
import { setupDom } from '../helpers/dom-env'

setupDom('<!doctype html><html><body></body></html>', { url: 'https://guba.eastmoney.com/' })

const NOW = new Date('2026-09-18T14:00:00+08:00').getTime()
const fixture = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, '../fixtures', name), 'utf-8')
const docOf = (name: string): Document => new JSDOM(fixture(name)).window.document

// ---------- 1. schema + 路由 ----------
check('guba.json 通过 schema 校验', validateAdapter(gubaAdapter as unknown as Adapter) === null, JSON.stringify(validateAdapter(gubaAdapter as unknown as Adapter)))
check('fund.json 通过 schema 校验', validateAdapter(fundAdapter as unknown as Adapter) === null, JSON.stringify(validateAdapter(fundAdapter as unknown as Adapter)))
check('guba.json 含 3 个页面类型条目', (gubaAdapter as unknown as Adapter).platforms.length === 3)

const route = (pathname: string): string | null =>
  AdapterManager.getAdapterFor('guba.eastmoney.com', pathname)?.name ?? null

check('全部列表 → 全部与热门条目', route('/list,600519.html') === '东方财富股吧·全部与热门', route('/list,600519.html') ?? 'null')
check('全部列表分页（_n）→ 同一条目', route('/list,600519_2.html') === '东方财富股吧·全部与热门')
check('热门列表 → 同一条目', route('/list,600519,99.html') === '东方财富股吧·全部与热门')
check('热门列表分页 → 同一条目', route('/list,600519,99_2.html') === '东方财富股吧·全部与热门')
check('最新发帖 → 发帖时间条目', route('/list,600519,f.html') === '东方财富股吧·最新发帖', route('/list,600519,f.html') ?? 'null')
check('分类视图（资讯/研报/公告）→ 发帖时间条目', route('/list,600519,1,f.html') === '东方财富股吧·最新发帖' && route('/list,600519,3,f.html') === '东方财富股吧·最新发帖')
check('最新发帖分页 → 发帖时间条目', route('/list,600519,f_2.html') === '东方财富股吧·最新发帖')
check('详情页 → 全部与热门条目（评论过滤挂在该条目）', route('/news,600519,1774603234.html') === '东方财富股吧·全部与热门')
check('详情页评论排序视图均在范围内', route('/news,600519,1774603234,d.html') === '东方财富股吧·全部与热门' && route('/news,600519,1774603234,z.html') === '东方财富股吧·全部与热门' && route('/news,600519,1774603234_2.html') === '东方财富股吧·全部与热门')
check('基金吧总版 → 基金吧条目', route('/jj.html') === '东方财富基金吧总版' && route('/jj_2.html') === '东方财富基金吧总版')
check('未适配页面类型（排行榜等）→ null（静默退出）', route('/rank/') === null, route('/rank/') ?? 'null')
check('天天基金：仅基金详情页在范围内', AdapterManager.getAdapterFor('fund.eastmoney.com', '/000001.html')?.name === '天天基金·基金详情内嵌吧帖' && AdapterManager.getAdapterFor('fund.eastmoney.com', '/fundf10/jbgk_000001.html') === null)

// ---------- 2. 条目的时间语义与年份策略 ----------
const gubaEntries = (gubaAdapter as unknown as Adapter).platforms
const [allView, newView, fundBar] = gubaEntries
const fund = (fundAdapter as unknown as Adapter).platforms[0] as PlatformAdapter

check(
  '全部与热门：时间取 mod_time（渲染后 JS 补类名，带回退链）+ 序列年份推断',
  JSON.stringify(allView.timestamp.selector) === JSON.stringify(['div.update.mod_time', 'div.update']) &&
    allView.timestamp.year_inference === 'descending-list',
  JSON.stringify(allView.timestamp),
)
check(
  '最新发帖：时间取 pub_time（与上一条目语义不同，独立条目）+ 不声明年份推断',
  JSON.stringify(newView.timestamp.selector) === JSON.stringify(['div.update.pub_time', 'div.update']) &&
    newView.timestamp.year_inference === undefined,
  JSON.stringify(newView.timestamp),
)
check(
  '基金吧总版：时间取排序键 cite.last + 序列年份推断',
  fundBar.timestamp.selector === 'cite.last' && fundBar.timestamp.year_inference === 'descending-list',
)
check(
  '详情评论：容器与时间选择器按渲染后 DOM 声明',
  allView.comment_selectors?.join(',') === '#replylist .reply_item[data-reply_id]' && allView.comment_timestamp_selector === '.pubtime',
  JSON.stringify({ c: allView.comment_selectors, t: allView.comment_timestamp_selector }),
)
check(
  '天天基金：容器用 :has(td.td05) 排除表头行 + 序列年份推断',
  fund.post_selectors[0].includes(':has(td.td05)') && fund.timestamp.year_inference === 'descending-list',
  fund.post_selectors.join(','),
)

// ---------- 3. 基金吧总版：cite.last 可用、cite.date 整批放弃 ----------
{
  const doc = docOf('guba-fund-list.html')
  const rows = [...doc.querySelectorAll(fundBar.post_selectors[0])] as HTMLElement[]
  check('基金吧总版：容器命中 4 行', rows.length === 4, `got ${rows.length}`)
  check(
    '基金吧总版：置顶活动帖（em.settop）在行内',
    rows.filter((r) => r.querySelector('em.settop')).length === 2,
  )

  const state = createYearInferenceState('descending-list')
  const parsed = rows.map((r) =>
    parseTimestamp(extractTimestampText(r, fundBar.timestamp.selector, null, null)!, fundBar, NOW, state),
  )
  check(
    '基金吧总版：cite.last 序列推断（置顶行按异常行默认显示，随后重对齐恢复）',
    parsed[0]?.timestamp === new Date(2026, 8, 17, 18, 1).getTime() &&
      parsed[1] === null &&
      parsed[2]?.timestamp === new Date(2026, 8, 18, 11, 52).getTime(),
    JSON.stringify(parsed.map((p) => p?.timestamp)),
  )

  // 反证：同一列表若改用发帖时间 cite.date，首行（置顶旧帖）会触发 48h 守卫、整批放弃
  const dateState = createYearInferenceState('descending-list')
  const viaDate = rows.map((r) =>
    parseTimestamp(extractTimestampText(r, 'cite.date', null, null)!, fundBar, NOW, dateState),
  )
  check(
    '基金吧总版：改用 cite.date 会整批放弃推断（0% 覆盖，故不采用）',
    viaDate.every((p) => p === null),
    JSON.stringify(viaDate.map((p) => p?.timestamp)),
  )
}

// ---------- 4. 天天基金：内嵌吧帖 + 表头行排除 ----------
{
  const doc = docOf('fund-detail-bar.html')
  const plainRows = doc.querySelectorAll('.barEssayListWrap table.popTable tbody tr')
  const rows = [...doc.querySelectorAll(fund.post_selectors[0])] as HTMLElement[]
  check(
    '天天基金：:has(td.td05) 命中全部数据行',
    rows.length === 4 && rows.length === plainRows.length,
    `${rows.length} / ${plainRows.length}`,
  )
  // 造一个表头行验证排除效果（真实页面有 <tr><th>… 表头）
  const withHeader = new JSDOM(
    `${fixture('fund-detail-bar.html').split('</table>')[0]}<tr><th class="th01">点击</th><th class="th05">最新更新时间</th></tr></tbody></table></div></body></html>`,
  ).window.document
  check(
    '天天基金：表头行 <tr><th> 不会进入帖子集合（避免 1 行「无法解析」噪音）',
    withHeader.querySelectorAll(fund.post_selectors[0]).length === 4,
    `${withHeader.querySelectorAll(fund.post_selectors[0]).length}`,
  )
  check(
    '天天基金：时间取 td.td05（MM-DD HH:mm）',
    extractTimestampText(rows[0], fund.timestamp.selector, null, null) === '09-17 16:19',
    extractTimestampText(rows[0], fund.timestamp.selector, null, null) ?? 'null',
  )
  const state = createYearInferenceState('descending-list')
  const parsed = rows.map((r) =>
    parseTimestamp(extractTimestampText(r, fund.timestamp.selector, null, null)!, fund, NOW, state),
  )
  check(
    '天天基金：严格倒序 + 首行新鲜 → 年份推断全部成立',
    parsed[0]?.timestamp === new Date(2026, 8, 17, 16, 19).getTime() &&
      parsed[3]?.timestamp === new Date(2026, 8, 16, 9, 50).getTime() &&
      parsed.every((p) => p !== null),
    JSON.stringify(parsed.map((p) => p?.timestamp)),
  )
}

check('天天基金未声明评论选择器（内嵌列表无评论层）', !fund.comment_selectors?.length)

finish('东方财富股吧 / 天天基金适配包测试完成')
