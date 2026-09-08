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
import { SUPPORTED_ORIGINS, SUPPORTED_SITES } from '../../src/adapters'
import { validateAdapter } from '../../src/adapters/schema'
import xueqiuAdapter from '../../src/adapters/xueqiu.json'
import thsAdapter from '../../src/adapters/ths.json'
import jisiluAdapter from '../../src/adapters/jisilu.json'
import eastmoneyNewsAdapter from '../../src/adapters/eastmoney-news.json'

let pass = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    console.log(`  ❌ ${name} ${detail}`)
    process.exitCode = 1
  }
}

// ---------- 1. SUPPORTED_SITES 派生 ----------
check('平台数 = 4', SUPPORTED_SITES.length === 4, `got ${SUPPORTED_SITES.length}`)

const byName = new Map(SUPPORTED_SITES.map((s) => [s.name, s]))
const xueqiu = byName.get('雪球')
assert.ok(xueqiu, '雪球条目必须存在')
check('雪球 domains = [xueqiu.com]', JSON.stringify(xueqiu.domains) === JSON.stringify(['xueqiu.com']))
check('雪球 origin 映射', JSON.stringify(xueqiu.origins) === JSON.stringify(['*://xueqiu.com/*']))
check('雪球 last_verified = 2026-09-09', xueqiu.lastVerified === '2026-09-09')
check(
  '雪球能力含 补拉/虚拟分页/评论/预设',
  xueqiu.capabilities.includes('信息流补拉') &&
    xueqiu.capabilities.includes('个股跨页扫描') &&
    xueqiu.capabilities.includes('详情评论过滤') &&
    xueqiu.capabilities.includes('快捷预设') &&
    xueqiu.capabilities.includes('帖子过滤'),
)
check('雪球版本 0.4.0', xueqiu.version === '0.4.0')

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

const east = byName.get('东方财富资讯')
assert.ok(east, '东方财富资讯条目必须存在')
check('东方财富资讯能力不含评论（未配置）', !east.capabilities.includes('详情评论过滤'))

// ---------- 2. SUPPORTED_ORIGINS ----------
check('SUPPORTED_ORIGINS 共 5 条（与 manifest optional 一致）', SUPPORTED_ORIGINS.length === 5, `got ${SUPPORTED_ORIGINS.length}`)
check('origin 无重复', new Set(SUPPORTED_ORIGINS).size === SUPPORTED_ORIGINS.length)
for (const origin of ['*://xueqiu.com/*', '*://t.10jqka.com.cn/*', '*://finance.eastmoney.com/*', '*://jisilu.cn/*', '*://www.jisilu.cn/*']) {
  check(`包含 ${origin}`, SUPPORTED_ORIGINS.includes(origin))
}

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

console.log(`\n站点能力矩阵测试完成: ${pass} 项通过`)
if (process.exitCode === 1) process.exit(1)
