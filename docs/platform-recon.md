# 金融平台 DOM 取证摘要（P2-21 输入）

> 取证时点 2026-08-17/18；**P2-21 目标平台于 2026-09-18 复核可达性与结构**（结论见各节「09-18 复核」）。选择器快照**不代表站点当前结构**，正式适配前须真机复核；适配状态以 `PRD-v1.0.md` §4 F3 与 `DEV-PLAN.md` P2-21 为准。
> 风控：东财系（guba/fund）与淘股吧对高频无痕访问有滑块；登录态下东财系不再触发。
> 已落地的 DOM fixture（匿名化、含取证注释）在 `test/fixtures/`：`jisilu-category.html`、`jisilu-topic.html`、`guba-stock-list.html`、`guba-fund-list.html`、`fund-detail-bar.html`；引擎能力由 `test/unit/platform-fixtures.test.ts` 断言。

## 1. 集思录 jisilu.cn（**已适配 v0.2.0**，2026-09-18 真实浏览器取证）

- 页面：分类列表 `/category/{id}`、统一分页 `/home/explore/sort_type-new__category-{id}__day-{N}__page-{n}`、主题 `/question/{id}`、`/topic/{名称}`；首页 explore 无时间戳，不适配。
- 列表：容器 `div.aw-question-list > div.aw-item`；标题 `h4 a[href*="/question/"]`；时间 `span.aw-text-color-999` 行内文本 `作者 回复 • YYYY-MM-DD HH:mm • N 次浏览`（全年份）；稳定 ID `/question/{id}`；分页 `div.pagination`；默认 `sort_type-new` 为**严格时间倒序**。
- 回复：容器 `.aw-mod-body.aw-dynamic-topic > .aw-item[id^="answer_list_"]`；时间 `.aw-dynamic-topic-meta .pull-left.aw-text-color-999`，文本为 `YYYY-MM-DD HH:mm 来自<属地>`（需 `strip_pattern` 剥离属地；同级还有 `a.aw-text-color-999.aw-add-comment` 的「引用」锚点，选择器必须带 `.pull-left`/`span` 限定）。正文 `.aw-question-detail-title` 内 `.markitup-box` 不参与过滤。
- **09-18 真实浏览器（渲染后 DOM）复核结论**：
  - 板块：`/category/3` 新股、`4` 债券/可转债、`5` 套利、`6` 其他、`7` 基金（recon 原记 3|4|5|6，实际含 7）；每页 28~30 条。
  - 列表选择器 30/30 命中、时间提取 30/30；整页严格时间倒序（30 条全序校验通过）；分页第 2 页同模板。
  - **列表行内只有「最后回复时间」**：行属性仅 `class`，无 `data-*` 时间，行文本无第二处时间 → 列表过滤语义只能是「隐藏 T 之后有新回复的主题」（与 PRD「隐藏之后发布的帖子」的差异记录在适配包 notes 与 PRD F3）。
  - 详情页回复 99/99 命中、时间 99/99 提取；**平台深度限制**：该主题 29921 个回复，服务端只渲染最近 99 条，页面内无分页/加载更多入口，`?p=2` 返回同一批 → 评论可过滤范围即这 99 条。
  - 排序视图排除：`sort_type-add_time` / `sort_type-hot__day-30` 视图行时间同样为回复时间但不再单调，未纳入 `active_paths`（静默退出）。
  - 跨页聚合未启用（保留站点原生分页）：实测 T=昨日0点 时列表首屏仍保留 26/30 条，不存在「首屏全空」；`source_mode: 'url'` 能力已就绪，若后续实测出现首屏过空，可按板块（`page_url_pattern` 含 category id）启用。
  - 免登录、无滑块；`last_verified` 留空（未做扩展级真机验收）。


## 2. 东方财富主站资讯 finance.eastmoney.com

- 栏目列表 `/a/czqyw.html`、`/a/cgspl.html` 等，分页 `{栏目}_{n}.html`（41-42 条/页）；`/a/` 下栏目同模板（已验证两栏目）。
- 容器 `ul > li[id^="newsTr"]`（有图/无图两变体，均含 `.text`）；时间 `p.time` = `YYYY年MM月DD日 HH:mm`（全年份）；稳定 ID 取正文链接 `{yyyymmdd}{数字}` 或 URL；类别 = 栏目（URL 整刷）。
- 免登录、无评论交互，仅需列表过滤。
- **09-18 复核（重要变化）**：服务端返回的是**客户端渲染壳**——`/a/czqyw.html` 与 `/a/cgspl.html` 两个不同栏目字节数完全相同（43KB）、页面内既无 `newsTr` 也无 `p.time`/日期文本（body 内只有导航与排行榜），列表由 `newslistbefore.js` 注入。因此：
  - 该平台的适配包**无法离线校验选择器**，只能在真实浏览器中定稿；
  - `source_mode: 'url'` 的整页 fetch 对该页面**取不到列表**（拿到的还是壳），跨页聚合要么改用其数据接口（客户端渲染路径）要么只过滤已加载内容并标注；
  - 内置 `eastmoney-news.json` v0.1.0 是否仍有效**待真机确认**（recon 2026-08-18 观测到 `newsTr` 有值，推测为浏览器 JS 渲染后的结果）。

