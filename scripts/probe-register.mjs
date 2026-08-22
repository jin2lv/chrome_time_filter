/**
 * 诊断 SW 中 content script 注册状态与权限
 * 运行：node scripts/probe-register.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')

const context = await chromium.launchPersistentContext(resolve(root, '.playwright', 'probe-register'), {
  headless: false,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
})

try {
  // 打开 mock 域名页面触发 SW + content script 注入
  await context.route('http://xueqiu.com:8080/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><div id="app">mock</div></body></html>',
    }),
  )
  const page = await context.newPage()
  await page.goto('http://xueqiu.com:8080/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  const sw = context.serviceWorkers().find((w) => w.url().includes('service-worker-loader'))
  if (!sw) {
    console.log('NO SW')
  } else {
    console.log('SW:', sw.url())
    const diag = await sw.evaluate(async () => {
      const out = { permissions: {}, registered: [], manifest: {} }
      const manifest = chrome.runtime.getManifest()
      out.manifest = {
        host_permissions: manifest.host_permissions,
        optional_host_permissions: manifest.optional_host_permissions,
      }
      for (const origin of ['*://xueqiu.com/*', '*://t.10jqka.com.cn/*']) {
        out.permissions[origin] = await chrome.permissions.contains({ origins: [origin] })
      }
      const regs = await chrome.scripting.getRegisteredContentScripts()
      out.registered = regs.map((r) => ({ id: r.id, matches: r.matches, js: r.js }))
      return out
    })
    console.log(JSON.stringify(diag, null, 2))
  }

  // 检查页面是否注入了 content script
  const injected = await page.evaluate(() => {
    return {
      hasTmInput: !!document.querySelector('input'),
      html: document.body.innerHTML.slice(0, 200),
    }
  }).catch((e) => `page eval err: ${e.message}`)
  console.log('页面状态:', JSON.stringify(injected))
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}