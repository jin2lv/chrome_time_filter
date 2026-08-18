# 各平台前端界面格式探索记录（Recon Notes）

> 目的：为 TimeMachine v1.0 的其他金融平台适配做前期取证（DOM 结构、时间戳格式、分页/加载、排序、类别上下文）。
> 探索时间：2026-08-17（夜间，无登录态）+ 2026-08-18（系统 Chrome 可见窗口，用户协助登录东财/同花顺后补取证，见第 9 节）。
> 所有选择器均为首次快照样本；正式适配前需按 P2-16 闸门逐个完成真机验收。
> 风控提示：东方财富系（guba/fund）与淘股吧对高频无痕访问有滑块验证码（"身份核实"）；**登录态下未再触发**（2026-08-18 实测）。

---

## 1. 东方财富股吧 guba.eastmoney.com

### 1.1 页面类型与 URL 模式（个股吧为例，code=002156）

| 页面 | URL | 说明 |
|------|-----|------|
| 吧列表-全部 | `https://guba.eastmoney.com/list,002156.html` | 默认"最新"排序，混合资讯+用户帖 |
| 吧列表-热门 | `list,002156,99.html` | |
| 吧列表-最新发帖 | `list,002156,f.html` | 用户帖为主 |
| 分类-资讯 | `list,002156,1,f.html` | |
| 分类-研报 | `list,002156,2,f.html` | |
| 分类-公告 | `list,002156,3,f.html` | |
| 分类-视频 | `list,002156,20.html` | |
| 分页 | `list,002156_2.html` / `list,002156,f_2.html` | 数字页码 `a.nump`，下一页 `a.nextp` |
| 帖子正文 | `news,002156,{postId}.html` | 未登录触发"身份核实"滑块 |

### 1.2 列表 DOM 结构（实测 `list,002156,f.html`）

```html
<table class="default_list"><tbody>
  <tr class="listitem ">
    <td><div class="read">1489</div></td>                      <!-- 阅读数 -->
    <td><div class="reply">6</div></td>                        <!-- 回复数 -->
    <td><div class="title">
        <span class="type_tag zx tag_1" title="资讯">资讯</span> <!-- 类型标签：zx=资讯 wdm=问董秘 等，用户帖无此标签 -->
        <a href="/news,002156,1760223459.html" class="PO" data-cntitle="...">标题</a>
      </div></td>
    <td><div class="author cl"><a class="nametext fl" href="...">作者</a></div></td>
    <td><div class="update pub_time">08-17 16:26</div></td>    <!-- 默认列表为 mod_time（最后回复），f 列表为 pub_time（发帖时间） -->
  </tr>
</tbody></table>
```

- **帖子容器**：`table.default_list tbody tr.listitem`
- **时间元素**：`div.update.mod_time`（全部/热门排序下=最后回复时间）或 `div.update.pub_time`（最新发帖排序下=发帖时间）；格式 **`MM-DD HH:mm`**（无年份）
- **稳定 ID**：标题链接 `/news,{code},{postId}.html` 中的 postId；用户帖与资讯帖均适用
- **类型标签**：`span.type_tag`（无标签=普通用户帖；`zx`=资讯、`wdm`=问董秘）；置顶帖有 `em.settop`（天天基金吧版统一样式）

### 1.3 时间精度与跨年

- 全部为 `MM-DD HH:mm` 简写、**无年份**；跨年判断需按"时间倒序/列表位置"补年份（与同花顺 `date_attr` 同类问题）。当前列表内样本均在当月，未见跨年样本。
- f 列表首条 `08-17 16:26`（发帖时间早于列表时间 22:29 的最后回复时间），确认两个时间字段语义不同，适配需选对字段。

### 1.4 类别上下文

- 个股吧本体即独立"吧"上下文；吧内"全部/热门/资讯/研报/公告/视频/最新发帖"是筛选排序（URL 路径参数 99/1/2/3/20/f）。
- 每个股吧 URL 独立（不同股票 code），天然是隔离上下文，无需前端类别监听，但筛选切换按 URL 跳转（页面整刷），可作为上下文 key 处理。
- 首页 `guba.eastmoney.com/` 只有热门榜/话题聚合（无时间流），**不属于信息流列表**，v1.0 可不处理。

