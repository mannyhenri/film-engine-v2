/**
 * PRODUCTION STUDIO: PICK SHOTS, CHOOSE A MODEL, SEND, ASSEMBLE, HAND TO RESOLVE.
 *
 * Every check here runs over a REGISTRY rather than a few examples, because a
 * recommender that knows six of the twenty-four Higgsfield models passes any
 * example a person thinks to write:
 *   - every video model in the Higgsfield snapshot has derived facts, and every
 *     recommendation accounts for every model: ranked, or refused with why;
 *   - every trait the recommender reads has a detector and a weight for every
 *     model family;
 *   - every uploadable non-image media kind has a place in Assemble and a folder;
 *   - the key is taken as copied, and a cancel reaches Higgsfield.
 *
 * Nothing is sent to Higgsfield or Resolve: fetch and the launcher are stubs.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR
    || path.join(os.tmpdir(), 'film-engine-studio-' + crypto.randomUUID().slice(0, 8));
const { ensureSchema } = require('../db/schema');
ensureSchema();

const hf = require('../lib/providers/higgsfield');
const facts = require('../lib/video-model-facts');
const rec = require('../lib/model-recommender');
const { MEDIA_KINDS } = require('../lib/media-kinds');

const MODEL_IDS = Object.keys(hf.MODELS.video);
const CHOICE_IDS = require('../lib/higgsfield-catalog').videoChoices().map(m=>m.id);
const FAMILIES = [...new Set(MODEL_IDS.map(id => hf.MODELS.video[id].family))];

test('the registry was read (these checks run over something)', () => {
    assert.ok(MODEL_IDS.length >= 20, `only ${MODEL_IDS.length} Higgsfield video models`);
    assert.ok(rec.TRAITS.length >= 8, `only ${rec.TRAITS.length} traits`);
});

test('every Higgsfield video model has facts derived from its schemas', () => {
    for (const id of MODEL_IDS) {
        const f = facts.factsFor(id);
        assert.ok(f, id);
        assert.ok(f.duration && f.duration.min > 0 && f.duration.max >= f.duration.min, `${id}: duration ${JSON.stringify(f.duration)}`);
        assert.ok(f.aspects.length > 0, `${id}: no aspect ratios`);
        assert.ok(Number.isInteger(f.max_images) && f.max_images >= 0, `${id}: max_images`);
        assert.strictEqual(typeof f.native_audio, 'boolean', `${id}: native_audio`);
        assert.ok(Number.isFinite(f.usd_per_second), `${id}: no price in the rate book`);
    }
});

test('every model family has a profile with a weight for every trait', () => {
    const missing = [];
    for (const fam of FAMILIES) {
        const p = rec.FAMILY_PROFILES[fam];
        if (!p) { missing.push(`${fam}: no profile`); continue; }
        if (!Number.isFinite(p.base)) missing.push(`${fam}: no base quality`);
        for (const t of rec.TRAITS) if (!Number.isFinite(p.traits[t.id])) missing.push(`${fam}: no weight for ${t.id}`);
    }
    assert.deepStrictEqual(missing, []);
});

test('every trait is detected on its own example, and a plain prompt sets none of them', () => {
    for (const t of rec.TRAITS) {
        const got = rec.detectTraits({ prompt: t.example.prompt, ...t.example.brief });
        assert.ok(got.includes(t.id), `${t.id} not detected in its example: ${JSON.stringify(t.example)}`);
    }
    assert.deepStrictEqual(rec.detectTraits({ prompt: 'A man stands in a room.', duration_s: 5, aspect: '16:9', shot_count: 1 }), []);
});

const BRIEFS = [
    { prompt: 'Close-up, she says quietly "You came back." Neon reflections.', duration_s: 5, aspect: '16:9', shot_count: 1, reference_count: 3, has_start_frame: true },
    { prompt: 'Muscle car drifts around a corner at night, whip pan, sparks.', duration_s: 8, aspect: '16:9', shot_count: 1, reference_count: 1, has_start_frame: true },
    { prompt: 'Wide, medium, close-up: a detective enters, spots a figure, it turns.', duration_s: 12, aspect: '16:9', shot_count: 3, reference_count: 6, has_start_frame: true },
    { prompt: 'Slow aerial over misty pines at dawn, one continuous take.', duration_s: 25, aspect: '16:9', shot_count: 1, reference_count: 0, has_start_frame: false },
    { prompt: 'A young man talks excitedly to camera about a sneaker, handheld.', duration_s: 10, aspect: '9:16', shot_count: 1, reference_count: 1, has_start_frame: true },
];

test('every recommendation accounts for every model exactly once: ranked or refused with a reason', () => {
    for (const brief of BRIEFS) {
        const out = rec.recommend(brief);
        const seen = [...out.cards.map(c => c.id), ...out.blocked.map(b => b.id)];
        assert.deepStrictEqual([...seen].sort(), [...CHOICE_IDS].sort(), brief.prompt);
        for (const c of out.cards) {
            assert.ok(c.fit >= 0 && c.fit <= 100, `${c.id} fit ${c.fit}`);
            assert.ok(c.reasons.length > 0 && c.reasons.every(r => typeof r === 'string' && r.length > 8), `${c.id} has no reason`);
            assert.ok(Number.isFinite(c.est_usd) || (c.external && c.cost.source), `${c.id} has no sourced cost status`);
        }
        for (const b of out.blocked) assert.ok(typeof b.why === 'string' && b.why.length > 8, `${b.id} refused without why`);
        assert.ok(out.cards.length > 0, `nothing eligible for: ${brief.prompt}`);
        assert.strictEqual(out.cards.filter(c => c.top).length, 1, 'exactly one top pick');
        assert.ok(out.cards.every((c, i, a) => i === 0 || Number(a[i-1].noAdvantage)<Number(c.noAdvantage) || a[i-1].noAdvantage===c.noAdvantage && a[i - 1].fit >= c.fit), 'cards are ranked by fit');
    }
});

test('hard rules: too long, wrong shape and a missing start frame refuse, naming the limit', () => {
    const long = rec.recommend(BRIEFS[3]);
    for (const id of MODEL_IDS) {
        const f = facts.factsFor(id);
        const blocked = long.blocked.find(b => b.id === id);
        if (f.duration.max < 25) assert.ok(blocked && new RegExp(`${f.duration.max}s`).test(blocked.why), `${id} (max ${f.duration.max}s) not refused for 25s`);
    }
    const vertical = rec.recommend(BRIEFS[4]);
    for (const id of MODEL_IDS) {
        if (!facts.factsFor(id).aspects.includes('9:16')) assert.ok(vertical.blocked.some(b => b.id === id && /9:16/.test(b.why)), `${id} has no 9:16 and was not refused`);
    }
    const textOnly = rec.recommend({ ...BRIEFS[0], has_start_frame: false, reference_count: 0 });
    for (const id of MODEL_IDS) {
        const m = hf.MODELS.video[id];
        if (!m.endpoints.text && !m.endpoints.reference) assert.ok(textOnly.blocked.some(b => b.id === id && /start frame/.test(b.why)), `${id} needs a start frame`);
    }
});

test('dialogue goes to a model that makes sound; a model without it says so', () => {
    const out = rec.recommend(BRIEFS[0]);
    assert.ok(facts.factsFor(out.cards[0].id).native_audio, `top pick ${out.cards[0].id} makes no sound`);
    const silent = out.cards.find(c => !facts.factsFor(c.id).native_audio);
    if (silent) assert.ok(silent.reasons.some(r => /no (generated )?(sound|audio|dialogue)/i.test(r)), `${silent.id} does not say it is silent`);
});

test('references beyond a model\'s limit are reported as dropped, not silently cut', () => {
    const out = rec.recommend(BRIEFS[2]);
    for (const c of out.cards) {
        const max = facts.factsFor(c.id).max_images;
        if (max !== null && max < 6) assert.ok(c.dropped_refs === 6 - max && c.reasons.some(r => /reference/.test(r)), `${c.id} takes ${max}, drops ${c.dropped_refs}`);
        else assert.strictEqual(c.dropped_refs, 0, c.id);
    }
});

test('budget pick follows the observed strong-fit rule, allows the top pick, and compares website credits for equal lengths', () => {
    for (const brief of BRIEFS) {
        const out = rec.recommend(brief), b = out.cards.find(c=>c.budget);
        if (!b) continue;
        const best = Math.max(...out.cards.filter(c=>!c.noAdvantage).map(c=>c.fit));
        assert.ok(!b.noAdvantage && b.fit>=Math.max(70,best-20));
        const others=out.cards.filter(c=>c!==b&&!c.noAdvantage&&c.fit>=Math.max(70,best-20)&&Number.isFinite(c.cost.credits)&&c.billed_seconds===b.billed_seconds);
        assert.ok(others.length && b.cost.credits<=.75*Math.min(...others.map(c=>c.cost.credits)));
    }
});

test('an AI judgement re-ranks the eligible cards and can never revive a refused model', () => {
    const base = rec.recommend(BRIEFS[3]);
    const refused = base.blocked[0].id;
    const top = base.cards[base.cards.length - 1].id;
    const judged = base.cards.map(c => c.id === top ? { id: top, fit: 99, reason: 'The AI says this is the one for a long aerial.' } : { id: c.id, fit: 50 });
    const merged = rec.mergeJudgement(base, [...judged, { id: refused, fit: 100, reason: 'nope' }]);
    assert.strictEqual(merged.cards[0].id, top);
    assert.ok(merged.cards[0].reasons[0].startsWith('The AI says'));
    assert.ok(!merged.cards.some(c => c.id === refused));
    assert.strictEqual(merged.cards.filter(c => c.top).length, 1);
    assert.strictEqual(merged.judged, true);
});

test('every uploadable non-image media kind has an Assemble section and a project folder', () => {
    const kinds = require('../lib/assemble-kinds').assembleKinds();
    for (const [cap, spec] of Object.entries(MEDIA_KINDS)) {
        if (spec.media === 'image') continue;
        const k = kinds.find(x => x.capability === cap);
        assert.ok(k, `${cap} has no Assemble section`);
        assert.ok(['video', 'dialogue', 'sfx', 'music'].includes(k.section), `${cap}: section ${k.section}`);
        assert.strictEqual(k.scope, spec.scope, cap);
        assert.match(k.folder, /^0\d /, `${cap}: folder ${k.folder}`);
    }
});

test('the Higgsfield key is taken as copied: one key, or the older id:secret pair', () => {
    const was = process.env.HF_CREDENTIALS;
    process.env.HF_CREDENTIALS = 'hf_single_copied_key_123';
    assert.deepStrictEqual(hf.credential(), { ok: true, header: 'Key hf_single_copied_key_123' });
    process.env.HF_CREDENTIALS = 'kid:ksecret';
    assert.deepStrictEqual(hf.credential(), { ok: true, header: 'Key kid:ksecret' });
    process.env.HF_CREDENTIALS = 'Key hf_pasted_with_prefix';
    assert.deepStrictEqual(hf.credential(), { ok: true, header: 'Key hf_pasted_with_prefix' });
    process.env.HF_CREDENTIALS = 'two words';
    assert.strictEqual(hf.credential().ok, false);
    if (was === undefined) delete process.env.HF_CREDENTIALS; else process.env.HF_CREDENTIALS = was;
});

test('a cancel reaches Higgsfield; a request that already started falls back to stop waiting', async () => {
    const was = process.env.HF_CREDENTIALS, real = global.fetch;
    process.env.HF_CREDENTIALS = 'hf_key';
    const calls = [];
    try {
        assert.strictEqual(hf.adapter.cancel, 'provider');
        global.fetch = async (url, o) => { calls.push({ url, method: o && o.method, auth: o && o.headers && o.headers.Authorization }); return { ok: true, status: 202, json: async () => ({}), text: async () => '' }; };
        assert.deepStrictEqual(await hf.cancelJob('req-1'), { ok: true });
        assert.deepStrictEqual(calls[0], { url: 'https://api.higgsfield.ai/requests/req-1/cancel', method: 'POST', auth: 'Key hf_key' });
        global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ detail: 'Request is not in queue' }), text: async () => '' });
        const r = await hf.cancelJob('req-2');
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.fallback, 'stop_waiting');
    } finally {
        global.fetch = real;
        if (was === undefined) delete process.env.HF_CREDENTIALS; else process.env.HF_CREDENTIALS = was;
    }
});

test('Send to Resolve: opens the app, runs the import until Resolve answers, else says why and keeps the package', async () => {
    const { launchResolve } = require('../lib/resolve-launch');
    const runs = [];
    let tries = 0;
    const ok = await launchResolve('/tmp/pkg', { platform: 'darwin', waitMs: 0, attempts: 4,
        run: async (cmd, args) => { runs.push([cmd, ...args].join(' ')); if (cmd === 'python3') { tries++; return tries < 3 ? { code: 1, out: 'Open DaVinci Resolve first' } : { code: 0, out: 'Timeline imported' }; } return { code: 0, out: '' }; } });
    assert.strictEqual(ok.imported, true);
    assert.match(runs[0], /^open -a DaVinci Resolve/);
    assert.strictEqual(tries, 3);
    const no = await launchResolve('/tmp/pkg', { platform: 'darwin', waitMs: 0, attempts: 2,
        run: async (cmd) => cmd === 'python3' ? { code: 1, out: 'Open DaVinci Resolve first and check scripting access.' } : { code: 0, out: '' } });
    assert.strictEqual(no.imported, false);
    assert.match(no.reason, /scripting/i);
    const missing = await launchResolve('/tmp/pkg', { platform: 'darwin', waitMs: 0, attempts: 2,
        run: async (cmd) => cmd === 'open' ? { code: 1, out: 'Unable to find application named DaVinci Resolve' } : { code: 0, out: '' } });
    assert.strictEqual(missing.imported, false);
    assert.match(missing.reason, /not installed|could not open/i);
});

test('the route lists every Higgsfield video model with its facts', async () => {
    const { handleProductionStudio } = require('../routes/production-studio');
    let status, body;
    const res = { writeHead: s => { status = s; }, end: b => { body = JSON.parse(b); } };
    await handleProductionStudio({ method: 'GET' }, res, ['film', 'production-studio', 'higgsfield-models']);
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body.models.map(m => m.id).sort(), [...CHOICE_IDS].sort());
    assert.ok(body.models.every(m => m.label && (m.external || (m.duration && m.workflows.length))));
    assert.ok('connected' in body);
});

test('the route recommends by the rules without needing an AI', async () => {
    const { handleProductionStudio } = require('../routes/production-studio');
    let status, body;
    const res = { writeHead: s => { status = s; }, end: b => { body = JSON.parse(b); } };
    await handleProductionStudio({ method: 'POST', body: { ...BRIEFS[2], ai: false } }, res, ['film', 'production-studio', 'recommend']);
    assert.strictEqual(status, 200, JSON.stringify(body));
    assert.strictEqual(body.cards.length + body.blocked.length, CHOICE_IDS.length);
    assert.strictEqual(body.judged, false);
});

/*
 * The judge and the rewrite ask the director's CONNECTED AI (Claude or Codex, signed in under AI connections, the
 * account Ask AI uses), not the project's API provider: the API adapters are blocked behind the final request review
 * ("Exact final request review is not supported for Anthropic yet"), so through them the judge never answered.
 */
