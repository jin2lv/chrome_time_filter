/**
 * AdapterManager：按域名匹配适配包（P1 完善，P2-5 支持远程热更新）
 *
 * 职责：
 * - 按域名匹配适配包（远程与内置按版本择新）
 * - 加载前 Schema 校验，脏配置丢弃
 * - 提供 getAdapter(domain) / hasAdapter(domain) / getPackageFor(domain) API
 * - loadRemoteFromStorage：content script 启动时加载 storage 中已更新的远程包
 * - 失效检测辅助（P1-5）：post_selectors 零匹配判定
 */
import type { Adapter, PlatformAdapter } from '../shared/types'
import { getRemoteAdapter } from '../shared/storage'
import { validateAdapter } from './schema'
import xueqiuAdapter from './xueqiu.json'
import thsAdapter from './ths.json'
import jisiluAdapter from './jisilu.json'
import gubaAdapter from './guba.json'
import fundAdapter from './fund.json'
import eastmoneyNewsAdapter from './eastmoney-news.json'

/** 内置兜底适配包（随扩展打包，始终可用） */
const BUILTIN_ADAPTERS: Adapter[] = [
  xueqiuAdapter as unknown as Adapter,
  thsAdapter as unknown as Adapter,
  jisiluAdapter as unknown as Adapter,
  gubaAdapter as unknown as Adapter,
  fundAdapter as unknown as Adapter,
  eastmoneyNewsAdapter as unknown as Adapter,
]

class AdapterManagerImpl {
  private remoteAdapters: Adapter[] = []

  /** 匹配单个平台适配包：同一域名使用版本最高的有效包 */
  getAdapter(domain: string): PlatformAdapter | null {
    return this.matchingPlatforms(domain)[0] ?? null
  }

  /**
   * 按域名 + 页面类型（pathname）匹配平台适配包（P2-21 前置能力）。
   *
   * 同一域名可声明多个页面类型条目（各自用 active_paths 隔离，如
   * `guba.eastmoney.com` 的个股吧与基金吧总版模板不同、时间字段语义不同）。
   * 命中规则：优先返回路径命中的条目；其次返回无路径作用域的兜底条目；
   * 都没有则返回 null（该页面类型不在适配范围，内容脚本应静默退出）。
   */
  getAdapterFor(domain: string, pathname: string): PlatformAdapter | null {
    const candidates = this.matchingPlatforms(domain)
    const hit = candidates.find((platform) => matchesActivePath(platform, pathname))
    if (hit) return hit
    return candidates.find((platform) => !platform.active_paths?.length) ?? null
  }

  /** 是否存在某平台的适配包（域名级：任一页面类型命中即为 true） */
  hasAdapter(domain: string): boolean {
    return this.getAdapter(domain) !== null
  }

  /** 域匹配的全部平台条目（来自版本最高的匹配包） */
  private matchingPlatforms(domain: string): PlatformAdapter[] {
    const pkg = this.getPackageFor(domain)
    if (!pkg) return []
    return pkg.platforms.filter((platform) => domainMatches(platform, domain))
  }

  /** 适配包完整包体（供远程更新对比版本号使用） */
  getPackageFor(domain: string): Adapter | null {
    const matches = [...this.remoteAdapters, ...BUILTIN_ADAPTERS].filter((pkg) =>
      pkg.platforms.some((platform) =>
        platform.domains.some((candidate) => domain === candidate || domain.endsWith('.' + candidate)),
      ),
    )
    return matches.reduce<Adapter | null>((newest, pkg) =>
      !newest || compareVersions(pkg.version, newest.version) > 0 ? pkg : newest
    , null)
  }

  /** (P2-5) 覆盖远程适配包：批量校验，非法条目丢弃 */
  setRemoteAdapters(pkgs: Adapter[]): void {
    const accepted: Adapter[] = []
    for (const pkg of pkgs) {
      const errs = validateAdapter(pkg)
      if (errs) {
        console.warn('[时光机] 远程适配包校验失败，已丢弃:', errs)
      } else {
        accepted.push(pkg)
      }
    }
    this.remoteAdapters = accepted
  }

  /** (P2-5) content script 启动时从 storage 加载已更新的远程适配包 */
  async loadRemoteFromStorage(): Promise<void> {
    const stored = await getRemoteAdapter()
    if (stored) {
      const errs = validateAdapter(stored.package)
      if (!errs) this.remoteAdapters = [stored.package]
    }
  }

}

export const AdapterManager = new AdapterManagerImpl()

/** 域名匹配：等值或子域（`t.10jqka.com.cn` 命中 `10jqka.com.cn` 的条目） */
function domainMatches(platform: PlatformAdapter, domain: string): boolean {
  return platform.domains.some(
    (candidate) => domain === candidate || domain.endsWith('.' + candidate),
  )
}

/**
 * 页面类型白名单判定：平台声明 active_paths 后，仅匹配的 pathname 启用过滤与失效检测。
 * 非法正则视为不匹配（脏配置不得中断运行）。content script 与 AdapterManager 共用。
 */
export function matchesActivePath(platform: PlatformAdapter, pathname: string): boolean {
  if (!platform.active_paths?.length) return false
  return platform.active_paths.some((pattern) => {
    try {
      return new RegExp(pattern).test(pathname)
    } catch {
      return false
    }
  })
}

