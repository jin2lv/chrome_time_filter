# AGENTS.md — TimeMachine 时光机（Chrome MV3 扩展）

按指定时间点隐藏"之后发布"的帖子（雪球/同花顺）。设计权威来源：`PRD-v1.0.md` 与 `DEV-PLAN.md`（顶部"开发/测试交接记录"是当前未提交基线的唯一真相）。仓库内注释与文档为中文，commit message 用英文 conventional（`feat:`/`fix:`）。

## 验证命令（顺序执行）

```bash
npm test                # 唯一测试入口：package.json 中硬编码 12 个 tsx 文件
npx tsc --noEmit        # 类型检查（tsconfig include 只含 src/，test/ 不参与检查）
npm run build           # 产物 dist/（CRXJS loader + hash 文件名）
git diff --check
```

- **新增测试文件必须手动追加到 `package.json` 的 `test` 脚本**，否则不会被运行。
- 无 lint / 无测试框架：测试 = `node:assert` + `JSDOM` + 手写 chrome mock，顶层断言抛错即失败。单跑：`npx tsx test/unit/xueqiu-backfill.test.ts`。
- **Vite 配置了 `emptyOutDir: false`**（Windows safe-delete 拦截 quirk），dist/ 会残留旧 hash 文件；干净构建先 `rm -rf dist`。

## 构建产物与打包

- `npm run test:build` → `dist-test/`：从 dist/ 复制并在 manifest 追加 `*://xueqiu.com/*` host_permissions、**删除 `key`**（unpacked 加载时 key 与路径不符会校验报错）。
- `npm run package` → `artifacts/timemachine-v<version>.zip`（商店包，剥离开发 key）。
- `node scripts/e2e.mjs`：真实 Chrome e2e（mock 雪球页 + 过滤断言）。**仅限 Windows 本机**：硬编码 `C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core`，且需先 build + test:build。

## 架构关键（易踩坑）

- **按需授权模型**：manifest 的 `content_scripts` 只有 `*://localhost/*` 占位（Chrome 不允许空数组）。真实注入由 background 用 `chrome.scripting.registerContentScripts` 动态注册（id `tm-main`）。`src/background/index.ts:25` 的 `TARGET_MATCHES` 必须与 `optional_host_permissions` 严格同步，添加新平台要同时改两处。
- **适配包 = 数据驱动 JSON**（`src/adapters/xueqiu.json` v0.3.0 / `ths.json` v0.1.0）：新增平台时写 JSON 并通过 `validateAdapter`（手写校验，`src/adapters/schema.ts`），改字段需同步 schema、`src/shared/types.ts` 的 `PlatformAdapter` 类型、content script 消费处及对应测试。
- storage keys：`timeSettings.<domain>`、`prefs`、`adapters.remote`（见 `src/shared/storage.ts`）。
- 消息协议（`RuntimeMessage`）：background ↔ content script 广播 `TIME_SETTINGS_UPDATED` / `TOGGLE_FILTER` / `ADAPTERS_UPDATED` / `FILTER_COUNT_UPDATED` / `FILTER_STATE_CHANGED`；加新消息要同步 `src/shared/types.ts`。
- content script（`src/content/index.ts`）是核心，含雪球虚拟分页引擎 `src/content/virtual-pagination.ts`（稳定 ID 去重、缓存、200 原生页上限），修改前先读该文件头部注释。
- 过滤标记：`data-tm-filtered` 属性（dataset 键 `tmFiltered`，含连字符会抛 SyntaxError）；hide 策略 = `style.display:none`。
- 开发用固定扩展 id 来自 vite 配置中的 `key`，对应私钥 `scripts/keys/timemachine-dev.pem`（本地文件，**已在 .gitignore，禁止提交**）。

## 已知问题 / 操作约束

- **扩展重载后已打开的雪球标签可能不自动注入**：打开 Popup 触发注册同步后刷新可恢复（未根治）。
- 雪球有反爬风控：真机验证时连续自动翻页/快速点击会触发"访问验证"滑块，污染测试结果；每次切换等待原生列表稳定、降低操作频率（见 DEV-PLAN 交接记录）。
- 相对时间解析采用"时间锚定"：以 MutationObserver 首次检测到帖子的时刻为锚点反推（`src/shared/time.ts`），含义与"页面加载时间"不同，改动前先看懂该策略。