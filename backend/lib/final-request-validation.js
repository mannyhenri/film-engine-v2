'use strict';
/** Closed validation of the native request, before the user can approve it. */
function fail(message){throw Object.assign(new Error(message),{status:400});}
function inferred(value){
 if(Array.isArray(value))return{type:'array',items:value.length?inferred(value[0]):{}};
 if(value && typeof value==='object')return{type:'object',properties:Object.fromEntries(Object.entries(value).map(([key,v])=>[key,inferred(v)])),additionalProperties:false};
 return{type:value===null?'null':typeof value};
}
const text={type:'string'};
const media={type:'string',minLength:1};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
function fieldSchema(spec={}){
 const types={int:'integer',bool:'boolean',choice:'string',url:'string',list:'array'};
 return{...spec,type:types[spec.type]||spec.type};
}
function schemaFor(provider,capability,request,nativeBody=request.body){
 const schema=inferred(nativeBody || {});
 const props=schema.properties || {};
 const fields=require('./providers/video-model-fields.json');
 if(provider==='runway'){
  const specs=fields.runway?.models?.[nativeBody.model] || {};
  for(const [key,spec]of Object.entries(specs))if(spec.type)props[key]=fieldSchema(spec);
  const imagePosition={type:'string',enum:specs.promptImage?.positions || ['first','last']};
  if(nativeBody.promptImage!==undefined)props.promptImage={oneOf:[media,{type:'array',maxItems:specs.promptImage?.maxItems||1,minItems:1,items:object({uri:media,position:imagePosition},['uri'])}]};
  if(nativeBody.referenceImages!==undefined)props.referenceImages={type:'array',minItems:1,maxItems:3,items:object({uri:media,tag:text},['uri'])};
  if(nativeBody.referenceAudio!==undefined)props.referenceAudio={type:'array',minItems:1,maxItems:specs.referenceAudio?.maxItems||2,items:object({uri:media,type:{type:'string',enum:['audio']}},['uri','type'])};
  if(nativeBody.shots!==undefined)props.shots={type:'array',minItems:3,maxItems:5,items:object({prompt:{type:'string',minLength:1,maxLength:1000},duration:{type:'integer',minimum:1,maximum:15}},['prompt','duration'])};
  if(request.mode==='multi_shot_video'){props.duration={type:'integer',minimum:5,maximum:15};props.ratio={type:'string',enum:['1280:720','1920:1080']};}
 }
 if(provider==='seedance'){
  const slug=request.url.split('/').pop();
  const specs=fields.muapi?.endpoints?.[slug] || {};
  for(const [key,spec]of Object.entries(specs))props[key]=fieldSchema(spec);
  if(nativeBody.duration!==undefined)props.duration={type:'integer',minimum:4,maximum:30};
  if(nativeBody.images_list!==undefined)props.images_list={type:'array',minItems:slug.includes('first-last')?2:1,maxItems:slug.includes('first-last')?2:30,items:media};
  if(nativeBody.audios_list!==undefined)props.audios_list={type:'array',maxItems:30,items:media};
  if(nativeBody.videos_list!==undefined)props.videos_list={type:'array',maxItems:30,items:media};
  if(slug.endsWith('image-to-video'))schema.required=['image_url'];
  if(slug.includes('first-last'))schema.required=['images_list'];
 }
 if(provider==='muapi'){
  const m=require('./providers/muapi-image');
  props.aspect_ratio={type:'string',enum:m.ACCEPTED_RATIOS||['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9']};
  if(nativeBody.resolution!==undefined)props.resolution={type:'string',enum:['1k','2k','4k']};
  if(nativeBody.images_list!==undefined){props.images_list={type:'array',minItems:1,maxItems:8,items:media};schema.required=['images_list'];}
 }
 if(provider==='google'){
  const m=require('./providers/google-image');
  props.input={type:'array',minItems:1,maxItems:9,items:{oneOf:[object({type:{enum:['text']},text},['type','text']),object({type:{enum:['image']},mime_type:{type:'string',enum:['image/png','image/jpeg','image/webp']},data:{type:'string',minLength:1}},['type','mime_type','data'])]}};
  // Text parts and image parts have distinct closed field sets.
  props.input.items.oneOf[0].required=['type','text'];
  props.response_format=object({type:{type:'string',enum:['image']},mime_type:{type:'string',enum:['image/jpeg']},image_size:{type:'string',enum:m.MODELS[request.model]?.sizes||[]},aspect_ratio:{type:'string',enum:m.ASPECTS}},['type','mime_type','image_size']);
  schema.required=['input','response_format','model'];
 }
 if(provider==='higgsfield'){
  const native=require('./providers/higgsfield-models.json').models[request.endpoint]?.schema;
  if(native)return native;
 }
 if(provider==='openai'){
  const m=require('./providers/openai-image');props.size={type:'string',enum:m.VALID_SIZES};props.quality={type:'string',enum:m.VALID_QUALITY};props.n={type:'integer',minimum:1,maximum:1};
 }
 if(provider==='magnific'){
  const m=require('./providers/magnific');props.resolution={type:'string',enum:m.TIERS.map(t=>t.id)};
  for(const [key,range]of Object.entries(m.MODELS[request.model]?.params||{}))props[key]=range==='bool'?{type:'boolean'}:typeof range[0]==='string'?{type:'string',enum:range}:{type:'number',minimum:range[0],maximum:range[1]};
  schema.required=['video','resolution'];
 }
 if(provider==='meshy'){
  if(nativeBody.prompt!==undefined)props.prompt={type:'string',minLength:1,maxLength:capability==='model3d'?600:16000};
  if(nativeBody.texture_prompt!==undefined)props.texture_prompt={type:'string',maxLength:600};
  if(nativeBody.reference_image_urls!==undefined){props.reference_image_urls={type:'array',minItems:1,maxItems:5,items:media};schema.required=['reference_image_urls'];}
 }
 schema.properties=props;
 return schema;
}
function validate(value,schema={},label='request'){
 if(schema.oneOf || schema.anyOf){const variants=schema.oneOf||schema.anyOf;for(const variant of variants){try{validate(value,variant,label);return;}catch(_){}}fail(`${label} has an unsupported structure or value`);}
 if(schema.enum && !schema.enum.includes(value))fail(`Unsupported ${label}: ${String(value)}`);
 if(schema.type){const matches=schema.type==='array'?Array.isArray(value):schema.type==='object'?!!value&&typeof value==='object'&&!Array.isArray(value):schema.type==='integer'?Number.isInteger(value):schema.type==='null'?value===null:typeof value===schema.type;if(!matches)fail(`Invalid type for ${label}`);}
 if(typeof value==='number'){if(!Number.isFinite(value))fail(`${label} must be finite`);if(schema.minimum!==undefined && value<schema.minimum || schema.maximum!==undefined && value>schema.maximum)fail(`${label} is outside the supported range`);}
 if(typeof value==='string'){if(schema.minLength!==undefined && value.length<schema.minLength || schema.maxLength!==undefined && value.length>schema.maxLength)fail(`${label} has an unsupported length`);}
 if(Array.isArray(value)){if(schema.minItems!==undefined&&value.length<schema.minItems || schema.maxItems!==undefined&&value.length>schema.maxItems)fail(`${label} has an unsupported reference count`);if(schema.items)value.forEach((item,i)=>validate(item,schema.items,`${label}[${i}]`));}
 else if(value && typeof value==='object'){
  for(const key of schema.required||[])if(!Object.prototype.hasOwnProperty.call(value,key))fail(`Missing required ${label}.${key}`);
  for(const [key,item]of Object.entries(value)){const property=schema.properties?.[key];if(!property){if(schema.additionalProperties===false)fail(`Unsupported provider field: ${label}.${key}`);}else validate(item,property,`${label}.${key}`);}
 }
}
function validateWireRequest(provider,capability,request,body,nativeBody){
 const schema=schemaFor(provider,capability,request,nativeBody);
 validate(body,schema);
 if(provider==='runway' && Array.isArray(body.shots) && body.shots.reduce((sum,shot)=>sum+shot.duration,0)!==body.duration)fail('The multi-shot durations must match the reviewed total duration');
 if(provider==='google')for(const part of body.input||[])if(part.type==='image'&&!/^[A-Za-z0-9+/]+={0,2}$/.test(part.data))fail('Google image parts need base64 content');
 return schema;
}
module.exports={schemaFor,validateWireRequest,validate};