### 1.5 障碍与待补

- ~~帖子正文详情页（评论）需登录，未登录触发滑块。~~ **已于 2026-08-18 登录态完成取证，见 1.6**。
- 单吧列表页无风控时可访问（本次 list 页成功，仅详情页触发滑块）。

### 1.6 帖子详情页与评论结构（2026-08-18 登录态实测）

> 登录态下详情页不再触发滑块；已删帖跳 `guba.eastmoney.com/error?type=2`。

**主帖**：
- 发帖时间：`.time` → `2026-08-18 11:48:50`（**完整 `YYYY-MM-DD HH:mm:ss` 绝对时间**，与列表的 `MM-DD HH:mm` 不同）
- 正文容器：`#newscontent`

**评论**（27 回复实测帖）：
```html
<div id="allReplyList" class="allReplyList">
  <div class="listhead alllist_head cl">
    全部评论<span>(27)</span>
    <a class="author_only" href="/news,002156,1760485661,2533345683400512.html#allReplyList">只看作者</a>
    排序: 最新(默认) | <a href="/news,002156,1760485661,d.html#allReplyList">最热</a> | <a href="...,z.html#allReplyList">最早</a>
  </div>
  <div class="replylist_content cx4">
    <div class="reply_item cl" data-reply_id="9943897622">
      <div class="item_reuser"><a href="//i.eastmoney.com/{uid}">昵称</a></div>
      <div class="publishtime"><span class="pubtime">2026-08-18 11:21:35</span><span class="ipfrom">来自 广东</span></div>
      <div class="reply_title"><span class="reply_title_span">评论正文</span></div>
      <!-- 楼中楼: ul > li > .reuser_l2(.reuser_l2_nick / .reply_title / .reply_bottom_l2 > .pubtime) -->
    </div>
  </div>
</div>
```

- **评论容器**：`#allReplyList .reply_item[data-reply_id]`（data-reply_id 为稳定 ID）
- **评论时间**：`.pubtime` → `YYYY-MM-DD HH:mm:ss` 完整绝对时间（楼中楼同）；`.ipfrom` 为 IP 属地
- **排序**：最新（默认）/ 最热（`,d.html`）/ 最早（`,z.html`），URL 带 `#allReplyList` 锚点
- **评论分页**：`/news,{code},{postId},N.html`（N=2 实测返回更旧的 8 条）；页 1 默认渲染 17/27 条（含楼中楼），无"加载更多"按钮，翻页走 URL
- **只看作者**：`/news,{code},{postId},{uid}.html#allReplyList`

---

## 2. 淘股吧 tgb.cn（旧域 taoguba.com.cn）

> 2026-08-17 实测：`taoguba.com.cn` 已 301 到 `www.tgb.cn`；但服务整体不稳定，`/bbs/` 论坛路径与多个 API（`/user/getIsLogin`、`/user/getUserImg`）间歇 502（nginx）。当前不可做可靠取证。

### 2.1 已观测结构

| 页面 | URL | 状态 |
|------|-----|------|
| 新首页 | `https://www.tgb.cn/index.html` | 可开；信息流由 JS 异步加载（初始 DOM 几乎为空） |
| 淘股论坛 | `https://www.tgb.cn/bbs/` | 502（不稳定，多次重试失败） |
| 投资策略 | `tgb.cn/feeds/qryFeedsViewPointView` | 可开；付费投顾内容，非社区帖子 |
| 极速快讯 | `shuo.tgb.cn/newsFlash/` | 未测 |

- 新首页有 tab："综合推荐 / 淘县神评 / 网友精选 / 今日推荐 / 淘县院子"；排序区"最新热度 / 最新发布 / 7日最热 / 30日最热"。
- 首页信息流容器初始为空（数据走 API），正文链接形如 `tgb.cn/blog/{id}`。
- 投资策略页时间格式样本：`今天 08:21`、`2026-8-16 23:52`（混合相对/绝对，`YYYY-M-D H:mm`）。

