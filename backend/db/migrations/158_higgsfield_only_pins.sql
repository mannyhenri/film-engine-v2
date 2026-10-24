-- Higgsfield only (the user's ruling, 2026-10-24): every project that pinned another vendor for
-- pictures, footage, upscales or meshes is moved to the signed-in Higgsfield plan. Runway was
-- removed outright, so a pin naming it would no longer resolve at all. Sound, dialogue and
-- ambience (ElevenLabs), worlds, lip-sync and writing are left exactly as each project set them.
--
-- A model pinned beside a moved provider is another vendor's id (nano-banana-pro, gen4.5,
-- meshy-6-lite) that Higgsfield does not carry, so it is cleared and the Higgsfield default runs.
--
-- Every project's previous configuration is kept first, so the move can be undone by hand.
CREATE TABLE IF NOT EXISTS film_provider_config_before_higgsfield (
    project_id TEXT PRIMARY KEY,
    provider_config TEXT,
    saved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO film_provider_config_before_higgsfield (project_id, provider_config)
    SELECT id, provider_config FROM film_projects;

UPDATE film_projects SET provider_config = json_remove(json_set(provider_config, '$.image', 'higgsfield-mcp'), '$.image_model')
 WHERE json_valid(provider_config) AND json_extract(provider_config, '$.image') IN ('muapi', 'google', 'meshy', 'openai', 'runway', 'higgsfield');

UPDATE film_projects SET provider_config = json_remove(json_set(provider_config, '$.video', 'higgsfield-mcp'), '$.video_model')
 WHERE json_valid(provider_config) AND json_extract(provider_config, '$.video') IN ('seedance', 'runway', 'higgsfield');

UPDATE film_projects SET provider_config = json_remove(json_set(provider_config, '$.post', 'higgsfield-mcp'), '$.post_model')
 WHERE json_valid(provider_config) AND json_extract(provider_config, '$.post') IN ('seedance', 'topaz', 'magnific', 'runway');

UPDATE film_projects SET provider_config = json_remove(json_set(provider_config, '$.model3d', 'higgsfield-mcp'), '$.model3d_model')
 WHERE json_valid(provider_config) AND json_extract(provider_config, '$.model3d') = 'meshy';

-- An account default naming a vendor that is no longer the default (or no longer exists) is cleared,
-- so the built-in Higgsfield default answers.
DELETE FROM film_app_settings
 WHERE key IN ('default_image_provider', 'default_video_provider')
   AND value IN ('muapi', 'google', 'meshy', 'openai', 'runway', 'seedance', 'higgsfield');

-- A model pinned with no provider beside it now runs on Higgsfield too. Higgsfield's model ids use
-- underscores (nano_banana_pro, seedance_2_5); another vendor's (meshy-6-lite, gen4.5) does not
-- exist there, so it is cleared rather than handed to Higgsfield to refuse.
UPDATE film_projects SET provider_config = json_remove(provider_config, '$.image_model')
 WHERE json_valid(provider_config) AND COALESCE(json_extract(provider_config, '$.image'), 'higgsfield-mcp') = 'higgsfield-mcp'
   AND json_extract(provider_config, '$.image_model') GLOB '*[-.]*';
UPDATE film_projects SET provider_config = json_remove(provider_config, '$.video_model')
 WHERE json_valid(provider_config) AND COALESCE(json_extract(provider_config, '$.video'), 'higgsfield-mcp') = 'higgsfield-mcp'
   AND json_extract(provider_config, '$.video_model') GLOB '*[-.]*';
UPDATE film_projects SET provider_config = json_remove(provider_config, '$.model3d_model')
 WHERE json_valid(provider_config) AND COALESCE(json_extract(provider_config, '$.model3d'), 'higgsfield-mcp') = 'higgsfield-mcp'
   AND json_extract(provider_config, '$.model3d_model') GLOB '*[-.]*';
UPDATE film_projects SET provider_config = json_remove(provider_config, '$.post_model')
 WHERE json_valid(provider_config) AND COALESCE(json_extract(provider_config, '$.post'), 'higgsfield-mcp') = 'higgsfield-mcp'
   AND json_extract(provider_config, '$.post_model') GLOB '*[-.]*';
