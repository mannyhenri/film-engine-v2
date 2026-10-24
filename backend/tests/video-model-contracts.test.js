/**
 * What a video model costs, what references it will take, and which tier picks it.
 *
 * The registry described Seedance 2.0 under a name the whole discussion was
 * reading as 2.5, and Runway exposes BOTH as distinct models. It also had no
 * hailuo3 — which matters more than a missing id, because H3 charges 2 credits
 * per reference IMAGE, making a nine-reference package cost $0.18 and the whole
 * shot cheaper than Gen-4.5 with no references at all.
 *
 * Set-based over the model registry, because the failure is per model: billing
 * metadata present on eight of eleven reads as complete and silently prices the
 * other three at zero.
 *
 * The load-bearing invariant is at the bottom: Gen-4.5 keeps its keyframe-only
 * payload byte-for-byte. Sending plates to an image-to-video model was removed
 * deliberately — the keyframe was already generated FROM them — and adding a
 * reference contract must not quietly revert that.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const videoRef = () => require('../lib/video-reference');
const tiers = () => require('../lib/video-tiers');
const cost = () => require('../lib/video-cost');
// Higgsfield's app catalogue: the only video vendor since Runway was removed (2026-10-24).
const MODELS = require('../lib/higgsfield-app-catalog').MODELS;

/* ── A. every model carries Higgsfield's own credit quotes ───────────── */

test('the catalogue carries Seedance 2.5 and MiniMax H3', () => {
    for (const id of ['seedance_2_5', 'minimax_h3']) assert.ok(MODELS[id], `${id} is not in the Higgsfield app catalogue`);
    assert.strictEqual(MODELS.seedance_2_5.credits['resolution=1080p'].on.per_second, 16,
        'Seedance 2.5 was repriced — Higgsfield quoted 16 credits a second at 1080p');
});

test('every video model is quoted, and the estimator prices every one', () => {
    const ids = Object.keys(MODELS);
    assert.ok(ids.length >= 20, `expected the catalogue to have grown, got ${ids.length}`);
    for (const id of ids) {
        const e = cost().estimateVideoCost({ model: id, durationSeconds: 5 });
        assert.ok(Number.isFinite(e.credits) && e.credits > 0, `${id} priced at ${e.credits}`);
        assert.ok(Number.isFinite(e.usd) && e.usd > 0, `${id} has no dollar figure`);
        assert.ok(Array.isArray(e.lines) && e.lines.length, `${id} produced no breakdown`);
        assert.ok(/^https?:\/\//.test(e.source), `${id} has no source URL — an unre-checkable rate decays into a lie`);
    }
});

test('a model priced per resolution is priced at the tier asked for', () => {
    const at = r => cost().estimateVideoCost({ model: 'seedance_2_5', durationSeconds: 10, resolution: r }).credits;
    assert.strictEqual(at('480p'), 30);
    assert.strictEqual(at('720p'), 70);
    assert.strictEqual(at('1080p'), 160);
});

/* ── B. every model declares what references it will take ────────────── */

test('every contract names its roles and limits', () => {
    for (const id of ['seedance_2_5', 'minimax_h3', 'veo3_1']) {
        const c = videoRef().contractFor(id);
        assert.ok(Array.isArray(c.roles), `${id} contract declares no roles`);
        for (const cap of ['maxImages', 'maxVideos', 'maxAudio'])
            assert.strictEqual(typeof c[cap], 'number', `${id} contract has no ${cap}`);
        assert.ok(c.why, `${id} contract states no reason — an undocumented limit is a guess`);
    }
});

test('a model that documents no references stays keyframe-only', () => {
    const c = videoRef().contractFor('veo3_1');
    assert.deepStrictEqual(c.roles, ['keyframe'],
        'the keyframe was already generated FROM the plates, and re-sending them asks the model which picture is the truth');
    assert.strictEqual(c.maxImages, 1);
});

test('minimax_h3 and seedance_2_5 take role-addressed packages', () => {
    const h3 = videoRef().contractFor('minimax_h3');
    assert.ok(h3.maxImages >= 9, `minimax_h3 should take a real package, got ${h3.maxImages}`);
    assert.ok(h3.roles.includes('character') && h3.roles.includes('location'));
    const sd = videoRef().contractFor('seedance_2_5');
    assert.ok(sd.maxImages >= 30, `seedance 2.5 documents 30 images, contract says ${sd.maxImages}`);
    assert.ok(sd.maxVideos >= 10 && sd.maxAudio >= 10);
});

test('a reference is semantic, and unknown roles are refused not silently dropped', () => {
    assert.ok(videoRef().ROLES.length >= 7, 'the role vocabulary is too small to describe a shot');
    for (const role of ['keyframe', 'character', 'creature', 'prop', 'location', 'style', 'motion', 'audio'])
        assert.ok(videoRef().ROLES.includes(role), `role ${role} is missing`);
    const out = videoRef().selectReferences([
        { assetId: 'a', role: 'character', subject: 'MAYA', sourceType: 'image' },
        { assetId: 'b', role: 'nonsense', sourceType: 'image' },
    ], videoRef().contractFor('minimax_h3'));
    assert.strictEqual(out.selected.length, 1);
    assert.ok(out.dropped.some(d => /nonsense/.test(d.reason || d.role || '')),
        'an unusable reference must be reported, not dropped in silence');
});

test('selection trims to the contract and reports what did not fit', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
        ({ assetId: 'x' + i, role: 'character', subject: 'S' + i, sourceType: 'image' }));
    const out = videoRef().selectReferences(many, videoRef().contractFor('minimax_h3'));
    assert.ok(out.selected.length <= videoRef().contractFor('minimax_h3').maxImages);
    assert.ok(out.dropped.length > 0, 'over-budget references vanished without a word');
});

