/**
 * ComfyUI on the PC (lib/comfyui.js, routes/comfyui.js), against a fake ComfyUI HTTP server.
 *
 * The fixture graph has the shape of the real "storyboard shot to video" workflow on the PC
 * (MiniMaxH3ReferenceToVideo, node ids from the peer's export): prompt 138.value, seed 129.noise_seed,
 * four CustomCombo dropdowns (choice + index), six image and three audio loaders feeding
 * ref_images.ref_image_N / ref_audios.ref_audio_N, SaveVideo 92. Checks, over the whole manifest:
 *   - every prompt/seed/option/slot the manifest names is set in the queued graph; combos get choice AND index
 *   - for every subset of filled slots, unfilled loaders are removed and the refs renumber from 0 in order
 *   - a manifest naming a missing node or input is caught, for every reference it holds
 *   - a job uploads, queues, waits, downloads the file; a ComfyUI error and an unreachable PC fail with a reason
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-comfyui-'));
process.env.FILM_DATA_DIR = path.join(TMP, 'data');
process.env.FILM_COMFYUI_OUT = path.join(TMP, 'out');
process.env.FILM_COMFYUI_POLL_MS = '20';
const comfy = require('../lib/comfyui');
const { handleComfyUI } = require('../routes/comfyui');

/* ---------- the fixture workflow ---------- */
const IMG = ['301', '302', '303', '304', '305', '306'];
const AUD = ['401', '402', '403'];
const combo = (choice) => ({ class_type: 'CustomCombo', inputs: { choice, index: 0 } });
function graph() {
    const g = {
        136: { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { prompt: ['138', 0], noise: ['129', 0], width: ['201', 0], length: ['211', 0] } },
        138: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'saved prompt' } },
        129: { class_type: 'RandomNoise', inputs: { noise_seed: 1 } },
        200: combo('16:9 (864x480)'), 210: combo('5 s'), 220: combo('Turbo 4-step (draft)'), 230: combo('SDR (standard)'),
        201: { class_type: 'ComfyMathExpression', inputs: { a: ['200', 1] } },
        211: { class_type: 'ComfyMathExpression', inputs: { a: ['210', 1] } },
        92: { class_type: 'SaveVideo', inputs: { video: ['136', 0], filename_prefix: 'ComfyUI Videos/shot' } },
    };
    IMG.forEach((id, i) => { g[id] = { class_type: 'LoadImage', inputs: { image: `saved${i}.png` } }; g[136].inputs[`ref_images.ref_image_${i}`] = [id, 0]; });
    AUD.forEach((id, i) => { g[id] = { class_type: 'LoadAudio', inputs: { audio: `saved${i}.wav` } }; g[136].inputs[`ref_audios.ref_audio_${i}`] = [id, 0]; });
    return g;
}
const enumOpt = (id, node, labels) => ({ id, label: id, node, input: 'choice', type: 'enum', index: true, choices: labels.map((label, index) => ({ label, index })), default: 0 });
const MANIFEST = {
    name: 'Storyboard shot to video (draft 480p)', kind: 'video', workflow: 'storyboard_shot_to_video.api.json',
    prompt: { node: '138', input: 'value' }, seed: { node: '129', input: 'noise_seed' },
    images: IMG.map((node, i) => ({ node, input: 'image', role: ['storyboard', 'character1', 'character2', 'location', 'prop', 'prop2'][i] })),
    audio: AUD.map((node, i) => ({ node, input: 'audio', role: `dialogue${i + 1}` })),
    options: [
        enumOpt('aspect', '200', ['16:9 (864x480)', '9:16 (480x864)', '1:1 (480x480)', '2.39:1 (1152x480)']),
        enumOpt('duration', '210', ['5 s', '8 s', '10 s', '15 s']),
        enumOpt('quality', '220', ['Turbo 4-step (draft)', 'Full 20-step (final)']),
        enumOpt('color', '230', ['SDR (standard)', 'HDR (HLG, 10-bit)']),
    ],
    outputs: { node: '92' },
};

