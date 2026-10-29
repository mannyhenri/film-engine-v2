/**
 * COMFYUI ON ANOTHER MACHINE: Film Engine drives ComfyUI's own HTTP API on the Windows PC
 * (the models and GPU this Mac doesn't have). Nothing custom runs there besides ComfyUI and
 * the workflow files.
 *
 * The workflows live in ComfyUI's user folder, `workflows/film-engine/`, as pairs:
 *   <slug>.api.json  the graph, exported with "Export (API)"
 *   <slug>.fe.json   the manifest: which nodes Film Engine fills and which options it shows
 *     { name, kind, workflow, prompt: {node, input}, seed: {node, input},
 *       images: [{node, input, role}], audio: [{node, input, role}],
 *       options: [{id, label, node, input, type: enum|int|float|text|bool, index?, choices?, default, min?, max?}],
 *       outputs: {node} }
 * Everything not named in the manifest stays exactly as saved in the workflow.
 *
 * One job: upload the inputs (POST /upload/image takes any file) -> POST /prompt with the
 * patched graph -> poll /history/{id} (with /queue for position) -> download each output
 * through /view into the results folder.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_URL = 'http://192.168.4.60:8188';
const DIR = 'workflows/film-engine';
const OUT_ROOT = () => process.env.FILM_COMFYUI_OUT || path.join(os.homedir(), 'Movies', 'Film Engine Generators', 'ComfyUI');

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

/** The PC's address: Settings (comfyui_url), else FILM_COMFYUI_URL, else the PC on this network. */
function baseUrl() {
    let v = '';
    try { v = require('../routes/app-settings').readSettings().comfyui_url || ''; } catch (_) { /* before migrations */ }
    return String(v || process.env.FILM_COMFYUI_URL || DEFAULT_URL).replace(/\/+$/, '');
}

async function call(p, { method = 'GET', body, timeout = 10000, raw = false } = {}) {
    const url = baseUrl() + p;
    let res;
    try {
        res = await fetch(url, { method, body, signal: AbortSignal.timeout(timeout),
            headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined });
    } catch (err) {
        throw httpError(502, `ComfyUI is not answering at ${baseUrl()} (${err.cause?.code || err.name}). Is the PC on, and ComfyUI listening on the network (0.0.0.0)?`);
    }
    if (!res.ok) {
        let detail = '';
        let parsed = null;
        try { parsed = await res.json(); detail = parsed.error?.message || parsed.error || JSON.stringify(parsed.node_errors || parsed).slice(0, 400); } catch (_) { /* not json */ }
        const err = httpError(res.status === 404 ? 404 : 502, `ComfyUI ${method} ${p.split('?')[0]} answered ${res.status}${detail ? ': ' + detail : ''}`);
        err.body = parsed;   // the caller may need ComfyUI's node_errors
        throw err;
    }
    return raw ? res : res.json();
}

/** Is the PC there, and how busy is it. */
async function status() {
    const [stats, queue] = await Promise.all([call('/system_stats', { timeout: 4000 }), call('/queue', { timeout: 4000 }).catch(() => null)]);
    return {
        ok: true, url: baseUrl(),
        version: stats.system?.comfyui_version || null,
        devices: (stats.devices || []).map(d => ({ name: d.name, vram_total: d.vram_total, vram_free: d.vram_free })),
        running: queue ? (queue.queue_running || []).length : null,
        pending: queue ? (queue.queue_pending || []).length : null,
    };
}

const userdata = file => `/userdata/${encodeURIComponent(`${DIR}/${file}`)}`;

/** Check a manifest against its graph: every node and input it names must exist. */
function validate(manifest, graph) {
    const problems = [];
    const has = (ref, what) => {
        if (!ref || ref.node == null) return problems.push(`${what}: no node given`);
        const n = graph[String(ref.node)];
        if (!n) return problems.push(`${what}: node ${ref.node} is not in the workflow`);
        if (ref.input && !(ref.input in (n.inputs || {}))) problems.push(`${what}: node ${ref.node} (${n.class_type}) has no input "${ref.input}"`);
    };
    if (manifest.prompt) has(manifest.prompt, 'prompt');
    if (manifest.seed) has(manifest.seed, 'seed');
    (manifest.images || []).forEach((r, i) => has(r, `image ${i + 1}${r.role ? ' (' + r.role + ')' : ''}`));
    (manifest.audio || []).forEach((r, i) => has(r, `audio ${i + 1}${r.role ? ' (' + r.role + ')' : ''}`));
    (manifest.video || []).forEach((r, i) => has(r, `video ${i + 1}${r.role ? ' (' + r.role + ')' : ''}`));
    for (const o of manifest.options || []) {
        has(o, `option ${o.id}`);
        if (o.type === 'enum' && !(o.choices || []).length) problems.push(`option ${o.id}: an enum needs choices`);
        if (o.index && !('index' in (graph[String(o.node)]?.inputs || {}))) problems.push(`option ${o.id}: node ${o.node} has no "index" input to set`);
    }
    if (!manifest.outputs || !graph[String(manifest.outputs.node)]) problems.push('outputs: the save node is not in the workflow');
    return problems;
}

