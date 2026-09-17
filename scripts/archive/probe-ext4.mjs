/**
 * 最小 Chrome 启动验证（无扩展）
 * 运行：node scripts/probe-ext4.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const context = await chromium.launchPersistentContext(resolve(import.meta.dirname, '..', '.playwright', 'probe-profile4'), {
  channel: 'chrome',
  headless: true, // 先试 headless，隔离扩展因素
})

try {
  const page = await context.newPage()
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 })
  const title = await page.title()
  console.log('Page title:', title)
  console.log('UA:', await page.evaluate(() => navigator.userAgent))
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}