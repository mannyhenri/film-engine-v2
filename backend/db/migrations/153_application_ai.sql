-- Application conversations have their own ownership domain. Project foreign
-- keys and all existing writer tables remain unchanged.
CREATE TABLE film_application_ai_conversations (
 id TEXT PRIMARY KEY,
 scope TEXT NOT NULL DEFAULT 'application' CHECK(scope='application'),
 application_id TEXT NOT NULL DEFAULT 'film-engine-v2' CHECK(application_id='film-engine-v2'),
 title TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE film_application_ai_tasks (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES film_application_ai_conversations(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('claude','codex')),
 status TEXT NOT NULL DEFAULT 'preview', request TEXT NOT NULL, payload TEXT NOT NULL,
 fingerprint TEXT NOT NULL, source TEXT NOT NULL, result TEXT NOT NULL DEFAULT '',
 result_fingerprint TEXT NOT NULL DEFAULT '', provider_session TEXT NOT NULL DEFAULT '',
 error TEXT NOT NULL DEFAULT '', events TEXT NOT NULL DEFAULT '[]',
 apply_state TEXT NOT NULL DEFAULT 'none', application TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);
CREATE INDEX film_application_ai_tasks_conversation ON film_application_ai_tasks(conversation_id,created_at);
CREATE TABLE film_application_ai_uploads (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES film_application_ai_conversations(id) ON DELETE CASCADE,
 filename TEXT NOT NULL, format TEXT NOT NULL, original BLOB NOT NULL,
 original_sha TEXT NOT NULL, bytes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
 progress INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL DEFAULT '', text_sha TEXT NOT NULL DEFAULT '',
 provenance TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
 approved_sha TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
