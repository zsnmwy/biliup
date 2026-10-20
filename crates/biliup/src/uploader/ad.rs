//! 商业推广（porder）、花火订单（adorder）与联合投稿参与者（staffs）。
//!
//! `porder` / `adorder_id` / `adorder_type` / `staffs` 都是 add/v3 请求体的
//! 一等字段（serde 自然带上），仅 web 投稿通道支持。花火带货「投稿后再添加
//! 商品」形态只带订单 id 与类型即可，不需要 goodsInfos。
//!
//! 行业与推广形式的合法 id 来自登录后 `GET member.bilibili.com/x/vupre/web/archive/pre`
//! 响应的 `industry_list` / `showtype_list`；品牌搜索
//! `GET member.bilibili.com/x/web/ad/brand/list?brand_name=`，
//! 联合投稿参与者搜索 `GET member.bilibili.com/x/web/staff/user/search?kw=`。

use crate::uploader::bilibili::{Porder, Staff, Studio};

/// 花火订单类型：商单
pub const AD_ORDER_TYPE_COMMERCIAL: i32 = 0;
/// 花火订单类型：任务
pub const AD_ORDER_TYPE_TASK: i32 = 1;
/// 花火订单类型：带货
pub const AD_ORDER_TYPE_GOODS: i32 = 2;
/// 花火订单类型：广告合伙人
pub const AD_ORDER_TYPE_PARTNER: i32 = 3;
/// 花火订单类型：招募
pub const AD_ORDER_TYPE_RECRUIT: i32 = 4;
/// 花火订单类型：CPVV
pub const AD_ORDER_TYPE_CPVV: i32 = 5;
/// 商业推广在 add/v3 里的 adorder_type 固定值
pub const PORDER_AD_ORDER_TYPE: i32 = 9;

/// 解析投稿模板里的 `porder` 配置（JSON 对象字符串）。
/// `None` 或空白视为未启用；解析失败返回可读错误。
/// `flow_id` 网页端恒为 1，配置里可省略，解析后统一补成 1。
pub fn parse_porder(config: Option<&str>) -> std::result::Result<Option<Porder>, String> {
    let Some(config) = config.map(str::trim).filter(|config| !config.is_empty()) else {
        return Ok(None);
    };
    let mut porder: Porder = serde_json::from_str(config)
        .map_err(|error| format!("porder 不是合法的商业推广配置: {error}"))?;
    porder.flow_id = 1;
    Ok(Some(porder))
}

/// 解析投稿模板里的 `staffs` 配置（JSON 数组字符串）。
/// `None` 或空白视为没有参与者；解析失败返回可读错误。
pub fn parse_staffs(config: Option<&str>) -> std::result::Result<Vec<Staff>, String> {
    let Some(config) = config.map(str::trim).filter(|config| !config.is_empty()) else {
        return Ok(Vec::new());
    };
    let staffs: Vec<Staff> = serde_json::from_str(config)
        .map_err(|error| format!("staffs 不是合法的参与者数组: {error}"))?;
    Ok(staffs)
}

/// 提交前的互斥校验（与网页端 `checkArchive` 的硬约束一致）。
/// 返回 `Err` 时应在投稿前中止，尽早失败。
pub fn validate_publish_extras(studio: &Studio) -> std::result::Result<(), String> {
    if let Some(porder) = &studio.porder {
        if studio.adorder_id.is_some() {
            return Err("商业推广（porder）与花火订单（adorder_id）互斥，只能配置其中一个".into());
        }
        if studio.charging_pay != 0 {
            return Err("商业推广（porder）与充电专属（charging_pay）互斥".into());
        }
        if studio.is_only_self == Some(1) {
            return Err("商业推广（porder）与仅自己可见（is_only_self）互斥".into());
        }
        if porder.industry_id == 0 {
            return Err(
                "商业推广（porder）缺少 industry_id，行业 id 取自 archive/pre 的 industry_list"
                    .into(),
            );
        }
    }
    if studio.adorder_id.is_some() {
        if studio.copyright == 2 {
            return Err("转载稿件不支持花火订单（adorder_id），请改回自制或去掉花火配置".into());
        }
        let Some(adorder_type) = studio.adorder_type else {
            return Err(
                "配置了 adorder_id 就必须同时配置 adorder_type（0 商单/1 任务/2 带货/3 广告合伙人/4 招募/5 CPVV）"
                    .into(),
            );
        };
        if !(AD_ORDER_TYPE_COMMERCIAL..=AD_ORDER_TYPE_CPVV).contains(&adorder_type) {
            return Err(format!(
                "adorder_type 必须在 0-5 之间（0 商单/1 任务/2 带货/3 广告合伙人/4 招募/5 CPVV），实际 {adorder_type}"
            ));
        }
    } else if studio.adorder_type.is_some() && studio.porder.is_none() {
        return Err(
            "单独配置了 adorder_type：它必须与 adorder_id 一起提供，或由 porder 自动置 9".into(),
        );
    }
    Ok(())
}

