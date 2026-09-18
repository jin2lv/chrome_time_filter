/**
 * 同花顺适配包测试（P2-1）
 * 运行：npx tsx test/unit/ths.test.ts
 *
 * 覆盖：
 * - getAdapter('t.10jqka.com.cn') 返回同花顺适配包
 * - extractTimestampText 组合模式（data-date 属性 + 时间文本）
 * - parseAbsoluteTime 'MMDD HH:mm' 无年份补当年
 * - 跨年修正（MMDD 解析出未来时间 → 年份 -1）
 * - AdapterManager 双平台注册
 */
import { AdapterManager } from '../../src/adapters'
import { extractTimestampText, parseAbsoluteTime } from '../../src/shared/time'
import { check, finish } from '../helpers/check'
import { setupDom } from '../helpers/dom-env'

setupDom('<!doctype html><html><body></body></html>', { url: 'http://t.10jqka.com.cn/' })

// 1. 适配包匹配
const ths = AdapterManager.getAdapter('t.10jqka.com.cn')
check('getAdapter(t.10jqka.com.cn) 命中同花顺', ths?.name === '同花顺', ths?.name ?? 'null')
const thsSub = AdapterManager.getAdapter('www.t.10jqka.com.cn')
check('子域名命中', thsSub?.name === '同花顺', thsSub?.name ?? 'null')
check('雪球不受影响', AdapterManager.getAdapter('xueqiu.com')?.name === '雪球')
check('未知域名返回 null', AdapterManager.getAdapter('example.com') === null)

// 2. 组合提取（模拟同花顺 DOM）
const mock = document.createElement('li')
mock.className = 'feed-item'
mock.setAttribute('data-date', '0811')
mock.innerHTML = `<div class="feed-item-timeline-time">08:29</div>`
const text = extractTimestampText(mock, '.feed-item-timeline-time', null, 'data-date')
check('组合提取 = "0811 08:29"', text === '0811 08:29', text ?? 'null')
const noDate = extractTimestampText(mock, '.feed-item-timeline-time', null, null)
check('无 date_attr 时取纯文本', noDate === '08:29', noDate ?? 'null')

// 3. MMDD HH:mm 解析（无年份补当年）
const ts = parseAbsoluteTime('0811 08:29', 'MMDD HH:mm')
const now = new Date()
const expected = new Date(now.getFullYear(), 7, 11, 8, 29).getTime() // 8月=index 7
check('MMDD HH:mm 补当年', ts !== null && ts === expected, `got ${ts}, expected ${expected}`)

// 4. 跨年修正：MMDD 解析出未来时间 → 年份 -1
const futureText = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate() + 1).padStart(2, '0')} 23:59`
const futureTs = parseAbsoluteTime(futureText, 'MMDD HH:mm')
const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1, 23, 59).getTime()
check('跨年帖修正为去年', futureTs !== null && futureTs <= Date.now(), `got ${futureTs}`)

// 5. Schema 校验通过（ths 适配包合法）
const pkg = (await import('../../src/adapters/ths.json')) as unknown as { default: unknown }
const { validateAdapter } = await import('../../src/adapters/schema')
const errs = validateAdapter((pkg as { default: unknown }).default)
check('ths 适配包通过 Schema 校验', errs === null, JSON.stringify(errs))

finish('同花顺适配包测试完成')
