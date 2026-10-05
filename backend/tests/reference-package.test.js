/**
 * GRD-4666: pinned reference packages, capability negotiation, board/video drift review, shot copies.
 * Set-based over the pass, control, drift and disposition registries lib/reference-package.js
 * declares. Blender is injected except in the last test, which renders real passes when Blender is here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-refpkg-'));
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const worlds = require('../lib/worlds');
const wp = require('../lib/world-previz');
const rp = require('../lib/reference-package');
const { handlePrevis } = require('../routes/previs');

const PNG = w => { // a w x (w*9/16) solid PNG, enough for size checks
    const zlib = require('zlib'), h = Math.round(w * 9 / 16);
    const raw = Buffer.alloc((w * 3 + 1) * h, 0x80); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
    const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(require('zlib').crc32 ? zlib.crc32(Buffer.concat([Buffer.from(t), d])) : 0, 8 + d.length); return b; };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
function sceneGlb() {
    const verts = [0, 0, 0, 10, 0, 0, 10, 0, 6, 0, 0, 6, 0, 3, 0, 10, 3, 0], idx = [0, 1, 2, 0, 2, 3, 0, 1, 5, 0, 5, 4];
    const pos = Buffer.alloc(verts.length * 4); verts.forEach((v, i) => pos.writeFloatLE(v, i * 4));
    const ind = Buffer.alloc(idx.length * 4); idx.forEach((v, i) => ind.writeUInt32LE(v, i * 4));
    const bin = Buffer.concat([pos, ind]);
    const json = { asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [0, 0, 0], max: [10, 3, 6] }, { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: ind.length }], buffers: [{ byteLength: bin.length }] };
    let jb = Buffer.from(JSON.stringify(json)); if (jb.length % 4) jb = Buffer.concat([jb, Buffer.alloc(4 - (jb.length % 4), 0x20)]);
    const h = Buffer.alloc(12); h.write('glTF', 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + jb.length + 8 + bin.length, 8);
    const jc = Buffer.alloc(8); jc.writeUInt32LE(jb.length, 0); jc.write('JSON', 4); const bc = Buffer.alloc(8); bc.writeUInt32LE(bin.length, 0); bc.write('BIN\0', 4);
    return Buffer.concat([h, jc, jb, bc, bin]);
}
const INSPECTION = () => ({ units: { system: 'METRIC', scale_length: 1, length_unit: 'METERS' }, axes: { up: 'Z', forward: 'Y', handedness: 'right' },
    renderer: { name: 'blender', version: '4.5.7' }, addons: [], objects: [{ name: 'Floor', location: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }], libraries: [], images: [], materials: [], glb: sceneGlb() });
function call(method, urlPath, body) {
    return new Promise(resolve => {
        const parts = urlPath.split('/').filter(Boolean);
        const res = { statusCode: 200, writeHead(s) { this.statusCode = s; return this; }, setHeader() {}, write() {},
            end(c) { let d; try { d = JSON.parse(c); } catch { d = c; } resolve({ status: this.statusCode, data: d }); } };
        Promise.resolve(handlePrevis({ method, body: body || {}, headers: {} }, res, parts)).catch(e => resolve({ status: 500, data: { error: e.message } }));
    });
}
// A pass render stand-in: real files, so hashes and sizes are real.
const fakePasses = kinds => async (plan, outDir) => {
    fs.mkdirSync(outDir, { recursive: true });
    const out = {};
    for (const k of kinds) { const f = path.join(outDir, k === 'beauty' ? 'beauty.png' : `${k}.exr`); fs.writeFileSync(f, k === 'beauty' ? PNG(plan.width) : Buffer.from(`EXR ${k} ${plan.width}x${plan.height}`)); out[k] = f; }
    return { passes: out, renderer: 'cycles-cpu', subject_index: { 1: 'Mara' } };
};
const CAMERA = { position: [0, 1.6, 6], rotation: [0, 0, 0], focalMm: 35, sensorId: 'super35', sensorFit: 'HORIZONTAL', aspectRatio: '16:9', target: [0, 1.5, 0] };
async function staged() {
    const id = generateId(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-rp-'));
    db.prepare('INSERT INTO film_projects (id, title, assets_dir, aspect_ratio) VALUES (?, ?, ?, ?)').run(id, 'Packages', dir, '16:9');
    const scene = generateId(); db.prepare('INSERT INTO film_scenes (id, project_id, scene_number, location) VALUES (?, ?, 1, ?)').run(scene, id, 'DINER');
    const shot = generateId(); db.prepare('INSERT INTO film_shots (id, scene_id, shot_code, scene_card_yaml) VALUES (?, ?, ?, ?)').run(shot, scene, '1A', JSON.stringify({ shot_code: '1A', shot_type: 'medium', description: 'Mara waits by the door.' }));
    fs.writeFileSync(path.join(dir, 'set.blend'), 'BLENDER fixture');
    const w = worlds.createWorld(db, { projectId: id, name: 'Diner' });
    const v = await wp.importBlend(db, w.id, { file_path: 'set.blend' }, { inspect: async () => INSPECTION() });
    const put = await call('PUT', `/film/shots/${shot}/previs`, { camera: CAMERA, subjects: [{ name: 'Mara', kind: 'mesh', position: [0, 0, 0], sizeM: [0.5, 1.7, 0.3] }], durationMs: 4000 });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    worlds.pinShot(db, shot, v.id);
    const applied = await call('POST', `/film/shots/${shot}/previs/apply`, {});
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    return { id, dir, scene, shot, world: w, version: v };
}
const INTENT = { text: 'Mara small in frame left of the door; the door frame vertical, right third.', landmarks: [
    { id: 'door', category: 'door_window', name: 'Front door', position: [1.5, 1, -0.5] },
    { id: 'jukebox', category: 'prop', name: 'Jukebox', position: [-1.5, 0.8, -1] }] };
async function approvedPackage(s, kinds = ['beauty', 'depth', 'normal', 'object_mask']) {
    const pkg = await rp.createPackage(db, s.shot, { intent: INTENT, passes: kinds }, { renderPasses: fakePasses(kinds) });
    rp.approvePackage(db, pkg.id, { approval_fingerprint: pkg.package_fingerprint, human_confirmed: true, approved_by: 'Manny' });
    return pkg;
}

test('the declared registries', () => {
    assert.deepEqual(Object.keys(rp.PASS_SPECS), ['beauty', 'depth', 'normal', 'object_mask']);
    for (const [k, spec] of Object.entries(rp.PASS_SPECS)) for (const f of ['format', 'precision', 'units', 'convention', 'invalid']) assert.ok(spec[f], `${k}.${f}`);
    assert.equal(rp.PASS_SPECS.depth.format, 'exr'); assert.equal(rp.PASS_SPECS.beauty.format, 'png');
    assert.deepEqual([...rp.REFERENCE_CONTROLS], ['reference_image', 'camera_pose', 'depth', 'normal', 'object_mask']);
    assert.deepEqual([...rp.DRIFT_CATEGORIES], ['framing', 'eyeline', 'horizon', 'prop', 'door_window', 'placement']);
    assert.deepEqual([...rp.DISPOSITIONS], ['accept', 'accept_with_deviations', 'redo', 'reject']);
});

test('a reference package is immutable: hashes, shot versions, camera specification, intent, passes and a person\'s approval', async () => {
    const s = await staged();
    const pkg = await rp.createPackage(db, s.shot, { intent: INTENT, passes: ['beauty', 'depth', 'normal', 'object_mask'] }, { renderPasses: fakePasses(['beauty', 'depth', 'normal', 'object_mask']) });
    for (const p of pkg.passes) {
        assert.equal(p.sha256, crypto.createHash('sha256').update(fs.readFileSync(p.path)).digest('hex'), p.kind);
        for (const f of ['format', 'precision', 'units', 'convention', 'invalid']) assert.equal(p[f], rp.PASS_SPECS[p.kind][f], `${p.kind}.${f}`);
    }
    assert.equal(pkg.versions.world_version_id, s.version.id);
    assert.equal(pkg.versions.blocking_fingerprint, wp.blockingFingerprint(s.shot));
    assert.equal(pkg.camera.focalMm, 35); assert.equal(pkg.camera.aspectRatio, '16:9'); assert.ok(pkg.camera.width && pkg.camera.height && pkg.camera.sensor_width_mm);
    assert.equal(pkg.intent.text, INTENT.text);
    const door = pkg.intent.landmarks.find(l => l.id === 'door');
    assert.ok(Number.isFinite(door.screen[0]) && Number.isFinite(door.screen[1]), 'each landmark is projected into the frame');
    assert.ok(pkg.intent.subjects.some(x => x.name === 'Mara' && x.bounds), 'subject bounds in the frame');
    assert.match(pkg.package_fingerprint, /^[0-9a-f]{64}$/);
    assert.throws(() => db.prepare('UPDATE film_reference_packages SET intent_json = ? WHERE id = ?').run('{}', pkg.id), /immutable/);
    assert.throws(() => rp.approvePackage(db, pkg.id, { approval_fingerprint: 'f'.repeat(64), human_confirmed: true, approved_by: 'Manny' }), e => e.code === 'STALE_APPROVAL');
    assert.throws(() => rp.approvePackage(db, pkg.id, { approval_fingerprint: pkg.package_fingerprint, approved_by: 'Manny' }), e => e.status === 400);
    await assert.rejects(rp.createPackage(db, s.shot, { intent: INTENT, passes: ['beauty', 'xray'] }, { renderPasses: fakePasses(['beauty']) }), e => e.status === 400);
});

test('board jobs read the pinned approved package, never the latest mutable camera', async () => {
    const s = await staged();
    const pkg = await rp.createPackage(db, s.shot, { intent: INTENT, passes: ['beauty'] }, { renderPasses: fakePasses(['beauty']) });
    assert.throws(() => rp.pinPackage(db, s.shot, pkg.id), e => e.code === 'NOT_APPROVED');
    rp.approvePackage(db, pkg.id, { approval_fingerprint: pkg.package_fingerprint, human_confirmed: true, approved_by: 'Manny' });
    rp.pinPackage(db, s.shot, pkg.id);
    await call('PUT', `/film/shots/${s.shot}/previs`, { camera: { ...CAMERA, focalMm: 85 }, subjects: [{ name: 'Mara', kind: 'mesh', position: [0, 0, 0], sizeM: [0.5, 1.7, 0.3] }], durationMs: 4000 });
    await call('POST', `/film/shots/${s.shot}/previs/apply`, {});
    const { loadShotContext, buildCapabilityPayload } = require('../lib/capability-payloads');
    const ctx = loadShotContext(s.shot);
    assert.equal(ctx.previs.camera.focalMm, 35, 'the pinned package\'s camera');
    assert.equal(ctx.previs.reference_package.id, pkg.id);
    const built = buildCapabilityPayload('image', { ...ctx, project: { ...ctx.project, provider_config: '{}' } });
    const prompt = JSON.stringify(built.payload || built);
    assert.ok(prompt.includes('35mm lens') && !prompt.includes('85mm lens'), 'the board describes the approved camera');
    const st = rp.packageState(db, s.shot);
    assert.equal(st.stale, true); assert.ok(st.reasons.includes('camera'));
});

test('an image-only adapter omits every unsupported control, warns before submission, and needs approval of the weakened mode', async () => {
    const s = await staged();
    const pkg = await approvedPackage(s);
    rp.pinPackage(db, s.shot, pkg.id);
    const imageOnly = { id: 'image-only-test', capabilities: ['image'], supportsReferenceImages: true, maxReferenceImages: 3 };
    const n = rp.negotiate(db, pkg.id, imageOnly);
    assert.deepEqual(n.submitted, ['reference_image']);
    for (const control of rp.REFERENCE_CONTROLS.filter(c => c !== 'reference_image')) {
        const o = n.omitted.find(x => x.control === control);
        assert.ok(o && o.reason, `${control} is named as omitted with a reason`);
    }
    assert.equal(n.weakened, true); assert.match(n.warning, /camera|geometry/i); assert.match(n.warning, /drift/i);
    const full = rp.negotiate(db, pkg.id, { id: 'full-test', capabilities: ['image'], supportsReferenceImages: true, referenceControls: [...rp.REFERENCE_CONTROLS] });
    assert.equal(full.weakened, false); assert.deepEqual(full.omitted, []);
    assert.equal(rp.generationRefusal(db, s.shot, imageOnly).code, 'WEAKENED_REFERENCE_NOT_APPROVED');
    assert.throws(() => rp.approveWeakened(db, pkg.id, { provider_id: imageOnly.id, negotiation_fingerprint: 'x', human_confirmed: true, approved_by: 'Manny' }), e => e.code === 'STALE_APPROVAL');
    rp.approveWeakened(db, pkg.id, { provider_id: imageOnly.id, negotiation_fingerprint: n.negotiation_fingerprint, human_confirmed: true, approved_by: 'Manny' });
    assert.equal(rp.generationRefusal(db, s.shot, imageOnly), null);
    const { preSpendEnvelope } = require('../lib/approval-envelope');
    const env = preSpendEnvelope({ referenceNegotiation: n });
    assert.ok(env.warnings.some(w => w.id === 'reference_controls_omitted' && /depth/.test(w.detail)));
});

test('a shifted doorway, prop or subject is flagged, and anything unmarked goes to manual review', async () => {
    const s = await staged();
    const pkg = await approvedPackage(s);
    const exp = Object.fromEntries([...pkg.intent.landmarks, ...pkg.intent.subjects.map(x => ({ id: `subject:${x.name}`, screen: x.screen, bounds: x.bounds }))].map(l => [l.id, l]));
    const board = rp.registerBoardImage(db, s.shot, PNG(pkg.camera.width), { source: 'test' });
    const marks = {
        door: [exp.door.screen[0] + 0.2 * pkg.camera.width, exp.door.screen[1]],      // the doorway moved a fifth of the frame
        jukebox: exp.jukebox.screen,                                                     // where it should be
        'subject:Mara': [exp['subject:Mara'].screen[0], exp['subject:Mara'].screen[1] + 0.15 * pkg.camera.height],
        horizon: pkg.intent.horizon_y, eyeline: { 'Mara': pkg.intent.subjects[0].eyeline_y },
    };
    const c = rp.compareBoard(db, { package_id: pkg.id, board_asset_id: board.id, marks });
    const by = id => c.checks.find(x => x.id === id);
    assert.equal(by('door').status, 'drift'); assert.equal(by('door').category, 'door_window');
    assert.equal(by('jukebox').status, 'ok');
    assert.equal(by('subject:Mara').status, 'drift'); assert.equal(by('subject:Mara').category, 'placement');
    for (const cat of rp.DRIFT_CATEGORIES) assert.ok(c.checks.some(x => x.category === cat), `${cat} is checked`);
    assert.equal(c.manual_review, false);
    const blind = rp.compareBoard(db, { package_id: pkg.id, board_asset_id: board.id, marks: {} });
    assert.equal(blind.manual_review, true, 'nothing verified means a person looks');
    assert.ok(blind.checks.filter(x => x.category !== 'framing').every(x => x.status === 'unverified'));
    const cropped = rp.registerBoardImage(db, s.shot, (() => { const w = 400; const b = PNG(w); b.writeUInt32BE(w, 16); b.writeUInt32BE(w, 20); return b; })(), { source: 'test' });
    assert.equal(rp.compareBoard(db, { package_id: pkg.id, board_asset_id: cropped.id, marks }).checks.find(x => x.category === 'framing').status, 'drift', 'a square board against a 16:9 package is framing drift');
});

test('exact-geometry shots can take the renderer\'s own board; camera, aspect or world changes make boards stale and keep every previous version', async () => {
    const changes = {
        camera: async s => { await call('PUT', `/film/shots/${s.shot}/previs`, { camera: { ...CAMERA, position: [0.4, 1.6, 6] }, subjects: [{ name: 'Mara', kind: 'mesh', position: [0, 0, 0], sizeM: [0.5, 1.7, 0.3] }], durationMs: 4000 }); },
        aspect: async s => { await call('PUT', `/film/shots/${s.shot}/previs`, { camera: { ...CAMERA, aspectRatio: '2.39:1' }, subjects: [{ name: 'Mara', kind: 'mesh', position: [0, 0, 0], sizeM: [0.5, 1.7, 0.3] }], durationMs: 4000 }); },
        world: async s => { const v2 = await wp.importBlend(db, s.world.id, { file_path: 'set.blend' }, { inspect: async () => INSPECTION() }); worlds.pinShot(db, s.shot, v2.id); },
    };
    for (const [name, change] of Object.entries(changes)) {
        const s = await staged();
        const pkg = await approvedPackage(s); rp.pinPackage(db, s.shot, pkg.id);
        const board = rp.renderedBoard(db, s.shot);
        assert.equal(board.metadata.source, 'renderer'); assert.equal(board.metadata.reference_package_id, pkg.id);
        assert.equal(board.metadata.package_fingerprint, pkg.package_fingerprint);
        const fpBefore = require('../lib/artefact-fingerprint').fingerprintFor('keyframe', { shotId: s.shot });
        await change(s); await call('POST', `/film/shots/${s.shot}/previs/apply`, {});
        const st = rp.packageState(db, s.shot);
        assert.equal(st.stale, true, name); assert.ok(st.reasons.includes(name), `${name}: ${st.reasons}`);
        assert.notEqual(require('../lib/artefact-fingerprint').fingerprintFor('keyframe', { shotId: s.shot }), fpBefore, `${name}: the board is stale`);
        assert.ok(db.prepare('SELECT 1 FROM film_reference_packages WHERE id = ?').get(pkg.id), 'the package is kept');
        assert.ok(db.prepare('SELECT 1 FROM film_assets WHERE id = ?').get(board.id), 'the board version is kept');
    }
});

test('a board is disposed by a person, deviations are approved before pinning for video, and carried into motion review', async () => {
    const s = await staged();
    const pkg = await approvedPackage(s); rp.pinPackage(db, s.shot, pkg.id);
    const board = rp.renderedBoard(db, s.shot);
    const exp = pkg.intent.landmarks.find(l => l.id === 'door');
    const c = rp.compareBoard(db, { package_id: pkg.id, board_asset_id: board.id, marks: { door: [exp.screen[0] + 300, exp.screen[1]], jukebox: pkg.intent.landmarks.find(l => l.id === 'jukebox').screen,
        'subject:Mara': pkg.intent.subjects[0].screen, horizon: pkg.intent.horizon_y, eyeline: { Mara: pkg.intent.subjects[0].eyeline_y } } });
    assert.throws(() => rp.pinForVideo(db, s.shot, { review_id: c.review_id }), e => e.code === 'NOT_DISPOSED');
    assert.throws(() => rp.dispose(db, { review_id: c.review_id, comparison_fingerprint: c.comparison_fingerprint, disposition: 'accept', human_confirmed: true, by: 'Manny' }), e => e.code === 'UNRESOLVED_DRIFT');
    assert.throws(() => rp.dispose(db, { review_id: c.review_id, comparison_fingerprint: c.comparison_fingerprint, disposition: 'accept_with_deviations', deviations: [], human_confirmed: true, by: 'Manny' }), e => e.code === 'UNRESOLVED_DRIFT');
    assert.throws(() => rp.dispose(db, { review_id: c.review_id, comparison_fingerprint: c.comparison_fingerprint, disposition: 'accept_with_deviations', deviations: [{ check: 'door', note: 'door moved to clear the dolly' }], by: 'Manny' }), e => e.status === 400);
    rp.dispose(db, { review_id: c.review_id, comparison_fingerprint: c.comparison_fingerprint, disposition: 'accept_with_deviations', deviations: [{ check: 'door', note: 'door moved to clear the dolly' }], human_confirmed: true, by: 'Manny' });
    const pin = rp.pinForVideo(db, s.shot, { review_id: c.review_id });
    assert.equal(pin.refs.start_frame.asset_id, board.id);
    for (const k of ['start_frame', 'end_frame', 'trajectory']) assert.ok(k in pin.refs, k);
    assert.ok(Array.isArray(pin.refs.trajectory.keys));
    assert.ok(pin.refs.support && typeof pin.refs.support === 'object', 'what the video adapter can take is recorded');
    assert.throws(() => rp.reviewMotion(db, { video_pin_id: pin.id, findings: [] , by: 'Manny' }), e => e.status === 400);
    const mr = rp.reviewMotion(db, { video_pin_id: pin.id, findings: [{ category: 'placement', t_ms: 1800, note: 'Mara slides at the turn' }], human_confirmed: true, by: 'Manny' });
    assert.deepEqual(mr.carried_deviations.map(d => d.check), ['door'], 'the approved deviation travels into motion review');
    assert.equal(mr.findings[0].category, 'placement');
});

test('copying a shot keeps provenance and makes a distinct, editable identity', async () => {
    const s = await staged();
    const pkg = await approvedPackage(s); rp.pinPackage(db, s.shot, pkg.id);
    const before = db.prepare('SELECT camera_json FROM film_previs_blocking WHERE shot_id = ?').get(s.shot).camera_json;
    const copy = rp.copyShot(db, s.shot);
    assert.notEqual(copy.id, s.shot); assert.notEqual(copy.shot_code, '1A');
    assert.equal(copy.copied_from_shot_id, s.shot);
    const blk = db.prepare('SELECT * FROM film_previs_blocking WHERE shot_id = ?').get(copy.id);
    assert.equal(blk.camera_json, before); assert.equal(blk.world_version_id, s.version.id);
    assert.equal(blk.pinned_package_id, null, 'a copy starts with no package of its own'); assert.equal(blk.approved_fingerprint, null);
    await call('PUT', `/film/shots/${copy.id}/previs`, { camera: { ...CAMERA, focalMm: 50 }, durationMs: 4000 });
    assert.equal(db.prepare('SELECT camera_json FROM film_previs_blocking WHERE shot_id = ?').get(s.shot).camera_json, before, 'the original is untouched');
    assert.equal(db.prepare('SELECT copied_from_shot_id FROM film_shots WHERE id = ?').get(copy.id).copied_from_shot_id, s.shot);
});

test('with real Blender: one scene, camera and frame render beauty plus depth, normal and object-mask passes', { skip: !require('../lib/set-build').resolveBlender().available }, async () => {
    const s = await staged();
    const pkg = await rp.createPackage(db, s.shot, { intent: INTENT, passes: ['beauty', 'depth', 'normal', 'object_mask'] });
    const kinds = Object.fromEntries(pkg.passes.map(p => [p.kind, p]));
    assert.equal(fs.readFileSync(kinds.beauty.path).subarray(1, 4).toString(), 'PNG');
    for (const k of ['depth', 'normal', 'object_mask']) assert.equal(fs.readFileSync(kinds[k].path).readUInt32LE(0), 20000630, `${k} is OpenEXR`);
    assert.equal(pkg.renderer, 'cycles-cpu');
});

test('over HTTP and MCP: an agent builds, compares and copies; approving, pinning and deciding are a person\'s', async () => {
    const s = await staged();
    const tools = require('../lib/mcp-tools');
    for (const name of ['reference_package_list', 'reference_package_negotiate', 'board_compare', 'shot_copy']) assert.ok(tools.hasTool(name), name);
    const pkg = await rp.createPackage(db, s.shot, { intent: INTENT, passes: ['beauty'] }, { renderPasses: fakePasses(['beauty']) });
    const { handlePrevis } = require('../routes/previs');
    const viaAgent = await tools.callRoute('POST', `/film/shots/${s.shot}/previs/packages/${pkg.id}/approve`, { approval_fingerprint: pkg.package_fingerprint, human_confirmed: true, approved_by: 'agent' }, handlePrevis);
    assert.equal(viaAgent._status, 403);
    assert.equal(rp.getPackage(db, pkg.id).approved, false);
    const listed = tools.presentResult(await tools.callTool('reference_package_list', { shot_id: s.shot }));
    assert.equal(listed.packages[0].id, pkg.id);
    const copy = await call('POST', `/film/shots/${s.shot}/previs/copy`, {});
    assert.equal(copy.status, 201); assert.equal(copy.data.copied_from_shot_id, s.shot);
});
