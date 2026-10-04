-- GRD-4664: the blinded style pilot. A pilot is a versioned set of held-out briefs, the success
-- criterion the author agreed before it ran, blinded conditioned/unconditioned pairs, the author's
-- reviews (and, apart, any AI judgement, which never counts), and two separate author decisions:
-- the release gate and the activation.
CREATE TABLE film_style_pilots (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE, version INTEGER NOT NULL,
 provider TEXT NOT NULL, model TEXT NOT NULL, prompt_template_version TEXT NOT NULL,
 profile_version INTEGER NOT NULL, style_global_version INTEGER NOT NULL, style_override_version INTEGER NOT NULL,
 samples TEXT NOT NULL, criterion TEXT, criterion_rule TEXT, criterion_agreed_by TEXT, criterion_agreed_at TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','criterion_agreed','awaiting_review','failed')),
 provider_model TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, version)
);
CREATE TABLE film_style_pilot_briefs (
 id TEXT PRIMARY KEY, pilot_id TEXT NOT NULL REFERENCES film_style_pilots(id) ON DELETE CASCADE, position INTEGER NOT NULL,
 brief TEXT NOT NULL, sample_type TEXT NOT NULL, target_sample_id TEXT NOT NULL
);
CREATE TABLE film_style_pilot_pairs (
 id TEXT PRIMARY KEY, pilot_id TEXT NOT NULL REFERENCES film_style_pilots(id) ON DELETE CASCADE, brief_id TEXT NOT NULL,
 conditioned_text TEXT NOT NULL, unconditioned_text TEXT NOT NULL, left_is TEXT NOT NULL CHECK(left_is IN ('conditioned','unconditioned')),
 reuse_flags TEXT NOT NULL DEFAULT '[]', choice TEXT CHECK(choice IN ('left','right','tie')), rubric TEXT, reviewer TEXT, reviewed_at TEXT
);
CREATE TABLE film_style_pilot_ai_judgements (
 id TEXT PRIMARY KEY, pair_id TEXT NOT NULL REFERENCES film_style_pilot_pairs(id) ON DELETE CASCADE,
 judge TEXT NOT NULL, choice TEXT, scores TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_style_pilot_decisions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 pilot_id TEXT NOT NULL REFERENCES film_style_pilots(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('release_gate','activation')), decision TEXT NOT NULL CHECK(decision IN ('release','hold','activate')),
 profile_version INTEGER, reviewer TEXT NOT NULL, report_fingerprint TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
