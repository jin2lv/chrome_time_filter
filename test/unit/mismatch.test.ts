/**
 * 适配包失效检测测试（P1-5）
 * 运行：npx tsx test/unit/mismatch.test.ts
 *
 * 场景：页面加载 5s 内 post_selectors 零匹配 → 判定适配包失效
 * → 不过滤（全部显示）+ 注入提示条
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

process.on('unhandledRejection', (err: unknown) => {
  console.error('UNHANDLED_REJECTION:', (err as Error)?.message)
  process.exit(1)
})

// 空页面（无任何帖子容器，模拟平台改版后选择器失效）
const EMPTY_HTML = '<!doctype html><html><body><div id="root">空页面</div></body></html>'

// 加速：把 setTimeout 缩短为 50ms（失效检测内部是 5000ms）
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
;(globalThis as Record<string, unknown>).setTimeout = (fn: TimerHandler, ms?: number, ...args: unknown[]) =>
  realSetTimeout(fn, ms === 5000 ? 50 : ms, ...args) as unknown as ReturnType<typeof setTimeout>
;(globalThis as Record<string, unknown>).clearTimeout = realClearTimeout

const dom = new JSDOM(EMPTY_HTML, { url: 'http://xueqiu.com:8080/', runScripts: 'outside-only' })
const { window } = dom
Object.assign(globalThis, {
  window,
  document: window.document,
  location: window.location,
  MutationObserver: window.MutationObserver,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
})

const storageMap = new Map<string, unknown>()
storageMap.set('timeSettings.xueqiu.com', {
  mode: 'cutoff',
  cutoff: Date.now() - 2 * 60 * 60 * 1000,
  strategy: 'hide',
})

;(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    onMessage: { addListener: () => {} },
    sendMessage: async () => {},
  },
  storage: {
    onChanged: { addListener: () => {} },
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
  },
} as unknown as typeof chrome

await import('../../src/content/index.ts')
await new Promise((r) => setTimeout(r, 200)) // 等 init + 失效检测触发

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

const banner = document.querySelector('.tm-mismatch-modal')
check('模态浮层已注入', !!banner, '未找到 .tm-mismatch-modal')
check('提示文案正确', banner?.textContent?.includes('时光机需要更新') ?? false, banner?.textContent?.slice(0, 60) ?? '')
check('含刷新按钮', !!banner?.querySelector('button'), '缺少刷新按钮')
// 模态不可关闭：除刷新外无其他 dismiss 入口
check('无关闭入口（不可 dismiss）', !banner?.querySelector('[class*=close]'), '存在关闭按钮')
// 零匹配时无帖子可过滤，页面不应有任何隐藏
check('页面无隐藏元素（不过滤）', document.querySelectorAll('[style*="display: none"]').length === 0)

console.log(`\n失效检测测试完成: ${pass} 项通过`)
