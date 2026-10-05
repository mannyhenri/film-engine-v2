import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';

/*
 * Reference/board comparison (GRD-4666). The approved reference package and a board, in one frame:
 * the board over the package's beauty render with an opacity slider, and the package's landmarks,
 * subject bounds, horizon and eyelines drawn on top. A person marks where things landed on the
 * board, compares, and decides: accept, accept with named deviations, redo or reject. Only an
 * accepted board can be pinned for video. Every check the person did not mark stays "unverified"
 * and sends the board to a person; nothing is guessed from pixels.
 */
const field = { display:'block', width:'100%', margin:'6px 0 10px' };
const COLOURS = { ok:'#22c55e', drift:'#ef4444', unverified:'#f59e0b' };

export default function ReferenceCompare() {
 const [open, setOpen] = useState(false), [shots, setShots] = useState([]), [shotId, setShotId] = useState('');
 const [data, setData] = useState(null), [boardId, setBoardId] = useState(''), [opacity, setOpacity] = useState(50);
 const [marks, setMarks] = useState({}), [marking, setMarking] = useState(null), [result, setResult] = useState(null);
 const [disposition, setDisposition] = useState('accept'), [notes, setNotes] = useState({}), [by, setBy] = useState('');
 const [decided, setDecided] = useState(false), [pinned, setPinned] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
 const project = legacy.state.currentProject;
 const base = id => `/shots/${id}/previs`;
 async function step(fn) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } }

 const show = () => step(async () => {
  if (!project) throw new Error('Open a project first.');
  setOpen(true);
  const sc = await legacy.api(`/projects/${project.id}/scenes`);
  const all = [];
  for (const s of (sc.scenes || []).filter(x => x.status !== 'removed')) { const one = await legacy.api(`/scenes/${s.id}`); for (const sh of one.shots || []) all.push(sh); }
  setShots(all);
 });
 const pick = id => step(async () => {
  setShotId(id); setResult(null); setMarks({}); setDecided(false); setPinned(null);
  setData(id ? await legacy.api(`${base(id)}/packages`) : null); setBoardId('');
 });
 const pkg = data && data.state.pinned ? data.packages.find(p => p.id === data.state.pinned.id) : null;
 const checks = pkg ? [
  ...(pkg.intent.landmarks || []).map(l => ({ id:l.id, label:l.name || l.id, kind:'point' })),
  ...(pkg.intent.subjects || []).map(s => ({ id:`subject:${s.name}`, label:s.name, kind:'point' })),
  { id:'horizon', label:'Horizon', kind:'line' },
  ...(pkg.intent.subjects || []).map(s => ({ id:`eyeline:${s.name}`, label:`${s.name}'s eyeline`, kind:'line' })),
 ] : [];
 function place(e) {
  if (!marking || !pkg) return;
  const r = e.currentTarget.getBoundingClientRect();
  const x = Math.round((e.clientX - r.left) / (r.width || 1) * pkg.camera.width), y = Math.round((e.clientY - r.top) / (r.height || 1) * pkg.camera.height);
  const c = checks.find(k => k.id === marking);
  setMarks(m => (c.kind === 'line' ? (marking === 'horizon' ? { ...m, horizon:y } : { ...m, eyeline:{ ...(m.eyeline || {}), [marking.slice(8)]:y } }) : { ...m, [marking]:[x, y] }));
  setMarking(null);
 }
 const compare = () => step(async () => {
  setResult(await legacy.api(`${base(shotId)}/board-reviews`, { method:'POST', body:JSON.stringify({ package_id:pkg.id, board_asset_id:boardId, marks }) }));
  setDecided(false); setPinned(null);
 });
 const open_ = result ? result.checks.filter(c => c.status !== 'ok') : [];
 const decide = () => step(async () => {
  if (!window.confirm(`Record "${disposition.replace(/_/g, ' ')}" for this board?`)) return;
  await legacy.api(`${base(shotId)}/board-reviews/${result.review_id}/dispose`, { method:'POST', body:JSON.stringify({ comparison_fingerprint:result.comparison_fingerprint, disposition,
   deviations:disposition === 'accept_with_deviations' ? open_.map(c => ({ check:c.id, note:notes[c.id] || '' })) : [], human_confirmed:true, by }) });
  setDecided(true);
 });
 const pinVideo = () => step(async () => { setPinned(await legacy.api(`${base(shotId)}/board-reviews/${result.review_id}/pin-video`, { method:'POST', body:'{}' })); });
 const src = path => `${legacy.API_BASE}/film${path}`;
 const W = pkg ? pkg.camera.width : 16, H = pkg ? pkg.camera.height : 9;
 const statusOf = id => result && (result.checks.find(c => c.id === id) || {}).status;

 return <>
  <button type="button" className="btn btn-secondary" style={{ position:'fixed', right:150, bottom:38, zIndex:100 }} onClick={show}>Reference compare</button>
  {open && <section role="dialog" aria-label="Reference compare" style={{ position:'fixed', inset:'5% 8%', zIndex:1100, overflowY:'auto', background:'var(--gl-bg,#171923)', color:'var(--gl-text,#eee)', padding:20, border:'1px solid #666', borderRadius:12 }}>
   <button className="btn" onClick={() => setOpen(false)}>Close</button>
   <h2>Reference and board</h2>
   {error && <p role="alert">{error}</p>}
   <label>Shot<select style={field} value={shotId} onChange={e => pick(e.target.value)}><option value="">Choose a shot…</option>{shots.map(s => <option key={s.id} value={s.id}>{s.shot_code}</option>)}</select></label>
   {data && !pkg && <p>This shot has no pinned, approved reference package.</p>}
   {pkg && <>
    <p className="text-sm">Package v{pkg.version} · approved by {pkg.approved_by || 'nobody'}{data.state.stale ? ` · STALE: ${data.state.reasons.join(', ')} changed since` : ''}</p>
    <label>Board version<select style={field} value={boardId} onChange={e => { setBoardId(e.target.value); setResult(null); }}><option value="">Choose a board…</option>
     {data.boards.map(b => <option key={b.id} value={b.id}>v{b.version}{b.source ? ` (${b.source})` : ''}</option>)}</select></label>
    <label>Board opacity<input type="range" min="0" max="100" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></label>
    <div className="refcmp-stage" onClick={place} style={{ position:'relative', width:'100%', aspectRatio:`${W} / ${H}`, cursor:marking ? 'crosshair' : 'default', background:'#000' }}>
     <img className="refcmp-reference" alt="Reference package" src={src(`${base(shotId)}/packages/${pkg.id}/passes/beauty`)} style={{ position:'absolute', inset:0, width:'100%', height:'100%' }} />
     {boardId && <img className="refcmp-board" alt="Board" src={src(`${base(shotId)}/board-reviews/asset/${boardId}`)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity:opacity / 100 }} />}
     <svg className="refcmp-overlay" viewBox={`0 0 ${W} ${H}`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }}>
      {pkg.intent.horizon_y !== null && <line data-line="horizon" x1="0" x2={W} y1={pkg.intent.horizon_y} y2={pkg.intent.horizon_y} stroke="#38bdf8" strokeDasharray="8 6" />}
      {(pkg.intent.landmarks || []).filter(l => l.screen).map(l => <g key={l.id} data-landmark={l.id}><circle cx={l.screen[0]} cy={l.screen[1]} r="10" fill="none" stroke={COLOURS[statusOf(l.id)] || '#fff'} strokeWidth="3" /><text x={l.screen[0] + 12} y={l.screen[1]} fill="#fff" fontSize="18">{l.name || l.id}</text></g>)}
      {(pkg.intent.subjects || []).filter(s => s.bounds).map(s => <rect key={s.name} data-subject={s.name} x={s.bounds[0]} y={s.bounds[1]} width={s.bounds[2] - s.bounds[0]} height={s.bounds[3] - s.bounds[1]} fill="none" stroke={COLOURS[statusOf(`subject:${s.name}`)] || '#fff'} strokeWidth="3" />)}
      {Object.entries(marks).filter(([k, v]) => Array.isArray(v)).map(([k, v]) => <path key={k} d={`M${v[0] - 9} ${v[1]} h18 M${v[0]} ${v[1] - 9} v18`} stroke="#facc15" strokeWidth="3" />)}
     </svg>
    </div>
    <p className="text-sm">{marking ? `Click where ${checks.find(c => c.id === marking).label} is on the board.` : 'Mark where each landmark landed on the board, then compare. Anything unmarked goes to a person.'}</p>
    <ul className="text-sm">{checks.map(c => <li key={c.id} data-check={c.id}>{c.label}: {statusOf(c.id) || (c.id === 'horizon' ? (marks.horizon !== undefined ? 'marked' : 'unmarked') : c.id.startsWith('eyeline:') ? ((marks.eyeline || {})[c.id.slice(8)] !== undefined ? 'marked' : 'unmarked') : (marks[c.id] ? 'marked' : 'unmarked'))}
     {' '}<button type="button" className="btn btn-sm" data-mark={c.id} onClick={() => setMarking(c.id)}>Mark</button></li>)}</ul>
    <button className="btn" disabled={busy || !boardId} onClick={compare}>Compare</button>
    {result && <div className="refcmp-result">
     <p>{result.manual_review ? 'Some checks are unverified: this board needs a person to look.' : result.drift.length ? `Drift: ${result.drift.join(', ')}` : 'Every check is within tolerance.'}</p>
     <p className="text-sm">Framing: {(result.checks.find(c => c.category === 'framing') || {}).status}</p>
     <label>Disposition<select style={field} value={disposition} onChange={e => setDisposition(e.target.value)}>
      <option value="accept">Accept</option><option value="accept_with_deviations">Accept with known deviations</option><option value="redo">Redo</option><option value="reject">Reject</option></select></label>
     {disposition === 'accept_with_deviations' && open_.map(c => <label key={c.id}>Why {c.label || c.id} is accepted<textarea style={field} data-deviation={c.id} value={notes[c.id] || ''} onChange={e => setNotes(n => ({ ...n, [c.id]:e.target.value }))} /></label>)}
     <label>Your name<input style={field} value={by} onChange={e => setBy(e.target.value)} /></label>
     <button className="btn btn-primary" disabled={busy || !by.trim()} onClick={decide}>Record decision</button>
     {decided && ['accept', 'accept_with_deviations'].includes(disposition) && !pinned && <button className="btn btn-primary" disabled={busy} onClick={pinVideo}>Pin for video</button>}
     {pinned && <p className="refcmp-pinned">Pinned for video: start frame is this board; trajectory and {pinned.refs.deviations.length} approved deviation(s) travel with it.</p>}
    </div>}
   </>}
  </section>}
 </>;
}
