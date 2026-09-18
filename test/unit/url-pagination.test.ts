/**
 * 服务端 URL 翻页源策略测试（P2-21 前置能力）
 * 运行：npx tsx test/unit/url-pagination.test.ts
 *
 * 覆盖 VirtualPaginationController 的 source_mode='url'：
 * - 按 page_url_pattern 逐页 fetch（起始页 → 逐页 +1），不改动当前页面、不触发站内翻页
 * - 跨源页去重、按 page_size 重排、站内原生列表与分页被隐藏
 * - 末页判定（拉到的源页没有新帖 ID）、HTTP 失败 → error、取消/销毁恢复原生 DOM
 * - 离线文档里的相对链接按源页 URL 解析为绝对地址
 */
import assert from 'node:assert'
import { VirtualPaginationController } from '../../src/content/virtual-pagination'
import type { PlatformAdapter, ScanProgress } from '../../src/shared/types'
import { check, finish } from '../helpers/check'
import { setupDom } from '../helpers/dom-env'

type VirtualConfig = NonNullable<PlatformAdapter['virtual_pagination']>

/** 页面骨架：原生第 1 页列表 + 原生分页容器（虚拟分页要求两者存在） */
const NATIVE_PAGE = `<!doctype html><html><body>
  <div id="main">
    <ul class="native-list"><li class="post"><a class="pid" href="/news,1.html" data-id="1">原生帖 1</a></li></ul>
    <div class="pager"><a href="/list__page-1" class="active">1</a></div>
  </div>
</body></html>`

setupDom(NATIVE_PAGE, { url: 'https://urlmode.example.com/list__page-1' })

function sourcePage(ids: number[]): string {
  return `<!doctype html><html><body><ul class="list">${ids
    .map(
      (id) =>
        `<li class="post"><a class="pid" href="/news,${id}.html" data-id="${id}">帖 ${id}</a><span class="t">09-18 10:0${id % 10}</span></li>`,
    )
    .join('')}</ul></body></html>`
}

const config: VirtualConfig = {
  list_selector: '#main > .native-list',
  post_id: { selector: '.pid', attr: 'data-id' },
  source_link_selector: '.pid',
  native_pagination_selector: '#main > .pager',
  source_mode: 'url',
  page_url_pattern: '/list__page-{page}',
  start_page: 1,
  // 虚拟页 6 条：源页每页 3 条 → 首屏必须跨 3 个源页，且被过滤的帖子不计入缓存
  page_size: 6,
  max_source_pages: 5,
  wait_ms: 10,
}

const requested: string[] = []
const pages: Record<number, string> = {
  1: sourcePage([1, 2, 3]),
  2: sourcePage([4, 5, 6]),
  3: sourcePage([7, 8]),
  4: '<!doctype html><html><body><ul class="list"></ul></body></html>',
}
const fetchMock = (async (url: string) => {
  requested.push(String(url))
  const page = Number(String(url).match(/page-(\d+)/)?.[1] ?? 0)
  if (!(page in pages)) return { ok: false, status: 404, text: async () => '' }
  return { ok: true, status: 200, text: async () => pages[page] }
}) as unknown as typeof fetch
;(globalThis as Record<string, unknown>).fetch = fetchMock

const decisions: Array<{ id: string; decision: string }> = []
const progress: ScanProgress[] = []
const controller = VirtualPaginationController.create({
  config,
  postSelector: 'li.post',
  decide: (post) => {
    const id = post.querySelector('.pid')?.getAttribute('data-id') ?? '?'
    const decision = id === '5' ? 'filtered' : 'include'
    decisions.push({ id, decision })
    return decision as 'include' | 'filtered'
  },
  onDecision: () => {},
  onStateChange: (p) => progress.push({ ...p }),
})
assert.ok(controller, '控制器应在原生列表与分页存在时创建成功')

const nativeList = document.querySelector<HTMLElement>('#main > .native-list')!
const nativePager = document.querySelector<HTMLElement>('#main > .pager')!

await controller!.start()

// ---------- 1. 拉取行为 ----------
check(
  '首屏按模板逐页拉取（源页 1→3），不改动当前页面',
  requested.join(',') ===
    'https://urlmode.example.com/list__page-1,https://urlmode.example.com/list__page-2,https://urlmode.example.com/list__page-3',
  requested.join(','),
)
check('未触发站内翻页（页面 URL 不变）', location.pathname === '/list__page-1', location.pathname)
check(
  '原生分页容器被隐藏（站点整页翻页由扩展接管展示）',
  nativePager.style.getPropertyValue('display') === 'none',
  nativePager.style.getPropertyValue('display'),
)
check('原生列表被隐藏', nativeList.style.getPropertyValue('display') === 'none' && nativeList.dataset.tmVirtualNative === '1')

