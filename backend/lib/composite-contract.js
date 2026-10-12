const path=require('node:path');
const {fail,digest,sameTiming,timestampExpressions}=require('./depth-media');
const {orientationFor,canonicalRotation}=require('./depth-orientation');
const VERSION='film-composite-v1';
const PORTS={
 'subject-matte':{inputs:{source:{types:['VideoAsset'],required:true}},outputs:{alpha:'AlphaSequence',metadata:'ProcessingManifest'}},
 'alpha-refine':{inputs:{alpha:{types:['AlphaSequence'],required:true}},outputs:{alpha:'AlphaSequence',metadata:'ProcessingManifest'}},
 composite:{inputs:{source:{types:['VideoAsset'],required:true},alpha:{types:['AlphaSequence'],required:true},background:{types:['ImagePlate'],required:true},foreground:{types:['ImagePlate'],required:false},depth:{types:['DepthSequence'],required:false}},outputs:{video:'CompositeVideo',alpha:'AlphaSequence',foreground:'ForegroundLayer',metadata:'CompositeManifest'}},
 'moving-review':{inputs:{before:{types:['VideoAsset'],required:true},after:{types:['CompositeVideo'],required:true}},outputs:{}},
 'resolve-handoff':{inputs:{video:{types:['CompositeVideo'],required:true},alpha:{types:['AlphaSequence'],required:true},depth:{types:['DepthSequence'],required:false},background:{types:['ImagePlate'],required:true}},outputs:{package:'ResolveLayerPackage'}},
};
const canConnect=(type,node,port)=>PORTS[node]?.inputs[port]?.types.includes(type)===true;
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
function cacheKey(type,settings,inputs,version=VERSION){return digest(stable({type,version,settings,inputs}));}
function displayToEncoded(point,rotation){const [x,y]=point;for(const n of point)if(!Number.isFinite(n)||n<0||n>1)throw fail('Correction points must be normalized within the displayed frame');return {0:[x,y],90:[1-y,x],180:[1-x,1-y],'-90':[y,1-x]}[canonicalRotation(rotation)];}
function bounded(value,min,max,name,defaultValue){value=value??defaultValue;if(!Number.isFinite(value)||value<min||value>max)throw fail(`${name} must be from ${min} to ${max}`);return value;}
function validateTiming(t){
 if(!t||!Number.isSafeInteger(t.width)||t.width<1||!Number.isSafeInteger(t.height)||t.height<1||!Number.isSafeInteger(t.frame_count)||t.frame_count<1||t.frame_count>1800)throw fail('Composite requires bounded source geometry and frame count');
 if(!Number.isSafeInteger(t.start_frame)||!Number.isSafeInteger(t.end_frame_exclusive)||t.end_frame_exclusive-t.start_frame!==t.frame_count)throw fail('Composite requires an exact selected source frame range');
 if(!Array.isArray(t.frames)||t.frames.length!==t.frame_count||t.frames.some((f,i)=>f.index!==t.start_frame+i))throw fail('Composite source frame correspondence is incomplete');
 timestampExpressions(t);sameTiming(t,t);canonicalRotation(t.display_rotation_degrees??0);
 if(t.frames.some((f,i)=>!Number.isSafeInteger(f.pts)||!Number.isSafeInteger(f.duration_ticks)||f.duration_ticks<1||(i&&f.pts<=t.frames[i-1].pts)))throw fail('Composite requires ordered exact frame timestamps');
 if(t.start_pts!==t.frames[0].pts||t.duration_ticks!==t.frames.at(-1).pts+t.frames.at(-1).duration_ticks-t.start_pts)throw fail('Composite duration does not match its selected frame range');
}
function sameSourceFrames(expected, actual) {
 validateTiming(actual);
 const equalTime = (a,b) => BigInt(a)*BigInt(expected.time_base.numerator)*BigInt(actual.time_base.denominator)
  === BigInt(b)*BigInt(actual.time_base.numerator)*BigInt(expected.time_base.denominator);
 if(expected.start_frame!==actual.start_frame||expected.end_frame_exclusive!==actual.end_frame_exclusive
  ||expected.frames.some((frame,i)=>frame.index!==actual.frames[i]?.index
   ||!equalTime(frame.pts,actual.frames[i].pts)||!equalTime(frame.duration_ticks,actual.frames[i].duration_ticks))) {
  throw fail('Alpha/depth source frame correspondence differs from the exact selected source range');
 }
}
function correctionsFor(list,timing){
 if(!Array.isArray(list)||list.length>64)throw fail('At most 64 saved correction shapes are supported');
 return list.map(c=>{
  if(!['include','exclude'].includes(c.mode)||!Array.isArray(c.points)||c.points.length<3||c.points.length>32)throw fail('Manual correction requires an include/exclude polygon with 3–32 points');
  const start=c.start_frame??timing.start_frame,end=c.end_frame_exclusive??timing.end_frame_exclusive;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<timing.start_frame||end>timing.end_frame_exclusive||start>=end)throw fail('Correction range must lie inside the selected source range');
  const points=c.points.map(p=>{if(!Array.isArray(p)||p.length!==2)throw fail('Correction points require two normalized coordinates');displayToEncoded(p,0);return [...p];});
  return {mode:c.mode,points,start_frame:start,end_frame_exclusive:end,coordinates:'encoded_normalized'};
 });
}
function planComposite(recipe,{allowFixture=false}={}){
 if(!/^[0-9a-f-]{36}$/i.test(recipe.project_id||''))throw fail('Composite requires a project identity');
 const inputs=[];
 for(const [port,spec] of Object.entries(PORTS.composite.inputs)){
  const a=recipe[port];if(!a){if(spec.required)throw fail(`Composite ${port} requires ${spec.types.join(' or ')}`);continue;}
  if(!spec.types.includes(a.type))throw fail(`Composite ${port} requires ${spec.types.join(' or ')}`);
  if(a.project_id!==recipe.project_id)throw fail('Composite inputs must belong to the same project');
  if(!path.isAbsolute(a.file_path||'')||!/^[0-9a-f]{64}$/i.test(a.sha256||''))throw fail('Composite inputs require resolved local assets and byte checksums');
  if(a.provenance?.fixture&&!allowFixture)throw fail('Synthetic alpha/depth fixtures cannot produce a production composite');
  inputs.push({port,artifact:a});
 }
 const {source,alpha,background,foreground,depth}=recipe,t=source.timing;validateTiming(t);
 const s=recipe.settings||{},width=s.width??alpha.timing?.width,height=s.height??alpha.timing?.height;
 if(!Number.isInteger(width)||width<2||!Number.isInteger(height)||height<2||width>1920||height>1920||width*height>2073600||width*height*t.frame_count*4>536870912)throw fail('Composite output exceeds bounded processing limits');
 const rotation=t.display_rotation_degrees??0,expected={...t,width,height,display_rotation_degrees:rotation};
 for(const a of [alpha,depth].filter(Boolean)){
  if(a.source_sha256!==source.sha256||a.raw_format!=='f32le')throw fail('Alpha/depth must refer to the exact source and f32le layout');
  sameSourceFrames(expected,a.timing);
  sameTiming(expected,a.timing);
 }
 if(alpha.alpha_mode!=='straight')throw fail('Composite requires straight alpha; a depth map is not an alpha matte');
 if(depth&&depth.depth_kind!=='relative_inverse_depth')throw fail('Depth ordering currently requires explicitly identified relative inverse depth');
 if(!['contain','cover','stretch'].includes(s.plate_fit))throw fail('Review an explicit plate fit: contain, cover or stretch');
 for(const plate of [background,foreground].filter(Boolean))if(!Number.isSafeInteger(plate.width)||plate.width<1||!Number.isSafeInteger(plate.height)||plate.height<1||plate.width*plate.height>16777216)throw fail('Plate dimensions are missing or too large');
 if(s.inpaint||s.clean_plate_extract)throw fail('Clean-plate extraction/inpainting backend unavailable; a generated replacement is not a matching clean plate',503);
 if(s.motion_blur?.enabled)throw fail('Motion-vector blur backend unavailable; no simulated optical-flow result is substituted',503);
 const gains=s.light_rgb_gain??[1,1,1];if(!Array.isArray(gains)||gains.length!==3)throw fail('Light matching requires three RGB gains');
 const settings={width,height,plate_fit:s.plate_fit,exposure:bounded(s.exposure,-4,4,'Exposure',0),contrast:bounded(s.contrast,0,4,'Contrast',1),saturation:bounded(s.saturation,0,2,'Saturation',1),gamma:bounded(s.gamma,.1,4,'Gamma',1),light_rgb_gain:gains.map(v=>bounded(v,0,4,'Light RGB gain',1)),grain:bounded(s.grain,0,.2,'Grain',0),grain_seed:bounded(s.grain_seed,0,2147483647,'Grain seed',0),feather_px:bounded(s.feather_px,0,12,'Alpha feather',0),choke_px:bounded(s.choke_px,-4,4,'Alpha choke',0),corrections:correctionsFor(s.corrections??[],t)};
 if(!Number.isInteger(settings.feather_px)||!Number.isInteger(settings.choke_px)||!Number.isInteger(settings.grain_seed))throw fail('Pixel refinements and grain seed must be integers');
 let foregroundDepth=s.foreground_inverse_depth;
 if(foregroundDepth!=null){if(!foreground||!depth||!Number.isFinite(foregroundDepth))throw fail('Depth-positioned foreground requires a foreground plate, matching depth and a finite inverse depth');settings.foreground_inverse_depth=foregroundDepth;}
 const identity=inputs.map(({port,artifact})=>({port,...artifact,file_path:undefined}));
 const key=cacheKey('composite',settings,identity);
 return {contract:VERSION,project_id:recipe.project_id,recipe:{...recipe,settings},settings,cache_key:key,request_fingerprint:key,timing:expected,orientation:orientationFor(width,height,rotation),fixture:inputs.some(x=>x.artifact.provenance?.fixture),estimated_work_bytes:width*height*t.frame_count*14+width*height*32,paid:false,network_uploads:false,colour_pipeline:'encoded RGB preview compositing; approximate controls, not scene-linear relighting',depth_usage:foregroundDepth==null?'none':'foreground inverse-depth ordering',capabilities:{local_composite:true,manual_correction:true,feather_choke:true,colour_light_grain:true,motion_vector_blur:false,inpaint:false,clean_plate_extract:false}};
}
module.exports={VERSION,PORTS,canConnect,cacheKey,planComposite,displayToEncoded,validateTiming,correctionsFor};
