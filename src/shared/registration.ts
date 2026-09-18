/**
 * 动态内容脚本注册常量与工具（background / popup 共用）
 *
 * 注册与更新策略各自实现：background 按已授权 origin 过滤（service-worker.ts），
 * popup 在授权成功后合并当前站点（popup/main.ts）；两者必须共用同一注册 id
 * 与同一份 loader 路径读取逻辑，避免漂移。
 */

export const CONTENT_SCRIPT_ID = 'tm-main'

/**
 * 读取 content script 注入文件（CRXJS 产物为 loader，路径带 hash）。
 * 从 manifest 读取以免疫构建 hash 变化；loader 内部动态 import 实际代码。
 */
export function getContentScriptJs(): string[] {
  return chrome.runtime.getManifest().content_scripts?.[0]?.js ?? []
}
