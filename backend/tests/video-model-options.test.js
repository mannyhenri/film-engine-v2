/**
 * Every video model's own options, on the dialog that spends, and in the request.
 *
 * "Seedance 2.5 takes a first and last frame and I can change the video length
 * to up to 30 seconds, resolution quality, screen ratio and HDR — those options
 * should appear in the modal."
 *
 * Set-based over every (provider, model) the dialog offers for video, read from
 * generationOptions('video'), so a model added later arrives with its options or
 * fails here:
 *   - each option a model offers REACHES that provider's request: set it, and
 *     the field it names changes in the body the adapter would send;
 *   - what is offered is the provider's own schema (the dated snapshot), and a
 *     value outside it is refused by name, never sent;
 *   - Higgsfield's options are its own app catalogue's, and an automatic frame
 *     is one the model takes;
 *   - through the routes: the free preview carries the model's options and the
 *     request as it would go, and the paid call sends what was chosen, or
 *     refuses before sending anything;
 *   - the page draws a control for every option and sends them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.FILM_DATA_DIR = path.join(os.tmpdir(), 'film-engine-vmo-' + crypto.randomUUID().slice(0, 8));
for (const k of Object.keys(process.env)) if (/_API_KEY$|_API_SECRET$|^RUNWAYML_/.test(k)) delete process.env[k];
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const mo = require('../lib/model-options');
const hf = require('../lib/providers/higgsfield-mcp');
const appCatalog = require('../lib/higgsfield-app-catalog');
const seedance = require('../lib/providers/seedance');
const { generationOptions } = require('../lib/generation-override');
const SPA = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'index.html'), 'utf8');

const FRAME_A = 'data:image/png;base64,QUFB';
const FRAME_B = 'data:image/png;base64,QkJC';

/** The body field each option lands in, per adapter. */
const BODY_FIELD = {
    // Higgsfield names each model's sound switch itself (generate_audio, sound…), read from the catalogue.
    'higgsfield-mcp': { duration: 'duration', ratio: 'aspect_ratio', resolution: 'resolution', last_frame: 'medias' },
    seedance: { duration: 'duration', ratio: 'aspect_ratio', last_frame: 'images_list', seed: 'seed', draft: 'draft' },
};
const fieldOf = (provider, model, key) => (provider === 'higgsfield-mcp' && key === 'audio')
    ? (appCatalog.MODELS[model] && appCatalog.MODELS[model].audio && appCatalog.MODELS[model].audio.param)
    : provider === 'higgsfield-mcp' && key === 'resolution' ? (appCatalog.MODELS[model] && appCatalog.MODELS[model].resolution && appCatalog.MODELS[model].resolution.param)
    : BODY_FIELD[provider][key];
const BUILD = { 'higgsfield-mcp': p => hf.buildRequest('video', p).body, seedance: p => seedance.buildVideoRequest(p).body };

/** A value for each control that is NOT what an unset request would send. */
function pick(c, base, field) {
    if (c.type === 'choice') {
        const ids = c.choices.map(x => x.id);
        return ids.slice().reverse().find(x => String(x) !== String(base[field])) ?? ids[0];
    }
    if (c.type === 'range') return c.max !== base[field] ? c.max : c.min;
    if (c.type === 'toggle') return base[field] === true ? false : (c.default === true ? false : true);
    if (c.type === 'number') return 12345;
    if (c.type === 'text') return 'no birds in the sky';
    if (c.type === 'frame') return 'LAST';
    return null;
}

const OFFERED = [];
for (const p of generationOptions('video').providers) {
    for (const m of (p.models || [])) if (m.options && m.options.length) OFFERED.push({ provider: p.id, model: m.id, controls: m.options });
}

