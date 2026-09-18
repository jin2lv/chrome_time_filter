/**
 * 内存版 chrome.storage.local（测试共用）。
 * 其余 API 面（runtime/tabs/permissions/action 等）由各用例按需装配。
 */
export interface MemoryStorage {
  /** 底层 Map：用例可直接读写（等价于真实 storage 的持久容器） */
  readonly map: Map<string, unknown>
  readonly local: {
    get(keys?: string | string[] | null | Record<string, unknown>): Promise<Record<string, unknown>>
    set(items: Record<string, unknown>): Promise<void>
    remove(keys: string | string[]): Promise<void>
  }
}

export function createMemoryStorage(
  initial?: Iterable<readonly [string, unknown]>,
): MemoryStorage {
  const map = new Map<string, unknown>(initial)
  return {
    map,
    local: {
      async get(keys) {
        if (keys === null || keys === undefined) return Object.fromEntries(map)
        if (typeof keys === 'object' && !Array.isArray(keys)) {
          const out: Record<string, unknown> = {}
          for (const [k, fallback] of Object.entries(keys)) {
            out[k] = map.has(k) ? map.get(k) : fallback
          }
          return out
        }
        const ks = Array.isArray(keys) ? keys : [keys]
        const out: Record<string, unknown> = {}
        for (const k of ks) if (map.has(k)) out[k] = map.get(k)
        return out
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) map.set(k, v)
      },
      async remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k)
      },
    },
  }
}
