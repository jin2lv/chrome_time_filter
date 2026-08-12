/**
 * 端到端验证（P1-4）：playwright-core 加载扩展 → mock 雪球页 → 过滤断言
 * 运行：node scripts/e2e.mjs
 *
 * 流程：
 * 1. launchPersistentContext 加载 dist-test（测试构建：xueqiu.com 必须权限）
 * 2. route 拦截 http://xueqiu.com:8080/** 返回 mock 页
 * 3. 通过 SW 写入时间设置（截止 = 2 小时前，hide）
 * 4. 打开 mock 页 → content script 注入 → 过滤
 * 5. 断言：过滤数与 data-expect-filter 完全一致（零误杀/零漏杀）
 * 6. 点击"加载更多"验证 MutationObserver 增量处理
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
// playwright-core 装在隔离 workspace（NODE_PATH 对 ESM 无效，走 createRequire 绝对路径）
const { chromium } = require(
  'C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
)

const root = resolve(import.meta.dirname, '..')
const EXT_DIR = resolve(root, 'dist-test')
const PROFILE = resolve(root, '.playwright', 'e2e-profile-final')
const MOCK_HTML = readFileSync(resolve(root, 'test', 'fixtures', 'xueqiu-mock.html'), 'utf-8')

const CUTOFF_MS_AGO = 2 * 60 * 60 * 1000 // 截止 = 2 小时前

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
  ],
})

const results = { pass: 0, fail: 0 }
function check(name, cond, detail = '') {
  if (cond) {
    results.pass++
    console.log(`  ✅ ${name}`)
  } else {
    results.fail++
    console.log(`  ❌ ${name} ${detail}`)
  }
}

try {
  // 1. 等待扩展 SW
  console.log('1. 等待扩展加载...')
  let sw = null
  for (let i = 0; i < 20; i++) {
    const workers = context.serviceWorkers()
    const ours = workers.find((w) => w.url().includes('service-worker-loader'))
    if (ours) { sw = ours; break }
    await new Promise((r) => setTimeout(r, 500))
  }
  check('扩展 SW 已加载', !!sw, sw ? sw.url() : 'no sw')
  if (!sw) throw new Error('扩展未加载')

  const extId = new URL(sw.url()).host
  console.log(`   扩展 id: ${extId}`)

  // 2. 确认 content script 已注册（SW 侧）
  const regCheck = await sw.evaluate(async () => {
    const regs = await chrome.scripting.getRegisteredContentScripts()
    return JSON.stringify(regs.map((r) => ({ id: r.id, matches: r.matches })))
  })
  console.log('   已注册 content scripts:', regCheck)

  // 3. 写入时间设置（截止 = 2 小时前）
  await sw.evaluate((cutoffMsAgo) => {
    const cutoff = Date.now() - cutoffMsAgo
    return chrome.storage.local.set({
      'timeSettings.xueqiu.com': { mode: 'cutoff', cutoff, strategy: 'hide' },
    })
  }, CUTOFF_MS_AGO)
  console.log('2. 时间设置已写入（截止 = 2 小时前, hide）')

  // 4. 打开 mock 页（route 拦截 xueqiu.com 域名）
  await context.route('http://xueqiu.com:8080/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: MOCK_HTML }),
  )
  const page = await context.newPage()
  await page.goto('http://xueqiu.com:8080/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  // 5. 断言初始过滤
  console.log('3. 初始过滤断言（12 条，截止 2 小时前）...')
  const initial = await page.evaluate(() => {
    const posts = [...document.querySelectorAll('.timeline__item')]
    const filtered = posts.filter((p) => p.style.display === 'none')
    const wrong = posts.filter((p) => {
      const expect = p.dataset.expectFilter === 'true'
      const actual = p.style.display === 'none'
      return expect !== actual
    })
    return {
      total: posts.length,
      filtered: filtered.length,
      wrong: wrong.length,
      wrongDetail: wrong.map((p) => p.querySelector('.date-and-source')?.textContent?.trim()).slice(0, 6),
    }
  })
  check('帖子总数 = 12', initial.total === 12, `got ${initial.total}`)
  check(`过滤数 = 5（零误杀/零漏杀）`, initial.filtered === 5, `got ${initial.filtered}`)
  check('无判定错误', initial.wrong === 0, JSON.stringify(initial.wrongDetail))

  // 6. 点击"加载更多"验证 MutationObserver
  console.log('4. 加载更多（MutationObserver 增量过滤）...')
  await page.click('#load-more')
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => {
    const posts = [...document.querySelectorAll('.timeline__item')]
    const filtered = posts.filter((p) => p.style.display === 'none')
    const wrong = posts.filter((p) => {
      const expect = p.dataset.expectFilter === 'true'
      const actual = p.style.display === 'none'
      return expect !== actual
    })
    return { total: posts.length, filtered: filtered.length, wrong: wrong.length }
  })
  check('加载后总数 = 14', after.total === 14, `got ${after.total}`)
  check('过滤数 = 6（新增 1 条被过滤）', after.filtered === 6, `got ${after.filtered}`)
  check('无判定错误', after.wrong === 0, `got ${after.wrong}`)

  // 7. 切换时间设置（截止 = 8 小时前）→ 应重新过滤
  console.log('5. 变更截止时间（8 小时前）→ 重应用...')
  await sw.evaluate(() => {
    const cutoff = Date.now() - 8 * 60 * 60 * 1000
    return chrome.storage.local.set({
      'timeSettings.xueqiu.com': { mode: 'cutoff', cutoff, strategy: 'hide' },
    })
  })
  await page.waitForTimeout(1000)
  const afterCutoff = await page.evaluate(() => {
    const posts = [...document.querySelectorAll('.timeline__item')]
    const filtered = posts.filter((p) => p.style.display === 'none')
    const wrong = posts.filter((p) => {
      // 8 小时前截止：相对/绝对时间 < 8h 的都被过滤；expectFilter 不适用，这里单独算
      const t = p.querySelector('.date-and-source')?.textContent ?? ''
      const isNew = /分钟前|小时前/.test(t) && !/8小时前|6小时前|5小时前|4小时前|3小时前/.test(t)
      const isAbsNew = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t.trim()) && p.dataset.expectFilter === 'true'
      const expectFilter = isNew || isAbsNew
      return expectFilter !== (p.style.display === 'none')
    })
    return { filtered: filtered.length, wrong: wrong.length }
  })
  check('8小时前截止：过滤数正确（7 条）', afterCutoff.filtered === 7, `got ${afterCutoff.filtered}`)
  check('无判定错误', afterCutoff.wrong === 0, `got ${afterCutoff.wrong}`)

  // 8. 截图留证
  await page.screenshot({ path: resolve(root, 'dist', 'e2e-filter-result.png') })
  console.log('6. 截图已保存: dist/e2e-filter-result.png')
} catch (e) {
  console.error('E2E ERROR:', e.message)
  results.fail++
} finally {
  await context.close()
  console.log(`\n========== 结果: ${results.pass} 通过 / ${results.fail} 失败 ==========`)
  process.exit(results.fail > 0 ? 1 : 0)
}
