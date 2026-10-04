import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import * as E from './engine.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * Scenes, as React. Same routes, confirmations and status lines as the legacy page. What stays in core,
 * because other pages share it, is reached through `legacy`: the screenplay-drift report (DRIFT, filled by
 * loadScreenplayDrift), the scene-dialogue generation (one confirmation, then shot by shot), and the
 * status icons in the screenplay editor. `state.scenes` is still written: 24 places in core read it.
 *
 * Selection is React state now. The legacy page read it back out of the checkboxes, so a list rebuilt by
 * any refresh silently dropped it; here a refresh keeps the scenes that still exist selected.
 */
export function parseJsonArray(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
    return [];
}
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
const shotWarning = (n) => n > 0 ? '\n\nThis also deletes ' + plural(n, 'shot') + ' and their notes, versions and render history.' : '';
// Writing readiness (GRD-4671): the three statuses lib/scene-writing.js declares. Separate from the production
// status badge: a scene can be production-approved while its writing is still Draft.
const WRITING = [['draft', 'Draft'], ['reviewing', 'Reviewing'], ['production_ready', 'Production ready']];
const writingLabel = (v) => (WRITING.find(([id]) => id === v) || [v, v || ''])[1];
const warn = { background: 'rgba(245,158,11,.16)', color: 'var(--gl-warning,#f59e0b)', border: '1px solid var(--gl-warning,#f59e0b)' };

