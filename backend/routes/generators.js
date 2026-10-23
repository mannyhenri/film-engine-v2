/**
 * GENERATORS over HTTP: Production's Generators tab (lib/generators.js).
 *
 *   GET  /film/generators/tools               every local AI tool found, with its options (from generator.json)
 *   POST /film/generators/inputs              register a dropped file by its path: { path } -> fps, size, frames
 *   POST /film/generators/inputs/import       the same for a browser without file paths: the raw video as the body
 *   GET  /film/generators/inputs/:id          stream a registered input (ranges)
 *   GET  /film/generators/inputs/:id/preview  the same, playable in the tab's player (an H.264 copy of ProRes)
 *   GET  /film/generators/settings            where results are saved: { out_dir (null = default), default_out_dir }
 *   PUT  /film/generators/settings            choose it: { out_dir } (a folder; null resets to the default)
 *   GET  /film/generators/jobs                every job, newest first (the history)
 *   POST /film/generators/jobs                queue one: { tool, input_id, start?, end?, options? }
 *   GET  /film/generators/jobs/:id            one job's status and progress
 *   POST /film/generators/jobs/:id/cancel     stop it (the engine and everything it started)
 *   GET  /film/generators/jobs/:id/output/:n  stream a finished output (ranges)
 *   GET  /film/generators/jobs/:id/output/:n/preview  the same, playable in the tab's player
 *
 * All free: every engine runs on this Mac (RIFE, Real-ESRGAN and the rest); nothing is sent anywhere.
 */
const fs = require('fs');
const path = require('path');
const gen = require('../lib/generators');
const { serveResolvedFile, DATA_DIR } = require('../lib/file-storage');

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

const MIME = { '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
    '.srt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp', '.heic': 'image/heic', '.exr': 'image/x-exr' };
const mimeOf = p => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

async function handleGenerators(req, res, parts) {
    const body = req.body || {};
    const [, , a, b, c, d, e] = parts;   // film / generators / a / b / c / d / e
    try {
        if (a === 'tools' && !b && req.method === 'GET') {
            return json(res, 200, { tools: gen.listTools().map(({ dir, ...t }) => t), engine_dir: gen.ENGINE_DIR(), out_dir: gen.OUT_ROOT() });
        }
        if (a === 'settings' && !b) {
            if (req.method === 'GET') return json(res, 200, gen.getSettings());
            if (req.method === 'PUT') return json(res, 200, gen.setSettings(body));
        }
        if (a === 'inputs' && !b && req.method === 'POST') return json(res, 200, { input: gen.probeInput(body.path) });
        if (a === 'inputs' && b === 'import' && req.method === 'POST') {
            if (!body.__raw) return json(res, 400, { error: 'send the file itself as the body, with a video or audio content type' });
            const name = String(req.headers['x-file-name'] || 'upload').replace(/[^\w .()-]/g, '_').slice(0, 120);
            const dir = path.join(DATA_DIR, 'generators', 'inputs');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `${Date.now()}-${name}`);
            fs.writeFileSync(file, body.__raw);
            return json(res, 200, { input: gen.probeInput(file) });
        }
        if (a === 'inputs' && b && !c && req.method === 'GET') {
            const rec = gen.getInput(b);
            return serveResolvedFile(req, res, { path: rec.path, mime: mimeOf(rec.path) }, { cacheControl: 'no-store' });
        }
        if (a === 'inputs' && b && c === 'preview' && req.method === 'GET') {
            const p = await gen.previewFile(gen.getInput(b).path);
            return serveResolvedFile(req, res, { path: p, mime: mimeOf(p) }, { cacheControl: 'no-store' });
        }
        if (a === 'jobs' && !b) {
            if (req.method === 'GET') return json(res, 200, { jobs: gen.listJobs() });
            if (req.method === 'POST') return json(res, 202, { job: gen.createJob(body) });
        }
        if (a === 'jobs' && b && !c && req.method === 'GET') return json(res, 200, { job: gen.publicJob(gen.getJob(b)) });
        if (a === 'jobs' && b && c === 'cancel' && req.method === 'POST') return json(res, 200, { job: gen.cancelJob(b) });
        if (a === 'jobs' && b && c === 'output' && d !== undefined && req.method === 'GET') {
            const p = e === 'preview' ? await gen.previewFile(gen.outputPath(b, d)) : gen.outputPath(b, d);
            return serveResolvedFile(req, res, { path: p, mime: mimeOf(p) }, { cacheControl: 'no-store' });
        }
        return json(res, 404, { error: 'unknown generators route' });
    } catch (err) {
        return json(res, err.status || 500, { error: err.message });
    }
}

module.exports = { handleGenerators };
