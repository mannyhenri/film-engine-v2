/**
 * A Direct shot (or a sequence made as one clip), made on the ComfyUI PC (lib/comfyui.js).
 *
 * The same unit Optimize with AI sends (lib/seedance-prompt.js gather): the storyboard frame, the character,
 * location and prop sheets and the recorded dialogue. The pictures fill the workflow's image slots, the
 * storyboard frame first; the dialogue goes in as a WAV (ComfyUI's LoadAudio reads wav/mp3, not the
 * black-screen MP4). The prompt gets a short key naming each <Picture N> and <Audio 1> in slot order, the
 * way the workflow's prompt refers to them. Each take is one ComfyUI job with its own seed; when one comes
 * back it is copied into the project and added to the shot as its newest video version.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { db } = require('../db/database');
const comfy = require('./comfyui');
const { gather } = require('./seedance-prompt');
const { resolveFfmpeg } = require('./ffmpeg');
const { DATA_DIR, saveFile, urlForPath } = require('./file-storage');

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

function run(bin, args) {
    return new Promise((resolve, reject) => {
        const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        p.stderr.on('data', d => { err += d; });
        p.on('error', reject);
        p.on('close', code => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited ${code}`))));
    });
}

/** The pictures in slot order: storyboard frames first, then the sheets as gathered. */
function slotOrder(materials) {
    const imgs = materials.filter(m => m.kind === 'image');
    return [...imgs.filter(m => m.role === 'storyboard frame'), ...imgs.filter(m => m.role !== 'storyboard frame')];
}

/** The key the prompt ends with, so the model knows which picture and sound is which. */
function promptKey(pictures, dialogue) {
    const lines = pictures.map((m, i) => `<Picture ${i + 1}> is ${m.role === 'storyboard frame' ? `the storyboard frame of ${m.name}: follow its composition and framing` : `${m.name}'s ${m.role}`}.`);
    if (dialogue) {
        const said = (dialogue.cues || []).map(c => `${c.name}: "${c.text}"`).join(' ');
        lines.push(`<Audio 1> is the recorded dialogue: the characters speak it, lip-synced, at its timing${said ? ` (${said})` : ''}.`);
    }
    return lines.join('\n');
}

/** Add a finished take to its shot as the newest video version; answers what the page shows. */
function fileTake(projectId, shotId, file, meta) {
    const ext = path.extname(file).toLowerCase() || '.mp4';
    const row = db.prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM film_assets
        WHERE shot_id = ? AND asset_type IN ('video_final','video_synced','video_raw')`).get(shotId);
    const version = Number(row?.v || 0) + 1;
    const code = String(meta.label || 'shot').replace(/[^\w+-]+/g, '_');
    const name = `${code}_comfyui_v${version}_${Date.now()}${ext}`;
    const stored = saveFile(projectId, 'video', name, fs.readFileSync(file));
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO film_assets (id, project_id, shot_id, asset_type, file_path, file_name, format, mime_type, version,
        provider, provider_model, provider_job_id, license_source, license_status, input_refs)
        VALUES (?, ?, ?, 'video_raw', ?, ?, ?, ?, ?, 'comfyui', ?, ?, 'generated', 'generated', ?)`)
        .run(id, projectId, shotId, stored, name, ext.slice(1), ext === '.webm' ? 'video/webm' : 'video/mp4', version,
            meta.workflow, meta.prompt_id || null, JSON.stringify({ comfyui: { url: comfy.baseUrl(), workflow: meta.workflow, seed: meta.seed, options: meta.options } }));
    return { asset_id: id, version, url: urlForPath(stored), path: stored };
}

/**
 * body: the Optimize unit ({ label, prompt, duration_s, shots: [{shot_id, code, offset_s, lines}], character_ids,
 * location_ids, prop_ids, storyboard_asset_ids, dialogue_file? }) plus { workflow, options, takes, no_dialogue? }.
 * Answers { jobs, pictures, dialogue, note } at once; each job is followed at GET /film/comfyui/jobs/:id.
 */
async function makeShot(projectId, body = {}) {
    const shotId = body.shots?.[0]?.shot_id;
    if (!shotId) throw httpError(400, 'pick a shot first');
    if (!db.prepare('SELECT 1 FROM film_shots s JOIN film_scenes sc ON sc.id = s.scene_id WHERE s.id = ? AND sc.project_id = ?').get(shotId, projectId)) throw httpError(404, 'that shot is not in this project');
    const { manifest } = await comfy.loadWorkflow(body.workflow);
    const takes = Math.max(1, Math.min(4, Number(body.takes) || 1));

    const folder = path.join(DATA_DIR, 'comfyui', 'inputs', `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
    fs.mkdirSync(folder, { recursive: true });
    const materials = await gather(projectId, body.no_dialogue ? { ...body, shots: (body.shots || []).map(s => ({ ...s, lines: [] })), dialogue_file: null } : body, folder);
    const pictures = slotOrder(materials).slice(0, (manifest.images || []).length);
    const video = materials.find(m => m.kind === 'video');
    let dialogue = null;
    if (video && (manifest.audio || []).length) {
        const wav = video.file.replace(/\.mp4$/i, '.wav');
        await run(resolveFfmpeg().bin, ['-v', 'error', '-y', '-i', video.file, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
        dialogue = { file: wav, cues: video.cues || [], source: video.source };
    }
    const prompt = [String(body.prompt || '').trim(), promptKey(pictures, dialogue)].filter(Boolean).join('\n\n');
    const jobs = [];
    for (let t = 0; t < takes; t++) {
        const seed = crypto.randomInt(0, 2 ** 47);
        const meta = { label: body.label, workflow: body.workflow, seed, options: body.options || {} };
        jobs.push(comfy.startJob({ workflow: body.workflow, prompt, seed, options: body.options || {}, shot_id: shotId,
            images: pictures.map(m => m.file), audio: dialogue ? [dialogue.file] : [] },
            { label: `Take ${t + 1}`, onDone: j => fileTake(projectId, shotId, j.outputs[0].path, { ...meta, prompt_id: j.prompt_id }) }));
    }
    return {
        jobs,
        pictures: pictures.map((m, i) => ({ slot: i + 1, role: m.role, name: m.name })),
        dialogue: dialogue ? { source: dialogue.source, lines: dialogue.cues.length } : null,
        note: !dialogue && (manifest.audio || []).length && !body.no_dialogue ? 'No recorded dialogue was found for this shot, so the video is made without it.' : null,
    };
}

module.exports = { makeShot, slotOrder, promptKey, fileTake };
