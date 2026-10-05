/**
 * Qualifying the first stereo adapter, worker and playback profile (GRD-4667).
 *
 * This is a feasibility gate, not a stereo pipeline. A candidate adapter (StereoCrafter is the first)
 * stays DISABLED until it has:
 *  - evidence: pinned code commit, weights with hashes, a dependency lock, and licence terms checked
 *    separately for code, weights and dependencies (commercial use stated by a named person), the
 *    worker's hardware and software, and the allowed use;
 *  - a benchmark on a hard-case reel of owned footage that covers every case in HARD_CASES, with each
 *    diagnostic either measured on the worker or explicitly "not measured", never estimated here;
 *  - a viewing on a named first playback profile (device, player, version, test date, comfort criteria);
 *  - a person's decision: build, reuse or no-go. No-go keeps it disabled with a named fallback.
 *
 * The fallback that is always available is flat_sbs: both eyes the same picture, packed into the
 * profile's layout and labelled. It has no depth, so it adds no disparity and no comfort risk.
 * Nothing here promises a VRAM figure, a speed or universal comfort.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HARD_CASES = Object.freeze(['camera_movement', 'occlusion', 'cut', 'dissolve', 'glass', 'hair', 'mist']);
const DIAGNOSTICS = Object.freeze(['throughput_fps', 'peak_memory_mb', 'cost_per_minute', 'temporal_depth_stability', 'occlusion_fill', 'edge_artifacts']);
const EVIDENCE_FIELDS = Object.freeze(['code', 'weights', 'dependencies', 'terms', 'worker', 'allowed_use']);
const PACKINGS = Object.freeze({
 full_sbs:{ label:'Full SBS', perEye:s => ({ width:s.width, height:s.height }), packed:s => ({ width:s.width * 2, height:s.height }) },
 half_sbs:{ label:'Half SBS', perEye:s => ({ width:Math.round(s.width / 2), height:s.height }), packed:s => ({ width:s.width, height:s.height }) },
});
const EYE_ORDERS = Object.freeze(['left_right', 'right_left']);
const TRANSITION_POLICIES = Object.freeze(['convergence_ramp', 'cut_to_flat', 'per_eye_dissolve']);
const CROP_POLICIES = Object.freeze(['pad', 'refuse']);          // never a silent crop
const CODECS = Object.freeze({ h264:'libx264', hevc:'libx265' });
const CAPTIONS = Object.freeze(['per_eye_burn', 'sidecar', 'none']);
const DECISIONS = Object.freeze(['build', 'reuse', 'no_go']);
const TERM_COMPONENTS = Object.freeze(['code', 'weights', 'dependencies']);

function fail(status, message, code) { const e = new Error(message); e.status = status; e.code = code; throw e; }
const parse = (j, f) => { try { return j ? JSON.parse(j) : f; } catch { return f; } };
const text = (v, name, max = 500) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : fail(400, `${name} is required (text, at most ${max} characters)`, 'invalid_request'));

function candidate(db, id) {
 const c = db.prepare('SELECT * FROM film_stereo_candidates WHERE id = ?').get(id);
 if (!c) fail(404, `No stereo candidate ${id}`, 'NOT_FOUND');
 return { id:c.id, kind:c.kind, label:c.label, status:c.status, evidence:parse(c.evidence_json, null), decision:c.decision, ...(parse(c.decision_json, {}) || {}) };
}
const candidates = db => db.prepare('SELECT id FROM film_stereo_candidates ORDER BY rowid').all().map(r => candidate(db, r.id));
const enabledAdapters = db => candidates(db).filter(c => c.status === 'enabled');

function recordEvidence(db, id, e) {
 const c = candidate(db, id);
 if (c.kind === 'fallback') fail(400, 'The fallback needs no qualification', 'invalid_request');
 const ev = e || {};
 for (const f of EVIDENCE_FIELDS) if (ev[f] === undefined || ev[f] === null) fail(400, `evidence.${f} is required`, 'invalid_request');
 if (!/^https?:\/\//.test(String(ev.code.repo || ''))) fail(400, 'evidence.code.repo must be the repository URL', 'invalid_request');
 if (!/^[0-9a-f]{40}$/.test(String(ev.code.commit || ''))) fail(400, 'evidence.code.commit must be the full pinned commit hash, not a branch', 'invalid_request');
 if (!Array.isArray(ev.weights) || !ev.weights.length || ev.weights.some(w => !w || !w.name || !/^[0-9a-f]{64}$/.test(String(w.sha256 || '')) || !w.source)) fail(400, 'evidence.weights: each { name, sha256, source }', 'invalid_request');
 if (!/^[0-9a-f]{64}$/.test(String(ev.dependencies.lockfile_sha256 || ''))) fail(400, 'evidence.dependencies.lockfile_sha256: the hash of the pinned lock file', 'invalid_request');
 if (!Array.isArray(ev.terms)) fail(400, 'evidence.terms must list the licence of each component', 'invalid_request');
 for (const comp of TERM_COMPONENTS) {
  const t = ev.terms.find(x => x && x.component === comp);
  if (!t) fail(400, `evidence.terms: the ${comp} licence must be checked separately`, 'invalid_request');
  if (!['allowed', 'not_allowed', 'unclear'].includes(t.commercial_use) || !t.verified_by || !/^\d{4}-\d{2}-\d{2}$/.test(String(t.verified_at || '')) || !t.source_url) {
   fail(400, `evidence.terms (${comp}): commercial_use (allowed, not_allowed or unclear), verified_by, verified_at (YYYY-MM-DD) and source_url`, 'invalid_request');
  }
 }
 if (!ev.worker.hardware || !ev.worker.software || !ev.worker.hardware.gpu || !ev.worker.software.os) fail(400, 'evidence.worker: { hardware: { gpu, … }, software: { os, … } }', 'invalid_request');
 text(ev.allowed_use, 'evidence.allowed_use', 1000);
 db.prepare(`UPDATE film_stereo_candidates SET evidence_json = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(ev), id);
 return candidate(db, id);
}

async function mediaInfo(file) {
 // The shared inspector (ffmpeg -nostdin -i, stdin ignored): the one probe every media path uses.
 const m = require('./ffmpeg').inspectMedia(file, { timeoutMs:60000 });
 if (!m || !m.ok || !m.width || !m.height) return null;
 return { width:m.width, height:m.height, fps:m.fps || 24, duration_s:m.durationSeconds || null };
}

async function defineReel(db, body) {
 const b = body || {}, name = text(b.name, 'name', 200);
 if (!Array.isArray(b.clips) || !b.clips.length) fail(400, 'clips are required', 'invalid_request');
 const clips = [];
 for (const c of b.clips) {
  if (!c || typeof c.id !== 'string' || !c.id) fail(400, 'every clip needs an id', 'invalid_request');
  if (c.rights_confirmed !== true || typeof c.owner !== 'string' || !c.owner.trim()) fail(400, `clip ${c.id}: only owned footage, with its owner and rights confirmed`, 'invalid_request');
  if (typeof c.path !== 'string' || !path.isAbsolute(c.path) || !fs.existsSync(c.path)) fail(400, `clip ${c.id}: no file at ${c.path}`, 'invalid_request');
  if (!Array.isArray(c.categories) || !c.categories.length || c.categories.some(x => !HARD_CASES.includes(x))) fail(400, `clip ${c.id}: categories from ${HARD_CASES.join(', ')}`, 'invalid_request');
  clips.push({ id:c.id, path:c.path, owner:c.owner.trim(), categories:c.categories, sha256:crypto.createHash('sha256').update(fs.readFileSync(c.path)).digest('hex'), media:await mediaInfo(c.path) });
 }
 const coverage = Object.fromEntries(HARD_CASES.map(h => [h, clips.filter(c => c.categories.includes(h)).length]));
 const missing = HARD_CASES.filter(h => !coverage[h]);
 if (missing.length) fail(400, `The reel must include every hard case; missing: ${missing.join(', ')}`, 'invalid_request');
 const id = crypto.randomUUID();
 db.prepare('INSERT INTO film_stereo_reels (id, name, clips_json, coverage_json) VALUES (?, ?, ?, ?)').run(id, name, JSON.stringify(clips), JSON.stringify(coverage));
 return { id, name, clips, coverage };
}
const reel = (db, id) => { const r = db.prepare('SELECT * FROM film_stereo_reels WHERE id = ?').get(id); if (!r) fail(404, 'Reel not found', 'NOT_FOUND'); return { id:r.id, name:r.name, clips:parse(r.clips_json, []), coverage:parse(r.coverage_json, {}) }; };

const notMeasured = reason => ({ value:null, reason:reason || 'not measured by this adapter' });
/** Frame-to-frame depth stability, 1 = perfectly stable: 1 minus the mean relative change between consecutive depth frames. */
function depthStability(series) {
 if (!Array.isArray(series) || series.length < 2) return null;
 let change = 0, n = 0;
 for (let i = 1; i < series.length; i++) {
  const a = series[i - 1], b = series[i];
  for (let k = 0; k < Math.min(a.length, b.length); k++) { const m = (Math.abs(a[k]) + Math.abs(b[k])) / 2 || 1; change += Math.abs(b[k] - a[k]) / m; n++; }
 }
 return n ? Math.round(Math.max(0, 1 - change / n) * 1000) / 1000 : null;
}
async function runBenchmark(db, id, reelId, opts = {}) {
 const c = candidate(db, id), r = reel(db, reelId);
 if (c.kind !== 'fallback' && !c.evidence) fail(409, 'Record the candidate\'s evidence (code, weights, terms, worker) before benchmarking', 'NO_EVIDENCE');
 const runAdapter = opts.runAdapter || (c.id === 'flat_sbs' ? null : null);
 if (!runAdapter) fail(409, `${c.id} is not installed on this machine; run the benchmark on the worker and pass its runner`, 'NOT_INSTALLED');
 const results = [];
 for (const clip of r.clips) {
  const out = await runAdapter(clip, c) || {};
  const fps = clip.media && clip.media.fps ? clip.media.fps : 24;
  const num = (v, reason) => (typeof v === 'number' && Number.isFinite(v) ? v : notMeasured(reason));
  const stability = depthStability(out.depth_series);
  const clipMinutes = out.frames ? out.frames / fps / 60 : null;
  const diagnostics = {
   throughput_fps:out.frames && out.seconds ? Math.round(out.frames / out.seconds * 1000) / 1000 : notMeasured('frames and seconds not reported'),
   peak_memory_mb:num(out.peak_memory_mb, 'peak memory not reported by the worker'),
   cost_per_minute:opts.cost_per_hour_usd && out.seconds && clipMinutes ? Math.round(opts.cost_per_hour_usd * out.seconds / 3600 / clipMinutes * 1000) / 1000 : notMeasured('no worker cost rate given'),
   temporal_depth_stability:stability === null ? notMeasured('the adapter returned no per-frame depth') : stability,
   occlusion_fill:num(out.occlusion_fill), edge_artifacts:num(out.edge_artifacts),
  };
  results.push({ clip_id:clip.id, categories:clip.categories, diagnostics, review_notes:[] });
 }
 const bid = crypto.randomUUID();
 db.prepare('INSERT INTO film_stereo_benchmarks (id, candidate_id, reel_id, worker_json, results_json) VALUES (?, ?, ?, ?, ?)').run(bid, c.id, r.id, JSON.stringify(c.evidence ? c.evidence.worker : { hardware:{ note:'this machine' } }), JSON.stringify(results));
 return benchmark(db, bid);
}
function benchmark(db, id) {
 const b = db.prepare('SELECT * FROM film_stereo_benchmarks WHERE id = ?').get(id);
 if (!b) fail(404, 'Benchmark not found', 'NOT_FOUND');
 return { id:b.id, candidate_id:b.candidate_id, reel_id:b.reel_id, worker:parse(b.worker_json, null), results:parse(b.results_json, []), created_at:b.created_at };
}
function addReviewNote(db, id, body) {
 const b = benchmark(db, id), n = body || {};
 const r = b.results.find(x => x.clip_id === n.clip_id);
 if (!r) fail(404, 'No such clip in this benchmark', 'NOT_FOUND');
 r.review_notes.push({ note:text(n.note, 'note', 2000), reviewer:text(n.reviewer, 'reviewer', 100), at:new Date().toISOString() });
 db.prepare('UPDATE film_stereo_benchmarks SET results_json = ? WHERE id = ?').run(JSON.stringify(b.results), id);
 return benchmark(db, id);
}

