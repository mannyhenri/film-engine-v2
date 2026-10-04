-- Shared data: changes explicit Meshy 5 selections only, on next V2 startup.
-- Original and replacement JSON are retained for conditional rollback.
CREATE TABLE film_meshy6lite_config_backup (
    project_id TEXT PRIMARY KEY,
    original_config TEXT NOT NULL,
    migrated_config TEXT NOT NULL,
    backed_up_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO film_meshy6lite_config_backup (project_id, original_config, migrated_config)
SELECT id, provider_config, json_set(provider_config, '$.model3d_model', 'meshy-6-lite')
FROM film_projects
WHERE json_valid(provider_config)
  AND json_extract(CASE WHEN json_valid(provider_config) THEN provider_config ELSE '{}' END, '$.model3d_model') = 'meshy-5'
  AND (json_extract(CASE WHEN json_valid(provider_config) THEN provider_config ELSE '{}' END, '$.model3d') IS NULL
       OR json_extract(CASE WHEN json_valid(provider_config) THEN provider_config ELSE '{}' END, '$.model3d') = 'meshy');
UPDATE film_projects
SET provider_config = (SELECT migrated_config FROM film_meshy6lite_config_backup WHERE project_id = film_projects.id)
WHERE id IN (SELECT project_id FROM film_meshy6lite_config_backup);