/** 供 popup/设置页查看内置版本号 */
export const BUILTIN_VERSIONS: { name: string; version: string }[] = BUILTIN_ADAPTERS.map((p) => ({
  name: p.platforms[0]?.name ?? 'unknown',
  version: p.version,
}))

/* ---- P2-20/P2-18：支持站点能力矩阵（设置页「站点与适配」数据源） ---- */

export interface SupportedSite {
  name: string
  /** 需要授权的域名（与适配包 domains 一致；jisilu 含 www 与裸域两条） */
  domains: string[]
  /** 对应的授权 origin（`*://domain/*`） */
  origins: string[]
  version: string
  /** 最后真机验证日期；未真机验证为 null（设置页显示「未真机验证」） */
  lastVerified: string | null
  /** 平台级能力摘要（按适配包实际配置派生，不做无依据承诺） */
  capabilities: string[]
  /** 页面类型级能力矩阵（P2-18：列表/评论/区间/跨页/时间精度/排序完整性） */
  pages: SitePageCapability[]
}

export interface SitePageCapability {
  pageType: string
  /** 该页面类型是否参与评论独立过滤 */
  comment: boolean
  /** 区间模式支持（判定引擎全平台通用） */
  interval: boolean
  /** 跨页能力描述；null = 仅当前已加载内容 */
  crossPage: string | null
  /** 时间精度（相对时间 ±5 分钟 / 绝对时间分钟级） */
  precision: string
  /** 排序完整性（loaded-only / 完整） */
  ordering: string
  /** 已验证页面：v1.0 以平台级 last_verified 粗粒度代替页面级验证记录 */
  verified: boolean
}

/** 按适配包配置派生能力摘要：声明了什么才展示什么 */
function describeCapabilities(p: PlatformAdapter): string[] {
  const caps: string[] = ['帖子过滤']
  if (p.feed_context) caps.push('信息流上下文')
  if (p.feed_context?.backfill) caps.push('信息流补拉')
  if (p.virtual_pagination) caps.push('个股跨页扫描')
  if (p.comment_selectors?.length) caps.push('详情评论过滤')
  if (p.quick_presets?.length) caps.push('快捷预设')
  return caps
}

/** 页面类型级能力：从适配包现有字段推导（feed_context / virtual_pagination / comment_selectors） */
function describePages(p: PlatformAdapter): SitePageCapability[] {
  const pages: SitePageCapability[] = []
  const precision =
    p.timestamp.type === 'relative' ? '相对时间（±5 分钟）' : '绝对时间（分钟级）'
  const verified = Boolean(p.last_verified)
  if (p.feed_context) {
    const backfill = p.feed_context.backfill
    pages.push({
      pageType: '信息流',
      comment: false,
      interval: true,
      crossPage: backfill ? `滚动补拉（上限 ${backfill.max_screens} 屏）` : null,
      precision,
      ordering: p.feed_context.completeness === 'loaded-only' ? '仅已加载内容' : '完整',
      verified,
    })
  }
  if (p.virtual_pagination) {
    pages.push({
      pageType: '个股讨论页',
      comment: false,
      interval: true,
      crossPage: `${p.virtual_pagination.source_mode === 'url' ? 'URL 翻页聚合' : '虚拟分页'}（上限 ${p.virtual_pagination.max_source_pages} 原生页）`,
      precision,
      ordering: '完整',
      verified,
    })
  }
  // 纯列表平台（既无信息流上下文也无跨页扫描）：显式给一行列表能力，
  // 否则设置页能力矩阵会空白，与「已验证页面类型」要求不符
  if (!p.feed_context && !p.virtual_pagination) {
    pages.push({
      pageType: '列表页',
      comment: false,
      interval: true,
      crossPage: null,
      precision,
      ordering: '仅已加载内容',
      verified,
    })
  }
  if (p.comment_selectors?.length) {
    pages.push({
      pageType: '帖子详情页',
      comment: true,
      interval: true,
      crossPage: null,
      precision,
      // 引擎不驱动任何平台的评论分页/加载更多，只过滤 DOM 中已存在的评论：
      // 声明「完整」会暗示已覆盖全部评论（集思录详情页即只渲染最近 99 条），故按已加载口径声明
      ordering: '仅已加载内容',
      verified,
    })
  }
  return pages
}

export const SUPPORTED_SITES: SupportedSite[] = BUILTIN_ADAPTERS.flatMap((pkg) =>
  pkg.platforms.map((platform) => ({
    name: platform.name,
    domains: [...platform.domains],
    origins: platform.domains.map((d) => `*://${d}/*`),
    version: pkg.version,
    lastVerified: platform.last_verified ?? null,
    capabilities: describeCapabilities(platform),
    pages: describePages(platform),
  })),
)

/** 全部支持站点的授权 origin 去重集合（供「授权全部金融站点」一次性申请，绝不自动调用） */
export const SUPPORTED_ORIGINS: string[] = [
  ...new Set(SUPPORTED_SITES.flatMap((s) => s.origins)),
]

/**
 * 轻量 semver 比较：'0.9.1' < '0.10.0'
 * @returns a > b → 1; a < b → -1; 相等 → 0
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}
