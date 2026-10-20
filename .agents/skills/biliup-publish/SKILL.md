---
name: biliup-publish
description: 用 biliup CLI 向 B 站投稿视频并配置全部增强能力（个性化卡片、章节、字幕、商业推广/花火、联合投稿、定时发布、自动加入合集）。凡用户要求投稿/上传视频到 B 站（bilibili）、设置定时发布、挂互动引导/投票/评分/关联视频等个性化卡片、加章节或字幕、配置商单，或遇到投稿报错（21091、79025、79049、36719、601 等）时使用——即使用户没有明确说"用 biliup"。
---

# biliup 投稿能力使用指南

本技能覆盖 biliup Rust 版（本仓库 `crates/biliup-cli`）的投稿链路。投稿 = 预上传 →
分片上传 → （可选预挂：个性化卡片/章节/字幕）→ `add/v3` 提交 → （自动加入合集）。
绝大多数增强能力**仅 web 提交通道支持**，投稿命令必须带 `--submit web`。

## 1. 前置条件

**构建**（本机 PATH 上有 chocolatey 的旧 cargo 1.84，会遮蔽 rustup 工具链）：

```bash
export PATH="/c/Users/zsnmwy/.cargo/bin:$PATH"   # 必须先修 PATH，仓库需要 edition2024
cargo build -p biliup-cli                        # 产物：target/debug/biliup
```

**登录**（需要 `cookies.json`，含 SESSDATA/bili_jct 等）：

- 交互终端里让用户自己跑 `cargo run -p biliup-cli` 编译出的 `biliup login`（选扫码登录，
  会在当前目录生成 `qrcode.png` 供手机扫描，成功后写 `cookies.json`）。
- Agent 无法代扫二维码。若已有 `cookies.json`（仓库根目录或用户指定路径）直接用。
- 凭据文件含登录态，不要提交进 git，也不要把内容打印到输出里。

## 2. 标准投稿命令

`--user-cookie` 是**全局参数，必须放在 `upload` 子命令前面**（放在后面会报
unexpected argument）：

```bash
biliup --user-cookie cookies.json upload <视频路径> \
  --submit web \
  --copyright 1 --tid 231 \
  --title "标题" --desc "简介" --tag "标签1,标签2" \
  --cover cover.jpg \
  --dtime <10位Unix时间戳> \
  --chapters '<JSON 数组>' \
  --subtitle-zh <subtitle.srt> \
  --personal-cards '<JSON 数组>' \
  --porder '<JSON 对象>' \
  --staffs '<JSON 数组>' \
  --section-id <合集小节id> \
  --extra-fields '{"creation_statement":{"id":-1},"space_hidden":2,"watermark":{"state":0}}'
```

要点（均为真号实测结论，细节见 `references/business-rules.md`）：

- `--extra-fields` 里的 `creation_statement/space_hidden/watermark` 是与网页端行为
  对齐的推荐值；`creation_statement:{id:-1}` 表示自制无需标注，缺了它 add/v3 可能
  被网页规则拒绝。
- `--dtime` 接受 10 位绝对时间戳；有效窗口为提交时间 +4 小时 ~ +15 天。测试投稿用
  `date -d "+14 days" +%s` 取最远值，**并明确提醒用户在到期前删除稿件**。
- 失败语义分三档：个性化卡片/章节预挂失败会**中止投稿**（避免挂了标记但内容缺失）；
  字幕、加入合集失败只告警不阻断；app/bcut 通道自动剥离 web-only 字段并告警。
- 上传分片限流（code 601 上传过快）时程序会自动持锁重试，无需干预。

## 3. 配置参数速查

**个性化卡片 `--personal-cards`**（数组，按 `kind` 区分；at 为秒）：

```json
[
  {"kind":"like","at":15,"msg":"求三连","sub_type":2,"auto_create":false,"count_down":10},
  {"kind":"vote","at":170,"question":"问题(≤12字)","options":["会","不会"],"duration":7000},
  {"kind":"related","at":100,"oid":"<自己账号的BV号>","msg":"说明"},
  {"kind":"preview","at":50,"reserve_type":1,"reserve_id":<真实预约id>,"msg":"下期更精彩"},
  {"kind":"score","at":120,"skin":1,"msg":"给个评分吧"},
  {"kind":"score_summary","at":200,"refs":["<已有评分卡idStr>"],"msg":"总结"}
]
```

**章节 `--chapters`**：`[{"from":0,"to":80,"content":"标题(≤16字)"}]`，1-10 段、
from 非降、视频须 ≥60 秒；正文走 `card/pre/chapter/submit`，add/v3 只带 `has_chapter`。

**商业推广 `--porder`**（与花火/充电/仅自己可见互斥）：
`{"industry_id":21149,"official":0,"brand_name":"品牌","brand_source":2,"show_type":"11"}`
行业与推广形式 id 从 `GET member.bilibili.com/x/vupre/web/archive/pre`（登录态）的
`industry_list`/`showtype_list` 取。**花火带货**改用 `--adorder-id/--adorder-type`（0-5），
与 porder 不能同传。

**联合投稿 `--staffs`**：`[{"title":"出演","mid":<对方mid>}]`。搜索候选走
`GET member.bilibili.com/x/web/staff/user/search?kw=<关键词>`。

**加入合集 `--section-id`**：小节 id，投稿成功后自动 `episodes/add`；合集/小节列表
从 `GET member.bilibili.com/x2/creative/web/seasons` 查（注意返回是
`data.seasons[].sections.sections[].id` 双层嵌套）。

## 4. 硬性业务规则（违反即报错，已逐条真号验证）

投稿前先按 `references/business-rules.md` 的互斥矩阵和错误码表自查一遍配置，
不要指望服务端的报错来发现这些问题——卡片/章节失败会浪费一次上传。

## 5. 测试投稿的安全做法

用户要求"试一下能不能发"时：用 `--dtime` 设到 14 天后（`state=-60` 定时待发布，
不会立刻公开），标题带【接口测试】字样，投稿后**主动提醒用户到创作中心删除稿件**，
并说明到期会自动公开。多次重试时优先改配置而不是重复上传——每次上传都会创建新的
预上传会话。

## 6. 深入资料

- 互斥矩阵、错误码、卡片类型总表、稿件状态码：`references/business-rules.md`
- 协议级逆向依据（字段行号证据、payload 细节）：本仓库旁路分析包
  `zsnmwy-bilibili-videoup-analysis-87e4dd3/docs/`（不在 git 内，存在时才可读）