function defineProfile(db, body) {
 const b = body || {};
 const spec = { name:text(b.name, 'name', 200), device:text(b.device, 'device', 200), player:text(b.player, 'player', 200), player_version:text(b.player_version, 'player_version', 50) };
 if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.test_date || ''))) fail(400, 'test_date: the day it was viewed, YYYY-MM-DD', 'invalid_request');
 if (!PACKINGS[b.packing]) fail(400, `packing must be one of ${Object.keys(PACKINGS).join(', ')}`, 'invalid_request');
 if (!EYE_ORDERS.includes(b.eye_order)) fail(400, `eye_order must be one of ${EYE_ORDERS.join(', ')}`, 'invalid_request');
 if (!b.source || !Number.isInteger(b.source.width) || !Number.isInteger(b.source.height) || b.source.width < 2 || b.source.height < 2) fail(400, 'source: { width, height } of the 2D master', 'invalid_request');
 if (!CODECS[b.codec]) fail(400, `codec must be one of ${Object.keys(CODECS).join(', ')}`, 'invalid_request');
 const color = text(b.color, 'color', 40), audio = text(b.audio, 'audio', 40);
 if (!CAPTIONS.includes(b.captions)) fail(400, `captions must be one of ${CAPTIONS.join(', ')}`, 'invalid_request');
 if (!TRANSITION_POLICIES.includes(b.transition_policy)) fail(400, `transition_policy (dissolves and cuts) must be one of ${TRANSITION_POLICIES.join(', ')}`, 'invalid_request');
 if (!CROP_POLICIES.includes(b.crop_policy)) fail(400, `crop_policy must be one of ${CROP_POLICIES.join(', ')}: a picture is never cropped silently`, 'invalid_request');
 const cc = b.comfort_criteria;
 if (!cc || !['max_positive_disparity_pct', 'max_negative_disparity_pct', 'max_disparity_change_per_s', 'review_viewing_minutes'].every(k => typeof cc[k] === 'number' && cc[k] >= 0)) {
  fail(400, 'comfort_criteria: max_positive_disparity_pct, max_negative_disparity_pct, max_disparity_change_per_s, review_viewing_minutes (the criteria the review will use; not a comfort promise)', 'invalid_request');
 }
 const p = PACKINGS[b.packing];
 Object.assign(spec, { test_date:b.test_date, packing:b.packing, eye_order:b.eye_order, source:{ width:b.source.width, height:b.source.height }, per_eye:p.perEye(b.source), packed:p.packed(b.source),
  label:`${p.label}, ${b.eye_order === 'left_right' ? 'left eye on the left' : 'right eye on the left'}`, codec:b.codec, color, audio, captions:b.captions,
  transition_policy:b.transition_policy, crop_policy:b.crop_policy, comfort_criteria:cc });
 const id = crypto.randomUUID();
 db.prepare('INSERT INTO film_stereo_profiles (id, name, spec_json) VALUES (?, ?, ?)').run(id, spec.name, JSON.stringify(spec));
 return { id, ...spec };
}
function profile(db, id) { const r = db.prepare('SELECT * FROM film_stereo_profiles WHERE id = ?').get(id); if (!r) fail(404, 'Profile not found', 'NOT_FOUND'); return { id:r.id, ...parse(r.spec_json, {}) }; }

