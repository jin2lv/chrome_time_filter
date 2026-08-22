/**
 * 手动触发 ensureContentScriptRegistered 并捕获错误
 * 运行：node scripts/probe-register2.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')

const context = await chromium.launchPersistentContext(resolve(root, '.playwright', 'probe-register2'), {
  headless: false,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
})

try {
  // 打开 mock 页面触发 SW
  await context.route('http://xueqiu.com:8080/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><div id="app">mock</div></body></html>',
    }),
  )
  const page = await context.newPage()
  await page.goto('http://xueqiu.com:8080/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  const sw = context.serviceWorkers().find((w) => w.url().includes('service-worker-loader'))
  if (!sw) {
    console.log('NO SW')
    throw new Error('no sw')
  }

  // 捕获 SW console 错误——重载 SW 以重新执行 init
  const logs = []
  sw.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      logs.push(`[${msg.type()}] ${msg.text()}`)
    }
  })

  // 先从扩展页面加载一次 SW 确保干净
  console.log('重载 SW...')
  await sw.evaluate(() => chrome.runtime.reload?.())
  await page.waitForTimeout(2000)

  // 再次找 SW
  const sw2 = context.serviceWorkers().find((w) => w.url().includes('service-worker-loader'))
  console.log('SW after reload:', sw2 ? sw2.url() : 'NO SW')

  // 等 init 完成
  await page.waitForTimeout(3000)
  console.log('SW logs:', JSON.stringify(logs, null, 2))

  // 检查注册结果
  if (sw2) {
    const regs = await sw2.evaluate(async () => {
      const regs = await chrome.scripting.getRegisteredContentScripts()
      return regs.map((r) => ({ id: r.id, matches: r.matches, js: r.js }))
    })
    console.log('registered now:', JSON.stringify(regs))
  }
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}