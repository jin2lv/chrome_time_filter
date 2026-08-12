/**
 * 共享类型定义（P0 骨架，P1 起逐步使用）
 */

/** 过滤策略：对被过滤帖子的页面呈现方式 */
export type FilterStrategy = 'hide' | 'collapse'

/** 时间模式：v1.0 仅截止模式；窗口模式 v1.2 */
export type TimeMode = 'cutoff' | 'window'

/** 按域名存储的时间设置（全局同步，同域名所有 Tab 共享） */
export interface TimeSettings {
  /** v1.0 仅截止模式 */
  mode: TimeMode
  /** 截止时间（epoch 毫秒），截止模式使用 */
  cutoff: number | null
  /** 窗口模式起止（v1.2 预留） */
  window?: { start: number | null; end: number | null }
  /** 策略：全局默认 hidden，可按域名覆盖 */
  strategy: FilterStrategy
}

/** 时间戳解析类型 */
export type TimestampParserType = 'absolute' | 'relative' | 'iso8601' | 'custom'

/** 相对时间解析规则（"3小时前"、"昨天" 等） */
export interface RelativePattern {
  regex: string
  unit: 'minute' | 'hour' | 'day' | 'week'
  multiplier: number
}

/** 适配包：针对单个平台的 JSON 配置（数据而非代码，可热更新） */
export interface Adapter {
  /** 适配包格式版本 */
  version: string
  platforms: PlatformAdapter[]
}

export interface PlatformAdapter {
  name: string
  domains: string[]
  /** 帖子容器选择器（可多个，按优先级匹配） */
  post_selectors: string[]
  timestamp: {
    selector: string
    type: TimestampParserType
    /** 绝对时间格式（dayjs 格式串），type === 'absolute' 时使用 */
    format?: string
    /** 相对时间规则，type === 'relative' 时使用 */
    patterns?: RelativePattern[]
    /** 备用：从 data 属性提取时间戳 */
    attr?: string | null
    /**
     * 日期属性（可选组合）：同花顺等平台把日期放在帖子容器 data-* 属性
     * （如 data-date="0811"），时间文本在 selector 元素内。组合后按 format 解析。
     */
    date_attr?: string | null
    /**
     * V2：前置正则剥离（如知乎 "编辑于 " 前缀）
     */
    strip_pattern?: string
  }
  /** 详情页评论选择器（评论按自身时间戳独立过滤） */
  comment_selectors?: string[]
  comment_timestamp_selector?: string
  /** 快捷预设 */
  quick_presets: { label: string; value: string }[]
}

/** Popup/Content Script/Background 间消息 */
export type RuntimeMessage =
  | { type: 'TIME_SETTINGS_UPDATED'; domain: string; settings: TimeSettings | null }
  | { type: 'FILTER_COUNT_UPDATED'; count: number; unparseable: number }
  | { type: 'TOGGLE_FILTER' }
  | { type: 'FILTER_STATE_CHANGED'; enabled: boolean }
  | { type: 'QUERY_STATE' }
  | { type: 'ADAPTER_MISMATCH'; platform: string }
  | { type: 'ADAPTERS_UPDATED' }

/** Popup 查询 Content Script 状态的响应 */
export interface ContentState {
  enabled: boolean
  hasSettings: boolean
  hasAdapter: boolean
  filteredCount: number
  unparseableCount: number
}