/** Every workflow in the film-engine folder on the PC, with its options and whether it is ready to run. */
async function listWorkflows() {
    const files = await call(`/userdata?dir=${encodeURIComponent(DIR)}`).catch(err => { if (err.status === 404) return []; throw err; });
    const out = [];
    for (const f of (Array.isArray(files) ? files : []).filter(x => /\.fe\.json$/i.test(x))) {
        const slug = f.replace(/\.fe\.json$/i, '');
        try {
            const manifest = await call(userdata(f));
            const graph = await call(userdata(manifest.workflow || `${slug}.api.json`));
            const problems = validate(manifest, graph);
            out.push({ slug, name: manifest.name || slug, kind: manifest.kind || 'video', ready: !problems.length, problems,
                prompt: !!manifest.prompt, seed: !!manifest.seed,
                images: (manifest.images || []).map(r => ({ role: r.role || 'reference' })),
                audio: (manifest.audio || []).map(r => ({ role: r.role || 'audio' })),
                // A workflow with a video slot works on a finished take (upscale, retake…), not on a storyboard shot.
                video: (manifest.video || []).map(r => ({ role: r.role || 'take' })),
                options: (manifest.options || []).map(({ node, input, index, ...o }) => o),
                draft: manifest.draft || null });
        } catch (err) {
            out.push({ slug, name: slug, ready: false, problems: [err.message], images: [], audio: [], video: [], options: [] });
        }
    }
    return out;
}

async function loadWorkflow(slug) {
    if (!/^[\w .()-]+$/.test(String(slug || ''))) throw httpError(400, 'pick a workflow');
    const manifest = await call(userdata(`${slug}.fe.json`));
    const graph = await call(userdata(manifest.workflow || `${slug}.api.json`));
    const problems = validate(manifest, graph);
    if (problems.length) throw httpError(422, `the ${slug} workflow doesn't match its manifest: ${problems.join('; ')}`);
    return { manifest, graph };
}

const isLink = v => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && Number.isInteger(v[1]);

/**
 * The graph to queue: the manifest's inputs filled, every unfilled image/audio loader removed with
 * the inputs that linked to it, and dynamic reference inputs (ref_images.ref_image_N) renumbered
 * from 0 so the remaining slots stay in order. Pure, so it is tested without a PC.
 * values: { prompt?, seed?, options: {id: value}, images: [uploaded name | null], audio: [...] }
 */
