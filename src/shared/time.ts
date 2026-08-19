/**
 * 时间解析工具（P1 完善）
 *
 * 解析策略（PRD F2）：
 * 1. 相对时间（"9分钟前"、"3小时前"、"昨天"、"2天前"）：
 *    时间锚定 —— 以 MutationObserver 首次检测到帖子的时刻（anchor）为锚点反向推算
 * 2. 绝对时间（"2026-08-11 10:30"、"08-11 10:30"）：直接解析
 * 3. 无法解析 → 返回 null（调用方默认显示该帖子 + 计数"无法解析"）
 */
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import type { PlatformAdapter } from './types'

dayjs.extend(customParseFormat)

/** 相对时间解析结果 */
export interface RelativeTimeResult {
  /** 绝对时间（epoch 毫秒） */
  timestamp: number
  /** 是否相对时间（用于 UI 标注"±5 分钟"） */
  isRelative: boolean
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 相对时间单位 → 毫秒 */
const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: MINUTE,
  hour: HOUR,
  day: DAY,
  week: 7 * DAY,
}

/**
 * 从原始文本中提取时间部分：
 * 雪球时间文本形如 "9分钟前· 来自iPhone"（时间在 "·" 前）
 */
export function extractTimePart(raw: string): string {
  return raw.split('·')[0].trim()
}

/** patterns 编译缓存：同一适配包正则复用实例，避免逐帖重复编译 */
const relativePatternCache = new Map<string, RegExp>()

/** 获取（或编译并缓存）相对时间正则 */
function getRelativePattern(regex: string): RegExp {
  let re = relativePatternCache.get(regex)
  if (!re) {
    re = new RegExp(regex)
    relativePatternCache.set(regex, re)
  }
  return re
}

/** 相对时间解析（时间锚定）
 * @param text 原始时间文本（可含 "· 来自xxx" 后缀）
 * @param patterns 适配包相对时间规则
 * @param anchor 锚点时刻（MutationObserver 首次检测到帖子的时刻）
 */
export function parseRelativeTime(
  text: string,
  patterns: NonNullable<PlatformAdapter['timestamp']['patterns']>,
  anchor: number,
): number | null {
  const part = extractTimePart(text)
  for (const pat of patterns) {
    const re = getRelativePattern(pat.regex)
    const m = part.match(re)
    if (!m) continue
    const n = m[1] !== undefined ? parseInt(m[1], 10) : 1
    if (Number.isNaN(n)) continue
    const unitMs = UNIT_MS[pat.unit]
    if (unitMs === undefined) continue
    return anchor - n * pat.multiplier * unitMs
  }
  return null
}

/** 绝对时间多格式兜底解析 */
const ABSOLUTE_FORMATS = [
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DD',
  'MM-DD HH:mm',
  'MMDD HH:mm',
]

/** 无年份格式（MM-DD / MMDD）补当年；若结果晚于当前时刻（跨年帖），年份回退一年 */
function fixMissingYear(d: dayjs.Dayjs): dayjs.Dayjs {
  const now = dayjs()
  const withYear = d.year(now.year())
  if (withYear.isAfter(now)) return d.year(now.year() - 1)
  return withYear
}

