/**
 * 适配包 JSON Schema 校验（手写轻量校验，不引依赖）
 *
 * 校验失败返回错误列表；校验通过返回 null。
 * 适配包是热更新数据，加载前必须校验，避免脏配置进入运行时。
 */
import type { PlatformAdapter, TimestampParserType } from '../shared/types'

const TIMESTAMP_TYPES: TimestampParserType[] = ['absolute', 'relative', 'iso8601', 'custom']
const UNITS = ['second', 'minute', 'hour', 'day', 'week'] as const
const YEAR_INFERENCE_MODES = ['descending-list', 'never'] as const
const VIRTUAL_SOURCE_MODES = ['click', 'url'] as const

/** 非空字符串数组校验（返回错误信息或 null） */
function checkNonEmptyStrings(value: unknown, label: string): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return `${label} 必须是非空字符串数组`
  }
  if (value.some((item) => typeof item !== 'string' || !item)) {
    return `${label} 必须是非空字符串数组`
  }
  return null
}

export function validateAdapter(pkg: unknown): string[] | null {
  const errors: string[] = []
  if (!pkg || typeof pkg !== 'object') {
    return ['适配包必须是对象']
  }
  const p = pkg as Record<string, unknown>

  if (typeof p.version !== 'string' || !p.version) {
    errors.push('缺少 version（字符串）')
  }
  // disabled（可选，P2-19 应急停用）：仅允许布尔
  if (p.disabled !== undefined && typeof p.disabled !== 'boolean') {
    errors.push('disabled 必须是布尔值')
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
  // last_verified（可选，P2-20）：最后真机验证日期，用于设置页能力矩阵
  if (pl.last_verified !== undefined) {
    if (typeof pl.last_verified !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pl.last_verified)) {
      errs.push('last_verified 必须是 YYYY-MM-DD 格式字符串')
    }
  }
  if (!Array.isArray(pl.post_selectors) || pl.post_selectors.length === 0) {
    errs.push('post_selectors 必须是非空数组')
  }
  const ts = pl.timestamp
  if (!ts || typeof ts !== 'object') {
    errs.push('缺少 timestamp')
    return errs
  }
  if (typeof ts.selector === 'string') {
    if (!ts.selector) errs.push('timestamp.selector 必须是非空字符串')
  } else {
    // 多选择器回退链（可选）：同一行存在多种模板变体时按顺序取第一个命中的元素
    const err = checkNonEmptyStrings(ts.selector, 'timestamp.selector')
    if (err) errs.push(err)
  }
  if (!TIMESTAMP_TYPES.includes(ts.type)) {
    errs.push(`timestamp.type 必须是 ${TIMESTAMP_TYPES.join('/')}`)
  }
  // year_inference（可选）：无年份时间的年份推断策略
  if (
    ts.year_inference !== undefined &&
    !YEAR_INFERENCE_MODES.includes(ts.year_inference as (typeof YEAR_INFERENCE_MODES)[number])
  ) {
    errs.push(`timestamp.year_inference 必须是 ${YEAR_INFERENCE_MODES.join('/')}`)
  }
  if (
    (ts.type === 'absolute' || ts.type === 'custom') &&
    (typeof ts.format !== 'string' || !ts.format)
  ) {
    errs.push(`${ts.type} 类型必须提供 timestamp.format`)
  }
  // date_attr（可选）：日期在帖子容器 data-* 属性时的组合模式
  if (ts.date_attr !== undefined && ts.date_attr !== null && typeof ts.date_attr !== 'string') {
    errs.push('timestamp.date_attr 必须是字符串或 null')
  }
  for (const name of ['date_text_selector', 'date_text_scope_selector'] as const) {
    if (ts[name] !== undefined && ts[name] !== null && typeof ts[name] !== 'string') {
      errs.push(`timestamp.${name} 必须是字符串或 null`)
    }
  }
  // strip_pattern（可选）：前置剥离正则，必须合法（非法正则会在运行时抛异常中断过滤）
  if (ts.strip_pattern !== undefined && ts.strip_pattern !== null) {
    if (typeof ts.strip_pattern !== 'string' || !ts.strip_pattern) {
      errs.push('timestamp.strip_pattern 必须是非空字符串')
    } else {
      try {
        new RegExp(ts.strip_pattern)
      } catch {
        errs.push(`timestamp.strip_pattern 不是合法正则: ${ts.strip_pattern}`)
      }
    }
  }
  // extract_pattern（可选）：提取时间子串的正则，必须合法
  if (ts.extract_pattern !== undefined) {
    if (typeof ts.extract_pattern !== 'string' || !ts.extract_pattern) {
      errs.push('timestamp.extract_pattern 必须是非空字符串')
    } else {
      try {
        new RegExp(ts.extract_pattern)
      } catch {
        errs.push(`timestamp.extract_pattern 不是合法正则: ${ts.extract_pattern}`)
      }
    }
    // 跨字段约束：relative 类型下提取会把相对文本替换为绝对样式子串，跳过相对解析，语义矛盾
    if (ts.type === 'relative') {
      errs.push('relative 类型不得声明 timestamp.extract_pattern')
    }
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
  } else {
    pl.quick_presets.forEach((preset, i) => {
      if (!preset || typeof preset.label !== 'string' || !preset.label) {
        errs.push(`quick_presets[${i}].label 必须是非空字符串`)
      }
      if (!preset || typeof preset.value !== 'string' || !preset.value) {
        errs.push(`quick_presets[${i}].value 必须是非空字符串`)
      }
    })
  }
  // active_paths（可选）：pathname 白名单正则，非空字符串数组且必须合法
  if (pl.active_paths !== undefined) {
    if (!Array.isArray(pl.active_paths) || pl.active_paths.length === 0) {
      errs.push('active_paths 必须是非空字符串数组')
    } else {
      pl.active_paths.forEach((pattern, i) => {
        if (typeof pattern !== 'string' || !pattern) {
          errs.push(`active_paths[${i}] 必须是非空字符串`)
          return
        }
        try {
          new RegExp(pattern)
        } catch {
          errs.push(`active_paths[${i}] 不是合法正则`)
        }
      })
    }
  }
  if (pl.feed_context !== undefined) {
    const feed = pl.feed_context
    if (!feed || typeof feed !== 'object') {
      errs.push('feed_context 必须是对象')
    } else {
      if (!Array.isArray(feed.path_patterns) || feed.path_patterns.length === 0) {
        errs.push('feed_context.path_patterns 必须是非空数组')
      } else {
        feed.path_patterns.forEach((pattern, i) => {
          if (typeof pattern !== 'string' || !pattern) {
            errs.push(`feed_context.path_patterns[${i}] 必须是非空字符串`)
            return
          }
          try {
            new RegExp(pattern)
          } catch {
            errs.push(`feed_context.path_patterns[${i}] 不是合法正则`)
          }
        })
      }
      for (const name of ['active_selectors', 'trigger_selectors'] as const) {
        if (!Array.isArray(feed[name]) || feed[name].length === 0 || feed[name].some((v) => typeof v !== 'string' || !v)) {
          errs.push(`feed_context.${name} 必须是非空字符串数组`)
        }
      }
      if (!Number.isFinite(feed.wait_ms) || feed.wait_ms < 0) {
        errs.push('feed_context.wait_ms 必须是非负数')
      }
      if (feed.completeness !== 'loaded-only' && feed.completeness !== 'complete') {
        errs.push('feed_context.completeness 必须是 loaded-only/complete')
      }
      // backfill（可选，P2-17 切片 1）：信息流连续补拉配置
      if (feed.backfill !== undefined) {
        const backfill = feed.backfill
        if (!backfill || typeof backfill !== 'object') {
          errs.push('feed_context.backfill 必须是对象')
        } else {
          if (!Array.isArray(backfill.contexts) || backfill.contexts.length === 0 || backfill.contexts.some((v) => typeof v !== 'string' || !v)) {
            errs.push('feed_context.backfill.contexts 必须是非空字符串数组')
          }
          if (!Number.isFinite(backfill.scroll_delay_ms) || backfill.scroll_delay_ms < 0) {
            errs.push('feed_context.backfill.scroll_delay_ms 必须是非负数')
          }
          if (!Number.isInteger(backfill.max_screens) || backfill.max_screens < 1) {
            errs.push('feed_context.backfill.max_screens 必须是正整数')
          }
          if (!Number.isInteger(backfill.target_hits) || backfill.target_hits < 1) {
            errs.push('feed_context.backfill.target_hits 必须是正整数')
          }
          if (
            backfill.end_stall_count !== undefined &&
            (!Number.isInteger(backfill.end_stall_count) || backfill.end_stall_count < 1)
          ) {
            errs.push('feed_context.backfill.end_stall_count 必须是正整数')
          }
          // load_more_selector（可选，切片 2）：按钮式加载选择器
          if (
            backfill.load_more_selector !== undefined &&
            (typeof backfill.load_more_selector !== 'string' || !backfill.load_more_selector)
          ) {
            errs.push('feed_context.backfill.load_more_selector 必须是非空字符串')
          }
        }
      }
    }
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
      ]
      selectors.forEach(([name, value]) => {
        if (typeof value !== 'string' || !value) {
          errs.push(`virtual_pagination.${name} 必须是非空字符串`)
        }
      })
      // 源页获取方式（可选，缺省 click）：click 需要站内翻页控件，url 需要页码 URL 模板
      const sourceMode = virtual.source_mode ?? 'click'
      if (!VIRTUAL_SOURCE_MODES.includes(sourceMode as (typeof VIRTUAL_SOURCE_MODES)[number])) {
        errs.push(`virtual_pagination.source_mode 必须是 ${VIRTUAL_SOURCE_MODES.join('/')}`)
      }
      if (sourceMode === 'url') {
        if (typeof virtual.page_url_pattern !== 'string' || !virtual.page_url_pattern) {
          errs.push('virtual_pagination.page_url_pattern 必须是非空字符串（url 模式）')
        } else if (!virtual.page_url_pattern.includes('{page}')) {
          errs.push('virtual_pagination.page_url_pattern 必须含 {page} 占位符')
        }
        if (
          virtual.start_page !== undefined &&
          (!Number.isInteger(virtual.start_page) || virtual.start_page < 1)
        ) {
          errs.push('virtual_pagination.start_page 必须是正整数')
        }
        if (virtual.first_page !== undefined) {
          errs.push('virtual_pagination.first_page 仅适用于 click 模式')
        }
        for (const name of ['next_selector', 'active_page_selector'] as const) {
          if (virtual[name] !== undefined) {
            errs.push(`virtual_pagination.${name} 仅适用于 click 模式`)
          }
        }
      } else {
        for (const name of ['next_selector', 'active_page_selector'] as const) {
          const value = virtual[name]
          if (typeof value !== 'string' || !value) {
            errs.push(`virtual_pagination.${name} 必须是非空字符串（click 模式）`)
          }
        }
        for (const name of ['page_url_pattern', 'start_page'] as const) {
          if (virtual[name] !== undefined) {
            errs.push(`virtual_pagination.${name} 仅适用于 url 模式`)
          }
        }
      }
      if (
        virtual.context_selector !== undefined &&
        (typeof virtual.context_selector !== 'string' || !virtual.context_selector)
      ) {
        errs.push('virtual_pagination.context_selector 必须是非空字符串')
      }
      if (
        virtual.context_trigger_selector !== undefined &&
        (typeof virtual.context_trigger_selector !== 'string' || !virtual.context_trigger_selector)
      ) {
        errs.push('virtual_pagination.context_trigger_selector 必须是非空字符串')
      }
      if (
        virtual.empty_selector !== undefined &&
        (typeof virtual.empty_selector !== 'string' || !virtual.empty_selector)
      ) {
        errs.push('virtual_pagination.empty_selector 必须是非空字符串')
      }
      if (
        virtual.context_wait_ms !== undefined &&
        (!Number.isFinite(virtual.context_wait_ms) || virtual.context_wait_ms < 0)
      ) {
        errs.push('virtual_pagination.context_wait_ms 必须是非负数')
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
      for (const key of ['next_delay_min_ms', 'next_delay_max_ms'] as const) {
        const value = virtual[key]
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
          errs.push(`virtual_pagination.${key} 必须是非负数`)
        }
      }
      if (
        virtual.next_delay_min_ms !== undefined &&
        virtual.next_delay_max_ms !== undefined &&
        virtual.next_delay_min_ms > virtual.next_delay_max_ms
      ) {
        errs.push('virtual_pagination.next_delay_min_ms 不能大于 next_delay_max_ms')
      }
    }
  }
  return errs
}