/// 网页端行为：配置了商业推广时 `adorder_type` 固定置 9（后端补齐）。
pub fn apply_porder_adorder_type(studio: &mut Studio) {
    if studio.porder.is_some() && studio.adorder_id.is_none() {
        studio.adorder_type = Some(PORDER_AD_ORDER_TYPE);
    }
}

/// 非 web 投稿通道不支持商业/花火/联合投稿字段：告警后从请求体里去掉，
/// 避免 app/BCut 接口收到未知字段。
pub fn strip_web_only_extras(studio: &mut Studio) {
    if studio.porder.is_some() {
        tracing::warn!("商业推广（porder）仅 web 投稿通道支持，本次投稿已跳过");
        studio.porder = None;
    }
    if studio.adorder_id.is_some() || studio.adorder_type.is_some() {
        tracing::warn!("花火订单（adorder_id/adorder_type）仅 web 投稿通道支持，本次投稿已跳过");
        studio.adorder_id = None;
        studio.adorder_type = None;
    }
    if studio.staffs.is_some() {
        tracing::warn!("联合投稿（staffs）仅 web 投稿通道支持，本次投稿已跳过");
        studio.staffs = None;
    }
    if !studio.chapters.is_empty() {
        tracing::warn!("章节（chapters）仅 web 投稿通道支持，本次投稿已跳过");
        studio.chapters.clear();
    }
    if !studio.subtitle_files.is_empty() {
        tracing::warn!("字幕（subtitle_zh/subtitle_en）仅 web 投稿通道支持，本次投稿已跳过");
        studio.subtitle_files.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_porder_adorder_type, parse_porder, parse_staffs, strip_web_only_extras,
        validate_publish_extras,
    };
    use crate::uploader::bilibili::{Porder, Staff, Studio};
    use crate::uploader::chapter::Chapter;
    use serde_json::json;

    fn studio() -> Studio {
        serde_json::from_value(json!({
            "copyright": 1,
            "source": "",
            "tid": 95,
            "cover": "",
            "title": "t",
            "desc": "",
            "dynamic": "",
            "tag": "",
            "dolby": 0,
            "lossless_music": 0,
            "no_reprint": 0,
            "charging_pay": 0,
            "up_selection_reply": false,
            "up_close_reply": false,
            "up_close_danmu": false
        }))
        .unwrap()
    }

    fn porder() -> Porder {
        Porder {
            flow_id: 1,
            industry_id: 8,
            official: 0,
            brand_name: Some("某品牌".into()),
            brand_id: None,
            brand_source: Some(2),
            show_type: Some("11".into()),
        }
    }

    /// porder 配置解析：flow_id 可省略并恒补成 1；空白视作未启用
    #[test]
    fn porder_config_parse_fills_flow_id() {
        let parsed = parse_porder(Some(r#"{"industry_id":8,"official":0,"brand_name":"某品牌","brand_source":2,"show_type":"11"}"#))
            .unwrap()
            .unwrap();
        assert_eq!(parsed, porder());

        assert!(parse_porder(None).unwrap().is_none());
        assert!(parse_porder(Some("")).unwrap().is_none());
        assert!(parse_porder(Some("not json")).is_err());
        assert!(parse_porder(Some("[]")).is_err(), "porder 必须是 JSON 对象");
    }

    /// staffs 配置解析：字段名只有 title 与 mid
    #[test]
    fn staffs_config_parse_keeps_title_and_mid_only() {
        let staffs =
            parse_staffs(Some(r#"[{"title":"剪辑","mid":42,"uname":"多余字段"}]"#)).unwrap();
        assert_eq!(
            staffs,
            vec![Staff {
                title: "剪辑".into(),
                mid: 42,
            }]
        );
        // 序列化时多余字段不会出现
        assert_eq!(
            serde_json::to_string(&staffs).unwrap(),
            r#"[{"title":"剪辑","mid":42}]"#
        );
        assert!(parse_staffs(None).unwrap().is_empty());
        assert!(parse_staffs(Some("  ")).unwrap().is_empty());
        assert!(parse_staffs(Some("not json")).is_err());
        // 元素缺 mid 要报可读错误
        assert!(parse_staffs(Some(r#"[{"title":"剪辑"}]"#)).is_err());
    }

    /// 互斥校验：porder×adorder、porder×充电、porder×仅自己可见、adorder×转载
    #[test]
    fn publish_extras_mutual_exclusion() {
        let mut studio = studio();
        assert!(validate_publish_extras(&studio).is_ok());

        studio.porder = Some(porder());
        assert!(validate_publish_extras(&studio).is_ok());

        // porder × adorder_id
        studio.adorder_id = Some(1);
        studio.adorder_type = Some(2);
        assert!(validate_publish_extras(&studio).is_err());
        studio.adorder_id = None;
        studio.adorder_type = None;

        // porder × charging_pay
        studio.charging_pay = 1;
        assert!(validate_publish_extras(&studio).is_err());
        studio.charging_pay = 0;

        // porder × is_only_self
        studio.is_only_self = Some(1);
        assert!(validate_publish_extras(&studio).is_err());
        studio.is_only_self = None;

        // adorder × 转载
        studio.porder = None;
        studio.adorder_id = Some(1);
        studio.adorder_type = Some(2);
        studio.copyright = 2;
        assert!(validate_publish_extras(&studio).is_err());
        studio.copyright = 1;
        assert!(validate_publish_extras(&studio).is_ok());

        // adorder_id 必须带 adorder_type，类型必须在 0-5
        studio.adorder_type = None;
        assert!(validate_publish_extras(&studio).is_err());
        studio.adorder_type = Some(6);
        assert!(validate_publish_extras(&studio).is_err());
        studio.adorder_type = Some(5);
        assert!(validate_publish_extras(&studio).is_ok());
    }

    /// porder 自动把 adorder_type 置 9；与 adorder_id 同填时不覆盖
    #[test]
    fn porder_sets_adorder_type_nine() {
        let mut studio = studio();
        studio.porder = Some(porder());
        apply_porder_adorder_type(&mut studio);
        assert_eq!(studio.adorder_type, Some(9));

        // 带 adorder_type 出厂值也不会被覆盖成其它值——恒 9
        studio.adorder_type = Some(2);
        apply_porder_adorder_type(&mut studio);
        assert_eq!(studio.adorder_type, Some(9));
    }

    /// 非 web 通道剥离 web-only 字段；普通字段不受影响
    #[test]
    fn strip_web_only_extras_clears_configured_fields() {
        let mut studio = studio();
        studio.porder = Some(porder());
        studio.adorder_type = Some(9);
        studio.staffs = Some(vec![Staff {
            title: "剪辑".into(),
            mid: 42,
        }]);
        studio.chapters = vec![Chapter {
            from: 0,
            to: 60,
            content: "开场".into(),
        }];
        strip_web_only_extras(&mut studio);
        assert!(studio.porder.is_none());
        assert!(studio.adorder_type.is_none());
        assert!(studio.staffs.is_none());
        assert!(studio.chapters.is_empty());
        assert_eq!(studio.tid, 95, "普通字段不受影响");
    }
}
