-- GRD-4670: release gates and retained evidence. Every record is tied to the exact version set it was
-- tested against (fingerprint of build, model or adapter, fixture manifest and device profile), so a
-- gate never counts evidence or an approval from another version.
CREATE TABLE film_release_evidence (
 id TEXT PRIMARY KEY, track TEXT NOT NULL, at_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('automated','human','screenshot')),
 result TEXT NOT NULL CHECK(result IN ('pass','fail')),
 versions_json TEXT NOT NULL, fingerprint TEXT NOT NULL, report TEXT NOT NULL,
 reviewer TEXT, verdict_json TEXT, requalify_reason TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_film_release_evidence_gate ON film_release_evidence(track, at_id, fingerprint);
CREATE TABLE film_release_artifacts (
 id TEXT PRIMARY KEY, track TEXT NOT NULL, kind TEXT NOT NULL, fingerprint TEXT NOT NULL, ref TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_releases (
 id TEXT PRIMARY KEY, track TEXT NOT NULL, fingerprint TEXT NOT NULL, versions_json TEXT NOT NULL,
 released_by TEXT NOT NULL, report_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
