/**
 * 同域多页面类型适配测试（P2-21 前置能力）
 * 运行：npx tsx test/unit/adapter-pages.test.ts
 *
 * 覆盖：
 * - AdapterManager.getAdapterFor(domain, pathname)：路径命中优先、无作用域条目兜底、
 *   全部未命中返回 null（内容脚本应静默退出）
 * - 同域两个页面类型条目各自独立（post_selectors / timestamp / year_inference 互不串用）
 * - schema：url 模式虚拟分页的必填项与互斥项
 * - build-adapters-json.mjs 的域名规则：同域多条目必须全部用 active_paths 隔离
 */
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AdapterManager, matchesActivePath } from '../../src/adapters'
import { validateAdapter } from '../../src/adapters/schema'
import type { Adapter } from '../../src/shared/types'
import { check, finish } from '../helpers/check'
import { setupDom } from '../helpers/dom-env'

setupDom('<!doctype html><html><body></body></html>', { url: 'https://guba.example.com/' })

const repoRoot = resolve(import.meta.dirname, '../..')

/**
 * 同域三个页面类型（P2-21 目标形态）：
 * - 个股吧「最新发帖」`list,{code},f.html`：按发帖时间排序 → 可用 descnding 序列推断年份
 * - 个股吧「全部/热门」`list,{code}.html`：按最后回复排序 → 时间列语义是回复时间，
 *   必须拆成独立条目（回退链严禁表达语义差异），且年份不可推断
 * - 基金吧总版 `jj.html`：模板与时间字段完全不同（模板差异 → 必须独立条目）
 */
const sameDomainPkg: Adapter = {
  version: '1.0.0',
  platforms: [
    {
      name: '示例股吧·最新发帖',
      domains: ['guba.example.com'],
      active_paths: ['^/list,\\d+,f\\.html$'],
      post_selectors: ['table.default_list tr.listitem'],
      timestamp: { selector: ['div.update.pub_time', 'div.update'], type: 'absolute', format: 'MM-DD HH:mm', year_inference: 'descending-list' },
      quick_presets: [],
    },
    {
      name: '示例股吧·全部',
      domains: ['guba.example.com'],
      active_paths: ['^/list,\\d+\\.html$'],
      post_selectors: ['table.default_list tr.listitem'],
      timestamp: { selector: ['div.update.mod_time', 'div.update'], type: 'absolute', format: 'MM-DD HH:mm', year_inference: 'never' },
      quick_presets: [],
    },
    {
      name: '示例基金吧总版',
      domains: ['guba.example.com'],
      active_paths: ['^/jj(_\\d+)?\\.html$'],
      post_selectors: ['div.balist > ul.newlist > li'],
      timestamp: { selector: 'cite.date', type: 'absolute', format: 'MM-DD HH:mm', year_inference: 'never' },
      quick_presets: [],
    },
  ],
}

check('同域多条目通过 schema 校验', validateAdapter(sameDomainPkg) === null, JSON.stringify(validateAdapter(sameDomainPkg)))

AdapterManager.setRemoteAdapters([sameDomainPkg])

// ---------- 1. 路径命中选择 ----------
const stock = AdapterManager.getAdapterFor('guba.example.com', '/list,600519.html')
check('个股吧「全部」路径 → 全部条目', stock?.name === '示例股吧·全部', stock?.name ?? 'null')
const stockNew = AdapterManager.getAdapterFor('guba.example.com', '/list,600519,f.html')
check('「最新发帖」路径 → 发帖时间条目（与全部条目分离）', stockNew?.name === '示例股吧·最新发帖', stockNew?.name ?? 'null')
check(
  '两个个股吧条目的时间语义互不串用',
  stockNew?.timestamp.year_inference === 'descending-list' && stock?.timestamp.year_inference === 'never',
)
const fund = AdapterManager.getAdapterFor('guba.example.com', '/jj.html')
check('基金吧总版路径 → 基金吧条目', fund?.name === '示例基金吧总版', fund?.name ?? 'null')
const fundPage2 = AdapterManager.getAdapterFor('guba.example.com', '/jj_2.html')
check('基金吧翻页路径仍命中基金吧条目', fundPage2?.name === '示例基金吧总版', fundPage2?.name ?? 'null')
const other = AdapterManager.getAdapterFor('guba.example.com', '/news,600519,123.html')
check('详情页路径未命中任何条目 → null（内容脚本静默退出）', other === null, other?.name ?? 'null')
check('域名级 hasAdapter 仍为 true（平台受支持，仅该页面类型未适配）', AdapterManager.hasAdapter('guba.example.com'))
check('域名级 getAdapter 返回首个条目（popup 展示用）', AdapterManager.getAdapter('guba.example.com')?.name === '示例股吧·最新发帖')

