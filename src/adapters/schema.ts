/**
 * 适配包 JSON Schema 校验（手写轻量校验，不引依赖）
 *
 * 校验失败返回错误列表；校验通过返回 null。
 * 适配包是热更新数据，加载前必须校验，避免脏配置进入运行时。
 */
import type { PlatformAdapter, TimestampParserType } from '../shared/types'

const TIMESTAMP_TYPES: TimestampParserType[] = ['absolute', 'relative', 'iso8601', 'custom']
const UNITS = ['minute', 'hour', 'day', 'week'] as const

export function validateAdapter(pkg: unknown): string[] | null {
  const errors: string[] = []
  if (!pkg || typeof pkg !== 'object') {
    return ['适配包必须是对象']
  }
  const p = pkg as Record<string, unknown>

  if (typeof p.version !== 'string' || !p.version) {
    errors.push('缺少 version（字符串）')
  }
  if (!Array.isArray(p.platforms) || p.platforms.length === 0) {
    errors.push('platforms 必须是非空数组')
    return errors
  }
  p.platforms.forEach((pl, i) => {
    const errs = validatePlatform(pl as PlatformAdapter)
    errs.forEach((e) => errors.push(`platforms[${i}]: ${e}`))
  })
  return errors.length ? errors : null
}

function validatePlatform(pl: PlatformAdapter): string[] {
  const errs: string[] = []
  if (!pl || typeof pl !== 'object') {
    return ['必须是对象']
  }
  if (typeof pl.name !== 'string' || !pl.name) errs.push('缺少 name')
  if (!Array.isArray(pl.domains) || pl.domains.length === 0) {
    errs.push('domains 必须是非空数组')
  }
  if (!Array.isArray(pl.post_selectors) || pl.post_selectors.length === 0) {
    errs.push('post_selectors 必须是非空数组')
  }
  const ts = pl.timestamp
  if (!ts || typeof ts !== 'object') {
    errs.push('缺少 timestamp')
    return errs
  }
  if (typeof ts.selector !== 'string' || !ts.selector) {
    errs.push('timestamp.selector 必须是非空字符串')
  }
  if (!TIMESTAMP_TYPES.includes(ts.type)) {
    errs.push(`timestamp.type 必须是 ${TIMESTAMP_TYPES.join('/')}`)
  }
  if (ts.type === 'absolute' && (typeof ts.format !== 'string' || !ts.format)) {
    errs.push('absolute 类型必须提供 timestamp.format')
  }
  if (ts.type === 'custom' && (typeof ts.format !== 'string' || !ts.format)) {
    errs.push('custom 类型必须提供 timestamp.format')
  }
  // date_attr（可选）：日期在帖子容器 data-* 属性时的组合模式
  if (ts.date_attr !== undefined && ts.date_attr !== null && typeof ts.date_attr !== 'string') {
    errs.push('timestamp.date_attr 必须是字符串或 null')
  }
  if (ts.type === 'relative') {
    if (!Array.isArray(ts.patterns) || ts.patterns.length === 0) {
      errs.push('relative 类型必须提供 timestamp.patterns')
    } else {
      ts.patterns.forEach((pat, i) => {
        if (!pat || typeof pat.regex !== 'string') {
          errs.push(`patterns[${i}].regex 必须是字符串`)
          return
        }
        try {
          new RegExp(pat.regex)
        } catch {
          errs.push(`patterns[${i}].regex 不是合法正则: ${pat.regex}`)
        }
        if (!UNITS.includes(pat.unit)) {
          errs.push(`patterns[${i}].unit 必须是 ${UNITS.join('/')}`)
        }
        if (typeof pat.multiplier !== 'number') {
          errs.push(`patterns[${i}].multiplier 必须是数字`)
        }
      })
    }
  }
  if (!Array.isArray(pl.quick_presets)) {
    errs.push('quick_presets 必须是数组')
  }
  return errs
}
