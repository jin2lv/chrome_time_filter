/**
 * 深度探测：加载 dist-test 扩展并检查 chrome://extensions 状态
 * 运行：node scripts/probe-ext2.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')
const PROFILE = resolve(root, '.playwright', 'probe-profile3')

console.log('EXT_DIR:', EXT_DIR)

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--enable-logging=stderr',
    '--v=1',
  ],
})

// 收集 console 消息
context.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    console.log(`[console.${msg.type()}]`, msg.text().slice(0, 300))
  }
})

try {
  // 打开 chrome://extensions 页面检查
  const page = await context.newPage()
  await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => console.log('ext page nav:', e.message))
  await page.waitForTimeout(3000)

  const extInfo = await page.evaluate(() => {
    // extensions page 是 shadow DOM 结构
    const extract = (root) => {
      const items = root.querySelectorAll('extensions-item, extensions-manager')
      return items.length
    }
    const all = document.querySelectorAll('*')
    let text = document.body ? document.body.innerText.slice(0, 1000) : '(no body)'
    return text
  }).catch(e => `eval error: ${e.message}`)
  console.log('chrome://extensions body:', extInfo.slice(0, 500))

  // 等 SW
  let sw = null
  for (let i = 0; i < 40; i++) {
    const workers = context.serviceWorkers()
    const ours = workers.find((w) => w.url().includes('service-worker-loader'))
    if (ours) { sw = ours; break }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('SW found:', sw ? sw.url() : 'NO SW')

  // 列出所有 workers
  const allWorkers = context.serviceWorkers()
  console.log('all SWs:', allWorkers.map(w => w.url()))

  await page.goto('about:blank')
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}