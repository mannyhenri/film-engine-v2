import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {subscribeProjectEpoch} from '../../lib/project-epoch.js';
import { legacy } from '../../lib/legacy.js';
import StyleTraits from './StyleTraits.jsx';
import DraftScene from './DraftScene.jsx';
import PilotPanel from './PilotPanel.jsx';

// What deleting keeps and what it cannot reach, said before the person confirms (GRD-4661).
const DELETE_NOTE = 'Its text is removed now and it stops being used for drafts immediately; any approved profile that used it becomes stale. '
 + 'Only its hash and dates are kept. Screenplay revisions you saved keep their own text, and anything already sent to an external AI provider is subject to that provider\'s retention policy.';
const RIGHTS = [['own_writing','I wrote it'],['licensed','Licensed to me'],['permission_granted','Used with the owner\'s permission']];

/** The Screenplay page's toolbar, while it is on screen: Learn my style sits beside AI Chat. */
function useScreenplayToolbar() {
 const find = () => document.getElementById('aiChatToggle')?.parentElement || null;
 const [slot, setSlot] = useState(find);
 useEffect(() => {
  const obs = new MutationObserver(() => { const next = find(); setSlot(cur => (cur === next ? cur : next)); });
  obs.observe(document.body, { childList:true, subtree:true });
  return () => obs.disconnect();
 }, []);
 return slot;
}

