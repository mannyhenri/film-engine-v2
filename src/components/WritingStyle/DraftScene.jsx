import { useEffect, useState } from 'react';
import { legacy } from '../../lib/legacy.js';

/*
 * Draft a scene in the approved style (GRD-4663): brief and constraints → a preview of exactly what
 * would be sent → the author approves and it is sent → alternatives → line hunks against the current
 * scene → the author accepts the hunks they choose as a new script revision. Nothing here edits the
 * screenplay until that last step. With provider "host", the assistant in Claude writes the draft and
 * returns it with script_create_draft, so nothing is sent from here.
 */
const field = { display:'block', width:'100%', margin:'6px 0 10px' };

export default function DraftScene({ projectId }) {
 const base = `/projects/${projectId}/style-drafting`;
 const [scenes, setScenes] = useState([]), [meta, setMeta] = useState(null);
 const [form, setForm] = useState({ scene_id:'', brief:'', constraints:'', provider:'host' });
 const [request, setRequest] = useState(null), [compare, setCompare] = useState(null), [chosen, setChosen] = useState({});
 const [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState('');
 const op = (name, body) => legacy.api(`${base}/${name}`, { method:'POST', body:JSON.stringify(body || {}) });
 async function step(fn) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
 async function load() {
  const [list, s] = await Promise.all([op('drafts.list'), legacy.api(`/projects/${projectId}/scenes`)]);
  setMeta(list); setScenes((s.scenes || []).filter(x => x.status !== 'removed'));
 }
 useEffect(() => { step(load); }, [projectId]);

 const preview = () => step(async () => {
  setCompare(null); setDone('');
  const r = await op('script.create_draft', { scene_id:form.scene_id, brief:form.brief, provider:form.provider, expected_script_version:meta.script_version,
   constraints:form.constraints.split('\n').map(c => c.trim()).filter(Boolean) });
  setRequest(r);
 });
 const send = () => step(async () => {
  const pv = request.preview;
  if (!window.confirm(`Send this to ${pv.provider_label}? Purpose: ${pv.purpose}. It includes ${pv.excerpts.length} of your excerpts (${pv.sample_categories.join(', ') || 'no categories'}) and this one scene, nothing else.`)) return;
  await op('drafts.approve_preview', { request_id:request.request_id, approval_fingerprint:pv.payload_fingerprint, human_confirmed:true });
  await op('drafts.generate', { request_id:request.request_id });
  setCompare(await op('script.compare_drafts', { request_id:request.request_id })); setChosen({});
 });
 const accept = alt => step(async () => {
  const ids = Object.keys(chosen[alt.draft_id] || {}).filter(k => chosen[alt.draft_id][k]);
  if (!window.confirm(`Accept ${ids.length} selected change(s) into a new revision of the screenplay?`)) return;
  const r = await op('drafts.accept', { draft_id:alt.draft_id, hunk_ids:ids, approval_fingerprint:alt.fingerprint, human_confirmed:true, expected_script_version:compare.current.script_version });
  setDone(`Accepted into script version ${r.script_version}.`); setCompare(null); setRequest(null); await load();
 });
 const pv = request && request.preview;

 return <div className="draft-scene">
  <h3>Draft a scene</h3>
  <p>Drafts use your approved style. The screenplay changes only when you accept selected text.</p>
  {error && <p role="alert">{error}</p>}
  {done && <p>{done}</p>}
  <label>Scene<select style={field} value={form.scene_id} onChange={e => setForm(f => ({ ...f, scene_id:e.target.value }))}>
   <option value="">Choose a scene…</option>{scenes.map(s => <option key={s.id} value={s.id}>{s.scene_number}. {s.int_ext} {s.location} {s.time_of_day}</option>)}</select></label>
  <label>Brief<textarea style={field} rows={3} value={form.brief} onChange={e => setForm(f => ({ ...f, brief:e.target.value }))} /></label>
  <label>Constraints (one per line)<textarea style={field} rows={2} value={form.constraints} onChange={e => setForm(f => ({ ...f, constraints:e.target.value }))} /></label>
  <label>Provider<select style={field} value={form.provider} onChange={e => setForm(f => ({ ...f, provider:e.target.value }))}>
   {(meta ? meta.providers : []).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
  <button className="btn" disabled={busy || !meta || !form.scene_id || !form.brief.trim()} onClick={preview}>Preview what will be sent</button>
  {pv && <div className="draft-preview card" style={{ padding:10, margin:'8px 0' }}>
   <p><strong>{pv.provider_label}</strong> · {pv.purpose}</p>
   <p className="text-sm">Your excerpts: {pv.excerpts.length ? pv.excerpts.map(e => `${e.category} (${e.source}, ~${e.tokens} tokens)`).join('; ') : 'none'}. Categories: {pv.sample_categories.join(', ') || 'none'}.</p>
   <details><summary>The scene that would be sent</summary><pre style={{ whiteSpace:'pre-wrap' }}>{pv.script_excerpt}</pre></details>
   {pv.external
    ? <button className="btn btn-primary" disabled={busy} onClick={send}>Approve and send</button>
    : <p className="text-sm">Nothing is sent from here. Ask your assistant in Claude to write this draft and return it with script_create_draft (request {request.request_id}).</p>}
  </div>}
  {compare && compare.alternatives.map((alt, i) => <div key={alt.draft_id} className="draft-alternative card" style={{ padding:10, margin:'8px 0' }}>
   <p><strong>Alternative {i + 1}</strong> · {alt.provenance.provider_model || alt.provenance.provider}</p>
   {alt.hunks.map(h => <label key={h.id} className="draft-hunk" style={{ display:'block', margin:'4px 0' }}>
    <input type="checkbox" checked={!!(chosen[alt.draft_id] || {})[h.id]} onChange={e => setChosen(c => ({ ...c, [alt.draft_id]:{ ...(c[alt.draft_id] || {}), [h.id]:e.target.checked } }))} />
    {h.before.length > 0 && <span style={{ textDecoration:'line-through', marginLeft:6 }}>{h.before.join(' / ')}</span>}
    {h.after.length > 0 && <span style={{ marginLeft:6 }}>{h.after.join(' / ')}</span>}
   </label>)}
   <button className="btn btn-primary" disabled={busy || !Object.values(chosen[alt.draft_id] || {}).some(Boolean)} onClick={() => accept(alt)}>Accept selected as a new revision</button>
  </div>)}
 </div>;
}
