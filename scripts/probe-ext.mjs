/**
 * 探测脚本：加载 dist-test 扩展，检查 SW 与 content script 注册状态
 * 运行：node scripts/probe-ext.mjs [profileName]
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')
const profileName = process.argv[2] || 'probe-profile2'
const PROFILE = resolve(root, '.playwright', profileName)

console.log('EXT_DIR:', EXT_DIR)
console.log('PROFILE:', PROFILE)

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
  ],
})

try {
  let sw = null
  for (let i = 0; i < 30; i++) {
    const workers = context.serviceWorkers()
    const ours = workers.find((w) => w.url().includes('service-worker-loader'))
    if (ours) { sw = ours; break }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('SW found:', sw ? sw.url() : 'NO SW')
  const pages = context.pages()
  console.log('pages:', pages.length)

  if (sw) {
    const regCheck = await sw.evaluate(async () => {
      const regs = await chrome.scripting.getRegisteredContentScripts()
      return JSON.stringify(regs.map((r) => ({ id: r.id, matches: r.matches, js: r.js })))
    })
    console.log('registered content scripts:', regCheck)
  }

  // 打开扩展 welcome 页或 popup 验证可访问
  if (sw) {
    const extId = new URL(sw.url()).host
    console.log('ext id:', extId)
    const popupUrl = `chrome-extension://${extId}/src/popup/index.html`
    try {
      const p2 = await context.newPage()
      await p2.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 10000 })
      await p2.waitForTimeout(800)
      const title = await p2.title().catch(() => '(no title)')
      const bodyText = await p2.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => '(no body)')
      console.log('Popup loaded, title:', title)
      console.log('Popup body:', bodyText)
      await p2.close()
    } catch (e) {
      console.log('Popup open error:', e.message)
    }
  }
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}