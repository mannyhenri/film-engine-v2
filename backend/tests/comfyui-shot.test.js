/**
 * A Direct shot made on the ComfyUI PC (lib/comfyui-shot.js), with real ffmpeg and a fake ComfyUI. Checks:
 *   - the storyboard frame fills slot 1, then the sheets, as many as the workflow has slots
 *   - the dialogue goes in as a WAV, and the prompt ends with a key naming every <Picture N> and <Audio 1>
 *   - each take is its own job with its own seed, and each one back is added to the shot as the next video version
 *   - "without dialogue" sends no audio; a shot from another project and a missing workflow are refused
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-comfyshot-'));
process.env.FILM_DATA_DIR = path.join(TMP, 'data');
process.env.FILM_COMFYUI_OUT = path.join(TMP, 'out');
process.env.FILM_COMFYUI_POLL_MS = '20';
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const { resolveFfmpeg } = require('../lib/ffmpeg');
const comfy = require('../lib/comfyui');
const shotLib = require('../lib/comfyui-shot');

const ff = resolveFfmpeg();
const haveFfmpeg = !!(ff && ff.available);
const assetsDir = path.join(TMP, 'film');
fs.mkdirSync(assetsDir, { recursive: true });
const projectId = generateId(), juneId = generateId(), dinerId = generateId(), shotId = generateId(), sceneId = generateId();
db.prepare('INSERT INTO film_projects (id, title, assets_dir) VALUES (?, ?, ?)').run(projectId, 'ComfyUI test', assetsDir);
db.prepare('INSERT INTO film_characters (id, project_id, name) VALUES (?, ?, ?)').run(juneId, projectId, 'JUNE');
db.prepare('INSERT INTO film_locations (id, project_id, name) VALUES (?, ?, ?)').run(dinerId, projectId, 'THE DINER');
db.prepare('INSERT INTO film_scenes (id, project_id, scene_number) VALUES (?, ?, 1)').run(sceneId, projectId);
db.prepare('INSERT INTO film_shots (id, scene_id, shot_code) VALUES (?, ?, ?)').run(shotId, sceneId, '1A');

const pic = (name, w, h, color) => { const f = path.join(TMP, name); if (haveFfmpeg) execFileSync(ff.bin, ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', f], { stdio: ['ignore', 'pipe', 'pipe'] }); return f; };
const tone = (name, secs) => { const f = path.join(TMP, name); if (haveFfmpeg) execFileSync(ff.bin, ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=440:d=${secs}`, f], { stdio: ['ignore', 'pipe', 'pipe'] }); return f; };
const asset = (cols, type, file, meta = {}) => {
    const id = generateId();
    const names = Object.keys(cols);
    db.prepare(`INSERT INTO film_assets (id, project_id, ${names.join(', ')}, asset_type, file_path, file_name, format, metadata) VALUES (?, ?, ${names.map(() => '?').join(', ')}, ?, ?, ?, 'png', ?)`)
        .run(id, projectId, ...Object.values(cols), type, file, path.basename(file), JSON.stringify(meta));
    return id;
};
let frameId;
if (haveFfmpeg) {
    asset({ character_id: juneId }, 'character_sheet', pic('JUNE_front.png', 400, 800, 'red'), { view: 'front' });
    asset({ location_id: dinerId }, 'reference_image', pic('DINER_east.png', 1600, 900, 'gray'), { view: 'east' });
    frameId = asset({ shot_id: shotId }, 'storyboard', pic('1A.png', 1280, 720, 'purple'));
    asset({ shot_id: shotId }, 'audio_dialogue', tone('1A_JUNE_0.mp3', 1));
}
const BODY = extra => ({ label: '1A', prompt: 'June sets the cup down.', duration_s: 5, aspect: '16:9',
    shots: [{ shot_id: shotId, code: '1A', offset_s: 0, lines: [{ index: 0, t: 1, ch: 'JUNE', name: 'June', text: 'Late again.' }] }],
    character_ids: [juneId], location_ids: [dinerId], prop_ids: [], storyboard_asset_ids: [frameId],
    workflow: 'storyboard_shot_to_video', options: { duration: '5 s' }, ...extra });

/* The workflow on the fake PC: two image slots, one audio slot, a duration combo. */
const GRAPH = {
    136: { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { prompt: ['138', 0], 'ref_images.ref_image_0': ['301', 0], 'ref_images.ref_image_1': ['302', 0], 'ref_audios.ref_audio_0': ['401', 0] } },
    138: { class_type: 'PrimitiveStringMultiline', inputs: { value: '' } },
    129: { class_type: 'RandomNoise', inputs: { noise_seed: 1 } },
    210: { class_type: 'CustomCombo', inputs: { choice: '5 s', index: 0 } },
    301: { class_type: 'LoadImage', inputs: { image: 'x.png' } }, 302: { class_type: 'LoadImage', inputs: { image: 'y.png' } },
    401: { class_type: 'LoadAudio', inputs: { audio: 'z.wav' } },
    92: { class_type: 'SaveVideo', inputs: { video: ['136', 0] } },
};
const MANIFEST = { name: 'Storyboard shot to video', kind: 'video', workflow: 'storyboard_shot_to_video.api.json',
    prompt: { node: '138', input: 'value' }, seed: { node: '129', input: 'noise_seed' },
    images: [{ node: '301', input: 'image', role: 'storyboard' }, { node: '302', input: 'image', role: 'reference' }],
    audio: [{ node: '401', input: 'audio', role: 'dialogue' }],
    options: [{ id: 'duration', label: 'Duration', node: '210', input: 'choice', type: 'enum', index: true, choices: [{ label: '5 s', index: 0 }, { label: '8 s', index: 1 }], default: 0 }],
    outputs: { node: '92' } };

