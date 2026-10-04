/**
 * Per-scene writing readiness (GRD-4671): Draft, Reviewing, Production ready.
 *
 * READ AGAINST THE DOCUMENT, NOT STAMPED BY WRITERS. A scene's text changes through a dozen paths
 * (REST and MCP scene edits, script saves, autosave, history restore, FDX import, character and
 * location renames that write the Fountain directly). A readiness that each of them had to reset
 * would be wrong the first time one forgot. So readiness is stored with the fingerprint of the full
 * scene text it was given to, and every read compares that with the scene's text in the latest
 * Fountain. A mismatch is Draft, and the reset is recorded with both fingerprints.
 *
 * Identity is the film_scenes row the reconciler keeps: a replaced or recreated scene is a new row
 * with no readiness. Two scenes with identical full text cannot be told apart, so neither holds
 * readiness, and neither can be given it.
 *
 * Writing readiness is separate from film_scenes.status (the production stage). Nothing here reads
 * production status, shots or renders, and nothing here renders, exports or spends.
 */
const crypto = require('crypto');

const WRITING_STATUSES = Object.freeze(['draft', 'reviewing', 'production_ready']);
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
function fail(status, message, code, extra) {
    const e = new Error(message); e.status = status; e.code = code; e.extra = extra || {}; throw e;
}

/** Each active scene's full current text and its fingerprint, or null when it cannot be located. */
function currentTexts(db, projectId) {
    const scenes = db.prepare(`SELECT * FROM film_scenes WHERE project_id = ? AND status != 'removed'
        ORDER BY CAST(scene_number AS INTEGER), scene_number`).all(projectId);
    const script = db.prepare(`SELECT fountain_content FROM film_scripts
        WHERE project_id = ? AND fountain_content IS NOT NULL ORDER BY version DESC LIMIT 1`).get(projectId);
    const out = new Map();
    if (!script) { for (const s of scenes) out.set(s.id, null); return out; }
    const fountain = String(script.fountain_content).replace(/\r\n?/g, '\n');
    const lines = fountain.split('\n');
    // The same position-then-heading mapping scene edits use, so readiness and edits agree on which text is whose.
    const { locateSceneSpan } = require('../routes/scenes');
    scenes.forEach((s, i) => {
        const found = locateSceneSpan(s, fountain, i);
        if (found.error) { out.set(s.id, null); return; }
        // Trailing blank lines are the gap before the next scene, not this scene's text.
        const text = lines.slice(found.span.start, found.span.end + 1).join('\n').replace(/\s+$/, '');
        out.set(s.id, { text, fingerprint: sha(text) });
    });
    return out;
}

function duplicates(texts) {
    const seen = new Map();
    for (const t of texts.values()) if (t) seen.set(t.fingerprint, (seen.get(t.fingerprint) || 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([fp]) => fp));
}

/**
 * Bring stored readiness in line with the document: any non-Draft scene whose text moved, vanished
 * or became ambiguous is reset to Draft, with an auto_reset event. Returns the current texts.
 */
function refreshWith(db, projectId) {
    const texts = currentTexts(db, projectId), dup = duplicates(texts);
    const rows = db.prepare(`SELECT * FROM film_scene_writing_status WHERE project_id = ? AND status != 'draft'`).all(projectId);
    for (const row of rows) {
        const cur = texts.get(row.scene_id);
        if (cur && cur.fingerprint === row.fingerprint && !dup.has(cur.fingerprint)) continue;
        const next = cur ? cur.fingerprint : row.fingerprint;
        db.prepare(`UPDATE film_scene_writing_status SET status = 'draft', fingerprint = ?, actor = 'system', reason = ?, updated_at = datetime('now') WHERE scene_id = ?`)
            .run(next, cur ? (dup.has(cur.fingerprint) ? 'identical scene text appeared; identity is ambiguous' : 'accepted scene text changed') : 'scene text is no longer in the screenplay', row.scene_id);
        db.prepare(`INSERT INTO film_scene_writing_events (id, project_id, scene_id, kind, fingerprint, prior_fingerprint, prior_status, new_status, actor, reason)
            VALUES (?, ?, ?, 'auto_reset', ?, ?, ?, 'draft', 'system', ?)`)
            .run(crypto.randomUUID(), projectId, row.scene_id, cur ? cur.fingerprint : null, row.fingerprint, row.status,
                cur ? (dup.has(cur.fingerprint) ? 'identical scene text appeared; identity is ambiguous' : 'accepted scene text changed') : 'scene text is no longer in the screenplay');
    }
    return { texts, dup };
}

function refresh(db, projectId) { return db.transaction(() => refreshWith(db, projectId)).immediate(); }

/** Every active scene's writing readiness, keyed by scene id, after a refresh. */
function state(db, projectId) {
    const { texts, dup } = refresh(db, projectId);
    const stored = new Map(db.prepare('SELECT scene_id, status FROM film_scene_writing_status WHERE project_id = ?').all(projectId).map(r => [r.scene_id, r.status]));
    const out = new Map();
    for (const [id, cur] of texts) {
        out.set(id, {
            writing_status: stored.get(id) || 'draft',
            writing_fingerprint: cur ? cur.fingerprint : null,
            writing_ambiguous: !!(cur && dup.has(cur.fingerprint)),
        });
    }
    return out;
}

