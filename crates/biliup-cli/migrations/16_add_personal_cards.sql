-- 投稿模板的个性化卡片配置（personal_cards JSON 数组字符串），仅 web 投稿通道生效
ALTER TABLE uploadstreamers ADD COLUMN personal_cards TEXT;
