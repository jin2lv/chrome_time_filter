# TimeMachine 时光机 — 开发计划与验证清单

## 2026-09-09 批次八（批次 D：P2-18 平台能力矩阵页面类型级 + 金融场景区间预设）

> 纯开发批次，承接批次七的平台级矩阵。基线全绿：`npm test` 16 文件（新增 trading-day.test.ts 13 项；sites-panel.test.ts 扩至 27 项）、tsc 0 错误、build/test:build loader ✅、git diff --check。真机冒烟（dist-test 重载）：Popup 区间面板 **7 项预设**渲染齐备，点击「交易日全天」（周三）正确填入今日 00:00–23:59 并保存；设置页雪球行「页面类型能力（3 类）」展开表格渲染正确。测后设置已恢复（截止 09-06 00:00，各模式记忆独立回显）。

### 落地清单

- `src/shared/trading.ts`（新）：`lastTradingDay`/`lastTradingDayRange`（最近一个交易日，**v1.0 按工作日、不含法定节假日**，头注与 Popup 按钮 title 双注明；v1.1 接交易日历 P3-3）、`tradingSessionRange`（09:30–15:00）、`lunchReviewRange`（09:30–11:30）
- `src/popup/index.html` + `main.ts`：区间预设新增 **午间复盘 / 交易时段 / 交易日全天** 三按钮（title 注明工作日口径），resolveWindowPreset 接入三个 resolver；自定义事件窗口 = 既有自定义起止输入（不新增控件）
- `src/adapters/index.ts`：`SitePageCapability` + `describePages`——页面类型级能力矩阵从适配包字段推导（feed_context→信息流[补拉上限/排序完整性]、virtual_pagination→个股讨论页[原生页上限]、comment_selectors→帖子详情页[评论过滤]；时间精度按 timestamp.type；verified 以平台级 last_verified 粗粒度代替页面级验证记录，如实标注）
- `src/options/main.ts` + `style.css`：每平台行下可折叠「页面类型能力（N 类）」表格（页面类型/评论/区间/跨页/时间精度/排序完整性/已验证）
- `test/unit/trading-day.test.ts`（新 13 项）：周三/周五→当天、周六/周日→上周五、周一为交易日→当天（含凌晨边界）、全天边界、交易时段/午间复盘时点
- `test/unit/sites-panel.test.ts`：+5 项（雪球 3 类页面、信息流补拉/精度/排序、个股 200 页上限、详情页评论✓、同花顺 0 类页面如实验证、verified 与 last_verified 全平台一致）

### 范围决策（如实记录）

- 健康状态 v1.0 为两档：已验证（绿）/未真机验证（灰），数据驱动；解析率/匹配数等运行时健康指标归 P2-19/P2-22，不在本批虚构。
- 页面类型级「已验证」以平台级 last_verified 粗粒度代替（页面级验证记录数据源尚不存在），表格列名如实为「已验证」。
- 「某交易日全天」v1.0 语义落地为「最近一个交易日全天」；「自定义事件窗口」由既有自定义起止输入承担。
- 新区间预设的实际过滤真机回归（午间复盘等在雪球页的过滤行为）攒到批次 E 全量回归。

---

## 2026-09-09 批次七（批次 C：P2-20 多站授权与每站设置）

> 纯开发批次。落地 P2-20 四个子项的数据层与设置页 UI；授权弹窗链路的真机验证按计划攒到批次 E（机制本身已在批次六商店包 §2.4/§2.5 全链路闭环，本批复用同一 permissions API）。基线全绿：`npm test` 15 文件（新增 sites-panel.test.ts，已挂 package.json）、`npx tsc --noEmit` 0 错误、`rm -rf dist && npm run build`（loader ✅）、`npm run test:build`、`git diff --check`；另做 dist-test 重载后的设置页**渲染冒烟**（四平台矩阵/状态标签/能力摘要/记忆管理/授权全部按钮全部正确渲染，无 JS 错误）。

### 落地清单

- `src/shared/types.ts`：`PlatformAdapter.last_verified?: string`（最后真机验证日期，可选）
- `src/adapters/schema.ts`：last_verified 校验（可选，YYYY-MM-DD 格式）
- `src/adapters/xueqiu.json`：`"last_verified": "2026-09-09"`（今日三批真机验证背书）；同花顺/集思录/东财资讯不填 → 设置页如实显示「未真机验证」
- `src/adapters/jisilu.json`：domains 补 `www.jisilu.cn`（§2.3 双 origin 承诺落到适配包数据这一单一事实源；授权请求一次覆盖双域；匹配语义不变，此前经 endsWith 已匹配 www）
- `src/adapters/index.ts`：`SUPPORTED_SITES`（平台/域名/origin/版本/验证日期/能力摘要——能力按适配包实际配置派生：帖子过滤、信息流上下文、信息流补拉、个股跨页扫描、详情评论过滤、快捷预设）+ `SUPPORTED_ORIGINS`（5 条去重，与 manifest optional 一致）
- `src/options/index.html` + `main.ts` + `style.css`：「站点与适配」重构为支持站点矩阵——每平台一行（授权状态标签 + 单站授权/移除 + v版本·验证日期·能力摘要 + 每站时间设置记忆摘要（timeSettings.<domain>：模式/策略）与「重置此站点设置」）；顶部「授权全部金融站点」按钮（一次 permissions.request 全部 5 origin，**用户主动点击，绝不自动申请**）；平台外的其他已授权 origin 兜底列表（dist-test 预授予场景）
- `test/unit/sites-panel.test.ts`（新，22 项）：矩阵派生（4 平台、jisilu 双 origin、能力按配置、last_verified 仅雪球）、SUPPORTED_ORIGINS 与 manifest 一致、schema 新字段合法/非法、全部内置包仍过校验

### 设计与范围决策

- **每站记忆**：`timeSettings.<domain>` 早已按域名持久化 mode/cutoff/window/strategy（P1 起即"每站记忆"），本批补齐管理面（摘要+重置）；「同域名不同页面继承」即域名级共享的现状语义，**页面级覆盖明确归 P3-5**（"按平台或页面类型覆盖默认模式与预设"），不在 v1.0 扩域。
- 能力摘要为配置派生（声明什么展示什么），不为未验收平台背书；最后验证日期数据驱动，后续真机验收各平台时随适配包更新。
- 授权 API 与批次六验证过的 permissions.request/remove 完全同路；按钮链路真机验证（弹窗形态/拒绝路径）攒到批次 E 雪球全量回归。

---

## 2026-09-09 批次六（批次 B：闭闸门——§13 全新 Profile E2E + §2.4 商店包撤销授权）

> 承接批次三产出的商店包与批次五的遗留，完成 P2-16 闸门最后两项真机验证。**P2-16 正式关闭**（附一项如实标注的例外，见下）。出包：旧 `artifacts/timemachine-v1.0.0.zip` 留档为 `timemachine-v1.0.0-20260908-archive.zip`，`npm run package` 重出（27 条目全正斜杠、v1.0.0、无 key、**必授权限为空 + 5 个 optional**——§2.4 可撤销的商店包形态）。全新 Profile 经 `--user-data-dir` 独立目录 + 解包 ZIP 加载（商店 ID `phpmhbnkhjefkeedcapibhjidlkkolko`）。验证明细回写 VERIFY-CHECKLIST §1.1/§2.1/§2.2/§2.4/§2.5/§13 及历史表。

### 本批通过项

- **§13 全新 Profile E2E ✅**：加载即弹 welcome 3 步引导 → 未授权禁用态 → 授权弹窗允许 → 截止=今日0点 → 个股页 SZ300142 虚拟分页过滤生效（窗口判定正确）→ Popup 关闭过滤（原生即时恢复）/重新开启（虚拟分页恢复）→ 失效模态自然呈现（登出态首页，§9.1 同款）→ §2.4 撤销链路。全流程无运行时错误；SW Network 面板捕获生命周期网络活动仅扩展自身模块、**零第三方外呼**（全库唯一 fetch 指向 cdn.jsdelivr.net 占位地址，静态+动态双证）。
- **§2.4 撤销授权 4 项 ✅（dist-test 机制限制正式解除）**：设置页移除 xueqiu.com → permissions.remove 成功（列表实时只剩 localhost，§2.5 同批闭环）→ 未刷新的雪球标签原生列表/分页**即时恢复**（PERMISSION_REVOKED → stopFiltering 真机闭环）→ 刷新后完全惰性、无报错。
- **附带闭环**：§1.1 引导、§2.1 未授权态、§2.2 授权流程、§4.3 关闭/开启恢复（商店包维度）、P2 真机清单 #6/#7/#12。

### 新观察（如实记录）

1. **chrome://extensions 错误面板 6 条 modulepreload 警告**（"cross-world extension resource mismatch" / "preloaded but not used"）：CRXJS/Vite 构建产物在 popup/index.html 的 modulepreload 提示，全部为**警告级**、无运行时异常，商店审核角度无害；备案不修（如需消除可在构建期去掉 popup HTML 的 modulepreload hint，P3）。
2. 登出态 DOM 变体（与批次五 O1 同族，登记 P3）：①登出首页 feed 零匹配触发已知误弹模态（09-08 已记录）；②登出详情页评论 DOM 未被 comment_selectors 匹配（0 过滤/0 无法解析，评论过滤不生效）——登录态评论验收维持 §7.x 结论，目标用户场景（登录态）不受影响。
3. SW 生命周期网络捕获中未出现 jsDelivr 请求：onInstalled 仅 reason=install 时更新（解包重载 reason 不符），属预期；拉取行为归 §11（REMOTE_ADAPTERS_URL 落地时验证）。

### 环境恢复

- 验证用 Chrome 实例（独立 Profile）已关闭，`.verify13-store/`、`.verify13-profile/` 临时目录已删除；日常 Profile 与 dist-test 未触碰。

### 遗留与移交

- **P2-16 正式关闭**：第 2/3/4 项全过；第 1 项截止模式全覆盖、区间版 9/10 类通过，**视频类缺口（批次五 O1，窗口外视频卡片绕过过滤）转适配包 v0.4.1 数据驱动修复跟踪**，作为闸门关闭的已记录例外（引擎/授权/撤销链路不受影响）。
- 移交批次 C/D（P2-20 多站授权、P2-18 能力矩阵）开发；批次 E（切片 2 + P2-19 发布源，动工前与用户确认外部资源）。

---

## 2026-09-09 批次五（P2-17 切片 1 真机回归 + P2-16 首页区间版收尾）

> 承接批次四的「真机回归欠」与 P2-16 闸门第一项的区间版缺口。纯验证批次（无代码改动）：登录态雪球首页 dist-test 会话完成信息流连续补拉（切片 1）全状态真机验收、首页区间版其余类别抽查、个股页虚拟分页回归。基线四项复跑全绿（npm test 14 文件 / tsc 0 错误 / rm -rf dist && build loader 校验 / test:build）。测试明细已回写 `VERIFY-CHECKLIST.md` §0/§5.1/§5.6（新开）及历史记录表。全程低频操作（切换间隔 ≥6s），**零风控**。

### 本批通过项

- **§5.6 信息流连续补拉（切片 1 验收）✅**：白名单挂载（7x24 + 关注/全部两类挂载、七类不挂载）；截止=1小时下 7x24/关注流均 **1 屏命中 ≥10 条即停**（idle「已找到 N 条更早的符合时间条件帖子（已加载 1 屏）」）；exhausted（「已到信息流末页…」+按钮禁用，Popup 同步）；cancelled（「补拉已取消…」+按钮恢复）；区间=今天补拉同样命中即停；悬浮条「已扫描 N 屏」实时累计（screens 双语义渲染正确）；命中统计不双计。**如实记录两项**：① Popup loading 态文案未捕获（单次运行 1.2~2.5s 短于开 Popup 延迟；loading 管线由其余三态真机+单测覆盖，取消成功本身证明 loading 态正确）；② 悬浮条文案为「已扫描 N 屏」而非任务描述「已加载 N 屏」（单位渲染正确，措辞差异备案）。
- **站点行为关键记录**：雪球 7x24/关注流滚动追加约 2-3 屏后切换「加载更多」按钮模式，纯滚动不再追加——引擎 exhausted 在该站点的实际语义是「滚动追加路径到头」（非数据真正耗尽）；**切片 2 的 load-more 按钮式获取正对此场景**，优先级有真实数据支撑。
- **§5.1 首页区间版其余类别 ✅（6/7）**：区间=今天逐类抽查——自选（可见均今日、过滤 7）、基金（10 全隐）、资讯（可见 1 今日、过滤 7）、达人（8 全隐）、私募（10 全隐）、ETF（8 全隐）；可见帖均在窗口内、计数逐类独立重置、无串流。
- **个股页回归 ✅**：SZ300142 区间=今天虚拟分页正常激活（状态条/原生列表隐藏/悬浮条「已扫描 N 个原始页」）；深扫 33 原生页后「取消扫描」即时生效（已过滤 340、虚拟控件保留）；切回截止 09-06 00:00 同页即时重滤。注：区间=今天在该股无今日帖，引擎按设计深回溯（33 页量级，未触发风控即手动止损）。