/* A take tool: LoadVideo -> (upscale) -> SaveVideo, with a Resolution dropdown. */
const TAKE_GRAPH = {
    10: { class_type: 'LoadVideo', inputs: { file: 'x.mp4' } },
    20: { class_type: 'CustomCombo', inputs: { choice: '1080p (1920x1080)', index: 0 } },
    30: { class_type: 'SeedVR2PostProcessing', inputs: { video: ['10', 0], size: ['20', 1] } },
    92: { class_type: 'SaveVideo', inputs: { video: ['30', 0] } },
};
const TAKE_MANIFEST = { name: 'Upscale (SeedVR2)', kind: 'fx', workflow: 'take_upscale.api.json',
    video: [{ node: '10', input: 'file', role: 'take' }],
    options: [{ id: 'resolution', label: 'Resolution', node: '20', input: 'choice', type: 'enum', index: true, choices: [{ label: '1080p (1920x1080)', index: 0 }, { label: '4K (3840x2160)', index: 1 }], default: 0 }],
    outputs: { node: '92' } };

function fakeComfy() {
    const state = { uploads: [], prompts: [], hold: false, release: [] };
    const history = {};
    const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const send = (code, data, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            if (u.pathname.startsWith('/userdata/')) {
                const f = decodeURIComponent(u.pathname.slice(10)).replace('workflows/film-engine/', '');
                if (f.startsWith('take_upscale')) return send(200, f.endsWith('.fe.json') ? TAKE_MANIFEST : TAKE_GRAPH);
                return send(200, f.endsWith('.fe.json') ? MANIFEST : GRAPH);
            }
            if (u.pathname === '/upload/image') {
                const name = /filename="([^"]+)"/.exec(body.toString('latin1'))[1];
                state.uploads.push({ name, wav: body.includes(Buffer.from('WAVE')) });
                return send(200, { name, subfolder: 'film-engine', type: 'input' });
            }
            if (u.pathname === '/prompt') {
                const id = `p${state.prompts.length + 1}`;
                state.prompts.push(JSON.parse(body.toString()).prompt);
                const finishIt = () => { history[id] = { status: { status_str: 'success', completed: true }, outputs: { 92: { images: [{ filename: `shot_${id}.mp4`, subfolder: '', type: 'output' }] } } }; };
                if (state.hold) state.release.push(finishIt); else setTimeout(finishIt, 30);
                return send(200, { prompt_id: id, node_errors: {} });
            }
            if (u.pathname.startsWith('/history/')) { const id = u.pathname.split('/')[2]; return send(200, history[id] ? { [id]: history[id] } : {}); }
            if (u.pathname === '/queue') return send(200, { queue_running: state.prompts.map((_, i) => `p${i + 1}`).filter(id => !history[id] && !state.hold).map(id => [0, id]), queue_pending: state.hold ? state.prompts.map((_, i) => [i, `p${i + 1}`]) : [] });
            if (u.pathname === '/view') return send(200, Buffer.from('MP4 ' + u.searchParams.get('filename')), 'video/mp4');
            return send(404, {});
        });
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => { process.env.FILM_COMFYUI_URL = `http://127.0.0.1:${server.address().port}`; r({ server, state }); }));
}
const versions = () => db.prepare("SELECT * FROM film_assets WHERE shot_id = ? AND asset_type = 'video_raw' ORDER BY version").all(shotId);

