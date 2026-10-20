//! 投稿页内嵌字幕（最多两个槽位，默认语言代码 zh / en）。
//!
//! 与网页端一致的两步（`index.a0b85e27.js` 的 `uploadSubtitle` 与
//! `checkUploadSubtitle`）：
//!
//! 1. 把 .srt 文件 multipart POST 到 `api.bilibili.com/x/upload/web/image`，
//!    form 字段 `bucket=subtitle`、文件字段名 `file`、`csrf`、
//!    `content_type=application/x-subrip`；成功后取 `data.location`，
//!    并把协议头从 `https:` 换成 `http:`。
//! 2. multipart POST `api.bilibili.com/x/v2/dm/subtitle/draft/preSave`：
//!    字段 `oid`=分P cid、`type=1`、`files`=`[{"url","lan","subtitle_id"}]`
//!    的 JSON 字符串、`aid`（新投稿为 0）、`csrf`。
//!
//! 成功后 `videos[0].pre_subtitle = true`。字幕是非必需品：任何一步失败都只
//! 告警跳过，不阻断投稿（与封面不同）。设置对象里的 `subtitle: {open, lan}`
//! 是历史占位字段（open 恒 0），与本链路无关。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::error::{Kind, Result};
use crate::uploader::bilibili::{BiliBili, ResponseData, Studio};

/// 字幕槽位语言代码：中文
pub const SUBTITLE_LAN_ZH: &str = "zh";
/// 字幕槽位语言代码：英文
pub const SUBTITLE_LAN_EN: &str = "en";
/// 上传字幕时 form 里的 bucket 固定值
pub const SUBTITLE_BUCKET: &str = "subtitle";
/// 上传字幕的 multipart 文件字段名
pub const SUBTITLE_FILE_FIELD: &str = "file";
/// 字幕文件的 MIME 类型，网页端固定 application/x-subrip
pub const SUBTITLE_CONTENT_TYPE: &str = "application/x-subrip";
/// draft/preSave 的 type 字段固定值
const PRE_SAVE_TYPE: u8 = 1;

/// 一条待上传的字幕：配置里的本地 .srt 文件路径与语言代码
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubtitleFile {
    /// 本地 .srt 文件路径
    pub path: PathBuf,
    /// 字幕语言代码（zh / en）
    pub lan: String,
}

impl SubtitleFile {
    pub fn new(path: impl Into<PathBuf>, lan: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            lan: lan.into(),
        }
    }
}

/// draft/preSave 的 `files` 数组元素。`subtitle_id` 是已有字幕的 id，新上传为 0。
#[derive(PartialEq, Eq, Serialize, Deserialize, Debug, Clone)]
pub struct PreSubtitle {
    /// 上传接口返回的 location
    pub url: String,
    /// 字幕语言代码
    pub lan: String,
    /// 已有字幕的 id；新上传为 0
    pub subtitle_id: u64,
}

/// draft/preSave 的 multipart 文本字段（字段名与顺序与网页端 FormData 一致）
pub(crate) fn pre_save_fields(
    oid: u64,
    aid: u64,
    files: &[PreSubtitle],
    csrf: &str,
) -> Vec<(String, String)> {
    let files = serde_json::to_string(files).unwrap_or_else(|_| "[]".into());
    vec![
        ("oid".into(), oid.to_string()),
        ("type".into(), PRE_SAVE_TYPE.to_string()),
        ("files".into(), files),
        ("aid".into(), aid.to_string()),
        ("csrf".into(), csrf.into()),
    ]
}

/// upload/web/image 的 multipart 文本字段（文件字段 `file` 由调用方单独附上）
pub(crate) fn upload_fields(csrf: &str) -> Vec<(String, String)> {
    vec![
        ("bucket".into(), SUBTITLE_BUCKET.into()),
        ("csrf".into(), csrf.into()),
        ("content_type".into(), SUBTITLE_CONTENT_TYPE.into()),
    ]
}

/// 模板/命令行的字幕路径配置（zh、en 各一个可选路径）转成待上传列表
pub fn subtitle_files_from_paths(
    subtitle_zh: Option<&str>,
    subtitle_en: Option<&str>,
) -> Vec<SubtitleFile> {
    [
        (subtitle_zh, SUBTITLE_LAN_ZH),
        (subtitle_en, SUBTITLE_LAN_EN),
    ]
    .into_iter()
    .filter_map(|(path, lan)| {
        let path = path.map(str::trim).filter(|path| !path.is_empty())?;
        Some(SubtitleFile::new(path, lan))
    })
    .collect()
}

