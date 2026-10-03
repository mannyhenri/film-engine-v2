import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * The Mood Board, as React: where a look is decided before anything generates. Its output is the style
 * preset (Apply look); Preview style shows what would be written and writes nothing. Same routes and
 * status lines as the legacy page. The spec vocabularies come from the server, so the board can never
 * offer a lens or a ratio the engine would refuse.
 *
 * Shared with other pages and so reached through `legacy`: the upload helper (size check, the
 * "Uploading…" label, the error left on the control), the plate thumbnail URL, and the plate viewer.
 *
 * One change, named in the test: a failed read is reported. The legacy loader had no catch, so a board
 * that could not be read left the page blank with nothing said.
 */
export const MOOD_KINDS = ['palette', 'lighting', 'lens', 'framing', 'texture', 'image'];

export default function MoodBoardPage() {
    const [entries, setEntries] = useState(null);
    const [specs, setSpecs] = useState({});
    const [draft, setDraft] = useState({ kind: MOOD_KINDS[0], note: '', specKind: '', specValue: '' });
    const [composed, setComposed] = useState(null); // { apply, res }

    async function loadMoodBoardPage() {
        if (!legacy.state.currentProject) return;
        const pid = legacy.state.currentProject.id;
        try {
            const board = await legacy.api(`/projects/${pid}/mood-board`);
            const res = await legacy.api(`/projects/${pid}/mood-board/compose`, { method: 'POST', body: JSON.stringify({}) });
            setSpecs(res.spec_kinds || {});
            setEntries(board.entries || []);
            legacy.setStatus(`${(board.entries || []).length} board entr(ies)`);
        } catch (err) { legacy.setStatus('Could not read the mood board: ' + err.message); }
    }
    usePageLoader('loadMoodBoardPage', loadMoodBoardPage);

    const allowed = (kind) => (specs[kind] ? specs[kind].allowed : []).map(String);
    function chooseSpec(kind) { setDraft(d => ({ ...d, specKind: kind, specValue: allowed(kind)[0] || '' })); }

    async function moodBoardAdd() {
        const body = { kind: draft.kind, note: draft.note };
        if (draft.specKind) { body.spec_kind = draft.specKind; body.spec_value = draft.specValue || allowed(draft.specKind)[0]; }
        try {
            await legacy.api(`/projects/${legacy.state.currentProject.id}/mood-board`, { method: 'POST', body: JSON.stringify(body) });
            setDraft(d => ({ ...d, note: '' }));
            loadMoodBoardPage();
        } catch (err) { legacy.setStatus('Could not add: ' + err.message); }
    }

    async function moodBoardDelete(id) {
        try { await legacy.api(`/mood-board/${id}`, { method: 'DELETE' }); loadMoodBoardPage(); }
        catch (err) { legacy.setStatus('Could not remove: ' + err.message); }
    }

    async function moodBoardCompose(apply) {
        try {
            const res = await legacy.api(`/projects/${legacy.state.currentProject.id}/mood-board/compose`,
                { method: 'POST', body: JSON.stringify({ apply: !!apply }) });
            setComposed({ apply, res });
            legacy.setStatus(apply ? 'Look applied' : 'Look previewed — not applied');
        } catch (err) { legacy.setStatus('Could not compose the look: ' + err.message); }
    }

    function uploadMoodBoardImage(event) {
        if (!legacy.state.currentProject) return;
        return legacy.uploadReferenceImage(event, 'mood-board-image', `/projects/${legacy.state.currentProject.id}/mood-board/import`,
            draft.note ? { note: draft.note } : {}, 'loadMoodBoardPage');
    }

    const res = composed && composed.res;
    return (
        <div className="page" id="page-moodboard">
            <div className="flex-between mb-16">
                <h2>Mood Board</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => moodBoardCompose(false)}>Preview style</button>
                    <button className="btn btn-primary" onClick={() => moodBoardCompose(true)} data-tooltip="Write this look onto the project" data-tooltip-pos="bottom">Apply look</button>
                </div>
            </div>
            <div className="card mb-16">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
                        <label>Facet</label>
                        <select id="moodKind" value={draft.kind} onChange={(e) => { const v = e.target.value; setDraft(d => ({ ...d, kind: v })); }}>
                            {MOOD_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0, flex: '1 1 260px' }}>
                        <label>Note</label>
                        <input type="text" id="moodNote" placeholder="teal shadows, amber sodium practicals" value={draft.note}
                            onChange={(e) => { const v = e.target.value; setDraft(d => ({ ...d, note: v })); }} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0, minWidth: 150 }}>
                        <label>Spec</label>
                        <select id="moodSpecKind" value={draft.specKind} onChange={(e) => chooseSpec(e.target.value)}>
                            <option value="">&mdash;</option>
                            {Object.entries(specs).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0, minWidth: 130 }}>
                        <label>Value</label>
                        <select id="moodSpecValue" value={draft.specValue} onChange={(e) => { const v = e.target.value; setDraft(d => ({ ...d, specValue: v })); }}>
                            {allowed(draft.specKind).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </div>
                    <button className="btn btn-secondary" onClick={moodBoardAdd} style={{ height: 36 }}>Add</button>
                    {/* The pictures a director brings to a look meeting are almost never ones this tool made. */}
                    <label className="btn btn-secondary" style={{ height: 36, lineHeight: '22px', cursor: 'pointer', margin: 0 }}
                        title="Pin a film still, a photograph or a painting you already have">Upload image
                        <input type="file" data-import-target="mood-board-image" accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                            style={{ display: 'none' }} onChange={uploadMoodBoardImage} />
                    </label>
                </div>
            </div>
            <div id="moodComposed" className="card mb-16" style={composed ? undefined : { display: 'none' }}>
                {res && <>
                    <strong>{composed.apply ? 'Applied' : 'Would apply'}</strong>
                    <p className="text-sm" style={{ marginTop: 6 }}>{res.style_preset || res.message || ''}</p>
                    {(res.warnings || []).map((w, i) => <p key={i} className="text-sm" style={{ color: 'var(--gl-warning,#f59e0b)', marginTop: 6 }}>{w.detail}</p>)}
                    {res.effective_style && res.effective_style !== res.style_preset &&
                        <p className="text-sm" style={{ marginTop: 8 }}><strong>What actually reaches a prompt:</strong><br />{res.effective_style}</p>}
                    {(res.applied_specs || []).length > 0 &&
                        <p className="text-sm text-muted" style={{ marginTop: 6 }}>Settings written: {res.applied_specs.map(s => s.kind).join(', ')}</p>}
                </>}
            </div>
            <div id="moodEntries" className="entity-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
                {entries && !entries.length && <div className="text-muted" style={{ gridColumn: '1/-1' }}>Nothing on the board yet.</div>}
                {(entries || []).map(e => <MoodEntry key={e.id} e={e} onRemove={() => moodBoardDelete(e.id)} />)}
            </div>
        </div>
    );
}

function MoodEntry({ e, onRemove }) {
    const [broken, setBroken] = useState(false);
    return (
        <div className="card">
            <div className="flex-between"><strong>{e.spec_kind || e.kind}</strong>
                <button className="btn btn-sm" onClick={onRemove}>Remove</button></div>
            {e.image_url && !broken && (
                <img src={legacy.plateSrc(e.image_url, 480)} style={{ width: '100%', marginTop: 6, borderRadius: 4 }} alt={e.note || 'Board reference'}
                    onClick={() => legacy.openPlateViewer(legacy.API_BASE + e.image_url, e.note || 'Board reference')}
                    onError={() => setBroken(true)} />
            )}
            {e.image_url && broken && <div className="text-sm text-muted">This reference could not be loaded — the file may have been moved or deleted.</div>}
            {!e.image_url && e.image_path && <div className="text-sm text-muted" style={{ marginTop: 6 }}>This reference has no servable location.</div>}
            <p className="text-sm" style={{ marginTop: 6 }}>{e.spec_value || e.note || ''}</p>
        </div>
    );
}
