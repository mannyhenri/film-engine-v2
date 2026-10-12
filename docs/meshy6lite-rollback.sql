-- Run only after stopping V2 safely; this database is shared with the legacy app.
-- Preserve any configuration edited after migration. Backups remain for inspection.
BEGIN IMMEDIATE;
UPDATE film_projects
SET provider_config = (SELECT original_config FROM film_meshy6lite_config_backup WHERE project_id = film_projects.id)
WHERE EXISTS (SELECT 1 FROM film_meshy6lite_config_backup b
              WHERE b.project_id = film_projects.id AND b.migrated_config = film_projects.provider_config);
COMMIT;
