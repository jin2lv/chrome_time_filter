/**
 * 金融场景时间辅助（P2-18）
 *
 * 「最近一个交易日」v1.0 按工作日处理：跳过周六/周日，**不含法定节假日**
 * （A 股节假日休市未建模；该限制已在 Popup 预设按钮 title 与产品文案注明，
 * v1.1 接入可维护的交易日历后替换，见 P3-3）。
 */

export interface DayRange {
  start: number
  end: number
}

/** 当日 00:00:00.000 */
export function startOfDay(date: Date): number {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value.getTime()
}

/** 当日 23:59:59.999 */
export function endOfDay(date: Date): number {
  const value = new Date(date)
  value.setHours(23, 59, 59, 999)
  return value.getTime()
}

function atTime(date: Date, hours: number, minutes: number): number {
  const value = new Date(date)
  value.setHours(hours, minutes, 0, 0)
  return value.getTime()
}

/** 周末（周六/周日）；法定节假日不在 v1.0 范围内 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/** 最近一个交易日（含当天）：工作日返回当天，周末向前回溯到最近的工作日 */
export function lastTradingDay(now: Date = new Date()): Date {
  const date = new Date(now)
  while (isWeekend(date)) date.setDate(date.getDate() - 1)
  return date
}

/** 最近一个交易日的全天范围 [00:00, 23:59:59.999] */
export function lastTradingDayRange(now: Date = new Date()): DayRange {
  const date = lastTradingDay(now)
  return { start: startOfDay(date), end: endOfDay(date) }
}

/** 当日交易时段 09:30–15:00（以 dateRef 所在日为准，不校验是否交易日） */
export function tradingSessionRange(dateRef: Date = new Date()): DayRange {
  return { start: atTime(dateRef, 9, 30), end: atTime(dateRef, 15, 0) }
}

/** 午间复盘时段 09:30–11:30（以 dateRef 所在日为准） */
export function lunchReviewRange(dateRef: Date = new Date()): DayRange {
  return { start: atTime(dateRef, 9, 30), end: atTime(dateRef, 11, 30) }
}
