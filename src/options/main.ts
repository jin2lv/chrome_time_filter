/**
 * Options 设置页（P2-6 完善，P2-20 多站授权与每站设置）
 *
 * 配置项（PRD F5）：
 * - 默认过滤策略（hide/collapse）
 * - 角标显示计数
 * - 评论无时间戳回退策略（P2-4：全部显示/默认折叠）
 * - 站点与适配（P2-20）：支持站点能力矩阵（平台+授权状态+版本+验证日期+能力摘要）、
 *   单站授权/撤销、「授权全部金融站点」（用户主动点击，绝不静默申请）、
 *   每站时间设置记忆摘要与重置（timeSettings.<domain>）
 * - 适配包版本信息（内置包列表）
 * - 适配包自动更新开关（P2-5 使用）
 */
import { BUILTIN_VERSIONS, SUPPORTED_ORIGINS, SUPPORTED_SITES } from '../adapters'
import { getPrefs, getTimeSettings, removeTimeSettings, setPrefs } from '../shared/storage'

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
  void renderSites()
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

/** 已授权 origin 集合（optional host permissions） */
async function grantedOrigins(): Promise<Set<string>> {
  const perms = await chrome.permissions.getAll()
  return new Set((perms.origins ?? []).filter((o) => o.startsWith('*://')))
}

function describeMode(mode: 'cutoff' | 'window' | undefined): string {
  return mode === 'window' ? '区间' : '截止'
}

function describeStrategy(strategy: string | undefined): string {
  return strategy === 'collapse' ? '折叠' : '隐藏'
}

/**
 * 支持站点能力矩阵（P2-20）：
 * 平台 + 授权状态 + 单站授权/撤销 + 版本/验证日期/能力摘要 + 每站时间设置记忆（摘要/重置）。
 * 「授权全部金融站点」为用户主动点击的一次性申请，绝不自动调用。
 */
async function renderSites(): Promise<void> {
  const ul = $('site-list')
  ul.innerHTML = ''
  const granted = await grantedOrigins()

  for (const site of SUPPORTED_SITES) {
    const isGranted = site.origins.every((o) => granted.has(o))
    const li = document.createElement('li')
    li.className = 'site-row'

    const head = document.createElement('div')
    head.className = 'site-head'

    const name = document.createElement('span')
    name.className = 'site-name'
    name.textContent = site.name
    const domain = document.createElement('span')
    domain.className = 'site-domain'
    domain.textContent = site.domains.join(' / ')

    const status = document.createElement('span')
    status.className = `site-status ${isGranted ? 'granted' : 'not-granted'}`
    status.textContent = isGranted ? '已授权' : '未授权'

    const action = document.createElement('button')
    action.className = isGranted ? 'remove-btn' : 'grant-btn'
    action.textContent = isGranted ? '移除' : '授权'
    action.addEventListener('click', async () => {
      if (isGranted) {
        await chrome.permissions.remove({ origins: site.origins })
      } else {
        const ok = await chrome.permissions.request({ origins: site.origins })
        if (!ok) return
      }
      void renderSites()
    })

    head.append(name, domain, status, action)

    const meta = document.createElement('div')
    meta.className = 'site-meta'
    const verified = site.lastVerified ? `验证于 ${site.lastVerified}` : '未真机验证'
    meta.textContent = `适配包 v${site.version} · ${verified} · 能力：${site.capabilities.join('、')}`

    const memory = document.createElement('div')
    memory.className = 'site-memory'
    const primaryDomain = site.domains[0]
    const saved = await getTimeSettings(primaryDomain)
    if (saved && (saved.cutoff !== null || saved.window)) {
      memory.textContent = `已记忆时间设置：${describeMode(saved.mode)} · ${describeStrategy(saved.strategy)}`
      const reset = document.createElement('button')
      reset.textContent = '重置此站点设置'
      reset.className = 'remove-btn reset-btn'
      reset.addEventListener('click', async () => {
        await removeTimeSettings(primaryDomain)
        void renderSites()
      })
      memory.append(reset)
    } else {
      memory.textContent = '未记忆时间设置（首次在该站点设定后保存）'
    }

    li.append(head, meta, memory)

    // 页面类型能力矩阵（P2-18）：列表/评论/区间/跨页/时间精度/排序完整性
    if (site.pages.length > 0) {
      const details = document.createElement('details')
      details.className = 'site-pages'
      const summary = document.createElement('summary')
      summary.textContent = `页面类型能力（${site.pages.length} 类）`
      const table = document.createElement('table')
      table.className = 'pages-table'
      const thead = document.createElement('thead')
      thead.innerHTML =
        '<tr><th>页面类型</th><th>评论</th><th>区间</th><th>跨页</th><th>时间精度</th><th>排序完整性</th><th>已验证</th></tr>'
      const tbody = document.createElement('tbody')
      for (const page of site.pages) {
        const tr = document.createElement('tr')
        const cells = [
          page.pageType,
          page.comment ? '✓' : '—',
          page.interval ? '✓' : '—',
          page.crossPage ?? '仅已加载内容',
          page.precision,
          page.ordering,
          page.verified ? '✓' : '未验证',
        ]
        for (const cell of cells) {
          const td = document.createElement('td')
          td.textContent = cell
          tr.appendChild(td)
        }
        tbody.appendChild(tr)
      }
      table.append(thead, tbody)
      details.append(summary, table)
      li.append(details)
    }

    ul.appendChild(li)
  }

  const grantAll = $<HTMLButtonElement>('grant-all-btn')
  grantAll.onclick = async () => {
    await chrome.permissions.request({ origins: SUPPORTED_ORIGINS })
    void renderSites()
  }

  // 平台之外的其他已授权 origin（如 dist-test 预授予条目），有则列出
  const others = [...granted].filter((o) => !SUPPORTED_ORIGINS.includes(o))
  const box = $('other-origins')
  if (others.length === 0) {
    box.hidden = true
    return
  }
  box.hidden = false
  const otherUl = $('other-origins-list')
  otherUl.innerHTML = ''
  for (const origin of others) {
    const li = document.createElement('li')
    li.className = 'perm-row'
    const span = document.createElement('span')
    span.textContent = origin.replace('*://', '').replace('/*', '')
    const btn = document.createElement('button')
    btn.textContent = '移除'
    btn.className = 'remove-btn'
    btn.addEventListener('click', async () => {
      await chrome.permissions.remove({ origins: [origin] })
      void renderSites()
    })
    li.append(span, btn)
    otherUl.appendChild(li)
  }
}

init().catch((err) => console.error('[时光机] options init failed', err))
