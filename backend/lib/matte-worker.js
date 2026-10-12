const fs=require('node:fs'),path=require('node:path');
const {fail,hashFile,digest,processOutput,seconds}=require('./depth-media');
const {runOwnedWorker}=require('./local-sequence-worker');
const CONTRACT='film-matte-worker-v1';
function validateMatteDescriptor(d,{allowFixture=false}={}){
 if(d?.contract!==CONTRACT||d.operation!=='subject_alpha'||d.raw_format!=='f32le'||d.alpha_mode!=='straight'||d.output_coordinates!=='encoded'||d.source_timestamps!==true||d.network_uploads!==false||d.paid!==false)throw fail('Matte worker must provide straight float alpha, encoded coordinates, exact timing and no paid/upload dispatch',503);
 if(d.fixture&&!allowFixture)throw fail('Synthetic matte fixtures are unavailable in production',503);
 for(const k of ['provider','model','revision','license'])if(typeof d[k]!=='string'||!d[k].trim()||d[k].length>200)throw fail('Matte descriptor requires '+k,503);
 if(!['framewise','recurrent','temporal'].includes(d.temporal_behavior))throw fail('Matte worker must state its actual temporal behavior',503);
 if(!/^[0-9a-f]{64}$/i.test(d.model_sha256||''))throw fail('Matte worker requires pinned model bytes',503);
 if(!d.fixture){if(d.backend!=='pytorch-mps-fp32'||!d.supported_devices?.includes('mps')||d.gpu_required_when_selected!==true||d.cpu_neural_fallback!==false)throw fail('Subject Matte requires explicit MPS GPU inference without CPU neural fallback',503);for(const k of ['worker_sha256','source_manifest_sha256'])if(!/^[0-9a-f]{64}$/i.test(d[k]||''))throw fail('Matte worker requires reviewed code pins',503);}
 for(const k of ['max_width','max_height','max_frames','max_raw_bytes','max_output_pixels','max_source_pixels','max_model_pixels','model_input_size_min','model_input_size_max'])if(!Number.isSafeInteger(d[k])||d[k]<1)throw fail('Matte descriptor requires a positive '+k,503);
 if(!Number.isFinite(d.max_duration_seconds)||d.max_duration_seconds<=0)throw fail('Matte descriptor requires a positive max_duration_seconds',503);
 if(d.model_input_size_multiple!=null&&(!Number.isSafeInteger(d.model_input_size_multiple)||d.model_input_size_multiple<1))throw fail('Matte descriptor requires a positive model input multiple',503);
 if(d.model_input_size_min>d.model_input_size_max)throw fail('Matte input limits are reversed',503);
 return {...d,available:true};
}
function admitMatte(d,r){const n=r.settings?.model_input_size;if(r.settings?.device!=='mps')throw fail('Subject Matte requires an explicit MPS selection');if(!Number.isInteger(n)||n<d.model_input_size_min||n>d.model_input_size_max||n%(d.model_input_size_multiple||1)!==0)throw fail('Matte model input size exceeds the installed worker limits');if((r.timing.coded_width||r.timing.width)*(r.timing.coded_height||r.timing.height)>d.max_source_pixels||n*n>d.max_model_pixels||seconds(r.timing.duration_ticks,r.timing.time_base)>d.max_duration_seconds)throw fail('Matte source, model grid or duration exceeds the audited worker limits');const pixels=r.width*r.height,bytes=pixels*r.timing.frame_count*4;if(!Number.isSafeInteger(bytes)||r.width>d.max_width||r.height>d.max_height||r.timing.frame_count>d.max_frames||pixels>d.max_output_pixels||bytes>d.max_raw_bytes)throw fail('Matte range and output resolution exceed the installed worker limits');return {raw_bytes:bytes,output_pixels:pixels};}
function validateMatteProvenance(d,r,p){if(d.fixture)return;if(!p||p.backend!=='mps'||p.cpu_neural_fallback!==false||!/^mps(?::\d+)?$/.test(p.neural_device||'')||p.request_fingerprint!==r.request_fingerprint||p.source_sha256!==r.source_sha256||p.model_input_size!==r.settings.model_input_size)throw fail('Matte GPU provenance differs from the reviewed request or device');for(const k of ['model_sha256','worker_sha256','source_manifest_sha256'])if(p[k]!==d[k])throw fail('Matte GPU provenance differs from reviewed code/model pins');if(p.precision!=='float32'||!Number.isSafeInteger(p.gpu_forward_hook_calls)||p.gpu_forward_hook_calls<1||!Number.isSafeInteger(p.gpu_dispatch_output_tensors)||p.gpu_dispatch_output_tensors<1)throw fail('Matte provenance lacks positive GPU execution evidence');}
function createMatteWorker({env=process.env,allowFixture=false}={}){
 const bin=env.FILM_MATTE_WORKER,workerEnv={PATH:env.PATH||'/usr/bin:/bin',FILM_MATTE_MODEL_SHA256:env.FILM_MATTE_MODEL_SHA256,GRIDLIGHT_MATTE_DEVICE:'mps',PYTORCH_ENABLE_MPS_FALLBACK:'0'};
 const unavailable=reason=>({available:false,contract:CONTRACT,reason});
 async function describe(){
  if(env.FILM_MATTE_ENABLED!=='1'||!bin)return unavailable('Subject Matte model unavailable. Install and explicitly configure a reviewed GPU worker after owner approval.');
  if(!path.isAbsolute(bin)||!fs.existsSync(bin))return unavailable('Configured Subject Matte executable is missing');
  try{const before=await hashFile(bin),d=validateMatteDescriptor(JSON.parse((await processOutput(bin,['--describe'],{env:workerEnv,timeoutMs:10000,maxBytes:16384})).toString()),{allowFixture});if(d.model_sha256!==env.FILM_MATTE_MODEL_SHA256)throw fail('Matte model checksum does not match the configured pin',503);const after=await hashFile(bin);if(before!==after)throw fail('Matte worker changed during inspection',409);return {...d,executable_sha256:after,fingerprint:digest({descriptor:d,executable_sha256:after})};}catch(e){return unavailable(e.message);}
 }
 async function run(request,options){const d=await describe();if(!d.available)throw fail(d.reason,503);if(options.expectedFingerprint&&options.expectedFingerprint!==d.fingerprint)throw fail('Matte worker changed after plan review',409);admitMatte(d,request);return runOwnedWorker(bin,request,{...options,env:workerEnv,label:'Matte'});}
 return {describe,run};
}
module.exports={CONTRACT,createMatteWorker,validateMatteDescriptor,validateMatteProvenance,admitMatte};
