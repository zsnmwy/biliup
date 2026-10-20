//! 投稿章节（视频分段时间轴）。
//!
//! 与网页端一致：章节正文不进 add/v3 请求体。投稿前用 preupload 返回的
//! biz_id（即分P cid）POST `member.bilibili.com/x/web/card/pre/chapter/submit`，
//! 成功后在 add/v3 里带 `has_chapter: true`（仅新建、非互动、确实有章节时）。
//!
//! pre 接口与编辑器正式 `card/submit` 共用同一套 axios 拦截器：POST 体是
//! qs.stringify 的 `application/x-www-form-urlencoded`；`setPreCards` 把 `cards`
//! 改名 `chapters` 并删掉 `type`，`permanent` 在删 type 前已写入所以仍然带上。
//! 因此 pre 请求的字段是 `cid`、`chapters`（章节 JSON 字符串）、`permanent`、`csrf`，
//! 没有 `type`，也没有 `aid`。

use serde::{Deserialize, Deserializer, Serialize};

use crate::error::{Kind, Result};
use crate::uploader::bilibili::{BiliBili, ResponseData, Studio};

/// 单个章节。序列化形态即 `chapters` JSON 字符串数组里的元素，
/// 字段名与网页端一字不差；from/to 提交取整秒。
#[derive(PartialEq, Eq, Serialize, Deserialize, Debug, Clone)]
pub struct Chapter {
    /// 章节开始时间（秒，取整）
    #[serde(deserialize_with = "round_seconds")]
    pub from: i64,
    /// 章节结束时间（秒，取整）
    #[serde(deserialize_with = "round_seconds")]
    pub to: i64,
    /// 章节标题，非空且不超过 16 个字
    pub content: String,
}

/// 配置里的小数秒四舍五入成整秒（网页端时间轴按整秒提交）
fn round_seconds<'de, D>(deserializer: D) -> std::result::Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    let number = serde_json::Number::deserialize(deserializer)?;
    if let Some(seconds) = number.as_i64() {
        return Ok(seconds);
    }
    let seconds = number
        .as_f64()
        .ok_or_else(|| serde::de::Error::custom("章节时间必须是数字"))?;
    Ok(seconds.round() as i64)
}

/// 章节配置校验：段数 1-10、from 非降、to>from、标题非空且 ≤16 个字。
/// 与网页端投稿前时间轴编辑器的写死规则一致。
pub fn validate_chapters(chapters: &[Chapter]) -> std::result::Result<(), String> {
    if chapters.is_empty() {
        return Err("章节至少需要 1 段".into());
    }
    if chapters.len() > 10 {
        return Err(format!("章节最多 10 段，实际 {} 段", chapters.len()));
    }
    let mut previous_from: Option<i64> = None;
    for (index, chapter) in chapters.iter().enumerate() {
        let no = index + 1;
        if chapter.content.trim().is_empty() {
            return Err(format!("第 {no} 段章节标题不能为空"));
        }
        if chapter.content.chars().count() > 16 {
            return Err(format!("第 {no} 段章节标题超过 16 个字"));
        }
        if chapter.to <= chapter.from {
            return Err(format!("第 {no} 段章节结束时间必须大于开始时间"));
        }
        if let Some(previous) = previous_from
            && chapter.from < previous
        {
            return Err(format!("第 {no} 段章节开始时间不能早于上一段"));
        }
        previous_from = Some(chapter.from);
    }
    Ok(())
}

/// 解析投稿模板里的 `chapters` 配置（JSON 数组字符串）。
/// `None` 或空白视为没有章节；解析或校验失败返回可读错误。
pub fn parse_chapters(config: Option<&str>) -> std::result::Result<Vec<Chapter>, String> {
    let Some(config) = config.map(str::trim).filter(|config| !config.is_empty()) else {
        return Ok(Vec::new());
    };
    let chapters: Vec<Chapter> = serde_json::from_str(config)
        .map_err(|error| format!("chapters 不是合法的章节数组: {error}"))?;
    validate_chapters(&chapters).map_err(|error| format!("chapters 配置有误: {error}"))?;
    Ok(chapters)
}

/// `card/pre/chapter/submit` 的表单体（按表单编码提交）。
/// 字段名与网页端一致：`chapters` 是章节 JSON 字符串，`permanent` 恒为
/// true（App 播放页默认展开章节进度条），没有 `type` 字段。
pub(crate) fn pre_chapter_form(
    cid: u64,
    chapters: &[Chapter],
    csrf: &str,
) -> Result<Vec<(String, String)>> {
    validate_chapters(chapters).map_err(Kind::Custom)?;
    let chapters = serde_json::to_string(chapters).map_err(|e| Kind::Custom(e.to_string()))?;
    Ok(vec![
        ("cid".into(), cid.to_string()),
        ("chapters".into(), chapters),
        ("permanent".into(), "true".into()),
        ("csrf".into(), csrf.into()),
    ])
}

