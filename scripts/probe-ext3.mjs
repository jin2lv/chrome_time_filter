/**
 * 用 e2e-profile-final（历史上成功加载过扩展）探测
 * 运行：node scripts/probe-ext3.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')
const PROFILE = resolve(root, '.playwright', 'e2e-profile-final')

// 尝试读取 manifest 扩展名看是否有缓存
console.log('EXT_DIR:', EXT_DIR)

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
  ],
})

context.on('page', (p) => {
  console.log('[page created]', p.url())
})
context.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 200))
})

try {
  // 直接打开一个普通页面，验证浏览器正常
  const page = await context.newPage()
  await page.goto('about:blank', { waitUntil: 'domcontentloaded' })
  console.log('blank page ok')

  await page.goto('chrome://extensions-internals', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(e => console.log('ext-internals nav err:', e.message))
  await page.waitForTimeout(2000)
  const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1500) : '(no body)').catch(e => `eval err: ${e.message}`)
  console.log('extensions-internals:', body.slice(0, 800))

  await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(e => console.log('ext nav err:', e.message))
  await page.waitForTimeout(2000)
  const body2 = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1500) : '(no body)').catch(e => `eval err: ${e.message}`)
  console.log('extensions page:', body2.slice(0, 800))

  let sw = null
  for (let i = 0; i < 40; i++) {
    const workers = context.serviceWorkers()
    const ours = workers.find((w) => w.url().includes('service-worker-loader'))
    if (ours) { sw = ours; break }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('SW found:', sw ? sw.url() : 'NO SW')

  // 尝试直接 eval SW
  if (!sw) {
    // 尝试触发 SW 启动：打开 chrome-extension://<id>/ 路径
    // 先找 id——用 profile 中的 Preferences 或直接看 Local State
    const localState = JSON.parse(readFileSync(resolve(PROFILE, 'Local State'), 'utf-8')).catch?.(()=>null)
    console.log('local state keys:', Object.keys(localState || {}))
  }
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}