### 2.2 结论

- 站内仍保留原品牌与结构（`taoguba.com.cn` 链接在页脚博客处仍在使用），但**服务稳定性是首要门槛**。
- 正式适配前需：① 服务恢复后重取 `/bbs/` 帖子流结构；② 确认信息流 API 返回与分页方式；③ 判断登录墙。当前**不建议承诺适配**。

---

## 3. 天天基金 fund.eastmoney.com（+ fundf10 / guba 基金吧）

### 3.1 页面类型与 URL 模式

| 页面 | URL | 状态 |
|------|-----|------|
| 基金详情页 | `fund.eastmoney.com/{code}.html`（如 /110022.html） | ✅ 免登录可开 |
| 基金档案 F10 | `fundf10.eastmoney.com/jbgk_{code}.html` | ✅ |
| 基金吧总版 | `guba.eastmoney.com/jj.html`（`fund.eastmoney.com/ba/jj.html`、`jijinba.eastmoney.com` 均 301 至此） | ✅ |
| 基金吧分页 | `guba.eastmoney.com/jj_{n}.html`（实测 337359 页 × 80 条/页） | ✅ |
| 单基金吧列表 | `guba.eastmoney.com/list,of{code}.html` | ❌ 未登录滑块；✅ 登录态（2026-08-18，结构见 3.5） |
| 分类吧 | `list,jjdt.html`（基金动态）、`list,zg{公司ID}.html`、`list,sh/sz{code}.html`（场内 LOF/ETF） | ❌ 滑块 |
| 帖子正文 | `guba.eastmoney.com/news,{barType},{postId}.html` | ❌ 滑块 |
| 详情页内嵌吧帖区块 | 基金详情页内 `.barEssayListWrap > table.popTable`（10 条最新吧帖） | ✅ |

### 3.2 列表 DOM（总版 jj.html）

```html
<div class="balist"><ul class="newlist">
  <li class="first">
    <cite>3769</cite>                                   <!-- 阅读数 -->
    <cite>65</cite>                                     <!-- 回复数 -->
    <span class="sub">
      [<a href="/list,of020774.html" class="balink">国寿安保...C吧</a>]
      <em class="settop">置顶</em>
      <a href="/news,of020774,1757431746.html" class="note">标题</a>
    </span>
    <cite class="aut"><a href="i.eastmoney.com/{uid}">作者</a></cite>
    <cite class="date">08-11 16:18</cite>               <!-- 发帖时间 -->
    <cite class="last">08-17 22:07</cite>               <!-- 最后回复时间 -->
  </li>
</ul></div>
```

- **帖子容器**：`div.balist > ul.newlist > li`
- **发帖时间**：`li > cite.date`；**最后回复时间**：`li > cite.last`；格式 **`MM-DD HH:mm`（无年份）**
- **详情页内嵌吧帖**：`table.popTable > tbody > tr`，时间在 `td.td05`（`MM-DD HH:mm`）
- **数据 API**：`fund.eastmoney.com/ba/interface/GetList.aspx?code=of110022`（需带合适参数，否则被滑块拦截）
- **吧类型前缀**（`a.balink` href 提取）：`of{6位代码}`=开放式基金吧、`sh/sz{code}`=场内、`jjdt`=基金动态吧、`zg{id}`=基金公司吧 → 可作 feed 上下文 Key。

### 3.3 时间精度与跨年

- 与股吧相同的 `MM-DD HH:mm` 无年份问题；列表为帖子最后回复倒序（可辅助推断年份）。

### 3.4 结论

- 无登录路径最稳的是**基金详情页内嵌 10 条吧帖**（零风控），但只能覆盖"最新帖"+ 深度极浅。
- **登录态下单基金吧列表完全可用**（3.5），可作为主适配路径；总版 jj.html 作免登录兜底（可翻 33 万页回溯，但按吧混排）。

### 3.5 单基金吧列表结构（2026-08-18 登录态实测 `list,of110022.html`）

