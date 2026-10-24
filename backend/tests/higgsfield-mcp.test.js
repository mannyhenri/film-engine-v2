'use strict';
/**
 * Higgsfield, signed in: Film Engine as an app on the person's own account.
 *
 *   - the sign-in's tokens go to the secret store, never to the plaintext
 *     credentials table, and the page only ever sees "connected";
 *   - the MCP client opens a session, reads JSON and SSE answers, and refreshes
 *     an expiring token before it is refused;
 *   - every capability builds the tool call the final review shows, priced in
 *     Higgsfield's own credits;
 *   - while Higgsfield is a manual vendor nothing is sent, and once sending is
 *     switched on an approved request goes up, generates, waits and downloads
 *     with its bytes proven against the approval.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.FILM_DATA_DIR = path.join(os.tmpdir(), 'film-engine-hfmcp-' + crypto.randomUUID().slice(0, 8));
process.env.FILM_SECRET_STORE = 'memory';
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
const secrets = require('../lib/secret-store');
const hf = require('../lib/providers/higgsfield-mcp');
const providers = require('../lib/providers');
const { handleProviders } = require('../routes/providers');

const PNG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
const MCP = hf.MCP_URL;

function call(method, parts, { body, query, host } = {}) {
    return new Promise(resolve => {
        const res = { statusCode: 200, headers: {}, writeHead(s, h) { this.statusCode = s; this.headers = h || {}; },
            end(t) { let json = null; try { json = JSON.parse(t); } catch (_) { /* html */ } resolve({ status: this.statusCode, json, text: String(t || '') }); } };
        Promise.resolve(handleProviders({ method, body: body || {}, headers: { host: host || 'localhost:3100' } }, res, ['film', ...parts], query || {}));
    });
}

/** A fake Higgsfield: OAuth discovery + registration + token, and an MCP server speaking JSON or SSE. */
function fakeHiggsfield({ sse = false, onTool } = {}) {
    const seen = { tools: [], refresh: 0, puts: 0, sessions: 0 };
    const reply = (obj, headers = {}) => {
        const text = sse ? `event: message\ndata: ${JSON.stringify(obj)}\n\n` : JSON.stringify(obj);
        return new Response(text, { status: 200, headers: { 'content-type': sse ? 'text/event-stream' : 'application/json', ...headers } });
    };
    const fetch = async (url, init = {}) => {
        const u = String(url);
        if (u.endsWith('/.well-known/oauth-protected-resource')) return Response.json({ resource: MCP, authorization_servers: ['https://auth.example.test'], scopes_supported: ['openid', 'offline_access'] });
        if (u === 'https://auth.example.test/.well-known/oauth-authorization-server') return Response.json({ authorization_endpoint: 'https://auth.example.test/authorize', token_endpoint: 'https://auth.example.test/token', registration_endpoint: 'https://auth.example.test/register' });
        if (u === 'https://auth.example.test/register') return Response.json({ client_id: 'client-1', registration_access_token: 'reg-secret', registration_client_uri: 'https://auth.example.test/register/client-1' });
        if (u === 'https://auth.example.test/token') {
            const form = new URLSearchParams(init.body);
            if (form.get('grant_type') === 'refresh_token') { seen.refresh++; return Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }); }
            return Response.json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 });
        }
        if (u.startsWith('https://upload.example.test/')) { seen.puts++; return new Response('', { status: 200 }); }
        if (u.startsWith('https://cdn.example.test/')) return new Response(Buffer.from('generated-bytes'), { status: 200 });
        if (u.split('#')[0] === MCP) {
            seen.auth = init.headers && (init.headers.Authorization || init.headers.authorization);
            const msg = JSON.parse(init.body);
            if (msg.method === 'initialize') { seen.sessions++; return reply({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }, { 'mcp-session-id': 'session-' + seen.sessions }); }
            if (msg.method === 'notifications/initialized') return new Response('', { status: 202 });
            if (msg.method === 'tools/list') return reply({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'balance' }, { name: 'generate_image' }] } });
            if (msg.method === 'tools/call') {
                const { name, arguments: args } = msg.params;
                seen.tools.push({ name, args, session: init.headers['Mcp-Session-Id'] });
                const answer = (onTool && onTool(name, args)) || ({
                    balance: { credits: 2950, subscription_plan_type: 'ultra' },
                    media_upload: { files: [{ media_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://upload.example.test/put', upload_headers: { 'Content-Type': 'image/png' } }] },
                    media_confirm: { confirmed: true },
                    generate_image: { jobs: [{ job_id: '22222222-2222-4222-8222-222222222222', status: 'queued' }] },
                    jobs_wait: { jobs: [{ index: 0, job_id: '22222222-2222-4222-8222-222222222222', status: 'completed', results: [{ url: 'https://cdn.example.test/out.png' }] }], all_terminal: true },
                })[name];
                return reply({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(answer) }] } });
            }
        }
        throw new Error('unexpected fetch ' + u);
    };
    return { fetch, seen };
}

