/**
 * 单元测试：时间解析与截止判定逻辑（P1-4）
 * 运行：npx tsx test/unit/time.test.ts
 */
import assert from 'node:assert'
import {
  extractTimePart,
  parseAbsoluteTime,
  parseRelativeTime,
  parseTimestamp,
} from '../../src/shared/time'
import type { PlatformAdapter } from '../../src/shared/types'
import xueqiu from '../../src/adapters/xueqiu.json'

const adapter = (xueqiu as unknown as { platforms: PlatformAdapter[] }).platforms[0]
const patterns = adapter.timestamp.patterns!

// 锚点：固定时刻（2026-08-11 12:00:00 UTC+8 → epoch ms）
const anchor = new Date('2026-08-11T12:00:00+08:00').getTime()

function approx(actual: number | null, expectedMsAgo: number, label: string, toleranceMs = 60_000): void {
  const expected = anchor - expectedMsAgo
  assert.ok(actual !== null, `${label}: 应解析成功`)
  assert.ok(
    Math.abs(actual! - expected) <= toleranceMs,
    `${label}: 期望 ${expected}（${expectedMsAgo}ms 前）实际 ${actual}，差 ${Math.abs(actual! - expected)}ms`,
  )
}

// ---- extractTimePart ----
assert.strictEqual(extractTimePart('9分钟前· 来自iPhone'), '9分钟前')
assert.strictEqual(extractTimePart('3小时前'), '3小时前')
assert.strictEqual(extractTimePart('昨天 · 来自Android'), '昨天')
console.log('✓ extractTimePart')

// ---- parseRelativeTime（时间锚定）----
approx(parseRelativeTime('9分钟前', patterns, anchor), 9 * 60_000, '9分钟前')
approx(parseRelativeTime('5秒前', patterns, anchor), 5_000, '5秒前', 1)
approx(parseRelativeTime('刚刚', patterns, anchor), 0, '刚刚', 1)
approx(parseRelativeTime('17分钟前', patterns, anchor), 17 * 60_000, '17分钟前')
approx(parseRelativeTime('3小时前', patterns, anchor), 3 * 3_600_000, '3小时前')
approx(parseRelativeTime('昨天', patterns, anchor), 24 * 3_600_000, '昨天')
approx(parseRelativeTime('2天前', patterns, anchor), 2 * 24 * 3_600_000, '2天前')
assert.strictEqual(parseRelativeTime('2026-08-10 15:00', patterns, anchor), null, '绝对时间不应被相对解析命中')
console.log('✓ parseRelativeTime（时间锚定 ±1min）')

// ---- parseAbsoluteTime ----
const abs1 = parseAbsoluteTime('2026-08-10 15:00', adapter.timestamp.format)
assert.strictEqual(abs1, new Date('2026-08-10T15:00:00+08:00').getTime(), 'YYYY-MM-DD HH:mm')
const abs2 = parseAbsoluteTime('08-10 15:00', adapter.timestamp.format)
assert.strictEqual(abs2, new Date('2026-08-10T15:00:00+08:00').getTime(), 'MM-DD HH:mm 兜底')
assert.strictEqual(parseAbsoluteTime('不知道什么格式', adapter.timestamp.format), null, '无法解析 → null')
console.log('✓ parseAbsoluteTime（多格式兜底）')

// ---- 今天/昨天 HH:mm（P2-4 雪球评论格式）----
const now2 = new Date()
const todayTs = parseAbsoluteTime('今天 08:17 · 江苏', adapter.timestamp.format)
const todayExpected = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate(), 8, 17).getTime()
assert.ok(todayTs !== null && Math.abs(todayTs - todayExpected) < 1000, `今天 HH:mm: got ${todayTs} expected ${todayExpected}`)
const yestTs = parseAbsoluteTime('昨天 16:23', adapter.timestamp.format)
const yestExpected = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate() - 1, 16, 23).getTime()
assert.ok(yestTs !== null && Math.abs(yestTs - yestExpected) < 1000, `昨天 HH:mm: got ${yestTs} expected ${yestExpected}`)
console.log('✓ 今天/昨天 HH:mm（雪球评论格式，P2-4）')

// ---- parseTimestamp 统一入口 ----
// 雪球适配包是 relative：相对时间应命中相对分支
const rel = parseTimestamp('5小时前', adapter, anchor)
assert.ok(rel !== null && rel.isRelative, 'relative 适配包：相对时间走相对分支')
approx(rel!.timestamp, 5 * 3_600_000, '5小时前 → 锚定')
// 绝对时间在 relative 适配包下也能兜底（abs fallback）
const absMix = parseTimestamp('2026-08-10 15:00', adapter, anchor)
assert.ok(absMix !== null && !absMix.isRelative, 'relative 适配包：绝对时间兜底解析')
assert.strictEqual(absMix!.timestamp, new Date('2026-08-10T15:00:00+08:00').getTime())
// 无法解析 → null
assert.ok(parseTimestamp('刚刚', adapter, anchor)?.isRelative, '刚刚应按当前锚点解析')
console.log('✓ parseTimestamp（相对优先 + 绝对兜底）')

// ---- 截止判定（零误杀/零漏杀逻辑层）----
// 截止时间 = 锚点 - 2h（即 2 小时前）
const cutoff = anchor - 2 * 3_600_000
function shouldFilter(timestamp: number): boolean {
  return timestamp > cutoff
}
// "3小时前" 帖子的锚定时间 = anchor-3h < cutoff → 保留（老帖不误杀）
const old = parseRelativeTime('3小时前', patterns, anchor)!
assert.strictEqual(shouldFilter(old), false, '3小时前帖子 ≤ 截止 → 保留（零误杀）')
// "9分钟前" → anchor-9min > cutoff → 过滤（新帖不漏杀）
const fresh = parseRelativeTime('9分钟前', patterns, anchor)!
assert.strictEqual(shouldFilter(fresh), true, '9分钟前帖子 > 截止 → 过滤（零漏杀）')
// "2小时前" 帖子 = anchor-2h = cutoff → 保留（边界：≤ T 显示）
const edge = parseRelativeTime('2小时前', patterns, anchor)!
assert.strictEqual(shouldFilter(edge), false, '恰好 2 小时前（=T）→ 保留')
console.log('✓ 截止判定（零误杀/零漏杀/边界）')

console.log('\n全部单测通过 ✅')
