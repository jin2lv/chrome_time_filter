/**
 * P2-20 多站授权与每站设置——支持站点能力矩阵测试
 * 运行：npx tsx test/unit/sites-panel.test.ts
 *
 * 覆盖：
 * - SUPPORTED_SITES 派生：平台数、域名/origin 映射（jisilu 双 origin）、能力摘要按配置派生、
 *   last_verified 仅出现在已真机验证的平台
 * - SUPPORTED_ORIGINS：与 manifest optional_host_permissions 一致（5 条、去重）
 * - schema：last_verified 合法值通过、非法格式拒绝；全部内置适配包仍过校验（含新字段）
 */
import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORTED_ORIGINS, SUPPORTED_SITES } from '../../src/adapters'
import { validateAdapter } from '../../src/adapters/schema'
import xueqiuAdapter from '../../src/adapters/xueqiu.json'
import thsAdapter from '../../src/adapters/ths.json'
import jisiluAdapter from '../../src/adapters/jisilu.json'
import eastmoneyNewsAdapter from '../../src/adapters/eastmoney-news.json'
import { check, finish } from '../helpers/check'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// ---------- 1. SUPPORTED_SITES 派生 ----------
check('平台条目数 = 8（雪球/同花顺/集思录/东方财富股吧×3/天天基金/东方财富资讯）', SUPPORTED_SITES.length === 8, `got ${SUPPORTED_SITES.length}`)

const byName = new Map(SUPPORTED_SITES.map((s) => [s.name, s]))
const xueqiu = byName.get('雪球')
assert.ok(xueqiu, '雪球条目必须存在')
check('雪球 domains = [xueqiu.com]', JSON.stringify(xueqiu.domains) === JSON.stringify(['xueqiu.com']))
check('雪球 origin 映射', JSON.stringify(xueqiu.origins) === JSON.stringify(['*://xueqiu.com/*']))
// last_verified / version 从内置适配包动态推导（写死会在每次合法取证更新时误报，
// 见 AGENTS.md「内置适配包升版本不破坏测试」的同类教训）
check(
  `雪球 last_verified = 适配包声明（${xueqiuAdapter.platforms[0].last_verified}）`,
  xueqiu.lastVerified === xueqiuAdapter.platforms[0].last_verified,
)
check(
  '雪球能力含 补拉/虚拟分页/评论/预设',
  xueqiu.capabilities.includes('信息流补拉') &&
    xueqiu.capabilities.includes('个股跨页扫描') &&
    xueqiu.capabilities.includes('详情评论过滤') &&
    xueqiu.capabilities.includes('快捷预设') &&
    xueqiu.capabilities.includes('帖子过滤'),
)
check(`雪球版本 = 适配包声明（${xueqiuAdapter.version}）`, xueqiu.version === xueqiuAdapter.version)

const jisilu = byName.get('集思录')
assert.ok(jisilu, '集思录条目必须存在')
check(
  '集思录双 origin（www + 裸域，§2.3 无授权死结）',
  JSON.stringify(jisilu.origins) === JSON.stringify(['*://jisilu.cn/*', '*://www.jisilu.cn/*']),
)

const ths = byName.get('同花顺')
assert.ok(ths, '同花顺条目必须存在')
check('同花顺未真机验证 → lastVerified = null', ths.lastVerified === null)
check('同花顺能力不含虚拟分页（未配置）', !ths.capabilities.includes('个股跨页扫描'))
check(
  '同花顺页面类型行 = 1（纯列表平台也要有列表页能力行，不能空白）',
  ths.pages.length === 1 && ths.pages[0].pageType === '列表页' && ths.pages[0].ordering === '仅已加载内容',
  JSON.stringify(ths.pages),
)

check('集思录能力含 帖子过滤 / 详情评论过滤 / 快捷预设', jisilu.capabilities.includes('帖子过滤') && jisilu.capabilities.includes('详情评论过滤') && jisilu.capabilities.includes('快捷预设'), JSON.stringify(jisilu.capabilities))
check(
  '集思录页面类型行 = 2（列表页 + 帖子详情页）',
  jisilu.pages.length === 2 && jisilu.pages.map((p) => p.pageType).join(',') === '列表页,帖子详情页',
  JSON.stringify(jisilu.pages.map((p) => p.pageType)),
)
check(
  '集思录评论行声明「仅已加载内容」（平台只渲染最近 99 条回复）',
  jisilu.pages.find((p) => p.pageType === '帖子详情页')?.ordering === '仅已加载内容',
  JSON.stringify(jisilu.pages.find((p) => p.pageType === '帖子详情页')),
)
check('集思录 lastVerified 与适配包声明一致（未真机验收则为 null）', jisilu.lastVerified === (jisiluAdapter.platforms[0].last_verified ?? null))
check('集思录未声明跨页聚合（保留站点原生分页）', jisilu.pages.every((p) => p.crossPage === null), JSON.stringify(jisilu.pages.map((p) => p.crossPage)))

const east = byName.get('东方财富资讯')
assert.ok(east, '东方财富资讯条目必须存在')
check('东方财富资讯能力不含评论（未配置）', !east.capabilities.includes('详情评论过滤'))

