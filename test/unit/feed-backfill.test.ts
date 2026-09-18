/**
 * 信息流连续补拉引擎测试（P2-17 切片 1）：jsdom + 覆写 scrollTo 模拟无限滚动加载
 * 运行：npx tsx test/unit/feed-backfill.test.ts
 *
 * 覆盖：
 * - 挂载白名单：上下文不在 backfill.contexts 内拒绝挂载
 * - 目标达成：命中 target_hits 后回到就绪态（可继续触发）
 * - 末页判定：连续 end_stall_count 次滚动无新增 → exhausted，且禁止再触发
 * - 屏数上限：达到 max_screens → limit，可「继续查找」累计
 * - 取消与恢复：loading 中取消 → cancelled，可再次启动
 * - 统一状态契约：ScanProgress.unit = 'screens'
 * - schema 校验：非法 backfill 配置被拒绝
 */
import assert from 'node:assert'
import { FeedBackfillController } from '../../src/content/feed-backfill'
import { validateAdapter } from '../../src/adapters/schema'
import type { ScanProgress } from '../../src/shared/types'
import { setupDom } from '../helpers/dom-env'

const dom = setupDom(`<body></body>`, { url: 'http://xueqiu.com:8080/' })

// jsdom 的 scrollTo 是 no-op 并报 Not implemented；覆写为「滚动即触发站点加载更多」
let loadBehavior: () => Array<{ id: string; expect: string }> = () => []
let scrollCount = 0
dom.window.scrollTo = (() => {
  scrollCount++
  const added = loadBehavior()
  setTimeout(() => {
    for (const item of added) {
      const el = dom.window.document.createElement('article')
      el.className = 'timeline__item'
      el.dataset.expect = item.expect
      el.innerHTML = `<a class="date-and-source" data-id="${item.id}">帖子 ${item.id}</a>`
      dom.window.document.body.appendChild(el)
    }
  }, 5)
}) as unknown as typeof window.scrollTo

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('until() timeout')
    await sleep(10)
  }
}

function makeController(
  config: import('../../src/shared/types').FeedBackfillConfig,
  onProgress?: (p: ScanProgress) => void,
): FeedBackfillController {
  const controller = FeedBackfillController.mount({
    config,
    currentContext: config.contexts[0] ?? '',
    postSelector: 'article.timeline__item',
    decide: (el) => (el.dataset.expect === 'include' ? 'include' : 'filtered'),
    onStateChange: onProgress,
  })!
  return controller
}

let nextId = 1
const appendPosts = (specs: Array<{ expect: string }>): Array<{ id: string; expect: string }> =>
  specs.map((s) => ({ id: `p${nextId++}`, expect: s.expect }))

// ---------- 1. 挂载白名单 ----------
{
  const controller = FeedBackfillController.mount({
    config: { contexts: ['热门 / 全部'], scroll_delay_ms: 10, max_screens: 3, target_hits: 1 },
    currentContext: '7x24',
    postSelector: 'article.timeline__item',
    decide: () => 'include',
  })
  assert.equal(controller, null, '上下文不在白名单内应拒绝挂载')
  console.log('✅ 挂载白名单：contexts 不匹配拒绝挂载')
}

// ---------- 2. 目标达成后回到就绪态 ----------
{
  scrollCount = 0
  nextId = 1
  let last: ScanProgress | null = null
  loadBehavior = () => appendPosts([{ expect: 'include' }])
  const controller = makeController(
    { contexts: ['7x24'], scroll_delay_ms: 15, max_screens: 5, target_hits: 2 },
    (p) => { last = p },
  )
  assert.ok(document.querySelector('.tm-backfill-bar'), '挂载后应有补拉操作条')
  assert.equal(document.querySelector<HTMLButtonElement>('.tm-backfill-bar button')!.textContent, '查找更早的帖子')
  controller.start()
  await until(() => last!.state === 'idle')
  assert.equal(last!.unit, 'screens', 'ScanProgress 应携带 unit=screens')
  assert.ok(last!.scannedPages >= 2, '至少滚动 2 屏才可能命中 2 条')
  const status = document.querySelector('.tm-backfill-status')!.textContent!
  assert.ok(status.includes('已找到 2 条'), `就绪态状态文本应含命中数，实际：${status}`)
  assert.equal(document.querySelector<HTMLButtonElement>('.tm-backfill-bar button')!.textContent, '继续查找')

  // 继续触发：screens 累计、再次命中即停
  const screensBefore = last!.scannedPages
  controller.start()
  await until(() => last!.state === 'idle' && last!.scannedPages > screensBefore)
  controller.destroy()
  assert.ok(!document.querySelector('.tm-backfill-bar'), 'destroy 后操作条应移除')
  console.log('✅ 目标达成：命中即停、可继续触发、unit=screens')
}