/* ---------- buildPrompt, over the whole manifest ---------- */
test('every option the manifest names is set; enum combos get both choice and index', () => {
    for (const o of MANIFEST.options) {
        for (const c of o.choices) {
            const g = comfy.buildPrompt(MANIFEST, graph(), { options: { [o.id]: c.label }, images: ['a.png'], audio: [] });
            assert.strictEqual(g[o.node].inputs.choice, c.label, `${o.id} choice`);
            assert.strictEqual(g[o.node].inputs.index, c.index, `${o.id} index`);
        }
        assert.throws(() => comfy.buildPrompt(MANIFEST, graph(), { options: { [o.id]: 'nope' } }), /not one of its choices/);
    }
    const g = comfy.buildPrompt(MANIFEST, graph(), { prompt: 'Mara slaps Dev', seed: 42, images: [], audio: [] });
    assert.strictEqual(g[138].inputs.value, 'Mara slaps Dev');
    assert.strictEqual(g[129].inputs.noise_seed, 42);
    const r = comfy.buildPrompt(MANIFEST, graph(), {});
    assert.ok(Number.isInteger(r[129].inputs.noise_seed) && r[129].inputs.noise_seed !== 1, 'a random seed when none is given');
    assert.strictEqual(r[138].inputs.value, 'saved prompt', 'unset prompt keeps the saved one');
});

test('for every subset of filled slots, unfilled loaders go and refs renumber from 0 in slot order', () => {
    for (const [refs, key, prefix] of [[IMG, 'images', 'ref_images.ref_image_'], [AUD, 'audio', 'ref_audios.ref_audio_']]) {
        for (let mask = 0; mask < 2 ** refs.length; mask++) {
            const given = refs.map((_, i) => (mask & (1 << i) ? `in/${i}.x` : null));
            const g = comfy.buildPrompt(MANIFEST, graph(), { [key]: given });
            const filled = refs.filter((_, i) => given[i]);
            refs.forEach((id, i) => assert.strictEqual(!!g[id], !!given[i], `slot ${i} present iff filled (mask ${mask})`));
            filled.forEach(id => assert.strictEqual(g[id].inputs[key === 'images' ? 'image' : 'audio'], given[refs.indexOf(id)]));
            const keys = Object.keys(g[136].inputs).filter(k => k.startsWith(prefix));
            assert.deepStrictEqual(keys.map(k => g[136].inputs[k][0]), filled, `refs in order (mask ${mask})`);
            assert.deepStrictEqual(keys.map(k => Number(k.slice(prefix.length))).sort((a, b) => a - b), filled.map((_, i) => i), `contiguous from 0 (mask ${mask})`);
            for (const n of Object.values(g)) for (const v of Object.values(n.inputs)) if (Array.isArray(v) && v.length === 2) assert.ok(g[v[0]], `no link to a removed node (mask ${mask})`);
        }
    }
});

test('validate catches every reference that points at a missing node or input', () => {
    assert.deepStrictEqual(comfy.validate(MANIFEST, graph()), []);
    const refs = [['prompt'], ['seed'], ...MANIFEST.images.map((_, i) => ['images', i]), ...MANIFEST.audio.map((_, i) => ['audio', i]), ...MANIFEST.options.map((_, i) => ['options', i])];
    for (const where of refs) {
        for (const bad of [{ node: '9999' }, { input: 'no_such_input' }]) {
            const m = JSON.parse(JSON.stringify(MANIFEST));
            const ref = where.length === 1 ? m[where[0]] : m[where[0]][where[1]];
            Object.assign(ref, bad);
            assert.ok(comfy.validate(m, graph()).length > 0, `${where.join(' ')} with ${JSON.stringify(bad)}`);
        }
    }
});

