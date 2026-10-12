import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeProjectEpoch, projectEpoch } from '../../lib/project-epoch.js';
import { reviewApi, cancelledReview, prepareFinalRequest } from './request-bridge.js';
import './final-request-review.css';
import {handoffEligible,useDesktopAvailability,copyHandoff,ImageHandoffResult} from './ImageHandoff.jsx';
import ExpressionPicker from './ExpressionPicker.jsx';

const json = value => JSON.stringify(value, null, 2);
const clone = value => JSON.parse(JSON.stringify(value));
function fullPromptOf(snapshot) {
 const body=snapshot?.body || {};
 if (typeof body.prompt === 'string') return body.prompt;
 if (typeof body.promptText === 'string') return body.promptText;
 if (typeof body.text === 'string') return body.text;
 const multipart=body.fields?.find(field=>field.name==='prompt');
 if (typeof multipart?.value==='string') return multipart.value;
 if (typeof body.instances?.[0]?.prompt==='string') return body.instances[0].prompt;
 if (typeof body.world_prompt?.text_prompt==='string') return body.world_prompt.text_prompt;
 const textPart=Array.isArray(body.input)?body.input.find(part=>part.type==='text'):null;
 if(typeof textPart?.text==='string')return textPart.text;
 return undefined;
}
const readOnlyFieldsOf = review => review.snapshot?.metadata?.readOnlyInputFields || [];
const editableOf = review => {
 const edited=clone(review.editable || {provider:review.snapshot?.provider,capability:review.snapshot?.capability,payload:review.snapshot?.payload || {}});
 const prompt=fullPromptOf(review.snapshot);
 for(const key of readOnlyFieldsOf(review))delete edited.payload[key];
 if(prompt!==undefined) edited.payload.final_prompt=prompt;
 return edited;
};
const refsOf = payload => {const lists=[payload.references,payload.reference_images,payload.referenceImages,payload.refImages,payload.keyframes].filter(Array.isArray);return lists.find(list=>list.length)||lists[0]||[];};
const sourceKeyOf = (ref,provider) => !ref || typeof ref!=='object'?'uri':(String(provider).startsWith('openai')?['file_path','uri','url','image_url','src','image','path','asset_id','data']:['uri','url','image_url','src','image','file_path','path','asset_id','data']).find(key=>key in ref) || 'uri';
const roleKeyOf = ref => !ref || typeof ref!=='object'?'role':['reference_role','role','kind','tag','type'].find(key=>key in ref) || 'role';
const previewOf = ref => ref && (typeof ref.data==='string' ? (ref.data.startsWith('data:') ? ref.data : `data:${ref.mime || 'image/png'};base64,${ref.data}`) : undefined) || ref?.preview_url;
const modelOf = (payload,provider) => (String(provider).startsWith('openai')?payload.openai_model:undefined) || payload.model || payload.modelId || payload.model_id || '';
const promptOf = payload => payload.final_prompt ?? payload.prompt ?? payload.text ?? '';

