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
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const SOURCES = ['xueqiu.json', 'ths.json', 'jisilu.json', 'eastmoney-news.json']
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

// 域名重复检查：同一域名只能由一个平台声明（客户端按域名取最高版本包再 find 平台）
const seen = new Map()
for (const platform of platforms) {
  for (const domain of platform.domains) {
    if (seen.has(domain)) {
      console.error(`✗ 域名重复声明: ${domain}（${seen.get(domain)} 与 ${platform.name}）`)
      process.exit(1)
    }
    seen.set(domain, platform.name)
  }
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
