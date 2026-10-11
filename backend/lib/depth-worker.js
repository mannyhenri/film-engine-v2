const fs=require('fs');
const path=require('path');
const {runOwnedWorker}=require('./local-sequence-worker');
const {fail,digest,hashFile,processOutput}=require('./depth-media');
const {validateAdmission}=require('./depth-admission');
const CONTRACT='film-depth-worker-v1';
const unavailable=reason=>({available:false,reason,kind:'local',contract:CONTRACT});
function validateDescriptor(d,{allowFixture=false}={}){
 if(d?.contract!==CONTRACT||d.operation!=='temporal_video_depth'||d.network_uploads!==false||d.paid!==false||d.temporal_consistency!==true||d.raw_format!=='f32le'||d.source_timestamps!==true)throw fail('Worker must supply temporal float depth, exact source timing, and no upload or paid dispatch',503);
 if(d.fixture===true&&!allowFixture)throw fail('Synthetic fixture workers are not production depth backends',503);
 if(d.fixture!==true){
  if(d.backend!=='pytorch-mps-fp32'||!d.supported_devices?.includes('mps')||d.gpu_required_when_selected!==true)throw fail('Depth Map requires the explicit MPS GPU worker; CPU neural inference is not enabled',503);
  if(!Number.isSafeInteger(d.gpu_max_model_pixels)||d.gpu_max_model_pixels<1||d.max_model_pixels!==d.gpu_max_model_pixels)throw fail('GPU model-grid limits must match the selected MPS backend',503);
  for(const key of ['worker_sha256','source_manifest_sha256'])if(!/^[0-9a-f]{64}$/i.test(d[key]||''))throw fail('GPU descriptor requires current code pins',503);
  for(const key of ['mps_compat.py','mps_backend.py'])if(!/^[0-9a-f]{64}$/i.test(d.adapter_sha256?.[key]||''))throw fail('GPU descriptor requires pinned adapter checksums',503);
 }
 for(const k of ['provider','model','revision','license'])if(typeof d[k]!=='string'||!d[k].trim()||d[k].length>200)throw fail(`Worker descriptor requires ${k}`,503);
 if(!/^[0-9a-f]{64}$/i.test(d.model_sha256))throw fail('Worker descriptor requires a pinned model checksum',503);
 for(const k of ['max_width','max_height','max_frames'])if(!Number.isInteger(d[k])||d[k]<1)throw fail(`Worker requires a valid ${k} limit`,503);
 for(const k of ['max_output_pixels','max_raw_bytes','max_source_pixels','max_model_pixels'])if(d[k]!=null&&(!Number.isSafeInteger(d[k])||d[k]<1))throw fail(`Worker requires a valid ${k} limit`,503);
 if(d.max_duration_seconds!=null&&(!Number.isFinite(d.max_duration_seconds)||d.max_duration_seconds<=0))throw fail('Worker requires a valid duration limit',503);
 for(const k of ['model_input_size_min','model_input_size_max'])if(d[k]!=null&&(!Number.isInteger(d[k])||d[k]<1))throw fail(`Worker requires a valid ${k} limit`,503);
 if(d.model_input_size_min!=null&&d.model_input_size_max!=null&&d.model_input_size_min>d.model_input_size_max)throw fail('Worker model input limits are reversed',503);
 return {...d,available:true,fingerprint:digest(d)};
}
function validateModelInput(descriptor,settings){
 const size=settings?.model_input_size;
 if((descriptor.model_input_size_min!=null&&(!Number.isInteger(size)||size<descriptor.model_input_size_min))||(descriptor.model_input_size_max!=null&&(!Number.isInteger(size)||size>descriptor.model_input_size_max)))throw fail('Model input size is outside the configured worker limits');
}
function validateDevice(descriptor,settings){
 if(settings?.device!=='mps')throw fail('Review and save an explicit MPS GPU selection; automatic or CPU neural inference is unavailable');
 if(!descriptor.fixture&&(!descriptor.supported_devices?.includes('mps')||descriptor.gpu_required_when_selected!==true))throw fail('Configured worker does not guarantee required MPS GPU inference',503);
}
function validateGpuProvenance(descriptor,request,p){
 if(descriptor.fixture)return;
 if(!p||p.backend!=='mps'||p.cpu_neural_fallback!==false||!/^mps(?::\d+)?$/.test(p.neural_device||'')||p.precision!=='float32')throw fail('Worker GPU provenance does not confirm MPS execution without CPU neural fallback');
 for(const key of ['model_sha256','worker_sha256','source_manifest_sha256'])if(p[key]!==descriptor[key])throw fail('Worker GPU provenance code/model pin differs from the reviewed backend');
 for(const key of ['mps_compat.py','mps_backend.py'])if(p.adapter_sha256?.[key]!==descriptor.adapter_sha256[key])throw fail('Worker GPU adapter pin differs from the reviewed backend');
 if(p.request_fingerprint!==request.request_fingerprint||p.source_sha256!==request.source_sha256||p.model_input_size!==request.settings.model_input_size)throw fail('Worker GPU provenance differs from the reviewed request');
 for(const key of ['gpu_dispatch_output_tensors','gpu_forward_hook_calls'])if(!Number.isSafeInteger(p[key])||p[key]<1)throw fail('Worker GPU provenance lacks positive neural device evidence');
}
function createWorker({env=process.env,allowFixture=false}={}){
 const bin=env.FILM_DEPTH_WORKER;
 const workerEnv={PATH:env.PATH || '/usr/bin:/bin',FILM_DEPTH_MODEL_SHA256:env.FILM_DEPTH_MODEL_SHA256,GRIDLIGHT_DEPTH_DEVICE:'mps',PYTORCH_ENABLE_MPS_FALLBACK:'0'};
 async function describe(){
  if(env.FILM_DEPTH_ENABLED!=='1'||!bin)return unavailable('Depth backend unavailable. Configure and explicitly enable a verified local temporal depth worker.');
  if(!path.isAbsolute(bin)||!fs.existsSync(bin))return unavailable('Configured depth worker executable does not exist.');
  try{
   const before=await hashFile(bin);
   const raw=await processOutput(bin,['--describe'],{timeoutMs:10000,maxBytes:16384,env:workerEnv});
   const descriptor=validateDescriptor(JSON.parse(raw.toString()),{allowFixture});
   if(!env.FILM_DEPTH_MODEL_SHA256||descriptor.model_sha256!==env.FILM_DEPTH_MODEL_SHA256)throw fail('Configured model checksum does not match the worker descriptor',503);
   const executable_sha256=await hashFile(bin);if(before!==executable_sha256)throw fail('Configured GPU worker changed during inspection',409);return {...descriptor,executable_sha256,fingerprint:digest({descriptor,executable_sha256})};
  }catch(e){return unavailable(e.message);}
 }
 async function run(request,{signal,onProgress,outputDir,expectedFingerprint}){
  const descriptor=await describe();if(!descriptor.available)throw fail(descriptor.reason,503);
  if(expectedFingerprint&&descriptor.fingerprint!==expectedFingerprint)throw fail('Configured GPU worker changed after review',409);
  if(await hashFile(bin)!==descriptor.executable_sha256)throw fail('Configured worker changed after review',409);
  validateDevice(descriptor,request.settings);
  validateModelInput(descriptor,request.settings);
  validateAdmission(descriptor,request);
  return runOwnedWorker(bin,request,{env:workerEnv,signal,onProgress,outputDir,label:'Depth'});
 }
 return {describe,run};
}
module.exports={CONTRACT,validateDescriptor,validateModelInput,validateDevice,validateGpuProvenance,createWorker};
