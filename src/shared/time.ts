/**
 * 时间解析工具（P1 完善）
 *
 * 解析策略（PRD F2）：
 * 1. 相对时间（"9分钟前"、"3小时前"、"昨天"、"2天前"）：
 *    时间锚定 —— 以 MutationObserver 首次检测到帖子的时刻（anchor）为锚点反向推算
 * 2. 绝对时间（"2026-08-11 10:30"、"08-11 10:30"）：直接解析
 * 3. 无法解析 → 返回 null（调用方默认显示该帖子 + 计数"无法解析"）
 *
 * 无年份时间（`MM-DD HH:mm` / `MMDD HH:mm`）的年份归属见 `inferYearFor`：
 * 适配包可用 `timestamp.year_inference` 选择「序列推断（严格倒序列表）」或
 * 「不推断（默认显示）」；省略时沿用逐帖与当前时刻比较的旧行为。
 */
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import type { PlatformAdapter, YearInferenceMode } from './types'

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

/** 正则编译缓存值：null 表示该 pattern 不合法（避免重复编译与重复告警） */
type RegexCache = Map<string, RegExp | null>

/** 编译并缓存适配包正则；非法正则返回 null（调用方跳过该规则，不中断调用链） */
function compileCached(cache: RegexCache, pattern: string): RegExp | null {
  if (cache.has(pattern)) return cache.get(pattern) ?? null
  try {
    const re = new RegExp(pattern)
    cache.set(pattern, re)
    return re
  } catch {
    console.warn('[时光机] 适配包正则不合法，已跳过:', pattern)
    cache.set(pattern, null)
    return null
  }
}

/** patterns 编译缓存：同一适配包正则复用实例，避免逐帖重复编译 */
const relativePatternCache: RegexCache = new Map()
/** extract_pattern 编译缓存 */
const extractPatternCache: RegexCache = new Map()
/** strip_pattern 编译缓存 */
const stripPatternCache: RegexCache = new Map()

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
    const re = compileCached(relativePatternCache, pat.regex)
    if (!re) continue
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

/* ---- 无年份时间的序列化年份推断（P2-21 前置能力）---- */

/** 首行必须落在近 48h 内，否则该列表视为非活跃/非严格倒序流，整批不可信 */
const FRESH_WINDOW_MS = 48 * 60 * 60 * 1000
/** 首行时刻允许的时钟偏差容差 */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

/** 无年份时间样本：月日压缩值 + 当日分钟数 */
export interface NoYearSample {
  /** 月日压缩值：MM * 100 + DD（8 月 11 日 → 811） */
  monthDay: number
  /** 当日分钟数 HH * 60 + mm */
  minutesOfDay: number
}

/**
 * 序列化年份推断状态（每个扫描会话一份；会话重建时必须重建状态）。
 *
 * 设计动机（`docs/platform-recon.md` §8.1）：`MM-DD HH:mm` 无年份，
 * 逐帖「与当前时刻比较」会把上一年同月日的帖子误判为今年（误杀），
 * 因此改为「首行锚定 + 序列推进」，并在首行不新鲜时整批放弃推断。
 */
export interface YearInferenceState {
  mode: YearInferenceMode
  /** 是否已用首行锚定年份 */
  started: boolean
  /** 整批不可信：后续无年份时间一律返回 null（调用方默认显示 + 计数） */
  disabled: boolean
  /** 当前推断年份 */
  year: number
  /** 上一行的月日压缩值与月份（用于跨年判定） */
  prevMonthDay: number
  prevMonth: number
}

/** 新建年份推断状态；mode 为 'never' 时状态直接置为不可推断 */
export function createYearInferenceState(mode: YearInferenceMode): YearInferenceState {
  return {
    mode,
    started: false,
    disabled: mode === 'never',
    year: 0,
    prevMonthDay: 0,
    prevMonth: 0,
  }
}

/**
 * 解析无年份时间文本（`MM-DD HH:mm[:ss]`、`MMDD HH:mm[:ss]`、纯日期形式）。
 * 不补年份；不匹配返回 null（调用方回退到通用绝对解析）。
 */
