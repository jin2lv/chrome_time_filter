/**
 * 无年份时间处理测试（P2-21 前置能力）
 * 运行：npx tsx test/unit/year-inference.test.ts
 *
 * 覆盖：
 * - inferYearFor：首行锚定、近 48h 守卫、跨年推进、排序异常行（置顶/混排）不误判
 * - parseTimestamp：适配包声明 year_inference 后无年份时间的行为（descending-list / never）
 * - 未声明 year_inference 时保持旧行为（雪球「修改于 MM-DD HH:mm」兼容）
 * - 多选择器回退链（timestamp.selector 数组）与 schema 校验
 */
import assert from 'node:assert'
import { createYearInferenceState, extractTimestampText, inferYearFor, parseNoYearSample, parseTimestamp } from '../../src/shared/time'
import type { PlatformAdapter } from '../../src/shared/types'
import { validateAdapter } from '../../src/adapters/schema'
import { check, finish } from '../helpers/check'
import { setupDom } from '../helpers/dom-env'

setupDom('<!doctype html><html><body></body></html>', { url: 'https://example.com/' })

const NOW = new Date('2026-09-18T12:00:00+08:00').getTime()
const day = (iso: string): number => new Date(iso).getTime()

// ---------- 1. parseNoYearSample ----------
check('MM-DD HH:mm 样本', JSON.stringify(parseNoYearSample('09-18 11:46')) === JSON.stringify({ monthDay: 918, minutesOfDay: 706 }))
check('MMDD HH:mm 样本（同花顺 data-date）', JSON.stringify(parseNoYearSample('0918 08:29')) === JSON.stringify({ monthDay: 918, minutesOfDay: 509 }))
check('纯日期样本', JSON.stringify(parseNoYearSample('08-17')) === JSON.stringify({ monthDay: 817, minutesOfDay: 0 }))
check('带秒样本', JSON.stringify(parseNoYearSample('09-18 11:46:30')) === JSON.stringify({ monthDay: 918, minutesOfDay: 706 }))
check('全年份文本不算无年份样本', parseNoYearSample('2026-09-18 11:46') === null)
check('非法月日被拒', parseNoYearSample('13-45 11:46') === null && parseNoYearSample('09-18 25:00') === null)

// ---------- 2. inferYearFor：首行锚定 + 48h 守卫 ----------
{
  const s = createYearInferenceState('descending-list')
  check('首行新鲜（当日）→ 今年', inferYearFor(s, parseNoYearSample('09-18 11:46')!, NOW) === 2026)
  check('序列推进：更早的月日沿用同一年的推断', inferYearFor(s, parseNoYearSample('09-17 20:16')!, NOW) === 2026)
  check('同日多行不改变年份', inferYearFor(s, parseNoYearSample('09-17 09:00')!, NOW) === 2026)
}
{
  // 首行月日 > 今日月日 → 去年（跨年：元旦当天回看 12-31）
  const s = createYearInferenceState('descending-list')
  const now = day('2026-01-01T10:00:00+08:00')
  check('首行 12-31 在今天 01-01 之后 → 去年', inferYearFor(s, parseNoYearSample('12-31 23:00')!, now) === 2025)
  check('跨年推进：1 月 → 12 月年份 -1', inferYearFor(s, parseNoYearSample('01-01 08:00')!, now) === 2025)
}
{
  // 跨年推进（列表从 1 月继续翻到上一年 12 月）
  const s = createYearInferenceState('descending-list')
  const now = day('2026-01-02T12:00:00+08:00')
  check('首行当日 → 今年', inferYearFor(s, parseNoYearSample('01-02 10:00')!, now) === 2026)
  check('1 月内倒序 → 仍是今年', inferYearFor(s, parseNoYearSample('01-01 09:00')!, now) === 2026)
  check('出现 12 月 → 年份 -1（跨年）', inferYearFor(s, parseNoYearSample('12-31 20:00')!, now) === 2025)
}
{
  // 48h 守卫：首行不新鲜 → 整批不可信（后续行一律 null，不误杀）
  const s = createYearInferenceState('descending-list')
  check('首行超出 48h → 该行不可解析', inferYearFor(s, parseNoYearSample('09-10 10:00')!, NOW) === null)
  check('守卫触发后整批不可解析', inferYearFor(s, parseNoYearSample('09-09 10:00')!, NOW) === null)
}
{
  // 排序异常：月日回跳（置顶帖、财富号混排）→ 该行不可解析，且游标重对齐以便后续行恢复
  const s = createYearInferenceState('descending-list')
  assert.strictEqual(inferYearFor(s, parseNoYearSample('09-18 11:46')!, NOW), 2026)
  check('正常倒序（更早月日）沿用今年', inferYearFor(s, parseNoYearSample('08-17 03:45')!, NOW) === 2026)
  check('月日回跳（非 1 月→12 月）→ 该行不可解析', inferYearFor(s, parseNoYearSample('09-15 10:45')!, NOW) === null)
  check('异常行后游标重对齐：后续更早行恢复正常', inferYearFor(s, parseNoYearSample('09-14 08:00')!, NOW) === 2026)
}
{
  // guba「全部」列表的真实结构：财富号置顶区块（更旧）+ 严格倒序的普通帖区块。
  // 异常行重对齐游标后，占据主体的普通帖区块能正常推断（实测覆盖率 6% → ~94%）。
  const s = createYearInferenceState('descending-list')
  const seq = ['09-18 08:29', '09-17 18:17', '09-15 14:14', '09-18 12:19', '09-18 12:16', '09-18 12:11']
  const years = seq.map((text) => inferYearFor(s, parseNoYearSample(text)!, NOW))
  check(
    '置顶区块后普通帖区块恢复推断（仅区块交界那一行不可解析）',
    JSON.stringify(years) === JSON.stringify([2026, 2026, 2026, null, 2026, 2026]),
    JSON.stringify(years),
  )
}
{
  const s = createYearInferenceState('never')
  check('never 模式：一律不可推断', inferYearFor(s, parseNoYearSample('09-18 11:46')!, NOW) === null)
}

