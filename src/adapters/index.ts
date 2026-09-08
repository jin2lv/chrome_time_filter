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
import eastmoneyNewsAdapter from './eastmoney-news.json'

/** 内置兜底适配包（随扩展打包，始终可用） */
const BUILTIN_ADAPTERS: Adapter[] = [
  xueqiuAdapter as unknown as Adapter,
  thsAdapter as unknown as Adapter,
  jisiluAdapter as unknown as Adapter,
  eastmoneyNewsAdapter as unknown as Adapter,
]

class AdapterManagerImpl {
  private remoteAdapters: Adapter[] = []

  /** 匹配单个平台适配包：同一域名使用版本最高的有效包 */
  getAdapter(domain: string): PlatformAdapter | null {
    const pkg = this.getPackageFor(domain)
    return pkg?.platforms.find((platform) =>
      platform.domains.some((candidate) => domain === candidate || domain.endsWith('.' + candidate)),
    ) ?? null
  }

  /** 是否存在某平台的适配包 */
  hasAdapter(domain: string): boolean {
    return this.getAdapter(domain) !== null
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
  setRemoteAdapters(pkgs: Adapter[]): { accepted: number; rejected: number } {
    const accepted: Adapter[] = []
    let rejected = 0
    for (const pkg of pkgs) {
      const errs = validateAdapter(pkg)
      if (errs) {
        rejected++
        console.warn('[时光机] 远程适配包校验失败，已丢弃:', errs)
      } else {
        accepted.push(pkg)
      }
    }
    this.remoteAdapters = accepted
    return { accepted: accepted.length, rejected }
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
  if (p.feed_context) {
    const backfill = p.feed_context.backfill
    pages.push({
      pageType: '信息流',
      comment: false,
      interval: true,
      crossPage: backfill ? `滚动补拉（上限 ${backfill.max_screens} 屏）` : null,
      precision,
      ordering: p.feed_context.completeness === 'loaded-only' ? '仅已加载内容' : '完整',
      verified: Boolean(p.last_verified),
    })
  }
  if (p.virtual_pagination) {
    pages.push({
      pageType: '个股讨论页',
      comment: false,
      interval: true,
      crossPage: `虚拟分页（上限 ${p.virtual_pagination.max_source_pages} 原生页）`,
      precision,
      ordering: '完整',
      verified: Boolean(p.last_verified),
    })
  }
  if (p.comment_selectors?.length) {
    pages.push({
      pageType: '帖子详情页',
      comment: true,
      interval: true,
      crossPage: null,
      precision,
      ordering: '完整',
      verified: Boolean(p.last_verified),
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
