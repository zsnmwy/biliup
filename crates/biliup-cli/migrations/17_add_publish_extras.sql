-- 投稿模板新增商业推广/花火/联合投稿/章节/字幕/合集配置（仅 web 投稿通道生效）
ALTER TABLE uploadstreamers ADD COLUMN porder TEXT;
ALTER TABLE uploadstreamers ADD COLUMN adorder_id INTEGER;
ALTER TABLE uploadstreamers ADD COLUMN adorder_type INTEGER;
ALTER TABLE uploadstreamers ADD COLUMN staffs TEXT;
ALTER TABLE uploadstreamers ADD COLUMN chapters TEXT;
ALTER TABLE uploadstreamers ADD COLUMN subtitle_zh TEXT;
ALTER TABLE uploadstreamers ADD COLUMN subtitle_en TEXT;
ALTER TABLE uploadstreamers ADD COLUMN section_id INTEGER;
