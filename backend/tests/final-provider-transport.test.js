require('../lib/manual-generation').allowSendForTests(); // exercises the dormant API send path
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'final-provider-data-'));
const credentials=require('../lib/providers/credentials');
credentials.getCredential=()=>({apiKey:'mock:test',meta:{}});
process.env.RUNWAY_API_KEY='mock-only';
process.env.MUAPI_API_KEY='mock-only';
const boundary=require('../lib/final-provider-request');
const contract=require('../lib/final-request-review');
let snapshot,claims,receipts;
contract.store=()=>({claim:()=>{claims++;return{snapshot,replay:false};},submitted:()=>{},uncertain:()=>{},complete:()=>{},recordTransport:(id,receipt)=>{receipts.push(receipt);return 'receipt';},settleTransport:()=>{}});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'final-provider-transport-'));
const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.write('IHDR',12);png.writeUInt32BE(1200,16);png.writeUInt32BE(800,20);
const uri=`data:image/png;base64,${png.toString('base64')}`;
const secondPng=Buffer.from(png);secondPng[23]^=1;const secondUri=`data:image/png;base64,${secondPng.toString('base64')}`;
const file=path.join(dir,'reference.png');fs.writeFileSync(file,png);
const video = Buffer.alloc(24);video.write('ftyp',4);video.write('mp42',8);const videoFile=path.join(dir,'video.mp4');fs.writeFileSync(videoFile,video);
const cases=[
 ['seedance','video','seedance',{model:'seedance-2.5',prompt:'Distinct endpoint frames',keyframes:[uri,secondUri],seed:123456,duration_s:5}],
 ['runway','image','runway',{model:'gen4_image',prompt:'Distinct ordered references',reference_images:[{uri},{uri:secondUri}]}],
 ['magnific','post','magnific',{model:'magnific-video-upscaler-precision',source_video:videoFile,target_resolution:'3840x2160'}],
 ['elevenlabs','voice','elevenlabs',{model:'eleven_multilingual_v2',voice_id:'approved-voice',text:'Exact approved spoken words'}],
 ['elevenlabs','sfx','elevenlabs',{prompt:'Exact approved sound effect',duration_s:4}],
 ['elevenlabs','ambient','elevenlabs',{prompt:'Exact approved ambience',duration_s:10}],
 ['elevenlabs','music','elevenlabs',{model:'music_v1',prompt:'Exact approved instrumental cue',duration_s:10}],
 ['elevenlabs','music','elevenlabs',{workflow:'music_separate',stem_variation_id:'two_stems_v1',file:{bytes:video,mime:'audio/wav',name:'approved.wav'}}],
 ['meshy','image','meshy',{model:'nano-banana-pro',prompt:'Visible exact prompt',negative_prompt:'visible negative',reference_images:[{uri}]}],
 ['meshy','model3d','meshy',{model:'meshy-6-lite',operation:'text_to_mesh',prompt:'Visible exact mesh prompt',refine:true}],
 ['meshy','model3d','meshy',{model:'meshy-7.1',operation:'image_to_mesh',image:uri}],
 ['meshy','model3d','meshy',{model:'meshy-6-lite',operation:'refine_mesh',preview_task_id:'existing-preview',texture_prompt:'Visible texture prompt'}],
 ['worldlabs','world','worldlabs',{model:'marble-1.0-draft',prompt:'Visible exact world prompt',images:[{data:png.toString('base64'),extension:'png'}]}],
 ['openai','image','openai-image',{model:'gpt-image-1',prompt:'Visible exact prompt',negative_prompt:'visible negative',reference_images:[{file_path:file}]}],
 ['google','image','google-image',{model:'gemini-3.1-flash-image',prompt:'Visible exact prompt',negative_prompt:'visible negative',reference_images:[{uri}]}],
 ['muapi','image','muapi-image',{model:'nano-banana-2',prompt:'Visible exact prompt',reference_images:[{uri}]}],
 ['runway','image','runway',{model:'gen4_image',prompt:'Visible exact prompt',reference_images:[{uri}]}],
 ['runway','video','runway',{model:'gen4_turbo',prompt:'Visible exact prompt',init_image:uri,duration_s:5}],
 ['seedance','video','seedance',{model:'seedance-2.5',prompt:'Visible exact prompt',init_image:uri,duration_s:5,audio:true}],
 ['higgsfield','video','higgsfield',{model:'seedance-2-5',prompt:'Visible exact prompt',init_image:uri,duration_s:5}],
 ['runway','video','runway',{model:'gen4_turbo',runway_recipe:'multi_shot_video',mode:'custom',shots:[{prompt:'one',duration:2},{prompt:'two',duration:2},{prompt:'three',duration:2}]}],
 ['seedance','post','seedance',{model:'topaz-video-upscale',type:'upscale',source_video:videoFile,source_width:1200,source_height:800}],
 ['higgsfield','image','higgsfield',{model:'soul-standard',prompt:'Visible exact prompt'}],
 ['muapi-upscale','image-upscale','muapi-topaz-upscale',{image:uri,resolution:'2K'}],
];
for(const [provider,capability,name,payload] of cases)test(`${provider}/${capability} actual transport matches frozen visible semantics and bytes`,async()=>{
 snapshot=await boundary.resolveFinalRequest(provider,capability,payload);claims=0;receipts=[];
 const submitted=[];const uploads=[];const original=global.fetch;
 global.fetch=async(url,init={})=>{
  const href=String(url);
  if(!init.method || init.method==='GET')return{ok:true,status:200,json:async()=>({credits:100})};
  if(href.endsWith('/upload_file')){
   const blob=init.body.get('file');const bytes=Buffer.from(await blob.arrayBuffer());uploads.push(bytes);return{ok:true,status:200,json:async()=>({url:`https://mock.invalid/${uploads.length}`})};
  }
  if(href.endsWith('/v1/ai/uploads/request-url'))return{ok:true,status:200,json:async()=>({files:[{upload_url:'https://mock.invalid/put',asset_url:'https://mock.invalid/1'}]})};
  if(href.endsWith('/files/generate-upload-url'))return{ok:true,status:200,json:async()=>({upload_url:'https://mock.invalid/put',public_url:'https://mock.invalid/1'})};
  if(init.method==='PUT'){uploads.push(Buffer.from(init.body));return{ok:true,status:200};}
  submitted.push({url:href,body:init.body});
  return{ok:false,status:400,text:async()=>JSON.stringify({error:'mock stops after inspecting serialized paid request'}),json:async()=>({error:'mock stops after inspecting serialized paid request'})};
 };
 try{
  const opts={finalRequest:{id:'approved-test',fingerprint:'approved-hash'}};
  const changed={...payload,prompt:'MUTATED AFTER APPROVAL',model:'invalid-after-send'};
  const m=require('../lib/providers/'+name);const adapter=m.adapter||m[`${provider}Adapter`];
  if(provider==='muapi-upscale')await m.upscaleImage(payload,opts);else await adapter.generate(capability,changed,opts);
  assert.equal(claims,1);assert.equal(submitted.length,1);assert.equal(receipts.length,1);assert.equal(receipts[0].references.length,snapshot.references.length);assert.equal(submitted[0].url,snapshot.endpoint);
  if(snapshot.body.encoding==='multipart'){
   assert(Buffer.isBuffer(submitted[0].body));
   const actual=receipts[0].body.fields;
   assert.equal(receipts[0].serialized_base64,submitted[0].body.toString('base64'));
   assert.deepEqual(actual,snapshot.body.fields);
  }else{
   const actual=JSON.parse(submitted[0].body);const expected=structuredClone(snapshot.body);
   let ix=0;function map(v){if(Array.isArray(v))return v.map(map);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,map(x)]));if(typeof v==='string'&&v.startsWith('data:')&&uploads.length)return `https://mock.invalid/${++ix}`;return v;}
   assert.deepEqual(actual,map(expected));
  }
  for(const bytes of uploads)assert(snapshot.references.some(ref=>ref.sha256===crypto.createHash('sha256').update(bytes).digest('hex')));
  if(uploads.length && snapshot.body.encoding!=='multipart'){
   function prove(expected,actual,role='body'){
    if(Array.isArray(expected))return expected.forEach((v,i)=>prove(v,actual[i],`${role}[${i}]`));
    if(expected&&typeof expected==='object')return Object.entries(expected).forEach(([k,v])=>prove(v,actual[k],`${role}.${k}`));
    if(typeof expected==='string'&&expected.startsWith('data:')){const index=Number(String(actual).split('/').pop())-1;assert(uploads[index],`missing uploaded bytes for ${role}`);assert.equal(crypto.createHash('sha256').update(uploads[index]).digest('hex'),crypto.createHash('sha256').update(Buffer.from(expected.split(',')[1],'base64')).digest('hex'),`uploaded bytes/role/order differ at ${role}`);}
   }
   prove(snapshot.body,JSON.parse(submitted[0].body));
  }
 }finally{global.fetch=original;}
});
test('unknown models and unverified remote references cannot become an approved request',async()=>{
 await assert.rejects(boundary.resolveFinalRequest('muapi','image',{model:'unknown',prompt:'x'}),/Unsupported/);
 await assert.rejects(boundary.resolveFinalRequest('muapi','image',{prompt:'x',reference_images:[{uri:'https://remote.invalid/a.png'}]}),/immutable/);
});
test('full final prompt edits never append negative or sound policy again',async()=>{
 for(const [provider,capability,payload] of [['openai','image',{model:'gpt-image-1',prompt:'initial',negative_prompt:'avoid',final_prompt:'My exact final prompt'}],['seedance','video',{model:'seedance-2.5',prompt:'initial',audio:true,final_prompt:'My exact final prompt'}]]){
  const request=await boundary.resolveFinalRequest(provider,capability,payload);
  assert.equal(request.body.prompt,'My exact final prompt');
 }
});
test('unsupported edited wire fields and invalid option values fail before approval',async()=>{
 const p={model:'gen4_turbo',prompt:'x',init_image:uri,duration_s:5};const original=await boundary.resolveFinalRequest('runway','video',p);
 await assert.rejects(boundary.resolveFinalRequest('runway','video',{...p,final_request_body:{...original.body,unknown_option:1}}),/Unsupported provider field/);
 await assert.rejects(boundary.resolveFinalRequest('runway','video',{...p,final_request_body:{...original.body,duration:999}}),/supported range/);
});
test('closed native schemas reject malformed reference roles/counts/image parts and unknown resolutions without network',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Validation cannot submit');};
 try{
  const r={model:'gen4_image',prompt:'x',reference_images:[{uri}]};const rb=await boundary.resolveFinalRequest('runway','image',r);
  await assert.rejects(boundary.resolveFinalRequest('runway','image',{...r,final_request_body:{...rb.body,referenceImages:[{...rb.body.referenceImages[0],role:'unrecognized'}]}}),/Unsupported provider field/);
  const lastBytes=Buffer.from(png);lastBytes[23]^=1;const lastUri=`data:image/png;base64,${lastBytes.toString('base64')}`;
  const s={model:'seedance-2.5',prompt:'x',keyframes:[uri,lastUri]};const sb=await boundary.resolveFinalRequest('seedance','video',s);
  assert.match(sb.endpoint,/first-last/);
  await assert.rejects(boundary.resolveFinalRequest('seedance','video',{...s,final_request_body:{...sb.body,images_list:Array(31).fill(uri)}}),/reference count/);
  const g={model:'gemini-3.1-flash-image',prompt:'x',reference_images:[{uri}]};const gb=await boundary.resolveFinalRequest('google','image',g);
  await assert.rejects(boundary.resolveFinalRequest('google','image',{...g,final_request_body:{...gb.body,input:[{type:'image',mime:'image/png',data:png.toString('base64')}]}}),/unsupported structure/);
  const m={model:'nano-banana-2',prompt:'x',width:1280,height:720};const mb=await boundary.resolveFinalRequest('muapi','image',m);
  await assert.rejects(boundary.resolveFinalRequest('muapi','image',{...m,final_request_body:{...mb.body,resolution:'8k'}}),/Unsupported/);
  await assert.rejects(boundary.resolveFinalRequest('muapi','image',{...m,final_request_body:{...mb.body,images_list:[uri]}}),/Unsupported provider field/);
  const endpointChanged=await boundary.resolveFinalRequest('muapi','image',{...m,reference_images:[{uri}]});assert.match(endpointChanged.endpoint,/-edit$/);
  const oneFrame=await boundary.resolveFinalRequest('seedance','video',{...s,keyframes:[uri]});assert.match(oneFrame.endpoint,/image-to-video$/);
  await assert.rejects(boundary.resolveFinalRequest('higgsfield','video',{model:'seedance-2-5',prompt:'x',higgsfield_options:{unknown_option:true}}),/Unsupported selected/);
  assert.equal(calls,0);
 }finally{global.fetch=original;}
});
test('Meshy successful preview never sends an unapproved second texture request',async()=>{
 const payload={model:'meshy-6-lite',operation:'text_to_mesh',prompt:'Approved geometry',refine:true};snapshot=await boundary.resolveFinalRequest('meshy','model3d',payload);
 const original=global.fetch;let posts=0;
 global.fetch=async(url,init={})=>{const data=init.method==='POST'?(posts++,{result:'preview-task'}):{status:'SUCCEEDED',model_urls:{glb:'https://result.invalid/model.glb'}};return{ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)};};
 try{const result=await require('../lib/providers/meshy').adapter.generate('model3d',payload,{finalRequest:{id:'approved-test',fingerprint:'hash'}});assert.equal(result.ok,true);assert.equal(posts,1);assert.equal(result.meta.refinement_requires_review,true);assert.equal(result.meta.refine_task_id,null);}finally{global.fetch=original;}
});
test('approval replay rejects a second paid submission at the raw adapter boundary',async()=>{
 const savedStore=contract.store;let calls=0;const original=global.fetch;
 snapshot=await boundary.resolveFinalRequest('muapi','image',{prompt:'Approved once'});
 contract.store=()=>({claim:()=>({snapshot,replay:true,request_id:'existing-paid-job'}),uncertain:()=>{}});
 global.fetch=async()=>{calls++;throw Error('Must not submit');};
 try{await assert.rejects(require('../lib/providers/muapi-image').generate('image',{prompt:'x'},{finalRequest:{id:'once',fingerprint:'hash'}}),/already sent/);assert.equal(calls,0);}finally{contract.store=savedStore;global.fetch=original;}
});
test('a provider outage never automatically repeats the paid POST',async()=>{
 const original=global.fetch;try{
  for(const [provider,capability,name,payload] of [['higgsfield','image','higgsfield',{model:'soul-standard',prompt:'x'}],['elevenlabs','voice','elevenlabs',{text:'hello'}]]){
   snapshot=await boundary.resolveFinalRequest(provider,capability,payload);let calls=0;global.fetch=async()=>{calls++;return{ok:false,status:503,json:async()=>({error:'mock outage'}),text:async()=>JSON.stringify({error:'mock outage'})};};
   const m=require('../lib/providers/'+name);await m.adapter.generate(capability,payload,{finalRequest:{id:'approved-test',fingerprint:'hash'}});assert.equal(calls,1);
  }
 }finally{global.fetch=original;}
});
test('changed endpoint routing state invalidates an approved snapshot before any paid POST',async()=>{
 const oldBase=process.env.OPENAI_BASE_URL,original=global.fetch;let calls=0;
 try{
  delete process.env.OPENAI_BASE_URL;snapshot=await boundary.resolveFinalRequest('openai','image',{model:'gpt-image-1',prompt:'Approved original endpoint'});
  process.env.OPENAI_BASE_URL='https://changed-endpoint.invalid/v1';global.fetch=async()=>{calls++;throw Error('Must not submit');};
  await assert.rejects(require('../lib/providers/openai-image').adapter.generate('image',{}, {finalRequest:{id:'approved-test',fingerprint:'hash'}}),/adapter changed/);assert.equal(calls,0);
 }finally{global.fetch=original;if(oldBase===undefined)delete process.env.OPENAI_BASE_URL;else process.env.OPENAI_BASE_URL=oldBase;}
});
test('provider endpoint credentials are rejected without appearing in review',async()=>{
 const previous=process.env.OPENAI_BASE_URL;
 try{
  process.env.OPENAI_BASE_URL='https://example.invalid/v1?api_key=mock-secret';await assert.rejects(boundary.resolveFinalRequest('openai','image',{prompt:'x'}),/credential query/);
  process.env.OPENAI_BASE_URL='https://user:mock-password@example.invalid/v1';await assert.rejects(boundary.resolveFinalRequest('openai','image',{prompt:'x'}),/transport headers/);
 }finally{if(previous===undefined)delete process.env.OPENAI_BASE_URL;else process.env.OPENAI_BASE_URL=previous;}
});
test('raw adapter calls without final approval submit nothing',async()=>{
 let calls=0;const original=global.fetch;global.fetch=async()=>{calls++;throw Error('must not fetch');};
 try{await assert.rejects(require('../lib/providers/muapi-image').generate('image',{prompt:'x'},{}),/approved final/);assert.equal(calls,0);}finally{global.fetch=original;}
});
test.after(()=>{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(process.env.FILM_DATA_DIR,{recursive:true,force:true});});

 test('raw Gridlight LLM stream rejects a forged approval before fetch',async()=>{
  const original=global.fetch;let calls=0,reported;
  global.fetch=async()=>{calls++;throw new Error('must not reach transport');};
  try {
   const result=await require('../lib/providers/gridlight-adapter').adapter.generateStream('llm',{prompt:'mock prompt',finalRequest:{id:'forged',fingerprint:'forged'}},null,{finalRequest:{id:'forged',fingerprint:'forged'},onError:value=>{reported=value;}});
   assert.equal(result.ok,false);assert.equal(result.status,428);assert.equal(reported.status,428);assert.equal(calls,0);
  }finally{global.fetch=original;}
 });