/* ---------- a fake ComfyUI ---------- */
function fakeComfy({ fail = false } = {}) {
    const state = { uploads: [], prompts: [], history: {} };
    const files = { 'storyboard_shot_to_video.fe.json': MANIFEST, 'storyboard_shot_to_video.api.json': graph(),
        'broken.fe.json': { ...MANIFEST, workflow: 'storyboard_shot_to_video.api.json', prompt: { node: '777', input: 'value' } } };
    const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const send = (code, data, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
        let body = [];
        req.on('data', c => body.push(c));
        req.on('end', () => {
            body = Buffer.concat(body);
            if (u.pathname === '/system_stats') return send(200, { system: { comfyui_version: '0.43.1' }, devices: [{ name: 'cuda:0 NVIDIA', vram_total: 24e9, vram_free: 20e9 }] });
            if (u.pathname === '/queue' && req.method === 'GET') return send(200, { queue_running: state.prompts.map((_, i) => `p${i + 1}`).filter(id => !state.history[id]).map(id => [0, id]), queue_pending: [] });
            if (u.pathname === '/userdata') return u.searchParams.get('dir') === 'workflows/film-engine' ? send(200, Object.keys(files)) : send(404, {});
            if (u.pathname.startsWith('/userdata/')) {
                const f = decodeURIComponent(u.pathname.slice('/userdata/'.length)).replace('workflows/film-engine/', '');
                return files[f] ? send(200, files[f]) : send(404, {});
            }
            if (u.pathname === '/upload/image') {
                const name = /filename="([^"]+)"/.exec(body.toString('latin1'))[1];
                state.uploads.push(name);
                return send(200, { name, subfolder: 'film-engine', type: 'input' });
            }
            if (u.pathname === '/prompt') {
                const p = JSON.parse(body.toString());
                const id = `p${state.prompts.length + 1}`;
                state.prompts.push(p.prompt);
                setTimeout(() => {
                    state.history[id] = fail
                        ? { status: { status_str: 'error', completed: false, messages: [['execution_error', { node_type: 'MiniMaxH3ReferenceToVideo', exception_message: 'CUDA out of memory' }]] }, outputs: {} }
                        : { status: { status_str: 'success', completed: true }, outputs: { 92: { images: [{ filename: 'shot_00001.mp4', subfolder: 'ComfyUI Videos', type: 'output' }], animated: [true] } } };
                }, 60);
                return send(200, { prompt_id: id, number: 1, node_errors: {} });
            }
            if (u.pathname.startsWith('/history/')) { const id = u.pathname.split('/')[2]; return send(200, state.history[id] ? { [id]: state.history[id] } : {}); }
            if (u.pathname === '/view') return send(200, Buffer.from('FAKE-MP4:' + u.searchParams.get('filename')), 'video/mp4');
            return send(404, {});
        });
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => { process.env.FILM_COMFYUI_URL = `http://127.0.0.1:${server.address().port}`; r({ server, state }); }));
}
const route = (method, url, body) => new Promise(resolve => {
    const res = { writeHead(code) { this.code = code; }, end(s) { resolve({ code: this.code, body: JSON.parse(s) }); } };
    handleComfyUI({ method, body, headers: {} }, res, url.split('/').filter(Boolean));
});
async function finish(id) {
    for (;;) { const { body } = await route('GET', `/film/comfyui/jobs/${id}`); if (['done', 'failed'].includes(body.job.status)) return body.job; await new Promise(r => setTimeout(r, 20)); }
}

