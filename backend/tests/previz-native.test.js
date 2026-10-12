const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawnSync } = require('child_process');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-native-snapshot-test-'));
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const raster = require('../lib/png-raster');
const { createSnapshotService, nativePosition, nativeQuaternion } = require('../lib/previz-snapshot');
const { roomCameras } = require('../routes/previz-workspace');

test('real supported Blender import → approved CPU image → new storyboard version', { timeout: 180000 }, async () => {
    const blender = require('../lib/set-build').resolveBlender();
    assert.ok(blender.available, blender.reason);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-native-scene-'));
    const create = spawnSync(blender.bin, ['-b', '--factory-startup', '--disable-autoexec', '--python', path.join(__dirname, 'fixtures/previz-native.py'), '--', root], { timeout: 90000, encoding: 'utf8' });
    assert.ok(fs.existsSync(path.join(root, 'fixture.blend')), create.stderr + create.stdout);
    const originalHash = sha(fs.readFileSync(path.join(root, 'fixture.blend')));
    const project = generateId(), scene = generateId(), shot = generateId(), world = generateId();
    db.prepare('INSERT INTO film_projects(id,title,assets_dir) VALUES(?,?,?)').run(project, 'Disposable native fixture', root);
    db.prepare('INSERT INTO film_scenes(id,project_id,scene_number,location) VALUES(?,?,1,?)').run(scene, project, 'Fixture');
    db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,?)').run(shot, scene, '1A', JSON.stringify({ action: 'Look at the cube.' }));
    db.prepare('INSERT INTO film_worlds(id,project_id,name) VALUES(?,?,?)').run(world, project, 'Disposable native set');
    const v = await require('../lib/world-previz').importBlend(db, world, { file_path: 'fixture.blend' });
    const service = createSnapshotService(db,{runBlender:async(...args)=>{const r=await require('../lib/set-build').runBlender(...args);if(process.env.PREVIZ_EVIDENCE_DIR){fs.mkdirSync(process.env.PREVIZ_EVIDENCE_DIR,{recursive:true});fs.copyFileSync(r.image,path.join(process.env.PREVIZ_EVIDENCE_DIR,'raw-native-render.png'));}return r;}}), source = service.worldSource(v.id);
    assert.ok(source.linked_assets.some(a => a.path === '//textures/floor.png' && a.evidence && a.sha256 === a.evidence.sha256));
    const rooms = roomCameras(source.geometry.path);
    assert.equal(rooms.length, 1);
    const width = 128, height = 72, fov = 38, near = .02, far = 1000, aspect = width / height;
    const f = 1 / Math.tan(fov * Math.PI / 360);
    const projection = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, -(far + near) / (far - near), -1, 0, 0, -2 * far * near / (far - near), 0];
    const preview = raster.encode({ width, height, pixels: Buffer.alloc(width * height * 4, 255) });
    const prop=require('../lib/previs-library').get('chair');
    const subjects=[{kind:'mesh',name:'Real chair',model:{library:'chair',loaded_sha256:sha(fs.readFileSync(prop.file))},position:[1,0,0],rotationDeg:[0,25,0],sizeM:[.4,.94,.4]}];
    const lighting=require('../routes/previz-workspace').workspaceLighting({settings:{type:'natural',technique:'three-point'},camera:[0,2,4],subject:[1,0,0]});
    const lights={mode:'rig',rig:lighting.rig,mood:lighting.mood};
    const captured = await service.prepare({
        project_id: project, shot_id: shot, world_version_id: v.id, world_sha256: source.geometry.sha256,
        world_scale_factor: 1,
        preview: 'data:image/png;base64,' + preview.toString('base64'),
        camera: { position: [0, 2, 4], quaternion: [0, 0, 0, 1], verticalFovDegrees: fov, aspectRatio: aspect, near, far, lens_mm: 35, sensor_width_mm: 24.89, projectionMatrix: projection },
        frame: { width, height, playhead_ms: 0 }, subjects, lights, timeline: { keys: [], moves: [] }, framing: { size: 'WS' }, room: 'Fixture',
    });
    const approve = r => service.approve(r.review.id, { fingerprint: r.review.fingerprint, human_confirmed: true });
    const draft = service.saveDraft(approve(captured));
    const review = await service.prepareRender(draft.snapshot_id);
    assert.deepEqual(review.blockers, []);
    const rendered = await service.render(approve(review));
    assert.equal(rendered.version, draft.version + 1);
    const image = fs.readFileSync(rendered.file_path), decoded = raster.decode(image);
    assert.equal(decoded.width, width); assert.equal(decoded.height, height);
    assert.notEqual(sha(image), sha(preview));
    const values = new Set(decoded.pixels); assert.ok(values.size > 20, 'real rendered pixels vary');
    const asset = db.prepare('SELECT * FROM film_assets WHERE id=?').get(rendered.asset_id), meta = JSON.parse(asset.metadata);
    assert.equal(meta.receipt.renderer, 'cycles-cpu');
    assert.ok(meta.receipt.projection_max_abs_error < 1e-5);
    assert.deepEqual(meta.previz_snapshot.camera, captured.snapshot.camera);
    assert.deepEqual(meta.previz_snapshot.subjects,captured.snapshot.subjects);
    assert.deepEqual(meta.previz_snapshot.lights,captured.snapshot.lights);
    assert.deepEqual(meta.previz_snapshot.framing,captured.snapshot.framing);
    assert.deepEqual(meta.receipt.native_position, nativePosition(captured.snapshot.camera.position));
    const q = nativeQuaternion(captured.snapshot.camera.quaternion), actual = meta.receipt.native_quaternion_wxyz;
    [q[3], q[0], q[1], q[2]].forEach((x, i) => assert.ok(Math.abs(x - actual[i]) < 1e-6));
    assert.equal(sha(fs.readFileSync(path.join(root, 'fixture.blend'))), originalHash);
    assert.equal(sha(fs.readFileSync(draft.file_path)), sha(preview));
    if (process.env.PREVIZ_EVIDENCE_DIR) {
        fs.mkdirSync(process.env.PREVIZ_EVIDENCE_DIR, { recursive: true });
        fs.copyFileSync(rendered.file_path, path.join(process.env.PREVIZ_EVIDENCE_DIR, 'real-native-render.png'));
        fs.writeFileSync(path.join(process.env.PREVIZ_EVIDENCE_DIR, 'native-render-receipt.json'), JSON.stringify(meta, null, 2));
    }
});
