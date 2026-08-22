/**
 * 确认扩展 SW 启动 + content script 注册状态
 * 运行：node scripts/probe-sw.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')
const EXT_ID = 'hmeklmafbbcpmbjikjaffgnnejgeglfe'

const context = await chromium.launchPersistentContext(resolve(root, '.playwright', 'probe-sw'), {
  headless: false,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
})

try {
  // 打开一个普通页面触发 SW 启动
  const page = await context.newPage()
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForTimeout(1000)

  // 检查所有 service workers
  const workers = context.serviceWorkers()
  console.log('SW count:', workers.length)
  for (const w of workers) console.log('  SW:', w.url())

  // 尝试直接访问扩展页面触发 SW
  const popupUrl = `chrome-extension://${EXT_ID}/src/popup/index.html`
  console.log('打开 popup:', popupUrl)
  const p2 = await context.newPage()
  await p2.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch((e) => console.log('popup nav err:', e.message))
  await p2.waitForTimeout(1500)
  const bodyText = await p2.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '(no body)').catch((e) => `eval err: ${e.message}`)
  console.log('Popup body:', bodyText)

  // 再次检查 SW
  const workers2 = context.serviceWorkers()
  console.log('SW count after popup:', workers2.length)
  for (const w of workers2) console.log('  SW:', w.url())
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}