test('status, workflow list, and a full job: upload, queue, wait, download', async () => {
    const { server, state } = await fakeComfy();
    try {
        const st = await route('GET', '/film/comfyui/status');
        assert.strictEqual(st.body.ok, true);
        assert.strictEqual(st.body.version, '0.43.1');
        const wf = await route('GET', '/film/comfyui/workflows');
        const good = wf.body.workflows.find(w => w.slug === 'storyboard_shot_to_video');
        assert.strictEqual(good.ready, true);
        assert.deepStrictEqual(good.options.map(o => o.id), MANIFEST.options.map(o => o.id));
        assert.ok(good.options.every(o => !('node' in o)), 'node ids stay on the server');
        const broken = wf.body.workflows.find(w => w.slug === 'broken');
        assert.strictEqual(broken.ready, false);
        assert.match(broken.problems.join(), /node 777/);

        const own = path.join(process.env.FILM_DATA_DIR, 'comfyui-test'); fs.mkdirSync(own, { recursive: true });
        const frame = path.join(own, '4C.png'); fs.writeFileSync(frame, 'png');
        const wav = path.join(own, '4C dialogue.wav'); fs.writeFileSync(wav, 'wav');
        const start = await route('POST', '/film/comfyui/jobs', { workflow: 'storyboard_shot_to_video', prompt: 'Mara slaps Dev', seed: 7,
            options: { aspect: '2.39:1 (1152x480)', duration: '8 s' }, images: [frame], audio: [wav] });
        assert.strictEqual(start.code, 202);
        const job = await finish(start.body.job.id);
        assert.strictEqual(job.status, 'done', job.error);
        assert.deepStrictEqual(state.uploads.map(n => n.replace(/^[0-9a-f]{12}-/, '')), ['4C.png', '4C dialogue.wav'], 'named by a hash of the bytes, then the file name');
        const sent = state.prompts[0];
        assert.strictEqual(sent[301].inputs.image, `film-engine/${state.uploads[0]}`);
        assert.strictEqual(sent[401].inputs.audio, `film-engine/${state.uploads[1]}`);
        assert.ok(!sent[302] && !sent[402], 'unfilled slots removed');
        assert.deepStrictEqual([sent[200].inputs.choice, sent[200].inputs.index, sent[210].inputs.index], ['2.39:1 (1152x480)', 3, 1]);
        assert.strictEqual(job.outputs.length, 1);
        assert.strictEqual(fs.readFileSync(job.outputs[0].path, 'utf8'), 'FAKE-MP4:shot_00001.mp4');
        assert.ok(job.outputs[0].path.startsWith(path.join(TMP, 'out', 'storyboard_shot_to_video')));
    } finally { server.close(); }
});

test('a ComfyUI execution error and an unreachable PC fail with the reason', async () => {
    const { server } = await fakeComfy({ fail: true });
    try {
        const start = await route('POST', '/film/comfyui/jobs', { workflow: 'storyboard_shot_to_video', images: [], audio: [] });
        const job = await finish(start.body.job.id);
        assert.strictEqual(job.status, 'failed');
        assert.match(job.error, /CUDA out of memory/);
    } finally { server.close(); }
    process.env.FILM_COMFYUI_URL = 'http://127.0.0.1:1';
    const st = await route('GET', '/film/comfyui/status');
    assert.strictEqual(st.body.ok, false);
    assert.match(st.body.error, /not answering at http:\/\/127\.0\.0\.1:1/);
    const bad = await route('POST', '/film/comfyui/jobs', {});
    assert.strictEqual(bad.code, 400);
});

test('step progress comes over the WebSocket: step N of M and the time left, only for this job', async () => {
    const { WebSocketServer } = require('ws');
    const sockets = new Map();
    const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const send = (code, data, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => {
            if (u.pathname.startsWith('/userdata/')) return send(200, decodeURIComponent(u.pathname).endsWith('.fe.json') ? MANIFEST : graph());
            if (u.pathname === '/prompt') {
                const body = JSON.parse(Buffer.concat(chunks).toString());
                const ws = sockets.get(body.client_id);
                const say = (type, data) => ws && ws.send(JSON.stringify({ type, data: { prompt_id: 'pp', ...data } }));
                setTimeout(() => {
                    say('execution_start', {});
                    ws.send(JSON.stringify({ type: 'progress', data: { prompt_id: 'someone-else', value: 9, max: 9, node: '1' } }));
                    say('progress', { value: 1, max: 4, node: '13' });
                    setTimeout(() => say('progress', { value: 2, max: 4, node: '13' }), 60);
                }, 10);
                return send(200, { prompt_id: 'pp', node_errors: {} });
            }
            if (u.pathname === '/history/pp') return send(200, state.finished ? { pp: { status: { completed: true }, outputs: { 92: { images: [{ filename: 'a.mp4', type: 'output' }] } } } } : {});
            if (u.pathname === '/queue') return send(200, { queue_running: [[0, 'pp']], queue_pending: [] });
            if (u.pathname === '/view') return send(200, Buffer.from('MP4'), 'video/mp4');
            return send(404, {});
        });
    });
    const state = { finished: false };
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws, req) => sockets.set(new URL(req.url, 'http://x').searchParams.get('clientId'), ws));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    process.env.FILM_COMFYUI_URL = `http://127.0.0.1:${server.address().port}`;
    try {
        const job = comfy.startJob({ workflow: 'storyboard_shot_to_video', images: [], audio: [] });
        let seen = null;
        for (let i = 0; i < 100 && !(seen && seen.progress && seen.progress.value === 2); i++) { await new Promise(r => setTimeout(r, 20)); seen = comfy.getJob(job.id); }
        assert.strictEqual(seen.status, 'running');
        assert.deepStrictEqual([seen.progress.value, seen.progress.max, seen.progress.node], [2, 4, '13'], 'another prompt\'s progress is ignored');
        assert.ok(Number.isInteger(seen.progress.eta_s) && seen.progress.eta_s >= 0, 'time left from the step timing');
        assert.ok(!('socket' in seen), 'the socket stays on the server');
        state.finished = true;
        await comfy._jobs.get(job.id).done;
        assert.strictEqual(comfy.getJob(job.id).status, 'done');
    } finally { wss.close(); server.close(); }
});