impl BiliBili {
    /// 投稿前提交章节（未发布稿件预挂）。`cid` 是 preupload 返回的 biz_id。
    /// 成功后调用方应在 add/v3 里带 `has_chapter: true`。
    pub async fn submit_pre_chapters(&self, cid: u64, chapters: &[Chapter]) -> Result<()> {
        let form = pre_chapter_form(cid, chapters, self.get_csrf()?)?;
        let response = self
            .client
            .post("https://member.bilibili.com/x/web/card/pre/chapter/submit")
            .form(&form)
            .send()
            .await?;
        let res: ResponseData = if !response.status().is_success() {
            return Err(Kind::Custom(response.text().await?));
        } else {
            response.json().await?
        };
        if res.code == 0 {
            Ok(())
        } else {
            Err(Kind::Custom(format!("{res}")))
        }
    }

    /// 网页投稿前置动作：把 `studio.chapters` 挂到第一个分P上，成功后置
    /// `has_chapter = true`。互动视频或分P缺 cid 时告警跳过（与网页端一致，
    /// 章节与互动视频互斥）；章节接口失败向上报错，由调用方决定是否继续投稿。
    pub async fn attach_chapters(&self, studio: &mut Studio) -> Result<()> {
        if studio.chapters.is_empty() {
            return Ok(());
        }
        if studio.interactive == 1 {
            tracing::warn!(
                count = studio.chapters.len(),
                "互动视频不支持章节，跳过章节提交"
            );
            return Ok(());
        }
        let Some(cid) = studio.videos.first().and_then(|video| video.cid) else {
            tracing::warn!(
                count = studio.chapters.len(),
                "分P缺少 cid（preupload biz_id），跳过章节提交"
            );
            return Ok(());
        };
        self.submit_pre_chapters(cid, &studio.chapters).await?;
        studio.has_chapter = Some(true);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{Chapter, parse_chapters, pre_chapter_form, validate_chapters};

    fn chapter(from: i64, to: i64, content: &str) -> Chapter {
        Chapter {
            from,
            to,
            content: content.into(),
        }
    }

    /// 表单体字段名与取值必须与网页端一字不差：
    /// form-urlencoded、chapters 是 JSON 字符串、permanent 恒 true、没有 type/aid
    #[test]
    fn pre_chapter_form_matches_web_protocol() {
        let chapters = vec![chapter(0, 60, "开场"), chapter(60, 120, "正片")];
        let form = pre_chapter_form(8123, &chapters, "jct").unwrap();
        assert_eq!(
            form,
            vec![
                ("cid".into(), "8123".into()),
                (
                    "chapters".into(),
                    r#"[{"from":0,"to":60,"content":"开场"},{"from":60,"to":120,"content":"正片"}]"#
                        .into()
                ),
                ("permanent".into(), "true".into()),
                ("csrf".into(), "jct".into()),
            ]
        );
    }

    /// 配置 JSON 往返：字段名一字不差，小数秒四舍五入成整秒
    #[test]
    fn chapters_config_roundtrip_and_round_seconds() {
        let parsed = parse_chapters(Some(
            r#"[{"from":0,"to":60.4,"content":"开场"},{"from":59.9,"to":120,"content":"正片"}]"#,
        ))
        .unwrap();
        assert_eq!(parsed[0].to, 60, "60.4 取整为 60");
        assert_eq!(parsed[1].from, 60, "59.9 取整为 60，仍满足非降");

        let serialized = serde_json::to_string(&parsed).unwrap();
        assert_eq!(
            serialized,
            r#"[{"from":0,"to":60,"content":"开场"},{"from":60,"to":120,"content":"正片"}]"#
        );

        assert!(parse_chapters(None).unwrap().is_empty());
        assert!(parse_chapters(Some("  ")).unwrap().is_empty());
        assert!(parse_chapters(Some("not json")).is_err());
    }

    /// 校验规则：段数 1-10、from 非降、to>from、标题非空且 ≤16 字
    #[test]
    fn chapter_validation_rules() {
        let mut chapters = vec![chapter(0, 60, "开场"), chapter(60, 120, "正片")];
        assert!(validate_chapters(&chapters).is_ok());

        // to <= from
        chapters[0].to = 0;
        assert!(validate_chapters(&chapters).is_err());
        chapters[0].to = 60;

        // from 倒退（from 必须非降）
        chapters[0].from = 50;
        chapters[1].from = 30;
        assert!(validate_chapters(&chapters).is_err());
        chapters[0].from = 0;
        chapters[1].from = 60;

        // 空标题 / 超长标题
        chapters[1].content = "  ".into();
        assert!(validate_chapters(&chapters).is_err());
        chapters[1].content = "标".repeat(17);
        assert!(validate_chapters(&chapters).is_err());
        chapters[1].content = "标".repeat(16);
        assert!(validate_chapters(&chapters).is_ok());

        // 段数上限 10
        let eleven: Vec<Chapter> = (0..11).map(|i| chapter(i * 10, i * 10 + 5, "段")).collect();
        assert!(validate_chapters(&eleven).is_err());
        let ten: Vec<Chapter> = (0..10).map(|i| chapter(i * 10, i * 10 + 5, "段")).collect();
        assert!(validate_chapters(&ten).is_ok());

        // 空数组报错（有章节配置却解析出 0 段说明配置有误）
        assert!(validate_chapters(&[]).is_err());
    }
}
