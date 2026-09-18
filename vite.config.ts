import { defineConfig } from 'vite'
import { crx, defineManifest } from '@crxjs/vite-plugin'

/**
 * 平台 origin 单一清单：optional_host_permissions 与 web_accessible_resources.matches
 * 共用，避免两处手抄漂移。新增平台时需同步在 src/adapters/ 注册适配包。
 */
const SITE_ORIGINS = [
  '*://xueqiu.com/*',
  '*://t.10jqka.com.cn/*',
  '*://finance.eastmoney.com/*',
  '*://jisilu.cn/*',
  '*://www.jisilu.cn/*',
]

/**
 * TimeMachine 时光机 — Manifest V3 扩展清单
 *
 * 权限模型（按需授权）：
 * - permissions 仅声明 storage + scripting（安装时零 host 权限）
 * - scripting 用于动态注册 content script（P1 起）
 * - 平台域名全部走 optional_host_permissions，用户首次访问时按需请求
 * - P1 起：content script 经 chrome.scripting.registerContentScripts 动态注入
 *   （不再用静态 content_scripts 声明，避免安装时泄露 host 权限）
 */
const manifest = defineManifest({
  manifest_version: 3,
  name: '时光机',
  version: '1.0.0',
  description: '只看到指定时间点之前发布的帖子，过滤其后的内容。',
  minimum_chrome_version: '110',
  // 固定扩展 id（开发调试/动态注入需要稳定 id）。
  // key 对应私钥：scripts/keys/timemachine-dev.pem（仅开发用，勿泄露；生产上架需自行保管私钥）
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv3ZArRRhcxg1M3PGYLDAi1HCP5CBAR0kWVvkuN4nwmqmM++UIZWSVTu3wETevK4l9Dm9XBYTlJ9HkcQxR2UMFlRhAn679tw7OwUsyIcxqNYs6OflPE9CfCocF1VBJAQ4gRLZ3KYxyrW6nZv+6Ue7xgQ8XfW21WIEUgw3/6YjGNgwPolhV0ouHRr2xELTOe1LT+u8VGUytd5Y50U1sWJ+AzpYp7phg+seI5aVFi6V3odqcHtTH8eeZnbW7JVlaoPhF/MLYYwfnnMOB0p/6hayDXttMu163Vyx5Xm0UFxC9JUIs03FBsGvjjWcHEmc8az2ghdNIEh2qFcLFEW+B3GjVwIDAQAB',

  action: {
    default_title: '时光机',
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'public/icons/icon16.png',
      32: 'public/icons/icon32.png',
      48: 'public/icons/icon48.png',
      128: 'public/icons/icon128.png',
    },
  },

  options_page: 'src/options/index.html',

  background: {
    // Keep a distinct basename from content/index.ts: CRXJS uses entry
    // basenames when generating loader imports, and duplicate index.ts
    // entries can point the service worker loader at the content chunk.
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  // content_scripts 声明：matches 不能留空（Chrome 加载已解压扩展时
  // 校验拒绝 []），故填 `*://localhost/*`——正常浏览几乎不会匹配，
  // 即使触发 content script 找不到适配包也直接退出，无副作用。
  // 实际各平台注入走 background 动态注册（chrome.scripting.registerContentScripts，
  // 配合 optional_host_permissions 按需授权，见 src/background/service-worker.ts）。
  content_scripts: [
    {
      matches: ['*://localhost/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],

  // `activeTab` lets the popup inspect the URL of the tab the user explicitly
  // invoked it from. Site access itself remains opt-in via optional hosts.
  permissions: ['activeTab', 'storage', 'scripting', 'alarms'],
  optional_host_permissions: SITE_ORIGINS,

  // CRXJS turns the declared content script into a small loader which imports
  // the actual module at runtime. Those modules must be web-accessible to the
  // pages that can receive the dynamically registered script.
  web_accessible_resources: [
    {
      resources: ['assets/*'],
      matches: SITE_ORIGINS,
    },
  ],

  // P2-7：全局快捷键（Ctrl+Shift+T 与 Chrome 内置「重新打开已关闭标签页」冲突，2026-09-07 真机实测被抢占；设置页自定义快捷键 Chrome 限制为修饰键+字母，P2-6 待补）
  commands: {
    'toggle-filter': {
      suggested_key: { default: 'Alt+Shift+T' },
      description: '切换当前标签页的过滤开关',
    },
  },

  icons: {
    16: 'public/icons/icon16.png',
    32: 'public/icons/icon32.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
})

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    // 注意：Windows 下 WorkBuddy 的 safe-delete shim 会拦截 Vite 对 dist/
    // 的整目录清空（trash 操作失败抛错）。故关闭 emptyOutDir，构建以覆盖方式
    // 写入同名文件；如需彻底清空，先手动执行 `rm -rf dist`。
    emptyOutDir: false,
    rollupOptions: {
      output: {
        // content script 产物路径由 background 动态读取
        // chrome.runtime.getManifest().content_scripts[0].js[0] 引用（对 hash 免疫），
        // 见 src/background/service-worker.ts
      },
    },
  },
})
