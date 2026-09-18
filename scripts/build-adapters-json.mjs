#!/usr/bin/env node
/**
 * 生成远程发布用的聚合适配包（P2-19）
 *
 * 把内置的 4 个适配包合并成单个 `adapters.json`（Adapter 结构：version + platforms[]），
 * 并生成随包发布的 `adapters.json.sha256`（客户端拉取后先校验和再解析）。
 *
 * 为什么生成而不是手写：内置包在 src/adapters/*.json，手写发布包必然漂移；
 * 发布流程固定为：改内置包 → `npm run adapters:build [-- --version x.y.z]` → 提交推送 → 可选 purge CDN。
 *
 * 版本约定：聚合包版本独立于扩展版本，单调递增（客户端不接受降级；回退用递增版本发布旧内容）。
 *
 * 用法：node scripts/build-adapters-json.mjs [--version 1.0.1]
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// 自动收录 src/adapters 下全部适配包 JSON（新增平台只需放入文件，无需维护第二份清单）。
// 输出顺序：已知平台按既有发布顺序，新增文件按文件名排序追加，避免无意义的重排 diff。
const ALL_SOURCES = new Set(
  readdirSync(join(root, 'src/adapters')).filter((file) => file.endsWith('.json')),
)
const PREFERRED_ORDER = ['xueqiu.json', 'ths.json', 'jisilu.json', 'guba.json', 'fund.json', 'eastmoney-news.json']
const SOURCES = [
  ...PREFERRED_ORDER.filter((file) => ALL_SOURCES.has(file)),
  ...[...ALL_SOURCES].filter((file) => !PREFERRED_ORDER.includes(file)).sort(),
]
const DEFAULT_VERSION = '1.0.0'

const versionArgIndex = process.argv.indexOf('--version')
const version = versionArgIndex >= 0 ? process.argv[versionArgIndex + 1] : DEFAULT_VERSION
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`✗ 版本号不合法: ${version}（应形如 1.0.0）`)
  process.exit(1)
}

const platforms = []
for (const file of SOURCES) {
  const pkg = JSON.parse(readFileSync(join(root, 'src/adapters', file), 'utf8'))
  if (!Array.isArray(pkg.platforms) || pkg.platforms.length === 0) {
    console.error(`✗ ${file} 缺少 platforms`)
    process.exit(1)
  }
  for (const platform of pkg.platforms) {
    if (!Array.isArray(platform.domains) || platform.domains.length === 0) {
      console.error(`✗ ${file} 的 ${platform.name} 缺少 domains`)
      process.exit(1)
    }
    platforms.push(platform)
  }
}

// 域名重复检查：同一域名允许多个页面类型条目共存（如 guba.eastmoney.com 的个股吧与
// 基金吧总版模板/时间语义不同），但必须**全部**用 active_paths 做路径隔离——客户端
// getAdapterFor 按 pathname 取首个命中，无作用域的条目会让其余条目永远不可达。
const byDomain = new Map()
for (const platform of platforms) {
  for (const domain of platform.domains) {
    if (!byDomain.has(domain)) byDomain.set(domain, [])
    byDomain.get(domain).push(platform)
  }
}
for (const [domain, list] of byDomain) {
  if (list.length === 1) continue
  const unscoped = list.filter((p) => !Array.isArray(p.active_paths) || p.active_paths.length === 0)
  if (unscoped.length > 0) {
    console.error(
      `✗ 域名 ${domain} 被多个平台条目声明但缺少 active_paths 隔离：` +
        `${list.map((p) => p.name).join('、')}（缺作用域：${unscoped.map((p) => p.name).join('、')}）`,
    )
    console.error('  同域多页面类型必须各自声明互不重叠的 active_paths（pathname 正则）')
    process.exit(1)
  }
  console.log(
    `  · ${domain} 由 ${list.length} 个页面类型条目共享（active_paths 隔离）：${list.map((p) => p.name).join('、')}`,
  )
}

const aggregate = { version, platforms }
const json = JSON.stringify(aggregate, null, 2) + '\n'
const checksum = createHash('sha256').update(json, 'utf8').digest('hex')

writeFileSync(join(root, 'adapters.json'), json)
writeFileSync(join(root, 'adapters.json.sha256'), checksum + '\n')

console.log(`✓ adapters.json 已生成：v${version}，${platforms.length} 个平台`)
console.log(`  平台：${platforms.map((p) => p.name).join('、')}`)
console.log(`  sha256：${checksum}`)
console.log('  发布：提交推送后可选 purge CDN：')
console.log(`    https://purge.jsdelivr.net/gh/jin2lv/chrome_time_filter@main/adapters.json`)
