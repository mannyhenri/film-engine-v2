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
const { DATA_DIR, copyFile, urlForPath } = require('./file-storage');

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

function run(bin, args) {
    return new Promise((resolve, reject) => {
        const p = spawn(bin, ['-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        p.stderr.on('data', d => { err += d; });
        p.on('error', reject);
        p.on('close', code => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited ${code}`))));
    });
}

/** The Duration option's seconds ("8 s" -> 8), when the workflow has one. */
function chosenSeconds(manifest, options) {
    const o = (manifest.options || []).find(x => x.type === 'enum' && /duration|length/i.test(`${x.id} ${x.label || ''}`));
    if (!o) return null;
    const v = options[o.id] === undefined ? o.default : options[o.id];
    const c = (o.choices || []).find(x => (typeof x === 'object' ? x.label === v || x.index === v : x === v));
    const m = /^(\d+(?:\.\d+)?)\s*s$/.exec(String(typeof c === 'object' ? c?.label : c || '').trim());
    return m ? Number(m[1]) : null;
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

/*
 * Where a take comes from: made on the ComfyUI PC, made on this Mac (Generators), or a finished clip the director
 * adds from a file (made anywhere else; its provider is what they say, else "imported").
 */
const TAKE_SOURCES = Object.freeze({
    pc: Object.freeze({ provider: 'comfyui', tag: 'comfyui' }),
    mac: Object.freeze({ provider: 'generators', tag: 'mac' }),
    file: Object.freeze({ provider: 'imported', tag: 'file' }),
});

/** Add a finished take to its shot as the newest video version; answers what the page shows. meta.where: TAKE_SOURCES (pc by default). */
function fileTake(projectId, shotId, file, meta) {
    const where = TAKE_SOURCES[meta.where] ? meta.where : 'pc';
    const source = TAKE_SOURCES[where];
    const ext = path.extname(file).toLowerCase() || '.mp4';
    const row = db.prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM film_assets
        WHERE shot_id = ? AND asset_type IN ('video_final','video_synced','video_raw')`).get(shotId);
    const version = Number(row?.v || 0) + 1;
    const code = String(meta.label || 'shot').replace(/[^\w+-]+/g, '_');
    const name = `${code}_${source.tag}_v${version}_${Date.now()}${ext}`;
    const stored = copyFile(projectId, 'video', name, file);
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO film_assets (id, project_id, shot_id, asset_type, file_path, file_name, format, mime_type, version,
        provider, provider_model, provider_job_id, license_source, license_status, input_refs)
        VALUES (?, ?, ?, 'video_raw', ?, ?, ?, ?, ?, ?, ?, ?, 'generated', 'generated', ?)`)
        .run(id, projectId, shotId, stored, name, ext.slice(1), { '.webm': 'video/webm', '.mov': 'video/quicktime' }[ext] || 'video/mp4', version,
            (where === 'file' && meta.provider) || source.provider, meta.workflow || null, meta.prompt_id || null,
            JSON.stringify(where === 'file' ? { file: { source: meta.source || path.basename(file) } }
                : { comfyui: { url: where === 'mac' ? 'this Mac' : comfy.baseUrl(), workflow: meta.workflow, seed: meta.seed, options: meta.options,
                    ...(meta.from ? { from: meta.from } : {}) } }));
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
    // The video is as long as the Duration chosen, not the shot: the dialogue is cut to the same length.
    const chosen = chosenSeconds(manifest, body.options || {});
    const length = chosen || Number(body.duration_s) || 5;
    const late = (body.no_dialogue ? [] : body.shots || []).flatMap(s => (s.lines || []).filter(l => Number(s.offset_s || 0) + Number(l.t || 0) >= length));
    const unit = { ...body, duration_s: length, dialogue_as: 'video' };   // the WAV below is taken from the MP4
    const materials = await gather(projectId, body.no_dialogue ? { ...unit, shots: (body.shots || []).map(s => ({ ...s, lines: [] })), dialogue_file: null } : unit, folder);
    const pictures = slotOrder(materials).slice(0, (manifest.images || []).length);
    const video = materials.find(m => m.kind === 'video');
    let dialogue = null;
    if (video && (manifest.audio || []).length) {
        const wav = video.file.replace(/\.mp4$/i, '.wav');
        await run(resolveFfmpeg().bin, ['-v', 'error', '-y', '-i', video.file, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
        dialogue = { file: wav, cues: video.cues || [], source: video.source };
    }
    const prompt = [String(body.prompt || '').trim(), promptKey(pictures, dialogue)].filter(Boolean).join('\n\n');
    // Sent once for every take (the names start with a hash of the bytes, so a sheet already on the PC is not sent again).
    const images = [];
    for (const m of pictures) images.push(await comfy.upload(m.file));
    const audio = dialogue ? [await comfy.upload(dialogue.file)] : [];
    const jobs = [];
    for (let t = 0; t < takes; t++) {
        const seed = crypto.randomInt(0, 2 ** 47);
        const meta = { label: body.label, workflow: body.workflow, seed, options: body.options || {} };
        jobs.push(comfy.startJob({ workflow: body.workflow, prompt, seed, options: body.options || {}, shot_id: shotId, images, audio },
            { label: `Take ${t + 1}`, uploaded: true, fileOn: { project_id: projectId, shot_id: shotId, meta },
                sources: { images: pictures.map(m => m.file), audio: dialogue ? [dialogue.file] : [] } }));
    }
    const notes = [];
    if (!dialogue && (manifest.audio || []).length && !body.no_dialogue) notes.push('No recorded dialogue was found for this shot, so the video is made without it.');
    if (late.length) notes.push(`${late.length} line${late.length === 1 ? ' starts' : 's start'} after ${length} s, past the Duration chosen, so ${late.length === 1 ? 'it is' : 'they are'} left out.`);
    return {
        jobs, length_s: length,
        pictures: pictures.map((m, i) => ({ slot: i + 1, role: m.role, name: m.name })),
        dialogue: dialogue ? { source: dialogue.source, lines: dialogue.cues.length - late.length } : null,
        note: notes.join(' ') || null,
    };
}

const VIDEO_TYPES = ['video_final', 'video_synced', 'video_raw'];

/** A finished clip from a file, added to the shot as its next take (so take tools can work on it). body: { path, provider? } */
function importTake(shotId, body = {}) {
    const shot = db.prepare('SELECT sh.id, sh.shot_code, sc.project_id FROM film_shots sh JOIN film_scenes sc ON sc.id = sh.scene_id WHERE sh.id = ?').get(String(shotId));
    if (!shot) throw httpError(404, 'no such shot');
    const file = String(body.path || '');
    if (!path.isAbsolute(file) || !fs.existsSync(file)) throw httpError(404, `no file at ${file || '(no path)'}`);
    const ff = resolveFfmpeg();
    // ffmpeg names each stream it finds ("Stream #0:0: Video: …"); a cover picture in a sound file is not a video.
    const info = require('child_process').spawnSync(ff.bin, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr || '';
    if (!/Stream #\S+.*: Video: (?!.*attached pic)/.test(info)) throw httpError(400, `${path.basename(file)} is not a video`);
    return fileTake(shot.project_id, shot.id, file, { label: shot.shot_code, where: 'file', provider: body.provider ? String(body.provider) : null, source: path.basename(file) });
}

/** A shot's video takes, newest first, each with what made it and the take it was made from. */
function listTakes(shotId) {
    return db.prepare(`SELECT id, version, asset_type, provider, provider_model, file_path, input_refs, created_at FROM film_assets
        WHERE shot_id = ? AND asset_type IN (${VIDEO_TYPES.map(() => '?').join(',')}) ORDER BY version DESC, created_at DESC`).all(shotId, ...VIDEO_TYPES)
        .map(r => {
            let refs = {}; try { refs = JSON.parse(r.input_refs || '{}') || {}; } catch (_) { /* old rows */ }
            const c = refs.comfyui || null;
            return { asset_id: r.id, version: r.version, provider: r.provider, workflow: c?.workflow || r.provider_model || null,
                options: c?.options || null, from: c?.from || null, url: urlForPath(r.file_path), exists: fs.existsSync(r.file_path), created_at: r.created_at };
        });
}

/**
 * Work on a finished take with a workflow that takes a video (upscale to 1080p or 4K, and so on): the take goes
 * up as the workflow's video input, and the result is filed on the same shot as its next version, remembering
 * which take it came from. body: { workflow, options? }
 */
async function makeFromTake(assetId, body = {}) {
    const a = db.prepare(`SELECT a.id, a.project_id, a.shot_id, a.version, a.file_path, s.shot_code FROM film_assets a
        JOIN film_shots s ON s.id = a.shot_id JOIN film_scenes sc ON sc.id = s.scene_id
        WHERE a.id = ? AND sc.project_id = a.project_id AND a.asset_type IN (${VIDEO_TYPES.map(() => '?').join(',')})`).get(String(assetId || ''), ...VIDEO_TYPES);
    if (!a) throw httpError(404, 'that take is not a video version of a shot');
    if (!fs.existsSync(a.file_path)) throw httpError(404, `the take's file is missing: ${a.file_path}`);
    if (String(body.workflow || '').startsWith('mac:')) return makeOnMac(a, body.workflow, body.options || {});
    const { manifest } = await comfy.loadWorkflow(body.workflow);
    if (!(manifest.video || []).length) throw httpError(400, `${manifest.name || body.workflow} does not take a video; pick a take tool`);
    const meta = { label: a.shot_code, workflow: body.workflow, options: body.options || {}, from: { asset_id: a.id, version: a.version } };
    const video = await forThePc(a.file_path);
    const job = comfy.startJob({ workflow: body.workflow, options: body.options || {}, shot_id: a.shot_id, video: [video] },
        { label: `${manifest.name || body.workflow} of v${a.version}`, fileOn: { project_id: a.project_id, shot_id: a.shot_id, meta } });
    return { job };
}

/*
 * What the PC reads as it is: H.264 (its smoke decoded it). A take in any other codec (the HEVC of a Seedance draft,
 * the ProRes of a Mac upscale, VP9) goes as an H.264 MP4 made for it: near-lossless (CRF 10), the same frames and
 * length, the sound as AAC. The take itself is left as it is.
 */
const PC_READS = ['h264'];
async function forThePc(file) {
    const ff = resolveFfmpeg().bin;
    const info = require('child_process').spawnSync(ff, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr || '';
    const codec = (/Stream #\S+.*: Video: (\w+)/.exec(info) || [])[1];
    if (!codec || PC_READS.includes(codec)) return file;   // H.264 already, or nothing ffmpeg can name (sent as it is)
    const dir = path.join(DATA_DIR, 'comfyui', 'inputs', `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${path.basename(file, path.extname(file))}.mp4`);
    await run(ff, ['-v', 'error', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'slow', '-crf', '10',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', out]);
    return out;
}

/*
 * Take tools on THIS Mac: the Generators tools that take a whole video and give back a video (AI Upscale, which runs
 * Real-ESRGAN on the Mac's own GPUs). Listed beside the PC's take tools; the result is filed the same way.
 */
const MAC_TOOLS = ['upscale'];
function macTools() {
    const gen = require('./generators');
    return gen.listTools().filter(t => MAC_TOOLS.includes(t.id)).map(t => ({
        slug: `mac:${t.id}`, name: `${t.name} (this Mac)`, where: 'mac', kind: 'fx', ready: !t.unavailable, problems: t.unavailable ? [t.unavailable] : [],
        video: [{ role: 'take' }], draft: null,
        // Only the picks; sliders and checkboxes keep the tool's defaults.
        options: (t.options || []).filter(o => o.type === 'select').map(o => ({ id: o.name, label: o.label, type: 'enum',
            choices: o.choices.map((c, i) => ({ label: c.label, index: i, value: c.value })), default: Math.max(0, o.choices.findIndex(c => c.value === o.default)) })),
    }));
}

/** Run a Mac take tool on a take; its job is followed like a PC job (GET /film/comfyui/jobs/:id). */
function makeOnMac(a, slug, options) {
    const gen = require('./generators');
    const tool = macTools().find(t => t.slug === slug);
    if (!tool) throw httpError(400, `${slug} is not a take tool on this Mac`);
    if (!tool.ready) throw httpError(409, `${tool.name} is not ready: ${tool.problems.join('; ')}`);
    // The pills send labels; the engine takes the values.
    const values = {};
    for (const o of tool.options) { const c = o.choices.find(x => x.label === options[o.id] || x.index === options[o.id]); if (c) values[o.id] = c.value; }
    const input = gen.probeInput(a.file_path);
    const gj = gen.createJob({ tool: slug.slice(4), input_id: input.id, options: values });
    const j = comfy.trackExternal({ workflow: slug, label: `${tool.name.replace(' (this Mac)', '')} of v${a.version} on this Mac`, shot_id: a.shot_id }, async j => {
        for (;;) {
            await new Promise(r => setTimeout(r, Number(process.env.FILM_COMFYUI_POLL_MS) || 1500));
            const g = gen.getJob(gj.id);
            if (g.status === 'running') {
                j.status = 'running';
                if (g.total) {
                    const per = g.done > 0 ? (Date.now() - Date.parse(g.started_at)) / g.done : null;
                    j.progress = { value: g.done, max: g.total, node: 'mac', eta_s: per ? Math.round(per * (g.total - g.done) / 1000) : null };
                }
            }
            if (g.status === 'done') {
                if (!g.outputs.length) throw httpError(502, `${tool.name} finished without a file`);
                j.outputs = g.outputs.map(p => ({ path: p, name: path.basename(p) }));
                j.filed = fileTake(a.project_id, a.shot_id, g.outputs[0], { label: a.shot_code, workflow: slug, where: 'mac', options, from: { asset_id: a.id, version: a.version } });
                return;
            }
            if (g.status === 'failed' || g.status === 'cancelled') throw httpError(502, g.error || `${tool.name} ${g.status}`);
        }
    });
    return { job: j };
}

module.exports = { makeShot, listTakes, makeFromTake, macTools, slotOrder, promptKey, fileTake, importTake, chosenSeconds, TAKE_SOURCES, PC_READS };