> 与个股吧的 `table.default_list` 不同，基金吧沿用旧版 guba 模板。

```html
<div id="articlelistnew" class="all fund_list">
  <div class="articleh normal_post">
    <span class="l1">34</span>                       <!-- 阅读数 -->
    <span class="l2">0</span>                        <!-- 回复数 -->
    <span class="l3"><a href="/news,of110022,1760403830.html" title="浪费钱">浪费钱</a></span>  <!-- 标题+稳定ID -->
    <span class="l4"><a href="//i.eastmoney.com/{uid}">基民...</a></span>                        <!-- 作者 -->
    <span class="l5">08-18 10:06</span>              <!-- 时间 MM-DD HH:mm，无年份 -->
  </div>
  <!-- 置顶/官方活动帖: .l3 内 <em class="settop">讨论</em>，且链接可能指向其他吧（of020774/jjdt 等跨吧活动帖） -->
</div>
```

- **帖子容器**：`#articlelistnew .articleh.normal_post`（实测 80 条/页）
- **时间**：`.l5`，`MM-DD HH:mm` 无年份（同跨年推断问题）
- **稳定 ID**：`.l3 a` 的 `/news,of{code},{postId}.html`
- **注意**：列表混有跨吧置顶活动帖（`em.settop` + 链接指向其他 of/jjdt 吧），过滤判定时应按行自身 `.l5` 时间判定，去重 ID 用行内链接即可，无需剔除（除非产品要求）。
- **分页**：`list,of110022_{n}.html`；**类别**：全部/热帖(,99)/资讯(,1,f)/公告(,3,f)/研报(,2,f)/视频(,20) —— 与个股吧 URL 规则一致。

---

## 4. 同花顺 t.10jqka.com.cn（现有 ths.json 的扩展面）

> 现有 `ths.json` 已覆盖首页信息流（`li.feed-item` + `data-date`(MMDD) + `.feed-item-timeline-time`(HH:mm)）。本次复核首页结构未变（34 条 feed）。

### 4.1 扩展页面探索

| 页面 | URL | 状态 |
|------|-----|------|
| 首页信息流 | `t.10jqka.com.cn/` | ✅ 与 ths.json 一致（登录态复核 34 条 feed，data-date/data-pid 齐全） |
| 个股吧 | `t.10jqka.com.cn/guba/{code}/` | ❌ **页面已废弃**：登录态下贵州茅台吧仍"暂时还没有帖子"；`.postlist-tab` 的 tab 在源码中被注释；页面零帖子接口请求（仅 getSelfStock/getunread/getUserNick 三个无关 API） |
| 圈子主页 | `t.10jqka.com.cn/circle/{id}/` | ❌ 个人主页/消息中心（策略动态/收到的评论/系统通知），非帖子流 |
| 帖子详情 | `t.10jqka.com.cn/pid_{pid}.shtml` | ❌ 404；首页 feed 卡片无详情锚点、点击无跳转/无弹窗 → **Web 端无评论层入口** |
| 投资策略 | `t.10jqka.com.cn/feeds/...` | 付费投顾流，非社区，不适配 |
| 财经资讯 | `stock.10jqka.com.cn/` | 资讯站，新闻正文为 Next.js app（`news-p-fe-app-news-flow-home`），无时间流列表页 |

- 首页 feed 卡片仅含作者圈链接（`/circle/{id}/`）与 `data-pid`/`data-date`，无详情页 URL；详情疑似仅存于 App/微前端。
- 个股吧/圈子在登录态下同样无数据，**不是登录墙问题，而是产品线废弃**。

### 4.2 结论

- 同花顺 Web 端**仅首页信息流可适配**（维持现有 `ths.json`），评论过滤与个股吧/圈子扩展在 Web 端无可行目标，从 v1.0 适配范围移除。

---

## 5. 集思录 jisilu.cn ⭐（友好度最高）

### 5.1 页面类型与 URL 模式

