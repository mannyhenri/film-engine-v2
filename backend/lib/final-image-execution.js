'use strict';
/** Bookkeeping for an already authorized image request. The raw adapter owns the atomic paid claim. */
function executionPayload(review) {
 const snapshot=review.snapshot;
 const payload=JSON.parse(JSON.stringify(review.editable.payload));
 const body=snapshot.body?.encoding==='multipart'
  ? Object.fromEntries(snapshot.body.fields.filter(field=>field.value!==undefined).map(field=>[field.name,field.value]))
  : snapshot.body || {};
 payload.model=body.model || body.ai_model || snapshot.model;
 const prompt=body.promptText ?? body.prompt ?? body.text ?? body.input?.find(part=>part.type==='text')?.text;
 if(prompt!==undefined){payload.prompt=prompt;payload.final_prompt=prompt;}
 for(const field of ['quality','size','resolution','aspect_ratio','seed']){
  if(Object.prototype.hasOwnProperty.call(body,field))payload[field]=body[field];
 }
 const duration=body.duration ?? body.duration_s ?? body.duration_seconds ?? snapshot.metadata?.duration_s;
 if(duration!==undefined){payload.duration_s=Number(duration);payload.duration_seconds=Number(duration);}
 const audio=body.generate_audio ?? (body.sound!==undefined?body.sound==='on'||body.sound===true:undefined);
 if(audio!==undefined){payload.audio=audio;payload.generate_audio=audio;}
 payload.count=Number(body.n ?? body.batch_size ?? 1);
 if(body.n!==undefined)payload.n=Number(body.n);
 const size=/^(\d+)[x:](\d+)$/.exec(String(body.size || body.ratio || ''));
 if(size){payload.width=Number(size[1]);payload.height=Number(size[2]);}
 const tier=String(body.resolution || body.response_format?.image_size || '').toLowerCase();
 const longEdge={'1k':1024,'2k':2048,'4k':4096}[tier];
 if(longEdge){
  const aspect=/^(\d+):(\d+)$/.exec(String(body.aspect_ratio || body.response_format?.aspect_ratio || ''));
  const ratio=aspect?Number(aspect[1])/Number(aspect[2]):Number(payload.width||1)/Number(payload.height||1);
  payload.width=Math.round(ratio>=1?longEdge:longEdge*ratio);
  payload.height=Math.round(ratio>=1?longEdge/ratio:longEdge);
 }
 return payload;
}
async function executeApprovedImage(adapter,authorization,config={},opts={}) {
 const reviewStore=require('./final-request-review').store();
 const reviewed=reviewStore.get(authorization.finalRequest.id);
 // Reject replay before opening another local progress/job row. The adapter's
 // atomic claim additionally prevents concurrent or uncertain paid submissions.
 if(reviewed.state!=='approved')throw Object.assign(new Error('This final request was already sent or is not approved; resume its existing job'),{status:409});
 const payload=executionPayload(reviewed);
 const snapshot=reviewed.snapshot;
 const progress=require('./generation-progress');
 const jobs=require('./generation-jobs');
 const options={...opts,finalRequest:authorization.finalRequest};
 const metadata={...opts.jobMeta,final_request_review_id:reviewed.id,approved_fingerprint:reviewed.fingerprint,
  provider_model:snapshot.model,resolution:payload.resolution||payload.size||null,aspect_ratio:payload.aspect_ratio||null,
  duration_s:payload.duration_s??null,audio:payload.generate_audio??null,count:payload.count,
  approved_cost_quote:snapshot.quote,price_kind:'estimate'};
 let jobId=progress.start({provider:adapter.id,capability:'image',projectId:config.__project_id||null,
  shotId:config.__shot_id||null,sceneId:config.__scene_id||null,meta:metadata});
 const theirProgress=options.onProgress;
 options.onProgress=event=>{if(jobId && event)progress.report(jobId,event);if(typeof theirProgress==='function'){try{theirProgress(event);}catch(_){}}};
 const theirHandle=options.onHandle;
 options.onHandle=(handle,facts)=>{
  let meter=null;
  try{const plan=adapter.meter?.('image',payload,null);if(plan && Number(plan.quantity)>0)meter={unit:plan.unit,quantity:plan.quantity,model:plan.model||null,parts:plan.parts||null};}catch(_){}
  const meta={...metadata,...facts,...(meter?{meter}:{})};
  jobId=jobId?progress.attachHandle(jobId,handle,meta):jobs.record({provider:adapter.id,capability:'image',requestId:handle,
   projectId:config.__project_id||null,shotId:config.__shot_id||null,sceneId:config.__scene_id||null,meta});
  if(typeof theirHandle==='function'){try{theirHandle(handle,facts);}catch(_){}}
  return jobId;
 };
 options.onTimeout=(handle,waitedMs)=>jobs.timedOut({provider:adapter.id,jobId,requestId:handle,waitedMs});
 function settle(result){progress.flush(jobId);if(!jobId)return;if(result?.ok)jobs.complete(jobId,{});else if(!result?.pending)jobs.fail(jobId,result?.error);}
 try{
  const result=await require('./providers').metered(adapter,config).generate('image',payload,options);
  settle(result);
  return {...result,provider:result.provider||adapter.id,generation_job_id:jobId};
 }catch(error){settle({ok:false,error:error.message});throw error;}
}
module.exports={executionPayload,executeApprovedImage};