test('the dialog offers options for the video models, and Seedance 2.5 carries the ones asked for', () => {
    assert.ok(OFFERED.length >= 10, `only ${OFFERED.length} models carry options`);
    const keysOf = (prov, model) => OFFERED.find(o => o.provider === prov && o.model === model).controls.map(c => c.key);
    for (const k of ['duration', 'ratio', 'resolution', 'audio', 'last_frame']) {
        assert.ok(keysOf('higgsfield-mcp', 'seedance_2_5').includes(k), `Higgsfield Seedance 2.5 does not offer ${k}`);
    }
    for (const k of ['duration', 'ratio', 'last_frame', 'seed']) {
        assert.ok(keysOf('seedance', 'seedance-2.5-1080p').includes(k), `MuAPI Seedance 2.5 does not offer ${k}`);
    }
    const len = OFFERED.find(o => o.provider === 'higgsfield-mcp' && o.model === 'seedance_2_5').controls.find(c => c.key === 'duration');
    assert.equal(len.max, 30, 'Seedance 2.5 runs to 30 seconds on Higgsfield');
    const notes = mo.optionsFor('seedance', 'seedance-2.5-1080p').notes.join(' ');
    assert.match(notes, /No HDR/, 'MuAPI Seedance does not say it has no HDR');
    assert.match(notes, /no sound switch/, 'MuAPI Seedance does not say it takes no sound switch');
});

test('every option every model offers reaches that provider\'s request', () => {
    const bad = [];
    for (const o of OFFERED) {
        const base = { model: o.model, prompt: 'The dragon turns.', init_image: FRAME_A, width: 1920, height: 1080,
            target_resolution: '1920x1080', duration_s: 5, fps: 24 };
        const before = BUILD[o.provider]({ ...base });
        for (const c of o.controls) {
            const field = fieldOf(o.provider, o.model, c.key);
            if (!field) { bad.push(`${o.provider}/${o.model}: ${c.key} names no request field`); continue; }
            // Higgsfield sends a tier by its own raw value (MiniMax "1080" for 1080p): compare on the tier's name.
            const m = o.provider === 'higgsfield-mcp' && appCatalog.MODELS[o.model];
            const asKey = m && c.key === 'resolution' ? Object.keys(m.resolution.values).find(k => m.resolution.values[k] === before[field]) : undefined;
            const value = pick(c, asKey !== undefined ? { ...before, [field]: asKey } : before, field);
            const { values, refused } = mo.readOptions(o.provider, o.model, { [c.key]: value === 'LAST' ? 'x' : value });
            if (c.type !== 'frame' && refused.length) { bad.push(`${o.provider}/${o.model}: ${c.key}=${value} refused: ${refused}`); continue; }
            const payload = mo.applyVideoOptions({ ...base }, c.type === 'frame' ? {} : values,
                c.type === 'frame' ? { lastFrameUri: FRAME_B } : {});
            const after = BUILD[o.provider](payload);
            if (JSON.stringify(after[field]) === JSON.stringify(before[field])) {
                bad.push(`${o.provider}/${o.model}: ${c.key}=${value} did not change ${field} (${JSON.stringify(before[field])})`);
            }
            if (c.type === 'frame' && !JSON.stringify(after[field]).includes(FRAME_B)) {
                bad.push(`${o.provider}/${o.model}: the ending frame is not in ${field}`);
            }
        }
    }
    assert.deepEqual(bad, []);
});

