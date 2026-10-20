//! 投稿个性化卡片：互动引导（like）、关联视频（related）、投票弹幕（vote）。
//!
//! 与网页端一致：上传完成拿到 preupload 的 biz_id（即 cid）之后、投稿之前，
//! 逐张 POST 到 `x/v2/dm/command/post`；卡片内容不进 add/v3 请求体，
//! 只在挂了卡片时把 `videos[0].pre_command` 置 true。
//! 未发布稿件预挂用 `aid=0, plat=10`，已发布稿件管理用真实 aid、`plat=8`。

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tracing::{info, warn};

use crate::error::{Kind, Result};
use crate::uploader::bilibili::{BiliBili, ResponseData, Studio};

/// 互动引导的展示时长（毫秒），网页端固定值
const LIKE_DURATION_MS: i64 = 5000;
/// 关联视频的展示时长（毫秒），网页端固定值
const RELATED_DURATION_MS: i64 = 10000;
/// 投票卡片的默认展示时长（毫秒）
const DEFAULT_VOTE_DURATION_MS: i64 = 7000;
/// 投票卡片的 vote_type，网页端原样透传的默认值
const VOTE_TYPE: i64 = 1;
/// 投票卡片的「其他，请补充」自定义项开关，固定为字符串 "0"（关闭）
const HAS_SELF_DEF_OFF: &str = "0";

/// dm/command/post 的表单参数
#[derive(Debug, Clone)]
pub struct DmCommandPost {
    /// 卡片类型：5 互动引导 / 2 关联视频 / 9 投票
    pub card_type: u8,
    /// 稿件 aid，未发布稿件预挂时填 0
    pub aid: u64,
    /// 分P cid（preupload 返回的 biz_id）
    pub cid: u64,
    /// 卡片出现时间（毫秒）
    pub progress: u64,
    /// 10 未发布 / 8 已发布
    pub plat: u8,
    /// `data` 字段：各卡片类型专属结构的 JSON 字符串
    pub data: String,
    /// type=5 时 form 层额外携带的 auto_create
    pub auto_create: Option<bool>,
    /// type=5 时 form 层额外携带的 count_down
    pub count_down: Option<u32>,
    /// 编辑已有卡片时的卡片 id（creative/list 返回的 idStr）
    pub dmid: Option<String>,
}

/// 一张个性化卡片。序列化形态即投稿模板 `personal_cards` 配置里的 JSON 对象。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PersonalCard {
    /// 互动引导（弹幕命令 type=5）
    Like {
        /// 卡片出现时间（秒）
        at: f64,
        /// 弹幕文案，最多 6 个汉字
        #[serde(default)]
        msg: String,
        /// 子类型：0 关注 / 1 三连 / 2 关注&三连 / 3 充电 / 4 三连充电
        #[serde(default)]
        sub_type: u8,
        /// 关注引导是否自动创建应援
        #[serde(default)]
        auto_create: bool,
        /// 倒计时秒数
        #[serde(default = "default_count_down")]
        count_down: u32,
    },
    /// 关联视频（弹幕命令 type=2）
    Related {
        /// 卡片出现时间（秒）
        at: f64,
        /// 目标视频 id 或链接，原样提交
        oid: String,
        /// 描述文案，可空
        #[serde(default)]
        msg: String,
    },
    /// 投票弹幕（弹幕命令 type=9）
    Vote {
        /// 卡片出现时间（秒）
        at: f64,
        /// 问题，最多 12 个字
        question: String,
        /// 选项 2-4 个，按 optionA..optionD 顺序提交
        options: Vec<String>,
        /// 展示时长（毫秒）
        #[serde(default = "default_vote_duration")]
        duration: i64,
    },
    /// 下期预告 / 更新预约（弹幕命令 type=10）
    Preview {
        /// 卡片出现时间（秒）
        at: f64,
        /// 预约类型：1 普通预约 / 2 直播预约（type=2 时需带 live_stime）
        reserve_type: i32,
        /// 预约 id（活动侧下发；没有时传 0 走 activity 分支）
        #[serde(default)]
        reserve_id: i64,
        /// 直播开始时间（秒），仅 reserve_type=2 时提交
        #[serde(default)]
        live_stime: Option<i64>,
        /// 文案，可空
        #[serde(default)]
        msg: String,
    },
    /// 评分弹幕（弹幕命令 type=11）
    Score {
        /// 卡片出现时间（秒）
        at: f64,
        /// 评分皮肤，取值来自 command/panel 的 drop 配置
        #[serde(default = "default_skin")]
        skin: i32,
        /// 评分档位 id，可选；取值来自 command/panel 的 drop 配置
        #[serde(default)]
        grade_id: Option<i64>,
        /// 文案，可空
        #[serde(default)]
        msg: String,
    },
    /// 评分总结（弹幕命令 type=12），引用同视频已有评分弹幕的 idStr
    ScoreSummary {
        /// 卡片出现时间（秒）
        at: f64,
        /// 引用的评分弹幕卡片 idStr 列表
        refs: Vec<String>,
        /// 文案，可空
        #[serde(default)]
        msg: String,
    },
}