async function signIn(fake) {
    const real = global.fetch; global.fetch = fake.fetch;
    try {
        const start = await call('GET', ['providers', 'higgsfield-mcp', 'connect']);
        assert.equal(start.status, 200, start.text);
        const state = new URL(start.json.authorize_url).searchParams.get('state');
        const done = await call('GET', ['providers', 'higgsfield-mcp', 'callback'], { query: { code: 'the-code', state } });
        assert.equal(done.status, 200, done.text);
        return start.json.authorize_url;
    } finally { global.fetch = real; }
}

test.afterEach(() => { secrets.remove('higgsfield-mcp'); db.prepare("DELETE FROM film_provider_credentials WHERE provider LIKE '%higgsfield-mcp%'").run(); hf.adapter.reset(); });

test('the secret store keeps, merges and forgets, and says where it keeps', () => {
    secrets.set('probe', { a: 1 });
    secrets.merge('probe', { b: 2 });
    assert.deepEqual(secrets.get('probe'), { a: 1, b: 2 });
    secrets.remove('probe');
    assert.equal(secrets.get('probe'), null);
    assert.match(secrets.where(), /memory/);
});

test('signing in keeps every token out of the credentials table, and the page sees only "connected"', async () => {
    const fake = fakeHiggsfield();
    const url = await signIn(fake);
    assert.match(url, /code_challenge_method=S256/, 'the sign-in is not PKCE');
    const row = db.prepare("SELECT api_key, meta FROM film_provider_credentials WHERE provider = 'higgsfield-mcp'").get();
    const meta = JSON.parse(row.meta);
    for (const k of ['access_token', 'refresh_token', 'registration_access_token', 'client_secret', 'expires_at']) {
        assert.equal(meta[k], undefined, `${k} was written to the plaintext table`);
    }
    assert.equal(meta.client_id, 'client-1', 'the public client id is kept to sign in again');
    assert.equal(meta._pkce_verifier, undefined, 'the PKCE verifier outlived the sign-in');
    const kept = secrets.get('higgsfield-mcp');
    assert.equal(kept.access_token, 'access-1');
    assert.equal(kept.refresh_token, 'refresh-1');
    assert.equal(kept.registration_access_token, 'reg-secret');

    const catalog = await call('GET', ['providers']);
    const tile = catalog.json.providers.find(p => p.id === 'higgsfield-mcp');
    assert.equal(tile.credentials.connected, true);
    assert.ok(!catalog.text.includes('access-1') && !catalog.text.includes('refresh-1'), 'a token reached the page');
    assert.equal(providers.isProviderConfigured('higgsfield-mcp'), true, 'signed in but not configured');
    assert.equal(providers.resolveId('video', {}), 'higgsfield-mcp', 'signed in, Higgsfield is the video default');
    assert.equal(providers.resolveId('image', {}), 'higgsfield-mcp', 'signed in, Higgsfield makes the house standard');

    const out = await call('POST', ['providers', 'higgsfield-mcp', 'disconnect']);
    assert.equal(out.status, 200);
    assert.equal(secrets.get('higgsfield-mcp'), null, 'disconnecting left the tokens behind');
    // Still the provider (the hand-over and test mode need no sign-in); the page says it is signed out.
    assert.equal(providers.isProviderConfigured('higgsfield-mcp'), true);
    const after = (await call('GET', ['providers'])).json.providers.find(p => p.id === 'higgsfield-mcp');
    assert.equal(after.credentials.connected, false, 'signed out still reads as connected');
});