impl BiliBili {
    /// 上传一个字幕文件，返回素材 location（网页端会把 https: 换成 http: 后再用）
    pub async fn upload_subtitle_file(&self, path: &Path) -> Result<String> {
        let bytes = std::fs::read(path)
            .map_err(|e| Kind::Custom(format!("读取字幕文件 {} 失败: {e}", path.display())))?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| Kind::Custom(format!("字幕文件路径不合法: {}", path.display())))?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(file_name.to_owned())
            .mime_str(SUBTITLE_CONTENT_TYPE)?;
        let mut form = reqwest::multipart::Form::new();
        for (name, value) in upload_fields(self.get_csrf()?) {
            form = form.text(name, value);
        }
        form = form.part(SUBTITLE_FILE_FIELD, part);
        let response = self
            .client
            .post("https://api.bilibili.com/x/upload/web/image")
            .multipart(form)
            .send()
            .await?;
        let res: ResponseData = if !response.status().is_success() {
            return Err(Kind::Custom(response.text().await?));
        } else {
            response.json().await?
        };
        if res.code != 0 {
            return Err(Kind::Custom(format!("{res}")));
        }
        let location = res
            .data
            .as_ref()
            .and_then(|data| data.get("location"))
            .and_then(|value| value.as_str())
            .ok_or_else(|| Kind::Custom(format!("字幕上传响应缺少 location: {res}")))?;
        Ok(location.replacen("https:", "http:", 1))
    }

    /// 把已上传的字幕登记到投稿页草稿（draft/preSave）。`oid` 是分P cid，
    /// 新投稿 `aid` 填 0。
    pub async fn pre_save_subtitles(
        &self,
        oid: u64,
        aid: u64,
        files: &[PreSubtitle],
    ) -> Result<()> {
        let mut form = reqwest::multipart::Form::new();
        for (name, value) in pre_save_fields(oid, aid, files, self.get_csrf()?) {
            form = form.text(name, value);
        }
        let response = self
            .client
            .post("https://api.bilibili.com/x/v2/dm/subtitle/draft/preSave")
            .multipart(form)
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

    /// 网页投稿前置动作：上传 `studio.subtitle_files` 并登记草稿，全部成功后置
    /// `videos[0].pre_subtitle = true`。字幕非必需：文件不存在、不是 .srt、
    /// 分P缺 cid 或接口失败都只告警跳过，不阻断投稿。
    pub async fn attach_subtitles(&self, studio: &mut Studio) {
        if studio.subtitle_files.is_empty() {
            return;
        }
        let Some(cid) = studio.videos.first().and_then(|video| video.cid) else {
            tracing::warn!(
                count = studio.subtitle_files.len(),
                "分P缺少 cid（preupload biz_id），跳过字幕上传"
            );
            return;
        };
        let mut uploaded = Vec::new();
        for file in &studio.subtitle_files {
            let extension = file
                .path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.to_ascii_lowercase());
            if extension.as_deref() != Some("srt") {
                tracing::warn!(
                    path = %file.path.display(),
                    lan = %file.lan,
                    "字幕文件必须是 .srt，跳过该字幕"
                );
                continue;
            }
            match self.upload_subtitle_file(&file.path).await {
                Ok(url) => uploaded.push(PreSubtitle {
                    url,
                    lan: file.lan.clone(),
                    subtitle_id: 0,
                }),
                Err(error) => tracing::warn!(
                    path = %file.path.display(),
                    lan = %file.lan,
                    error = %error,
                    "字幕上传失败，跳过该字幕"
                ),
            }
        }
        if uploaded.is_empty() {
            return;
        }
        if let Err(error) = self.pre_save_subtitles(cid, 0, &uploaded).await {
            tracing::warn!(error = %error, "字幕草稿登记（draft/preSave）失败，跳过字幕");
            return;
        }
        studio.videos[0].pre_subtitle = Some(true);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PreSubtitle, SUBTITLE_BUCKET, SUBTITLE_CONTENT_TYPE, SUBTITLE_FILE_FIELD, pre_save_fields,
        subtitle_files_from_paths, upload_fields,
    };

    /// upload/web/image 的文本字段与网页端 FormData 一致：
    /// bucket=subtitle、csrf、content_type=application/x-subrip，文件字段名是 file
    #[test]
    fn upload_fields_match_web_form() {
        assert_eq!(
            upload_fields("jct"),
            vec![
                ("bucket".into(), SUBTITLE_BUCKET.into()),
                ("csrf".into(), "jct".into()),
                ("content_type".into(), SUBTITLE_CONTENT_TYPE.into()),
            ]
        );
        assert_eq!(SUBTITLE_BUCKET, "subtitle");
        assert_eq!(SUBTITLE_FILE_FIELD, "file");
        assert_eq!(SUBTITLE_CONTENT_TYPE, "application/x-subrip");
    }

    /// draft/preSave 的字段名与取值：oid=分P cid、type=1、
    /// files 是 [{"url","lan","subtitle_id"}] 的 JSON 字符串、aid=0（新投稿）、csrf
    #[test]
    fn pre_save_fields_match_web_form() {
        let files = vec![PreSubtitle {
            url: "http://i0.hdslb.com/bfs/subtitle/a.srt".into(),
            lan: "zh".into(),
            subtitle_id: 0,
        }];
        assert_eq!(
            pre_save_fields(8123, 0, &files, "jct"),
            vec![
                ("oid".into(), "8123".into()),
                ("type".into(), "1".into()),
                (
                    "files".into(),
                    r#"[{"url":"http://i0.hdslb.com/bfs/subtitle/a.srt","lan":"zh","subtitle_id":0}]"#
                        .into()
                ),
                ("aid".into(), "0".into()),
                ("csrf".into(), "jct".into()),
            ]
        );
    }

    /// zh/en 两个槽位的路径配置：空白视作未配置，顺序恒 zh 在前
    #[test]
    fn subtitle_paths_config_to_files() {
        let files = subtitle_files_from_paths(Some(" a.srt "), Some("b.srt"));
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].lan, "zh");
        assert_eq!(files[0].path, std::path::Path::new("a.srt"));
        assert_eq!(files[1].lan, "en");

        assert!(subtitle_files_from_paths(None, Some("")).is_empty());
        assert!(subtitle_files_from_paths(Some("  "), None).is_empty());
    }
}
