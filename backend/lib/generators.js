/**
 * GENERATORS: Production's local AI tools (slow motion, upscale, depth, rotoscope, stems, subtitles).
 *
 * Each tool is a command-line engine in its own folder under ENGINE_DIR, described by a `generator.json`
 * manifest (name, what it accepts, whether it takes a section or the whole file, its options). This module
 * reads the manifests, checks the file the user dropped, runs one job at a time (they share the GPUs) and
 * reports progress from the JSON file every engine writes:
 *     { "stage", "done", "total", "out" | "outs", "error" }   ("done" and "error" are terminal)
 *
 * WHY HERE AND NOT IN RESOLVE. Free DaVinci Resolve 21.1 refuses both halves of an in-app tool: its Lua
 * logs "Fusion UIManager feature is not supported" for any window, and the script sandbox has no `io`, so a
 * script can neither start an engine nor read its progress. The engines run from this app instead and their
 * results land in a folder the user drags into Resolve.
 *
 * WHY A LOCAL PATH AND NOT AN UPLOAD. The backend runs on the same machine as the page, so a dropped file is
 * read where it is: no copy of a 2 GB ProRes and no body ceiling. Inputs are registered by id at probe time
 * and only registered paths are ever served back to the page.
 *
 * Free: nothing here calls a paid service; every engine runs on this Mac.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DATA_DIR } = require('./file-storage');
const { inspectMedia, resolveFfmpeg } = require('./ffmpeg');

const ENGINE_DIR = () => process.env.FILM_GENERATORS_DIR || path.join(os.homedir(), 'Documents', 'Resolve Plugins');
const OUT_ROOT = () => process.env.FILM_GENERATORS_OUT || path.join(os.homedir(), 'Movies', 'Film Engine Generators');
const STATE_DIR = () => path.join(process.env.FILM_GENERATORS_STATE || DATA_DIR, 'generators');
const POLL_MS = 700;
const VIDEO_EXT = new Set(['.mov', '.mp4', '.m4v', '.mkv', '.mxf', '.avi', '.webm', '.mts', '.m2ts']);
const AUDIO_EXT = new Set(['.wav', '.aif', '.aiff', '.mp3', '.m4a', '.aac', '.flac', '.ogg']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp', '.heic']);
const SHOWABLE_IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);   // the rest (TIFF, HEIC) get a PNG copy to show

// ── Tools ───────────────────────────────────────────────────────────────

/** Every tool folder with a valid generator.json, in a stable order. Read fresh, so a new engine appears. */
function listTools() {
    let dirs = [];
    try { dirs = fs.readdirSync(ENGINE_DIR(), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
    catch (_) { return []; }
    const tools = [];
    for (const d of dirs.sort()) {
        const dir = path.join(ENGINE_DIR(), d);
        const file = path.join(dir, 'generator.json');
        if (!fs.existsSync(file)) continue;
        try {
            const m = JSON.parse(fs.readFileSync(file, 'utf8'));
            const problem = validateManifest(m, dir);
            tools.push(problem ? { id: m.id || d, name: m.name || d, dir, unavailable: problem }
                : { ...m, dir, options: m.options || [] });
        } catch (err) {
            tools.push({ id: d, name: d, dir, unavailable: `generator.json is not valid JSON: ${err.message}` });
        }
    }
    return tools;
}

function validateManifest(m, dir) {
    if (!m || typeof m !== 'object') return 'empty manifest';
    if (!/^[a-z0-9-]+$/.test(String(m.id || ''))) return 'manifest id must be lowercase letters, digits or dashes';
    if (!m.script || !fs.existsSync(path.join(dir, m.script))) return `engine script ${m.script || '(none)'} is missing`;
    if (m.python && !fs.existsSync(path.join(dir, m.python))) return `its Python (${m.python}) is not installed yet`;
    if (!['section', 'whole'].includes(m.range)) return 'range must be "section" or "whole"';
    if (!m.out || !m.out.flag || !['file', 'dir'].includes(m.out.kind)) return 'out needs a flag and kind "file" or "dir"';
    return null;
}

function getTool(id) {
    const t = listTools().find(x => x.id === id);
    if (!t) throw httpError(404, `no generator called ${id}`);
    if (t.unavailable) throw httpError(409, `${t.name} is not ready: ${t.unavailable}`);
    return t;
}

/** The python a tool runs under: its own venv when the manifest names one, else the system's. */
function pythonFor(tool) {
    if (tool.python) return path.join(tool.dir, tool.python);
    const found = ['/usr/local/bin/python3', '/opt/homebrew/bin/python3', '/usr/bin/python3'].find(p => fs.existsSync(p));
    if (!found) throw httpError(500, 'python3 was not found on this Mac');
    return found;
}

/**
 * The engine's arguments from the manifest and the user's choices. Unknown options are dropped and values
 * are checked against the manifest, so the page can only ever pass what the tool declared.
 */
function buildArgs(tool, inputPath, { start, end, options } = {}, outPath, progressPath) {
    const args = [path.join(tool.dir, tool.script), inputPath];
    if (tool.range === 'section' && Number.isInteger(start) && Number.isInteger(end)) {
        if (start < 0 || end <= start) throw httpError(400, 'the section must end after it starts');
        args.push('--start', String(start), '--end', String(end));
    }
    const chosen = options || {};
    // A setting that applies only to some choices ("when": {"engine": ["ultrasharp"]}) is left out when they are not made:
    // Gigapixel took a Size, Fog took a blur. Judged on what will be sent (the choice made, else its default).
    const value = o => (chosen[o.name] !== undefined ? chosen[o.name] : o.default);
    const byName = Object.fromEntries((tool.options || []).map(o => [o.name, o]));
    const applies = o => !o.when || Object.entries(o.when).every(([k, vs]) => byName[k] && (vs || []).map(String).includes(String(value(byName[k]))));
    for (const opt of tool.options || []) {
        if (!applies(opt)) continue;
        const raw = chosen[opt.name] !== undefined ? chosen[opt.name] : opt.default;
        if (raw === undefined || raw === null || raw === '') continue;
        if (opt.type === 'checkbox') { if (raw === true || raw === 'true' || raw === 1) args.push(opt.flag); continue; }
        if (opt.type === 'select') {
            const hit = (opt.choices || []).find(c => String(c.value) === String(raw));
            if (!hit) throw httpError(400, `${opt.label || opt.name}: ${raw} is not one of its choices`);
            args.push(opt.flag, String(hit.value)); continue;
        }
        if (opt.type === 'slider' || opt.type === 'number') {
            const n = Number(raw);
            if (!Number.isFinite(n)) throw httpError(400, `${opt.label || opt.name} must be a number`);
            const lo = opt.min ?? -Infinity, hi = opt.max ?? Infinity;
            args.push(opt.flag, String(Math.min(hi, Math.max(lo, n)))); continue;
        }
        if (opt.type === 'points') {
            if (!/^(\s*[01]?\.?\d*,\s*[01]?\.?\d*,\s*[01]\s*;?)+$/.test(String(raw))) throw httpError(400, 'points must be "x,y,label;..." with x,y between 0 and 1');
            args.push(opt.flag, String(raw)); continue;
        }
        if (opt.type === 'text') { args.push(opt.flag, String(raw).slice(0, 200)); continue; }
    }
    if (chosen.frame !== undefined && Number.isInteger(Number(chosen.frame)) && tool.options?.some(o => o.type === 'points')) {
        args.push('--frame', String(Number(chosen.frame)));
    }
    args.push(tool.out.flag, outPath, '--progress', progressPath);
    return args;
}

// ── Inputs ──────────────────────────────────────────────────────────────

const inputs = new Map();   // id -> { id, path, name, kind, fps, width, height, duration, frames }

/** Check a dropped file and register it. Only registered inputs can be run or served. */
function probeInput(filePath) {
    load();
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw httpError(400, 'a full file path is needed');
    let st; try { st = fs.statSync(filePath); } catch (_) { throw httpError(404, `there is no file at ${filePath}`); }
    if (!st.isFile()) throw httpError(400, `${path.basename(filePath)} is not a file`);
    const ext = path.extname(filePath).toLowerCase();
    const kind = VIDEO_EXT.has(ext) ? 'video' : AUDIO_EXT.has(ext) ? 'audio' : IMAGE_EXT.has(ext) ? 'image' : null;
    if (!kind) throw httpError(400, `${path.basename(filePath)} is not a video, audio or image file this tab knows`);
    const info = kind === 'image' ? inspectImage(filePath) : inspectMedia(filePath);
    if (!info.ok) throw httpError(422, info.reason);
    const id = crypto.createHash('sha1').update(filePath + ':' + st.size + ':' + st.mtimeMs).digest('hex').slice(0, 16);
    const fps = info.fps || null;
    const rec = { id, path: filePath, name: path.basename(filePath), kind, size: st.size,
        fps, width: info.width, height: info.height, duration: info.durationSeconds,
        frames: fps ? Math.round(info.durationSeconds * fps) : null, has_audio: !!info.hasAudio,
        codec: info.codec || null, preview: needsPreview(filePath, info) };
    inputs.set(id, rec);
    persist();
    if (rec.preview) previewFile(filePath, info).catch(() => { /* the route reports it when the player asks */ });
    return rec;
}

// ── Previews ────────────────────────────────────────────────────────────

/*
 * The tab's player is Chromium's, and Chromium can't decode ProRes (or DNxHD, CineForm...): Electron 33
 * answers MEDIA_ERR_SRC_NOT_SUPPORTED. Every result here is ProRes, and a dropped master often is, so those
 * get an H.264 copy for the PLAYER ONLY; the engines always read the original. The copy keeps every frame
 * and the frame rate (passthrough), so the frame counter and In / Out marks stay true to the original.
 */
const PLAYABLE_VIDEO = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1']);
const PLAYABLE_AUDIO = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg']);
const previews = new Map();   // cache key -> Promise<path>, so two requests share one conversion

function needsPreview(filePath, info) {
    const ext = path.extname(filePath).toLowerCase();
    if (AUDIO_EXT.has(ext)) return !PLAYABLE_AUDIO.has(ext);
    if (IMAGE_EXT.has(ext)) return !SHOWABLE_IMAGE.has(ext);
    return !PLAYABLE_VIDEO.has(String(info && info.codec || '').toLowerCase());
}

/** A path the player can play: the file itself when it can, else a cached H.264 / AAC copy (made once). */
function previewFile(filePath, info) {
    const st = fs.statSync(filePath);
    const image = IMAGE_EXT.has(path.extname(filePath).toLowerCase());
    info = info || (image ? inspectImage(filePath) : inspectMedia(filePath));
    if (!info.ok) return Promise.reject(httpError(422, info.reason));
    if (!needsPreview(filePath, info)) return Promise.resolve(filePath);
    if (image) return imagePreview(filePath, st);
    const audio = AUDIO_EXT.has(path.extname(filePath).toLowerCase());
    const key = crypto.createHash('sha1').update(filePath + ':' + st.size + ':' + st.mtimeMs).digest('hex').slice(0, 16);
    const out = path.join(STATE_DIR(), 'previews', key + (audio ? '.m4a' : '.mp4'));
    if (fs.existsSync(out)) return Promise.resolve(out);
    if (!previews.has(key)) {
        const made = makePreview(filePath, out, audio, info.fps).finally(() => previews.delete(key));
        previews.set(key, made);
    }
    return previews.get(key);
}

/** A TIFF or HEIC shown as a PNG (made once), at most 3840 wide. */
function imagePreview(src, st) {
    const key = crypto.createHash('sha1').update(src + ':' + st.size + ':' + st.mtimeMs).digest('hex').slice(0, 16);
    const out = path.join(STATE_DIR(), 'previews', key + '.png');
    if (fs.existsSync(out)) return Promise.resolve(out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const ff = resolveFfmpeg();
    return new Promise((resolve, reject) => {
        const p = spawn(ff.bin, ['-nostdin', '-y', '-v', 'error', '-i', src, '-vf', "scale='min(3840,iw)':-2", '-frames:v', '1', out], { stdio: 'ignore' });
        p.on('error', reject);
        p.on('close', code => (code === 0 ? resolve(out) : reject(httpError(500, 'could not make a viewable copy of this image'))));
    });
}

function makePreview(src, out, audio, fps) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    prunePreviews(path.dirname(out));
    const ff = resolveFfmpeg();
    if (!ff || !ff.available) return Promise.reject(httpError(500, 'ffmpeg is needed to preview this file'));
    const tmp = out.replace(/(\.\w+)$/, '.part$1');
    // Full 4K up to 60 fps; past that (a 192 fps slow-mo) 1920 wide, which every decoder plays smoothly.
    const width = fps > 60 ? 1920 : 3840;
    const head = ['-nostdin', '-y', '-v', 'error', '-i', src];
    const tail = ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp];
    const video = enc => [...head, '-map', '0:v:0', '-map', '0:a:0?', '-fps_mode', 'passthrough',
        '-vf', `scale='min(${width},iw)':-2,format=yuv420p`, ...enc, ...tail];
    const tries = audio ? [[...head, '-vn', ...tail]]
        : [video(['-c:v', 'h264_videotoolbox', '-b:v', '24M']), video(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18'])];
    const run = args => new Promise((resolve, reject) => {
        const p = spawn(ff.bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        p.stderr.on('data', d => { err = (err + d).slice(-2000); });
        p.on('error', reject);
        p.on('close', code => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited ${code}`))));
    });
    return tries.reduce((chain, args) => chain.catch(() => run(args)), Promise.reject(new Error('start')))
        .then(() => { fs.renameSync(tmp, out); return out; })
        .catch(err => { try { fs.unlinkSync(tmp); } catch (_) { /* nothing written */ } throw httpError(500, `could not make a playable preview: ${err.message}`); });
}

/** Keep the newest 30 previews; they are only copies and are remade on demand. */
function prunePreviews(dir) {
    const files = listDir(dir).filter(f => !f.includes('.part.')).map(f => ({ f, t: fs.statSync(f).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(30)) { try { fs.unlinkSync(f); } catch (_) { /* in use or gone */ } }
}

/** A still: its size, read by ffmpeg (a still has no duration, which inspectMedia requires). */
function inspectImage(filePath) {
    const ff = resolveFfmpeg();
    if (!ff || !ff.available) return { ok: false, reason: 'ffmpeg is needed to read images' };
    const r = require('child_process').spawnSync(ff.bin, ['-hide_banner', '-i', filePath], { encoding: 'utf8', timeout: 30000 });
    const m = /Video: (\w+)[^\n]*?(\d{2,5})x(\d{2,5})/.exec(String(r.stderr || ''));
    if (!m) return { ok: false, reason: `ffmpeg could not read ${path.basename(filePath)} as an image` };
    return { ok: true, codec: m[1], width: Number(m[2]), height: Number(m[3]), durationSeconds: 0, fps: null, hasAudio: false };
}

function getInput(id) {
    load();
    const rec = inputs.get(String(id));
    if (!rec) throw httpError(404, 'that file is no longer registered; drop it again');
    if (!fs.existsSync(rec.path)) throw httpError(404, `${rec.name} has moved or been deleted`);
    return rec;
}

// ── Jobs ────────────────────────────────────────────────────────────────

const jobs = new Map();      // id -> job record (persisted)
let settings = {};           // { out_dir } (persisted): where results are saved; unset = per-tool default
const procs = new Map();     // id -> ChildProcess (this process only)
let loaded = false;

function stateFile() { return path.join(STATE_DIR(), 'state.json'); }
function load() {
    if (loaded) return; loaded = true;
    try {
        const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
        for (const i of s.inputs || []) inputs.set(i.id, i);
        settings = s.settings && typeof s.settings === 'object' ? s.settings : {};
        for (const j of s.jobs || []) {
            // A job that was running when the app quit has no process any more: say so rather than spin forever.
            if (j.status === 'running' || j.status === 'queued') { j.status = 'interrupted'; j.error = 'Film Engine was closed while this ran'; }
            jobs.set(j.id, j);
        }
    } catch (_) { /* first run */ }
}
function persist() {
    try {
        fs.mkdirSync(STATE_DIR(), { recursive: true });
        const tmp = stateFile() + '.tmp';
        const recent = [...jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200);
        fs.writeFileSync(tmp, JSON.stringify({ settings, inputs: [...inputs.values()].slice(-200), jobs: recent }, null, 1));
        fs.renameSync(tmp, stateFile());
    } catch (_) { /* state is a convenience; a failed write must not fail the job */ }
}

/**
 * Where results are saved. Unset: OUT_ROOT/<tool name>/ (~/Movies/Film Engine Generators/AI Slow-Mo/). Set:
 * that folder, used as is for every tool. It must be an absolute path to a folder this Mac can write to;
 * it's created if missing, and refused with a reason rather than failing later inside a job.
 */
function getSettings() {
    load();
    return { out_dir: settings.out_dir || null, default_out_dir: OUT_ROOT() };
}
function setSettings(body) {
    load();
    const dir = body && body.out_dir;
    if (dir === null || dir === '' || dir === undefined) { settings = { ...settings, out_dir: null }; persist(); return getSettings(); }
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw httpError(400, 'choose a folder (a full path)');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { throw httpError(400, `cannot create ${dir}: ${err.message}`); }
    if (!fs.statSync(dir).isDirectory()) throw httpError(400, `${dir} is a file, not a folder`);
    try { fs.accessSync(dir, fs.constants.W_OK); } catch (_) { throw httpError(403, `this Mac can't write to ${dir}`); }
    settings = { ...settings, out_dir: dir };
    persist();
    return getSettings();
}

function publicJob(j) {
    const { log_path, progress_path, _python, _args, ...rest } = j;   // the command line and internal paths stay internal
    return rest;
}
function listJobs() { load(); return [...jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(publicJob); }
function getJob(id) { load(); const j = jobs.get(String(id)); if (!j) throw httpError(404, 'no such generator job'); return j; }

function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); }

/** Queue a job: { tool, input_id, start?, end?, options? }. Starts at once if nothing else is running. */
function createJob(body) {
    load();
    const tool = getTool(String(body.tool || ''));
    const input = getInput(body.input_id);
    if (tool.accepts === 'audio' && input.kind !== 'audio' && !input.has_audio) throw httpError(400, `${input.name} has no audio`);
    // A tool that works on sound (stems, subtitles) says so with "audio_ok": it then takes a bare audio file too.
    if (tool.accepts === 'video' && input.kind !== 'video' && !tool.audio_ok) throw httpError(400, `${tool.name} needs a video`);
    if (tool.accepts === 'image' && input.kind !== 'image') throw httpError(400, `${tool.name} needs an image`);
    if (tool.accepts !== 'image' && input.kind === 'image') throw httpError(400, `${tool.name} needs a ${tool.accepts}, not an image`);
    const start = body.start !== undefined && body.start !== null ? Number(body.start) : undefined;
    const end = body.end !== undefined && body.end !== null ? Number(body.end) : undefined;
    const id = crypto.randomBytes(6).toString('hex');
    const base = input.name.replace(/\.[^.]+$/, '').replace(/[/:]/g, '-');
    const section = tool.range === 'section' && Number.isInteger(start) && Number.isInteger(end) ? ` f${start}-${end}` : '';
    const outDir = settings.out_dir || path.join(OUT_ROOT(), tool.name);   // the chosen folder, else the tool's default
    const outPath = path.join(outDir, `${base} - ${tool.name}${section} ${stamp()}${tool.out.kind === 'file' ? (tool.out.ext || '') : ''}`);
    const progressPath = path.join(STATE_DIR(), 'progress', `${id}.json`);
    const args = buildArgs(tool, input.path, { start, end, options: body.options }, outPath, progressPath);   // validates before anything is queued
    const job = { id, tool: tool.id, tool_name: tool.name, input_id: input.id, input_name: input.name,
        start: section ? start : null, end: section ? end : null, options: body.options || {},
        status: 'queued', stage: 'Waiting for the GPU', done: 0, total: 0, outputs: [], error: null,
        created_at: new Date().toISOString(), started_at: null, finished_at: null,
        out_path: outPath, out_kind: tool.out.kind, progress_path: progressPath, log_path: progressPath.replace(/\.json$/, '.log'),
        _python: pythonFor(tool), _args: args };
    jobs.set(id, job);
    persist();
    pump();
    return publicJob(job);
}

/** Start the oldest queued job when nothing is running: one at a time, they share the GPUs. */
function pump() {
    if ([...jobs.values()].some(j => j.status === 'running')) return;
    const next = [...jobs.values()].filter(j => j.status === 'queued').sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (next) start(next);
}

function start(job) {
    fs.mkdirSync(path.dirname(job.progress_path), { recursive: true });
    fs.mkdirSync(job.out_kind === 'dir' ? job.out_path : path.dirname(job.out_path), { recursive: true });
    try { fs.unlinkSync(job.progress_path); } catch (_) {}
    const log = fs.openSync(job.log_path, 'w');
    // Own process group, so Cancel stops the engine AND what it started (rife, ffmpeg, a GPU worker).
    const child = spawn(job._python, job._args, { detached: true, stdio: ['ignore', log, log],
        env: { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || '/usr/bin:/bin'}` } });
    fs.closeSync(log);
    procs.set(job.id, child);
    Object.assign(job, { status: 'running', stage: 'Starting', started_at: new Date().toISOString() });
    persist();
    const timer = setInterval(() => readProgress(job), POLL_MS);
    child.on('error', err => { finish(job, 'failed', `could not start the engine: ${err.message}`); });
    child.on('exit', (code, signal) => {
        clearInterval(timer);
        procs.delete(job.id);
        readProgress(job);
        if (job.status !== 'running') return;              // cancelled, or already failed
        if (job.stage === 'done') return finish(job, 'done');
        const tail = readTail(job.log_path);
        finish(job, 'failed', job.error || (signal ? `the engine stopped (${signal})` : `the engine exited with code ${code}`) + (tail ? `: ${tail}` : ''));
    });
}

function readProgress(job) {
    let p; try { p = JSON.parse(fs.readFileSync(job.progress_path, 'utf8')); } catch (_) { return; }
    job.stage = String(p.stage || job.stage);
    job.done = Number(p.done) || 0;
    job.total = Number(p.total) || 0;
    if (p.error) job.error = String(p.error);
    if (p.note) job.note = String(p.note).slice(0, 300);   // e.g. Subtitles: "no speech found"
    // An engine's measured results (mastering: LUFS, true peak), shown on the job. Flat values only.
    if (p.stats && typeof p.stats === 'object') job.stats = Object.fromEntries(Object.entries(p.stats)
        .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 12));
    const outs = Array.isArray(p.outs) ? p.outs : p.out ? [p.out] : [];
    if (outs.length) job.outputs = outs.map(String);
}

function readTail(file) {
    try { return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-3).join(' ').slice(-400); } catch (_) { return ''; }
}

function finish(job, status, error) {
    if (status === 'done' && !job.outputs.length) {
        job.outputs = job.out_kind === 'dir' ? listDir(job.out_path) : fs.existsSync(job.out_path) ? [job.out_path] : [];
    }
    if (status === 'done') job.outputs = job.outputs.filter(p => fs.existsSync(p));
    Object.assign(job, { status, error: error || null, finished_at: new Date().toISOString(), stage: status === 'done' ? 'done' : job.stage });
    persist();
    pump();
}
function listDir(d) { try { return fs.readdirSync(d).filter(f => !f.startsWith('.')).map(f => path.join(d, f)); } catch (_) { return []; } }

function cancelJob(id) {
    const job = getJob(id);
    if (job.status === 'queued') { finish(job, 'cancelled'); return publicJob(job); }
    if (job.status !== 'running') return publicJob(job);
    const child = procs.get(job.id);
    job.status = 'cancelled'; job.finished_at = new Date().toISOString(); persist();
    if (child) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { try { child.kill('SIGTERM'); } catch (__) {} }
        setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {} }, 3000).unref();
    }
    pump();
    return publicJob(job);
}

/** One of a finished job's outputs, by index: the only output paths ever served. */
function outputPath(id, n) {
    const job = getJob(id);
    const p = job.outputs[Number(n)];
    if (!p || !fs.existsSync(p)) throw httpError(404, 'that output is not there any more');
    return p;
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { listTools, getTool, buildArgs, pythonFor, probeInput, getInput, previewFile, createJob, listJobs, getJob, getSettings, setSettings,
    publicJob, cancelJob, outputPath, ENGINE_DIR, OUT_ROOT, _reset: () => { jobs.clear(); inputs.clear(); procs.clear(); settings = {}; loaded = false; } };