// ---------- 2. 跨源页聚合与去重 ----------
const virtualText = document.querySelector('.tm-virtual-list')?.textContent ?? ''
check(
  '虚拟页渲染 6 条（来自源页 1、2、3）',
  ['帖 1', '帖 2', '帖 3', '帖 4', '帖 6', '帖 7'].every((t) => virtualText.includes(t)),
  virtualText,
)
check('被过滤的帖子不进入缓存', !virtualText.includes('帖 5'), virtualText)
check(
  '每个帖 ID 只判定一次（跨源页去重）',
  decisions.length === 8 && decisions.length === new Set(decisions.map((d) => d.id)).size,
  JSON.stringify(decisions),
)
check(
  '相对链接按源页 URL 解析为绝对地址',
  document.querySelector<HTMLElement>('.tm-virtual-list .post')?.dataset.tmSourceHref?.startsWith('https://urlmode.example.com/news,') ?? false,
  document.querySelector<HTMLElement>('.tm-virtual-list .post')?.dataset.tmSourceHref ?? 'none',
)

// ---------- 3. 下一页：继续拉取源页 4（空页 → 末页） ----------
const nextButton = [...document.querySelectorAll<HTMLButtonElement>('.tm-virtual-controls button')].find(
  (b) => b.textContent === '下一页',
)!
nextButton.click()
await new Promise((resolve) => setTimeout(resolve, 60))
const afterNext = document.querySelector('.tm-virtual-list')?.textContent ?? ''
check('下一页渲染缓存中的第 7 条（源页 3 的第 2 条）', afterNext.includes('帖 8'), afterNext)
check(
  '拉取序列推进到源页 4（触发末页判定）',
  requested[requested.length - 1] === 'https://urlmode.example.com/list__page-4',
  requested.join(','),
)
check(
  '空源页 → 末页状态',
  controller!.getProgress().state === 'exhausted',
  JSON.stringify(controller!.getProgress()),
)
check(
  '扫描进度：空页不计入已扫描源页（3 页有内容，第 4 页仅用于判定末页）、单位沿用 pages',
  controller!.getProgress().scannedPages === 3 &&
    controller!.getProgress().currentSourcePage === '3' &&
    controller!.getProgress().unit === undefined,
  JSON.stringify(controller!.getProgress()),
)
check('状态回调上报（Popup/悬浮条文案依据）', progress.some((p) => p.state === 'exhausted'))

// ---------- 4. 销毁恢复原生 DOM ----------
controller!.destroy()
check('销毁后原生列表恢复', nativeList.style.getPropertyValue('display') === '' && nativeList.dataset.tmVirtualNative === undefined)
check('销毁后虚拟容器移除', document.querySelector('.tm-virtual-pagination') === null)

// ---------- 5. 失败路径：HTTP 错误 → error ----------
;(globalThis as Record<string, unknown>).fetch = (async () => ({
  ok: false,
  status: 500,
  text: async () => '',
})) as unknown as typeof fetch
const failing = VirtualPaginationController.create({
  config,
  postSelector: 'li.post',
  decide: () => 'include',
  onDecision: () => {},
})
assert.ok(failing, '第二个控制器同样应创建成功')
await failing!.start()
check('起始页 HTTP 500 → error 状态', failing!.getProgress().state === 'error', JSON.stringify(failing!.getProgress()))
failing!.destroy()

// ---------- 6. 重复内容（服务端忽略页码）→ 末页而非无限拉取 ----------
;(globalThis as Record<string, unknown>).fetch = (async () => ({
  ok: true,
  status: 200,
  text: async () => sourcePage([1, 2, 3]),
})) as unknown as typeof fetch
const repeated = VirtualPaginationController.create({
  config,
  postSelector: 'li.post',
  decide: () => 'include',
  onDecision: () => {},
})
assert.ok(repeated, '第三个控制器同样应创建成功')
await repeated!.start()
check(
  '服务端返回同一批内容 → exhausted（不重复渲染）',
  repeated!.getProgress().state === 'exhausted' && repeated!.getProgress().scannedPages === 2,
  JSON.stringify(repeated!.getProgress()),
)
repeated!.destroy()

finish('服务端 URL 翻页源策略测试完成')
