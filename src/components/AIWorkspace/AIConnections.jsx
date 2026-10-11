import {useEffect,useRef,useState} from 'react';
import {legacy} from '../../lib/legacy.js';
import './AIConnections.css';
const post=(path,body)=>legacy.api('/ai-connections/'+path,{method:'POST',body:JSON.stringify(body),refresh:false});
export default function AIConnections(){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState('');
 const dialog=useRef(null),opener=useRef(null),alive=useRef(true);
 const accept=value=>{if(!alive.current)return;if(value?.application!=='film-engine-v2'||!Array.isArray(value.providers))throw Error('The updated Film connection backend is not active yet.');setData(value);setError('');window.dispatchEvent(new CustomEvent('film:ai-connections:changed',{detail:value}));};
 useEffect(()=>{
  alive.current=true;let fetching=false;
  const desktop=!!window.__feDesktop,owner=crypto.randomUUID();
  const refresh=async()=>{if(fetching)return;fetching=true;try{accept(desktop?await legacy.api('/ai-connections'):await post('attach',{owner}));}catch(e){if(alive.current)setError(e.message);}finally{fetching=false;}};
  const show=()=>{opener.current=document.activeElement;setOpen(true);};
  const detach=()=>{
   if(desktop)return;
   const api=window.__filmEngineApiBase||`http://${location.hostname||'localhost'}:3100`;
   navigator.sendBeacon?.(api+'/film/ai-connections/detach',new Blob([JSON.stringify({owner})],{type:'application/json'}));
  };
  if(document.readyState==='complete')refresh();else window.addEventListener('DOMContentLoaded',refresh,{once:true});
  const timer=setInterval(refresh,15000);
  window.addEventListener('film:ai-connections:open',show);window.addEventListener('beforeunload',detach);
  return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('DOMContentLoaded',refresh);window.removeEventListener('film:ai-connections:open',show);window.removeEventListener('beforeunload',detach);if(!desktop)Promise.resolve().then(()=>post('detach',{owner})).catch(()=>{});};
 },[]);
 useEffect(()=>{if(!open)return;dialog.current?.focus();const key=e=>{if(e.key==='Escape'){setOpen(false);opener.current?.focus();}if(e.key==='Tab'){const items=[...dialog.current.querySelectorAll('button:not(:disabled),a[href]')],first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[open]);
 useEffect(()=>{if(!open||!data?.providers.some(p=>p.login||['starting','reconnecting','busy','cancelling','cancelling_sign_in'].includes(p.state)))return;let fetching=false;const timer=setInterval(async()=>{if(fetching)return;fetching=true;try{accept(await legacy.api('/ai-connections'));}catch(e){if(alive.current)setError(e.message);}finally{fetching=false;}},1000);return()=>clearInterval(timer);},[open,data]);
 async function action(name,provider){setBusy(true);setError('');try{accept(await post(name,{provider,...(name==='sign-in'?{human_confirmed:true}:{})}));setConfirm('');}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}
 const count=data?.providers.filter(p=>p.available).length||0;
 return <>
  <button className="btn ai-connections-launch" onClick={e=>{opener.current=e.currentTarget;setOpen(true);}}>AI connections · {data?`${count}/2 ready`:'backend pending'}</button>
  {open&&<div className="ai-connections-shade"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Film AI connections" className="ai-connections-panel">
   <header><h2>AI connections</h2><button className="btn" onClick={()=>{setOpen(false);opener.current?.focus();}}>Close</button></header>
   <p>Film starts and manages its own Claude and Codex workers while the app is open. After initial secure sign-in, use the AI workspace here for your requests and results.</p>
   <p>Film keeps application and project conversations and approved story voice. Reopening a conversation restores its saved history. Every request starts an isolated provider session with the exact context you reviewed.</p>
   {error&&<p role="alert">{error}</p>}
   {!data&&<p>Activate the updated Film Engine V2 backend to use managed connections. Your current work remains saved.</p>}
   {data?.providers.map(p=><article key={p.id}>
    <h3>{p.label} · {p.state.replaceAll('_',' ')}</h3><p role="status">{p.note}</p>
    <p>{p.inference_verified?'A completed model response was verified during this app session.':'Model response has not been verified during this app session.'}</p>
    {p.installed&&!p.login&&<button className="btn" disabled={busy||['busy','cancelling','starting'].includes(p.state)} onClick={()=>action('reconnect',p.id)}>Reconnect {p.label}</button>}
    {p.installed&&!p.connected&&!p.login&&<button className="btn" disabled={busy} onClick={()=>setConfirm(p.id)}>Sign in to {p.label}</button>}
    {confirm===p.id&&<div><p>Start the provider’s official browser sign-in using its installed CLI. The provider stores the account credentials. Film does not accept passwords, API keys or access tokens.</p><button className="btn" disabled={busy} onClick={()=>action('sign-in',p.id)}>Start secure sign-in</button><button className="btn" onClick={()=>setConfirm('')}>Back</button></div>}
    {p.login&&<div><p>Complete secure sign-in in the provider’s browser window.</p>{p.login.url&&<a href={p.login.url} target="_blank" rel="noopener noreferrer">Open secure provider sign-in</a>}{p.login.code&&<p>One-time device code: <strong>{p.login.code}</strong></p>}<button className="btn" disabled={busy} onClick={()=>action('cancel-sign-in',p.id)}>Stop sign-in</button></div>}
   </article>)}
   <p>Opening Film sends no AI prompt. Reconnection never resubmits an interrupted task. Closing Film stops its owned workers; it keeps your saved conversations.</p>
  </section></div>}
 </>;
}
