import { useEffect, useRef, useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { reviewApi } from '../../components/FinalRequestReview/request-bridge.js';
import { projectEpoch } from '../../lib/project-epoch.js';

export default function UpscaleFrameDialog({ shotId, projectId, onClose, onComplete }) {
 const [resolution,setResolution]=useState('2K'),[plan,setPlan]=useState(null),[review,setReview]=useState(null),[job,setJob]=useState(null),[error,setError]=useState(''),[copied,setCopied]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const alive=useRef(true),sending=useRef(false),reviewRef=useRef(null),completed=useRef(false),epoch=useRef(projectEpoch());
 const identity=useRef({shotId,projectId});identity.current={shotId,projectId};
 const base=`/shots/${shotId}/storyboard-upscale`;
 const current=()=>alive.current&&epoch.current===projectEpoch()&&identity.current.shotId===shotId&&identity.current.projectId===projectId;
 const cancelSnapshot=()=>{const r=reviewRef.current;reviewRef.current=null;if(r)reviewApi(`/final-request-review/${r.id}/cancel`,{}).catch(()=>{});};
 const close=()=>{alive.current=false;cancelSnapshot();onClose();};
 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;cancelSnapshot();};},[]);
 useEffect(()=>{
  let active=true;sending.current=false;setBusy(false);cancelSnapshot();setPlan(null);setReview(null);setJob(null);completed.current=false;setCopied('');setError('');
  (async()=>{
   try {
    const p=await legacy.api(`${base}/preview?resolution=${resolution}&provider=muapi`);
    if(!active||!current())return;
    setPlan(p);if(p.existing_job){setJob(p.existing_job);return;}
    // Manual upscale: no key is needed to prepare the hand-over.
    if(p.board_locked||p.already_at_target)return;
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
 // Only a job submitted before manual generation can still be collected or resumed.
 async function resume(){
  if(sending.current||!current()||!job)return;
  sending.current=true;setBusy(true);setError('');
  try{await acceptJob(await legacy.api(`${base}/${job.id}/${job.state==='ready'?'collect':'retry'}`,{method:'POST',body:'{}'}));}
  catch(e){if(current()&&e.code!=='FINAL_REQUEST_CANCELLED')setError(e.message);}
  finally{if(current()){sending.current=false;setBusy(false);}}
 }
 const pending=job&&!['completed','stale','uncertain','ready'].includes(job.state)&&!job.error&&!error;
 const canRetry=job?.state==='ready'||(job?.request_id&&(job?.error||error));
 const snapshot=review?.snapshot,source=snapshot?.references?.[0];
 const preview=source?.data?(source.data.startsWith('data:')?source.data:`data:${source.mime||'image/png'};base64,${source.data}`):null;
 const preparing=!job&&!error&&(!plan||(!plan.board_locked&&!plan.already_at_target&&!review));
 const settings=plan&&snapshot?`Upscaler: ${snapshot.model||plan.model}\nSize: ${plan.source.width}×${plan.source.height} → ${plan.output.width}×${plan.output.height} (${resolution})\nAspect ratio preserved. Upscale the clean frame only; no prompt or annotations.`:'';
 async function copySettings(){try{await navigator.clipboard.writeText(settings);if(current())setCopied('Settings copied.');}catch(e){if(current())setError('Clipboard unavailable: '+e.message);}}
 const percent=typeof job?.progress==='number'&&job.progress>=0&&job.progress<=100?job.progress:undefined;
 return <div className="modal-overlay open" role="presentation"><section className="modal upscale-dialog" role="dialog" aria-modal="true" aria-label="Upscale storyboard frame">
  <header className="modal-header"><h3>Upscale this frame</h3><button className="modal-close" aria-label="Close upscale" onClick={close}>×</button></header>
  <div className="modal-body">
   <p>Film Engine does not send this. Download the clean frame, upscale it in Topaz (or the upscaler you use) with the settings below, then import the result as a new frame version. The original stays in frame history.</p>
   <label>Target<select aria-label="Upscale target" value={resolution} disabled={busy||Boolean(job)} onChange={e=>setResolution(e.target.value)}><option>2K</option><option>4K</option></select></label>
   {plan&&<><p>{plan.source.width}×{plan.source.height} → {plan.output.width}×{plan.output.height}. Aspect ratio preserved.</p><p>{plan.model}.</p>
    {plan.board_locked&&<p role="status">Unlock the storyboard before changing its selected frame.</p>}
    {plan.already_at_target&&<p role="status">This frame already reaches the selected target.</p>}
   </>}
   {snapshot&&<>
    {preview&&<img src={preview} alt="Exact clean frame to upscale" style={{maxWidth:'100%',maxHeight:220}}/>}
    {preview&&<p><a href={preview} download={`${shotId}-clean-frame.png`} aria-label="Download clean frame">Download clean frame</a> · SHA-256 <code>{source?.sha256}</code></p>}
    <pre aria-label="Upscale settings to match">{settings}</pre>
    <details><summary>Exact provider options this replaces</summary><p>{snapshot.endpoint}</p><pre aria-label="Exact upscale provider options">{JSON.stringify(snapshot.body,null,2)}</pre></details>
    {copied&&<p role="status">{copied}</p>}
   </>}
   {(preparing||busy||pending)&&<div role="status"><progress aria-label="Upscale progress" {...(percent===undefined?{}:{value:percent,max:100})}/><p>{preparing?'Preparing the frame and settings…':job?.state==='completed'?'Frame saved; refreshing storyboard…':job?.state==='submitting'?'Sending the approved frame…':job?.state==='queued'?'Upscale queued…':'Waiting for the saved upscale job…'}{percent===undefined?'':` ${percent}%`}</p></div>}
   {job&&<p role="status">Job: {job.state}. {job.error||''}{job.state==='completed'?' Saved as a new frame version.':''}</p>}
   {job?.state==='uncertain'&&<p>Do not submit again. Check MuAPI history first; the provider may have accepted the paid request.</p>}
   {error&&<p role="alert">{error}</p>}
   <div className="actions"><button className="btn btn-secondary" onClick={close}>{pending?'Close (job keeps running)':'Close'}</button>
    {!job&&!busy&&<button className="btn btn-secondary" onClick={()=>{setReview(null);setRefresh(n=>n+1);}}>Refresh</button>}
    {canRetry?<button className="btn btn-primary" disabled={busy} onClick={resume}>{job.state==='ready'?'Collect saved result':'Resume existing job'}</button>:<button className="btn btn-primary" disabled={busy||!settings} onClick={copySettings}>Copy settings</button>}
   </div>
  </div>
 </section></div>;
}
