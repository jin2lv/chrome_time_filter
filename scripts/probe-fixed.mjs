/**
 * 验证修复后的 SW loader（全新 profile，确认 background 注册生效）
 * 运行：node scripts/probe-fixed.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')

const context = await chromium.launchPersistentContext(resolve(root, '.playwright', 'probe-fixed'), {
  headless: false,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
})

try {
  const logs = []
  context.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))

  // 打开 mock 雪球页
  await context.route('http://xueqiu.com:8080/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><div id="app">mock</div></body></html>',
    }),
  )
  const page = await context.newPage()
  await page.goto('http://xueqiu.com:8080/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  const sw = context.serviceWorkers().find((w) => w.url().includes('service-worker-loader'))
  console.log('SW:', sw ? sw.url() : 'NO SW')

  if (sw) {
    const state = await sw.evaluate(async () => {
      const regs = await chrome.scripting.getRegisteredContentScripts()
      return {
        registered: regs.map((r) => ({ id: r.id, matches: r.matches, js: r.js })),
        hasBackground: typeof chrome.commands !== 'undefined',
      }
    })
    console.log('注册状态:', JSON.stringify(state, null, 2))
  }

  console.log('console 日志:')
  for (const log of logs) console.log(log)
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}