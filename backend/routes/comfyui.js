/**
 * COMFYUI over HTTP: the Windows PC's ComfyUI, driven from Film Engine (lib/comfyui.js).
 *
 *   GET  /film/comfyui/status            is the PC answering: { ok, url, version, devices, running, pending } (or { ok: false, error })
 *   GET  /film/comfyui/workflows         every workflow in its film-engine folder, with options and whether it is ready
 *   POST /film/comfyui/jobs              run one: { workflow, prompt?, seed?, options?, images?: [path|null], audio?: [path|null], shot_id? }
 *   GET  /film/comfyui/jobs/:id          its stage, queue position and, when done, the downloaded files
 *   POST /film/comfyui/jobs/:id/cancel   take it off the PC's queue (or interrupt it)
 *   GET  /film/comfyui/mac-tools         take tools that run on this Mac (Generators' AI Upscale), shaped like workflows
 *   GET  /film/comfyui/shots/:id/takes   the shot's video takes, newest first, with what made each and the take it came from
 *   POST /film/comfyui/shots/:id/takes   add a finished clip from a file as the shot's next take: { path, provider? } → 201 { take }
 *   POST /film/comfyui/takes/:assetId    run a take tool (a PC workflow with a video slot, or "mac:<tool>") on that take: { workflow, options? };
 *                                        the result is filed on the same shot as its next version
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
        if (a === 'mac-tools' && !b && req.method === 'GET') return json(res, 200, { tools: require('../lib/comfyui-shot').macTools() });
        if (a === 'jobs' && !b && req.method === 'POST') return json(res, 202, { job: comfy.startJob(body) });
        if (a === 'jobs' && b && !c && req.method === 'GET') return json(res, 200, { job: comfy.getJob(b) });
        if (a === 'jobs' && b && c === 'cancel' && req.method === 'POST') return json(res, 200, { job: await comfy.cancelJob(b) });
        // A shot's takes, and a take tool run on one of them (lib/comfyui-shot.js).
        if (a === 'shots' && b && c === 'takes' && req.method === 'GET') return json(res, 200, { takes: require('../lib/comfyui-shot').listTakes(b) });
        if (a === 'shots' && b && c === 'takes' && req.method === 'POST') return json(res, 201, { take: require('../lib/comfyui-shot').importTake(b, body) });
        if (a === 'takes' && b && !c && req.method === 'POST') return json(res, 202, await require('../lib/comfyui-shot').makeFromTake(b, body));
        return json(res, 404, { error: 'Not found' });
    } catch (err) {
        return json(res, err.status || 500, { error: err.message });
    }
}

module.exports = { handleComfyUI };
