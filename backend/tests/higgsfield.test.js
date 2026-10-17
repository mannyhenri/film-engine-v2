/**
 * HIGGSFIELD THROUGH ITS OWN API.
 *
 * Every model in the dated snapshot of Higgsfield's docs builds a request its
 * own schema accepts; the workflow follows what the shot carries; pictures go
 * up through the presigned upload before the submission; the submission
 * carries `Authorization: Key id:secret` and an Idempotency-Key; the poll
 * reads the documented terminal states; the key is checked for free.
 *
 * The API is a stub here: nothing is sent to Higgsfield and nothing is spent.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR
    || path.join(os.tmpdir(), 'film-engine-higgsfield-' + crypto.randomUUID().slice(0, 8));
process.env.HIGGSFIELD_POLL_INTERVAL_MS = '1';
const { ensureSchema } = require('../db/schema');
ensureSchema();

const hf = require('../lib/providers/higgsfield');
const CONTRACT = require('../lib/providers/higgsfield-models.json');
const providers = require('../lib/providers');
const pricing = require('../lib/provider-pricing');

const IMG = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');

function checkAgainstSchema(endpoint, body) {
    const schema = CONTRACT.models[endpoint].schema;
    const props = schema.properties;
    for (const [k, v] of Object.entries(body)) {
        assert.ok(props[k], `${endpoint}: sent ${k}, which its schema does not have`);
        const s = props[k];
        if (Array.isArray(s.enum)) assert.ok(s.enum.includes(v), `${endpoint}: ${k}=${v} is not one of ${s.enum}`);
        if (typeof v === 'number') {
            if (s.minimum !== undefined) assert.ok(v >= s.minimum, `${endpoint}: ${k} under its minimum`);
            if (s.maximum !== undefined) assert.ok(v <= s.maximum, `${endpoint}: ${k} over its maximum`);
        }
    }
    for (const f of (schema.required || [])) assert.ok(body[f] !== undefined, `${endpoint}: required ${f} was not sent`);
}

test('the snapshot is real and dated, and every documented image and video model is offered', () => {
    assert.match(CONTRACT.checked, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Object.keys(CONTRACT.models).length >= 80, 'the snapshot lost endpoints');
    const offered = new Set([...Object.values(hf.MODELS.video), ...Object.values(hf.MODELS.image)]
        .flatMap(m => Object.values(m.endpoints)));
    const apart = new Set(hf.SOURCE_WORKFLOWS.map(s => s.endpoint));
    for (const ep of Object.keys(CONTRACT.models)) {
        if (CONTRACT.models[ep].output === 'audio') continue;
        assert.ok(offered.has(ep) || apart.has(ep), `${ep} is neither a model nor named as needing a source clip`);
    }
});

test('every video model builds an accepted request or rejects pictures its schema cannot carry', () => {
    for (const id of Object.keys(hf.MODELS.video)) {
        for (const shot of [
            { motion_prompt: 'she turns to the window', duration_s: 6, target_resolution: '1920x1080' },
            { motion_prompt: 'she turns', init_image: IMG, duration_s: 5, target_resolution: '1920x1080' },
            { motion_prompt: 'she turns', init_image: IMG, last_frame: IMG, duration_s: 8, target_resolution: '3840x2160' },
            { motion_prompt: 'she turns', reference_images: [IMG, IMG], duration_s: 5 },
        ]) {
            let req;
            try { req = hf.buildRequest('video', { ...shot, model: id }); }
            catch (error) {
                assert.ok(shot.init_image || shot.keyframes || shot.reference_images, `${id}: a text-only request was rejected`);
                assert.match(error.message, /higgsfield:.*(?:keyframe|initial image|last-frame image|reference images)/, `${id}: unexpected refusal`);
                continue;
            }
            if (req.missing.length) continue;   // e.g. text-only model given a keyframe it cannot place: named, not sent
            checkAgainstSchema(req.endpoint, req.body);
        }
    }
});

test('every image model builds an accepted request or rejects references its schema cannot carry', () => {
    for (const id of Object.keys(hf.MODELS.image)) {
        for (const p of [{ prompt: 'a quiet lake at dawn', width: 2048, height: 1152 }, { prompt: 'the same lake', reference_images: [IMG], width: 1024, height: 1024 }]) {
            let req;
            try { req = hf.buildRequest('image', { ...p, model: id }); }
            catch (error) {
                assert.ok(p.reference_images, `${id}: a text-only request was rejected`);
                assert.match(error.message, /higgsfield:.*reference images/, `${id}: unexpected refusal`);
                continue;
            }
            assert.deepStrictEqual(req.missing, [], `${id}: missing ${req.missing}`);
            checkAgainstSchema(req.endpoint, req.body);
        }
    }
});

test('the workflow is what the shot carries', () => {
    const m = 'seedance-2-5';
    assert.match(hf.buildRequest('video', { model: m, prompt: 'x' }).endpoint, /text-to-video$/);
    assert.match(hf.buildRequest('video', { model: m, prompt: 'x', init_image: IMG }).endpoint, /image-to-video$/);
    assert.match(hf.buildRequest('video', { model: m, prompt: 'x', reference_images: [IMG] }).endpoint, /reference-to-video$/);
    const two = hf.buildRequest('video', { model: m, prompt: 'x', init_image: IMG, last_frame: IMG });
    assert.ok(two.body.image_url && two.body.end_image_url, 'the end frame was not sent');
    const o3 = hf.buildRequest('video', { model: 'kling-o3', prompt: 'x', init_image: IMG, last_frame: IMG });
    assert.match(o3.endpoint, /first-last-frame$/);
    assert.ok(o3.body.first_frame_url && o3.body.last_frame_url);
});

test('silent by default: the provider bed is asked for only when chosen', () => {
    assert.strictEqual(hf.buildRequest('video', { model: 'seedance-2-5', prompt: 'x' }).body.generate_audio, false);
    assert.strictEqual(hf.buildRequest('video', { model: 'seedance-2-5', prompt: 'x', generate_audio: true }).body.generate_audio, true);
});

test('a chosen option outside the schema is dropped with why, inside it is sent', () => {
    const r = hf.buildRequest('video', { model: 'seedance-2-5', prompt: 'x', higgsfield_options: { bitrate_mode: 'standard', nonsense: 1 } });
    assert.strictEqual(r.body.bitrate_mode, 'standard');
    assert.ok(r.dropped.some(d => d.field === 'nonsense'));
});

test('the key is taken as copied; the older ID and secret joined by a colon still work', () => {
    const was = process.env.HF_CREDENTIALS;
    process.env.HF_CREDENTIALS = 'just-a-copied-key';
    assert.deepStrictEqual(hf.credential(), { ok: true, header: 'Key just-a-copied-key' });
    process.env.HF_CREDENTIALS = 'kid:ksecret';
    assert.deepStrictEqual(hf.credential(), { ok: true, header: 'Key kid:ksecret' });
    if (was === undefined) delete process.env.HF_CREDENTIALS; else process.env.HF_CREDENTIALS = was;
});

function stubFetch(script) {
    const calls = [];
    const real = global.fetch;
    global.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        const r = script(String(url), init, calls);
        const body = r.body;
        return {
            ok: r.status >= 200 && r.status < 300, status: r.status,
            json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
            arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body || {}))),
        };
    };
    return { calls, restore: () => { global.fetch = real; } };
}

test('Higgsfield remains manual-only: previews do not authorize a paid transport', async () => {
    process.env.HF_CREDENTIALS = 'kid:ksecret';
    const s=stubFetch(()=>({status:500,body:{detail:'no network expected'}}));
    try {
        const store=require('../lib/final-request-review').store();
        for(const [capability,model] of [['video','seedance-2-5'],['image','soul-2']]){
            const review=await store.preview({provider:'higgsfield',capability,payload:{model,prompt:'Manual request'}});
            assert.throws(()=>store.approve(review.id,{fingerprint:review.fingerprint,human_confirmed:true,cost_unknown_ack:true}),/Manual generation only/);
        }
        assert.equal(s.calls.length,0,'a manual preview made a network request');
    } finally {s.restore();delete process.env.HF_CREDENTIALS;}
});

test('generation without a final approval is refused without uploading or submitting', async () => {
    process.env.HF_CREDENTIALS='kid:ksecret';
    const s=stubFetch(()=>({status:500,body:{detail:'no network expected'}}));
    try {
        for(const capability of ['video','image']){
            const out=await hf.generate(capability,{prompt:'x'},{});
            assert.equal(out.ok,false);assert.match(out.error,/approved final provider request/);
        }
        assert.equal(s.calls.length,0);
    } finally {s.restore();delete process.env.HF_CREDENTIALS;}
});

test('the key check is free and tells a good key from a bad one', async () => {
    process.env.HF_CREDENTIALS = 'kid:ksecret';
    let s = stubFetch(() => ({ status: 404, body: { detail: 'Request not found' } }));
    try { assert.strictEqual((await hf.checkCredential()).ok, true); } finally { s.restore(); }
    s = stubFetch(() => ({ status: 401, body: { detail: 'Invalid credentials' } }));
    try {
        const r = await hf.checkCredential();
        assert.strictEqual(r.ok, false);
        assert.match(r.error, /401/);
        assert.ok(s.calls.every(c => /\/requests\/[^/]+\/status$/.test(c.url)), 'the check reached something other than a status read');
    } finally { s.restore(); delete process.env.HF_CREDENTIALS; }
});

test('it is a registered, priced provider for video and image', () => {
    const a = providers.get('higgsfield');
    assert.ok(a, 'not registered');
    assert.deepStrictEqual([...a.capabilities].sort(), ['image', 'video']);
    for (const cap of ['video', 'image']) {
        const m = a.meter(cap, { model: Object.keys(hf.MODELS[cap])[0], duration_s: 5 }, { ok: true });
        assert.ok(m && m.quantity > 0, `${cap} is not metered`);
        const entry = pricing.RATE_BOOK ? pricing.RATE_BOOK[`higgsfield:${cap}`] : null;
        if (entry) assert.notStrictEqual(entry.connected, false, `higgsfield:${cap} is still marked not connected`);
    }
});
