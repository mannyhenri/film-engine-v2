const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {spawn}=require('child_process');
const {orientationFor,probeRotation}=require('./depth-orientation');
const fail=(message,status=422)=>Object.assign(Error(message),{status});
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function* readChunks(file,{signal,chunkSize=65536}={}){
 const handle=await fs.promises.open(file,'r');
 try{let offset=0;while(true){if(signal?.aborted)throw fail('Cancelled',409);const buffer=Buffer.alloc(chunkSize);let used=0;while(used<buffer.length){const {bytesRead}=await handle.read(buffer,used,buffer.length-used,offset+used);if(!bytesRead)break;used+=bytesRead;}if(!used)break;offset+=used;yield buffer.subarray(0,used);}}
 finally{await handle.close();}
}
async function hashFile(file,signal){const h=crypto.createHash('sha256');for await(const chunk of readChunks(file,{signal})){h.update(chunk);}return h.digest('hex');}
function rational(value){const m=String(value).match(/^(\d+)\/(\d+)$/);if(!m||!Number(m[1])||!Number(m[2]))throw fail('Missing valid rational media timing');return {numerator:Number(m[1]),denominator:Number(m[2])};}
function ticks(value){if(!/^-?\d+$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail('Unsafe or missing frame timestamp');return Number(value);}
function seconds(t,timeBase){return t*timeBase.numerator/timeBase.denominator;}
function processOutput(bin,args,{signal,maxBytes=64*1024*1024,timeoutMs=60000,cwd,env}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(fail('Cancelled',409));return;}
  const argv=/^ffmpeg(?:\.exe)?$/i.test(path.basename(bin))?['-nostdin',...args.filter(a=>a!=='-nostdin')]:args;
  const child=spawn(bin,argv,{cwd,env,stdio:['ignore','pipe','pipe'],shell:false});let out=[],size=0,error='',failure=null,killTimer;
  const terminate=()=>{child.kill('SIGTERM');if(!killTimer)killTimer=setTimeout(()=>child.kill('SIGKILL'),3000);};
  const stop=()=>{failure=fail('Cancelled',409);terminate();};
  const timeout=setTimeout(()=>{failure=fail('Media process timed out');terminate();},timeoutMs);
  signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  child.stdout.on('data',b=>{size+=b.length;if(size>maxBytes){failure=fail('Media probe output exceeds its safe limit');terminate();}else out.push(b);});
  child.stderr.on('data',b=>{error=(error+b.toString()).slice(-2000);});
  child.on('error',e=>{failure=fail(`Media process unavailable: ${e.code || 'spawn error'}`,503);});
  child.on('close',code=>{clearTimeout(timeout);clearTimeout(killTimer);signal?.removeEventListener('abort',stop);if(failure)reject(failure);else if(code!==0)reject(fail(`Media process failed (${code}): ${error}`));else resolve(Buffer.concat(out));});
 });
}
function probeBinary(){return process.env.FILM_FFPROBE_PATH || ['/usr/local/bin/ffprobe','/opt/homebrew/bin/ffprobe','/usr/bin/ffprobe'].find(p=>fs.existsSync(p)) || 'ffprobe';}
async function inspectVideo(file,{signal,probe=probeBinary()}={}){
 const bytes=await processOutput(probe,['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=width,height,time_base,avg_frame_rate,r_frame_rate,duration_ts:stream_tags=rotate:stream_side_data=side_data_type,displaymatrix,rotation:frame=best_effort_timestamp,pkt_duration,duration:frame_side_data=side_data_type,displaymatrix,rotation','-of','json',file],{signal});
 const data=JSON.parse(bytes.toString()),s=data.streams?.[0];if(!s||!s.width||!s.height)throw fail('Source has no decodable video stream');
 const displayRotation=probeRotation(s,data.frames);
 const tb=rational(s.time_base),fps=rational(s.avg_frame_rate),frames=(data.frames || []).map((f,i)=>({index:i,pts:ticks(f.best_effort_timestamp),duration_ticks:(f.pkt_duration??f.duration)==null?null:ticks(f.pkt_duration??f.duration)}));
 if(!frames.length||frames.length>100000)throw fail('Source must have between 1 and 100,000 decoded frames');
 for(let i=0;i<frames.length;i++){
  if(i&&frames[i].pts<=frames[i-1].pts)throw fail('Source frame timestamps must increase strictly');
  if(i+1<frames.length)frames[i].duration_ticks=frames[i+1].pts-frames[i].pts;
  else if(!(frames[i].duration_ticks>0)){
   const duration=s.duration_ts==null?null:ticks(s.duration_ts);
   if(duration!=null&&frames[0].pts+duration>frames[i].pts)frames[i].duration_ticks=frames[0].pts+duration-frames[i].pts;
   else throw fail('Cannot determine the final frame duration without rounding');
  }
 }
 const duration=frames.at(-1).pts+frames.at(-1).duration_ticks-frames[0].pts;
 return {...orientationFor(s.width,s.height,displayRotation),width:s.width,height:s.height,time_base:tb,fps,frame_count:frames.length,start_pts:frames[0].pts,duration_ticks:duration,variable_frame_rate:new Set(frames.map(f=>f.duration_ticks)).size>1,frames};
}
function selectedTiming(source,start,end){
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>source.frame_count)throw fail('Choose an existing, nonempty frame range');
 const frames=source.frames.slice(start,end),duration=frames.at(-1).pts+frames.at(-1).duration_ticks-frames[0].pts;
 return {...source,start_frame:start,end_frame_exclusive:end,frame_count:frames.length,start_pts:frames[0].pts,duration_ticks:duration,frames};
}
function sameTiming(expected,actual,{tolerance=0}={}){
 if(expected.frame_count!==actual.frame_count||expected.width!==actual.width||expected.height!==actual.height)throw fail(`Output frame count or dimensions do not match: requested ${expected.frame_count} × ${expected.width}×${expected.height}, received ${actual.frame_count} × ${actual.width}×${actual.height}`);
 if(expected.display_rotation_degrees!=null&&expected.display_rotation_degrees!==(actual.display_rotation_degrees??0))throw fail('Output display rotation does not match the reviewed source');
 const e=expected.frames,a=actual.frames,tb=expected.time_base,other=actual.time_base;
 if(!other||!Number.isSafeInteger(other.numerator)||other.numerator<1||!Number.isSafeInteger(other.denominator)||other.denominator<1||!Array.isArray(a)||a.length!==actual.frame_count||!Number.isSafeInteger(actual.duration_ticks)||actual.duration_ticks<1)throw fail('Output has invalid timing metadata');
 for(let i=0;i<a.length;i++)if(!Number.isSafeInteger(a[i].pts)||!Number.isSafeInteger(a[i].duration_ticks)||a[i].duration_ticks<1||(i&&a[i].pts<=a[i-1].pts))throw fail('Output has invalid frame timestamps');
 for(let i=0;i<e.length;i++)if(Math.abs(seconds(e[i].pts-e[0].pts,tb)-seconds(a[i].pts-a[0].pts,other))>tolerance)throw fail(`Output timestamp drift at frame ${i}`);
 if(Math.abs(seconds(expected.duration_ticks,tb)-seconds(actual.duration_ticks,other))>tolerance)throw fail('Output duration does not match the requested source range');
}
function timestampExpressions(timing){
 const runs=[];for(let i=0;i<timing.frame_count;i++){const f=timing.frames[i],last=runs.at(-1);if(last&&last.duration===f.duration_ticks)last.end=i+1;else runs.push({start:i,end:i+1,pts:f.pts-timing.start_pts,duration:f.duration_ticks});}
 if(runs.length>128)throw fail('This VFR range exceeds 128 timestamp segments; shorten the range before depth inference');
 const num=timing.time_base.numerator,den=timing.time_base.denominator;
 const chain=field=>runs.reduceRight((tail,run,index)=>{const value=field==='pts'?`${run.pts*num}+(N-${run.start})*${run.duration*num}`:String(run.duration*num);return index===runs.length-1?value:`if(lt(N,${run.end}),${value},${tail})`;},'0');
 return `setts=time_base=1/${den}:prescale=1:pts='${chain('pts')}':dts='${chain('pts')}':duration='${chain('duration')}'`;
}
async function validateRaw(file,request,signal){
 const expected=request.timing.frame_count*request.width*request.height*4;
 if(!Number.isSafeInteger(expected)||fs.statSync(file).size!==expected)throw fail('Raw float depth byte count does not match frames × width × height');
 let min=Infinity,max=-Infinity,count=0;
 for await(const chunk of readChunks(file,{signal})){
  if(signal?.aborted)throw fail('Cancelled',409);
  for(let i=0;i<chunk.length;i+=4){const n=chunk.readFloatLE(i);if(!Number.isFinite(n))throw fail('Raw depth contains a nonfinite value');min=Math.min(min,n);max=Math.max(max,n);count++;}
 }
 return {min,max,count,sha256:await hashFile(file,signal),normalization:'one_global_range_for_selected_clip'};
}
// The derivative is made here from validated raw values, never from per-frame normalized images.
async function encodePreview(raw,outDir,request,range,signal){
 const {timing,width,height}=request,handle=await fs.promises.open(raw,'r'),pixels=width*height,buf=Buffer.alloc(pixels*4),framesPath=path.join(outDir,'frames.gray'),frames=await fs.promises.open(framesPath,'w');
 try{
  for(let i=0;i<timing.frame_count;i++){
   if(signal.aborted)throw fail('Cancelled',409);
   const {bytesRead}=await handle.read(buf,0,buf.length,i*buf.length);if(bytesRead!==buf.length)throw fail('Raw depth changed while encoding');
   const gray=Buffer.alloc(pixels);
   for(let p=0;p<pixels;p++)gray[p]=range.max===range.min?0:Math.round(255*(buf.readFloatLE(p*4)-range.min)/(range.max-range.min));
   let offset=0;while(offset<gray.length){const {bytesWritten}=await frames.write(gray,offset,gray.length-offset);if(!bytesWritten)throw fail('Depth display frame could not be written');offset+=bytesWritten;}
  }
 }finally{await handle.close();await frames.close();}
 // Explicit rawvideo avoids content-based probing of grayscale images (some depth patterns resemble MPEG-TS).
 // Packet timestamps and final duration are then set from the exact source ticks, including VFR ranges.
 const angle=timing.display_rotation_degrees??0;
 const video=path.join(outDir,'preview.mp4'),encodedVideo=angle?path.join(outDir,'preview-encoded.mp4'):video,ff=require('./ffmpeg').resolveFfmpeg();if(!ff.available)throw fail('FFmpeg is required to encode the depth display video',503);
 await processOutput(ff.bin,['-nostdin','-v','error','-y','-f','rawvideo','-pixel_format','gray','-video_size',`${width}x${height}`,'-framerate',`${timing.fps.numerator}/${timing.fps.denominator}`,'-i','frames.gray','-frames:v',String(timing.frame_count),'-fps_mode','passthrough','-enc_time_base',`${timing.time_base.numerator}/${timing.time_base.denominator}`,'-c:v','libx264','-bf','0','-pix_fmt',width%2===0&&height%2===0?'yuv420p':'yuv444p','-bsf:v',timestampExpressions(timing),'-video_track_timescale',String(timing.time_base.denominator),'-movflags','+faststart',encodedVideo],{signal,cwd:outDir,timeoutMs:600000});
 // Record rotation without re-encoding, swapping encoded dimensions, or changing PTS.
 if(angle)await processOutput(ff.bin,['-nostdin','-v','error','-y','-copyts','-noautorotate','-display_rotation',String(angle),'-i',encodedVideo,'-map','0:v:0','-c:v','copy','-video_track_timescale',String(timing.time_base.denominator),'-movflags','+faststart',video],{signal,cwd:outDir,timeoutMs:600000});
 const encoded=await inspectVideo(video,{signal});sameTiming({...timing,width,height},encoded,{tolerance:0.000000001});
 return {path:video,timing:encoded};
}

module.exports={fail,digest,hashFile,readChunks,rational,seconds,processOutput,inspectVideo,selectedTiming,sameTiming,timestampExpressions,validateRaw,encodePreview};
