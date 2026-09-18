# AGENTS.md — TimeMachine 时光机（Chrome MV3 扩展）

按指定时间点隐藏"之后发布"的帖子（雪球/同花顺）。仓库内注释与文档为中文，commit message 用英文 conventional（`feat:`/`fix:`）。**文档只写现状与未决事项；已完成/已归档内容不落在仓库里，由 git 历史承载。**

## 文档地图（权威边界）

| 文档 | 角色 |
|------|------|
| `PRD-v1.0.md` | **产品设计权威**：功能规则、时间语义、适配计划、v1.1+ 场景与版本规划（§12） |
| `DEV-PLAN.md` | **任务与进度**：当前未闭环队列 + P0~P4 任务表（已完成任务只留一行） |
| `VERIFY-CHECKLIST.md` | **验收清单**：真机测试项、结论、风控纪律（含新手导览） |
| `docs/platform-recon.md` | 待适配平台 DOM 取证摘要（P2-21 引用） |
| `docs/PRIVACY-POLICY.md` / `docs/STORE-LISTING.md` | 上架物料（发布必需） |

## 验证命令（顺序执行）

```bash
npm test                # 唯一测试入口：package.json 中硬编码 23 个 tsx 文件
npx tsc --noEmit        # 类型检查（tsconfig include 只含 src/，test/ 不参与检查）
npm run build           # 产物 dist/（CRXJS loader + hash 文件名）
git diff --check
```

- **新增测试文件必须手动追加到 `package.json` 的 `test` 脚本**，否则不会被运行。
- 无 lint / 无测试框架：测试 = `node:assert` + `JSDOM` + 手写 chrome mock，顶层断言抛错即失败。公共辅助在 `test/helpers/`（`check` / `dom-env` / `chrome-mock`，`setupDom` 已注入 `DOMParser` 供 url 模式虚拟分页使用）。单跑：`npx tsx test/unit/xueqiu-backfill.test.ts`。
- **平台 DOM fixture 在 `test/fixtures/`**（`jisilu-category` / `jisilu-topic` / `guba-stock-list` / `guba-fund-list` / `fund-detail-bar`）：从真实页面裁剪 + 用户内容匿名化，文件头注释记录取证日期/URL/结构发现与未决项。新增平台适配前先按此格式取证落 fixture，再写 `test/unit/platform-fixtures.test.ts` 断言（选择器命中、时间文本提取、年份推断行为）。**取证优先用真实浏览器（chrome-devtools MCP 在渲染后 DOM 上跑选择器）**：jsdom 抓服务端 HTML 看不到 JS 注入的节点（guba 的时间单元格类名、东财资讯的整个列表都在 JS 里），只用 jsdom 会误判选择器失效。
- **Vite 配置了 `emptyOutDir: false`**（Windows safe-delete 拦截 quirk），dist/ 会残留旧 hash 文件；干净构建先 `rm -rf dist`。

## 构建产物与打包

- `npm run test:build` → `dist-test/`：从 dist/ 复制并在 manifest 追加 `*://xueqiu.com/*` host_permissions、**删除 `key`**（unpacked 加载时 key 与路径不符会校验报错）。
- `npm run package` → `artifacts/timemachine-v<version>.zip`（商店包，剥离开发 key）。
- `node scripts/e2e.mjs`：真实 Chrome e2e（mock 雪球页 + 过滤断言）。**仅限 Windows 本机**：硬编码 `C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/playwright-core`，且需先 build + test:build。
- 一次性调查脚本已归档至 `scripts/archive/`（`probe-*.mjs`，注入不稳定排查期产物，硬编码 Windows playwright-core 路径）；现役脚本为 `cdp-sw.mjs`/`check-build-loader.mjs`/`make-test-build.mjs` 等。

## 架构关键（易踩坑）

