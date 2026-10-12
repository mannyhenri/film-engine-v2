const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {spawnSync}=require('child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'film-depth-test-'));process.env.FILM_DATA_DIR=dir;
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const {createDepthService,graphProjection,validDepthConnection}=require('../lib/production-depth');
const {createWorker,validateDescriptor}=require('../lib/depth-worker');const media=require('../lib/depth-media');
const uid=()=>crypto.randomUUID(),nodePath=path.dirname(process.execPath),ff='/usr/local/bin/ffmpeg';
const fixtureFile=path.join(dir,'fixture-worker');fs.writeFileSync(fixtureFile,'#!'+process.execPath+'\n'+fs.readFileSync(path.join(__dirname,'fixtures/depth-fixture-worker.cjs'),'utf8').split('\n').slice(1).join('\n'));fs.chmodSync(fixtureFile,0o700);
function worker(file=fixtureFile){return createWorker({env:{FILM_DEPTH_ENABLED:'1',FILM_DEPTH_WORKER:file,FILM_DEPTH_MODEL_SHA256:'0'.repeat(64),PATH:nodePath+':/usr/local/bin:/usr/bin:/bin'},allowFixture:true});}
const storage={ensureDir(pid){const p=path.join(dir,'outputs',pid);fs.mkdirSync(p,{recursive:true});return p;},urlForPath(p){return '/local/'+path.basename(p);}};
function fixture(rate='24000/1001',vfr=false,count=6,size=[32,48]){
 const pid=uid(),aid=uid(),file=path.join(dir,aid+'.mp4');db.prepare('INSERT INTO film_projects(id,title) VALUES(?,?)').run(pid,'Synthetic depth test');
 const args=['-v','error','-y','-f','lavfi','-i',`testsrc2=size=${size[0]}x${size[1]}:rate=${rate}`,'-frames:v',String(count)];
 if(vfr)args.push('-vf',"select='not(eq(n,2))'",'-fps_mode','vfr');args.push('-c:v','libx264','-pix_fmt','yuv420p',file);
 const run=spawnSync(ff,args);assert.equal(run.status,0,run.stderr?.toString());
 db.prepare("INSERT INTO film_assets(id,project_id,asset_type,file_path,file_name,format,mime_type,width,height) VALUES(?,?,'video_raw',?,?,'mp4','video/mp4',?,?)").run(aid,pid,file,path.basename(file),...size);return {pid,aid,file};
}
async function prepared(f,options={}){const w=createDepthService(db,{worker:worker(),storage,allowFixture:true,...options}),source=await w.inspectSource(f.pid,f.aid),node=await w.saveNode(f.pid,null,{source_asset_id:f.aid,source_fingerprint:source.fingerprint,start_frame:1,end_frame_exclusive:5});return {w,source,node};}
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
test('probe retains portrait dimensions, 24000/1001 and 30000/1001 rates and decoded frame timestamps',async()=>{
 for(const rate of ['24000/1001','30000/1001']){const f=fixture(rate),s=await media.inspectVideo(f.file);assert.equal(s.width,32);assert.equal(s.height,48);assert.equal(s.frame_count,6);assert.deepEqual(s.fps,{numerator:Number(rate.split('/')[0]),denominator:1001});assert.ok(s.frames.every(x=>Number.isInteger(x.pts)&&x.duration_ticks>0));}
});
test('configured worker is unavailable by default; fixture is rejected outside an explicit test',async()=>{
 assert.equal((await createWorker({env:{}}).describe()).available,false);const d=await worker().describe();assert.equal(d.available,true);assert.throws(()=>validateDescriptor(d),/fixture workers/);assert.throws(()=>validateDescriptor({...d,fixture:false,temporal_consistency:false}),/temporal float/);assert.throws(()=>validateDescriptor({...d,fixture:false,network_uploads:true}),/no upload/);
});
test('reviewed full range produces raw depth, global preview, timing manifest and typed graph lineage',async()=>{
 const f=fixture(),{w,node}=await prepared(f);const p=await w.plan(f.pid,node.id,{expected_revision:1,mode:'full'}),j=await w.execute(f.pid,node.id,{expected_revision:1,mode:'full',plan_fingerprint:p.plan_fingerprint});await w.settle(j.id);const completed=w.job(f.pid,j.id);assert.equal(completed.status,'complete',completed.error);
 const n=w.readNode(f.pid,node.id),v=n.versions[0];assert.equal(v.role,'authoritative');assert.equal(v.fixture,true);assert.equal(v.files.frame_count,4);assert.equal(v.files.width,32);assert.equal(v.files.height,48);assert.equal(v.depth_is_alpha,false);assert.equal(v.normalization.normalization,'one_global_range_for_selected_clip');assert.equal(v.request.timing.start_frame,1);assert.equal(fs.statSync(f.file).size>0,true);assert.equal(await media.hashFile(f.file),v.request.source_sha256);
 const graph=graphProjection(db,f.pid,storage);assert.deepEqual(new Set(graph.nodes.map(n=>n.type)),new Set(['depth-source','depth-map','depth-output','depth-preview']));assert.equal(graph.edges.length,3);assert.equal(validDepthConnection(graph.nodes[0],graph.nodes[1]),true);assert.equal(validDepthConnection(graph.nodes[2],graph.nodes[1]),false);
});
test('variable frame timestamps and selected-window duration survive authoritative output',async()=>{
 const f=fixture('25/1',true),{w,source,node}=await prepared(f);assert.equal(source.timing.variable_frame_rate,true);const p=await w.plan(f.pid,node.id,{expected_revision:1,mode:'full'}),j=await w.execute(f.pid,node.id,{expected_revision:1,mode:'full',plan_fingerprint:p.plan_fingerprint});await w.settle(j.id);assert.equal(w.job(f.pid,j.id).status,'complete',w.job(f.pid,j.id).error);const v=w.readNode(f.pid,node.id).versions[0];assert.deepEqual(v.request.timing.frames,source.timing.frames.slice(1,5));
});
test('preview is explicitly distinct from authoritative data and never becomes a source video',async()=>{
 const f=fixture(),{w,node}=await prepared(f),p=await w.plan(f.pid,node.id,{expected_revision:1,mode:'preview'}),j=await w.execute(f.pid,node.id,{expected_revision:1,mode:'preview',plan_fingerprint:p.plan_fingerprint});await w.settle(j.id);assert.equal(w.job(f.pid,j.id).status,'complete',w.job(f.pid,j.id).error);const v=w.readNode(f.pid,node.id).versions[0];assert.equal(v.role,'preview_only');await assert.rejects(w.inspectSource(f.pid,v.preview_asset_id),/source video asset/);
});
test('cross-project assets, stale node revision, unreviewed source and stale plan are refused',async()=>{
 const f=fixture(),foreign=fixture(),{w,node}=await prepared(f);await assert.rejects(w.inspectSource(f.pid,foreign.aid),/not in this project/);await assert.rejects(w.saveNode(f.pid,null,{source_asset_id:f.aid}),/review/);await assert.rejects(w.plan(f.pid,node.id,{expected_revision:0,mode:'full'}),/changed/);await assert.rejects(w.execute(f.pid,node.id,{expected_revision:1,mode:'full',plan_fingerprint:'bad'}),/plan changed/);
 const p=await w.plan(f.pid,node.id,{expected_revision:1,mode:'full'});db.prepare('UPDATE film_assets SET version=2 WHERE id=?').run(f.aid);await assert.rejects(w.execute(f.pid,node.id,{expected_revision:1,mode:'full',plan_fingerprint:p.plan_fingerprint}),/Source video changed/);
});
test('source change during work prevents asset publication',async()=>{
 const f=fixture(),base=worker(),wrapper={describe:()=>base.describe(),async run(...args){const r=await base.run(...args);db.prepare('UPDATE film_assets SET version=2 WHERE id=?').run(f.aid);return r;}};
 const {w,node}=await prepared(f,{worker:wrapper}),p=await w.plan(f.pid,node.id,{expected_revision:1,mode:'full'}),before=db.prepare('SELECT count(*) n FROM film_assets WHERE project_id=?').get(f.pid).n,j=await w.execute(f.pid,node.id,{expected_revision:1,mode:'full',plan_fingerprint:p.plan_fingerprint});await w.settle(j.id);assert.equal(w.job(f.pid,j.id).status,'failed');assert.match(w.job(f.pid,j.id).error,/Source or node changed/);assert.equal(db.prepare('SELECT count(*) n FROM film_assets WHERE project_id=?').get(f.pid).n,before);
});
test('cancellation waits for the owned child exit; duplicate active jobs and input changes are refused',async()=>{
 const slow=path.join(dir,'fixture-worker-slow');fs.copyFileSync(fixtureFile,slow);fs.chmodSync(slow,0o700);const f=fixture(),{w,node}=await prepared(f,{worker:worker(slow)}),p=await w.plan(f.pid,node.id,{expected_revision:1,mode:'full'}),j=await w.execute(f.pid,node.id,{expected_revision:1,mode:'full',plan_fingerprint:p.plan_fingerprint});
 await assert.rejects(w.execute(f.pid,node.id,{expected_revision:1,mode:'full',plan_fingerprint:p.plan_fingerprint}),/already active/);assert.equal(w.cancel(f.pid,j.id).status,'cancelling');await w.settle(j.id);assert.equal(w.job(f.pid,j.id).status,'cancelled');assert.equal(w.readNode(f.pid,node.id).versions.length,0);
});
test('nonfinite worker output and incomplete float byte counts cannot publish versions',async()=>{
 const invalid=path.join(dir,'fixture-worker-invalid');fs.copyFileSync(fixtureFile,invalid);fs.chmodSync(invalid,0o700);const f=fixture(),{w,node}=await prepared(f,{worker:worker(invalid)}),p=await w.plan(f.pid,node.id,{expected_revision:1,mode:'full'}),j=await w.execute(f.pid,node.id,{expected_revision:1,mode:'full',plan_fingerprint:p.plan_fingerprint});await w.settle(j.id);assert.equal(w.job(f.pid,j.id).status,'failed');assert.match(w.job(f.pid,j.id).error,/nonfinite/);
 const short=path.join(dir,'short.f32');fs.writeFileSync(short,Buffer.alloc(4));await assert.rejects(media.validateRaw(short,p.request,new AbortController().signal),/byte count/);
});

test('72-frame portrait depth patterns cannot be misprobed as MPEG-TS and retain exact timing',async()=>{const f=fixture('24000/1001',false,72,[64,96]),w=createDepthService(db,{worker:worker(),storage,allowFixture:true}),source=await w.inspectSource(f.pid,f.aid),node=await w.saveNode(f.pid,null,{source_asset_id:f.aid,source_fingerprint:source.fingerprint}),p=await w.plan(f.pid,node.id,{expected_revision:1,mode:'full'}),j=await w.execute(f.pid,node.id,{expected_revision:1,mode:'full',plan_fingerprint:p.plan_fingerprint});await w.settle(j.id);assert.equal(w.job(f.pid,j.id).status,'complete',w.job(f.pid,j.id).error);assert.equal(w.readNode(f.pid,node.id).versions[0].files.frame_count,72);});

test('invalid worker timing metadata cannot bypass drift validation',async()=>{const f=fixture(),timing=await media.inspectVideo(f.file);for(const invalid of [{...timing,time_base:{numerator:null,denominator:1}},{...timing,duration_ticks:null},{...timing,frames:timing.frames.map(x=>({...x,pts:null}))}])assert.throws(()=>media.sameTiming(timing,invalid),/invalid/);});
test('preview includes final frame duration within its two-second cap',async()=>{const f=fixture('24000/1001',false,72),w=createDepthService(db,{worker:worker(),storage,allowFixture:true}),source=await w.inspectSource(f.pid,f.aid),node=await w.saveNode(f.pid,null,{source_asset_id:f.aid,source_fingerprint:source.fingerprint}),p=await w.plan(f.pid,node.id,{expected_revision:1,mode:'preview'});assert.equal(p.request.timing.frame_count,47);assert.ok(media.seconds(p.request.timing.duration_ticks,p.request.timing.time_base)<=2);});

test('audited model input bounds are checked during plan review before any inference job',async()=>{
 const f=fixture(),base=worker();let dispatched=0;
 const limited={async describe(){return {...await base.describe(),model_input_size_min:128,model_input_size_max:518};},async run(...args){dispatched++;return base.run(...args);}};
 const w=createDepthService(db,{worker:limited,storage,allowFixture:true}),source=await w.inspectSource(f.pid,f.aid);
 const n=await w.saveNode(f.pid,null,{source_asset_id:f.aid,source_fingerprint:source.fingerprint,model_input_size:768});
 await assert.rejects(w.plan(f.pid,n.id,{expected_revision:1,mode:'full'}),/outside the configured worker limits/);
 assert.equal(dispatched,0);assert.equal(db.prepare('SELECT count(*) n FROM production_depth_jobs WHERE project_id=?').get(f.pid).n,0);
 const valid=await w.saveNode(f.pid,n.id,{expected_revision:1,source_fingerprint:source.fingerprint,model_input_size:128});
 assert.equal((await w.plan(f.pid,n.id,{expected_revision:valid.revision,mode:'full'})).request.settings.model_input_size,128);
});
test('malformed optional worker model bounds cannot be advertised as an available backend',async()=>{
 const d=await worker().describe();
 assert.throws(()=>validateDescriptor({...d,model_input_size_max:'518'},{allowFixture:true}),/valid model_input_size_max/);
 assert.throws(()=>validateDescriptor({...d,model_input_size_min:518,model_input_size_max:128},{allowFixture:true}),/reversed/);
});

test('allocation and temporal caps fail at plan review and never create inference jobs',async()=>{
 const f=fixture(),base=worker(),sourceService=createDepthService(db,{worker:base,storage,allowFixture:true});
 const source=await sourceService.inspectSource(f.pid,f.aid),n=await sourceService.saveNode(f.pid,null,{source_asset_id:f.aid,source_fingerprint:source.fingerprint,start_frame:1,end_frame_exclusive:5,model_input_size:128});
 let dispatched=0;
 for(const [limits,pattern] of [[{max_output_pixels:1000},/output pixels/],[{max_raw_bytes:20000},/byte limit/],[{max_duration_seconds:.1},/duration/],[{max_source_pixels:1000},/Source geometry/],[{max_model_pixels:10000},/model grid/]]){
  const limited={async describe(){return {...await base.describe(),...limits};},async run(){dispatched++;throw Error('Must not dispatch');}},w=createDepthService(db,{worker:limited,storage,allowFixture:true});
  await assert.rejects(w.plan(f.pid,n.id,{expected_revision:1,mode:'full'}),pattern);
 }
 assert.equal(dispatched,0);assert.equal(db.prepare('SELECT count(*) n FROM production_depth_jobs WHERE project_id=?').get(f.pid).n,0);
});
test('worker orientation disagreement prevents publication',async()=>{
 const f=fixture(),base=worker(),wrapper={describe:()=>base.describe(),async run(...args){const r=await base.run(...args);r.orientation=require('../lib/depth-orientation').orientationFor(32,48,90);return r;}};
 const {w,node}=await prepared(f,{worker:wrapper}),p=await w.plan(f.pid,node.id,{expected_revision:1,mode:'full'}),j=await w.execute(f.pid,node.id,{expected_revision:1,mode:'full',plan_fingerprint:p.plan_fingerprint});
 await w.settle(j.id);assert.equal(w.job(f.pid,j.id).status,'failed');assert.match(w.job(f.pid,j.id).error,/orientation/);assert.equal(w.readNode(f.pid,node.id).versions.length,0);
});
test('changed worker launcher refreshes the reviewed descriptor fingerprint',async()=>{
 const file=path.join(dir,'changing-worker');fs.copyFileSync(fixtureFile,file);fs.chmodSync(file,0o700);const configured=worker(file),before=await configured.describe();
 fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("revision:'test-v1'","revision:'test-v2'"));
 const after=await configured.describe();assert.equal(after.revision,'test-v2');assert.notEqual(before.fingerprint,after.fingerprint);
});
