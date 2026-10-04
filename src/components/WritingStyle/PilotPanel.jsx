import { useEffect, useState } from 'react';
import { legacy } from '../../lib/legacy.js';

/*
 * The blinded style pilot (GRD-4664), run by the author. Choose held-out samples and write a brief
 * for each, agree the success criterion, run, review each pair blind (left/right, never which is
 * conditioned) with the full rubric, read the report, then release or hold. Activation is a
 * separate step after release. See docs/style-pilot.md.
 */
const RUBRIC = ['correctness', 'character_consistency', 'subtext', 'pacing', 'action_clarity', 'description', 'sounds_like_me'];
const field = { display:'block', width:'100%', margin:'6px 0 10px' };

export default function PilotPanel({ projectId }) {
 const base = `/projects/${projectId}/style-pilot`;
 const op = (name, body) => legacy.api(`${base}/${name}`, { method:'POST', body:JSON.stringify(body || {}) });
 const [held, setHeld] = useState([]), [picked, setPicked] = useState({}), [setup, setSetup] = useState({ provider:'claude', model:'' });
 const [status, setStatus] = useState(null), [queue, setQueue] = useState(null), [report, setReport] = useState(null);
 const [crit, setCrit] = useState({ criterion:'', min_win_rate:'', max_rubric_regressions:'', reviewer:'' });
 const [reviews, setReviews] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
 async function step(fn) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
 async function load() {
  const [ws, st] = await Promise.all([legacy.api(`/projects/${projectId}/writing-style`), op('status')]);
  setHeld((ws.samples || []).filter(s => s.retention === 'held_out' && !s.shared_from)); setStatus(st);
  const current = st.pilots[0];
  if (current) setQueue(await op('reviewQueue', { pilot_id:current.id })); else setQueue(null);
 }
 useEffect(() => { step(load); }, [projectId]);
 const current = status && status.pilots[0];
 const reviewer = crit.reviewer.trim();

 const create = () => step(async () => {
  const briefs = Object.entries(picked).filter(([, v]) => v && v.on && v.brief.trim()).map(([id, v]) => ({ target_sample_id:id, brief:v.brief, sample_type:(held.find(s => s.id === id) || {}).exercise || 'general' }));
  await op('createPilot', { briefs, provider:setup.provider, model:setup.model }); setReport(null); await load();
 });
 const agree = () => step(async () => {
  if (!window.confirm(`Fix this success criterion before testing? "${crit.criterion}"`)) return;
  await op('agreeCriterion', { pilot_id:current.id, criterion:crit.criterion, reviewer, human_confirmed:true,
   ...(crit.min_win_rate !== '' ? { min_win_rate:Number(crit.min_win_rate) } : {}), ...(crit.max_rubric_regressions !== '' ? { max_rubric_regressions:Number(crit.max_rubric_regressions) } : {}) });
  await load();
 });
 const run = () => step(async () => {
  if (!window.confirm(`Send ${queue.pilot.briefs.length * 2} drafts (${queue.pilot.briefs.length} briefs, with and without your style) to ${current && queue.pilot.provider}?`)) return;
  setQueue(await op('runPilot', { pilot_id:current.id })); await load();
 });
 const save = pair => step(async () => {
  const r = reviews[pair.id] || {};
  await op('reviewPair', { pair_id:pair.id, choice:r.choice, reviewer, rubric:{ left:r.left || {}, right:r.right || {} } });
  setQueue(await op('reviewQueue', { pilot_id:current.id }));
 });
 const decide = decision => step(async () => {
  const r = await op('report', { pilot_id:current.id });
  if (!window.confirm(`${decision === 'release' ? 'Release' : 'Hold'} this candidate, based on the report you read?`)) return;
  setStatus(await op('releaseGate', { pilot_id:current.id, decision, report_fingerprint:r.report_fingerprint, human_confirmed:true, reviewer }));
 });
 const activate = () => step(async () => {
  if (!window.confirm('Activate the released profile for drafting?')) return;
  setStatus(await op('activate', { pilot_id:current.id, human_confirmed:true, reviewer }));
 });
 const setReview = (id, patch) => setReviews(x => ({ ...x, [id]:{ ...(x[id] || {}), ...patch(x[id] || {}) } }));
 const gate = status && current && [...status.decisions].reverse().find(d => d.kind === 'release_gate' && d.pilot_id === current.id);
 const chosen = Object.values(picked).filter(v => v && v.on && v.brief.trim()).length;

 return <div className="pilot-panel">
  <h3>Style pilot</h3>
  <p>A blind test: the same model and brief, with and without your style. Nothing is activated without your verdict. <em>How this works is in the help: inference-time conditioning and its limits.</em></p>
  {error && <p role="alert">{error}</p>}
  <div className="pilot-status">{status && (status.released_profile ? `Active: profile version ${status.released_profile.profile_version}` : gate && gate.decision === 'release' ? 'Released by you, not active yet.' : 'No released style yet.')}</div>

  {(!current || current.status === 'awaiting_review' || current.status === 'failed') && <div>
   <h4>New pilot: choose at least 10 held-out samples</h4>
   {held.map(s => <div key={s.id} className="pilot-target">
    <label><input type="checkbox" checked={!!(picked[s.id] && picked[s.id].on)} onChange={e => setPicked(p => ({ ...p, [s.id]:{ brief:'', ...(p[s.id] || {}), on:e.target.checked } }))} /> {s.exercise || 'general'} · {s.source}</label>
    <textarea style={field} rows={2} placeholder="A brief that this held-out sample answers" value={(picked[s.id] || {}).brief || ''} onChange={e => setPicked(p => ({ ...p, [s.id]:{ on:true, ...(p[s.id] || {}), brief:e.target.value } }))} />
   </div>)}
   <label>Provider<select style={field} value={setup.provider} onChange={e => setSetup(x => ({ ...x, provider:e.target.value }))}><option value="claude">Claude (Anthropic API)</option><option value="chatgpt">ChatGPT (OpenAI API)</option></select></label>
   <label>Model<input style={field} value={setup.model} onChange={e => setSetup(x => ({ ...x, model:e.target.value }))} /></label>
   <button className="btn" disabled={busy || chosen < 10 || !setup.model.trim()} onClick={create}>Create pilot</button> <span className="text-sm">{chosen} chosen</span>
  </div>}

  {current && current.status === 'draft' && <div>
   <h4>Pilot {current.version}: agree the success criterion first</h4>
   <label>Success criterion<input style={field} value={crit.criterion} onChange={e => setCrit(c => ({ ...c, criterion:e.target.value }))} /></label>
   <label>Minimum win rate<input style={field} value={crit.min_win_rate} onChange={e => setCrit(c => ({ ...c, min_win_rate:e.target.value }))} placeholder="0.6" /></label>
   <label>Most rubric regressions allowed<input style={field} value={crit.max_rubric_regressions} onChange={e => setCrit(c => ({ ...c, max_rubric_regressions:e.target.value }))} placeholder="0" /></label>
   <label>Your name<input style={field} value={crit.reviewer} onChange={e => setCrit(c => ({ ...c, reviewer:e.target.value }))} /></label>
   <button className="btn" disabled={busy || !crit.criterion.trim() || !reviewer} onClick={agree}>Agree criterion</button>
  </div>}
  {current && current.status === 'criterion_agreed' && <button className="btn btn-primary" disabled={busy} onClick={run}>Run pilot</button>}

  {queue && queue.pairs.length > 0 && <div>
   <h4>Review blind (pilot {queue.pilot.version})</h4>
   {!reviewer && <label>Your name<input style={field} value={crit.reviewer} onChange={e => setCrit(c => ({ ...c, reviewer:e.target.value }))} /></label>}
   {queue.pairs.map(p => <div key={p.id} className="pilot-pair card" style={{ padding:10, margin:'8px 0' }}>
    <p className="text-sm">{p.brief}{p.choice ? ` · reviewed (${p.choice})` : ''}</p>
    <div style={{ display:'flex', gap:12 }}>
     <pre className="pilot-left" style={{ flex:1, whiteSpace:'pre-wrap' }}>{p.left}</pre><pre className="pilot-right" style={{ flex:1, whiteSpace:'pre-wrap' }}>{p.right}</pre>
    </div>
    {p.reuse_flags.map((f, i) => <p key={i} className="text-sm">⚠ {f.side}: {f.reason}</p>)}
    {['left', 'right', 'tie'].map(c => <label key={c} style={{ marginRight:10 }}><input type="radio" name={`choice-${p.id}`} value={c} checked={(reviews[p.id] || {}).choice === c} onChange={() => setReview(p.id, () => ({ choice:c }))} /> {c === 'tie' ? 'Tie' : `${c[0].toUpperCase()}${c.slice(1)} sounds more like me`}</label>)}
    <table className="text-sm"><tbody>{RUBRIC.map(d => <tr key={d}><td>{d.replace(/_/g, ' ')}</td>{['left', 'right'].map(side => <td key={side}>
     <select className="pilot-score" aria-label={`${side} ${d}`} value={((reviews[p.id] || {})[side] || {})[d] || ''} onChange={e => setReview(p.id, r => ({ [side]:{ ...(r[side] || {}), [d]:Number(e.target.value) } }))}>
      <option value="">{side}</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></td>)}</tr>)}</tbody></table>
    <button className="btn btn-sm pilot-save" disabled={busy || !reviewer || !(reviews[p.id] || {}).choice} onClick={() => save(p)}>Save review</button>
   </div>)}
   <button className="btn" disabled={busy} onClick={() => step(async () => setReport(await op('report', { pilot_id:current.id })))}>Show report</button>
  </div>}

  {report && <div className="pilot-report card" style={{ padding:10, margin:'8px 0' }}>
   <p>Pilot {report.versions.pilot_version} · profile v{report.versions.profile_version} · {report.versions.provider} {report.versions.model} · {report.sample_size.reviewed} of {report.sample_size.pairs} reviewed</p>
   <p>Wins {report.counts.wins} · Ties {report.counts.ties} · Losses {report.counts.losses} · win rate {report.criterion.win_rate ?? '—'} · criterion {report.criterion.met === null ? 'not yet decidable' : report.criterion.met ? 'met' : 'not met'}</p>
   <table className="text-sm"><tbody>{RUBRIC.map(d => <tr key={d}><td>{d.replace(/_/g, ' ')}</td><td>with style {report.rubric[d].conditioned ?? '—'}</td><td>without {report.rubric[d].unconditioned ?? '—'}</td></tr>)}</tbody></table>
   {report.regressions.length > 0 && <p>Regressions: {report.regressions.join(', ')}</p>}
   {report.notes.map((n, i) => <p key={i} className="text-sm">{n}</p>)}
   <p className="text-sm">Excluded: {report.exclusions.evaluation_targets} targets, {report.exclusions.near_duplicates} near-duplicates. AI judge: {report.ai_judgements.count} recorded; it never counts.</p>
   <button className="btn btn-primary" disabled={busy || !reviewer} onClick={() => decide('release')}>Release</button>{' '}
   <button className="btn" disabled={busy || !reviewer} onClick={() => decide('hold')}>Hold</button>
  </div>}
  {gate && gate.decision === 'release' && !(status.released_profile && status.released_profile.pilot_id === current.id) && <button className="btn btn-primary" disabled={busy || !reviewer} onClick={activate}>Activate</button>}
 </div>;
}
