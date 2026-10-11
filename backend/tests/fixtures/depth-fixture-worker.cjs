#!/usr/bin/env node
// TEST ONLY: deterministic floating values validate transport/timing, not inferred depth quality.
const fs=require('fs'),path=require('path');
const descriptor={contract:'film-depth-worker-v1',operation:'temporal_video_depth',provider:'synthetic-local-fixture',model:'fixture-gradient',revision:'test-v1',license:'test-only',model_sha256:'0'.repeat(64),network_uploads:false,paid:false,temporal_consistency:true,source_timestamps:true,raw_format:'f32le',fixture:true,max_width:4096,max_height:4096,max_frames:1000};
if(process.argv.includes('--describe')){console.log(JSON.stringify(descriptor));process.exit(0);}
let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>text+=s);process.stdin.on('end',async()=>{
 try{
  const r=JSON.parse(text),file=path.join(r.output_dir,'raw.f32'),size=r.width*r.height,buf=Buffer.alloc(size*4),fd=fs.openSync(file,'w');
  if(process.argv[1].includes('slow'))await new Promise(resolve=>setTimeout(resolve,10000));
  for(let f=0;f<r.timing.frame_count;f++){
   for(let p=0;p<size;p++)buf.writeFloatLE(process.argv[1].includes('invalid')?NaN:f*.25+(p%r.width)/r.width,p*4);
   fs.writeSync(fd,buf);console.log(JSON.stringify({type:'progress',progress:(f+1)/r.timing.frame_count,phase:'SYNTHETIC TEST · frame '+(f+1)}));
  }
  fs.closeSync(fd);console.log(JSON.stringify({type:'result',request_fingerprint:r.request_fingerprint,source_fingerprint:r.source_fingerprint,raw_file:'raw.f32',depth_kind:'relative_inverse_depth',timing:{...r.timing,width:r.width,height:r.height}}));
 }catch(e){console.log(JSON.stringify({type:'error',message:e.message}));process.exitCode=1;}
});