test('edited outer input rejects unknown fields and unsupported image count or audio before fetch',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('no transport');};
 try{for(const extra of [{imaginary_option:'unsupported'},{n:7},{count:7},{audio:true},{resolution:'8k'},{aspect_ratio:'imaginary'},{seed:123456},{guidance_scale:999},{sampler:'unsupported_sampler'},{duration_s:99},{quality:'unsupported-ultra'},{size:'4096x4096'},{negative_prompt:'forbid red'},{target_polycount:99999}])await assert.rejects(()=>boundary.resolveFinalRequest('muapi','image',{model:'nano-banana-2',prompt:'exact',...extra}),/Unsupported editable input field|does not support|not an image|unsupported|Unsupported MuAPI|Unsupported editable muapi image option/);assert.equal(calls,0);}
 finally{global.fetch=original;}
});

test('inherited unsupported image defaults are removed and visibly disclosed before review',async()=>{
 const normalized=boundary.normalizeInheritedInputs('muapi','image',{model:'nano-banana-2',prompt:'exact',seed:123456,steps:30,guidance_scale:7});
 assert.equal(normalized.seed,undefined);assert.equal(normalized.steps,undefined);assert.equal(normalized.guidance_scale,undefined);
 assert.deepEqual(normalized.__not_sent_input_fields,['seed','steps','guidance_scale']);
 const resolved=await boundary.resolveFinalRequest('muapi','image',normalized);assert.ok(resolved.metadata.readOnlyInputFields.includes('__not_sent_input_fields'));
 assert.equal(resolved.body.seed,undefined);
});

