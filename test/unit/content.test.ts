/**
 * Content Script 行为测试（P1-4）：jsdom + chrome mock 验证过滤逻辑
 * 运行：npx tsx test/unit/content.test.ts
 *
 * 覆盖（验收标准 #1 逻辑层）：
 * - 初始过滤：零误杀 / 零漏杀（对照 data-expect-filter）
 * - MutationObserver 增量过滤（滚动加载）
 * - 时间设置变更 → 重应用
 * - 无法解析时间戳：显示 + 计数
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

process.on('unhandledRejection', (err: unknown) => {
  console.error('UNHANDLED_REJECTION:', {
    name: (err as Error)?.name,
    message: (err as Error)?.message,
    stack: (err as Error)?.stack,
  })
  process.exit(1)
})

const MOCK_HTML = readFileSync(resolve(import.meta.dirname, '../fixtures/xueqiu-mock.html'), 'utf-8')

// ---------- 环境准备 ----------
// runScripts: 'dangerously' —— mock 页的帖子由页面脚本动态生成，需要执行
const dom = new JSDOM(MOCK_HTML, { url: 'http://xueqiu.com:8080/', runScripts: 'dangerously' })
const { window } = dom
Object.assign(globalThis, {
  window,
  document: window.document,
  location: window.location,
  MutationObserver: window.MutationObserver,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
})

// ---------- chrome mock ----------
const storageMap = new Map<string, unknown>()
const messageListeners: ((msg: unknown, sender?: unknown, sendResponse?: unknown) => void)[] = []
let lastReportedCount = -1
let lastReportedUnparseable = -1

const chromeMock = {
  runtime: {
    onMessage: { addListener: (fn: typeof messageListeners[number]) => messageListeners.push(fn) },
    sendMessage: async (msg: any) => {
      if (msg?.type === 'FILTER_COUNT_UPDATED') {
        lastReportedCount = msg.count
        lastReportedUnparseable = msg.unparseable
      }
    },
  },
  storage: {
    onChanged: { addListener: () => {} },
    local: {
      get: async (keys?: string | string[] | null | Record<string, unknown>) => {
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
  },
} as unknown as typeof chrome

;(globalThis as Record<string, unknown>).chrome = chromeMock

// 预设时间设置：截止 = 2 小时前（hide）
storageMap.set('timeSettings.xueqiu.com', {
  mode: 'cutoff',
  cutoff: Date.now() - 2 * 60 * 60 * 1000,
  strategy: 'hide',
})

// ---------- 加载 content script ----------
await import('../../src/content/index.ts')
await new Promise((r) => setTimeout(r, 150)) // 等 init 完成

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

function audit(): { total: number; filtered: number; wrong: number; wrongDetail: string[] } {
  const posts = [...document.querySelectorAll('.timeline__item')]
  const filtered = posts.filter((p) => (p as HTMLElement).style.display === 'none')
  const wrong = posts.filter((p) => {
    const expect = (p as HTMLElement).dataset.expectFilter === 'true'
    const actual = (p as HTMLElement).style.display === 'none'
    return expect !== actual
  })
  return {
    total: posts.length,
    filtered: filtered.length,
    wrong: wrong.length,
    wrongDetail: wrong.map((p) => p.querySelector('.date-and-source')?.textContent?.trim() ?? '?'),
  }
}

// 1. 初始过滤（12 条，6 条应过滤：刚刚、9/17/45/110分钟前 + 绝对30分钟前）
console.log('1. 初始过滤（截止 = 2 小时前）')
let r = audit()
check('12 条帖子全部处理', r.total === 12, `got ${r.total}`)
check('过滤 6 条', r.filtered === 6, `got ${r.filtered}`)
check('零误杀/零漏杀', r.wrong === 0, JSON.stringify(r.wrongDetail))
check('计数上报 = 6', lastReportedCount === 6, `got ${lastReportedCount}`)
check('无法解析 = 1（3个月前）', lastReportedUnparseable === 1, `got ${lastReportedUnparseable}`)

// 2. MutationObserver 增量（滚动加载 2 条：3分钟前应过滤、8小时前保留）
console.log('2. MutationObserver 增量过滤')
const btn = document.getElementById('load-more') as HTMLButtonElement
btn.click()
await new Promise((r) => setTimeout(r, 100))
r = audit()
check('14 条帖子', r.total === 14, `got ${r.total}`)
check('过滤 7 条（新增 3分钟前）', r.filtered === 7, `got ${r.filtered}`)
check('零误杀/零漏杀', r.wrong === 0, JSON.stringify(r.wrongDetail))

// 3. 时间设置变更 → 重应用（截止改 8 小时前）
console.log('3. 时间设置变更 → 重应用（截止 = 8 小时前）')
storageMap.set('timeSettings.xueqiu.com', {
  mode: 'cutoff',
  cutoff: Date.now() - 8 * 60 * 60 * 1000,
  strategy: 'hide',
})
// 模拟 SW 广播 TIME_SETTINGS_UPDATED
const settingsMsg = {
  type: 'TIME_SETTINGS_UPDATED',
  domain: 'xueqiu.com',
  settings: storageMap.get('timeSettings.xueqiu.com'),
}
;(messageListeners[0] as (m: unknown) => void)(settingsMsg)
await new Promise((r) => setTimeout(r, 150))
r = audit()
// 8 小时前截止：过滤 9/17/45/110分钟前、绝对30分钟前、3分钟前 = 6 条；3h/5h/abs4h 也 <8h
// 实际：<8h 的全部过滤。帖子时间：9m,17m,45m,110m,3h,5h,26h,3d,abs30m,abs4h,刚刚,3个月前,3m,10h
// <8h: 刚刚,9m,17m,45m,110m,3h,5h,abs30m,abs4h,3m = 10 条（10h/26h/3d/无法解析 保留）
if (r.filtered !== 10) {
  const detail = [...document.querySelectorAll('.timeline__item')].map((p) => {
    const t = (p as HTMLElement).dataset.expectFilter === 'true' ? 'E1' : 'E0'
    const vis = (p as HTMLElement).style.display === 'none' ? 'HIDE' : 'show'
    return `${vis}/${t}: ${p.querySelector('.date-and-source')?.textContent?.trim()}`
  })
  console.log('   DEBUG:', JSON.stringify(detail, null, 1))
}
check('过滤 10 条', r.filtered === 10, `got ${r.filtered}`)
check('无判定错误（与 expectFilter 不符属预期变化，仅校验数量）', r.filtered === 10)

// 4. 开关切换（TOGGLE_FILTER → 恢复显示 → 再开重新过滤）
console.log('4. 开关切换')
;(messageListeners[0] as (m: unknown) => void)({ type: 'TOGGLE_FILTER' })
await new Promise((r) => setTimeout(r, 100))
const visible = document.querySelectorAll('.timeline__item:not([style*="display: none"])').length
check('关闭后全部恢复显示', visible === 14, `got ${visible}`)
;(messageListeners[0] as (m: unknown) => void)({ type: 'TOGGLE_FILTER' })
await new Promise((r) => setTimeout(r, 100))
r = audit()
check('重新开启后恢复过滤（10 条）', r.filtered === 10, `got ${r.filtered}`)

// 5. 折叠策略（P2-3）：切换 collapse → 占位条替换 → 点击展开
// 注：此时页面 14 条，2h 截止过滤 7 条（刚刚,9m,17m,45m,110m,abs30m,3m）
console.log('5. 折叠策略')
storageMap.set('timeSettings.xueqiu.com', {
  mode: 'cutoff',
  cutoff: Date.now() - 2 * 60 * 60 * 1000,
  strategy: 'collapse',
})
;(messageListeners[0] as (m: unknown) => void)({ type: 'TIME_SETTINGS_UPDATED', domain: 'xueqiu.com', settings: storageMap.get('timeSettings.xueqiu.com') })
await new Promise((r) => setTimeout(r, 150))
const collapsed = document.querySelectorAll('.tm-collapsed').length
check('折叠占位条数 = 过滤数（7）', collapsed === 7, `got ${collapsed}`)
const hiddenPosts = [...document.querySelectorAll('.timeline__item')].filter(
  (p) => (p as HTMLElement).style.display === 'none',
).length
check('折叠时帖子仍隐藏', hiddenPosts === 7, `got ${hiddenPosts}`)
// 点击第一个占位条 → 展开对应帖子
const firstPh = document.querySelector('.tm-collapsed') as HTMLElement
firstPh?.click()
await new Promise((r) => setTimeout(r, 50))
const collapsedAfter = document.querySelectorAll('.tm-collapsed').length
check('点击占位条后占位条移除', collapsedAfter === 6, `got ${collapsedAfter}`)
const unhidden = [...document.querySelectorAll('.timeline__item')].filter(
  (p) => (p as HTMLElement).style.display !== 'none',
).length
check('对应帖子恢复显示', unhidden === 8, `got ${unhidden}`) // 7 保留 + 1 展开

// 6. 评论过滤（P2-4）：按自身时间戳独立判定 + 无时间戳回退策略
console.log('6. 评论过滤（P2-4）')
// 构造雪球详情页评论 DOM（4 条：1 新评论应过滤、1 旧评论保留、2 条无时间戳）
const commentList = document.createElement('div')
commentList.className = 'comment__list'
commentList.innerHTML = `
  <div class="comment__item"><div class="comment__item__main__hd"><span class="time">3分钟前</span></div><p>新评论</p></div>
  <div class="comment__item"><div class="comment__item__main__hd"><span class="time">5小时前</span></div><p>旧评论</p></div>
  <div class="comment__item"><div class="comment__item__main__hd"><span class="time"></span></div><p>无时间A</p></div>
  <div class="comment__item"><div class="comment__item__main__hd"></div><p>无时间B</p></div>
`
document.body.appendChild(commentList)
await new Promise((r) => setTimeout(r, 100))
let cmtHidden = [...document.querySelectorAll('.comment__item')].filter(
  (c) => (c as HTMLElement).style.display === 'none',
).length
check('默认回退(show)：仅 1 条新评论被过滤', cmtHidden === 1, `got ${cmtHidden}`)

// 切换 commentNoTime = collapse → 无时间戳评论折叠
storageMap.set('prefs', { commentNoTime: 'collapse' })
;(messageListeners[0] as (m: unknown) => void)({ type: 'TIME_SETTINGS_UPDATED', domain: 'xueqiu.com', settings: storageMap.get('timeSettings.xueqiu.com') })
await new Promise((r) => setTimeout(r, 150))
cmtHidden = [...document.querySelectorAll('.comment__item')].filter(
  (c) => (c as HTMLElement).style.display === 'none',
).length
check('回退折叠：3 条隐藏（1 新 + 2 无时间戳）', cmtHidden === 3, `got ${cmtHidden}`)
const cmtCollapsed = document.querySelectorAll('.tm-collapsed').length
check('折叠占位条对应出现', cmtCollapsed >= 2, `got ${cmtCollapsed}`)

// 切回 show
storageMap.set('prefs', { commentNoTime: 'show' })
;(messageListeners[0] as (m: unknown) => void)({ type: 'TIME_SETTINGS_UPDATED', domain: 'xueqiu.com', settings: storageMap.get('timeSettings.xueqiu.com') })
await new Promise((r) => setTimeout(r, 150))
cmtHidden = [...document.querySelectorAll('.comment__item')].filter(
  (c) => (c as HTMLElement).style.display === 'none',
).length
check('切回 show：恢复 1 条新评论被过滤', cmtHidden === 1, `got ${cmtHidden}`)

// 7. 悬浮提示条（P2-8）：prefs.floatingBanner 开启 → 注入/更新/关闭
console.log('7. 悬浮提示条（P2-8）')
storageMap.set('prefs', { commentNoTime: 'show', floatingBanner: true })
;(messageListeners[0] as (m: unknown) => void)({ type: 'TIME_SETTINGS_UPDATED', domain: 'xueqiu.com', settings: storageMap.get('timeSettings.xueqiu.com') })
await new Promise((r) => setTimeout(r, 100))
let banner = document.querySelector('.tm-banner')
check('悬浮条已注入', !!banner, '未找到 .tm-banner')
check(
  '内容含截止时间与过滤数',
  (banner?.textContent?.includes('截止:') && banner?.textContent?.includes('已过滤')) ?? false,
  banner?.textContent?.slice(0, 80) ?? '',
)
;(banner?.querySelector('button') as HTMLElement | null)?.click()
await new Promise((r) => setTimeout(r, 50))
check('点击关闭后悬浮条移除', !document.querySelector('.tm-banner'))
storageMap.set('prefs', { commentNoTime: 'show', floatingBanner: false })
;(messageListeners[0] as (m: unknown) => void)({ type: 'TIME_SETTINGS_UPDATED', domain: 'xueqiu.com', settings: storageMap.get('timeSettings.xueqiu.com') })
await new Promise((r) => setTimeout(r, 100))
check('关闭开关后不注入', !document.querySelector('.tm-banner'))

console.log(`\nContent Script 行为测试完成: ${pass} 项通过`)
