# 金融平台 DOM 取证摘要（P2-21 输入）

> 取证时点 2026-08-17/18。选择器为当时快照，**不代表站点当前结构**，正式适配前须真机复核；适配状态以 `PRD-v1.0.md` §4 F3 与 `DEV-PLAN.md` P2-21 为准。
> 风控：东财系（guba/fund）与淘股吧对高频无痕访问有滑块；登录态下东财系不再触发。

## 1. 集思录 jisilu.cn（首选，友好度最高）

- 页面：分类列表 `/category/{3|4|5|6}`、统一分页 `/home/explore/sort_type-{new|hot|add_time}__category-{id}__day-{N}__page-{n}`、主题 `/question/{id}`、`/topic/{名称}`；首页 explore 无时间戳，不适配。
- 列表：容器 `div.aw-question-list > div.aw-item`；标题 `h4 a[href*="/question/"]`；时间 `span.aw-text-color-999` 内 `YYYY-MM-DD HH:mm`（全年份）；稳定 ID `/question/{id}`；分页 `div.pagination`；排序 new（默认）/hot/add_time（严格时间倒序）。
- 回复：容器 `.aw-mod-body.aw-dynamic-topic > div.aw-item[id^="answer_list_"]`；时间 `.aw-dynamic-topic-meta .pull-left.aw-text-color-999`（`YYYY-MM-DD HH:mm`）；主帖时间在标题区文本。实测一次性渲染 98 条，**大帖回复分页/懒加载待复核**。
- 类别 = category id（URL 整刷），天然隔离上下文；免登录、无滑块。

## 2. 东方财富主站资讯 finance.eastmoney.com

- 栏目列表 `/a/czqyw.html`、`/a/cgspl.html` 等，分页 `{栏目}_{n}.html`（41-42 条/页）；`/a/` 下栏目同模板（已验证两栏目）。
- 容器 `ul > li[id^="newsTr"]`（有图/无图两变体，均含 `.text`）；时间 `p.time` = `YYYY年MM月DD日 HH:mm`（全年份）；稳定 ID 取正文链接 `{yyyymmdd}{数字}` 或 URL；类别 = 栏目（URL 整刷）。
- 免登录、无评论交互，仅需列表过滤。

## 3. 东方财富股吧 guba.eastmoney.com

- 列表 URL：`list,{code}.html`（全部，按 mod_time）、`list,{code},99.html`（热门）、`list,{code},f.html`（最新发帖，按 pub_time）、分类 `,1,f`资讯 / `,2,f`研报 / `,3,f`公告 / `,20`视频；分页 `..._{n}.html`（`a.nump` / `a.nextp`）。详情 `news,{code},{postId}.html`。
- 列表 DOM：容器 `table.default_list tbody tr.listitem`；时间 `div.update.mod_time`（最后回复）或 `div.update.pub_time`（发帖），格式 `MM-DD HH:mm`（**无年份，需推断**）；稳定 ID = postId；类型标签 `span.type_tag`（`zx`=资讯、`wdm`=问董秘），置顶 `em.settop`。
- 详情主帖：正文 `#newscontent`，时间 `.time` = `YYYY-MM-DD HH:mm:ss`。
- 评论：容器 `#allReplyList .reply_item[data-reply_id]`（稳定 ID）；时间 `.pubtime` = `YYYY-MM-DD HH:mm:ss`，属地 `.ipfrom`；排序 最新（默认）/`,d.html` 最热/`,z.html` 最早；分页 `,N.html`；只看作者 `,{uid}.html`；楼中楼 `.reuser_l2*` 同格式。无「加载更多」，翻页走 URL。
- 首页热门榜/话题聚合无时间流，不处理。

## 4. 天天基金 fund.eastmoney.com（含基金吧）

- 基金详情 `/{code}.html`、档案 `fundf10.eastmoney.com/jbgk_{code}.html`；详情页内嵌吧帖 `.barEssayListWrap > table.popTable > tbody > tr`，时间 `td.td05`（`MM-DD HH:mm`）——免登录零风控，但仅 10 条最新。
- 基金吧总版 `guba.eastmoney.com/jj.html`（+ `jj_{n}.html`，80 条/页，可翻 33 万页）：容器 `div.balist > ul.newlist > li`，发帖 `cite.date` / 末回复 `cite.last`（`MM-DD HH:mm`）；吧类型前缀 `a.balink`（`of{6位}`开放基金、`sh/sz`场内、`jjdt`动态、`zg{id}`公司）可作上下文 key。
- 单基金吧 `list,of{code}.html`（登录态可用，旧模板）：容器 `#articlelistnew .articleh.normal_post`（80 条/页），时间 `.l5`，稳定 ID `.l3 a`（`/news,of{code},{postId}.html`）；分类/分页规则同个股吧。混有跨吧置顶活动帖（`em.settop`），按行自身时间判定即可。
- 数据 API `fund.eastmoney.com/ba/interface/GetList.aspx?code=of{code}`（参数不当会被滑块拦截）。
- 时间均为 `MM-DD HH:mm` 无年份。

## 5. 同花顺 t.10jqka.com.cn

- 现有 `ths.json` 覆盖首页信息流：`li.feed-item` + `data-date`(MMDD) + `.feed-item-timeline-time`(HH:mm)；登录态复核 34 条结构未变。
- **个股吧 `guba/{code}/` 已废弃**（登录态仍空、tab 源码注释、无帖子接口请求）；`circle/{id}/` 是个人主页/消息中心；`pid_{pid}.shtml` 404 → **Web 端无评论/详情层**。
- 结论：v1.0 仅保留首页信息流，移除个股吧/圈子/评论扩展计划。

## 6. 淘股吧 tgb.cn（旧域 taoguba.com.cn）

- 已 301 至 `www.tgb.cn`；`/bbs/` 与多个 API 间歇 502，服务不稳定，**暂不可信、不建议承诺**。
- 首页信息流由 JS/API 异步加载（初始 DOM 为空）；投资策略页时间样本 `今天 08:21` / `2026-8-16 23:52`。
- 待服务恢复后复核：`/bbs/` 帖子流结构、信息流 API 与分页、登录墙。

## 7. 通达信网页版

- `www.tdx.com.cn` 为软件产品站，`sns.tdx.com.cn` 为投教内容，均无公共 UGC 信息流 → **无社区可适配**，保持 P1 观察，不投入。

## 8. 对通用引擎的能力提示（配 P2-17）

1. **无年份时间推断**：股吧 `*_f.html`、天天基金、同花顺首页为 `MM-DD HH:mm`。仅对「严格发帖时间倒序」列表启用（首行锚定 `first_year = 首行MM-DD > 今日MM-DD ? 今年-1 : 今年`，逐行 `MM-DD < 上一行 → 年份-1`）；「全部/热门」按最后回复排序，**不可推断**。仅当首行在近 48h 内才启用，否则整批回退「无法解析 → 默认显示 + 计数」，不误杀。postId 全局单调递增可作一致性校验。
2. **双时间字段**：股吧（mod_time / pub_time）、天天基金（date / last）——判定必须选「发帖时间」，适配包需支持第二标签。
3. **上下文**：全部为「URL 即上下文」（栏目/吧/分类 id），进 `feed_context.path_patterns` 即可，无需前端 tab 监听。
4. **登录分层**：适配按「免登录列表 + 登录态详情/评论」双层设计。