test('slotOrder puts every storyboard frame first, then the sheets in gathered order', () => {
    const m = (role, name) => ({ kind: 'image', role, name });
    const mats = [m('character sheet', 'June'), m('storyboard frame', 'shot 1A'), m('location sheet', 'Diner'), { kind: 'video' }, m('storyboard frame', 'shot 1B')];
    assert.deepStrictEqual(shotLib.slotOrder(mats).map(x => x.name), ['shot 1A', 'shot 1B', 'June', 'Diner']);
    const key = shotLib.promptKey(shotLib.slotOrder(mats), { cues: [{ name: 'June', text: 'Late again.' }] });
    shotLib.slotOrder(mats).forEach((_, i) => assert.match(key, new RegExp(`<Picture ${i + 1}>`)));
    assert.match(key, /<Audio 1> is the recorded dialogue.*June: "Late again\."/);
});

test('two takes: frame in slot 1, dialogue as WAV, each filed on the shot as the next version', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    const { server, state } = await fakeComfy();
    try {
        const out = await shotLib.makeShot(projectId, BODY({ takes: 2 }));
        assert.strictEqual(out.jobs.length, 2);
        assert.deepStrictEqual(out.pictures.map(p => p.role), ['storyboard frame', 'character sheet'], 'two slots: frame, then the first sheet');
        assert.ok(out.dialogue && out.dialogue.lines === 1);
        const done = await Promise.all(out.jobs.map(j => comfy._jobs.get(j.id).done.then(() => comfy.getJob(j.id))));
        done.forEach(j => assert.strictEqual(j.status, 'done', j.error));
        const sent = state.prompts[0];
        assert.match(sent[301].inputs.image, /storyboard frame\.png$/);
        assert.match(sent[401].inputs.audio, /\.wav$/);
        assert.ok(state.uploads.some(u => u.name.endsWith('.wav') && u.wav), 'a real WAV was uploaded');
        assert.strictEqual(state.uploads.length, 3, 'frame, sheet and WAV sent once for both takes');
        assert.strictEqual(state.prompts[0][301].inputs.image, state.prompts[1][301].inputs.image, 'both takes read the same upload');
        assert.match(sent[138].inputs.value, /^June sets the cup down\.\n\n<Picture 1> is the storyboard frame of shot 1A/);
        assert.match(sent[138].inputs.value, /<Audio 1>/);
        assert.notStrictEqual(state.prompts[0][129].inputs.noise_seed, state.prompts[1][129].inputs.noise_seed, 'each take its own seed');
        const v = versions();
        assert.deepStrictEqual(v.map(r => r.version), [1, 2]);
        v.forEach(r => { assert.strictEqual(r.provider, 'comfyui'); assert.ok(fs.existsSync(r.file_path)); assert.match(fs.readFileSync(r.file_path, 'utf8'), /^MP4 shot_p/); });
        assert.deepStrictEqual(done.map(j => j.filed.version).sort(), [1, 2]);
    } finally { server.close(); }
});

test('without dialogue no audio is sent; a missing workflow or a foreign shot is refused', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    const { server, state } = await fakeComfy();
    try {
        const out = await shotLib.makeShot(projectId, BODY({ no_dialogue: true }));
        assert.strictEqual(out.dialogue, null);
        await comfy._jobs.get(out.jobs[0].id).done;
        assert.ok(!state.prompts[0][401], 'the audio loader is removed');
        assert.ok(!('ref_audios.ref_audio_0' in state.prompts[0][136].inputs));
        await assert.rejects(shotLib.makeShot(projectId, BODY({ shots: [{ shot_id: generateId(), code: 'X', lines: [] }] })), /not in this project/);
        await assert.rejects(shotLib.makeShot(projectId, BODY({ workflow: '' })), /pick a workflow/);
    } finally { server.close(); }
});

