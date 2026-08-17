/**
 * 共享类型定义（P0 骨架，P1 起逐步使用）
 */

/** 过滤策略：对被过滤帖子的页面呈现方式 */
export type FilterStrategy = 'hide' | 'collapse'

/** 时间模式：截止时间或闭区间 */
export type TimeMode = 'cutoff' | 'window'

/** 按域名存储的时间设置（全局同步，同域名所有 Tab 共享） */
export interface TimeSettings {
  mode: TimeMode
  /** 截止时间（epoch 毫秒），截止模式使用 */
  cutoff: number | null
  /** 窗口模式起止，保留 start <= timestamp <= end */
  window?: { start: number | null; end: number | null }
  /** 策略：全局默认 hidden，可按域名覆盖 */
  strategy: FilterStrategy
}

/** 时间戳解析类型 */
export type TimestampParserType = 'absolute' | 'relative' | 'iso8601' | 'custom'

/** 相对时间解析规则（"3小时前"、"昨天" 等） */
export interface RelativePattern {
  regex: string
  unit: 'second' | 'minute' | 'hour' | 'day' | 'week'
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
    /** 日期文本位于帖子所在分组中（如雪球 7x24 的“今天”分组标题） */
    date_text_selector?: string | null
    /** 从帖子向上定位日期分组；省略时仅在帖子内部查找 date_text_selector */
    date_text_scope_selector?: string | null
    /**
     * V2：前置正则剥离（如知乎 "编辑于 " 前缀）
     */
    strip_pattern?: string
  }
  /** 详情页评论选择器（评论按自身时间戳独立过滤） */
  comment_selectors?: string[]
  comment_timestamp_selector?: string
  /** 信息流类别上下文；活动类别变化时重置缓存、计数与异步任务 */
  feed_context?: {
    /** 仅在匹配的 pathname 上启用，使用正则字符串 */
    path_patterns: string[]
    /** 每一层活动标签选择器，按一级、二级依次声明 */
    active_selectors: string[]
    /** 可触发上下文切换的标签，用于捕获点击后页面异步替换 */
    trigger_selectors: string[]
    /** 类别 DOM 稳定后再重新绑定的等待时间 */
    wait_ms: number
    /** 智能/热度流无法保证找全时间范围时必须明确标注 */
    completeness: 'loaded-only' | 'complete'
  }
  /** 快捷预设 */
  quick_presets: { label: string; value: string }[]
  /** 可选虚拟分页：跨原生页面按需聚合符合时间条件的帖子 */
  virtual_pagination?: {
    list_selector: string
    post_id: {
      selector: string
      attr: string
    }
    source_link_selector: string
    /** 列表类别/作用域的当前值；变化时重建虚拟分页会话 */
    context_selector?: string
    /** 可触发列表类别切换的控件；捕获点击时立即停止旧扫描会话 */
    context_trigger_selector?: string
    /** 类别切换后等待站点替换列表 DOM 的时间；省略时复用 wait_ms */
    context_wait_ms?: number
    /** 站点明确表示当前类别无内容时的元素；命中后保留站点原生空状态 */
    empty_selector?: string
    native_pagination_selector: string
    next_selector: string
    active_page_selector: string
    first_page?: {
      input_selector: string
      value: string
    }
    page_size: number
    max_source_pages: number
    wait_ms: number
  }
}

/** Popup/Content Script/Background 间消息 */
export type RuntimeMessage =
  | { type: 'TIME_SETTINGS_UPDATED'; domain: string; settings: TimeSettings | null }
  | {
      type: 'FILTER_COUNT_UPDATED'
      count: number
      unparseable: number
      context?: string
      completeness?: ContentCompleteness
    }
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
  context?: string
  completeness?: ContentCompleteness
  diagnostics: TimeDiagnostic[]
  scan?: ScanProgress
}

export type ContentCompleteness = 'complete' | 'loaded-only' | 'scanning' | 'exhausted' | 'error'

export interface TimeDiagnostic {
  kind: 'post' | 'comment'
  raw: string
}

export interface ScanProgress {
  state: 'idle' | 'loading' | 'exhausted' | 'limit' | 'cancelled' | 'error'
  scannedPages: number
  maxPages: number
  currentSourcePage: string
}
