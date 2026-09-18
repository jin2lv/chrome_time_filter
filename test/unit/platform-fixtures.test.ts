/**
 * 平台 DOM fixture 测试（P2-21 取证驱动）
 * 运行：npx tsx test/unit/platform-fixtures.test.ts
 *
 * 用 2026-09-18 抓取并匿名化的真实页面结构（渲染后 DOM）验证**已发布的适配包**：
 * - 集思录：分类列表（选择器 + 时间提取 + 解析）与主题详情（评论选择器精度 + strip_pattern）
 * - 东方财富股吧：个股吧全部列表（JS 补类名、无 data-postid、推荐区块导致的年份推断异常行）
 * - 东方财富基金吧总版：cite.date 与 cite.last 语义分离、为何取排序键 cite.last
 * - 天天基金详情内嵌吧帖：列结构、时间列与行模板变体
 * - 服务端 URL 翻页策略在真实集思录结构上的端到端行为（跨源页聚合 + 去重 + 末页）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { VirtualPaginationController } from '../../src/content/virtual-pagination'
import { createYearInferenceState, extractTimestampText, parseTimestamp } from '../../src/shared/time'
import type { Adapter, PlatformAdapter } from '../../src/shared/types'
import jisiluAdapter from '../../src/adapters/jisilu.json'
import gubaAdapter from '../../src/adapters/guba.json'
import fundAdapter from '../../src/adapters/fund.json'
import { check, finish } from '../helpers/check'
import { setupDom } from '../helpers/dom-env'

const fixture = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, '../fixtures', name), 'utf-8')
const docOf = (name: string): Document => new JSDOM(fixture(name)).window.document

const jisilu = (jisiluAdapter as unknown as { platforms: PlatformAdapter[] }).platforms[0]
const NOW = new Date('2026-09-18T12:00:00+08:00').getTime()

/** 已发布的适配包条目（避免测试里再写一份候选配置，防止与线上配置漂移） */
const gubaEntries = (gubaAdapter as unknown as Adapter).platforms
const gubaAll = gubaEntries[0] // 全部与热门（mod_time + 详情评论）
const gubaFundBar = gubaEntries[2] // 基金吧总版（cite.last）
const fundDetail = (fundAdapter as unknown as Adapter).platforms[0]