/** The fallback: the same picture for both eyes, packed and labelled per the profile. Never a silent crop. */
async function encodeFlatSbs(db, body) {
 const b = body || {}, p = profile(db, b.profile_id);
 const info = await mediaInfo(b.input);
 if (!info) fail(400, 'The input cannot be read as video', 'BAD_INPUT');
 const adjustments = [];
 const srcAspect = info.width / info.height, wantAspect = p.source.width / p.source.height;
 if (Math.abs(srcAspect - wantAspect) / wantAspect > 0.005) {
  if (p.crop_policy === 'refuse') fail(409, `The input is ${info.width}x${info.height}; fitting it to ${p.source.width}x${p.source.height} would crop or distort it, and this profile refuses`, 'WOULD_CROP');
  adjustments.push(srcAspect > wantAspect ? `letterboxed: ${info.width}x${info.height} fitted inside ${p.source.width}x${p.source.height} with bars top and bottom`
   : `pillarboxed: ${info.width}x${info.height} fitted inside ${p.source.width}x${p.source.height} with bars left and right`);
 } else if (info.width !== p.source.width || info.height !== p.source.height) adjustments.push(`scaled from ${info.width}x${info.height} to ${p.source.width}x${p.source.height}`);
 const S = p.source, E = p.per_eye;
 const filter = `[0:v]scale=${S.width}:${S.height}:force_original_aspect_ratio=decrease,pad=${S.width}:${S.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,scale=${E.width}:${E.height},setsar=1,split[l][r];[l][r]hstack=inputs=2[v]`;
 const args = ['-nostdin', '-loglevel', 'error', '-y', '-i', b.input, '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', '-c:v', CODECS[p.codec], '-pix_fmt', 'yuv420p',
  ...(p.audio === 'passthrough' ? ['-c:a', 'copy'] : ['-c:a', 'aac']), '-movflags', '+faststart+use_metadata_tags', '-metadata', `stereo_mode=${p.eye_order}`, '-metadata', `stereo_packing=${p.packing}`, b.output];
 const ff = require('./ffmpeg').resolveFfmpeg();
 const r = await require('./ffmpeg').probe(ff.bin, args.slice(1), { timeoutMs:30 * 60 * 1000 });
 if (r.code !== 0) fail(500, `ffmpeg could not pack the SBS file: ${r.stderr.slice(-300)}`, 'ENCODE_FAILED');
 return { output:b.output, packing:p.packing, label:p.label, packed:p.packed, per_eye:p.per_eye, adjustments };
}