### 新观察（如实记录，未修复）

1. **O1（适配覆盖缺口，建议 v0.4.1 数据驱动修复）：雪球首页「视频」类窗口外帖子不被过滤**。实测：区间=今天下但斌 08-19 13:08、陈立峰 昨天 06:59、特斯拉 08-24 13:24 等视频卡片全部可见；混排普通帖正常过滤（计数 7→16）；Popup 类别标注正常（「视频：…」上下文识别无恙）；无 unparseable 计数。定性：视频卡片 DOM 不匹配 post_selectors（`article.timeline__item`/`.timeline__item`/`.timeline__live tr`），完全绕过过滤链。09-07 §5.1 截止模式视频类通过系当时样本未含窗口外视频卡片（全部可见帖恰早于截止），该结论需按本条收窄。修复方向：适配包增补视频卡片选择器（浏览器取证具体 class）+ schema 校验 + 回归测试；P2-18 能力矩阵落地时视频类应标「部分覆盖」直至修复复验。
2. 个股页悬浮条曾出现「已扫描 0 个原始页」的瞬态（扫描会话重建时 scanProgress 初始值先于扫描上报），不影响正确性（取消后正确显示 33），低优先级备案。

### 环境恢复（已执行）

- 设置恢复测前状态：截止 2026-09-06 00:00（截止模式）、悬浮提示条关闭；测试用调试标签页已关闭；dist-test 未改动（纯验证批）。

### 遗留与移交

- P2-16 闸门第一项：区间版 9/10 类通过，**视频类因 O1 缺口暂不勾**（待 v0.4.1 修复复验后本项方可闭环）；截止版十类与个股六类/详情评论此前已过。
- P2-16 闸门剩余不变：§13 全新 Profile E2E + §2.4 商店包撤销授权（批次 B，需用户配合部分：授权弹窗/Profile 创建人工步骤）。
- P2-17 切片 1 真机回归至此闭环；切片 2（原生页码策略收编 + load-more 按钮式）排期批次 E。

---

## 2026-09-08 开发批次四（P2-17 切片 1：信息流连续补拉 + 统一状态单位）

> 启动 P2-17（闸门剩余两项——首页区间版 6 类抽查、§13/§2.4 商店包复验——不阻塞开发，安排在切片 1 的真机回归会话与独立会话中收尾）。本批为纯开发批次：新增信息流连续补拉引擎（P2-15 遗留项「为可可靠回溯的雪球首页类别接入连续补拉」的正身）、统一扫描状态单位契约、适配包 schema 扩展与回归测试。

### 设计决策（切片 1）

- **手动触发，不自动滚动**：信息流尾部固定条「⏳ 查找更早的帖子」按钮，用户点击后才启动滚动补拉（与虚拟分页「点击下一页才继续扫描、不预取超过所需页」哲学一致）。热度/智能流（热门等非严格时间序）不提供入口，保持「仅过滤已加载内容」诚实标注——「不适合深度回溯的信息流不会勉强适配」。
- **数据驱动白名单**：适配包 `feed_context.backfill`（contexts/scroll_delay_ms/max_screens/target_hits/end_stall_count），仅严格时间序类别声明；雪球 v0.4.0 配置 `["7x24", "关注 / 全部"]`、节流 1200ms/屏、上限 10 屏、目标 10 条、连续 2 次无新增判末页。运行时不强制 delay 下限（测试需小值），风控安全由适配包数据审核负责。
- **引擎独立成模块**（`src/content/feed-backfill.ts`）：不改动已真机验证的 `virtual-pagination.ts`（原生页码策略收编为切片 2）。补拉只负责「拉」（滚动节流/新增检测/命中统计/停止条件/状态上报），过滤判定与隐藏仍由既有 observer → processPost 链唯一负责（decide 仅作命中统计，不计数，避免 filtered/unparseable 双计）。
- **统一状态契约**：`ScanProgress` 新增可选 `unit: 'pages' | 'screens'`；Popup `scanStatusText` 与悬浮条按单位渲染「原生页/屏」。补拉状态映射 completeness：loading→scanning、exhausted→exhausted、limit/cancelled/idle→loaded-only。
- **UI 不依赖站点 DOM 结构**：fixed 底部居中操作条（状态文本 + 主按钮），按钮按状态切换「查找更早的帖子/取消/继续查找」，exhausted 后禁用。

### 落地清单

- `src/shared/types.ts`：`FeedBackfillConfig` + `feed_context.backfill` + `ScanProgress.unit`
- `src/adapters/schema.ts`：backfill 校验（contexts 非空字符串数组、delay 非负、max_screens/target_hits/end_stall_count 正整数）
- `src/content/feed-backfill.ts`：FeedBackfillController（滚动循环、命中统计、idle/exhausted/limit/cancelled 状态机、screens 累计跨会话）
- `src/content/index.ts`：mountFeedBackfill()（reapplyAll/init 挂载、stopFiltering/reapplyAll 销毁；与虚拟分页互斥）
- `src/popup/main.ts`：scanStatusText 按 unit 渲染
- `src/adapters/xueqiu.json`：v0.4.0，feed_context.backfill 配置 + notes 更新
- `test/unit/feed-backfill.test.ts`（新，已挂入 package.json test，14 文件）：挂载白名单/目标达成/末页判定/屏数上限/取消恢复/schema 校验 6 组
- `test/unit/adapters-update.test.ts`：远程包版本断言由硬编码 0.3.0/0.4.0 改为动态推导内置版本 +1 minor（内置包升版本不再造成测试回归）

### 验证与遗留

- 基线全绿：`npm test` 14 文件、`npx tsc --noEmit`、`rm -rf dist && npm run build`（loader 校验通过）、`npm run test:build`、`git diff --check`。
- **真机回归欠**（切片 1 验收）：雪球首页 7x24/关注流点击补拉按钮的实机行为（滚动加载、状态条、与风控节流的实际表现）+ 截止/区间两模式；排入下一会话的雪球真机回归批次。
  - → **2026-09-09 已完成**（批次五，VERIFY-CHECKLIST §5.6 全状态通过；站点滚动追加 2-3 屏后切「加载更多」按钮的行为被实测记录，为切片 2 提供依据）。
- P2-17 其余（load-more 按钮式获取、原生页码策略收编统一引擎、扫描状态纳入诊断报告）为切片 2 范畴。

---

## 2026-09-08 批次三（商店包 + §12 性能实测 + §14 发布准备）

> 用户指令「出商店包，然后做 §12 和 §14」。本批产出商店 ZIP、§12 四项性能数据、§14 大部分物料；顺带修复打包脚本一个真实缺陷、更新两份上架文档过时内容。基线复跑全绿（npm test 13 文件 / tsc 0 错误 / git diff --check）。

### 本批完成项

- **商店包 ✅**：`rm -rf dist && npm run build && npm run package` → `artifacts/timemachine-v1.0.0.zip`（27 条目）。核验：v1.0.0、无开发 key、无必授 host_permissions、5 个 optional_host_permissions、中文条目 UTF-8 正常。**顺带修复打包脚本缺陷**：本机无 `zip` CLI 时回退 PowerShell Compress-Archive，产物条目名为反斜杠分隔（`assets\foo.js`，商店解包有被拒/路径错乱风险）——`scripts/package-extension.mjs` 新增 Python zipfile 回退（恒正斜杠，插在 PowerShell 之前），重出包并验证。
- **§12 性能四项 ✅（mock 实测）**：computer-use 会话已被 stop 且本批无法重启，改用仓库既有模式（playwright-core + `--load-extension` 加载 dist-test + 本地结构化 mock 雪球页，零风控）。数据（PerformanceObserver longtask + rAF 帧采样 + 事件循环滞后探针）：
  - 无明显卡顿：80 帖首屏 + 3 屏滚动追加（每屏 20 帖）全程 **0 长任务、60fps、0 慢帧**，首屏过滤稳定 34-36ms；
  - 回调累计 <1s：以 longtask 总量作上界代理 = **0ms**（未做逐回调打点，如实标注）；
  - 悬浮条开/关对照：两组 fresh 内容均为 0 长任务/60fps，无可测差异；
  - 扫描中可交互：虚拟分页跨 2 原生页扫描窗口内 **0 长任务、事件循环最大滞后 11ms**，完成后「第 1 页 · 已扫描 2 个原始页」+ 原生列表隐藏正常。
  - 边界（如实记录）：未在登录态真站测量；mock 需复刻真实雪球分页 DOM 语义（active 页码为裸数字「1」，否则 `goToFirstSourcePage` 走跳页路径判 error——调试 mock 时踩过并已留档于本节）。
- **§14 发布准备 ◐**：
  - 截图 6 张已采集至 `store-assets/`（1280×800，playwright 视口直出）：引导页 ✅ / 虚拟分页（mock 页，状态条完整）/ 折叠占位条效果（mock 页）/ Popup（真实 UI，合成画布）/ 设置页 ✅ / 同花顺真实站点（无可见过滤痕迹）。真实雪球登录态截图自动化环境不可得（未登录首页 DOM 无 post_selectors 匹配），建议发布前真机重截 2/3/6。
  - `docs/STORE-LISTING.md`：修正过时快捷键文案 Ctrl+Shift+T → **Alt+Shift+T**；§4 截图清单落地为实际文件+状态备注。
  - `docs/PRIVACY-POLICY.md`：权限表 optional_host_permissions 由「雪球、同花顺」更正为实际 5 平台 origins。
  - 剩余用户步骤：隐私政策托管为公开 URL；开发者控制台填写描述/关键词/分类并上传 ZIP+截图；§13/§2.4 需在商店包上真机复验后才可勾「清单全部通过」闸门。

### 新观察（如实记录，未修复）

1. **P3：未登录访问雪球首页会误弹失效模态**（自动化截图时实测命中）：未登录首页 DOM 无 `article.timeline__item` 等匹配，feed 路径 `^/$` 命中 → 5s 后模态。产品上可考虑登录态检测豁免或文档注明「需登录使用」；不影响登录态用户。
2. `docs/timemachine-v1.0.0.zip` 为历史散落产物（untracked，早于本次 artifacts/ 产物），建议确认后删除或移入 artifacts/。
3. 性能探针脚本（.tmp-*.mjs）已按临时约定用后删除；如需沉淀为 `scripts/perf-probe.mjs` 可参照 DEV-PLAN 本节方法描述重建（playwright 硬编码路径仅本机可用）。

### 环境与回归

- 本机 dist/ 已干净重建（用于打包）；dist-test 未动（与 dist 同源同 hash）；日常 Chrome Profile 及 test 扩展设置未被触碰（本批全程自动化 Chromium 独立 Profile）。
- 回归：npm test 13 文件全绿、tsc 0 错误、git diff --check 通过。
- 遗留缺口不变：§13 全新 Profile E2E、§2.1-2.4 商店包授权/撤销真机、§10.x 其他平台真机、隐私政策托管 URL（用户）——见 VERIFY-CHECKLIST §14 未勾项与 09-07/09-06 批次记录。

---

## 2026-09-08 真机测试批次二（错误路径 + 区间收尾，dist-test，纯验证无代码改动）

> 承接 09-08 开发批次的待办（§9.1 失效模态、§9.4/9.5 诊断、§7.4 详情评论区间、§5.1 首页区间扫尾），全部在 dist-test 上以「篡改适配包 bundle 构造错误样本」方式真机完成。基线三项复跑全绿：`npm test`（13 个文件，与 package.json 一致——上一批记录写「14 个文件」系笔误）、`npx tsc --noEmit` 0 错误、`npm run test:build`（loader 校验通过）。测试明细已回写 `VERIFY-CHECKLIST.md` §0/§5.1/§7.4/§9.1/§9.4/§9.5 及历史记录表。

### 本批通过项

