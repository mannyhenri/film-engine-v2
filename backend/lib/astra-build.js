/**
 * ASTRA BUILDS: a location or a prop modelled in Blender, guided by Astra (GPT-6-Astra or newer, through the
 * user's Codex sign-in; lib/codex-astra.js).
 *
 *   round 1    Astra sees the subject's reference pictures and its own words and writes a complete Blender
 *              script: real-world scale in metres, the full geometry, materials, and for a location its
 *              lighting fixtures. Film Engine checks the script (astra_check.py) and runs it in background
 *              Blender inside an OS sandbox (blender-astra.py), which renders review views and exports a GLB.
 *   rounds 2+  Astra sees the references beside its review renders, the stats and any error, and its last
 *              script, and writes a full corrected one. A round that fails is retried once with the error.
 *   finish     the last good round's GLB becomes a 3D model asset of the subject (location_id / prop_id set),
 *              and for a location the next version of its world: a Previz set.
 *   2nd pass   a new build from a finished one (from_build_id) with a `details` note ("add wear on the
 *              counter, menus"): it starts from that build's final script and adds what was asked.
 *
 * One build runs at a time (Blender and Astra are both heavy); jobs persist in a JSON state file like the
 * Generators', and a build that was running when the backend stopped is marked interrupted.
 *
 * SAFETY. The script is AI-written code. It is refused on any import outside bpy/bmesh/mathutils/math/random,
 * any file, process, network or dunder access, and any save/export/import operator (astra_check.py, applied
 * here and again inside Blender); then Blender runs headless with factory settings and --disable-autoexec,
 * under macOS sandbox-exec: no network, writes only to the round's folder and the user's temp, and no
 * reading the user's keys (~/.ssh, ~/.codex, ~/.aws, Keychains) or Film Engine's own data folder.
 *
 * Cost: free to Film Engine. Astra runs on the user's ChatGPT plan (each round is one Codex turn); Blender is local.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const astra = require('./codex-astra');

const RUNNER = path.join(__dirname, '..', 'blender-astra.py');
const CHECKER = path.join(__dirname, '..', 'astra_check.py');
const KINDS = Object.freeze({
    location: { table: 'film_locations', column: 'location_id' },
    prop: { table: 'film_props', column: 'prop_id' },
});
const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = 6;
const MAX_REFS = 6;
const BLENDER_TIMEOUT_MS = 10 * 60 * 1000;
const ASTRA_TIMEOUT_MS = 10 * 60 * 1000;
const VIEWS = { prop: ['front', 'three_quarter_left', 'three_quarter_right', 'top'],
    location: ['front', 'three_quarter_left', 'three_quarter_right', 'top', 'interior_eye_level'] };

function db() { return require('../db/database').db; }
function httpError(status, message, code) { const e = new Error(message); e.status = status; if (code) e.code = code; return e; }
function stateDir() { return path.join(process.env.FILM_ASTRA_STATE || require('./file-storage').DATA_DIR, 'astra-builds'); }
function nowIso() { return new Date().toISOString(); }

// ── state ───────────────────────────────────────────────────────────────

const builds = new Map();
const running = new Map();   // id -> { abort: AbortController, children: Set<ChildProcess> }
let loaded = false;
let queue = Promise.resolve();

function stateFile() { return path.join(stateDir(), 'state.json'); }
function load() {
    if (loaded) return;
    loaded = true;
    try {
        const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
        for (const b of s.builds || []) {
            if (b.status === 'running' || b.status === 'queued') {
                b.status = 'interrupted'; b.stage = 'Interrupted: Film Engine stopped while this was building';
                b.finished_at = b.finished_at || nowIso();
            }
            builds.set(b.id, b);
        }
    } catch (_) { /* first run */ }
}
function persist() {
    try {
        fs.mkdirSync(stateDir(), { recursive: true });
        const tmp = stateFile() + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ builds: [...builds.values()] }, null, 1));
        fs.renameSync(tmp, stateFile());
    } catch (_) { /* state is a convenience; the asset rows are the record */ }
}
function update(b, patch) { Object.assign(b, patch); persist(); return b; }

