-- CHARACTER SHEET PROMPTS: the last main-picture and character-sheet prompt ChatGPT wrote for each character, and
-- whether one is being written now. Kept here, not in the page, so a prompt is never lost: leaving the sheet, coming
-- back, or restarting the app (a prompt still being written then is marked interrupted).
CREATE TABLE film_character_sheet_prompts (
    character_id TEXT NOT NULL REFERENCES film_characters(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('main', 'sheet')),
    status TEXT NOT NULL DEFAULT 'writing' CHECK (status IN ('writing', 'done', 'failed', 'interrupted')),
    prompt TEXT,
    model TEXT,
    error TEXT,
    studio_portrait_id TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    PRIMARY KEY (character_id, kind)
);