export function FinalRequestReviewDialog({ initialReview, onSend, onCancel, onReview, request = reviewApi }) {
 const [review,setReview] = useState(initialReview);
 const [draft,setDraft] = useState(() => json(editableOf(initialReview)));
 const [bodyDraft,setBodyDraft]=useState(()=>json(initialReview.snapshot?.body || {})),[bodyDirty,setBodyDirty]=useState(false);
 const [dirty,setDirty] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState(''), [ack,setAck] = useState(false);
 const submitting = useRef(false);
 const mounted=useRef(true),epoch=useRef(projectEpoch());
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const live=()=>mounted.current && epoch.current===projectEpoch();
 const discard=reviews=>Promise.allSettled(reviews.filter(r=>r?.id).map(r=>request(`/final-request-review/${r.id}/cancel`,{})));
 const availability=useDesktopAvailability();
 const [destination,setDestination]=useState('api'),[handoff,setHandoff]=useState(null),[desktopNotice,setDesktopNotice]=useState('');
 let editable; try { editable=JSON.parse(draft); } catch { editable=null; }
 const payload=editable?.payload || {}, references=refsOf(payload), snapshot=review.snapshot || {}, quote=snapshot.quote || review.quote || {};
 const update = fn => { if (!editable || handoff) return; const next=clone(editable); fn(next); setDraft(json(next)); setDirty(true); setAck(false); setError(''); };
 async function resolve() {
  if (!live() || submitting.current) return;
  let edited; try { edited=JSON.parse(draft); if(bodyDirty){edited.payload.final_request_body=JSON.parse(bodyDraft);const full=fullPromptOf({body:edited.payload.final_request_body});if(full!==undefined)edited.payload.final_prompt=full;} } catch { setError('Request edits must be valid JSON.'); return; }
  submitting.current=true; setBusy(true); setError('');
  try {
   const prior=editableOf(review);
   for(const key of readOnlyFieldsOf(review)){if(key in edited.payload)throw new Error(`Request metadata is read-only: ${key}`);if(Object.prototype.hasOwnProperty.call(review.editable.payload,key))edited.payload[key]=clone(review.editable.payload[key]);}
   // The immutable token identifies the original route item and selects the
   // edited provider request. Never alter the original route body to dispatch
   // a newly chosen provider or model.
   const normalized=await request('/final-request-review',{...edited,provenance:prior.provenance || snapshot.provenance || initialReview.provenance,replaces_review_id:review.id});
   onReview?.(normalized);
   if(!live()){await discard([normalized]);return;}
   const next={...normalized,route_request:review.route_request};
   setReview(next); setDraft(json(editableOf(next))); setBodyDraft(json(next.snapshot?.body || {}));setBodyDirty(false); setDirty(false); setAck(false);
  } catch (e) { if(live())setError(e.message); }
  finally { submitting.current=false; if(live())setBusy(false); }
 }
 async function refresh(nextBody) {
  if(!live() || submitting.current || !review.route_request)return;
  submitting.current=true;setBusy(true);setAck(false);setError('');
  try {
   const routeRequest={...review.route_request,...(nextBody && !nextBody.nativeEvent?{body:nextBody}:{})};
   const prepared=await request('/final-request-review/prepare',routeRequest);
   const candidates=prepared.reviews || (prepared.id?[prepared]:[]);
   candidates.forEach(next=>onReview?.(next));
   if(!live()){await discard(candidates);return;}
   if(candidates.length!==1){await discard(candidates);throw new Error('Cancel and start this batch again to review every refreshed item before Send.');}
   const next={...candidates[0],route_request:routeRequest};
   setReview(next);setDraft(json(editableOf(next)));setBodyDraft(json(next.snapshot?.body || {}));setBodyDirty(false);setDirty(false);
  }catch(e){if(live())setError(e.message);}finally{submitting.current=false;if(live())setBusy(false);}
 }
 async function send() {
  if (!live() || submitting.current || dirty || !ack) return;
  submitting.current=true; setBusy(true); setError('');
  try {
   if(destination!=='api') {
    const saved=handoff || await request(`/final-request-review/${review.id}/handoff`,{fingerprint:review.fingerprint,human_confirmed:true});
    if(!live())return;
    setHandoff(saved);
    const opened=await copyHandoff(saved,destination);
    if(!live())return;
    if(!opened.copied || !opened.opened)throw new Error(opened.error || opened.reason || 'Desktop handoff unavailable');
    setDesktopNotice(opened.note);
    submitting.current=false;setBusy(false);
    return;
   }
   const unknownCost=quote.amount==null && quote.estimated_cost==null && quote.credits==null;
   const approved=await request(`/final-request-review/${review.id}/approve`, {fingerprint:review.fingerprint,human_confirmed:true,...(unknownCost?{cost_unknown_ack:true}:{})});
   const token=approved.approval || approved;
   onReview?.(token);
   if(!live()){await discard([token]);return;}
   await onSend({...token,...(review.route_request?{__route_body:review.route_request.body}:{})});
  } catch(e) { if(live()){setError(e.message); submitting.current=false; setBusy(false); setAck(false);} }
 }
 async function cancel() {
  if (!live() || submitting.current) return;
  // Latch before awaiting the server, just as Send does.
  submitting.current=true;setBusy(true);
  if(handoff)return onSend({__manual_handoff:{handoff_id:handoff.id,target:handoff.target,pending:true}});
  // Cancel before Send must never call the generation endpoint.
  try { await request(`/final-request-review/${review.id}/cancel`, {}); } catch (_) {}
  if(live())onCancel();
 }
 const snapshotRefs=snapshot.references || snapshot.media || [];
 const batch=initialReview.review_position;
 const sendLabel=batch?.total>1?(batch.index===batch.total-1?`Send all ${batch.total} reviewed requests`:'Approve item and review next'):'Send exact reviewed request';
 const canSend=!busy && !handoff && !dirty && ack && Boolean(review.id && review.fingerprint) && review.state !== 'cancelled' && (destination==='api'||(destination==='chatgpt'?availability.available:availability.browser_available));
 return <div className="final-review-overlay"><section className="final-review-dialog" role="dialog" aria-modal="true" aria-label="Final provider request review">
  <header><h2>{snapshot.capability==='video'?'Are you ready to generate the video?':'Review the final provider request'}{snapshot.capability!=='video'&&batch?.total>1?` (${batch.index+1} of ${batch.total})`:null}</h2>{snapshot.capability==='video'&&batch?.total>1&&<span>({batch.index+1} of {batch.total})</span>}<button aria-label="Cancel final review" disabled={busy} onClick={cancel}>×</button></header>
  <div className="final-review-body">
   {batch?.total>1&&<p>No provider request is sent until every item has been reviewed and you click Send all on the last item.</p>}
   <p>Edit the request, then resolve your edits to see the exact provider values. Send approves this visible snapshot. A changed source, quote or provider request requires a new review.</p>
   {handoffEligible(review)&&<label>Image generation destination<select aria-label="Image generation destination" value={destination} disabled={busy||!!handoff} onChange={e=>{setDestination(e.target.value);setAck(false);setError('');}}><option value="api">Selected API provider</option><option value="chatgpt" disabled={!availability.available}>ChatGPT Desktop — copy prompt and open app{availability.available?'':` (${availability.reason})`}</option><option value="browser" disabled={!availability.browser_available}>ChatGPT web — copy prompt and open browser</option></select></label>}
   {snapshot.capability==='image'&&!handoffEligible(review)&&<p>ChatGPT manual handoff is available for standalone storyboard frames and character, location or prop images. Dependent flow, pipeline, station and in-between images need their existing workflow delivery.</p>}
   {destination!=='api'&&<p>Manual image generation: nothing is sent to an API. Switch to Chat, paste the copied prompt and attach the exported reference images yourself. {batch?.total>1?'This hands off this item only and stops the batch; no API requests from this batch are sent.':''}</p>}
   {handoff&&<><p role="status">{desktopNotice}</p><ImageHandoffResult handoff={handoff} request={request} onImported={result=>onSend({__manual_handoff:{handoff_id:handoff.id,target:handoff.target,result}})} onFinish={()=>onSend({__manual_handoff:{handoff_id:handoff.id,target:handoff.target,pending:true}})}/></>}
   {!handoff && review.route_request && /\/shots\/[^/]+\/storyboard\/regenerate$/.test(review.route_request.path) && <ExpressionPicker review={review} request={request} disabled={busy||dirty} onApply={selections=>refresh({...review.route_request.body,expression_references:selections})}/>}
   <div className="final-review-grid">
    <label>Provider<input value={editable?.provider || ''} disabled={busy||!!handoff||!editable} onChange={e=>update(x=>{x.provider=e.target.value;})}/></label>
    <label>Model<input value={modelOf(payload,editable?.provider)} disabled={busy||!!handoff||!editable} onChange={e=>update(x=>{const key='modelId' in x.payload?'modelId':'model_id' in x.payload?'model_id':'model';x.payload[key]=e.target.value;if(String(x.provider).startsWith('openai')){x.payload.model=e.target.value;x.payload.openai_model=e.target.value;}})}/></label>
   </div>
   <label>Full prompt<textarea aria-label="Full prompt" rows="7" value={promptOf(payload)} disabled={busy||!!handoff||!editable} onChange={e=>update(x=>{x.payload.final_prompt=e.target.value;})}/></label>
   {references.length>0&&<fieldset><legend>Ordered reference images and roles</legend>{references.map((ref,i)=><div className="final-review-reference" key={i}>
    <span>{i+1}. {ref?.moodboard_entry_id ? `Moodboard: ${(ref.influence_roles || []).join(', ')}. ${ref.influence_note || ''}` : ref?.kind || ''}</span>{ref&&typeof ref==='object'&&previewOf(ref)&&<img src={previewOf(ref)} alt={`Reference ${i+1}`}/>}
    <input aria-label={`Reference ${i+1}`} value={typeof ref==='string'?ref:ref?.[sourceKeyOf(ref,editable.provider)]||''} disabled={busy||!!handoff} onChange={e=>update(x=>{const list=refsOf(x.payload);if(typeof list[i]==='string')list[i]=e.target.value;else if(!list[i]||typeof list[i]!=='object')list[i]={uri:e.target.value};else{const key=sourceKeyOf(list[i],x.provider);list[i][key]=e.target.value;}})}/>
    {ref&&typeof ref==='object'&&<input aria-label={`Reference ${i+1} role`} value={ref[roleKeyOf(ref)]||''} disabled={busy||!!handoff} onChange={e=>update(x=>{const ref=refsOf(x.payload)[i];ref[roleKeyOf(ref)]=e.target.value;})}/>}
    <button aria-label={`Move reference ${i+1} up`} disabled={busy||!!handoff||i===0} onClick={()=>update(x=>{const list=refsOf(x.payload);[list[i-1],list[i]]=[list[i],list[i-1]];})}>↑</button>
    <button aria-label={`Move reference ${i+1} down`} disabled={busy||!!handoff||i===references.length-1} onClick={()=>update(x=>{const list=refsOf(x.payload);[list[i+1],list[i]]=[list[i],list[i+1]];})}>↓</button>
    <button aria-label={`Remove reference ${i+1}`} disabled={busy||!!handoff} onClick={()=>update(x=>refsOf(x.payload).splice(i,1))}>Remove</button>
   </div>)}</fieldset>}
   {snapshot.metadata?.readOnlyInputFields?.length>0&&<p>Read-only application metadata (not provider options): {snapshot.metadata.readOnlyInputFields.filter(key=>key!=='__not_sent_input_fields').join(', ') || 'None'}.</p>}
   {review.editable?.payload?.__not_sent_input_fields?.length>0&&<p>Not sent by this provider: {review.editable.payload.__not_sent_input_fields.join(', ')}.</p>}
   <label>All request inputs and options (editable JSON)<textarea aria-label="All request inputs and options" rows="10" value={draft} disabled={busy||!!handoff} spellCheck={false} onChange={e=>{setDraft(e.target.value);setDirty(true);setAck(false);setError('');}}/></label>
   <button disabled={busy||!!handoff||!dirty} onClick={resolve}>{busy?'Validating…':'Resolve edits and update final review'}</button>
   {review.route_request&&<button disabled={busy||!!handoff} onClick={refresh}>Refresh final review</button>}
   {dirty&&<p role="status">Edits are not approved. Resolve them before Send.</p>}
   <h3>Exact resolved provider request</h3>
   {snapshot.body?.encoding!=='multipart'&&<label>Resolved provider fields (editable JSON)<textarea aria-label="Resolved provider fields" rows="10" disabled={busy||!!handoff} value={bodyDraft} onChange={e=>{setBodyDraft(e.target.value);setBodyDirty(true);setDirty(true);setAck(false);setError('');}}/></label>}
   <p>Endpoint: {snapshot.endpoint || snapshot.request?.endpoint || 'See request below'}. Provider: {snapshot.provider || editable?.provider}. Model: {snapshot.model || snapshot.request?.body?.model || 'See request below'}.</p>
   {snapshotRefs.length>0&&<div>{snapshotRefs.map((ref,i)=><div className="final-review-reference" key={i}>{previewOf(ref)&&(ref.mime?.startsWith('video/')?<video src={previewOf(ref)} controls preload="metadata" aria-label={`Resolved video reference ${i+1}`}/>:ref.mime?.startsWith('audio/')?<audio src={previewOf(ref)} controls preload="none" aria-label={`Resolved audio reference ${i+1}`}/>:ref.mime?.startsWith('model/')||ref.mime==='application/octet-stream'?<a href={previewOf(ref)} download={`approved-reference-${i+1}`}>Download exact model reference bytes</a>:<img src={previewOf(ref)} alt={`Resolved reference ${i+1}`}/>)}<span>{ref.order ?? i+1}. {ref.role || 'reference'} · {ref.wire_role || 'wire role not recorded'} · {ref.byte_length ?? 'unknown'} bytes{ref.moodboard_entry_id ? ` · Moodboard ${(ref.influence_roles || []).join(', ')} · ${ref.influence_note || ''} · ${ref.byte_length} bytes` : ''} <code>{ref.sha256 || ref.content_hash || ref.hash}</code>{ref.annotated?' · annotations included':''}</span></div>)}</div>}
   <pre aria-label="Exact resolved provider request">{json(snapshot)}</pre>
   <h3>{destination!=='api'?'Manual handoff cost':'Cost review'}</h3>{destination!=='api'?<p>No Film Engine API generation is submitted or charged. Your ChatGPT plan and available image-generation limits apply when you generate there.</p>:<>{quote.range&&<p>Provider estimate: {Array.isArray(quote.range)?quote.range.join('–'):`${quote.range.min}–${quote.range.max}`} {quote.currency || quote.unit || 'credits'}. This range is an estimate, not the final billed charge.</p>}<p>{quote.estimated_cost != null ? `${quote.estimated_cost} ${quote.currency || quote.unit || 'credits'} estimated` : quote.amount != null ? `${quote.amount} ${quote.currency || quote.unit || 'credits'} estimated` : 'Verified cost estimate unavailable. The provider may charge credits.'} This is an estimate, not a reported provider charge.{quote.expires_at?` Quote expires ${quote.expires_at}.`:''}</p></>}
   <code className="final-review-fingerprint">Approved request fingerprint: {review.fingerprint}</code>
   <label className="final-review-consent"><input type="checkbox" checked={ack} disabled={busy||dirty||!!handoff} onChange={e=>setAck(e.target.checked)}/> {destination!=='api'?'I approve this exact image prompt and reference snapshot for a manual ChatGPT handoff.':'I approve this exact resolved request and the displayed cost terms.'}</label>
   {error&&<p role="alert">{error}</p>}
  </div>
  <footer><button disabled={busy} onClick={cancel}>{handoff?'Close handoff':'Cancel'}</button><button disabled={!canSend} onClick={send}>{busy?'Approving…':destination!=='api'?'Copy prompt & open ChatGPT':sendLabel}</button></footer>
 </section></div>;
}