| 页面 | URL | 说明 |
|------|-----|------|
| 分类主题列表 | `jisilu.cn/category/4`（4=债券/可转债；3=新股；5=套利；6=价值投资） | ✅ 免登录 |
| 统一分页/排序 URL | `jisilu.cn/home/explore/sort_type-new__category-4__day-0__page-2` | 排序 new/hot/add_time；day=N 天筛选；page 分页（该分类实测 574 页，29 条/页） |
| 主题正文 | `jisilu.cn/question/{id}` | ✅ 免登录；回复一次性渲染 |
| 话题页 | `jisilu.cn/topic/{名称}` | 未深测 |
| 首页 explore | `jisilu.cn/home/explore` | 仅"最新/热门/实盘"顶栏聚合（无时间戳），不适配 |

### 5.2 分类列表 DOM

```html
<div class="aw-question-list">
  <div class="aw-item">
    <span class="aw-question-replay-count aw-border-radius-5 active"><em>26</em> 回复</span>
    <div class="aw-questoin-content">
      <h4>
        <a target="_blank" href="https://www.jisilu.cn/question/524337">标题</a>
        <a href=".../topic/恒逸石化" class="aw-topic-name" data-id="14354"><span>恒逸石化</span></a>
      </h4>
      <span class="aw-text-color-999">
        <a class="aw-user-name" href="/people/{uid}">作者</a> 回复 • 2026-08-17 22:05 • 5856 次浏览
      </span>
    </div>
  </div>
</div>
```

- **帖子容器**：`div.aw-question-list > div.aw-item`
- **标题**：`.aw-questoin-content h4 a[href*="/question/"]`
- **时间**：`span.aw-text-color-999` 文本中 `YYYY-MM-DD HH:mm`（**全年份绝对时间，无跨年歧义**）
- **稳定 ID**：`/question/{id}`
- **分页**：`div.pagination`，URL `home/explore/sort_type-{new|hot|add_time}__category-{id}__day-{0..}__page-{n}`，`a.active` 标记当前页
- **排序**："最新"（默认，sort_type-new）/ "热门"（sort_type-hot，带 day-30）/ "按发表时间"（sort_type-add_time）——add_time 即严格时间倒序
- **类别**：category id 即上下文 key（3 新股 / 4 债券可转债 / 5 套利 / 6 价值投资），URL 整刷切换，天然隔离

### 5.3 正文/回复 DOM

```html
<div class="aw-mod aw-question-detail-box">
  <div class="aw-mod-head">…</div>
  <div class="aw-mod-body aw-dynamic-topic">
    <div class="aw-item" id="answer_list_{replyId}">
      <div class="aw-mod-body clearfix">
        <div class="pull-left aw-dynamic-topic-content">
          <p class="publisher"><a class="aw-user-name">作者</a> …</p>
          <div class="aw-dynamic-topic-meta">
            <span class="pull-left aw-text-color-999">2026-08-17 22:05</span>
            ...
```

- **回复容器**：`.aw-mod-body.aw-dynamic-topic > div.aw-item[id^="answer_list_"]`（一次性渲染，实测 98 条回复帖全量在页；395 回复的巨型帖未见分页按钮——可能按需懒加载或未登录截断，需大帖复核）
- **回复时间**：`.aw-dynamic-topic-meta .pull-left.aw-text-color-999`，格式 `YYYY-MM-DD HH:mm`（主帖时间在标题区文本 `发表时间 2026-08-12 14:00` 样式）
- **主题标签**：`.aw-topic-name`（可作类别上下文）

### 5.4 结论

- **适配友好度排序第一**：全年份绝对时间、服务端分页、URL 即上下文、免登录、无滑块（本次全程 200）。
- 时间解析无需跨年推断逻辑；过滤判定直读文本。
- 待补：大帖回复分页/懒加载机制、topic 页结构。

---

## 6. 东方财富主站 finance.eastmoney.com（资讯类）

### 6.1 页面类型与 URL 模式

