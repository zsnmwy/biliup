-- 投稿模板同步个性化卡片配置（与主库 uploadstreamers.personal_cards 同形）
ALTER TABLE fleet_templates ADD COLUMN personal_cards TEXT;
