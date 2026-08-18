import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const html = readFileSync(resolve(import.meta.dirname, '../../src/popup/index.html'), 'utf8')
const dom = new JSDOM(html, { url: 'chrome-extension://test/src/popup/index.html' })

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
})

const stored: Record<string, unknown> = {}
let registrationUpdates = 0
;(globalThis as Record<string, unknown>).chrome = {
  tabs: {
    query: async () => [{ id: 7, url: 'https://xueqiu.com/' }],
    sendMessage: async () => ({
      enabled: true,
      hasSettings: true,
      hasAdapter: true,
      filteredCount: 0,
      unparseableCount: 0,
      diagnostics: [],
    }),
  },
  runtime: {
    getManifest: () => ({
      content_scripts: [{ js: ['assets/content-loader.js'] }],
      optional_host_permissions: ['*://xueqiu.com/*'],
    }),
    openOptionsPage: async () => {},
  },
  scripting: {
    getRegisteredContentScripts: async () => [{ id: 'tm-main', matches: ['*://xueqiu.com/*'] }],
    updateContentScripts: async () => { registrationUpdates++ },
    registerContentScripts: async () => {},
    executeScript: async () => {},
  },
  permissions: {
    contains: async () => true,
    request: async () => true,
  },
  storage: {
    local: {
      get: async (key: string) => key in stored ? { [key]: stored[key] } : {},
      set: async (items: Record<string, unknown>) => Object.assign(stored, items),
    },
  },
}

await import('../../src/popup/main.ts')
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(registrationUpdates, 1, 'Popup 应在已有内容脚本响应时仍同步最新注册配置')

const windowMode = document.querySelector<HTMLInputElement>('input[name="time-mode"][value="window"]')!
const start = document.getElementById('window-start-input') as HTMLInputElement
const end = document.getElementById('window-end-input') as HTMLInputElement
const error = document.getElementById('time-error') as HTMLParagraphElement

windowMode.click()
start.value = '2026-08-13T09:30'
end.value = '2026-08-13T15:00'
end.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 0))

const valid = stored['timeSettings.xueqiu.com'] as {
  mode: string
  cutoff: null
  window: { start: number; end: number }
}
assert.equal(valid.mode, 'window')
assert.equal(valid.cutoff, null)
assert.equal(valid.window.start, new Date('2026-08-13T09:30').getTime())
assert.equal(valid.window.end, new Date('2026-08-13T15:00').getTime())
assert.equal(error.hidden, true)

start.value = '2026-08-13T16:00'
start.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(error.hidden, false)
assert.match(error.textContent ?? '', /开始时间不能晚于结束时间/)
assert.equal(
  (stored['timeSettings.xueqiu.com'] as typeof valid).window.start,
  new Date('2026-08-13T09:30').getTime(),
  '非法区间不得覆盖上一次有效设置',
)

console.log('Popup 起止时间模式测试通过')