// A WAV's length from its own header (byte rate, then the data chunk), so no extra process is spawned.
const probeSecs = f => {
    const b = fs.readFileSync(f);
    const byteRate = b.readUInt32LE(28);
    for (let i = 12; i < b.length - 8;) { const id = b.toString('ascii', i, i + 4), size = b.readUInt32LE(i + 4); if (id === 'data') return size / byteRate; i += 8 + size; }
    return NaN;
};

test('the dialogue is cut to the Duration chosen, not the shot, and lines past it are named', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    const { server } = await fakeComfy();
    try {
        assert.strictEqual(shotLib.chosenSeconds(MANIFEST, { duration: '8 s' }), 8);
        assert.strictEqual(shotLib.chosenSeconds(MANIFEST, {}), 5, 'the workflow default when nothing is picked');
        const lines = [{ index: 0, t: 1, ch: 'JUNE', name: 'June', text: 'Late again.' }, { index: 1, t: 6.5, ch: 'JUNE', name: 'June', text: 'Again.' }];
        const out = await shotLib.makeShot(projectId, BODY({ duration_s: 18, options: { duration: '5 s' }, shots: [{ shot_id: shotId, code: '1A', offset_s: 0, lines }] }));
        assert.strictEqual(out.length_s, 5);
        assert.match(out.note, /1 line starts after 5 s, past the Duration chosen/);
        const dir = path.join(process.env.FILM_DATA_DIR, 'comfyui', 'inputs');
        const newest = fs.readdirSync(dir).sort().pop();
        const wav = fs.readdirSync(path.join(dir, newest)).find(f => f.endsWith('.wav'));
        assert.ok(Math.abs(probeSecs(path.join(dir, newest, wav)) - 5) < 0.1, 'the WAV is 5 s');
        await comfy._jobs.get(out.jobs[0].id).done;
    } finally { server.close(); }
});

test('Film Engine restarting mid-render: the take is followed again and filed when it lands', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    const { server, state } = await fakeComfy();
    state.hold = true;
    try {
        const before = versions().length;
        const out = await shotLib.makeShot(projectId, BODY({ takes: 1 }));
        const id = out.jobs[0].id;
        while (!comfy._jobs.get(id).prompt_id) await new Promise(r => setTimeout(r, 10));
        await new Promise(r => setTimeout(r, 60));
        // "Restart": this process forgets the job; only what was written down survives.
        comfy._jobs.get(id).detached = true;
        comfy._jobs.delete(id);
        state.hold = false;
        state.release.splice(0).forEach(f => f());
        assert.strictEqual(comfy.resumeJobs(), 1);
        const j = await comfy._jobs.get(id).done.then(() => comfy.getJob(id));
        assert.strictEqual(j.status, 'done', j.error);
        assert.strictEqual(versions().length, before + 1, 'filed on the shot after the restart');
        assert.strictEqual(comfy.resumeJobs(), 0, 'a finished take is not resumed again');
    } finally { server.close(); }
});

test('the storyboard frame always makes it in, however many sheets there are', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    const { gather } = require('../lib/seedance-prompt');
    const props = [];
    for (let i = 0; i < 14; i++) {
        const id = generateId();
        db.prepare('INSERT INTO film_props (id, project_id, name) VALUES (?, ?, ?)').run(id, projectId, `PROP ${i}`);
        asset({ prop_id: id }, 'reference_image', pic(`prop${i}.png`, 32, 32, 'white'), { view: 'front' });
        props.push(id);
    }
    const folder = path.join(process.env.FILM_DATA_DIR, 'gather-cap'); fs.mkdirSync(folder, { recursive: true });
    const mats = await gather(projectId, { ...BODY(), prop_ids: props, shots: [] }, folder);
    const imgs = mats.filter(m => m.kind === 'image');
    assert.strictEqual(imgs.length, 12, 'still capped');
    assert.ok(imgs.some(m => m.role === 'storyboard frame'), 'the frame kept its place');
    assert.strictEqual(shotLib.slotOrder(mats)[0].role, 'storyboard frame');
});

