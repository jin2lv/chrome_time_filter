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
})

let authorized = false
let requestCount = 0
let registerCount = 0
let executeCount = 0
let optionsPageOpens = 0

;(globalThis as Record<string, unknown>).chrome = {
  tabs: {
    query: async () => [{ id: 7, url: 'https://xueqiu.com/S/SZ300142' }],
    sendMessage: async () => null,
  },
  runtime: {
    getManifest: () => ({ content_scripts: [{ js: ['assets/content-loader.js'] }] }),
    openOptionsPage: async () => { optionsPageOpens++ },
  },
  scripting: {
    getRegisteredContentScripts: async () => [],
    registerContentScripts: async () => {
      registerCount++
    },
    updateContentScripts: async () => {},
    executeScript: async () => {
      executeCount++
    },
  },
  permissions: {
    contains: async () => authorized,
    request: async () => {
      requestCount++
      authorized = true
      return true
    },
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
}

await import('../../src/popup/main.ts')
await new Promise((resolve) => setTimeout(resolve, 0))

const authArea = document.getElementById('auth-area') as HTMLDivElement
const authButton = document.getElementById('auth-btn') as HTMLButtonElement
const presetButtons = [
  ...document.querySelectorAll<HTMLButtonElement>('.preset[data-preset]'),
]

assert.equal(authArea.hidden, false, '未授权时应显示授权区域')
assert.equal(authButton.disabled, false, '授权按钮必须保持可点击')
assert.equal(presetButtons.length, 3, '应识别三个时间预设按钮')
assert.ok(presetButtons.every((button) => button.disabled), '授权前时间预设应禁用')

authButton.click()
await new Promise((resolve) => setTimeout(resolve, 0))

assert.equal(requestCount, 1, '点击授权按钮应发起一次权限请求')
assert.equal(registerCount, 1, '授权成功后应注册内容脚本')
assert.equal(executeCount, 1, '授权成功后应立即注入当前标签页')
assert.ok(presetButtons.every((button) => !button.disabled), '授权后时间预设应启用')
assert.match(
  document.getElementById('auth-status')?.textContent ?? '',
  /已授权/,
  '授权成功后应显示结果',
)

document.getElementById('settings-btn')?.click()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(optionsPageOpens, 1, '设置按钮应直接打开扩展设置页')

console.log('Popup 授权流程测试通过')
