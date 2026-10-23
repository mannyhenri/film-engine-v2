'use strict';
/**
 * DELETE A 3D MODEL (the 3D Models page): what uses it first, then everything that would break without it.
 *
 * A model is a film_assets row (metadata.kind model_3d / model_rigged / model_animated: Meshy, Astra-in-Blender,
 * imported) and its file. Most links to an asset clear themselves (ON DELETE SET NULL). Two would be left BROKEN:
 *   - a Previz set built from it: the world version's collider points at the model; emptied, the set has no geometry.
 *     That version goes (its other assets and sources with it), and shots pinned to it are unpinned, their blocking kept.
 *   - a model placed in a shot in Previz: subjects_json holds { model: { asset_id } }, which no foreign key sees.
 *     Those placed copies are taken out; everything else in the shot's blocking stays.
 * Depth layers made from an asset hold it with NO ACTION, so such a model is refused with the reason, not half-deleted.
 */
const fs = require('fs');
const path = require('path');

function parse(s, d) { try { const v = JSON.parse(s); return v ?? d; } catch (_) { return d; } }
function fail(status, message, extra = {}) { throw Object.assign(new Error(message), { status, ...extra }); }

function modelRow(db, assetId) {
    const a = db.prepare('SELECT * FROM film_assets WHERE id = ?').get(assetId);
    if (!a) fail(404, 'no such model');
    const meta = parse(a.metadata, {});
    if (!/^model/.test(String(meta.kind || ''))) fail(400, `${a.file_name || 'this asset'} is not a 3D model`);
    return { a, meta };
}

/** Where this model is used: the Previz sets built from it and the shots it is placed in. */
function usesOf(db, assetId) {
    const { a, meta } = modelRow(db, assetId);
    const versions = db.prepare(`SELECT v.id, v.version, w.id world_id, w.name world_name, l.name location_name
        FROM film_world_assets wa JOIN film_world_versions v ON v.id = wa.world_version_id JOIN film_worlds w ON w.id = v.world_id
        LEFT JOIN film_locations l ON l.id = w.location_id WHERE wa.asset_id = ?`).all(assetId).map(v => ({
        ...v, pinned_shots: db.prepare(`SELECT s.shot_code FROM film_previs_blocking b JOIN film_shots s ON s.id = b.shot_id WHERE b.world_version_id = ?`).all(v.id).map(r => r.shot_code) }));
    const staged = [];
    for (const b of db.prepare(`SELECT b.id, b.subjects_json, s.shot_code FROM film_previs_blocking b JOIN film_shots s ON s.id = b.shot_id
        JOIN film_scenes sc ON sc.id = s.scene_id WHERE sc.project_id = ? AND b.subjects_json LIKE ?`).all(a.project_id, `%${assetId}%`)) {
        const n = parse(b.subjects_json, []).filter(x => x && x.model && x.model.asset_id === assetId).length;
        if (n) staged.push({ shot_code: b.shot_code, count: n });
    }
    const depth = db.prepare(`SELECT COUNT(*) n FROM production_depth_nodes WHERE source_asset_id = ?`).get(assetId).n
        + db.prepare(`SELECT COUNT(*) n FROM production_depth_versions WHERE ? IN (manifest_asset_id, preview_asset_id, raw_asset_id)`).get(assetId).n;
    return { asset_id: assetId, file_name: a.file_name, kind: meta.kind, subject_name: meta.subject_name || null,
        previz_sets: versions, staged_in: staged, depth_layers: depth, in_use: versions.length > 0 || staged.length > 0 };
}

/** Delete it. In use: only with { confirm: true }, after the page has shown usesOf. Returns what was removed. */
function deleteModel(db, assetId, { confirm = false } = {}) {
    const uses = usesOf(db, assetId);
    if (uses.depth_layers) fail(409, `${uses.file_name} has depth layers made from it (Production › depth); delete those first.`, { uses });
    if (uses.in_use && !confirm) fail(409, 'this model is in use; confirm to delete it and what was built from it', { uses });
    const { a, meta } = modelRow(db, assetId);
    const removedVersions = uses.previz_sets.map(v => v.id);
    let unstaged = 0;
    db.transaction(() => {
        for (const v of removedVersions) {
            db.prepare('UPDATE film_previs_blocking SET world_version_id = NULL, world_pinned_at = NULL WHERE world_version_id = ?').run(v);
            db.prepare('UPDATE film_world_versions SET parent_version_id = NULL WHERE parent_version_id = ?').run(v);
            db.prepare('DELETE FROM film_world_versions WHERE id = ?').run(v);
            // A world whose active set was this one falls back to its newest remaining version, or none.
            for (const w of db.prepare('SELECT id FROM film_worlds WHERE active_version_id = ?').all(v)) {
                const next = db.prepare('SELECT id FROM film_world_versions WHERE world_id = ? ORDER BY version DESC LIMIT 1').get(w.id);
                db.prepare("UPDATE film_worlds SET active_version_id = ?, updated_at = datetime('now') WHERE id = ?").run(next ? next.id : null, w.id);
            }
        }
        for (const b of db.prepare('SELECT id, subjects_json FROM film_previs_blocking WHERE subjects_json LIKE ?').all(`%${assetId}%`)) {
            const subs = parse(b.subjects_json, []);
            const kept = subs.filter(x => !(x && x.model && x.model.asset_id === assetId));
            if (kept.length !== subs.length) { unstaged += subs.length - kept.length; db.prepare('UPDATE film_previs_blocking SET subjects_json = ? WHERE id = ?').run(JSON.stringify(kept), b.id); }
        }
        db.prepare('DELETE FROM film_assets WHERE id = ?').run(assetId);
    })();
    // The file, and an Astra build's editable .blend beside it, once nothing in the database points at them.
    const files = [a.file_path, meta.blend_path].filter(Boolean);
    const removedFiles = [];
    for (const f of files) {
        if (!path.isAbsolute(String(f))) continue;
        const still = db.prepare('SELECT 1 FROM film_assets WHERE file_path = ? LIMIT 1').get(f);
        if (still) continue;
        try { fs.unlinkSync(f); removedFiles.push(f); } catch (_) { /* already gone */ }
    }
    return { deleted: true, asset_id: assetId, previz_sets_removed: removedVersions.length, shots_unpinned: uses.previz_sets.flatMap(v => v.pinned_shots),
        placed_copies_removed: unstaged, files_removed: removedFiles };
}

module.exports = { usesOf, deleteModel };