/** What the page sees: no file paths, render URLs instead. */
function publicBuild(b) {
    if (!b) return null;
    const url = (r, n) => `/film/astra-builds/${b.id}/render/${r}/${n}`;
    const last = [...(b.rounds_log || [])].reverse().find(r => r.renders && r.renders.length);
    return {
        id: b.id, project_id: b.project_id, subject_kind: b.subject_kind, subject_id: b.subject_id, subject_name: b.subject_name,
        status: b.status, stage: b.stage, round: b.round, rounds: b.rounds, details: b.details || null,
        from_build_id: b.from_build_id || null, model: b.model || null,
        renders: last ? last.renders.map((r, n) => ({ view: r.view, url: url(last.round, n), round: last.round })) : [],
        history: (b.rounds_log || []).map(r => ({ round: r.round, ok: r.ok, tries: r.tries, error: r.error || null, stats: r.stats || null,
            note: r.note || null, renders: (r.renders || []).map((x, n) => ({ view: x.view, url: url(r.round, n) })) })),
        final_round: b.final_round || null, asset_id: b.asset_id || null, asset_url: b.asset_url || null,
        world_id: b.world_id || null, world_version_id: b.world_version_id || null,
        error: b.error || null, created_at: b.created_at, started_at: b.started_at || null, finished_at: b.finished_at || null,
    };
}

