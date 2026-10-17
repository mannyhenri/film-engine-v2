/**
 * CUTS over HTTP: the director's rough edit (lib/production-cuts.js).
 *
 *   GET    /film/projects/:id/cuts              every cut of the film, newest version first
 *   POST   /film/projects/:id/cuts              a new cut: { name?, shot_ids, holds? }
 *   GET    /film/cuts/:id                       one cut, laid out: shots with picture and timing, sounds with spans
 *   PUT    /film/cuts/:id                       { name?, shot_ids?, holds? }
 *   DELETE /film/cuts/:id
 *   POST   /film/cuts/:id/versions              a copy as the next version of its name
 *   POST   /film/cuts/:id/sounds                wire a sound: { kind, start_shot_id, offset_ms?, end_shot_id?, asset_id?, label?, gain_db?, fade_in_ms?, fade_out_ms? }
 *   PUT    /film/cut-sounds/:id                 change it (any of the same fields)
 *   DELETE /film/cut-sounds/:id
 *   POST   /film/cuts/:id/send-to-resolve       write this cut's Resolve package, open Resolve, import it as a timeline
 *
 * All free. Nothing here generates: a sound node's file comes from an upload (media import) or the sound
 * generator (POST /film/projects/:id/sounds/generate), each with its own confirmation.
 */
const { db } = require('../db/database');
const cuts = require('../lib/production-cuts');

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

async function handleProductionCuts(req, res, parts) {
    const body = req.body || {};
    try {
        if (parts[1] === 'projects' && parts[3] === 'cuts' && !parts[4]) {
            if (req.method === 'GET') return json(res, 200, { cuts: cuts.listCuts(db, parts[2]) });
            if (req.method === 'POST') return json(res, 201, { cut: cuts.createCut(db, parts[2], body) });
        }
        if (parts[1] === 'cuts' && parts[2]) {
            const id = parts[2];
            if (!parts[3]) {
                if (req.method === 'GET') return json(res, 200, { cut: cuts.getCut(db, id) });
                if (req.method === 'PUT') return json(res, 200, { cut: cuts.updateCut(db, id, body) });
                if (req.method === 'DELETE') return json(res, 200, cuts.deleteCut(db, id));
            }
            if (parts[3] === 'versions' && req.method === 'POST') return json(res, 201, { cut: cuts.newVersion(db, id) });
            if (parts[3] === 'sounds' && req.method === 'POST') return json(res, 201, { cut: cuts.addSound(db, id, body) });
            if (parts[3] === 'send-to-resolve' && req.method === 'POST') {
                const cut = cuts.row(db, id);
                const r = await require('./production-studio').sendToResolve(cut.project_id, cut);
                return json(res, r.status, r.body);
            }
        }
        if (parts[1] === 'cut-sounds' && parts[2] && !parts[3]) {
            if (req.method === 'PUT') return json(res, 200, { cut: cuts.updateSound(db, parts[2], body) });
            if (req.method === 'DELETE') return json(res, 200, { cut: cuts.deleteSound(db, parts[2]) });
        }
        return json(res, 405, { error: 'Method not allowed' });
    } catch (err) {
        return json(res, err.status || 500, { error: err.message, ...(err.code ? { code: err.code } : {}) });
    }
}

module.exports = { handleProductionCuts };
