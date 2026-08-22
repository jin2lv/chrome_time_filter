/**
 * 通过 chrome://extensions-internals 检查扩展加载状态
 * 运行：node scripts/probe-cdp.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')

const context = await chromium.launchPersistentContext(resolve(root, '.playwright', 'probe-cdp'), {
  headless: false,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
})

try {
  const page = await context.newPage()
  await page.goto('chrome://extensions-internals', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch((e) => console.log('nav:', e.message))
  await page.waitForTimeout(3000)
  const text = await page.evaluate(() => document.body.innerText).catch((e) => `err: ${e.message}`)
  // 列出所有扩展名
  const names = [...text.matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1])
  console.log('所有扩展:', JSON.stringify(names))
  const ids = [...text.matchAll(/"id":\s*"([^"]+)"/g)].map((m) => m[1])
  console.log('所有 id:', JSON.stringify(ids))
  const idx = text.indexOf('时光机')
  if (idx >= 0) {
    console.log('=== 时光机 扩展信息 ===')
    console.log(text.slice(Math.max(0, idx - 100), idx + 1500))
  } else {
    console.log('时光机不在列表中。body 前 3000 字:')
    console.log(text.slice(0, 3000))
  }
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}