// ---------- 1b. 页面类型能力矩阵（P2-18） ----------
check('雪球 3 类页面（信息流/个股/详情）', xueqiu.pages.length === 3, JSON.stringify(xueqiu.pages.map((p) => p.pageType)))
const xueqiuFeed = xueqiu.pages.find((p) => p.pageType === '信息流')
assert.ok(xueqiuFeed, '雪球信息流页面条目必须存在')
check(
  '雪球信息流：区间✓、补拉上限 10 屏、仅已加载内容、相对时间精度',
  xueqiuFeed.interval === true &&
    xueqiuFeed.crossPage === '滚动补拉（上限 10 屏）' &&
    xueqiuFeed.ordering === '仅已加载内容' &&
    xueqiuFeed.precision.includes('相对时间'),
)
const xueqiuStock = xueqiu.pages.find((p) => p.pageType === '个股讨论页')
assert.ok(xueqiuStock, '雪球个股页条目必须存在')
check('雪球个股页：虚拟分页上限 200 原生页', xueqiuStock.crossPage === '虚拟分页（上限 200 原生页）')
const xueqiuDetail = xueqiu.pages.find((p) => p.pageType === '帖子详情页')
assert.ok(xueqiuDetail, '雪球详情页条目必须存在')
check('雪球详情页：评论过滤✓、无跨页', xueqiuDetail.comment === true && xueqiuDetail.crossPage === null)
check(
  '评论行统一声明「仅已加载内容」（引擎不驱动任何平台的评论分页）',
  SUPPORTED_SITES.every((s) => s.pages.filter((p) => p.comment).every((p) => p.ordering === '仅已加载内容')),
)
check(
  '页面类型行并不总是空的：每个平台至少有 1 行能力',
  SUPPORTED_SITES.every((s) => s.pages.length >= 1),
  JSON.stringify(SUPPORTED_SITES.map((s) => [s.name, s.pages.length])),
)
check(
  '全部平台页面行 verified 与平台级 last_verified 一致',
  SUPPORTED_SITES.every((s) => s.pages.every((p) => p.verified === (s.lastVerified !== null))),
)

// ---------- 2. SUPPORTED_ORIGINS ----------
check('SUPPORTED_ORIGINS 共 7 条（与 manifest optional 一致）', SUPPORTED_ORIGINS.length === 7, `got ${SUPPORTED_ORIGINS.length}`)
check('origin 无重复', new Set(SUPPORTED_ORIGINS).size === SUPPORTED_ORIGINS.length)
for (const origin of ['*://xueqiu.com/*', '*://t.10jqka.com.cn/*', '*://finance.eastmoney.com/*', '*://guba.eastmoney.com/*', '*://fund.eastmoney.com/*', '*://jisilu.cn/*', '*://www.jisilu.cn/*']) {
  check(`包含 ${origin}`, SUPPORTED_ORIGINS.includes(origin))
}
// 同域多页面类型条目共享同一 origin，不得因此在权限清单里出现重复项
check(
  '东方财富股吧 3 个条目共享同一 origin（去重后 1 条）',
  SUPPORTED_ORIGINS.filter((o) => o.includes('guba.eastmoney.com')).length === 1,
)
check(
  '同域多条目平台：域名字段一致、名称各异（设置页按条目列出）',
  SUPPORTED_SITES.filter((s) => s.domains.includes('guba.eastmoney.com')).map((s) => s.name).join('|') ===
    '东方财富股吧·全部与热门|东方财富股吧·最新发帖|东方财富基金吧总版',
  SUPPORTED_SITES.filter((s) => s.domains.includes('guba.eastmoney.com')).map((s) => s.name).join('|'),
)

// ---------- 3. schema：last_verified ----------
const valid = validateAdapter(xueqiuAdapter)
check('雪球适配包（含 last_verified）通过校验', valid === null, JSON.stringify(valid))

const bad = structuredClone(xueqiuAdapter) as Record<string, unknown>
;(bad.platforms as Array<Record<string, unknown>>)[0].last_verified = '2026/09/09'
const badErrs = validateAdapter(bad)
check('非法 last_verified 格式被拒绝', badErrs !== null && badErrs.some((e) => e.includes('last_verified')), JSON.stringify(badErrs))

for (const [name, pkg] of [
  ['同花顺', thsAdapter],
  ['集思录', jisiluAdapter],
  ['东方财富资讯', eastmoneyNewsAdapter],
] as const) {
  const errs = validateAdapter(pkg)
  check(`${name}适配包仍过校验`, errs === null, JSON.stringify(errs))
}

// ---------- 4. 远程发布产物（P2-19）：adapters.json 与 .sha256 必须一致且可校验 ----------
const releaseJson = readFileSync(join(repoRoot, 'adapters.json'))
const releasePkg = JSON.parse(releaseJson.toString('utf8'))
check('adapters.json 通过 schema 校验', validateAdapter(releasePkg) === null, JSON.stringify(validateAdapter(releasePkg)))
check(
  'adapters.json 覆盖全部 4 个内置平台',
  releasePkg.platforms.length === SUPPORTED_SITES.length,
  `${releasePkg.platforms.length} vs ${SUPPORTED_SITES.length}`,
)
check(
  'adapters.json 平台与内置包同源（域名集合一致）',
  JSON.stringify(releasePkg.platforms.map((p: { domains: string[] }) => p.domains).flat().sort()) ===
    JSON.stringify(SUPPORTED_SITES.map((s) => s.domains).flat().sort()),
)
const declaredSum = readFileSync(join(repoRoot, 'adapters.json.sha256'), 'utf8').trim()
const actualSum = createHash('sha256').update(releaseJson).digest('hex')
check('adapters.json.sha256 与文件内容一致（客户端校验依据）', declaredSum === actualSum, `${declaredSum} vs ${actualSum}`)
check('disabled 字段可省略（内置包不含）', releasePkg.disabled === undefined)

finish('站点能力矩阵测试完成')
