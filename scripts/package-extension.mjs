#!/usr/bin/env node
/**
 * 打包时光机扩展用于 Chrome Web Store 提交。
 * - 复制 dist/ 到临时目录
 * - 剥离 manifest 中的开发用 `key`（商店会分配自己的 ID）
 * - 压缩为 artifacts/timemachine-v<version>.zip
 *
 * 用法：node scripts/package-extension.mjs  （或 npm run package）
 */
import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const distDir = join(root, 'dist')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const outName = `timemachine-v${version}.zip`
const artifactsDir = join(root, 'artifacts')
const tmpDir = join(root, '.store-build')

// 尽力而为的清理：本机 Windows safe-delete shim 可能拦截 rmSync（与 Vite emptyOutDir 同源问题），
// 清理失败不应掩盖打包成功。
function safeRm(target) {
  try {
    rmSync(target, { recursive: true, force: true })
  } catch {
    /* 清理失败可忽略，残留 .store-build/ 由 bash `rm -rf .store-build` 处理 */
  }
}

if (!existsSync(distDir)) {
  console.error('✗ dist/ 不存在，请先运行 npm run build')
  process.exit(1)
}

// 准备临时目录：拷贝 dist，剥离开发用 key
safeRm(tmpDir)
mkdirSync(tmpDir, { recursive: true })
cpSync(distDir, tmpDir, { recursive: true })

const manifestPath = join(tmpDir, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.key) {
  delete manifest.key
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log('· 已从 manifest 剥离开发用 key（商店会分配自己的 ID）')
}

mkdirSync(artifactsDir, { recursive: true })
const outPath = join(artifactsDir, outName)
rmSync(outPath, { force: true })

function zipWithCli() {
  try {
    execSync(`zip -r -q "${outPath}" .`, { cwd: tmpDir, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function zipWithPowerShell() {
  try {
    execSync(
      `powershell.exe -NoProfile -Command "Compress-Archive -Path '${tmpDir}/*' -DestinationPath '${outPath}' -Force"`,
      { stdio: 'ignore' }
    )
    return true
  } catch {
    return false
  }
}

const ok = zipWithCli() || zipWithPowerShell()
safeRm(tmpDir)

if (!ok) {
  console.error('✗ 压缩失败：环境中未找到 zip 或 PowerShell')
  process.exit(1)
}

console.log(`✓ 已生成 ${outPath}`)
console.log('  下一步：在 Chrome 开发者模式加载该 zip 验证，或直接上传到 Chrome Web Store 控制台。')
