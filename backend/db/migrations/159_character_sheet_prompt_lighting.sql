-- Two lightings for each character-sheet prompt, to compare before choosing (the user's ruling, 2026-10-24):
-- 'main' / 'sheet' keep the original soft, matte light; 'main_natural' / 'sheet_natural' are written from the
-- natural-light copies of the same guides (prompt-guides/*-natural-light.md). SQLite cannot widen a CHECK, so
-- the table is rebuilt with every row kept.
CREATE TABLE film_character_sheet_prompts_v2 (
    character_id TEXT NOT NULL REFERENCES film_characters(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('main', 'sheet', 'main_natural', 'sheet_natural')),
    status TEXT NOT NULL DEFAULT 'writing' CHECK (status IN ('writing', 'done', 'failed', 'interrupted')),
    prompt TEXT,
    model TEXT,
    error TEXT,
    studio_portrait_id TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    PRIMARY KEY (character_id, kind)
);
INSERT INTO film_character_sheet_prompts_v2 SELECT character_id, kind, status, prompt, model, error, studio_portrait_id, started_at, finished_at FROM film_character_sheet_prompts;
DROP TABLE film_character_sheet_prompts;
ALTER TABLE film_character_sheet_prompts_v2 RENAME TO film_character_sheet_prompts;