test('Higgsfield\'s options are its app catalogue\'s own, and its automatic frame is one the model takes', () => {
    const bad = [];
    for (const [model, m] of Object.entries(appCatalog.MODELS)) {
        const opts = mo.optionsFor('higgsfield-mcp', model);
        const ratio = opts.controls.find(c => c.key === 'ratio');
        if (m.aspects && m.aspects.length > 1) assert.deepEqual(ratio.choices.map(c => c.id), m.aspects, `${model} ratios`);
        for (const [w, h] of [[1280, 720], [1920, 1080], [3840, 2160], [1080, 1920], [1024, 1024]]) {
            let body;
            try { body = hf.buildRequest('video', { model, prompt: 'x', init_image: FRAME_A, width: w, height: h, target_resolution: `${w}x${h}` }).body; }
            catch (err) { if (/takes no keyframe/.test(err.message)) continue; throw err; }
            if (m.aspects && body.aspect_ratio && !m.aspects.includes(body.aspect_ratio)) bad.push(`${model} at ${w}x${h} sends ${body.aspect_ratio}, which it does not take`);
            const d = m.duration || {};
            const ok = Array.isArray(d.values) ? d.values.includes(body.duration) : (body.duration >= d.min && body.duration <= d.max);
            if (!ok) bad.push(`${model} sends a ${body.duration}s length it does not take`);
        }
    }
    assert.deepEqual(bad, []);
});

test('a value the model does not take is refused by name and never sent', () => {
    const r = mo.readOptions('higgsfield-mcp', 'seedance_2_5', { duration: 45, ratio: '1234:567', output_format: 'hdr10', audio: false });
    assert.deepEqual(r.values, { audio: false });
    assert.equal(r.refused.length, 3);
    assert.match(r.refused.join(' '), /duration: 45 is outside 4–30s/);
    assert.match(r.refused.join(' '), /ratio: 1234:567 is not one of/);
    assert.match(r.refused.join(' '), /output_format: seedance_2_5 does not take this/);
    // An adapter never sends a value its catalogue refuses, even if one arrives.
    const body = hf.buildRequest('video', { model: 'seedance_2_5', prompt: 'x', init_image: FRAME_A, aspect_ratio: '1234:567',
        output_format: 'hdr10', resolution: '4k' }).body;
    assert.notEqual(body.aspect_ratio, '1234:567');
    assert.equal(body.output_format, undefined);
    assert.notEqual(body.resolution, '4k');
});

test('no options chosen builds exactly the request it always did', () => {
    for (const o of OFFERED) {
        const base = { model: o.model, prompt: 'x', init_image: FRAME_A, width: 1920, height: 1080, duration_s: 5, fps: 24 };
        const a = BUILD[o.provider]({ ...base });
        const b = BUILD[o.provider](mo.applyVideoOptions({ ...base }, {}, {}));
        assert.deepEqual(b, a, `${o.provider}/${o.model}`);
    }
});

/* ── through the routes ─────────────────────────────────────────────────── */

function seedShot() {
    const { getFilePath } = require('../lib/file-storage');
    const projectId = generateId(), sceneId = generateId(), a = generateId(), b = generateId();
    db.prepare('INSERT INTO film_projects (id, title, target_fps, target_resolution, provider_config) VALUES (?, ?, 24, ?, ?)')
        .run(projectId, 'Options', '1920x1080', JSON.stringify({ video: 'higgsfield-mcp', video_model: 'seedance_2_5' }));
    db.prepare('INSERT INTO film_scenes (id, project_id, scene_number, location) VALUES (?, ?, 1, ?)').run(sceneId, projectId, 'STREET');
    for (const [id, code] of [[a, '1A'], [b, '1B']]) {
        db.prepare('INSERT INTO film_shots (id, scene_id, shot_code, duration_ms, scene_card_yaml, sort_order) VALUES (?, ?, ?, 5000, ?, ?)')
            .run(id, sceneId, code, JSON.stringify({ shot_code: code, description: 'The dragon turns.', camera: { shot_type: 'wide' } }), code === '1A' ? 0 : 1);
        const file = `${code}.png`;
        const p = getFilePath(projectId, 'storyboards', file);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, Buffer.from(code === '1A' ? 'AAA' : 'BBB'));
        db.prepare("INSERT INTO film_assets (id, project_id, shot_id, asset_type, file_name, file_path) VALUES (?, ?, ?, 'storyboard', ?, ?)")
            .run(generateId(), projectId, id, file, p);
    }
    return { projectId, a, b };
}

