import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeProjectEpoch, projectEpoch } from '../../lib/project-epoch.js';
import { reviewApi, cancelledReview, prepareFinalRequest } from './request-bridge.js';
import './final-request-review.css';
import {handoffEligible,useDesktopAvailability,copyHandoff,ImageHandoffResult} from './ImageHandoff.jsx';
import ExpressionPicker from './ExpressionPicker.jsx';
import { reviewIdsIn } from './review-marker.js';

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
 // Runway multi-shot: one prompt per shot, handed over in order with its length.
 if(Array.isArray(body.shots)&&body.shots.some(shot=>typeof shot?.prompt==='string'))return body.shots.map((shot,i)=>`Shot ${i+1}${shot?.duration?` (${shot.duration}s)`:''}: ${shot?.prompt||''}`).join('\n');
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
// Manual generation: what the user copies into the vendor's own app.
const PROMPT_KEYS=new Set(['prompt','promptText','text','final_prompt','negative_prompt_text']);
const settingsOf = snapshot => {
 const body=snapshot?.body || {};
 const entries=body.encoding==='multipart'?(body.fields||[]).filter(f=>f.value!==undefined&&!f.data).map(f=>[f.name,f.value]):Object.entries(body);
 return entries.filter(([key,value])=>!PROMPT_KEYS.has(key)&&(value===null||['string','number','boolean'].includes(typeof value))&&!(typeof value==='string'&&(value.startsWith('data:')||value.length>200)));
};
// The original on disk first: the vendor's app takes the full-resolution source.
const assetPathOf = ref => ref?.source_path || ref?.path || ref?.file_path || '';
const tagOf = ref => (typeof ref?.tag === 'string' && ref.tag) ? '@' + ref.tag.replace(/^@/, '') : '';
const extOf = mime => ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','audio/wav':'wav','audio/mpeg':'mp3','model/gltf-binary':'glb'})[mime] || (mime||'').split('/')[1] || 'bin';
const assetLabelOf = ref => String((ref.tag && ref.tag.replace(/^@/, '')) || ref.role || 'reference').replace(/[^a-z0-9_-]+/gi,'-');
const assetNameOf = (ref,i,ext) => `${String(ref.order ?? i+1).padStart(2,'0')}-${assetLabelOf(ref)}.${ext || extOf(ref.mime)}`;
function reviewBase() { return typeof window.__feFinalReviewBase === 'function' ? window.__feFinalReviewBase() : 'http://localhost:3100/film'; }
async function downloadOriginal(reviewId, ref, i) {
 const response = await fetch(`${reviewBase()}/final-request-review/${reviewId}/references/${ref.order ?? i+1}/original`);
 if (!response.ok) throw new Error('The original file is not available');
 const url = URL.createObjectURL(await response.blob());
 const a = document.createElement('a'); a.href = url; a.download = assetNameOf(ref, i, (assetPathOf(ref).split('.').pop() || '').toLowerCase() || undefined); a.click();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const vendorOf = provider => ({openai:'ChatGPT / OpenAI',google:'Google (Gemini / Flow)',muapi:'muapi',seedance:'Seedance',runway:'Runway',higgsfield:'Higgsfield','muapi-upscale':'Topaz (via muapi)',meshy:'Meshy',worldlabs:'World Labs',magnific:'Magnific',elevenlabs:'ElevenLabs',topaz:'Topaz'})[provider] || provider || 'the generator';
async function copyText(text) {
 if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
 const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
}
function briefOf(snapshot,prompt,refs) {
 const lines=[`Generator: ${vendorOf(snapshot.provider)}${snapshot.model?` · model ${snapshot.model}`:''} · ${snapshot.capability || ''}`,'','PROMPT',prompt || '(no text prompt)'];
 const settings=settingsOf(snapshot);
 if(settings.length)lines.push('','SETTINGS',...settings.map(([k,v])=>`${k}: ${v}`));
 if(refs.length)lines.push('','ASSETS (in order)',...refs.map((ref,i)=>`${ref.order ?? i+1}. ${tagOf(ref)?tagOf(ref)+' ':''}${ref.role || 'reference'}${assetPathOf(ref)?` — ${assetPathOf(ref)}`:''}`));
 return lines.join('\n');
}

export function FinalRequestReviewDialog({ initialReview, onSend, onCancel, onReview, request = reviewApi }) {
 const [review,setReview] = useState(initialReview);
 const [draft,setDraft] = useState(() => json(editableOf(initialReview)));
 const [bodyDraft,setBodyDraft]=useState(()=>json(initialReview.snapshot?.body || {})),[bodyDirty,setBodyDirty]=useState(false);
 const [dirty,setDirty] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState(''), [copied,setCopied] = useState('');
 const submitting = useRef(false);
 const mounted=useRef(true),epoch=useRef(projectEpoch());
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const live=()=>mounted.current && epoch.current===projectEpoch();
 const discard=reviews=>Promise.allSettled(reviews.filter(r=>r?.id).map(r=>request(`/final-request-review/${r.id}/cancel`,{})));
 const availability=useDesktopAvailability();
 const [destination,setDestination]=useState('copy'),[handoff,setHandoff]=useState(null),[desktopNotice,setDesktopNotice]=useState('');
 let editable; try { editable=JSON.parse(draft); } catch { editable=null; }
 const payload=editable?.payload || {}, references=refsOf(payload), snapshot=review.snapshot || {};
 const update = fn => { if (!editable || handoff) return; const next=clone(editable); fn(next); setDraft(json(next)); setDirty(true); setError(''); };
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
   setReview(next); setDraft(json(editableOf(next))); setBodyDraft(json(next.snapshot?.body || {}));setBodyDirty(false); setDirty(false);
  } catch (e) { if(live())setError(e.message); }
  finally { submitting.current=false; if(live())setBusy(false); }
 }
 async function refresh(nextBody) {
  if(!live() || submitting.current || !review.route_request)return;
  submitting.current=true;setBusy(true);setError('');
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
 async function handOff() {
  if (!live() || submitting.current || dirty || destination==='copy') return;
  submitting.current=true; setBusy(true); setError('');
  try {
   const saved=handoff || await request(`/final-request-review/${review.id}/handoff`,{fingerprint:review.fingerprint,human_confirmed:true});
   if(!live())return;
   setHandoff(saved);
   const opened=await copyHandoff(saved,destination);
   if(!live())return;
   if(!opened.copied || !opened.opened)throw new Error(opened.error || opened.reason || 'Desktop handoff unavailable');
   setDesktopNotice(opened.note);
  } catch(e) { if(live())setError(e.message); }
  finally { submitting.current=false; if(live())setBusy(false); }
 }
 async function copy(kind) {
  setError('');
  try { await copyText(kind==='brief'?briefOf(snapshot,resolvedPrompt,snapshotRefs):resolvedPrompt); if(live())setCopied(kind==='brief'?'Prompt, settings and asset list copied.':'Prompt copied.'); }
  catch(e){ if(live())setError('Clipboard unavailable: '+e.message+'. Select the prompt text and copy it yourself.'); }
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
 const resolvedPrompt=fullPromptOf(snapshot) ?? promptOf(payload);
 const settings=settingsOf(snapshot);
 const batch=initialReview.review_position;
 const canHandOff=!busy && !handoff && !dirty && Boolean(review.id && review.fingerprint) && review.state !== 'cancelled' && (destination==='chatgpt'?availability.available:availability.browser_available);
 return <div className="final-review-overlay"><section className="final-review-dialog" role="dialog" aria-modal="true" aria-label="Final provider request review" data-review={review.id}>
  <header><h2>Prompt and assets for {vendorOf(snapshot.provider)}{batch?.total>1?` (${batch.index+1} of ${batch.total})`:null}</h2><button aria-label="Close final review" disabled={busy} onClick={cancel}>×</button></header>
  <div className="final-review-body">
   <p className="final-review-manual">Film Engine does not send this request. Copy the prompt, download the assets in order, and generate in {vendorOf(snapshot.provider)}'s own app with the settings below.</p>
   {batch?.total>1&&<p>Item {batch.index+1} of {batch.total}. Use Next and Previous to go through every item; Close ends the batch.</p>}
   <section className="final-review-handover" aria-label="Manual generation hand-over">
    <h3>Prompt</h3>
    <pre aria-label="Prompt to copy">{resolvedPrompt || ''}</pre>
    {settings.length>0&&<><h3>Settings to match</h3><dl className="final-review-settings">{settings.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></>}
    <h3>Assets ({snapshotRefs.length})</h3>
    {snapshotRefs.length?<ol aria-label="Assets to upload" className="final-review-assets">{snapshotRefs.map((ref,i)=><li key={i}>
     {previewOf(ref)&&ref.mime?.startsWith('image/')&&<img src={previewOf(ref)} alt={`Asset ${i+1}`}/>}
     <span>{ref.order ?? i+1}. {tagOf(ref)&&<strong>{tagOf(ref)} </strong>}{ref.role || 'reference'}{ref.mime?` · ${ref.mime}`:''}{assetPathOf(ref)?<> · <code>{assetPathOf(ref)}</code></>:null}{ref.source_transform?' · the prepared copy was re-encoded; download the original for full resolution':''}</span>
     {(ref.source_path||ref.path)&&<button type="button" aria-label={`Download original of asset ${i+1}`} onClick={()=>downloadOriginal(review.id,ref,i).catch(e=>live()&&setError(e.message))}>Download original</button>}
     {previewOf(ref)&&<a href={previewOf(ref)} download={assetNameOf(ref,i)} aria-label={`Download asset ${i+1}`}>{ref.source_path||ref.path?'Download prepared copy':'Download'}</a>}
     {assetPathOf(ref)&&<button type="button" aria-label={`Copy path of asset ${i+1}`} onClick={()=>copyText(assetPathOf(ref)).then(()=>live()&&setCopied('Path copied.')).catch(e=>setError(e.message))}>Copy path</button>}
    </li>)}</ol>:<p>No assets: this request is prompt only.</p>}
    {copied&&<p role="status">{copied}</p>}
   </section>
   {handoffEligible(review)&&<label>Image hand-off<select aria-label="Image generation destination" value={destination} disabled={busy||!!handoff} onChange={e=>{setDestination(e.target.value);setError('');}}><option value="copy">Copy prompt and download assets</option><option value="chatgpt" disabled={!availability.available}>ChatGPT Desktop — copy prompt and open app{availability.available?'':` (${availability.reason})`}</option><option value="browser" disabled={!availability.browser_available}>ChatGPT web — copy prompt and open browser</option></select></label>}
   {handoff&&<><p role="status">{desktopNotice}</p><ImageHandoffResult handoff={handoff} request={request} onImported={result=>onSend({__manual_handoff:{handoff_id:handoff.id,target:handoff.target,result}})} onFinish={()=>onSend({__manual_handoff:{handoff_id:handoff.id,target:handoff.target,pending:true}})}/></>}
   {!handoff && review.route_request && /\/shots\/[^/]+\/storyboard\/regenerate$/.test(review.route_request.path) && <ExpressionPicker review={review} request={request} disabled={busy||dirty} onApply={selections=>refresh({...review.route_request.body,expression_references:selections})}/>}
   <details className="final-review-edit"><summary>Edit the prompt, references or options</summary>
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
   <label>All request inputs and options (editable JSON)<textarea aria-label="All request inputs and options" rows="10" value={draft} disabled={busy||!!handoff} spellCheck={false} onChange={e=>{setDraft(e.target.value);setDirty(true);setError('');}}/></label>
   <button disabled={busy||!!handoff||!dirty} onClick={resolve}>{busy?'Validating…':'Resolve edits and update final review'}</button>
   {review.route_request&&<button disabled={busy||!!handoff} onClick={refresh}>Refresh final review</button>}
   {dirty&&<p role="status">Edits are not applied yet. Resolve them to update the prompt and assets above.</p>}
   <h3>Exact resolved provider request</h3>
   {snapshot.body?.encoding!=='multipart'&&<label>Resolved provider fields (editable JSON)<textarea aria-label="Resolved provider fields" rows="10" disabled={busy||!!handoff} value={bodyDraft} onChange={e=>{setBodyDraft(e.target.value);setBodyDirty(true);setDirty(true);setError('');}}/></label>}
   <p>Endpoint: {snapshot.endpoint || snapshot.request?.endpoint || 'See request below'}. Provider: {snapshot.provider || editable?.provider}. Model: {snapshot.model || snapshot.request?.body?.model || 'See request below'}.</p>
   {snapshotRefs.length>0&&<div>{snapshotRefs.map((ref,i)=><div className="final-review-reference" key={i}>{previewOf(ref)&&(ref.mime?.startsWith('video/')?<video src={previewOf(ref)} controls preload="metadata" aria-label={`Resolved video reference ${i+1}`}/>:ref.mime?.startsWith('audio/')?<audio src={previewOf(ref)} controls preload="none" aria-label={`Resolved audio reference ${i+1}`}/>:ref.mime?.startsWith('model/')||ref.mime==='application/octet-stream'?<a href={previewOf(ref)} download={`approved-reference-${i+1}`}>Download exact model reference bytes</a>:<img src={previewOf(ref)} alt={`Resolved reference ${i+1}`}/>)}<span>{ref.order ?? i+1}. {ref.role || 'reference'} · {ref.wire_role || 'wire role not recorded'} · {ref.byte_length ?? 'unknown'} bytes{ref.moodboard_entry_id ? ` · Moodboard ${(ref.influence_roles || []).join(', ')} · ${ref.influence_note || ''} · ${ref.byte_length} bytes` : ''} <code>{ref.sha256 || ref.content_hash || ref.hash}</code>{ref.annotated?' · annotations included':''}</span></div>)}</div>}
   <pre aria-label="Exact resolved provider request">{json(snapshot)}</pre>
   </details>
   {error&&<p role="alert">{error}</p>}
  </div>
  <footer><button disabled={busy} onClick={cancel}>Close</button>{batch?.total>1&&<span className="final-review-nav">{batch.index>0&&<button disabled={busy} onClick={()=>onSend({__manual_nav:'previous'})}>Previous item</button>}{batch.index<batch.total-1&&<button disabled={busy} onClick={()=>onSend({__manual_nav:'next'})}>Next item</button>}</span>}{destination==='copy'?<><button disabled={busy||dirty} onClick={()=>copy('brief')}>Copy prompt, settings &amp; asset list</button><button disabled={busy||dirty} onClick={()=>copy('prompt')}>Copy prompt</button></>:<button disabled={!canHandOff} onClick={handOff}>{busy?'Preparing…':'Copy prompt & open ChatGPT'}</button>}</footer>
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
  const announced=new Set();
  window.__feObserveFinalRequestState=data=>{
   // A streamed route names each item's manual review in its events: open each
   // once. Only stream events (a typed object), never a listing that happens to
   // carry an old job's error, and only a review still awaiting its hand-over.
   if(data&&typeof data==='object'&&!Array.isArray(data)&&typeof data.type==='string'){
    for(const id of reviewIdsIn(data)){
     if(announced.has(id))continue;announced.add(id);
     reviewApi(`/final-request-review/${id}`).then(r=>r?.state==='preview'?show(r):null).catch(()=>{});
    }
   }
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
