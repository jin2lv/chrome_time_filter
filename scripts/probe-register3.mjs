/**
 * 捕获 SW 全部 console 输出定位注册失败原因
 * 运行：node scripts/probe-register3.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')

const context = await chromium.launchPersistentContext(resolve(root, '.playwright', 'probe-register3'), {
  headless: false,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
})

try {
  const allLogs = []
  context.on('console', (msg) => allLogs.push(`[${msg.type()}] ${msg.text()}`))

  // 打开 mock 页面触发 SW
  await context.route('http://xueqiu.com:8080/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><div id="app">mock</div></body></html>',
    }),
  )
  const page = await context.newPage()
  await page.goto('http://xueqiu.com:8080/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  let sw = context.serviceWorkers().find((w) => w.url().includes('service-worker-loader'))
  console.log('SW:', sw ? sw.url() : 'NO SW')

  if (sw) {
    // 注册状态
    const state = await sw.evaluate(async () => {
      const manifest = chrome.runtime.getManifest()
      return {
        manifestContentScripts: manifest.content_scripts,
        permitted: await chrome.permissions.contains({ origins: ['*://xueqiu.com/*'] }),
      }
    })
    console.log('manifest:', JSON.stringify(state.manifestContentScripts))
    console.log('permitted:', state.permitted)
  }

  // 直接尝试注册并捕获错误
  if (sw) {
    const regResult = await sw.evaluate(async () => {
      try {
        const manifest = chrome.runtime.getManifest()
        const js = manifest.content_scripts?.[0]?.js
        await chrome.scripting.registerContentScripts([
          {
            id: 'tm-test-manual',
            matches: ['*://xueqiu.com/*'],
            js: js ?? [],
            runAt: 'document_idle',
          },
        ])
        const regs = await chrome.scripting.getRegisteredContentScripts()
        return { ok: true, js, regs: regs.map((r) => ({ id: r.id, matches: r.matches })) }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    })
    console.log('手动注册结果:', JSON.stringify(regResult, null, 2))
  }

  console.log('全部 console 日志:')
  for (const log of allLogs) console.log(log)
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}