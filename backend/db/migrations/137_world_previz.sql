-- GRD-4665: an editable Blender world and an approved camera before a locked board.
-- A world version records its editable source (.blend copy and hash, linked assets, units, axes,
-- renderer and add-on versions, a hash of every transform), the import report, and its approval.
ALTER TABLE film_world_versions ADD COLUMN editable_source_json TEXT;
ALTER TABLE film_world_versions ADD COLUMN import_report_json TEXT;
ALTER TABLE film_world_versions ADD COLUMN approval_fingerprint TEXT;
ALTER TABLE film_world_versions ADD COLUMN approved_at TEXT;
ALTER TABLE film_world_versions ADD COLUMN approved_by TEXT;
-- A shot's range and markers, and whether it is in the locked workflow (board only after approvals).
ALTER TABLE film_previs_blocking ADD COLUMN range_json TEXT;
ALTER TABLE film_previs_blocking ADD COLUMN previz_workflow TEXT NOT NULL DEFAULT 'free' CHECK(previz_workflow IN ('free','locked'));
