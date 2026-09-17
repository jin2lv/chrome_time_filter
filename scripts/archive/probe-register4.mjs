/**
 * 捕获 SW 的 warning 级日志（自动注册失败的 catch 输出）
 * 运行：node scripts/probe-register4.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')

const context = await chromium.launchPersistentContext(resolve(root, '.playwright', 'probe-register4'), {
  headless: false,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
})

try {
  const logs = []
  context.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))

  // 打开普通页面触发 SW（不路由 mock）
  const page = await context.newPage()
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForTimeout(2000)

  const sw = context.serviceWorkers().find((w) => w.url().includes('service-worker-loader'))
  console.log('SW:', sw ? sw.url() : 'NO SW')

  if (sw) {
    // 尝试调用扩展内部导出的函数？不行，SW 是打包产物。直接看注册结果
    const regs = await sw.evaluate(async () => {
      const all = await chrome.scripting.getRegisteredContentScripts()
      return all.map((r) => ({ id: r.id, matches: r.matches }))
    })
    console.log('自动注册结果:', JSON.stringify(regs))

    // 直接 eval 调用 ensureContentScriptRegistered（从 bundle 找 export 名）
    // bundle 是 ESM，没有全局导出。改用触发 onInstalled？手动调用内部逻辑：
    // 查看 SW 源码里 TARGET_MATCHES 与匹配逻辑 -> 复现：
    const manual = await sw.evaluate(async () => {
      const tries = []
      // 模拟 ensureContentScriptRegistered 内部
      try {
        const matches = []
        for (const m of ['*://xueqiu.com/*', '*://t.10jqka.com.cn/*', '*://finance.eastmoney.com/*', '*://jisilu.cn/*', '*://www.jisilu.cn/*']) {
          if (await chrome.permissions.contains({ origins: [m] })) matches.push(m)
        }
        tries.push({ step: 'collect matches', matches })
        const manifest = chrome.runtime.getManifest()
        const js = manifest.content_scripts?.[0]?.js ?? []
        tries.push({ step: 'get js', js })
        if (matches.length === 0) return { ...tries, skip: true }
        await chrome.scripting.registerContentScripts([{
          id: 'tm-main-test',
          matches,
          js,
          runAt: 'document_idle',
          persistAcrossSessions: true,
        }])
        const regs = await chrome.scripting.getRegisteredContentScripts()
        tries.push({ step: 'register ok', regs: regs.map((r) => r.id) })
        return tries
      } catch (e) {
        return { ...tries, error: String(e) }
      }
    })
    console.log('复现 ensureContentScriptRegistered:', JSON.stringify(manual, null, 2))
  }

  console.log('全部 console 日志:')
  for (const log of logs) console.log(log)
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await context.close()
  console.log('done')
}