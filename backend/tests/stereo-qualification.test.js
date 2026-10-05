/**
 * GRD-4667: qualifying the first stereo adapter, worker and playback profile. Set-based over the hard
 * cases, diagnostics, evidence fields, packings and decisions lib/stereo-qualification.js declares.
 * The flat-SBS fallback is encoded for real with ffmpeg; a depth adapter is injected, because none is
 * installed here and its numbers must come from the worker, never from this test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-stereo-'));
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
const sq = require('../lib/stereo-qualification');

const HAVE_FFMPEG = require('../lib/ffmpeg').resolveFfmpeg().available;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-stereo-clips-'));
function clip(name, w = 320, h = 180, secs = 1) {
    const out = path.join(DIR, name);
    if (HAVE_FFMPEG && !fs.existsSync(out)) execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=24:duration=${secs}`, '-pix_fmt', 'yuv420p', out], { stdio: ['ignore', 'pipe', 'pipe'] });
    else if (!fs.existsSync(out)) fs.writeFileSync(out, 'fake');
    return out;
}
const EVIDENCE = () => ({
    code: { repo: 'https://github.com/TencentARC/StereoCrafter', commit: 'a'.repeat(40) },
    weights: [{ name: 'depthcrafter', sha256: 'b'.repeat(64), source: 'https://huggingface.co/tencent/DepthCrafter' }],
    dependencies: { lockfile_sha256: 'c'.repeat(64), python: '3.10.14' },
    terms: [{ component: 'code', license: 'custom', commercial_use: 'allowed', verified_by: 'Manny', verified_at: '2026-10-04', source_url: 'https://example.invalid/license' },
        { component: 'weights', license: 'custom', commercial_use: 'allowed', verified_by: 'Manny', verified_at: '2026-10-04', source_url: 'https://example.invalid/weights-license' },
        { component: 'dependencies', license: 'mixed', commercial_use: 'allowed', verified_by: 'Manny', verified_at: '2026-10-04', source_url: 'https://example.invalid/deps' }],
    worker: { hardware: { gpu: 'NVIDIA L40S', vram_gb: 48, cpu: 'AMD EPYC 9354', ram_gb: 256 }, software: { os: 'Ubuntu 22.04', driver: '550.90', cuda: '12.4', python: '3.10.14' } },
    allowed_use: 'Internal look development and client review on owned footage only.',
});
const reelClips = () => sq.HARD_CASES.map((c, i) => ({ id: `c${i}`, path: clip(`${c}.mp4`), categories: [c], owner: 'Gridlight', rights_confirmed: true }));
const PROFILE = (over = {}) => ({ name: 'Quest 3 full SBS', device: 'Meta Quest 3', player: 'Skybox VR Player', player_version: '1.4.9', test_date: '2026-10-04',
    packing: 'full_sbs', eye_order: 'left_right', source: { width: 1920, height: 1080 }, codec: 'hevc', color: 'bt709', audio: 'passthrough', captions: 'per_eye_burn',
    transition_policy: 'convergence_ramp', crop_policy: 'pad',
    comfort_criteria: { max_positive_disparity_pct: 1.5, max_negative_disparity_pct: 2.5, max_disparity_change_per_s: 1, review_viewing_minutes: 20 }, ...over });

test('the declared registries', () => {
    assert.deepEqual([...sq.HARD_CASES], ['camera_movement', 'occlusion', 'cut', 'dissolve', 'glass', 'hair', 'mist']);
    assert.deepEqual([...sq.DIAGNOSTICS], ['throughput_fps', 'peak_memory_mb', 'cost_per_minute', 'temporal_depth_stability', 'occlusion_fill', 'edge_artifacts']);
    assert.deepEqual([...sq.EVIDENCE_FIELDS], ['code', 'weights', 'dependencies', 'terms', 'worker', 'allowed_use']);
    assert.deepEqual(Object.keys(sq.PACKINGS), ['full_sbs', 'half_sbs']);
    assert.deepEqual([...sq.DECISIONS], ['build', 'reuse', 'no_go']);
    assert.ok(!sq.CROP_POLICIES.includes('crop'), 'there is no silent crop policy');
});

test('candidates start disabled; the fallback is the only enabled adapter until a person decides', () => {
    const list = sq.candidates(db);
    assert.equal(list.find(c => c.id === 'stereocrafter').status, 'disabled');
    assert.equal(list.find(c => c.id === 'flat_sbs').status, 'enabled');
    assert.deepEqual(sq.enabledAdapters(db).map(a => a.id), ['flat_sbs']);
});

test('evidence must name code, weights, dependencies, terms, worker and allowed use, each completely', () => {
    sq.recordEvidence(db, 'stereocrafter', EVIDENCE());
    assert.equal(sq.candidate(db, 'stereocrafter').evidence.code.commit, 'a'.repeat(40));
    for (const field of sq.EVIDENCE_FIELDS) {
        const e = EVIDENCE(); delete e[field];
        assert.throws(() => sq.recordEvidence(db, 'stereocrafter', e), err => err.status === 400 && new RegExp(field).test(err.message), field);
    }
    const noWeightsTerms = EVIDENCE(); noWeightsTerms.terms = noWeightsTerms.terms.filter(t => t.component !== 'weights');
    assert.throws(() => sq.recordEvidence(db, 'stereocrafter', noWeightsTerms), /weights/, 'terms are verified separately for code, weights and dependencies');
    const shortCommit = EVIDENCE(); shortCommit.code.commit = 'main';
    assert.throws(() => sq.recordEvidence(db, 'stereocrafter', shortCommit), /commit/, 'pinned code, not a branch');
});

test('the hard-case reel must cover every case with owned footage', async () => {
    const reel = await sq.defineReel(db, { name: 'Stress reel 1', clips: reelClips() });
    for (const c of sq.HARD_CASES) assert.ok(reel.coverage[c] >= 1, c);
    for (const c of sq.HARD_CASES) {
        const clips = reelClips().filter(x => !x.categories.includes(c));
        await assert.rejects(sq.defineReel(db, { name: 'Missing ' + c, clips }), new RegExp(c), c);
    }
    await assert.rejects(sq.defineReel(db, { name: 'Unowned', clips: reelClips().map((x, i) => i ? x : { ...x, rights_confirmed: false }) }), /owned|rights/);
});

test('a benchmark measures what it can and says "not measured" for the rest; it never invents numbers', async () => {
    sq.recordEvidence(db, 'stereocrafter', EVIDENCE());
    const reel = await sq.defineReel(db, { name: 'Bench reel', clips: reelClips() });
    // A stand-in for the worker run: depth for each frame, and what the worker itself measured.
    const runAdapter = async (clipSpec) => ({ frames: 24, seconds: 12, peak_memory_mb: 21000, depth_series: [[1, 1, 1], [1.1, 1, 0.9], [1, 1, 1]], occlusion_fill: null, edge_artifacts: 0.04, cost: 0.31 });
    const b = await sq.runBenchmark(db, 'stereocrafter', reel.id, { runAdapter, cost_per_hour_usd: 1.8 });
    for (const r of b.results) {
        for (const d of sq.DIAGNOSTICS) assert.ok(d in r.diagnostics, `${r.clip_id}: ${d}`);
        assert.equal(r.diagnostics.throughput_fps, 2);
        assert.equal(r.diagnostics.peak_memory_mb, 21000);
        assert.ok(r.diagnostics.temporal_depth_stability > 0 && r.diagnostics.temporal_depth_stability <= 1);
        assert.deepEqual(r.diagnostics.occlusion_fill, { value: null, reason: 'not measured by this adapter' });
        assert.ok(Array.isArray(r.review_notes));
    }
    assert.equal(b.worker.hardware.gpu, 'NVIDIA L40S', 'the evidence names the worker it ran on');
    sq.addReviewNote(db, b.id, { clip_id: 'c5', note: 'hair edges shimmer at frame 14', reviewer: 'Manny' });
    assert.equal(sq.benchmark(db, b.id).results.find(r => r.clip_id === 'c5').review_notes[0].note, 'hair edges shimmer at frame 14');
    await assert.rejects(sq.runBenchmark(db, 'stereocrafter', reel.id, {}), e => e.code === 'NOT_INSTALLED', 'no depth adapter is installed here: refused, not faked');
});

test('the first profile names the device, player and test date, computes per-eye and packed sizes, and records comfort criteria', () => {
    const full = sq.defineProfile(db, PROFILE());
    assert.deepEqual([full.per_eye, full.packed], [{ width: 1920, height: 1080 }, { width: 3840, height: 1080 }]);
    const half = sq.defineProfile(db, PROFILE({ name: 'half', packing: 'half_sbs' }));
    assert.deepEqual([half.per_eye, half.packed], [{ width: 960, height: 1080 }, { width: 1920, height: 1080 }]);
    assert.equal(full.label, 'Full SBS, left eye on the left');
    for (const k of ['device', 'player', 'player_version', 'test_date', 'comfort_criteria', 'transition_policy', 'eye_order', 'codec', 'color', 'audio', 'captions']) {
        const p = PROFILE(); delete p[k];
        assert.throws(() => sq.defineProfile(db, p), e => e.status === 400, k);
    }
    assert.throws(() => sq.defineProfile(db, PROFILE({ crop_policy: 'crop' })), /crop/);
    assert.throws(() => sq.defineProfile(db, PROFILE({ test_date: 'next week' })), /test_date/);
});

test('the flat-SBS fallback really encodes both eyes into the packing, labelled, and pads rather than silently cropping', { skip: !HAVE_FFMPEG }, async () => {
    const full = sq.defineProfile(db, PROFILE({ name: 'tiny full', source: { width: 320, height: 180 }, codec: 'h264' }));
    const half = sq.defineProfile(db, PROFILE({ name: 'tiny half', packing: 'half_sbs', source: { width: 320, height: 180 }, codec: 'h264' }));
    for (const p of [full, half]) {
        const out = path.join(DIR, `${p.packing}.mp4`);
        const r = await sq.encodeFlatSbs(db, { input: clip('camera_movement.mp4'), profile_id: p.id, output: out });
        const v = require('../lib/ffmpeg').inspectMedia(out);
        assert.deepEqual([v.width, v.height], [p.packed.width, p.packed.height], p.packing);
        const tags = execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', out, '-f', 'ffmetadata', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
        assert.match(tags, /^stereo_mode=left_right$/m);
        assert.deepEqual(r.adjustments, [], 'nothing changed: the source matched the profile');
    }
    const wide = clip('wide.mp4', 400, 160);
    const padded = await sq.encodeFlatSbs(db, { input: wide, profile_id: full.id, output: path.join(DIR, 'padded.mp4') });
    assert.ok(padded.adjustments.some(a => /letterbox|pad/i.test(a)), 'the fit is said, not hidden');
    const refuse = sq.defineProfile(db, PROFILE({ name: 'refuse', source: { width: 320, height: 180 }, codec: 'h264', crop_policy: 'refuse' }));
    await assert.rejects(sq.encodeFlatSbs(db, { input: wide, profile_id: refuse.id, output: path.join(DIR, 'refused.mp4') }), e => e.code === 'WOULD_CROP');
});

test('a person decides build, reuse or no-go from measurements and target-device viewing; no-go keeps it disabled with a fallback', async () => {
    sq.recordEvidence(db, 'stereocrafter', EVIDENCE());
    const reel = await sq.defineReel(db, { name: 'Decision reel', clips: reelClips() });
    const b = await sq.runBenchmark(db, 'stereocrafter', reel.id, { runAdapter: async () => ({ frames: 24, seconds: 24, peak_memory_mb: 30000, depth_series: [[1], [1]], edge_artifacts: 0.2 }) });
    const prof = sq.defineProfile(db, PROFILE({ name: 'decision profile' }));
    assert.throws(() => sq.decide(db, 'stereocrafter', { decision: 'build', benchmark_ids: [], viewed_on_profile_id: prof.id, notes: 'x', by: 'Manny', human_confirmed: true }), /benchmark/);
    assert.throws(() => sq.decide(db, 'stereocrafter', { decision: 'build', benchmark_ids: [b.id], notes: 'x', by: 'Manny', human_confirmed: true }), /device|profile/);
    assert.throws(() => sq.decide(db, 'stereocrafter', { decision: 'build', benchmark_ids: [b.id], viewed_on_profile_id: prof.id, notes: 'x', by: 'Manny' }), e => e.status === 400);
    const unclear = EVIDENCE(); unclear.terms[1].commercial_use = 'unclear';
    sq.recordEvidence(db, 'stereocrafter', unclear);
    assert.throws(() => sq.decide(db, 'stereocrafter', { decision: 'build', benchmark_ids: [b.id], viewed_on_profile_id: prof.id, notes: 'x', by: 'Manny', human_confirmed: true }), /commercial/);
    assert.equal(sq.candidate(db, 'stereocrafter').status, 'disabled');
    assert.throws(() => sq.decide(db, 'stereocrafter', { decision: 'no_go', benchmark_ids: [b.id], viewed_on_profile_id: prof.id, notes: 'edges too visible on hair', by: 'Manny', human_confirmed: true }), /fallback/);
    const d = sq.decide(db, 'stereocrafter', { decision: 'no_go', benchmark_ids: [b.id], viewed_on_profile_id: prof.id, notes: 'edges too visible on hair', fallback: 'flat_sbs', next_decision: 'Re-test after the next DepthCrafter release', by: 'Manny', human_confirmed: true });
    assert.equal(d.status, 'disabled'); assert.equal(d.fallback, 'flat_sbs');
    sq.recordEvidence(db, 'stereocrafter', EVIDENCE());
    const go = sq.decide(db, 'stereocrafter', { decision: 'build', benchmark_ids: [b.id], viewed_on_profile_id: prof.id, notes: 'acceptable on the reel', by: 'Manny', human_confirmed: true });
    assert.equal(go.status, 'enabled');
    assert.ok(sq.enabledAdapters(db).some(a => a.id === 'stereocrafter'));
});

test('the qualification document records what is promised and what is not', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'stereo-qualification.md'), 'utf8');
    for (const c of sq.HARD_CASES) assert.ok(doc.includes(c), c);
    assert.match(doc, /no fixed VRAM|No fixed VRAM/); assert.match(doc, /comfort/i); assert.match(doc, /StereoCrafter/); assert.match(doc, /flat_sbs/);
});

test('over HTTP: a worker posts measurements; the decision is refused for an agent', async () => {
    const { handleStereo } = require('../routes/stereo');
    const call = (method, url, body, extra = {}) => new Promise(resolve => { let status; const res = { writeHead(c) { status = c; }, end(s) { resolve({ status, body: JSON.parse(s) }); } };
        handleStereo({ method, body, headers: {}, ...extra }, res, url.split('/').filter(Boolean)); });
    sq.recordEvidence(db, 'stereocrafter', EVIDENCE());
    const reel = (await call('POST', '/film/stereo/reels', { name: 'HTTP reel', clips: reelClips() })).body;
    const meas = Object.fromEntries(reel.clips.map(c => [c.id, { frames: 24, seconds: 8, peak_memory_mb: 18000 }]));
    const b = await call('POST', '/film/stereo/benchmarks', { candidate_id: 'stereocrafter', reel_id: reel.id, measurements: meas });
    assert.equal(b.status, 201, JSON.stringify(b.body)); assert.equal(b.body.results[0].diagnostics.throughput_fps, 3);
    const prof = (await call('POST', '/film/stereo/profiles', PROFILE({ name: 'http profile' }))).body;
    const agent = await call('POST', '/film/stereo/candidates/stereocrafter/decide', { decision: 'build', benchmark_ids: [b.body.id], viewed_on_profile_id: prof.id, notes: 'x', by: 'agent', human_confirmed: true }, { actor: 'agent' });
    assert.equal(agent.status, 403);
});