- **按需授权模型**：manifest 的 `content_scripts` 只有 `*://localhost/*` 占位（Chrome 不允许空数组）。真实注入由 background 用 `chrome.scripting.registerContentScripts` 动态注册（id `tm-main`，常量与 loader 读取见 `src/shared/registration.ts`）。平台清单两处：`vite.config.ts` 的 `SITE_ORIGINS`（`optional_host_permissions` 与 `web_accessible_resources.matches` 共用同一常量）与 `src/adapters/index.ts` 的内置适配包注册；background 的 `TARGET_MATCHES` 由适配包派生的 `SUPPORTED_ORIGINS` 自动同步。添加新平台 = 新增适配包 JSON + 注册（`src/adapters/index.ts`）+ 更新 `SITE_ORIGINS`。
- **适配包 = 数据驱动 JSON**（内置 6 份：`xueqiu.json` v0.4.1 / `ths.json` / `jisilu.json` v0.2.0 / `guba.json` v0.1.0（3 个页面类型条目）/ `fund.json` v0.1.0 / `eastmoney-news.json` v0.1.0）：新增平台时写 JSON 并通过 `validateAdapter`（手写校验，`src/adapters/schema.ts`），改字段需同步 schema、`src/shared/types.ts` 的 `PlatformAdapter` 类型、content script 消费处及对应测试。改动内置适配包后必须 `npm run adapters:build -- --version <递增>` 重生成 `adapters.json`（`sites-panel.test.ts` 会断言两者同步）；新增平台还要在 `vite.config.ts` 的 `SITE_ORIGINS` 加 origin、在 `src/adapters/index.ts` 注册。
- **一个域名可有多个页面类型条目**（P2-21 前置能力）：`PlatformAdapter.active_paths` 隔离，`AdapterManager.getAdapterFor(domain, pathname)` 取路径命中条目（无 `active_paths` 的条目作为兜底，未命中返回 null → 内容脚本静默退出）；**发布脚本 `build-adapters-json.mjs` 要求同域多条目的每一条都必须声明 `active_paths`**，否则拒绝出包。新增平台适配若同域有两种模板/两种时间语义（如 guba 个股吧 vs 基金吧总版、「全部」的回复时间 vs 「最新发帖」的发帖时间），必须拆成独立条目——`timestamp.selector` 的数组是**同一时间语义**的行模板回退链，严禁用它表达语义差异。
- **无年份时间（`MM-DD HH:mm` / `MMDD HH:mm`）由适配包 `timestamp.year_inference` 决定**：省略 = 旧行为（逐帖与当前时刻比较补当年，仅适合雪球「修改于」这类不依赖年份的场合）；`descending-list` = 按严格发帖时间倒序做序列推断（首行锚定 + 近 48h 守卫 + 月日回跳视为异常行），**异常行返回 null（默认显示）并把游标重对齐到该行**——不留神把游标卡在低水位会让其后所有正常行都被判为异常（guba 实测覆盖率 6% → 99%）；`never` = 不推断（按最后回复排序、年份不可判定的列表必须用它）。年份状态按扫描会话持有（`src/content/index.ts` 的 `yearStateFor`），`teardownFilterState` 时丢弃重建。规则与失败方向见 `src/shared/time.ts` 的 `inferYearFor`。
- **虚拟分页有两种源页获取方式**（`virtual_pagination.source_mode`）：缺省 `click`（点击站内翻页控件 + 等列表 DOM 变化，雪球）；`url`（`page_url_pattern` 含 `{page}`，逐页 `fetch` 同源整页 + `DOMParser` 解析成离线文档，会话总从 `start_page` 重新聚合，空页/无新帖 ID 判末页）。`url` 模式不改动当前页面，因此缓存与去重跨页保持；**客户端渲染的站点不适用**（服务端 HTML 里没有帖子）。两种模式都要求 `native_pagination_selector`（用于隐藏站点分页），`next_selector`/`active_page_selector` 仅 `click` 模式必填。
- storage keys：`timeSettings.<domain>`、`prefs`、`adapters.remote`（见 `src/shared/storage.ts`）。
- 消息协议（`RuntimeMessage`）：background ↔ content script 广播 `TIME_SETTINGS_UPDATED` / `TOGGLE_FILTER` / `ADAPTERS_UPDATED` / `FILTER_COUNT_UPDATED` / `FILTER_STATE_CHANGED` / `PERMISSION_REVOKED`（授权撤销，content 收到后 `stopFiltering()` 恢复 DOM 并停止，对应 background `permissions.onRemoved`，见 `src/background/service-worker.ts`）；加新消息要同步 `src/shared/types.ts`。
- content script（`src/content/index.ts`）是核心，含虚拟分页引擎 `src/content/virtual-pagination.ts`（稳定 ID 去重、缓存、200 原生页上限、click/url 双源页策略），修改前先读该文件头部注释。
- **信息流连续补拉**（`src/content/feed-backfill.ts`，P2-17 切片 1）：数据驱动 `feed_context.backfill`（contexts 白名单仅声明严格时间序类别如 7x24/关注），用户手动点「查找更早的帖子」触发滚动补拉，与虚拟分页互斥；`ScanProgress.unit: 'screens'` 供 Popup/悬浮条区分「屏/原生页」双语义。修改前先读该文件头部注释；内置适配包升版本不会破坏 adapters-update.test.ts（版本断言已动态推导）。
- 过滤标记：`data-tm-filtered` 属性（dataset 键 `tmFiltered`，含连字符会抛 SyntaxError）；hide 策略 = `style.display:none`。
- 开发用固定扩展 id 来自 vite 配置中的 `key`，对应私钥 `scripts/keys/timemachine-dev.pem`（本地文件，**已在 .gitignore，禁止提交**）。

