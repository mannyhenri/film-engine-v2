'use strict';
/**
 * CUTS: the director's rough edit, made in Production's Cut tab.
 *
 * A cut is picked shots in the order they play, footage or not: a shot with a clip plays its clip, a shot with only
 * its storyboard frame holds that frame for its length (Resolve gets it as a still with a yellow marker). Sounds are
 * wired to shots: each starts at a shot, plus an offset, and plays its own length or runs to the end of a later shot.
 *
 * The picture of each shot is read off the timeline Playback plays (routes/timeline loadTimeline), so a cut, the
 * film's cut and the conform never disagree about which take a shot plays or how long its board holds.
 */
const crypto = require('crypto');

const KINDS = Object.freeze(['music', 'sfx', 'ambient', 'dialogue']);
/** Which audio asset types a sound of each kind may carry. */
const ASSET_TYPES = Object.freeze({ music: ['audio_music'], sfx: ['audio_sfx'], ambient: ['audio_ambient'], dialogue: ['audio_dialogue'] });

function fail(status, message, code) { throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) }); }
const parse = (s, d) => { try { const v = JSON.parse(s); return v == null ? d : v; } catch (_) { return d; } };

function projectShots(db, projectId) {
    return new Set(db.prepare('SELECT sh.id FROM film_shots sh JOIN film_scenes s ON s.id = sh.scene_id WHERE s.project_id = ?').all(projectId).map(r => r.id));
}
function row(db, id) {
    const c = db.prepare('SELECT * FROM production_cuts WHERE id = ?').get(id);
    if (!c) fail(404, 'Cut not found');
    return c;
}
function soundRow(db, id) {
    const s = db.prepare('SELECT * FROM production_cut_sounds WHERE id = ?').get(id);
    if (!s) fail(404, 'Sound not found');
    return s;
}

/** Shot ids, checked: every one a shot of this project, each once. */
function checkShots(db, projectId, ids) {
    if (!Array.isArray(ids)) fail(400, 'shot_ids must be a list');
    const own = projectShots(db, projectId), seen = new Set();
    for (const id of ids) {
        if (typeof id !== 'string' || !own.has(id)) fail(400, `shot ${id} is not a shot of this project`);
        if (seen.has(id)) fail(400, `shot ${id} is in the cut twice`);
        seen.add(id);
    }
    return ids;
}
function checkHolds(holds, shotIds) {
    if (holds == null) return {};
    if (typeof holds !== 'object' || Array.isArray(holds)) fail(400, 'holds must be { shot_id: milliseconds }');
    const out = {};
    for (const [id, ms] of Object.entries(holds)) {
        if (!shotIds.includes(id)) continue;
        const n = Math.round(Number(ms));
        if (!Number.isFinite(n) || n < 500 || n > 600000) fail(400, `a shot plays between 0.5s and 10 minutes (${id}: ${ms})`);
        out[id] = n;
    }
    return out;
}

function createCut(db, projectId, body = {}) {
    if (!db.prepare('SELECT id FROM film_projects WHERE id = ?').get(projectId)) fail(404, 'Project not found');
    const name = String(body.name || 'Rough cut').trim().slice(0, 120) || 'Rough cut';
    const shotIds = checkShots(db, projectId, body.shot_ids || []);
    const version = (db.prepare('SELECT MAX(version) v FROM production_cuts WHERE project_id = ? AND name = ?').get(projectId, name).v || 0) + 1;
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO production_cuts (id, project_id, name, version, shot_ids, holds_json) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, projectId, name, version, JSON.stringify(shotIds), JSON.stringify(checkHolds(body.holds, shotIds)));
    return getCut(db, id);
}