/* ---------- the review's fixes (confer critique) ---------- */

/*
 * A scriptable PC: `history(id, n)` answers the nth /history poll (null = not done, 'down' = unreachable),
 * `queue(id, n)` the nth /queue ('running' | 'pending' | 'gone'). Records uploads and interrupts.
 */
function scriptedPC({ history, queue = () => 'running', ws = null } = {}) {
    const st = { uploads: [], interrupts: 0, polls: 0, qpolls: 0, deleted: [] };
    const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const send = (code, data, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            if (u.pathname.startsWith('/userdata/')) return send(200, decodeURIComponent(u.pathname).endsWith('.fe.json') ? MANIFEST : graph());
            if (u.pathname === '/upload/image') { const name = /filename="([^"]+)"/.exec(body.toString('latin1'))[1]; st.uploads.push(name); return send(200, { name, subfolder: 'film-engine' }); }
            if (u.pathname === '/prompt') { if (ws) ws.onPrompt(JSON.parse(body.toString()).client_id); return send(200, { prompt_id: 'q1', node_errors: {} }); }
            if (u.pathname === '/history/q1') {
                const r = history(st.polls++);
                if (r === 'down') { res.destroy(); return; }
                return send(200, r === 'done' ? { q1: { status: { completed: true }, outputs: { 92: { images: [{ filename: 'out.mp4', type: 'output' }] } } } } : {});
            }
            if (u.pathname === '/queue' && req.method === 'GET') {
                const q = queue(st.qpolls++);
                return send(200, { queue_running: q === 'running' ? [[0, 'q1']] : q === 'other' ? [[0, 'someone-else']] : [], queue_pending: q === 'pending' ? [[1, 'q1']] : [] });
            }
            if (u.pathname === '/queue' && req.method === 'POST') { st.deleted.push(...(JSON.parse(body.toString()).delete || [])); return send(200, {}); }
            if (u.pathname === '/interrupt') { st.interrupts++; return send(200, {}); }
            if (u.pathname === '/view') return send(200, Buffer.from('MP4'), 'video/mp4');
            return send(404, {});
        });
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => { process.env.FILM_COMFYUI_URL = `http://127.0.0.1:${server.address().port}`; r({ server, st }); }));
}
const ownFile = (name, bytes) => { const d = path.join(process.env.FILM_DATA_DIR, 'comfyui-test'); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, name); fs.writeFileSync(f, bytes); return f; };
const settle = async id => { await comfy._jobs.get(id).done; return comfy.getJob(id); };

test('a file outside the projects and the data folder is never sent to the PC', async () => {
    const { server, st } = await scriptedPC({ history: () => 'done' });
    try {
        const outside = path.join(TMP, 'not-a-project-file.png'); fs.writeFileSync(outside, 'secret');
        const j = await settle(comfy.startJob({ workflow: 'storyboard_shot_to_video', images: [outside], audio: [] }).id);
        assert.strictEqual(j.status, 'failed');
        assert.match(j.error, /only project files go to the PC/);
        assert.deepStrictEqual(st.uploads, []);
    } finally { server.close(); }
});

