/**
 * Deleting a 3D model (lib/model-delete.js; GET /film/models/:id/uses, DELETE /film/models/:id): set-based over every kind
 * of model the 3D Models page lists, and every way one is used.
 *   - each kind deletes: its row and its file go; a job that made it keeps its row (output_asset_id cleared)
 *   - in use (a Previz set built from it, placed in a shot): uses are listed and the delete needs confirm; then the set
 *     version goes, its shots are unpinned with their blocking kept, the world's active set falls back, the placed copies go
 *   - not a model, or a model with depth layers made from it: refused, nothing changed
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-model-delete-'));
process.env.FILM_DATA_DIR = path.join(TMP, 'data');
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const { handleThreeD } = require('../routes/threed');

const pid = generateId(), sc = generateId(), loc = generateId(), char = generateId();
db.prepare('INSERT INTO film_projects (id, title) VALUES (?, ?)').run(pid, 'Delete test');
db.prepare('INSERT INTO film_scenes (id, project_id, scene_number) VALUES (?, ?, 1)').run(sc, pid);
db.prepare('INSERT INTO film_locations (id, project_id, name) VALUES (?, ?, ?)').run(loc, pid, 'DINER');
db.prepare('INSERT INTO film_characters (id, project_id, name) VALUES (?, ?, ?)').run(char, pid, 'JUNE');
const shot = code => { const id = generateId(); db.prepare('INSERT INTO film_shots (id, scene_id, shot_code) VALUES (?, ?, ?)').run(id, sc, code); return id; };

function model(kind, meta = {}) {
    const id = generateId(), file = path.join(TMP, `${id}.glb`);
    fs.writeFileSync(file, 'glTF');
    db.prepare("INSERT INTO film_assets (id, project_id, asset_type, file_path, file_name, format, metadata) VALUES (?, ?, 'other', ?, ?, 'glb', ?)")
        .run(id, pid, file, path.basename(file), JSON.stringify({ kind, ...meta }));
    return { id, file };
}
function call(method, parts, query = {}) {
    return new Promise(resolve => {
        const res = { status: 0, writeHead(c) { this.status = c; }, end(b) { resolve({ status: this.status, body: JSON.parse(b) }); } };
        Promise.resolve(handleThreeD({ method, body: {} }, res, ['film', 'models', ...parts], query)).catch(e => resolve({ status: 500, body: { error: e.message } }));
    });
}

// Every kind the page lists: Meshy's, Astra's, an imported one, and a rig and an animation made from a model.
const KINDS = [
    ['Meshy character', 'model_3d', { subject_kind: 'character', subject_id: char, source: 'meshy' }],
    ['Astra prop', 'model_3d', { subject_kind: 'prop', source: 'astra-blender' }],
    ['imported', 'model_3d', { subject_kind: 'imported' }],
    ['rigged', 'model_rigged', { subject_kind: 'character', subject_id: char }],
    ['animated', 'model_animated', { subject_kind: 'character', subject_id: char }],
];
for (const [name, kind, meta] of KINDS) {
    test(`a ${name} model (${kind}) not in use deletes: its row and file go, the job that made it stays`, async () => {
        const m = model(kind, meta);
        const job = generateId();
        db.prepare("INSERT INTO film_3d_jobs (id, project_id, gen_type, status, output_asset_id) VALUES (?, ?, 'generate', 'complete', ?)").run(job, pid, m.id);
        const uses = await call('GET', [m.id, 'uses']);
        assert.strictEqual(uses.status, 200);
        assert.strictEqual(uses.body.in_use, false);
        const r = await call('DELETE', [m.id]);
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.ok(!db.prepare('SELECT 1 FROM film_assets WHERE id = ?').get(m.id));
        assert.ok(!fs.existsSync(m.file));
        assert.strictEqual(db.prepare('SELECT output_asset_id FROM film_3d_jobs WHERE id = ?').get(job).output_asset_id, null);
    });
}

test('a location set built from it, and copies placed in shots: listed, refused without confirm, then cleaned up', async () => {
    const m = model('model_3d', { subject_kind: 'location', subject_id: loc, source: 'astra-blender' });
    const older = model('model_3d', { subject_kind: 'location', subject_id: loc });
    const world = generateId(), v1 = generateId(), v2 = generateId();
    db.prepare('INSERT INTO film_worlds (id, project_id, location_id, name) VALUES (?, ?, ?, ?)').run(world, pid, loc, 'Diner set');
    for (const [v, n, a] of [[v1, 1, older.id], [v2, 2, m.id]]) {
        db.prepare("INSERT INTO film_world_versions (id, world_id, version, provider, status) VALUES (?, ?, ?, 'blender', 'approved')").run(v, world, n);
        db.prepare("INSERT INTO film_world_assets (id, world_version_id, kind, asset_id) VALUES (?, ?, 'collider', ?)").run(generateId(), v, a);
    }
    db.prepare('UPDATE film_worlds SET active_version_id = ? WHERE id = ?').run(v2, world);
    const s1 = shot('1A'), s2 = shot('1B');
    const placed = { kind: 'human', name: 'JUNE', model: { asset_id: m.id } }, other = { kind: 'mesh', name: 'stool', model: { library: 'stool' } };
    db.prepare("INSERT INTO film_previs_blocking (id, shot_id, camera_json, world_version_id, world_pinned_at, subjects_json) VALUES (?, ?, '{\"x\":1}', ?, datetime('now'), ?)")
        .run(generateId(), s1, v2, JSON.stringify([placed, other]));
    db.prepare("INSERT INTO film_previs_blocking (id, shot_id, camera_json, subjects_json) VALUES (?, ?, '{}', ?)").run(generateId(), s2, JSON.stringify([placed, placed]));

    const uses = (await call('GET', [m.id, 'uses'])).body;
    assert.deepStrictEqual(uses.previz_sets.map(v => [v.version, v.location_name, v.pinned_shots]), [[2, 'DINER', ['1A']]]);
    assert.deepStrictEqual(uses.staged_in.sort((a, b) => a.shot_code.localeCompare(b.shot_code)), [{ shot_code: '1A', count: 1 }, { shot_code: '1B', count: 2 }]);
    const refused = await call('DELETE', [m.id]);
    assert.strictEqual(refused.status, 409);
    assert.ok(db.prepare('SELECT 1 FROM film_assets WHERE id = ?').get(m.id), 'nothing changed without confirm');

    const r = await call('DELETE', [m.id], { confirm: '1' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.previz_sets_removed, r.body.shots_unpinned, r.body.placed_copies_removed], [1, ['1A'], 3]);
    assert.ok(!db.prepare('SELECT 1 FROM film_world_versions WHERE id = ?').get(v2), 'the set version built from it goes');
    assert.strictEqual(db.prepare('SELECT active_version_id FROM film_worlds WHERE id = ?').get(world).active_version_id, v1, 'the world falls back to v1');
    const b1 = db.prepare('SELECT * FROM film_previs_blocking WHERE shot_id = ?').get(s1);
    assert.strictEqual(b1.world_version_id, null, '1A is unpinned');
    assert.strictEqual(b1.camera_json, '{"x":1}', 'its blocking is kept');
    assert.deepStrictEqual(JSON.parse(b1.subjects_json), [other], 'only the placed copy goes');
    assert.deepStrictEqual(JSON.parse(db.prepare('SELECT subjects_json FROM film_previs_blocking WHERE shot_id = ?').get(s2).subjects_json), []);
    assert.ok(fs.existsSync(older.file), 'the other version\'s model is untouched');
});

test('not a model, or a model with depth layers made from it: refused, nothing changed', async () => {
    const pic = generateId();
    db.prepare("INSERT INTO film_assets (id, project_id, asset_type, file_path, file_name, metadata) VALUES (?, ?, 'reference_image', '/x.png', 'x.png', '{}')").run(pic, pid);
    assert.strictEqual((await call('DELETE', [pic])).status, 400);
    assert.ok(db.prepare('SELECT 1 FROM film_assets WHERE id = ?').get(pic));
    assert.strictEqual((await call('DELETE', [generateId()])).status, 404);
    const m = model('model_3d', {});
    const cols = db.prepare('PRAGMA table_info(production_depth_nodes)').all().filter(c => c.notnull && c.dflt_value == null && c.name !== 'source_asset_id');
    const vals = cols.map(c => c.name === 'project_id' ? pid : /_json$/.test(c.name) ? '{}' : /INT|REAL/i.test(c.type) ? 1 : c.name === 'id' ? generateId() : 'x');
    db.prepare(`INSERT INTO production_depth_nodes (${[...cols.map(c => c.name), 'source_asset_id'].join(', ')}) VALUES (${[...cols, 1].map(() => '?').join(', ')})`).run(...vals, m.id);
    const r = await call('DELETE', [m.id], { confirm: '1' });
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /depth layers/);
    assert.ok(fs.existsSync(m.file));
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