function sceneOrFail(db, sceneId) {
    const scene = db.prepare('SELECT * FROM film_scenes WHERE id = ?').get(sceneId);
    if (!scene) fail(404, 'Scene not found', 'not_found');
    return scene;
}

function read(db, sceneId) {
    const scene = sceneOrFail(db, sceneId);
    const s = state(db, scene.project_id).get(sceneId) || { writing_status: 'draft', writing_fingerprint: null, writing_ambiguous: false };
    return {
        scene_id: sceneId, project_id: scene.project_id, statuses: WRITING_STATUSES,
        writing_status: s.writing_status, fingerprint: s.writing_fingerprint, ambiguous: s.writing_ambiguous,
        // Shown beside, never mixed with, writing readiness.
        production_status: scene.status,
        history: db.prepare(`SELECT kind, fingerprint, prior_fingerprint, prior_status, new_status, actor, reason, created_at
            FROM film_scene_writing_events WHERE scene_id = ? ORDER BY rowid`).all(sceneId),
    };
}

/**
 * An explicit transition, from the UI or MCP. The caller states the fingerprint of the text it saw;
 * if the scene has moved on since, the transition is refused rather than applied to unseen text.
 */
function transition(db, sceneId, body, actor) {
    const b = body || {};
    if (!WRITING_STATUSES.includes(b.status)) fail(400, `status must be one of ${WRITING_STATUSES.join(', ')}`, 'invalid_request');
    if (typeof b.expected_fingerprint !== 'string' || !b.expected_fingerprint) fail(400, 'expected_fingerprint is required: read the scene first', 'invalid_request');
    if (typeof b.project_id !== 'string' || !b.project_id) fail(400, 'project_id is required', 'invalid_request');
    if (b.reason !== undefined && (typeof b.reason !== 'string' || b.reason.length > 500)) fail(400, 'reason must be text of at most 500 characters', 'invalid_request');
    const key = b.idempotency_key;
    if (key !== undefined && (typeof key !== 'string' || !/^[\w.:-]{1,100}$/.test(key))) fail(400, 'idempotency_key must be 1–100 letters, digits, ".", ":", "_" or "-"', 'invalid_request');
    return db.transaction(() => {
        const scene = sceneOrFail(db, sceneId);
        if (scene.project_id !== b.project_id) fail(403, 'This scene does not belong to that project', 'forbidden');
        const hash = sha(JSON.stringify({ sceneId, status: b.status, expected: b.expected_fingerprint, reason: b.reason || null }));
        if (key) {
            const seen = db.prepare('SELECT request_hash FROM film_scene_writing_events WHERE project_id = ? AND idempotency_key = ?').get(scene.project_id, key);
            if (seen) {
                if (seen.request_hash !== hash) fail(409, 'This idempotency key was already used for a different request', 'idempotency_conflict');
                return true;
            }
        }
        const { texts, dup } = refreshWith(db, scene.project_id);
        const cur = texts.get(sceneId);
        if (!cur) fail(409, 'This scene cannot be found in the current screenplay; save the screenplay and try again', 'scene_text_unavailable');
        if (cur.fingerprint !== b.expected_fingerprint) fail(409, 'The scene text changed since it was read; review the current text', 'version_conflict', { current_fingerprint: cur.fingerprint });
        if (dup.has(cur.fingerprint) && b.status !== 'draft') fail(409, 'Another scene has identical text, so this scene cannot be identified for readiness; make it distinct first', 'ambiguous_identity');
        const row = db.prepare('SELECT status FROM film_scene_writing_status WHERE scene_id = ?').get(sceneId);
        const prior = row ? row.status : 'draft';
        if (prior === b.status && !key) return true;
        db.prepare(`INSERT INTO film_scene_writing_status (scene_id, project_id, status, fingerprint, actor, reason) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(scene_id) DO UPDATE SET status = excluded.status, fingerprint = excluded.fingerprint, actor = excluded.actor, reason = excluded.reason, updated_at = datetime('now')`)
            .run(sceneId, scene.project_id, b.status, cur.fingerprint, actor, b.reason || null);
        db.prepare(`INSERT INTO film_scene_writing_events (id, project_id, scene_id, kind, fingerprint, prior_status, new_status, actor, reason, idempotency_key, request_hash)
            VALUES (?, ?, ?, 'transition', ?, ?, ?, ?, ?, ?, ?)`)
            .run(crypto.randomUUID(), scene.project_id, sceneId, cur.fingerprint, prior, b.status, actor, b.reason || null, key || null, key ? hash : null);
        return true;
    }).immediate() && read(db, sceneId);
}

module.exports = { WRITING_STATUSES, currentTexts, refresh, state, read, transition };