// ---------- 2. 各条目的配置互不串用 ----------
check(
  '各条目使用自己的选择器与时间字段',
  JSON.stringify(stock?.post_selectors) === JSON.stringify(['table.default_list tr.listitem']) &&
    JSON.stringify(fund?.post_selectors) === JSON.stringify(['div.balist > ul.newlist > li']) &&
    fund?.timestamp.selector === 'cite.date',
)
check(
  '回退链在同一语义内声明（pub_time → update、mod_time → update）',
  Array.isArray(stockNew?.timestamp.selector) &&
    stockNew?.timestamp.selector.length === 2 &&
    Array.isArray(stock?.timestamp.selector),
)

// ---------- 3. 无作用域条目作为兜底 ----------
AdapterManager.setRemoteAdapters([
  {
    version: '1.0.0',
    platforms: [
      { name: '兜底平台', domains: ['fallback.example.com'], post_selectors: ['article'], timestamp: { selector: 'time', type: 'absolute', format: 'YYYY-MM-DD' }, quick_presets: [] },
    ],
  },
])
check(
  '未声明 active_paths 的条目匹配任意路径（向后兼容）',
  AdapterManager.getAdapterFor('fallback.example.com', '/anything/here')?.name === '兜底平台',
)

// ---------- 4. matchesActivePath ----------
const multiPath = sameDomainPkg.platforms[1] // 「全部」条目
check('matchesActivePath：命中', matchesActivePath(multiPath, '/list,600519.html'))
check('matchesActivePath：未命中', !matchesActivePath(multiPath, '/jj.html'))
check(
  'matchesActivePath：非法正则视为不匹配（脏配置不中断）',
  !matchesActivePath({ ...multiPath, active_paths: ['(unclosed'] }, '/list,600519.html'),
  '不应抛异常',
)

// ---------- 5. schema：url 模式虚拟分页 ----------
const baseVirtual = {
  list_selector: '.list',
  post_id: { selector: 'a.id', attr: 'data-id' },
  source_link_selector: 'a.id',
  native_pagination_selector: '.pagination',
  page_size: 10,
  max_source_pages: 20,
  wait_ms: 300,
}
const urlMode = {
  version: '1.0.0',
  platforms: [
    {
      name: 'URL 翻页平台',
      domains: ['urlmode.example.com'],
      post_selectors: ['.list > li'],
      timestamp: { selector: 'time', type: 'absolute', format: 'MM-DD HH:mm' },
      quick_presets: [],
      virtual_pagination: { ...baseVirtual, source_mode: 'url', page_url_pattern: '/list__page-{page}', start_page: 1 },
    },
  ],
}
check('schema：url 模式（含 {page} 模板）通过校验', validateAdapter(urlMode) === null, JSON.stringify(validateAdapter(urlMode)))

const clickMode = structuredClone(urlMode) as Record<string, any>
clickMode.platforms[0].virtual_pagination = { ...baseVirtual, next_selector: '.next', active_page_selector: '.page.active' }
check('schema：click 模式（缺省 source_mode）通过校验', validateAdapter(clickMode) === null, JSON.stringify(validateAdapter(clickMode)))

const missingPattern = structuredClone(urlMode) as Record<string, any>
delete missingPattern.platforms[0].virtual_pagination.page_url_pattern
check(
  'schema：url 模式缺 page_url_pattern 被拒绝',
  !!validateAdapter(missingPattern)?.some((e) => e.includes('page_url_pattern')),
  JSON.stringify(validateAdapter(missingPattern)),
)

