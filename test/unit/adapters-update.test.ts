/**
 * P2-5 适配包热更新测试
 * 运行：npx tsx test/unit/adapters-update.test.ts
 *
 * 覆盖：
 * - compareVersions 语义（0.9.1 < 0.10.0）
 * - updateAdapters：远程新版本→更新；旧版本→跳过；非法格式→丢弃；网络失败→静默降级；开关关闭→跳过
 * - AdapterManager.loadRemoteFromStorage 加载 storage 远程包
 */
import { createHash } from 'node:crypto'
import { compareVersions } from '../../src/adapters'
import { check, finish } from '../helpers/check'
import { createMemoryStorage } from '../helpers/chrome-mock'
import { setupDom } from '../helpers/dom-env'

setupDom('<!doctype html><html><body></body></html>', { url: 'http://xueqiu.com/' })

// ---------- 1. compareVersions ----------
check('0.9.1 < 0.10.0', compareVersions('0.9.1', '0.10.0') === -1)
check('1.2.3 > 1.2.2', compareVersions('1.2.3', '1.2.2') === 1)
check('相等 = 0', compareVersions('0.1.1', '0.1.1') === 0)
check('短版本补零', compareVersions('0.2', '0.2.0') === 0)
console.log('✓ compareVersions')

// ---------- 2. updateAdapters 流程 ----------
// 构造 chrome mock（覆盖 SW 顶层引用的 API）
const storage = createMemoryStorage()
const storageMap = storage.map
const mockFetch = (globalThis as Record<string, unknown>).fetch
const sendMessages: unknown[] = []
const alarmsCreated: unknown[] = []
const contentScriptUpdates: Array<{ js?: string[] }> = []
const unregistered: unknown[] = []
// 授权状态集：模拟用户撤销授权后 contains 返回 false
let authorizedOrigins = ['*://xueqiu.com/*']
let removedListener: ((removed: { origins: string[] }) => void) | null = null