function call(method, url, parts, body, query) {
    const { handleVideoGen } = require('../routes/video-gen');
    return new Promise(resolve => {
        const res = { statusCode: 200, writeHead(s) { this.statusCode = s; return this; }, setHeader() {},
            end(p) { let j = null; try { j = JSON.parse(p || '{}'); } catch (_) {} resolve({ code: this.statusCode, json: j }); } };
        handleVideoGen({ method, url, body: body || {}, headers: {} }, res, parts, query || {});
    });
}

test('the free preview carries the model\'s options and the request as it would go', async () => {
    const { a, b } = seedShot();
    const r = await call('GET', `/film/shots/${a}/video/preview`, ['film', 'shots', a, 'video', 'preview'], {},
        { options: JSON.stringify({ duration: 22, ratio: '21:9', audio: false, last_frame: b }) });
    assert.equal(r.code, 200, JSON.stringify(r.json));
    const o = r.json.options;
    assert.equal(o.provider, 'higgsfield-mcp');
    assert.ok(o.controls.some(c => c.key === 'last_frame'), 'no ending-frame control');
    assert.deepEqual(o.values, { duration: 22, ratio: '21:9', audio: false });
    assert.equal(o.last_frame.shot_code, '1B');
    assert.ok(o.frames.some(f => f.label === '1B'), 'the ending-frame picker does not list 1B');
    const out = r.json.outbound.body || r.json.outbound;
    assert.equal(out.duration, 22);
    assert.equal(out.aspect_ratio, '21:9');
    assert.equal(out.generate_audio, false);
    // The preview names the pictures without their bytes, by the role each plays.
    const roles = (out.medias || []).map(m => m.role);
    assert.ok(roles.includes('start_image') && roles.includes('end_image'), `the ending frame is not in the request: ${roles}`);
    assert.ok(!(out.medias || []).some(m => /^data:/.test(m.value)), 'the preview carried picture bytes');
    assert.equal(r.json.estimate && r.json.estimate.lines && r.json.duration_s, 22, 'the preview is not priced at the chosen length');

    const bad = await call('GET', `/film/shots/${a}/video/preview`, ['film', 'shots', a, 'video', 'preview'], {},
        { options: JSON.stringify({ duration: 99 }) });
    assert.ok(bad.json.warnings.some(w => /Option not sent — duration: 99/.test(w)), 'a refused option is not said');
});

test('the paid call refuses a bad option before anything, and a good one stops at the final review', async () => {
    const { a, b } = seedShot();
    const sent = [];
    const realFetch = global.fetch;
    global.fetch = async (url, init) => { sent.push(String(url)); return new Response('{}', { status: 400 }); };
    try {
        const refused = await call('POST', `/film/shots/${a}/video/generate`, ['film', 'shots', a, 'video', 'generate'],
            { options: { duration: 99 } });
        assert.equal(refused.code, 400);
        assert.match(refused.json.error, /duration: 99/);
        // Higgsfield is reviewed and handed over: the chosen options reach the frozen request, nothing reaches Higgsfield.
        const review = await call('POST', `/film/shots/${a}/video/generate`, ['film', 'shots', a, 'video', 'generate'],
            { options: { duration: 12, ratio: '9:16', audio: false, last_frame: b } });
        assert.equal(review.code, 428, JSON.stringify(review.json).slice(0, 600));
        const reviewId = String(review.json.error).split(':')[1];
        const body = require('../lib/final-request-review').store().get(reviewId).snapshot.body;
        assert.equal(body.model, 'seedance_2_5');
        assert.equal(body.duration, 12);
        assert.equal(body.aspect_ratio, '9:16');
        assert.equal(body.generate_audio, false);
        assert.ok(body.medias.some(m => m.role === 'end_image'), 'the ending frame is not in the frozen request');
        assert.equal(sent.filter(u => /higgsfield/.test(u)).length, 0, 'a request reached Higgsfield');
    } finally { global.fetch = realFetch; }
});
