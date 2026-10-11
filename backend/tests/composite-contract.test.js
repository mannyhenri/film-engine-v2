const test=require('node:test'),assert=require('node:assert/strict');
const {PORTS,canConnect,planComposite,cacheKey,displayToEncoded}=require('../lib/composite-contract');
const pid='11111111-1111-4111-8111-111111111111',sha='0'.repeat(64);
const timing={width:64,height:48,display_rotation_degrees:0,frame_count:2,time_base:{numerator:1,denominator:1000},fps:{numerator:24,denominator:1},start_frame:0,end_frame_exclusive:2,start_pts:0,duration_ticks:84,frames:[{index:0,pts:0,duration_ticks:42},{index:1,pts:42,duration_ticks:42}]};
function recipe(){return {project_id:pid,source:{type:'VideoAsset',project_id:pid,file_path:'/source',sha256:sha,timing},alpha:{type:'AlphaSequence',project_id:pid,file_path:'/alpha',sha256:sha,source_sha256:sha,raw_format:'f32le',alpha_mode:'straight',timing,provenance:{fixture:true}},background:{type:'ImagePlate',project_id:pid,file_path:'/plate',sha256:sha,width:64,height:48,matching_clean_plate:false},settings:{plate_fit:'contain',width:64,height:48}};}
test('ports distinguish alpha/depth/plate/video and enforce all required composite inputs',()=>{assert.deepEqual(PORTS.composite.inputs.alpha.types,['AlphaSequence']);assert.equal(canConnect('DepthSequence','subject-matte','source'),false);assert.equal(canConnect('DepthSequence','composite','alpha'),false);assert.equal(canConnect('DepthSequence','composite','depth'),true);assert.equal(canConnect('ImagePlate','composite','background'),true);const r=recipe();delete r.alpha;assert.throws(()=>planComposite(r,{allowFixture:true}),/AlphaSequence/);});
test('plan refuses cross-project, stale-source, shifted timing, invalid alpha and unavailable effects',()=>{const cases=[r=>r.alpha.project_id='22222222-2222-4222-8222-222222222222',r=>r.alpha.source_sha256='1'.repeat(64),r=>r.alpha.timing={...timing,frames:[timing.frames[0],{...timing.frames[1],pts:43}]},r=>r.alpha.alpha_mode='premultiplied',r=>r.settings.motion_blur={enabled:true},r=>r.settings.inpaint=true];for(const mutate of cases){const r=recipe();mutate(r);assert.throws(()=>planComposite(r,{allowFixture:true}));}assert.throws(()=>planComposite(recipe()),/Synthetic/);});
test('cache identities include ordered typed upstream bytes, settings, corrections and implementation pins',()=>{const r=recipe(),p=planComposite(r,{allowFixture:true});assert.equal(p.cache_key,planComposite(JSON.parse(JSON.stringify(r)),{allowFixture:true}).cache_key);for(const mutate of [r=>r.background.sha256='1'.repeat(64),r=>r.settings.exposure=1,r=>r.settings.corrections=[{mode:'exclude',points:[[0,0],[1,0],[1,1]],start_frame:0,end_frame_exclusive:1}],r=>r.alpha.provenance.model_sha256='1'.repeat(64)]){const changed=recipe();mutate(changed);assert.notEqual(planComposite(changed,{allowFixture:true}).cache_key,p.cache_key);}assert.notEqual(cacheKey('a',{},[],'v1'),cacheKey('a',{},[],'v2'));});
test('upright correction points map explicitly into encoded coordinates for every supported rotation',()=>{assert.deepEqual(displayToEncoded([.2,.3],0),[.2,.3]);assert.deepEqual(displayToEncoded([.2,.3],-90),[.3,.8]);assert.deepEqual(displayToEncoded([.2,.3],90),[.7,.2]);assert.deepEqual(displayToEncoded([.2,.3],180),[.8,.7]);});
test('same-source equal-length windows cannot reuse alpha or depth from other absolute frames',()=>{
 for(const layer of ['alpha','depth']){
  const r=recipe();if(layer==='depth')r.depth={...r.alpha,type:'DepthSequence',depth_kind:'relative_inverse_depth'};
  const shifted={...timing,start_frame:100,end_frame_exclusive:102,start_pts:4200,frames:timing.frames.map(f=>({...f,index:f.index+100,pts:f.pts+4200}))};
  r.source={...r.source,timing:shifted};if(layer==='depth')r.alpha={...r.alpha,timing:shifted};
  assert.throws(()=>planComposite(r,{allowFixture:true}),/source frame correspondence/);
 }
});
test('source correspondence compares absolute rational PTS and every frame duration',()=>{
 const r=recipe();r.alpha={...r.alpha,timing:{...timing,time_base:{numerator:1,denominator:2000},duration_ticks:168,frames:timing.frames.map(f=>({...f,pts:f.pts*2,duration_ticks:f.duration_ticks*2}))}};
 assert.ok(planComposite(r,{allowFixture:true}));
 for(const mutate of [t=>{t.start_pts=2;t.frames=t.frames.map(f=>({...f,pts:f.pts+2}));},t=>{t.frames[0].duration_ticks-=1;}]){
  const changed=JSON.parse(JSON.stringify(r));mutate(changed.alpha.timing);assert.throws(()=>planComposite(changed,{allowFixture:true}),/source frame correspondence/);
 }
});