export function writingStyleHandoff(project, version) {
 return `Film Engine project ${project.id} (${project.title}). Read writing_style_read, writing_style_examples and writing_style_context for this project. Use only confirmed original human examples to propose guidance with writing_style_propose (expected_version: ${version}). Incorporate my feedback. Keep the proposal inactive until I review and approve it. Return screenplay drafts with profile provenance; do not overwrite canon. Use only this Film screenplay/story profile. Marketing business voice is independent. Direct instructions are preferences; infer voice only from original samples. This is text writing style, not audio cloning.`;
}
export default function WritingStyleWorkbench() {
 const requestVersion=useRef(0);
 const [reviewedApproval,setReviewedApproval]=useState('');
 const [importReview,setImportReview]=useState(null),[editing,setEditing]=useState(null),[correction,setCorrection]=useState(''),[correctionSource,setCorrectionSource]=useState('');
 const [portable,setPortable]=useState(null),[confirmImport,setConfirmImport]=useState(false);
 const [project,setProject]=useState(null), [view,setView]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
 const [text,setText]=useState(''), [source,setSource]=useState(''), [authorship,setAuthorship]=useState('unknown'), [confirmed,setConfirmed]=useState(false), [exercise,setExercise]=useState('');
 const [directPreferences,setDirectPreferences]=useState(false),[preferenceSource,setPreferenceSource]=useState('');
 const [guidance,setGuidance]=useState(''), [feedback,setFeedback]=useState(''), [selected,setSelected]=useState([]);
 const [tags,setTags]=useState(''), [heldOut,setHeldOut]=useState(false);
 const [script,setScript]=useState({ title:'', owner:'', text:'', rights_basis:'', language:'en' }), [scriptRights,setScriptRights]=useState(false), [scriptOriginal,setScriptOriginal]=useState(false);
 const toolbar=useScreenplayToolbar();
 function close(){requestVersion.current++;setProject(null);setView(null);setError('');setBusy(false);setEditing(null);setImportReview(null);}
 useEffect(()=>subscribeProjectEpoch(close),[]);
 const latest=view?.profiles[0], base=project ? `/projects/${project.id}/writing-style` : '';
 async function open() {
  const p=legacy.state.currentProject; if (!p) { setError('Open a project first.'); return; }
  const token=++requestVersion.current;
  setReviewedApproval('');setEditing(null);setCorrection('');setCorrectionSource('');setImportReview(null);setBusy(false);
  setPortable(null);setConfirmImport(false);setDirectPreferences(false);setPreferenceSource('');
  setProject({ id:p.id,title:p.title }); setView(null); setError(''); setSelected([]); setGuidance(''); setText(''); setSource(''); setConfirmed(false); setAuthorship('unknown'); setFeedback('');
  try { const next=await legacy.api(`/projects/${p.id}/writing-style`);if(token===requestVersion.current&&legacy.state.currentProject?.id===p.id)setView(next); } catch(e) { if(token===requestVersion.current)setError(e.message); }
 }
 async function post(path,body,method='POST') {
  if(legacy.state.currentProject?.id!==project?.id){close();return false;}
  const token=requestVersion.current;setBusy(true);setError('');
  try { const next=await legacy.api(base+path,{ method,body:JSON.stringify(body||{}),refresh:false }); if(token!==requestVersion.current||legacy.state.currentProject?.id!==project.id)return false;setView(next); return true; }
  catch(e) { if(token===requestVersion.current)setError(e.message);return false; } finally { if(token===requestVersion.current)setBusy(false); }
 }
 async function previewImport(){
  const token=requestVersion.current,pid=project.id;setBusy(true);setError('');setImportReview(null);
  try{const next=await legacy.api(base+'/import-preview',{method:'POST',body:JSON.stringify({profile:portable,human_confirmed:confirmImport}),refresh:false});if(token===requestVersion.current&&legacy.state.currentProject?.id===pid)setImportReview(next);}
  catch(e){if(token===requestVersion.current)setError(e.message);}finally{if(token===requestVersion.current)setBusy(false);}
 }
 async function addSample() {
  const tagList=tags.split(',').map(t=>t.trim()).filter(Boolean);
  if (await post('/samples',{ text,source,authorship,confirmed_original:confirmed,exercise:exercise||undefined,tags:tagList,held_out:heldOut })) { setText('');setSource('');setConfirmed(false);setTags('');setHeldOut(false); }
 }
 async function importScript() {
  if (await post('/sources',{ ...script, rights_confirmed:scriptRights, authorship:scriptOriginal?'original_human':'unknown', confirmed_original:scriptOriginal })) {
   setScript({ title:'', owner:'', text:'', rights_basis:'', language:'en' });setScriptRights(false);setScriptOriginal(false);
  }
 }
 const deleteSample=s=>{ if(window.confirm(`Delete this sample? ${DELETE_NOTE}`)) post(`/samples/${s.id}`,{},'DELETE'); };
 const deleteSource=d=>{ if(window.confirm(`Delete "${d.title}" and every sample taken from it? ${DELETE_NOTE}`)) post(`/sources/${d.id}`,{},'DELETE'); };
 async function exportProfile() {
  try {
   const portable=await legacy.api(base+'/export');
   const url=URL.createObjectURL(new Blob([JSON.stringify(portable,null,2)],{ type:'application/json' }));
   const a=document.createElement('a');a.href=url;a.download='film-screenplay-story-voice.json';a.click();URL.revokeObjectURL(url);
  } catch(e) { setError(e.message); }
 }
 const field={ display:'block',width:'100%',margin:'6px 0 12px' };
 return <>
  <button type="button" className="btn btn-secondary" style={{ position:'fixed',right:18,bottom:38,zIndex:100 }} onClick={open}>My Voice</button>
  {toolbar && createPortal(<button type="button" className="toolbar-btn learn-my-style" onClick={open} data-tooltip="Your independent Film screenplay/story voice">My Voice</button>,toolbar)}
  {error && !project && <div role="alert" style={{ position:'fixed',right:18,bottom:80,zIndex:100 }}>{error}</div>}
  {project && <section role="dialog" aria-modal="true" aria-label="Film My Voice workbench" style={{ position:'fixed',inset:'6% 12%',zIndex:1100,overflowY:'auto',background:'var(--gl-bg,#171923)',color:'var(--gl-text,#eee)',padding:24,border:'1px solid #666',borderRadius:12 }}>
   <button className="btn" onClick={close}>Close</button>
   <h2>My Voice · screenplay and story · {project.title}</h2>
   <p>Film Engine owns this profile, its samples, guidance, approvals, corrections and versions. Marketing Engine has its own business voice. There is no automatic sharing or synchronization.</p>
   <p>Capture your own words, review a profile, then use it for fresh drafts. AI-edited scripts are not evidence of your original voice. Nothing here rewrites your screenplay.</p>
   {error && <p role="alert">{error}</p>}
   {!view ? <p>Loading writing profile…</p> : <>
    <p>{view.active_profile ? `Active approved profile: version ${view.active_profile.version}` : 'No approved profile. Your style is inactive.'}</p>
    {view.active_profile && <p>{view.active_profile.sample_ids.length ? 'Original sample evidence supports this profile; direct preferences remain separately attributed.' : 'Approved direct preferences only · no learned voice and no original samples.'}</p>}
    <h3>Film profile import · preview before applying</h3>
    <label>Profile JSON file<input style={field} type="file" accept="application/json,.json" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>500000)throw Error('Profile file is too large.');setPortable(JSON.parse(await f.text()));setConfirmImport(false);setImportReview(null);}catch(err){setError(err.message);setPortable(null);}}} /></label>
    {portable && <div><p>{portable.profile_name} · {portable.profile_version}</p><details><summary>Review imported guidance</summary>{(portable.approved_rules||[]).map((r,i)=><p key={i}>{r.pattern}</p>)}</details>
     <label><input type="checkbox" checked={confirmImport} onChange={e=>{setConfirmImport(e.target.checked);setImportReview(null);}} /> I reviewed these Film instructions and confirm any claimed original samples are mine.</label>
     <p><button className="btn" disabled={busy} onClick={previewImport}>Preview import and conflicts</button></p>
     {importReview && <div aria-label="Import review"><p>Eligible originals: {importReview.eligible_samples} · quarantined sources: {importReview.quarantined_samples}</p>{importReview.warnings.map(w=><p key={w}>{w}</p>)}{importReview.rules.map(r=><p key={r.id}>{r.pattern} · {r.evidence.map(e=>`${e.kind}: ${e.provenance}`).join('; ')}</p>)}
      <button className="btn" disabled={busy} onClick={async()=>{if(await post('/import',{profile:portable,human_confirmed:confirmImport,import_preview_fingerprint:importReview.fingerprint})){setImportReview(null);setPortable(null);}}}>Import profile for local review</button>
     </div>}
     <p>Unconfirmed or generated sources stay quarantined. Imported guidance still needs local approval.</p>
    </div>}
    <div className="writing-coverage"><h3>Coverage</h3>
     <p>{view.coverage.categories.map(c=>`${c.id} ${c.count}`).join(' · ')}</p>
     <p>{view.coverage.gaps.length ? `No usable sample yet for: ${view.coverage.gaps.join(', ')}. ` : 'Every category has a usable sample. '}A partial profile is fine: missing categories stay unknown and are not invented.</p>
    </div>
    <h3>1. Learn my style: a short prompt, or writing you already have</h3>
    <label>Exercise<select style={field} value={exercise} onChange={e=>setExercise(e.target.value)}><option value="">Paste existing writing</option>{view.exercises.map(e=><option key={e.id} value={e.id}>{e.label||e.id}</option>)}</select></label>
    {exercise && <p>{view.exercises.find(e=>e.id===exercise)?.prompt}</p>}
    <label>Writing sample<textarea style={field} rows={5} value={text} onChange={e=>setText(e.target.value)} /></label>
    <label>Source and provenance<input style={field} value={source} onChange={e=>setSource(e.target.value)} placeholder="Where and when you wrote this; editors or AI involved" /></label>
    <label>Authorship<select style={field} value={authorship} onChange={e=>{setAuthorship(e.target.value);setConfirmed(false);}}>
     <option value="unknown">Unknown / not confirmed</option><option value="original_human">My original human writing</option><option value="human_edited">Edited by another human</option><option value="ai_assisted">AI-assisted or AI-edited</option>
    </select></label>
    <label><input type="checkbox" checked={confirmed} disabled={authorship!=='original_human'} onChange={e=>setConfirmed(e.target.checked)} /> I confirm these are my original words, written without AI assistance.</label>
    <label>Tags (comma separated)<input style={field} value={tags} onChange={e=>setTags(e.target.value)} placeholder="dialogue, comedy" /></label>
    <label><input type="checkbox" checked={heldOut} onChange={e=>setHeldOut(e.target.checked)} /> Hold this sample out (kept for testing the profile, never used for drafts)</label>
    <p><button className="btn btn-primary" disabled={busy||!text.trim()||!source.trim()} onClick={addSample}>Save evidence</button></p>
    <h3>Import a script you own or may use</h3>
    <label>Script title<input style={field} value={script.title} onChange={e=>setScript(v=>({ ...v,title:e.target.value }))} /></label>
    <label>Script owner<input style={field} value={script.owner} onChange={e=>setScript(v=>({ ...v,owner:e.target.value }))} /></label>
    <label>Script text<textarea style={field} rows={6} value={script.text} onChange={e=>setScript(v=>({ ...v,text:e.target.value }))} placeholder="Paste Fountain or plain text. Each scene becomes a sample." /></label>
    <label>Rights basis<select style={field} value={script.rights_basis} onChange={e=>setScript(v=>({ ...v,rights_basis:e.target.value }))}><option value="">Choose…</option>{RIGHTS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    <label>Language<input style={field} value={script.language} onChange={e=>setScript(v=>({ ...v,language:e.target.value }))} /></label>
    <label><input type="checkbox" checked={scriptRights} onChange={e=>setScriptRights(e.target.checked)} /> I own this script or have permission to use it for my writing style.</label>
    <label><input type="checkbox" checked={scriptOriginal} onChange={e=>setScriptOriginal(e.target.checked)} /> These are my original words, not AI-written.</label>
    <p><button className="btn" disabled={busy||!script.title.trim()||!script.owner.trim()||!script.text.trim()||!script.rights_basis||!scriptRights} onClick={importScript}>Import script</button></p>
    {view.sources.map(d=><div key={d.id} className="writing-source"><p>{d.title} · {d.owner} · {d.rights_basis.replace(/_/g,' ')} · {d.deleted_at ? 'deleted (hash kept)' : `kept on this machine, hash ${d.source_hash.slice(0,10)}`}
     {!d.deleted_at && <button className="btn btn-sm" disabled={busy} onClick={()=>deleteSource(d)}>Delete script</button>}</p></div>)}
    <h3>2. Draft and review a profile</h3>
    {view.samples.map(s=><div key={s.id} className="writing-sample"><label><input type="checkbox" disabled={!!s.eligibility} checked={selected.includes(s.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id))} /> {s.source} · {s.authorship}{s.confirmed_original ? ' · confirmed' : ''}{s.eligibility ? ` · not style evidence (not used: ${s.eligibility.replace(/_/g,' ')})` : ' · used as evidence'}{s.tags.length ? ` · ${s.tags.join(', ')}` : ''}{s.shared_from ? ' · shared from another project' : ''}</label>
     {s.retention!=='deleted' && !s.shared_from && <span> <button className="btn btn-sm" disabled={busy} onClick={()=>post(`/samples/${s.id}`,{ included:!s.included })}>{s.included ? 'Exclude' : 'Include'}</button>
      <button className="btn btn-sm" disabled={busy} onClick={()=>post(`/samples/${s.id}`,{ held_out:s.retention!=='held_out' })}>{s.retention==='held_out' ? 'Release' : 'Hold out'}</button>
      <button className="btn btn-sm" disabled={busy} onClick={()=>setEditing({id:s.id,text:s.text,source:s.source,fingerprint:s.fingerprint,authorship:s.authorship,confirmed:false})}>Edit sample</button>
      <button className="btn btn-sm" disabled={busy} onClick={()=>deleteSample(s)}>Delete</button></span>}
     {s.retention!=='deleted' && <details><summary>Read sample</summary><p style={{whiteSpace:'pre-wrap'}}>{s.text}</p></details>}</div>)}
    {editing && <div aria-label="Edit captured sample"><h4>Edit captured sample</h4><p>Editing evidence makes affected approvals stale. An AI-assisted source remains quarantined.</p>
     <label>Edited sample text<textarea style={field} rows={5} value={editing.text} onChange={e=>setEditing(v=>({...v,text:e.target.value,confirmed:false}))}/></label>
     <label>Edit provenance<input style={field} value={editing.source} onChange={e=>setEditing(v=>({...v,source:e.target.value}))}/></label>
     {editing.authorship==='original_human' && <label><input type="checkbox" checked={editing.confirmed} onChange={e=>setEditing(v=>({...v,confirmed:e.target.checked}))}/> I confirm this edited sample is my original unaided writing.</label>}
     <button className="btn" disabled={busy||!editing.text.trim()||!editing.source.trim()||(editing.authorship==='original_human'&&!editing.confirmed)} onClick={async()=>{if(await post(`/samples/${editing.id}`,{text:editing.text,source:editing.source,expected_fingerprint:editing.fingerprint,confirmed_original:editing.confirmed}))setEditing(null);}}>Save sample edit</button>
     <button className="btn" onClick={()=>setEditing(null)}>Cancel sample edit</button>
    </div>}
    <label>Proposed style guidance<textarea style={field} rows={4} value={guidance} onChange={e=>setGuidance(e.target.value)} placeholder="Rhythm, vocabulary, dialogue, things to avoid. An assistant can propose this through MCP." /></label>
    <label><input type="checkbox" checked={directPreferences} onChange={e=>setDirectPreferences(e.target.checked)} /> These are my explicit preferences, not a voice learned from samples.</label>
    {directPreferences && <label>Preference provenance<input style={field} value={preferenceSource} onChange={e=>setPreferenceSource(e.target.value)} placeholder="Where and when you explicitly requested these rules" /></label>}
    <button className="btn" disabled={busy||(!selected.length&&!(directPreferences&&preferenceSource.trim()))||!guidance.trim()} onClick={()=>post('/profiles',{ expected_version:latest?.version||0,sample_ids:selected,guidance,preference_confirmation:directPreferences,preference_source:preferenceSource })}>Save draft profile</button>
    <button className="btn" onClick={async()=>{try{await navigator.clipboard.writeText(writingStyleHandoff(project,latest?.version||0));}catch(e){setError(e.message);}}}>Copy assistant handoff</button>
    {latest && <div><h4>Version {latest.version} · {latest.state}</h4>{!latest.sample_ids.length && <p>Direct preferences only. No learned voice or original samples.</p>}<p style={{whiteSpace:'pre-wrap'}}>{latest.guidance}</p><details><summary>Profile evidence and preferences</summary>{latest.sample_ids.map(id=>{const sample=view.samples.find(s=>s.id===id);return <p key={id}>Original sample: {sample?.source||id}</p>;})}{latest.direct_rules.map(r=><p key={r.id}>User instruction: {r.pattern}<br/>Source: {r.source.provenance}</p>)}</details>
     {latest.state==='draft' && <div><label><input type="checkbox" checked={reviewedApproval===`${latest.version}:${latest.evidence_hash}`} onChange={e=>setReviewedApproval(e.target.checked?`${latest.version}:${latest.evidence_hash}`:'')}/> I reviewed this Film profile, its direct preferences and any original sample evidence.</label><p><button className="btn btn-primary" disabled={busy||reviewedApproval!==`${latest.version}:${latest.evidence_hash}`} onClick={()=>post(`/profiles/${latest.version}/approve`,{expected_version:latest.version,human_confirmed:true,profile_approval_fingerprint:latest.evidence_hash})}>Approve reviewed profile</button></p></div>}
    </div>}
    {view.profiles.length>1 && <details><summary>Previous profile versions</summary>{view.profiles.slice(1).map(p=><p key={p.version}>Version {p.version} · {p.state}: {p.guidance}</p>)}</details>}
    <StyleTraits projectId={project.id} />
    <DraftScene projectId={project.id} />
    <PilotPanel projectId={project.id} />
    <h3>3. Corrections, feedback and Film export</h3>
    <label>Correction to this Film guidance<textarea style={field} rows={3} value={correction} onChange={e=>setCorrection(e.target.value)} placeholder="Your direct instruction. It takes precedence over conflicting earlier guidance."/></label>
    <label>Correction provenance<input style={field} value={correctionSource} onChange={e=>setCorrectionSource(e.target.value)} placeholder="Where and when you gave this instruction"/></label>
    <button className="btn" disabled={busy||!latest||!correction.trim()||!correctionSource.trim()} onClick={async()=>{if(await post('/corrections',{expected_version:latest.version,profile_approval_fingerprint:latest.evidence_hash,correction,preference_source:correctionSource})){setCorrection('');setCorrectionSource('');}}}>Propose corrected version</button>
    <p>Corrections remain direct preferences. A corrected version becomes active only after your review and approval.</p>
    <label>What sounds like you, and what does not?<textarea style={field} value={feedback} onChange={e=>setFeedback(e.target.value)} /></label>
    <button className="btn" disabled={busy||!latest||!feedback.trim()} onClick={()=>post('/feedback',{profile_version:latest.version,text:feedback})}>Save feedback</button>
    {view.feedback.map(f=><p key={f.id}>Version {f.profile_version}: {f.text}</p>)}
    <button className="btn" onClick={exportProfile}>Export Film voice for ChatGPT / Claude</button>
    <p>Exports include rules and source metadata. Sample prose is not exported without separate excerpt reuse approval. Only approved guidance is active; proposed updates need your review.</p>
   </>}
  </section>}
 </>;
}
