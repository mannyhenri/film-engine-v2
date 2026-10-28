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

const pic = (name, w, h, color) => { const f = path.join(TMP, name); if (haveFfmpeg) execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', f]); return f; };
const tone = (name, secs) => { const f = path.join(TMP, name); if (haveFfmpeg) execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=440:d=${secs}`, f]); return f; };
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

function fakeComfy() {
    const state = { uploads: [], prompts: [] };
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
                setTimeout(() => { history[id] = { status: { status_str: 'success', completed: true }, outputs: { 92: { images: [{ filename: `shot_${id}.mp4`, subfolder: '', type: 'output' }] } } }; }, 30);
                return send(200, { prompt_id: id, node_errors: {} });
            }
            if (u.pathname.startsWith('/history/')) { const id = u.pathname.split('/')[2]; return send(200, history[id] ? { [id]: history[id] } : {}); }
            if (u.pathname === '/queue') return send(200, { queue_running: [], queue_pending: [] });
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
