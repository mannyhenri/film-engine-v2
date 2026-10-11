const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createWorker,validateDescriptor,validateDevice,validateGpuProvenance}=require('../lib/depth-worker');
const {validateAdmission}=require('../lib/depth-admission');
const pin='0'.repeat(64),root=fs.mkdtempSync(path.join(os.tmpdir(),'film-gpu-contract-'));
const descriptor={contract:'film-depth-worker-v1',operation:'temporal_video_depth',provider:'gridlight-local',model:'Video-Depth-Anything-Small',revision:'test-gpu-contract',license:'Apache-2.0',model_sha256:pin,temporal_consistency:true,source_timestamps:true,network_uploads:false,paid:false,raw_format:'f32le',fixture:false,backend:'pytorch-mps-fp32',supported_devices:['cpu','mps'],gpu_required_when_selected:true,gpu_max_model_pixels:500000,max_model_pixels:500000,worker_sha256:pin,source_manifest_sha256:pin,adapter_sha256:{'mps_compat.py':pin,'mps_backend.py':pin},max_width:1920,max_height:1920,max_frames:1800,max_raw_bytes:536870912,max_output_pixels:2073600,model_input_size_min:128,model_input_size_max:518};
const request={request_fingerprint:'reviewed',source_sha256:pin,width:640,height:360,settings:{device:'mps',model_input_size:518},timing:{width:3840,height:2160,display_rotation_degrees:-90,frame_count:32,duration_ticks:801,time_base:{numerator:1,denominator:600}}};
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('GPU selection rejects legacy CPU descriptors and implicit auto/device fallback',()=>{
 const good=validateDescriptor(descriptor);assert.equal(good.backend,'pytorch-mps-fp32');
 for(const change of [{backend:'pytorch-cpu-fp32'},{supported_devices:['cpu']},{gpu_required_when_selected:false},{gpu_max_model_pixels:0},{adapter_sha256:{}}])assert.throws(()=>validateDescriptor({...descriptor,...change}),/GPU|MPS|adapter/);
 for(const device of [undefined,'auto','cpu','cuda'])assert.throws(()=>validateDevice(good,{device}),/explicit MPS/);
 assert.doesNotThrow(()=>validateDevice(good,{device:'mps'}));
});
test('518 is admitted only by the audited GPU grid, all output-byte guards remain',()=>{
 assert.equal(validateAdmission(descriptor,request).model_grid.pixels,478632);
 assert.throws(()=>validateAdmission({...descriptor,max_model_pixels:300000},request),/model grid/);
 assert.throws(()=>validateAdmission(descriptor,{...request,width:3840,height:2160}),/range and resolution/);
 assert.throws(()=>validateAdmission(descriptor,{...request,width:1280,height:720,timing:{...request.timing,frame_count:270}}),/byte limit/);
});
test('only current pinned GPU execution provenance can be published',()=>{
 const p={request_fingerprint:'reviewed',source_sha256:pin,model_sha256:pin,worker_sha256:pin,source_manifest_sha256:pin,adapter_sha256:descriptor.adapter_sha256,backend:'mps',neural_device:'mps:0',cpu_neural_fallback:false,precision:'float32',model_input_size:518,gpu_dispatch_output_tensors:1,gpu_forward_hook_calls:1};
 assert.doesNotThrow(()=>validateGpuProvenance(descriptor,request,p));
 for(const change of [{backend:'cpu'},{cpu_neural_fallback:true},{neural_device:'cpu'},{worker_sha256:'1'.repeat(64)},{adapter_sha256:{'mps_compat.py':pin,'mps_backend.py':'1'.repeat(64)}},{gpu_dispatch_output_tensors:0}])assert.throws(()=>validateGpuProvenance(descriptor,request,{...p,...change}),/GPU|provenance|pin|adapter/);
});
function executable(kind){const p=path.join(root,'worker-'+kind);fs.writeFileSync(p,'#!'+process.execPath+'\nconst fs=require("fs");\nconst d='+JSON.stringify(descriptor)+';\nif(process.argv.includes("--describe")){console.log(JSON.stringify(d));process.exit(0);}\nlet text="";process.stdin.on("data",x=>text+=x);process.stdin.on("end",()=>{const r=JSON.parse(text);if(r.settings.device!=="mps"||process.env.GRIDLIGHT_DEPTH_DEVICE!=="mps"||process.env.PYTORCH_ENABLE_MPS_FALLBACK!=="0")throw Error("GPU request boundary missing");fs.appendFileSync('+JSON.stringify(path.join(root,'attempts-'+kind))+',"mps\\n");'+(kind==='cancel'?'setTimeout(()=>{},10000);':'console.log(JSON.stringify({type:"error",message:'+JSON.stringify(kind==='missing-gpu'?'MPS GPU unavailable':'Unsupported neural operation; CPU fallback forbidden')+'}));')+'});\n');fs.chmodSync(p,0o700);return p;}
test('unavailable GPU and unsupported operator fail once with no CPU retry',async()=>{
 for(const kind of ['missing-gpu','unsupported-op']){const w=createWorker({env:{FILM_DEPTH_ENABLED:'1',FILM_DEPTH_WORKER:executable(kind),FILM_DEPTH_MODEL_SHA256:pin}});assert.equal((await w.describe()).available,true);await assert.rejects(w.run(request,{signal:new AbortController().signal,onProgress:()=>{},outputDir:root}),kind==='missing-gpu'?/GPU unavailable/:/fallback forbidden/);assert.equal(fs.readFileSync(path.join(root,'attempts-'+kind),'utf8'),'mps\n');}
});
test('GPU cancellation reaps owned worker; missing executable is unavailable',async()=>{
 assert.equal((await createWorker({env:{FILM_DEPTH_ENABLED:'1',FILM_DEPTH_WORKER:path.join(root,'missing'),FILM_DEPTH_MODEL_SHA256:pin}}).describe()).available,false);
 const w=createWorker({env:{FILM_DEPTH_ENABLED:'1',FILM_DEPTH_WORKER:executable('cancel'),FILM_DEPTH_MODEL_SHA256:pin}}),signal=new AbortController();await w.describe();const running=w.run(request,{signal:signal.signal,onProgress:()=>{},outputDir:root});setTimeout(()=>signal.abort(),100);await assert.rejects(running,/Cancelled/);
});
