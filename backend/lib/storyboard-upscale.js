const fs=require('fs'), crypto=require('crypto');
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
const LOCAL_TOOL='image-upscale';
const LOCAL_ENGINE_LABEL={ultrasharp:'4x-UltraSharp (this Mac)',realesrgan:'Real-ESRGAN x4plus (this Mac)',gigapixel:'Topaz Gigapixel (this Mac)'};
function localTool(gen){try{return (gen||require('./generators')).getTool(LOCAL_TOOL);}catch(_){return null;}}
/** The engines the installed generator offers, read from its own generator.json. */
function localEngines(gen){const t=localTool(gen);const o=t&&(t.options||[]).find(x=>x.name==='engine');return o?o.choices.map(c=>({value:c.value,label:c.label})):[];}
/** The target, as the long edge the collect step checks: 2K is 2048, 4K is 3840 (the generator's own "4k"). */
function localRequest(d,resolution){const long=Math.max(d.width,d.height),target=resolution==='4K'?3840:2048;return {target_pixels:target,factor:Math.round(target/long*100)/100,model:'AI Image Upscale (this Mac)'};}
/** The generator's size option that reaches the target: the smallest of 2× and 4× that gets there, else its 4k (filing conforms it to the target). */
function localSize(p){if(p.resolution==='4K')return '4k';const long=Math.max(p.source.width,p.source.height);return long*2>=2048?'2':long*4>=2048?'4':'4k';}
function createUpscaleStore(db,deps={}) {
 const runner=deps.runner || ((image,options)=>require('./providers/muapi-topaz-upscale').upscaleImage(image,options));
 const configured=deps.configured || (()=>Boolean(process.env.MUAPI_API_KEY || process.env.SEEDANCE_API_KEY || require('./providers/credentials').getCredential('muapi')?.apiKey));
 const inflight=new Map();
 function shot(id){const row=db.prepare('SELECT sh.*,sc.project_id,p.board_locked_at FROM film_shots sh JOIN film_scenes sc ON sc.id=sh.scene_id JOIN film_projects p ON p.id=sc.project_id WHERE sh.id=?').get(id);if(!row)fail(404,'Shot not found');return row;}
 function plan(id,resolution,provider='muapi') {
  const sh=shot(id);if(!['muapi','local'].includes(provider))fail(400,'Upscale on this Mac (local) or with MuAPI Topaz');
  if(!['2K','4K'].includes(resolution))fail(400,'Choose 2K or 4K');
  const asset=require('./selected-frame').selectedFrame(db,id);if(!asset?.file_path || !fs.existsSync(asset.file_path))fail(409,'This shot has no selected frame on disk');
  const bytes=fs.readFileSync(asset.file_path),dimensions=require('./image-raster').dimensionsOfBuffer(bytes);if(!dimensions)fail(400,'Upscale needs a PNG or JPEG frame');
  // Local: the Generators' AI Image Upscale on this Mac (lib/generators.js). Free; nothing leaves the machine.
  const request=provider==='local'?localRequest(dimensions,resolution):require('./providers/muapi-topaz-upscale').buildUpscaleRequest({...dimensions,resolution,image_url:'https://placeholder.invalid/source'});
  const source_hash=crypto.createHash('sha256').update(bytes).digest('hex');
  const plan_token=crypto.createHash('sha256').update(JSON.stringify([id,asset.id,source_hash,resolution,provider])).digest('hex');
  const target=request.target_pixels,ratio=dimensions.width/dimensions.height;
  const width=dimensions.width>=dimensions.height?target:Math.round(target*ratio),height=dimensions.height>=dimensions.width?target:Math.round(target/ratio);
  return {shot_id:id,source_asset_id:asset.id,source_hash,plan_token,provider,resolution,source:dimensions,output:{width,height},factor:request.factor,model:request.model,configured:provider==='local'?localTool(deps.generators)!==null:configured(),board_locked:Boolean(sh.board_locked_at),estimated_cost:provider==='local'?0:null,cost_note:provider==='local'?'Free: the AI Image Upscale generator runs on this Mac.':'MuAPI credits will be charged. This image endpoint has no verified price estimate here; confirm the provider cost before proceeding.',
   ...(provider==='local'?{engines:localEngines(deps.generators)}:{}),already_at_target:Math.max(dimensions.width,dimensions.height)>=target,existing_job:(()=>{const j=db.prepare('SELECT * FROM film_storyboard_upscale_jobs WHERE plan_token=?').get(plan_token);if(!j)return null;const {result_json,...rest}=j;return {...rest,result:result_json?JSON.parse(result_json):null};})()};
 }
 function get(id,jobId){shot(id);const row=db.prepare('SELECT * FROM film_storyboard_upscale_jobs WHERE id=? AND shot_id=?').get(jobId,id);if(!row)fail(404,'Upscale job not found');const {result_json,...rest}=row;return {...rest,result:result_json?JSON.parse(result_json):null};}
 function update(id,state,extra={}){db.prepare('UPDATE film_storyboard_upscale_jobs SET state=?,request_id=COALESCE(?,request_id),result_json=COALESCE(?,result_json),error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(state,extra.request_id||null,extra.result?JSON.stringify(extra.result):null,extra.error||null,id);}
 async function processJob(job,p) {
  const asset=db.prepare('SELECT * FROM film_assets WHERE id=?').get(job.source_asset_id);
  if(!asset?.file_path || crypto.createHash('sha256').update(fs.readFileSync(asset.file_path)).digest('hex')!==job.source_hash) {update(job.id,'stale',{error:'Source frame changed; no provider submission'});return;}
  if(!job.request_id)update(job.id,'submitting');else update(job.id,'waiting');
  try {
   const bytes=fs.readFileSync(asset.file_path),image=`data:${bytes[0]===0xff?'image/jpeg':'image/png'};base64,${bytes.toString('base64')}`;
   const result=await runner({image,resolution:job.resolution},{finalRequest:job.finalRequest,requestId:job.request_id,onSubmitted:request_id=>update(job.id,'waiting',{request_id})});
   const current=get(job.shot_id,job.id);
   if(!result.ok){update(job.id,current.request_id?'waiting':'uncertain',{error:result.error||'Upscale did not finish'});return;}
   if(!result.file_path || !fs.existsSync(result.file_path))throw new Error('Upscaler returned no durable image');
   const {images,...saved}=result;
   update(job.id,'ready',{result:saved});
   collect(job.shot_id,job.id,p);
  } catch(error){const current=get(job.shot_id,job.id);update(job.id,current.state==='ready'?'ready':current.request_id?'waiting':'uncertain',{error:error.message});}
 }
 function collectUnlocked(id,jobId,p){const j=get(id,jobId);if(j.state==='completed')return j;if(j.state!=='ready')fail(409,'Upscale is not ready');
  const filed=db.prepare("SELECT id FROM film_assets WHERE shot_id=? AND json_valid(metadata) AND json_extract(metadata,'$.collected_from_job')=? LIMIT 1").get(id,jobId);if(filed){update(j.id,'completed',{result:{...j.result,asset:filed.id}});return get(id,j.id);}
  const current=plan(id,j.resolution,j.provider);if(current.source_hash!==j.source_hash||current.source_asset_id!==j.source_asset_id){update(j.id,'ready',{error:'Frame changed while finishing; result kept. Restore the original source version to collect.'});return get(id,j.id);}
  if(current.board_locked){update(j.id,'ready',{error:'Board is locked; result kept. Unlock to collect.'});return get(id,j.id);}
  const delivered=require('./image-raster').readDimensions(j.result.file_path);
  if(!delivered || Math.max(delivered.width,delivered.height)<Math.max(current.output.width,current.output.height) || Math.abs(delivered.width/delivered.height-current.source.width/current.source.height)>0.005){update(j.id,'ready',{error:'Provider output does not reach the target with the source aspect ratio; result kept, clean frame unchanged.'});return get(id,j.id);}
  const save=deps.save || (r=>require('../routes/storyboard').fileCollectedFrame(r));
  const r=save({shotId:id,sourcePath:j.result.file_path,provider:j.provider==='local'?'local':'muapi',providerModel:j.result.model,jobId:j.id,width:current.output.width,height:current.output.height,directionMode:'upscale'});
  if(!r.ok){update(j.id,'ready',{error:r.error});return get(id,j.id);}
  update(j.id,'completed',{result:{...j.result,asset:r.asset || r.asset_id || null,output:current.output}});return get(id,j.id);
 }
 const collectTransaction=db.transaction(collectUnlocked);
 function collect(id,jobId,p){return collectTransaction.immediate(id,jobId,p);}
 const claim=db.transaction((id,b)=>{const p=plan(id,b.resolution,b.provider);if(b.plan_token!==p.plan_token)fail(409,'Frame or target changed; preview and confirm again');if(!p.configured)fail(409,'Configure MuAPI in Setup before upscaling');if(p.board_locked)fail(423,'Board is locked');if(p.already_at_target)fail(409,'Selected frame already reaches this target');if(b.confirmed!==true||b.cost_unknown_ack!==true)fail(400,'Explicit provider and unknown-cost confirmation required');const prior=db.prepare('SELECT * FROM film_storyboard_upscale_jobs WHERE plan_token=?').get(p.plan_token);if(prior)return {job:prior,p,fresh:false};const job={id:crypto.randomUUID(),shot_id:id,...p};db.prepare("INSERT INTO film_storyboard_upscale_jobs (id,shot_id,plan_token,source_asset_id,source_hash,provider,resolution,state) VALUES (?,?,?,?,?,?,?,'queued')").run(job.id,id,p.plan_token,p.source_asset_id,p.source_hash,p.provider,p.resolution);return {job:{...job,state:'queued'},p,fresh:true};});
 function start(id,b){
  if(b.provider==='local')return startLocal(id,b);
  const initial=plan(id,b.resolution,b.provider);
  if(!initial.configured)fail(409,'Configure MuAPI in Setup before upscaling');
  if(initial.board_locked)fail(423,'Board is locked');
  if(initial.already_at_target)fail(409,'Selected frame already reaches this target');
  if(deps.runner){const c=claim.immediate(id,b);if(c.fresh)launch(c.job,c.p);return get(id,c.job.id);}
  return startReviewed(id,b);
 }
 /*
  * ON THIS MAC: the Generators' AI Image Upscale (4x-UltraSharp, Real-ESRGAN, or the person's own Topaz
  * Gigapixel). Free, so there is no paid confirmation; the result goes through the same collect as any
  * other upscale (the frame unchanged, the board unlocked, the target reached at the source's aspect).
  */
 const claimLocal=db.transaction((id,b)=>{const p=plan(id,b.resolution,'local');if(b.plan_token&&b.plan_token!==p.plan_token)fail(409,'Frame or target changed; preview again');if(!p.configured)fail(409,'The AI Image Upscale generator is not installed (Production › Generators)');if(p.board_locked)fail(423,'Board is locked');if(p.already_at_target)fail(409,'Selected frame already reaches this target');
  const prior=db.prepare("SELECT * FROM film_storyboard_upscale_jobs WHERE plan_token=? AND state NOT IN ('failed','stale','handed_over')").get(p.plan_token);if(prior)return {job:prior,p,fresh:false};
  db.prepare('DELETE FROM film_storyboard_upscale_jobs WHERE plan_token=?').run(p.plan_token);
  const job={id:crypto.randomUUID(),shot_id:id,...p};db.prepare("INSERT INTO film_storyboard_upscale_jobs (id,shot_id,plan_token,source_asset_id,source_hash,provider,resolution,state) VALUES (?,?,?,?,?,?,?,'queued')").run(job.id,id,p.plan_token,p.source_asset_id,p.source_hash,'local',p.resolution);return {job:{...job,state:'queued'},p,fresh:true};});
 function startLocal(id,b){
  const engine=String(b.engine||'ultrasharp');
  if(!localEngines(deps.generators).some(e=>e.value===engine))fail(400,`Unknown local upscaler: ${engine}`);
  const c=claimLocal.immediate(id,b);
  if(c.fresh&&!inflight.has(c.job.id)){const promise=processLocal(c.job,c.p,engine,Number.isFinite(Number(b.grain))?Number(b.grain):0).finally(()=>inflight.delete(c.job.id));inflight.set(c.job.id,promise);}
  return get(id,c.job.id);
 }
 async function processLocal(job,p,engine,grain){
  const gen=deps.generators||require('./generators');
  const asset=db.prepare('SELECT * FROM film_assets WHERE id=?').get(job.source_asset_id);
  if(!asset?.file_path||crypto.createHash('sha256').update(fs.readFileSync(asset.file_path)).digest('hex')!==job.source_hash){update(job.id,'stale',{error:'Source frame changed; nothing was upscaled'});return;}
  try{
   update(job.id,'submitting');
   const input=gen.probeInput(asset.file_path);
   const options={engine,grain,...(engine==='gigapixel'?{}:{size:localSize(p)})};
   const g=gen.createJob({tool:LOCAL_TOOL,input_id:input.id,options});
   update(job.id,'waiting',{request_id:'generator:'+g.id});
   for(;;){
    await new Promise(r=>setTimeout(r,deps.pollMs||1000));
    const now=gen.publicJob(gen.getJob(g.id));
    if(now.status==='queued'||now.status==='running')continue;
    if(now.status!=='done'){update(job.id,'failed',{error:`The upscaler ${now.status}${now.error?': '+now.error:''}`});return;}
    const out=(now.outputs||[]).find(f=>fs.existsSync(f));
    // Gigapixel opens the frame in Topaz; the person exports it there and imports it as a new version.
    if(!out){update(job.id,'handed_over',{error:engine==='gigapixel'?'Opened in Topaz Gigapixel. Export it there, then import it on this shot as a new frame version.':'The upscaler finished without a file'});return;}
    update(job.id,'ready',{result:{file_path:out,model:LOCAL_ENGINE_LABEL[engine]||engine,generator_job:g.id}});
    collect(job.shot_id,job.id,p);return;
   }
  }catch(error){update(job.id,'failed',{error:error.message});}
 }
 async function startReviewed(id,b){
  let authorization;
  if(!deps.runner){
   const p=plan(id,b.resolution,b.provider),asset=db.prepare('SELECT file_path FROM film_assets WHERE id=?').get(p.source_asset_id);
   authorization=await require('./final-request-review').authorizeGeneration({provider:'muapi-upscale',capability:'image-upscale',payload:{image:require('./reference-images').toDataUri(asset.file_path),resolution:p.resolution},provenance:{shot_id:id,project_id:shot(id).project_id}});
   if(!authorization.ok)fail(authorization.status,authorization.error);
  }
  const c=claim.immediate(id,b);if(c.fresh)launch({...c.job,finalRequest:authorization?.finalRequest},c.p);return get(id,c.job.id);
 }
 function launch(j,p){if(inflight.has(j.id))return;const promise=processJob(j,p).finally(()=>inflight.delete(j.id));inflight.set(j.id,promise);}
 function retry(id,jobId){const j=get(id,jobId);if(inflight.has(j.id)||j.state==='completed')return j;if(j.state==='ready')return collect(id,jobId);if(!j.request_id)fail(409,'No confirmed provider handle. Do not resubmit an uncertain paid request; check provider history.');launch(j,plan(id,j.resolution,j.provider));return get(id,jobId);}
 return {plan,get,start,retry,collect,wait:async id=>{await inflight.get(id);}};
}
let singleton;
function store(){return singleton ||= createUpscaleStore(require('../db/database').db);}
module.exports={createUpscaleStore,store};
