/**
 * 扫描状态文案（P2-17 切片 2：统一状态契约的唯一文案来源）
 *
 * 供 Popup（scanStatusText）与诊断报告（scanDiagnosticLine）共用：
 * - 单位双语义：pages=原生页码扫描（虚拟分页）；screens=信息流滚动/补拉
 * - 状态：idle / loading / exhausted / limit / cancelled / error
 */
import type { ScanProgress } from './types'

/** 人类可读状态文案（Popup 展示） */
export function scanStatusText(scan: ScanProgress): string {
  const { state, scannedPages: scanned, maxPages: max, unit } = scan
  if (unit === 'screens') {
    if (state === 'loading') return `正在查找更早的帖子，已加载 ${scanned} 屏。`
    if (state === 'exhausted') return `已加载 ${scanned} 屏，到达信息流末页。`
    if (state === 'limit') return `已加载 ${scanned} 屏，达到 ${max} 屏安全上限。`
    if (state === 'cancelled') return `补拉已取消，已加载 ${scanned} 屏。`
    if (state === 'error') return `信息流加载失败，已加载 ${scanned} 屏。`
    return scanned > 0 ? `已加载 ${scanned} 屏。` : ''
  }
  if (state === 'loading') return `正在跨页查找，已扫描 ${scanned} 个原生页面。`
  if (state === 'exhausted') return `已扫描 ${scanned} 个原生页面，并到达网站末页。`
  if (state === 'limit') return `已扫描 ${scanned} 个原生页面，达到 ${max} 页安全上限。`
  if (state === 'cancelled') return `扫描已取消，已扫描 ${scanned} 个原生页面。`
  if (state === 'error') return `原生页面加载失败，结果可能不完整；已扫描 ${scanned} 页。`
  return scanned > 0 ? `已扫描 ${scanned} 个原生页面。` : ''
}

/** 脱敏诊断报告用的单行状态（P2-15/P2-19：仅状态与计数，无页面内容） */
export function scanDiagnosticLine(scan: ScanProgress | null | undefined): string | null {
  if (!scan) return null
  const unit = scan.unit === 'screens' ? '屏' : '原生页'
  return `扫描=${scan.state} | 单位=${unit} | 已扫描 ${scan.scannedPages}/${scan.maxPages}${
    scan.currentSourcePage ? ` | 当前原始页=${scan.currentSourcePage}` : ''
  }`
}