function fakeConnected(reply, seen) {
    return {
        providersAsync: async () => [{ id: 'claude', available: true }, { id: 'codex', available: false }],
        start(input, hooks) {
            seen.push(input);
            const answer = typeof reply === 'function' ? reply(input.payload) : reply;
            setImmediate(() => { hooks.complete(answer, { session_id: 's' }); hooks.closed && hooks.closed(); });
            return { closed: Promise.resolve({ status: 'completed' }), cancel() { return false; } };
        },
    };
}

test('Ask AI to judge answers through the connected AI account, and re-ranks the eligible models', async () => {
    const { db, generateId } = require('../db/database');
    const pid = generateId();
    db.prepare('INSERT INTO film_projects (id, title) VALUES (?, ?)').run(pid, 'Judge');
    const studio = require('../routes/production-studio');
    const seen = [];
    studio.useConnectedAI(fakeConnected(payload => JSON.stringify(
        [...payload.matchAll(/"id":"([a-z0-9-]+)"/g)].map((m, i) => ({ id: m[1], fit: 90 - i, reason: 'Holds the face across the move.' }))), seen));
    try {
        let status, body;
        const res = { writeHead: x => { status = x; }, end: b => { body = JSON.parse(b); } };
        await studio.handleProductionStudio({ method: 'POST', body: { ...BRIEFS[2], ai: true } }, res, ['film', 'projects', pid, 'production-studio', 'recommend']);
        assert.strictEqual(status, 200, JSON.stringify(body));
        assert.ok(!body.judge_error, body.judge_error);
        assert.strictEqual(body.judged, true);
        assert.strictEqual(seen.length, 1);
        assert.strictEqual(seen[0].provider, 'claude');
        assert.ok(body.cards.some(c => c.reasons.some(r => /Holds the face/.test(r)) || c.ai_reason), 'the AI\'s reason reaches a card');
    } finally { studio.useConnectedAI(null); }
});