test('unsupported technical choices reject across existing mesh, world and finishing builders',async()=>{
 for(const [provider,capability,payload] of [['meshy','model3d',{model:'meshy-6-lite',operation:'text_to_mesh',prompt:'exact'}],['worldlabs','world',{model:'marble-1.0-draft',prompt:'exact'}],['magnific','post',{model:'magnific-video-upscaler-precision',source_video:videoFile,target_resolution:'3840x2160'}]])
  for(const extra of [{guidance_scale:999},{sampler:'unsupported'}])await assert.rejects(()=>boundary.resolveFinalRequest(provider,capability,{...payload,...extra}),/Unsupported editable/);
});

test('outer reference count cannot be silently truncated by the native image builder',async()=>{
 await assert.rejects(()=>boundary.resolveFinalRequest('muapi','image',{model:'nano-banana-2',prompt:'exact',reference_images:Array.from({length:9},()=>({uri}))}),/Too many reference images/);
});

test('final prompt and native body controls remain editable rather than readonly metadata',async()=>{
 const visible=await boundary.resolveFinalRequest('muapi','image',{model:'nano-banana-2',prompt:'base',final_prompt:'full edited prompt',final_request_body:{prompt:'base',aspect_ratio:'1:1',resolution:'2k'}});
 assert.equal(visible.body.prompt,'full edited prompt');assert.equal(visible.body.resolution,'2k');
 assert.ok(!visible.metadata.readOnlyInputFields.includes('final_prompt'));assert.ok(!visible.metadata.readOnlyInputFields.includes('final_request_body'));
});

