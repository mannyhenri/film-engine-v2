-- Project-scoped human writing evidence. No screenplay or voice/audio rows are changed.
CREATE TABLE film_writing_samples (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 text TEXT NOT NULL, source TEXT NOT NULL, authorship TEXT NOT NULL
 CHECK(authorship IN ('original_human','human_edited','ai_assisted','unknown')),
 confirmed_original INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_original IN (0,1)),
 exercise TEXT NOT NULL DEFAULT '', source_meta TEXT NOT NULL DEFAULT '{}', fingerprint TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_writing_profiles (
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE, version INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved')),
 guidance TEXT NOT NULL, sample_ids TEXT NOT NULL, direct_rules TEXT NOT NULL DEFAULT '[]', evidence_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, approved_at TEXT,
 PRIMARY KEY(project_id,version)
);
CREATE TABLE film_writing_feedback (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 profile_version INTEGER NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(project_id,profile_version) REFERENCES film_writing_profiles(project_id,version)
);
-- Preserve imported history/proposals as data without activating them.
CREATE TABLE film_writing_imports (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 profile_json TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
