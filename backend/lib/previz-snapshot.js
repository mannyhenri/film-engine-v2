/** Location-first captures use the existing durable approval store and storyboard importer.
 * No caller-selected scripts, output paths, external service or generated stand-in actors. */
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  crypto = require('crypto');
const {
  canonical,
  hash,
  createFinalRequestStore
} = require('./final-request-review');
const sha = b => hash(b),
  parse = (s, f = null) => {
    try {
      return JSON.parse(s);
    } catch {
      return f;
    }
  };
function fail(message, status = 409) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function vector(v, n, name) {
  if (!Array.isArray(v) || v.length !== n || v.some(x => typeof x !== 'number' || !Number.isFinite(x))) fail(name + ' needs ' + n + ' finite numbers', 400);
  return v.slice();
}
function number(v, min, max, name) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(name + ' is outside its supported range', 400);
  return v;
}
function fileEvidence(file) {
  if (!file || !fs.existsSync(file)) return null;
  return {
    path: fs.realpathSync(file),
    sha256: sha(fs.readFileSync(file))
  };
}
function worldSource(db, id) {
  const v = db.prepare('SELECT v.*,w.project_id,w.location_id,w.name world_name FROM film_world_versions v JOIN film_worlds w ON w.id=v.world_id WHERE v.id=? AND w.archived_at IS NULL').get(id);
  if (!v) fail('Set version is missing or archived', 404);
  const asset = db.prepare("SELECT a.*,wa.metadata_json import_metadata FROM film_world_assets wa JOIN film_assets a ON a.id=wa.asset_id WHERE wa.world_version_id=? AND wa.kind='collider'").get(id);
  const glb = fileEvidence(asset?.file_path);
  if (!glb) fail('This set has no readable 3D geometry');
  const source = parse(v.editable_source_json);
  if (source?.blend && fileEvidence(source.blend.path)?.sha256 !== source.blend.sha256) fail('Native source changed since import. Reimport the matched set');
  return {
    version: v,
    geometry: {
      asset_id: asset.id,
      ...glb,
      import_evidence: parse(asset.import_metadata, {})?.import_evidence || null
    },
    native: source?.blend ? {
      ...source.blend
    } : null,
    linked_assets: (source?.linked_assets || []).map(a => ({
      ...a,
      evidence: a.packed ? null : fileEvidence(a.resolved_path || path.resolve(path.dirname(source.blend.path), a.path.replace(/^\/\//, '')))
    })),
    report: parse(v.import_report_json, {}) || {}
  };
}
function shotRow(db, id) {
  const row = db.prepare('SELECT sh.*,sc.project_id,sc.location,sc.status scene_status,p.board_locked_at FROM film_shots sh JOIN film_scenes sc ON sc.id=sh.scene_id JOIN film_projects p ON p.id=sc.project_id WHERE sh.id=?').get(id);
  if (!row || row.scene_status === 'removed') fail('Choose an existing target shot', 404);
  if (row.board_locked_at) fail('Unlock the storyboard before saving a Previz image version', 423);
  return row;
}
function publicShot(s) {
  return {
    id: s.id,
    project_id: s.project_id,
    scene_id: s.scene_id,
    shot_code: s.shot_code,
    description: parse(s.scene_card_yaml, {})?.action || parse(s.scene_card_yaml, {})?.description || '',
    scene_card_yaml: s.scene_card_yaml || '',
    location: s.location || ''
  };
}
function nativePosition(p) {
  return [p[0], -p[2], p[1]];
}
function nativeQuaternion(q) {
  const [x, y, z, w] = q,
    k = Math.SQRT1_2;
  return [(w + x) * k, (y - z) * k, (y + z) * k, (w - x) * k];
}
function validateLights(lights) {
  if (!['native', 'rig'].includes(lights.mode)) fail('Unsupported lighting mode', 400);
  if (lights.mode === 'native') return {
    ...lights,
    rig: [],
    mood: null
  };
  if (!Array.isArray(lights.rig) || lights.rig.length > 30) fail('Invalid lighting rig', 400);
  const colour = v => {
    if (!/^#[0-9a-f]{6}$/i.test(v || '')) fail('Invalid light colour', 400);
    return v;
  };
  const rig = lights.rig.map(l => ({
    ...l,
    position: vector(l.position, 3, 'light.position'),
    target: vector(l.target, 3, 'light.target'),
    colour: colour(l.colour),
    ratio: number(l.ratio ?? 1, 0, 100, 'light intensity'),
    soft: number(l.soft ?? 0, 0, 1, 'light softness')
  }));
  const mood = lights.mood ? {
    ...lights.mood,
    ambient: number(lights.mood.ambient, 0, 10, 'ambient intensity'),
    colour: colour(lights.mood.colour)
  } : null;
  return {
    ...lights,
    rig,
    mood,
    native_mapping: 'Directional rig uses native sun lights; browser hemisphere mood becomes diffuse world illumination. Native materials are rendered in Cycles CPU.'
  };
}

/** Small provenance commitment, not replacement source geometry or render input. */
function validateBrowserRepresentation(value, versionId, sourceSha256) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 4096) fail('Invalid browser representation descriptor', 400);
  const allowed = ['algorithm','rendererRevision','sourceSha256','worldVersionId','cellSize','coordinateSpace','geometryPolicy',
    'sourceMeshes','batchedMeshes','batches','drawMeshes','triangles','bounds','sourceMappingSha256','derivedSha256','sourceMappingCount','fullManifestBytes'];
  if (Object.keys(value).some(k => !allowed.includes(k))) fail('Unsupported browser representation field', 400);
  if (value.algorithm !== 'previz-static-spatial-v1' || value.rendererRevision !== String(require('../../public/legacy/vendor/three.min.js').REVISION)) fail('Unsupported browser representation algorithm or renderer', 400);
  if (value.worldVersionId !== versionId || value.sourceSha256 !== sourceSha256) fail('Browser representation belongs to another set source');
  for (const key of ['sourceMappingSha256','derivedSha256']) if (!/^[a-f0-9]{64}$/.test(value[key] || '')) fail('Invalid browser representation checksum', 400);
  if (value.coordinateSpace !== 'unchanged source scene' || value.geometryPolicy !== 'All triangles and vertex attributes retained. Static opaque objects only. Native source unchanged.') fail('Unsupported browser representation geometry policy', 400);
  const integer = (key, max) => {
    const n = number(value[key], 0, max, 'browser representation ' + key);
    if (!Number.isInteger(n)) fail('Browser representation counts must be integers', 400);
    return n;
  };
  for (const key of ['sourceMeshes','batchedMeshes','batches','drawMeshes','sourceMappingCount']) integer(key, 100000);
  integer('triangles', 100000000);
  const bytes = integer('fullManifestBytes', 64 * 1024 * 1024);
  if (!bytes || value.cellSize !== 32 || value.batches > value.batchedMeshes || value.batchedMeshes > value.sourceMeshes
    || value.sourceMappingCount !== value.batchedMeshes || value.drawMeshes !== value.sourceMeshes - value.batchedMeshes + value.batches) fail('Inconsistent browser representation counts or configuration', 400);
  const bounds = {min:vector(value.bounds?.min,3,'browser source bounds.min'),max:vector(value.bounds?.max,3,'browser source bounds.max')};
  if (bounds.min.some((x,i) => x > bounds.max[i])) fail('Invalid browser source bounds', 400);
  return {...value,bounds};
}
function createSnapshotService(db, deps = {}) {
  const running = new Map();
  function row(id) {
    const r = db.prepare('SELECT * FROM film_previz_snapshots WHERE id=?').get(id);
    if (!r) fail('Saved Previz snapshot not found', 404);
    if (sha(r.snapshot_json) !== r.snapshot_hash) fail('Saved snapshot was changed');
    return r;
  }
  function snapshot(id) {
    return parse(row(id).snapshot_json);
  }
  function sourceCurrent(s) {
    const current = worldSource(db, s.world.version_id);
    if (canonical(current.geometry) !== canonical(s.world.geometry) || canonical(current.native) !== canonical(s.world.native) || canonical(current.linked_assets) !== canonical(s.world.linked_assets) || current.version.scale_factor !== s.world.scale_factor) fail('Set source changed. Capture and review a fresh snapshot');
    const target = publicShot(shotRow(db, s.target.id));
    if (canonical(target) !== canonical(s.target)) fail('Target shot brief changed. Capture and review it again');
    for (const a of s.subjects) {
      if (a.asset && canonical(fileEvidence(a.asset.path)) !== canonical({
        path: a.asset.path,
        sha256: a.asset.sha256
      })) fail('A staged asset changed. Capture it again');
    }
  }
  function evidence(spec) {
    const s = snapshot(spec.snapshot_id);
    sourceCurrent(s);
    const r = row(spec.snapshot_id),
      preview = fileEvidence(r.preview_path);
    if (preview?.sha256 !== r.preview_sha256) fail('Captured preview changed');
    return {
      spec,
      digest: hash(canonical({
        snapshot_hash: r.snapshot_hash,
        target: s.target,
        world: s.world,
        preview: r.preview_sha256
      }))
    };
  }
  const reviews = createFinalRequestStore(db, {
    provenance: evidence,
    resolve: async (provider, capability, payload) => {
      if (!['previz-browser', 'blender'].includes(provider) || capability !== 'image') fail('Unsupported local render request', 400);
      const s = snapshot(payload.snapshot_id),
        r = row(payload.snapshot_id);
      return {
        provider,
        capability,
        endpoint: provider === 'blender' ? 'local:allowlisted-blender-previz' : 'local:storyboard-import',
        adapterVersion: 'previz-snapshot-v1',
        body: {
          snapshot_id: r.id,
          snapshot_hash: r.snapshot_hash,
          target: s.target,
          world: s.world,
          camera: s.camera,
          frame: s.frame,
          subjects: s.subjects,
          lights: s.lights,
          timeline: s.timeline,
          framing: s.framing,
          room: s.room,
          output: {
            format: 'PNG',
            renderer: provider === 'blender' ? 'Cycles CPU' : 'browser preview',
            samples: 32
          }
        },
        references: [{
          path: r.preview_path,
          role: 'approved captured frame',
          mime: 'image/png'
        }],
        quote: {
          kind: 'free_preflight',
          amount: 0,
          currency: 'USD',
          note: 'Local processing; no paid provider call.'
        }
      };
    }
  });
  function resolveSubject(s, project) {
    const out = {
      ...s,
      position: vector(s.position, 3, 'subject.position'),
      rotationDeg: vector(s.rotationDeg || [0, 0, 0], 3, 'subject.rotationDeg'),
      sizeM: vector(s.sizeM || [1, 1.8, 1], 3, 'subject.sizeM')
    };
    if (out.sizeM.some(n => n <= 0 || n > 100)) fail('Invalid subject size', 400);
    delete out.asset;
    delete out.proxy;
    const id = s.model?.asset_id;
    if (id) {
      const a = db.prepare("SELECT * FROM film_assets WHERE id=? AND project_id=? AND asset_type='other' AND json_valid(metadata) AND json_extract(metadata,'$.kind')='model_3d'").get(id, project);
      if (a) {
        const ev = fileEvidence(a.file_path);
        out.asset = ev ? {
          id: a.id,
          character_id: a.character_id || null,
          prop_id: a.prop_id || null,
          ...ev
        } : null;
      }
    } else if (s.model?.library) {
      const entry = require('./previs-library').get(s.model.library);
      if (entry) {
        out.proxy = entry.category === 'people';
        if (!out.proxy) {
          const ev = fileEvidence(entry.file);
          if (ev) out.asset = {
            library: s.model.library,
            ...ev
          };
        }
      }
    }
    if (out.asset) {
      if (!/^[a-f0-9]{64}$/i.test(s.model?.loaded_sha256 || '')) fail('The staged model has no verified preview hash', 400);
      if (out.asset.sha256 !== s.model.loaded_sha256) fail('Staged model changed since the preview. Reopen the set and capture it again');
      const bytes = fs.readFileSync(out.asset.path);
      if (bytes.toString('ascii', 0, 4) !== 'glTF') fail('Staged native rendering requires a self-contained GLB');
      const n = bytes.readUInt32LE(12),
        g = JSON.parse(bytes.toString('utf8', 20, 20 + n).trim());
      if ([...(g.buffers || []), ...(g.images || [])].some(x => x.uri && !x.uri.startsWith('data:'))) fail('Staged GLB has external resources without immutable native evidence');
    }
    return out;
  }
  async function prepare(body) {
    if (!body.shot_id) fail('Choose a real target shot before saving', 400);
    const target = shotRow(db, body.shot_id);
    if (target.project_id !== body.project_id) fail('Target belongs to another project', 400);
    const src = worldSource(db, body.world_version_id);
    if (src.version.project_id !== target.project_id) fail('Set belongs to another project', 400);
    if (body.world_sha256 !== src.geometry.sha256) fail('Set source changed since it loaded');
    if (!Number.isFinite(body.world_scale_factor) || body.world_scale_factor <= 0 || body.world_scale_factor !== src.version.scale_factor) fail('Set calibration changed since it loaded. Reload the set and capture it again');
    const c = body.camera || {},
      f = body.frame || {};
    const camera = {
      position: vector(c.position, 3, 'camera.position'),
      quaternion: vector(c.quaternion, 4, 'camera.quaternion'),
      verticalFovDegrees: number(c.verticalFovDegrees, 1, 150, 'camera FOV'),
      aspectRatio: number(c.aspectRatio, .1, 10, 'camera aspect'),
      near: number(c.near, .001, 10, 'camera near'),
      far: number(c.far, 10, 100000, 'camera far'),
      lens_mm: number(c.lens_mm, 1, 1000, 'lens'),
      sensor_width_mm: number(c.sensor_width_mm, 1, 100, 'sensor'),
      sensorFit: c.sensorFit || 'HORIZONTAL',
      projectionMatrix: vector(c.projectionMatrix, 16, 'projection matrix')
    };
    if (Math.abs(Math.hypot(...camera.quaternion) - 1) > 1e-4 || camera.far <= camera.near) fail('Invalid camera orientation or clipping', 400);
    const frame = {
      width: number(f.width, 2, 4096, 'frame width'),
      height: number(f.height, 2, 4096, 'frame height'),
      playhead_ms: number(f.playhead_ms || 0, 0, 86400000, 'playhead')
    };
    if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || Math.abs(frame.width / frame.height - camera.aspectRatio) > 1e-4) fail('Capture aspect does not match the camera', 400);
    if (!/^data:image\/png;base64,/.test(body.preview || '') || body.preview.length > 24e6) fail('Capture a browser PNG preview', 400);
    const bytes = Buffer.from(body.preview.split(',')[1], 'base64'),
      raster = require('./png-raster').decode(bytes);
    if (!raster || raster.width !== frame.width || raster.height !== frame.height) fail('Browser preview dimensions do not match the frozen camera', 400);
    if (!Array.isArray(body.subjects) || body.subjects.length > 200) fail('Invalid staged subjects', 400);
    const s = {
      schema: 'film-previz-snapshot-v1',
      coordinate_system: 'gltf-right-handed-y-up',
      units: 'metres',
      target: publicShot(target),
      world: {
        id: src.version.world_id,
        version_id: src.version.id,
        version: src.version.version,
        name: src.version.world_name,
        location_id: src.version.location_id,
        scale_factor: src.version.scale_factor,
        geometry: src.geometry,
        native: src.native,
        linked_assets: src.linked_assets,
        report: src.report
      },
      browser_representation: validateBrowserRepresentation(body.browser_representation, src.version.id, src.geometry.sha256),
      camera,
      frame,
      subjects: body.subjects.map(x => resolveSubject(x, target.project_id)),
      lights: validateLights(body.lights || {
        mode: 'native'
      }),
      timeline: body.timeline || {},
      framing: body.framing || {},
      room: String(body.room || '').slice(0, 200)
    };
    const id = crypto.randomUUID(),
      text = canonical(s),
      previewPath = require('./file-storage').saveFile(target.project_id, 'previs', 'snapshot_' + id + '.png', bytes);
    db.prepare('INSERT INTO film_previz_snapshots(id,project_id,shot_id,snapshot_json,snapshot_hash,preview_path,preview_sha256) VALUES(?,?,?,?,?,?,?)').run(id, target.project_id, target.id, text, sha(text), previewPath, sha(bytes));
    return {
      snapshot_id: id,
      snapshot: s,
      review: await reviews.preview({
        provider: 'previz-browser',
        capability: 'image',
        payload: {
          snapshot_id: id
        },
        provenance: {
          snapshot_id: id
        }
      })
    };
  }
  function attach(id, bytes, kind, receipt) {
    const r = row(id),
      s = snapshot(id);
    sourceCurrent(s);
    const imported = require('./media-imports').importMedia('storyboard-image', {
      shotId: r.shot_id,
      bytes,
      mime: 'image/png',
      versioned: true
    });
    const metadata = {
      kind,
      label: kind === 'previz_draft' ? 'Previz draft · browser preview' : 'Blender render · Cycles CPU',
      previz_snapshot_id: id,
      previz_snapshot_hash: r.snapshot_hash,
      previz_snapshot: s,
      receipt: receipt || null
    };
    db.prepare('UPDATE film_assets SET metadata=?,width=?,height=? WHERE id=?').run(canonical(metadata), s.frame.width, s.frame.height, imported.asset_id);
    db.prepare('UPDATE film_previz_snapshots SET ' + (kind === 'previz_draft' ? 'draft_asset_id' : 'render_asset_id') + '=? WHERE id=?').run(imported.asset_id, id);
    return {
      ...imported,
      snapshot_id: id,
      snapshot_hash: r.snapshot_hash,
      kind
    };
  }
  function tokenRow(token, provider) {
    const review = reviews.get(token?.id);
    if (review.fingerprint !== token?.fingerprint || review.snapshot.provider !== provider) fail('Approval fingerprint or output changed');
    return review;
  }
  function saveDraft(token) {
    const review = tokenRow(token, 'previz-browser');
    if (review.state === 'completed') return review.result;
    const claim = reviews.claim(token, 'previz-browser', 'image'),
      id = claim.snapshot.body.snapshot_id;
    const result = db.transaction(() => {
      const r = row(id);
      const out = attach(id, fs.readFileSync(r.preview_path), 'previz_draft');
      reviews.complete(review.id, out);
      return out;
    }).immediate();
    return result;
  }
  function blockers(s) {
    const reasons = [];
    if (!s.world.native?.path || !s.world.native?.sha256) reasons.push('Match and import the native .blend for this exact set version.');else if (!fs.existsSync(s.world.native.path) || sha(fs.readFileSync(s.world.native.path)) !== s.world.native.sha256) reasons.push('The native .blend is missing or no longer matches.');
    if (s.world.scale_factor !== 1) reasons.push('Native rendering requires the matched set in metres with scale 1.');
    for (const a of s.world.linked_assets) {
      if (a.kind === 'library') reasons.push('Linked Blender library requires a verified native reload before rendering: ' + a.path);
      if (a.kind === 'image' && a.source && !['FILE', 'GENERATED', 'VIEWER'].includes(a.source)) reasons.push('Native texture source needs a verified dependency manifest: ' + a.source + ' ' + a.path);
      if (!a.packed && (a.exists === false || !a.evidence || !a.sha256 || a.evidence.sha256 !== a.sha256)) reasons.push('Missing native dependency: ' + a.path);
    }
    for (const a of s.world.report.missing_assets || []) reasons.push('Missing native asset: ' + a.path);
    for (const a of s.subjects) {
      if (a.proxy || a.kind === 'human' && (!a.asset?.character_id || a.model?.library)) reasons.push(a.name + ': map a real character asset; a stand-in is not a final actor.');else if (!a.asset) reasons.push(a.name + ': model asset is missing.');
      if (a.pose && a.pose !== 'rest') reasons.push(a.name + ': this character pose has no native mapping.');
    }
    const b = (deps.resolveBlender || require('./set-build').resolveBlender)();
    if (!b.available) reasons.push(b.reason);
    return reasons;
  }
  async function prepareRender(id) {
    const r = row(id),
      s = snapshot(id);
    if (r.job_state === 'rendering') fail('This saved snapshot is already rendering');
    if (!r.draft_asset_id) fail('Save and review the browser draft first');
    sourceCurrent(s);
    const reasons = blockers(s);
    return {
      snapshot_id: id,
      snapshot: s,
      blockers: reasons,
      review: reasons.length ? null : await reviews.preview({
        provider: 'blender',
        capability: 'image',
        payload: {
          snapshot_id: id
        },
        provenance: {
          snapshot_id: id
        }
      })
    };
  }
  async function render(token) {
    const review = tokenRow(token, 'blender'),
      id = review.snapshot.body.snapshot_id;
    if (review.state === 'completed') return review.result;
    if (running.has(review.id)) return running.get(review.id);
    if (row(id).job_state === 'rendering') fail('This snapshot is already rendering');
    const claim = reviews.claim(token, 'blender', 'image');
    if (claim.replay) fail('This request was already sent; ' + row(id).job_state + '. Prepare a fresh review for a failed or cancelled render');
    const s = snapshot(id),
      reasons = blockers(s);
    if (reasons.length) fail(reasons.join(' '));
    db.prepare("UPDATE film_previz_snapshots SET job_state='rendering',job_error=NULL,active_review_id=? WHERE id=?").run(review.id, id);
    reviews.submitted(review.id, id);
    const promise = (async () => {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'film-previz-native-'));
      try {
        sourceCurrent(s);
        const working = path.join(work, 'source.blend');
        fs.copyFileSync(s.world.native.path, working);
        if (sha(fs.readFileSync(working)) !== s.world.native.sha256) fail('Native working copy changed');
        const job = {
          mode: 'previz',
          out_dir: work,
          native_snapshot: s,
          blend: working,
          source_sha256: s.world.native.sha256,
          snapshot_hash: row(id).snapshot_hash
        };
        const result = await (deps.runBlender || require('./set-build').runBlender)(job, 600000, {
          script: path.resolve(__dirname, '../blender-previz.py')
        });
        if (row(id).job_state !== 'rendering' || row(id).active_review_id !== review.id) fail('Render cancelled; no image was attached');
        if (result.snapshot_hash !== row(id).snapshot_hash || result.renderer !== 'cycles-cpu' || !result.image || path.resolve(result.image) !== path.join(work, 'snapshot.png')) fail('Blender did not produce this exact approved snapshot');
        const bytes = fs.readFileSync(result.image);
        const raster = require('./png-raster').decode(bytes);
        if (!raster || raster.width !== s.frame.width || raster.height !== s.frame.height) fail('Blender returned no PNG matching the approved dimensions');
        const output = db.transaction(() => {
          if (row(id).job_state !== 'rendering' || row(id).active_review_id !== review.id) fail('Render cancelled');
          const out = attach(id, bytes, 'previz_blender', result);
          db.prepare("UPDATE film_previz_snapshots SET job_state='completed' WHERE id=?").run(id);
          reviews.complete(review.id, out);
          return out;
        }).immediate();
        return output;
      } catch (err) {
        db.prepare("UPDATE film_previz_snapshots SET job_state=CASE WHEN job_state='cancelled' THEN job_state ELSE 'failed' END,job_error=? WHERE id=? AND active_review_id=?").run(err.message, id, review.id);
        throw err;
      } finally {
        running.delete(review.id);
        fs.rmSync(work, {
          recursive: true,
          force: true
        });
      }
    })();
    running.set(review.id, promise);
    return promise;
  }
  function cancel(id) {
    const r = reviews.get(id),
      sid = r.snapshot.body.snapshot_id;
    if (r.state === 'completed') fail('Image is already saved');
    if (r.state === 'submitted') {
      db.prepare("UPDATE film_previz_snapshots SET job_state='cancelled' WHERE id=? AND job_state='rendering' AND active_review_id=?").run(sid, id);
      return {
        state: 'cancelled',
        note: 'Output will be discarded; the local worker may still be finishing.'
      };
    }
    return reviews.cancel(id);
  }
  return {
    prepare,
    prepareRender,
    saveDraft,
    render,
    cancel,
    approve: reviews.approve,
    get: id => ({
      snapshot_id: id,
      snapshot: snapshot(id),
      ...row(id)
    }),
    worldSource: id => worldSource(db, id),
    review: id => reviews.get(id)
  };
}
let service;
const getService = () => service || (service = createSnapshotService(require('../db/database').db));
module.exports = {
  createSnapshotService,
  getService,
  nativePosition,
  nativeQuaternion
};
