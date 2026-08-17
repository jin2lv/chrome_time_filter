# 时光机（TimeMachine）— 竞品调研报告

> 调研时间：2026-08-14 ｜ 范围：GitHub 公开仓库 + GreasyFork 用户脚本生态
> 调研人：WorkBuddy ｜ 方式：GitHub API + Web 检索，逐仓核实 star 数、最后推送时间、归档状态、license
> 本报告只做分析，未改动任何项目代码。

## 0. 核心结论

**没有发现一款"跨平台、按用户设定的任意时间截止/区间过滤帖子、且仍在维护"的直接竞品**。这验证了时光机的差异化定位：

- 最接近的维护中项目（custom-top-sort-for-reddit、YouTube-Filter、YouTube-Gatekeeper）全部局限在**单一平台**（Reddit / YouTube），且只能做**粗粒度时间预设**或**排序参数微调**；
- 中文金融社区（雪球、同花顺、东方财富、淘股吧、集思录）的过滤工具均为**关键词/用户维度屏蔽**，无一做时间维度过滤；
- 概念重合度最高的 RewindReddit、雪球神器等项目均已**停更多年**，死因正是"单平台绑定 + 平台改版"——恰好是时光机 JSON 适配包热更新 + 失效保护设计要解决的痛点。

---

## 1. 仍在维护、做得较好的类似项目（重点）

### 1.1 BevizLaszlo/UBlock-Filters-for-Social-Media（⭐ 79，活跃）

- **定位**：给 uBlock Origin 用的静态过滤规则列表（Python 脚本生成），移除 YouTube/Reddit/X/Facebook/Instagram 等的信息流、短视频、推荐内容，主打减少刷屏。
- **质量与活跃度**：MIT 协议；**最近推送 2026-08-09（5 天前）**；README 完善、覆盖平台最广（8+ 平台）。
- **不足**：
  - 没有时间维度——只能整块隐藏，无法"保留 T 之前、裁掉 T 之后"；
  - 纯静态规则，无交互面板、无过滤计数、无"无法解析"诊断；
  - 全局一刀切，不能按页面类型/类别单独设规则；
  - 全海外平台，零中文金融站覆盖；
  - 隐藏的是"模块"而非逐帖判定，不具备相对时间锚定、跨页聚合等能力。

### 1.2 arvidsandin/custom-top-sort-for-reddit（⭐ 19，活跃）

- **定位**：让 Reddit 的 top 排序支持任意自定义时间跨度（如"最近 3 天 21 小时"），上架 Chrome/Firefox/Edge 商店。
- **质量与活跃度**：GPL-3.0；**最近推送 2026-07-18**；兼容 RES，是"时间过滤"细分里最活跃的一个。
- **不足**：
  - 仅 Reddit 单平台，且只改排序参数——**无法对已加载内容做时间裁剪**；
  - 依赖 Reddit 自身排序能力，处理不了智能/热度排序下"结果不完整"（时光机补拉引擎 + 完整性标注正针对此）；
  - 无评论级时间过滤、无窗口（起止区间）模式、无中文平台；
  - 2022 年后基本无新功能迭代。

### 1.3 tojicb-fushiguro/YouTube-Filter（⭐ 8，近半年活跃）

- **定位**：按标题/频道/上传日期过滤 YouTube 视频；软隐藏（blur）与硬隐藏；可隐藏 Shorts、评论区、推荐栏等。
- **质量与活跃度**：MIT；**最近推送 2026-03-02**；有 CSS-first 隐藏、MutationObserver 防循环等工程细节。
- **不足**：
  - 仅 YouTube 单平台；
  - 日期过滤只有 Today/Week/Month/Year 四个预设档位，无法任意截止；
  - 作者自认相对时间解析存在边缘情况，无显式"无法解析"回退标注；
  - 无跨页聚合、无过滤计数、无中文平台；用户量小。

### 1.4 hubig21/YouTube-Gatekeeper / YTcF（⭐ 5，活跃）

- **定位**：YouTube 频道/关键词过滤 + 上传日期过滤（hideNewer/hideOlder），GreasyFork 分发，中文界面。
- **质量与活跃度**：**最近推送 2026-06-23**；迭代频繁。
- **不足**：仅 YouTube；日期过滤仍是粗粒度档位；依赖 Tampermonkey；无窗口模式、无诊断/计数、无金融场景、无 license。

### 1.5 luchuangao/x-tracker（⭐ 0，活跃但无人验证）

- **定位**：X/微博/雪球/小红书/Substack 聚合阅读扩展（sidepanel 双视图）；唯一同时覆盖雪球的活跃项目。
- **质量与活跃度**：**最近推送 2026-03-15**；但 ⭐ 0、无 license、无测试、单人项目。
- **不足**：聚合视图是抓取到自己面板，**不是原站就地过滤**；时间范围过滤已被作者主动移除（commit `Remove time range`）；无虚拟分页、无去重、无诊断。