test('every selected plate records semantic identity with exact bytes and actual wire order',async()=>{
 const refs=[{uri,reference_role:'character',asset_id:'character-plate-v3',subject_kind:'character',subject_id:'character',version:3,name:'Maya'},{uri:secondUri,reference_role:'location',asset_id:'location-plate-v5',subject_kind:'location',subject_id:'location',version:5,name:'Kitchen'}];
 for(const provider of ['openai','google','muapi','runway']){
  const model={openai:'gpt-image-1',google:'gemini-3.1-flash-image',muapi:'nano-banana-2',runway:'gen4_image'}[provider];const resolved=await boundary.resolveFinalRequest(provider,'image',{model,prompt:'Exact ordered plates',reference_images:refs});
  assert.equal(resolved.references.length,2);resolved.references.forEach((ref,index)=>{assert.equal(ref.role,refs[index].reference_role);assert.equal(ref.source_asset_id,refs[index].asset_id);assert.equal(ref.subject_id,refs[index].subject_id);assert.equal(ref.version,refs[index].version);assert.equal(ref.order,index+1);assert.equal(ref.byte_length,png.length);assert.notEqual(ref.wire_role,ref.role);assert.equal(ref.sha256,crypto.createHash('sha256').update(index?secondPng:png).digest('hex'));});
 }
});
test('audio conditioning records full source bytes and rejects unsupported models or timeline transforms',async()=>{
 const file=path.join(dir,'approved-audio.wav'),bytes=Buffer.from('RIFF0000WAVEimmutable audio full source');fs.writeFileSync(file,bytes);
 const audio={file_path:file,reference_role:'dialogue',asset_id:'sound-v2',version:2,name:'Dialogue'};
 for(const [provider,model]of [['seedance','seedance-2.5'],['runway','seedance2_5']]){
  const resolved=await boundary.resolveFinalRequest(provider,'video',{model,prompt:'Exact sound source',init_image:uri,audio_references:[audio],duration_s:5});const ref=resolved.references.find(r=>r.mime.startsWith('audio/'));assert(ref);assert.equal(ref.role,'dialogue');assert.equal(ref.source_asset_id,'sound-v2');assert.equal(ref.version,2);assert.equal(ref.byte_length,bytes.length);assert.equal(ref.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.match(ref.wire_role,/audios_list|referenceAudio/);
  await assert.rejects(()=>boundary.resolveFinalRequest(provider,'video',{model,prompt:'exact',init_image:uri,audio_references:[{...audio,gain_db:0}],duration_s:5}),/conditioning does not support/);
 }
 await assert.rejects(()=>boundary.resolveFinalRequest('runway','video',{model:'gen4_turbo',prompt:'Exact',init_image:uri,audio_references:[audio],duration_s:5}),/audio references/);
 await assert.rejects(()=>boundary.resolveFinalRequest('seedance','video',{model:'seedance-2.5',workflow:'image-to-video',prompt:'Exact',init_image:uri,audio_references:[audio],duration_s:5}),/audio references/);
});