- **§9.1 失效模态通过**：备份后直改 `dist-test/assets/adapters-*.js`，雪球三个 post_selectors → 零匹配 `.tm-no-such-2026`（包结构仍过 validateAdapter）→ 重载 → 刷新首页：模态出现（标题/文案/「刷新重试」按钮齐全，a11y 核实无任何关闭控件），同页过滤停止、角标清空。
- **§9.4/9.5 通过**：从干净备份仅篡改雪球 `timestamp.selector` → 16 条帖子全部「未找到时间元素」→ Popup 出现「查看无法解析的时间」展开区，样本 1 条（kind+raw 去重，≤8）：「帖子 / (关注 / 全部)：未找到时间元素」；「复制诊断报告」经 `powershell Get-Clipboard` 核验：仅平台=雪球/适配包版本=0.3.0/模式=cutoff 边界/计数（0 过滤+16 无法解析）/pathname「/」+时间原文+回退行为，**无 URL query、无帖子正文、无账号、无 Cookie**，脱敏承诺兑现。
- **§7.4 单页双向通过**：区间=今天 00:00~23:59；样本页 `xueqiu.com/6451611049/141390314`（2020 老帖被今日转发热帖引用、当天仍在新增评论，评论时间跨 2020→当日）。区间内 4 条今日评论（14分钟前/56分钟前/今天07:23/今天07:12）保留；区间外 80 条（含 2020-02-17 批次）隐藏。双向对照：Popup 关过滤→区间外评论显形可读时间戳→开过滤→重新隐藏。切回截止 09-06 00:00 后同页即时重滤（今日评论转隐藏）。
- **§5.1 区间抽查通过**：关注流仅 2 条今日帖保留（过滤 18）、热门流 10 条全为往日帖全隐（可见 0），计数独立无串流。首页区间版覆盖关注/热门两类，其余类别留待按需补测。
- **附带证据**：Popup 开关（关闭/开启）在详情页双向生效并正确恢复 DOM；设置修改跨 Tab 广播即时重滤（详情页评论区随截止切换即时变化）；详情页正文（区间外老帖）按设计不参与过滤（§9.3 语义）。

### 环境实况与实测观察（如实记录）

1. **dev 时光机（eobbppih）在日常 Profile 中不存在**：chrome://extensions 搜索「时光机」仅命中 test 扩展，全列表 9 个扩展无 dev。任务简报假设的双扩展干扰不存在，本批未执行「停用 dev」，也无需恢复；后续批次如需双扩展对照须先重新加载 dev。
2. **角标计数观察项（低严重度，待核）**：详情页懒加载评论分批被过滤时（3 批 ×20，Popup 计数正确累加至 80），工具栏角标始终显示首屏的 20，疑似角标未随 MutationObserver 批次刷新或存在节流；不影响过滤正确性，建议后续核对 `FILTER_COUNT_UPDATED` → badge 上报链路。
3. **omnibox 补全 quirk 再次命中**：直接键入 `xueqiu.com/` 被 inline 补全为历史个股页；剪贴板粘贴完整 URL 可规避（09-06 已记录，本批实测有效）。
4. **datetime-local 年段 6 位吸收 quirk 复现**：分段连输 `20260906…` 时年段吞 6 位（年=202609），与 §3.2 记录一致；实测解法：年段输 `2026` 后按 `→` 跳段再输月日时分，可正确设置任意历史日期（预设按钮覆盖不到的值用此法）。
5. 懒加载「展开查看更多」每次追加 20 条评论，均被区间过滤即时隐藏（页面无可见变化但 Popup 计数递增），符合预期；测试时勿以「页面没变化」误判点击无效，应以 Popup 计数/角标为准。

### 环境恢复（已执行）

- `npm run test:build` 重建干净 dist-test（并校验适配包两个关键选择器已还原）→ 重载扩展 → 雪球过滤恢复（角标 15）。
- 设置恢复为测试前状态：截止 2026-09-06 00:00、隐藏策略、开启；测试产生的详情页标签页已关闭，`.tmp-backup/`（tamper 脚本+备份）已删除。
- 全程低频操作（切换间隔 ≥5s），**未触发任何「访问验证」风控**。

### 未完成或不能下结论（移交后续）

- §5.1 区间版其余类别（7x24/自选/视频/基金/资讯/达人/私募/ETF）未逐一验证（本批仅关注/热门两项抽查，任务范围如此）。
- 角标计数观察项（上述第 2 条）未定位根因，属新发现的低严重度问题，未修复。
- 原计划范围外不变：§13 全新 Profile E2E、§12 性能实测、§2.4 商店包撤销授权、§6.10、§10.x 其他平台真机、P2-19 深回溯提示等仍欠（见 09-07/09-06 批次记录）。

---

## 2026-09-08 开发批次（快捷键冲突修复 + 区间隔夜丢过滤修复）

> 承接 09-06/07 两批真机验证的发现，本批为纯开发批次：两项修复 + 回归测试 + 基线构建 + 真机部署。真机验证完成快捷键以外的部分；快捷键按键与 §6.7b 验证需用户物理操作（见下）。

### 修复 1：快捷键冲突（§8 / §6.7b 解阻）

- `vite.config.ts`：`commands.toggle-filter.suggested_key` 由 `Ctrl+Shift+T`（与 Chrome 内置「重新打开已关闭标签页」冲突，09-07 实测被抢占）更换为 **`Alt+Shift+T`**；`service-worker.ts` 相关注释同步。
- **实测发现（重要）**：重载扩展后 manifest suggested_key 变更**不会自动应用**——`chrome://extensions/shortcuts` 页两个时光机的「切换当前标签页的过滤开关」均显示「未设置」，需**手动绑定一次**：点击该输入框后物理按下 Alt+Shift+T。且快捷键捕获框不接收合成/自动化按键，此步只能人工完成；绑定后的开关切换真机验证（§8 两项 + §6.7b 扫描中关闭过滤）同待用户。

### 修复 2：区间模式隔夜空闲后新内容未过滤（09-07 真机发现，低严重度缺陷）

- **现象**：设置区间后标签页空闲 >4h，页面新注入的 7x24 条目未被隐藏（计数 0），重存设置后恢复；截止模式未观察到同类现象。
- **根因定性**：核心过滤链（observer → processPost → extract/parse → shouldFilter）在逻辑层对区间+新增节点是通的（jsdom 直接复现不出），指向「后台标签被 Chrome 节流/内存回收时变异处理丢失」一类环境性丢事件。
- **修复**：`src/content/index.ts` init 增加 `visibilitychange` 前台补扫——回到 visible 时若 adapter/settings/enabled 齐备则 `scanExisting()` 增量补处理未处理节点（processPost 以 processed WeakSet 去重；虚拟会话活跃时 `startVirtualPagination` 直接返回 true，不影响其收集；后台→前台的一次切签即可恢复）。
- **回归测试**：新增 `test/unit/content-interval.test.ts`（已挂入 package.json test，13+1=13+1）——以 no-op MutationObserver 模拟「变异处理丢失」，覆盖：区间初始过滤（窗口内保留/窗口外隐藏/计数）、丢失复现、visibilitychange 补扫恢复、重复补扫幂等，9/9 通过。注意 jsdom `visibilityState` 默认 'prerender'，测试内覆写为 'visible'。

### 基线与部署

- `npm test`（14 个文件）全绿；`npx tsc --noEmit` 0 错误；`rm -rf dist && npm run build`（check:build-loader 通过）；`npm run test:build` 生成 dist-test；`git diff --check` 通过。
- dist-test 已在 Chrome 重载并抽查无回归：新构建在雪球页正常过滤（截止 09-06 下「今天(09-08)」条目全隐）、切签往返触发看门狗无状态污染。
- dev 扩展（dist/）已重载恢复用户环境。

### 待用户 / 待后续

- ~~用户 1 分钟操作~~ → **2026-09-08 已完成**：用户在 `chrome://extensions/shortcuts` 手动绑定 Alt+Shift+T 并实机按键验证 §8 两项 + §6.7b 扫描中关闭过滤，全部通过（VERIFY-CHECKLIST §8/§6.7 已回写）。P2-16 的「修改边界、切换模式、切换类别、关闭过滤和取消扫描均恢复正确 DOM」至此全项闭环。
- 快捷键捕获框不接收自动化按键的结论如需复核，属 Chrome 安全设计，不再尝试。
- 后续测试（待批准）：§9.1 失效模态 + §9.4/9.5 诊断（dist-test 直改适配包 JSON 构造样本）、详情评论区间复验、首页区间扫尾、商店包 + 全新 Profile E2E（§13/§2.1-2.4）、性能实测（§12）。
  → 进度更新 2026-09-08：§9.1/§9.4/§9.5、详情评论区间复验（§7.4）、首页区间扫尾（关注/热门抽查）、商店包产出、性能实测（§12）均已完成（见上方批次二/三记录）；**全新 Profile E2E（§13）与 §2.1-2.4 商店包复验仍欠**。

---

## 2026-09-07 雪球真机终验批次二（P2-15 / P2-16 推进，dist-test/ 低频会话）

> 承接 2026-09-06 批次，本批完成 P2-15（连续结果/诊断/状态透明）与 P2-16（完整体验闸门）的首页信息流全类别、区间校验、虚拟分页剩余行为与跨 Tab 同步的真机验证。样本：雪球首页十类（关注/热门/7x24/自选/视频/基金/资讯/达人/私募/ETF）、二级类别、沃森生物 SZ300142 个股页（多档截止 + 区间 + 深回溯）、双 Tab 同步。测试明细已回写 `VERIFY-CHECKLIST.md` §3.2/§3.3/§3.6/§4.6/§5.1-5.5/§6.2/§6.5-6.7/§6.9/§8/§9.4-9.5 及历史记录表。无代码改动，纯验证批次。

### 本批通过项

- **§5.1 首页十类切换全量通过**：逐类验证过滤正确（可见帖均早于截止）、旧上下文无串流、每类计数隔离（含「N小时前」相对时间锚定解析与「修改于…」编辑格式样本）。
- **§5.3 7x24 通过**：「今天/昨天」分组标题 + 行内 HH:mm 组合解析正确；截止 09-07 06:14 下 06:02/05:37 等保留、其后隐藏，昨日同题快讯保留——分钟级边界准确。
- **§5.2 二级类别通过**：自选流「公告」二级独立上下文实测（昨天 15:34–19:07 公告全保留、独立计数）；关注流四标签渲染正常（该账号关注流为空，深度沿用 08-14/17 校准记录）。
- **§5.4 智能流完整性标注通过（P2-15）**：Popup 按类别带名标注（「7x24：当前类别为智能或热度信息流，仅过滤已加载内容，结果不代表完整时间范围。」）；悬浮条尾部恒有「仅过滤已加载内容」。
- **§5.5 连续滚动 3 屏通过**：ETF 流 3 屏追加无重复、无串流、计数稳定。
- **§3.2 区间校验通过**：起止输入/回显、4 区间预设（「昨天」=09-06 00:00~23:59 实测）、空值/单端报错「请同时设置开始时间和结束时间。」、起>止报错「开始时间不能晚于结束时间。」且不覆盖上次有效设置。
- **§3.6 双 Tab 同步通过**：B 标签 Popup 修改设置 → A 标签（未做任何操作）悬浮条与过滤自动按新设置更新（storage.onChanged → 广播通路真机验证）；反向（B 自动应用共享设置）亦验证。
- **§4.6 悬浮提示条通过**：内容含边界/计数/模式/扫描页数，滚动平滑无闪烁；测毕已恢复关闭。
- **§6.2 首屏跨页聚合通过**：截止 09-06 00:00 时原生第 1 页越界帖居多，引擎跨 2 原生页聚合满 10 条无空白。
- **§6.6 扫描中取消通过**：区间深回溯扫描中状态条显示「正在扫描原始第 N 页 + 取消扫描」，点击后 Popup 显示「扫描已取消，已扫描 59 个原始页面。」，已收集虚拟页保留且内容正确。
- **§6.7a 扫描中修改截止通过**：两次扫描中改截止，旧扫描立即停止、按新边界重新聚合。
- **§6.9 类别切换重建通过**：全部→交易→全部→交易往返，会话重建、缓存/计数隔离。
- **§6.5「原始页面加载失败」终态意外实测通过**：区间深回溯触发风控导致原生页加载失败，状态条正确显示该文案并停止。

### 实测发现（记录待跟进）

1. **快捷键冲突（§8/§6.7b 受阻）**：`commands.toggle-filter.suggested_key=Ctrl+Shift+T` 与 Chrome 内置「重新打开已关闭标签页」冲突，实机按下执行重开标签页、扩展切换不生效。需在 `chrome://extensions/shortcuts` 手动改绑；建议发布前评估更换 suggested_key（§6.7b「扫描中关闭过滤」依赖该快捷键，同受阻）。
2. **区间模式隔夜空闲后新内容未自动重过滤（低严重度）**：设置区间后标签页长时间空闲（>4h），页面新注入的 7x24 条目未被隐藏（已过滤计数 0）；在 Popup 重新保存一次设置后立即恢复。截止模式未观察到同类现象。疑似 interval 判定路径对无设置变更的新增节点缺一次重扫，建议排查 `src/content` 区间分支的观察器回调。**注意与上一条区分：这是隔夜长空闲场景，正常浏览会话未见。**
3. **区间深回溯的风控代价（产品提示项）**：区间 09-06 00:00~23:59 在 09-07 访问时需跨过全部 09-07 帖（个股页实测扫至 59+ 原生页、隐藏 583 条）才收敛，高频原生翻页最终触发「访问验证」滑块（人工通过后继续）。属设计内行为（553fd11 节流生效中，仅深回溯场景累积触发），建议后续在 Popup/悬浮条对「深回溯扫描中」给出更显著提示（P2-19 适配健康检查范畴）。
4. datetime-local「年」段可吸收 6 位数字导致手输错位，为浏览器原生行为；预设按钮可规避（§3.2 已记录）。

