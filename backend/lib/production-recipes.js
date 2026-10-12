/**
 * Mutable Production editing state. Nothing here dispatches a provider or
 * changes an asset's provenance. Conditioning references belong to a draft's
 * payload.audio_references; independent audio tracks belong only to the edit.
 */
const fs = require('fs');
const crypto = require('crypto');

function fail(status, message, extra) { throw Object.assign(new Error(message), { status, ...extra }); }
function parse(text, fallback) { try { return JSON.parse(text); } catch (_) { return fallback; } }

function nodeOwner(db, projectId, nodeKey) {
    const match = /^(shot|seq):([0-9a-f-]{36})$/i.exec(String(nodeKey || ''));
    if (!match) fail(400, 'A draft or timeline audio owner must be a shot:<id> or seq:<id>');
    const row = match[1] === 'shot'
        ? db.prepare(`SELECT sh.id, sh.scene_id, s.project_id FROM film_shots sh
            JOIN film_scenes s ON s.id = sh.scene_id WHERE sh.id = ? AND s.project_id = ?`).get(match[2], projectId)
        : db.prepare('SELECT id, project_id FROM film_sequences WHERE id = ? AND project_id = ?').get(match[2], projectId);
    if (!row) fail(404, 'That Production node is not in this project');
    return { ...row, type: match[1] === 'shot' ? 'shot' : 'sequence', node_key: nodeKey,
        shot_id: match[1] === 'shot' ? row.id : null, sequence_id: match[1] === 'seq' ? row.id : null };
}

function draftOf(row) {
    return row ? { revision: row.revision, payload: parse(row.payload_json, {}),
        source_asset_id: row.source_asset_id || null, updated_at: row.updated_at } : null;
}
function readDraft(db, projectId, nodeKey) {
    nodeOwner(db, projectId, nodeKey);
    return draftOf(db.prepare('SELECT * FROM production_node_drafts WHERE project_id = ? AND node_key = ?').get(projectId, nodeKey));
}
function saveDraft(db, projectId, nodeKey, input) {
    nodeOwner(db, projectId, nodeKey);
    if (!input || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) fail(400, 'expected_revision must be a nonnegative integer');
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) fail(400, 'payload must be a draft recipe object');
    let serialized;
    try { serialized = JSON.stringify(input.payload); } catch (_) { fail(400, 'payload must contain JSON values'); }
    if (input.source_asset_id && !db.prepare('SELECT 1 FROM film_assets WHERE id = ? AND project_id = ?').get(input.source_asset_id, projectId)) {
        fail(400, 'source_asset_id must name an asset in this project');
    }
    return db.transaction(() => {
        const row = db.prepare('SELECT * FROM production_node_drafts WHERE project_id = ? AND node_key = ?').get(projectId, nodeKey);
        if ((row ? row.revision : 0) !== input.expected_revision) fail(409, 'The draft changed in another inspector. Reload before saving.', { draft: draftOf(row) });
        const revision = input.expected_revision + 1;
        const sourceId = input.source_asset_id === undefined ? (row && row.source_asset_id) || null : input.source_asset_id || null;
        db.prepare(`INSERT INTO production_node_drafts(project_id, node_key, revision, payload_json, source_asset_id)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, node_key) DO UPDATE SET
            revision = excluded.revision, payload_json = excluded.payload_json, source_asset_id = excluded.source_asset_id, updated_at = datetime('now')`)
            .run(projectId, nodeKey, revision, serialized, sourceId);
        return readDraft(db, projectId, nodeKey);
    }).immediate();
}

/**
 * source is captured on attachment: {asset_id,project_id,path,duration_ms,mime_type,
 * asset_type,version,byte_length,sha256}. It survives later asset-row edits and
 * deletion. Read-time offline tells the truth about the captured path without
 * rewriting the snapshot. Export verifies bytes against the recorded hash.
 */
