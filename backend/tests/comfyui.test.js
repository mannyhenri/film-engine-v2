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
            if (u.pathname === '/queue' && req.method === 'GET') return send(200, { queue_running: [], queue_pending: [] });
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

        const frame = path.join(TMP, '4C.png'); fs.writeFileSync(frame, 'png');
        const wav = path.join(TMP, '4C dialogue.wav'); fs.writeFileSync(wav, 'wav');
        const start = await route('POST', '/film/comfyui/jobs', { workflow: 'storyboard_shot_to_video', prompt: 'Mara slaps Dev', seed: 7,
            options: { aspect: '2.39:1 (1152x480)', duration: '8 s' }, images: [frame], audio: [wav] });
        assert.strictEqual(start.code, 202);
        const job = await finish(start.body.job.id);
        assert.strictEqual(job.status, 'done', job.error);
        assert.deepStrictEqual(state.uploads, ['4C.png', '4C dialogue.wav']);
        const sent = state.prompts[0];
        assert.strictEqual(sent[301].inputs.image, 'film-engine/4C.png');
        assert.strictEqual(sent[401].inputs.audio, 'film-engine/4C dialogue.wav');
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