// ---------- 3. 末页判定与禁止再触发 ----------
{
  scrollCount = 0
  nextId = 1
  let last: ScanProgress | null = null
  loadBehavior = () => [] // 站点不再追加 → 连续 stall
  const controller = makeController(
    { contexts: ['7x24'], scroll_delay_ms: 15, max_screens: 5, target_hits: 1, end_stall_count: 2 },
    (p) => { last = p },
  )
  controller.start()
  await until(() => last!.state === 'exhausted')
  assert.equal(last!.scannedPages, 2, `连续 ${2} 次无新增判末页，实际滚了 ${last!.scannedPages} 屏`)
  const button = document.querySelector<HTMLButtonElement>('.tm-backfill-bar button')!
  assert.equal(button.disabled, true, '末页后按钮应禁用')
  const screensAtExhausted = last!.scannedPages
  controller.start()
  await sleep(60)
  assert.equal(last!.scannedPages, screensAtExhausted, '末页后再 start 不应产生新扫描')
  controller.destroy()
  console.log('✅ 末页判定：连续无新增 → exhausted 且禁止再触发')
}

// ---------- 4. 屏数上限 ----------
{
  scrollCount = 0
  nextId = 1
  let last: ScanProgress | null = null
  loadBehavior = () => appendPosts([{ expect: 'filtered' }]) // 只拉到窗口外帖子，永不命中
  const controller = makeController(
    { contexts: ['7x24'], scroll_delay_ms: 15, max_screens: 3, target_hits: 1 },
    (p) => { last = p },
  )
  controller.start()
  await until(() => last!.state === 'limit')
  assert.equal(last!.scannedPages, 3, '滚满 max_screens 屏即停')
  assert.ok(
    document.querySelector('.tm-backfill-status')!.textContent!.includes('3 屏安全上限'),
    'limit 状态文本应提示上限',
  )
  assert.equal(document.querySelector<HTMLButtonElement>('.tm-backfill-bar button')!.textContent, '继续查找')
  controller.destroy()
  console.log('✅ 屏数上限：达到 max_screens → limit 且可继续查找')
}

// ---------- 5. 取消与恢复 ----------
{
  scrollCount = 0
  nextId = 1
  let last: ScanProgress | null = null
  loadBehavior = () => appendPosts([{ expect: 'filtered' }, { expect: 'include' }])
  const controller = makeController(
    { contexts: ['7x24'], scroll_delay_ms: 40, max_screens: 20, target_hits: 50 },
    (p) => { last = p },
  )
  controller.start()
  await until(() => last!.state === 'loading' && last!.scannedPages >= 1)
  controller.cancel()
  assert.equal(last!.state, 'cancelled')
  const screensAtCancel = last!.scannedPages
  await sleep(80)
  assert.equal(last!.scannedPages, screensAtCancel, '取消后不再滚动')
  assert.equal(
    document.querySelector<HTMLButtonElement>('.tm-backfill-bar button')!.textContent,
    '继续查找',
  )
  controller.start()
  await until(() => last!.scannedPages > screensAtCancel)
  controller.destroy()
  console.log('✅ 取消与恢复：cancelled 后停止滚动、可再次启动')
}