export function parseNoYearSample(part: string): NoYearSample | null {
  const m =
    part.match(/^(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/) ??
    part.match(/^(\d{2})(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  const hour = m[3] === undefined ? 0 : Number(m[3])
  const minute = m[4] === undefined ? 0 : Number(m[4])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59) return null
  return { monthDay: month * 100 + day, minutesOfDay: hour * 60 + minute }
}

/** 用指定年份 + 无年份样本合成 epoch ms；日期非法（如 2 月 31 日）返回 null */
function composeTimestamp(year: number, sample: NoYearSample): number | null {
  const month = Math.floor(sample.monthDay / 100)
  const day = sample.monthDay % 100
  const d = new Date(year, month - 1, day, Math.floor(sample.minutesOfDay / 60), sample.minutesOfDay % 60, 0, 0)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return d.valueOf()
}

/**
 * 按「严格发帖时间倒序」假设推断无年份时间的年份。
 *
 * 规则（`docs/platform-recon.md` §8.1）：
 * - 首行锚定：月日 > 今日月日 → 去年，否则今年；首行必须落在近 48h 内，
 *   否则整批置 `disabled` 并返回 null（宁可全部默认显示，也不误杀）。
 * - 序列推进：月日不增 → 沿用当前年份；「上一行 1 月 → 本行 12 月」判定为跨年，
 *   年份 -1；其余月日回跳视为**排序异常行**（置顶区块、财富号混排等），
 *   该行返回 null（默认显示 + 计数）并把游标**重对齐到该行**。
 *
 * 为什么异常行要重对齐游标：实测 guba「全部」列表的真实结构是
 * 「财富号置顶区块（更旧）+ 严格倒序的普通帖区块」，若异常行不推进游标，
 * 游标会卡在置顶区块的低水位，导致其后**所有**正常行都被判为异常
 * （实测覆盖率 6%；重对齐后约 94%）。重对齐只影响异常检测与 1→12 跨年判定，
 * 不改变年份锚定本身；异常行依旧不参与过滤，失败方向仍是「默认显示」。
 *
 * 注意：游标只随「不增」的月日前进，列表整体乱序时（如 guba 基金吧总版按末回复排序）
 * 仍会有大量行落到「不可解析 → 默认显示」——该情形应改用 `year_inference: 'never'`
 * 或省略该字段（旧逐帖补年行为），见适配包 notes。
 *
 * @returns 推断出的年份；null = 该行不可解析（调用方按无法解析处理）
 */
export function inferYearFor(
  state: YearInferenceState,
  sample: NoYearSample,
  now: number = Date.now(),
): number | null {
  if (state.disabled) return null
  const nowDate = new Date(now)
  if (!state.started) {
    state.started = true
    const todayMonthDay = (nowDate.getMonth() + 1) * 100 + nowDate.getDate()
    const year = sample.monthDay > todayMonthDay ? nowDate.getFullYear() - 1 : nowDate.getFullYear()
    const ts = composeTimestamp(year, sample)
    if (ts === null || now - ts > FRESH_WINDOW_MS || ts > now + CLOCK_SKEW_MS) {
      // 首行不新鲜 → 列表可能按回复/热度排序或已停滞，年份不可判定的风险高于收益
      state.disabled = true
      return null
    }
    state.year = year
    state.prevMonthDay = sample.monthDay
    state.prevMonth = Math.floor(sample.monthDay / 100)
    return year
  }

  const month = Math.floor(sample.monthDay / 100)
  if (sample.monthDay <= state.prevMonthDay) {
    state.prevMonthDay = sample.monthDay
    state.prevMonth = month
    return state.year
  }
  if (state.prevMonth === 1 && month === 12) {
    // 跨年：上一行 1 月之后出现 12 月
    state.year -= 1
    state.prevMonthDay = sample.monthDay
    state.prevMonth = month
    return state.year
  }
  // 排序异常行：不推断（默认显示），但重对齐游标以便后续行恢复
  state.prevMonthDay = sample.monthDay
  state.prevMonth = month
  return null
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

/**
 * 应用 strip_pattern 前缀剥离；正则非法时静默跳过（不中断调用链）。
 * @returns 剥离后的文本（剥离失败时返回原文）
 */
function applyStripPattern(raw: string, stripPattern: string | null | undefined): string {
  if (!stripPattern) return raw
  const re = compileCached(stripPatternCache, stripPattern)
  if (!re) return raw
  return raw.replace(re, '').trim()
}

/**
 * 统一入口：先相对后绝对
 * 若适配包声明 extract_pattern，先对原始文本正则提取时间子串
 * （命中取 match[0]，未命中回退原文本），再走解析流程。
 *
 * 适配包声明 `timestamp.year_inference` 时，无年份时间不再走「逐帖与当前时刻
 * 比较」的旧兜底，而是按该策略判定年份；不可推断时返回 null（调用方按无法解析
 * 处理：默认显示 + 计数），绝不猜测。
 *
 * @param yearState 扫描会话共享的年份推断状态（content script 按会话持有并重建）
 * @returns 绝对时间（epoch ms）或 null
 */
export function parseTimestamp(
  text: string,
  adapter: PlatformAdapter,
  anchor: number,
  yearState?: YearInferenceState | null,
): RelativeTimeResult | null {
  const ts = adapter.timestamp
  let extractText = text
  if (ts.extract_pattern) {
    const re = compileCached(extractPatternCache, ts.extract_pattern)
    if (re) {
      const m = extractText.match(re)
      if (m) extractText = m[0]
    }
  }
  if (ts.type === 'relative' && ts.patterns) {
    const rel = parseRelativeTime(extractText, ts.patterns, anchor)
    if (rel !== null) return { timestamp: rel, isRelative: true }
  }
  // 无年份时间：按适配包声明的策略推断年份（未声明则回退旧行为）
  if (ts.year_inference && !/[Yy]/.test(ts.format ?? '')) {
    const sample = parseNoYearSample(extractTimePart(extractText))
    if (sample) {
      const year = yearState ? inferYearFor(yearState, sample) : null
      if (year === null) return null
      const composed = composeTimestamp(year, sample)
      return composed === null ? null : { timestamp: composed, isRelative: false }
    }
  }
  const abs = parseAbsoluteTime(extractText, ts.format)
  if (abs !== null) return { timestamp: abs, isRelative: false }
  return null
}

/**
 * 从帖子容器内提取原始时间文本（支持 date_attr 组合：日期在容器属性、时间在 selector 元素）
 * V2 扩展：支持 strip_pattern 前置正则剥离（如知乎 "编辑于 " 前缀）
 *
 * @param selector 可传多个选择器（按顺序取第一个命中的元素）；用于同一列表内
 *   多种行模板的时间单元格，回退链必须表达同一时间语义（见 PlatformAdapter.timestamp.selector）
 */
export function extractTimestampText(
  el: HTMLElement,
  selector: string | string[],
  attr?: string | null,
  dateAttr?: string | null,
  stripPattern?: string | null,
  dateTextSelector?: string | null,
  dateTextScopeSelector?: string | null,
): string | null {
  const candidates = Array.isArray(selector) ? selector : [selector]
  let node: Element | null = null
  for (const candidate of candidates) {
    if (!candidate) continue
    node = el.matches(candidate) ? el : el.querySelector(candidate)
    if (node) break
  }
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
