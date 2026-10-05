-- GRD-4666: pinned reference packages, board and video drift review, shot copies.
-- A package is immutable: its passes, hashes, camera, intent and the versions it was rendered from.
CREATE TABLE film_reference_packages (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 shot_id TEXT NOT NULL REFERENCES film_shots(id) ON DELETE CASCADE, version INTEGER NOT NULL,
 world_version_id TEXT, world_fingerprint TEXT, blocking_fingerprint TEXT NOT NULL,
 camera_json TEXT NOT NULL, intent_json TEXT NOT NULL, passes_json TEXT NOT NULL, renderer TEXT,
 package_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(shot_id, version)
);
CREATE TRIGGER film_reference_packages_immutable BEFORE UPDATE ON film_reference_packages
 BEGIN SELECT RAISE(ABORT, 'reference packages are immutable; build a new package'); END;
-- A person's approval of a package, or of a weakened reference mode for one provider.
CREATE TABLE film_reference_approvals (
 id TEXT PRIMARY KEY, package_id TEXT NOT NULL REFERENCES film_reference_packages(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('package','weakened')), provider_id TEXT, fingerprint TEXT NOT NULL,
 approved_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE film_previs_blocking ADD COLUMN pinned_package_id TEXT;
CREATE TABLE film_board_reviews (
 id TEXT PRIMARY KEY, package_id TEXT NOT NULL REFERENCES film_reference_packages(id) ON DELETE CASCADE,
 shot_id TEXT NOT NULL, board_asset_id TEXT NOT NULL, comparison_json TEXT NOT NULL, comparison_fingerprint TEXT NOT NULL,
 disposition TEXT CHECK(disposition IN ('accept','accept_with_deviations','redo','reject')), deviations_json TEXT,
 decided_by TEXT, decided_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_video_pins (
 id TEXT PRIMARY KEY, shot_id TEXT NOT NULL, review_id TEXT NOT NULL REFERENCES film_board_reviews(id) ON DELETE CASCADE,
 package_id TEXT NOT NULL, refs_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_motion_reviews (
 id TEXT PRIMARY KEY, video_pin_id TEXT NOT NULL REFERENCES film_video_pins(id) ON DELETE CASCADE, video_asset_id TEXT,
 findings_json TEXT NOT NULL, carried_json TEXT NOT NULL, reviewer TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE film_shots ADD COLUMN copied_from_shot_id TEXT;
ALTER TABLE film_shots ADD COLUMN copied_at TEXT;
