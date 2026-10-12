/**
 * Integration tests for the video generation route (routes/video-gen.js).
 *
 * Spins up the real server with an isolated DB and local mock gateway.
 * Legacy Gridlight generation must fail closed without a reviewed builder;
 * existing local media serving and refusal bookkeeping remain available.
 */
const { describe, it, before, after } = require('node:test');
/*
 * The local gateway is OFF unless switched on, so a suite that stands up a mock
 * Gridlight and generates against it has to enable it — exactly as an operator
 * running the real service does. Set before anything requires the provider
 * registry, which caches the answer.
 */
process.env.GRIDLIGHT_ENABLED = '1';
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const TEST_DIR = path.join(os.tmpdir(), 'film-engine-video-' + crypto.randomUUID().slice(0, 8));
const TEST_PORT = 16000 + Math.floor(Math.random() * 900);
const BASE_URL = `http://localhost:${TEST_PORT}`;

let mockMode = 'binary'; // 'binary' | 'json' | 'jsonBadUrl' | 'error500'
let serverProcess;
let mockGridlight;
let generationCalls = 0;

function request(urlPath, opts = {}) {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.stringify(opts.body) : null;
    return new Promise((resolve, reject) => {
        const req = http.request(`${BASE_URL}${urlPath}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; }
                resolve({ status: res.statusCode, data: parsed, raw: data, headers: res.headers });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function waitForServer(maxRetries = 40) {
    for (let i = 0; i < maxRetries; i++) {
        try { const res = await request('/api/health'); if (res.status === 200) return; } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Server did not start');
}

describe('Video Generation Integration (mock Gridlight)', () => {
    let mockPort, projectId, sceneId, shotId;

    before(async () => {
        fs.mkdirSync(TEST_DIR, { recursive: true });

        // The gateway as the Gridlight Video Integration Brief describes it:
        // a capabilities manifest, POST /video answered as Server-Sent Events,
        // and a gateway-relative video_url served as MP4 bytes.
        const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from('FAKE-MP4-DATA')]);
        mockGridlight = http.createServer((req, res) => {
            if (req.method === 'GET') {
                if (req.url === '/media/capabilities') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ media: [{ medium: 'video', models: [{
                        id: 'ltx-2.5', available: true, has_audio: true,
                        inputs: [{ id: 'keyframe', kind: 'keyframe', field: 'references',
                            accepts: ['image/png', 'image/jpeg', 'image/webp'], max: 8, at: ['start', 'end', 'seconds'] }],
                    }] }] }));
                }
                if (req.url.startsWith('/videos/')) {
                    res.writeHead(200, { 'Content-Type': 'video/mp4' });
                    return res.end(MP4);
                }
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                return res.end('not found');
            }
            generationCalls++;
            let raw = '';
            req.on('data', c => raw += c);
            req.on('end', () => {
                let reqBody = {}; try { reqBody = JSON.parse(raw || '{}'); } catch { /* ignore */ }
                if (mockMode === 'error500') { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"error":"boom"}'); }
                // Gateway-relative, fetched with the same Bearer. A URL that
                // does not serve is the "generated but could not be stored" case.
                const videoUrl = mockMode === 'jsonBadUrl' ? '/missing/nope.mp4' : '/videos/vid_abc123.mp4';
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
                res.write('data: ' + JSON.stringify({ event: 'started' }) + '\n\n');
                res.write('data: ' + JSON.stringify({ event: 'progress', step: 1, total: 2 }) + '\n\n');
                res.write('data: ' + JSON.stringify({ event: 'completed', video_url: videoUrl, seed: 42,
                    model: reqBody.model, has_audio: true }) + '\n\n');
                return res.end();
            });
        });
        await new Promise(r => mockGridlight.listen(0, '127.0.0.1', r));
        mockPort = mockGridlight.address().port;

        serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
            env: {
                ...process.env,
                PORT: String(TEST_PORT),
                FILM_DATA_DIR: TEST_DIR,
                GRIDLIGHT_URL: `http://127.0.0.1:${mockPort}`,
                GRIDLIGHT_API_KEY: 'test-token',
                RATE_LIMIT_MAX_GENERATION: '1000',
            },
            stdio: 'pipe',
        });
        serverProcess.stderr.on('data', () => {});
        serverProcess.stdout.on('data', () => {});
        await waitForServer();

        // Fixtures: project → script → scene → shot
        const proj = await request('/film/projects', { method: 'POST', body: { title: 'Video Test', logline: 'x' } });
        projectId = proj.data.id;
        await request(`/film/projects/${projectId}/script`, {
            method: 'POST',
            body: { content: 'Title: Video Test\n\nINT. OFFICE - DAY\n\nJohn types.\n', format: 'fountain' },
        });
        const scenes = await request(`/film/projects/${projectId}/scenes`);
        sceneId = (scenes.data.scenes || [])[0].id;
        const shots = await request('/film/shots', { method: 'POST', body: { scene_id: sceneId, cards: [{ shot_code: '1A', camera: { shot_type: 'medium', movement: 'static' } }] } });
        shotId = (shots.data.shots || shots.data.created || [])[0].id;
    });

    after(() => {
        if (serverProcess) serverProcess.kill('SIGTERM');
        if (mockGridlight) mockGridlight.close();
        try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('rejects an invalid shot id with 400', async () => {
        const res = await request('/film/shots/not-a-uuid/video/generate', { method: 'POST', body: {} });
        assert.equal(res.status, 400);
    });

    it('returns 404 for an unknown shot', async () => {
        const res = await request('/film/shots/11111111-1111-4111-8111-111111111111/video/generate', { method: 'POST', body: {} });
        assert.equal(res.status, 404);
    });

    for (const mode of ['binary', 'json', 'jsonBadUrl', 'error500']) {
        it(`refuses unreviewed legacy Gridlight generation before any POST (${mode})`, async () => {
            mockMode = mode;
            const res = await request(`/film/shots/${shotId}/video/generate`, { method:'POST', body:{} });
            assert.ok(res.status >= 400, 'an unreviewed request reported success');
            assert.match(res.data.error, /final request|review|approval/i);
            assert.equal(generationCalls, 0, 'unapproved generation reached the gateway');
            const assets = await request(`/film/projects/${projectId}/assets`);
            assert.ok(!(assets.data.assets || []).some(a => a.asset_type === 'video_raw'), 'refusal created generated media');
        });
    }

    it('records refusal as a failed job without a completed job or generated asset', async () => {
        const res = await request(`/film/shots/${shotId}/video`);
        assert.equal(res.status, 200);
        const jobs = res.data.jobs || res.data.video_jobs || [];
        assert.ok(jobs.some(j => j.status === 'failed'));
        assert.ok(!jobs.some(j => j.status === 'complete'));
        assert.equal(generationCalls, 0);
    });

    it('serves existing local MP4 media with the correct MIME type and bytes', async () => {
        // Serving remains available for media saved by an earlier approved job.
        const project = await request(`/film/projects/${projectId}`);
        const root = project.data.assets_dir || project.data.project?.assets_dir;
        const dir = root ? path.join(root, '04 Video', 'Clips') : path.join(TEST_DIR, 'video', projectId);
        fs.mkdirSync(dir, { recursive:true });
        fs.writeFileSync(path.join(dir, '1A.mp4'), Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisomFAKE-MP4-DATA')]));
        const served = await request(`/film/video/${projectId}/1A.mp4`);
        assert.equal(served.status, 200);
        assert.match(served.headers['content-type'], /video\/mp4/);
        assert.match(served.raw, /FAKE-MP4-DATA/);
        assert.equal(generationCalls, 0);
    });

    it('streams video generation events (status → done)', async () => {
        mockMode = 'binary';
        const res = await request(`/film/shots/${shotId}/video/generate/stream`, { method: 'POST', body: {} });
        assert.equal(res.status, 200);
        assert.match(res.raw, /"type":"status"/);
        assert.match(res.raw, /"type":"done"/);
    });

    it('batch stream refuses every unreviewed legacy generation', async () => {
        mockMode = 'binary';
        const res = await request(`/film/projects/${projectId}/video/batch/stream`, { method: 'POST', body: {} });
        assert.equal(res.status, 200);
        assert.match(res.raw, /"type":"status"/);
        assert.match(res.raw, /"type":"shot_failed"/);
        assert.match(res.raw, /final request|review|approval/i);
        assert.doesNotMatch(res.raw, /"type":"shot_complete"/);
        assert.equal(generationCalls, 0);
        assert.match(res.raw, /"type":"result"/);
        assert.match(res.raw, /"type":"done"/);
    });

    it('lists project video jobs', async () => {
        const res = await request(`/film/projects/${projectId}/video`);
        assert.equal(res.status, 200);
        const jobs = res.data.jobs || res.data.video_jobs || [];
        assert.ok(jobs.length >= 1);
    });

    it('refuses before an upstream error and retains failed-job bookkeeping', async () => {
        mockMode = 'error500';
        const res = await request(`/film/shots/${shotId}/video/generate`, { method: 'POST', body: {} });
        assert.ok(res.status >= 400, `expected error status, got ${res.status}`);
        const status = await request(`/film/shots/${shotId}/video`);
        const jobs = status.data.jobs || status.data.video_jobs || [];
        assert.ok(jobs.some(j => j.status === 'failed'), 'expected a failed video job');
        assert.equal(generationCalls, 0, 'even an erroring gateway must not receive an unapproved POST');
    });

    it('rejects a traversal filename on the serve route', async () => {
        const res = await request(`/film/video/${projectId}/..%2f..%2f..%2fetc%2fpasswd`);
        assert.ok(res.status === 400 || res.status === 404, `got ${res.status}`);
    });

    it('404s a missing video file', async () => {
        const res = await request(`/film/video/${projectId}/nonexistent.mp4`);
        assert.equal(res.status, 404);
    });
});
