/**
 * 最小扩展加载验证（最小 ext）
 * 运行：node scripts/probe-minimal.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, '.playwright', 'minimal-ext')
const PROFILE = resolve(root, '.playwright', 'minimal-profile')

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: true,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
  ],
})

try {
  let sw = null
  for (let i = 0; i < 40; i++) {
    const workers = context.serviceWorkers()
    if (workers.length > 0) { sw = workers[0]; console.log('worker url:', sw.url()); break }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('SW:', sw ? sw.url() : 'NO SW')
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}