test('Optimize with AI rewrites through the connected AI account', async () => {
    const { db, generateId } = require('../db/database');
    const pid = generateId();
    db.prepare('INSERT INTO film_projects (id, title) VALUES (?, ?)').run(pid, 'Rewrite');
    const studio = require('../routes/production-studio');
    studio.useConnectedAI(fakeConnected(JSON.stringify({ prompt: 'Wide shot, slow push in. Maya crosses the diner.', changes: ['Camera first.'] }), []));
    try {
        let status, body;
        const res = { writeHead: x => { status = x; }, end: b => { body = JSON.parse(b); } };
        await studio.handleProductionStudio({ method: 'POST', body: { model_id: MODEL_IDS[0], prompt: 'Maya crosses the diner.', duration_s: 5 } },
            res, ['film', 'projects', pid, 'production-studio', 'optimize-prompt']);
        assert.strictEqual(status, 200, JSON.stringify(body));
        assert.match(body.prompt, /slow push in/);
    } finally { studio.useConnectedAI(null); }
});

test('every Higgsfield video model: the composed negative goes only where the model has a negative field', () => {
    for (const id of MODEL_IDS) {
        const f = facts.factsFor(id);
        // The keyframe goes as the first frame where the model takes one, else as a reference picture.
        const pictures = f.start_frame ? { init_image: 'https://x.test/a.png' } : f.max_images ? { reference_images: ['https://x.test/a.png'] } : {};
        const payload = { model: id, prompt: 'A man walks.', negative_prompt: 'blurry', ...pictures };
        const takes = hf.adapter.takesNegative('video', payload);
        assert.strictEqual(takes, facts.factsFor(id).negative_prompt || takes, `${id}: a model whose schema has no negative field said it takes one`);
        const sent = takes ? payload : (({ negative_prompt, ...rest }) => rest)(payload);
        assert.doesNotThrow(() => hf.buildRequest('video', sent), `${id}: refused after the negative was set aside`);
        if (takes) assert.strictEqual(hf.buildRequest('video', sent).body.negative_prompt, 'blurry', id);
    }
});

