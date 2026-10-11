// Opt-in real local inference. Default test runs never contact or start a model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

test('configured real worker publishes four synthetic frames through Film', {
  skip: process.env.FILM_DEPTH_REAL_WORKER_SMOKE !== '1', timeout: 180000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'film-real-depth-smoke-'));
  const previousData = process.env.FILM_DATA_DIR;
  process.env.FILM_DATA_DIR = root;
  const repo = process.env.FILM_DEPTH_SMOKE_REPO || path.resolve(__dirname, '../..');
  const {db} = require(path.join(repo, 'backend/db/database'));
  require(path.join(repo, 'backend/db/schema')).ensureSchema();
  const media = require(path.join(repo, 'backend/lib/depth-media'));
  const {createWorker} = require(path.join(repo, 'backend/lib/depth-worker'));
  const {createDepthService, graphProjection} = require(path.join(repo, 'backend/lib/production-depth'));
  const worker = createWorker();
  const pid = crypto.randomUUID(), aid = crypto.randomUUID();
  const sourceFile = path.join(root, 'video', pid, 'synthetic.mp4');
  fs.mkdirSync(path.dirname(sourceFile), {recursive: true});
  let service, job;
  try {
    const backend = await worker.describe();
    assert.equal(backend.available, true, backend.reason);
    assert.equal(backend.fixture, false);
    const ff = require(path.join(repo, 'backend/lib/ffmpeg')).resolveFfmpeg();
    assert.equal(ff.available, true, ff.reason);
    const encoded = spawnSync(ff.bin, ['-nostdin','-v', 'error', '-y', '-f', 'lavfi', '-i',
      'testsrc2=size=160x96:rate=30000/1001', '-frames:v', '6', '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p', sourceFile],{stdio:['ignore','pipe','pipe']});
    assert.equal(encoded.status, 0, encoded.stderr?.toString());
    const rotation=Number(process.env.FILM_DEPTH_SMOKE_ROTATION??0);
    assert.ok([0,90,180,-90].includes(rotation));
    if(rotation){
      const rotated=path.join(path.dirname(sourceFile),'rotated.mp4');
      const r=spawnSync(ff.bin,['-nostdin','-v','error','-y','-copyts','-noautorotate','-display_rotation',String(rotation),'-i',sourceFile,'-c:v','copy',rotated],{stdio:['ignore','pipe','pipe']});
      assert.equal(r.status,0,r.stderr?.toString());fs.renameSync(rotated,sourceFile);
    }
    const beforeHash = await media.hashFile(sourceFile);
    db.prepare('INSERT INTO film_projects(id,title) VALUES(?,?)').run(pid, 'Real depth smoke · synthetic');
    db.prepare("INSERT INTO film_assets(id,project_id,asset_type,file_path,file_name,format,mime_type,width,height) VALUES(?,?,'video_raw',?,'synthetic.mp4','mp4','video/mp4',160,96)").run(aid,pid,sourceFile);
    const storage = require(path.join(repo, 'backend/lib/file-storage'));
    service = createDepthService(db, {worker, storage});
    const source = await service.inspectSource(pid, aid);
    const node = await service.saveNode(pid, null, {source_asset_id: aid,
      source_fingerprint: source.fingerprint, start_frame: 1, end_frame_exclusive: 5,
      model_input_size: 128});
    const plan = await service.plan(pid, node.id, {expected_revision: 1, mode: 'full'});
    const started = performance.now();
    job = await service.execute(pid, node.id, {expected_revision: 1, mode: 'full', plan_fingerprint: plan.plan_fingerprint});
    await service.settle(job.id);
    const completed = service.job(pid, job.id);
    assert.equal(completed.status, 'complete', completed.error);
    const v = service.readNode(pid, node.id).versions[0];
    assert.equal(v.fixture, false); assert.equal(v.depth_kind, 'relative_inverse_depth');
    assert.equal(v.worker_provenance.backend, 'mps');
    assert.equal(v.worker_provenance.cpu_neural_fallback, false);
    assert.ok(v.worker_provenance.gpu_dispatch_output_tensors > 0);
    assert.ok(v.worker_provenance.gpu_forward_hook_calls > 0);
    assert.equal(v.role, 'authoritative'); assert.equal(v.depth_is_alpha, false);
    assert.deepEqual(v.request.timing, plan.request.timing);
    assert.deepEqual(v.files.frame_count, 4); assert.equal(v.files.width, 160); assert.equal(v.files.height, 96);
    assert.deepEqual(v.request.timing.fps, {numerator: 30000, denominator: 1001});
    const raw = service.versionFile(pid, v.id, 'raw');
    assert.equal(raw.size, 4 * 160 * 96 * 4);
    const range = await media.validateRaw(raw.path, plan.request, new AbortController().signal);
    assert.ok(Number.isFinite(range.min) && Number.isFinite(range.max));
    assert.equal(range.sha256, v.files.raw_sha256);
    const preview = service.versionFile(pid, v.id, 'preview');
    const actualTiming = await media.inspectVideo(preview.path);
    media.sameTiming({...plan.request.timing,width:160,height:96}, actualTiming, {tolerance:1e-9});
    assert.equal(await media.hashFile(preview.path), v.files.preview_sha256);
    const manifest = JSON.parse(fs.readFileSync(service.versionFile(pid, v.id, 'manifest').path));
    assert.equal(manifest.files.raw_sha256, range.sha256);
    assert.equal(source.timing.display_rotation_degrees,rotation);
    assert.equal(actualTiming.display_rotation_degrees,rotation);
    assert.equal(manifest.orientation.display_rotation_degrees,rotation);
    assert.equal(manifest.orientation.output_coordinates,'encoded');
    assert.equal(manifest.quality_status,backend.provider==='gridlight-local'&&backend.model==='Video-Depth-Anything-Small'?'experimental_preview':'unverified');
    assert.equal(manifest.worker_orientation.display_rotation_degrees,rotation);
    assert.equal(manifest.worker_orientation.coded_width,160);
    assert.equal(manifest.worker_orientation.coded_height,96);
    if(process.env.FILM_DEPTH_SMOKE_DELIVERABLES){
      const out=process.env.FILM_DEPTH_SMOKE_DELIVERABLES;fs.mkdirSync(out,{recursive:true});
      for(const [from,name] of [[sourceFile,'synthetic-source.mp4'],[raw.path,'depth.f32'],[preview.path,'depth-preview.mp4'],[service.versionFile(pid,v.id,'manifest').path,'manifest.json']])fs.copyFileSync(from,path.join(out,name));
    }
    assert.equal(await media.hashFile(sourceFile), beforeHash);
    const graph = graphProjection(db, pid, storage); assert.equal(graph.edges.length, 3);
    assert.equal(db.prepare('SELECT count(*) n FROM film_scripts').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM film_scenes').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM film_shots').get().n, 0);
    const evidence = {checked_at:new Date().toISOString(),backend,worker_provenance:v.worker_provenance,service_wall_seconds:(performance.now()-started)/1000,
      synthetic_only:true,live_database_used:false,source_unchanged:true,source_sha256:beforeHash,
      model_input_size:128,files:v.files,timing:v.request.timing,preview_timing:actualTiming,range,
      depth_kind:v.depth_kind,quality_status:v.quality_status,orientation:v.orientation,worker_orientation:v.worker_orientation,admission:plan.admission,graph_edges:graph.edges.length,job_status:completed.status};
    if(process.env.FILM_DEPTH_SMOKE_EVIDENCE) fs.writeFileSync(process.env.FILM_DEPTH_SMOKE_EVIDENCE,JSON.stringify(evidence,null,2));
  } finally {
    if(job && service && ['running','validating','encoding','cancelling'].includes(service.job(pid,job.id).status)) {
      service.cancel(pid,job.id); await service.settle(job.id);
    }
    db.close(); fs.rmSync(root,{recursive:true,force:true});
    if(previousData===undefined) delete process.env.FILM_DATA_DIR; else process.env.FILM_DATA_DIR=previousData;
  }
});