function listBuilds(projectId, { subject_kind, subject_id } = {}) {
    load();
    return [...builds.values()]
        .filter(b => b.project_id === projectId && (!subject_kind || b.subject_kind === subject_kind) && (!subject_id || b.subject_id === subject_id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(publicBuild);
}
function getBuild(id) {
    load();
    const b = builds.get(String(id));
    if (!b) throw httpError(404, 'no such Astra build');
    return b;
}

// ── the subject ─────────────────────────────────────────────────────────

function loadSubject(projectId, kind, id) {
    const spec = KINDS[kind];
    if (!spec) throw httpError(400, `subject_kind must be ${Object.keys(KINDS).join(' or ')} (characters go to Meshy)`);
    const row = db().prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id);
    if (!row || row.project_id !== projectId) throw httpError(404, `that ${kind} is not in this project`);
    return row;
}

/** The subject's sendable reference pictures, newest first, by its own column (never by file name). */
function referencesFor(kind, subjectId) {
    const { sendableSql } = require('./subject-gallery');
    const rows = db().prepare(`SELECT id, file_path, metadata FROM film_assets
        WHERE ${KINDS[kind].column} = ? AND asset_type IN ('reference_image', 'character_sheet') AND ${sendableSql()}
        ORDER BY created_at DESC`).all(subjectId);
    const out = [];
    const seenViews = new Set();
    for (const r of rows) {
        if (!r.file_path || !fs.existsSync(r.file_path) || !/\.(png|jpe?g|webp)$/i.test(r.file_path)) continue;
        let view = null;
        try { view = JSON.parse(r.metadata || '{}').view || null; } catch (_) { view = null; }
        if (view && seenViews.has(view)) continue;   // the newest plate per view, as the set builder takes them
        if (view) seenViews.add(view);
        out.push({ asset_id: r.id, path: r.file_path, view });
        if (out.length >= MAX_REFS) break;
    }
    return out;
}

function describe(kind, s) {
    const lines = [`Name: ${s.name}`];
    if (s.description) lines.push(`Description: ${s.description}`);
    if (kind === 'prop') {
        const dims = [['height', s.height_m], ['width', s.width_m], ['length', s.length_m]].filter(([, v]) => v);
        if (dims.length) lines.push(`Real size: ${dims.map(([k, v]) => `${k} ${v} m`).join(', ')}`);
        for (const k of ['category', 'materials', 'period', 'visual_prompt', 'notes']) if (s[k]) lines.push(`${k.replace('_', ' ')}: ${s[k]}`);
    } else {
        for (const k of ['location_type', 'reference_prompt', 'lighting_default', 'time_of_day_default', 'atmosphere_notes',
            'lighting_technique', 'continuity_notes']) if (s[k]) lines.push(`${k.replace(/_/g, ' ')}: ${s[k]}`);
    }
    return lines.join('\n').slice(0, 6000);
}

// ── the prompts ─────────────────────────────────────────────────────────

const RULES = kind => `RULES FOR THE SCRIPT
- One complete Blender 4.5 Python script, in a single \`\`\`python block. It runs in an EMPTY scene (no default cube, camera or light).
- Only these imports: bpy, bmesh, mathutils, math, random. No file, network or process access, no open(), exec, eval, getattr,
  no dunder names, no bpy.ops.wm / export / import / render / script operators, no bpy.app or bpy.utils, no image textures or
  files: the runner frames, renders, saves and exports. Anything else makes the whole script be refused.
- Real-world scale in METRES, Z up. ${kind === 'prop'
        ? 'The prop stands on z = 0, centred on the origin in X and Y, at its true size.'
        : 'The floor is at z = 0 and the room is centred on the origin; walls, floor and ceiling have real thickness; leave real openings for doors and windows.'}
- Model it fully, not as placeholder boxes: the real silhouette and proportions, the parts it is made of, bevels where edges are
  rounded (bevel / subdivision / solidify / array modifiers and bmesh are all fine). Name every object for what it is.
- Materials: Principled BSDF per material with the base colour, roughness and metallic you see in the pictures (glass: transmission
  ~1, low roughness; emissive for anything that glows). Colours in linear RGB.
${kind === 'location'
        ? '- Lighting: model the visible light fixtures (with emissive materials) and add real lights where the pictures show light coming from: area lights for windows, point/spot for practicals, a sun if sunlight falls through the windows. Match the direction and warmth you see.\n'
        : ''}- No cameras. Keep it under ${kind === 'prop' ? '60,000' : '400,000'} triangles. Deterministic: random.seed(0) if you use random.`;

function firstPrompt(kind, subject, refs, details) {
    return [
        `You are guiding Blender to build a 3D model of a film ${kind} for previsualisation. Build it so it matches the reference pictures as closely as you can.`,
        '',
        `THE ${kind.toUpperCase()}`,
        describe(kind, subject),
        '',
        refs.length ? `The first ${refs.length} attached image(s) are its reference pictures${refs.some(r => r.view) ? ` (views: ${refs.map(r => r.view || 'reference').join(', ')})` : ''}.`
            : 'There are no reference pictures: build it from the description.',
        details ? `\nTHE DIRECTOR ALSO ASKS FOR: ${details}` : '',
        '',
        RULES(kind),
        '',
        'Answer with one or two sentences on what you are building, then the script.',
    ].join('\n');
}

function nextPrompt(kind, subject, refs, prev, details, secondPass) {
    const r = prev.result || {};
    const renders = (r.renders || []).map(x => x.view);
    return [
        secondPass
            ? `You are refining a Blender model of a film ${kind} in a SECOND PASS. Below is the script that built the current model.`
            : `You are refining a Blender model of a film ${kind}. Below is your previous script and what it produced.`,
        '',
        `THE ${kind.toUpperCase()}`,
        describe(kind, subject),
        '',
        refs.length ? `Attached, in order: ${refs.length} reference picture(s), then ${renders.length ? `the review renders of the current model (${renders.join(', ')})` : 'no renders (the script failed)'}.`
            : `Attached: ${renders.length ? `the review renders of the current model (${renders.join(', ')})` : 'nothing (the script failed)'}.`,
        r.stats && r.stats.triangles ? `Measured: ${r.stats.objects} objects, ${r.stats.triangles} triangles, ${r.stats.materials} materials, ${r.stats.lights} lights, size ${r.stats.size_m.join(' x ')} m (x, y, z).` : '',
        prev.error ? `\nTHE LAST RUN FAILED:\n${String(prev.error).slice(0, 2500)}\nFix that first.` : '',
        details ? `\nTHE DIRECTOR ASKS FOR: ${details}\nAdd this on top of the current model; keep everything that already matches the pictures.` : '',
        '',
        'PREVIOUS SCRIPT',
        '```python', prev.script.slice(0, 60000), '```',
        '',
        secondPass ? '' : 'Compare the renders with the reference pictures. Name what is wrong (proportions, missing parts, materials and colours, lighting), then return a FULL corrected script (not a diff).',
        RULES(kind),
        '',
        'Answer with a short list of what you are changing, then the full script.',
    ].filter(l => l !== undefined).join('\n');
}

// ── running a script ────────────────────────────────────────────────────

/** The static gate, run by the same Python checker Blender applies again inside. */
function checkScript(source, dir) {
    const file = path.join(dir || fs.mkdtempSync(path.join(os.tmpdir(), 'astra-check-')), 'check.py');
    fs.writeFileSync(file, source);
    const py = process.env.FILM_PYTHON || 'python3';
    const r = spawnSync(py, ['-I', CHECKER, file], { encoding: 'utf8', timeout: 30000 });
    try { return JSON.parse(r.stdout).problems || []; } catch (_) { return [`the safety check could not run (${(r.stderr || r.error || '').toString().slice(0, 200)})`]; }
}

/** The user's own temp folder (/private/var/folders/<x>/<y>/<hash>), the one place besides the job Blender may write. */
function userTemp() {
    try { return path.dirname(fs.realpathSync(os.tmpdir())); } catch (_) { return null; }
}

function sandboxProfile(paths) {
    const home = os.homedir();
    // Real paths: the sandbox matches the resolved path, and /tmp is /private/tmp on macOS.
    const writable = paths.filter(Boolean).map(p => { try { return fs.realpathSync(p); } catch (_) { return p; } });
    const q = p => JSON.stringify(p);
    const dataDir = require('./file-storage').DATA_DIR;
    return `(version 1)
(allow default)
(deny network*)
(allow network* (local unix))
(deny file-write*)
(allow file-write* ${writable.filter(Boolean).map(p => `(subpath ${q(p)})`).join(' ')} (literal "/dev/null") (regex #"^/dev/(tty|fd/)"))
(deny file-read* (subpath ${q(path.join(home, '.ssh'))}) (subpath ${q(path.join(home, '.codex'))}) (subpath ${q(path.join(home, '.aws'))})
  (subpath ${q(path.join(home, 'Library', 'Keychains'))}) (subpath ${q(dataDir)}))
(allow file-read* ${writable.filter(Boolean).map(p => `(subpath ${q(p)})`).join(' ')})
`;
}

let SANDBOX = null;
/** Can Blender run under sandbox-exec here? Probed once; a missing sandbox is reported, never silently skipped. */
function sandboxStatus() {
    if (SANDBOX) return SANDBOX;
    if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) {
        SANDBOX = { ok: false, reason: 'macOS sandbox-exec is not available here' };
        return SANDBOX;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-sbx-'));
    const prof = path.join(dir, 'p.sb');
    fs.writeFileSync(prof, sandboxProfile([dir]));
    const r = spawnSync('/usr/bin/sandbox-exec', ['-f', prof, '/bin/sh', '-c', `echo ok > ${JSON.stringify(path.join(dir, 'w'))}`], { encoding: 'utf8', timeout: 10000 });
    SANDBOX = r.status === 0 && fs.existsSync(path.join(dir, 'w')) ? { ok: true } : { ok: false, reason: (r.stderr || 'sandbox-exec failed').trim().slice(0, 300) };
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
    return SANDBOX;
}

/** One Blender run of a script, sandboxed; resolves the runner's result.json. */
function runBlender(scriptPath, outDir, kind, { engine, signal, onSpawn } = {}) {
    const blender = require('./set-build').resolveBlender();
    if (!blender.available) return Promise.reject(httpError(503, blender.reason, 'NO_BLENDER'));
    const sbx = sandboxStatus();
    if (!sbx.ok && !process.env.FILM_ASTRA_ALLOW_UNSANDBOXED) {
        return Promise.reject(httpError(503, `Astra builds only run sandboxed, and the sandbox is unavailable: ${sbx.reason}`, 'NO_SANDBOX'));
    }
    fs.mkdirSync(outDir, { recursive: true });
    const jobPath = path.join(outDir, 'job.json');
    fs.writeFileSync(jobPath, JSON.stringify({ script: scriptPath, out_dir: outDir, kind, views: VIEWS[kind],
        width: kind === 'prop' ? 768 : 1024, height: kind === 'prop' ? 768 : 576, ...(engine ? { engine } : {}) }));
    try { fs.unlinkSync(path.join(outDir, 'result.json')); } catch (_) { /* first run */ }
    const argv = ['-b', '--factory-startup', '--disable-autoexec', '--python', RUNNER, '--', jobPath];
    let cmd = blender.bin, args = argv;
    if (sbx.ok) {
        const prof = path.join(outDir, 'sandbox.sb');
        fs.writeFileSync(prof, sandboxProfile([outDir, userTemp()]));
        cmd = '/usr/bin/sandbox-exec'; args = ['-f', prof, blender.bin, ...argv];
    }
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
        if (onSpawn) onSpawn(child);
        let log = '', killedFor = null;
        const kill = why => { killedFor = why; try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } } };
        const timer = setTimeout(() => kill('timeout'), BLENDER_TIMEOUT_MS);
        const onAbort = () => kill('cancelled');
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        child.stdout.on('data', b => { log = (log + b).slice(-200000); });
        child.stderr.on('data', b => { log = (log + b).slice(-200000); });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.on('close', (code, sig) => {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
            if (killedFor === 'cancelled') return reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
            const resultPath = path.join(outDir, 'result.json');
            if (/ASTRA-DONE/.test(log) && fs.existsSync(resultPath)) return resolve(JSON.parse(fs.readFileSync(resultPath, 'utf8')));
            // Eevee's Metal backend can abort in background mode on some Macs (set-build.js saw it): once on Cycles CPU.
            if (!engine && !killedFor && (sig === 'SIGABRT' || sig === 'SIGSEGV' || code === 134 || code === 139)) {
                return runBlender(scriptPath, outDir, kind, { engine: 'CYCLES', signal, onSpawn }).then(resolve, reject);
            }
            const tail = log.split('\n').filter(l => /Error|Traceback|line \d+/.test(l)).slice(-8).join('\n');
            resolve({ ok: false, renders: [], stats: {}, error: `Blender did not finish (${killedFor === 'timeout' ? `over ${BLENDER_TIMEOUT_MS / 60000} min` : sig ? `signal ${sig}` : `exit ${code}`}). ${tail || log.slice(-600)}` });
        });
    });
}

