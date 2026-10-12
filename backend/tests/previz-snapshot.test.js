const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('fs'),
  os = require('os'),
  path = require('path'),
  crypto = require('crypto');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-snapshot-test-'));
const {
  db,
  generateId
} = require('../db/database');
require('../db/schema').ensureSchema();
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const api = require('../lib/previz-snapshot');
// Pure snapshot tests must never probe or launch the installed Blender.
function createService(database, deps = {}) {
  return api.createSnapshotService(database, {
    resolveBlender: available,
    runBlender: () => { throw new Error('Snapshot test requires an explicit render mock'); },
    ...deps
  });
}
const png = require('../lib/png-raster').encode({
  width: 16,
  height: 9,
  pixels: Buffer.alloc(16 * 9 * 4, 255)
});
function fixture() {
  const project = generateId(),
    scene = generateId(),
    shot = generateId(),
    world = generateId(),
    version = generateId(),
    asset = generateId(),
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-snapshot-project-'));
  db.prepare('INSERT INTO film_projects(id,title,assets_dir) VALUES(?,?,?)').run(project, 'Disposable', root);
  db.prepare('INSERT INTO film_scenes(id,project_id,scene_number,location) VALUES(?,?,1,?)').run(scene, project, 'Fixture');
  db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,?)').run(shot, scene, '1A', JSON.stringify({
    description: 'Canonical guidance'
  }));
  db.prepare('INSERT INTO film_worlds(id,project_id,name) VALUES(?,?,?)').run(world, project, 'Fixture set');
  const file = path.join(root, 'set.glb');
  fs.writeFileSync(file, 'glTFfixture');
  db.prepare("INSERT INTO film_assets(id,project_id,asset_type,file_path,file_name) VALUES(?,?,'other',?,?)").run(asset, project, file, 'set.glb');
  db.prepare('INSERT INTO film_world_versions(id,world_id,version,scale_factor) VALUES(?,?,1,1)').run(version, world);
  db.prepare("INSERT INTO film_world_assets(id,world_version_id,asset_id,kind) VALUES(?,?,?,'collider')").run(generateId(), version, asset);
  return {
    project,
    scene,
    shot,
    world,
    version,
    asset,
    root,
    file
  };
}
function capture(f) {
  return {
    project_id: f.project,
    shot_id: f.shot,
    world_version_id: f.version,
    world_sha256: sha(fs.readFileSync(f.file)),
    world_scale_factor: 1,
    preview: 'data:image/png;base64,' + png.toString('base64'),
    camera: {
      position: [1, 1.7, 4],
      quaternion: [0, 0, 0, 1],
      verticalFovDegrees: 38,
      aspectRatio: 16 / 9,
      near: .02,
      far: 1000,
      lens_mm: 35,
      sensor_width_mm: 36,
      sensorFit: 'HORIZONTAL',
      projectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -.04, 0]
    },
    frame: {
      width: 16,
      height: 9,
      playhead_ms: 0
    },
    subjects: [],
    lights: {
      mode: 'native',
      rig: [],
      mood: null
    },
    timeline: {
      keys: [],
      moves: [],
      range: null
    },
    framing: {
      size: 'WS',
      angle: 'eye'
    },
    room: 'Fixture'
  };
}
test('draft review creates no board until approved, imports a new immutable version with complete snapshot', async () => {
  const f = fixture(),
    s = createService(db),
    r = await s.prepare(capture(f));
  assert.equal(db.prepare('SELECT count(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n, 0);
  assert.throws(() => s.saveDraft({
    id: r.review.id,
    fingerprint: r.review.fingerprint
  }), /required/);
  const token = s.approve(r.review.id, {
    human_confirmed: true,
    fingerprint: r.review.fingerprint
  });
  const saved = s.saveDraft(token);
  assert.equal(saved.version, 1);
  assert.equal(s.saveDraft(token).asset_id, saved.asset_id);
  const row = db.prepare('SELECT * FROM film_assets WHERE id=?').get(saved.asset_id),
    meta = JSON.parse(row.metadata);
  assert.deepEqual(meta.previz_snapshot.camera, capture(f).camera);
  assert.deepEqual(meta.previz_snapshot.timeline, capture(f).timeline);
  assert.equal(sha(fs.readFileSync(row.file_path)), sha(png));
  const second = await s.prepare({
    ...capture(f),
    camera: {
      ...capture(f).camera,
      lens_mm: 50
    }
  });
  const next = s.saveDraft(s.approve(second.review.id, {
    human_confirmed: true,
    fingerprint: second.review.fingerprint
  }));
  assert.equal(next.version, 2);
  assert.equal(sha(fs.readFileSync(row.file_path)), sha(png));
  assert.equal(db.prepare('SELECT current_frame_version v FROM film_shots WHERE id=?').get(f.shot).v, 2);
});
test('no target, stale source, wrong project, tampered token and cancel refuse attachment', async () => {
  const f = fixture(),
    s = createService(db);
  await assert.rejects(s.prepare({
    ...capture(f),
    shot_id: null
  }), /target/i);
  await assert.rejects(s.prepare({
    ...capture(f),
    project_id: generateId()
  }), /project/i);
  const r = await s.prepare(capture(f));
  s.cancel(r.review.id);
  assert.throws(() => s.approve(r.review.id, {
    human_confirmed: true,
    fingerprint: r.review.fingerprint
  }), /fresh/);
  const r2 = await s.prepare(capture(f));
  const t = s.approve(r2.review.id, {
    human_confirmed: true,
    fingerprint: r2.review.fingerprint
  });
  fs.writeFileSync(f.file, 'glTFchanged');
  assert.throws(() => s.saveDraft(t), /changed|source/i);
  assert.equal(db.prepare('SELECT count(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n, 0);
});
test('native missing and proxy actors are explicit render blockers, never fallback successes', async () => {
  const f = fixture(),
    s = createService(db),
    r = await s.prepare({
      ...capture(f),
      subjects: [{
        kind: 'human',
        name: 'Stand-in',
        position: [0, 0, 0],
        sizeM: [1, 1.8, 1],
        rotationDeg: [0, 0, 0],
        model: {
          library: 'man'
        }
      }]
    });
  const d = s.saveDraft(s.approve(r.review.id, {
    human_confirmed: true,
    fingerprint: r.review.fingerprint
  }));
  const review = await s.prepareRender(d.snapshot_id);
  assert.ok(review.blockers.some(b => /native|blend/i.test(b)));
  assert.ok(review.blockers.some(b => /actor|stand-in/i.test(b)));
  assert.equal(review.review, null);
});
function approve(s, r) {
  return s.approve(r.review.id, {
    human_confirmed: true,
    fingerprint: r.review.fingerprint
  });
}
function nativeFixture(f) {
  const file = path.join(f.root, 'source.blend');
  fs.writeFileSync(file, 'native fixture');
  db.prepare('UPDATE film_world_versions SET editable_source_json=? WHERE id=?').run(JSON.stringify({
    blend: {
      path: file,
      sha256: sha(fs.readFileSync(file)),
      bytes: 14
    },
    linked_assets: []
  }), f.version);
  return file;
}
const available = () => ({
  available: true,
  path: '/fixture/blender'
});
const fakeOutput = async job => {
  const image = path.join(job.out_dir, 'snapshot.png');
  fs.writeFileSync(image, png);
  return {
    image,
    renderer: 'cycles-cpu',
    snapshot_hash: job.snapshot_hash
  };
};
test('ordinary imports and version activation retain every original image', async () => {
  const f = fixture(),
    imports = require('../lib/media-imports'),
    first = imports.importMedia('storyboard-image', {
      shotId: f.shot,
      bytes: png,
      mime: 'image/png'
    }),
    s = createService(db),
    altered = require('../lib/png-raster').encode({
      width: 16,
      height: 9,
      pixels: Buffer.alloc(16 * 9 * 4, 100)
    });
  const r = await s.prepare({
    ...capture(f),
    preview: 'data:image/png;base64,' + altered.toString('base64')
  });
  const saved = s.saveDraft(approve(s, r));
  const live = path.join(path.dirname(saved.file_path), '1A.png');
  assert.equal(sha(fs.readFileSync(live)), sha(altered));
  const kept = db.prepare('SELECT * FROM film_assets WHERE id=?').get(first.asset_id);
  assert.equal(sha(fs.readFileSync(kept.file_path)), sha(png));
  const imported = imports.importMedia('storyboard-image', {
    shotId: f.shot,
    bytes: png,
    mime: 'image/png'
  });
  assert.equal(imported.version, 3);
  assert.equal(sha(fs.readFileSync(saved.file_path)), sha(altered));
});
test('native source cannot silently rebase at capture and immutable snapshot fields reject edits', async () => {
  const f = fixture(),
    native = nativeFixture(f),
    s = createService(db);
  const r = await s.prepare(capture(f));
  assert.throws(() => db.prepare('UPDATE film_previz_snapshots SET shot_id=? WHERE id=?').run(generateId(), r.snapshot_id), /immutable/);
  fs.writeFileSync(native, 'changed native');
  await assert.rejects(s.prepare(capture(f)), /Native source changed/);
});
test('approved native result attaches only original target and repeated Send is idempotent', async () => {
  const f = fixture();
  nativeFixture(f);
  let count = 0;
  const s = createService(db, {
    resolveBlender: available,
    runBlender: async job => {
      count++;
      return fakeOutput(job);
    }
  });
  const r = await s.prepare(capture(f)),
    draft = s.saveDraft(approve(s, r)),
    render = await s.prepareRender(draft.snapshot_id),
    token = approve(s, render);
  const results = await Promise.all([s.render(token), s.render(token)]);
  assert.equal(count, 1);
  assert.equal(results[0].asset_id, results[1].asset_id);
  assert.equal(results[0].shot_id, f.shot);
  assert.equal(results[0].version, 2);
  assert.equal((await s.render(token)).asset_id, results[0].asset_id);
});
test('cancelled request and different reviews cannot cross-attach on a shared snapshot', async () => {
  const f = fixture();
  nativeFixture(f);
  const releases = [];
  const s = createService(db, {
    resolveBlender: available,
    runBlender: job => new Promise(resolve => releases.push(() => fakeOutput(job).then(resolve)))
  });
  const r = await s.prepare(capture(f)),
    draft = s.saveDraft(approve(s, r));
  const a = await s.prepareRender(draft.snapshot_id),
    b = await s.prepareRender(draft.snapshot_id),
    ta = approve(s, a),
    tb = approve(s, b);
  const pa = s.render(ta);
  await assert.rejects(s.render(tb), /already rendering/);
  s.cancel(a.review.id);
  const pb = s.render(tb);
  const rejected = assert.rejects(pa, /cancel/i);
  releases[0]();
  await rejected;
  releases[1]();
  const result = await pb;
  assert.equal(result.version, 2);
  await assert.rejects(s.render(ta), /already sent/);
  assert.equal(db.prepare("SELECT count(*) n FROM film_assets WHERE shot_id=? AND json_extract(metadata,'$.kind')='previz_blender'").get(f.shot).n, 1);
});
test('worker failure, stale target brief and wrong result hash never attach an image', async () => {
  for (const kind of ['failure', 'stale', 'hash']) {
    const f = fixture();
    nativeFixture(f);
    const s = createService(db, {
      resolveBlender: available,
      runBlender: async job => {
        if (kind === 'failure') throw Error('Native fixture failed');
        if (kind === 'stale') db.prepare('UPDATE film_shots SET scene_card_yaml=? WHERE id=?').run(JSON.stringify({
          action: 'Changed brief'
        }), f.shot);
        const r = await fakeOutput(job);
        return kind === 'hash' ? {
          ...r,
          snapshot_hash: 'wrong'
        } : r;
      }
    });
    const r = await s.prepare(capture(f)),
      d = s.saveDraft(approve(s, r)),
      rr = await s.prepareRender(d.snapshot_id);
    await assert.rejects(s.render(approve(s, rr)), /failed|brief changed|exact approved/);
    assert.equal(db.prepare('SELECT count(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n, 1);
  }
});
test('lossless large native storage adaptation preserves scene identifiers and every buffer-view byte', () => {
  const fs = require('fs'),
    normal = require('../lib/glb-storage');
  const binary = Buffer.from([1, 2, 3, 4, 1, 2, 3, 4]);
  const g = {
    asset: {
      version: '2.0'
    },
    buffers: [{
      byteLength: 8
    }],
    bufferViews: [{
      buffer: 0,
      byteOffset: 0,
      byteLength: 4
    }, {
      buffer: 0,
      byteOffset: 4,
      byteLength: 4
    }],
    nodes: [{
      name: 'Preserved',
      extras: {
        physical: true
      }
    }]
  };
  let j = Buffer.from(JSON.stringify(g));
  if (j.length % 4) j = Buffer.concat([j, Buffer.alloc(4 - j.length % 4, 32)]);
  const h = Buffer.alloc(12),
    jc = Buffer.alloc(8),
    bc = Buffer.alloc(8);
  h.write('glTF');
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(28 + j.length + binary.length, 8);
  jc.writeUInt32LE(j.length);
  jc.writeUInt32LE(0x4e4f534a, 4);
  bc.writeUInt32LE(binary.length);
  bc.writeUInt32LE(0x004e4942, 4);
  const input = Buffer.concat([h, jc, j, bc, binary]),
    r = normal.deduplicateBuffers(input),
    n = r.bytes.readUInt32LE(12),
    out = JSON.parse(r.bytes.toString('utf8', 20, 20 + n).trim()),
    bin = r.bytes.subarray(28 + n);
  assert.deepEqual(out.nodes, g.nodes);
  for (let i = 0; i < g.bufferViews.length; i++) assert.deepEqual(bin.subarray(out.bufferViews[i].byteOffset, out.bufferViews[i].byteOffset + 4), binary.subarray(g.bufferViews[i].byteOffset, g.bufferViews[i].byteOffset + 4));
  assert.equal(out.buffers[0].byteLength, 4);
  assert.equal(r.evidence.original_sha256, sha(input));
});
test('authoritative people category blocks a mislabelled proxy and linked libraries fail explicitly', async () => {
  const f = fixture();
  nativeFixture(f);
  const s = createService(db, {
    resolveBlender: available
  });
  const r = await s.prepare({
    ...capture(f),
    subjects: [{
      kind: 'mesh',
      name: 'Mislabelled person',
      position: [0, 0, 0],
      sizeM: [1, 1.8, 1],
      model: {
        library: 'man'
      }
    }]
  });
  assert.equal(r.snapshot.subjects[0].proxy, true);
  const d = s.saveDraft(approve(s, r)),
    review = await s.prepareRender(d.snapshot_id);
  assert.ok(review.blockers.some(x => /stand-in/.test(x)));
  const library = path.join(f.root, 'linked.blend');
  fs.writeFileSync(library, 'native library');
  const native = JSON.parse(db.prepare('SELECT editable_source_json FROM film_world_versions WHERE id=?').get(f.version).editable_source_json);
  native.linked_assets = [{
    kind: 'library',
    path: '//linked.blend',
    resolved_path: library,
    sha256: sha(fs.readFileSync(library)),
    exists: true
  }];
  db.prepare('UPDATE film_world_versions SET editable_source_json=? WHERE id=?').run(JSON.stringify(native), f.version);
  const r2 = await s.prepare(capture(f)),
    d2 = s.saveDraft(approve(s, r2)),
    review2 = await s.prepareRender(d2.snapshot_id);
  assert.ok(review2.blockers.some(x => /verified native reload/.test(x)));
  assert.equal(review2.review, null);
});
test('every supported lighting mood passes a real local route result through the snapshot validator', async () => {
  const f = fixture(),
    s = createService(db),
    {
      workspaceLighting
    } = require('../routes/previz-workspace');
  for (const type of Object.keys(require('../lib/lighting').MOODS)) {
    const lit = workspaceLighting({
      settings: {
        type,
        technique: 'three-point'
      },
      camera: [0, 1.68, 4],
      subject: [0, 0, 0]
    });
    assert.match(lit.mood.colour, /^#[0-9a-f]{6}$/i);
    const r = await s.prepare({
      ...capture(f),
      lights: {
        mode: 'rig',
        rig: lit.rig,
        mood: lit.mood
      }
    });
    assert.equal(r.snapshot.lights.mood.colour, lit.mood.colour);
  }
});
test('a cached staged model cannot adopt regenerated bytes or unrecorded external textures', async () => {
  const f = fixture(),
    s = createService(db),
    id = generateId(),
    file = path.join(f.root, 'prop.glb'),
    source = require('../lib/previs-library').get('chair').file;
  fs.copyFileSync(source, file);
  db.prepare("INSERT INTO film_assets(id,project_id,asset_type,file_path,file_name,metadata) VALUES(?,?,'other',?,?,?)").run(id, f.project, file, 'prop.glb', JSON.stringify({
    kind: 'model_3d'
  }));
  const subject = {
    kind: 'mesh',
    name: 'Chair',
    model: {
      asset_id: id,
      loaded_sha256: sha(fs.readFileSync(file))
    },
    position: [0, 0, 0],
    sizeM: [.4, .94, .4]
  };
  const r = await s.prepare({
    ...capture(f),
    subjects: [subject]
  });
  assert.equal(r.snapshot.subjects[0].asset.sha256, subject.model.loaded_sha256);
  fs.copyFileSync(require('../lib/previs-library').get('table').file, file);
  await assert.rejects(s.prepare({
    ...capture(f),
    subjects: [subject]
  }), /changed since the preview/);
  await assert.rejects(s.prepare({
    ...capture(f),
    subjects: [{
      ...subject,
      model: {
        asset_id: id
      }
    }]
  }), /verified preview hash/);
  const b = fs.readFileSync(source),
    n = b.readUInt32LE(12),
    g = JSON.parse(b.toString('utf8', 20, 20 + n).trim());
  g.images = [{
    uri: 'missing.png'
  }];
  let j = Buffer.from(JSON.stringify(g));
  if (j.length % 4) j = Buffer.concat([j, Buffer.alloc(4 - j.length % 4, 32)]);
  const head = Buffer.from(b.subarray(0, 12)),
    jc = Buffer.alloc(8),
    bin = b.subarray(20 + n);
  head.writeUInt32LE(20 + j.length + bin.length, 8);
  jc.writeUInt32LE(j.length);
  jc.writeUInt32LE(0x4e4f534a, 4);
  fs.writeFileSync(file, Buffer.concat([head, jc, j, bin]));
  subject.model.loaded_sha256 = sha(fs.readFileSync(file));
  await assert.rejects(s.prepare({
    ...capture(f),
    subjects: [subject]
  }), /external resources/);
});

test('same-version calibration changes before capture fail without creating a snapshot or draft', async () => {
  const f=fixture(), service=createService(db), worlds=require('../lib/worlds');
  worlds.calibrateVersion(db,f.version,{source:'custom',knownMeters:2,measuredUnits:1});
  const loaded={...capture(f),world_scale_factor:2};
  const shaBefore=loaded.world_sha256;
  worlds.calibrateVersion(db,f.version,{source:'custom',knownMeters:1,measuredUnits:1});
  assert.equal(service.worldSource(f.version).geometry.sha256,shaBefore);
  await assert.rejects(service.prepare(loaded),/calibration changed/);
  await assert.rejects(service.prepare({...capture(f),world_scale_factor:undefined}),/calibration changed/);
  assert.equal(db.prepare('SELECT count(*) n FROM film_previz_snapshots WHERE shot_id=?').get(f.shot).n,0);
  const fresh=await service.prepare(capture(f));
  assert.equal(fresh.snapshot.world.scale_factor,1);
  worlds.calibrateVersion(db,f.version,{source:'custom',knownMeters:2,measuredUnits:1});
  assert.throws(()=>service.approve(fresh.review.id,{fingerprint:fresh.review.fingerprint,human_confirmed:true}),/source changed/);
});
test('storyboard locking blocks capture, later approval and late render attachment', async () => {
  const f=fixture(); let release;
  db.prepare('UPDATE film_world_versions SET editable_source_json=? WHERE id=?').run(JSON.stringify({blend:{path:f.file,sha256:sha(fs.readFileSync(f.file))}}),f.version);
  const service=createService(db,{runBlender:job=>new Promise(resolve=>release=async()=>resolve(await fakeOutput(job)))});
  const r=await service.prepare(capture(f));
  db.prepare("UPDATE film_projects SET board_locked_at=datetime('now') WHERE id=?").run(f.project);
  await assert.rejects(service.prepare(capture(f)),/Unlock the storyboard/);
  assert.throws(()=>service.approve(r.review.id,{fingerprint:r.review.fingerprint,human_confirmed:true}),/Unlock the storyboard/);
  db.prepare('UPDATE film_projects SET board_locked_at=NULL WHERE id=?').run(f.project);
  const draft=service.saveDraft(service.approve(r.review.id,{fingerprint:r.review.fingerprint,human_confirmed:true}));
  const reviewed=await service.prepareRender(draft.snapshot_id);assert.deepEqual(reviewed.blockers,[]);
  const rendering=service.render(service.approve(reviewed.review.id,{fingerprint:reviewed.review.fingerprint,human_confirmed:true}));
  await Promise.resolve();
  db.prepare("UPDATE film_projects SET board_locked_at=datetime('now') WHERE id=?").run(f.project);
  const denied=assert.rejects(rendering,/Unlock the storyboard/);
  await release();await denied;
  assert.equal(db.prepare("SELECT count(*) n FROM film_assets WHERE shot_id=? AND asset_type='storyboard'").get(f.shot).n,1);
});

function browserDescriptor(f) {
  return {algorithm:'previz-static-spatial-v1',rendererRevision:String(require('../../public/legacy/vendor/three.min.js').REVISION),
    sourceSha256:sha(fs.readFileSync(f.file)),worldVersionId:f.version,cellSize:32,
    coordinateSpace:'unchanged source scene',geometryPolicy:'All triangles and vertex attributes retained. Static opaque objects only. Native source unchanged.',
    sourceMeshes:20,batchedMeshes:18,batches:2,drawMeshes:4,triangles:120,bounds:{min:[0,0,0],max:[4,3,4]},
    sourceMappingSha256:'a'.repeat(64),derivedSha256:'b'.repeat(64),sourceMappingCount:18,fullManifestBytes:4096};
}
test('small browser representation provenance survives restart, frozen approval and draft storage without changing render inputs', async () => {
  const f=fixture(), service=createService(db), descriptor=browserDescriptor(f), body={...capture(f),browser_representation:descriptor};
  const prepared=await service.prepare(body);
  assert.deepEqual(prepared.snapshot.browser_representation,descriptor);
  assert.equal(prepared.snapshot.world.geometry.sha256,body.world_sha256);
  assert.deepEqual(prepared.snapshot.camera,body.camera);
  assert.equal(service.review(prepared.review.id).snapshot.body.browser_representation,undefined);
  const restarted=createService(db);
  assert.deepEqual(restarted.get(prepared.snapshot_id).snapshot.browser_representation,descriptor);
  const saved=restarted.saveDraft(approve(restarted,prepared));
  const asset=db.prepare('SELECT * FROM film_assets WHERE id=?').get(saved.asset_id);
  assert.deepEqual(JSON.parse(asset.metadata).previz_snapshot.browser_representation,descriptor);
  assert.equal(sha(fs.readFileSync(asset.file_path)),sha(png));
  const row=db.prepare('SELECT * FROM film_previz_snapshots WHERE id=?').get(prepared.snapshot_id);
  const tampered=JSON.parse(row.snapshot_json); tampered.browser_representation.derivedSha256='c'.repeat(64);
  assert.throws(()=>db.prepare('UPDATE film_previz_snapshots SET snapshot_json=? WHERE id=?').run(JSON.stringify(tampered),prepared.snapshot_id), /immutable|constraint/i);
  assert.deepEqual(restarted.get(prepared.snapshot_id).snapshot.browser_representation,descriptor);
});
test('browser representation rejects stale identity, unknown fields, unbounded mappings and inconsistent counts before persistence', async () => {
  const f=fixture(), service=createService(db), descriptor=browserDescriptor(f), original=db.prepare('SELECT count(*) n FROM film_previz_snapshots').get().n;
  const invalid=[{worldVersionId:'other'},{sourceSha256:'f'.repeat(64)},{algorithm:'unknown'},{rendererRevision:'unknown'},
    {sourceMappingCount:17},{drawMeshes:5},{batches:19},{sourceMeshes:100001},{triangles:1.5},{fullManifestBytes:67108865},
    {cellSize:16},{derivedSha256:'short'},{bounds:{min:[5,0,0],max:[4,3,4]}},{sources:[]},{geometryPolicy:'x'.repeat(5000)}];
  for(const changed of invalid) await assert.rejects(service.prepare({...capture(f),browser_representation:{...descriptor,...changed}}),/representation|source bounds/);
  assert.equal(db.prepare('SELECT count(*) n FROM film_previz_snapshots').get().n,original);
  const valid=await service.prepare({...capture(f),browser_representation:descriptor});
  fs.writeFileSync(f.file,'source changed after capture');
  assert.throws(()=>approve(service,valid),/source changed/);
});