test('upload names come from the bytes: two different files never share a name, the same bytes upload once', async () => {
    const { server, st } = await scriptedPC({ history: () => 'done' });
    try {
        comfy._sent.clear();
        const a = ownFile('sheet.png', 'AAAA'), b = path.join(path.dirname(a), 'sub'); fs.mkdirSync(b, { recursive: true });
        const b2 = path.join(b, 'sheet.png'); fs.writeFileSync(b2, 'BBBB');   // same file name, other bytes: another shot's sheet
        const a2 = ownFile('copy-of-sheet.png', 'AAAA');                    // same bytes, other name
        const names = [await comfy.upload(a), await comfy.upload(b2), await comfy.upload(a2)];
        assert.notStrictEqual(names[0], names[1], 'same name, different bytes: different names on the PC');
        assert.strictEqual(names[0], names[2], 'same bytes: the name already on the PC');
        assert.strictEqual(st.uploads.length, 2, 'the same bytes are sent once');
    } finally { server.close(); }
});

test('the PC out of reach for a moment does not fail a take; out of reach past the grace period does', async () => {
    let r = await scriptedPC({ history: n => (n < 4 ? 'down' : n < 6 ? null : 'done') });
    try {
        const j = await settle(comfy.startJob({ workflow: 'storyboard_shot_to_video', images: [], audio: [] }).id);
        assert.strictEqual(j.status, 'done', j.error);
    } finally { r.server.close(); }
    process.env.FILM_COMFYUI_GRACE_MS = '150';
    r = await scriptedPC({ history: () => 'down' });
    try {
        const j = await settle(comfy.startJob({ workflow: 'storyboard_shot_to_video', images: [], audio: [] }).id);
        assert.strictEqual(j.status, 'failed');
        assert.match(j.error, /lost contact with the PC/);
    } finally { r.server.close(); delete process.env.FILM_COMFYUI_GRACE_MS; }
});

test('a take the PC forgot (in neither history nor queue) fails instead of waiting forever', async () => {
    const { server } = await scriptedPC({ history: () => null, queue: n => (n < 2 ? 'pending' : 'gone') });
    try {
        const j = await settle(comfy.startJob({ workflow: 'storyboard_shot_to_video', images: [], audio: [] }).id);
        assert.strictEqual(j.status, 'failed');
        assert.match(j.error, /no longer has this take/);
    } finally { server.close(); }
});

test('Stop interrupts the PC only when it is running THIS take', async () => {
    for (const [who, interrupts] of [['other', 0], ['running', 1]]) {
        let done = false;
        const { server, st } = await scriptedPC({ history: () => (done ? 'done' : null), queue: () => who });
        try {
            const id = comfy.startJob({ workflow: 'storyboard_shot_to_video', images: [], audio: [] }).id;
            while (!comfy._jobs.get(id).prompt_id) await new Promise(r => setTimeout(r, 10));
            await comfy.cancelJob(id);
            done = true;
            await comfy._jobs.get(id).done;
            assert.strictEqual(st.interrupts, interrupts, `PC running ${who}`);
            assert.deepStrictEqual(st.deleted, ['q1']);
        } finally { server.close(); }
    }
});

test('a dropped progress socket is opened again while the take runs', async () => {
    const { WebSocketServer } = require('ws');
    let conns = 0, done = false;
    const socks = new Map();
    const wsHooks = { onPrompt: id => setTimeout(() => {
        const s = socks.get(id);
        s.send(JSON.stringify({ type: 'progress', data: { prompt_id: 'q1', value: 1, max: 4, node: '13' } }));
        s.close();   // the drop
    }, 10) };
    const { server } = await scriptedPC({ history: () => (done ? 'done' : null), ws: wsHooks });
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (s, req) => {
        conns++;
        const id = new URL(req.url, 'http://x').searchParams.get('clientId');
        socks.set(id, s);
        if (conns === 2) setTimeout(() => s.send(JSON.stringify({ type: 'progress', data: { prompt_id: 'q1', value: 3, max: 4, node: '13' } })), 10);
    });
    try {
        const id = comfy.startJob({ workflow: 'storyboard_shot_to_video', images: [], audio: [] }).id;
        for (let i = 0; i < 300 && comfy.getJob(id).progress?.value !== 3; i++) await new Promise(r => setTimeout(r, 20));
        assert.strictEqual(conns, 2, 'connected again after the drop');
        assert.strictEqual(comfy.getJob(id).progress.value, 3);
        done = true;
        assert.strictEqual((await settle(id)).status, 'done');
    } finally { wss.close(); server.close(); }
});

