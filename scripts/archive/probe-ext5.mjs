/**
 * 最小扩展加载复现：全新 profile + headed + no-sandbox
 * 运行：node scripts/probe-ext5.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')
const PROFILE = resolve(root, '.playwright', 'probe-profile5')

console.log('EXT_DIR:', EXT_DIR)

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-sandbox',
    '--disable-gpu',
  ],
})

context.on('serviceworker', (w) => console.log('[serviceworker event]', w.url()))
context.on('page', (p) => console.log('[page event]', p.url()))

try {
  const page = await context.newPage()
  await page.goto('about:blank', { waitUntil: 'domcontentloaded' })
  console.log('blank ok')

  await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(e => console.log('nav err:', e.message))
  await page.waitForTimeout(2500)
  const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1200) : '(no body)').catch(e => `err: ${e.message}`)
  console.log('extensions page:', body)

  // 等 SW
  let sw = null
  for (let i = 0; i < 40; i++) {
    const workers = context.serviceWorkers()
    console.log('workers now:', workers.map(w => w.url().slice(0, 80)))
    const ours = workers.find((w) => w.url().includes('service-worker-loader'))
    if (ours) { sw = ours; break }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('SW:', sw ? sw.url() : 'NO SW')
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}