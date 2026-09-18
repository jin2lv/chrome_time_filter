/**
 * Content Script 区间（window）模式 + 前台补扫看门狗测试
 * 运行：npx tsx test/unit/content-interval.test.ts
 *
 * 背景（2026-09-07 真机发现）：区间模式下标签页长时间空闲（Chrome 后台节流/内存回收）
 * 后新注入的帖子未被过滤，重新保存设置后恢复。
 *
 * 覆盖：
 * - 区间模式初始过滤：窗口内保留 / 窗口外隐藏
 * - 变异事件丢失场景：观察器失效时追加的越界节点，通过 visibilitychange 前台补扫恢复过滤
 * - 前台补扫不破坏既有状态（窗口内帖子保持可见、计数正确）
 *
 * 实现说明：以 no-op MutationObserver 模拟「后台变异处理丢失」，帖子只能被
 * visibilitychange 触发的增量补扫（scanExisting）处理。
 */
import dayjs from 'dayjs'
import { check, finish } from '../helpers/check'
import { createMemoryStorage } from '../helpers/chrome-mock'
import { setupDom } from '../helpers/dom-env'

process.on('unhandledRejection', (err: unknown) => {
  console.error('UNHANDLED_REJECTION:', {
    name: (err as Error)?.name,
    message: (err as Error)?.message,
    stack: (err as Error)?.stack,
  })
  process.exit(1)
})

const dom = setupDom('<!doctype html><html><body><div id="feed"></div></body></html>', {
  url: 'http://xueqiu.com:8080/',
  runScripts: 'dangerously',
})
// jsdom 默认 visibilityState='prerender'，与真实 Chrome 不符；覆写为 visible 供看门狗判定
Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

// 关键：替换 MutationObserver 为 no-op，模拟后台标签变异处理丢失
class NoopMutationObserver {
  observe(): void {}
  disconnect(): void {}
  takeRecords(): MutationRecord[] {
    return []
  }
}
;(globalThis as Record<string, unknown>).MutationObserver = NoopMutationObserver

// ---------- chrome mock ----------
const storage = createMemoryStorage()
const storageMap = storage.map
const messageListeners: ((msg: unknown, sender?: unknown, sendResponse?: unknown) => void)[] = []
let lastReportedCount = -1

const chromeMock = {
  runtime: {
    onMessage: { addListener: (fn: typeof messageListeners[number]) => messageListeners.push(fn) },
    sendMessage: async (msg: any) => {
      if (msg?.type === 'FILTER_COUNT_UPDATED') lastReportedCount = msg.count
    },
  },
  storage: {
    onChanged: { addListener: () => {} },
    local: storage.local,
  },
} as unknown as typeof chrome

;(globalThis as Record<string, unknown>).chrome = chromeMock

// ---------- 区间设置：今天 00:00 ~ 23:59 ----------
const dayStart = dayjs().startOf('day').valueOf()
const dayEnd = dayjs().endOf('day').valueOf()
storageMap.set('timeSettings.xueqiu.com', {
  mode: 'window',
  window: { start: dayStart, end: dayEnd },
  strategy: 'hide',
})

// 初始帖子在 import 前就位（等价真实页面：内容先于 content script 存在，init 扫描覆盖）
function makePost(text: string): HTMLElement {
  const el = document.createElement('article')
  el.className = 'timeline__item'
  const a = document.createElement('a')
  a.className = 'date-and-source'
  a.textContent = text
  el.appendChild(a)
  document.getElementById('feed')!.appendChild(el)
  return el
}
const p1 = makePost('30分钟前') // 窗口内（今天）
const p2 = makePost('1天前') // 窗口外（昨天）

// ---------- 加载 content script ----------
await import('../../src/content/index.ts')
await new Promise((r) => setTimeout(r, 150)) // 等 init 完成

function isVisible(el: HTMLElement): boolean {
  return el.style.display !== 'none'
}

// 1. 区间模式初始过滤：窗口内（30分钟前 → 今天）保留，窗口外（1天前 → 昨天）隐藏
console.log('1. 区间模式初始过滤（今天 00:00 ~ 23:59）')
check('窗口内帖子（30分钟前）保留', isVisible(p1))
check('窗口外帖子（1天前）隐藏', !isVisible(p2))
check('计数上报 = 1', lastReportedCount === 1, `got ${lastReportedCount}`)

// 2. 变异事件丢失（no-op observer）：追加越界节点不被处理——复现真机症状
console.log('2. 变异丢失复现：观察器失效时追加节点不被过滤')
const p3 = makePost('1天前')
await new Promise((r) => setTimeout(r, 50))
check('追加的越界节点未被处理（复现丢失）', lastReportedCount === 1, `got ${lastReportedCount}`)

// 3. 前台补扫看门狗：visibilitychange → scanExisting → 越界节点被过滤
console.log('3. visibilitychange 前台补扫恢复过滤')
document.dispatchEvent(new Event('visibilitychange'))
await new Promise((r) => setTimeout(r, 50))
check('补扫后越界节点被隐藏', !isVisible(p3))
check('窗口内帖子仍保留、窗口外仍隐藏', isVisible(p1) && !isVisible(p2))
check('计数上报 = 2', lastReportedCount === 2, `got ${lastReportedCount}`)

// 4. 重复补扫幂等：再次 visibilitychange 不改变状态、计数不重复
console.log('4. 重复补扫幂等')
document.dispatchEvent(new Event('visibilitychange'))
await new Promise((r) => setTimeout(r, 50))
check('状态保持：p1 可见、p2/p3 隐藏', isVisible(p1) && !isVisible(p2) && !isVisible(p3))
check('计数不重复（仍 = 2）', lastReportedCount === 2, `got ${lastReportedCount}`)

finish('区间模式 + 前台补扫测试完成')