## 3. 东方财富股吧 guba.eastmoney.com（**已适配 3 个页面类型条目**）

- 列表 URL：`list,{code}.html`（全部，按 mod_time）、`list,{code},99.html`（热门）、`list,{code},f.html`（最新发帖，按 pub_time）、分类 `,1,f`资讯 / `,2,f`研报 / `,3,f`公告 / `,20`视频；分页 `..._{n}.html`（`a.nump` / `a.nextp`）。详情 `news,{code},{postId}.html`。
- 列表 DOM：容器 `table.default_list tbody tr.listitem`；时间 `div.update.mod_time`（最后回复）或 `div.update.pub_time`（发帖），格式 `MM-DD HH:mm`（**无年份，需推断**）；稳定 ID = postId；类型标签 `span.type_tag`（`zx`=资讯、`wdm`=问董秘），置顶 `em.settop`。
- 详情主帖：正文 `#newscontent`，时间 `.time` = `YYYY-MM-DD HH:mm:ss`。
- 评论：容器 `#allReplyList .reply_item[data-reply_id]`（稳定 ID）；时间 `.pubtime` = `YYYY-MM-DD HH:mm:ss`，属地 `.ipfrom`；排序 最新（默认）/`,d.html` 最热/`,z.html` 最早；分页 `,N.html`；只看作者 `,{uid}.html`；楼中楼 `.reuser_l2*` 同格式。无「加载更多」，翻页走 URL。
- 首页热门榜/话题聚合无时间流，不处理。
- **09-18 复核（**渲染后 DOM**，与 08-18 服务端 HTML 取证有实质差异，务必按渲染后 DOM 适配）**：
  - 容器 `table.default_list tbody tr.listitem` 渲染后 **85 行**（服务端 80 行）；稳定 ID：**渲染后行内 `a` 没有 `data-postid`**（服务端 HTML 曾有），普通帖只能取 href 的 `/news,{code},{postId}.html`；财富号帖 href 指向 `//caifuhao.eastmoney.com/news/...`（无 postId，无法作为跨页去重键）。
  - **时间单元格类名由 JS 补全**：`div.update.mod_time`（「全部」视图）/ `div.update.pub_time`（`f.html` 最新发帖视图）；服务端 HTML 里只有 `div.update`。适配包用回退链 `['div.update.mod_time','div.update']` 与 `['div.update.pub_time','div.update']`。
  - **行序不是严格时间倒序**：顶部是「财富号置顶区块」（时间更旧），其后才是严格倒序的普通帖区块（85 行中 21 行为财富号）。
  - 无年份时间（MM-DD HH:mm）推断策略实测（85 行，2026-09-18）：`descending-list` 在异常行可重对齐游标后覆盖 **99%**（仅区块交界 1 行不可解析 → 默认显示）；重对齐前只有 **6%**（游标被置顶区块的低水位卡死）；省略该字段（旧逐帖补年行为）覆盖 100%。→ 建议：「全部」视图用 `descending-list`（失败方向为默认显示），`f.html` 视图因首行为 3 天前的财富号帖、会触发 48h 守卫导致 0% 覆盖，改省略该字段走旧逐帖补年（需在 notes 记录年份口径与残余风险）。
  - 分页为**真实链接整页跳转**（`a.nump` / `a.nextp` → `/list,{code}_{n}.html`、`/list,{code},f_{n}.html`）→ 站点原生翻页可用，未计划扩展侧跨页聚合；若启用 `source_mode: 'url'`，模板需按 code 参数化。
  - 分类 tab（URL 即上下文）：全部 `list,{code}.html`、热门 `list,{code},99.html`、资讯 `list,{code},1,f.html`、公告 `list,{code},3,f.html`、研报 `list,{code},2,f.html`、视频 `list,{code},20.html`、问董秘（外部页）。分类视图与 `f.html` 同模板（`pub_time`）。
  - 详情页（**已按渲染后 DOM 取证 2026-09-18**）：正文 `#newscontent` + `.time`（`YYYY-MM-DD HH:mm:ss`）**不参与过滤**；评论容器 `#replylist .reply_item[data-reply_id]`（实测 48 条 = 「热门评论」区块 5 条 + 最新评论；热门区块前置故行序非单调，但评论按各自时间判定、不依赖顺序），时间 `span.pubtime` 全年份（`YYYY-MM-DD HH:mm:ss`，无需年份推断），属地 `span.ipfrom`（`来自 山东`）不参与解析；评论分页为 URL 翻页（`/news,{code},{id}_{n}.html#allReplyList`），排序控件 最新（默认）/ 最热（`,d.html`）/ 最早（`,z.html`）/ 只看作者（`{uid}.html`）。注：服务端 HTML 的容器 id 为 `#allReplyList`，渲染后实际是 `#replylist`（早期 recon 记录的是前者）。
  - 匿名访问 85 行可正常取到，未见滑块。
  - **已适配为 `src/adapters/guba.json` 的 3 个页面类型条目**（全部与热门 + 详情评论 / 最新发帖与分类 / 基金吧总版），`last_verified` 未设置（未做扩展级真机验收）。

