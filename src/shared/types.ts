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
  /**
   * 应急停用开关（P2-19，可选）：远程包置 true 时，客户端清空远程包并回退内置包。
   * 仅远程发布源使用；内置包不使用该字段。
   */
  disabled?: boolean
  platforms: PlatformAdapter[]
}

export interface PlatformAdapter {
  name: string
  domains: string[]
  /** 最后真机验证日期（YYYY-MM-DD，可选）：设置页能力矩阵展示，未真机验证则不填 */
  last_verified?: string
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
    /**
     * 先对原始文本做正则提取（命中取 match[0]），再走相对/绝对解析；
     * 未命中回退原文本。用于时间混排在整行文本中的平台（如集思录
     * 「作者 回复 • 2026-08-17 22:05 • 5856 次浏览」）。
     */
    extract_pattern?: string
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
    /**
     * 可选连续补拉（P2-17 切片 1）：用户点击「查找更早的帖子」后按需向下滚动加载，
     * 直到收满目标条数 / 达到屏数上限 / 到达末页 / 用户取消。
     * 仅严格时间排序的类别可声明（contexts 白名单），热度/智能流不得声明。
     */
    backfill?: FeedBackfillConfig
  }
  /** 快捷预设 */
  quick_presets: { label: string; value: string }[]
  /**
   * 页面白名单（pathname 正则）。声明后仅白名单路径启用过滤与失效检测；
   * 其他路径内容脚本静默退出。多页面类型平台必需，避免正文页零匹配误报失效模态。
   */
  active_paths?: string[]
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
    /** 翻页前额外随机等待的下界毫秒数；省略时为 0 */
    next_delay_min_ms?: number
    /** 翻页前额外随机等待的上界毫秒数；省略时为 0 */
    next_delay_max_ms?: number
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
  /** 站点授权被撤销：content script 收到后停止过滤并恢复 DOM（幂等） */
  | { type: 'PERMISSION_REVOKED' }

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

/** 信息流连续补拉配置（P2-17 切片 1）；仅严格时间排序的类别可声明 */
export interface FeedBackfillConfig {
  /** 允许补拉的上下文值（与 currentFeedContext() 精确匹配） */
  contexts: string[]
  /** 每次滚动加载的间隔 ms（风控节流，数据驱动，运行时不强制下限） */
  scroll_delay_ms: number
  /** 单次补拉会话累计滚动屏数上限 */
  max_screens: number
  /** 新收集到多少条符合时间条件的帖子后停止 */
  target_hits: number
  /** 连续多少次滚动无新增内容判定为末页（缺省 2） */
  end_stall_count?: number
  /**
   * 「加载更多」按钮选择器（P2-17 切片 2，可选）
   *
   * 站点在滚动追加若干屏后会切换为按钮式加载（雪球真机实测 2-3 屏后出现）。
   * 声明后：滚动无新增时先尝试点击该按钮继续拉取；未声明则维持原有「无新增即计停滞」语义。
   * 每次按钮拉取同样计入 max_screens 上限（一次用户可见的拉取 = 1 屏）。
   */
  load_more_selector?: string
}

export interface TimeDiagnostic {
  kind: 'post' | 'comment'
  raw: string
  /** 页面 pathname（不含 query） */
  page?: string
  /** 当前类别/上下文 */
  context?: string
}

export interface ScanProgress {
  state: 'idle' | 'loading' | 'exhausted' | 'limit' | 'cancelled' | 'error'
  scannedPages: number
  maxPages: number
  currentSourcePage: string
  /** 计数单位：原生页码扫描为 pages（缺省），信息流滚动补拉为 screens（P2-17 切片 1） */
  unit?: 'pages' | 'screens'
}