/** "今天 HH:mm" / "昨天 HH:mm"（雪球评论时间格式，如 "今天 08:17"、"昨天 16:23"） */
function parseRelativeDayTime(part: string): number | null {
  const m = part.match(/^(今天|昨天)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const [, dayWord, h, min, sec] = m
  const base = dayjs()
    .hour(Number(h))
    .minute(Number(min))
    .second(Number(sec) || 0)
    .millisecond(0)
  return (dayWord === '昨天' ? base.subtract(1, 'day') : base).valueOf()
}

export function parseAbsoluteTime(
  text: string,
  format?: string,
): number | null {
  const part = extractTimePart(text)
  // 相对日期词 + 时刻（今天/昨天 HH:mm）
  const relDay = parseRelativeDayTime(part)
  if (relDay !== null) return relDay
  const formats = format ? [format, ...ABSOLUTE_FORMATS.filter((f) => f !== format)] : ABSOLUTE_FORMATS
  for (const f of formats) {
    const d = dayjs(part, f, true)
    if (!d.isValid()) continue
    // 无年份格式（MM-DD 等）需要补年份
    const hasYear = /[Yy]/.test(f)
    const value = hasYear ? d : fixMissingYear(d)
    return value.valueOf()
  }
  // 纯 ISO（dayjs 原生可解析）
  const iso = dayjs(part)
  if (iso.isValid() && /\d{4}-\d{2}-\d{2}T\d{2}/.test(part)) return iso.valueOf()
  return null
}

/** extract_pattern 编译缓存：避免每个帖子重复编译（同一正则复用实例） */
const extractPatternCache = new Map<string, RegExp>()

/** strip_pattern 编译缓存：同一正则复用实例 */
const stripPatternCache = new Map<string, RegExp>()

/**
 * 应用 strip_pattern 前缀剥离；正则非法时静默跳过（不中断调用链）。
 * @returns 剥离后的文本（剥离失败时返回原文）
 */
function applyStripPattern(raw: string, stripPattern: string | null | undefined): string {
  if (!stripPattern) return raw
  let re = stripPatternCache.get(stripPattern)
  if (!re) {
    try {
      re = new RegExp(stripPattern)
    } catch {
      console.warn('[时光机] strip_pattern 不是合法正则，已跳过:', stripPattern)
      return raw
    }
    stripPatternCache.set(stripPattern, re)
  }
  return raw.replace(re, '').trim()
}

/**
 * 统一入口：先相对后绝对
 * 若适配包声明 extract_pattern，先对原始文本正则提取时间子串
 * （命中取 match[0]，未命中回退原文本），再走解析流程。
 * @returns 绝对时间（epoch ms）或 null
 */
export function parseTimestamp(
  text: string,
  adapter: PlatformAdapter,
  anchor: number,
): RelativeTimeResult | null {
  const ts = adapter.timestamp
  let extractText = text
  if (ts.extract_pattern) {
    let re = extractPatternCache.get(ts.extract_pattern)
    if (!re) {
      re = new RegExp(ts.extract_pattern)
      extractPatternCache.set(ts.extract_pattern, re)
    }
    const m = extractText.match(re)
    if (m) extractText = m[0]
  }
  if (ts.type === 'relative' && ts.patterns) {
    const rel = parseRelativeTime(extractText, ts.patterns, anchor)
    if (rel !== null) return { timestamp: rel, isRelative: true }
  }
  const abs = parseAbsoluteTime(extractText, ts.format)
  if (abs !== null) return { timestamp: abs, isRelative: false }
  return null
}

/**
 * 从帖子容器内提取原始时间文本（支持 date_attr 组合：日期在容器属性、时间在 selector 元素）
 * V2 扩展：支持 strip_pattern 前置正则剥离（如知乎 "编辑于 " 前缀）
 */
export function extractTimestampText(
  el: HTMLElement,
  selector: string,
  attr?: string | null,
  dateAttr?: string | null,
  stripPattern?: string | null,
  dateTextSelector?: string | null,
  dateTextScopeSelector?: string | null,
): string | null {
  const node = el.matches(selector) ? el : el.querySelector(selector)
  if (!node) return null

  // 组合模式：日期来自帖子容器 data-* 属性（如 data-date="0811"），时间来自 selector 文本
  if (dateAttr) {
    const date = el.getAttribute(dateAttr)
    if (date) {
      const time = attr ? node.getAttribute(attr) : (node.textContent ?? '').trim()
      if (time) {
        const raw = `${date} ${time}`.trim()
        return applyStripPattern(raw, stripPattern)
      }
    }
  }

  // 分组日期模式：如雪球 7x24 的日期在 .timeline__live 标题，行内只有 HH:mm。
  if (dateTextSelector) {
    const scope = dateTextScopeSelector ? el.closest(dateTextScopeSelector) : el
    const dateText = scope?.querySelector(dateTextSelector)?.textContent?.trim()
    const timeText = attr ? node.getAttribute(attr) : node.textContent?.trim()
    if (dateText && timeText) {
      const raw = `${dateText} ${timeText}`
      return applyStripPattern(raw, stripPattern)
    }
  }

  let raw: string | null = null
  if (attr) {
    raw = node.getAttribute(attr)
  }
  if (!raw) {
    raw = (node.textContent ?? '').trim()
  }
  if (!raw) return null
  return applyStripPattern(raw, stripPattern)
}

export default dayjs