## 4. 天天基金 fund.eastmoney.com（含基金吧，**已适配基金详情内嵌吧帖**）

- 基金详情 `/{code}.html`、档案 `fundf10.eastmoney.com/jbgk_{code}.html`；详情页内嵌吧帖 `.barEssayListWrap > table.popTable > tbody > tr`，时间 `td.td05`（`MM-DD HH:mm`）——免登录零风控，但仅 10 条最新。
- 基金吧总版 `guba.eastmoney.com/jj.html`（+ `jj_{n}.html`，80 条/页，可翻 33 万页）：容器 `div.balist > ul.newlist > li`，发帖 `cite.date` / 末回复 `cite.last`（`MM-DD HH:mm`）；吧类型前缀 `a.balink`（`of{6位}`开放基金、`sh/sz`场内、`jjdt`动态、`zg{id}`公司）可作上下文 key。
- 单基金吧 `list,of{code}.html`（登录态可用，旧模板）：容器 `#articlelistnew .articleh.normal_post`（80 条/页），时间 `.l5`，稳定 ID `.l3 a`（`/news,of{code},{postId}.html`）；分类/分页规则同个股吧。混有跨吧置顶活动帖（`em.settop`），按行自身时间判定即可。
- 数据 API `fund.eastmoney.com/ba/interface/GetList.aspx?code=of{code}`（参数不当会被滑块拦截）。
- 时间均为 `MM-DD HH:mm` 无年份。
- **09-18 复核（均按渲染后 DOM，已适配）**：
  - **基金详情内嵌吧帖**（`.barEssayListWrap`）：容器 `.barEssayListWrap > table.popTable > tbody > tr`（实测 21 行，其中 1 行是 `<tr><th>…` 表头 → 适配包用 `tr:has(td.td05)` 排除，避免多出 1 行「无法解析」计数）；列结构 `td01` 阅读、`td02` 回复、`td03` 标题、`td04` 作者、`td05` 最新更新时间（`MM-DD HH:mm` 无年份）；时间**严格倒序、首行新鲜（实测 21 小时前）** → `year_inference: 'descending-list'`（fixture 测试覆盖 100% 推断）；**行内混有 8 个不同吧来源**（`of018957`、`zssh000001`、`of000001`、`of001638`、`of008327`、`of028647`、`of100018`、`of027762`）→ 内嵌列表按基金/指数吧聚合，不能假设单一吧上下文；链接为绝对地址 `http://fund.eastmoney.com/ba/news,{code},{id}.html`；固定约 20 条、无分页。适配包 `fund.json` 的页面白名单仅 `/{6位数字}.html`（其余 fund.eastmoney.com 页面类型未取证、静默退出）。
  - **基金吧总版** `guba.eastmoney.com/jj.html`（DOM 在 guba 域，但属天天基金场景）：容器 `div.balist > ul.newlist > li`（80 行/页），`cite.date`（发帖）/ `cite.last`（末回复）均 `MM-DD HH:mm` 无年份，吧类型前缀 `a.balink` 成立 ✔；**取 `cite.last` + `descending-list`**：该列表按末回复排序，`cite.date` 非单调且首行为置顶旧帖（实测 20 天前，前 2 行带 `em.settop`）→ 用 `cite.date` 会触发 48h 守卫整批放弃（实测 0% 覆盖），用排序键 `cite.last` 实测 80 行覆盖 99%（置顶行按异常行默认显示）。已随 `guba.json` 的「东方财富基金吧总版」条目发布。分页为原生链接 `jj_{n}.html`。
  - 单基金吧 `list,of{code}.html`（登录态旧模板）、`fundf10.eastmoney.com` 档案页**仍未取证**，不在本期范围。

## 5. 同花顺 t.10jqka.com.cn