## 已知问题 / 操作约束

- **扩展重载注入不稳定已根治并真机闭环**（2026-08-23 `30e5ecf` 根治；2026-09-06 真机复验通过，VERIFY-CHECKLIST §1.4）：根因是 `content/index.ts` 与 `background/index.ts` 同 basename 导致 CRXJS 生成的 service worker loader 可能指向 content chunk（构建成功但 SW 加载失败 → 动态注册从不执行）。已将 background 入口重命名为 `service-worker.ts`，并新增 `scripts/check-build-loader.mjs` 挂入 `build`/`test:build` 校验 loader 指向 background chunk 防回归；SW 注册通路含 `onInstalled` + `onStartup` + 顶层唤醒三重幂等触发。实测注意：重载后新标签页的注入生效有数十秒引擎稳定等待期，属设计内延迟。
- **快捷键冲突已修复并实机验证（2026-09-08）**：`commands.toggle-filter` suggested_key 由 `Ctrl+Shift+T`（与 Chrome 内置「重新打开已关闭标签页」冲突）更换为 `Alt+Shift+T`（vite.config.ts），用户已在 shortcuts 页手动绑定并实机验证通过。注意两条运维知识：suggested_key 变更后重载/更新扩展**不会自动应用绑定**（需 shortcuts 页手动绑定一次）；快捷键捕获框不接收合成/自动化按键（绑定与验证只能人工按键）。
- **适配包发布纪律（远程包会遮挡更新的内置包）**：远程包的版本单调比较是「远程 vs 已存远程」，**不比较内置包**——只要 CDN 上存在任何远程包，它就会持续覆盖较新的内置包。因此每次改动内置适配包后必须 `npm run adapters:build` → 提交 → 推送（必要时递增 `adapters.json` 版本号并 purge CDN），否则用户端跑的是旧适配内容。jsDelivr purge 有传播延迟（实测首次 ~40s 后仍为旧内容），需复核而非假定立即生效。另：`updateAdapters()` 只在 `onInstalled(reason='install')` 与 12h alarm 触发，商店更新（`reason='update'`）不会立即拉取，用户最长 12h 才拿到新适配包（后续优化项）。
- 雪球有反爬风控：真机验证时连续自动翻页/快速点击会触发"访问验证"滑块，污染测试结果；每次切换等待原生列表稳定、降低操作频率（历史记录见 git log）。553fd11 翻页节流（400-800ms 随机间隔 + wait 800ms）经 2026-09-06/07 真机低频会话实战验证有效（十类切换 + 多页翻页零风控）；但**区间深回溯**（如昨日区间在次日访问需跨过全部今日帖）会连续扫描数十原生页，累积仍会触发风控（09-07 实测 59 页后触发），测试时须预留人工过滑块。
- **同 Profile 并存多份本扩展构建会互相污染**：dev（dist/）重建后若内容 hash 未变，其历史动态注册仍有效并继续向新雪球标签注入过滤；真机测试前须在 chrome://extensions 停用非受测实例，测毕恢复。另 dist-test 的 manifest 预授予平台 `host_permissions`，Chrome 会忽略 optional 声明并拒绝 `permissions.remove`（撤销授权链路仅能在商店包构建上真机验证，见 VERIFY-CHECKLIST §2.4）。
- 相对时间解析采用"时间锚定"：以 MutationObserver 首次检测到帖子的时刻为锚点反推（`src/shared/time.ts`），含义与"页面加载时间"不同，改动前先看懂该策略。