| 页面 | URL | 说明 |
|------|-----|------|
| 证券聚焦列表 | `finance.eastmoney.com/a/czqyw.html` | ✅ 免登录，41-42 条/页 |
| 分页 | `finance.eastmoney.com/a/czqyw_2.html` | `_{n}.html` 数字分页 |
| 证券要闻 | `finance.eastmoney.com/news/cgnjj.html` 等栏目 | 同一套列表结构（未逐一验证） <sup>[1]</sup> |
| 资讯正文 | `finance.eastmoney.com/a/202608173843415437.html` | 未深测 |

[1] 2026-08-18 补验**股市评论 `a/cgspl.html`**：与 czqyw 完全同模板（`li#newsTr{n}` + `p.time` `2026年08月18日 10:52` + 分页 `cgspl_{n}.html`，41 条/页）。栏目模板一致性成立，一个适配可覆盖 `/a/` 下多栏目。

### 6.2 列表 DOM

```html
<ul>
  <li id="newsTr0">
    <div class="image"><a href=".../a/202608173843415437.html"><img ...></a></div>
    <div class="text">
      <p class="title"><a href="..." target="_blank">标题</a></p>
      <p class="info" title="摘要...">摘要…</p>
      <p class="time">2026年08月17日 20:16</p>
    </div>
  </li>
</ul>
```

- **帖子容器**：`ul > li[id^="newsTr"]`（有图/无图两变体，均含 `.text`）
- **时间**：`p.time`，格式 **`YYYY年MM月DD日 HH:mm`**（全年份绝对时间，中文单位分隔）
- **稳定 ID**：正文链接 URL 中 `{yyyymmdd}{一串数字}` 段（如 `202608173843415437`），或直接以 URL 去重
- **分页**：`{栏目}_{n}.html`
- **类别**：栏目页=上下文（czqyw/cgnjj/...），URL 整刷切换

### 6.3 结论

- 资讯类列表结构极简且无登录/风控阻力，时间格式标准；属于 PRD 中"东方财富：个股资讯、公告、财富号等页面"的一部分。
- 注意这是资讯页（无评论交互），只做列表过滤即可。

---

## 7. 通达信网页版（P1 待定）

### 7.1 事实

- 官网 `www.tdx.com.cn` 是软件产品站（券商系统/下载/商城/投教），**无公共 UGC 信息流**。
- `sns.tdx.com.cn`（投资学院）为投教内容站（视频/文章推荐），非讨论社区，无时间流列表。
- 无类似雪球/股吧的浏览器社区页面。

### 7.2 结论

- **目前无社区信息流可适配**，与 PRD P2-21 的"先验证网页能力，不满足则不对外承诺"预期一致；建议保持在 P1 观察位，不投入适配。

---

## 8. 汇总与优先级建议

| 平台 | 列表免登录 | 时间格式 | 跨年歧义 | 分页可达 | 排序 | 备注 |
|------|-----------|---------|---------|---------|------|------|
| 集思录 jisilu.cn | ✅ | `YYYY-MM-DD HH:mm` | 无 | ✅ 服务端 `page-N`（574 页） | new/hot/add_time | **首选适配**；详情回复一次渲染 |
| 东方财富主站（资讯） | ✅ | `YYYY年MM月DD日 HH:mm` | 无 | ✅ `_{n}` | 时间序 | 无评论；czqyw/cgspl 双栏目验证同模板 |
| 东方财富股吧 | ✅（列表） | 列表 `MM-DD HH:mm`；**详情/评论 `YYYY-MM-DD HH:mm:ss`** | 列表有，详情无 | ✅ `_{n}`/`f_{n}`；评论 `,N.html` | 热门/最新发帖/类别；评论 最新/最热/最早 | 登录态全通（1.6） |
| 天天基金 | ✅（总版/详情内嵌/登录态单吧） | `MM-DD HH:mm` | 有 | ✅（总版 33 万页；单吧 `_{n}`） | 最后回复序 | 单吧登录态 `.articleh.normal_post`（3.5） |
| 同花顺（首页） | ✅（现有适配） | `data-date`(MMDD)+`HH:mm` | 有 | 未复核 | — | 个股吧废弃、Web 无评论层，仅首页流可适配 |
| 淘股吧 | ❌（/bbs/ 502） | — | — | — | — | 服务不稳定主导，暂不可信 |
| 通达信 | ❌（无社区） | — | — | — | — | 保持 P1 观察 |