// ---------- 7. 「加载更多」按钮式获取（切片 2） ----------
{
  // 7a. 滚动无新增 + 按钮可用 → 点击按钮继续拉取、命中计入
  scrollCount = 0
  nextId = 1
  let last: ScanProgress | null = null
  let clicks = 0
  const button = document.createElement('button')
  button.className = 'tm-load-more'
  button.textContent = '加载更多'
  button.addEventListener('click', () => {
    clicks++
    loadBehavior = () => appendPosts([{ expect: 'include' }])
  })
  document.body.appendChild(button)
  loadBehavior = () => [] // 滚动不再追加 → 依赖按钮
  const controller = makeController(
    {
      contexts: ['7x24'],
      scroll_delay_ms: 15,
      max_screens: 6,
      target_hits: 2,
      load_more_selector: '.tm-load-more',
    },
    (p) => { last = p },
  )
  controller.start()
  await until(() => last!.state === 'idle')
  assert.ok(clicks >= 1, `应点击「加载更多」至少一次，实际 ${clicks}`)
  assert.ok(
    document.querySelector('.tm-backfill-status')!.textContent!.includes('已找到 2 条'),
    '按钮式拉取的命中应计入统计',
  )
  controller.destroy()
  button.remove()
  console.log('✅ 按钮式补拉：滚动无新增时点击「加载更多」继续拉取并计入命中')
}
{
  // 7b. 声明了选择器但按钮不存在 → 维持「无新增计停滞」原语义（exhausted）
  scrollCount = 0
  nextId = 1
  let last: ScanProgress | null = null
  loadBehavior = () => []
  const controller = makeController(
    {
      contexts: ['7x24'],
      scroll_delay_ms: 15,
      max_screens: 5,
      target_hits: 1,
      end_stall_count: 2,
      load_more_selector: '.tm-no-such-button',
    },
    (p) => { last = p },
  )
  controller.start()
  await until(() => last!.state === 'exhausted')
  assert.equal(last!.scannedPages, 2, '按钮缺失时仍按原语义（2 次无新增）判末页')
  controller.destroy()
  console.log('✅ 按钮缺失：选择器声明但元素不存在 → 维持原末页语义')
}
{
  // 7c. 按钮禁用 → 不点击、按停滞判末页
  scrollCount = 0
  nextId = 1
  let last: ScanProgress | null = null
  let clicks = 0
  const disabledButton = document.createElement('button')
  disabledButton.className = 'tm-load-more-disabled'
  disabledButton.setAttribute('disabled', '')
  disabledButton.addEventListener('click', () => { clicks++ })
  document.body.appendChild(disabledButton)
  loadBehavior = () => []
  const controller = makeController(
    {
      contexts: ['7x24'],
      scroll_delay_ms: 15,
      max_screens: 5,
      target_hits: 1,
      end_stall_count: 2,
      load_more_selector: '.tm-load-more-disabled',
    },
    (p) => { last = p },
  )
  controller.start()
  await until(() => last!.state === 'exhausted')
  assert.equal(clicks, 0, '禁用按钮不应被点击')
  controller.destroy()
  disabledButton.remove()
  console.log('✅ 按钮禁用：不点击、按无新增判末页')
}
{
  // 7d. 按钮拉取计入 max_screens 上限
  scrollCount = 0
  nextId = 1
  let last: ScanProgress | null = null
  let clicks = 0
  const button = document.createElement('button')
  button.className = 'tm-load-more-limit'
  button.addEventListener('click', () => {
    clicks++
    for (const item of appendPosts([{ expect: 'filtered' }])) {
      const el = document.createElement('article')
      el.className = 'timeline__item'
      el.dataset.expect = item.expect
      el.innerHTML = `<a class="date-and-source" data-id="${item.id}">帖子 ${item.id}</a>`
      document.body.appendChild(el)
    }
  })
  document.body.appendChild(button)
  loadBehavior = () => [] // 只有按钮能拉到内容（且均为窗口外）
  const controller = makeController(
    {
      contexts: ['7x24'],
      scroll_delay_ms: 15,
      max_screens: 3,
      target_hits: 99,
      load_more_selector: '.tm-load-more-limit',
    },
    (p) => { last = p },
  )
  controller.start()
  await until(() => last!.state === 'limit')
  assert.equal(last!.scannedPages, 3, '按钮拉取同样计入屏数上限')
  assert.ok(clicks >= 1 && clicks <= 3, `按钮点击次数应被上限约束，实际 ${clicks}`)
  controller.destroy()
  button.remove()
  console.log('✅ 按钮式拉取计入 max_screens 上限')
}