function buildPrompt(manifest, graph, values = {}) {
    const g = JSON.parse(JSON.stringify(graph));
    const set = (ref, v) => { g[String(ref.node)].inputs[ref.input] = v; };
    if (manifest.prompt && values.prompt != null) set(manifest.prompt, String(values.prompt));
    if (manifest.seed) set(manifest.seed, Number.isInteger(values.seed) ? values.seed : crypto.randomInt(0, 2 ** 47));
    for (const o of manifest.options || []) {
        const given = (values.options || {})[o.id];
        const v = given === undefined ? o.default : given;
        if (v === undefined) continue;
        if (o.type === 'enum') {
            const c = (o.choices || []).find(x => (typeof x === 'object' ? x.label === v || x.index === v : x === v));
            if (!c) throw httpError(400, `${o.label || o.id}: "${v}" is not one of its choices`);
            const label = typeof c === 'object' ? c.label : c;
            set(o, label);
            if (o.index) g[String(o.node)].inputs.index = typeof c === 'object' ? c.index : o.choices.indexOf(c);
        } else if (o.type === 'int' || o.type === 'float') {
            const n = Number(v);
            if (!Number.isFinite(n) || (o.type === 'int' && !Number.isInteger(n))) throw httpError(400, `${o.label || o.id} must be a${o.type === 'int' ? ' whole' : ''} number`);
            if ((o.min != null && n < o.min) || (o.max != null && n > o.max)) throw httpError(400, `${o.label || o.id} must be between ${o.min} and ${o.max}`);
            set(o, n);
        } else if (o.type === 'bool') set(o, !!v);
        else set(o, String(v));
    }
    const removed = new Set();
    const fill = (refs, given) => refs.forEach((ref, i) => {
        if (given[i]) set(ref, given[i]);
        else { removed.add(String(ref.node)); delete g[String(ref.node)]; }
    });
    fill(manifest.images || [], values.images || []);
    fill(manifest.audio || [], values.audio || []);
    fill(manifest.video || [], values.video || []);
    // Drop inputs that pointed at a removed loader: a node left reading nothing is refused by ComfyUI.
    for (const node of Object.values(g)) for (const [k, v] of Object.entries(node.inputs || {})) if (isLink(v) && removed.has(v[0])) delete node.inputs[k];
    // The reference inputs on the core node, in the MANIFEST's slot order (its ref_wiring names the node and the
    // input prefix): the filled slots become prefix0, prefix1… so <Picture N> is always the Nth filled slot.
    const core = manifest.ref_wiring && manifest.core_node != null && g[String(manifest.core_node)];
    if (core) {
        const orig = graph[String(manifest.core_node)].inputs || {};
        for (const [kind, refs, given] of [['images', manifest.images || [], values.images || []], ['audio', manifest.audio || [], values.audio || []]]) {
            const prefix = manifest.ref_wiring[kind]?.core_input_prefix;
            if (!prefix) continue;
            for (const k of Object.keys(core.inputs)) if (k.startsWith(prefix)) delete core.inputs[k];
            refs.filter((_, i) => given[i]).forEach((ref, i) => {
                const link = Object.entries(orig).find(([k, v]) => k.startsWith(prefix) && isLink(v) && v[0] === String(ref.node));
                core.inputs[prefix + i] = link ? link[1] : [String(ref.node), 0];
            });
        }
        return g;
    }
    // No ref_wiring: renumber each dynamic family (…ref_x_N) contiguously, in its original order.
    for (const node of Object.values(g)) {
        const fam = {};
        for (const k of Object.keys(node.inputs || {})) { const m = /^(.*ref_\w*?_)(\d+)$/.exec(k); if (m) (fam[m[1]] ||= []).push([Number(m[2]), k]); }
        for (const [prefix, list] of Object.entries(fam)) {
            const vals = list.sort((a, b) => a[0] - b[0]).map(([, k]) => { const v = node.inputs[k]; delete node.inputs[k]; return v; });
            vals.forEach((v, i) => { node.inputs[prefix + i] = v; });
        }
    }
    return g;
}

/*
 * Send one local file into ComfyUI's input folder; answers the name a LoadImage/LoadAudio takes.
 * The name starts with a hash of the file's bytes, so two shots never overwrite each other's inputs while one
 * waits in the PC's queue, and a sheet already sent this session is not sent again (the same bytes, the same name).
 * Only files Film Engine owns go: a project's own folder or Film Engine's data folder, never anything else on the Mac.
 */
const sent = new Map();   // content hash -> name on the PC, for this session
async function upload(file) {
    if (!file || !path.isAbsolute(file) || !fs.existsSync(file)) throw httpError(404, `the file to send is not at ${file}`);
    if (!require('./file-storage').isOwnedPath(file)) throw httpError(403, `only project files go to the PC; ${path.basename(file)} is not in a project or Film Engine's data folder`);
    const bytes = fs.readFileSync(file);
    const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12);
    if (sent.has(hash)) return sent.get(hash);
    const form = new FormData();
    form.append('image', new Blob([bytes]), `${hash}-${path.basename(file).replace(/[^\w .()@+-]/g, '_')}`);
    form.append('subfolder', 'film-engine');
    form.append('type', 'input');
    form.append('overwrite', 'true');
    const r = await call('/upload/image', { method: 'POST', body: form, timeout: 300000 });
    const name = r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
    sent.set(hash, name);
    return name;
}

/* ---------------- jobs ---------------- */