---

## 2. 概念最接近、但已停更/停止维护（参考价值 > 实用价值）

| 项目 | 概念 | 停更时间 | 不足 |
|------|------|---------|------|
| **howardjohn/RewindReddit**（3★） | Reddit 评论区滑块，只看"某时间之前/之后/区间"的评论——概念重合度最高 | 2014 | 仅 Reddit；无 license；jQuery/jQueryUI；Manifest V1 时代产物 |
| **Reddit: Time Filter (old view)** | 只针对 old.reddit "TOP 过去 24 小时"排序做时间过滤 | 2022 | 仅 Reddit 且仅一种排序场景；非开源；~105 用户 |
| **ymjrcc/xueqiu_crx 雪球神器**（1★） | 雪球首页关键词屏蔽 + 模块屏蔽 + 自动展开 | 2018 | 雪球改版后必然失效；无时间过滤；无 license；无测试 |
| **Dobiasd/RedditTimeMachine**（22★） | 生成"某历史日期区间"的 Reddit 搜索链接（Web 应用，非扩展） | 作者明示不再更新 | 不注入页面、不裁剪信息流，只生成链接 |
| **yarabarla/Reddit-Time-Machine**（2★） | 按日期查看 Reddit 旧帖 | 2016 | 单平台、demo 级 |
| **jlokos/reddit-revive**（2★） | 用 Wayback Machine 打开 Reddit 历史快照 | 2023 | 依赖第三方归档、无实时过滤能力 |

## 3. 周边生态（不做时间过滤，同属"内容净化"赛道）

- **雪球一键屏蔽用户**（GreasyFork，2026-05 仍更新）：用户维度屏蔽，非时间。
- **Universal Forum Block**：Discuz!/Discourse 论坛关键词/用户屏蔽用户脚本。
- **utags/utags-advanced-filter**：按更新日期/安装量过滤 GreasyFork 脚本列表（维护工具性质）。

---

## 4. 共同短板（= 时光机的差异化印证）

1. **单平台绑定**：全部聚焦 Reddit 或 YouTube；无一覆盖雪球、同花顺、东方财富、淘股吧、集思录等中文金融社区。
2. **时间粒度粗、不可任意截止**：停留在"预设档位"，没有分钟级任意截止/起止区间的判定层。
3. **不做补拉与跨页聚合**：遇到"前几页全是新帖"或智能排序时直接放弃，没有虚拟分页/懒扫描/完整性命中标注。
4. **无失效保护与诊断**：站点改版选择器失效时静默失败，没有"失效即不过滤 + 强制提示"，也没有可复制的脱敏诊断。
5. **无状态模型**：无按域名同步、按 Tab 独立开关、按平台覆盖策略的多 Tab 状态模型。
6. **工程质量普遍低**：非开源/无 license/无测试/无 CI 占多数（BevizLaszlo、custom-top-sort 除外）。

---

## 5. 对时光机的建议（仅分析，不改代码）

- **商业化窗口真实存在**：直接竞品缺位且均未覆盖中文金融场景，v1.0 聚焦雪球→金融平台的路线未被任何活跃项目堵住。
- **可借鉴的优点**：custom-top-sort 的多浏览器商店发布与 RES 兼容；BevizLaszlo 的规则自动生成脚本；YouTube-Filter 的 CSS-first 隐藏与观察器防循环。
- **可预见的风险**：RewindReddit、雪球神器等"概念近亲"停更主因是平台改版与单点绑定——时光机的 JSON 适配包热更新 + 失效保护设计正是针对这两大死因，应坚持。

---

## 附录：核实过的仓库数据（截至 2026-08-14）

| 仓库 | Stars | 最后推送 | 归档 | License | 语言 |
|------|-------|---------|------|---------|------|
| BevizLaszlo/UBlock-Filters-for-Social-Media | 79 | 2026-08-09 | 否 | MIT | Python |
| arvidsandin/custom-top-sort-for-reddit | 19 | 2026-07-18 | 否 | GPL-3.0 | JavaScript |
| tojicb-fushiguro/YouTube-Filter | 8 | 2026-03-02 | 否 | MIT | JavaScript |
| hubig21/YouTube-Gatekeeper | 5 | 2026-06-23 | 否 | 无 | — |
| howardjohn/RewindReddit | 3 | 2014-08-21 | 否 | 无 | JavaScript |
| jlokos/reddit-revive | 2 | 2023-06-21 | 否 | MIT | JavaScript |
| yarabarla/Reddit-Time-Machine | 2 | 2016（约） | 否 | MIT | JavaScript |
| ymjrcc/xueqiu_crx | 1 | 2018-09-17 | 否 | 无 | JavaScript |
| Dobiasd/RedditTimeMachine | 22 | 明示不再更新 | 否 | MIT | Elm |
| luchuangao/x-tracker | 0 | 2026-03-15 | 否 | 无 | JavaScript |
