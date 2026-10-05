-- GRD-4667: qualifying the first stereo adapter, worker and playback profile. A candidate stays
-- disabled until it has evidence, measurements, a target-device viewing and a person's decision.
CREATE TABLE film_stereo_candidates (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'disabled' CHECK(status IN ('disabled','enabled')),
 evidence_json TEXT, decision TEXT CHECK(decision IN ('build','reuse','no_go')), decision_json TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO film_stereo_candidates (id, kind, label, status) VALUES
 ('flat_sbs', 'fallback', 'Flat SBS: both eyes the same picture (zero disparity). Safe, no depth.', 'enabled'),
 ('stereocrafter', 'depth_warp_inpaint', 'StereoCrafter (depth estimation, warp and inpainting): a candidate, not yet qualified.', 'disabled');
CREATE TABLE film_stereo_reels (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, clips_json TEXT NOT NULL, coverage_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_stereo_benchmarks (
 id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES film_stereo_candidates(id), reel_id TEXT NOT NULL REFERENCES film_stereo_reels(id),
 worker_json TEXT, results_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE film_stereo_profiles (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, spec_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
