/** 快速二分：极简扩展能否通过 playwright launchPersistentContext 加载 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core')

const root = resolve(import.meta.dirname, '..')
const EXT = process.argv[2] ?? resolve(root, '.playwright', 'minimal-ext')
const PROFILE = resolve(root, '.playwright', 'probe-profile')

console.log('加载扩展:', EXT)
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  dumpio: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--enable-unsafe-extension-debugging',
    '--enable-logging=stderr',
    '--v=1',
  ],
})
try {
  const browser = context.browser()
  const cdp = await browser.newBrowserCDPSession()
  await cdp.send('Target.setDiscoverTargets', { discover: true })
  const { targetInfos } = await cdp.send('Target.getTargets')
  const extTargets = targetInfos.filter((t) => t.url.startsWith('chrome-extension://'))
  console.log('扩展相关 targets:')
  extTargets.forEach((t) => console.log('  ', t.type, '|', t.url.slice(0, 100)))
  if (extTargets.length === 0) console.log('  (无 chrome-extension target)')
} catch (e) {
  console.error('错误:', e.message)
} finally {
  await context.close()
}
