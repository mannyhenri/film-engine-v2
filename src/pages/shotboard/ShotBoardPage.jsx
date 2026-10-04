import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * The Shot Board, as React: every shot in five status columns. Drag a card to another column to change
 * its status; drop it on another card to move it in the running order. A card opens the shot's drawer
 * (transitions, notes, Regenerate, Run pipeline, A/B compare).
 *
 * Same routes and status lines as the legacy page, with two fixes, each named in the tests:
 *   - every page of the shot list is read. The route answers 50 shots unless asked for more, and the
 *     legacy board never asked: a film past 50 shots lost the rest from the board, and a reorder sent a
 *     partial running order.
 *   - the drawer reads the shot itself (GET /shots/:id). The list carries no camera, lighting, cast or
 *     card, so the legacy drawer showed "-" for all of them and never showed the scene card.
 *
 * Shared with the rest of the app, through `legacy`: regenerateStoryboard (the one paid regenerate, with its
 * confirmation). The drawer keeps id="shotDetailPanel" with its picture inside, because core's frameBusy
 * finds the frame being regenerated there and veils it.
 */
export const COLUMNS = [['pending', 'Pending'], ['generating', 'Generating'], ['complete', 'Complete'], ['failed', 'Failed'], ['approved', 'Approved']];
export const TRANSITIONS = [['cut', 'Cut'], ['dissolve', 'Dissolve'], ['cross-dissolve', 'Cross Dissolve'], ['fade-from-black', 'Fade from Black'],
    ['fade-from-white', 'Fade from White'], ['wipe-left', 'Wipe Left'], ['wipe-right', 'Wipe Right'], ['dip-to-black', 'Dip to Black'], ['dip-to-white', 'Dip to White']];
const PAGE = 200; // the route's own ceiling per page
const drawerStyle = (width) => ({ position: 'fixed', right: 0, top: 0, bottom: 0, width, zIndex: 200, overflowY: 'auto', borderRadius: 0,
    borderLeft: '1px solid var(--gl-border-subtle)', boxShadow: '-4px 0 20px rgba(0,0,0,0.3)' });

/** Every shot, every page: the route answers at most PAGE at a time. */
export async function readAllShots(projectId) {
    const all = [];
    for (let page = 1; ; page++) {
        const r = await legacy.api(`/projects/${projectId}/shotlist?limit=${PAGE}&page=${page}`);
        const rows = r.shots || [];
        all.push(...rows);
        if (!rows.length || all.length >= (r.total || 0)) return all;
    }
}

/** The camera, lighting and cast a card states, as the drawer shows them. */
export function cardFacts(card) {
    const c = (card && card.camera) || {};
    const l = card && card.lighting;
    return {
        camera: [c.shot_type, c.lens, c.movement && c.movement !== 'static' ? c.movement : null].filter(Boolean).join(' · ') || '-',
        lighting: (l && typeof l === 'object' ? [l.type, l.technique].filter(Boolean).join(' · ') : l) || '-',
        characters: (Array.isArray(card && card.characters) ? card.characters.join(', ') : (card && card.characters)) || '-',
    };
}

const shotImg = (projectId, code) => `${legacy.API_BASE}/film/storyboards/${projectId}/${encodeURIComponent(code)}.png?w=480`;

