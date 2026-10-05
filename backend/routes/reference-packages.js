// /film/shots/:id/previs/{packages,board-reviews,video-pins,copy} — GRD-4666 reference packages, drift
// review and shot copies. Approvals, dispositions and motion review are a person's: an agent (MCP) is refused.
const { db } = require('../db/database');
const rp = require('../lib/reference-package');
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const PERSON_ONLY = new Set(['approve', 'approve-weakened', 'pin', 'dispose', 'pin-video', 'motion-review']);
async function handleReferencePackages(req, res, urlParts) {
    const shotId = urlParts[2], area = urlParts[4], id = urlParts[5], action = urlParts[6] || (area === 'copy' ? 'copy' : null);
    const body = req.body || {};
    if (PERSON_ONLY.has(action) && req.actor === 'agent') return json(res, 403, { error: 'A person decides this, in the app', code: 'forbidden' });
    try {
        // Pictures for the comparison view, only ever this shot's own: a package pass, or a board asset.
        if (req.method === 'GET' && ((area === 'packages' && urlParts[6] === 'passes') || (area === 'board-reviews' && id === 'asset'))) {
            const fs = require('fs');
            let file = null, mime = 'image/png';
            if (area === 'packages') {
                const p = rp.getPackage(db, id);
                const pass = p.shot_id === shotId && p.passes.find(x => x.kind === urlParts[7]);
                if (pass) { file = pass.path; mime = pass.format === 'png' ? 'image/png' : 'image/x-exr'; }
            } else {
                const a = db.prepare('SELECT file_path, mime_type FROM film_assets WHERE id = ? AND shot_id = ?').get(urlParts[6], shotId);
                if (a) { file = a.file_path; mime = a.mime_type || 'image/png'; }
            }
            if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
            res.writeHead(200, { 'Content-Type': mime });
            return res.end(fs.readFileSync(file));
        }
        if (area === 'packages') {
            if (!id && req.method === 'GET') return json(res, 200, { state: rp.packageState(db, shotId),
                boards: db.prepare(`SELECT id, version, metadata FROM film_assets WHERE shot_id = ? AND asset_type = 'storyboard' ORDER BY version DESC`).all(shotId)
                    .map(b => { let m = {}; try { m = JSON.parse(b.metadata || '{}'); } catch (_) { m = {}; } return { id: b.id, version: b.version, source: m.source || m.provider || null }; }),
                packages: db.prepare('SELECT id FROM film_reference_packages WHERE shot_id = ? ORDER BY version DESC').all(shotId).map(r => rp.getPackage(db, r.id)) });
            if (!id && req.method === 'POST') return json(res, 201, await rp.createPackage(db, shotId, body));
            if (id === 'rendered-board' && req.method === 'POST') return json(res, 201, rp.renderedBoard(db, shotId));
            if (id && !action && req.method === 'GET') return json(res, 200, rp.getPackage(db, id));
            if (action === 'approve' && req.method === 'POST') return json(res, 200, rp.approvePackage(db, id, body));
            if (action === 'pin' && req.method === 'POST') return json(res, 200, rp.pinPackage(db, shotId, id));
            if (action === 'negotiate' && req.method === 'POST') return json(res, 200, rp.negotiate(db, id, require('../lib/providers').get(body.provider_id) || { id: body.provider_id }));
            if (action === 'approve-weakened' && req.method === 'POST') return json(res, 200, rp.approveWeakened(db, id, body));
        }
        if (area === 'board-reviews') {
            if (!id && req.method === 'POST') return json(res, 201, rp.compareBoard(db, body));
            if (action === 'dispose' && req.method === 'POST') return json(res, 200, rp.dispose(db, { ...body, review_id: id }));
            if (action === 'pin-video' && req.method === 'POST') return json(res, 201, rp.pinForVideo(db, shotId, { review_id: id }));
        }
        if (area === 'video-pins' && action === 'motion-review' && req.method === 'POST') return json(res, 201, rp.reviewMotion(db, { ...body, video_pin_id: id }));
        if (area === 'copy' && req.method === 'POST') return json(res, 201, rp.copyShot(db, shotId));
        return json(res, 405, { error: 'Method not allowed' });
    } catch (e) {
        return json(res, e.status || 500, { error: e.message, code: e.code, ...(e.open ? { open: e.open } : {}), ...(e.current_fingerprint ? { current_fingerprint: e.current_fingerprint } : {}) });
    }
}
module.exports = { handleReferencePackages };
