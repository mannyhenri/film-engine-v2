-- GRD-4662: evidence-backed style traits. The author's global StyleProfileVersion and each project's
-- ProjectStyleOverride are immutable versions: a change, a rejection or a rollback writes a new row
-- whose parent is the one it replaces. Learning (corrections, pairwise choices) only ever proposes.
CREATE TABLE film_style_profile_versions (
 version INTEGER PRIMARY KEY, parent_version INTEGER, traits TEXT NOT NULL,
 approval_fingerprint TEXT NOT NULL, change_summary TEXT NOT NULL, actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_project_style_overrides (
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE, version INTEGER NOT NULL,
 parent_version INTEGER, global_version INTEGER, disabled TEXT NOT NULL DEFAULT '[]', added TEXT NOT NULL DEFAULT '[]',
 approval_fingerprint TEXT NOT NULL, change_summary TEXT NOT NULL, actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(project_id, version)
);
CREATE TRIGGER film_style_profile_versions_immutable BEFORE UPDATE ON film_style_profile_versions
 BEGIN SELECT RAISE(ABORT, 'style profile versions are immutable; write a new version'); END;
CREATE TRIGGER film_project_style_overrides_immutable BEFORE UPDATE ON film_project_style_overrides
 BEGIN SELECT RAISE(ABORT, 'project style overrides are immutable; write a new version'); END;
CREATE TABLE film_style_trait_proposals (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 origin TEXT NOT NULL CHECK(origin IN ('samples','explicit','correction','pairwise')),
 target TEXT NOT NULL CHECK(target IN ('global','project')), trait TEXT NOT NULL, fingerprint TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','modified','rejected')),
 replaces TEXT, decision_reason TEXT, decided_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_style_corrections (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 before_text TEXT NOT NULL, after_text TEXT NOT NULL, before_span TEXT, after_span TEXT, reason TEXT,
 scope TEXT NOT NULL CHECK(scope IN ('scene','project','global')), proposal_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_style_pairwise (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 dimension TEXT NOT NULL, option_a TEXT NOT NULL, option_b TEXT NOT NULL, first TEXT NOT NULL CHECK(first IN ('a','b')),
 choice TEXT CHECK(choice IN ('a','b','neither')), proposal_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, chosen_at TEXT
);
