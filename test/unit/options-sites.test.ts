/**
 * 设置页「站点与适配」渲染测试（P2-20 / P2-22 同域多条目归组）
 * 运行：npx tsx test/unit/options-sites.test.ts
 *
 * 覆盖：
 * - 同域多页面类型条目按 origin 归为一行（guba 3 个条目 → 1 行，授权/重置按钮不重复）
 * - 页面类型能力表把各条目的页面类型逐条列出（多条目时带条目名前缀）
 * - 单条目平台仍用平台名作标题、域名作副标题（不回归）
 * - 授权按钮操作该组全部 origin；「授权全部金融站点」按钮存在
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SUPPORTED_SITES } from '../../src/adapters'
import { setupDom } from '../helpers/dom-env'

const html = readFileSync(resolve(import.meta.dirname, '../../src/options/index.html'), 'utf8')
setupDom(html, { url: 'chrome-extension://test/src/options/index.html' })

// guba 的时间设置已记忆（用于验证「每站设置」块只出现一次）
const storage = new Map<string, unknown>([
  ['timeSettings.guba.eastmoney.com', { mode: 'cutoff', cutoff: Date.now() - 3600_000, strategy: 'hide' }],
])
const requested: string[][] = []
const removed: string[][] = []
let grantedOrigins: string[] = []

;(globalThis as Record<string, unknown>).chrome = {
  runtime: { getManifest: () => ({ version: '1.0.0' }) },
  permissions: {
    getAll: async () => ({ origins: grantedOrigins }),
    request: async ({ origins }: { origins: string[] }) => {
      requested.push(origins)
      grantedOrigins = [...new Set([...grantedOrigins, ...origins])]
      return true
    },
    remove: async ({ origins }: { origins: string[] }) => {
      removed.push(origins)
      grantedOrigins = grantedOrigins.filter((o) => !origins.includes(o))
      return true
    },
  },
  storage: {
    local: {
      get: async (key: string) => (storage.has(key) ? { [key]: storage.get(key) } : {}),
      set: async () => {},
      remove: async (key: string) => {
        storage.delete(key)
      },
    },
  },
}

await import('../../src/options/main.ts')
await new Promise((resolve) => setTimeout(resolve, 50))

const rows = [...document.querySelectorAll<HTMLElement>('#site-list .site-row')]
// 注意：renderSites 会整体替换 DOM，取值必须每次重新查询，不能复用旧引用
const rowByName = (name: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('#site-list .site-row')].find(
    (row) => row.querySelector('.site-name')?.textContent === name,
  )

// ---------- 1. 归组：一行一个 origin 集合 ----------
const distinctOrigins = new Set(SUPPORTED_SITES.map((s) => [...s.origins].sort().join('|')))
assert.equal(
  rows.length,
  distinctOrigins.size,
  `站点行数应等于 origin 集合数（${distinctOrigins.size}），实际 ${rows.length}：${rows
    .map((r) => r.querySelector('.site-name')?.textContent)
    .join(' / ')}`,
)
assert.equal(SUPPORTED_SITES.length, 8, '内置平台条目应为 8 条')
assert.equal(rows.length, 6, '归组后应为 6 行（guba 3 条目合并为 1 行）')

const guba = rowByName('guba.eastmoney.com')
assert.ok(guba, 'guba 行应以域名作标题（多条目组）')
assert.match(
  guba!.querySelector('.site-domain')?.textContent ?? '',
  /3 个页面类型条目/,
  `guba 行副标题应标注条目数：${guba!.querySelector('.site-domain')?.textContent}`,
)
assert.equal(
  guba!.querySelectorAll('.site-head button').length,
  1,
  'guba 行只能有一个授权/移除按钮（不得对同一 origin 重复）',
)
assert.equal(
  guba!.querySelectorAll('.reset-btn').length,
  1,
  'guba 行只能有一个「重置此站点设置」按钮（同一份 timeSettings）',
)
assert.match(guba!.querySelector('.site-memory')?.textContent ?? '', /已记忆时间设置/)

// ---------- 2. 页面类型表：多条目逐条列出并带条目名前缀 ----------
const gubaPages = [...guba!.querySelectorAll('.pages-table tbody tr')]
assert.equal(gubaPages.length, 4, `guba 应列出 4 类页面（3 条目的页面行合计），实际 ${gubaPages.length}`)
const gubaPageLabels = gubaPages.map((tr) => tr.querySelector('td')?.textContent ?? '')
assert.ok(
  gubaPageLabels.includes('东方财富股吧·全部与热门 · 列表页') &&
    gubaPageLabels.includes('东方财富股吧·全部与热门 · 帖子详情页') &&
    gubaPageLabels.includes('东方财富股吧·最新发帖 · 列表页') &&
    gubaPageLabels.includes('东方财富基金吧总版 · 列表页'),
  `guba 页面类型标签应带条目名前缀：${JSON.stringify(gubaPageLabels)}`,
)
assert.match(guba!.querySelector('summary')?.textContent ?? '', /页面类型能力（4 类）/)

// ---------- 3. 单条目平台不回归 ----------
const xueqiu = rowByName('雪球')
assert.ok(xueqiu, '雪球行应以平台名作标题')
assert.equal(xueqiu!.querySelector('.site-domain')?.textContent, 'xueqiu.com', '单条目仍展示域名')
assert.equal(xueqiu!.querySelectorAll('.pages-table tbody tr').length, 3, '雪球 3 类页面')
assert.equal(
  xueqiu!.querySelector('.pages-table tbody td')?.textContent,
  '信息流',
  '单条目页面类型不带条目名前缀',
)
const jisilu = rowByName('集思录')
assert.ok(jisilu, '集思录行存在')
assert.match(jisilu!.querySelector('.site-domain')?.textContent ?? '', /jisilu\.cn \/ www\.jisilu\.cn/, '双域名仍完整展示')

// ---------- 4. 授权操作作用于整组 origin ----------
;(guba!.querySelector('.site-head button') as HTMLButtonElement).click()
await new Promise((resolve) => setTimeout(resolve, 50))
assert.equal(requested.length, 1, '点击授权应发起一次请求')
assert.deepEqual(requested[0], ['*://guba.eastmoney.com/*'], `授权应请求该组 origin：${JSON.stringify(requested[0])}`)
const gubaAfter = rowByName('guba.eastmoney.com')
assert.match(gubaAfter!.querySelector('.site-status')?.textContent ?? '', /已授权/, '授权后状态更新')

// 重置按钮清掉该域名的 timeSettings
;(gubaAfter!.querySelector('.reset-btn') as HTMLButtonElement).click()
await new Promise((resolve) => setTimeout(resolve, 50))
assert.equal(storage.has('timeSettings.guba.eastmoney.com'), false, '重置应删除该域名的时间设置')

// ---------- 5. 其他入口仍在 ----------
assert.ok(document.getElementById('grant-all-btn'), '「授权全部金融站点」按钮应存在')
assert.ok(document.getElementById('adapter-list'), '内置适配包版本列表应存在')

console.log('设置页站点归组测试通过')
