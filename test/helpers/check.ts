/**
 * 手写断言辅助（无测试框架）：失败置 process.exitCode = 1，由 finish 汇总退出。
 *
 * 用法：
 *   import { check, finish } from '../helpers/check'
 *   check('场景', cond, detail)
 *   finish('XX 测试完成')
 */
let pass = 0

export function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    console.log(`  ❌ ${name} ${detail}`)
    process.exitCode = 1
  }
}

/** 输出汇总；存在失败项时以非零码退出（供 npm test 的 && 链感知） */
export function finish(label: string): void {
  console.log(`\n${label}: ${pass} 项通过`)
  if (process.exitCode === 1) {
    console.error('存在失败项')
    process.exit(1)
  }
}
