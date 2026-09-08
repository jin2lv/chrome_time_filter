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

- **按需授权模型**：manifest 的 `content_scripts` 只有 `*://localhost/*` 占位（Chrome 不允许空数组）。真实注入由 background 用 `chrome.scripting.registerContentScripts` 动态注册（id `tm-main`）。`src/background/service-worker.ts:25` 的 `TARGET_MATCHES` 必须与 `optional_host_permissions` 严格同步，添加新平台要同时改两处。
- **适配包 = 数据驱动 JSON**（`src/adapters/xueqiu.json` v0.3.0 / `ths.json` v0.1.0）：新增平台时写 JSON 并通过 `validateAdapter`（手写校验，`src/adapters/schema.ts`），改字段需同步 schema、`src/shared/types.ts` 的 `PlatformAdapter` 类型、content script 消费处及对应测试。
- storage keys：`timeSettings.<domain>`、`prefs`、`adapters.remote`（见 `src/shared/storage.ts`）。
- 消息协议（`RuntimeMessage`）：background ↔ content script 广播 `TIME_SETTINGS_UPDATED` / `TOGGLE_FILTER` / `ADAPTERS_UPDATED` / `FILTER_COUNT_UPDATED` / `FILTER_STATE_CHANGED` / `PERMISSION_REVOKED`（授权撤销，content 收到后 `stopFiltering()` 恢复 DOM 并停止，对应 background `permissions.onRemoved`，见 `src/background/service-worker.ts`）；加新消息要同步 `src/shared/types.ts`。
- content script（`src/content/index.ts`）是核心，含雪球虚拟分页引擎 `src/content/virtual-pagination.ts`（稳定 ID 去重、缓存、200 原生页上限），修改前先读该文件头部注释。
- **信息流连续补拉**（`src/content/feed-backfill.ts`，P2-17 切片 1）：数据驱动 `feed_context.backfill`（contexts 白名单仅声明严格时间序类别如 7x24/关注），用户手动点「查找更早的帖子」触发滚动补拉，与虚拟分页互斥；`ScanProgress.unit: 'screens'` 供 Popup/悬浮条区分「屏/原生页」双语义。修改前先读该文件头部注释；内置适配包升版本不会破坏 adapters-update.test.ts（版本断言已动态推导）。
- 过滤标记：`data-tm-filtered` 属性（dataset 键 `tmFiltered`，含连字符会抛 SyntaxError）；hide 策略 = `style.display:none`。
- 开发用固定扩展 id 来自 vite 配置中的 `key`，对应私钥 `scripts/keys/timemachine-dev.pem`（本地文件，**已在 .gitignore，禁止提交**）。

## 已知问题 / 操作约束

- **扩展重载注入不稳定已根治并真机闭环**（2026-08-23 `30e5ecf` 根治；2026-09-06 真机复验通过，VERIFY-CHECKLIST §1.4）：根因是 `content/index.ts` 与 `background/index.ts` 同 basename 导致 CRXJS 生成的 service worker loader 可能指向 content chunk（构建成功但 SW 加载失败 → 动态注册从不执行）。已将 background 入口重命名为 `service-worker.ts`，并新增 `scripts/check-build-loader.mjs` 挂入 `build`/`test:build` 校验 loader 指向 background chunk 防回归；SW 注册通路含 `onInstalled` + `onStartup` + 顶层唤醒三重幂等触发。实测注意：重载后新标签页的注入生效有数十秒引擎稳定等待期，属设计内延迟。
- **快捷键冲突已修复并实机验证（2026-09-08）**：`commands.toggle-filter` suggested_key 由 `Ctrl+Shift+T`（与 Chrome 内置「重新打开已关闭标签页」冲突）更换为 `Alt+Shift+T`（vite.config.ts），用户已在 shortcuts 页手动绑定并实机验证通过。注意两条运维知识：suggested_key 变更后重载/更新扩展**不会自动应用绑定**（需 shortcuts 页手动绑定一次）；快捷键捕获框不接收合成/自动化按键（绑定与验证只能人工按键）。
- 雪球有反爬风控：真机验证时连续自动翻页/快速点击会触发"访问验证"滑块，污染测试结果；每次切换等待原生列表稳定、降低操作频率（见 DEV-PLAN 交接记录）。553fd11 翻页节流（400-800ms 随机间隔 + wait 800ms）经 2026-09-06/07 真机低频会话实战验证有效（十类切换 + 多页翻页零风控）；但**区间深回溯**（如昨日区间在次日访问需跨过全部今日帖）会连续扫描数十原生页，累积仍会触发风控（09-07 实测 59 页后触发），测试时须预留人工过滑块。
- **同 Profile 并存多份本扩展构建会互相污染**：dev（dist/）重建后若内容 hash 未变，其历史动态注册仍有效并继续向新雪球标签注入过滤；真机测试前须在 chrome://extensions 停用非受测实例，测毕恢复。另 dist-test 的 manifest 预授予平台 `host_permissions`，Chrome 会忽略 optional 声明并拒绝 `permissions.remove`（撤销授权链路仅能在商店包构建上真机验证，见 VERIFY-CHECKLIST §2.4）。
- 相对时间解析采用"时间锚定"：以 MutationObserver 首次检测到帖子的时刻为锚点反推（`src/shared/time.ts`），含义与"页面加载时间"不同，改动前先看懂该策略。
