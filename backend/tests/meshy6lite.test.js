const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-meshy6lite-'));
process.env.MESHY_API_KEY = 'mock-only-not-a-real-key';
process.env.MESHY_BASE_URL = 'https://meshy.invalid';
const { adapter, buildRequest } = require('../lib/providers/meshy');
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
const { threedPayloadFor } = require('../routes/threed');
const { THREED_ENDPOINTS } = require('../lib/gridlight-client');
const { build3DPayload } = require('../lib/threed-prompt');
const { backendId, matchesBackend } = require('../lib/backend-identity');

test('v2 never reuses the retiring backend even at the same version', () => {
    const legacy = { service: 'film-engine', version: '1.0.1' };
    assert.equal(matchesBackend(legacy, '1.0.1'), false);
    assert.equal(matchesBackend({ ...legacy, backend_id: backendId }, '1.0.1'), true);
    assert.equal(matchesBackend({ ...legacy, backend_id: backendId }, '1.0.2'), false);
});

test('gateway defaults translate, but explicit invalid models fail locally', async () => {
    const payload = build3DPayload({ name: 'chair' }, {});
    const translated = threedPayloadFor(adapter, THREED_ENDPOINTS.generate, payload);
    assert.equal(buildRequest(translated).body.ai_model, 'meshy-6-lite');
    let calls = 0;
    const previous = global.fetch;
    global.fetch = async () => { calls++; throw new Error('no network allowed'); };
    try {
        for (const model of ['meshy-5', 'meshy-7', 'typo', 'hunyuan3d']) {
            const p = threedPayloadFor(adapter, THREED_ENDPOINTS.generate, { prompt: 'chair', model }, true);
            const result = await adapter.generate('model3d', p);
            assert.equal(result.status, 400);
            assert.match(result.error, /unsupported 3D model/);
        }
        assert.equal(calls, 0);
    } finally { global.fetch = previous; }
});

test('actual submit bodies use supported models for text, image and refinement', async () => {
    const previous = global.fetch;
    const requests = [];
    global.fetch = async (url, opts) => {
        const body = opts.body ? JSON.parse(opts.body) : null;
        requests.push({ url, method: opts.method, body });
        const data = opts.method === 'POST' ? { result: 'mock-task' }
            : { status: 'SUCCEEDED', model_urls: { glb: 'https://assets.invalid/model.glb' } };
        return { ok: true, status: 200, text: async () => JSON.stringify(data) };
    };
    try {
        for (const model of [undefined, 'meshy-6-lite', 'meshy-6', 'meshy-7.1', 'latest']) {
            requests.length = 0;
            const result = await adapter.generate('model3d', { prompt: 'chair', ...(model ? { model } : {}) });
            assert.equal(result.ok, true);
            const posts = requests.filter(r => r.method === 'POST');
            assert.equal(posts.length, 2);
            assert.equal(posts[0].url, 'https://meshy.invalid/openapi/v2/text-to-3d');
            for (const request of posts) {
                assert.equal(request.body.ai_model, model || 'meshy-6-lite');
                assert.equal(request.body.model_type, undefined);
            }
            assert.equal(posts[1].body.mode, 'refine');
        }
        requests.length = 0;
        assert.equal((await adapter.generate('model3d', { image_url: 'https://assets.invalid/input.png' })).ok, true);
        assert.equal(requests[0].url, 'https://meshy.invalid/openapi/v1/image-to-3d');
        assert.equal(requests[0].body.ai_model, 'meshy-6-lite');
    } finally { global.fetch = previous; }
});

test('saved Meshy pins are honoured and unsupported pins reach validation', async () => {
    const providers = require('../lib/providers');
    const pinned = providers.resolveGenerator('model3d', { model3d: 'meshy', model3d_model: 'typo' });
    assert.equal((await pinned.generate('model3d', { prompt: 'chair' })).status, 400);
    const menu = adapter.modelsByCapability.model3d;
    assert.ok(menu['meshy-6-lite']); assert.ok(menu['meshy-7.1']); assert.ok(menu.latest);
    assert.equal(menu['meshy-5'], undefined);
});

test('migration preserves unrelated settings, malformed JSON, other providers and later edits', () => {
    const Database = require('better-sqlite3');
    const scratch = new Database(':memory:');
    scratch.exec('CREATE TABLE film_projects (id TEXT PRIMARY KEY, provider_config TEXT)');
    const rows = [
        ['m', JSON.stringify({ model3d: 'meshy', model3d_model: 'meshy-5', image: 'muapi', extra: { keep: true } })],
        ['implicit', JSON.stringify({ model3d_model: 'meshy-5', image: 'muapi' })],
        ['other', JSON.stringify({ model3d: 'gridlight', model3d_model: 'meshy-5' })],
        ['bad', 'malformed'], ['new', JSON.stringify({ model3d: 'meshy', model3d_model: 'meshy-7.1' })],
    ];
    for (const row of rows) scratch.prepare('INSERT INTO film_projects VALUES (?, ?)').run(...row);
    scratch.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/129_meshy6lite_config.sql'), 'utf8'));
    const get = id => scratch.prepare('SELECT provider_config FROM film_projects WHERE id=?').get(id).provider_config;
    assert.deepEqual(JSON.parse(get('m')), { ...JSON.parse(rows[0][1]), model3d_model: 'meshy-6-lite' });
    for (const [id, original] of rows.slice(2)) assert.equal(get(id), original);
    assert.equal(scratch.prepare('SELECT count(*) AS n FROM film_meshy6lite_config_backup').get().n, 2);
    scratch.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run('{"later":"edit"}', 'implicit');
    scratch.exec(fs.readFileSync(path.join(__dirname, '../../docs/meshy6lite-rollback.sql'), 'utf8'));
    assert.equal(get('m'), rows[0][1]);
    assert.equal(get('implicit'), '{"later":"edit"}');
    scratch.close();
});

test('pricing metadata uses current API mesh-only costs, retaining historical Meshy 5', () => {
    const { rateFor } = require('../lib/provider-pricing');
    assert.equal(rateFor('meshy', 'model3d', 'meshy-6-lite').native_per_unit, 5);
    assert.equal(rateFor('meshy', 'model3d', 'meshy-7.1').native_per_unit, 20);
    assert.equal(rateFor('meshy', 'model3d', 'meshy-5').native_per_unit, 10);
    const { priceUsage } = require('../lib/provider-pricing');
    for (const [payload, credits] of [[{ prompt: 'chair', refine: false }, 5], [{ prompt: 'chair' }, 15],
        [{ operation: 'image_to_mesh', image_url: 'mock' }, 15], [{ model: 'latest', prompt: 'chair' }, 30]]) {
        const usage = adapter.meter('model3d', payload, null);
        const estimate = priceUsage({ provider: 'meshy', capability: 'model3d', ...usage });
        assert.equal(estimate.native_quantity, credits);
        assert.equal(estimate.provider_confirmed, false);
    }
    assert.equal(adapter.meter('model3d', { prompt: 'chair' }, { provider_model: 'meshy-6-lite', meta: { textured: false } }).native_charged, 5);
});

test.after(() => db.close());