/* ── C. tiers are policy, not model aliases ──────────────────────────── */

test('every tier is a policy and resolves to a known model or an explicit null', () => {
    const ids = Object.keys(tiers().VIDEO_TIERS);
    assert.deepStrictEqual(ids, ['draft', 'production', 'hero']);
    for (const id of ids) {
        const t = tiers().VIDEO_TIERS[id];
        assert.ok(t.label && t.why, `tier ${id} has no label/why`);
        assert.strictEqual(typeof t.maxAttempts, 'number', `tier ${id} sets no attempt ceiling`);
        assert.ok('preferredModel' in t, `tier ${id} does not state a preferred model (null is allowed)`);
        if (t.preferredModel !== null)
            assert.ok(MODELS[t.preferredModel], `tier ${id} prefers unknown model ${t.preferredModel}`);
    }
    assert.strictEqual(tiers().VIDEO_TIERS.draft.preferredModel, 'seedance_2_5');
    assert.strictEqual(tiers().VIDEO_TIERS.draft.resolution, '480p', 'the cheap blocking pass is Seedance 2.5 at 480p');
    assert.strictEqual(tiers().VIDEO_TIERS.production.preferredModel, 'seedance_2_5');
    assert.strictEqual(tiers().VIDEO_TIERS.hero.preferredModel, null,
        'hero must stay a router/user decision rather than a hardcoded model');
});

/* ── D. the estimate, computed locally from Higgsfield's quotes ───────── */

test('the quoted arithmetic comes out exactly', () => {
    const draft = cost().estimateVideoCost({ model: 'seedance_2_5', durationSeconds: 5, resolution: '480p' });
    assert.strictEqual(draft.credits, 15, '5s at 3 credits a second');
    assert.strictEqual(draft.usd, Math.round(15 * cost().USD_PER_CREDIT * 100) / 100);
});

test('a clip shorter than the model takes is billed at its shortest, and says so', () => {
    const short = cost().estimateVideoCost({ model: 'seedance_2_5', durationSeconds: 2, resolution: '720p' });
    assert.strictEqual(short.durationSeconds, 4, 'Seedance 2.5 makes at least 4 seconds');
    assert.strictEqual(short.credits, 28);
    assert.ok(short.minimumApplied, 'the shortest length was applied without saying so');
});

/* ── E. the model can see a picture ──────────────────────────────────── */

test('an MCP tool result can carry images, not only text', () => {
    const server = require('../mcp-server.js');
    assert.strictEqual(typeof server.toolResult, 'function',
        'mcp-server should expose how it builds a tool result, so it can be tested');
    const out = server.toolResult({
        _status: 200,
        body: { note: 'two frames', images: [
            { data_uri: 'data:image/png;base64,iVBORw0KGgo=', label: 'storyboard' },
        ] },
    });
    const kinds = out.content.map(c => c.type);
    assert.ok(kinds.includes('image'),
        'a result carrying images produced text only — the model cannot see the shot it made');
    const img = out.content.find(c => c.type === 'image');
    assert.strictEqual(img.mimeType, 'image/png');
    assert.ok(!/^data:/.test(img.data), 'the base64 must be bare, not a data: URI');
    assert.ok(kinds.includes('text'), 'the text body must survive alongside the pictures');
});

test('a result with no images is byte-identical to before', () => {
    const server = require('../mcp-server.js');
    const out = server.toolResult({ _status: 200, body: { ok: true } });
    assert.deepStrictEqual(out.content.map(c => c.type), ['text']);
});

test('there is a tool that hands over the frames to compare', () => {
    const { listTools } = require('../lib/mcp-tools');
    // Named for the job, not the data: `shot_frames` already exists and lists
    // version METADATA. This one hands over the pictures.
    const t = listTools().find(x => x.name === 'shot_review');
    assert.ok(t, 'no shot_review tool — validation has nothing to look at');
    assert.ok(listTools().find(x => x.name === 'shot_frames'),
        'the existing version-listing tool was renamed away');
    assert.match(String(t.description), /storyboard|frame/i);
});

/* ── F. every attempt is recorded, or the router never gets its data ──── */