test('a take tool works on a finished take: the take goes up as the video, the result is the next version, from that take', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    const { server, state } = await fakeComfy();
    try {
        const own = path.join(process.env.FILM_DATA_DIR, 'takes'); fs.mkdirSync(own, { recursive: true });
        const src = path.join(own, 'draft.mp4'); fs.writeFileSync(src, 'DRAFT-MP4-BYTES');
        const draft = shotLib.fileTake(projectId, shotId, src, { label: '1A', workflow: 'storyboard_shot_to_video', options: { duration: '5 s' } });
        const before = versions().length;
        const { job } = await shotLib.makeFromTake(draft.asset_id, { workflow: 'take_upscale', options: { resolution: '4K (3840x2160)' } });
        const j = await comfy._jobs.get(job.id).done.then(() => comfy.getJob(job.id));
        assert.strictEqual(j.status, 'done', j.error);
        const sent = state.prompts.at(-1);
        assert.match(sent[10].inputs.file, /^film-engine\/[0-9a-f]{12}-1A_comfyui_v\d+_\d+\.mp4$/, 'the take is the LoadVideo file');
        assert.deepStrictEqual([sent[20].inputs.choice, sent[20].inputs.index], ['4K (3840x2160)', 1]);
        assert.strictEqual(versions().length, before + 1);
        const takes = shotLib.listTakes(shotId);
        assert.strictEqual(takes[0].version, j.filed.version, 'newest first');
        assert.deepStrictEqual(takes[0].from, { asset_id: draft.asset_id, version: draft.version }, 'remembers the take it came from');
        assert.strictEqual(takes[0].workflow, 'take_upscale');
        assert.ok(takes.every(t => 'url' in t && 'exists' in t));
        // Refused: a workflow without a video input, and something that is not a video take.
        await assert.rejects(shotLib.makeFromTake(draft.asset_id, { workflow: 'storyboard_shot_to_video' }), /does not take a video/);
        await assert.rejects(shotLib.makeFromTake(frameId, { workflow: 'take_upscale' }), /not a video version of a shot/);
    } finally { server.close(); }
});

test('a Mac take tool (Generators AI Upscale) runs on a take and files the result the same way, from that take', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    // A fake Generators engine standing in for Real-ESRGAN: the real module, with createJob/getJob swapped for the test.
    const gen = require('../lib/generators');
    const keep = { listTools: gen.listTools, probeInput: gen.probeInput, createJob: gen.createJob, getJob: gen.getJob };
    const out = path.join(process.env.FILM_DATA_DIR, 'mac-out.mov'); fs.writeFileSync(out, 'MOV-4K');
    let created = null, polls = 0;
    gen.listTools = () => [{ id: 'upscale', name: 'AI Upscale', accepts: 'video', range: 'whole', out: { kind: 'file', ext: '.mov' },
        options: [{ name: 'scale', type: 'select', label: 'Size', default: 2, choices: [{ value: 2, label: '2× (1080p → 4K)' }, { value: 4, label: '4× (1080p → 8K)' }] },
            { name: 'strength', type: 'slider', label: 'AI strength', default: 0.85 }] }, { id: 'stems', name: 'AI Stems', accepts: 'audio' }];
    gen.probeInput = p => ({ id: 'in1', path: p, kind: 'video' });
    gen.createJob = b => { created = b; return { id: 'g1' }; };
    gen.getJob = () => (++polls < 3 ? { status: 'running', done: polls, total: 4, started_at: new Date(Date.now() - 2000).toISOString() } : { status: 'done', outputs: [out] });
    try {
        const tools = shotLib.macTools();
        assert.deepStrictEqual(tools.map(t => t.slug), ['mac:upscale'], 'only video-in, video-out tools');
        assert.deepStrictEqual(tools[0].options.map(o => o.id), ['scale'], 'picks only; sliders keep their defaults');
        const own = path.join(process.env.FILM_DATA_DIR, 'takes'); fs.mkdirSync(own, { recursive: true });
        const src = path.join(own, 'for-mac.mp4'); fs.writeFileSync(src, 'TAKE');
        const take = shotLib.fileTake(projectId, shotId, src, { label: '1A', workflow: 'storyboard_shot_to_video', options: {} });
        const { job } = await shotLib.makeFromTake(take.asset_id, { workflow: 'mac:upscale', options: { scale: '4× (1080p → 8K)' } });
        await comfy._jobs.get(job.id).done;
        const j = comfy.getJob(job.id);
        assert.strictEqual(j.status, 'done', j.error);
        assert.deepStrictEqual(created, { tool: 'upscale', input_id: 'in1', options: { scale: 4 } }, 'labels become the engine\'s values');
        const t = shotLib.listTakes(shotId)[0];
        assert.strictEqual(t.version, j.filed.version);
        assert.deepStrictEqual([t.workflow, t.provider, t.from.asset_id], ['mac:upscale', 'generators', take.asset_id]);
        assert.match(fs.readFileSync(j.filed.path, 'utf8'), /^MOV-4K$/);
        assert.match(j.filed.path, /\.mov$/);
        await assert.rejects(comfy.cancelJob(job.id), /stop it in Production › Generators/);
    } finally { Object.assign(gen, keep); }
});

