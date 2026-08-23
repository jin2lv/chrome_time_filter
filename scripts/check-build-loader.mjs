/**
 * Verify that CRXJS points the MV3 service-worker loader at the background
 * chunk, not the content-script chunk. Both source files used to be named
 * index.ts, which can make a successful build produce a broken loader.
 *
 * Usage: node scripts/check-build-loader.mjs [dist-directory]
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outputDir = resolve(root, process.argv[2] ?? 'dist')
const manifestPath = resolve(outputDir, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const serviceWorker = manifest.background?.service_worker

if (typeof serviceWorker !== 'string' || !serviceWorker) {
  throw new Error('构建产物缺少 manifest.background.service_worker')
}

const loader = readFileSync(resolve(outputDir, serviceWorker), 'utf8')
const importMatch = loader.match(/import\s+['"](\.\/[^'"]+)['"]/)
if (!importMatch) {
  throw new Error(`${serviceWorker} 未找到静态 background chunk import`)
}

const chunkPath = resolve(outputDir, importMatch[1])
const chunk = readFileSync(chunkPath, 'utf8')
if (!chunk.includes('Service Worker')) {
  throw new Error(
    `${serviceWorker} 指向的 ${importMatch[1]} 不是 background chunk（缺少 Service Worker 标记）`,
  )
}

console.log(`[check-build-loader] ${serviceWorker} -> ${importMatch[1]} ✅`)
