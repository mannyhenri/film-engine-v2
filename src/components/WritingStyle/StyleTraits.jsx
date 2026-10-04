import { useEffect, useState } from 'react';
import { legacy } from '../../lib/legacy.js';

/*
 * Style traits (GRD-4662), inside the writing-style workbench. Every proposed trait is shown as its
 * plain-language rule, where it comes from (the author's own style, or a genre, scene or character
 * requirement), its confidence, and its evidence: each excerpt with its location, and counterexamples.
 * Corrections and A/B choices only ever propose. The author accepts, modifies or rejects each proposal,
 * removes a trait for one project or everywhere, and restores an earlier version. Each needs a confirm
 * and carries the exact fingerprint of what will become active.
 */
const SOURCE = { author_style:'Author style', genre:'Genre requirement', scene:'Scene requirement', character:'Character requirement' };
const KIND = { rule:'Rule', anti_pattern:'Avoid' };
const field = { display:'block', width:'100%', margin:'6px 0 10px' };

export default function StyleTraits({ projectId }) {
 const base = `/projects/${projectId}/style-profile`;
 const [view, setView] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
 const [edits, setEdits] = useState({});
 const [corr, setCorr] = useState({ before:'', after:'', reason:'', scope:'scene' });
 const [ab, setAb] = useState({ dimension:'rhythm', option_a:'', option_b:'' });

 async function call(path, body, method = 'POST') {
  setBusy(true); setError('');
  try {
   const next = await legacy.api(base + path, method === 'GET' ? {} : { method, body:JSON.stringify(body || {}) });
   // Anything but a style-profile answer is an error here, never a half-drawn panel inside the workbench.
   if (!next || !Array.isArray(next.proposals) || !next.global || !next.override) throw new Error('Style traits are unavailable right now.');
   setView(next); return true;
  }
  catch (e) { setError(e.message); return false; } finally { setBusy(false); }
 }
 useEffect(() => { call('', null, 'GET'); }, [projectId]);
 if (!view) return <div className="style-traits"><h3>Style traits</h3>{error ? <p role="alert">{error}</p> : <p>Loading…</p>}</div>;

 const versionOf = target => (target === 'global' ? view.global.version : view.override.version);
 const pending = view.proposals.filter(p => p.status === 'pending');
 const accept = p => { if (window.confirm(`Make this active ${p.target === 'global' ? 'in your global style' : 'for this project'}: "${p.trait.statement}"?`))
  call('/proposals/accept', { proposal_id:p.id, approval_fingerprint:p.fingerprint, human_confirmed:true, expected_version:versionOf(p.target) }); };
 const remove = (t, target) => { if (window.confirm(`Remove "${t.statement}" ${target === 'global' ? 'from your global style, for every project' : 'for this project only'}?`))
  call('/traits/remove', { target, trait_id:t.id, approval_fingerprint:t.fingerprint, human_confirmed:true, expected_version:versionOf(target) }); };
 const restore = (target, v) => { if (window.confirm(`Restore ${target === 'global' ? 'global style' : 'this project\'s style'} version ${v.version}? A new version is written; nothing earlier is changed.`))
  call('/restore', { target, version:v.version, approval_fingerprint:v.approval_fingerprint, human_confirmed:true, expected_version:versionOf(target) }); };
 const origin = t => (t.explicit_user_rule ? `Explicit user rule (${t.preference_source})` : `confidence ${t.confidence}`);
 const spans = (list, cls) => list.length > 0 && <ul className={cls}>{list.map((e, i) => <li key={i}>“{e.excerpt}” · {e.location}</li>)}</ul>;

 return <div className="style-traits">
  <h3>Style traits</h3>
  <p>Precedence: the scene's instructions and screenplay facts, then this project's style, then your global style. Learning only proposes: nothing is active until you accept it.</p>
  <button className="btn btn-sm" disabled={busy} onClick={() => call('', null, 'GET')}>Refresh</button>
  {error && <p role="alert">{error}</p>}

  <h4>Proposed</h4>
  {!pending.length && <p>No pending proposals.</p>}
  {pending.map(p => <div key={p.id} className="style-proposal card" style={{ padding:10, margin:'8px 0' }}>
   <p><strong>{KIND[p.trait.kind]}:</strong> {p.trait.statement}</p>
   <p className="text-sm">{SOURCE[p.trait.source]} · {p.trait.category} · {p.target === 'global' ? 'global style' : 'this project'} · {origin(p.trait)} · from {p.origin}</p>
   {spans(p.trait.evidence, 'style-evidence')}
   {p.trait.counterexamples.length > 0 && <div className="style-counterexamples"><p className="text-sm">Counterexamples:</p>{spans(p.trait.counterexamples, 'style-counter-list')}</div>}
   {p.trait.exclusions.length > 0 && <p className="text-sm">Not in: {p.trait.exclusions.join(', ')}</p>}
   <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => accept(p)}>Accept</button>{' '}
   <button className="btn btn-sm style-reject" disabled={busy} onClick={() => call('/proposals/reject', { proposal_id:p.id })}>Reject</button>
   <textarea className="style-modify" style={field} rows={2} value={edits[p.id] ?? p.trait.statement} onChange={e => setEdits(x => ({ ...x, [p.id]:e.target.value }))} />
   <button className="btn btn-sm style-save-modified" disabled={busy || !(edits[p.id] || '').trim() || edits[p.id] === p.trait.statement}
    onClick={() => call('/proposals/modify', { proposal_id:p.id, trait:{ ...p.trait, statement:edits[p.id] } })}>Save as a revised proposal</button>
  </div>)}

  <div className="style-in-force"><h4>In force for this project</h4>
   {!view.effective.length && <p>No traits in force yet: nothing in force for this project.</p>}
   {view.effective.map(t => <p key={t.id}>{KIND[t.kind]}: {t.statement} · {t.layer === 'global' ? 'global' : 'project'} · {SOURCE[t.source]}{' '}
    <button className="btn btn-sm style-remove-here" disabled={busy} onClick={() => remove(t, 'project')}>Remove for this project</button>
    {t.layer === 'global' && <> <button className="btn btn-sm" disabled={busy} onClick={() => remove(t, 'global')}>Remove everywhere</button></>}</p>)}
   {view.suppressed.length > 0 && <details><summary>Not applied here</summary>{view.suppressed.map((x, i) => <p key={i}>{x.trait.statement}: {x.reason}</p>)}</details>}
  </div>

  <h4>Correct a line</h4>
  <label>Before<input style={field} value={corr.before} onChange={e => setCorr(c => ({ ...c, before:e.target.value }))} /></label>
  <label>After<input style={field} value={corr.after} onChange={e => setCorr(c => ({ ...c, after:e.target.value }))} /></label>
  <label>Why (optional)<input style={field} value={corr.reason} onChange={e => setCorr(c => ({ ...c, reason:e.target.value }))} /></label>
  <label>Applies to<select style={field} value={corr.scope} onChange={e => setCorr(c => ({ ...c, scope:e.target.value }))}>
   <option value="scene">This scene only</option><option value="project">This project</option><option value="global">All my writing</option></select></label>
  <button className="btn btn-sm" disabled={busy || !corr.before.trim()} onClick={async () => {
   if (await call('/corrections', { before:corr.before, after:corr.after, scope:corr.scope, reason:corr.reason.trim() || undefined })) setCorr({ before:'', after:'', reason:'', scope:'scene' });
  }}>Record correction</button>

  <h4>Which sounds more like you?</h4>
  <label>Dimension<select style={field} value={ab.dimension} onChange={e => setAb(x => ({ ...x, dimension:e.target.value }))}>{view.dimensions.map(d => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}</select></label>
  <label>Option A<input style={field} value={ab.option_a} onChange={e => setAb(x => ({ ...x, option_a:e.target.value }))} /></label>
  <label>Option B<input style={field} value={ab.option_b} onChange={e => setAb(x => ({ ...x, option_b:e.target.value }))} /></label>
  <button className="btn btn-sm" disabled={busy || !ab.option_a.trim() || !ab.option_b.trim()} onClick={async () => { if (await call('/pairwise', ab)) setAb(x => ({ ...x, option_a:'', option_b:'' })); }}>Ask me</button>
  {view.pairwise.map(q => <div key={q.id} className="style-pairwise card" style={{ padding:10, margin:'8px 0' }}>
   <p className="text-sm">{q.dimension.replace(/_/g, ' ')}: shown in random order</p>
   <button className="btn btn-sm" disabled={busy} onClick={() => call('/pairwise/choose', { id:q.id, choice:'first' })}>{q.first}</button>{' '}
   <button className="btn btn-sm" disabled={busy} onClick={() => call('/pairwise/choose', { id:q.id, choice:'second' })}>{q.second}</button>{' '}
   <button className="btn btn-sm" disabled={busy} onClick={() => call('/pairwise/choose', { id:q.id, choice:'neither' })}>Neither</button>
  </div>)}

  <div className="style-history"><h4>History</h4>
   {[['global', view.global], ['project', view.override]].map(([target, layer]) => layer.versions.slice().reverse().map(v => <div key={target + v.version}>
    <p className="text-sm"><strong>{target === 'global' ? 'Global' : 'Project'} version {v.version}</strong> · {v.created_at}
     {v.version !== layer.version && <> <button className="btn btn-sm style-restore" data-target={target} data-version={v.version} disabled={busy} onClick={() => restore(target, v)}>Restore</button></>}</p>
    <ul className="text-sm">{v.change_summary.map((line, i) => <li key={i}>{line}</li>)}</ul>
   </div>))}
  </div>
 </div>;
}
