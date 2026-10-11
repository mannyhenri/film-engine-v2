const fs=require('node:fs'),path=require('node:path');
const media=require('./depth-media');
const {planComposite}=require('./composite-contract');
const clamp=n=>Math.max(0,Math.min(1,n));
function check(signal){if(signal?.aborted)throw media.fail('Cancelled',409);}
async function verifyInput(a,signal){const stat=await fs.promises.lstat(a.file_path);if(!stat.isFile()||stat.isSymbolicLink())throw media.fail('Processing input must be a regular resolved asset file');if(await media.hashFile(a.file_path,signal)!==a.sha256)throw media.fail('Processing input bytes changed after review',409);}
function polygonContains(x,y,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [xi,yi]=points[i],[xj,yj]=points[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}return inside;}
async function yieldPixels(signal){check(signal);await new Promise(resolve=>setImmediate(resolve));check(signal);}
async function refineAlpha(raw,width,height,settings,sourceFrame,signal){
 check(signal);let a=new Float32Array(width*height);
 for(let i=0;i<a.length;i++){
  const v=raw.readFloatLE(i*4);if(!Number.isFinite(v)||v<0||v>1)throw media.fail('AlphaSequence contains nonfinite or out-of-range alpha');a[i]=v;
  if((i+1)%16384===0)await yieldPixels(signal);
 }
 for(const c of settings.corrections){
  if(sourceFrame<c.start_frame||sourceFrame>=c.end_frame_exclusive)continue;
  const xs=c.points.map(p=>p[0]),ys=c.points.map(p=>p[1]);
  const left=Math.max(0,Math.floor(Math.min(...xs)*width)),right=Math.min(width,Math.ceil(Math.max(...xs)*width)),top=Math.max(0,Math.floor(Math.min(...ys)*height)),bottom=Math.min(height,Math.ceil(Math.max(...ys)*height));
  for(let y=top;y<bottom;y++){
   for(let x=left;x<right;x++)if(polygonContains((x+.5)/width,(y+.5)/height,c.points))a[y*width+x]=c.mode==='include'?1:0;
   if((y-top+1)%8===0)await yieldPixels(signal);
  }
 }
 const radius=Math.abs(settings.choke_px);
 if(radius)for(const horizontal of [true,false]){
  const b=new Float32Array(a.length);
  for(let y=0;y<height;y++){
   for(let x=0;x<width;x++){
    let value=settings.choke_px>0?1:0;
    for(let offset=-radius;offset<=radius;offset++){
     const xx=horizontal?Math.max(0,Math.min(width-1,x+offset)):x,yy=horizontal?y:Math.max(0,Math.min(height-1,y+offset));
     value=settings.choke_px>0?Math.min(value,a[yy*width+xx]):Math.max(value,a[yy*width+xx]);
    }
    b[y*width+x]=value;
   }
   if((y+1)%8===0)await yieldPixels(signal);
  }
  a=b;
 }
 const blur=settings.feather_px;
 if(blur)for(const horizontal of [true,false]){
  const b=new Float32Array(a.length),lines=horizontal?height:width,length=horizontal?width:height;
  for(let line=0;line<lines;line++){
   const at=i=>horizontal?line*width+i:i*width+line;let total=0;
   for(let i=-blur;i<=blur;i++)total+=a[at(Math.max(0,Math.min(length-1,i)))];
   for(let i=0;i<length;i++){
    b[at(i)]=total/(blur*2+1);total-=a[at(Math.max(0,i-blur))];total+=a[at(Math.min(length-1,i+blur+1))];
   }
   if((line+1)%8===0)await yieldPixels(signal);
  }
  a=b;
 }
 check(signal);return a;
}
async function blendFrame(source,alpha,background,foreground,depth,settings,frame,signal){
 check(signal);
 const pixels=alpha.length,rgb=Buffer.alloc(pixels*3),rgba=Buffer.alloc(pixels*4),exposureGain=2**settings.exposure,inverseGamma=1/settings.gamma;let seed=(settings.grain_seed+frame*1664525)>>>0;
 for(let p=0;p<pixels;p++){
  const src=[source[p*3]/255,source[p*3+1]/255,source[p*3+2]/255],lum=.2126*src[0]+.7152*src[1]+.0722*src[2],a=alpha[p];
  const fgAlpha=foreground?foreground[p*4+3]/255:0;let subjectNearer=false;
  if(depth){const d=depth.readFloatLE(p*4);if(!Number.isFinite(d))throw media.fail('DepthSequence contains nonfinite depth');subjectNearer=settings.foreground_inverse_depth!=null&&d>settings.foreground_inverse_depth;}
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;const grain=(seed/4294967296-.5)*settings.grain;
  for(let c=0;c<3;c++){
   const corrected=clamp(Math.pow(clamp(((lum+(src[c]-lum)*settings.saturation)*exposureGain*settings.light_rgb_gain[c]-.5)*settings.contrast+.5),inverseGamma));
   const base=background[p*3+c]/255,fgColour=foreground?foreground[p*4+c]/255:0,subject=corrected*a+base*(1-a),layered=!foreground?subject:subjectNearer?corrected*a+(fgColour*fgAlpha+base*(1-fgAlpha))*(1-a):fgColour*fgAlpha+subject*(1-fgAlpha);
   rgb[p*3+c]=Math.round(clamp(layered+grain)*255);rgba[p*4+c]=Math.round(corrected*255);
  }
  rgba[p*4+3]=Math.round(a*255);
  if((p+1)%4096===0)await yieldPixels(signal);
 }
 check(signal);return {rgb,rgba};
}
function plateFilters(plan){const {display_width:w,display_height:h,display_rotation_degrees:angle}=plan.orientation;let fit=plan.settings.plate_fit==='stretch'?`scale=${w}:${h}`:plan.settings.plate_fit==='cover'?`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`:`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`;if(angle===90)fit+=',transpose=1';if(angle===-90)fit+=',transpose=2';if(angle===180)fit+=',hflip,vflip';return fit;}
async function exactVideo(ff,raw,out,plan,signal,{foreground=false}={}){
 const t=plan.timing,{width,height}=plan.settings,angle=t.display_rotation_degrees??0,encoded=angle?out+'.encoded'+path.extname(out):out;
 await media.processOutput(ff,['-nostdin','-v','error','-y','-f','rawvideo','-pixel_format',foreground?'rgba':'rgb24','-video_size',`${width}x${height}`,'-framerate',`${t.fps.numerator}/${t.fps.denominator}`,'-i',raw,'-frames:v',String(t.frame_count),'-fps_mode','passthrough','-enc_time_base',`${t.time_base.numerator}/${t.time_base.denominator}`,'-c:v',foreground?'qtrle':'libx264',...(foreground?['-pix_fmt','argb']:['-bf','0','-pix_fmt',width%2||height%2?'yuv444p':'yuv420p']),'-bsf:v',media.timestampExpressions(t),'-video_track_timescale',String(t.time_base.denominator),'-movflags','+faststart',encoded],{signal,timeoutMs:600000});
 if(angle){await media.processOutput(ff,['-nostdin','-v','error','-y','-copyts','-noautorotate','-display_rotation',String(angle),'-i',encoded,'-map','0:v:0','-c:v','copy','-video_track_timescale',String(t.time_base.denominator),'-movflags','+faststart',out],{signal,timeoutMs:600000});await fs.promises.rm(encoded);}
 const actual=await media.inspectVideo(out,{signal});media.sameTiming(t,actual,{tolerance:1e-9});return actual;
}
async function renderComposite(recipe,outputDir,{signal,onProgress=()=>{},allowFixture=false,keepWorkFiles=false}={}){
 const plan=planComposite(recipe,{allowFixture}),r=plan.recipe,{width,height}=plan.settings,pixels=width*height;
 if((await fs.promises.readdir(outputDir)).length)throw media.fail('Composite output directory must be fresh and empty');
 const ff=require('./ffmpeg').resolveFfmpeg();if(!ff.available)throw media.fail('Local FFmpeg compositor unavailable',503);
 const inputs=['source','alpha','background','foreground','depth'].map(k=>r[k]).filter(Boolean);
 for(const input of inputs)await verifyInput(input,signal);
 const disk=await fs.promises.statfs(outputDir);if(plan.estimated_work_bytes*2+32*1024*1024>disk.bavail*disk.bsize)throw media.fail('Insufficient disk for the reviewed composite range',507);
 const inputRgb=path.join(outputDir,'source.rgb'),bgRgb=path.join(outputDir,'background.rgb'),fgRgba=path.join(outputDir,'foreground.rgba'),resultRgb=path.join(outputDir,'composite.rgb'),subjectRgba=path.join(outputDir,'subject.rgba'),refinedPath=path.join(outputDir,'refined-alpha.f32');
 onProgress(.02,'Verifying inputs and decoding the selected source range');
 await media.processOutput(ff.bin,['-nostdin','-v','error','-y','-noautorotate','-i',r.source.file_path,'-vf',`select='between(n,${plan.timing.start_frame},${plan.timing.end_frame_exclusive-1})',scale=${width}:${height}`,'-frames:v',String(plan.timing.frame_count),'-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo',inputRgb],{signal,timeoutMs:600000});
 if(fs.statSync(inputRgb).size!==pixels*3*plan.timing.frame_count)throw media.fail('Source decoder did not preserve the selected frame count');
 for(const [plate,file,format] of [[r.background,bgRgb,'rgb24'],[r.foreground,fgRgba,'rgba']])if(plate)await media.processOutput(ff.bin,['-nostdin','-v','error','-y','-i',plate.file_path,'-vf',plateFilters(plan),'-frames:v','1','-pix_fmt',format,'-f','rawvideo',file],{signal,timeoutMs:60000});
 const bg=await fs.promises.readFile(bgRgb),fg=r.foreground?await fs.promises.readFile(fgRgba):null;if(bg.length!==pixels*3||(fg&&fg.length!==pixels*4))throw media.fail('Plate decoder geometry differs from reviewed output');
 const rawSize=pixels*4*plan.timing.frame_count;for(const a of [r.alpha,r.depth].filter(Boolean))if(fs.statSync(a.file_path).size!==rawSize)throw media.fail('Raw alpha/depth byte count differs from the selected geometry and frames');
 const handles=[];const open=async(p,mode)=>{const f=await fs.promises.open(p,mode);handles.push(f);return f;};
 try{
  const src=await open(inputRgb,'r'),alpha=await open(r.alpha.file_path,'r'),depth=r.depth?await open(r.depth.file_path,'r'):null,out=await open(resultRgb,'w'),subject=await open(subjectRgba,'w'),refined=await open(refinedPath,'w');
  const srcBuf=Buffer.alloc(pixels*3),alphaBuf=Buffer.alloc(pixels*4),depthBuf=depth?Buffer.alloc(pixels*4):null,refinedBuf=Buffer.alloc(pixels*4);
  for(let frame=0;frame<plan.timing.frame_count;frame++){
   check(signal);for(const [fd,buf] of [[src,srcBuf],[alpha,alphaBuf],[depth,depthBuf]].filter(x=>x[0])){const {bytesRead}=await fd.read(buf,0,buf.length,frame*buf.length);if(bytesRead!==buf.length)throw media.fail('Processing input changed during frame reading');}
   const a=await refineAlpha(alphaBuf,width,height,plan.settings,plan.timing.frames[frame].index,signal),b=await blendFrame(srcBuf,a,bg,fg,depthBuf,plan.settings,frame,signal);
   for(let i=0;i<pixels;i++){refinedBuf.writeFloatLE(a[i],i*4);if((i+1)%8192===0)await yieldPixels(signal);}
   for(const [handle,buffer] of [[out,b.rgb],[subject,b.rgba],[refined,refinedBuf]]){let offset=0;while(offset<buffer.length){const written=await handle.write(buffer,offset,buffer.length-offset);if(!written.bytesWritten)throw media.fail('Composite frame could not be written');offset+=written.bytesWritten;}}onProgress(.15+.6*(frame+1)/plan.timing.frame_count,`Compositing frame ${frame+1} of ${plan.timing.frame_count}`);await new Promise(resolve=>setImmediate(resolve));
  }
 }finally{await Promise.all(handles.map(h=>h.close()));}
 if(fs.statSync(refinedPath).size!==rawSize||fs.statSync(resultRgb).size!==pixels*3*plan.timing.frame_count||fs.statSync(subjectRgba).size!==rawSize)throw media.fail('Composite output byte count differs from reviewed frames');
 check(signal);onProgress(.8,'Encoding composite and an alpha-bearing foreground layer');
 const videoPath=path.join(outputDir,'composite-preview.mp4'),foregroundPath=path.join(outputDir,'subject-alpha.mov');
 const videoTiming=await exactVideo(ff.bin,resultRgb,videoPath,plan,signal),foregroundTiming=await exactVideo(ff.bin,subjectRgba,foregroundPath,plan,signal,{foreground:true});
 for(const input of inputs)await verifyInput(input,signal);check(signal);
 const files={video:{name:path.basename(videoPath),sha256:await media.hashFile(videoPath,signal)},foreground:{name:path.basename(foregroundPath),sha256:await media.hashFile(foregroundPath,signal),alpha_precision:'8-bit straight alpha; authoritative refined f32 alpha is separate'},refined_alpha:{name:path.basename(refinedPath),sha256:await media.hashFile(refinedPath,signal),raw_format:'f32le'}};
 const manifest={type:'CompositeManifest',contract:plan.contract,project_id:plan.project_id,cache_key:plan.cache_key,request_fingerprint:plan.request_fingerprint,settings:plan.settings,inputs:r,fixture:plan.fixture,quality_status:plan.fixture?'synthetic_transport_test':'visual_review_required',orientation:plan.orientation,timing:plan.timing,preview_timing:videoTiming,foreground_timing:foregroundTiming,colour_pipeline:plan.colour_pipeline,depth_usage:plan.depth_usage,capabilities:plan.capabilities,execution:{backend:'local CPU pixel compositor and FFmpeg; no neural inference',neural_inference:false,source_unchanged:true,source_audio:'not included in this preview; original source remains available for handoff'},files};
 const manifestPath=path.join(outputDir,'manifest.json');await fs.promises.writeFile(manifestPath,JSON.stringify(manifest,null,2));
 if(!keepWorkFiles)for(const file of [inputRgb,bgRgb,fgRgba,resultRgb,subjectRgba])await fs.promises.rm(file,{force:true});
 onProgress(1,'Composite complete; moving visual review required');return {video_path:videoPath,foreground_path:foregroundPath,refined_alpha_path:refinedPath,manifest_path:manifestPath,manifest};
}
module.exports={renderComposite,refineAlpha,blendFrame,verifyInput,plateFilters,exactVideo};