fn default_skin() -> i32 {
    1
}

fn default_count_down() -> u32 {
    10
}

fn default_vote_duration() -> i64 {
    DEFAULT_VOTE_DURATION_MS
}

impl PersonalCard {
    /// 卡片出现时间（秒）
    pub fn at(&self) -> f64 {
        match self {
            PersonalCard::Like { at, .. }
            | PersonalCard::Related { at, .. }
            | PersonalCard::Vote { at, .. }
            | PersonalCard::Preview { at, .. }
            | PersonalCard::Score { at, .. }
            | PersonalCard::ScoreSummary { at, .. } => *at,
        }
    }

    /// 弹幕命令的卡片类型：5 互动引导 / 2 关联视频 / 9 投票 / 10 下期预告 / 11 评分 / 12 评分总结
    pub fn card_type(&self) -> u8 {
        match self {
            PersonalCard::Like { .. } => 5,
            PersonalCard::Related { .. } => 2,
            PersonalCard::Vote { .. } => 9,
            PersonalCard::Preview { .. } => 10,
            PersonalCard::Score { .. } => 11,
            PersonalCard::ScoreSummary { .. } => 12,
        }
    }

    /// 配置校验，解析模板后与提交前各查一遍
    pub fn validate(&self) -> std::result::Result<(), String> {
        match self {
            PersonalCard::Vote { options, .. } => {
                if !(2..=4).contains(&options.len()) {
                    return Err(format!(
                        "投票卡片需要 2-4 个选项，实际 {} 个",
                        options.len()
                    ));
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// `dm/command/post` 的 `data` 字段内容（JSON 字符串）
    pub fn data_json(&self) -> Result<String> {
        self.validate().map_err(Kind::Custom)?;
        let value = match self {
            PersonalCard::Like {
                msg,
                sub_type,
                auto_create,
                count_down,
                ..
            } => json!({
                "msg": msg,
                "type": sub_type,
                "auto_create": auto_create,
                "count_down": count_down,
                "duration": LIKE_DURATION_MS,
                "posX_2": 50,
                "posY_2": 65,
            }),
            PersonalCard::Related { oid, msg, .. } => json!({
                "oid": oid,
                "msg": msg,
                "duration": RELATED_DURATION_MS,
                "posX_2": 50,
                "posY_2": 65,
            }),
            PersonalCard::Vote {
                question,
                options,
                duration,
                ..
            } => {
                let mut value = json!({
                    "duration": duration,
                    "pub_dynamic": false,
                    "vote_type": VOTE_TYPE,
                    "has_self_def": HAS_SELF_DEF_OFF,
                    "question": question,
                    "posX_2": 97,
                    "posY_2": 85,
                });
                // 选项按顺序填进 optionA..optionD
                for (index, option) in options.iter().enumerate() {
                    let key = format!("option{}", (b'A' + index as u8) as char);
                    value[key.as_str()] = json!(option);
                }
                value
            }
            PersonalCard::Preview {
                reserve_type,
                reserve_id,
                live_stime,
                msg,
                ..
            } => {
                // 有 reserve_id 走预约分支，否则 reserve_type 即 activity.id（编辑器 36294-36299）
                let mut value = if *reserve_id != 0 {
                    json!({
                        "reserve_type": reserve_type,
                        "reserve_id": reserve_id,
                        "msg": msg,
                        "duration": LIKE_DURATION_MS,
                        "posX_2": 50,
                        "posY_2": 65,
                    })
                } else {
                    json!({
                        "reserve_type": reserve_type,
                        "msg": msg,
                        "duration": LIKE_DURATION_MS,
                        "posX_2": 50,
                        "posY_2": 65,
                    })
                };
                // live_stime 用秒，仅预约类型 2（直播）时提交
                if *reserve_type == 2
                    && let Some(stime) = live_stime
                {
                    value["live_stime"] = json!(stime);
                }
                value
            }
            PersonalCard::Score {
                skin,
                grade_id,
                msg,
                ..
            } => {
                let mut value = json!({
                    "skin": skin,
                    "msg": msg,
                    "duration": LIKE_DURATION_MS,
                    "posX_2": 50,
                    "posY_2": 65,
                });
                if let Some(grade) = grade_id {
                    value["grade_id"] = json!(grade);
                }
                value
            }
            // 评分总结不在通用序列化白名单里，只有 dmids_str 与 msg
            PersonalCard::ScoreSummary { refs, msg, .. } => json!({
                "dmids_str": refs,
                "msg": msg,
            }),
        };
        serde_json::to_string(&value).map_err(|e| Kind::Custom(e.to_string()))
    }

    /// 组装 `dm/command/post` 的表单参数
    pub fn to_dm_command_post(&self, aid: u64, cid: u64, plat: u8) -> Result<DmCommandPost> {
        let (auto_create, count_down) = match self {
            PersonalCard::Like {
                auto_create,
                count_down,
                ..
            } => (Some(*auto_create), Some(*count_down)),
            _ => (None, None),
        };
        Ok(DmCommandPost {
            card_type: self.card_type(),
            aid,
            cid,
            // 网页端 progress 取毫秒
            progress: (self.at() * 1000.0).round().max(0.0) as u64,
            plat,
            data: self.data_json()?,
            auto_create,
            count_down,
            dmid: None,
        })
    }
}

/// 解析投稿模板里的 `personal_cards` 配置（JSON 数组字符串）。
/// `None` 或空白视为没有卡片；解析或校验失败返回可读错误，由调用方决定报错方式。
pub fn parse_personal_cards(
    config: Option<&str>,
) -> std::result::Result<Vec<PersonalCard>, String> {
    let Some(config) = config.map(str::trim).filter(|config| !config.is_empty()) else {
        return Ok(Vec::new());
    };
    let cards: Vec<PersonalCard> = serde_json::from_str(config)
        .map_err(|error| format!("personal_cards 不是合法的卡片数组: {error}"))?;
    for card in &cards {
        card.validate()
            .map_err(|error| format!("personal_cards 配置有误: {error}"))?;
    }
    Ok(cards)
}

impl BiliBili {
    /// 新建/编辑一张个性化卡片（弹幕命令）
    pub async fn dm_command_post(&self, payload: &DmCommandPost) -> Result<Value> {
        let mut form = json!({
            "type": payload.card_type,
            "aid": payload.aid,
            "cid": payload.cid,
            "progress": payload.progress,
            "plat": payload.plat,
            "data": payload.data,
            "csrf": self.get_csrf()?,
        });
        // 互动引导：form 层还要带一份 auto_create / count_down（与 data 内的一致）
        if let (5, Some(auto_create), Some(count_down)) =
            (payload.card_type, payload.auto_create, payload.count_down)
        {
            form["auto_create"] = json!(auto_create);
            form["count_down"] = json!(count_down);
        }
        // 编辑已有卡片时带上原卡片 id
        if let Some(dmid) = &payload.dmid {
            form["dmid"] = json!(dmid);
        }
        let response = self
            .client
            .post("https://api.bilibili.com/x/v2/dm/command/post")
            .form(&form)
            .send()
            .await?;
        let res: ResponseData = if !response.status().is_success() {
            return Err(Kind::Custom(response.text().await?));
        } else {
            response.json().await?
        };
        if res.code == 0 {
            Ok(res.data.unwrap_or_default())
        } else {
            Err(Kind::Custom(format!("{res}")))
        }
    }

    /// 读取已配置的个性化卡片列表。未发布稿件 `aid=0, plat=10`，已发布用真实 aid、`plat=8`
    pub async fn dm_creative_list(&self, aid: u64, oid: u64, plat: u8) -> Result<Value> {
        let res: ResponseData = self
            .client
            .get("https://api.bilibili.com/x/v2/dm/command/creative/list")
            .query(&[
                ("aid", aid.to_string()),
                ("oid", oid.to_string()),
                ("plat", plat.to_string()),
            ])
            .send()
            .await?
            .json()
            .await?;
        if res.code == 0 {
            Ok(res.data.unwrap_or_default())
        } else {
            Err(Kind::Custom(format!("{res}")))
        }
    }

    /// 删除一张个性化卡片（`dmid` 为 creative/list 返回的 idStr）
    pub async fn dm_command_del(&self, aid: u64, oid: u64, dmid: &str, plat: u8) -> Result<()> {
        let res: ResponseData = self
            .client
            .post("https://api.bilibili.com/x/v2/dm/command/del")
            .form(&json!({
                "aid": aid,
                "oid": oid,
                "dmid": dmid,
                "plat": plat,
                "csrf": self.get_csrf()?,
            }))
            .send()
            .await?
            .json()
            .await?;
        if res.code == 0 {
            Ok(())
        } else {
            Err(Kind::Custom(format!("{res}")))
        }
    }

    /// 逐张提交个性化卡片。未发布稿件预挂用 `aid=0, plat=10`。
    pub async fn submit_personal_cards(
        &self,
        cards: &[PersonalCard],
        aid: u64,
        cid: u64,
        plat: u8,
    ) -> Result<()> {
        for card in cards {
            let payload = card.to_dm_command_post(aid, cid, plat)?;
            info!(
                card_type = payload.card_type,
                progress = payload.progress,
                "提交个性化卡片"
            );
            self.dm_command_post(&payload).await?;
        }
        Ok(())
    }

    /// 网页投稿前置动作：把 `studio.personal_cards` 逐张挂到第一个分P上
    /// （`aid=0, plat=10`），成功后置 `videos[0].pre_command = true`。
    /// 分P缺 cid 时告警跳过（卡片挂不上但投稿可继续）；卡片接口失败向上报错，
    /// 由调用方决定是否继续投稿。
    pub async fn attach_personal_cards(&self, studio: &mut Studio) -> Result<()> {
        if studio.personal_cards.is_empty() {
            return Ok(());
        }
        let Some(cid) = studio.videos.first().and_then(|video| video.cid) else {
            warn!(
                cards = studio.personal_cards.len(),
                "分P缺少 cid（preupload biz_id），跳过个性化卡片"
            );
            return Ok(());
        };
        self.submit_personal_cards(&studio.personal_cards, 0, cid, 10)
            .await?;
        studio.videos[0].pre_command = Some(true);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{PersonalCard, parse_personal_cards};

    fn like() -> PersonalCard {
        PersonalCard::Like {
            at: 30.0,
            msg: "求三连".into(),
            sub_type: 1,
            auto_create: false,
            count_down: 10,
        }
    }

    fn related() -> PersonalCard {
        PersonalCard::Related {
            at: 120.0,
            oid: "BV1xx411c7mD".into(),
            msg: "上期视频".into(),
        }
    }

    fn vote() -> PersonalCard {
        PersonalCard::Vote {
            at: 60.0,
            question: "下期看什么".into(),
            options: vec!["A".into(), "B".into()],
            duration: 7000,
        }
    }

    /// data JSON 必须与网页端逐字段一致（字段名、默认值、固定坐标与时长）
    #[test]
    fn like_data_json_matches_web_protocol() {
        let data: serde_json::Value = serde_json::from_str(&like().data_json().unwrap()).unwrap();
        assert_eq!(
            data,
            serde_json::json!({
                "msg": "求三连",
                "type": 1,
                "auto_create": false,
                "count_down": 10,
                "duration": 5000,
                "posX_2": 50,
                "posY_2": 65
            })
        );
        assert_eq!(like().card_type(), 5);
    }

    #[test]
    fn related_data_json_matches_web_protocol() {
        let data: serde_json::Value =
            serde_json::from_str(&related().data_json().unwrap()).unwrap();
        assert_eq!(
            data,
            serde_json::json!({
                "oid": "BV1xx411c7mD",
                "msg": "上期视频",
                "duration": 10000,
                "posX_2": 50,
                "posY_2": 65
            })
        );
        assert_eq!(related().card_type(), 2);
    }

    #[test]
    fn vote_data_json_matches_web_protocol() {
        let data: serde_json::Value = serde_json::from_str(&vote().data_json().unwrap()).unwrap();
        assert_eq!(
            data,
            serde_json::json!({
                "duration": 7000,
                "pub_dynamic": false,
                "vote_type": 1,
                "has_self_def": "0",
                "question": "下期看什么",
                "optionA": "A",
                "optionB": "B",
                "posX_2": 97,
                "posY_2": 85
            })
        );
        assert_eq!(vote().card_type(), 9);
    }

    /// 3、4 个选项按顺序落进 optionC / optionD
    #[test]
    fn vote_options_fill_option_a_to_d_in_order() {
        let card = PersonalCard::Vote {
            at: 1.0,
            question: "q".into(),
            options: vec!["1".into(), "2".into(), "3".into(), "4".into()],
            duration: 7000,
        };
        let data: serde_json::Value = serde_json::from_str(&card.data_json().unwrap()).unwrap();
        assert_eq!(data["optionA"], "1");
        assert_eq!(data["optionB"], "2");
        assert_eq!(data["optionC"], "3");
        assert_eq!(data["optionD"], "4");
    }

    /// 下期预告：带 reserve_id 时走预约分支；无 reserve_id 时不带该键；
    /// 仅预约类型 2（直播）带 live_stime（秒）
    #[test]
    fn preview_data_json_matches_web_protocol() {
        let with_id = PersonalCard::Preview {
            at: 50.0,
            reserve_type: 1,
            reserve_id: 42,
            live_stime: None,
            msg: "下期更精彩".into(),
        };
        let data: serde_json::Value = serde_json::from_str(&with_id.data_json().unwrap()).unwrap();
        assert_eq!(
            data,
            serde_json::json!({
                "reserve_type": 1,
                "reserve_id": 42,
                "msg": "下期更精彩",
                "duration": 5000,
                "posX_2": 50,
                "posY_2": 65
            })
        );
        assert_eq!(with_id.card_type(), 10);

        let live = PersonalCard::Preview {
            at: 1.0,
            reserve_type: 2,
            reserve_id: 0,
            live_stime: Some(1793725293),
            msg: String::new(),
        };
        let data: serde_json::Value = serde_json::from_str(&live.data_json().unwrap()).unwrap();
        assert!(data.get("reserve_id").is_none(), "{data}");
        assert_eq!(data["live_stime"], 1793725293);
    }

    /// 评分弹幕：skin 恒带，grade_id 仅在设置时出现
    #[test]
    fn score_data_json_matches_web_protocol() {
        let plain = PersonalCard::Score {
            at: 120.0,
            skin: 1,
            grade_id: None,
            msg: "打个分吧".into(),
        };
        let data: serde_json::Value = serde_json::from_str(&plain.data_json().unwrap()).unwrap();
        assert_eq!(
            data,
            serde_json::json!({
                "skin": 1,
                "msg": "打个分吧",
                "duration": 5000,
                "posX_2": 50,
                "posY_2": 65
            })
        );
        assert_eq!(plain.card_type(), 11);

        let graded = PersonalCard::Score {
            at: 1.0,
            skin: 2,
            grade_id: Some(3),
            msg: String::new(),
        };
        let data: serde_json::Value = serde_json::from_str(&graded.data_json().unwrap()).unwrap();
        assert_eq!(data["skin"], 2);
        assert_eq!(data["grade_id"], 3);
    }

    /// 评分总结不在通用序列化白名单里，data 只有 dmids_str 与 msg
    #[test]
    fn score_summary_data_json_only_has_dmids_and_msg() {
        let summary = PersonalCard::ScoreSummary {
            at: 200.0,
            refs: vec!["111".into(), "222".into()],
            msg: "评分总结".into(),
        };
        let data: serde_json::Value = serde_json::from_str(&summary.data_json().unwrap()).unwrap();
        assert_eq!(
            data,
            serde_json::json!({"dmids_str": ["111", "222"], "msg": "评分总结"})
        );
        assert_eq!(summary.card_type(), 12);
    }

    /// 配置可省略的字段按默认值参与 data JSON：sub_type=0、auto_create=false、
    /// count_down=10、msg 为空、投票时长 7000
    #[test]
    fn config_defaults_fill_protocol_defaults() {
        let cards: Vec<PersonalCard> = serde_json::from_value(serde_json::json!([
            {"kind": "like", "at": 5},
            {"kind": "related", "at": 6, "oid": "BV1xx411c7mD"},
            {"kind": "vote", "at": 7, "question": "q", "options": ["A", "B"]}
        ]))
        .unwrap();
        let like_data: serde_json::Value =
            serde_json::from_str(&cards[0].data_json().unwrap()).unwrap();
        assert_eq!(like_data["type"], 0);
        assert_eq!(like_data["auto_create"], false);
        assert_eq!(like_data["count_down"], 10);
        assert_eq!(like_data["msg"], "");
        assert_eq!(like_data["duration"], 5000);

        let related_data: serde_json::Value =
            serde_json::from_str(&cards[1].data_json().unwrap()).unwrap();
        assert_eq!(related_data["msg"], "");

        let vote_data: serde_json::Value =
            serde_json::from_str(&cards[2].data_json().unwrap()).unwrap();
        assert_eq!(vote_data["duration"], 7000);
    }

    /// 模板配置的 serde 往返：字段名一字不差
    #[test]
    fn config_roundtrip_keeps_declared_field_names() {
        let config = r#"[
            {"kind":"like","at":30,"msg":"求三连","sub_type":1,"auto_create":false,"count_down":10},
            {"kind":"related","at":120,"oid":"BV1xx411c7mD","msg":"上期视频"},
            {"kind":"vote","at":60,"question":"下期看什么","options":["A","B"],"duration":7000}
        ]"#;
        let cards = parse_personal_cards(Some(config)).unwrap();
        assert_eq!(cards, vec![like(), related(), vote()]);
        let serialized = serde_json::to_string(&cards).unwrap();
        let back: Vec<PersonalCard> = serde_json::from_str(&serialized).unwrap();
        assert_eq!(back, cards);
    }

    /// 投稿前校验：投票选项必须 2-4 个
    #[test]
    fn vote_requires_two_to_four_options() {
        let card = PersonalCard::Vote {
            at: 1.0,
            question: "q".into(),
            options: vec!["A".into()],
            duration: 7000,
        };
        assert!(card.validate().is_err());
        assert!(card.data_json().is_err());
        assert!(
            parse_personal_cards(Some(
                r#"[{"kind":"vote","at":1,"question":"q","options":["A"]}]"#
            ))
            .is_err()
        );
        let card = PersonalCard::Vote {
            at: 1.0,
            question: "q".into(),
            options: vec!["A".into(), "B".into(), "C".into(), "D".into(), "E".into()],
            duration: 7000,
        };
        assert!(card.validate().is_err());
    }

    /// progress 按四舍五入转毫秒；空白/缺省配置视为没有卡片
    #[test]
    fn progress_is_milliseconds_and_blank_config_is_empty() {
        let card = PersonalCard::Related {
            at: 1.25,
            oid: "BV1xx411c7mD".into(),
            msg: String::new(),
        };
        let payload = card.to_dm_command_post(0, 42, 10).unwrap();
        assert_eq!(payload.progress, 1250);
        assert_eq!(payload.aid, 0);
        assert_eq!(payload.cid, 42);
        assert_eq!(payload.plat, 10);
        assert!(payload.auto_create.is_none());
        assert!(payload.dmid.is_none());

        let like_payload = like().to_dm_command_post(0, 42, 10).unwrap();
        assert_eq!(like_payload.auto_create, Some(false));
        assert_eq!(like_payload.count_down, Some(10));

        assert!(parse_personal_cards(None).unwrap().is_empty());
        assert!(parse_personal_cards(Some("  ")).unwrap().is_empty());
        assert!(parse_personal_cards(Some("not json")).is_err());
    }
}
