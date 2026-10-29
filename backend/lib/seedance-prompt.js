/**
 * SEEDANCE PROMPT: the final prompt for Seedance 2.5, written by ChatGPT the way the director found works.
 *
 * Their process, by hand: the character sheets, the location sheet, the dialogue audio laid on a black-screen MP4,
 * their own description, and the Seedance 2.5 prompt-builder guide (prompt-guides/seedance-25-prompt-builder.md),
 * all given to ChatGPT, which wrote the final prompt in the guide's format; then that prompt and the same assets go to
 * Seedance (draft first) on Higgsfield. This does the gathering and the asking:
 *
 *   - a CHARACTER SHEET per character: their approved views (front, side, back) side by side in one picture
 *   - a LOCATION SHEET per location (its approved views), each PROP's plates, each shot's STORYBOARD frame
 *   - the DIALOGUE: every recorded line placed at its time on one track, on a black-screen MP4 (@Video 1)
 *   - the director's working prompt, as it stands (their direction and their own edits)
 *
 * ChatGPT is the user's own Codex sign-in (lib/codex-astra.js; the newest Astra model): free to the project. The
 * pictures go in as images; the MP4 cannot, so its lines and times are written out for it. Everything is written to a
 * hand-off folder, numbered and named by the label the prompt binds it to (01 @Image 1 - JUNE character sheet.png), with
 * the prompt beside them, so what is uploaded to Seedance is exactly what the prompt names.
 *
 * Nothing here calls a paid service: Seedance itself stays a hand-over (manual-generation.js).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { db } = require('../db/database');
const { dirFor, ensureDir } = require('./file-storage');
const { loadGallery } = require('./subject-gallery');
const { resolveFfmpeg } = require('./ffmpeg');

const GUIDE_PATH = path.join(__dirname, '..', 'prompt-guides', 'seedance-25-prompt-builder.md');
const VIEW_ORDER = ['front', 'side-right', 'side', 'side-left', 'three-quarter', 'back'];
const MAX_IMAGES = 12;   // the guide's stable range is 1-8 subjects; sheets keep a cast of four well inside it
const SHEET_H = 900;

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

/** The guide, as stored in the app; its closing marketing line and the "ask first" step do not apply here. */
function guide() {
    const md = fs.readFileSync(GUIDE_PATH, 'utf8');
    return md.replace(/^---[\s\S]*?---\n/, '').replace(/## Closing line \(required\)[\s\S]*?(?=\n## |$)/, '').trim();
}

const exists = p => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
const sortViews = rows => [...rows].sort((a, b) => {
    const ia = VIEW_ORDER.indexOf(a.view || ''), ib = VIEW_ORDER.indexOf(b.view || '');
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});

/** A subject's approved plates (the gallery's own rule: references only, never expressions or inspiration). */
function platesOf(kind, id, projectId) {
    const rows = sortViews(loadGallery(db, kind, id).filter(r => r.sendable && r.project_id === projectId && exists(r.file_path)));
    // A character with a MAIN sheet (lib/character-sheet-main.js) is that one picture: it is already the full sheet.
    const main = rows.find(r => r.metadata && r.metadata.main_sheet);
    return main ? [main] : rows;
}

function run(bin, args) {
    return new Promise((resolve, reject) => {
        const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        p.stderr.on('data', d => { err = (err + d).slice(-2000); });
        p.on('error', reject);
        p.on('close', code => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited ${code}`))));
    });
}

/** Pictures side by side at one height: one picture of every view, as a character sheet is. */
async function sheet(ff, files, out) {
    if (files.length === 1) { await run(ff, ['-v', 'error', '-y', '-i', files[0], '-frames:v', '1', out]); return; }
    const ins = files.flatMap(f => ['-i', f]);
    const scaled = files.map((_, i) => `[${i}:v]scale=-2:${SHEET_H},setsar=1[v${i}]`).join(';');
    const graph = `${scaled};${files.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${files.length}[o]`;
    await run(ff, ['-v', 'error', '-y', ...ins, '-filter_complex', graph, '-map', '[o]', '-frames:v', '1', out]);
}

/** The newest recording of each line of a shot, by its file's name: <code>_<CHARACTER>_<line index>.mp3. */
function lineAudio(shotId, code, index) {
    const rows = db.prepare("SELECT file_path, file_name FROM film_assets WHERE shot_id = ? AND asset_type = 'audio_dialogue' ORDER BY created_at DESC").all(shotId);
    const re = new RegExp(`^${String(code).replace(/[^\w]/g, '.')}_.+_${index}\\.[a-z0-9]+$`, 'i');
    return rows.find(r => re.test(r.file_name || '') && exists(r.file_path))?.file_path || null;
}

/** Every recorded line at its time, on a black screen: Seedance takes the voices and timing from it, not its picture. */
/*
 * The forms the dialogue is handed over in: on a black-screen MP4 (the director's hand-over to Seedance on Higgsfield,
 * which takes it as a video reference), or the sound alone as a WAV (Seedance 2.5's audio reference). One mix either way.
 */
const DIALOGUE_FORMS = Object.freeze({
    video: Object.freeze({ label: '@Video 1', kind: 'video', ext: '.mp4', streams: 'audio,video' }),
    audio: Object.freeze({ label: '@Audio 1', kind: 'audio', ext: '.wav', streams: 'audio' }),
});
async function dialogueTrack(ff, cues, durationS, out, as = 'video') {
    const ins = cues.flatMap(c => [...(c.from ? ['-ss', String(c.from)] : []), '-i', c.file]);
    const n = cues.length;
    const delays = cues.map((c, i) => `[${i}:a]aresample=48000,adelay=${Math.round(c.at * 1000)}:all=1[a${i}]`).join(';');
    const mix = n > 1 ? `${delays};${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${n}:normalize=0[mix]` : `${delays};[a0]anull[mix]`;
    const filter = ['-filter_complex', `${mix};[mix]apad,atrim=0:${durationS}[a]`];
    if (as === 'audio') return run(ff, ['-v', 'error', '-y', ...ins, ...filter, '-map', '[a]', '-c:a', 'pcm_s16le', '-t', String(durationS), out]);
    await run(ff, ['-v', 'error', '-y', ...ins, '-f', 'lavfi', '-i', `color=c=black:s=1280x720:r=24:d=${durationS}`,
        ...filter, '-map', `${n}:v`, '-map', '[a]',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', String(durationS), '-movflags', '+faststart', out]);
}

const safe = s => String(s || '').replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
const tc = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/**
 * Gather the materials for one unit (a shot, or a sequence generated as one clip).
 * body: { label, prompt, duration_s, aspect, model_label?, shots: [{ shot_id, code, offset_s, lines: [{ index, t, ch, name, text }] }],
 *         character_ids, location_ids, prop_ids, storyboard_asset_ids, dialogue_file?, dialogue_as? ('video' | 'audio', DIALOGUE_FORMS) }
 */
async function gather(projectId, body, folder) {
    const as = body.dialogue_as || 'video';
    const form = DIALOGUE_FORMS[as];
    if (!form) throw httpError(400, `dialogue_as must be one of ${Object.keys(DIALOGUE_FORMS).join(', ')}`);
    const ff = resolveFfmpeg();
    if (!ff || !ff.available) throw httpError(500, 'ffmpeg is needed to make the reference sheets');
    const materials = [];
    let n = 0;
    // The storyboard frames are gathered last but always fit: the sheets stop short of the cap by as many frames.
    const frames = new Set((body.storyboard_asset_ids || []).filter(Boolean).map(String)).size;
    const add = async (role, name, files, about) => {
        const cap = role === 'storyboard frame' ? MAX_IMAGES : MAX_IMAGES - frames;
        if (!files.length || materials.filter(m => m.kind === 'image').length >= cap) return;
        n++;
        const label = `@Image ${materials.filter(m => m.kind === 'image').length + 1}`;
        const file = path.join(folder, `${String(n).padStart(2, '0')} ${label} - ${safe(name)} ${role}.png`);
        await sheet(ff.bin, files, file);
        materials.push({ kind: 'image', label, role, name, file, about, sources: files.length });
    };
    const uniq = a => [...new Set((a || []).filter(Boolean).map(String))];
    for (const id of uniq(body.character_ids)) {
        const c = db.prepare('SELECT name FROM film_characters WHERE id = ? AND project_id = ?').get(id, projectId);
        const rows = c ? platesOf('character', id, projectId) : [];
        const main = rows.length === 1 && rows[0].metadata && rows[0].metadata.main_sheet;
        await add('character sheet', c?.name || 'character', rows.map(r => r.file_path), main
            ? 'a three-panel character sheet of ONE person: headless front, back, and face close-up, the same outfit in all three'
            : `${rows.length} view${rows.length === 1 ? '' : 's'} of ONE person (${rows.map(r => r.view || 'view').join(', ')})`);
    }
    for (const id of uniq(body.location_ids)) {
        const l = db.prepare('SELECT name FROM film_locations WHERE id = ? AND project_id = ?').get(id, projectId);
        const rows = l ? platesOf('location', id, projectId) : [];
        await add('location sheet', l?.name || 'location', rows.map(r => r.file_path),
            `${rows.length} view${rows.length === 1 ? '' : 's'} of ONE place (${rows.map(r => r.view || 'view').join(', ')})`);
    }
    for (const id of uniq(body.prop_ids)) {
        const p = db.prepare('SELECT name FROM film_props WHERE id = ? AND project_id = ?').get(id, projectId);
        const rows = p ? platesOf('prop', id, projectId) : [];
        await add('prop', p?.name || 'prop', rows.map(r => r.file_path), `${rows.length} view${rows.length === 1 ? '' : 's'} of ONE object`);
    }
    for (const [i, id] of uniq(body.storyboard_asset_ids).entries()) {
        const a = db.prepare('SELECT file_path FROM film_assets WHERE id = ? AND project_id = ?').get(id, projectId);
        const shot = (body.shots || [])[i];
        if (a && exists(a.file_path)) await add('storyboard frame', `shot ${shot?.code || i + 1}`, [a.file_path], 'the storyboard frame: composition and framing to follow');
    }

    /*
     * The dialogue. A recording the director chose (dialogue_file: the scene's whole take, say, with where this clip
     * starts in it) wins; else each recorded line of the shots, placed where it is spoken. Either way the lines and
     * their times are written out for ChatGPT, which cannot hear the file.
     */
    const lines = [];
    for (const s of body.shots || []) for (const l of s.lines || []) lines.push({ s, l, at: Math.max(0, Number(s.offset_s || 0) + Number(l.t || 0)) });
    const said = lines.map(x => ({ at: x.at, name: x.l.name || x.l.ch, text: x.l.text || '' }));
    const duration = Math.max(1, Number(body.duration_s) || 5);
    const chosen = body.dialogue_file && body.dialogue_file.path;
    const cues = chosen ? [] : lines.map(x => ({ file: lineAudio(x.s.shot_id, x.s.code, x.l.index), at: x.at })).filter(c => c.file);
    if (chosen || cues.length) {
        n++;
        const file = path.join(folder, `${String(n).padStart(2, '0')} ${form.label} - dialogue${as === 'video' ? ' (black screen)' : ''}${form.ext}`);
        if (chosen) {
            const src = String(body.dialogue_file.path);
            if (!path.isAbsolute(src) || !exists(src)) throw httpError(404, `the dialogue recording is not at ${src}`);
            await dialogueTrack(ff.bin, [{ file: src, at: 0, from: Math.max(0, Number(body.dialogue_file.from_s) || 0) }], duration, file, as);
        } else await dialogueTrack(ff.bin, cues, duration, file, as);
        materials.push({ kind: form.kind, label: form.label, role: 'dialogue audio', name: 'dialogue', file,
            about: as === 'video' ? 'the recorded dialogue on a black screen: voices and timing only, never its picture' : 'the recorded dialogue: the voices and their timing', cues: said,
            source: chosen ? `${path.basename(String(body.dialogue_file.path))} from ${Number(body.dialogue_file.from_s) || 0} s` : `${cues.length} recorded line${cues.length === 1 ? '' : 's'}` });
    }
    return materials;
}

function question(body, materials) {
    const lines = materials.map(m => m.kind !== 'image'
        ? `${m.label} = ${m.about}.${m.cues.length ? ` Its lines, as directed: ${m.cues.map(c => `${tc(c.at)} ${c.name}: "${c.text}"`).join('; ')}.` : ''}`
        : `${m.label} = ${m.role} of ${m.name}: ${m.about}.`);
    return [
        'You write the final prompt a film director will paste into Seedance 2.5 (Dreamina) on Higgsfield.',
        'Follow the guide below exactly: its master template, its reference binding (name and bind EVERY material individually, with exclusions such as "do not use the image background" where a reference could leak), its stage/timestamp discipline, its audio syntax and its exclusions.',
        'Do not ask questions; draft now. Do not add the guide\'s closing line or anything outside the prompt.',
        'Keep every fact of the director\'s working prompt: who is there, what happens and when, every spoken line verbatim and in order, the camera, the light, the sound. Do not invent characters, places, props or lines.',
        'Use the attached pictures to describe appearance, place and composition precisely, and bind them by the labels below. The pictures are attached in label order (@Image 1 first).',
        '',
        `CLIP: ${body.label || 'shot'} · ${Number(body.duration_s) || 5} s · ${body.aspect || '16:9'}${body.model_label ? ` · for ${body.model_label}` : ''}.`,
        'REFERENCE MATERIALS:',
        ...(lines.length ? lines : ['none (text only)']),
        '',
        'THE DIRECTOR\'S WORKING PROMPT:',
        String(body.prompt || '').trim(),
        '',
        'THE GUIDE:',
        guide(),
        '',
        'Answer ONLY with JSON: {"prompt": "<the final Seedance 2.5 prompt>", "references": [{"label": "@Image 1", "use": "<what this material is used for, one sentence>"}], "notes": ["<anything the director should check, one short sentence each>"]}',
    ].join('\n');
}

function jsonIn(text) {
    const s = String(text || ''), i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { return null; }
}

/** The whole job: gather, ask, write the hand-off folder. Returns what the page shows and keeps. */
async function writeSeedancePrompt(projectId, body, { ask = require('./codex-astra').ask, onStage = () => {} } = {}) {
    if (!db.prepare('SELECT 1 FROM film_projects WHERE id = ?').get(projectId)) throw httpError(404, 'no such project');
    if (!String(body.prompt || '').trim()) throw httpError(400, 'nothing to optimize: the prompt is empty');
    ensureDir(projectId, 'exports');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const folder = path.join(dirFor(projectId, 'exports'), 'Seedance hand-off', `${safe(body.label || 'shot')} ${stamp}`);
    fs.mkdirSync(folder, { recursive: true });
    onStage('sheets', 'Making the character and location sheets and the dialogue track');
    const materials = await gather(projectId, body, folder);
    const images = materials.filter(m => m.kind === 'image').map(m => m.file);
    onStage('writing', `ChatGPT is writing the prompt from ${images.length} picture${images.length === 1 ? '' : 's'}${materials.some(m => m.kind !== 'image') ? ' and the dialogue' : ''}`);
    const answer = await ask({ prompt: question(body, materials), images });
    onStage('saving', 'Saving the prompt and the hand-off folder');
    const parsed = jsonIn(answer.text);
    if (!parsed || typeof parsed.prompt !== 'string' || !parsed.prompt.trim()) throw httpError(502, 'ChatGPT\'s answer had no prompt in it');
    const uses = new Map((Array.isArray(parsed.references) ? parsed.references : []).map(r => [String(r.label || '').replace(/\s+/g, ' ').trim(), String(r.use || '')]));
    const refs = materials.map((m, i) => ({ order: i + 1, label: m.label, kind: m.kind, role: m.role, name: m.name, ...(m.source ? { source: m.source } : {}),
        file: m.file, file_name: path.basename(m.file), use: uses.get(m.label) || m.about, in_prompt: parsed.prompt.includes(m.label) }));
    const prompt = parsed.prompt.trim();
    fs.writeFileSync(path.join(folder, '00 prompt.txt'), prompt + '\n\n' + refs.map(r => `${r.label}: ${r.file_name} (${r.use})`).join('\n') + '\n');
    return { prompt, refs, folder, notes: (Array.isArray(parsed.notes) ? parsed.notes : []).map(String).slice(0, 8),
        model: answer.model, by: 'chatgpt', created_at: new Date().toISOString(),
        source_sha: crypto.createHash('sha1').update(String(body.prompt)).digest('hex').slice(0, 12) };
}

/*
 * As a job: ChatGPT takes one to three minutes and says nothing while it writes, so the page polls the stage and the
 * time taken, and the result is kept here until read even if the page was left meanwhile. In memory: a restart loses
 * a running job, which the page reports as gone.
 */
const jobs = new Map();
function startJob(projectId, body, opts = {}) {
    const id = crypto.randomUUID();
    const job = { id, project_id: projectId, label: body.label || '', status: 'running', stage: 'starting', stage_label: 'Starting',
        started_at: Date.now(), stage_at: Date.now(), result: null, error: null };
    jobs.set(id, job);
    for (const [k, j] of jobs) if (j.status !== 'running' && Date.now() - j.started_at > 6 * 3600e3) jobs.delete(k);
    writeSeedancePrompt(projectId, body, { ...opts, onStage: (stage, label) => Object.assign(job, { stage, stage_label: label, stage_at: Date.now() }) })
        .then(result => Object.assign(job, { status: 'done', stage: 'done', stage_label: 'Done', result, finished_at: Date.now() }))
        .catch(err => Object.assign(job, { status: 'failed', error: err.message, finished_at: Date.now() }));
    return publicJob(job);
}
function publicJob(j) {
    const now = j.finished_at || Date.now();
    return { id: j.id, status: j.status, stage: j.stage, stage_label: j.stage_label, label: j.label, error: j.error, result: j.result,
        elapsed_s: Math.round((now - j.started_at) / 1000), stage_elapsed_s: Math.round((now - j.stage_at) / 1000) };
}
function getJob(id) { const j = jobs.get(String(id)); if (!j) throw httpError(404, 'that optimize job is gone (Film Engine restarted?); run it again'); return publicJob(j); }

module.exports = { startJob, getJob, writeSeedancePrompt, gather, question, guide, lineAudio, GUIDE_PATH, DIALOGUE_FORMS };
