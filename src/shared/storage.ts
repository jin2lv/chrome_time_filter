/**
 * 存储工具：状态统一存 chrome.storage.local
 *
 * key 规则（PRD F1）：
 * - timeSettings.<domain>  → 按域名的时间设置（全局同步）
 * - prefs                  → 全局偏好（默认策略、角标计数等，P2 设置页使用）
 */
import type { Adapter, FilterStrategy, TimeSettings } from './types'

const PREFIX = 'timeSettings.'
const PREFS_KEY = 'prefs'
const REMOTE_ADAPTER_KEY = 'adapters.remote'

/** 远程适配包存储结构（P2-5 热更新） */
export interface StoredRemoteAdapter {
  version: string
  package: Adapter
  updatedAt: number
}

export interface Prefs {
  /** 全局默认过滤策略 */
  defaultStrategy: FilterStrategy
  /** 适配包自动更新（每 12h，P2 实现） */
  autoUpdateAdapters: boolean
  /** 角标显示计数 */
  badgeCount: boolean
  /** 评论无时间戳时的回退策略：'show' 全部显示 / 'collapse' 默认折叠（P2-4） */
  commentNoTime: 'show' | 'collapse'
  /** 页面右下角悬浮提示条（P2-8，默认关） */
  floatingBanner: boolean
  /** 引导页完成标记（welcome.js 直接写入；当前无读取方，保留供设置迁移/审计） */
  onboarded?: boolean
}

export const DEFAULT_PREFS: Prefs = {
  defaultStrategy: 'hide',
  autoUpdateAdapters: true,
  badgeCount: true,
  commentNoTime: 'show',
  floatingBanner: false,
}

/** 读取某域名的时间设置；未设定过返回 null */
export async function getTimeSettings(domain: string): Promise<TimeSettings | null> {
  const data = await chrome.storage.local.get(PREFIX + domain)
  return (data[PREFIX + domain] as TimeSettings | undefined) ?? null
}

/** 写入某域名的时间设置（设定后立即生效，跨 Tab 由 storage.onChanged 同步） */
export async function setTimeSettings(
  domain: string,
  settings: TimeSettings,
): Promise<void> {
  await chrome.storage.local.set({ [PREFIX + domain]: settings })
}

/** 删除某域名的时间设置（重置） */
export async function removeTimeSettings(domain: string): Promise<void> {
  await chrome.storage.local.remove(PREFIX + domain)
}

/** 读取全局偏好（合并默认值） */
export async function getPrefs(): Promise<Prefs> {
  const data = await chrome.storage.local.get(PREFS_KEY)
  return { ...DEFAULT_PREFS, ...(data[PREFS_KEY] ?? {}) }
}

export async function setPrefs(patch: Partial<Prefs>): Promise<void> {
  const prefs = await getPrefs()
  await chrome.storage.local.set({ [PREFS_KEY]: { ...prefs, ...patch } })
}

/* ---- 远程适配包（P2-5 热更新） ---- */

export async function getRemoteAdapter(): Promise<StoredRemoteAdapter | null> {
  const data = await chrome.storage.local.get(REMOTE_ADAPTER_KEY)
  return (data[REMOTE_ADAPTER_KEY] as StoredRemoteAdapter | undefined) ?? null
}

export async function setRemoteAdapter(pkg: Adapter): Promise<void> {
  const entry: StoredRemoteAdapter = {
    version: pkg.version,
    package: pkg,
    updatedAt: Date.now(),
  }
  await chrome.storage.local.set({ [REMOTE_ADAPTER_KEY]: entry })
}

/** 清空远程适配包（P2-19 应急停用：发布方置 disabled 时回退内置包） */
export async function clearRemoteAdapter(): Promise<void> {
  await chrome.storage.local.remove(REMOTE_ADAPTER_KEY)
}

/** 域名辅助：从 location.hostname 提取规范化域名（如 xueqiu.com） */
export function extractDomain(hostname: string): string {
  return hostname.replace(/^www\./, '')
}