// ── the loop ────────────────────────────────────────────────────────────

function buildRoot(projectId, id) {
    return path.join(require('./file-storage').dirFor(projectId, '3d'), 'astra-builds', id);
}

/** Smaller copies of the references for Astra (long side 1536), so a 6K plate doesn't eat the turn. */
function prepareRefs(refs, dir) {
    fs.mkdirSync(dir, { recursive: true });
    const { resolveFfmpeg } = require('./ffmpeg');
    const ff = resolveFfmpeg();
    return refs.map((r, i) => {
        const out = path.join(dir, `ref_${i + 1}.jpg`);
        if (ff && ff.available) {
            const x = spawnSync(ff.bin, ['-nostdin', '-v', 'error', '-y', '-i', r.path, '-vf', "scale='min(1536,iw)':-2", '-q:v', '3', out], { timeout: 60000 });
            if (x.status === 0 && fs.existsSync(out)) return { ...r, send: out };
        }
        return { ...r, send: r.path };
    });
}

async function oneRound(b, ctx, roundNo, prev) {
    const dir = path.join(b.out_dir, `round_${roundNo}`);
    fs.mkdirSync(dir, { recursive: true });
    const entry = { round: roundNo, ok: false, tries: 0, renders: [], stats: null, error: null };
    b.rounds_log.push(entry);
    let attemptPrev = prev;
    for (let attempt = 1; attempt <= 2; attempt++) {
        entry.tries = attempt;
        update(b, { round: roundNo, stage: `Round ${roundNo} of ${b.rounds}: Astra is ${attemptPrev ? 'reviewing and rewriting' : 'writing'} the build${attempt > 1 ? ' (retrying after an error)' : ''}` });
        const images = [...ctx.refs.map(r => r.send), ...((attemptPrev && attemptPrev.result && attemptPrev.result.renders) || []).map(r => r.path).filter(p => fs.existsSync(p))];
        const prompt = attemptPrev ? nextPrompt(b.subject_kind, ctx.subject, ctx.refs, attemptPrev, ctx.details, ctx.secondPass && roundNo === 1)
            : firstPrompt(b.subject_kind, ctx.subject, ctx.refs, ctx.details);
        fs.writeFileSync(path.join(dir, `prompt_${attempt}.txt`), prompt);
        const answer = await astra.ask({ prompt, images, timeoutMs: ASTRA_TIMEOUT_MS, signal: ctx.abort.signal, onSpawn: c => ctx.children.add(c) });
        if (!b.model) update(b, { model: answer.model });
        fs.writeFileSync(path.join(dir, `answer_${attempt}.md`), answer.text);
        const script = astra.extractScript(answer.text);
        const scriptPath = path.join(dir, 'build.py');
        let result;
        if (!script) {
            result = { ok: false, renders: [], stats: {}, error: 'The answer had no Python script in a ```python block.' };
        } else {
            fs.writeFileSync(scriptPath, script);
            const problems = checkScript(script, dir);
            if (problems.length) {
                result = { ok: false, renders: [], stats: {}, refused: problems, error: 'The build script was refused before running:\n' + problems.join('\n') };
            } else {
                update(b, { stage: `Round ${roundNo} of ${b.rounds}: Blender is building and rendering` });
                result = await runBlender(scriptPath, dir, b.subject_kind, { signal: ctx.abort.signal, onSpawn: c => ctx.children.add(c) });
            }
        }
        entry.note = (answer.text.split('```')[0] || '').trim().slice(0, 1200) || null;
        entry.stats = result.stats || null;
        entry.renders = result.renders || [];
        entry.error = result.ok ? null : result.error;
        if (result.ok) {
            entry.ok = true; entry.script = scriptPath; entry.glb = result.glb; entry.blend = result.blend;
            persist();
            return { script, result, error: null };
        }
        persist();
        // The retry sees the failure: the failed script and its error, on top of the last good result.
        attemptPrev = { script: script || (attemptPrev ? attemptPrev.script : ''), result: (attemptPrev && attemptPrev.result) || null, error: result.error };
    }
    return { script: attemptPrev.script, result: null, error: entry.error };
}