/*
 * Every place a take can come from (TAKE_SOURCES): made on the PC, made on this Mac, or a finished clip the director
 * adds from a file. Each is filed as the shot's next version, under its own provider, and listed with the takes.
 */
test('a take from every source is filed as the next version under its own provider, and listed', { skip: !haveFfmpeg && 'no ffmpeg' }, () => {
    const shot = generateId();
    db.prepare('INSERT INTO film_shots (id, scene_id, shot_code) VALUES (?, ?, ?)').run(shot, sceneId, '1Z');
    const clip = path.join(TMP, 'clip.mp4');
    execFileSync(ff.bin, ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=1', '-f', 'lavfi', '-i', 'sine=d=1', '-shortest', clip], { stdio: ['ignore', 'pipe', 'pipe'] });
    const sources = Object.keys(shotLib.TAKE_SOURCES);
    assert.deepStrictEqual(sources.sort(), ['file', 'mac', 'pc']);
    // A take can be gigabytes (a 4K ProRes): filing copies it on disk and never reads the whole clip into memory.
    const read = fs.readFileSync;
    fs.readFileSync = (f, ...rest) => { if (String(f) === clip) throw new Error('read the whole clip into memory'); return read(f, ...rest); };
    const filedBy = {};
    try { for (const where of sources) filedBy[where] = shotLib.fileTake(projectId, shot, clip, { label: '1Z', where, workflow: `w-${where}`, provider: where === 'file' ? 'elsewhere' : undefined }); }
    finally { fs.readFileSync = read; }
    for (const [i, where] of sources.entries()) {
        const filed = filedBy[where];
        assert.strictEqual(fs.statSync(filed.path).size, fs.statSync(clip).size, `${where}: the copy is whole`);
        assert.strictEqual(filed.version, i + 1, `${where}: the next version`);
        const row = db.prepare('SELECT provider, asset_type FROM film_assets WHERE id = ?').get(filed.asset_id);
        assert.deepStrictEqual(row, { provider: where === 'file' ? 'elsewhere' : shotLib.TAKE_SOURCES[where].provider, asset_type: 'video_raw' }, where);
        assert.ok(path.basename(filed.path).startsWith(`1Z_${shotLib.TAKE_SOURCES[where].tag}_v${i + 1}_`), `${where}: named by its source`);
    }
    assert.deepStrictEqual(shotLib.listTakes(shot).map(t => [t.version, t.exists]), [[3, true], [2, true], [1, true]]);
});

test('adding a take from a file: it lands on the shot; a missing file, a non-video or an unknown shot is refused', { skip: !haveFfmpeg && 'no ffmpeg' }, () => {
    const shot = generateId();
    db.prepare('INSERT INTO film_shots (id, scene_id, shot_code) VALUES (?, ?, ?)').run(shot, sceneId, '1Y');
    const clip = path.join(TMP, 'made elsewhere.mp4');
    execFileSync(ff.bin, ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=1', clip], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = shotLib.importTake(shot, { path: clip });
    assert.strictEqual(out.version, 1);
    assert.strictEqual(shotLib.listTakes(shot)[0].provider, 'imported');
    assert.ok(fs.existsSync(out.path) && out.path !== clip, 'a copy is kept with the project');
    assert.throws(() => shotLib.importTake(shot, { path: path.join(TMP, 'nope.mp4') }), /no file at/);
    assert.throws(() => shotLib.importTake(shot, { path: tone('just sound.mp3', 1) }), /not a video/);
    assert.throws(() => shotLib.importTake('no-such-shot', { path: clip }), /no such shot/);
});