// ---------- 8. 已在文档底部：先回退一屏再滚到底（2026-09-16 真机缺陷回归） ----------
{
  const docEl = dom.window.document.documentElement
  const savedScrollTo = dom.window.scrollTo

  const VIEW_H = 800
  const DOC_H = 2000
  const MAX_TOP = DOC_H - VIEW_H
  let fakeScrollY = 0
  const tops: number[] = []

  Object.defineProperty(docEl, 'scrollHeight', { configurable: true, get: () => DOC_H })
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, get: () => VIEW_H })
  Object.defineProperty(dom.window, 'scrollY', { configurable: true, get: () => fakeScrollY })
  dom.window.scrollTo = ((opts: ScrollToOptions | number) => {
    const top = typeof opts === 'object' ? (opts.top ?? 0) : opts
    tops.push(top)
    fakeScrollY = Math.min(Math.max(0, top), MAX_TOP)
  }) as unknown as typeof window.scrollTo

  const scrollOnce = async (startY: number): Promise<number[]> => {
    tops.length = 0
    fakeScrollY = startY
    loadBehavior = () => []
    let last: ScanProgress | null = null
    const controller = makeController(
      { contexts: ['7x24'], scroll_delay_ms: 20, max_screens: 1, target_hits: 99 },
      (p) => { last = p },
    )
    controller.start()
    await until(() => last!.state === 'limit')
    controller.destroy()
    return [...tops]
  }

  // 8a. 已处于底部：先回退一屏（maxTop - 视口高），再滚到底
  const atBottom = await scrollOnce(MAX_TOP)
  assert.equal(atBottom[0], MAX_TOP - VIEW_H, `已在底部时应先回退一屏，实际滚动序列 ${atBottom.join(' → ')}`)
  assert.equal(atBottom[atBottom.length - 1], DOC_H, '回退后仍应滚到文档末端')
  assert.ok(atBottom.length >= 2, '已到底时应产生两次滚动（回退 + 回到底）')

  // 8b. 未到底部：不应产生多余的回退滚动（保持原行为）
  const notAtBottom = await scrollOnce(0)
  assert.equal(notAtBottom[0], DOC_H, `未到底时应直接滚到末端，实际 ${notAtBottom.join(' → ')}`)
  assert.equal(notAtBottom.length, 1, '未到底时不应额外回退')

  // 恢复：jsdom 的 scrollHeight/innerHeight/scrollY 来自原型，删除本段的自有覆盖即可回落
  delete (docEl as unknown as Record<string, unknown>).scrollHeight
  delete (dom.window as unknown as Record<string, unknown>).innerHeight
  delete (dom.window as unknown as Record<string, unknown>).scrollY
  dom.window.scrollTo = savedScrollTo
  console.log('✅ 已在文档底部：先回退一屏再滚到底（避免空操作误判末页）')
}

// ---------- 9. schema 校验：非法 backfill 配置 ----------
{
  const base = {
    version: '1.0.0',
    platforms: [
      {
        name: '测试平台',
        domains: ['example.com'],
        post_selectors: ['article'],
        timestamp: { selector: '.time', type: 'absolute', format: 'YYYY-MM-DD HH:mm' },
        quick_presets: [{ label: '1小时前', value: '1_hour_ago' }],
        feed_context: {
          path_patterns: ['^/$'],
          active_selectors: ['.tab.active'],
          trigger_selectors: ['.tab'],
          wait_ms: 100,
          completeness: 'loaded-only',
          backfill: {
            contexts: ['全部'],
            scroll_delay_ms: 1000,
            max_screens: 5,
            target_hits: 10,
          },
        },
      },
    ],
  }
  assert.equal(validateAdapter(JSON.parse(JSON.stringify(base))), null, '合法 backfill 配置应通过校验')

  const invalid = (mutate: (backfill: Record<string, unknown>) => void): string[] | null => {
    const pkg = JSON.parse(JSON.stringify(base))
    mutate((pkg.platforms[0].feed_context.backfill as Record<string, unknown>))
    return validateAdapter(pkg)
  }
  assert.ok(invalid((b) => { b.contexts = [] })?.join().includes('contexts'), '空 contexts 应报错')
  assert.ok(invalid((b) => { b.contexts = [''] })?.join().includes('contexts'), '空字符串 contexts 应报错')
  assert.ok(invalid((b) => { b.scroll_delay_ms = -1 })?.join().includes('scroll_delay_ms'), '负 delay 应报错')
  assert.ok(invalid((b) => { b.max_screens = 0 })?.join().includes('max_screens'), '0 上限应报错')
  assert.ok(invalid((b) => { b.target_hits = 1.5 })?.join().includes('target_hits'), '非整数 target 应报错')
  assert.ok(invalid((b) => { b.end_stall_count = 0 })?.join().includes('end_stall_count'), '0 stall 应报错')
  assert.ok(
    invalid((b) => { b.load_more_selector = '' })?.join().includes('load_more_selector'),
    '空 load_more_selector 应报错',
  )
  assert.equal(
    validateAdapter(
      (() => {
        const pkg = JSON.parse(JSON.stringify(base))
        ;(pkg.platforms[0].feed_context.backfill as Record<string, unknown>).load_more_selector = '.load-more'
        return pkg
      })(),
    ),
    null,
    '合法 load_more_selector 应通过校验',
  )
  console.log('✅ schema 校验：非法 backfill 配置被拒绝')
}

console.log('信息流连续补拉引擎测试通过')
