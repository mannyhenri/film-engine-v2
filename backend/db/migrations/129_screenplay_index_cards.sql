-- Review metadata is independent of screenplay and production scene rows.
CREATE TABLE film_screenplay_cards (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 heading TEXT NOT NULL,
 text_hash TEXT NOT NULL,
 summary TEXT NOT NULL DEFAULT '',
 summary_hash TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE film_screenplay_card_snapshots (
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 script_id TEXT NOT NULL REFERENCES film_scripts(id) ON DELETE CASCADE,
 script_hash TEXT NOT NULL,
 mapping TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(project_id, script_id, script_hash)
);
CREATE INDEX film_screenplay_cards_project ON film_screenplay_cards(project_id);