test('the account reads credits and plan over MCP, as JSON or as an event stream', async () => {
    for (const sse of [false, true]) {
        const fake = fakeHiggsfield({ sse });
        await signIn(fake);
        const real = global.fetch; global.fetch = fake.fetch;
        try {
            const r = await call('GET', ['providers', 'higgsfield-mcp', 'account']);
            assert.equal(r.status, 200, r.text);
            assert.equal(r.json.credits, 2950);
            assert.equal(r.json.plan, 'ultra');
            assert.equal(fake.seen.auth, 'Bearer access-1', 'the call was not made with the signed-in token');
            assert.equal(fake.seen.tools.at(-1).session, 'session-1', 'the call did not carry its MCP session');
        } finally { global.fetch = real; secrets.remove('higgsfield-mcp'); hf.adapter.reset(); }
    }
});

test('an expiring token is refreshed before the call, and the new one is kept', async () => {
    const fake = fakeHiggsfield();
    await signIn(fake);
    secrets.merge('higgsfield-mcp', { expires_at: Date.now() - 1000 });
    const real = global.fetch; global.fetch = fake.fetch;
    try {
        const b = await hf.balance();
        assert.equal(b.ok, true, b.error);
        assert.equal(fake.seen.refresh, 1, 'the expired token was not refreshed');
        assert.equal(secrets.get('higgsfield-mcp').access_token, 'access-2');
        assert.equal(fake.seen.auth, 'Bearer access-2');
    } finally { global.fetch = real; }
});

test('signed out, every call says how to sign in rather than failing somewhere else', async () => {
    const b = await hf.balance();
    assert.equal(b.ok, false);
    assert.equal(b.status, 401);
    assert.match(b.error, /Connect Higgsfield/);
});

test('every served capability builds the tool call the review shows, and the rest are named as not served', () => {
    const cases = {
        image: [{ prompt: 'a hall', reference_images: [PNG], target_resolution: '3840x2160' }, 'generate_image'],
        video: [{ motion_prompt: 'push in', init_image: PNG, duration_s: 7, target_resolution: '1920x1080' }, 'generate_video'],
        voice: [{ text: 'We go at dawn.' }, 'generate_audio'],
        post: [{ source_video: '/tmp/clip.mp4', target_resolution: '3840x2160' }, 'upscale_video'],
        model3d: [{ image_url: PNG }, 'generate_3d'],
    };
    for (const cap of hf.adapter.capabilities) {
        const [payload, tool] = cases[cap];
        const req = hf.buildRequest(cap, payload);
        assert.equal(req.tool, tool, `${cap} reaches the wrong tool`);
        assert.equal(req.url, `${MCP}#${tool}`, `${cap}: the reviewed endpoint does not name its tool`);
    }
    for (const cap of ['sfx', 'ambient', 'lipsync', 'world']) {
        assert.equal(hf.adapter.supports(cap), false, `${cap} is claimed though Higgsfield offers no tool for it`);
        assert.ok(hf.adapter.notServed[cap], `${cap} is not served and does not say why`);
    }
    const img = hf.buildRequest('image', cases.image[0]);
    assert.equal(img.body.model, 'nano_banana_pro', 'the house standard is not Nano Banana Pro');
    assert.equal(img.body.resolution, '4k', 'a 4K project did not ask for the 4k tier');
    assert.equal(img.body.use_unlim, false, 'a request left the server free to ask about free generations');
    const vid = hf.buildRequest('video', cases.video[0]);
    assert.equal(vid.body.mode, 'omni_reference', 'Seedance 2.5 reads pictures only in omni-reference');
    assert.equal(vid.body.generate_audio, false, 'a clip was given its own sound unasked');
    const edit = hf.buildRequest('video', { videoUri: '/tmp/clip.mp4', promptText: 'Replace the background: rain.', sourceSeconds: 6 });
    assert.equal(edit.body.mode, 'video_edit');
    assert.deepEqual(edit.body.medias.map(m => m.role), ['video_references']);
    assert.deepEqual(hf.toolArguments('upscale_video', hf.buildRequest('post', cases.post[0]).body).params.video_id, '/tmp/clip.mp4',
        'the upscale tool is not handed its one clip as video_id');
});

