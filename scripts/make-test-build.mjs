/**
 * 生成临时测试构建 dist-test/：
 * 复制 dist/ 并在 manifest 追加必需 host_permissions（*://xueqiu.com/*），
 * 使动态注册的 content script 在无授权交互下也能注入（仅供本地端到端测试，
 * 正式 manifest 不受影响）。
 *
 * 用法：node scripts/make-test-build.mjs
 */
import { cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const src = resolve(root, 'dist')
const dst = resolve(root, 'dist-test')

// 注意：Windows 下 WorkBuddy 的 safe-delete shim 会拦截 fs.rmSync，
// 故采用覆盖式复制（旧 hash 残留无害），不删除目标目录
mkdirSync(dst, { recursive: true })
cpSync(src, dst, { recursive: true })

const mfPath = resolve(dst, 'manifest.json')
const mf = JSON.parse(readFileSync(mfPath, 'utf-8'))
// 测试构建：所有目标平台 host_permissions 预授予，避免按需授权弹窗阻塞自动化。
// origin 清单直接取自 manifest 的 optional_host_permissions，与构建配置单源。
mf.host_permissions = mf.optional_host_permissions ?? []
// 测试构建标识，避免误加载到正式环境
mf.name = mf.name + ' (test)'
// unpacked 加载时 key 字段会引发 manifest 校验异常（id 与路径不符），测试构建移除
delete mf.key
writeFileSync(mfPath, JSON.stringify(mf, null, 2))

console.log('[make-test-build] dist-test 已生成, host_permissions:', mf.host_permissions)
