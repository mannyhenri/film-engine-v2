import { useEffect, useRef, useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { reviewApi, cancelledReview } from '../../components/FinalRequestReview/request-bridge.js';
import { projectEpoch } from '../../lib/project-epoch.js';

export default function UpscaleFrameDialog({ shotId, projectId, onClose, onComplete }) {
 const [resolution,setResolution]=useState('2K'),[plan,setPlan]=useState(null),[review,setReview]=useState(null),[job,setJob]=useState(null),[error,setError]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const alive=useRef(true),sending=useRef(false),reviewRef=useRef(null),completed=useRef(false),epoch=useRef(projectEpoch());
 const identity=useRef({shotId,projectId});identity.current={shotId,projectId};
 const base=`/shots/${shotId}/storyboard-upscale`;
 const current=()=>alive.current&&epoch.current===projectEpoch()&&identity.current.shotId===shotId&&identity.current.projectId===projectId;
 const cancelSnapshot=()=>{const r=reviewRef.current;reviewRef.current=null;if(r)reviewApi(`/final-request-review/${r.id}/cancel`,{}).catch(()=>{});};
 const close=()=>{alive.current=false;cancelSnapshot();onClose();};
 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;cancelSnapshot();};},[]);
 useEffect(()=>{
  let active=true;sending.current=false;setBusy(false);cancelSnapshot();setPlan(null);setReview(null);setJob(null);completed.current=false;setAck(false);setError('');
  (async()=>{
   try {
    const p=await legacy.api(`${base}/preview?resolution=${resolution}&provider=muapi`);
    if(!active||!current())return;
    setPlan(p);if(p.existing_job){setJob(p.existing_job);return;}
    if(!p.configured||p.board_locked||p.already_at_target)return;
    // Planning does not send a provider request. The single visible approval
    // below supplies these route attestations only after durable approval.
    const body={provider:'muapi',resolution,plan_token:p.plan_token,confirmed:true,cost_unknown_ack:true};
    const prepared=await reviewApi('/final-request-review/prepare',{path:base,body});
    const reviews=prepared.reviews||[];
    if(reviews.length!==1)throw new Error('A complete single image-upscale review is unavailable. Nothing was sent.');
    const r={...reviews[0],route_body:body};
    if(!active||!current()){await reviewApi(`/final-request-review/${r.id}/cancel`,{});return;}
    reviewRef.current=r;
    if(r.snapshot?.references?.[0]?.sha256!==p.source_hash)throw new Error('The source frame changed while preparing the review. Refresh before confirming.');
    setReview(r);
   }catch(e){if(active&&current())setError(e.message);}
  })();
  return ()=>{active=false;};
 },[base,resolution,refresh]);
 async function acceptJob(j){
  if(!current())return;
  setJob(j);
  if(j.state==='completed'&&!completed.current){
   if(!j.result?.asset){setError('The provider finished, but the saved frame version is not verified. Reopen to check the saved job.');return;}
   completed.current=true;
   try{await onComplete?.();if(current())close();}catch(e){if(current())setError(`The frame was saved, but refreshing the storyboard failed. ${e.message}`);}
  }
 }
 useEffect(()=>{
  if(!job||['completed','uncertain','stale'].includes(job.state)||(job.state==='ready'&&job.error)||job.error)return;
  let active=true,timer;
  const poll=async()=>{try{
   let j=await legacy.api(`${base}/${job.id}`);
   if(!active||!current())return;
   if(j.state==='ready'&&!j.error)j=await legacy.api(`${base}/${job.id}/collect`,{method:'POST',body:'{}'});
   if(!active||!current())return;
   await acceptJob(j);
   if(!['completed','uncertain','stale','ready'].includes(j.state)&&!j.error)timer=setTimeout(poll,1500);
  }catch(e){if(active&&current())setError(`Connection interrupted. The saved job can be resumed without another paid submission. ${e.message}`);}};
  timer=setTimeout(poll,1500);return ()=>{active=false;clearTimeout(timer);};
 },[base,job?.id,job?.state,job?.error]);
 async function send(retry=false){
  if(sending.current||!current()||(!retry&&(!review||!ack||job)))return;
  sending.current=true;setBusy(true);setError('');
  try{
   let j;
   if(retry)j=await legacy.api(`${base}/${job.id}/${job.state==='ready'?'collect':'retry'}`,{method:'POST',body:'{}'});
   else {
    const r=review;
    const approved=await reviewApi(`/final-request-review/${r.id}/approve`,{fingerprint:r.fingerprint,human_confirmed:true,cost_unknown_ack:true});
    if(!current())throw cancelledReview();
    // This dialog is the final visible review. Calling the reviewed transport
    // avoids opening the shared second modal; the server still validates and
    // consumes the same immutable token before upload or provider submission.
    j=await reviewApi(base,{...r.route_body,final_request_approvals:[approved.approval||approved]});
    reviewRef.current=null;
   }
   await acceptJob(j);
  }catch(e){if(current()&&e.code!=='FINAL_REQUEST_CANCELLED'){setError(e.message);setAck(false);}}
  finally{if(current()){sending.current=false;setBusy(false);}}
 }
 const pending=job&&!['completed','stale','uncertain','ready'].includes(job.state)&&!job.error&&!error;
 const canRetry=job?.state==='ready'||(job?.request_id&&(job?.error||error));
 const snapshot=review?.snapshot,quote=snapshot?.quote||{},source=snapshot?.references?.[0];
 const preview=source?.data?(source.data.startsWith('data:')?source.data:`data:${source.mime||'image/png'};base64,${source.data}`):null;
 const preparing=!job&&!error&&(!plan||(plan.configured&&!plan.board_locked&&!plan.already_at_target&&!review));
 const percent=typeof job?.progress==='number'&&job.progress>=0&&job.progress<=100?job.progress:undefined;
 return <div className="modal-overlay open" role="presentation"><section className="modal upscale-dialog" role="dialog" aria-modal="true" aria-label="Upscale storyboard frame">
  <header className="modal-header"><h3>Upscale this frame</h3><button className="modal-close" aria-label="Close upscale" onClick={close}>×</button></header>
  <div className="modal-body">
   <p>Finish the selected clean frame. No scene prompt or annotations are sent. The original stays in frame history.</p>
   <label>Provider<select aria-label="Upscale provider" value="muapi" disabled><option value="muapi">MuAPI Topaz Precision / High Fidelity V3</option></select></label>
   <label>Target<select aria-label="Upscale target" value={resolution} disabled={busy||Boolean(job)} onChange={e=>setResolution(e.target.value)}><option>2K</option><option>4K</option></select></label>
   {plan&&<><p>{plan.source.width}×{plan.source.height} → {plan.output.width}×{plan.output.height}. Aspect ratio preserved.</p><p>{plan.model}.</p>
    {!plan.configured&&<p role="status">Configure MuAPI under Setup → API keys to enable this image upscaler.</p>}
    {plan.board_locked&&<p role="status">Unlock the storyboard before changing its selected frame.</p>}
    {plan.already_at_target&&<p role="status">This frame already reaches the selected target.</p>}
   </>}
   {snapshot&&<>
    {preview&&<img src={preview} alt="Exact clean frame to upscale" style={{maxWidth:'100%',maxHeight:220}}/>}
    <p>Source SHA-256: <code>{source?.sha256}</code></p>
    <p>Provider: {snapshot.provider}. Model: {snapshot.model}. Target: {resolution}.</p>
    <details><summary>Exact provider endpoint and all options</summary><p>{snapshot.endpoint}</p><pre aria-label="Exact upscale provider options">{JSON.stringify(snapshot.body,null,2)}</pre></details>
    <p>{quote.estimated_cost!=null?`${quote.estimated_cost} ${quote.currency||quote.unit||'credits'} estimated`:quote.amount!=null?`${quote.amount} ${quote.currency||quote.unit||'credits'} estimated`:quote.credits!=null?`${quote.credits} credits estimated`:'Verified cost estimate unavailable. MuAPI may charge credits.'}{quote.expires_at?` Review expires ${quote.expires_at}.`:''}</p>
    <label><input type="checkbox" checked={ack} disabled={busy||Boolean(job)} onChange={e=>setAck(e.target.checked)} /> I approve this exact clean frame, target and provider options, and the displayed cost terms.</label>
   </>}
   {(preparing||busy||pending)&&<div role="status"><progress aria-label="Upscale progress" {...(percent===undefined?{}:{value:percent,max:100})}/><p>{preparing?'Preparing the final upscale review…':busy&&!job?'Approving and starting upscale…':job?.state==='completed'?'Frame saved; refreshing storyboard…':job?.state==='submitting'?'Sending the approved frame…':job?.state==='queued'?'Upscale queued…':'Waiting for the saved upscale job…'}{percent===undefined?'':` ${percent}%`}</p></div>}
   {job&&<p role="status">Job: {job.state}. {job.error||''}{job.state==='completed'?' Saved as a new frame version.':''}</p>}
   {job?.state==='uncertain'&&<p>Do not submit again. Check MuAPI history first; the provider may have accepted the paid request.</p>}
   {error&&<p role="alert">{error}</p>}
   <div className="actions"><button className="btn btn-secondary" onClick={close}>{pending?'Close (job keeps running)':'Cancel / close'}</button>
    {!job&&!busy&&<button className="btn btn-secondary" onClick={()=>{setAck(false);setReview(null);setRefresh(n=>n+1);}}>Refresh review</button>}
    {canRetry?<button className="btn btn-primary" disabled={busy} onClick={()=>send(true)}>{job.state==='ready'?'Collect saved result':'Resume existing job'}</button>:<button className="btn btn-primary" disabled={busy||!review||!plan?.configured||plan.board_locked||plan.already_at_target||!ack||Boolean(job)} onClick={()=>send(false)}>{busy?'Starting…':'Confirm paid upscale'}</button>}
   </div>
  </div>
 </section></div>;
}