test('every request is priced in Higgsfield credits from its own quotes, and the meter records them', () => {
    const img = hf.buildRequest('image', { prompt: 'x', target_resolution: '2048x1080' });
    assert.equal(hf.creditsFor('image', img.body, img), 2, 'Nano Banana Pro at 2k is 2 credits');
    const vid = hf.buildRequest('video', { prompt: 'x', duration_s: 5, target_resolution: '1280x720' });
    assert.equal(hf.creditsFor('video', vid.body, vid), 35, 'Seedance 2.5 at 720p is 7 credits a second');
    const usage = hf.adapter.meter('video', { prompt: 'x', duration_s: 5, target_resolution: '1280x720' }, null);
    assert.deepEqual([usage.unit, usage.quantity, usage.native_charged], ['second', 5, 35]);
    const priced = require('../lib/provider-pricing').priceUsage({ provider: 'higgsfield-mcp', capability: 'video', ...usage });
    assert.equal(priced.native_quantity, 35, 'Budget would not see the credits');
    assert.ok(priced.amount_usd > 0, 'the credits were not turned into money');
    const quote = require('../lib/final-request-review').quoteFor({ provider: 'higgsfield-mcp', capability: 'video', model: 'seedance_2_5', body: vid.body, metadata: vid });
    assert.equal(quote.credits, 35, 'the final review does not show the credits');
});

async function approvedImage(store) {
    const review = await store.preview({ provider: 'higgsfield-mcp', capability: 'image', payload: { prompt: 'A lighthouse at dusk', reference_images: [PNG] } });
    return { review, token: store.approve(review.id, { fingerprint: review.fingerprint, human_confirmed: true, cost_unknown_ack: true }) };
}

test('while Higgsfield is handed over, an approval is refused and nothing reaches it', async () => {
    const contract = require('../lib/final-request-review');
    const store = contract.createFinalRequestStore(db);
    const review = await store.preview({ provider: 'higgsfield-mcp', capability: 'image', payload: { prompt: 'A lighthouse at dusk' } });
    assert.equal(review.snapshot.body.prompt, 'A lighthouse at dusk', 'the hand-over does not carry the exact prompt');
    assert.throws(() => store.approve(review.id, { fingerprint: review.fingerprint, human_confirmed: true }), /Manual generation only/);
});

test('once sending is on, an approved request uploads, generates, waits and downloads, with its bytes proven', async () => {
    const manual = require('../lib/manual-generation');
    manual.MANUAL_PROVIDERS.delete('higgsfield-mcp');
    const contract = require('../lib/final-request-review');
    const original = contract.store;
    const memory = new (require('better-sqlite3'))(':memory:');
    memory.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/141_final_request_reviews.sql'), 'utf8'));
    const store = contract.createFinalRequestStore(memory);
    contract.store = () => store;
    const fake = fakeHiggsfield();
    try {
        await signIn(fake);
        const { token } = await approvedImage(store);
        const real = global.fetch; global.fetch = fake.fetch;
        let out;
        try { out = await hf.generate('image', {}, { finalRequest: token }); }
        finally { global.fetch = real; }
        assert.equal(out.ok, true, out.error);
        assert.equal(Buffer.from(out.data).toString(), 'generated-bytes');
        assert.equal(out.provider_job_id, '22222222-2222-4222-8222-222222222222');
        const names = fake.seen.tools.map(t => t.name);
        assert.deepEqual(names, ['media_upload', 'media_confirm', 'generate_image', 'jobs_wait'], `the calls were ${names}`);
        assert.equal(fake.seen.puts, 1, 'the reference was not uploaded');
        const gen = fake.seen.tools.find(t => t.name === 'generate_image').args.params;
        assert.equal(gen.prompt, 'A lighthouse at dusk');
        assert.deepEqual(gen.medias, [{ role: 'image_references', value: '11111111-1111-4111-8111-111111111111' }],
            'the picture did not travel as its uploaded media id');
        const receipt = memory.prepare('SELECT * FROM film_generation_transport_receipts').get();
        assert.ok(receipt, 'the send left no transport receipt');
    } finally {
        manual.MANUAL_PROVIDERS.add('higgsfield-mcp');
        contract.store = original;
        memory.close();
    }
});

