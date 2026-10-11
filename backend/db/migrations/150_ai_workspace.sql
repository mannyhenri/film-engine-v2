-- App-owned provider-neutral conversations and auditable, reversible writing tasks.
CREATE TABLE film_ai_conversations (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 feature TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX film_ai_conversations_scope ON film_ai_conversations(project_id,feature);
CREATE TABLE film_ai_tasks (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES film_ai_conversations(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'preview', request TEXT NOT NULL,
 payload TEXT NOT NULL, fingerprint TEXT NOT NULL, source TEXT NOT NULL, result TEXT DEFAULT '',
 error TEXT DEFAULT '', provider_session TEXT DEFAULT '', events TEXT NOT NULL DEFAULT '[]',
 apply_state TEXT NOT NULL DEFAULT 'none', before_script_id TEXT, after_script_id TEXT,
 after_hash TEXT, application TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);
CREATE INDEX film_ai_tasks_conversation ON film_ai_tasks(conversation_id,created_at);
