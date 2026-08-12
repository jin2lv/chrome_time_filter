/**
 * P2-5 适配包热更新测试
 * 运行：npx tsx test/unit/adapters-update.test.ts
 *
 * 覆盖：
 * - compareVersions 语义（0.9.1 < 0.10.0）
 * - updateAdapters：远程新版本→更新；旧版本→跳过；非法格式→丢弃；网络失败→静默降级；开关关闭→跳过
 * - AdapterManager.loadRemoteFromStorage 加载 storage 远程包
 */
import { JSDOM } from 'jsdom'
import { compareVersions } from '../../src/adapters'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://xueqiu.com/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document })

let pass = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    console.log(`  ❌ ${name} ${detail}`)
    process.exitCode = 1
  }
}

// ---------- 1. compareVersions ----------
check('0.9.1 < 0.10.0', compareVersions('0.9.1', '0.10.0') === -1)
check('1.2.3 > 1.2.2', compareVersions('1.2.3', '1.2.2') === 1)
check('相等 = 0', compareVersions('0.1.1', '0.1.1') === 0)
check('短版本补零', compareVersions('0.2', '0.2.0') === 0)
console.log('✓ compareVersions')

// ---------- 2. updateAdapters 流程 ----------
// 构造 chrome mock（覆盖 SW 顶层引用的 API）
const storageMap = new Map<string, unknown>()
const mockFetch = (globalThis as Record<string, unknown>).fetch
const sendMessages: unknown[] = []
const alarmsCreated: unknown[] = []

;(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    // 立即执行回调模拟 onInstalled（安装：注册 alarm + 首拉）
    onInstalled: { addListener: (cb: (d: { reason: string }) => void) => void cb({ reason: 'install' }) },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ content_scripts: [{ js: ['assets/x.js'] }] }),
    getURL: (p: string) => p,
  },
  scripting: {
    getRegisteredContentScripts: async () => [],
    registerContentScripts: async () => {},
  },
  alarms: {
    create: async (name: string, opts: unknown) => { alarmsCreated.push({ name, opts }) },
    onAlarm: { addListener: () => {} },
  },
  commands: { onCommand: { addListener: () => {} } },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return Object.fromEntries(storageMap)
        const ks = Array.isArray(keys) ? keys : [keys as string]
        const out: Record<string, unknown> = {}
        for (const k of ks) if (storageMap.has(k)) out[k] = storageMap.get(k)
        return out
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storageMap.set(k, v)
      },
    },
    onChanged: { addListener: () => {} },
  },
  tabs: {
    query: async () => [{ id: 1, url: 'http://xueqiu.com/' }],
    sendMessage: async (id: number, msg: unknown) => { sendMessages.push(msg) },
    create: async () => {},
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
    setIcon: async () => {},
    setTitle: async () => {},
  },
} as unknown as typeof chrome

// prefs：自动更新开启
storageMap.set('prefs', { autoUpdateAdapters: true, commentNoTime: 'show' })

// 构造远程包（比内置 0.1.x 更新的 0.2.0）
const remotePkg = {
  version: '0.2.0',
  platforms: [
    {
      name: '雪球',
      domains: ['xueqiu.com'],
      post_selectors: ['.timeline__item'],
      timestamp: { selector: 'a.date-and-source', type: 'relative', patterns: [{ regex: '^(\\d+)分钟前', unit: 'minute', multiplier: 1 }] },
      quick_presets: [],
    },
  ],
}

const { updateAdapters } = await import('../../src/background/index')
const { AdapterManager } = await import('../../src/adapters')
const { getRemoteAdapter } = await import('../../src/shared/storage')

// 2a. 远程版本更新 → 更新成功 + 存储写入 + 广播
;(globalThis as Record<string, unknown>).fetch = async () => ({
  ok: true,
  json: async () => remotePkg,
})
let r = await updateAdapters()
check('新版本 → 更新成功', r.updated === true, JSON.stringify(r))
const stored = await getRemoteAdapter()
check('storage 已写入远程包 v0.2.0', stored?.version === '0.2.0', stored?.version ?? 'null')
check('已广播 ADAPTERS_UPDATED', sendMessages.some((m) => (m as { type?: string }).type === 'ADAPTERS_UPDATED'))
const ths = AdapterManager.getAdapter('xueqiu.com')
check('AdapterManager 使用远程包', ths?.name === '雪球' && (ths as unknown as { version?: string }).version === undefined)

// 2b. 旧版本 → 跳过
;(globalThis as Record<string, unknown>).fetch = async () => ({
  ok: true,
  json: async () => ({ ...remotePkg, version: '0.1.0' }),
})
r = await updateAdapters()
check('旧版本 → 不更新', r.updated === false && r.reason === 'no-newer', JSON.stringify(r))

// 2c. 非法格式 → 丢弃
;(globalThis as Record<string, unknown>).fetch = async () => ({
  ok: true,
  json: async () => ({ version: '9.9.9', platforms: [{ name: '坏包' }] }), // 缺 post_selectors/timestamp
})
r = await updateAdapters()
check('非法格式 → 丢弃', r.updated === false && r.reason === 'invalid', JSON.stringify(r))

// 2d. 网络失败 → 静默降级
;(globalThis as Record<string, unknown>).fetch = async () => {
  throw new Error('network down')
}
r = await updateAdapters()
check('网络失败 → 静默降级', r.updated === false && r.reason === 'network', JSON.stringify(r))

// 2e. 开关关闭 → 跳过
storageMap.set('prefs', { autoUpdateAdapters: false, commentNoTime: 'show' })
r = await updateAdapters()
check('开关关闭 → 跳过', r.updated === false && r.reason === 'disabled', JSON.stringify(r))

// 2f. alarm 创建（onInstalled 内）
check('alarm 已注册（12h）', alarmsCreated.length > 0 && (alarmsCreated[0] as { opts: { periodInMinutes: number } }).opts.periodInMinutes === 720)

// 恢复 fetch
;(globalThis as Record<string, unknown>).fetch = mockFetch

console.log(`\n适配包热更新测试完成: ${pass} 项通过`)
