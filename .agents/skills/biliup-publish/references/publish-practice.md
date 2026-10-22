# 真号投稿实践补充（2026-10 实测）

`business-rules.md` 的运营实践补充：双比例封面、发布后补挂卡片、发布稿章节替换、删稿通路。结论均来自真号投稿后的接口回读验证。

## 1. 双比例封面：16:9 播放页 + 4:3 首页推荐

网页投稿页支持两张封面，CLI `--cover` 只有一张。做法：

1. 4:3 图先传 B站图床拿 URL：

```
POST https://member.bilibili.com/x/vu/web/cover/up?csrf=<bili_jct>
Content-Type: application/x-www-form-urlencoded

cover=data:image/jpeg;base64,<...>&csrf=<bili_jct>
```

返回 `data.url`。

2. 4:3 封面在稿件里的字段名是 `cover43`，用 `--extra-fields` 带进 add/v3：

```bash
--extra-fields '{"cover43":"https://archive.biliimg.com/bfs/archive/<...>.jpg"}'
```

实测 add/v3 接受 `cover43`；`GET /x/vupre/web/archive/view` 回读 `archive.cover43` 为所传 URL。

> 注意：`--extra-fields` 是 serde flatten，任何 add/v3 一等字段都能这样携带，同时会绕开 CLI 的互斥校验——配置前先自查 business-rules §4。

## 2. 已发布稿件补挂个性化卡片（plat=8）

business-rules §1 说「自动挂卡只有投稿前（plat=10）这一条可靠路径」。补充实测：

- 稿件**过审公开（state=0）后**，`plat=8` + 真实 aid 同样可以挂：投票（type 9）与互动引导（type 5）均生效，creative/list 回读可见（服务端补全 icon，command 为 #VOTE# / #ATTENTION#）。
- 审核中（state=-30）才返回 36719。
- 用途：投稿时漏挂卡片后的补救，是「稿件编辑-互动管理」手动操作之外的一条自动通路。

表单同投稿前预挂（`type/aid/cid/progress毫秒/plat/data JSON/csrf`，type=5 另带 `auto_create`、`count_down`），读回验证：

```
GET https://api.bilibili.com/x/v2/dm/command/creative/list?aid=<aid>&oid=<cid>&plat=8
```

## 3. 已发布稿件替换章节标题：pre/chapter/submit 只部分生效

对已发布稿件按投稿前同款表单（不带 aid）重发 `POST /x/web/card/pre/chapter/submit`：

- 返回 code 0，但实测 6 节里只有第 1 节标题真正替换，其余节等 18 分钟以上仍是旧值；
- form 里加 `aid` 反而返回 -400；
- 即发布稿目前没有可靠的章节替换 API，完整修改仍需创作中心「稿件编辑 → 章节设置」手动保存（该编辑器是 postMessage iframe，接口未抓到）。

结论：章节在投稿时一次挂对最稳；发布后要改标题走网页编辑页。

## 4. 删除稿件没有可用 API

`/x/vu/web/delete`、`/x/vu/web/archive/del`、`/x/vu/web/archive/multidel` 均 404（2026-10 实测）。测试稿只能在创作中心手动删除——投稿演练建议一律 `--dtime` 定时或 `--is-only-self`（见 business-rules §5）。

## 5. 待解：商业推广「视频带货」投稿声明

网页端「商业推广 → 视频带货 → 投稿后再添加商品」（悬赏带货）在 add/v3 里对应的字段未知：

- `--porder` 是「其他」页签（定制软广 industry/showtype）那条路，不是带货；
- `--extra-fields '{"adorder_type":2}'`（无订单 id）投稿成功但无任何可见状态（archive/view 与公开接口均不回显），CLI 互斥校验也不允许单传 `adorder_type`；
- 后挂花火订单的稿件（`adorder_id` 有值）是带货落地的最终形态，但订单在花火后台产生。

知道网页端这个勾选实际发送字段的欢迎补充。