const badPattern = structuredClone(urlMode) as Record<string, any>
badPattern.platforms[0].virtual_pagination.page_url_pattern = '/list__page'
check(
  'schema：url 模式模板缺 {page} 被拒绝',
  !!validateAdapter(badPattern)?.some((e) => e.includes('{page}')),
  JSON.stringify(validateAdapter(badPattern)),
)

const clickMissingNext = structuredClone(clickMode) as Record<string, any>
delete clickMissingNext.platforms[0].virtual_pagination.next_selector
check(
  'schema：click 模式缺 next_selector 被拒绝',
  !!validateAdapter(clickMissingNext)?.some((e) => e.includes('next_selector')),
  JSON.stringify(validateAdapter(clickMissingNext)),
)

const mixed = structuredClone(urlMode) as Record<string, any>
mixed.platforms[0].virtual_pagination.next_selector = '.next'
check(
  'schema：url 模式声明 click 专用字段被拒绝',
  !!validateAdapter(mixed)?.some((e) => e.includes('仅适用于 click')),
  JSON.stringify(validateAdapter(mixed)),
)

// ---------- 6. 发布包域名规则：同域多条目必须全部有 active_paths ----------
/** 在临时仓库副本里执行真实发布脚本（避免污染 src/adapters 与 adapters.json） */
function buildInTempRepo(adapterFiles: Record<string, unknown>): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tm-adapters-'))
  try {
    const srcAdapters = join(dir, 'src', 'adapters')
    mkdirSync(srcAdapters, { recursive: true })
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    for (const [name, pkg] of Object.entries(adapterFiles)) {
      writeFileSync(join(srcAdapters, name), JSON.stringify(pkg, null, 2))
    }
    // 脚本按 __dirname/.. 解析仓库根目录，复制到临时仓库的 scripts/ 下即可独立运行
    writeFileSync(
      join(dir, 'scripts', 'build-adapters-json.mjs'),
      readFileSync(join(repoRoot, 'scripts', 'build-adapters-json.mjs')),
    )
    const stdout = execFileSync('node', [join(dir, 'scripts', 'build-adapters-json.mjs')], { encoding: 'utf8' })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const scoped = buildInTempRepo({
  'dup.json': {
    version: '1.0.0',
    platforms: [
      { name: 'A 页面', domains: ['dup.example.com'], active_paths: ['^/a'], post_selectors: ['article'], timestamp: { selector: 'time', type: 'absolute', format: 'YYYY-MM-DD' }, quick_presets: [] },
      { name: 'B 页面', domains: ['dup.example.com'], active_paths: ['^/b'], post_selectors: ['article'], timestamp: { selector: 'time', type: 'absolute', format: 'YYYY-MM-DD' }, quick_presets: [] },
    ],
  },
})
check('同域 + 全部 active_paths 隔离 → 发布脚本通过', scoped.status === 0, scoped.stderr.slice(0, 300))
check(
  '通过时输出同域共享提示',
  scoped.stdout.includes('active_paths 隔离'),
  scoped.stdout.slice(0, 300),
)

const unscoped = buildInTempRepo({
  'dup.json': {
    version: '1.0.0',
    platforms: [
      { name: 'A 页面', domains: ['dup.example.com'], active_paths: ['^/a'], post_selectors: ['article'], timestamp: { selector: 'time', type: 'absolute', format: 'YYYY-MM-DD' }, quick_presets: [] },
      { name: 'B 页面', domains: ['dup.example.com'], post_selectors: ['article'], timestamp: { selector: 'time', type: 'absolute', format: 'YYYY-MM-DD' }, quick_presets: [] },
    ],
  },
})
check('同域 + 有条目缺 active_paths → 发布脚本拒绝', unscoped.status !== 0, `status=${unscoped.status}`)
check(
  '拒绝原因指向 active_paths 隔离',
  unscoped.stderr.includes('active_paths'),
  unscoped.stderr.slice(0, 300),
)

// 注：发布脚本本身不做 schema 校验（它只检查结构存在性与域名规则）；发布产物的 schema
// 合法性由 sites-panel.test.ts 对 adapters.json 的断言覆盖（npm test 先于发布执行）。
// 「脚本内联校验」记为 P2-22 的待办，避免发布方跳过测试直接推包。

assert.ok(true)
finish('同域多页面类型适配测试完成')