async function runBuild(b) {
    const abort = new AbortController();
    const ctx = { abort, children: new Set(), details: b.details || '', secondPass: !!b.from_build_id };
    running.set(b.id, ctx);
    update(b, { status: 'running', started_at: nowIso(), stage: 'Gathering the reference pictures' });
    try {
        ctx.subject = loadSubject(b.project_id, b.subject_kind, b.subject_id);
        const refs = referencesFor(b.subject_kind, b.subject_id);
        ctx.refs = prepareRefs(refs, path.join(b.out_dir, 'refs'));
        update(b, { references: refs.map(r => r.asset_id) });
        let prev = null;
        if (b.from_build_id) {
            const src = getBuild(b.from_build_id);
            const fin = (src.rounds_log || []).find(r => r.round === src.final_round && r.ok);
            if (!fin || !fs.existsSync(fin.script)) throw httpError(409, 'the build to refine has no finished script');
            prev = { script: fs.readFileSync(fin.script, 'utf8'), result: { renders: fin.renders, stats: fin.stats }, error: null };
        }
        let best = null;
        for (let r = 1; r <= b.rounds; r++) {
            const out = await oneRound(b, ctx, r, prev);
            if (out.result) { best = { round: r, ...out }; prev = { script: out.script, result: out.result, error: null }; }
            else if (best) { prev = { script: best.script, result: best.result, error: out.error }; }
            else prev = { script: out.script, result: null, error: out.error };
        }
        if (!best) throw new Error(`No round produced a model. Last error: ${String(prev && prev.error || 'unknown').slice(0, 800)}`);
        update(b, { stage: 'Saving the model', final_round: best.round });
        Object.assign(b, finish(b, ctx.subject, best));
        update(b, { status: 'done', stage: 'Done', finished_at: nowIso() });
    } catch (err) {
        if (err.code === 'CANCELLED' || abort.signal.aborted) update(b, { status: 'cancelled', stage: 'Cancelled', finished_at: nowIso() });
        else update(b, { status: 'failed', stage: 'Failed', error: err.message, finished_at: nowIso() });
    } finally {
        running.delete(b.id);
    }
}

