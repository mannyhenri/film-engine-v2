const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const media=require('../lib/depth-media');
const {probeRotation,orientationFor,validateWorkerOrientation}=require('../lib/depth-orientation');
const {vdaModelGrid,validateAdmission}=require('../lib/depth-admission');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'film-rotation-test-')),ff='/usr/local/bin/ffmpeg';
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
function command(args){const r=spawnSync(ff,['-v','error','-y',...args],{maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr?.toString());return r.stdout;}
function matrix(angle){const r=angle*Math.PI/180,c=Math.round(Math.cos(r))*65536,s=Math.round(Math.sin(r))*65536;return {side_data_type:'Display Matrix',rotation:angle,displaymatrix:`\n00000000: ${c} ${-s} 0\n00000001: ${s} ${c} 0\n00000002: 0 0 1073741824\n`};}
function rotate(data,width,height,angle){let values=data,w=width,h=height;for(let i=0;i<((angle/90+4)%4);i++){const next=Buffer.alloc(values.length);for(let y=0;y<w;y++)for(let x=0;x<h;x++)next[y*h+x]=values[x*w+w-1-y];values=next;[w,h]=[h,w];}return values;}
test('all quarter-turn display matrices are canonical; mirror/scale/arbitrary/changing transforms fail',()=>{
 for(const angle of [0,90,180,-90])assert.equal(probeRotation({side_data_list:[matrix(angle)]}),angle);
 assert.equal(probeRotation({tags:{rotate:'270'}}),-90);
 const mirrored=matrix(0);mirrored.displaymatrix=mirrored.displaymatrix.replace('65536 0 0','-65536 0 0');
 assert.throws(()=>probeRotation({side_data_list:[mirrored]}),/Mirrored/);
 assert.throws(()=>probeRotation({tags:{rotate:45}}),/quarter-turn/);
 assert.throws(()=>probeRotation({side_data_list:[matrix(0)]},[{side_data_list:[matrix(90)]}]),/Changing/);
 assert.throws(()=>validateWorkerOrientation({width:32,height:48,display_rotation_degrees:-90},orientationFor(32,48,90)),/reviewed source/);
});
test('recorded MP4 rotation displays pixels upright while encoded geometry and exact VFR timing remain unchanged',async()=>{
 const base=path.join(root,'base.mp4');command(['-f','lavfi','-i','testsrc2=size=32x48:rate=25','-frames:v','7','-vf',"select='not(eq(n,2))'",'-fps_mode','vfr','-c:v','libx264',base]);
 for(const angle of [0,90,180,-90]){
  const dir=path.join(root,String(angle));fs.mkdirSync(dir);const source=path.join(dir,'source.mp4');
  if(angle)command(['-copyts','-noautorotate','-display_rotation',String(angle),'-i',base,'-c:v','copy',source]);else fs.copyFileSync(base,source);
  const before=await media.hashFile(source),timing=media.selectedTiming(await media.inspectVideo(source),1,5);
  assert.equal(timing.display_rotation_degrees,angle);assert.equal(timing.variable_frame_rate,true);
  const request={width:32,height:48,timing},raw=path.join(dir,'raw.f32'),bytes=Buffer.alloc(4*32*48*4);
  for(let f=0;f<4;f++)for(let p=0;p<32*48;p++)bytes.writeFloatLE((p%32)+(Math.floor(p/32)*2)+f,(f*32*48+p)*4);
  fs.writeFileSync(raw,bytes);const signal=new AbortController().signal,range=await media.validateRaw(raw,request,signal);
  const result=await media.encodePreview(raw,dir,request,range,signal);
  assert.equal(result.timing.width,32);assert.equal(result.timing.height,48);assert.equal(result.timing.display_rotation_degrees,angle);
  media.sameTiming({...timing,width:32,height:48},result.timing,{tolerance:1e-9});
  const encoded=command(['-noautorotate','-i',result.path,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','-']);
  const upright=command(['-i',result.path,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','-']);
  const expected=rotate(encoded,32,48,angle);assert.equal(upright.length,expected.length);
  assert.ok(upright.every((v,i)=>Math.abs(v-expected[i])<=1),`wrong display pixel rotation ${angle}`);
  assert.equal(await media.hashFile(source),before);
 }
});
test('FFV1/NUT final-frame duration is retained from modern ffprobe duration fields',async()=>{
 const file=path.join(root,'synthetic.nut');command(['-f','lavfi','-i','testsrc2=size=32x48:rate=24000/1001','-frames:v','6','-c:v','ffv1',file]);
 const timing=await media.inspectVideo(file);assert.equal(timing.frame_count,6);assert.deepEqual(timing.fps,{numerator:24000,denominator:1001});
 assert.equal(timing.frames.at(-1).duration_ticks,timing.frames[1].pts-timing.frames[0].pts);
});
test('audited allocation, duration, source and VDA grid caps refuse jobs before model load',()=>{
 const request={width:160,height:96,timing:{width:160,height:96,frame_count:4,duration_ticks:160,time_base:{numerator:1,denominator:1000}},settings:{model_input_size:128}};
 const descriptor={max_width:1920,max_height:1920,max_frames:1800,max_output_pixels:2073600,max_raw_bytes:536870912,max_duration_seconds:60,max_source_pixels:16777216,max_model_pixels:300000};
 assert.deepEqual(vdaModelGrid(160,96,128),{width:210,height:140,pixels:29400,effective_model_input_size:128});
 assert.deepEqual(vdaModelGrid(360,640,256),{width:266,height:462,pixels:122892,effective_model_input_size:256});
 assert.ok(validateAdmission(descriptor,request).model_grid.pixels<300000);
 for(const [key,value,pattern] of [['max_output_pixels',10000,/output pixels/],['max_raw_bytes',200000,/byte limit/],['max_duration_seconds',.1,/duration/],['max_source_pixels',10000,/Source geometry/],['max_model_pixels',10000,/model grid/]])assert.throws(()=>validateAdmission({...descriptor,[key]:value},request),pattern);
 assert.throws(()=>validateAdmission(descriptor,{...request,width:3840,height:2160}),/range and resolution/);
 assert.throws(()=>validateAdmission(descriptor,{...request,settings:{model_input_size:518}}),/model grid/);
});

test('standard translated phone display matrices retain orientation while arbitrary translation is refused',()=>{
 const side=matrix(-90);side.displaymatrix=side.displaymatrix.replace('00000002: 0 0 1073741824','00000002: 141557760 0 1073741824');
 assert.equal(probeRotation({width:3840,height:2160,side_data_list:[side]}),-90);
 assert.throws(()=>probeRotation({width:3840,height:2160,side_data_list:[{...side,displaymatrix:side.displaymatrix.replace('141557760','141557761')}]}),/nonstandard/);
});