### 未完成或不能下结论（P2-15/16 剩余）

- §9.4/9.5 诊断明细与报告脱敏：全会话 0 条无法解析 → 诊断展开区按设计隐藏（`src/popup/main.ts:483` 已核实渲染条件），需构造无法解析样本后复验「查看无法解析的时间/复制诊断报告」及报告脱敏字段。
  → **2026-09-08 已完成**（批次二）：篡改适配包 timestamp.selector 构造 16 条无法解析样本，展开区、样本≤8、复制诊断报告剪贴板脱敏全部通过（VERIFY-CHECKLIST §9.4/§9.5）。
- §6.5「已到末页/已达上限」提示、§6.10 原生隐藏抵抗：真机未走到（数据深度/防御性场景），自动化覆盖。
- §6.7b 扫描中关闭过滤：依赖快捷键改绑后复验。
  → **2026-09-08 已完成**：用户在 shortcuts 页绑定 Alt+Shift+T 并实机验证通过（VERIFY-CHECKLIST §6.7/§8）。
- P2-16 闸门其余：首页区间模式全类别（本批区间只在个股页与 7x24 验证）、详情评论区间双向（08-17 已过，建议最新构建复验）、性能实测（§12）、全新 Profile 端到端（§13）、§2.4 商店包复验。
  → 进度更新 2026-09-08：详情评论区间双向 ✅（批次二 §7.4 单页双向）、性能实测 ✅（批次三 §12，mock 基准）、首页区间已覆盖关注/热门（批次二 §5.1 抽查）；其余类别区间版、全新 Profile E2E（§13）、§2.4 商店包复验仍欠（商店包已产出，见批次三）。
- P2-15 开发项「为可可靠回溯的雪球首页类别接入连续补拉」仍为开发任务（未启动），本批验证的智能流「仅过滤已加载内容」语义与之衔接。
  → **2026-09-08 已完成开发**（批次四，P2-17 切片 1：feed-backfill 引擎 + 统一状态单位 + 适配包 v0.4.0 backfill 配置，自动化覆盖）；雪球真机回归（7x24/关注流实机补拉）待下一真机批次。

---

## 2026-09-06 雪球真机终验批次（P2-16 闸门推进，dist-test/ 低频会话）

> 本节记录 2026-09-06 在 Windows Chrome 真机（已登录日常 Profile）使用 `npm run test:build` 产物 dist-test/ 完成的低频真机终验。样本：雪球首页、沃森生物 SZ300142 个股页（六类别/翻页）、两个帖子详情页、用户主页、搜索页。全程翻页/切类别/详情跳转约 20 次操作、间隔 ≥3s，**未触发任何「访问验证」风控**（553fd11 翻页节流实战有效）。测试明细与逐项状态已回写 `VERIFY-CHECKLIST.md` §0/§1.4/§2.4/§6.1/§6.3/§6.4/§7.2/§9.2/§9.3 及历史记录表。

### 本批完成项（全部为验证，无代码改动）

- **基线四项全绿**：`npm test` 12 文件、`npx tsc --noEmit`、`rm -rf dist && npm run build`（check:build-loader 通过）、`npm run test:build`；dist-test manifest 核对（无 key、host_permissions 含 xueqiu、v1.0.0）。
- **§1.4 重载注入复验通过（已知问题正式闭环）**：重载 dist-test 扩展 → 新开雪球标签、全程不打开 Popup → 内容脚本自动注入，虚拟分页自动激活（「第 1 页 · 已扫描 2 个原始页」，当天帖隐藏、截止前帖保留）。备注两点实测行为：① 引擎有数十秒启动稳定等待，其间今日帖短暂原生可见，属设计内延迟；② 重载不弹欢迎页（M2 正常）。SW loader 构建期校验 + SW 活动态 + 注入/扫描全程可用，SW DevTools 控制台未逐条核对（以运行证据为准）。
- **§6.1 个股六类别 6/6 通过（08-17「交易」受风控污染项闭环）**：全部/讨论（已扫描 2 原生页）、投资者关系（2 页，2014 调研问答全保留）、**交易（1 页、10 条模拟盘帖、零风控）**、资讯（1 页）、公告（1 页）；各类虚拟第 1 页均 10 条 + 状态条正确 + 原生列表/分页隐藏。
- **§6.3/§6.4 通过**：下一页仅多扫 1 个原生页（2→3）收满 10 条、与第 1 页零重复 ID；上一页秒回缓存，已扫描数保持 3 不变。
- **§7.2 评论分钟级精确判定通过**：详情页评论「09-05 17:59 · 云南」，截止 09-05 17:00 → 隐藏（Popup 已过滤 1 条 + 图标红色角标 1），截止 09-05 18:00 → 恢复显示；另一详情页今日评论被独立隐藏（§7.1/「今天 HH:mm」同通路验证）。实机发现：雪球详情页评论列表现显示绝对「MM-DD HH:mm · 省份」格式，「昨天 HH:mm」字面格式见于信息流 meta/正文引用块（判定同通路），或为雪球展示格式变化，不影响 H1 结论。
- **§9.2/§9.3 模态不误报通过（H4 实机复核）**：用户主页、搜索页、两个帖子详情页各等 ≥6s，均无失效模态、无注入痕迹。
- **§2.4 撤销授权定性（测试构建机制性受限）**：dist-test 将平台 origin 同时写入 manifest `host_permissions`（test:build 预授予设计），Chrome 据此忽略 optional 声明；设置页「移除」调用 `permissions.remove` 被 Chrome 拒绝（扩展错误页证据：「You cannot remove required permissions」+ 5 条 optional redundant 警告）。**非扩展缺陷**；H2 通路由自动化覆盖（content.test.ts PERMISSION_REVOKED 8 项、adapters-update.test.ts onRemoved 广播/注销）。待商店包（仅 optional 授权）构建复验 4 项手动检查。

### 环境与操作注意事项（本次实测沉淀）

- **同 Profile 并存 dev/dist-test 双扩展会互相污染**：dev（dist/，ID `eobbppih...`）重建后内容 hash 不变，其历史动态注册仍然有效，会向每个新雪球标签注入并以旧设置过滤；真机测试期间须在 chrome://extensions 停用另一方，测毕恢复（本次已按此执行并复原）。
- dist-test 首次加载会自动弹 welcome.html（install 语义）；扩展卡片可能残留一条「错误」按钮（即上述 permissions.remove 的预期报错），可「全部清除」。
- Chrome omnibox 会把「xueqiu.com」内联补全为历史记录 URL（本次两次意外导航到 /S/SZ300142），导航实验时建议输入完整 URL 或核对地址栏。

### 未完成或不能下结论（P2-16 剩余）

- P2-16 其余项不变：首页全部一级/二级类别终验、详情评论区间模式双向真机、连续滚动 3 屏性能实测、全新 Profile 端到端、§2.4 商店包复验、集思录/东财资讯真机验收等仍欠。
  → 进度更新：首页一级/二级类别终验 ✅（09-07 §5.1/§5.2）、详情评论区间双向 ✅（09-08 批次二 §7.4）、连续滚动 3 屏 ✅（09-07 §5.5）与性能实测 ✅（09-08 批次三 §12）；全新 Profile E2E、§2.4 商店包复验、集思录/东财真机验收仍欠。
- test 扩展（时光机 (test)，`hmeklmaf...`）存储为本批测试产物（截止=2026-09-05 18:00、隐藏策略、已开启），如需干净状态可在扩展详情「移除」后重新加载 dist-test。

---

## 2026-08-22/23 开发/测试交接记录（注入不稳定根治批次）

> 本节记录 2026-08-22/23 两个提交的落地状态：扩展重载后动态内容脚本注入不稳定的根因定位与根治、虚拟分页翻页节流。均为 bug 修复，未改变平台适配语义与既有架构。

### 本批完成项

- **扩展重载注入不稳定根治**（`30e5ecf`，2026-08-23）：根因是 `content/index.ts` 与 `background/index.ts` 同 basename，CRXJS 从 entry basename 生成 loader import，可能使构建成功但 service worker loader 指向 content chunk（SW 加载失败 → 动态注册从不执行 → 重载扩展后已打开标签不注入）。修复：background 入口重命名为 `src/background/service-worker.ts`；新增 `scripts/check-build-loader.mjs` 挂入 `build` 与 `test:build`，每次构建校验 loader 静态 import 指向 background chunk（含 `'Service Worker'` 标记）防回归。SW 注册通路本就含 `onInstalled` + `onStartup` + SW 顶层唤醒三重幂等触发（`service-worker.ts` 末段），根因修复后注入通路完整。
- **注入问题调查工具沉淀**（`0f90e6c`，2026-08-22）：新增 `scripts/probe-*.mjs`（12 个，probe-cdp/ext/register/sw 系列）与 `docs/CHROME-DEVTOOLS-MCP.md`，用于捕获 SW warning 级注册失败日志、安装/重载/触发扩展动作；`make-test-build.mjs` 加固。probe 脚本硬编码 Windows playwright-core 路径，仅 Windows 本机可用。
- **虚拟分页翻页节流防风控**（`553fd11`，2026-08-23）：`virtual_pagination.wait_ms` 300→800，新增可选 `next_delay_min_ms`/`next_delay_max_ms` 适配包字段（schema 校验非负且 min≤max），引擎点击下一原生页前等待随机间隔（雪球 400-800ms），降低触发「访问验证」滑块的概率。
- **时间测试日期无关化**（`8fa2edd`，2026-08-22）：`time.test.ts`「昨天 16:23」断言复用 `yestExpected`，不再锚定硬编码日期。
- **文档**（`c642b83`）：新增 `VERIFY-CHECKLIST.md` 手动验收清单与新手版指南；AGENTS.md 已知问题段已同步「注入已根治」；VERIFY-CHECKLIST §1.4 改为根治后真机复验项。

### 验证记录（本批）

- **2026-09-01 基线复跑（Linux/WSL，工作区含本节文档改动）**：`npm test` 12 个文件全部通过（含 adapters-update 18 项）；`npx tsc --noEmit` 0 错误；`rm -rf dist && npm run build` 成功且退出码 0（`check:build-loader` 随构建自动通过：`service-worker-loader.js -> ./assets/service-worker.ts-*.js`）；`git diff --check` 通过。node_modules 已含 `@esbuild/linux-x64`（此前 --no-save 补装仍在）。
- ~~注入根治的真机复验仍欠~~ → **2026-09-06 已复验通过**（见顶部「2026-09-06 雪球真机终验批次」与 VERIFY-CHECKLIST §1.4），该已知问题正式关闭；08-17 及更早记录已被本批取代。

### 未完成或不能下结论

- 同 2026-08-19 批次「未完成或不能下结论」各条不变：P2-16 雪球终验（六类别/去重/缓存待最新构建复验）、集思录/东财资讯真机验收、全新 Profile 端到端、性能实测等仍欠。
  → 进度更新：六类别/去重/缓存 ✅（09-06 §6.1/§6.3/§6.4）、性能实测 ✅（09-08 批次三 §12）；集思录/东财真机验收、全新 Profile E2E 仍欠。

---

## 2026-08-19 开发/测试交接记录（深度 Review 修复批次：H1-H5 / M1-M6）

> 本节记录 2026-08-19 全量代码深度 review 后的修复批次：5 项确认 bug（H1-H5）与 6 项中优先级问题（M1-M6）。全部为 bug 修复与性能收拢，未改变平台适配语义与既有架构；新增 1 个运行时消息（`PERMISSION_REVOKED`）。评审问题清单原文见会话记录（H1-H5、M1-M6 编号一一对应）。

### 本批完成项

