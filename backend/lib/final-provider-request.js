'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { fileURLToPath } = require('url');
const { AsyncLocalStorage } = require('async_hooks');
const attempts = new AsyncLocalStorage();
const approvedRequests = new WeakSet();
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function adapterVersion(provider) {
 const files = { openai:'openai-image', google:'google-image', muapi:'muapi-image', seedance:'seedance', runway:'runway', higgsfield:'higgsfield', 'muapi-upscale':'muapi-topaz-upscale', meshy:'meshy',worldlabs:'worldlabs',magnific:'magnific',elevenlabs:'elevenlabs' };
 if (!files[provider]) throw new Error(`Final request review is not supported for ${provider}`);
 const source=fs.readFileSync(path.join(__dirname,'providers',`${files[provider]}.js`));
 const routing={};
 for(const match of source.toString().matchAll(/process\.env\.([A-Z0-9_]+(?:BASE_URL|SLUG))/g)) {
  const name=match[1],value=process.env[name] || '';
  if(value && name.endsWith('URL'))validateEndpoint(value);
  routing[name]=value;
 }
 // Only include credential metadata when this adapter actually serves that URL.
 // API keys, account secrets and bearer tokens remain transport-only.
 if(/meta\.(?:base_url|baseUrl)/.test(source.toString())) {
  const meta=require('./providers/credentials').getCredential(provider==='muapi-upscale'?'muapi':provider)?.meta || {};
  const value=meta.base_url || meta.baseUrl || '';
  if(value)validateEndpoint(value);
  routing.credential_base_url=value;
 }
 return sha(Buffer.concat([source,Buffer.from(JSON.stringify(routing)),fs.readFileSync(__filename),fs.readFileSync(path.join(__dirname,'final-request-validation.js')),fs.readFileSync(path.join(__dirname,'providers','video-model-fields.json'))]));
}
function validateEndpoint(value) {
 let endpoint;try{endpoint=new URL(value);}catch(_){throw new Error('The provider endpoint must be an HTTP URL');}
 if(!['http:','https:'].includes(endpoint.protocol))throw new Error('The provider endpoint must be an HTTP URL');
 if(endpoint.username || endpoint.password)throw new Error('Provider credentials must use transport headers, not endpoint URLs');
 for(const name of endpoint.searchParams.keys())if(/^(?:key|api[_-]?key|token|access[_-]?token|authorization|auth|secret|credential|signature|sig)$|(?:secret|auth[_-]?token|api[_-]?key|x-amz-(?:credential|signature))/i.test(name))throw new Error('Provider credential query parameters cannot be included in final request review');
}
function builder(provider, capability, payload) {
 const p = payload || {};
 const modules = {openai:'openai-image',google:'google-image',muapi:'muapi-image',seedance:'seedance',runway:'runway',higgsfield:'higgsfield',meshy:'meshy',worldlabs:'worldlabs',magnific:'magnific',elevenlabs:'elevenlabs'};
 if(provider === 'muapi-upscale') {
  const parsed = require('./providers/muapi-upload').parseDataUri(p.image);
  if(!parsed) throw new Error('Upscale review needs immutable image bytes');
  const dimensions = require('./image-raster').dimensionsOfBuffer(parsed.bytes);
  const req = require('./providers/muapi-topaz-upscale').buildUpscaleRequest({...dimensions,resolution:p.resolution,image_url:'https://placeholder.invalid/source'});
  req.body.image_url = p.image;
  return req;
 }
 if(!modules[provider]) throw new Error(`No final request builder for ${provider}`);
 const m = require(`./providers/${modules[provider]}`);
 const adapter = m.adapter || m[`${provider}Adapter`];
 const models = adapter && ((adapter.modelsByCapability && adapter.modelsByCapability[capability]) || adapter.models?.[capability] || adapter.models);
 if(p.model && models && !(Array.isArray(models)?models.includes(p.model):Object.prototype.hasOwnProperty.call(models,p.model))) throw new Error(`Unsupported ${provider} ${capability} model: ${p.model}`);
 if(provider==='openai'&&p.openai_model&&models&&!(Array.isArray(models)?models.includes(p.openai_model):Object.prototype.hasOwnProperty.call(models,p.openai_model)))throw new Error(`Unsupported OpenAI image model: ${p.openai_model}`);
 if(provider==='meshy') {
  const base=(process.env.MESHY_BASE_URL || 'https://api.meshy.ai').replace(/\/+$/,'');
  if(capability==='image') { const body=m.buildImageRequest(p);return {url:base+(body.reference_image_urls?'/openapi/v1/image-to-image':'/openapi/v1/text-to-image'),body,model:body.ai_model}; }
  if(capability!=='model3d')throw new Error('Unsupported Meshy capability');
  if(p.operation==='refine_mesh') { if(!p.preview_task_id)throw new Error('Refinement needs the existing preview task ID');return {url:base+'/openapi/v2/text-to-3d',body:{mode:'refine',ai_model:p.model||'meshy-6-lite',preview_task_id:p.preview_task_id,...(p.texture_prompt?{texture_prompt:p.texture_prompt}:{})},operation:'refine_mesh',path:'/openapi/v2/text-to-3d',model:p.model||'meshy-6-lite'}; }
  const request=m.buildRequest(p);if(request.error)throw new Error(request.error);return {...request,url:base+request.path,model:request.body.ai_model || request.operation,followup:request.operation==='text_to_mesh' && p.refine!==false?'Texture refinement requires a separate final review after the preview task is available':null};
 }
 if(provider==='magnific') {
  if(capability!=='post')throw new Error('Magnific only serves video finishing');
  const source=p.video_url || p.source_video;if(!source)throw new Error('A source video is required');
  return {...m.buildVideoRequest({...p,video_url:source}),source_seconds:Number(p.source_seconds)||Number(p.duration_ms)/1000||Number(p.duration_s)||null,source_fps:Number(p.source_fps)||24};
 }
 if(provider==='elevenlabs') {
  const allowed={voice:['eleven_multilingual_v2','eleven_flash_v2_5','eleven_turbo_v2_5','eleven_v3'],sfx:['elevenlabs-sound-effects','eleven_text_to_sound_v2'],ambient:['eleven_text_to_sound_v2'],music:['music_v1','music_v2']};
  if(p.model && !allowed[capability]?.includes(p.model))throw new Error(`Unsupported ElevenLabs ${capability} model: ${p.model}`);
  if(capability==='music' && p.workflow==='music_separate') { const raw=p.file?.bytes;const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw?.data || raw || []);return m.buildStemSeparationRequest({...p,file:{...p.file,bytes}}); }
  const builds={voice:m.buildVoiceRequest,sfx:m.buildSfxRequest,ambient:m.buildAmbientRequest,music:m.buildMusicRequest};
  if(!builds[capability])throw new Error('Unsupported ElevenLabs capability');return builds[capability](p);
 }
 if(provider==='worldlabs') return m.buildRequest(p);
 if(provider==='higgsfield') return m.buildRequest(capability,p);
 if(provider==='seedance') return capability==='post'?m.buildPostRequest(p):m.buildVideoRequest(p);
 if(provider==='runway' && capability==='video') return p.runway_recipe==='multi_shot_video'?m.buildMultiShotRequest(p):m.buildVideoRequest(p);
 if(capability!=='image') throw new Error(`Final review is unavailable for ${provider}/${capability}`);
 return m.buildImageRequest(p);
}
async function resolveFinalRequest(provider, capability, payload) {
 const req = builder(provider,capability,payload);
 if(req.refused)throw new Error(req.refused);
 validateEndpoint(req.url);
 const nativeBody=req.body && JSON.parse(JSON.stringify(req.body));
 const validation=require('./final-request-validation');
 validation.validateEditableInput(provider,capability,payload,req);
 if(payload.options && Object.keys(payload.options).length) throw new Error('Generic options are unsupported. Edit the provider fields shown in the resolved request');
 if(payload.final_request_body) {
  if(req.form) throw new Error('Multipart request fields must be edited through the prompt and image controls');
  const editableFields=validation.schemaFor(provider,capability,req,nativeBody).properties || {};
  for(const key of Object.keys(payload.final_request_body)) if(!Object.prototype.hasOwnProperty.call(editableFields,key)) throw new Error(`Unsupported provider field: ${key}`);
  for(const key of ['model','ai_model','model_id'])if(Object.prototype.hasOwnProperty.call(payload.final_request_body,key) && payload.final_request_body[key]!==req.body[key])throw new Error('Select and validate the model before editing the final body');
  const edited=payload.final_request_body;
  for(const [key,value] of Object.entries(req.body)) {
   if(!Object.prototype.hasOwnProperty.call(edited,key))throw new Error(`Keep resolved field ${key}; change the editable provider option and resolve again to remove it`);
   if(Array.isArray(value)!==Array.isArray(edited[key]) || typeof value!==typeof edited[key])throw new Error(`Invalid type for provider field ${key}`);
  }
  const fields=require('./providers/video-model-fields.json');
  const specs = provider==='runway' ? fields.runway?.models?.[req.body.model] : (provider==='seedance'?fields.muapi?.endpoints?.[req.url.split('/').pop()]:null);
  for(const [key,spec] of Object.entries(specs||{})) {
   if(!Object.prototype.hasOwnProperty.call(edited,key))continue;
   const value=edited[key];
   if(spec.enum && !spec.enum.includes(value))throw new Error(`Unsupported ${key}: ${value}`);
   if(spec.type==='integer' && !Number.isInteger(value))throw new Error(`${key} must be an integer`);
   if(spec.minimum!==undefined && value<spec.minimum || spec.maximum!==undefined && value>spec.maximum)throw new Error(`${key} is outside the supported range`);
   if(spec.maxItems!==undefined && Array.isArray(value) && value.length>spec.maxItems)throw new Error(`Too many ${key} references`);
  }
  if(Object.prototype.hasOwnProperty.call(edited,'seed') && (!Number.isSafeInteger(edited.seed)||edited.seed<0||edited.seed>4294967295))throw new Error('Unsupported seed');
  req.body=JSON.parse(JSON.stringify(edited));
  // Edited wire options replace the measured metadata as well as the body.
  if(Number.isFinite(req.body.duration)){req.duration_s=req.body.duration;req.durationSeconds=req.body.duration;}
  if(Number.isFinite(req.body.duration_seconds)){req.duration_s=req.body.duration_seconds;req.durationSeconds=req.body.duration_seconds;}
  if(Number.isFinite(req.body.music_length_ms))req.durationSeconds=req.body.music_length_ms/1000;
  if(req.body.resolution)req.resolution=req.body.resolution;
  if(Object.prototype.hasOwnProperty.call(req,'estimatedCredits'))req.estimatedCredits=null;
  if(Object.prototype.hasOwnProperty.call(req,'estimated_usd'))req.estimated_usd=null;
 }
 if(Object.prototype.hasOwnProperty.call(payload,'final_prompt')) {
  const prompt=String(payload.final_prompt);
  if(req.form)req.form.set('prompt',prompt);
  else if(Object.prototype.hasOwnProperty.call(req.body,'promptText'))req.body.promptText=prompt;
  else if(Object.prototype.hasOwnProperty.call(req.body,'prompt'))req.body.prompt=prompt;
  else if(Object.prototype.hasOwnProperty.call(req.body,'text'))req.body.text=prompt;
  else if(req.body.world_prompt && Object.prototype.hasOwnProperty.call(req.body.world_prompt,'text_prompt'))req.body.world_prompt.text_prompt=prompt;
  else if(Array.isArray(req.body.input)) { const part=req.body.input.find(p=>p.type==='text'); if(part)part.text=prompt; else req.body.input.unshift({type:'text',text:prompt}); }
  else throw new Error('This provider request has no editable prompt');
 }
 if(req.body)validation.validateWireRequest(provider,capability,req,req.body,nativeBody);
 if(provider==='higgsfield')for(const drop of req.dropped||[])if(payload.higgsfield_options && Object.prototype.hasOwnProperty.call(payload.higgsfield_options,drop.field))throw new Error(`Unsupported selected Higgsfield option ${drop.field}: ${drop.why}`);
 if(req.missing && req.missing.length) throw new Error(`Missing options: ${req.missing.join(', ')}`);
 let body = req.body;
 const references=[];
 if(req.form) {
  const fields=[];
  for(const [name,value] of req.form.entries()) {
   if(typeof value==='string') fields.push({name,value});
   else {
    const bytes=Buffer.from(await value.arrayBuffer());
    fields.push({name,mime:value.type,filename:value.name,data:bytes.toString('base64')});
    references.push({role:name,wire_index:fields.length-1,path:req.referencePaths && req.referencePaths[references.length],mime:value.type,sha256:sha(bytes),data:`data:${value.type};base64,${bytes.toString('base64')}`});
   }
  }
  body={encoding:'multipart',fields};
 } else {
  body=JSON.parse(JSON.stringify(body));
  function walk(v,role,parent,key) {
   if(Array.isArray(v)) return v.forEach((x,i)=>walk(x,`${role}[${i}]`,v,i));
   if(v && typeof v==='object') {
    // Google image parts carry separate MIME/base64 fields.
    if(v.source==='data_base64' && v.data_base64) { const mime=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4'})[v.extension];if(!mime)throw new Error('Unknown reference extension');const bytes=Buffer.from(v.data_base64,'base64');references.push({role,mime,sha256:sha(bytes),data:`data:${mime};base64,${v.data_base64}`});return; }
    if(v.type==='image' && v.mime_type && v.data) { const bytes=Buffer.from(v.data,'base64'); references.push({role,mime:v.mime_type,sha256:sha(bytes),data:`data:${v.mime_type};base64,${v.data}`}); return; }
    return Object.entries(v).forEach(([k,x])=>walk(x,role?`${role}.${k}`:k,v,k));
   }
   if(typeof v!=='string') return;
   const match=/^data:([^;,]+);base64,(.+)$/s.exec(v);
   if(match) references.push({role,mime:match[1],sha256:sha(Buffer.from(match[2],'base64')),data:v});
   else if(isMediaField(role)) {
    if(/^https?:\/\//i.test(v))throw new Error(`Reference ${role} needs immutable bytes before review; a remote URL cannot prove its content`);
    let file=v;try{if(/^file:/i.test(v))file=fileURLToPath(v);}catch(_){throw new Error(`Reference ${role} has an invalid file URI`);}
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw new Error(`Reference ${role} needs resolved immutable bytes before review`);
    const bytes=fs.readFileSync(file); const mime = ({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav','.mp3':'audio/mpeg','.mp4':'video/mp4'})[path.extname(file).toLowerCase()] || require('./providers/muapi-upload').sniffMedia(bytes)?.mime; if(!mime) throw new Error('Unknown reference MIME type'); const data=`data:${mime};base64,${bytes.toString('base64')}`; references.push({role,mime,sha256:sha(bytes),data,path:file}); if(parent)parent[key]=data;
   }
  }
  walk(body,'');
 }
 // Every reference describes the bytes actually in the resolved request.
 // Input labels are attached only after a byte/order match; a selected plate
 // that a model dropped must never look like a used conditioning reference.
 references.forEach((ref,index)=>Object.assign(ref,{wire_role:ref.wire_role||ref.role,order:index+1,byte_length:Buffer.from(ref.data.split(',')[1],'base64').length,role:ref.mime.startsWith('audio/')?(ref.wire_index!==undefined?'audio_source':'audio_conditioning'):ref.mime.startsWith('video/')?'video_reference':'image_reference'}));
 function selectedBytes(ref,kind) {
  let source=typeof ref==='string'?ref:(ref?.uri||ref?.url||ref?.file_path||ref?.path);
  if(typeof source==='string' && /^file:/i.test(source)){try{source=fileURLToPath(source);}catch(_){return null;}}
  if(ref && typeof ref==='object' && (ref.data_base64||ref.data) && typeof (ref.data_base64||ref.data)==='string')return Buffer.from(ref.data_base64||ref.data,'base64');
  if(kind==='image') {const uri=require('./reference-images').resolveUri(typeof ref==='string'?{uri:ref}:ref);if(uri?.startsWith('data:'))return Buffer.from(uri.split(',')[1],'base64');}
  if(typeof source==='string' && source.startsWith('data:'))return Buffer.from(source.split(',')[1],'base64');
  if(typeof source==='string' && fs.existsSync(source))return fs.readFileSync(source);
  return null;
 }
 function describe(ref,selection,kind) {
  if(!selection || typeof selection!=='object')return;
  const details={role:selection.reference_role||selection.kind||(kind==='audio'?'audio_conditioning':'image_reference')};
  for(const key of ['name','asset_id','source_asset_id','subject_id','subject_kind','character_id','location_id','prop_id','version','asset_version','moodboard_entry_id','tag'])if(selection[key]!==undefined)details[key]=selection[key];
  if(selection.asset_id)details.source_asset_id=selection.asset_id;
  if(selection.file_path && fs.existsSync(selection.file_path)){
   const sourceHash=sha(fs.readFileSync(selection.file_path));details.source_path=selection.file_path;details.source_sha256=sourceHash;
   if(sourceHash===ref.sha256)details.path=selection.file_path;
   else details.source_transform='encoded_reference_bytes_differ';
  }
  Object.assign(ref,details);
 }
 const endpointImages=new Set(), imageSelections=new Map();
 function bindEndpoint(selection,fromEnd=false) {
  const bytes=selectedBytes(selection,'image');if(!bytes)return null;
  const candidates=references.filter(ref=>ref.mime.startsWith('image/')&&!endpointImages.has(ref));
  if(fromEnd)candidates.reverse();
  const ref=candidates.find(candidate=>candidate.sha256===sha(bytes));
  if(ref){endpointImages.add(ref);describe(ref,selection,'image');}return ref;
 }
 const first=payload.init_image||payload.image_url||payload.image||payload.promptImage,last=payload.last_frame||payload.end_image;
 const frames=payload.keyframes||[],endpoints=[first,last].filter(Boolean);
 const uriOf=selection=>typeof selection==='string'?selection:selection?.uri||selection?.url||selection?.file_path;
 const aliases=endpoints.length&&frames.length===endpoints.length&&frames.every((frame,i)=>uriOf(frame)===uriOf(endpoints[i]));
 if(aliases){const matched=frames.map(frame=>bindEndpoint(frame));endpoints.forEach((selection,i)=>{if(matched[i])describe(matched[i],selection,'image');});}
 else{if(first)bindEndpoint(first);if(last)bindEndpoint(last,true);frames.forEach(frame=>bindEndpoint(frame));}
 for(const [kind,list] of [['image',[...(payload.reference_images||payload.referenceImages||[]),...(payload.images||[])]],['audio',payload.audio_references||[]]]) {
  const candidates=references.filter(ref=>ref.mime.startsWith(kind+'/'));
  if(kind==='audio' && list.length && candidates.length!==list.length)throw new Error('This provider/model does not send every selected audio reference; no audio was sent');
  let cursor=0;
  for(const selection of list) {
   if(kind==='audio' && selection && typeof selection==='object' && ['offset_ms','source_in_ms','duration_ms','gain_db','muted','trim_start_ms','trim_end_ms'].some(key=>selection[key]!==undefined))throw new Error('Audio conditioning does not support timeline offset, trim, gain or mute; attach the full source or use a timeline audio track');
   const bytes=selectedBytes(selection,kind),digest=bytes && sha(bytes);
   const found=candidates.findIndex((ref,index)=>index>=cursor && !endpointImages.has(ref) && ref.sha256===digest);
   if(found<0)throw new Error(`The provider changed or omitted selected ${kind} reference bytes/order. Prepare a fresh review with a supported model.`);
   describe(candidates[found],selection,kind);if(kind==='image')imageSelections.set(selection,candidates[found]);cursor=found+1;
  }
 }
 // Keyframes and source clips may be used without being in reference_images.
 for(const [kind,list] of [['video',[...(payload.reference_videos||[]),payload.source_video,payload.video_url].filter(Boolean)]]) {
  const used=new Set();for(const selection of list){const bytes=selectedBytes(selection,kind);if(!bytes)continue;const ref=references.find(r=>!used.has(r)&&r.sha256===sha(bytes));if(ref){used.add(ref);describe(ref,selection,kind);}}
 }
 // Match the provider's actual ordered bytes, never infer success from its input list.
 const selected = payload.reference_images || [];
 if (selected.some(ref=>ref?.moodboard_entry_id)) {
  const images=references.filter(ref=>ref.mime?.startsWith('image/'));
  const prompt = body.encoding==='multipart' ? body.fields.find(f=>f.name==='prompt')?.value : body.prompt || body.promptText || body.input?.find(p=>p.type==='text')?.text || '';
  for (const ref of selected) {
   const actual=imageSelections.get(ref),position=images.indexOf(actual)+1;
   const uri=require('./reference-images').resolveUri(ref);
   if (!actual || !uri || sha(Buffer.from(uri.split(',')[1],'base64'))!==actual.sha256) throw new Error('The provider changed or omitted selected reference bytes/order. Prepare a fresh review.');
   Object.assign(actual,{role:ref.reference_role || ref.kind || 'reference',name:ref.name});
   if (ref.moodboard_entry_id) {
    const instruction=require('./moodboard-influence').instruction(ref,position);
    if (!prompt.includes(instruction)) throw new Error('Moodboard influence instructions exceed the provider prompt capacity or were removed. Shorten influence notes/prompt, or choose a provider with a longer prompt limit.');
    Object.assign(actual,{moodboard_entry_id:ref.moodboard_entry_id,influence_roles:ref.influence_roles,influence_note:ref.influence_note,board_order:ref.board_order});
   }
  }
 }
 const metadata = Object.fromEntries(Object.entries(req).filter(([k])=> !['body','form','url','referencePaths'].includes(k)));
 const editableInputs=new Set((validation.supportedInputFields[provider+'/'+capability] || '').split(' '));
 metadata.readOnlyInputFields=[...validation.metadataInputFields].filter(key=>!['final_prompt','final_request_body'].includes(key) && !editableInputs.has(key) && Object.prototype.hasOwnProperty.call(payload,key));

 return {provider,capability,endpoint:req.url,model:req.model || body.model || (provider==='runway' && payload.runway_recipe==='multi_shot_video'?'multi_shot_video':null),body,references,metadata,adapterVersion:adapterVersion(provider)};
}
function isMediaField(role) {
 const field=role.replace(/\[\d+\]/g,'').split('.').pop();
 return /^(?:uri|url|image|images|image_url|image_uri|image_path|image_urls|images_list|init_image|source_image|promptImage|reference_image_urls|video|video_url|video_urls|videos_list|videoUri|source_video|audio|audio_url|audio_urls|audios_list|first_frame_image|last_frame_image|keyframes)$/.test(field) || /_(?:url|uri|path)$/.test(field);
}
function restore(snapshot) {
 if(snapshot.body && snapshot.body.encoding==='multipart') {
  const form=new FormData();
  for(const field of snapshot.body.fields) {
   if(Object.prototype.hasOwnProperty.call(field,'value')) form.append(field.name,field.value);
   else form.append(field.name,new Blob([Buffer.from(field.data,'base64')],{type:field.mime}),field.filename);
  }
  return {...snapshot.metadata,url:snapshot.endpoint,form,model:snapshot.model};
 }
 return {...snapshot.metadata,url:snapshot.endpoint,body:JSON.parse(JSON.stringify(snapshot.body)),model:snapshot.model};
}
async function approvedRequest(provider,capability,opts) {
 if(!opts || !opts.finalRequest) throw Object.assign(new Error('An approved final provider request is required before Send'),{status:409});
 const store=require('./final-request-review').store();
 const claim=await store.claim(opts.finalRequest,provider,capability);
 if(claim.replay) throw Object.assign(new Error('This approved request was already sent; resume its existing job instead'),{status:409,request_id:claim.request_id});
 attempts.getStore()?.claimed.add(opts.finalRequest.id);
 const snapshot=claim.snapshot;
 if(snapshot.adapterVersion!==adapterVersion(provider)) throw Object.assign(new Error('The provider adapter changed. Review the final request again'),{status:409});
 // Claim freezes bytes; never reread mutable source paths during execution.
 const request=restore(snapshot);
 const previous=opts.onHandle;
 opts.onHandle=(handle,details)=>{store.submitted(opts.finalRequest.id,handle,{jobMeta:opts.jobMeta}); if(previous) return previous(handle,details);};
 request.finalRequestId=opts.finalRequest.id;
 require('./generation-transport').attach(request,{store,reviewId:opts.finalRequest.id,snapshot});
 approvedRequests.add(request);
 return request;
}
async function finishGeneration(opts,run) {
 return attempts.run({claimed:new Set()},async()=>{
  const owns=()=>opts?.finalRequest?.id && attempts.getStore().claimed.has(opts.finalRequest.id);
  try { let result=await run(); if(owns()) { result={...result,final_request_review_id:opts.finalRequest.id,meta:{...result.meta,final_request_review_id:opts.finalRequest.id}};const store=require('./final-request-review').store(); if(result.ok)store.complete(opts.finalRequest.id,result,{jobMeta:opts.jobMeta}); else store.uncertain(opts.finalRequest.id,result.error); } return result; }
  catch(error) { if(owns())require('./final-request-review').store().uncertain(opts.finalRequest.id,error.message); throw error; }
 });
}
function normalizeInheritedInputs(provider,capability,payload) {
 const request=builder(provider,capability,payload), result={...payload};
 const ignored=require('./final-request-validation').unsupportedInheritedFields(capability,payload,request,provider);
 for(const key of ignored)delete result[key];
 if(ignored.length)result.__not_sent_input_fields=[...(payload.__not_sent_input_fields || []),...ignored].filter((key,index,all)=>all.indexOf(key)===index);
 return result;
}
module.exports={normalizeInheritedInputs,resolveFinalRequest,approvedRequest,restore,adapterVersion,finishGeneration,isApprovedRequest:request=>approvedRequests.has(request)};
