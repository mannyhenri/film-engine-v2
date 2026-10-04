-- GRD-4660: writing profiles take the shared v2 lifecycle (draft, ready_for_review, approved, stale,
-- blocked, failed) and writes take idempotency keys. SQLite cannot widen a CHECK in place, so the
-- profiles table is rebuilt. Feedback references it, so its rows are set aside and restored after.
CREATE TABLE _writing_profiles_new (
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE, version INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','ready_for_review','approved','stale','blocked','failed')),
 guidance TEXT NOT NULL, sample_ids TEXT NOT NULL, direct_rules TEXT NOT NULL DEFAULT '[]', evidence_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, approved_at TEXT,
 PRIMARY KEY(project_id,version)
);
INSERT INTO _writing_profiles_new (project_id,version,state,guidance,sample_ids,direct_rules,evidence_hash,created_at,approved_at)
 SELECT project_id,version,state,guidance,sample_ids,direct_rules,evidence_hash,created_at,approved_at FROM film_writing_profiles;
CREATE TABLE _writing_feedback_copy AS SELECT * FROM film_writing_feedback;
DROP TABLE film_writing_feedback;
DROP TABLE film_writing_profiles;
ALTER TABLE _writing_profiles_new RENAME TO film_writing_profiles;
CREATE TABLE film_writing_feedback (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 profile_version INTEGER NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(project_id,profile_version) REFERENCES film_writing_profiles(project_id,version)
);
INSERT INTO film_writing_feedback (id,project_id,profile_version,text,created_at)
 SELECT id,project_id,profile_version,text,created_at FROM _writing_feedback_copy;
DROP TABLE _writing_feedback_copy;
-- One row per idempotency key: a retry with the same key and payload replays, another payload is refused.
CREATE TABLE film_writing_requests (
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE, idempotency_key TEXT NOT NULL,
 operation TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(project_id,idempotency_key)
);