const jobs = new Map();
const STAGES = { uploading: 'Sending the inputs', queued: 'Waiting on the PC', running: 'Generating', downloading: 'Bringing it back', done: 'Done', failed: 'Failed' };
const POLL_MS = () => Number(process.env.FILM_COMFYUI_POLL_MS) || 1500;
// How long the PC may stay out of reach before a take is given up: a render runs on while Wi-Fi drops.
const GRACE_MS = () => Number(process.env.FILM_COMFYUI_GRACE_MS) || 10 * 60 * 1000;
const JOB_DIR = () => path.join(require('./file-storage').DATA_DIR, 'comfyui', 'jobs');
const LIVE = new Set(['uploading', 'queued', 'running', 'downloading']);

function publicJob(j) {
    const { values, done, cancelled, socket, sampler_started, detached, images, audio, video, sources, ...rest } = j;
    return { ...rest, stage_label: STAGES[j.status], elapsed_s: Math.round(((j.finished_at || Date.now()) - j.started_at) / 1000) };
}

/* A take outlives Film Engine: each one is written down, so a restart picks it up again (resumeJobs). */
function save(j) {
    try {
        fs.mkdirSync(JOB_DIR(), { recursive: true });
        const { done, socket, detached, cancelled, ...keep } = j;
        fs.writeFileSync(path.join(JOB_DIR(), `${j.id}.json`), JSON.stringify(keep));
    } catch (_) { /* a job that cannot be written down still runs */ }
}

/** Outputs a history entry lists for the save node (SaveVideo lists them under images or videos). */
function filesOf(entry, node) {
    const out = entry?.outputs?.[String(node)] || {};
    return Object.values(out).flat().filter(f => f && typeof f === 'object' && f.filename);
}

async function runJob(j) {
    try {
        j.status = 'uploading'; save(j);
        const { manifest, graph } = await loadWorkflow(j.workflow);
        const sendList = list => Promise.all((list || []).map(f => (f ? upload(f) : null)));
        const sendAll = async () => [await sendList(j.sources.images), await sendList(j.sources.audio), await sendList(j.sources.video)];
        // Names already on the PC (a run's takes share one upload) go as they are.
        let [images, audio, video] = j.uploaded ? [j.images, j.audio, j.video || []] : await sendAll();
        const queue = () => call('/prompt', { method: 'POST', body: JSON.stringify({ prompt: buildPrompt(manifest, graph, { ...j.values, images, audio, video }), client_id: j.id }), timeout: 30000 });
        j.socket = listen(j);
        let q;
        try { q = await queue(); }
        catch (err) {
            // A file sent earlier this session is gone from the PC (its input folder was cleaned): forget those names,
            // send the files again and queue once more. Anything else is the job's error.
            const loaders = Object.values(err.body?.node_errors || {}).some(e => /^Load(Image|Audio|Video)/.test(e?.class_type || ''));
            if (!loaders || ![...(j.sources.images || []), ...(j.sources.audio || []), ...(j.sources.video || [])].some(Boolean)) throw err;
            const gone = new Set([...images, ...audio, ...video].filter(Boolean));
            for (const [h, n] of sent) if (gone.has(n)) sent.delete(h);
            [images, audio, video] = await sendAll();
            q = await queue();
        }
        if (q.node_errors && Object.keys(q.node_errors).length) throw httpError(422, `ComfyUI refused the workflow: ${JSON.stringify(q.node_errors).slice(0, 400)}`);
        j.prompt_id = q.prompt_id;
        j.output_node = String(manifest.outputs.node);
        j.status = 'queued'; save(j);
    } catch (err) {
        return finish(j, err);
    }
    return collect(j);
}