;(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    // 立即执行回调模拟 onInstalled（安装：注册 alarm + 首拉）
    onInstalled: { addListener: (cb: (d: { reason: string }) => void) => void cb({ reason: 'install' }) },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ content_scripts: [{ js: ['assets/current-loader.js'] }] }),
    getURL: (p: string) => p,
  },
  scripting: {
    getRegisteredContentScripts: async () => [{
      id: 'tm-main',
      matches: ['*://xueqiu.com/*'],
      js: ['assets/stale-loader.js'],
    }],
    registerContentScripts: async () => {},
    updateContentScripts: async (scripts: Array<{ js?: string[] }>) => {
      contentScriptUpdates.push(...scripts)
    },
    unregisterContentScripts: async (details: unknown) => { unregistered.push(details) },
  },
  permissions: {
    getAll: async () => ({ origins: authorizedOrigins }),
    contains: async ({ origins }: { origins: string[] }) => origins.every((o) => authorizedOrigins.includes(o)),
    onAdded: { addListener: () => {} },
    onRemoved: { addListener: (cb: (removed: { origins: string[] }) => void) => { removedListener = cb } },
  },
  alarms: {
    create: async (name: string, opts: unknown) => { alarmsCreated.push({ name, opts }) },
    onAlarm: { addListener: () => {} },
  },
  commands: { onCommand: { addListener: () => {} } },
  storage: {
    local: storage.local,
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

const { updateAdapters } = await import('../../src/background/service-worker')
const { AdapterManager } = await import('../../src/adapters')
const { getRemoteAdapter, setRemoteAdapter } = await import('../../src/shared/storage')

// 构造远程包（比当前内置雪球版本更高一个小版本；内置版本随功能批次演进，此处动态推导）
const builtinVersion = AdapterManager.getPackageFor('xueqiu.com')?.version ?? '0.0.0'
const bumpMinor = (v: string): string => {
  const [major, minor, patch] = v.split('.').map((n) => parseInt(n, 10))
  return `${major}.${minor + 1}.${patch}`
}
const remoteVersion = bumpMinor(builtinVersion)
const remotePkg = {
  version: remoteVersion,
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

// 2a. 远程版本更新 → 更新成功 + 存储写入 + 广播
// 远程拉取为「两次请求」：adapters.json（正文）+ adapters.json.sha256（完整性校验，P2-19）
const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

/** 构造 URL 感知的 fetch mock：.sha256 请求返回校验和（checksum 为空则返回 404） */
function mockRemote(pkg: unknown, checksum?: string | null): typeof fetch {
  const text = JSON.stringify(pkg)
  return (async (url: string) => {
    if (String(url).endsWith('.sha256')) {
      if (checksum === null) return { ok: false, status: 404, text: async () => '' }
      return { ok: true, text: async () => checksum ?? sha256Hex(text) }
    }
    return { ok: true, text: async () => text }
  }) as unknown as typeof fetch
}

;(globalThis as Record<string, unknown>).fetch = mockRemote(remotePkg)
let r = await updateAdapters()
check('新版本 → 更新成功', r.updated === true, JSON.stringify(r))
const stored = await getRemoteAdapter()
check(`storage 已写入远程包 v${remoteVersion}`, stored?.version === remoteVersion, stored?.version ?? 'null')
check('已广播 ADAPTERS_UPDATED', sendMessages.some((m) => (m as { type?: string }).type === 'ADAPTERS_UPDATED'))
const ths = AdapterManager.getAdapter('xueqiu.com')
check('AdapterManager 使用远程包', ths?.name === '雪球' && (ths as unknown as { version?: string }).version === undefined)

// 2a-2. 扩展升级后，旧远程缓存不得覆盖版本更高的内置适配包
AdapterManager.setRemoteAdapters([{ ...remotePkg, version: '0.1.0' }])
const builtinWins = AdapterManager.getPackageFor('xueqiu.com')
check('旧远程缓存不覆盖新版内置包', builtinWins?.version === builtinVersion, builtinWins?.version ?? 'null')
AdapterManager.setRemoteAdapters([remotePkg])

// 2b. 旧版本 → 跳过
;(globalThis as Record<string, unknown>).fetch = mockRemote({ ...remotePkg, version: '0.1.0' })
r = await updateAdapters()
check('旧版本 → 不更新', r.updated === false && r.reason === 'no-newer', JSON.stringify(r))

// 2c. 非法格式 → 丢弃
;(globalThis as Record<string, unknown>).fetch = mockRemote({
  version: '9.9.9',
  platforms: [{ name: '坏包' }], // 缺 post_selectors/timestamp
})
r = await updateAdapters()
check('非法格式 → 丢弃', r.updated === false && r.reason === 'invalid', JSON.stringify(r))

// 2d. 网络失败 → 静默降级
;(globalThis as Record<string, unknown>).fetch = (async () => {
  throw new Error('network down')
}) as unknown as typeof fetch
r = await updateAdapters()
check('网络失败 → 静默降级', r.updated === false && r.reason === 'network', JSON.stringify(r))

// 2d-2. 完整性校验失败（P2-19）→ 丢弃，不写存储
const versionBefore = (await getRemoteAdapter())?.version ?? 'none'
;(globalThis as Record<string, unknown>).fetch = mockRemote(
  { ...remotePkg, version: bumpMinor(remoteVersion) },
  'name'.repeat(16), // 长度 64 但内容错误的校验和
)
r = await updateAdapters()
check('校验和不符 → 丢弃', r.updated === false && r.reason === 'checksum', JSON.stringify(r))
check(
  '校验和不符 → 存储未被覆盖',
  ((await getRemoteAdapter())?.version ?? 'none') === versionBefore,
)

// 2d-3. 校验和文件缺失（.sha256 404）→ 静默降级
;(globalThis as Record<string, unknown>).fetch = mockRemote(
  { ...remotePkg, version: bumpMinor(remoteVersion) },
  null,
)
r = await updateAdapters()
check('校验和文件缺失 → 静默降级', r.updated === false && r.reason === 'network', JSON.stringify(r))

// 2d-4. 应急停用（P2-19）：远程包 disabled → 清空远程包 + 广播回退内置
sendMessages.length = 0
;(globalThis as Record<string, unknown>).fetch = mockRemote({
  ...remotePkg,
  version: bumpMinor(remoteVersion),
  disabled: true,
})
r = await updateAdapters()
check('disabled 远程包 → 应急停用', r.updated === false && r.reason === 'kill-switch', JSON.stringify(r))
check('应急停用 → 存储中的远程包被清空', (await getRemoteAdapter()) === null)
check(
  '应急停用 → 广播 ADAPTERS_UPDATED 让客户端回退内置',
  sendMessages.some((m) => (m as { type?: string }).type === 'ADAPTERS_UPDATED'),
)
check(
  '应急停用 → AdapterManager 回退内置包',
  AdapterManager.getPackageFor('xueqiu.com')?.version === builtinVersion,
)
// 恢复：重新装载远程包供后续用例
AdapterManager.setRemoteAdapters([remotePkg])
await setRemoteAdapter(remotePkg as never)

// 2e. 开关关闭 → 跳过
storageMap.set('prefs', { autoUpdateAdapters: false, commentNoTime: 'show' })
r = await updateAdapters()
check('开关关闭 → 跳过', r.updated === false && r.reason === 'disabled', JSON.stringify(r))

// 2f. alarm 创建（onInstalled 内）
check('alarm 已注册（12h）', alarmsCreated.length > 0 && (alarmsCreated[0] as { opts: { periodInMinutes: number } }).opts.periodInMinutes === 720)
check(
  '扩展启动时更新动态内容脚本哈希',
  contentScriptUpdates.some((script) => script.js?.[0] === 'assets/current-loader.js'),
  JSON.stringify(contentScriptUpdates),
)

// 2g. 权限撤销（H2）：收敛注册（注销已撤销 origin）+ 向受影响标签页广播停用
check('onRemoved 监听器已注册', removedListener !== null)
authorizedOrigins = []
sendMessages.length = 0
removedListener?.({ origins: ['*://xueqiu.com/*'] })
await new Promise((r) => setTimeout(r, 50))
check(
  '撤销后广播 PERMISSION_REVOKED',
  sendMessages.some((m) => (m as { type?: string })?.type === 'PERMISSION_REVOKED'),
  JSON.stringify(sendMessages),
)
check('撤销后注销已注册的内容脚本', unregistered.length > 0, JSON.stringify(unregistered))

// 恢复 fetch
;(globalThis as Record<string, unknown>).fetch = mockFetch

finish('适配包热更新测试完成')
