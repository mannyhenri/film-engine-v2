-- GRD-4663: drafting with approved style context. A request holds the brief, the exact context it
-- was built from (scene text, style text, sample references) and the payload the author approved;
-- each draft alternative carries its DraftProvenance. Nothing here writes the screenplay: accepting
-- selected text writes a new script revision through the scene edit path.
CREATE TABLE film_style_draft_requests (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 scene_id TEXT NOT NULL, brief TEXT NOT NULL, constraints TEXT NOT NULL DEFAULT '[]',
 provider TEXT NOT NULL, model TEXT, language TEXT NOT NULL, owner TEXT, sample_types TEXT NOT NULL DEFAULT '[]', token_budget INTEGER NOT NULL,
 script_version INTEGER NOT NULL, scene_text TEXT NOT NULL, scene_text_fingerprint TEXT NOT NULL, style_text TEXT NOT NULL,
 profile_version INTEGER, style_global_version INTEGER, style_override_version INTEGER,
 samples TEXT NOT NULL, conflicts TEXT NOT NULL DEFAULT '[]', prompt_template_version TEXT NOT NULL,
 payload TEXT NOT NULL, payload_fingerprint TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'previewed' CHECK(status IN ('previewed','approved','generated','failed')),
 error TEXT, approved_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_style_drafts (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES film_style_draft_requests(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE, alt_index INTEGER NOT NULL,
 text TEXT NOT NULL, fingerprint TEXT NOT NULL, provenance TEXT NOT NULL,
 review_state TEXT NOT NULL DEFAULT 'pending' CHECK(review_state IN ('pending','accepted','rejected')),
 accepted_hunks TEXT, accepted_script_version INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