// ---------- 3. content 层：parseTimestamp 按适配包策略分支 ----------
function adapterWith(ts: Partial<PlatformAdapter['timestamp']>): PlatformAdapter {
  return {
    name: '测试',
    domains: ['example.com'],
    post_selectors: ['article'],
    timestamp: { selector: 'time', type: 'absolute', format: 'MM-DD HH:mm', ...ts },
    quick_presets: [],
  }
}

{
  const adapter = adapterWith({ year_inference: 'descending-list' })
  const state = createYearInferenceState('descending-list')
  const fresh = parseTimestamp('09-18 11:46', adapter, NOW, state)
  check(
    'descending-list：今年推断生效',
    fresh?.timestamp === new Date(2026, 8, 18, 11, 46).getTime(),
    String(fresh?.timestamp),
  )
  const stale = parseTimestamp('09-10 10:00', adapter, NOW)
  check('缺状态时按不可推断处理（不猜年份）', stale === null, String(stale?.timestamp))
}
{
  const adapter = adapterWith({ year_inference: 'never' })
  check('never：无年份时间不可解析', parseTimestamp('09-18 11:46', adapter, NOW) === null)
  check(
    'never：全年份时间仍可解析（同一列表混排）',
    parseTimestamp('2026-09-18 11:46', adapter, NOW)?.timestamp === new Date(2026, 8, 18, 11, 46).getTime(),
  )
}
{
  // 未声明 year_inference：保持旧行为（雪球「修改于 MM-DD HH:mm」依赖逐帖补当年）
  const adapter = adapterWith({})
  const parsed = parseTimestamp('09-18 11:46', adapter, NOW)
  check('未声明策略 → 沿用旧补当年行为', parsed !== null, 'null')
}

// ---------- 4. 多选择器回退链 ----------
{
  const dom = setupDom(
    `<!doctype html><body>
      <div class="a" id="row1"><span class="t1">09-18 11:46</span></div>
      <div class="a" id="row2"><span class="t2">09-17 09:08</span></div>
      <div class="a" id="row3"></div>
    </body>`,
    { url: 'https://example.com/' },
  )
  const rows = [...dom.window.document.querySelectorAll('.a')] as HTMLElement[]
  check(
    '主选择器命中时取主选择器',
    extractTimestampText(rows[0], ['.t1', '.t2'], null, null) === '09-18 11:46',
  )
  check(
    '主选择器未命中 → 回退到备用选择器',
    extractTimestampText(rows[1], ['.t1', '.t2'], null, null) === '09-17 09:08',
  )
  check('全部未命中 → null', extractTimestampText(rows[2], ['.t1', '.t2'], null, null) === null)

  const pkg = {
    version: '1.0.0',
    platforms: [
      {
        name: '测试',
        domains: ['example.com'],
        post_selectors: ['div.a'],
        timestamp: { selector: ['.t1', '.t2'], type: 'absolute', format: 'MM-DD HH:mm', year_inference: 'never' },
        quick_presets: [],
      },
    ],
  }
  check('schema：多选择器 + year_inference 通过校验', validateAdapter(pkg) === null, JSON.stringify(validateAdapter(pkg)))

  const badMode = structuredClone(pkg) as Record<string, any>
  badMode.platforms[0].timestamp.year_inference = 'guess'
  const errs = validateAdapter(badMode)
  check('schema：非法 year_inference 被拒绝', !!errs?.some((e) => e.includes('year_inference')), JSON.stringify(errs))

  const badSelector = structuredClone(pkg) as Record<string, any>
  badSelector.platforms[0].timestamp.selector = []
  check('schema：空选择器数组被拒绝', !!validateAdapter(badSelector)?.some((e) => e.includes('timestamp.selector')))
}

finish('无年份时间处理测试完成')
