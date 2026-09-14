/**
 * 扫描状态文案测试（P2-17 切片 2：Popup 与诊断报告共用 shared/scan-text.ts）
 * 运行：npx tsx test/unit/scan-status.test.ts
 *
 * 覆盖：
 * - scanStatusText：screens / pages 双单位 × idle/loading/exhausted/limit/cancelled/error
 * - scanDiagnosticLine：脱敏诊断行（状态/单位/计数/当前原始页），无扫描时返回 null
 */
import assert from 'node:assert'
import { scanDiagnosticLine, scanStatusText } from '../../src/shared/scan-text'
import type { ScanProgress } from '../../src/shared/types'

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

const screens = (state: ScanProgress['state'], scanned = 3, max = 10): ScanProgress => ({
  state,
  scannedPages: scanned,
  maxPages: max,
  currentSourcePage: '',
  unit: 'screens',
})
const pages = (state: ScanProgress['state'], scanned = 2, max = 200): ScanProgress => ({
  state,
  scannedPages: scanned,
  maxPages: max,
  currentSourcePage: '2',
})

check('screens/loading', scanStatusText(screens('loading')) === '正在查找更早的帖子，已加载 3 屏。', scanStatusText(screens('loading')))
check('screens/exhausted', scanStatusText(screens('exhausted')) === '已加载 3 屏，到达信息流末页。')
check('screens/limit', scanStatusText(screens('limit')) === '已加载 3 屏，达到 10 屏安全上限。')
check('screens/cancelled', scanStatusText(screens('cancelled')) === '补拉已取消，已加载 3 屏。')
check('screens/error', scanStatusText(screens('error')).includes('信息流加载失败'))
check('screens/idle 有屏数', scanStatusText(screens('idle')) === '已加载 3 屏。')
check('screens/idle 零屏数 → 空串', scanStatusText(screens('idle', 0)) === '')

check('pages/loading', scanStatusText(pages('loading')) === '正在跨页查找，已扫描 2 个原生页面。')
check('pages/exhausted', scanStatusText(pages('exhausted')) === '已扫描 2 个原生页面，并到达网站末页。')
check('pages/limit', scanStatusText(pages('limit')) === '已扫描 2 个原生页面，达到 200 页安全上限。')
check('pages/cancelled', scanStatusText(pages('cancelled')) === '扫描已取消，已扫描 2 个原生页面。')
check('pages/error', scanStatusText(pages('error')).includes('原生页面加载失败'))
check('pages/idle 有页数', scanStatusText(pages('idle')) === '已扫描 2 个原生页面。')
check('缺省 unit 视为 pages', scanStatusText({ ...pages('idle'), unit: undefined }) === '已扫描 2 个原生页面。')

check('diagnostic：无扫描 → null', scanDiagnosticLine(null) === null && scanDiagnosticLine(undefined) === null)
const d1 = scanDiagnosticLine(screens('loading'))!
check('diagnostic：screens 单位与计数', d1 === '扫描=loading | 单位=屏 | 已扫描 3/10', d1)
const d2 = scanDiagnosticLine(pages('exhausted'))!
check('diagnostic：pages 单位与当前原始页', d2 === '扫描=exhausted | 单位=原生页 | 已扫描 2/200 | 当前原始页=2', d2)
check(
  'diagnostic：不含页面 URL/正文等敏感字段',
  !d1.includes('http') && !d2.includes('http') && !/帖子|评论/.test(d1 + d2),
)

console.log(`\n扫描状态文案测试完成: ${pass} 项通过`)
if (process.exitCode === 1) process.exit(1)
