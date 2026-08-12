# TimeMachine 时光机 — 开发计划与验证清单

> 基于 PRD-v1.0.md 拆解，每步可实施、可验证。
> 更新日期：2026-08-12
> P0/P1 已完成，P2 基本完成，review 后修复 6 项，待 Chrome 实测。

---

## 阶段总览

| 阶段 | 目标 | 状态 |
|------|------|------|
| [Phase 0](#phase-0-项目脚手架) | 项目脚手架搭建 | ✅ 已完成 |
| [Phase 1](#phase-1-v01-原型验证) | v0.1 原型验证（雪球单平台） | ✅ 已完成（自动化全部通过，待 Chrome 实测 4 项） |
| [Phase 2](#phase-2-v10-mvp-发布) | v1.0 MVP 发布（雪球+同花顺） | ✅ 基本完成（部分项待 Chrome 实测） |
| [Phase 3](#phase-3-v11-扩展) | v1.1 扩展（股吧+补拉引擎+快捷键+设置页完善） | 🔲 待开始 |
| [Phase 4](#phase-4-v12-剧透线) | v1.2 剧透线（豆瓣+窗口模式+模糊策略） | 🔲 待开始 |

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
- Vite 8.2.1 + @crxjs/vite-plugin 2.7.1 + TypeScript 5.6 + dayjs 1.11.13
- Manifest V3；`content_scripts.matches: []` 在 CRXJS 下合法

---

## Phase 1: v0.1 原型验证

> **目标**：雪球单平台 + 截止模式 + 隐藏策略，通过全部三条验收标准。

### P1-1: 适配包基础设施
- [x] 定义适配包 JSON Schema（`src/adapters/schema.ts`）
- [x] 实现 `AdapterManager`（`src/adapters/index.ts`）
- [x] 编写雪球适配包 `xueqiu.json`（2026-08-11 DOM 取证校准）：
  - `post_selectors`: `article.timeline__item`（个股页实测匹配 10 条）
  - `timestamp`: 相对时间解析（"9分钟前/3小时前/昨天/N天前"）
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
- [ ] **待 Chrome 实测**：雪球首页 50-80 条 + 连续滚动 3 屏，DevTools Performance 录制 MutationObserver callback 累计 < 1s

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
4. `background/index.ts` 未使用 `badgeCount` 设置 → 增加判断
5. `content/index.ts` `scheduleMismatchCheck` 只检查 `post_selectors[0]` → 改为 `.every` 全零匹配
6. `content/index.ts` 相对时间锚定未持久化 → 写入 `dataset.tmAnchor` 复用原锚点

### P1 真机验证清单

| # | 项目 | 状态 |
|---|------|------|
| 1 | 安装引导页：卸载重载 → 自动弹出 welcome.html，3 步走完 | [x] |
| 2 | 引导完成后插件默认关闭 | [x] |
| 3 | `chrome.storage.local` 写入 `prefs.defaultStrategy` | [x] |
| 4 | 雪球个股页 → 授权 → 设「1小时前」→ 开启 → 新帖隐藏、老帖保留 | [ ] |
| 5 | 关闭面板，刷新页面 → 截止时间持久化 | [ ] |
| 6 | 切换策略（隐藏 ↔ 折叠），折叠后占位条可展开 | [ ] |
| 7 | 关闭过滤 → 全部恢复；重新开启 → 再次过滤 | [ ] |
| 8 | 面板「已过滤 N 条」+ 图标角标实时变化 | [ ] |
| 9 | A/B 双 Tab 时间同步（改 A → B 自动同步） | [ ] |
| 10 | 滚动性能：雪球首页 50-80 帖 + 滚 3 屏，无卡顿，MutationObserver < 1s | [ ] |

---

## Phase 2: v1.0 MVP 发布

> **目标**：雪球 + 同花顺双平台，截止模式，隐藏/折叠策略，计数器，设置页，适配包热更新。
> 微博已放弃适配（2026-08-12 决议：关注流仅保留约10页深度硬限制）。

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

### P2-12: v1.0 发布准备
- [ ] 构建生产版本 `npm run build`
- [ ] 打包 `dist/` 为 ZIP
- [ ] 准备商店描述、截图、隐私政策 URL

### P2 真机验证清单

| # | 项目 | 状态 |
|---|------|------|
| 1 | 同花顺首页 `t.10jqka.com.cn` → 授权 → 设截止时间 → 按 MMDD+HH:mm 组合时间过滤 | [ ] |
| 2 | 跨年帖（未来时间）正确回退一年；缺年份补当年 | [ ] |
| 3 | 雪球帖子详情页评论独立过滤；「今天 HH:mm」格式正确解析 | [ ] |
| 4 | 评论无时间戳时按回退策略处理（全部显示/默认折叠），切换策略行为正确 | [ ] |
| 5 | `Ctrl+Shift+T` 快捷键：过滤开关切换，图标角标同步 | [ ] |
| 6 | 全新 Profile 首次访问雪球 → Popup 显示「未授权」→ 授权后生效 | [ ] |
| 7 | 设置页「已授权站点管理」可列出/移除授权 | [ ] |
| 8 | 篡改适配包 `post_selectors` 使其零匹配 → 5s 内模态浮层（不可关闭 +「刷新重试」） | [ ] |
| 9 | 悬浮提示条：设置页开启 → 页面右下角出现；× 关闭；设置页关闭后不再注入 | [ ] |
| 10 | 适配包自动更新开关生效；模拟远程版本更高 → 存储更新 + 重载 | [ ] |
| 11 | 设置页各项配置（策略/角标/评论回退/授权/版本信息）正常 | [ ] |
| 12 | 全新 Chrome Profile：加载打包 ZIP → 完整走引导→过滤→关闭→评论→失效模态流程 | [ ] |

---

## Phase 3: v1.1 扩展

> **目标**：股吧适配 + 补拉引擎（缺量感知自动补拉）+ 快捷键完善 + 设置页增强。

### P3-1: 补拉引擎（缺量感知自动补拉）
- [ ] 实现 `src/content/backfill.ts`：
  - 过滤后 T 前可见帖数 < MIN_TARGET(默认20) → 触发补拉
  - 程序化滚动到底部/点击"加载更多"
  - 终止条件：≥ MIN_TARGET / 翻页 ≥ MAX_PAGES / 出现"没有更多" / 新帖时间已越过 T
- [ ] 防抖 + 可中断（用户滚动/点击/关闭时停止）
- [ ] 空结果诚实兜底 UI

### P3-2: 排序偏好切换
- [ ] 适配包新增 `sort_controls` 字段
- [ ] 补拉前自动切到严格时间序

### P3-3: 股吧适配
- [ ] DOM 取证 `guba.eastmoney.com`
- [ ] 编写适配包 JSON

### P3-4: 快捷键完善
- [ ] 快速切换策略快捷键 + 应用最近预设快捷键
- [ ] 设置页展示快捷键绑定状态

### P3-5: 设置页增强
- [ ] 导出/导入全部设置（JSON）
- [ ] 重置所有设置为默认值
- [ ] 适配包手动更新按钮

---

## Phase 4: v1.2 剧透线

> **目标**：豆瓣适配 + 窗口模式 + 模糊策略。

### P4-1: 窗口模式
- [ ] Popup 增加模式切换（截止/窗口）+ 起始/结束时间输入
- [ ] 窗口模式快捷预设（今天/昨天/最近3天/本周）
- [ ] 过滤逻辑扩展为 `start ≤ 时间 ≤ end`

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
| 1 | 功能正确性（零误杀/零漏杀） | ✅ 逻辑层自动化通过；真实雪球页手动复核待用户 |
| 2 | 性能 < 1s | ⏳ 需真实 Chrome DevTools 实测 |
| 3 | 适配包失效检测 | ✅ 自动化通过 |

## 附录 C：真机验证结果记录

- 通过项：____
- 失败项（附现象/截图/console 报错）：____
- 结论：□ 可进入发布  □ 需修复后重测