function updateCut(db, id, body = {}) {
    const c = row(db, id);
    const shotIds = body.shot_ids !== undefined ? checkShots(db, c.project_id, body.shot_ids) : parse(c.shot_ids, []);
    const holds = body.holds !== undefined ? checkHolds(body.holds, shotIds) : checkHolds(parse(c.holds_json, {}), shotIds);
    const name = body.name !== undefined ? (String(body.name).trim().slice(0, 120) || c.name) : c.name;
    if (name !== c.name && db.prepare('SELECT 1 FROM production_cuts WHERE project_id = ? AND name = ? AND version = ? AND id != ?').get(c.project_id, name, c.version, id)) {
        fail(409, `"${name}" v${c.version} already exists`);
    }
    db.prepare("UPDATE production_cuts SET name = ?, shot_ids = ?, holds_json = ?, updated_at = datetime('now') WHERE id = ?")
        .run(name, JSON.stringify(shotIds), JSON.stringify(holds), id);
    return getCut(db, id);
}

/** A copy of the cut as the next version of its name, sounds and all: v2 stays as it was. */
function newVersion(db, id) {
    const c = row(db, id);
    const version = db.prepare('SELECT MAX(version) v FROM production_cuts WHERE project_id = ? AND name = ?').get(c.project_id, c.name).v + 1;
    const copy = crypto.randomUUID();
    db.transaction(() => {
        db.prepare('INSERT INTO production_cuts (id, project_id, name, version, shot_ids, holds_json) VALUES (?, ?, ?, ?, ?, ?)')
            .run(copy, c.project_id, c.name, version, c.shot_ids, c.holds_json);
        for (const s of db.prepare('SELECT * FROM production_cut_sounds WHERE cut_id = ? ORDER BY sort_order, created_at').all(id)) {
            db.prepare(`INSERT INTO production_cut_sounds (id, cut_id, kind, label, asset_id, start_shot_id, offset_ms, end_shot_id, gain_db, fade_in_ms, fade_out_ms, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), copy, s.kind, s.label, s.asset_id, s.start_shot_id, s.offset_ms,
                s.end_shot_id, s.gain_db, s.fade_in_ms, s.fade_out_ms, s.sort_order);
        }
    })();
    return getCut(db, copy);
}

function deleteCut(db, id) { row(db, id); db.prepare('DELETE FROM production_cuts WHERE id = ?').run(id); return { deleted: id }; }

function soundFields(db, projectId, body, existing) {
    const out = {};
    if (body.kind !== undefined || !existing) {
        if (!KINDS.includes(body.kind)) fail(400, `kind must be one of: ${KINDS.join(', ')}`);
        out.kind = body.kind;
    }
    const kind = out.kind || existing.kind;
    const own = projectShots(db, projectId);
    if (body.start_shot_id !== undefined || !existing) {
        if (!own.has(body.start_shot_id)) fail(400, 'start_shot_id must be a shot of this project');
        out.start_shot_id = body.start_shot_id;
    }
    if (body.end_shot_id !== undefined) {
        if (body.end_shot_id !== null && !own.has(body.end_shot_id)) fail(400, 'end_shot_id must be a shot of this project, or null');
        out.end_shot_id = body.end_shot_id;
    }
    if (body.asset_id !== undefined) {
        if (body.asset_id !== null) {
            const a = db.prepare('SELECT asset_type FROM film_assets WHERE id = ? AND project_id = ?').get(body.asset_id, projectId);
            if (!a) fail(400, 'asset_id must be a file of this project');
            if (!ASSET_TYPES[kind].includes(a.asset_type)) fail(400, `a ${kind} sound takes ${ASSET_TYPES[kind].join(' or ')}, not ${a.asset_type}`);
        }
        out.asset_id = body.asset_id;
    }
    for (const [k, lo, hi] of [['offset_ms', 0, 3600000], ['fade_in_ms', 0, 600000], ['fade_out_ms', 0, 600000]]) {
        if (body[k] === undefined) continue;
        const n = Math.round(Number(body[k]));
        if (!Number.isFinite(n) || n < lo || n > hi) fail(400, `${k} must be between ${lo} and ${hi}`);
        out[k] = n;
    }
    if (body.gain_db !== undefined) {
        const n = Number(body.gain_db);
        if (!Number.isFinite(n) || n < -60 || n > 12) fail(400, 'gain_db must be between -60 and 12');
        out.gain_db = n;
    }
    if (body.label !== undefined) out.label = String(body.label).slice(0, 120);
    return out;
}

function addSound(db, cutId, body = {}) {
    const c = row(db, cutId);
    const f = soundFields(db, c.project_id, body, null);
    if (!parse(c.shot_ids, []).includes(f.start_shot_id)) fail(400, 'a sound starts at a shot that is in the cut');
    const order = (db.prepare('SELECT MAX(sort_order) n FROM production_cut_sounds WHERE cut_id = ?').get(cutId).n ?? -1) + 1;
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO production_cut_sounds (id, cut_id, kind, label, asset_id, start_shot_id, offset_ms, end_shot_id, gain_db, fade_in_ms, fade_out_ms, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, cutId, f.kind, f.label || '', f.asset_id || null, f.start_shot_id, f.offset_ms || 0,
        f.end_shot_id || null, f.gain_db ?? (f.kind === 'music' ? -12 : f.kind === 'ambient' ? -18 : f.kind === 'sfx' ? -6 : 0), f.fade_in_ms || 0, f.fade_out_ms || 0, order);
    return getCut(db, cutId);
}

function updateSound(db, id, body = {}) {
    const s = soundRow(db, id), c = row(db, s.cut_id);
    const f = soundFields(db, c.project_id, body, s);
    if (f.start_shot_id && !parse(c.shot_ids, []).includes(f.start_shot_id)) fail(400, 'a sound starts at a shot that is in the cut');
    const keys = Object.keys(f);
    if (keys.length) db.prepare(`UPDATE production_cut_sounds SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map(k => f[k]), id);
    return getCut(db, s.cut_id);
}

function deleteSound(db, id) { const s = soundRow(db, id); db.prepare('DELETE FROM production_cut_sounds WHERE id = ?').run(id); return getCut(db, s.cut_id); }

/**
 * The cut laid out: each shot's picture (clip, board or nothing), where it starts and how long it plays, and each
 * sound's span in the cut. `timeline` is loadTimeline's answer; passed in so the export reads it once.
 */
function layoutOf(db, cut, timeline) {
    const tl = timeline || require('../routes/timeline').loadTimeline(cut.project_id) || { entries: [] };
    const byShot = new Map();
    for (const e of tl.entries || []) {
        byShot.set(e.shot_id, e);
        for (const covered of e.covers || []) if (!byShot.has(covered)) byShot.set(covered, { ...e, covered_by: e.shot_id });
    }
    const holds = parse(cut.holds_json, {});
    const codes = new Map(db.prepare('SELECT id, shot_code, scene_card_yaml FROM film_shots WHERE id IN (SELECT value FROM json_each(?))').all(cut.shot_ids).map(r => [r.id, r]));
    /*
     * A board holds for the shot's length, as directed. The timeline holds every still for a fixed five seconds (its
     * rule for playback), so a 28-second shot played 5 s in the Cut, and a length changed in Generate never reached it.
     * The length set in Generate (production_directions, in seconds) first, then the card's own duration_seconds.
     * A clip still plays its own length; a hold set here in the Cut still wins over both.
     */
    const directed = new Map(db.prepare("SELECT owner, data_json FROM production_directions WHERE project_id = ? AND owner LIKE 'shot:%'").all(cut.project_id)
        .map(r => [r.owner.slice(5), Number(parse(r.data_json, {}).dur) || 0]));
    const cardSecs = row => { const c = parse(row && row.scene_card_yaml, null); return Number(c && (c.duration_seconds || c.duration_s)) || 0; };
    const boardMs = (id, row) => Math.round(1000 * (directed.get(id) || cardSecs(row))) || 0;
    let at = 0;
    const shots = [], placed = new Set();
    for (const id of parse(cut.shot_ids, [])) {
        const e = byShot.get(id);
        const shot = codes.get(id) || {};
        if (e && e.covered_by && placed.has(e.covered_by)) {   // inside a clip already in the cut: it plays there
            shots.push({ shot_id: id, shot_code: shot.shot_code || '', covered_by: e.covered_by, start_ms: null, duration_ms: 0, picture: 'covered' });
            continue;
        }
        const own = e && e.video ? Number(e.duration_ms) || 5000 : boardMs(id, shot) || (e ? Number(e.duration_ms) || 5000 : 5000);
        const sourceMs = e && e.video ? Number(e.video.source_duration_ms) || 0 : 0;
        let len = holds[id] || own;
        if (sourceMs && len > sourceMs) len = sourceMs;      // a clip cannot play longer than it is
        const picture = e && e.video ? 'clip' : e && e.still ? 'board' : 'none';
        shots.push({ shot_id: id, shot_code: shot.shot_code || (e && e.shot_code) || '', scene_id: e ? e.scene_id : null, start_ms: at, duration_ms: len,
            own_duration_ms: own, picture, held: !!holds[id], entry: e || null });
        placed.add(id);
        at += len;
    }
    const where = new Map(shots.filter(s => s.start_ms !== null).map(s => [s.shot_id, s]));
    const sounds = db.prepare('SELECT * FROM production_cut_sounds WHERE cut_id = ? ORDER BY sort_order, created_at').all(cut.id).map(s => {
        const asset = s.asset_id ? db.prepare('SELECT id, asset_type, file_path, file_name, duration_ms FROM film_assets WHERE id = ?').get(s.asset_id) : null;
        const from = where.get(s.start_shot_id);
        if (!from) return { ...s, asset, placed: false, why: 'its start shot is not in the cut' };
        const start = from.start_ms + s.offset_ms;
        const to = s.end_shot_id ? where.get(s.end_shot_id) : null;
        let end = to ? to.start_ms + to.duration_ms : asset && asset.duration_ms ? start + asset.duration_ms : from.start_ms + from.duration_ms;
        if (to && asset && asset.duration_ms && end - start > asset.duration_ms) end = start + asset.duration_ms;   // the file runs out first
        end = Math.min(end, at);
        if (end <= start) return { ...s, asset, placed: false, why: 'it starts after the cut ends' };
        return { ...s, asset, placed: true, start_ms: start, end_ms: end, ...(s.end_shot_id && !to ? { note: 'its end shot is not in the cut: it plays its own length' } : {}) };
    });
    return { total_ms: at, shots, sounds };
}

/** Where the Cut player fetches a sound's file (the same /film/files URL every other page uses). */
function soundUrl(filePath) {
    try { return require('./file-storage').urlForPath(filePath) || null; } catch (_) { return null; }
}

function present(db, c) {
    const layout = layoutOf(db, c);
    return { id: c.id, project_id: c.project_id, name: c.name, version: c.version, label: `${c.name} v${c.version}`,
        shot_ids: parse(c.shot_ids, []), holds: parse(c.holds_json, {}), created_at: c.created_at, updated_at: c.updated_at,
        total_ms: layout.total_ms,
        shots: layout.shots.map(({ entry, ...s }) => s),
        sounds: layout.sounds.map(s => ({ ...s, asset: s.asset ? { id: s.asset.id, asset_type: s.asset.asset_type, file_name: s.asset.file_name,
            file_path: s.asset.file_path, duration_ms: s.asset.duration_ms, url: soundUrl(s.asset.file_path) } : null })) };
}
function getCut(db, id) { return present(db, row(db, id)); }
function listCuts(db, projectId) {
    return db.prepare('SELECT * FROM production_cuts WHERE project_id = ? ORDER BY name, version DESC').all(projectId)
        .map(c => ({ id: c.id, name: c.name, version: c.version, label: `${c.name} v${c.version}`, shot_count: parse(c.shot_ids, []).length, updated_at: c.updated_at }));
}

module.exports = { KINDS, ASSET_TYPES, createCut, updateCut, newVersion, deleteCut, addSound, updateSound, deleteSound, getCut, listCuts, layoutOf, row };