function decide(db, id, body) {
 const b = body || {}, c = candidate(db, id);
 if (!DECISIONS.includes(b.decision)) fail(400, `decision must be one of ${DECISIONS.join(', ')}`, 'invalid_request');
 if (!Array.isArray(b.benchmark_ids) || !b.benchmark_ids.length) fail(400, 'A decision cites at least one benchmark of this candidate', 'invalid_request');
 for (const bid of b.benchmark_ids) if (benchmark(db, bid).candidate_id !== id) fail(400, `benchmark ${bid} is not of ${id}`, 'invalid_request');
 if (!b.viewed_on_profile_id) fail(400, 'A decision needs a viewing on the target device profile (viewed_on_profile_id)', 'invalid_request');
 const prof = profile(db, b.viewed_on_profile_id);
 const notes = text(b.notes, 'notes', 4000);
 if (b.human_confirmed !== true || typeof b.by !== 'string' || !b.by.trim()) fail(400, 'A named person makes the decision', 'invalid_request');
 if (b.decision !== 'no_go') {
  const bad = (c.evidence && c.evidence.terms || []).filter(t => t.commercial_use !== 'allowed').map(t => `${t.component} (${t.commercial_use})`);
  if (!c.evidence) fail(409, 'No evidence recorded', 'NO_EVIDENCE');
  if (bad.length) fail(409, `The commercial-use terms are not confirmed for: ${bad.join(', ')}. It stays disabled.`, 'TERMS_NOT_CLEARED');
 } else {
  const fallback = b.fallback;
  if (!fallback || !(fallback === 'none' || enabledAdapters(db).some(a => a.id === fallback && a.id !== id))) fail(400, 'A no-go names its fallback (an enabled adapter such as flat_sbs, or none) and the next decision', 'invalid_request');
  if (fallback === 'none' && !b.next_decision) fail(400, 'With no fallback, name the next decision', 'invalid_request');
 }
 const record = { decided_by:b.by.trim(), decided_at:new Date().toISOString(), notes, benchmark_ids:b.benchmark_ids, viewed_on:{ profile_id:prof.id, device:prof.device, player:prof.player, test_date:prof.test_date },
  fallback:b.decision === 'no_go' ? b.fallback : null, next_decision:b.next_decision || null };
 db.prepare(`UPDATE film_stereo_candidates SET status = ?, decision = ?, decision_json = ?, updated_at = datetime('now') WHERE id = ?`)
  .run(b.decision === 'no_go' ? 'disabled' : 'enabled', b.decision, JSON.stringify(record), id);
 return candidate(db, id);
}

module.exports = { HARD_CASES, DIAGNOSTICS, EVIDENCE_FIELDS, PACKINGS, EYE_ORDERS, TRANSITION_POLICIES, CROP_POLICIES, DECISIONS, candidate, candidates, enabledAdapters,
 recordEvidence, defineReel, runBenchmark, benchmark, addReviewNote, defineProfile, profile, encodeFlatSbs, decide, depthStability };