test('with ref_wiring, references follow the manifest slot order for every subset, whatever the graph numbering', () => {
    // The storyboard loader wired LAST in the graph but first in the manifest: the manifest wins.
    const g0 = graph();
    const order = ['306', '301', '302', '303', '304', '305'];
    for (const k of Object.keys(g0[136].inputs)) if (k.startsWith('ref_images.')) delete g0[136].inputs[k];
    g0[306] = { class_type: 'LoadImage', inputs: { image: 'sb.png' } };
    ['301', '302', '303', '304', '305', '306'].forEach((id, i) => { g0[136].inputs[`ref_images.ref_image_${i}`] = [id, 0]; });
    const m = { ...MANIFEST, core_node: '136', ref_wiring: { images: { core_input_prefix: 'ref_images.ref_image_' }, audio: { core_input_prefix: 'ref_audios.ref_audio_' } },
        images: order.map(node => ({ node, input: 'image' })) };
    for (let mask = 1; mask < 64; mask++) {
        const given = order.map((_, i) => (mask & (1 << i) ? `x${i}` : null));
        const g = comfy.buildPrompt(m, g0, { images: given, audio: [] });
        const refs = Object.keys(g[136].inputs).filter(k => k.startsWith('ref_images.')).sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop()));
        assert.deepStrictEqual(refs.map(k => g[136].inputs[k][0]), order.filter((_, i) => given[i]), `mask ${mask}`);
        assert.deepStrictEqual(refs.map(k => Number(k.split('_').pop())), refs.map((_, i) => i));
        assert.strictEqual(g[136].inputs.ref_image_size === undefined || typeof g[136].inputs.ref_image_size === 'string', true);
    }
});

