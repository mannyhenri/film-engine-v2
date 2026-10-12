import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {legacy} from '../../lib/legacy.js';
import {projectEpoch,subscribeProjectEpoch} from '../../lib/project-epoch.js';
import './depth.css';
const active=['running','validating','encoding','cancelling'];
function DepthJob({job:j,busy,onCancel}){return <div className="depth-job"><strong>{j.mode} · {j.status}</strong><progress value={j.progress} max="1"/><span>{j.phase}</span>{j.error&&<p role="alert">{j.error}</p>}{active.includes(j.status)&&<button disabled={busy||j.status==='cancelling'} onClick={()=>onCancel(j)}>Cancel owned depth job</button>}</div>;}
export default function DepthWorkbench(){
 const [open,setOpen]=useState(false),[catalog,setCatalog]=useState(null),[selected,setSelected]=useState(null),[source,setSource]=useState(null),[sourceId,setSourceId]=useState(''),[start,setStart]=useState(0),[end,setEnd]=useState(0),[modelSize,setModelSize]=useState(384),[mode,setMode]=useState('preview'),[plan,setPlan]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const captured=useRef(null),serial=useRef(0),mounted=useRef(true);
 const live=token=>mounted.current&&captured.current?.epoch===projectEpoch()&&captured.current?.id===legacy.state.currentProject?.id&&token===serial.current;
 const base=()=>`/projects/${captured.current?.id}/production-depth`;
 function close(){serial.current++;captured.current=null;setOpen(false);setPlan(null);setBusy(false);}
 async function call(url,body,method='POST'){return legacy.api(base()+url,{method,body:JSON.stringify(body),refresh:false});}
 function choose(node){setSelected(node);setSource(node?.source || null);setSourceId(node?.source.asset_id || '');setStart(node?.settings.start_frame || 0);setEnd(node?.settings.end_frame_exclusive || 0);setModelSize(node?.settings.model_input_size??384);setPlan(null);setError('');}
 async function refresh(nodeId,opening=false,assetId){
  if(opening){const id=legacy.state.currentProject?.id;if(!id)return;captured.current={id,epoch:projectEpoch()};setOpen(true);setPlan(null);setError('');}
  const token=++serial.current;setBusy(true);
  try{const data=await legacy.api(base(),{refresh:false});if(!live(token))return;setCatalog(data);
   const n=data.nodes.find(n=>n.id===nodeId);if(opening||!selected)choose(n || null);else if(n)setSelected(n);
   if(assetId){setSourceId(assetId);setSource(null);setPlan(null);}
  }catch(e){if(live(token))setError(e.message);}
  finally{if(live(token))setBusy(false);}
 }
 async function inspect(){const token=++serial.current;setBusy(true);setError('');setPlan(null);try{const data=await call('/inspect',{source_asset_id:sourceId});if(live(token)){setSource(data);setStart(0);setEnd(data.timing.frame_count);}}catch(e){if(live(token))setError(e.message);}finally{if(live(token))setBusy(false);}}
 async function save(){const token=++serial.current;setBusy(true);setPlan(null);try{const node=await call(selected?`/nodes/${selected.id}`:'/nodes',{source_asset_id:sourceId,source_fingerprint:source.fingerprint,start_frame:Number(start),end_frame_exclusive:Number(end),model_input_size:Number(modelSize),device:'mps',expected_revision:selected?.revision},selected?'PUT':'POST');if(!live(token))return;choose(node);await refresh(node.id);window.loadProductionGraph?.(true);}catch(e){if(live(token))setError(e.message);}finally{if(live(token))setBusy(false);}}
 async function review(){const token=++serial.current;setBusy(true);setError('');setPlan(null);try{const data=await call(`/nodes/${selected.id}/plan`,{expected_revision:selected.revision,mode});if(live(token))setPlan(data);}catch(e){if(live(token))setError(e.message);}finally{if(live(token))setBusy(false);}}
 async function run(){const token=++serial.current;setBusy(true);setError('');try{await call(`/nodes/${selected.id}/execute`,{expected_revision:selected.revision,mode:plan.request.mode,plan_fingerprint:plan.plan_fingerprint});if(!live(token))return;setPlan(null);await refresh(selected.id);window.loadProductionGraph?.(true);}catch(e){if(live(token))setError(e.message);}finally{if(live(token))setBusy(false);}}
 async function cancel(job){const token=++serial.current;setBusy(true);try{await call(`/jobs/${job.id}/cancel`,{});if(live(token))await refresh(selected.id);}catch(e){if(live(token))setError(e.message);}finally{if(live(token))setBusy(false);}}
 useEffect(()=>{mounted.current=true;const listener=e=>refresh(e.detail?.node_id,true,e.detail?.source_asset_id);window.addEventListener('film-open-depth',listener);const unsubscribe=subscribeProjectEpoch(close);return()=>{mounted.current=false;serial.current++;window.removeEventListener('film-open-depth',listener);unsubscribe();};},[]);
 useEffect(()=>{if(!open||!selected?.jobs.some(j=>active.includes(j.status)))return;const ctx=captured.current,token=serial.current;
  const timer=setTimeout(async()=>{if(captured.current!==ctx||!live(token))return;await refresh(selected.id);if(captured.current===ctx)window.loadProductionGraph?.(true);},1500);return()=>clearTimeout(timer);
 },[open,selected]);
 const url=value=>value?legacy.mediaUrl(value):'';
 const experimental=catalog?.backend.provider==='gridlight-local'&&catalog?.backend.model==='Video-Depth-Anything-Small';
 const running=selected?.jobs.find(j=>active.includes(j.status));
 const inputsDirty=selected&&(sourceId!==selected.source.asset_id||Number(start)!==selected.settings.start_frame||Number(end)!==selected.settings.end_frame_exclusive||Number(modelSize)!==(selected.settings.model_input_size??384)||selected.settings.device!=='mps'||source?.fingerprint!==selected.source.fingerprint);
 return <><button className="pg-hbtn" onClick={()=>refresh(null,true)}>Depth Map</button>{open&&createPortal(<div className="depth-overlay"><section className="depth-workbench" role="dialog" aria-modal="true" aria-label="Depth Map">
  <header><div><h2>Depth Map</h2><p>Video → temporal depth sequence → display video and source timing</p></div><button onClick={close}>Close</button></header>
  <p>Depth describes distance and structure. It is separate from an alpha matte and does not isolate hair or replace a background by itself.</p>
  {error&&<p role="alert">{error}</p>}
  <p className="depth-backend">{catalog?.backend.available?`${catalog.backend.fixture?'SYNTHETIC TEST ADAPTER · ':''}${catalog.backend.provider} · ${catalog.backend.model} · ${catalog.backend.revision}`:catalog?.backend.reason || 'Loading depth backend…'}</p>
  {experimental&&<p role="status">Experimental local Small depth preview · quality review pending.</p>}
  {catalog?.backend.available&&<p>No network upload or paid dispatch. Model checksum {catalog.backend.model_sha256.slice(0,16)}…</p>}
  <label>Saved depth node<select value={selected?.id || ''} onChange={e=>choose(catalog.nodes.find(n=>n.id===e.target.value) || null)}><option value="">New Depth Map</option>{catalog?.nodes.map(n=><option key={n.id} value={n.id}>{n.source.file_name || 'Video'} · revision {n.revision}</option>)}</select></label>
  <label>Source video<select value={sourceId} disabled={!!running} onChange={e=>{setSourceId(e.target.value);setSource(null);setPlan(null);}}><option value="">Choose a saved video asset</option>{catalog?.sources.map(a=><option key={a.id} value={a.id}>{a.file_name || a.id} · v{a.version}</option>)}</select></label>
  <button disabled={busy||!sourceId||!!running} onClick={inspect}>Inspect source frames</button>
  {source&&<><p>{source.timing.width} × {source.timing.height} · {source.timing.frame_count} frames · {source.timing.fps.numerator}/{source.timing.fps.denominator} fps{source.timing.variable_frame_rate?' · variable frame timing':''}. Individual timestamps and final frame duration are retained.</p>{!!source.timing.display_rotation_degrees&&<p>Displayed upright at {source.timing.display_width} × {source.timing.display_height}. The original encoded dimensions remain unchanged.</p>}
   <div className="depth-range"><label>First frame (0-based)<input type="number" min="0" step="1" value={start} disabled={!!running} onChange={e=>{setStart(e.target.value);setPlan(null);}}/></label><label>End frame (exclusive)<input type="number" min="1" step="1" value={end} disabled={!!running} onChange={e=>{setEnd(e.target.value);setPlan(null);}}/></label></div>
   <label>Model detail<select value={modelSize} disabled={!!running} onChange={e=>{setModelSize(Number(e.target.value));setPlan(null);}}>{[...new Set([128,256,384,518,Number(modelSize)])].sort((a,b)=>a-b).map(size=><option key={size} value={size}>{size}</option>)}</select></label><p>MPS GPU is required. No CPU neural fallback. 384 is the balanced default; 518 uses more GPU memory and is not guaranteed to improve edges. Plan review checks the actual model grid and worker limits.</p>
   <button disabled={busy||!!running} onClick={save}>{selected?'Save new input revision':'Create Depth Map node'}</button></>}
  {selected&&<><hr/><label>Depth output<select value={mode} disabled={!!running} onChange={e=>{setMode(e.target.value);setPlan(null);}}><option value="preview">Preview · up to 2 seconds / 640px</option><option value="full">Full saved range · source dimensions</option></select></label>
   {inputsDirty&&<p>Save the input changes before reviewing a depth plan.</p>}
   <button disabled={busy||!!running||!!inputsDirty||!catalog?.backend.available} onClick={review}>Review depth plan</button>
   {plan&&<div className="depth-plan"><p>{plan.request.mode==='preview'?'Preview only':'Full saved range'} · {plan.request.width} × {plan.request.height} · {plan.request.timing.frame_count} frames · {(plan.estimated_raw_bytes/1048576).toFixed(2)} MiB raw float depth</p><p>Device: {plan.request.settings.device || 'not selected'} · model input {plan.request.settings.model_input_size} · {plan.backend?.backend || 'test backend'}. One global display range. Exact source timestamps. A new version preserves existing footage and depth versions.</p><button disabled={busy} onClick={run}>Run reviewed depth plan</button></div>}
   {selected.jobs.slice(0,1).map(j=><DepthJob key={j.id} job={j} busy={busy} onCancel={cancel}/>)}
   {selected.versions.map(v=><article key={v.id}><h3>Depth v{v.version} · {v.role==='authoritative'?'Full saved range':v.role==='preview_only'?'Preview only':v.role}{v.quality_status==='experimental_preview'?' · EXPERIMENTAL PREVIEW':''}{v.fixture?' · SYNTHETIC TEST OUTPUT':''}</h3><video controls preload="metadata" src={url(v.preview_url)}/><p>{v.files.width} × {v.files.height} · {v.files.frame_count} frames · {v.depth_kind} · source version {v.request.source_version}</p>{!!v.orientation?.display_rotation_degrees&&<p>Display video is upright at {v.orientation.display_width} × {v.orientation.display_height}; raw floats retain encoded coordinates.</p>}<p>Display video uses a single global range; float depths and the manifest are authoritative. Preview-only versions are not full-resolution output.</p><div className="depth-links"><a href={url(v.raw_url)} download>Raw float depth sequence</a><a href={url(v.manifest_url)} download>Timing and provenance manifest</a><a href={url(v.preview_url)} download>Depth display video</a></div></article>)}
   {selected.jobs.length>1&&<details><summary>Prior depth jobs ({selected.jobs.length-1})</summary>{selected.jobs.slice(1).map(j=><DepthJob key={j.id} job={j} busy={busy} onCancel={cancel}/>)}</details>}
  </>}
  <p>MuAPI depth-anything is documented as grayscale per-frame depth. Raw float output, temporal consistency and exact timing are not documented, so it is not enabled for this contract. Film's current MuAPI Seedance route cannot consume reference videos. No hybrid background replacement or alpha-matte connection is enabled.</p>
 </section></div>,document.body)}</>;
}
