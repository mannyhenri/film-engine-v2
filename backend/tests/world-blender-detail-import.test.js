/** Real disposable native scene: curves/text must survive the supported import. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawnSync } = require('child_process');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-blender-detail-db-'));
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const wp = require('../lib/world-previz');
const worlds = require('../lib/worlds');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const parseGeometry = require('../lib/glb-parser').parseGlb;

function glb(bytes) {
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    const jsonLength = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
    return { json, bin: bytes.subarray(28 + jsonLength) };
}
function nodeGeometry(bytes, name) {
    const { json } = glb(bytes);
    const index = json.nodes.findIndex(n => n.name === name && n.mesh !== undefined);
    assert.ok(index >= 0, `${name} is missing its real native geometry`);
    // Keep the target's ancestors so transformed parent collections are tested.
    const keep = new Set([index]);
    for (let changed = true; changed;) {
        changed = false;
        json.nodes.forEach((n, i) => {
            if ((n.children || []).some(c => keep.has(c)) && !keep.has(i)) { keep.add(i); changed = true; }
        });
    }
    json.nodes.forEach((n, i) => { if (i !== index) delete n.mesh; n.children = (n.children || []).filter(c => keep.has(c)); });
    const jsonBytes = Buffer.from(JSON.stringify(json));
    const padded = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)]);
    const { bin } = glb(bytes), header = Buffer.alloc(12), jc = Buffer.alloc(8), bc = Buffer.alloc(8);
    header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + padded.length + bin.length, 8);
    jc.writeUInt32LE(padded.length); jc.writeUInt32LE(0x4e4f534a, 4);
    bc.writeUInt32LE(bin.length); bc.writeUInt32LE(0x004e4942, 4);
    return parseGeometry(Buffer.concat([header, jc, padded, bc, bin]));
}
function triangleSignature(triangles) {
    return triangles.map(t => t.map(p => p.map(x => Math.round(x * 10000)).join(',')).sort().join('|')).sort();
}
function materialSignature(json, name) {
    const node = json.nodes.find(n => n.name === name && n.mesh !== undefined);
    assert.ok(node, name);
    return json.meshes[node.mesh].primitives.map(p => json.materials[p.material]).sort((a, b) => a.name.localeCompare(b.name));
}
function cameraSignature(json) {
    return json.nodes.filter(n => n.camera !== undefined).map(n => ({
        name: n.name, matrix: n.matrix, translation: n.translation, rotation: n.rotation, scale: n.scale,
        camera: json.cameras[n.camera],
    })).sort((a, b) => a.name.localeCompare(b.name));
}

test('native import retains evaluated curve/font/surface details, cameras and original native bytes', {
    timeout: 180000,
    skip: process.env.FILM_RUN_BLENDER_TESTS !== '1'
        ? 'Set FILM_RUN_BLENDER_TESTS=1 to run the disposable native fixture'
        : !require('../lib/set-build').resolveBlender().available,
}, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-blender-detail-scene-'));
    try {
        const bin = require('../lib/set-build').resolveBlender().bin;
        const create = spawnSync(bin, ['-b', '--factory-startup', '--disable-autoexec', '--python',
            path.join(__dirname, 'fixtures/world-blender-details.py'), '--', root], { timeout: 90000, encoding: 'utf8' });
        assert.equal(create.status, 0, create.stderr + create.stdout);
        assert.match(create.stdout, /DETAIL-FIXTURE-DONE/);
        const blend = path.join(root, 'details.blend'), original = fs.readFileSync(blend), originalSha = sha(original);
        const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json')));
        const control = glb(fs.readFileSync(path.join(root, 'control.glb')));
        const project = generateId();
        db.prepare('INSERT INTO film_projects(id,title,assets_dir) VALUES(?,?,?)').run(project, 'Disposable detail fixture', root);
        const world = worlds.createWorld(db, { projectId: project, name: 'Native detail fixture' });
        const version = await wp.importBlend(db, world.id, { file_path: 'details.blend' });
        const asset = db.prepare(`SELECT a.file_path FROM film_world_assets w JOIN film_assets a ON a.id=w.asset_id
            WHERE w.world_version_id=? AND w.kind='collider'`).get(version.id);
        const bytes = fs.readFileSync(asset.file_path), actual = glb(bytes);

        assert.equal(actual.json.nodes.some(n => n.name === 'Native hidden support shim' && n.mesh !== undefined), false,
            'an authored viewport/render-hidden shim is not forced into the preview');

        for (const [name, source] of Object.entries(expected.objects)) {
            const geo = nodeGeometry(bytes, name);
            const triangles = geo.triangles.map(t => t.map(i => geo.vertices[i]));
            assert.equal(triangles.length, source.triangles.length, `${name} triangle count`);
            assert.deepEqual(triangleSignature(triangles), triangleSignature(source.triangles), `${name} world triangles in metres`);
            const nativePoints = source.triangles.flat();
            ['min', 'max'].forEach(kind => [0, 1, 2].forEach(axis => {
                const wanted = Math[kind](...nativePoints.map(p => p[axis]));
                assert.ok(Math.abs(geo.bounds[kind][axis] - wanted) < 1e-5, `${name} ${kind} bound ${axis}`);
            }));
            assert.deepEqual(materialSignature(actual.json, name), materialSignature(control.json, name), `${name} complete material`);
        }
        assert.deepEqual(cameraSignature(actual.json), cameraSignature(control.json), 'all camera transforms and perspective/orthographic projections');
        assert.equal(actual.json.cameras.length, 2);
        const imageHashes = actual.json.images.map(image => {
            const view = actual.json.bufferViews[image.bufferView];
            return sha(actual.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
        });
        assert.ok(imageHashes.includes(expected.texture_sha256), 'original texture bytes are embedded');
        const native = wp.editableSource(db, version.id);
        assert.equal(native.blend.sha256, originalSha);
        assert.deepEqual(fs.readFileSync(native.blend.path), original, 'saved native copy preserves every byte');
        assert.equal(sha(fs.readFileSync(blend)), originalSha, 'inspection does not mutate the source');
        assert.equal(native.objects, Object.keys(expected.source_types).length);
        assert.deepEqual(native.units, { system: 'METRIC', scale_length: 1, length_unit: 'METERS' });
        assert.deepEqual(native.axes, { up: 'Z', forward: 'Y', handedness: 'right' });
        assert.ok(native.linked_assets.some(a => a.path === '//detail.png' && a.sha256 === expected.texture_sha256));
        assert.equal(version.scale_factor, 1);
        assert.equal(require('../lib/world-assets').MAX_ASSET_BYTES, 64 * 1024 * 1024);
        assert.deepEqual(wp.importReport(db, version.id), { missing_assets: [], unsupported_materials: [], scale_changes: [], substitutions: [] });
        if (process.env.PREVIZ_DETAIL_EVIDENCE_DIR) {
            const out = process.env.PREVIZ_DETAIL_EVIDENCE_DIR;
            fs.mkdirSync(out, { recursive: true });
            fs.writeFileSync(path.join(out, 'detail-import-receipt.json'), JSON.stringify({
                native_sha256: originalSha, preview_sha256: sha(bytes), preview_bytes: bytes.length,
                source_types: expected.source_types, triangle_counts: Object.fromEntries(Object.entries(expected.objects).map(([n, o]) => [n, o.triangles.length])),
                cameras: cameraSignature(actual.json), native_source: native,
            }, null, 2));
        }
    } finally {
        db.close();
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(process.env.FILM_DATA_DIR, { recursive: true, force: true });
    }
});
