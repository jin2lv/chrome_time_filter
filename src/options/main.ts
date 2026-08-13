/**
 * Options 设置页（P2-6 完善）
 *
 * 配置项（PRD F5）：
 * - 默认过滤策略（hide/collapse）
 * - 角标显示计数
 * - 评论无时间戳回退策略（P2-4：全部显示/默认折叠）
 * - 已授权站点管理（chrome.permissions：列出/移除）
 * - 适配包版本信息（内置包列表）
 * - 适配包自动更新开关（P2-5 使用）
 */
import { BUILTIN_VERSIONS } from '../adapters'
import { getPrefs, setPrefs } from '../shared/storage'

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el as T
}

async function init(): Promise<void> {
  const prefs = await getPrefs()

  const strategy = $<HTMLSelectElement>('pref-strategy')
  const badge = $<HTMLInputElement>('pref-badge')
  const autoUpdate = $<HTMLInputElement>('pref-autoupdate')
  const commentNoTime = $<HTMLSelectElement>('pref-comment-notime')
  const banner = $<HTMLInputElement>('pref-banner')

  strategy.value = prefs.defaultStrategy
  badge.checked = prefs.badgeCount
  autoUpdate.checked = prefs.autoUpdateAdapters
  commentNoTime.value = prefs.commentNoTime
  banner.checked = prefs.floatingBanner

  strategy.addEventListener('change', () =>
    setPrefs({ defaultStrategy: strategy.value as 'hide' | 'collapse' }),
  )
  badge.addEventListener('change', () => setPrefs({ badgeCount: badge.checked }))
  autoUpdate.addEventListener('change', () =>
    setPrefs({ autoUpdateAdapters: autoUpdate.checked }),
  )
  commentNoTime.addEventListener('change', () =>
    setPrefs({ commentNoTime: commentNoTime.value as 'show' | 'collapse' }),
  )
  banner.addEventListener('change', () => setPrefs({ floatingBanner: banner.checked }))

  // 版本信息
  $('subtitle').textContent = `v${chrome.runtime.getManifest().version}`
  renderAdapters()
  void renderPermissions()
  bindNavigation()
}

function bindNavigation(): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.settings-nav a')]
  links.forEach((link) => {
    link.addEventListener('click', () => {
      links.forEach((item) => item.classList.toggle('active', item === link))
    })
  })
}

/** 内置适配包列表 */
function renderAdapters(): void {
  const ul = $('adapter-list')
  ul.innerHTML = ''
  for (const p of BUILTIN_VERSIONS) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = `${p.name}适配包`
    const version = document.createElement('span')
    version.className = 'version-tag'
    version.textContent = `v${p.version} · 内置`
    li.append(name, version)
    ul.appendChild(li)
  }
}

/** 已授权站点（optional host permissions） */
async function renderPermissions(): Promise<void> {
  const ul = $('permission-list')
  ul.innerHTML = ''
  const perms = await chrome.permissions.getAll()
  const origins = (perms.origins ?? []).filter((o) => o.startsWith('*://'))
  if (origins.length === 0) {
    const li = document.createElement('li')
    li.textContent = '（尚未授权任何站点）'
    ul.appendChild(li)
    return
  }
  for (const origin of origins) {
    const li = document.createElement('li')
    li.className = 'perm-row'
    const span = document.createElement('span')
    span.textContent = origin.replace('*://', '').replace('/*', '')
    const btn = document.createElement('button')
    btn.textContent = '移除'
    btn.className = 'remove-btn'
    btn.addEventListener('click', async () => {
      await chrome.permissions.remove({ origins: [origin] })
      void renderPermissions()
    })
    li.append(span, btn)
    ul.appendChild(li)
  }
}

init().catch((err) => console.error('[时光机] options init failed', err))