// ---------- 1. 内置集思录适配包 vs 今日真实结构 ----------
{
  const dom = new JSDOM(fixture('jisilu-category.html'))
  const doc = dom.window.document
  const listRows = doc.querySelectorAll(jisilu.post_selectors.join(','))
  check('集思录：内置 post_selectors 命中 4 行', listRows.length === 4, `got ${listRows.length}`)

  const first = listRows[0] as HTMLElement
  const text = extractTimestampText(first, jisilu.timestamp.selector, jisilu.timestamp.attr, jisilu.timestamp.date_attr, jisilu.timestamp.strip_pattern)
  check(
    '集思录：时间元素取到「作者 回复 • 时间 • N 次浏览」整行文本（时间子串由 extract_pattern 在解析阶段提取）',
    text === '用户1 回复 • 2026-09-18 09:44 • 100 次浏览',
    text ?? 'null',
  )
  check(
    '集思录：整行文本内的绝对时间可被定位',
    /(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.test(text ?? ''),
    text ?? 'null',
  )
  const parsed = parseTimestamp(text!, jisilu, NOW)
  check(
    '集思录：全年份时间解析为分钟级绝对时间',
    parsed?.timestamp === new Date(2026, 8, 18, 9, 44).getTime() && parsed?.isRelative === false,
    String(parsed?.timestamp),
  )
  check(
    '集思录：稳定 ID 取 /question/{id}',
    (first.querySelector('h4 a')?.getAttribute('href') ?? '').includes('/question/'),
    first.querySelector('h4 a')?.getAttribute('href') ?? 'null',
  )
  const pager = doc.querySelector('.pagination')
  check('集思录：服务端分页容器存在（url 模式 native_pagination_selector 依据）', !!pager)
  check(
    '集思录：页码 URL 模板可从分页链接反推（__page-{n}，服务端整页翻页）',
    /sort_type-new__category-3__day-0__page-2/.test(pager?.innerHTML ?? ''),
    pager?.innerHTML?.slice(0, 120) ?? '',
  )
}

// ---------- 1b. 内置集思录适配包 vs 今日真实详情页结构 ----------
{
  const dom = new JSDOM(fixture('jisilu-topic.html'))
  const doc = dom.window.document
  const commentSel = (jisilu.comment_selectors ?? []).join(',')
  const timeSel = jisilu.comment_timestamp_selector ?? ''
  const comments = [...doc.querySelectorAll(commentSel)] as HTMLElement[]

  check('集思录详情：内置 comment_selectors 命中 3 条回复', comments.length === 3, `got ${comments.length}`)
  check(
    '集思录详情：帖子选择器零命中（正文不参与过滤）',
    doc.querySelectorAll(jisilu.post_selectors.join(',')).length === 0,
  )
  check(
    '集思录详情：正文块不被评论选择器命中（.aw-question-detail-title 内无 answer_list_）',
    doc.querySelectorAll(".aw-question-detail-title .aw-item[id^='answer_list_']").length === 0,
  )
  check(
    '集思录详情：comment_timestamp_selector 命中 3/3',
    doc.querySelectorAll(timeSel).length === 3,
    `got ${doc.querySelectorAll(timeSel).length}`,
  )
  check(
    '集思录详情：去掉 .pull-left 限定会误命中同级「引用」锚点（精确限定的必要性）',
    doc.querySelectorAll('.aw-dynamic-topic-meta .aw-text-color-999').length === 6,
    `got ${doc.querySelectorAll('.aw-dynamic-topic-meta .aw-text-color-999').length}`,
  )

  const first = comments[0]
  const text = extractTimestampText(
    first,
    timeSel,
    jisilu.timestamp.attr,
    jisilu.timestamp.date_attr,
    jisilu.timestamp.strip_pattern,
  )
  check('集思录详情：strip_pattern 去掉「来自属地」后缀', text === '2026-09-18 09:44', text ?? 'null')
  const parsed = parseTimestamp(text ?? '', jisilu, NOW)
  check(
    '集思录详情：解析为分钟级绝对时间',
    parsed?.timestamp === new Date(2026, 8, 18, 9, 44).getTime() && parsed?.isRelative === false,
    String(parsed?.timestamp),
  )

  // 评论按自身时间独立判定：截止 09-18 08:00 → 09:44 / 08:49 过滤，07:34 保留
  const cutoff = new Date(2026, 8, 18, 8, 0).getTime()
  const decisions = comments.map((el) => {
    const t = extractTimestampText(el, timeSel, null, null, jisilu.timestamp.strip_pattern)
    const p = parseTimestamp(t ?? '', jisilu, NOW)
    return p ? (p.timestamp > cutoff ? 'filtered' : 'include') : 'unparseable'
  })
  check(
    '集思录详情：评论按各自时间判定（2 过滤 / 1 保留 / 0 无法解析）',
    decisions.join(',') === 'filtered,filtered,include',
    JSON.stringify(decisions),
  )
}

// ---------- 2. guba 个股吧（渲染后 DOM） ----------
{
  const doc = docOf('guba-stock-list.html')
  const rows = [...doc.querySelectorAll(gubaAll.post_selectors[0])] as HTMLElement[]
  check('guba 个股吧：容器命中 4 行', rows.length === 4, `got ${rows.length}`)
  check(
    'guba 个股吧：时间单元格为 div.update.mod_time（渲染后 JS 补类名，回退链第一项即命中）',
    rows.map((r) => extractTimestampText(r, gubaAll.timestamp.selector, null, null)).join('|') ===
      '09-18 08:29|09-17 18:17|09-18 12:19|09-18 12:16',
    rows.map((r) => extractTimestampText(r, gubaAll.timestamp.selector, null, null)).join('|'),
  )
  check(
    'guba 个股吧：回退链第二项（div.update）同样可用（服务端 HTML 无 mod_time 类名时兜底）',
    rows.every((r) => extractTimestampText(r, ['div.update.mod_time', 'div.update'], null, null) !== null),
  )
  check(
    'guba 个股吧：渲染后行内无 data-postid（稳定 ID 只能取自 href）',
    rows.every((r) => !r.querySelector('div.title a')?.hasAttribute('data-postid')) &&
      rows[2].querySelector('div.title a')?.getAttribute('href') === '/news,600519,1774936002.html',
    rows.map((r) => r.querySelector('div.title a')?.getAttribute('href')).join(','),
  )
  check(
    'guba 个股吧：财富号帖 href 指向 caifuhao（无 postId），普通帖为 /news,{code},{postId}.html',
    (rows[0].querySelector('div.title a')?.getAttribute('href') ?? '').includes('caifuhao') &&
      (rows[1].querySelector('div.title a')?.getAttribute('href') ?? '').includes('caifuhao') &&
      (rows[3].querySelector('div.title a')?.getAttribute('href') ?? '').includes('caifuhao'),
  )
  check(
    'guba 个股吧：分页为真实链接 /list,{code}_{n}.html（可用扩展侧 url 模式模板）',
    (doc.querySelector('a.nump')?.getAttribute('href') ?? '') === 'https://guba.eastmoney.com/list,600519_2.html',
    doc.querySelector('a.nump')?.getAttribute('href') ?? 'null',
  )

  // 年份推断：真实行序 = 财富号置顶区块（更旧）+ 严格倒序普通帖区块
  const neverState = createYearInferenceState('never')
  const state = createYearInferenceState('descending-list')
  const parsed = rows.map((r) =>
    parseTimestamp(extractTimestampText(r, gubaAll.timestamp.selector, null, null)!, gubaAll, NOW, state),
  )
  check(
    'guba 个股吧：区块内正常推断（置顶区块前两行 + 交界后的普通帖行）',
    parsed[0]?.timestamp === new Date(2026, 8, 18, 8, 29).getTime() &&
      parsed[1]?.timestamp === new Date(2026, 8, 17, 18, 17).getTime() &&
      parsed[3]?.timestamp === new Date(2026, 8, 18, 12, 16).getTime(),
    JSON.stringify(parsed.map((p) => p?.timestamp)),
  )
  check(
    'guba 个股吧：区块交界行不可解析 → 默认显示（不误杀），且后续行重对齐后恢复',
    parsed[2] === null,
    String(parsed[2]?.timestamp),
  )
  check(
    'guba 个股吧：year_inference=never 时全部不可解析（该视图年份语义无保障）',
    rows.every((r) => parseTimestamp(extractTimestampText(r, gubaAll.timestamp.selector, null, null)!, gubaAll, NOW, neverState) === null),
  )
}

// ---------- 3. guba 基金吧总版 ----------
{
  const doc = docOf('guba-fund-list.html')
  const rows = [...doc.querySelectorAll(gubaFundBar.post_selectors[0])] as HTMLElement[]
  check('guba 基金吧：容器命中 4 行', rows.length === 4, `got ${rows.length}`)
  const postTimes = rows.map((r) => r.querySelector('cite.date')?.textContent?.trim() ?? '')
  const replyTimes = rows.map((r) => r.querySelector('cite.last')?.textContent?.trim() ?? '')
  check(
    'guba 基金吧：cite.date 为发帖时间、cite.last 为末回复时间（两列并存）',
    postTimes.every((t) => /^\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) && replyTimes.every((t) => /^\d{2}-\d{2} \d{2}:\d{2}$/.test(t)),
    JSON.stringify({ postTimes, replyTimes }),
  )
  check(
    'guba 基金吧：置顶活动帖（em.settop）存在，行级时间不可作为排序基准',
    rows.some((r) => r.querySelector('em.settop')),
  )
  // 该列表按末回复排序：发帖时间 cite.date 非单调且首行为置顶旧帖 → 用 cite.date 会整批放弃
  const dateState = createYearInferenceState('descending-list')
  const viaDate = rows.map((r) =>
    parseTimestamp(extractTimestampText(r, 'cite.date', null, null)!, gubaFundBar, NOW, dateState),
  )
  check(
    'guba 基金吧：改用发帖时间 cite.date 会整批放弃推断（0% 覆盖，故不采用）',
    viaDate.every((p) => p === null),
    JSON.stringify(viaDate.map((p) => p?.timestamp)),
  )
  check(
    'guba 基金吧：发帖月日非单调（08-28 → 08-22 → 09-18）',
    postTimes[0] === '08-28 17:44' && postTimes[3] === '09-18 11:38',
    JSON.stringify(postTimes),
  )
  check(
    'guba 基金吧：已发布配置取排序键 cite.last + 序列年份推断',
    gubaFundBar.timestamp.selector === 'cite.last' && gubaFundBar.timestamp.year_inference === 'descending-list',
    JSON.stringify(gubaFundBar.timestamp),
  )
  const lastState = createYearInferenceState('descending-list')
  const viaLast = rows.map((r) =>
    parseTimestamp(extractTimestampText(r, gubaFundBar.timestamp.selector, null, null)!, gubaFundBar, NOW, lastState),
  )
  check(
    'guba 基金吧：cite.last 序列推断可用（置顶行按异常行默认显示，随后恢复）',
    viaLast[0] !== null && viaLast[1] === null && viaLast[2] !== null,
    JSON.stringify(viaLast.map((p) => p?.timestamp)),
  )
}

// ---------- 4. 天天基金详情内嵌吧帖 ----------
{
  const dom = new JSDOM(fixture('fund-detail-bar.html'))
  const doc = dom.window.document
  const rows = [...doc.querySelectorAll(fundDetail.post_selectors[0])] as HTMLElement[]
  check('天天基金：容器命中 4 行', rows.length === 4, `got ${rows.length}`)
  const firstText = extractTimestampText(rows[0], fundDetail.timestamp.selector, null, null)
  check('天天基金：时间取 td.td05（MM-DD HH:mm）', firstText === '09-17 16:19', firstText ?? 'null')
  check(
    '天天基金：行内混有不同吧来源（/news,of… / /news,zssh…）',
    rows.some((r) => (r.querySelector('a')?.getAttribute('href') ?? '').includes('/news,zssh')),
    rows.map((r) => r.querySelector('a')?.getAttribute('href')).join(','),
  )
  check(
    '天天基金：无年份时间在未声明 never 时按序列推断解析（当前配置）',
    parseTimestamp(firstText!, fundDetail, NOW, createYearInferenceState('descending-list'))?.timestamp ===
      new Date(2026, 8, 17, 16, 19).getTime(),
  )
  // 行模板变体：若站点把时间列换成 td.td06，该行不再被 :has(td.td05) 选中 →
  // 退化为「不参与过滤、默认显示」，而不是拿错列的时间误判
  const variant = rows[0].cloneNode(true) as HTMLElement
  const cell = variant.querySelector('td.td05')!
  cell.className = 'td06'
  const variantDoc = new JSDOM(`<div class="barEssayListWrap"><table class="popTable"><tbody>${variant.outerHTML}</tbody></table></div>`).window.document
  check(
    '天天基金：站点改用其他时间列时该行不被选中（失败方向为默认显示，不误杀）',
    variantDoc.querySelectorAll(fundDetail.post_selectors[0]).length === 0,
    `${variantDoc.querySelectorAll(fundDetail.post_selectors[0]).length}`,
  )
}

// ---------- 5. 真实结构上的 URL 翻页端到端 ----------
{
  const page1 = fixture('jisilu-category.html')
  // 第 2 页：结构相同、内容为更早的主题（真实站点形态；此处按 id 顺移模拟）
  const page2 = page1.replaceAll('question/4380', 'question/4379')
  const requested: string[] = []
  ;(globalThis as Record<string, unknown>).fetch = (async (url: string) => {
    requested.push(String(url))
    const page = Number(String(url).match(/page-(\d+)/)?.[1] ?? 0)
    if (page === 1) return { ok: true, status: 200, text: async () => page1 }
    if (page === 2) return { ok: true, status: 200, text: async () => page2 }
    return { ok: true, status: 200, text: async () => '<!doctype html><html><body><div class="aw-question-list"></div></body></html>' }
  }) as unknown as typeof fetch

  setupDom(page1, { url: 'https://www.jisilu.cn/category/3' })

  const config = {
    list_selector: '.aw-question-list',
    post_id: { selector: 'h4 a', attr: 'href' },
    source_link_selector: 'h4 a',
    native_pagination_selector: '.pagination',
    source_mode: 'url' as const,
    page_url_pattern: '/home/explore/sort_type-new__category-3__day-0__page-{page}',
    start_page: 1,
    page_size: 6,
    max_source_pages: 5,
    wait_ms: 10,
  }
  const decided: string[] = []
  const controller = VirtualPaginationController.create({
    config,
    postSelector: jisilu.post_selectors.join(','),
    decide: (post) => {
      const id = post.querySelector('h4 a')?.getAttribute('href') ?? '?'
      decided.push(id)
      const text = extractTimestampText(post, jisilu.timestamp.selector, jisilu.timestamp.attr, jisilu.timestamp.date_attr, jisilu.timestamp.strip_pattern)
      const parsed = text ? parseTimestamp(text, jisilu, NOW) : null
      // 截止 = 2026-09-17 22:00：晚于该时刻的主题应被过滤
      return parsed && parsed.timestamp > new Date(2026, 8, 17, 22, 0).getTime() ? 'filtered' : 'include'
    },
    onDecision: () => {},
  })
  check('集思录：url 模式控制器创建成功', controller !== null)
  await controller!.start()

  check(
    '集思录：首屏跨 2 个源页聚合（4 + 4 条 → 虚拟页 6 条）',
    requested.join(',') ===
      'https://www.jisilu.cn/home/explore/sort_type-new__category-3__day-0__page-1,https://www.jisilu.cn/home/explore/sort_type-new__category-3__day-0__page-2',
    requested.join(','),
  )
  check(
    '集思录：跨源页去重（每个主题只判定一次）',
    decided.length === new Set(decided).size && decided.length === 8,
    JSON.stringify(decided.length),
  )
  const virtualText = document.querySelector('.tm-virtual-list')?.textContent ?? ''
  check('集思录：虚拟页渲染 6 条', (virtualText.match(/示例标题/g) ?? []).length === 6, virtualText)
  check(
    '集思录：截止时间判定生效（09-18 09:44 的主题被过滤）',
    !virtualText.includes('示例标题 1'),
    virtualText.slice(0, 120),
  )
  check('集思录：原生列表被隐藏', (document.querySelector<HTMLElement>('.aw-question-list')!.style.getPropertyValue('display')) === 'none')
  check(
    '集思录：克隆帖的源链接为绝对地址（可点击回原帖）',
    (document.querySelector<HTMLElement>('.tm-virtual-list .post, .tm-virtual-list .aw-item')?.dataset.tmSourceHref ?? '').startsWith('https://www.jisilu.cn/question/'),
    document.querySelector<HTMLElement>('.tm-virtual-list .aw-item')?.dataset.tmSourceHref ?? 'none',
  )
  controller!.destroy()
  check('集思录：销毁后原生列表恢复', document.querySelector<HTMLElement>('.aw-question-list')!.style.getPropertyValue('display') === '')
}

finish('平台 DOM fixture 测试完成')