test('a generation attempt records what the router will need', () => {
    const migrations = fs.readdirSync(path.join(__dirname, '../db/migrations'));
    const file = migrations.find(f => /video_attempt/.test(f));
    assert.ok(file, 'no migration creates the attempts table');
    const sql = fs.readFileSync(path.join(__dirname, '../db/migrations', file), 'utf8');
    for (const col of ['shot_id', 'provider', 'model', 'tier', 'duration', 'resolution',
        'reference_images', 'reference_videos', 'estimated_credits', 'actual_credits',
        'attempt_number', 'accepted', 'rejection_reason', 'validation_score'])
        assert.match(sql, new RegExp(`\\b${col}\\b`), `the attempts table has no ${col}`);
});

/*
 * ── W5 — the in-between role ────────────────────────────────────────────────
 *
 * A strip can reach a provider two ways: as LEGS (N stations → N-1 short
 * first/last generations, stitched — any adapter with maxKeyframes >= 2), or as
 * a BUNDLE (one longer generation with the strip attached as references —
 * Seedance only, where images are free and the video is billed per second).
 *
 * Both are viable and they are not the same slot: keyframes are POSITIONAL
 * (first/last) and reference images are not. Conflating them is how a strip
 * gets sent to an adapter that will reject it.
 */

test('W5 · an in-between outranks identity inside its own clip', () => {
    const V = require('../lib/video-reference');
    assert.ok(V.ROLE_RANK.inbetween !== undefined, 'there is no inbetween role');
    assert.ok(V.ROLE_RANK.inbetween > V.ROLE_RANK.keyframe,
        'an in-between outranks the keyframe it was refined from');
    assert.ok(V.ROLE_RANK.inbetween < V.ROLE_RANK.character,
        'identity outranks a temporal neighbour — a face is noticed before a grade, '
        + 'but WITHIN one clip the frame a second away is what holds it together');
    assert.ok(V.ROLES.some(r => (r.id || r) === 'inbetween'), 'the role is ranked and not declared');
});

test('W5 · only the model that documents the images takes them', () => {
    /*
     * Set-based over every contract: over-sending is a provider rejection that
     * costs a generation, so a model that does not document the slot must not
     * be handed it.
     */
    const V = require('../lib/video-reference');
    assert.ok(V.CONTRACTS.seedance_2_5.roles.includes('inbetween'),
        'the one model with 30 free images does not take the strip');
    for (const [model, c] of Object.entries(V.CONTRACTS)) {
        if (model === 'seedance_2_5') continue;
        assert.ok(!c.roles.includes('inbetween'),
            `${model} was given the in-between slot without documenting it`);
    }
    assert.ok(!V.KEYFRAME_ONLY.roles.includes('inbetween'),
        'the keyframe-only default was widened — a model with no documented references stays keyframe-only deliberately');
});

test('W5 · an in-between is dropped by name where it is not taken', () => {
    const V = require('../lib/video-reference');
    const strip = Array.from({ length: 4 }, (_, i) => ({
        role: 'inbetween', kind: 'image', uri: `data:image/png;base64,s${i}`, name: `station ${i}`,
    }));
    const refs = [{ role: 'keyframe', kind: 'image', uri: 'data:image/png;base64,k', name: '1A' }, ...strip];

    const kept = V.selectReferences(refs, V.CONTRACTS.seedance_2_5);
    assert.equal(kept.selected.filter(r => r.role === 'inbetween').length, 4,
        'seedance dropped the strip it documents room for');

    const dropped = V.selectReferences(refs, V.CONTRACTS.minimax_h3);
    assert.equal(dropped.selected.filter(r => r.role === 'inbetween').length, 0);
    assert.equal(dropped.dropped.filter(r => r.role === 'inbetween').length, 4,
        'the strip vanished instead of being reported as dropped');
    for (const d of dropped.dropped.filter(r => r.role === 'inbetween')) {
        assert.ok(d.reason && d.reason.length > 8, 'a dropped in-between does not say why');
    }
});

test('W5 · the 31st image is dropped by name, never silently', () => {
    const V = require('../lib/video-reference');
    const many = Array.from({ length: 34 }, (_, i) => ({
        role: 'inbetween', kind: 'image', uri: `data:image/png;base64,s${i}`, name: `station ${i}`,
    }));
    const out = V.selectReferences(many, V.CONTRACTS.seedance_2_5);
    assert.equal(out.selected.length, V.CONTRACTS.seedance_2_5.maxImages);
    assert.equal(out.dropped.length, 34 - V.CONTRACTS.seedance_2_5.maxImages);
    for (const d of out.dropped) assert.ok(d.name, 'an over-budget image was dropped without a name');
});

test('W5 · the two shapes are offered, and legs is the default', () => {
    // legs works on any adapter with two keyframes; bundle is Seedance only.
    // Defaulting to the one that works everywhere is what makes the flag safe.
    const fs2 = require('fs');
    const src = fs2.readFileSync(require('path').join(__dirname, '..', 'routes', 'sequences.js'), 'utf8');
    assert.ok(/shape/.test(src), 'a strip cannot be asked for as legs or as a bundle');
    assert.ok(/'legs'/.test(src) && /'bundle'/.test(src), 'the two shapes are not named');
    assert.ok(/shape.*legs|legs.*default/i.test(src), 'legs is not the default');
});