/** The final round's GLB as the subject's 3D model; for a location, also the next version of its world. */
function finish(b, subject, best) {
    const d = db();
    const fsx = require('./file-storage');
    const { generateId } = require('../db/database');
    const glb = fs.readFileSync(best.result.glb);
    const safe = String(subject.name || b.subject_kind).replace(/[^\w .()-]+/g, '_').trim().slice(0, 60) || 'model';
    const filename = `${safe} - Astra ${b.id.slice(0, 6)} r${best.round}.glb`;
    const filePath = fsx.saveFile(b.project_id, '3d', filename, glb);
    const assetId = generateId();
    const col = KINDS[b.subject_kind].column;
    const metadata = {
        kind: 'model_3d', subject_kind: b.subject_kind, subject_id: subject.id, subject_name: subject.name, format: 'glb',
        source: 'astra-blender', build_id: b.id, round: best.round, details: b.details || null, model: b.model || null,
        from_build_id: b.from_build_id || null, stats: best.result.stats || null,
        character_id: null, prop_id: b.subject_kind === 'prop' ? subject.id : null, location_id: b.subject_kind === 'location' ? subject.id : null,
    };
    d.prepare(`INSERT INTO film_assets (id, project_id, ${col}, asset_type, file_path, file_name, format, mime_type, size_bytes, version, metadata, provider, provider_model)
               VALUES (?, ?, ?, 'other', ?, ?, 'glb', 'model/gltf-binary', ?, 1, ?, 'astra-blender', ?)`)
        .run(assetId, b.project_id, subject.id, filePath, filename, glb.length, JSON.stringify(metadata), b.model || null);
    const out = { asset_id: assetId, asset_url: fsx.getFileUrl('3d', b.project_id, filename) };
    if (b.subject_kind === 'location') {
        const worlds = require('./worlds');
        const world = d.prepare('SELECT * FROM film_worlds WHERE location_id = ? ORDER BY created_at LIMIT 1').get(subject.id)
            || worlds.createWorld(d, { projectId: b.project_id, locationId: subject.id, name: subject.name,
                description: 'Built in Blender, guided by Astra, from the location pictures.' });
        const version = worlds.importVersion(d, world.id, { glb, source: 'blender',
            reason: `Astra build ${b.id.slice(0, 6)}, round ${best.round}${b.details ? ` (second pass: ${b.details.slice(0, 120)})` : ''}`,
            caption: b.details || null });
        if (best.result.blend && fs.existsSync(best.result.blend)) {
            try {
                require('./world-previz').recordEditableSource(d, version.id, best.result.blend, {
                    units: { system: 'METRIC', scale_length: 1, length_unit: 'METERS' }, axes: { up: 'Z', forward: 'Y', handedness: 'right' },
                    renderer: { name: 'blender', version: require('./set-build').resolveBlender().version || null }, addons: [], objects: [], substitutions: [],
                }, b.project_id);
            } catch (_) { /* the version stands without its editable .blend */ }
        }
        out.world_id = world.id; out.world_version_id = version.id;
    }
    return out;
}