- **H1 「昨天 HH:mm」评论时间误匹配**：雪球适配包相对 pattern `^昨天` 改为 `^昨天$`。此前评论「昨天 16:23 · 江苏」被相对规则吞掉时刻（解析为锚点前一天同一时刻，误差随浏览时刻游移数小时），在「昨日 15:00」（昨日收盘前）等边界预设下漏过滤/误过滤；修复后该格式走绝对解析，纯「昨天」列表帖仍走相对锚定。`time.test.ts` 新增回归断言。
- **H2 授权撤销生命周期闭环**：新增 `PERMISSION_REVOKED` 消息（`src/shared/types.ts` 同步，AGENTS.md 消息协议清单已更新）；background 监听 `permissions.onRemoved` → 收敛动态内容脚本注册（注销已撤销 origin）+ 向受影响域名全部 tab 广播停用；content script 新增幂等 `stopFiltering()`（断开 observer、移除事件监听、取消定时器、恢复全部被过滤元素/占位条/banner、上报 `FILTER_STATE_CHANGED=false`）。此前设置页「移除授权」后已注入脚本继续过滤直至刷新。
- **H3 `strip_pattern` 输入验证补齐**：schema 增加正则合法性校验（与 `extract_pattern` 同级，非法正则远程包不再能进入运行时）；`time.ts` 新增 `applyStripPattern` 编译失败静默跳过 + warn，不再抛异常中断过滤链。`xueqiu-adapter.test.ts` 新增拒绝/放行断言。
- **H4 失效模态误报收敛**：5s 零匹配检测增加两层豁免——命中评论结构（详情评论页为合法过滤目标）不视为失效；非信息流承载页（`feed_context.path_patterns` / 虚拟分页列表容器均不命中的页面，如个人主页/搜索/正文）不弹「页面结构已变化」模态。首页改版场景语义不变（mismatch 测试原样通过）。
- **H5 虚拟分页重扫风暴节流**：observer 触发的 `reapplyAll` 增加 500ms 节流（`lastScanReapplyAt`），消除 create 失败（列表/分页 DOM 未就绪）窗口期内每批 DOM 变化触发全量重扫的性能问题。
- **M1** 相对时间正则编译缓存（`relativePatternCache`，与 `extractPatternCache` 策略一致），逐帖不再重复 `new RegExp`。
- **M2** 引导页仅在 `install` 打开；扩展 update 不再弹引导页（对齐 PRD §5.1）。
- **M3** `report()` 按 `count|unparseable|context|completeness|scan` 内容去重；悬浮条重构为「root + 单一内容节点」并 250ms 节流，滚动加载不再逐帖 IPC 与 banner DOM 重建。
- **M4** Popup 非目标站点（无适配包域名）禁用全部时间控件；保存设置后 content script 未注入（QUERY_STATE 失败）时提示「当前页面尚未加载过滤脚本」。
- **M5** 隐藏/折叠/重应用统一经 `dataset.tmOrigDisplay(+Priority)` 保存并还原元素原始 display（含 inline 样式与优先级），与虚拟分页 `nativeDisplays` 恢复模式对齐，不再粗暴 `display=''`。
- **M6** `TOGGLE_FILTER` 增加 `adapter && settings` 守卫：白名单外/未设定时间的页面不再翻转图标状态与实况脱节。

### 验证记录（本批）

- `npm test` 12 个测试文件全部通过（新增断言：time「昨天 HH:mm」、xueqiu-adapter strip_pattern schema、content 第 8 节 PERMISSION_REVOKED 8 项、adapters-update onRemoved 广播/注销；window-content/content 的 banner 等待窗口按 250ms 节流调整）。
- `npx tsc --noEmit` 0 错误；`rm -rf dist && npm run build` 成功后退出码 0；`git diff --check` 通过。
- Linux/WSL 环境仍按既有记录补装 `@esbuild/linux-x64@0.28.2`（--no-save，不改 package.json）。

### 未完成或不能下结论

- 全部待手动验收项按模块整理在 `VERIFY-CHECKLIST.md`（含步骤、验收项与状态核对框），P2 真机验证清单与新修复复核点均已并入。
- 雪球真机回归（个股六类别、首页上下文、详情评论、失效模态误报收敛的实机复核）仍欠；本批零改动虚拟分页扫描核心，回归由既有 6 个雪球测试文件把关。
  → **2026-09-08 全部闭环**：个股六类别 ✅（09-06 §6.1）、首页上下文 ✅（09-07 §5.1/§5.2）、详情评论 ✅（09-06/07 §7.1/§7.2 + 09-08 §7.4）、失效模态不误报 ✅（09-06 §9.2/§9.3）且正向触发 ✅（09-08 批次一 §9.1 构造法验证）。
- P2-16 雪球终验、P2-17~P2-20 通用能力、P2-21 其他金融平台、P2-22/23 发布准备的待办状态不因本批改变；集思录/东财资讯真机验收仍欠。

---

## 2026-08-18 开发/测试交接记录（有限开闸批次）

> 本节记录「有限开闸」批次（`.kilo/plans/1787062802798-limited-unblock-jisilu-eastmoney-news.md`）的落地状态。该批次因 P2-16 雪球终验被风控/真机条件阻塞而启动，只做不动雪球核心引擎的通用增强与两个零跨年歧义平台的适配；继续遵守「雪球验收未通过前不并行启动其他平台正式适配开发」的闸门约束，本批次新平台仅内置适配包，真机验收仍欠。

### 本批完成项

- 时间解析通用增强 `timestamp.extract_pattern`（正则提取时间子串，命中取 `match[0]` 再走相对/绝对解析，未命中回退原文本）。
- 适配包页面白名单 `active_paths`（pathname 正则）：声明后仅白名单路径启用过滤与失效检测，其他路径 content script 静默退出（`console.log` 后 return，不建 observer、不弹模态）；雪球/同花顺未声明，行为不变。
- 新内置适配包：集思录 `src/adapters/jisilu.json` v0.1.0（`domains: ["jisilu.cn"]`，列表 `.aw-question-list > .aw-item` + 详情回复 `.aw-dynamic-topic > .aw-item[id^='answer_list_']`，`extract_pattern` 从「作者 回复 • YYYY-MM-DD HH:mm • N 次浏览」提取时间，全年份无跨年歧义）；东方财富资讯 `src/adapters/eastmoney-news.json` v0.1.0（`domains: ["finance.eastmoney.com"]`，`li[id^='newsTr']` + `p.time` 中文年月日格式）。两者均为服务端 URL 分页，不接虚拟分页（P2-17 范畴），仅逐页加载过滤。两个适配包已挂入 `BUILTIN_ADAPTERS`。
- 权限接线三处同步：`optional_host_permissions` / `web_accessible_resources.matches`（vite.config.ts）/ background `TARGET_MATCHES` 各追加 `*://finance.eastmoney.com/*`、`*://jisilu.cn/*`、`*://www.jisilu.cn/*`；popup 授权 origin 改为按实际 hostname 构造（hostname 带 www 且与 apex 不同时一次 request 传两个 origins），storage key 仍用 `extractDomain` 归一后的 apex。
- Popup 截止预设适配包驱动化：`renderCutoffPresets` 按 `adapter.quick_presets` 生成按钮（无适配包时沿用三兜底项），`resolvePreset` 新增 `today_0915`/`today_0930`/`yesterday_1500`；雪球适配包 quick_presets 由 3 项扩为 6 项（新增「今天09:15」「今天09:30」「昨日收盘前」）。`test/unit/popup-auth.test.ts` 预设按钮期望由 3 改为 6（保持绿灯，非新增测试）。
- 诊断明细增强：`TimeDiagnostic` 增加 `page`（pathname，不含 query）与 `context`（当前类别/上下文）；Popup 诊断展开区新增「复制诊断报告」按钮，复制内容为平台/适配包内置版本、模式与边界、计数、逐条 {kind, page, context, raw, 回退行为=默认显示}，含 pathname 与时间原文，不含 URL query/帖子正文/账号信息（PRD F8 脱敏约束）。

### 代码审查修复（2026-08-18 晚，本地 review 后按用户指示修复）

- `authOrigins()` 收敛到 manifest `optional_host_permissions` 声明清单：派生 origin 超出声明时（如未声明 www 变体的 hostname）request 必失败形成授权死结，现过滤后回退 apex；`test/unit/popup-auth.test.ts` 与 `popup-window.test.ts` 的 runtime mock 补充 `optional_host_permissions`。
- `active_paths` 白名单判定抽为 `isPathAllowed(platform)`，init 早退时置 `adapter = null`，`reloadAdapter`（ADAPTERS_UPDATED 通路）复用同一判定——排除页在消息通路（TIME_SETTINGS_UPDATED/ADAPTERS_UPDATED/QUERY_STATE）同样静默退出，不再经 `reapplyAll` 意外过滤。
- `requestAuth` 成功路径与 init 已授权路径同构：隐藏授权区、`loadSettingsIntoUI()`（重读 settings 回显输入）、`refreshContentState()`——修复授权后复制诊断报告输出「模式=未设定」及授权区文案矛盾。
- `extract_pattern` 正则编译缓存（模块级 Map，同一正则复用实例），消除逐帖重复 `new RegExp`；灾难性回溯模式复杂度阈值检查登记为 P2-19 适配健康检查项（本批不实现）。
- schema 跨字段约束：`type === 'relative'` 不得声明 `extract_pattern`（提取会使相对文本跳过相对解析、静默错误归类）；`quick_presets` 校验 label/value 必须为非空字符串。

### 验证记录（本批）

- `npm test` 12 个文件全部通过（含 popup-auth 6 预设断言）；`npx tsc --noEmit` 0 错误；`rm -rf dist && npm run build` 成功后退出码 0；`git diff --check` 通过。
- 一次性片段验证（T3 前置，node ESM 直连 dayjs，未写成测试文件）：`dayjs('2026年08月17日 20:16', 'YYYY年MM月DD日 HH:mm', true)` strict 解析有效；extract_pattern `(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?)` 对集思录样本「作者 回复 • 2026-08-17 22:05 • 5856 次浏览」提取出 `2026-08-17 22:05`。
- 本环境注意：node_modules 为 Windows 平台 esbuild（win32-x64），Linux/WSL 下 tsx/vite 需 `npm install --no-save @esbuild/linux-x64@0.28.2` 补二进制；该补丁不改 package.json。

### 未完成或不能下结论

- 集思录/东财资讯的选择器均为单快照样本（recon 2026-08-17/18 记录），详情页回复分页/懒加载机制、大帖回复、栏目一致性（仅 czqyw/cgspl 双栏目验证）待真机验收；失效模态在 active_paths 内仍是兜底。
- 雪球 P2-16 真机终验仍未闭环；本批零改动雪球虚拟分页/上下文代码，回归由既有 6 个雪球测试文件把关。
- 扩展重载后注入不稳定、东财股吧/天天基金（MM-DD 无年份 + 双时间字段）、金融区间预设等仍按计划留待后续批次。

---

## 2026-08-17 开发/测试交接记录

> 本节是当前未提交工作区的接手基线。此前计划中的勾选项保留历史含义；若与本节冲突，以本节的实际终验状态为准。

### 当前代码与构建

- 工作区存在未提交变更，包含截止/区间模式、雪球首页上下文、个股虚拟分页、诊断/状态、Popup/设置体验、动态内容脚本同步及其测试；接手前先执行 `git status --short` 和 `git diff`，不要覆盖现有改动。
- 雪球内置适配包版本为 `0.3.0`，单次虚拟分页扫描上限为 200 个原生页。
- 2026-08-16 最后一次构建成功，业务脚本为 `dist/assets/index.ts-DwtVkn2F.js`，loader 为 `dist/assets/index.ts-loader-CvqizKNj.js`。
- 最后一次完整自动化基线（上一构建）为 `npm test`、`npx tsc --noEmit`、`npm run build`、`git diff --check` 全部退出码 0；最后补丁后单独复跑 `npx tsx test/unit/xueqiu-backfill.test.ts`、`npx tsc --noEmit`、`npm run build`，均退出码 0。最后补丁后尚未再次运行完整 `npm test` 和 `git diff --check`。

### 已实现并有自动化覆盖

- 截止模式与闭区间模式（`start <= timestamp <= end`），包括 Popup 输入/校验/回显、跨 Tab 更新、普通列表、评论和虚拟分页判定。
- 雪球首页一级/二级类别上下文、`7x24` 日期与行内时间组合、刚刚/N 秒前解析、上下文切换时缓存/计数/任务隔离。
- 雪球个股虚拟分页：稳定 ID 去重、上一页缓存、跨原生页聚合、200 页上限、扫描/末页/取消/错误状态、原生列表与分页持续隐藏、原生节点整体替换后重新绑定。
- 雪球空类别：适配配置 `empty_selector: ".stock-timeline > .empty"`；最后补丁在逐页等待轮询中主动检测空状态，覆盖 `.stock-timeline` 根节点被整体替换的回归场景。
- 旧远程适配包不再覆盖版本更高的内置适配包；动态内容脚本注册同步 `matches/js/runAt/persistAcrossSessions`，并覆盖旧 loader 哈希更新测试。

### 真实 Chrome 已确认通过

- 使用已登录雪球 Profile，最新版脚本 URL 已确认是 `chrome-extension://eobbppihdmnbfclgieihaabdifmhagfj/assets/index.ts-DwtVkn2F.js`。
- 个股“全部”干净启动：虚拟第一页 10 条，状态“第 1 页 · 已扫描 8 个原始页”；原生 `.status-list` 和 `.pagination` 均带 `data-tm-virtual-native="1"` 且计算样式为 `display:none`；未出现“原始页面加载失败”。
- 切换“投资者关系”：雪球原生空状态“该股票暂无信息”保留，`.tm-virtual-pagination` 为 0，页面无“正在扫描”或“原始页面加载失败”。
- 从空类别返回“讨论”：虚拟分页恢复，第一页 10 条、扫描 8 个原始页，原生列表/分页保持隐藏且无加载错误。
- 更早的真机记录确认：首页普通类别、`7x24`、个股分页的第一页/下一页/上一页缓存和详情评论区间过滤可工作；详情评论样本为区间内 `08-11 18:44` 保留、区间外 `08-13/今天` 8 条隐藏。