- 现有 `ths.json` 覆盖首页信息流：`li.feed-item` + `data-date`(MMDD) + `.feed-item-timeline-time`(HH:mm)；登录态复核 34 条结构未变。
- **个股吧 `guba/{code}/` 已废弃**（登录态仍空、tab 源码注释、无帖子接口请求）；`circle/{id}/` 是个人主页/消息中心；`pid_{pid}.shtml` 404 → **Web 端无评论/详情层**。
- 结论：v1.0 仅保留首页信息流，移除个股吧/圈子/评论扩展计划。
- **09-18 复核**：首页 `li.feed-item` 命中 44 条、`data-date`（0918/0917）、`.feed-item-timeline-time`（08:14）均成立 ✅；无年份（MMDD）→ 该信息流为严格时间倒序，可声明 `year_inference: 'descending-list'`（首行新鲜时按序列推断，不新鲜则整批默认显示）。**「资讯页」无任何取证样本**（recon 未采集），扩展前需先取证。

## 6. 淘股吧 tgb.cn（旧域 taoguba.com.cn）

- 已 301 至 `www.tgb.cn`；`/bbs/` 与多个 API 间歇 502，服务不稳定，**暂不可信、不建议承诺**。
- 首页信息流由 JS/API 异步加载（初始 DOM 为空）；投资策略页时间样本 `今天 08:21` / `2026-8-16 23:52`。
- 待服务恢复后复核：`/bbs/` 帖子流结构、信息流 API 与分页、登录墙。
- **09-18 复核**：`www.taoguba.com.cn` 仍 301 → `www.tgb.cn`，首页 200 但**无服务端帖子节点**（DOM 内有阿里云验证码配置 `AliyunCaptchaConfig`），维持「暂不承诺」。（2026-09-18 决议：v1.0 不承诺，待站点稳定后重新取证。）

## 7. 通达信网页版

- `www.tdx.com.cn` 为软件产品站，`sns.tdx.com.cn` 为投教内容，均无公共 UGC 信息流 → **无社区可适配**，保持 P1 观察，不投入。

## 8. 对通用引擎的能力提示（配 P2-17 / P2-21）

> **2026-09-18：以下 1~4 项已作为引擎能力落地**（`src/shared/time.ts`、`src/adapters/index.ts`、`src/content/virtual-pagination.ts`、`src/adapters/schema.ts`；单测 `year-inference` / `adapter-pages` / `url-pagination` / `platform-fixtures`）。此处保留结论与落地口径，剩下的仍是「按平台取证 + 写适配包」。

1. **无年份时间推断**：股吧 `*_f.html`、天天基金、同花顺首页为 `MM-DD HH:mm`。**仅对「严格发帖时间倒序」列表启用** `timestamp.year_inference: 'descending-list'`（首行锚定年份、首行须在近 48h 内、月日回跳视为异常行）；「全部/热门」按最后回复排序的列表一律 `'never'`，整批回退「无法解析 → 默认显示 + 计数」，不误杀。跨年判定为「上一行 1 月 → 本行 12 月」年份 -1（recon 原表述「逐行 MM-DD < 上一行即年份-1」会在同一年的月界上连续减年，已按此修正）。postId 全局单调递增可作一致性校验（尚未实现，非必需）。
   - **2026-09-18 补充（基于 guba 真实数据的修正）**：异常行不再只返回 null，而是把游标**重对齐**到该行，否则「置顶/财富号区块（更旧）+ 正常倒序区块」结构会把游标卡在低水位、令其后所有正常行都被判为异常（实测覆盖率 6% → 99%）。异常行本身依旧不参与过滤（默认显示 + 计数）。
2. **双时间字段**：股吧（mod_time / pub_time）、天天基金（date / last）——判定必须选「发帖时间」。落地口径：**同域拆成两个页面类型条目**（`active_paths` 隔离，如 `list,{code},f.html` 用发帖时间、`list,{code}.html` 用回复时间则必须独立声明）；`timestamp.selector` 的数组**只在同一语义内**做行模板回退（有图/无图、置顶/普通行）。
3. **上下文**：全部为「URL 即上下文」（栏目/吧/分类 id），进 `feed_context.path_patterns` 或 `active_paths` 即可，无需前端 tab 监听。
4. **服务端整页翻页**（集思录/股吧/东财资讯类）：用 `virtual_pagination.source_mode: 'url'` + `page_url_pattern`（含 `{page}`）逐页 fetch 同源整页并离线解析，缓存/去重跨页保持；客户端渲染的站点不适用（东财资讯即属此类，见 §2）。
5. **登录分层**：适配按「免登录列表 + 登录态详情/评论」双层设计；东财系与淘股吧的无登录访问有滑块/验证码，取证与真机验证用登录态。
