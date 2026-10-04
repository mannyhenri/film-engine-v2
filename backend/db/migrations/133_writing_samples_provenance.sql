-- GRD-4661: every writing sample says whose it is, on what rights, what it is, where it came from
-- (a source document and the span within it), which projects may use it, and whether it may be used
-- at all (included, held out for evaluation, deleted to a non-prose tombstone).
ALTER TABLE film_writing_samples ADD COLUMN owner TEXT NOT NULL DEFAULT '';
ALTER TABLE film_writing_samples ADD COLUMN rights_basis TEXT NOT NULL DEFAULT 'unconfirmed'
 CHECK(rights_basis IN ('unconfirmed','own_writing','licensed','permission_granted'));
ALTER TABLE film_writing_samples ADD COLUMN rights_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(rights_confirmed IN (0,1));
ALTER TABLE film_writing_samples ADD COLUMN sample_type TEXT NOT NULL DEFAULT 'pasted_writing'
 CHECK(sample_type IN ('guided_exercise','pasted_writing','screenplay_import','portable_import'));
ALTER TABLE film_writing_samples ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE film_writing_samples ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE film_writing_samples ADD COLUMN included INTEGER NOT NULL DEFAULT 1 CHECK(included IN (0,1));
ALTER TABLE film_writing_samples ADD COLUMN retention TEXT NOT NULL DEFAULT 'active' CHECK(retention IN ('active','held_out','deleted'));
ALTER TABLE film_writing_samples ADD COLUMN source_document_id TEXT;
ALTER TABLE film_writing_samples ADD COLUMN span_start INTEGER;
ALTER TABLE film_writing_samples ADD COLUMN span_end INTEGER;
ALTER TABLE film_writing_samples ADD COLUMN deleted_at TEXT;
-- A sample already confirmed as the author's own unaided writing is, by that confirmation, theirs to use.
UPDATE film_writing_samples SET rights_basis='own_writing', rights_confirmed=1 WHERE confirmed_original=1 AND authorship='original_human';
UPDATE film_writing_samples SET sample_type='guided_exercise' WHERE exercise != '';
-- An imported script, kept on this machine. Its text is cleared on deletion; the hash stays as provenance.
CREATE TABLE film_writing_source_documents (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 title TEXT NOT NULL, owner TEXT NOT NULL, rights_basis TEXT NOT NULL CHECK(rights_basis IN ('own_writing','licensed','permission_granted')),
 language TEXT NOT NULL DEFAULT 'en', source_hash TEXT NOT NULL, text TEXT NOT NULL, local_only INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
);
-- Other projects a sample's owner has allowed to use it. Revoking removes the row.
CREATE TABLE film_writing_sample_access (
 sample_id TEXT NOT NULL REFERENCES film_writing_samples(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(sample_id, project_id)
);