// ── the API ─────────────────────────────────────────────────────────────

function createBuild(projectId, body = {}) {
    load();
    const kind = String(body.subject_kind || '');
    if (!KINDS[kind]) throw httpError(400, `subject_kind must be ${Object.keys(KINDS).join(' or ')} (characters go to Meshy)`);
    const subject = loadSubject(projectId, kind, String(body.subject_id || ''));
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Math.round(Number(body.rounds) || DEFAULT_ROUNDS)));
    const details = typeof body.details === 'string' ? body.details.trim().slice(0, 2000) : '';
    let from = null;
    if (body.from_build_id) {
        from = getBuild(body.from_build_id);
        if (from.status !== 'done') throw httpError(409, 'only a finished build can have a second pass');
        if (from.subject_kind !== kind || from.subject_id !== subject.id) throw httpError(400, 'from_build_id is a build of another subject');
        if (!details) throw httpError(400, 'a second pass needs details: what to add or change');
    }
    // Fail now, not in the queue, when the tools are missing.
    astra.astraModel();
    if (!astra.resolveCodex().available) throw httpError(503, astra.resolveCodex().reason, 'NO_CODEX');
    if (!require('./set-build').resolveBlender().available) throw httpError(503, require('./set-build').resolveBlender().reason, 'NO_BLENDER');
    const id = crypto.randomBytes(8).toString('hex');
    const b = { id, project_id: projectId, subject_kind: kind, subject_id: subject.id, subject_name: subject.name,
        status: 'queued', stage: 'Waiting for the build before it', round: 0, rounds, details: details || null,
        from_build_id: from ? from.id : null, model: null, rounds_log: [], created_at: nowIso(), out_dir: buildRoot(projectId, id) };
    builds.set(id, b);
    persist();
    queue = queue.then(() => (b.status === 'queued' ? runBuild(b) : null)).catch(() => {});
    return publicBuild(b);
}