### 未完成或不能下结论

- 个股六类别的本轮完整终验未完成。“交易”类别测试过程中雪球页面出现“访问验证”滑块（TraceID `3ccdc17517868922656743338e913f`），随后原生列表/分页消失并显示插件加载失败；该结果受网站风控污染，既不能判定为插件竞态缺陷，也不能判定该类别通过。接手者应在解除风控、降低点击/翻页频率后重新验证交易/资讯/公告及全部六类。
  → **已闭环：2026-09-06 §6.1 六类别 6/6 通过（含「交易」，零风控，553fd11 节流生效）。**
- 本轮尚未完成虚拟第二页与第一页 ID 去重、上一页缓存不增加扫描页数的最新版复验；只能引用更早构建的通过记录，仍建议对 `DwtVkn2F` 重跑。
  → **已闭环：2026-09-06 §6.3 去重、§6.4 上一页缓存 通过（最新构建）。**
- 雪球首页全部一级/二级类别、详情评论、截止/区间模式切换、跨日/本地时区、连续滚动三屏、全新 Profile、授权/引导/失效保护、诊断报告和性能均未完成最终端到端验收。
  → 进度更新 2026-09-08：首页类别 ✅（§5.1/§5.2）、详情评论 ✅（§7.1/§7.2/§7.4）、截止/区间切换 ✅（§3.2/§6.7/§6.9）、连续滚动三屏 ✅（§5.5）、失效保护 ✅（§9.1-§9.3）、诊断报告 ✅（§9.4/§9.5）、性能 ✅（§12）；**全新 Profile E2E 与授权/引导（§1.1/§2.1-2.2）仍欠**（依赖商店包 + 全新 Profile）。
- 动态注入仍有独立已知问题：重载扩展后，新开的雪球标签可能没有自动注入内容脚本；打开时光机 Popup 后注册同步并刷新页面可恢复。已修复注册参数/loader 哈希同步，但“仅重载扩展时后台自动注入不稳定”的根因尚未关闭。
  → **已根治并闭环：2026-08-23 30e5ecf（background 入口重命名 + 构建期 loader 校验），2026-09-06 §1.4 真机复验通过。**
- 远程适配包正式发布源、签名/校验、版本回退与热更新真实环境尚未建立；当前仅有选择/缓存/版本逻辑测试。

### 建议接手顺序

1. 先完整运行 `npm test`、`npx tsc --noEmit`、`npm run build`、`git diff --check`，确认未提交基线。
2. 在无雪球访问验证的低频会话中，重跑个股六类别、第二页去重、上一页缓存与空类别；每次切换等待网站原生列表稳定，避免连续自动扫描触发风控。
3. 单独复现并修复“扩展重载后动态内容脚本未自动注入”，不要把该缺陷与雪球业务逻辑混在一起。
4. 再验收详情评论、雪球首页全部上下文、性能和全新 Profile；全部通过后更新 P2-16，之后才进入通用引擎和其他平台。

> 基于 PRD-v1.0.md 拆解，每步可实施、可验证。
> 更新日期：2026-08-17
> P0/P1 已完成；P2 调整为金融领域 v1.0。雪球个股虚拟分页、六类别切换、区间模式和首页分类基础过滤已实现，当前继续完成雪球真机竞态、详情评论、全新 Profile 与性能验收，验收通过后再适配其他金融平台。

---

## 阶段总览

