/**
 * ASTRA BUILDS over HTTP: a location or prop modelled in background Blender, guided by Astra (lib/astra-build.js).
 *
 *   GET  /film/astra-builds/status                    ready? { codex, model, blender, sandbox, ready }
 *   GET  /film/projects/:pid/astra-builds             every build of the project, newest first (?subject_kind=&subject_id=)
 *   POST /film/projects/:pid/astra-builds             { subject_kind: 'location'|'prop', subject_id, rounds?, details?, from_build_id? } -> 202 { build }
 *   GET  /film/astra-builds/:id                       one build: status, stage, round / rounds, renders, history
 *   POST /film/astra-builds/:id/cancel                stop it (Astra and Blender)
 *   GET  /film/astra-builds/:id/render/:round/:n      a review render (PNG)
 *
 * Free to Film Engine: Astra runs on the user's ChatGPT plan through their Codex sign-in, Blender on this Mac.
 */
const astraBuild = require('../lib/astra-build');
const { serveResolvedFile } = require('../lib/file-storage');

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

async function handleAstraBuilds(req, res, parts, query) {
    const q = query || {};
    const body = req.body || {};
    try {
        if (parts[1] === 'projects' && parts[2] && parts[3] === 'astra-builds' && !parts[4]) {
            if (req.method === 'GET') return json(res, 200, { builds: astraBuild.listBuilds(parts[2], { subject_kind: q.subject_kind, subject_id: q.subject_id }) });
            if (req.method === 'POST') return json(res, 202, { build: astraBuild.createBuild(parts[2], body) });
        }
        if (parts[1] === 'astra-builds') {
            const [, , id, tail, round, n] = parts;
            if (id === 'status' && !tail && req.method === 'GET') return json(res, 200, astraBuild.status());
            if (id && !tail && req.method === 'GET') return json(res, 200, { build: astraBuild.getBuild(id) });
            if (id && tail === 'cancel' && req.method === 'POST') return json(res, 200, { build: astraBuild.cancelBuild(id) });
            if (id && tail === 'render' && round !== undefined && n !== undefined && req.method === 'GET') {
                return serveResolvedFile(req, res, { path: astraBuild.renderPath(id, round, n), mime: 'image/png' }, { cacheControl: 'no-store' });
            }
        }
        return json(res, 404, { error: 'unknown astra-builds route' });
    } catch (err) {
        return json(res, err.status || 500, { error: err.message, ...(err.code ? { code: err.code } : {}) });
    }
}

module.exports = { handleAstraBuilds };
