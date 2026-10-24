'use strict';
/**
 * TEST MODE: the request is written down instead of sent.
 *
 * "I play with the app normally, but if I click any generate button which
 *  would send to Higgsfield, create a JSON of what would be the prompt sent
 *  with what images, so we can test that everything is done properly before
 *  using real credits."
 *
 * Switched in Setup (app setting `generation_test_mode`). While it is on, a
 * Higgsfield generation runs the whole real path — the route, the payload, the
 * final review with its exact prompt, pictures and credit cost, the approval —
 * and at the one point where the request would leave this machine it is saved
 * instead: a folder holding `request.json` (the tool, its exact arguments, each
 * file's role, order, size and hash, the credits) and the pictures themselves,
 * numbered in the order they would be uploaded.
 *
 * Nothing reaches Higgsfield, not even an upload, and no sign-in is needed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROVIDERS = new Set(['higgsfield-mcp']);
const FOLDER = 'Higgsfield test requests';

function enabled() {
    try {
        const v = require('../routes/app-settings').readSettings().generation_test_mode;
        return v === true || v === 'true' || v === 1 || v === '1';
    } catch (_) { return false; }
}

/** Whether a generation on this provider is written down rather than sent, right now. */
function appliesTo(provider) {
    return PROVIDERS.has(String(provider || '')) && enabled();
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3' };
const safe = s => String(s || '').replace(/[^\w .-]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'request';

/** The bytes and type of one media value as the approved request holds it: a data URI or a frozen file path. */
function fileOf(value) {
    const m = /^data:([^;,]+);base64,(.+)$/is.exec(String(value || ''));
    if (m) return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[2], 'base64'), from: 'inline' };
    if (typeof value === 'string' && fs.existsSync(value)) {
        const ext = path.extname(value).toLowerCase();
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }[ext] || 'application/octet-stream';
        return { mime, bytes: fs.readFileSync(value), from: value };
    }
    return null;
}

function folderFor(projectId) {
    try { if (projectId) return path.join(require('./file-storage').dirFor(projectId, 'exports'), FOLDER); } catch (_) { /* no project folder */ }
    const base = process.env.FILM_DATA_DIR || path.join(require('os').homedir(), '.gridlight', 'film-engine', 'data');
    return path.join(base, FOLDER);
}

/**
 * Save one approved request. `request` is the approved request as the adapter
 * would dispatch it; `snapshot` the frozen review (for the references' own
 * names and sources). Returns the folder and the JSON written.
 */
function writeRequest({ provider, capability, request, snapshot, projectId, reviewId, credits, usdPerCredit, wire }) {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const tool = String(request.url || '').split('#')[1] || null;
    const dir = path.join(folderFor(projectId), `${stamp} ${safe(capability)} ${safe(request.model)}`);
    fs.mkdirSync(dir, { recursive: true });

    const refs = (snapshot && snapshot.references) || [];
    const medias = Array.isArray(request.body && request.body.medias) ? request.body.medias : [];
    const files = medias.map((m, i) => {
        const f = fileOf(m.value);
        const ref = refs.find(r => (r.wire_role || r.role) === `medias[${i}].value`) || {};
        const entry = { order: i + 1, role: m.role, mime: f ? f.mime : null, bytes: f ? f.bytes.length : null,
            sha256: f ? crypto.createHash('sha256').update(f.bytes).digest('hex') : null,
            source: ref.source_path || ref.path || (f && f.from !== 'inline' ? f.from : null),
            ...(ref.name ? { name: ref.name } : {}), ...(ref.source_asset_id ? { asset_id: ref.source_asset_id } : {}),
            ...(ref.subject_kind ? { subject: `${ref.subject_kind}${ref.subject_id ? ':' + ref.subject_id : ''}` } : {}) };
        if (f) {
            const file = `${String(i + 1).padStart(2, '0')} ${safe(m.role)}${ref.name ? ' - ' + safe(ref.name) : ''}.${EXT[f.mime] || 'bin'}`;
            fs.writeFileSync(path.join(dir, file), f.bytes);
            entry.file = file;
        }
        return entry;
    });
    // The arguments exactly as they would go, each file named by what it is rather than by its bytes.
    const shown = JSON.parse(JSON.stringify(request.body || {}));
    if (Array.isArray(shown.medias)) shown.medias = shown.medias.map((m, i) => ({ role: m.role, value: `(file ${i + 1}: ${files[i].file || 'unreadable'} — uploaded to Higgsfield first, then sent as its media id)` }));

    const out = {
        test_mode: true,
        note: 'TEST MODE: this request was NOT sent to Higgsfield and no credits were spent. It is exactly what would have been sent.',
        written_at: new Date().toISOString(),
        provider, capability, tool, model: request.model || null,
        endpoint: request.url,
        prompt: (request.body && (request.body.prompt || request.body.text)) || null,
        arguments: shown,
        files,
        estimated: Number.isFinite(credits) ? { credits, usd: Number.isFinite(usdPerCredit) ? Math.round(credits * usdPerCredit * 100) / 100 : null } : null,
        notes: request.notes || [],
        review_id: reviewId || null,
        ...(wire ? { wire_example: wire } : {}),
    };
    fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(out, null, 2));
    return { dir, json: out };
}

/** The answer a generation gives in test mode: not a failure of the shot, and plainly not sent. */
function result(saved) {
    const e = `Test mode: nothing was sent to Higgsfield and no credits were spent. The exact request and its ${saved.json.files.length} file(s) are saved in ${saved.dir}`;
    return { ok: false, status: 409, code: 'GENERATION_TEST_MODE', test_mode: true, test_request_dir: saved.dir, error: e };
}

module.exports = { enabled, appliesTo, writeRequest, result, FOLDER, PROVIDERS };
