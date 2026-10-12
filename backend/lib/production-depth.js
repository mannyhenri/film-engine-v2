const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');
const media=require('./depth-media');
const {createWorker,validateModelInput,validateDevice,validateGpuProvenance}=require('./depth-worker');
const {validateAdmission}=require('./depth-admission');
const {orientationFor,validateWorkerOrientation}=require('./depth-orientation');
const ACTIVE=['running','validating','encoding','cancelling'];
const VIDEO_TYPES=['video_raw','video_synced','video_final'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const parse=v=>JSON.parse(v);
const id=()=>crypto.randomUUID();
function versionUrl(pid,vid,kind){return `/film/projects/${pid}/production-depth/versions/${vid}/${kind}`;}
function unavailableCatalog(){return {provider:'muapi',model:'depth-anything',endpoint:'/api/v1/depth-anything',status:'contract_insufficient',reason:'Documented grayscale Depth Anything V2 output; raw float depth, temporal consistency and exact source timestamps are not documented. No upload or paid dispatch enabled.',documentation:'https://muapi.ai/docs/models'};}
function createDepthService(db,{allowFixture=process.env.NODE_ENV==='test'&&process.env.FILM_DEPTH_ALLOW_TEST_FIXTURE==='1',worker=createWorker({allowFixture}),inspect=media.inspectVideo,storage=require('./file-storage')}={}){
 const work=new Map(),ownerToken=id();
 // A prior process's jobs never redispatch. A still-live owner is left alone.
 for(const job of db.prepare(`SELECT id,owner_pid FROM production_depth_jobs WHERE status IN (${ACTIVE.map(()=>'?')})`).all(...ACTIVE)){
  let alive=true;try{process.kill(job.owner_pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
  if(!alive)db.prepare("UPDATE production_depth_jobs SET status='interrupted',phase='Previous worker stopped; review before running again',finished_at=datetime('now') WHERE id=?").run(job.id);
 }
 function project(pid){if(!UUID.test(pid)||!db.prepare('SELECT 1 FROM film_projects WHERE id=?').get(pid))throw media.fail('Project not found',404);}
 function asset(pid,aid){project(pid);const row=db.prepare('SELECT * FROM film_assets WHERE id=? AND project_id=?').get(aid,pid);if(!row)throw media.fail('Source asset is not in this project',404);return row;}
 function node(pid,nid){project(pid);const row=db.prepare('SELECT * FROM production_depth_nodes WHERE id=? AND project_id=?').get(nid,pid);if(!row)throw media.fail('Depth node not found in this project',404);return row;}
 function version(pid,vid){project(pid);const row=db.prepare('SELECT * FROM production_depth_versions WHERE id=? AND project_id=?').get(vid,pid);if(!row)throw media.fail('Depth version not found in this project',404);return row;}
 function job(pid,jid){project(pid);const row=db.prepare('SELECT * FROM production_depth_jobs WHERE id=? AND project_id=?').get(jid,pid);if(!row)throw media.fail('Depth job not found in this project',404);return publicJob(row);}
 function publicJob(row){return {id:row.id,node_id:row.node_id,mode:row.mode,status:row.status,progress:row.progress,phase:row.phase,error:row.error,created_at:row.created_at,finished_at:row.finished_at,backend:parse(row.backend_json)};}
 function publicVersion(row){const m=parse(row.metadata_json);return {...m,id:row.id,version:row.version,job_id:row.job_id,mode:row.mode,raw_asset_id:row.raw_asset_id,preview_asset_id:row.preview_asset_id,manifest_asset_id:row.manifest_asset_id,
  raw_url:versionUrl(row.project_id,row.id,'raw'),preview_url:versionUrl(row.project_id,row.id,'preview'),manifest_url:versionUrl(row.project_id,row.id,'manifest')};}
 function versionFile(pid,vid,kind){const v=version(pid,vid),columns={raw:'raw_asset_id',preview:'preview_asset_id',manifest:'manifest_asset_id'};if(!columns[kind])throw media.fail('Depth file kind not found',404);const row=asset(pid,v[columns[kind]]);if(!fs.existsSync(row.file_path)||!fs.statSync(row.file_path).isFile())throw media.fail('Depth file is missing',404);const real=fs.realpathSync(row.file_path),root=fs.realpathSync(storage.dirFor(pid,'exports'));if(!storage.isPathContained(real,root))throw media.fail('Depth file is outside this project export storage',404);return {path:real,mime:{raw:'application/octet-stream',preview:'video/mp4',manifest:'application/json'}[kind],size:fs.statSync(row.file_path).size};}
 function readNode(pid,nid){const n=node(pid,nid),source=parse(n.source_json),settings=parse(n.settings_json);delete source.path;
  return {id:n.id,project_id:pid,revision:n.revision,source,settings,versions:db.prepare('SELECT * FROM production_depth_versions WHERE node_id=? ORDER BY version DESC').all(n.id).map(publicVersion),jobs:db.prepare('SELECT * FROM production_depth_jobs WHERE node_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20').all(n.id).map(publicJob)};
 }
 async function catalog(pid){project(pid);return {project_id:pid,backend:await worker.describe(),alternatives:[unavailableCatalog()],sources:db.prepare(`SELECT id,file_name,version,width,height,duration_ms FROM film_assets WHERE project_id=? AND asset_type IN (${VIDEO_TYPES.map(()=>'?')}) ORDER BY created_at DESC`).all(pid,...VIDEO_TYPES),nodes:db.prepare('SELECT id FROM production_depth_nodes WHERE project_id=? ORDER BY created_at,id').all(pid).map(n=>readNode(pid,n.id))};}
 async function inspectSource(pid,aid){const row=asset(pid,aid);if(!VIDEO_TYPES.includes(row.asset_type))throw media.fail('Depth input must be a source video asset, never a depth preview or image');
  if(!row.file_path||!fs.existsSync(row.file_path)||!fs.statSync(row.file_path).isFile())throw media.fail('Source video file is missing',409);
  const sha256=await media.hashFile(row.file_path),timing=await inspect(row.file_path);
  if(await media.hashFile(row.file_path)!==sha256)throw media.fail('Source changed while inspecting',409);
  const source={asset_id:row.id,asset_version:row.version,asset_type:row.asset_type,file_name:row.file_name,sha256,timing};source.fingerprint=media.digest(source);return source;
 }
 function settingsFor(source,b){
  const start=b.start_frame??0,end=b.end_frame_exclusive??source.timing.frame_count;media.selectedTiming(source.timing,start,end);
  const input=b.model_input_size??384;if(!Number.isInteger(input)||input<128||input>2048)throw media.fail('Model input size must be an integer from 128 to 2048');
  const device=b.device??'mps';if(device!=='mps')throw media.fail('Depth Map requires explicit MPS GPU inference; CPU or automatic device fallback is unavailable');
  return {start_frame:start,end_frame_exclusive:end,model_input_size:input,device,normalization:'global',depth_is_alpha:false};
 }
 async function saveNode(pid,nid,b){
  let existing=nid?node(pid,nid):null;
  if(existing&&b.expected_revision!==existing.revision)throw media.fail('Depth node changed after review',409);
  const source=await inspectSource(pid,b.source_asset_id || existing?.source_asset_id);
  if(!b.source_fingerprint||b.source_fingerprint!==source.fingerprint)throw media.fail('Inspect and review this exact source video before saving',409);
  const settings=settingsFor(source,b),nidOut=nid || id();
  db.transaction(()=>{
   if(existing){const current=node(pid,nid);if(current.revision!==b.expected_revision)throw media.fail('Depth node changed while inspecting',409);if(db.prepare(`SELECT 1 FROM production_depth_jobs WHERE node_id=? AND status IN (${ACTIVE.map(()=>'?')})`).get(nid,...ACTIVE))throw media.fail('Cancel or finish the active depth job before changing inputs',409);
    db.prepare('UPDATE production_depth_nodes SET source_asset_id=?,source_json=?,settings_json=?,revision=revision+1 WHERE id=?').run(source.asset_id,JSON.stringify(source),JSON.stringify(settings),nid);
   }else db.prepare('INSERT INTO production_depth_nodes(id,project_id,source_asset_id,source_json,settings_json) VALUES(?,?,?,?,?)').run(nidOut,pid,source.asset_id,JSON.stringify(source),JSON.stringify(settings));
  })();return readNode(pid,nidOut);
 }
 async function plan(pid,nid,b){
  const n=node(pid,nid);if(b.expected_revision!==n.revision)throw media.fail('Depth node changed after review',409);
  const source=parse(n.source_json),current=await inspectSource(pid,n.source_asset_id);if(current.fingerprint!==source.fingerprint)throw media.fail('Source video changed; inspect and save a new node revision',409);
  const backend=await worker.describe();if(!backend.available)throw media.fail(backend.reason,503);if(backend.fixture&&!allowFixture)throw media.fail('Synthetic depth fixtures are not production results',503);
  const settings=parse(n.settings_json),mode=b.mode;if(!['preview','full'].includes(mode))throw media.fail('Depth mode must be preview or full');
  validateModelInput(backend,settings);
  validateDevice(backend,settings);
  let end=settings.end_frame_exclusive,width=source.timing.width,height=source.timing.height;
  if(mode==='preview'){
   end=Math.min(end,settings.start_frame+120);const first=source.timing.frames[settings.start_frame].pts;
   while(end>settings.start_frame+1&&media.seconds(source.timing.frames[end-1].pts+source.timing.frames[end-1].duration_ticks-first,source.timing.time_base)>2)end--;
   const scale=Math.min(1,640/Math.max(width,height));width=Math.max(1,Math.round(width*scale));height=Math.max(1,Math.round(height*scale));
  }
  const timing=media.selectedTiming(source.timing,settings.start_frame,end);
  if(mode==='preview'&&media.seconds(timing.duration_ticks,timing.time_base)>2)throw media.fail('A single source frame exceeds the two-second preview limit; choose full output');
  media.timestampExpressions(timing);
  const admission=validateAdmission(backend,{width,height,timing,settings});
  const request={contract:'film-depth-request-v1',project_id:pid,node_id:nid,node_revision:n.revision,mode,source_asset_id:source.asset_id,source_fingerprint:source.fingerprint,source_sha256:source.sha256,source_version:source.asset_version,width,height,timing,settings};
  const request_fingerprint=media.digest(request),plan_fingerprint=media.digest({request_fingerprint,backend_fingerprint:backend.fingerprint});
  return {request:{...request,request_fingerprint},backend,admission,plan_fingerprint,estimated_raw_bytes:timing.frame_count*width*height*4,paid:false,uploads:false};
 }
 function update(jid,status,progress,phase){const row=db.prepare('SELECT status,progress FROM production_depth_jobs WHERE id=?').get(jid);if(!row||!ACTIVE.includes(row.status))return;if(row.status==='cancelling'&&status!=='cancelled')return;
  db.prepare('UPDATE production_depth_jobs SET status=?,progress=?,phase=? WHERE id=?').run(status,Math.max(row.progress,Math.min(1,progress)),phase,jid);
 }
 async function execute(pid,nid,b){
  const p=await plan(pid,nid,b);if(!b.plan_fingerprint||b.plan_fingerprint!==p.plan_fingerprint)throw media.fail('Depth plan changed; review the current source, range and backend',409);
  const disk=await fs.promises.statfs(os.tmpdir()),required=p.estimated_raw_bytes*2+fs.statSync(asset(pid,p.request.source_asset_id).file_path).size+16*1024*1024;
  if(required>disk.bavail*disk.bsize)throw media.fail('Not enough temporary disk space for this depth range',507);
  const jid=id(),controller=new AbortController();
  db.transaction(()=>{if(node(pid,nid).revision!==p.request.node_revision)throw media.fail('Depth node changed before dispatch',409);
   if(db.prepare(`SELECT 1 FROM production_depth_jobs WHERE node_id=? AND status IN (${ACTIVE.map(()=>'?')})`).get(nid,...ACTIVE))throw media.fail('A depth job is already active for this node',409);
   db.prepare('INSERT INTO production_depth_jobs(id,project_id,node_id,node_revision,mode,status,request_json,backend_json,owner_pid,owner_token) VALUES(?,?,?,?,?,?,?,?,?,?)').run(jid,pid,nid,p.request.node_revision,p.request.mode,'running',JSON.stringify(p.request),JSON.stringify(p.backend),process.pid,ownerToken);
  })();
  const done=perform(pid,jid,p,controller).finally(()=>work.delete(jid));work.set(jid,{controller,done});return job(pid,jid);
 }
 async function perform(pid,jid,p,controller){
  const signal=controller.signal;let dir,out;
  try{
   dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'film-depth-'));
   const input=path.join(dir,'source'+path.extname(asset(pid,p.request.source_asset_id).file_path));
   await fs.promises.copyFile(asset(pid,p.request.source_asset_id).file_path,input);
   if(await media.hashFile(input,signal)!==p.request.source_sha256)throw media.fail('Source changed before worker received its snapshot',409);
   update(jid,'running',0.02,'Estimating temporal depth');
   const result=await worker.run({...p.request,source_path:input},{signal,outputDir:dir,expectedFingerprint:p.backend.fingerprint,onProgress:(progress,phase)=>update(jid,'running',0.02+progress*0.68,phase)});
   if(signal.aborted)throw media.fail('Cancelled',409);
   if(result.request_fingerprint!==p.request.request_fingerprint||result.source_fingerprint!==p.request.source_fingerprint||result.raw_file!=='raw.f32')throw media.fail('Worker result does not match the reviewed request');
   media.sameTiming({...p.request.timing,width:p.request.width,height:p.request.height},result.timing);
   if(p.backend.output_coordinates==='encoded'&&p.request.timing.display_rotation_degrees&&result.orientation===undefined)throw media.fail('Worker did not confirm source display orientation');
   validateWorkerOrientation(p.request.timing,result.orientation);
   const orientation=orientationFor(p.request.width,p.request.height,p.request.timing.display_rotation_degrees??0);
   if(result.timing.fps?.numerator!==p.request.timing.fps.numerator||result.timing.fps?.denominator!==p.request.timing.fps.denominator)throw media.fail('Worker frame rate does not match the exact source rational');
   if(!['relative_depth','relative_inverse_depth','metric_depth'].includes(result.depth_kind))throw media.fail('Worker must state its depth units/interpretation');
   let workerProvenance;
   if(!p.backend.fixture){
    if(result.provenance_file!=='worker-provenance.json')throw media.fail('GPU worker did not supply execution provenance');
    const provenancePath=path.join(dir,result.provenance_file),stat=fs.lstatSync(provenancePath);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw media.fail('GPU provenance must be a bounded regular owned file');
    workerProvenance=JSON.parse(await fs.promises.readFile(provenancePath,'utf8'));
    validateGpuProvenance(p.backend,p.request,workerProvenance);
    media.sameTiming({...p.request.timing,width:p.request.width,height:p.request.height},workerProvenance.timing);
   }
   const raw=path.join(dir,'raw.f32');if(fs.lstatSync(raw).isSymbolicLink()||!fs.lstatSync(raw).isFile())throw media.fail('Worker raw output must be a regular owned file');
   update(jid,'validating',0.72,'Checking raw depths and source timestamps');const range=await media.validateRaw(raw,p.request,signal);
   update(jid,'encoding',0.84,'Encoding display video with one global depth range');const preview=await media.encodePreview(raw,dir,p.request,range,signal);
   const current=await inspectSource(pid,p.request.source_asset_id);if(current.fingerprint!==p.request.source_fingerprint||node(pid,p.request.node_id).revision!==p.request.node_revision)throw media.fail('Source or node changed while depth ran; result was not published',409);
   if(signal.aborted)throw media.fail('Cancelled',409);
   const metadata={type:'DepthSequence',quality_status:p.backend.provider==='gridlight-local'&&p.backend.model==='Video-Depth-Anything-Small'?'experimental_preview':'unverified',role:p.request.mode==='full'?'authoritative':'preview_only',fixture:p.backend.fixture===true,depth_is_alpha:false,depth_kind:result.depth_kind,request:p.request,backend:p.backend,normalization:range,preview_timing:preview.timing,orientation,admission:p.admission,...(workerProvenance?{worker_provenance:workerProvenance}:{}),...(result.orientation?{worker_orientation:result.orientation}:{}),source_unchanged:true};
   out=path.join(storage.ensureDir(pid,'exports'),'depth',jid);await fs.promises.mkdir(out,{recursive:true});
   const rawPath=path.join(out,'depth.f32'),videoPath=path.join(out,'depth-preview.mp4'),manifestPath=path.join(out,'manifest.json');
   await fs.promises.copyFile(raw,rawPath);await fs.promises.copyFile(preview.path,videoPath);const previewHash=await media.hashFile(videoPath,signal);
   metadata.files={raw_sha256:range.sha256,preview_sha256:previewHash,raw_format:'f32le',frame_layout:'frame-major,row-major,one float per pixel',width:p.request.width,height:p.request.height,frame_count:p.request.timing.frame_count};
   await fs.promises.writeFile(manifestPath,JSON.stringify(metadata,null,2));if(signal.aborted)throw media.fail('Cancelled',409);
   db.transaction(()=>{
    if(node(pid,p.request.node_id).revision!==p.request.node_revision)throw media.fail('Depth node changed before publishing',409);
    if(asset(pid,p.request.source_asset_id).version!==p.request.source_version)throw media.fail('Source asset version changed before publishing',409);
    const number=db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM production_depth_versions WHERE node_id=?').get(p.request.node_id).n;
    const rawId=id(),previewId=id(),manifestId=id();
    const add=(aid,file,subtype,mime,format)=>db.prepare(`INSERT INTO film_assets(id,project_id,asset_type,file_path,file_name,format,mime_type,size_bytes,duration_ms,width,height,metadata,version,provider,provider_model) VALUES(?,?,'other',?,?,?,?,?,?,?,?,?,?,?,?)`).run(aid,pid,file,path.basename(file),format,mime,fs.statSync(file).size,Math.round(media.seconds(p.request.timing.duration_ticks,p.request.timing.time_base)*1000),p.request.width,p.request.height,JSON.stringify({typed_asset:subtype,depth_node_id:p.request.node_id,depth_job_id:jid,source_asset_id:p.request.source_asset_id,source_fingerprint:p.request.source_fingerprint,request_fingerprint:p.request.request_fingerprint,fixture:p.backend.fixture===true,orientation}),number,p.backend.provider,p.backend.model);
    add(rawId,rawPath,'DepthSequence','application/octet-stream','f32');add(previewId,videoPath,'DepthPreview','video/mp4','mp4');add(manifestId,manifestPath,'DepthManifest','application/json','json');
    db.prepare('INSERT INTO production_depth_versions(id,project_id,node_id,job_id,version,mode,raw_asset_id,preview_asset_id,manifest_asset_id,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id(),pid,p.request.node_id,jid,number,p.request.mode,rawId,previewId,manifestId,JSON.stringify(metadata));
    db.prepare("UPDATE production_depth_jobs SET status='complete',progress=1,phase='Complete',finished_at=datetime('now') WHERE id=?").run(jid);
   })();
  }catch(e){if(out)await fs.promises.rm(out,{recursive:true,force:true});db.prepare("UPDATE production_depth_jobs SET status=?,error=?,phase=?,finished_at=datetime('now') WHERE id=?").run(signal.aborted?'cancelled':'failed',signal.aborted?null:e.message,signal.aborted?'Cancelled; worker exited':'Depth failed; no version published',jid);}
  finally{if(dir)await fs.promises.rm(dir,{recursive:true,force:true});}
 }
 function cancel(pid,jid){const row=job(pid,jid),task=work.get(jid);if(!ACTIVE.includes(row.status))return row;if(!task)throw media.fail('This depth job belongs to a different live process; cancel it from its owning Film instance',409);
  update(jid,'cancelling',row.progress,'Cancelling; waiting for owned worker to exit');task.controller.abort();return job(pid,jid);
 }
 async function settle(jid){await work.get(jid)?.done;}
 return {catalog,inspectSource,saveNode,readNode,plan,execute,job,cancel,settle,version,publicVersion,versionFile};
}
function graphProjection(db,pid,storage=require('./file-storage')){
 let records;try{records=db.prepare('SELECT * FROM production_depth_nodes WHERE project_id=? ORDER BY created_at,id').all(pid);}catch{return {nodes:[],edges:[],groups:[]};}
 const nodes=[],edges=[],groups=[];
 for(const record of records){
  const source=parse(record.source_json),settings=parse(record.settings_json),key='depth:'+record.id,srcKey='depth-source:'+record.id;
  const asset=db.prepare('SELECT id,file_path,version FROM film_assets WHERE id=? AND project_id=?').get(record.source_asset_id,pid);
  const latest=db.prepare('SELECT * FROM production_depth_versions WHERE node_id=? ORDER BY version DESC LIMIT 1').get(record.id),latestJob=db.prepare('SELECT * FROM production_depth_jobs WHERE node_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(record.id);
  const stale=!asset||asset.version!==source.asset_version;
  nodes.push({key:srcKey,type:'depth-source',id:record.id,asset_id:record.source_asset_id,name:source.file_name || 'Source video',url:asset?storage.urlForPath(asset.file_path):null,source,ports:{out:'VideoAsset'},w:260,h:220});
  nodes.push({key,type:'depth-map',id:record.id,name:'Depth Map',source_asset_id:record.source_asset_id,revision:record.revision,settings,stale,status:latestJob?.status || 'configuration_required',progress:latestJob?.progress || 0,phase:latestJob?.phase || 'Review source and configure a depth backend',ports:{in:'VideoAsset',out:'DepthSequence'},w:280,h:240});
  edges.push({from:srcKey,from_port:'video',to:key,to_port:'source',type:'video',relationship:'depth_source',style:'solid'});
  const members=[srcKey,key];
  if(latest){const m=parse(latest.metadata_json),rawKey='depth-output:'+latest.id,previewKey='depth-preview:'+latest.id;
   const preview=db.prepare('SELECT file_path FROM film_assets WHERE id=?').get(latest.preview_asset_id);
   nodes.push({key:rawKey,type:'depth-output',id:record.id,version_id:latest.id,version:latest.version,role:m.role,fixture:m.fixture,metadata:m,ports:{out:'DepthSequence'},parent:key,w:260,h:220});
   nodes.push({key:previewKey,type:'depth-preview',id:record.id,version_id:latest.id,version:latest.version,url:preview?versionUrl(pid,latest.id,'preview'):null,fixture:m.fixture,role:m.role,ports:{out:'DepthPreview'},parent:key,w:260,h:220});
   members.push(rawKey,previewKey);edges.push({from:key,from_port:'depth',to:rawKey,to_port:'in',type:'depth',relationship:'immutable_depth_origin',style:'solid'},{from:rawKey,from_port:'display',to:previewKey,to_port:'in',type:'depth',relationship:'depth_visualization',style:'solid'});
  }
  groups.push({id:'depth-group:'+record.id,label:'DEPTH · '+(source.file_name || 'source video'),rows:[srcKey,key],shots:[],sequences:[],versions:members.slice(2),sounds:[],links_start:[],links_end:[]});
 }
 return {nodes,edges,groups};
}
function validDepthConnection(from,to){return from?.ports?.out==='VideoAsset'&&to?.type==='depth-map'&&to.ports.in==='VideoAsset';}
module.exports={createDepthService,graphProjection,validDepthConnection,unavailableCatalog,ACTIVE};