test('fits stay distinguishable: no brief ties the top two picks at the ceiling', () => {
    for (const brief of BRIEFS) {
        const [a, b] = rec.recommend(brief).cards;
        assert.ok(!(a.fit >= 97 && b && b.fit >= 97), `${brief.prompt}: ${a.id} ${a.fit}, ${b && b.id} ${b && b.fit}`);
    }
});

test('every Higgsfield video model previews through the provider wrapper with the pipeline\'s composed negative', async () => {
    const providers = require('../lib/providers');
    const was = process.env.HF_CREDENTIALS;
    process.env.HF_CREDENTIALS = 'hf_preview_only';
    const failed = [];
    try {
        for (const id of MODEL_IDS) {
            const f = facts.factsFor(id);
            const gen = providers.resolve('video', { video: 'higgsfield', video_model: id });
            const pictures = f.start_frame ? { init_image: 'https://x.test/a.png' } : f.max_images ? { reference_images: ['https://x.test/a.png'] } : {};
            const out = await gen.generate('video', { model: id, prompt: 'A man walks to the door.', negative_prompt: 'blurry, low quality',
                duration_s: f.duration.min, ...pictures }, { previewRequest: true }).catch(e => ({ error: e.message }));
            if (!out || !out.preview) failed.push(`${id}: ${out && out.error}`);
            else if (!f.negative_prompt && out.payload.negative_prompt) failed.push(`${id}: sent a negative it has no field for`);
        }
    } finally { if (was === undefined) delete process.env.HF_CREDENTIALS; else process.env.HF_CREDENTIALS = was; }
    assert.deepStrictEqual(failed, []);
});