function validateEditableInput(provider, capability, payload, request) {
 const files = {openai:'openai-image',google:'google-image',muapi:'muapi-image',runway:'runway',seedance:'seedance',higgsfield:'higgsfield',meshy:'meshy',worldlabs:'worldlabs',magnific:'magnific',elevenlabs:'elevenlabs','muapi-upscale':'muapi-topaz-upscale'};
 const shared = new Set(('prompt negative_prompt video_negative_prompt audio_policy video_audio_policy model stream num_frames fps __model_explicit __not_sent_input_fields preview_task_id texture_prompt steps cfg_scale guidance_scale strength denoise_strength sampler scheduler style preset safety_tolerance reference_images reference_assets init_image end_image image image_url image_path file_path source_video video_url source_width source_height source_bytes source_seconds source_frames source_fps camera_control interpolation delivery duration duration_s duration_ms width height aspect_ratio ratio resolution quality size seed format target_polycount texture_resolution symmetry pbr remove_background input_url output_format scale_factor operation workflow provider endpoint type final_prompt final_request_body final_request_approvals options provenance project_id shot_id scene_id subject_id subject_kind world_version_id source_paths generation_choices __project_id __shot_id __scene_id __seed __default_seed').split(' '));
 const file=files[provider];
 for(const field of (supportedInputFields[provider+'/'+capability]||'').split(' '))if(field)shared.add(field);
 if(file){const source=require('fs').readFileSync(require('path').join(__dirname,'providers',file+'.js'),'utf8');for(const match of source.matchAll(/\b(?:p|o|payload|options|input|opts)\.([A-Za-z_][A-Za-z_0-9]*)/g))shared.add(match[1]);}
 for(const key of Object.keys(payload || {}))if(!shared.has(key))fail(`Unsupported editable input field: ${key}`);
 for(const key of unsupportedInheritedFields(capability,payload,request,provider))fail(`Unsupported editable ${provider} ${capability} option: ${key}`);
 if(capability==='image'){
  const referenceLimit={muapi:8,google:8,openai:8,runway:3}[provider];
  if(referenceLimit && Array.isArray(payload.reference_images) && payload.reference_images.length>referenceLimit)fail(`Too many reference images: ${provider} supports ${referenceLimit}`);
  if(['muapi','google'].includes(provider) && payload.resolution!==undefined)fail('Select width and height for this image provider; an outer resolution option is unsupported');
  if(provider==='openai'){const m=require('./providers/openai-image');if(payload.size && !m.VALID_SIZES.includes(payload.size))fail('Unsupported OpenAI size');if(payload.quality && !m.VALID_QUALITY.includes(payload.quality))fail('Unsupported OpenAI quality');}
  if(provider==='muapi' && payload.aspect_ratio && !require('./providers/muapi-image').ACCEPTED_RATIOS.includes(payload.aspect_ratio))fail('Unsupported MuAPI aspect_ratio');
  for(const key of ['n','count','num_images'])if(payload[key]!==undefined && request.body?.[key]===undefined && !request.form?.has(key))fail(`${provider} does not support the selected image count field ${key}`);
  if(payload.audio!==undefined)fail('Audio is not an image generation option');
 }
}
module.exports.validateEditableInput=validateEditableInput;

