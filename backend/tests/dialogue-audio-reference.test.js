/**
 * Recorded dialogue, sent to Seedance 2.5 as an audio reference.
 *
 * "Set up the path to upload audio, as I have audio files for a project (my
 * dialogue), with Seedance 2.5 on Runway or MuAPI." (Runway was removed on 2026-10-24; Higgsfield took its place.)
 *
 * The field names are held to tests/fixtures/seedance-audio-contract.json, the
 * free validation probes of 2026-09-29, rather than typed here a second time:
 *   - the payload carries the shot's lines, in order, only when asked, and a
 *     model that takes no audio is refused by name, never ignored;
 *   - MuAPI: audio forces omni-reference, `audios_list` carries it, and each
 *     local file is uploaded BEFORE the request, which names the hosted URLs;
 *   - Higgsfield seedance_2_5: each line travels as a `medias` entry with the
 *     `audio_references` role, uploaded to Higgsfield when the request is sent;
 *   - the free preview says how many lines would go, and a person and an agent
 *     can both upload the dialogue and switch it on.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

process.env.FILM_DATA_DIR = path.join(os.tmpdir(), 'film-engine-da-' + crypto.randomUUID().slice(0, 8));
process.env.SEEDANCE_POLL_INTERVAL_MS = '1';
for (const k of Object.keys(process.env)) if (/_API_KEY$|_API_SECRET$|^RUNWAYML_/.test(k)) delete process.env[k];
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const CONTRACT = require('./fixtures/seedance-audio-contract.json');
const seedance = require('../lib/providers/seedance');
const hf = require('../lib/providers/higgsfield-mcp');
const { buildCapabilityPayload } = require('../lib/capability-payloads');
const { resolveFfmpeg } = require('../lib/ffmpeg');

const ff = resolveFfmpeg();
const MEDIA = path.join(process.env.FILM_DATA_DIR, 'a');
fs.mkdirSync(MEDIA, { recursive: true });
function line(name, hz) {
    const f = path.join(MEDIA, name);
    execFileSync(ff.bin, ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=${hz}:d=1`, f], { stdio: ['ignore', 'ignore', 'ignore'] });
    return f;
}
const L1 = line('1A_RAY_1.mp3', 330), L2 = line('1A_JUNE_2.mp3', 440);

function ctxFor(extra) {
    return {
        shot: { id: 's1', shot_code: '1A', duration_ms: 5000 },
        sceneCard: { shot_code: '1A', description: 'They talk.', camera: {} },
        scene: { id: 'sc1', project_id: 'p1' }, project: { aspect_ratio: '16:9', target_resolution: '1920x1080' },
        keyframePath: null, initImage: 'data:image/png;base64,AAAA',
        // In spoken order, as loadShotContext hands them over (held by the route test below).
        dialogueAudio: [{ id: 'a1', file_path: L1, file_name: '1A_RAY_1.mp3' }, { id: 'a2', file_path: L2, file_name: '1A_JUNE_2.mp3' }],
        ...extra,
    };
}

test('the payload carries the shot\'s lines only when asked, and a model with no audio says so', () => {
    const off = buildCapabilityPayload('video', ctxFor({ overrides: { model: 'seedance_2_5' } })).payload;
    assert.equal(off.audio_references, undefined, 'not asked: no field at all');
    const on = buildCapabilityPayload('video', ctxFor({ useDialogueAudio: true, overrides: { model: 'seedance_2_5' } })).payload;
    assert.deepEqual(on.audio_references.map(a => a.file_path), [L1, L2]);
    const none = buildCapabilityPayload('video', ctxFor({ useDialogueAudio: true, dialogueAudio: [], overrides: { model: 'seedance_2_5' } })).payload;
    assert.match(none.audio_refused, /no recorded dialogue/);
    const gen45 = buildCapabilityPayload('video', ctxFor({ useDialogueAudio: true, overrides: { model: 'veo3_1' } })).payload;
    assert.equal(gen45.audio_references, undefined);
    assert.match(gen45.audio_refused, /takes no audio reference/);
});

test('MuAPI: dialogue runs omni-reference with the probed audio field, and the preview says what that costs the keyframe', () => {
    const r = seedance.buildVideoRequest({ prompt: 'x', init_image: 'data:image/png;base64,AAAA', audio_references: [{ file_path: L1 }, { file_path: L2 }] });
    assert.equal(r.workflow, 'omni-reference');
    assert.match(r.url, /seedance-2\.5-omni-reference/);
    assert.deepEqual(r.body[CONTRACT.muapi.audio_field], [L1, L2]);
    assert.ok(r.body.images_list.includes('data:image/png;base64,AAAA'), 'the board frame still travels, as a reference');
    const d = seedance.describeVideoRequest({ prompt: 'x', init_image: 'data:image/png;base64,AAAA', audio_references: [{ file_path: L1 }] });
    assert.ok(d.notes.some(n => /reference rather than the exact first frame/.test(n)));
    // Without audio the ordinary single-keyframe request is unchanged.
    assert.equal(seedance.buildVideoRequest({ prompt: 'x', init_image: 'data:image/png;base64,AAAA' }).workflow, 'image-to-video');
});

test('MuAPI: each dialogue file is uploaded first, and the request names the hosted URLs', async () => {
    process.env.SEEDANCE_API_KEY = 'test-muapi-key-000000';
    const real = global.fetch;
    const sent = [];
    let n = 0;
    global.fetch = async (url, init) => {
        const u = String(url);
        sent.push({ u, body: init && typeof init.body === 'string' ? JSON.parse(init.body) : null });
        const ok = j => ({ ok: true, status: 200, json: async () => j });
        if (u.endsWith('/upload_file')) return ok({ url: `https://cdn.muapi.ai/up/${++n}.mp3` });
        return { ok: false, status: 400, json: async () => ({ detail: 'stop here' }) };
    };
    try {
        await seedance.generate('video', { prompt: 'x', init_image: 'https://cdn.muapi.ai/k.png', audio_references: [{ file_path: L1 }, { file_path: L2 }] }, {});
        const job = sent.find(s => /omni-reference/.test(s.u));
        assert.ok(job, 'the omni-reference request went out');
        assert.equal(sent.filter(s => s.u.endsWith('/upload_file')).length, 2, 'both lines uploaded');
        assert.ok(sent.indexOf(job) > sent.findIndex(s => s.u.endsWith('/upload_file')), 'uploaded BEFORE the request');
        assert.deepEqual(job.body.audios_list, ['https://cdn.muapi.ai/up/1.mp3', 'https://cdn.muapi.ai/up/2.mp3'], 'in order');
    } finally { global.fetch = real; delete process.env.SEEDANCE_API_KEY; }
});

test('Higgsfield seedance_2_5 carries each line as an audio reference; a model that cannot is named', () => {
    const r = hf.buildRequest('video', { model: 'seedance_2_5', prompt: 'x', init_image: 'data:image/png;base64,AAAA', audio_references: [{ file_path: L1 }, { file_path: L2 }] });
    assert.deepEqual(r.body.medias.filter(m => m.role === 'audio_references').map(m => m.value), [L1, L2], 'both lines, in order');
    assert.equal(r.body.mode, 'omni_reference', 'audio is read only in omni-reference');
    const { MODELS } = require('../lib/higgsfield-app-catalog');
    const deaf = Object.keys(MODELS).find(id => !(MODELS[id].roles || []).includes('audio_references') && (MODELS[id].roles || []).includes('start_image'));
    assert.ok(deaf, 'every Higgsfield model takes audio, so this cannot be checked');
    assert.throws(() => hf.buildRequest('video', { model: deaf, prompt: 'x', init_image: 'data:image/png;base64,AAAA', audio_references: [{ file_path: L1 }] }),
        /takes no audio references/);
});

test('the free preview says how many recorded lines would go, through the real route', async () => {
    const pid = generateId(), sc = generateId(), sh = generateId();
    db.prepare(`INSERT INTO film_projects (id, title) VALUES (?, 'D')`).run(pid);
    db.prepare(`INSERT INTO film_scenes (id, project_id, scene_number) VALUES (?, ?, 1)`).run(sc, pid);
    db.prepare(`INSERT INTO film_shots (id, scene_id, shot_code, duration_ms, scene_card_yaml) VALUES (?, ?, '1A', 5000, ?)`)
        .run(sh, sc, JSON.stringify({ shot_code: '1A', description: 'They talk.' }));
    // Inserted out of spoken order, so only the line index can put them right.
    for (const f of [L2, L1]) db.prepare(`INSERT INTO film_assets (id, project_id, shot_id, asset_type, file_path, file_name) VALUES (?, ?, ?, 'audio_dialogue', ?, ?)`)
        .run(generateId(), pid, sh, f, path.basename(f));
    const { handleVideoGen } = require('../routes/video-gen');
    const call = q => new Promise(resolve => {
        const res = { writeHead(c) { this.c = c; }, setHeader() {}, end(b) { resolve({ code: this.c, json: JSON.parse(b) }); } };
        handleVideoGen({ method: 'GET', headers: {}, body: {} }, res, ['film', 'shots', sh, 'video', 'preview'], q);
    });
    const off = await call({ video_model: 'seedance_2_5', video: 'higgsfield-mcp' });
    assert.equal(off.json.dialogue_audio.available, 2);
    assert.deepEqual(off.json.dialogue_audio.sending, [], 'not sent unless asked');
    const on = await call({ video_model: 'seedance_2_5', video: 'higgsfield-mcp', use_dialogue_audio: '1' });
    assert.equal(on.code, 200, JSON.stringify(on.json));
    assert.ok(on.json.dialogue_audio.asked);
    assert.deepEqual(on.json.dialogue_audio.sending, ['1A_RAY_1.mp3', '1A_JUNE_2.mp3'], 'both lines, in the order they are said');
});

test('a person and an agent can both upload the dialogue and switch it on', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/index.html'), 'utf8');
    // Video Shots offered it too, until that page went (removed with Production's older pages by the user (2026-11-11)).
    assert.match(src, /mediaUploadControl\('voice', 'audio', 'shot', n\.id, \{ after: 'loadProductionGraph'/, 'and in the canvas drawer');
    assert.match(src, /\$\{dialogueAudioRowHtml\(d\.dialogue_audio\)\}/, 'the confirmation offers it');
    assert.match(src, /dlg && dlg\.checked \? \{ use_dialogue_audio: true \}/, 'and sends it when ticked');
    const tools = Object.fromEntries(require('../lib/mcp-tools').listTools().map(t => [t.name, t]));
    for (const n of ['video_generate', 'video_preview']) {
        const props = (tools[n].inputSchema || tools[n].input_schema || {}).properties || {};
        assert.ok(props.use_dialogue_audio, `${n} takes use_dialogue_audio`);
    }
    assert.ok(tools.media_upload, 'dialogue files go in through media_upload (voice)');
});