| 阶段 | 目标 | 状态 |
|------|------|------|
| [Phase 0](#phase-0-项目脚手架) | 项目脚手架搭建 | ✅ 已完成 |
| [Phase 1](#phase-1-v01-原型验证) | v0.1 原型验证（雪球单平台） | ✅ 已完成（自动化全部通过，待 Chrome 实测 4 项） |
| [Phase 2](#phase-2-v10-mvp-发布) | v1.0 金融首发（雪球全场景优先+区间模式+金融平台覆盖） | 🚧 进行中 |
| [Phase 3](#phase-3-v11-扩展) | v1.1 金融体验增强 | 🔲 待开始 |
| [Phase 4](#phase-4-v12-剧透线) | v1.2 剧透线（豆瓣+模糊策略） | 🔲 待开始 |

---

## Phase 0: 项目脚手架

> **目标**：搭建可运行的 Manifest V3 浏览器扩展项目骨架，支持 HMR 开发。

### P0-1: 初始化项目结构
- [x] 使用 Vite + CRXJS 创建扩展项目骨架
- [x] 配置 `manifest.json`（Manifest V3）
- [x] 配置构建输出目录为 `dist/`
- [x] 验证：`npm run build` 无报错（67ms 构建通过）

### P0-2: 目录结构设计
- [x] 创建 `src/` 下 background / content / popup / options / adapters / shared 目录
- [x] 验证：13 模块全部编译产出

### P0-3: 开发环境验证
- [x] 安装 dayjs 依赖，`tsc --noEmit` 类型检查通过
- [x] 配置 HMR + 自动 reload（`npm run dev` 实测通过）
- [x] 安装 superpowers-chrome MCP + clawbrowser skill + Playwright CLI
- [x] playwright-cli 验证：xueqiu.com 成功截图并提取页面 DOM

### P0-4: 真机加载验证
- [x] Chrome 打开 `chrome://extensions` → 开发者模式
- [x] 「加载已解压的扩展程序」→ 选择 `dist/`，图标正常无报错
- [x] 修改 popup HTML → dev server 自动 reload → popup 内容实时更新（HMR 验证）
- [x] ⚠️ 踩坑：Windows safe-delete shim 拦截 Vite `emptyOutDir` → `vite.config.ts` 设 `emptyOutDir: false`

### P0 技术栈总结
- Vite 8.2.1 + @crxjs/vite-plugin 2.7.1 + TypeScript 5.6 + dayjs 1.11 + Lucide 1.31
- Manifest V3；`content_scripts.matches: []` 在 CRXJS 下合法

---

## Phase 1: v0.1 原型验证

> **目标**：雪球单平台 + 截止模式 + 隐藏策略，通过全部三条验收标准。

### P1-1: 适配包基础设施
- [x] 定义适配包 JSON Schema（`src/adapters/schema.ts`）
- [x] 实现 `AdapterManager`（`src/adapters/index.ts`）
- [x] 编写雪球适配包 `xueqiu.json`（2026-08-14 登录态 DOM 取证校准）：
  - 普通信息流：`article.timeline__item` + `a.date-and-source[data-id]`
  - 首页 7x24：`.timeline__live tr`，组合分组日期标题与行内 `HH:mm`
  - `timestamp`: 相对时间解析（"刚刚/N秒前/N分钟前/N小时前/昨天/N天前"）
  - `quick_presets`: `["1小时前", "今日0点", "昨日0点"]`

### P1-2: 时间设置与存储
- [x] Popup 控制面板（截止模式）：datetime-local 输入、快捷预设、过滤策略、站点显示+过滤计数、按需授权引导
- [x] `chrome.storage.local` 持久化（key: `timeSettings.<domain>`）
- [x] Service Worker：拦截 `storage.onChanged`、动态注册 content script、badge 计数+图标切换

### P1-3: Content Script 核心过滤
- [x] `MutationObserver` 监听 DOM（`childList: true, subtree: true`）
- [x] 帖子时间戳提取（相对时间锚定 + 绝对时间多格式兜底）
- [x] 过滤判定 + "隐藏"策略（`display = 'none'`）
- [x] 过滤计数器 + SW 图标 badge 同步
- [x] 自动化验证（jsdom 24/24 通过）

### P1-4: 性能验证
- [x] jsdom 自动化：14 帖连续处理无错误，处理为同步轻量操作
- [x] **待 Chrome 实测**：雪球首页 50-80 条 + 连续滚动 3 屏，DevTools Performance 录制 MutationObserver callback 累计 < 1s（→ **2026-09-08 已完成**：VERIFY-CHECKLIST §12 四项通过——playwright Chromium + 结构化 mock 雪球页实测，0 长任务/60fps，回调累计以 longtask 上界代理 = 0ms；未在登录态真站复测，方法边界见 §12 记录）

### P1-5: 适配包失效检测
- [x] 5 秒内 `post_selectors` 零匹配 → 不过滤 + 页面提示条注入
- [x] 自动化验证（jsdom 5/5 通过）

### P1-6: 快捷开关
- [x] Popup 顶部开关按钮 + 图标状态切换（彩色/灰色）+ 状态按 Tab 独立

### P1-7: 首次引导页
- [x] `public/welcome.html`：3 步引导（概念说明 → 选策略 → 试雪球）
- [x] SW `onInstalled` 自动打开引导页

### P1 自动化验证结果
- `time.test.ts`：相对时间锚定（±1min）、绝对多格式兜底、截止判定零误杀/零漏杀
- `content.test.ts`（24/24）：初始过滤、MutationObserver 增量、时间变更重应用、开关切换、折叠策略、评论过滤、悬浮提示条
- `mismatch.test.ts`（5/5）：零匹配 → 提示条注入 + 不过滤

### P1 Review 修复记录（2026-08-11）
1. `popup/main.ts` `saveCutoff` 未校验 `NaN` → 增加 `Number.isNaN(ts)` 拦截
2. `popup/main.ts` 未读取全局 `defaultStrategy` → `init` 中增加 `getPrefs()` 同步
3. `content/index.ts` `cutoff=0` 边界处理 → 统一改为 `settings?.cutoff == null`
4. `background/service-worker.ts` 未使用 `badgeCount` 设置 → 增加判断
5. `content/index.ts` `scheduleMismatchCheck` 只检查 `post_selectors[0]` → 改为 `.every` 全零匹配
6. `content/index.ts` 相对时间锚定未持久化 → 写入 `dataset.tmAnchor` 复用原锚点

### P1 真机验证清单

| # | 项目 | 状态 |
|---|------|------|
| 1 | 安装引导页：卸载重载 → 自动弹出 welcome.html，3 步走完 | [x] |
| 2 | 引导完成后插件默认关闭 | [x] |
| 3 | `chrome.storage.local` 写入 `prefs.defaultStrategy` | [x] |
| 4 | 雪球个股页 → 授权 → 设「1小时前」→ 开启 → 新帖隐藏、老帖保留 | [x]（2026-08-13 用户确认基础过滤正常；09-06/07/08 多批次复验） |
| 5 | 关闭面板，刷新页面 → 截止时间持久化 | [x]（2026-09-08 跨会话实证：截止 2026-09-06 00:00 于 09-06 写入后，历经扩展多次重载与多次浏览器会话，09-07/09-08 Popup 回显一致并持续生效，强于「刷新页面」场景；VERIFY-CHECKLIST §3.5 已据此闭环） |
| 6 | 切换策略（隐藏 ↔ 折叠），折叠后占位条可展开 | [ ]（2026-09-08 部分证据：折叠策略渲染与占位条样式已在真实构建可见（store-assets/3-feed-collapse-mock.png）；占位条点击展开交互仍待真机，见 VERIFY-CHECKLIST §4.2） |
| 7 | 关闭过滤 → 全部恢复；重新开启 → 再次过滤 | [x]（2026-09-08 详情页 Popup 关闭/开启双向实测：关闭→被过滤评论全部恢复且计数清零、开启→重新过滤（VERIFY-CHECKLIST §7.4 记录）；快捷键关闭链路 §6.7b 亦已由用户实机验证） |
| 8 | 面板「已过滤 N 条」+ 图标角标实时变化 | [x]（多批次实机观察：角标 25/15/18/10 与 Popup 计数随过滤实时联动；遗留 P3 观察项——懒加载评论分批被过滤时角标未即时增长而 Popup 计数正确，见 09-08 批次记录） |
| 9 | A/B 双 Tab 时间同步（改 A → B 自动同步） | [x]（2026-09-07 双 Tab 双向验证通过，VERIFY-CHECKLIST §3.6） |
| 10 | 滚动性能：雪球首页 50-80 帖 + 滚 3 屏，无卡顿，MutationObserver < 1s | [x]（2026-09-08 §12 四项性能实测通过（mock 基准，边界见 §12），见 VERIFY-CHECKLIST §12） |

---

## Phase 2: v1.0 MVP 发布

> **目标**：先把雪球网页端目标场景做完整，再扩展国内金融社区/资讯网页；支持截止与起止区间、类别信息流、连续结果和能力透明。
> 微博已放弃适配（2026-08-12 决议：关注流仅保留约10页深度硬限制）。
> **开发闸门**：P2-13 至 P2-16 的雪球完整体验和真机验收未完成前，不启动其他平台正式适配。

### P2-1: 同花顺适配包
- [x] playwright-cli DOM 取证（2026-08-11）：帖子容器 `li.feed-item`，时间 `data-date`(MMDD) + `.feed-item-timeline-time`(HH:mm) 组合
- [x] 适配包 `ths.json` + 扩展 timestamp 支持 `date_attr` 组合模式
- [x] 自动化验证（`ths.test.ts` 9/9 通过）

### P2-2: 时间戳解析增强
- [x] 相对时间解析（"N分钟前/小时前/天前"）+ 今天/昨天 HH:mm
- [x] 无法解析回退：默认显示 + "N 条无法解析"标注
- [x] Popup 精度标注：相对时间平台显示 "⚠️ 精度 ±5 分钟"

### P2-3: 折叠策略
- [x] 占位条 `<div class="tm-collapsed">⏳ 此帖被时光机过滤</div>`，点击展开
- [x] Popup 支持切换隐藏/折叠

### P2-4: 评论过滤
- [x] DOM 取证：雪球详情页 `.comment__item`，时间 "今天 08:17 · 江苏"
- [x] 评论按自身时间戳独立判定 + 无时间戳回退策略（全部显示/默认折叠）
- [x] jsdom 验证 4 项通过

### P2-5: 适配包热更新
- [x] SW `chrome.alarms` 每 12h + 安装时首拉
- [x] semver 对比 + Schema 校验；失败静默降级到内置兜底
- [x] 设置页「适配包自动更新」开关
- [x] 自动化验证（`adapters-update.test.ts` 13/13 通过）

### P2-6: 设置页
- [x] 默认过滤策略、角标计数、悬浮提示条、评论回退策略、授权管理、适配包版本、自动更新开关、版本号
- [x] Popup 标题栏增加设置图标，可直接打开扩展设置页
- [x] 设置页重整为通用/评论过滤/站点与适配/高级四个分区；复选项使用开关控件，授权与适配状态使用结构化列表
- [x] 响应式视觉验证：1280px 桌面与 390px 窄屏均无横向溢出、文字截断或控件错位
- [ ] 待补：全局快捷键自定义、快捷预设管理、自定义适配包导入

### P2-7: 快捷键
- [x] `chrome.commands` 监听 `Ctrl+Shift+T`
- [ ] 待 Chrome 实测

### P2-8: 悬浮提示条
- [x] 右下角半透明深色提示条（可关闭，设置页默认关）
- [x] jsdom 验证 4 项通过

### P2-9: 按需授权
- [x] 首次访问未授权域名 → Popup 提示「点击授权」→ `permissions.request`
- [ ] 待 Chrome 实测

### P2-10: 适配包失效模态
- [x] 全零匹配 → 不过滤 + 不可关闭模态浮层（遮罩+"刷新重试"）
- [x] jsdom 验证 5 项通过

### P2-11: 微博适配
- [x] **已放弃**（2026-08-12 决议：关注流仅保留最近约 10 页深度硬限制，核心场景无法成立）

### P2-12: 雪球个股虚拟分页
- [x] 真实 DOM 取证：`.stock-timeline > .status-list`、每原生页 10 条、`.pagination__next` 原地换页
- [x] 六类标签取证：全部/讨论/投资者关系/交易/资讯/公告共用帖子、时间戳、稳定 ID 与分页结构
- [x] 稳定 ID/链接：`a.date-and-source[data-id]`；编辑帖 `修改于MM-DD HH:mm` 可解析
- [x] 配置字段 `virtual_pagination` 全部位于 `src/adapters/xueqiu.json`，通用引擎无雪球域名/选择器硬编码
- [x] 实现 `src/content/virtual-pagination.ts`：从原始第 1 页开始串行懒扫描，每虚拟页 10 条，收满即停
- [x] 缓存上一页、稳定 ID 去重、200 原生页硬上限、末页/上限/取消/超时状态
- [x] 虚拟列表使用克隆展示并保留原帖链接；禁用克隆内依赖雪球框架事件的表单/按钮
- [x] 截止时间变化、过滤关闭和适配包重载时中止扫描并恢复原生列表/分页
- [x] 类别上下文监听：活动标签变化时取消旧会话、清空类别缓存并为新类别重新绑定被替换的列表/分页节点
- [x] 自动化：跨原生页聚合、懒加载、去重、无法解析默认显示、缓存回翻、恢复 DOM
- [x] Chrome 基础实测：过滤及虚拟分页生效，用户确认截止当前功能正常（2026-08-13）
- [x] Chrome 类别取证与切换实测：全部/讨论/投资者关系/交易/资讯/公告共用结构，类别切换可独立重建（2026-08-13）

### P2-13: 截止/起止时间模式
- [x] 类型与判定层预留：`mode: 'window'` + `window.start/end`，保留区间为 `start ≤ 时间 ≤ end`
- [x] 雪球虚拟分页可复用窗口判定，并仅在起止边界完整时启动
- [x] Popup 增加“截止/时间区间”分段模式与起始/结束时间输入
- [x] 起始时间不得晚于结束时间；完成保存、回显、跨 Tab 更新和模式切换取消旧任务
- [x] 区间预设：今天、昨天、本周、最近 3 天
- [x] 悬浮提示条、日志与计数状态按模式显示完整时间边界
- [x] 普通列表、评论、虚拟分页和闭区间边界专项自动化
- [ ] 真机验证本地时区、跨日区间和模式切换中的扫描取消

### P2-14: 雪球首页分类信息流
- [x] 登录态 DOM 取证一级类别：关注/热门/7x24/自选/视频/基金/资讯/达人/私募/ETF
- [x] 取证二级类别：关注流的全部/关注精选/只看原发/未分组，自选流的全部/公告/新闻；统一选择器可识别后续动态标签
- [x] 将类别/筛选抽象为配置驱动的信息流上下文；切换时取消旧任务，隔离缓存、游标、去重与计数
- [x] 逐类验证：普通流使用 `.status-list > article.timeline__item` 与 `a.date-and-source[data-id]`，分析字段均为 `order=smart`；7x24 使用 `.timeline__live tr`、分组日期 + 行内时间，滚动 60 条后转“加载更多”
- [x] 智能/热度流只承诺过滤已加载内容，并在 Popup/悬浮条标明结果完整性
- [x] 类别选择器和上下文规则进入 `xueqiu.json`，通用引擎不硬编码雪球标签文本
- [x] 自动化覆盖一级/二级类别切换、DOM 替换、计数隔离和 7x24 分组时间解析
- [x] 登录 Chrome 逐类校准选择器，并通过关注→视频→ETF 快速连续切换与旧任务隔离验收；动态自定义分组仍需在账号出现该配置时补测

### P2-15: 雪球连续结果、诊断与状态透明
- [x] 个股虚拟分页上报扫描状态、已扫描原生页数、末页、上限、取消和加载错误
- [x] 原生列表/分页使用会话标记、`display:none!important` 与属性观察器持续隐藏，防止雪球异步改回 `display:block`；销毁会话时恢复原值
- [x] 类别切换等待与原生逐页轮询间隔分离，避免空类别使用旧 DOM 提前创建虚拟会话
- [x] 明确显示“仅过滤当前已加载内容/正在跨页查找/已到末页/结果可能不完整”
- [x] 无法解析默认显示；Popup 展开查看帖子/评论原始时间文本的本地样本
- [x] 首页逐类别完成首轮排序/加载取证：普通流为智能排序，7x24 为时间序；两者均先滚动追加，并在阈值后显示“加载更多”
- [x] 为可可靠回溯的雪球首页类别接入连续补拉；智能流保持仅过滤已加载内容（2026-09-08 批次四开发 + 2026-09-09 批次五真机验收通过：VERIFY-CHECKLIST §5.6；站点「加载更多」按钮式获取归切片 2）
- [ ] 诊断明细补充页面类型、当前类别、采用的回退行为与复制报告

### P2-16: 雪球完整体验验收闸门
- [ ] 首页全部目标类别、个股六类别、详情评论均通过截止与区间模式真机验收
  - 进度更新 2026-09-08：**截止模式已全覆盖**（首页十类 ✅09-07 §5.1、个股六类 ✅09-06 §6.1、详情评论 ✅§7.1/7.2）；**区间模式已覆盖** 个股页（09-07 §3.2/深回溯）、7x24（09-07）、关注/热门（09-08 批次二 §5.1 抽查）；首页区间版其余 6 类（自选/视频/基金/资讯/达人/私募/ETF）未逐一，闭环后本项方可勾。
  - 进度更新 2026-09-09：区间版其余类别抽查完成——自选/基金/资讯/达人/私募/ETF 六类 ✅（§5.1）；**视频类存在适配覆盖缺口（新观察 O1：窗口外视频卡片绕过过滤链），区间版视频类不通过**，本项在 O1 修复复验前保持不勾（缺口为数据驱动适配问题，非引擎缺陷）。
- [x] 区间模式详情评论真机双向样本：区间内 `08-11 18:44` 保留，区间外 `08-13/今天` 8 条全部隐藏（2026-09-08 批次二 §7.4 已用最新构建复验：单页双向样本 + 关/开对照）
- [x] 各类别连续加载 3 屏或跨页扫描，无旧上下文串流、重复帖子和错误计数（2026-09-07/08：§5.5 ETF 三屏追加零重复、§6.2 首屏跨页聚合、§6.3 下一页去重、§6.4 上一页缓存、§6.9 类别切换重建隔离、§5.1 计数隔离）
  - [x] 修改边界、切换模式、切换类别、关闭过滤和取消扫描均恢复正确 DOM（09-07：改边界/切类别/取消扫描；09-08：Alt+Shift+T 关闭过滤，用户实机验证）
- [x] 新 Profile 完成授权、引导、设置、失效保护、诊断和性能验收（= VERIFY-CHECKLIST §13 + §2.1-2.2，依赖商店包——ZIP 已产出见 P2-23）（✅ 2026-09-09 批次六：§13 端到端 + §2.1/2.2 商店包真机通过；诊断=§9.4/9.5（09-08 构造法）、性能=§12（09-08 mock 实测））
- [x] 通过后方可开始 P2-17 至 P2-20 的通用能力建设；完成后再开始 P2-21 其他金融平台适配（历史注记：08-18 曾因 P2-16 被风控阻塞「有限开闸」做过通用增强与两个内置适配包，见该批次记录）（**P2-16 闸门 2026-09-09 正式关闭**：第 1 项区间版视频类缺口（O1，窗口外视频卡片绕过过滤）转适配包 v0.4.1 跟踪，作为已记录例外；其余全过，批次五已先行启动 P2-17 开发）

### P2-17: 通用虚拟分页/补拉引擎（雪球闸门后、平台适配前）
- [ ] 统一获取策略配置：原生页码、下一页、加载更多、无限滚动、严格时间排序切换
  - ◐ 切片 1（2026-09-08 批次四）：无限滚动补拉已落地（feed-backfill.ts，数据驱动 feed_context.backfill）；原生页码策略收编与 load-more 按钮式为切片 2
- [ ] 统一稳定 ID 去重、缓存、取消、加载超时、末页、重复页和扫描上限
  - ◐ 补拉侧已落地：取消/末页/屏数上限/命中目标（feed 原生流承担去重与缓存语义，无需重排）；虚拟分页侧收编待切片 2
- [ ] 统一首屏目标：过滤后第一页尽量直接出现符合条件的内容，收满即停而非无界预取
  - ◐ 补拉按 target_hits 收满即停；虚拟分页本就收满即停；「首屏直接出现符合条件内容」的聚合目标待统一
- [ ] 统一可信状态：仅过滤已加载内容、正在跨页查找、已扫描 N 个原生页面、已到末页、非严格时间排序
  - ◐ ScanProgress 增 unit: 'pages'|'screens'（批次四）；「非严格时间排序」以 contexts 白名单 + loaded-only 标注体现
- [x] 所有状态可被 Popup、悬浮条和设置页消费；“未找到”不得被表达成“网站没有”（2026-09-08 批次四：Popup scanStatusText 与悬浮条按 unit 渲染「屏/原生页」双语义；「未找到」始终表达为已扫描范围而非站点无内容）
- [ ] 用雪球个股页和至少一个首页可回溯类别做兼容回归，再允许新平台复用（真机欠，切片 1 回归批次执行）
  - ✅ 2026-09-09 批次五完成：雪球个股页（SZ300142 区间模式虚拟分页激活/取消/切截止即时重滤）+ 首页两个可回溯类别（7x24/关注流全状态）真机回归通过（§5.6）；新平台复用闸门的此项回归就绪

### P2-18: 平台能力矩阵与金融场景预设
- [x] 设置页按“平台 + 页面类型”展示列表、评论、区间、跨页、时间精度、排序完整性和已验证页面（2026-09-09 批次八：页面类型能力矩阵，从适配包配置推导，雪球 3 类页面；列表=页面类型行的隐含前提，评论列对信息流/个股页如实为「—」）
- [x] 显示适配包版本、最后验证日期和当前健康状态（2026-09-09 批次七/八：版本+验证日期+已验证/未真机验证两档健康状态；运行时健康指标（解析率等）归 P2-19/P2-22）
- [ ] 截止预设：今天 09:15、今天 09:30、昨日收盘前
  - [x] 已随雪球适配包 quick_presets（6 项）与 popup `resolvePreset` 落地（2026-08-18，有限开闸批次）；「最近一个交易日」仍待交易日历
  - [x] 「最近一个交易日」v1.0 按工作日落地（2026-09-09 批次八 trading.ts，不含法定节假日并已在 UI 注明；v1.1 接交易日历 P3-3）
- [x] 区间预设：午间复盘 09:30–11:30、当日交易时段 09:30–15:00、某交易日全天、自定义事件窗口（2026-09-09 批次八：新增 3 预设按钮（「某交易日全天」v1.0 落地为最近一个交易日全天）；自定义事件窗口由既有自定义起止输入承担；预设填值真机冒烟通过，过滤行为回归攒批次 E）
- [x] “最近一个交易日”v1.0 先按工作日处理并明确不含法定节假日；v1.1 接交易日历（2026-09-09 批次八：trading.ts 头注 + Popup 按钮 title + 单测 13 项）

### P2-19: 完整诊断、适配健康与更新安全
- [ ] 诊断报告包含平台、页面 URL/类型、类别、原始时间文本、回退行为、适配包版本和扫描状态
  - [x] 部分完成（2026-08-18）：Popup 复制脱敏报告已含平台/适配包版本/模式边界/计数与逐条 {kind, page, context, raw, 回退行为}；扫描状态尚未纳入
- [ ] 报告复制前脱敏，不包含帖子正文、账号、Cookie 或登录数据；全部本地生成，不上传
  - [x] 部分完成（2026-08-18）：复制报告仅含 pathname 与时间原文（PRD F8），本地生成不上传；诊断明细页的完整脱敏校验仍缺
- [ ] 每个页面类型提供 DOM fixture、解析率/匹配数检查、评论/分页专项测试和真实 Chrome 冒烟测试
- [ ] 热更新后自动运行轻量健康检查；失败保持上一可用版本并允许手动回退
- [ ] 将占位远程地址替换为真实发布源，增加完整性校验、版本回退和应急停用策略

### P2-20: 多站授权与每站设置
- [x] 设置页列出全部支持站点及授权状态，支持单站授权和撤销（2026-09-09 批次七：支持站点矩阵，4 平台行含状态标签与单站授权/移除；授权弹窗真机验证攒到批次 E，机制同批次六 §2.4/§2.5 已闭环）
- [x] 提供用户主动点击的“授权全部金融站点”，不在安装时静默申请（2026-09-09 批次七：设置页顶部按钮，一次 request 全部 5 origin，附「绝不自动申请」承诺文案）
- [x] 每站展示最后验证日期、适配包版本和页面能力摘要（2026-09-09 批次七：能力按适配包配置派生；验证日期数据驱动 last_verified——雪球 2026-09-09，其余如实「未真机验证」）
- [x] 每站记忆默认时间模式、过滤策略和预设；同域名不同页面允许继承后覆盖（记忆=timeSettings.<domain> 既有持久化（模式/策略/边界），本批补管理面：设置页摘要+重置；「同域不同页面继承」为域名级共享现状语义，页面级覆盖归 P3-5）

### P2-21: 其他金融平台适配（完成 P2-17 至 P2-20 后串行推进）
- [ ] 东方财富股吧 `guba.eastmoney.com`；文档禁用含混简称“股吧”
- [ ] 淘股吧 `taoguba.com.cn`；作为与东方财富股吧独立的平台适配
- [ ] 天天基金：基金详情、基金讨论/基金吧及与东方财富共用结构的页面分别取证
- [ ] 东方财富：个股资讯、公告、财富号等页面按页面类型分别验收
  - 内置适配包 `eastmoney-news.json` v0.1.0 已落地（2026-08-18，仅 finance.eastmoney.com `/a/` 栏目列表，`li[id^='newsTr']`）；真机验收仍欠
- [ ] 同花顺：在现有 `t.10jqka.com.cn` 基础上扩展个股讨论、资讯等目标页面
- [ ] 集思录 `jisilu.cn`：主题列表、详情回复及基金/ETF/LOF/QDII 等相关板块
  - 内置适配包 `jisilu.json` v0.1.0 已落地（2026-08-18，分类列表 + 详情回复，`extract_pattern` 提取全年份时间）；真机验收仍欠
- [ ] 通达信网页版：先验证公开网页范围、登录/CSP、时间戳、分页和历史深度；不满足条件则不对外承诺
- [ ] 每个平台凡有资讯/讨论/公告/基金/自选等类别，均按独立信息流上下文过滤并验收

### P2-22: 适配健康与发布可信度
- [ ] 每个对外支持的页面类型具备 DOM fixture 单测和真实 Chrome 冒烟测试
- [ ] 记录帖子匹配数、时间解析率、排序完整性、历史深度和最后验证日期
- [ ] 建立真实适配包发布源、完整性校验、版本回退和失效应急流程
- [ ] 商店支持清单按“平台 + 页面类型 + 能力”编写，不以单页适配宣称整个品牌

### P2-23: v1.0 发布准备
- [x] 构建生产版本 `npm run build`
- [x] 打包 `dist/` 为 ZIP（2026-09-08：`artifacts/timemachine-v1.0.0.zip`，无 key、仅 optional 授权、正斜杠条目——打包脚本反斜杠缺陷已修，见批次三）
- [x] 准备商店描述与隐私政策文案（2026-09-08 顺带修正：快捷键文案 Alt+Shift+T、隐私政策权限表 5 平台）
- [ ] 完成商店截图与公开隐私政策 URL（◐ 截图 6 张已采集至 `store-assets/`（2026-09-08，其中 2/3/6 建议登录态真机重截）；隐私政策公开 URL 托管待用户执行）

### P2 真机验证清单

| # | 项目 | 状态 |
|---|------|------|
| 1 | 同花顺首页 `t.10jqka.com.cn` → 授权 → 设截止时间 → 按 MMDD+HH:mm 组合时间过滤 | [ ] |
| 2 | 跨年帖（未来时间）正确回退一年；缺年份补当年 | [ ] |
| 3 | 雪球帖子详情页评论独立过滤；「今天 HH:mm」格式正确解析 | [x]（2026-09-06 §7.1/§7.2：详情页今日评论独立隐藏、正文保留；「MM-DD HH:mm」分钟级双向判定实机通过） |
| 4 | 评论无时间戳时按回退策略处理（全部显示/默认折叠），切换策略行为正确 | [ ]（§7.3 仍欠） |
| 5 | `Ctrl+Shift+T` 快捷键：过滤开关切换，图标角标同步 | [x]（快捷键已改为 **Alt+Shift+T**（09-08 冲突修复），绑定后用户实机验证开关与图标正常（§8）；§6.7b 扫描中关闭亦通过） |
| 6 | 全新 Profile 首次访问雪球 → Popup 显示「未授权」→ 授权后生效 | [x]（2026-09-09 §2.1/§2.2 商店包真机：未授权禁用态 → 授权弹窗 → 注入生效（个股页过滤实证）） |
| 7 | 设置页「已授权站点管理」可列出/移除授权 | [x]（2026-09-09 §2.5/§2.4 商店包真机：列表实时、移除后条目消失且撤销链路 4 项闭环） |
| 8 | 篡改适配包 `post_selectors` 使其零匹配 → 5s 内模态浮层（不可关闭 +「刷新重试」） | [x]（2026-09-08 批次一 §9.1 构造法真机通过：模态出现、无关闭控件、仅「刷新重试」出口） |
| 9 | 悬浮提示条：设置页开启 → 页面右下角出现；× 关闭；设置页关闭后不再注入 | [x]（2026-09-06/07 §4.6 三项全过：内容含边界/计数/模式、滚动无闪烁（M3 节流）、测毕恢复关闭） |
| 10 | 适配包自动更新开关生效；模拟远程版本更高 → 存储更新 + 重载 | [ ]（mock/自动化已覆盖（adapters-update.test.ts），真机链路 §11 仍欠——REMOTE_ADAPTERS_URL 为占位地址） |
| 11 | 设置页各项配置（策略/角标/评论回退/授权/版本信息）正常 | [ ]（◐ 2026-09-08 截图证据：通用/评论过滤/站点与适配分区及开关渲染正常（store-assets/5-options.png）；「各项」逐项正式验收未做） |
| 12 | 全新 Chrome Profile：加载打包 ZIP → 完整走引导→过滤→关闭→评论→失效模态流程 | [x]（2026-09-09 §13 商店包真机：引导/过滤/关闭恢复/失效模态全流程无报错 + 网络隐私承诺核验；登出态边界（首页模态 P3、评论 DOM 未匹配）如实标注，登录态评论以 §7.x 为准） |
| 13 | 雪球个股页：从原始第 1 页按需扫描，前 10 条符合时间的帖子组成虚拟第 1 页；下一页续扫、上一页不重扫 | [x]（2026-09-06/07 §6.1-§6.4：首屏聚合恰满即停、下一页仅多扫 1 原生页且零重复 ID、上一页秒回缓存不增扫描数） |
| 14 | 扫描中修改截止时间/关闭过滤/取消，旧扫描停止且原生列表与分页恢复 | [x]（2026-09-07 §6.6/§6.7a + 2026-09-08 §6.7b/§8：三链路均实机通过） |

---

## Phase 3: v1.1 扩展

> **目标**：在 v1.0 金融平台覆盖基础上完善快捷操作、设置迁移、交易日历和维护工具。通用补拉与东方财富股吧适配已前移到 v1.0。

### P3-1: 快捷操作增强
- [ ] 快速切换策略快捷键 + 应用最近预设快捷键
- [ ] 设置页展示并引导修改 Chrome 快捷键绑定

### P3-2: 设置迁移与维护
- [ ] 导出/导入全部设置（JSON）
- [ ] 重置所有设置为默认值
- [ ] 适配包手动更新、回退和诊断导出

### P3-3: 交易日历与金融预设增强
- [ ] 接入或内置可维护的 A 股交易日历
- [ ] “最近一个交易日”等预设正确处理周末和法定休市日

### P3-4: 适配维护看板
- [ ] 汇总各页面类型的最后验证日期、解析率和失效状态
- [ ] 为适配包回归测试生成可分享的脱敏诊断报告

### P3-5: 金融预设个性化
- [ ] 自定义、排序和隐藏快捷预设
- [ ] 按平台或页面类型覆盖默认模式与预设

---

## Phase 4: v1.2 剧透线

> **目标**：豆瓣适配 + 窗口模式 + 模糊策略。

### P4-1: 窗口模式的非金融场景适配
- [ ] 复用 v1.0 已完成的窗口模式，补充剧集/赛事等场景预设

### P4-2: 模糊策略
- [ ] `filter: blur(8px)` + 点击临时解除 + 再次点击恢复
- [ ] 设置页和 Popup 支持选择模糊策略

### P4-3: 豆瓣适配
- [ ] DOM 取证 + 适配包编写
- [ ] 窗口模式为默认推荐（剧透场景）

### P4-4: 平台差异化 UI
- [ ] 金融平台默认截止模式，窗口模式折叠
- [ ] 剧透平台默认窗口模式

---

## 附录 A：调试 checklist

每次开发新适配包或修改过滤逻辑时，按以下清单验证：

- [ ] 在目标平台页面，验证 `post_selectors` 匹配到的帖子数量与实际可见帖子数一致
- [ ] 验证时间戳提取：抽取的 `Date` 对象与页面上显示的时间一致
- [ ] 设置截止时间后，滚动加载 3 屏，观察无卡顿
- [ ] 统计被过滤帖子数，手动抽查 10 条，确认零误杀、零漏杀
- [ ] 切换过滤策略（隐藏/折叠/模糊），观察 DOM 变化符合预期
- [ ] 模拟适配包失效（篡改选择器），观察提示正确弹出且不过滤

## 附录 B：验收标准总览

| # | 验收标准 | 状态 |
|---|---------|------|
| 1 | 功能正确性（零误杀/零漏杀） | ✅ 截止模式逻辑层自动化通过；雪球基础功能已由用户确认，窗口模式 UI/专项测试待开发 |
| 2 | 性能 < 1s | ⏳ 需真实 Chrome DevTools 实测 |
| 3 | 适配包失效检测 | ✅ 自动化通过 |

## 附录 C：真机验证结果记录

- 通过项：____
- 失败项（附现象/截图/console 报错）：____
- 结论：□ 可进入发布  □ 需修复后重测
