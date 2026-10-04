import { useState, useRef } from 'react';
import { legacy } from '../../lib/legacy.js';

export function writingStyleHandoff(project, version) {
 return `Film Engine project ${project.id} (${project.title}). Read writing_style_read, writing_style_examples and writing_style_context for this project. Use only confirmed original human examples to propose guidance with writing_style_propose (expected_version: ${version}). Incorporate my feedback. Keep the proposal inactive until I review and approve it. Return screenplay drafts with profile provenance; do not overwrite canon. This is text writing style, not audio cloning.`;
}
export default function WritingStyleWorkbench() {
 const requestVersion=useRef(0);
 const [portable,setPortable]=useState(null),[confirmImport,setConfirmImport]=useState(false);
 const [project,setProject]=useState(null), [view,setView]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
 const [text,setText]=useState(''), [source,setSource]=useState(''), [authorship,setAuthorship]=useState('unknown'), [confirmed,setConfirmed]=useState(false), [exercise,setExercise]=useState('');
 const [directPreferences,setDirectPreferences]=useState(false),[preferenceSource,setPreferenceSource]=useState('');
 const [guidance,setGuidance]=useState(''), [feedback,setFeedback]=useState(''), [selected,setSelected]=useState([]);
 const latest=view?.profiles[0], base=project ? `/projects/${project.id}/writing-style` : '';
 async function open() {
  const p=legacy.state.currentProject; if (!p) { setError('Open a project first.'); return; }
  const token=++requestVersion.current;
  setPortable(null);setConfirmImport(false);setDirectPreferences(false);setPreferenceSource('');
  setProject({ id:p.id,title:p.title }); setView(null); setError(''); setSelected([]); setGuidance(''); setText(''); setSource(''); setConfirmed(false); setAuthorship('unknown'); setFeedback('');
  try { const next=await legacy.api(`/projects/${p.id}/writing-style`);if(token===requestVersion.current)setView(next); } catch(e) { if(token===requestVersion.current)setError(e.message); }
 }
 async function post(path,body) {
  const token=requestVersion.current;setBusy(true);setError('');
  try { const next=await legacy.api(base+path,{ method:'POST',body:JSON.stringify(body) }); if(token!==requestVersion.current)return false;setView(next); return true; }
  catch(e) { if(token===requestVersion.current)setError(e.message);return false; } finally { if(token===requestVersion.current)setBusy(false); }
 }
 async function addSample() {
  if (await post('/samples',{ text,source,authorship,confirmed_original:confirmed,exercise })) { setText('');setSource('');setConfirmed(false); }
 }
 async function exportProfile() {
  try {
   const portable=await legacy.api(base+'/export');
   const url=URL.createObjectURL(new Blob([JSON.stringify(portable,null,2)],{ type:'application/json' }));
   const a=document.createElement('a');a.href=url;a.download='writing-style-profile.json';a.click();URL.revokeObjectURL(url);
  } catch(e) { setError(e.message); }
 }
 const field={ display:'block',width:'100%',margin:'6px 0 12px' };
 return <>
  <button type="button" className="btn btn-secondary" style={{ position:'fixed',right:18,bottom:38,zIndex:100 }} onClick={open}>Writing style</button>
  {error && !project && <div role="alert" style={{ position:'fixed',right:18,bottom:80,zIndex:100 }}>{error}</div>}
  {project && <section role="dialog" aria-modal="true" aria-label="Writing style workbench" style={{ position:'fixed',inset:'6% 12%',zIndex:1100,overflowY:'auto',background:'var(--gl-bg,#171923)',color:'var(--gl-text,#eee)',padding:24,border:'1px solid #666',borderRadius:12 }}>
   <button className="btn" onClick={() => { requestVersion.current++;setProject(null);setView(null);setError('');setBusy(false); }}>Close</button>
   <h2>Writing style · {project.title}</h2>
   <p>Capture your own words, review a profile, then use it for fresh drafts. AI-edited scripts are not evidence of your original voice. Nothing here rewrites your screenplay.</p>
   {error && <p role="alert">{error}</p>}
   {!view ? <p>Loading writing profile…</p> : <>
    <p>{view.active_profile ? `Active approved profile: version ${view.active_profile.version}` : 'No approved profile. Your style is inactive.'}</p>
    <h3>Portable profile import</h3>
    <label>Profile JSON file<input style={field} type="file" accept="application/json,.json" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>500000)throw Error('Profile file is too large.');setPortable(JSON.parse(await f.text()));setConfirmImport(false);}catch(err){setError(err.message);setPortable(null);}}} /></label>
    {portable && <div><p>{portable.profile_name} · {portable.profile_version}</p><details><summary>Review imported guidance</summary>{(portable.approved_rules||[]).map((r,i)=><p key={i}>{r.pattern}</p>)}</details>
     <label><input type="checkbox" checked={confirmImport} onChange={e=>setConfirmImport(e.target.checked)} /> I reviewed the imported original samples and confirm they are mine.</label>
     <p><button className="btn" disabled={busy} onClick={()=>post('/import',{profile:portable,human_confirmed:confirmImport})}>Import profile for local review</button></p>
     <p>Unconfirmed or generated sources stay quarantined. Imported guidance still needs local approval.</p>
    </div>}
    <h3>1. Original writing exercise or import</h3>
    <label>Exercise<select style={field} value={exercise} onChange={e=>setExercise(e.target.value)}><option value="">Import existing writing</option>{view.exercises.map(e=><option key={e.id} value={e.id}>{e.id}</option>)}</select></label>
    {exercise && <p>{view.exercises.find(e=>e.id===exercise)?.prompt}</p>}
    <label>Writing sample<textarea style={field} rows={5} value={text} onChange={e=>setText(e.target.value)} /></label>
    <label>Source and provenance<input style={field} value={source} onChange={e=>setSource(e.target.value)} placeholder="Where and when you wrote this; editors or AI involved" /></label>
    <label>Authorship<select style={field} value={authorship} onChange={e=>{setAuthorship(e.target.value);setConfirmed(false);}}>
     <option value="unknown">Unknown / not confirmed</option><option value="original_human">My original human writing</option><option value="human_edited">Edited by another human</option><option value="ai_assisted">AI-assisted or AI-edited</option>
    </select></label>
    <label><input type="checkbox" checked={confirmed} disabled={authorship!=='original_human'} onChange={e=>setConfirmed(e.target.checked)} /> I confirm these are my original words, written without AI assistance.</label>
    <p><button className="btn btn-primary" disabled={busy||!text.trim()||!source.trim()} onClick={addSample}>Save evidence</button></p>
    <h3>2. Draft and review a profile</h3>
    {view.samples.map(s=><div key={s.id}><label><input type="checkbox" disabled={!s.confirmed_original||s.authorship!=='original_human'} checked={selected.includes(s.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id))} /> {s.source} · {s.authorship}{s.confirmed_original ? ' · confirmed' : ' · not style evidence'}</label><details><summary>Read sample</summary><p style={{whiteSpace:'pre-wrap'}}>{s.text}</p></details></div>)}
    <label>Proposed style guidance<textarea style={field} rows={4} value={guidance} onChange={e=>setGuidance(e.target.value)} placeholder="Rhythm, vocabulary, dialogue, things to avoid. An assistant can propose this through MCP." /></label>
    <label><input type="checkbox" checked={directPreferences} onChange={e=>setDirectPreferences(e.target.checked)} /> These are my explicit preferences, not a voice learned from samples.</label>
    {directPreferences && <label>Preference provenance<input style={field} value={preferenceSource} onChange={e=>setPreferenceSource(e.target.value)} placeholder="Where and when you explicitly requested these rules" /></label>}
    <button className="btn" disabled={busy||(!selected.length&&!(directPreferences&&preferenceSource.trim()))||!guidance.trim()} onClick={()=>post('/profiles',{ expected_version:latest?.version||0,sample_ids:selected,guidance,preference_confirmation:directPreferences,preference_source:preferenceSource })}>Save draft profile</button>
    <button className="btn" onClick={async()=>{try{await navigator.clipboard.writeText(writingStyleHandoff(project,latest?.version||0));}catch(e){setError(e.message);}}}>Copy assistant handoff</button>
    {latest && <div><h4>Version {latest.version} · {latest.state}</h4>{!latest.sample_ids.length && <p>Direct preferences only. No learned voice or original samples.</p>}<p style={{whiteSpace:'pre-wrap'}}>{latest.guidance}</p>
     {latest.state==='draft' && <button className="btn btn-primary" disabled={busy} onClick={()=>{if(window.confirm('I reviewed this profile and its original samples. Use this version for my future drafts?'))post(`/profiles/${latest.version}/approve`,{expected_version:latest.version,human_confirmed:true});}}>Approve reviewed profile</button>}
    </div>}
    {view.profiles.length>1 && <details><summary>Previous profile versions</summary>{view.profiles.slice(1).map(p=><p key={p.version}>Version {p.version} · {p.state}: {p.guidance}</p>)}</details>}
    <h3>3. Feedback and portable profile</h3>
    <label>What sounds like you, and what does not?<textarea style={field} value={feedback} onChange={e=>setFeedback(e.target.value)} /></label>
    <button className="btn" disabled={busy||!latest||!feedback.trim()} onClick={()=>post('/feedback',{profile_version:latest.version,text:feedback})}>Save feedback</button>
    {view.feedback.map(f=><p key={f.id}>Version {f.profile_version}: {f.text}</p>)}
    <button className="btn" onClick={exportProfile}>Export profile for ChatGPT / Claude</button>
    <p>Exports include rules and source metadata. Sample prose is not exported without separate excerpt reuse approval. Only approved guidance is active; proposed updates need your review.</p>
   </>}
  </section>}
 </>;
}
