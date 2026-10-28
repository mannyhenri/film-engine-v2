/**
 * COMFYUI over HTTP: the Windows PC's ComfyUI, driven from Film Engine (lib/comfyui.js).
 *
 *   GET  /film/comfyui/status            is the PC answering: { ok, url, version, devices, running, pending } (or { ok: false, error })
 *   GET  /film/comfyui/workflows         every workflow in its film-engine folder, with options and whether it is ready
 *   POST /film/comfyui/jobs              run one: { workflow, prompt?, seed?, options?, images?: [path|null], audio?: [path|null], shot_id? }
 *   GET  /film/comfyui/jobs/:id          its stage, queue position and, when done, the downloaded files
 *   POST /film/comfyui/jobs/:id/cancel   take it off the PC's queue (or interrupt it)
 *
 * Free: it runs on your own PC.
 */
const comfy = require('../lib/comfyui');

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

async function handleComfyUI(req, res, parts) {
    const body = req.body || {};
    const [, , a, b, c] = parts;   // film / comfyui / a / b / c
    try {
        if (a === 'status' && !b && req.method === 'GET') {
            try { return json(res, 200, await comfy.status()); }
            catch (err) { return json(res, 200, { ok: false, url: comfy.baseUrl(), error: err.message }); }
        }
        if (a === 'workflows' && !b && req.method === 'GET') return json(res, 200, { workflows: await comfy.listWorkflows(), url: comfy.baseUrl() });
        if (a === 'jobs' && !b && req.method === 'POST') return json(res, 202, { job: comfy.startJob(body) });
        if (a === 'jobs' && b && !c && req.method === 'GET') return json(res, 200, { job: comfy.getJob(b) });
        if (a === 'jobs' && b && c === 'cancel' && req.method === 'POST') return json(res, 200, { job: await comfy.cancelJob(b) });
        return json(res, 404, { error: 'Not found' });
    } catch (err) {
        return json(res, err.status || 500, { error: err.message });
    }
}

module.exports = { handleComfyUI };