### 8.1 对通用引擎的能力提示（配 P2-17）

1. **无年份时间推断（可行范围受限）**：股吧列表/天天基金/同花顺均为 `MM-DD HH:mm` 无年份。可行性结论（2026-08-18 决策）：
   - **仅对"严格发帖时间倒序"列表启用**：股吧 `*_f.html` 系（`pub_time` 倒序）、同花顺首页（时间倒序）。规则：首行锚定 `first_year = 首行MM-DD > 今日MM-DD ? 今年-1 : 今年`，逐行"当前 MM-DD < 上一行 MM-DD → 年份-1"。
   - **默认"全部/热门"列表不可用于推断**：排序字段为最后回复时间（`mod_time`/`cite.last`），旧帖被新回复顶前，与发帖时间年份无关。
   - **锚点置信分级**：仅当列表首行时间在近 48h 内才启用推断；冷门吧/中间页锚定不可信时放弃推断，整批按"无法解析 → 默认显示 + 计数"回退（复用 PRD F2 机制），不误杀。
   - postId 全局单调递增（2008≈7.9亿 / 2023≈12.9亿 / 2026≈17.6亿），可用作推断一致性校验，不为它建模。
2. **双时间字段**：股吧（mod_time 最后回复 vs pub_time 发帖）、天天基金（date 发帖 vs last 末回复）——过滤判定必须选"发帖时间"，适配包需支持第二标签，避免选错字段造成误杀。
3. **信息流上下文**：全部为"URL 即上下文"（栏目/吧/分类 id），比雪球前端 tab 更简单，进 `feed_context.path_patterns` 即可。
4. **登录墙已解除（东财系）**：登录态下详情/评论/单基金吧均无滑块；但扩展运行在用户真实浏览器，用户通常已登录或可过验证码，适配按"免登录列表 + 登录态详情"双层设计。

---

## 9. 2026-08-18 登录态补充取证（环境与方法）

### 9.1 环境

- Kilo 设置改为「使用系统 Chrome + 关闭无头模式」后，Playwright 控制一个**可见的系统 Chrome 窗口**，但其 profile 与用户日常 Chrome 隔离（无登录态）。
- 用户在该可见窗口内手动登录东财（passport2.eastmoney.com）与同花顺（upass.10jqka.com.cn）后继续取证；登录后东财系滑块不再出现。

### 9.2 东财股吧（登录态新发现，详见 1.6 / 3.5）

- 详情页主帖时间 `.time` 与评论 `.pubtime` 均为完整 `YYYY-MM-DD HH:mm:ss`（带秒），**列表与详情时间精度不一致**，适配包需按页面类型选解析器。
- 评论分页走 URL `/news,{code},{postId},N.html`；排序 `最新(默认)/,d.html(最热)/,z.html(最早)`；"只看作者" `, {uid}.html`。
- 单基金吧列表 `list,of{code}.html` 登录态可用，旧版模板 `.articleh.normal_post`（`.l1/.l2/.l3/.l4/.l5`），混有跨吧置顶活动帖。

### 9.3 同花顺（登录态新发现，详见 4.1 / 4.2）

- 个股吧 `guba/{code}/` 登录态仍全空（含贵州茅台吧）；`.postlist-tab` 源码注释、无帖子接口请求 → **页面废弃**，非登录墙。
- 圈子 `circle/{id}/` 是个人主页/消息中心；首页 feed 卡片无详情链接，`pid_{id}.shtml` 404 → **Web 端无评论层**。
- 结论：同花顺 v1.0 仅保留首页信息流适配（`ths.json`），移除个股吧/圈子/评论扩展计划。

### 9.4 东财资讯栏目一致性

- `a/cgspl.html`（股市评论）与 `a/czqyw.html`（证券聚焦）同模板：`li#newsTr{n}` + `p.time`（`YYYY年MM月DD日 HH:mm`）+ `{栏目}_{n}.html` 分页，41 条/页。