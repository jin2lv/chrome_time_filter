/**
 * P2-18 金融场景预设——最近一个交易日与交易时段测试
 * 运行：npx tsx test/unit/trading-day.test.ts
 *
 * 覆盖（v1.0 按工作日，不含法定节假日——UI 已注明）：
 * - lastTradingDay：工作日返回当天；周六/周日/周一回溯到上周五
 * - lastTradingDayRange：全天边界 [00:00, 23:59:59.999]
 * - tradingSessionRange / lunchReviewRange：09:30–15:00 / 09:30–11:30
 */
import assert from 'node:assert'
import {
  isWeekend,
  lastTradingDay,
  lastTradingDayRange,
  lunchReviewRange,
  tradingSessionRange,
} from '../../src/shared/trading'
import { check, finish } from '../helpers/check'

const d = (y: number, m: number, day: number, h = 12, min = 0): Date => new Date(y, m - 1, day, h, min)

// 参照：2026-09-05 周六、09-06 周日、09-07 周一、09-09 周三
check('周三 isWeekend = false', isWeekend(d(2026, 9, 9)) === false)
check('周六 isWeekend = true', isWeekend(d(2026, 9, 5)) === true)
check('周日 isWeekend = true', isWeekend(d(2026, 9, 6)) === true)

check('周三 → 当天', lastTradingDay(d(2026, 9, 9)).getDate() === 9)
check('周五 → 当天', lastTradingDay(d(2026, 9, 4)).getDate() === 4)
check('周六 → 上周五(9/4)', lastTradingDay(d(2026, 9, 5)).getDate() === 4)
check('周日 → 上周五(9/4)', lastTradingDay(d(2026, 9, 6)).getDate() === 4)
check('周一为交易日 → 当天(9/7)', lastTradingDay(d(2026, 9, 7)).getDate() === 7)
check('周一凌晨 00:30 → 当天(9/7)', lastTradingDay(d(2026, 9, 7, 0, 30)).getDate() === 7)
check('回溯保留年月（9/6 周日 → 2026-09-04）', (() => {
  const r = lastTradingDay(d(2026, 9, 6))
  return r.getFullYear() === 2026 && r.getMonth() === 8 && r.getDate() === 4
})())

const range = lastTradingDayRange(d(2026, 9, 6))
const start = new Date(range.start)
const end = new Date(range.end)
check(
  '周日 → 上周五全天 [00:00, 23:59:59.999]',
  start.getDate() === 4 && start.getHours() === 0 && start.getMinutes() === 0 &&
    end.getDate() === 4 && end.getHours() === 23 && end.getMinutes() === 59,
  `${start.toString()} .. ${end.toString()}`,
)

const session = tradingSessionRange(d(2026, 9, 9))
const sStart = new Date(session.start)
const sEnd = new Date(session.end)
check(
  '交易时段 = 当日 09:30–15:00',
  sStart.getHours() === 9 && sStart.getMinutes() === 30 && sEnd.getHours() === 15 && sEnd.getMinutes() === 0,
)

const lunch = lunchReviewRange(d(2026, 9, 9))
const lStart = new Date(lunch.start)
const lEnd = new Date(lunch.end)
check(
  '午间复盘 = 当日 09:30–11:30',
  lStart.getHours() === 9 && lStart.getMinutes() === 30 && lEnd.getHours() === 11 && lEnd.getMinutes() === 30,
)

finish('交易日历辅助测试完成')
