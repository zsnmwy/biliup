# B 站投稿业务规则速查（全部为 2026-10 真号实测 + 静态逆向证据）

## 1. 个性化卡片类型总表

| kind | type | 必填/约束 | 实测结论 |
| --- | --- | --- | --- |
| like 互动引导 | 5 | msg ≤6 汉字；sub_type 0 关注/1 三连/2 关注&三连/3 充电/4 三连充电；同 sub_type 每视频 1 张 | ✅ 提交即生效 |
| related 关联视频 | 2 | oid **只能是自己账号的稿件**（BV/av/链接） | ❌ 指向他人稿件 → `79025 暂不支持跳转他人稿件`；账号无已发布稿件时不可用 |
| vote 投票弹幕 | 9 | question ≤12 字；选项 2-4；每视频 1 个；服务端代建投票（无需 vote_id） | ✅ 生效，回读可见 vote_id |
| preview 下期预告 | 10 | reserve_id **必须引用创作中心-预约管理里已创建的预约**；reserve_type=2（直播）时需 live_stime（秒） | ❌ 无预约时 → `79049 无此预约权限` |
| score 评分弹幕 | 11 | skin 默认 1 即可；grade_id 可不填，**服务端会自动分配** | ✅ 生效 |
| score_summary 评分总结 | 12 | refs = 同视频已有评分卡的 idStr 列表；data 里只有 dmids_str+msg（无坐标/时长） | 未单独实测（依赖 dm11 先存在） |

卡片挂载时机：**投稿前预挂**（preupload 返回的 biz_id 即 cid，`plat=10, aid=0` 逐张
`POST api.bilibili.com/x/v2/dm/command/post`，form：type/aid/cid/progress毫秒/plat/
data JSON/csrf），add/v3 只带 `videos[0].pre_command=true`。

**plat 边界**：`plat=8`（已投稿件）发 dm 命令要求稿件过审——审核中（state=-30）返回
`36719 该稿件暂时无法发送弹幕`。所以自动挂卡只有投稿前（plat=10）这一条可靠路径。

## 2. 联合投稿 staffs

- 元素只有 `{title, mid}`；**mid 不能是自己** → add/v3 返回 `21091 无效参与者`
  （注意：这会拒绝整个投稿，不是只忽略该参与者）。
- 需要真实第二账号；候选搜索 `GET /x/web/staff/user/search?kw=`（参数名是 kw）。
- 与充电互斥（账号无 upower_staff 白名单时）。

## 3. 互斥矩阵（提交层已硬校验，UI 同步拦截）

| 配置组合 | 结果 |
| --- | --- |
| porder × 花火(adorder_id) | 互斥，不能同传 |
| porder × 充电 charging_pay | 互斥 |
| porder × 仅自己可见 is_only_self | 互斥 |
| 花火 × 转载(copyright=2) | 互斥 |
| staffs × 充电 | 账号无 upower_staff 白名单时互斥（服务端判定） |
| 互动视频(interactive=1) | 卡片/章节全部跳过 |

B 站互斥码：转载 1 / 充电 2 / 首映 4 / 商单 8 / 联合投稿 16 / 定时 32 / 手动发布 64 /
花火定时 128 / 单片付费 256 / 仅自己可见 512。

## 4. 错误码速查（投稿链路实测）

| code | 场景 | 含义 / 处置 |
| --- | --- | --- |
| 79025 | dm 关联视频卡片 | 目标 oid 是他人稿件；改用自己账号的稿件 |
| 79049 | dm 下期预告卡片 | 账号无对应预约权限；reserve_id 必须来自已创建的预约 |
| 21091 | add/v3 | 联合投稿参与者无效（含把自己加进去）；换真实他人 mid |
| 36719 | dm 命令（plat=8） | 稿件未过审/已删除，不能发弹幕命令；改走投稿前预挂 |
| 601 | preupload | 上传过快限流；biliup 自动账号级锁重试，无需干预 |
| 412 | add/v3 | 风控拦截；检查网络环境与登录态，不要高频重试 |

## 5. 稿件状态码（archive/view 的 state）

| state | 含义 |
| --- | --- |
| -60 | 定时发布待生效（投稿成功、等待 dtime，不会公开） |
| -30 | 审核中 |
| -1 | 审核中（另一形态，实测定时稿过审前） |
| 0 | 正常（已公开） |

定时稿验证要点：`dtime` 字段等于提交时的时间戳即说明定时生效；state=-60/-1 均为
未公开状态。删除入口在创作中心-稿件管理；**dtime 到期会自动公开，测试稿必须提醒用户删除**。

## 6. 与网页端行为的对齐项（extra_fields 推荐值）

网页 add/v3 最小可通集合之外，建议随投稿带上（biliup 已在测试中验证服务端接受）：

```json
{"creation_statement":{"id":-1},"space_hidden":2,"watermark":{"state":0}}
```

- `creation_statement:{id:-1}`：自制无需标注声明；网页端缺声明会被前端拦截，服务端
  是否强制未验证，带上最稳。
- `space_hidden:2`：不隐藏空间；`watermark:{state:0}`：关投稿水印（转载稿网页强制 0）。

## 7. 其他实测注意

- CLI `--user-cookie` 是全局参数，必须放在 `upload` 子命令**前面**。
- 上传线路 `bldsa` 证书过期（`invalid peer certificate: Expired`）属已知现象，
  程序自动跳过该线路，不用处理。
- 花火任务类（adorder_type 1/3/4/5）在协议未签署时会被服务端拦；带货（type=2）分两种：
  绑定已有订单用 `--adorder-id`+`--adorder-type 2`；「投稿后再添加商品」（悬赏带货）只传
  `--adorder-type 2`，工具自动生成虚拟订单 id（网页端为 `Math.random()*1e17`）。
  **adorder_type 必须与 adorder_id 成对出现**（悬赏带货由工具补 id）——裸发
  `{"adorder_type":2}` 会被服务端静默丢弃，回读 `adorder_id=0`。