function snapshot(asset) {
    let bytes = null;
    try { bytes = fs.readFileSync(asset.file_path); } catch (_) { /* offline remains an explicit edit reference */ }
    return { asset_id: asset.id, project_id: asset.project_id, path: asset.file_path, duration_ms: Number(asset.duration_ms) || 0,
        mime_type: asset.mime_type || null, asset_type: asset.asset_type, version: asset.version,
        provider: asset.provider || null, model: asset.provider_model || null, created_at: asset.created_at,
        metadata: parse(asset.metadata, {}),
        byte_length: bytes ? bytes.length : (Number(asset.size_bytes) || null),
        sha256: bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : null };
}
function trackOf(row) {
    const source = parse(row.source_snapshot_json, {});
    let offline = true;
    try { offline = !source.path || !fs.statSync(source.path).isFile(); } catch (_) { /* keep the reference when its source goes offline */ }
    return { id: row.id, asset_id: row.asset_id || source.asset_id, node_key: row.node_key,
        shot_id: row.shot_id, sequence_id: row.sequence_id, relationship: 'timeline_audio',
        offset_ms: row.offset_ms, source_in_ms: row.source_in_ms, duration_ms: row.duration_ms,
        gain_db: row.gain_db, muted: !!row.muted, order: row.sort_order,
        source: { ...source, offline }, updated_at: row.updated_at };
}
function readAudioTracks(db, projectId, nodeKey) {
    nodeOwner(db, projectId, nodeKey);
    return db.prepare('SELECT * FROM production_audio_tracks WHERE project_id = ? AND node_key = ? ORDER BY sort_order, created_at, id')
        .all(projectId, nodeKey).map(trackOf);
}
function saveAudioTracks(db, projectId, nodeKey, tracks) {
    const owner = nodeOwner(db, projectId, nodeKey);
    if (!Array.isArray(tracks)) fail(400, 'tracks must be a list of explicit timeline audio edits');
    return db.transaction(() => {
        const existing = new Map(db.prepare('SELECT * FROM production_audio_tracks WHERE project_id = ? AND node_key = ?').all(projectId, nodeKey).map(r => [r.id, r]));
        const seen = new Set();
        const rows = tracks.map((track, index) => {
            if (!track || typeof track !== 'object') fail(400, `Track ${index + 1} must be an audio edit`);
            if (track.id && (!existing.has(track.id) || seen.has(track.id))) fail(400, 'Track id must name one existing track on this node, once');
            if (track.id) seen.add(track.id);
            const previous = track.id && existing.get(track.id);
            const prevSource = previous && parse(previous.source_snapshot_json, {});
            const sameSource = previous && track.asset_id === (previous.asset_id || prevSource.asset_id);
            const asset = db.prepare('SELECT * FROM film_assets WHERE id = ? AND project_id = ?').get(track.asset_id, projectId);
            if (!sameSource && (!asset || !(/^audio_/.test(asset.asset_type) || asset.asset_type === 'voice_sample'))) fail(400, 'Each track must reference an audio asset in this project');
            const source = sameSource ? prevSource : snapshot(asset);
            const offset = track.offset_ms === undefined ? 0 : track.offset_ms;
            const sourceIn = track.source_in_ms === undefined ? 0 : track.source_in_ms;
            const duration = track.duration_ms === undefined ? source.duration_ms - sourceIn : track.duration_ms;
            const gain = track.gain_db === undefined ? 0 : track.gain_db;
            const muted = track.muted === undefined ? false : track.muted;
            const order = track.order === undefined ? index : track.order;
            if (![offset, sourceIn, duration, order].every(Number.isSafeInteger)
                || sourceIn < 0 || duration <= 0 || order < 0 || !Number.isFinite(gain) || typeof muted !== 'boolean') {
                fail(400, 'Audio timing/order must be integers, gain finite, and muted true or false');
            }
            if (!(source.duration_ms > 0)) fail(400, 'This audio has no recorded duration; its source range cannot be verified');
            if (sourceIn + duration > source.duration_ms) fail(400, 'Audio trim exceeds the full source duration');
            return { id: track.id || crypto.randomUUID(), assetId: asset ? asset.id : null, source,
                offset, sourceIn, duration, gain, muted, order };
        });
        const remove = db.prepare('DELETE FROM production_audio_tracks WHERE project_id = ? AND node_key = ? AND id = ?');
        for (const id of existing.keys()) if (!rows.some(r => r.id === id)) remove.run(projectId, nodeKey, id);
        const write = db.prepare(`INSERT INTO production_audio_tracks(id, project_id, node_key, shot_id, sequence_id, asset_id,
            source_snapshot_json, offset_ms, source_in_ms, duration_ms, gain_db, muted, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
            asset_id = excluded.asset_id, source_snapshot_json = excluded.source_snapshot_json, offset_ms = excluded.offset_ms,
            source_in_ms = excluded.source_in_ms, duration_ms = excluded.duration_ms, gain_db = excluded.gain_db,
            muted = excluded.muted, sort_order = excluded.sort_order, updated_at = datetime('now')`);
        for (const r of rows) write.run(r.id, projectId, nodeKey, owner.shot_id, owner.sequence_id, r.assetId,
            JSON.stringify(r.source), r.offset, r.sourceIn, r.duration, r.gain, r.muted ? 1 : 0, r.order);
        return readAudioTracks(db, projectId, nodeKey);
    }).immediate();
}

module.exports = { readDraft, saveDraft, readAudioTracks, saveAudioTracks, nodeOwner };