test('a file the PC lost since it was sent (input folder cleaned) is sent again and the take queued once more', async () => {
    const onPC = new Set();
    const st = { uploads: 0, prompts: 0, refused: 0 };
    const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const send = (code, data, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            if (u.pathname.startsWith('/userdata/')) return send(200, decodeURIComponent(u.pathname).endsWith('.fe.json') ? MANIFEST : graph());
            if (u.pathname === '/upload/image') { const name = /filename="([^"]+)"/.exec(body.toString('latin1'))[1]; onPC.add(`film-engine/${name}`); st.uploads++; return send(200, { name, subfolder: 'film-engine' }); }
            if (u.pathname === '/prompt') {
                const g = JSON.parse(body.toString()).prompt;
                const missing = Object.entries(g).filter(([, n]) => n.class_type === 'LoadImage' && !onPC.has(n.inputs.image));
                if (missing.length) { st.refused++; return send(400, { error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' }, node_errors: Object.fromEntries(missing.map(([id, n]) => [id, { class_type: n.class_type, errors: [{ type: 'custom_validation_failed', message: `Invalid image file: ${n.inputs.image}` }] }])) }); }
                st.prompts++;
                return send(200, { prompt_id: `r${st.prompts}`, node_errors: {} });
            }
            if (u.pathname.startsWith('/history/')) { const id = u.pathname.split('/')[2]; return send(200, { [id]: { status: { completed: true }, outputs: { 92: { images: [{ filename: 'o.mp4', type: 'output' }] } } } }); }
            if (u.pathname === '/view') return send(200, Buffer.from('MP4'), 'video/mp4');
            if (u.pathname === '/queue') return send(200, { queue_running: [], queue_pending: [] });
            return send(404, {});
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    process.env.FILM_COMFYUI_URL = `http://127.0.0.1:${server.address().port}`;
    try {
        comfy._sent.clear();
        const frame = ownFile('lost-frame.png', 'FRAMEBYTES');
        const first = await settle(comfy.startJob({ workflow: 'storyboard_shot_to_video', images: [frame], audio: [] }).id);
        assert.strictEqual(first.status, 'done', first.error);
        assert.strictEqual(st.uploads, 1);
        onPC.clear();   // someone cleans the PC's input folder
        const second = await settle(comfy.startJob({ workflow: 'storyboard_shot_to_video', images: [frame], audio: [] }).id);
        assert.strictEqual(second.status, 'done', second.error);
        assert.deepStrictEqual([st.refused, st.uploads, st.prompts], [1, 2, 2], 'refused once, sent again, queued');
        assert.ok(!('sources' in second), 'local paths stay on the server');
    } finally { server.close(); }
});

test('every job field the My PC panel reads is one the server sends (derived from ComfyPanel.jsx)', async () => {
    // The panel and its tests mock jobs by hand; this pins the seam between them and publicJob().
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'pages', 'productiongraph', 'studio', 'ComfyPanel.jsx'), 'utf8');
    const used = new Map();
    for (const m of src.matchAll(/\bj\.([a-z_]+)(?:\??\.([a-z_]+))?/g)) { if (!used.has(m[1])) used.set(m[1], new Set()); if (m[2]) used.get(m[1]).add(m[2]); }
    assert.ok(used.size >= 8, `fields found: ${[...used.keys()]}`);
    // A take caught while running with progress, and one done and filed: between them every field has a value.
    const { WebSocketServer } = require('ws');
    let finished = false;
    const socks = new Map();
    const { server } = await scriptedPC({ history: () => (finished ? 'done' : null), ws: { onPrompt: id => setTimeout(() => socks.get(id)?.send(JSON.stringify({ type: 'progress', data: { prompt_id: 'q1', value: 1, max: 4, node: '13' } })), 10) } });
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (s, req) => socks.set(new URL(req.url, 'http://x').searchParams.get('clientId'), s));
    try {
        const id = comfy.startJob({ workflow: 'storyboard_shot_to_video', images: [], audio: [] }, { label: 'Take 1' }).id;
        for (let i = 0; i < 200 && !comfy.getJob(id).progress; i++) await new Promise(r => setTimeout(r, 10));
        const running = comfy.getJob(id);
        comfy._jobs.get(id).file_on = null;
        finished = true;
        await comfy._jobs.get(id).done;
        const done = { ...comfy.getJob(id), filed: { url: '/film/video/p/x.mp4', version: 1 } };   // filing itself is covered in comfyui-shot.test.js
        for (const [field, subs] of used) {
            assert.ok(field in running && field in done, `the panel reads job.${field}; the server does not send it`);
            for (const sub of subs) {
                const holder = field === 'progress' ? running.progress : field === 'filed' ? done.filed : null;
                if (holder) assert.ok(sub in holder, `the panel reads job.${field}.${sub}; the server does not send it`);
            }
        }
    } finally { wss.close(); server.close(); }
});

test('video slots: filled with the uploaded take, removed when empty, and checked by validate', () => {
    const g0 = { 10: { class_type: 'LoadVideo', inputs: { file: 'old.mp4' } }, 30: { class_type: 'X', inputs: { video: ['10', 0] } }, 92: { class_type: 'SaveVideo', inputs: { video: ['30', 0] } } };
    const m = { video: [{ node: '10', input: 'file', role: 'take' }], outputs: { node: '92' } };
    assert.deepStrictEqual(comfy.validate(m, g0), []);
    assert.ok(comfy.validate({ ...m, video: [{ node: '11', input: 'file' }] }, g0).length, 'a missing video node is caught');
    assert.ok(comfy.validate({ ...m, video: [{ node: '10', input: 'video' }] }, g0).length, 'a missing video input is caught');
    assert.strictEqual(comfy.buildPrompt(m, g0, { video: ['film-engine/abc-take.mp4'] })[10].inputs.file, 'film-engine/abc-take.mp4');
    const empty = comfy.buildPrompt(m, g0, { video: [] });
    assert.ok(!empty[10] && !('video' in empty[30].inputs), 'no take: the loader and its link go');
});
