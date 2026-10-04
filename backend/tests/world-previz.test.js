/**
 * GRD-4665: editable Blender worlds and camera-blocked previz. Set-based over the worker registry,
 * the camera framing fields and every change that must make a downstream approval stale. Blender is
 * not needed: the inspect worker is injected, and renders are checked at the plan, which is exactly
 * what a render is given.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-world-previz-'));
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const worlds = require('../lib/worlds');
const wp = require('../lib/world-previz');
const previsVideo = require('../lib/previs-video');
const { handlePrevis, CAMERA_FRAMING_FIELDS } = require('../routes/previs');

function sceneGlb() {
    const verts = [0, 0, 0, 10, 0, 0, 10, 0, 6, 0, 0, 6, 0, 3, 0, 10, 3, 0];
    const idx = [0, 1, 2, 0, 2, 3, 0, 1, 5, 0, 5, 4];
    const pos = Buffer.alloc(verts.length * 4); verts.forEach((v, i) => pos.writeFloatLE(v, i * 4));
    const ind = Buffer.alloc(idx.length * 4); idx.forEach((v, i) => ind.writeUInt32LE(v, i * 4));
    const bin = Buffer.concat([pos, ind]);
    const json = { asset: { version: '2.0', generator: 'Khronos glTF Blender I/O' }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
        accessors: [{ bufferView: 0, componentType: 5126, count: verts.length / 3, type: 'VEC3', min: [0, 0, 0], max: [10, 3, 6] },
            { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: ind.length }],
        buffers: [{ byteLength: bin.length }] };
    let jb = Buffer.from(JSON.stringify(json)); if (jb.length % 4) jb = Buffer.concat([jb, Buffer.alloc(4 - (jb.length % 4), 0x20)]);
    const h = Buffer.alloc(12); h.write('glTF', 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + jb.length + 8 + bin.length, 8);
    const jc = Buffer.alloc(8); jc.writeUInt32LE(jb.length, 0); jc.write('JSON', 4);
    const bc = Buffer.alloc(8); bc.writeUInt32LE(bin.length, 0); bc.write('BIN\0', 4);
    return Buffer.concat([h, jc, jb, bc, bin]);
}
// What the inspect worker reports for a .blend: units, axes, versions, transforms, references, an export.
const INSPECTION = (over = {}) => ({
    units: { system: 'METRIC', scale_length: 1, length_unit: 'METERS' }, axes: { up: 'Z', forward: 'Y', handedness: 'right' },
    renderer: { name: 'blender', version: '4.2.3' }, addons: [{ name: 'io_scene_gltf2', version: '4.2.70' }],
    objects: [{ name: 'Floor', location: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, { name: 'Counter', location: [2, 1, 0], rotation: [0, 0, 90], scale: [1, 1, 1] }],
    libraries: [{ path: '//props/stool.blend', exists: true }], images: [{ path: '//tex/tiles.png', exists: false }],
    materials: [{ name: 'Tiles', unsupported: [] }, { name: 'Neon', unsupported: ['ShaderNodeScript'] }], glb: sceneGlb(), ...over });

function project() {
    const id = generateId(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-wp-proj-'));
    db.prepare('INSERT INTO film_projects (id, title, assets_dir, aspect_ratio) VALUES (?, ?, ?, ?)').run(id, 'Sets', dir, '16:9');
    const scene = generateId();
    db.prepare('INSERT INTO film_scenes (id, project_id, scene_number, location) VALUES (?, ?, 1, ?)').run(scene, id, 'DINER');
    const shot = generateId();
    db.prepare('INSERT INTO film_shots (id, scene_id, shot_code, scene_card_yaml) VALUES (?, ?, ?, ?)').run(shot, scene, '1A', '{}');
    fs.writeFileSync(path.join(dir, 'diner.blend'), Buffer.from('BLENDER-v402 fixture bytes for the diner set'));
    return { id, dir, scene, shot };
}
function call(method, urlPath, body) {
    return new Promise(resolve => {
        const parts = urlPath.split('?')[0].split('/').filter(Boolean);
        const res = { statusCode: 200, writeHead(s) { this.statusCode = s; return this; }, setHeader() {}, write() {},
            end(c) { let d; try { d = JSON.parse(c); } catch { d = c; } resolve({ status: this.statusCode, data: d }); } };
        Promise.resolve(handlePrevis({ method, body: body || {}, headers: {} }, res, parts)).catch(e => resolve({ status: 500, data: { error: e.message } }));
    });
}
async function staged() {
    const p = project();
    const w = worlds.createWorld(db, { projectId: p.id, name: 'Diner' });
    const v = await wp.importBlend(db, w.id, { file_path: 'diner.blend' }, { inspect: async () => INSPECTION() });
    const put = await call('PUT', `/film/shots/${p.shot}/previs`, { camera: { position: [1, 1.6, 4], rotation: [0, 0, 0], focalMm: 35, sensorId: 'super35',
        sensorFit: 'HORIZONTAL', aspectRatio: '2.39:1', safeAreas: { action: 0.93, title: 0.8 }, target: [2, 1, 0] },
        subjects: [{ name: 'Mara', kind: 'mesh', position: [2, 0, 0] }], durationMs: 4000, range: { inMs: 1000, outMs: 3000, markers: [{ tMs: 2000, label: 'turn' }] } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    worlds.pinShot(db, p.shot, v.id);
    return { ...p, world: w, version: v };
}

test('Blender work runs only through allowlisted workers, from fixed scripts, without auto-run scripts', () => {
    assert.deepEqual(Object.keys(wp.WORKERS).sort(), ['inspect', 'previz', 'set_build']);
    for (const [name, spec] of Object.entries(wp.WORKERS)) {
        const args = wp.workerArgs(name, '/tmp/job.json');
        for (const flag of ['-b', '--factory-startup', '--disable-autoexec']) assert.ok(args.includes(flag), `${name}: ${flag}`);
        const script = args[args.indexOf('--python') + 1];
        assert.equal(path.dirname(script), path.resolve(__dirname, '..'), `${name}: the script is one of ours`);
        assert.ok(fs.existsSync(script), `${name}: ${spec.script} exists`);
    }
    assert.throws(() => wp.workerArgs('run_python', '/tmp/job.json'), /not an allowed Blender worker/);
    assert.throws(() => wp.workerArgs('inspect', '../../etc/job.json'), /job file/);
});

test('an imported .blend becomes an editable world version with its source, hashes, units, axes and versions', async () => {
    const p = project();
    const w = worlds.createWorld(db, { projectId: p.id, name: 'Diner' });
    const v = await wp.importBlend(db, w.id, { file_path: 'diner.blend' }, { inspect: async () => INSPECTION() });
    const src = wp.editableSource(db, v.id);
    const original = fs.readFileSync(path.join(p.dir, 'diner.blend'));
    assert.equal(src.blend.sha256, crypto.createHash('sha256').update(original).digest('hex'));
    assert.ok(fs.existsSync(src.blend.path) && src.blend.path !== path.join(p.dir, 'diner.blend'), 'kept as the version\'s own copy');
    assert.deepEqual(src.units, { system: 'METRIC', scale_length: 1, length_unit: 'METERS' });
    assert.deepEqual(src.axes, { up: 'Z', forward: 'Y', handedness: 'right' });
    assert.equal(src.renderer.version, '4.2.3'); assert.equal(src.addons[0].name, 'io_scene_gltf2');
    assert.deepEqual(src.linked_assets.map(a => a.path), ['//props/stool.blend', '//tex/tiles.png']);
    assert.match(src.transforms_hash, /^[0-9a-f]{64}$/);
    assert.equal(worlds.getVersion(db, v.id).provider, 'blender');
    assert.equal(wp.editability(db, v.id).editable, true);
    for (const bad of ['../outside.blend', '/etc/passwd']) await assert.rejects(wp.importBlend(db, w.id, { file_path: bad }, { inspect: async () => INSPECTION() }), /outside|No file/);
});

test('the import report names missing assets, unsupported materials, scale changes and substitutions', async () => {
    const p = project();
    const w = worlds.createWorld(db, { projectId: p.id, name: 'Diner' });
    const v = await wp.importBlend(db, w.id, { file_path: 'diner.blend' }, { inspect: async () => INSPECTION({ units: { system: 'IMPERIAL', scale_length: 0.3048, length_unit: 'FEET' } }) });
    const r = wp.importReport(db, v.id);
    assert.deepEqual(r.missing_assets.map(a => a.path), ['//tex/tiles.png']);
    assert.deepEqual(r.unsupported_materials, [{ name: 'Neon', unsupported: ['ShaderNodeScript'] }]);
    assert.ok(r.scale_changes.some(s => /IMPERIAL|0\.3048|feet/i.test(s.detail)));
    assert.ok(Array.isArray(r.substitutions));
    for (const key of wp.REPORT_KEYS) assert.ok(Array.isArray(r[key]), key);
});

test('a preview image is never the editable world, and cannot be approved as one', async () => {
    const p = project();
    const w = worlds.createWorld(db, { projectId: p.id, name: 'Painted' });
    const v = worlds.newVersion(db, w.id, { reason: 'Marble preview only', model: 'marble-1.0-draft' });
    require('../lib/world-assets').storeLocalAsset(db, v.id, p.id, 'panorama', Buffer.from('fake png bytes'));
    const e = wp.editability(db, v.id);
    assert.equal(e.editable, false); assert.equal(e.previews_only, true);
    assert.throws(() => wp.approveWorld(db, v.id, { approval_fingerprint: wp.worldFingerprint(db, v.id), human_confirmed: true, approved_by: 'Manny' }), e => e.code === 'NOT_EDITABLE');
});

test('reopening the saved .blend verifies units, transforms and source versions are preserved', async () => {
    const s = await staged();
    assert.deepEqual(await wp.reopenCheck(db, s.version.id, { inspect: async () => INSPECTION() }), { ok: true, differences: [] });
    const moved = INSPECTION({ objects: [...INSPECTION().objects.slice(0, 1), { name: 'Counter', location: [3, 1, 0], rotation: [0, 0, 90], scale: [1, 1, 1] }], renderer: { name: 'blender', version: '4.3.0' } });
    const r = await wp.reopenCheck(db, s.version.id, { inspect: async () => moved });
    assert.equal(r.ok, false);
    assert.ok(r.differences.some(d => d.field === 'transforms') && r.differences.some(d => d.field === 'renderer'));
    fs.appendFileSync(wp.editableSource(db, s.version.id).blend.path, 'tampered');
    assert.ok((await wp.reopenCheck(db, s.version.id, { inspect: async () => INSPECTION() })).differences.some(d => d.field === 'blend_sha256'));
});

test('camera framing fields are validated, saved and reloaded exactly', async () => {
    assert.deepEqual([...CAMERA_FRAMING_FIELDS].sort(), ['aspectRatio', 'safeAreas', 'sensorFit', 'target']);
    const s = await staged();
    const got = await call('GET', `/film/shots/${s.shot}/previs`);
    const cam = got.data.blocking.camera;
    assert.deepEqual([cam.sensorFit, cam.aspectRatio, cam.safeAreas, cam.target], ['HORIZONTAL', '2.39:1', { action: 0.93, title: 0.8 }, [2, 1, 0]]);
    assert.deepEqual(got.data.blocking.subjects[0].position, [2, 0, 0]);
    assert.deepEqual(got.data.blocking.range, { inMs: 1000, outMs: 3000, markers: [{ tMs: 2000, label: 'turn' }] });
    const bad = { sensorFit: 'DIAGONAL', aspectRatio: 'wide', safeAreas: { action: 1.4 }, target: [1, 2] };
    for (const field of CAMERA_FRAMING_FIELDS) {
        const r = await call('PUT', `/film/shots/${s.shot}/previs`, { camera: { position: [1, 1.6, 4], [field]: bad[field] } });
        assert.equal(r.status, 400, field);
    }
    for (const range of [{ inMs: 3000, outMs: 1000 }, { inMs: 0, outMs: 9000 }, { inMs: 0, outMs: 2000, markers: [{ tMs: 2500, label: 'x' }] }]) {
        assert.equal((await call('PUT', `/film/shots/${s.shot}/previs`, { durationMs: 4000, range })).status, 400, JSON.stringify(range));
    }
});

test('still and motion previews use the shot range and the same saved world and camera versions; flat is the default', async () => {
    const s = await staged();
    const motion = previsVideo.plan(s.shot), still = previsVideo.plan(s.shot, { kind: 'still' });
    assert.equal(motion.mode, 'flat'); assert.equal(previsVideo.plan(s.shot, { mode: 'textured' }).mode, 'textured');
    assert.throws(() => previsVideo.plan(s.shot, { mode: 'photoreal' }), e => e.code === 'BAD_MODE');
    for (const pl of [motion, still]) {
        assert.equal(pl.versions.world_version_id, s.version.id);
        assert.equal(pl.versions.blocking_fingerprint, wp.blockingFingerprint(s.shot));
        assert.equal(pl.versions.world_fingerprint, wp.worldFingerprint(db, s.version.id));
        assert.equal(pl.sensor_fit, 'HORIZONTAL');
        assert.equal(Math.round(pl.width / pl.height * 100) / 100, 2.39, 'the camera\'s own aspect ratio');
    }
    const times = motion.frames.map(f => f.t_ms);
    assert.equal(times[0], 1000); assert.equal(times.at(-1), 3000, 'motion covers the range, not the whole shot');
    assert.equal(still.frames.length, 1); assert.equal(still.frames[0].t_ms, 1000, 'a still is the in point unless told otherwise');
    assert.equal(previsVideo.plan(s.shot, { kind: 'still', atMs: 2000 }).frames[0].t_ms, 2000);
    assert.throws(() => previsVideo.plan(s.shot, { kind: 'still', atMs: 3500 }), e => e.code === 'OUTSIDE_RANGE');
    assert.deepEqual(motion.markers, [{ tMs: 2000, label: 'turn' }]);
    // Substitutions are reported, never silent: Mara has no model, so she is drawn as a box.
    assert.ok(motion.substitutions.some(x => /Mara/.test(x) && /box/.test(x)), JSON.stringify(motion.substitutions));
});

test('saving a shot reproduces its framing: the same saved state gives the same render job', async () => {
    const s = await staged();
    const a = previsVideo.plan(s.shot), b = previsVideo.plan(s.shot);
    assert.deepEqual(a.frames, b.frames);
    assert.deepEqual([a.width, a.height, a.sensor_width_mm, a.sensor_fit], [b.width, b.height, b.sensor_width_mm, b.sensor_fit]);
    assert.deepEqual(previsVideo.renderJob(a), previsVideo.renderJob(b), 'the exact worker job');
    const job = previsVideo.renderJob(a);
    assert.equal(job.sensor_fit, 'HORIZONTAL'); assert.equal(job.shading, 'flat');
});

test('the locked workflow cannot generate a board until the exact world and camera versions are approved',async () => {
    const s = await staged();
    const { executeGenerator } = require('../lib/node-handlers/generate');
    let spent = 0;
    const run = () => executeGenerator({ type: 'gen.image', config: {} }, {}, { project: { id: s.id }, shot: { id: s.shot }, sceneCard: {},
        providerFor: () => ({ id: 'mock', promptLimit: 2000, generate: async () => { spent++; return { ok: true }; } }) });
    assert.notEqual((await run()).code, 'PREVIZ_NOT_APPROVED', 'outside the locked workflow, nothing changes');
    const p2 = project();
    assert.throws(() => wp.setWorkflow(db, p2.shot, 'locked'), e => e.code === 'NO_WORLD', 'locking needs a pinned world');
    wp.setWorkflow(db, s.shot, 'locked');
    spent = 0;
    const gateReasons = () => wp.boardGate(db, s.shot).reasons.sort();
    assert.deepEqual(gateReasons(), ['camera_not_approved', 'world_not_approved']);
    let out = await run();
    assert.equal(out.code, 'PREVIZ_NOT_APPROVED'); assert.equal(spent, 0);
    wp.approveWorld(db, s.version.id, { approval_fingerprint: wp.worldFingerprint(db, s.version.id), human_confirmed: true, approved_by: 'Manny' });
    assert.deepEqual(gateReasons(), ['camera_not_approved']);
    assert.equal((await call('POST', `/film/shots/${s.shot}/previs/approve`, {})).status, 200);
    assert.deepEqual(wp.boardGate(db, s.shot), { locked: true, available: true, reasons: [] });
    out = await run();
    assert.notEqual(out.code, 'PREVIZ_NOT_APPROVED');
    const gotGate = (await call('GET', `/film/shots/${s.shot}/previs`)).data.board_gate;
    assert.equal(gotGate.available, true, 'the previs page shows whether Generate board is available');
});

test('changing the camera, the world or the aspect ratio makes downstream approvals stale', async () => {
    const changes = {
        camera: async s => call('PUT', `/film/shots/${s.shot}/previs`, { camera: { position: [1.5, 1.6, 4], focalMm: 35, sensorFit: 'HORIZONTAL', aspectRatio: '2.39:1', target: [2, 1, 0] } }),
        world: async s => { const v2 = await wp.importBlend(db, s.world.id, { file_path: 'diner.blend' }, { inspect: async () => INSPECTION() }); worlds.pinShot(db, s.shot, v2.id); },
        aspect_ratio: async s => call('PUT', `/film/shots/${s.shot}/previs`, { camera: { position: [1, 1.6, 4], rotation: [0, 0, 0], focalMm: 35, sensorId: 'super35', sensorFit: 'HORIZONTAL', aspectRatio: '1.85:1', safeAreas: { action: 0.93, title: 0.8 }, target: [2, 1, 0] } }),
    };
    for (const [name, change] of Object.entries(changes)) {
        const s = await staged();
        wp.setWorkflow(db, s.shot, 'locked');
        wp.approveWorld(db, s.version.id, { approval_fingerprint: wp.worldFingerprint(db, s.version.id), human_confirmed: true, approved_by: 'Manny' });
        await call('POST', `/film/shots/${s.shot}/previs/approve`, {});
        // A board is made from APPLIED previs (the Apply boundary), so compare applied states.
        await call('POST', `/film/shots/${s.shot}/previs/apply`, {});
        const keyframeBefore = require('../lib/artefact-fingerprint').fingerprintFor('keyframe', { shotId: s.shot });
        assert.equal(wp.boardGate(db, s.shot).available, true, `${name}: ready before`);
        await change(s);
        const gate = wp.boardGate(db, s.shot);
        assert.equal(gate.available, false, `${name}: no longer available`);
        assert.ok(gate.reasons.includes(name === 'world' ? 'world_not_approved' : 'camera_approval_stale'), `${name}: ${gate.reasons}`);
        if (name === 'world') assert.ok(gate.reasons.includes('camera_approval_stale'), 'the camera was approved against the old world');
        await call('POST', `/film/shots/${s.shot}/previs/apply`, {});
        const keyframeAfter = require('../lib/artefact-fingerprint').fingerprintFor('keyframe', { shotId: s.shot });
        assert.notEqual(keyframeAfter, keyframeBefore, `${name}: a board made before is now stale`);
    }
});

test('approving a world needs the exact version fingerprint and a person', async () => {
    const s = await staged();
    assert.throws(() => wp.approveWorld(db, s.version.id, { approval_fingerprint: 'f'.repeat(64), human_confirmed: true, approved_by: 'Manny' }), e => e.code === 'STALE_APPROVAL');
    assert.throws(() => wp.approveWorld(db, s.version.id, { approval_fingerprint: wp.worldFingerprint(db, s.version.id), approved_by: 'Manny' }), e => e.status === 400);
    const v = wp.approveWorld(db, s.version.id, { approval_fingerprint: wp.worldFingerprint(db, s.version.id), human_confirmed: true, approved_by: 'Manny' });
    assert.equal(v.status, 'approved'); assert.equal(v.approved_by, 'Manny');
});

test('with real Blender: a .blend imports through the inspect worker and reopens unchanged', { skip: !require('../lib/set-build').resolveBlender().available }, async () => {
    const { spawnSync } = require('child_process');
    const p = project();
    const blend = path.join(p.dir, 'real.blend');
    const make = spawnSync(require('../lib/set-build').resolveBlender().bin, ['-b', '--factory-startup', '--python-expr',
        `import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.mesh.primitive_cube_add(size=2, location=(1, 2, 1))\nbpy.context.object.name='Block'\nbpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(blend)})`], { encoding: 'utf8', timeout: 120000 });
    assert.ok(fs.existsSync(blend), make.stderr || make.stdout);
    const w = worlds.createWorld(db, { projectId: p.id, name: 'Real' });
    const v = await wp.importBlend(db, w.id, { file_path: 'real.blend' });
    const src = wp.editableSource(db, v.id);
    assert.equal(src.units.system, 'METRIC'); assert.match(src.renderer.version, /^\d+\.\d+/);
    assert.equal(src.objects, 1);
    assert.equal(wp.editability(db, v.id).source, 'blend');
    assert.deepEqual(await wp.reopenCheck(db, v.id), { ok: true, differences: [] });
});

test('over HTTP and MCP: import, read and reopen are open to an agent; approving a world is a person\'s', async () => {
    const s = await staged();
    const tools = require('../lib/mcp-tools');
    for (const name of ['world_import_blend', 'world_version_editable', 'world_reopen_check', 'previs_workflow']) assert.ok(tools.hasTool(name), name);
    const read = tools.presentResult(await tools.callTool('world_version_editable', { version_id: s.version.id }));
    assert.equal(read.editability.editable, true); assert.equal(read.approval_fingerprint, wp.worldFingerprint(db, s.version.id));
    const { handleWorlds } = require('../routes/worlds');
    const viaAgent = await tools.callRoute('POST', `/film/world-versions/${s.version.id}/approve`, { approval_fingerprint: read.approval_fingerprint, human_confirmed: true, approved_by: 'agent' }, handleWorlds);
    assert.equal(viaAgent._status, 403);
    assert.notEqual(worlds.getVersion(db, s.version.id).status, 'approved');
    const gate = tools.presentResult(await tools.callTool('previs_workflow', { shot_id: s.shot, workflow: 'locked' }));
    assert.deepEqual(gate.reasons.sort(), ['camera_not_approved', 'world_not_approved']);
});
