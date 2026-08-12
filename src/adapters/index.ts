/**
 * AdapterManager：按域名匹配适配包（P1 完善，P2-5 支持远程热更新）
 *
 * 职责：
 * - 按域名匹配适配包（先远程热更新包，后内置兜底）
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

/** 内置兜底适配包（随扩展打包，始终可用） */
const BUILTIN_ADAPTERS: Adapter[] = [xueqiuAdapter as unknown as Adapter, thsAdapter as unknown as Adapter]

class AdapterManagerImpl {
  private remoteAdapters: Adapter[] = []

  /** 匹配单个平台适配包：先远程（P2-5 热更新），后内置 */
  getAdapter(domain: string): PlatformAdapter | null {
    for (const pkg of this.allAdapters()) {
      const found = pkg.platforms.find((p) =>
        p.domains.some((d) => domain === d || domain.endsWith('.' + d)),
      )
      if (found) return found
    }
    return null
  }

  /** 是否存在某平台的适配包 */
  hasAdapter(domain: string): boolean {
    return this.getAdapter(domain) !== null
  }

  /** 适配包完整包体（供远程更新对比版本号使用） */
  getPackageFor(domain: string): Adapter | null {
    for (const pkg of this.allAdapters()) {
      if (pkg.platforms.some((p) => p.domains.includes(domain))) return pkg
    }
    return null
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

  private allAdapters(): Adapter[] {
    return [...this.remoteAdapters, ...BUILTIN_ADAPTERS]
  }
}

export const AdapterManager = new AdapterManagerImpl()

/** 供 popup/设置页查看内置版本号 */
export const BUILTIN_VERSIONS: { name: string; version: string }[] = BUILTIN_ADAPTERS.map((p) => ({
  name: p.platforms[0]?.name ?? 'unknown',
  version: p.version,
}))

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