/** Wait for the PC, bring the files back, file them. Also what a restart resumes. */
async function collect(j) {
    try {
        let entry = null, lastOk = Date.now(), missing = 0;
        while (!entry) {
            if (j.detached) return;
            if (j.cancelled) throw httpError(499, 'stopped');
            await new Promise(r => setTimeout(r, POLL_MS()));
            let h;
            try { h = await call(`/history/${encodeURIComponent(j.prompt_id)}`); lastOk = Date.now(); }
            catch (err) {
                if (Date.now() - lastOk > GRACE_MS()) throw httpError(502, `lost contact with the PC for ${Math.round(GRACE_MS() / 60000)} min (${err.message})`);
                continue;   // a blip: the PC is still rendering
            }
            const e = h[j.prompt_id];
            entry = e && (e.status?.completed || e.status?.status_str === 'error' || Object.keys(e.outputs || {}).length) ? e : null;
            if (entry) break;
            const queue = await call('/queue').catch(() => null);
            if (!queue) continue;
            const running = (queue.queue_running || []).some(x => x[1] === j.prompt_id);
            const at = (queue.queue_pending || []).findIndex(x => x[1] === j.prompt_id);
            // Neither done, nor running, nor waiting, three times over: ComfyUI restarted and forgot it.
            missing = running || at >= 0 || e ? 0 : missing + 1;
            if (missing >= 3) throw httpError(502, 'the PC no longer has this take (ComfyUI restarted?). Send it again.');
            j.position = running ? 0 : at >= 0 ? at + 1 : j.position;
            if (running && j.status === 'queued') { j.status = 'running'; save(j); }
        }
        if (j.detached) return;   // handed over (resumed elsewhere): only one follower files a take
        if (entry.status?.status_str === 'error') {
            const msg = (entry.status.messages || []).find(m => m[0] === 'execution_error')?.[1];
            throw httpError(502, `ComfyUI failed${msg ? ` in ${msg.node_type || 'a node'}: ${msg.exception_message || ''}`.trim() : ''}`);
        }
        j.status = 'downloading'; save(j);
        const files = filesOf(entry, j.output_node);
        if (!files.length) throw httpError(502, 'ComfyUI finished but the save node produced no file');
        const dir = path.join(OUT_ROOT(), j.workflow);
        fs.mkdirSync(dir, { recursive: true });
        for (const f of files) {
            const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
            const res = await call(`/view?${qs}`, { raw: true, timeout: 600000 });
            const dest = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)} ${path.basename(f.filename)}`);
            fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
            j.outputs.push({ path: dest, name: path.basename(f.filename) });
        }
        if (j.detached) return;
        // Filed on its shot as the next video version (lib/comfyui-shot.js); its failure is the job's, said plainly.
        if (j.file_on) {
            try { j.filed = require('./comfyui-shot').fileTake(j.file_on.project_id, j.file_on.shot_id, j.outputs[0].path, { ...j.file_on.meta, prompt_id: j.prompt_id }); }
            catch (err) { throw httpError(500, `the video came back (${j.outputs.map(o => o.path).join(', ')}) but could not be added to the shot: ${err.message}`); }
        }
        j.status = 'done';
        finish(j);
    } catch (err) {
        finish(j, err);
    }
}

function finish(j, err) {
    if (j.detached) return;
    if (err) { j.status = 'failed'; j.error = err.message; }
    j.finished_at = Date.now();
    save(j);
    try { j.socket && j.socket.close(); } catch (_) { /* already closed */ }
}

/*
 * Progress, from ComfyUI's WebSocket (the HTTP API has none): which node runs, and the sampler's step N of M.
 * A draft on a slow card takes over an hour, so the page shows the step and the time left, not just "Generating".
 * The time left is the average step so far times the steps to go, for the sampler that is running now.
 * A dropped socket is opened again while the take is still going.
 */
function listen(j) {
    if (typeof WebSocket !== 'function') return null;   // older Node: the job still runs, without step progress
    let ws;
    try { ws = new WebSocket(`${baseUrl().replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(j.id)}`); }
    catch (_) { return null; }
    ws.onmessage = ev => {
        let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch (_) { return; }
        const d = m && m.data;
        if (!d || (j.prompt_id && d.prompt_id && d.prompt_id !== j.prompt_id)) return;
        if (m.type === 'executing' && d.node) j.node = String(d.node);
        if (m.type === 'execution_start') { j.status = 'running'; j.position = 0; }
        if (m.type === 'progress' && Number.isFinite(d.value) && Number.isFinite(d.max)) {
            const now = Date.now();
            if (!j.progress || j.progress.max !== d.max || d.value < j.progress.value || String(d.node) !== j.progress.node) j.sampler_started = now;
            const done = d.value, per = done > 0 ? (now - j.sampler_started) / done : null;
            j.progress = { value: done, max: d.max, node: String(d.node), eta_s: per ? Math.round(per * (d.max - done) / 1000) : null };
            j.status = 'running';
        }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
        if (j.finished_at || j.cancelled || j.detached || j.socket !== ws) return;
        const t = setTimeout(() => { if (!j.finished_at && !j.cancelled && !j.detached) j.socket = listen(j); }, 3000);
        if (t.unref) t.unref();
    };
    return ws;
}

/**
 * Queue one generation: { workflow, prompt?, seed?, options?, images?: [path|null], audio?: [path|null], video?: [path|null], shot_id? }.
 * opts.uploaded: images/audio are names already on the PC (opts.sources: their local files). opts.fileOn { project_id, shot_id, meta }: add the result
 * to that shot as its next video version.
 */
function startJob(body = {}, { label = null, uploaded = false, fileOn = null, sources = null } = {}) {
    const j = { id: crypto.randomUUID(), workflow: String(body.workflow || ''), shot_id: body.shot_id || null, status: 'uploading', label, filed: null,
        file_on: fileOn, uploaded,
        // The local files behind the inputs, to send again if the PC lost them (uploaded jobs pass them in).
        sources: sources || (uploaded ? { images: [], audio: [], video: [] }
            : { images: Array.isArray(body.images) ? body.images : [], audio: Array.isArray(body.audio) ? body.audio : [], video: Array.isArray(body.video) ? body.video : [] }),
        values: { prompt: body.prompt, seed: Number.isInteger(body.seed) ? body.seed : undefined, options: body.options || {} },
        images: Array.isArray(body.images) ? body.images : [], audio: Array.isArray(body.audio) ? body.audio : [],
        video: Array.isArray(body.video) ? body.video : [],
        outputs: [], error: null, prompt_id: null, output_node: null, position: null, progress: null, node: null, started_at: Date.now(), finished_at: null };
    if (!j.workflow) throw httpError(400, 'pick a workflow');
    jobs.set(j.id, j);
    j.done = runJob(j);
    return publicJob(j);
}

/**
 * A job that runs somewhere else (a Generators tool on this Mac) but is followed like a PC job, so the page has
 * one way to watch every take. run(j) does the work and fills j.outputs / j.filed; a throw is the job's error.
 */
function trackExternal({ workflow, label, shot_id }, run) {
    const j = { id: crypto.randomUUID(), workflow, label, shot_id, status: 'queued', filed: null, outputs: [], error: null, prompt_id: null,
        position: null, progress: null, node: null, started_at: Date.now(), finished_at: null, external: true };
    jobs.set(j.id, j);
    j.done = Promise.resolve().then(() => run(j)).then(() => { j.status = 'done'; }, err => { j.status = 'failed'; j.error = err.message; })
        .finally(() => { j.finished_at = Date.now(); });
    return publicJob(j);
}

/** After a restart: every take that was waiting on the PC is followed again, and filed when it lands. */
function resumeJobs() {
    let n = 0;
    let files = [];
    try { files = fs.readdirSync(JOB_DIR()).filter(f => f.endsWith('.json')); } catch (_) { return 0; }
    for (const f of files) {
        let j; try { j = JSON.parse(fs.readFileSync(path.join(JOB_DIR(), f), 'utf8')); } catch (_) { continue; }
        if (!j || jobs.has(j.id) || !LIVE.has(j.status)) continue;
        if (!j.prompt_id) { j.status = 'failed'; j.error = 'Film Engine closed while sending this take. Send it again.'; j.finished_at = Date.now(); save(j); jobs.set(j.id, j); continue; }
        j.outputs = j.outputs || [];
        jobs.set(j.id, j);
        j.socket = listen(j);
        j.done = collect(j);
        n++;
    }
    return n;
}

function getJob(id) {
    const j = jobs.get(String(id));
    if (!j) throw httpError(404, 'that ComfyUI job is gone');
    return publicJob(j);
}

async function cancelJob(id) {
    const j = jobs.get(String(id));
    if (!j) throw httpError(404, 'that ComfyUI job is gone');
    if (j.external) throw httpError(400, 'this one runs on this Mac: stop it in Production › Generators');
    j.cancelled = true;
    if (j.prompt_id) {
        await call('/queue', { method: 'POST', body: JSON.stringify({ delete: [j.prompt_id] }) }).catch(() => {});
        // Interrupt only when the PC is running THIS take: /interrupt stops whatever is running.
        const queue = await call('/queue').catch(() => null);
        if ((queue?.queue_running || []).some(x => x[1] === j.prompt_id)) await call('/interrupt', { method: 'POST', body: '{}' }).catch(() => {});
    }
    return publicJob(j);
}

module.exports = { baseUrl, status, listWorkflows, loadWorkflow, validate, buildPrompt, upload, startJob, getJob, cancelJob, resumeJobs, trackExternal,
    OUT_ROOT, DEFAULT_URL, _jobs: jobs, _sent: sent };
