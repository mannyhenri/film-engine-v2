import { useEffect, useRef, useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { projectEpoch } from '../../lib/project-epoch.js';

/*
 * Upscale a board frame ON THIS MAC, with the Generators' AI Image Upscale (lib/generators.js): 4x-UltraSharp,
 * Real-ESRGAN, or the person's own Topaz Gigapixel. Free; nothing leaves the machine. The result is collected
 * through the same checks as any upscale (the frame unchanged, the board unlocked, the target reached at the
 * source's aspect) and saved as a new frame version; the original stays in frame history.
 */
export default function UpscaleFrameDialog({ shotId, projectId, onClose, onComplete }) {
 const [resolution,setResolution]=useState('2K'),[engine,setEngine]=useState('ultrasharp'),[grain,setGrain]=useState(0);
 const [plan,setPlan]=useState(null),[job,setJob]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const alive=useRef(true),completed=useRef(false),epoch=useRef(projectEpoch());
 const identity=useRef({shotId,projectId});identity.current={shotId,projectId};
 const base=`/shots/${shotId}/storyboard-upscale`;
 const current=()=>alive.current&&epoch.current===projectEpoch()&&identity.current.shotId===shotId&&identity.current.projectId===projectId;
 const close=()=>{alive.current=false;onClose();};
 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
 useEffect(()=>{
  let active=true;setPlan(null);setError('');completed.current=false;
  (async()=>{
   try{const p=await legacy.api(`${base}/preview?resolution=${resolution}&provider=local`);if(!active||!current())return;setPlan(p);
    if(p.existing_job&&!['failed','stale','handed_over'].includes(p.existing_job.state))setJob(p.existing_job);
    if(p.engines?.length&&!p.engines.some(e=>e.value===engine))setEngine(p.engines[0].value);}
   catch(e){if(active&&current())setError(e.message);}
  })();
  return ()=>{active=false;};
 },[base,resolution]); // eslint-disable-line react-hooks/exhaustive-deps
 async function accept(j){
  if(!current())return;
  setJob(j);
  if(j.state==='completed'&&!completed.current){
   if(!j.result?.asset){setError('The upscale finished, but the saved frame version is not verified. Reopen to check.');return;}
   completed.current=true;
   try{await onComplete?.();if(current())close();}catch(e){if(current())setError(`The frame was saved, but refreshing the storyboard failed. ${e.message}`);}
  }
 }
 const live=job&&['queued','submitting','waiting'].includes(job.state);
 useEffect(()=>{
  if(!job||!live)return;
  let active=true,timer;
  const poll=async()=>{try{const j=await legacy.api(`${base}/${job.id}`);if(!active||!current())return;
   if(j.state==='ready'&&!j.error){await accept(await legacy.api(`${base}/${job.id}/collect`,{method:'POST',body:'{}'}));return;}
   await accept(j);if(['queued','submitting','waiting'].includes(j.state))timer=setTimeout(poll,1200);}
  catch(e){if(active&&current())setError(e.message);}};
  timer=setTimeout(poll,1200);return ()=>{active=false;clearTimeout(timer);};
 },[base,job?.id,job?.state]); // eslint-disable-line react-hooks/exhaustive-deps
 async function run(){
  if(busy||!plan||!current())return;
  setBusy(true);setError('');
  try{await accept(await legacy.api(base,{method:'POST',body:JSON.stringify({provider:'local',resolution,engine,grain,plan_token:plan.plan_token})}));}
  catch(e){if(current())setError(e.message);}
  finally{if(current())setBusy(false);}
 }
 async function collect(){
  setBusy(true);setError('');
  try{await accept(await legacy.api(`${base}/${job.id}/collect`,{method:'POST',body:'{}'}));}catch(e){if(current())setError(e.message);}finally{if(current())setBusy(false);}
 }
 const blocked=!plan||plan.board_locked||plan.already_at_target||!plan.configured;
 const gigapixel=engine==='gigapixel';
 return <div className="modal-overlay open" role="presentation"><section className="modal upscale-dialog" role="dialog" aria-modal="true" aria-label="Upscale storyboard frame">
  <header className="modal-header"><h3>Upscale this frame</h3><button className="modal-close" aria-label="Close upscale" onClick={close}>×</button></header>
  <div className="modal-body">
   <p>Runs the <strong>AI Image Upscale</strong> generator on this Mac. Free; nothing is sent anywhere. The result is saved as a new frame version and the original stays in frame history.</p>
   <label>Target<select aria-label="Upscale target" value={resolution} disabled={busy||live} onChange={e=>setResolution(e.target.value)}><option>2K</option><option>4K</option></select></label>
   <label>Upscaler<select aria-label="Upscaler" value={engine} disabled={busy||live||!plan?.engines?.length} onChange={e=>setEngine(e.target.value)}>
    {(plan?.engines||[]).map(e=><option key={e.value} value={e.value}>{e.label}</option>)}</select></label>
   {!gigapixel&&<label>Film grain <input type="range" aria-label="Film grain" min="0" max="1" step="0.05" value={grain} disabled={busy||live} onChange={e=>setGrain(Number(e.target.value))}/> {grain.toFixed(2)}</label>}
   {gigapixel&&<p className="text-sm text-muted">Topaz Gigapixel opens with the frame; export it there, then import the result on this shot as a new frame version.</p>}
   {plan&&<>
    <p>{plan.source.width}×{plan.source.height} → {plan.output.width}×{plan.output.height}. Aspect ratio preserved.</p>
    {!plan.configured&&<p role="status">The AI Image Upscale generator is not installed. Add it under Production › Generators.</p>}
    {plan.board_locked&&<p role="status">Unlock the storyboard before changing its selected frame.</p>}
    {plan.already_at_target&&<p role="status">This frame already reaches the selected target.</p>}
   </>}
   {(live||busy)&&<div role="status"><progress aria-label="Upscale progress"/><p>{job?.state==='queued'||job?.state==='submitting'?'Starting the upscaler…':'Upscaling on this Mac…'}</p></div>}
   {job&&!live&&<p role="status">Job: {job.state==='handed_over'?'handed to Topaz Gigapixel':job.state}. {job.error||''}{job.state==='completed'?' Saved as a new frame version.':''}</p>}
   {error&&<p role="alert">{error}</p>}
   <div className="actions"><button className="btn btn-secondary" onClick={close}>{live?'Close (it keeps running)':'Close'}</button>
    {job?.state==='ready'
     ?<button className="btn btn-primary" disabled={busy} onClick={collect}>Save the upscaled frame</button>
     :<button className="btn btn-primary" disabled={busy||live||blocked} onClick={run}>{gigapixel?'Open in Topaz Gigapixel':'Upscale on this Mac'}</button>}
   </div>
  </div>
 </section></div>;
}
