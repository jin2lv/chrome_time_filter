/**
 * Content Script 无年份时间过滤测试（P2-21 前置能力的接线验证）
 * 运行：npx tsx test/unit/content-year-inference.test.ts
 *
 * 覆盖：
 * - 适配包声明 year_inference 后，content script 为帖子/评论各自维护序列状态
 * - 序列推断失败（首行不新鲜 / 排序异常）时帖子默认显示 + 计入「无法解析」，绝不误杀
 * - 重扫（时间设置变更）会重建年份状态：从新的首行重新锚定，不复用旧游标
 */
import { check, finish } from '../helpers/check'
import { createMemoryStorage } from '../helpers/chrome-mock'
import { setupDom } from '../helpers/dom-env'
import { AdapterManager } from '../../src/adapters'
import type { Adapter } from '../../src/shared/types'

process.on('unhandledRejection', (err: unknown) => {
  console.error('UNHANDLED_REJECTION:', (err as Error)?.message)
  process.exit(1)
})

const DOMAIN = 'mmdd.example.com'

/** 相对当前时刻生成 MM-DD HH:mm 文本（该平台只有无年份时间） */
function mmdd(msAgo: number): string {
  const d = new Date(Date.now() - msAgo)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const HOUR = 60 * 60 * 1000

/** 页面骨架：帖子行由用例按场景重写（row1 为列表首行） */
function pageHtml(rows: string[]): string {
  return `<!doctype html><html><body><ul class="list">${rows
    .map((text, i) => `<li class="post"><a class="t" data-id="${i}">${text}</a></li>`)
    .join('')}</ul></body></html>`
}

const ROWS_MIXED = [mmdd(30 * HOUR), mmdd(2 * HOUR), mmdd(40 * HOUR)]
const ROWS_STALE = [mmdd(72 * HOUR), mmdd(80 * HOUR)]
const ROWS_FRESH = [mmdd(1 * HOUR), mmdd(2 * HOUR), mmdd(3 * HOUR)]

setupDom(pageHtml(ROWS_MIXED), { url: `https://${DOMAIN}/list` })

// ---------- 适配包（远程注入，避免改动内置包） ----------
const pkg: Adapter = {
  version: '9.9.9',
  platforms: [
    {
      name: '无年份时间测试平台',
      domains: [DOMAIN],
      active_paths: ['^/list$'],
      post_selectors: ['li.post'],
      timestamp: { selector: '.t', type: 'absolute', format: 'MM-DD HH:mm', year_inference: 'descending-list' },
      quick_presets: [],
    },
  ],
}
AdapterManager.setRemoteAdapters([pkg])

// ---------- chrome mock ----------
const storage = createMemoryStorage()
const storageMap = storage.map
const listeners: Array<(msg: unknown) => void> = []
let lastCount = -1
let lastUnparseable = -1
;(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    onMessage: { addListener: (fn: (msg: unknown) => void) => listeners.push(fn) },
    sendMessage: async (msg: { type?: string; count?: number; unparseable?: number }) => {
      if (msg?.type === 'FILTER_COUNT_UPDATED') {
        lastCount = msg.count ?? 0
        lastUnparseable = msg.unparseable ?? 0
      }
    },
  },
  storage: { onChanged: { addListener: () => {} }, local: storage.local },
} as unknown as typeof chrome

// 截止 = 5 小时前：仅「2 小时前」那条新于截止，其余都应保留
function setCutoff(msAgo: number): void {
  storageMap.set(`timeSettings.${DOMAIN}`, { mode: 'cutoff', cutoff: Date.now() - msAgo, strategy: 'hide' })
}
setCutoff(5 * HOUR)

await import('../../src/content/index.ts')
await new Promise((r) => setTimeout(r, 150))

const hidden = (): number =>
  [...document.querySelectorAll('li.post')].filter((el) => (el as HTMLElement).style.display === 'none').length

// ---------- 1. 排序异常行：不可解析而非误杀 ----------
check('混排行序：没有任何帖子被隐藏（不误杀）', hidden() === 0, `hidden=${hidden()}`)
check('混排行序：新于截止的回跳行计入无法解析', lastUnparseable === 1, `unparseable=${lastUnparseable}`)
check('混排行序：过滤计数为 0', lastCount === 0, `count=${lastCount}`)

// ---------- 2. 首行不新鲜 → 整批放弃推断 ----------
document.querySelector('.list')!.innerHTML = ROWS_STALE.map(
  (text, i) => `<li class="post"><a class="t" data-id="${i}">${text}</a></li>`,
).join('')
;(listeners[0] as (m: unknown) => void)({ type: 'TIME_SETTINGS_UPDATED', domain: DOMAIN, settings: storageMap.get(`timeSettings.${DOMAIN}`) })
await new Promise((r) => setTimeout(r, 150))
check('首行超出 48h：全部帖子默认显示', hidden() === 0, `hidden=${hidden()}`)
check('首行超出 48h：全部计入无法解析', lastUnparseable === ROWS_STALE.length, `unparseable=${lastUnparseable}`)

// ---------- 3. 重扫重建状态：严格倒序 + 新鲜首行 → 正常过滤 ----------
document.querySelector('.list')!.innerHTML = ROWS_FRESH.map(
  (text, i) => `<li class="post"><a class="t" data-id="${i}">${text}</a></li>`,
).join('')
;(listeners[0] as (m: unknown) => void)({ type: 'TIME_SETTINGS_UPDATED', domain: DOMAIN, settings: storageMap.get(`timeSettings.${DOMAIN}`) })
await new Promise((r) => setTimeout(r, 150))
check('重扫后年份状态重建：新于截止的 3 条被过滤', hidden() === 3, `hidden=${hidden()}`)
check('重扫后无无法解析项', lastUnparseable === 0, `unparseable=${lastUnparseable}`)

// ---------- 4. 关闭过滤 → 全部恢复 ----------
;(listeners[0] as (m: unknown) => void)({ type: 'TOGGLE_FILTER' })
await new Promise((r) => setTimeout(r, 100))
check('关闭后全部恢复显示', hidden() === 0, `hidden=${hidden()}`)

finish('Content Script 无年份时间过滤测试完成')
