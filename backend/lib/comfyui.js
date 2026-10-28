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
        try { const j = await res.json(); detail = j.error?.message || j.error || JSON.stringify(j.node_errors || j).slice(0, 400); } catch (_) { /* not json */ }
        throw httpError(res.status === 404 ? 404 : 502, `ComfyUI ${method} ${p.split('?')[0]} answered ${res.status}${detail ? ': ' + detail : ''}`);
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
                options: (manifest.options || []).map(({ node, input, index, ...o }) => o) });
        } catch (err) {
            out.push({ slug, name: slug, ready: false, problems: [err.message], images: [], audio: [], options: [] });
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
    // Drop inputs that pointed at a removed loader, repeatedly: a node left with nothing to read is not removed (ComfyUI says so).
    for (const node of Object.values(g)) {
        for (const [k, v] of Object.entries(node.inputs || {})) if (isLink(v) && removed.has(v[0])) delete node.inputs[k];
        // Renumber each dynamic family (prefix + N) contiguously, in its original order.
        const fam = {};
        for (const k of Object.keys(node.inputs || {})) { const m = /^(.*ref_\w*?_)(\d+)$/.exec(k); if (m) (fam[m[1]] ||= []).push([Number(m[2]), k]); }
        for (const [prefix, list] of Object.entries(fam)) {
            const vals = list.sort((a, b) => a[0] - b[0]).map(([, k]) => { const v = node.inputs[k]; delete node.inputs[k]; return v; });
            vals.forEach((v, i) => { node.inputs[prefix + i] = v; });
        }
    }
    return g;
}

/** Send one local file into ComfyUI's input folder; answers the name a LoadImage/LoadAudio takes. */
async function upload(file) {
    if (!file || !path.isAbsolute(file) || !fs.existsSync(file)) throw httpError(404, `the file to send is not at ${file}`);
    const form = new FormData();
    form.append('image', new Blob([fs.readFileSync(file)]), path.basename(file));
    form.append('subfolder', 'film-engine');
    form.append('type', 'input');
    form.append('overwrite', 'true');
    const r = await call('/upload/image', { method: 'POST', body: form, timeout: 120000 });
    return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

/* ---------------- jobs ---------------- */

const jobs = new Map();
const STAGES = { uploading: 'Sending the inputs', queued: 'Waiting on the PC', running: 'Generating', downloading: 'Bringing it back', done: 'Done', failed: 'Failed' };
const POLL_MS = () => Number(process.env.FILM_COMFYUI_POLL_MS) || 1500;

function publicJob(j) {
    const { values, done, cancelled, ...rest } = j;
    return { ...rest, stage_label: STAGES[j.status], elapsed_s: Math.round(((j.finished_at || Date.now()) - j.started_at) / 1000) };
}

/** Outputs a history entry lists for the save node (SaveVideo lists them under images or videos). */
function filesOf(entry, node) {
    const out = entry?.outputs?.[String(node)] || {};
    return Object.values(out).flat().filter(f => f && typeof f === 'object' && f.filename);
}

async function runJob(j) {
    const step = s => { j.status = s; };
    try {
        step('uploading');
        const { manifest, graph } = await loadWorkflow(j.workflow);
        const images = [], audio = [];
        for (const f of j.images) images.push(f ? await upload(f) : null);
        for (const f of j.audio) audio.push(f ? await upload(f) : null);
        const prompt = buildPrompt(manifest, graph, { ...j.values, images, audio });
        const q = await call('/prompt', { method: 'POST', body: JSON.stringify({ prompt, client_id: j.id }), timeout: 30000 });
        if (q.node_errors && Object.keys(q.node_errors).length) throw httpError(422, `ComfyUI refused the workflow: ${JSON.stringify(q.node_errors).slice(0, 400)}`);
        j.prompt_id = q.prompt_id;
        step('queued');
        let entry = null;
        while (!entry) {
            if (j.cancelled) throw httpError(499, 'stopped');
            await new Promise(r => setTimeout(r, POLL_MS()));
            const h = await call(`/history/${encodeURIComponent(j.prompt_id)}`);
            entry = h[j.prompt_id] && (h[j.prompt_id].status?.completed || h[j.prompt_id].status?.status_str === 'error' || Object.keys(h[j.prompt_id].outputs || {}).length) ? h[j.prompt_id] : null;
            if (!entry) {
                const queue = await call('/queue').catch(() => null);
                const running = (queue?.queue_running || []).some(x => x[1] === j.prompt_id);
                j.position = running ? 0 : (queue?.queue_pending || []).findIndex(x => x[1] === j.prompt_id) + 1 || null;
                if (running) step('running');
            }
        }
        if (entry.status?.status_str === 'error') {
            const msg = (entry.status.messages || []).find(m => m[0] === 'execution_error')?.[1];
            throw httpError(502, `ComfyUI failed${msg ? ` in ${msg.node_type || 'a node'}: ${msg.exception_message || ''}`.trim() : ''}`);
        }
        step('downloading');
        const files = filesOf(entry, manifest.outputs.node);
        if (!files.length) throw httpError(502, 'ComfyUI finished but the save node produced no file');
        const dir = path.join(OUT_ROOT(), j.workflow);
        fs.mkdirSync(dir, { recursive: true });
        for (const f of files) {
            const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
            const res = await call(`/view?${qs}`, { raw: true, timeout: 300000 });
            const dest = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)} ${path.basename(f.filename)}`);
            fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
            j.outputs.push({ path: dest, name: path.basename(f.filename) });
        }
        step('done');
    } catch (err) {
        j.status = 'failed';
        j.error = err.message;
    } finally {
        j.finished_at = Date.now();
    }
}

/** Queue one generation: { workflow, prompt?, seed?, options?, images?: [path|null], audio?: [path|null], shot_id? } */
function startJob(body = {}) {
    const j = { id: crypto.randomUUID(), workflow: String(body.workflow || ''), shot_id: body.shot_id || null, status: 'uploading',
        values: { prompt: body.prompt, seed: Number.isInteger(body.seed) ? body.seed : undefined, options: body.options || {} },
        images: Array.isArray(body.images) ? body.images : [], audio: Array.isArray(body.audio) ? body.audio : [],
        outputs: [], error: null, prompt_id: null, position: null, started_at: Date.now(), finished_at: null };
    if (!j.workflow) throw httpError(400, 'pick a workflow');
    jobs.set(j.id, j);
    j.done = runJob(j);
    return publicJob(j);
}

function getJob(id) {
    const j = jobs.get(String(id));
    if (!j) throw httpError(404, 'that ComfyUI job is gone (Film Engine restarted?)');
    return publicJob(j);
}

async function cancelJob(id) {
    const j = jobs.get(String(id));
    if (!j) throw httpError(404, 'that ComfyUI job is gone');
    j.cancelled = true;
    if (j.prompt_id) {
        await call('/queue', { method: 'POST', body: JSON.stringify({ delete: [j.prompt_id] }) }).catch(() => {});
        if (j.status === 'running') await call('/interrupt', { method: 'POST', body: '{}' }).catch(() => {});
    }
    return publicJob(j);
}

module.exports = { baseUrl, status, listWorkflows, loadWorkflow, validate, buildPrompt, upload, startJob, getJob, cancelJob,
    OUT_ROOT, DEFAULT_URL, _jobs: jobs };