const supportedInputFields = {
 'muapi/image':'prompt model width height aspect_ratio reference_images',
 'google/image':'prompt negative_prompt model width height aspect_ratio reference_images',
 'openai/image':'prompt negative_prompt model openai_model width height size quality reference_images',
 'runway/image':'model prompt promptText negative_prompt width height ratio aspect_ratio aspectRatio reference_images referenceImages seed',
 'runway/video':'model prompt promptText negative_prompt motion_prompt motion camera_control reference_images referenceImages keyframes promptImage init_image image_url ratio width height duration_s duration duration_auto resolution video_audio_policy audio generate_audio output_format video_negative_prompt audio_references seed runway_recipe mode shots videoUri video_uri references strength',
 'seedance/video':'model prompt motion_prompt negative_prompt seed duration_s duration duration_ms muapi_draft generate_audio audio video_audio_policy source_video video_url audio_references reference_images reference_videos init_image image_url end_image last_frame keyframes workflow aspect_ratio ratio resolution width height muapi_options',
 'seedance/post':'model type job_type upscaler source_video video_url input_url input_video init_video resolution quality duration_s duration_ms source_seconds source_duration_ms prompt aspect_ratio target_resolution',
 'higgsfield/image':'model prompt negative_prompt seed width height aspect_ratio reference_images init_image image_url higgsfield_options',
 'higgsfield/video':'model prompt motion_prompt negative_prompt duration_s duration duration_ms audio_references generate_audio audio seed higgsfield_options reference_images init_image image_url end_image workflow aspect_ratio width height',
 'meshy/image':'model prompt promptText negative_prompt width height aspect_ratio ratio reference_images generate_multi_view multi_view pose_mode',
 'meshy/model3d':'operation image_url image image_urls model prompt art_style style should_remesh negative_prompt seed should_texture texture_prompt input_task_id model_url height_meters animation_id animation_prompt preview_task_id refine',
 'worldlabs/world':'model display_name seed prompt images video is_pano',
 'magnific/post':'model target_resolution video_url source_video source_seconds source_fps creativity hdr fractality resemblance sharpness precision engine',
 'elevenlabs/voice':'text prompt voice_id elevenlabs_voice_id model stability similarity_boost speed language style use_speaker_boost previous_text next_text output_format',
 'elevenlabs/sfx':'text prompt description prompt_influence duration_s duration_seconds duration model',
 'elevenlabs/ambient':'text prompt description prompt_influence duration_s duration_seconds duration model',
 'elevenlabs/music':'prompt text description duration_s duration_seconds duration model vocals force_instrumental composition_plan seed workflow file stem_variation_id',
 'muapi-upscale/image-upscale':'image resolution'
};
const metadataInputFields = new Set(('final_prompt final_request_body final_request_approvals options provenance project_id shot_id scene_id subject_id subject_kind world_version_id source_paths generation_choices __project_id __shot_id __scene_id __seed __default_seed __model_explicit __not_sent_input_fields num_frames fps camera_control interpolation delivery output_format stream video_negative_prompt audio_policy video_audio_policy source_width source_height source_bytes source_seconds source_frames source_fps source_duration_ms capture_note captures_excluded format').split(' '));
const semanticInputs = new Set(('prompt negative_prompt model reference_images reference_assets init_image end_image image image_url image_path file_path source_video video_url duration duration_s duration_ms width height aspect_ratio ratio resolution quality size seed format target_polycount texture_resolution symmetry pbr operation workflow endpoint type steps cfg_scale guidance_scale strength denoise_strength sampler scheduler n count num_images audio').split(' '));
function unsupportedInheritedFields(capability,payload,request,provider) {
 const allowed=new Set((supportedInputFields[provider+'/'+capability] || '').split(' '));
 const result=[];
 for(const key of Object.keys(payload))if(!allowed.has(key) && !metadataInputFields.has(key))result.push(key);
 // A selected optional technical field must reach the wire, even when another
 // operation under the same capability supports a field with that name.
 const durationFields=['duration','duration_seconds','durationSeconds','music_length_ms','length_seconds'];
 const sent=key=>request.body?.[key]!==undefined || request.form?.has(key);
 for(const key of ['seed','steps','cfg_scale','guidance_scale','strength','denoise_strength','sampler','scheduler','duration','duration_s','duration_ms'])
  if(payload[key]!=null && !sent(key) && !(key.startsWith('duration') && durationFields.some(sent)))result.push(key);
 return [...new Set(result)];
}
module.exports.unsupportedInheritedFields=unsupportedInheritedFields;
module.exports.supportedInputFields=supportedInputFields;
module.exports.metadataInputFields=metadataInputFields;