export default function ShotBoardPage() {
    const [shots, setShots] = useState(null);
    const [runtime, setRuntime] = useState(null);
    const [detailId, setDetailId] = useState(null);
    const [compareId, setCompareId] = useState(null);
    const drag = useRef(null);
    const [dropCol, setDropCol] = useState(null);
    const [dragging, setDragging] = useState(null);

    async function loadShotboardRuntime(pid) {
        try {
            const v = await legacy.api(`/projects/${pid}/deliverables/check`);
            setRuntime(v.target_duration_ms ? v : null); // a film has no target, and this stays empty
        } catch { setRuntime(null); }
    }

    async function loadShotBoard() {
        if (!legacy.state.currentProject) return;
        const pid = legacy.state.currentProject.id;
        legacy.setStatus('Loading shots...');
        loadShotboardRuntime(pid);
        try {
            const all = await readAllShots(pid);
            legacy.state.shots = all; // other pages read it
            setShots(all);
            legacy.setStatus(all.length + ' shot(s)');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadShotBoard', loadShotBoard);

    async function moveToColumn(status) {
        setDropCol(null);
        const id = drag.current;
        const shot = (shots || []).find(s => s.id === id);
        if (!shot || shot.status === status) return; // a fumbled drag costs nothing
        try {
            await legacy.api('/shots/' + id, { method: 'PUT', body: JSON.stringify({ status }) });
            legacy.setStatus(`${shot.shot_code || 'Shot'} → ${status}`);
            loadShotBoard();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function reorderOnto(targetId) {
        const id = drag.current;
        if (!id || id === targetId || !legacy.state.currentProject) return;
        const ids = (shots || []).map(s => s.id);
        const from = ids.indexOf(id), to = ids.indexOf(targetId);
        if (from < 0 || to < 0) return;
        ids.splice(from, 1);
        ids.splice(to, 0, id);
        try {
            await legacy.api('/projects/' + legacy.state.currentProject.id + '/shots/reorder', { method: 'POST', body: JSON.stringify({ shot_ids: ids }) });
            legacy.setStatus('Shots reordered');
            loadShotBoard();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    // Search, sort and filter the shots that were read (never re-read); each column shows its shown shots.
    const controls = useListControls(SURFACE, shots);
    const shown = controls.shown;
    const pid = shots && legacy.state.currentProject ? legacy.state.currentProject.id : '';
    const delta = runtime ? (runtime.cut_duration_ms - runtime.target_duration_ms) / 1000 : 0;
    return (
        <div className="page" id="page-shotboard">
            <div className="page-header flex-between">
                <h2>Shot Board</h2>
                {/* The running total against the bought runtime: this is where an overlong spot gets fixed. */}
                <div id="shotboardRuntime" className="text-sm">
                    {runtime && <>
                        <span style={{ color: runtime.on_target ? 'var(--gl-success)' : 'var(--gl-warning,#f59e0b)', fontWeight: 600 }}>
                            {(runtime.cut_duration_ms / 1000).toFixed(1)}s / {(runtime.target_duration_ms / 1000).toFixed(1)}s</span>
                        {!runtime.on_target && <span className="text-sm text-muted"> &middot; {delta > 0 ? 'over' : 'under'} by {Math.abs(delta).toFixed(1)}s</span>}
                    </>}
                </div>
            </div>
            <ListControlsBar list={controls} />
            {shots && shots.length > 0 && shown.length === 0 && <ListNoMatch list={controls} />}
            <div className="kanban-board" id="kanbanBoard">
                {shots && COLUMNS.map(([status, label]) => {
                    // A status the five do not name (none today) files under Pending, as the legacy board did.
                    const inCol = shown.filter(s => (COLUMNS.some(c => c[0] === s.status) ? s.status : 'pending') === status);
                    return (
                        <div key={status} className={'kanban-column' + (dropCol === status ? ' drop-target' : '')} data-status={status}
                            onDragOver={(e) => { e.preventDefault(); setDropCol(status); }}
                            onDragLeave={() => setDropCol(null)}
                            onDrop={(e) => { e.preventDefault(); moveToColumn(status); }}>
                            <div className="kanban-column-header"><span>{label}</span><span className="count">{inCol.length}</span></div>
                            {!inCol.length && <p className="text-sm text-muted" style={{ textAlign: 'center', padding: '20px 0' }}>Empty</p>}
                            {inCol.map(s => (
                                <div key={s.id} className="kanban-card" draggable="true" data-shot={s.id} style={{ cursor: 'pointer', opacity: dragging === s.id ? 0.5 : 1 }}
                                    onDragStart={(e) => { drag.current = s.id; setDragging(s.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
                                    onDragEnd={() => { drag.current = null; setDragging(null); }}
                                    onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
                                    // Reordering inside a column must not also be read as a status move.
                                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); reorderOnto(s.id); }}
                                    onClick={() => { setCompareId(null); setDetailId(s.id); }}>
                                    <HideOnError src={shotImg(pid, s.shot_code)} style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4, marginBottom: 6, display: 'block' }} />
                                    <div className="shot-code">&#9776; Sc{s.scene_number} / {s.shot_code}</div>
                                    <div className="shot-meta">{s.location || ''} {s.duration_ms ? '· ' + (s.duration_ms / 1000).toFixed(1) + 's' : ''}{s.transition_in_type && s.transition_in_type !== 'cut' ? ' · ' + s.transition_in_type : ''}</div>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
            {detailId && (shots || []).some(s => s.id === detailId) && createPortal(
                <ShotDrawer key={detailId} shot={shots.find(s => s.id === detailId)} projectId={pid}
                    onClose={() => setDetailId(null)} onCompare={() => openCompare(detailId)}
                    onTransitionSaved={(data) => setShots(list => list.map(s => (s.id === detailId ? { ...s, ...data } : s)))} />, document.body)}
            {compareId && createPortal(<ABCompare shotId={compareId} onClose={() => setCompareId(null)} />, document.body)}
        </div>
    );

    async function openCompare(shotId) {
        try {
            const data = await legacy.api('/shots/' + shotId + '/versions');
            if ((data.versions || []).length < 2) { legacy.setStatus('Need at least 2 versions to compare'); return; }
            setDetailId(null);
            setCompareId(shotId);
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
}

function HideOnError({ src, style }) {
    const [gone, setGone] = useState(false);
    return gone ? null : <img src={src} alt="" style={style} onError={() => setGone(true)} />;
}

function ShotDrawer({ shot, projectId, onClose, onCompare, onTransitionSaved }) {
    const [detail, setDetail] = useState(null); // GET /shots/:id
    const [notes, setNotes] = useState(null);
    const [noteText, setNoteText] = useState('');
    const [noImage, setNoImage] = useState(false);
    const [tr, setTr] = useState({ transition_in_type: shot.transition_in_type || 'cut', transition_in_duration_ms: shot.transition_in_duration_ms || 0,
        transition_out_type: shot.transition_out_type || 'cut', transition_out_duration_ms: shot.transition_out_duration_ms || 0 });
    useEffect(() => {
        legacy.api('/shots/' + shot.id).then(setDetail, () => setDetail({ card: {} }));
        loadNotes();
    }, [shot.id]);

    async function loadNotes() {
        try { const d = await legacy.api('/shots/' + shot.id + '/notes'); setNotes(d.notes || []); } catch { setNotes([]); }
    }
    async function addNote() {
        const content = noteText.trim();
        if (!content) return;
        try {
            await legacy.api('/shots/' + shot.id + '/notes', { method: 'POST', body: JSON.stringify({ content, note_type: 'direction' }) });
            setNoteText('');
            loadNotes();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    async function saveTransition(next) {
        setTr(next);
        const data = { transition_in_type: next.transition_in_type || 'cut', transition_in_duration_ms: parseInt(next.transition_in_duration_ms) || 0,
            transition_out_type: next.transition_out_type || 'cut', transition_out_duration_ms: parseInt(next.transition_out_duration_ms) || 0 };
        try {
            await legacy.api('/shots/' + shot.id + '/transition', { method: 'PUT', body: JSON.stringify(data) });
            legacy.setStatus('Transition saved');
            onTransitionSaved(data);
        } catch (err) { legacy.setStatus('Error saving transition: ' + err.message); }
    }
    async function runShotPipeline() {
        legacy.setStatus('Starting pipeline for shot...');
        try {
            await legacy.api('/shots/' + shot.id + '/render', { method: 'POST', body: JSON.stringify({ step: 'keyframe' }) });
            legacy.setStatus('Pipeline run started');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    const facts = detail ? cardFacts(detail.card) : { camera: '…', lighting: '…', characters: '…' };
    const hasCard = detail && detail.card && Object.keys(detail.card).length > 0;
    // Each control names the field it sets (data-field), written out per row rather than built, so a reader
    // of the source (manual-edit) can find the control for transition_in_type and transition_out_type.
    const options = TRANSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>);
    const pick = (key) => (e) => saveTransition({ ...tr, [key]: e.target.value });
    const type = (key) => (e) => setTr({ ...tr, [key]: e.target.value });
    return (
        <div id="shotDetailPanel" className="card" style={drawerStyle(420)}>
            <div className="flex-between mb-16">
                <h2>Sc{shot.scene_number} / {shot.shot_code}</h2>
                <button className="btn btn-secondary btn-sm" onClick={onClose}>&times;</button>
            </div>
            <div style={{ background: 'var(--surface-alt,var(--gl-bg-surface))', borderRadius: 8, minHeight: 140, marginBottom: 12, overflow: 'hidden' }}>
                {noImage
                    ? <p className="text-sm text-muted" style={{ padding: 40, textAlign: 'center' }}>No storyboard</p>
                    : <img src={shotImg(projectId, shot.shot_code)} alt="" style={{ width: '100%', display: 'block' }} onError={() => setNoImage(true)} />}
            </div>
            <div className="mb-8">
                <span className={'badge ' + (shot.status === 'approved' ? 'approved' : '')}>{shot.status}</span>
                {shot.duration_ms ? <span className="tag">{(shot.duration_ms / 1000).toFixed(1)}s</span> : null}
            </div>
            <table style={{ width: '100%', fontSize: 13 }} className="mb-16"><tbody>
                <tr><td className="text-muted" style={{ width: 100 }}>Camera</td><td>{facts.camera}</td></tr>
                <tr><td className="text-muted">Lighting</td><td>{facts.lighting}</td></tr>
                <tr><td className="text-muted">Location</td><td>{shot.location || '-'}</td></tr>
                <tr><td className="text-muted">Characters</td><td>{facts.characters}</td></tr>
            </tbody></table>
            {hasCard && <>
                <h4 className="mb-8">Scene Card</h4>
                <pre style={{ fontSize: 11, maxHeight: 200, overflow: 'auto', background: 'var(--gl-bg-primary)', padding: 8, borderRadius: 4 }}>{JSON.stringify(detail.card, null, 2)}</pre>
            </>}
            <div style={{ marginTop: 12, padding: 10, background: 'var(--gl-bg-header)', borderRadius: 8 }} className="mb-16">
                <h4 className="mb-8" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--gl-text-muted)' }}>Transitions</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, marginBottom: 8 }}>
                    <div><label className="text-sm text-muted">In</label>
                        <select id="shotTransitionIn" data-field="transition_in_type" style={{ fontSize: 12 }} value={tr.transition_in_type} onChange={pick('transition_in_type')}>{options}</select></div>
                    <div><label className="text-sm text-muted">ms</label>
                        <input type="number" id="shotTransitionInMs" data-field="transition_in_duration_ms" min="0" max="5000" step="100" style={{ fontSize: 12 }}
                            value={tr.transition_in_duration_ms} onChange={type('transition_in_duration_ms')} onBlur={() => saveTransition(tr)} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
                    <div><label className="text-sm text-muted">Out</label>
                        <select id="shotTransitionOut" data-field="transition_out_type" style={{ fontSize: 12 }} value={tr.transition_out_type} onChange={pick('transition_out_type')}>{options}</select></div>
                    <div><label className="text-sm text-muted">ms</label>
                        <input type="number" id="shotTransitionOutMs" data-field="transition_out_duration_ms" min="0" max="5000" step="100" style={{ fontSize: 12 }}
                            value={tr.transition_out_duration_ms} onChange={type('transition_out_duration_ms')} onBlur={() => saveTransition(tr)} /></div>
                </div>
            </div>
            <div className="mb-16" style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" onClick={() => legacy.regenerateStoryboard(shot.id)}>Regenerate Storyboard</button>
                <button className="btn btn-secondary btn-sm" onClick={runShotPipeline}>Run Pipeline</button>
                <button className="btn btn-secondary btn-sm" onClick={onCompare} style={{ marginTop: 4 }}>A/B Compare</button>
            </div>
            <div id="shotDetailNotes">
                {notes && <>
                    <h4 className="mb-8">Notes ({notes.length})</h4>
                    {notes.map(n => (
                        <div key={n.id} className="card mb-8" style={{ padding: 8 }}>
                            <span className="badge">{n.note_type}</span>
                            <p className="text-sm">{n.content}</p>
                            <p className="text-sm text-muted">{new Date(n.created_at).toLocaleDateString()}</p>
                        </div>
                    ))}
                    <div style={{ marginTop: 8 }}>
                        <textarea id="shotDetailNoteInput" rows={2} placeholder="Add a note..." style={{ width: '100%', fontSize: 12 }} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                        <button className="btn btn-primary btn-sm" style={{ marginTop: 4 }} onClick={addNote}>Add Note</button>
                    </div>
                </>}
            </div>
        </div>
    );
}

function ABCompare({ shotId, onClose }) {
    const [versions, setVersions] = useState(null);
    const [pick, setPick] = useState({ a: null, b: null });
    const [data, setData] = useState(null);
    const [mix, setMix] = useState(50);
    useEffect(() => {
        legacy.api('/shots/' + shotId + '/versions').then((d) => {
            const v = d.versions || [];
            setVersions(v);
            if (v.length >= 2) load(v[0].version_number, v[1].version_number);
        }, (err) => legacy.setStatus('Error: ' + err.message));
    }, [shotId]);
    async function load(a, b) {
        setPick({ a, b });
        try { setData(await legacy.api(`/shots/${shotId}/versions/compare?a=${a}&b=${b}`)); }
        catch (err) { legacy.setStatus('Error loading comparison: ' + err.message); }
    }
    const opts = (versions || []).map(v => <option key={v.version_number} value={v.version_number}>{v.version_number} ({new Date(v.created_at).toLocaleDateString()})</option>);
    const diff = (data && data.param_diff) || {};
    const side = (v) => (v && v.thumbnail_path
        ? <HideOnErrorOr src={`${legacy.API_BASE}/film/${v.thumbnail_path}`} />
        : <p className="text-sm text-muted" style={{ padding: 30 }}>No image</p>);
    return (
        <div id="abComparePanel" className="card" style={drawerStyle(700)}>
            <div className="flex-between mb-16"><h2>A/B Compare</h2><button className="btn btn-secondary btn-sm" onClick={onClose}>&times;</button></div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <div className="form-group" style={{ flex: 1 }}><label>Version A</label>
                    <select id="abVersionA" value={pick.a ?? ''} onChange={(e) => load(e.target.value, pick.b)}>{opts}</select></div>
                <div className="form-group" style={{ flex: 1 }}><label>Version B</label>
                    <select id="abVersionB" value={pick.b ?? ''} onChange={(e) => load(pick.a, e.target.value)}>{opts}</select></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }} id="abImages">
                <div style={{ flex: 1, textAlign: 'center' }}><div className="text-sm text-muted mb-8">A</div>
                    <div id="abImgA" style={{ background: 'var(--gl-bg-header)', minHeight: 150, borderRadius: 8, overflow: 'hidden', opacity: 1 - mix / 100 }}>{data && side(data.version_a)}</div></div>
                <div style={{ flex: 1, textAlign: 'center' }}><div className="text-sm text-muted mb-8">B</div>
                    <div id="abImgB" style={{ background: 'var(--gl-bg-header)', minHeight: 150, borderRadius: 8, overflow: 'hidden', opacity: mix / 100 }}>{data && side(data.version_b)}</div></div>
            </div>
            <div className="mb-8"><label className="text-sm text-muted">Crossfade</label>
                <input type="range" id="abSlider" min="0" max="100" value={mix} style={{ width: '100%' }} onChange={(e) => setMix(Number(e.target.value))} /></div>
            <div id="abDiffPanel" style={{ marginTop: 16 }}>
                {data && (!Object.keys(diff).length
                    ? <p className="text-sm text-muted">No parameter differences.</p>
                    : <>
                        <h4 className="mb-8" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--gl-text-muted)' }}>Parameter Differences</h4>
                        <table style={{ width: '100%', fontSize: 12 }}><tbody>
                            <tr style={{ color: 'var(--gl-text-muted)' }}><th style={{ textAlign: 'left' }}>Field</th><th>A</th><th>B</th></tr>
                            {Object.keys(diff).map(k => <tr key={k}><td style={{ color: 'var(--gl-brand-pink)' }}>{k}</td><td>{String(diff[k].a ?? '-')}</td><td>{String(diff[k].b ?? '-')}</td></tr>)}
                        </tbody></table>
                    </>)}
            </div>
        </div>
    );
}

function HideOnErrorOr({ src }) {
    const [gone, setGone] = useState(false);
    return gone ? <p className="text-sm text-muted" style={{ padding: 30 }}>No image</p> : <img src={src} alt="" style={{ width: '100%', display: 'block' }} onError={() => setGone(true)} />;
}