/* ── test mode: written down, never sent ─────────────────────────────── */

function setTestMode(on) {
    return new Promise(resolve => {
        const res = { writeHead(s) { this.s = s; }, end(t) { resolve({ status: this.s, json: JSON.parse(t) }); } };
        require('../routes/app-settings').handleAppSettings({ method: 'PUT', body: { generation_test_mode: on }, headers: {} }, res);
    });
}

test('test mode: an approved Higgsfield request is saved with its pictures, and nothing at all is fetched', async () => {
    const put = await setTestMode(true);
    assert.equal(put.status, 200, JSON.stringify(put.json));
    const contract = require('../lib/final-request-review');
    const original = contract.store;
    const memory = new (require('better-sqlite3'))(':memory:');
    memory.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/141_final_request_reviews.sql'), 'utf8'));
    const store = contract.createFinalRequestStore(memory);
    contract.store = () => store;
    const real = global.fetch;
    const fetched = [];
    global.fetch = async (u) => { fetched.push(String(u)); throw new Error('test mode reached the network: ' + u); };
    try {
        assert.equal(hf.isConnected(), false, 'the test must run signed out: test mode needs no sign-in');
        const { review, token } = await approvedImage(store);
        assert.equal(review.test_mode, true, 'the review does not tell the dialog that Send saves a test');
        const out = await hf.generate('image', {}, { finalRequest: token });
        assert.equal(out.ok, false);
        assert.equal(out.code, 'GENERATION_TEST_MODE');
        assert.match(out.error, /nothing was sent to Higgsfield and no credits were spent/);
        assert.deepEqual(fetched, [], 'test mode touched the network');
        const saved = JSON.parse(fs.readFileSync(path.join(out.test_request_dir, 'request.json'), 'utf8'));
        assert.equal(saved.test_mode, true);
        assert.equal(saved.tool, 'generate_image');
        assert.equal(saved.model, 'nano_banana_pro');
        assert.equal(saved.prompt, 'A lighthouse at dusk');
        assert.equal(saved.arguments.prompt, 'A lighthouse at dusk', 'the arguments are not the ones that would be sent');
        assert.equal(saved.files.length, 1);
        assert.equal(saved.files[0].role, 'image_references');
        assert.equal(saved.files[0].mime, 'image/png');
        assert.ok(fs.existsSync(path.join(out.test_request_dir, saved.files[0].file)), 'the picture was not saved beside the request');
        const bytes = fs.readFileSync(path.join(out.test_request_dir, saved.files[0].file));
        assert.equal(require('crypto').createHash('sha256').update(bytes).digest('hex'), saved.files[0].sha256, 'the saved picture is not the one that would go');
        assert.equal(saved.estimated.credits, 2, 'the test request does not say what it would have cost');
        assert.ok(!JSON.stringify(saved.arguments).includes('base64'), 'the JSON carries picture bytes instead of naming the file');
    } finally {
        global.fetch = real;
        contract.store = original;
        memory.close();
        await setTestMode(false);
    }
});

test('test mode off: Higgsfield is handed over again, and the wire refuses a test-mode send outright', async () => {
    const manual = require('../lib/manual-generation');
    assert.equal(manual.isManual('higgsfield-mcp', 'image'), true, 'with test mode off Higgsfield is not a hand-over');
    await setTestMode(true);
    try {
        assert.equal(manual.isManual('higgsfield-mcp', 'image'), false);
        assert.equal(manual.isManual('seedance', 'video'), true, 'test mode reached a vendor it does not cover');
        const transport = require('../lib/generation-transport');
        const req = { url: `${MCP}#generate_image`, body: {} };
        transport.attach(req, { store: {}, reviewId: 'r', snapshot: { provider: 'higgsfield-mcp', capability: 'image', endpoint: req.url, body: {}, references: [] } });
        await assert.rejects(transport.dispatch(req, req.url, { method: 'POST', body: '{}' }), /Test mode is on/);
    } finally { await setTestMode(false); }
});
