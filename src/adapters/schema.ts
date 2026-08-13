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
  if (pl.virtual_pagination !== undefined) {
    const virtual = pl.virtual_pagination
    if (!virtual || typeof virtual !== 'object') {
      errs.push('virtual_pagination 必须是对象')
    } else {
      const selectors: Array<[string, unknown]> = [
        ['list_selector', virtual.list_selector],
        ['source_link_selector', virtual.source_link_selector],
        ['native_pagination_selector', virtual.native_pagination_selector],
        ['next_selector', virtual.next_selector],
        ['active_page_selector', virtual.active_page_selector],
      ]
      selectors.forEach(([name, value]) => {
        if (typeof value !== 'string' || !value) {
          errs.push(`virtual_pagination.${name} 必须是非空字符串`)
        }
      })
      if (
        virtual.context_selector !== undefined &&
        (typeof virtual.context_selector !== 'string' || !virtual.context_selector)
      ) {
        errs.push('virtual_pagination.context_selector 必须是非空字符串')
      }
      if (!virtual.post_id || typeof virtual.post_id !== 'object') {
        errs.push('virtual_pagination.post_id 必须是对象')
      } else {
        if (typeof virtual.post_id.selector !== 'string' || !virtual.post_id.selector) {
          errs.push('virtual_pagination.post_id.selector 必须是非空字符串')
        }
        if (typeof virtual.post_id.attr !== 'string' || !virtual.post_id.attr) {
          errs.push('virtual_pagination.post_id.attr 必须是非空字符串')
        }
      }
      if (virtual.first_page !== undefined) {
        if (!virtual.first_page || typeof virtual.first_page !== 'object') {
          errs.push('virtual_pagination.first_page 必须是对象')
        } else {
          if (
            typeof virtual.first_page.input_selector !== 'string' ||
            !virtual.first_page.input_selector
          ) {
            errs.push('virtual_pagination.first_page.input_selector 必须是非空字符串')
          }
          if (typeof virtual.first_page.value !== 'string' || !virtual.first_page.value) {
            errs.push('virtual_pagination.first_page.value 必须是非空字符串')
          }
        }
      }
      if (!Number.isInteger(virtual.page_size) || virtual.page_size < 1) {
        errs.push('virtual_pagination.page_size 必须是正整数')
      }
      if (!Number.isInteger(virtual.max_source_pages) || virtual.max_source_pages < 1) {
        errs.push('virtual_pagination.max_source_pages 必须是正整数')
      }
      if (!Number.isFinite(virtual.wait_ms) || virtual.wait_ms < 0) {
        errs.push('virtual_pagination.wait_ms 必须是非负数')
      }
    }
  }
  return errs
}