function cancelBuild(id) {
    const b = getBuild(id);
    if (b.status === 'queued') { update(b, { status: 'cancelled', stage: 'Cancelled', finished_at: nowIso() }); return publicBuild(b); }
    const ctx = running.get(b.id);
    if (ctx) {
        ctx.abort.abort();
        for (const c of ctx.children) { try { process.kill(-c.pid, 'SIGKILL'); } catch (_) { /* gone */ } }
    }
    return publicBuild(b);
}

function renderPath(id, round, n) {
    const b = getBuild(id);
    const r = (b.rounds_log || []).find(x => x.round === Number(round));
    const p = r && r.renders && r.renders[Number(n)] && r.renders[Number(n)].path;
    if (!p || !fs.existsSync(p)) throw httpError(404, 'no such render');
    return p;
}

function status() {
    const out = {};
    const c = astra.resolveCodex();
    out.codex = c.available ? { found: true } : { found: false, reason: c.reason };
    try { out.model = astra.astraModel(); } catch (e) { out.model = null; out.model_error = e.message; }
    const bl = require('./set-build').resolveBlender();
    out.blender = bl.available ? { found: true, version: bl.version } : { found: false, reason: bl.reason };
    out.sandbox = sandboxStatus();
    out.ready = !!(c.available && out.model && bl.available && out.sandbox.ok);
    return out;
}

/** Wait for every queued build (tests). */
function idle() { return queue; }

module.exports = { createBuild, listBuilds, getBuild: id => publicBuild(getBuild(id)), cancelBuild, renderPath, status, checkScript,
    referencesFor, sandboxProfile, firstPrompt, nextPrompt, idle, KINDS, DEFAULT_ROUNDS, MAX_ROUNDS,
    _reset: () => { builds.clear(); running.clear(); loaded = false; queue = Promise.resolve(); SANDBOX = null; } };
