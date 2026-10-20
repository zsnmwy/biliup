-- 投稿模板同步商业推广/花火/联合投稿/章节/字幕/合集配置（与主库 uploadstreamers 同形）
ALTER TABLE fleet_templates ADD COLUMN porder TEXT;
ALTER TABLE fleet_templates ADD COLUMN adorder_id INTEGER;
ALTER TABLE fleet_templates ADD COLUMN adorder_type INTEGER;
ALTER TABLE fleet_templates ADD COLUMN staffs TEXT;
ALTER TABLE fleet_templates ADD COLUMN chapters TEXT;
ALTER TABLE fleet_templates ADD COLUMN subtitle_zh TEXT;
ALTER TABLE fleet_templates ADD COLUMN subtitle_en TEXT;
ALTER TABLE fleet_templates ADD COLUMN section_id INTEGER;