export default function FinalRequestReview() {
 const [pending,setPending]=useState(null),[waiting,setWaiting]=useState(null),[stageBusy,setStageBusy]=useState(false),[stageError,setStageError]=useState('');
 const [manual,setManual]=useState(null);
 const queue=useRef([]),active=useRef(false),current=useRef(null),stageSending=useRef(false),itemKey=useRef(0);
 useEffect(()=>{
  let live=true;
  const show=async (id,position)=>{
   if(!live)throw cancelledReview();
   const epoch=projectEpoch();
   const review=typeof id==='object'?id:await reviewApi(`/final-request-review/${id}`);
   if(!live || epoch!==projectEpoch()){await Promise.allSettled([reviewApi(`/final-request-review/${review.id}/cancel`,{})]);throw cancelledReview();}
   return new Promise((resolve,reject)=>{
    queue.current.push({key:++itemKey.current,review:{...review,review_position:position && {index:position.index,total:position.total}},reviewIds:new Set([review.id]),onReview:position?.onReview,resolve,reject});
    if(!active.current){active.current=true;current.current=queue.current.shift();setPending(current.current);}
   });
  };
  window.__feOpenFinalRequestReview=show;
  window.__fePrepareFinalRequest=(path,opts)=>prepareFinalRequest(path,opts,show);
  window.__feObserveFinalRequestState=data=>{
   const result=[data,data?.result,data?.run,data?.job,...(Array.isArray(data?.runs)?data.runs:[]),...(Array.isArray(data?.jobs)?data.jobs:[])].find(item=>item?.next_review);
   if(result?.next_review && ['awaiting_review','waiting_review','paused'].includes(result.status || result.state)) {setWaiting(clone(result));setStageError('');}
  };
  const clear=()=>{
   const items=[current.current,...queue.current].filter(Boolean);
   current.current=null;queue.current=[];active.current=false;
   for(const item of items){
    item.reject(cancelledReview());
    void Promise.allSettled([...item.reviewIds].map(id=>reviewApi(`/final-request-review/${id}/cancel`,{})));
   }
   if(live){setPending(null);setWaiting(null);setStageError('');}
  };
  const unsubscribe=subscribeProjectEpoch(clear);
  return ()=>{live=false;unsubscribe();delete window.__feOpenFinalRequestReview;delete window.__fePrepareFinalRequest;delete window.__feObserveFinalRequestState;clear();};
 },[]);
 useEffect(()=>{
  let live=true,readEpoch=0;
  const open=async value=>{
   const epoch=++readEpoch;
   try {const h=await reviewApi(`/final-request-review/handoffs/${value.handoff_id}`);if(live&&epoch===readEpoch&&h.state==='prepared'){setManual(h);localStorage.setItem('fe-pending-image-handoff',h.id);}}
   catch(_){}
  };
  const ready=event=>{if(event.detail.pending)open(event.detail);else {setManual(current=>current?.id===event.detail.handoff_id?null:current);if(localStorage.getItem('fe-pending-image-handoff')===event.detail.handoff_id)localStorage.removeItem('fe-pending-image-handoff');window.loadStoryboard?.();window.loadCharacters?.();}};
  window.addEventListener('fe-image-handoff-ready',ready);
  const saved=localStorage.getItem('fe-pending-image-handoff');if(saved)open({handoff_id:saved});
  return ()=>{live=false;window.removeEventListener('fe-image-handoff-ready',ready);};
 },[]);
 function finish(item,value,error){
  // A late callback retains its owner and cannot settle a newer queue item.
  if(current.current!==item)return;
  current.current=null;setPending(null);active.current=false;
  if(error)item.reject(error);else item.resolve(value);
  if(queue.current.length){active.current=true;current.current=queue.current.shift();setPending(current.current);}
 }
 async function reviewNext() {
  if(stageSending.current || !waiting?.next_review)return;
  const epoch=projectEpoch();stageSending.current=true;
  setStageBusy(true);setStageError('');
  try {
   const next=waiting.next_review;
   const approved=await window.__fePrepareFinalRequest(next.path,{method:'POST',body:json(next.body || {})});
   if(approved.__manual_handoff){setWaiting(null);return;}
   const result=await reviewApi(next.path,JSON.parse(approved.body));
   if(epoch!==projectEpoch())return;
   if(result?.next_review) {setWaiting(clone(result));window.__feObserveFinalRequestState?.(result);}
   else setWaiting(null);
   window.dispatchEvent(new CustomEvent('fe-final-request-resumed',{detail:result}));
  }catch(e){if(e.code!=='FINAL_REQUEST_CANCELLED')setStageError(e.message);}
  finally{stageSending.current=false;setStageBusy(false);}
 }
 if(!pending && !waiting && !manual)return null;
 return createPortal(<>
  {manual&&!pending&&<aside className="final-review-waiting"><ImageHandoffResult key={manual.id} handoff={manual} request={reviewApi} onImported={result=>{setManual(current=>current?.id===manual.id?null:current);if(localStorage.getItem('fe-pending-image-handoff')===manual.id)localStorage.removeItem('fe-pending-image-handoff');window.dispatchEvent(new CustomEvent('fe-image-handoff-imported',{detail:result}));window.loadStoryboard?.();window.loadCharacters?.();}}/></aside>}
  {waiting&&!pending&&<aside className="final-review-waiting" role="status"><strong>Next request needs review</strong><p>The previous result is saved. Review its actual output reference before sending the next provider request.</p><button disabled={stageBusy} onClick={reviewNext}>{stageBusy?'Opening review…':'Review next request'}</button>{stageError&&<p role="alert">{stageError}</p>}</aside>}
  {pending&&<FinalRequestReviewDialog key={pending.key} initialReview={pending.review} onReview={review=>{if(review?.id)pending.reviewIds.add(review.id);pending.onReview?.(review);}} onSend={approval=>finish(pending,approval)} onCancel={()=>finish(pending,null,cancelledReview())}/>}
 </>,document.body);
}