test('a shot\'s composed keyframe and references reach every Higgsfield model: sent where it takes them, set aside where it cannot', async () => {
    // What "Some shots could not compose a request" was: the pipeline attaches the shot's keyframe AND its character
    // and location plates; Seedance 2.5's first-frame endpoint takes no references, and the request threw.
    const providers = require('../lib/providers');
    const was = process.env.HF_CREDENTIALS;
    process.env.HF_CREDENTIALS = 'hf_preview_only';
    const failed = [];
    try {
        for (const id of MODEL_IDS) {
            const f = facts.factsFor(id);
            const gen = providers.resolve('video', { video: 'higgsfield', video_model: id });
            const out = await gen.generate('video', { model: id, prompt: 'A man walks to the door.', duration_s: f.duration.min,
                init_image: 'https://x.test/key.png', reference_images: ['https://x.test/maya.png', 'https://x.test/diner.png'] },
            { previewRequest: true }).catch(e => ({ error: e.message }));
            if (!out || !out.preview) { failed.push(`${id}: ${out && out.error}`); continue; }
            // The wire body the paid call would send, from the adapter's own builder over the payload the wrapper passed.
            let body;
            try { body = JSON.stringify(require('../lib/providers/higgsfield').buildRequest('video', out.payload).body || {}); }
            catch (e) { failed.push(`${id}: ${e.message}`); continue; }
            const setAside = (out.payload.__not_sent_input_fields || []).includes('reference_images');
            if (!body.includes('maya.png') && !setAside) failed.push(`${id}: the references were neither sent nor recorded as not sent`);
            if (body.includes('maya.png') && setAside) failed.push(`${id}: the references were sent and also recorded as not sent`);
        }
        // References the director chose on a saved draft are theirs: a model that cannot take them still refuses.
        const hf = require('../lib/providers/higgsfield');
        const schema = require('../lib/providers/higgsfield-models.json');
        const takesRefs = id => Object.entries(hf.MODELS.video[id].endpoints)
            .some(([kind, e]) => kind === 'reference' || !!(((schema.models || schema)[e] || {}).schema || {}).properties?.image_urls);
        const noRefs = MODEL_IDS.find(id => !takesRefs(id));
        assert.ok(noRefs, 'a model without a reference input exists to check against');
        // The paid path builds through the adapter's own builder, which the wrapper leaves alone for a saved recipe.
        assert.throws(() => hf.buildRequest('video', { model: noRefs, prompt: 'A man walks.', init_image: 'https://x.test/key.png',
            reference_images: ['https://x.test/maya.png'] }), /reference images/, `${noRefs}: chosen references were dropped silently`);
    } finally { if (was === undefined) delete process.env.HF_CREDENTIALS; else process.env.HF_CREDENTIALS = was; }
    assert.deepStrictEqual(failed, []);
});