export default function ScenesPage() {
    const [scenes, setScenes] = useState(null);
    const [drift, setDrift] = useState([]);
    const [selected, setSelected] = useState(() => new Set());
    const [open, setOpen] = useState({}); // scene id -> null (loading) | shots[] | 'error'
    const [history, setHistory] = useState({}); // scene id -> writing transition events

    async function loadScenes() {
        if (!legacy.state.currentProject) return;
        legacy.setStatus('Loading scenes...');
        try {
            const data = await legacy.api('/projects/' + legacy.state.currentProject.id + '/scenes');
            const list = data.scenes || [];
            legacy.state.scenes = list;
            // A scene's status is a workflow state a person advanced; it does not revert when the
            // screenplay changes. The drift is shown BESIDE it, so the two together say the true thing.
            await legacy.loadScreenplayDrift();
            setDrift(legacy.DRIFT.scenes || []);
            setScenes(list);
            setSelected(s => new Set([...s].filter(id => list.some(sc => sc.id === id))));
            setOpen({});
            legacy.setStatus(list.length + ' scene(s)');
            legacy.updateSceneStatusIcons();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadScenes', loadScenes);

    async function toggleScene(id) {
        if (id in open) { setOpen(o => { const n = { ...o }; delete n[id]; return n; }); return; }
        setOpen(o => ({ ...o, [id]: null }));
        legacy.api('/scenes/' + id + '/writing-status')
            .then(r => setHistory(h => ({ ...h, [id]: r.history || [] })), () => setHistory(h => ({ ...h, [id]: [] })));
        try {
            const data = await legacy.api('/scenes/' + id);
            setOpen(o => (id in o ? { ...o, [id]: data.shots || [] } : o));
        } catch { setOpen(o => (id in o ? { ...o, [id]: 'error' } : o)); }
    }

    // An explicit, person-made change. It names the text it was read with; if the scene moved on, the server
    // refuses and nothing changes here until the reload shows the current text.
    async function setWriting(s, status) {
        try {
            await legacy.api('/scenes/' + s.id + '/writing-status', { method: 'POST',
                body: JSON.stringify({ project_id: legacy.state.currentProject.id, status, expected_fingerprint: s.writing_fingerprint }) });
            legacy.setStatus('Scene ' + s.scene_number + ' writing: ' + writingLabel(status));
            loadScenes();
        } catch (err) { legacy.setStatus('Could not change writing status: ' + err.message); }
    }

    const toggleSelect = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

    async function deleteScene(s) {
        const label = String(s.location || 'this scene');
        if (!window.confirm('Delete scene "' + label + '"?' + shotWarning(s.shot_count || 0) + '\n\nThis cannot be undone.')) return;
        try {
            const res = await legacy.api('/scenes/' + s.id, { method: 'DELETE' });
            legacy.setStatus('Deleted scene' + (res.shots ? ' and ' + res.shots + ' shot(s)' : ''));
            loadScenes();
        } catch (err) { legacy.setStatus('Could not delete scene: ' + err.message); }
    }

    async function deleteSelectedScenes() {
        const ids = [...selected];
        if (!ids.length) return;
        // The shots up front, so the confirm states the real cost rather than a scene count.
        const shots = (scenes || []).filter(sc => selected.has(sc.id)).reduce((n, sc) => n + (sc.shot_count || 0), 0);
        if (!window.confirm('Delete ' + plural(ids.length, 'scene') + '?' + shotWarning(shots) + '\n\nThis cannot be undone.')) return;
        try {
            const res = await legacy.api('/projects/' + legacy.state.currentProject.id + '/scenes/delete', { method: 'POST', body: JSON.stringify({ scene_ids: ids }) });
            legacy.setStatus('Deleted ' + res.deleted + ' scene(s)' + (res.shots_deleted ? ' and ' + res.shots_deleted + ' shot(s)' : ''));
            setSelected(new Set());
            loadScenes();
        } catch (err) { legacy.setStatus('Could not delete scenes: ' + err.message); }
    }

    async function breakdown(body, start, done) {
        legacy.setStatus(start);
        try {
            const result = await legacy.api('/projects/' + legacy.state.currentProject.id + '/breakdown', { method: 'POST', body: JSON.stringify(body) });
            if (result.parse_error) return legacy.setStatus('Breakdown failed: ' + result.parse_error);
            legacy.setStatus(done(result));
            loadScenes();
            if (typeof window.renderScreenplayEditor === 'function') window.renderScreenplayEditor();
        } catch (err) { legacy.setStatus('Breakdown error: ' + err.message); }
    }
    const breakdownScene = (id) => breakdown({ scene_id: id, auto_save: true }, 'Breaking down scene...',
        (r) => `Scene broken down: ${r.card_count || (r.saved && r.saved[0]?.saved) || 0} shot(s) created`);
    function breakdownAllScenes() {
        const written = (scenes || []).filter(s => s.status === 'written');
        if (!written.length) return legacy.setStatus('No scenes to break down');
        if (!window.confirm(`Break down ${written.length} scene(s) into shots?\n\nThis will generate shot cards for all scenes in "written" status.`)) return;
        return breakdown({ all_scenes: true, auto_save: true }, `Breaking down ${written.length} scene(s)...`,
            (r) => `Breakdown complete: ${r.total_cards || (r.saved?.reduce((n, s) => n + (s.saved || 0), 0)) || 0} shot(s) created`);
    }

    const list = scenes || [];
    // Search, sort and filter what was read (never re-read).
    const controls = useListControls(SURFACE, scenes);
    const shownScenes = controls.shown || [];
    const written = list.filter(s => s.status === 'written').length;
    const writingCounts = WRITING.map(([id, label]) => [label, list.filter(s => s.writing_status === id).length]);
    const driftShots = drift.reduce((n, s) => n + s.shots_behind.length, 0);
    const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

    return (
        <div className="page" id="page-scenes">
            <div className="page-header">
                <h2>Scenes</h2>
                <button className="btn btn-primary" onClick={breakdownAllScenes} id="breakdownAllBtn" style={{ display: written ? 'inline-flex' : 'none' }}>
                    {written ? `⚙ Break Down ${written} Scene${written > 1 ? 's' : ''}` : '⚙ Break Down All New Scenes'}
                </button>
            </div>
            {/* Appears only with a selection, so the destructive control is not on screen in normal use. */}
            <div id="sceneBulkBar" className={'scene-bulk-bar' + (selected.size ? '' : ' hidden')}>
                <span id="sceneBulkCount">{selected.size} selected</span>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set(shownScenes.map(s => s.id)))} title="The scenes shown: a search or filter never selects what it hides">Select all</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
                <button className="btn btn-danger btn-sm" onClick={deleteSelectedScenes}>Delete selected</button>
            </div>
            {list.length > 0 && <p className="text-sm text-muted" id="sceneWritingCounts">Writing: {writingCounts.map(([label, n]) => `${label} ${n}`).join(' · ')}</p>}
            <ListControlsBar list={controls} />
            <div id="scenesList">
                {list.length > 0 && !shownScenes.length && <ListNoMatch list={controls} />}
                {scenes && !list.length && <div className="empty-state"><div className="icon">&#127916;</div><h3>No scenes yet</h3><p>Upload a screenplay to auto-extract scenes.</p></div>}
                {list.length > 0 && drift.length > 0 && (
                    <div className="card" id="sceneDriftBanner" style={{ borderColor: 'var(--gl-warning,#f59e0b)', background: 'rgba(245,158,11,.07)', padding: '12px 14px', marginBottom: 12 }}>
                        <strong style={{ color: 'var(--gl-warning,#f59e0b)' }}>The screenplay changed after these shots were written</strong>
                        <p className="text-sm" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
                            {drift.map(s => `scene ${s.scene_number}`).join(', ')} &mdash; {driftShots} shot card{driftShots === 1 ? '' : 's'} still describe the previous draft.
                            A scene's status is what someone set when they finished it; it does not revert on its own.
                        </p>
                        <p className="text-sm" style={{ margin: '8px 0 0', lineHeight: 1.55 }}>
                            <strong>Editing the cards is the safe fix</strong> &mdash; open each shot on the Storyboard and
                            change what no longer matches. Breaking the scene down again is <em>not</em> destructive and also
                            does nothing: it skips any scene that already has shots. To replace them you must delete the
                            shots first, and that is the step that loses their generated frames.
                        </p>
                    </div>
                )}
                {shownScenes.map(s => {
                    const behind = drift.find(d => String(d.scene_number) === String(s.scene_number));
                    const lines = s.dialogue_lines || 0;
                    const shots = open[s.id];
                    return (
                        <div key={s.id} className={'scene-row' + (s.id in open ? ' expanded' : '')} id={'scene-' + s.id}>
                            <div className="scene-row-header" onClick={() => toggleScene(s.id)}>
                                <input type="checkbox" className="scene-select" value={s.id} checked={selected.has(s.id)}
                                    onClick={(e) => e.stopPropagation()} onChange={() => toggleSelect(s.id)} title="Select for bulk delete" />
                                <div className="scene-number">{s.scene_number}</div>
                                <div className="scene-info">
                                    <h4>{s.int_ext || ''} {s.location || ''} {s.time_of_day ? '- ' + s.time_of_day : ''}</h4>
                                    <p>{parseJsonArray(s.characters_present).join(', ') || 'No characters'} &middot; {s.shot_count || 0} shot(s)</p>
                                </div>
                                {lines
                                    ? <button className="btn btn-sm" onClick={stop(() => E.generateSceneDialogue(s.id, lines))}
                                        title="Generate the dialogue for this scene's shots, then hear it in Playback. Spends one generation per line; lines already spoken are reused.">&#127908; Dialogue &middot; {lines}</button>
                                    : <button className="btn btn-sm" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }} title="This scene has no dialogue">&#127908; Dialogue &middot; 0</button>}
                                {s.status === 'written' && <button className="btn btn-sm" onClick={stop(() => breakdownScene(s.id))} title="Generate shots for this scene">&#9881; Break Down</button>}
                                {behind && <span className="badge" style={warn} title={`${behind.shots_behind.length} shot card(s) here were written from an earlier draft of this scene`}>script changed</span>}
                                {s.writing_status && <>
                                    <span className="badge scene-writing-badge" title="Writing readiness: whether this scene's text is done">Writing: {writingLabel(s.writing_status)}</span>
                                    <select className="scene-writing-select" aria-label="Writing status" value={s.writing_status}
                                        onClick={(e) => e.stopPropagation()} onChange={(e) => setWriting(s, e.target.value)}
                                        title={s.writing_ambiguous ? 'Another scene has identical text, so this one cannot be marked ready' : 'Set when the writing is reviewed; any accepted text change returns it to Draft'}>
                                        {WRITING.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                                    </select>
                                </>}
                                <span className={'badge ' + (s.status || '')} title="Production status: how far the scene is through production">{(s.status || '').replace(/_/g, ' ')}</span>
                                <button className="btn btn-sm scene-delete-btn" onClick={stop(() => deleteScene(s))} title="Delete this scene">&times;</button>
                                <span className="scene-expand">&#9654;</span>
                            </div>
                            <div className="scene-shots" id={'scene-shots-' + s.id}>
                                {shots === null && <div className="loading-spinner"></div>}
                                {shots === 'error' && <p className="text-sm" style={{ color: 'var(--gl-error)' }}>Failed to load shots.</p>}
                                {Array.isArray(shots) && !shots.length && <p className="text-sm text-muted" style={{ padding: 8 }}>No shots in this scene.</p>}
                                {Array.isArray(history[s.id]) && history[s.id].length > 0 && (
                                    <ul className="scene-writing-history text-sm" style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
                                        {history[s.id].map((ev, i) => (
                                            <li key={i}>{writingLabel(ev.prior_status)} → {writingLabel(ev.new_status)} · {ev.kind === 'auto_reset' ? 'automatic (text changed)' : ev.actor}
                                                {ev.fingerprint ? ' · text ' + String(ev.fingerprint).slice(0, 8) : ''} · {ev.created_at}{ev.reason ? ' · ' + ev.reason : ''}</li>
                                        ))}
                                    </ul>
                                )}
                                {Array.isArray(shots) && shots.map(sh => (
                                    <div key={sh.id || sh.shot_code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12 }}>
                                        <span style={{ background: 'rgba(233,30,99,0.12)', color: 'var(--gl-brand-pink)', padding: '2px 6px', borderRadius: 4, fontWeight: 600, fontSize: 11 }}>{sh.shot_code}</span>
                                        <span className={'badge ' + sh.status}>{sh.status}</span>
                                        <span className="text-muted">{sh.duration_ms ? (sh.duration_ms / 1000).toFixed(1) + 's' : ''}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