test('a shot\'s composed pictures are recognised as the project files they are: storyboard frame and every plate kind', async () => {
    // What "0 attached" was on Glass Harbour 1A: the pipeline sends each picture as bytes with no file reference, and the
    // starter matched only by asset id or path, so the frame and the Ray, June and diner plates all came back unresolved.
    const { db, generateId } = require('../db/database');
    const plans = require('../lib/final-request-plans');
    const drafts = require('../lib/production-draft-request');
    const fs = require('fs');
    const KINDS = ['storyboard', 'keyframe', 'character_sheet', 'reference_image'];
    const project = generateId(), scene = generateId(), shot = generateId();
    db.prepare('INSERT INTO film_projects (id, title) VALUES (?, ?)').run(project, 'Plates');
    db.prepare('INSERT INTO film_scenes (id, project_id, scene_number) VALUES (?, ?, 1)').run(scene, project);
    db.prepare("INSERT INTO film_shots (id, scene_id, shot_code, scene_card_yaml) VALUES (?, ?, '1A', '{}')").run(shot, scene);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-plates-'));
    const assets = KINDS.map((kind, i) => {
        const id = generateId(), file = path.join(dir, `${kind}.png`);
        fs.writeFileSync(file, require('../lib/png-raster').encode({ width: 8, height: 8, pixels: Buffer.alloc(8 * 8 * 4, 40 + i * 30) }));
        db.prepare("INSERT INTO film_assets (id, project_id, shot_id, asset_type, file_path, file_name, version, mime_type) VALUES (?, ?, ?, ?, ?, ?, 1, 'image/png')")
            .run(id, project, kind === 'storyboard' ? shot : null, kind, file, path.basename(file));
        return { id, kind, uri: 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') };
    });
    // The copies the pipeline sends instead of an original: a frame resized for video (.thumbs, lib/thumbnails.js
    // videoKeyframeFor) and a plate shrunk to fit inline (.sendable, lib/reference-images.js shrinkToFit). Each is named
    // after its original's identity, and is that original.
    const copyOf = (a, dirname, variant, fill) => {
        const st = fs.statSync(a.file);
        const file = path.join(path.dirname(a.file), dirname, `${path.basename(a.file)}.${st.mtimeMs.toFixed(0)}.${st.size}.${variant}.jpg`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(`derived ${variant} ${fill}`));
        return { id: a.id, uri: 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64') };
    };
    assets.forEach(a => { a.file = path.join(dir, `${a.kind}.png`); });
    const copies = [copyOf(assets[0], '.thumbs', 'video1920', 1), copyOf(assets[2], '.sendable', '2048', 2)];
    // A stale copy (named for an older version of its original) is NOT its original any more.
    const stale = path.join(dir, '.sendable', `reference_image.png.1.1.2048.jpg`);
    fs.writeFileSync(stale, Buffer.from('stale copy'));
    const staleUri = 'data:image/jpeg;base64,' + fs.readFileSync(stale).toString('base64');
    const real = plans.videoItem, was = process.env.HF_CREDENTIALS;
    process.env.HF_CREDENTIALS = 'hf_preview_only';
    plans.videoItem = async () => ({ provider: 'higgsfield', payload: { model: 'seedance-2-5', prompt: 'Maya crosses the diner.', duration_s: 5,
        init_image: assets[0].uri, reference_images: [...assets.slice(1), ...copies].map(a => a.uri).concat(staleUri) } });
    try {
        const starter = await drafts.starterDraft(db, project, `shot:${shot}`, 'video', { provider: 'higgsfield' });
        assert.strictEqual(starter.unresolved.length, 1, 'only the stale copy is unresolved: ' + JSON.stringify(starter.unresolved));
        const ids = [starter.recipe.init_image, ...starter.recipe.reference_images].map(r => r && r.asset_id);
        assert.deepStrictEqual(ids, [...assets.map(a => a.id), ...copies.map(c => c.id), undefined], 'each picture is its own project file, in order');
    } finally {
        plans.videoItem = real;
        if (was === undefined) delete process.env.HF_CREDENTIALS; else process.env.HF_CREDENTIALS = was;
    }
});

test('FILM_RESOLVE_LAUNCH=0 writes the package only: nothing is opened', async () => {
    const { launchResolve } = require('../lib/resolve-launch');
    const was = process.env.FILM_RESOLVE_LAUNCH;
    process.env.FILM_RESOLVE_LAUNCH = '0';
    try {
        const r = await launchResolve('/tmp/pkg', { platform: 'darwin', waitMs: 0 });
        assert.strictEqual(r.imported, false);
        assert.match(r.reason, /turned off/);
        assert.strictEqual(r.log.length, 0);
    } finally { if (was === undefined) delete process.env.FILM_RESOLVE_LAUNCH; else process.env.FILM_RESOLVE_LAUNCH = was; }
});
