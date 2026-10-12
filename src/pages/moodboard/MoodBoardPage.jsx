import { useEffect, useRef, useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';
import { projectEpoch } from '../../lib/project-epoch.js';

/*
 * The Mood Board, as React: where a look is decided before anything generates. Its output is the style
 * preset (Apply look); Preview style shows what would be written and writes nothing. Same routes and
 * status lines as the legacy page. The spec vocabularies come from the server, so the board can never
 * offer a lens or a ratio the engine would refuse.
 *
 * Shared upload size checks, plate thumbnail URLs and the plate viewer stay
 * behind `legacy`. Upload completion belongs to the captured project epoch.
 *
 * One change, named in the test: a failed read is reported. The legacy loader had no catch, so a board
 * that could not be read left the page blank with nothing said.
 */
export const MOOD_KINDS = ['palette', 'lighting', 'lens', 'framing', 'texture', 'image'];
const INFLUENCE_ROLES = ['style', 'colors', 'lighting', 'angle', 'framing', 'texture'];

export default function MoodBoardPage() {
    const [entries, setEntries] = useState(null);
    const [specs, setSpecs] = useState({});
    const [draft, setDraft] = useState({ kind: MOOD_KINDS[0], note: '', specKind: '', specValue: '' });
    const [composed, setComposed] = useState(null); // { apply, res }
    const [roles, setRoles] = useState(['style']);
    const [influenceNote, setInfluenceNote] = useState('');
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const mounted = useRef(true), loading = useRef(0), uploadBusy = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; loading.current++; }; }, []);
    const capture = () => ({ pid: legacy.state.currentProject?.id, epoch: projectEpoch() });
    const live = scope => mounted.current && scope.pid === legacy.state.currentProject?.id && scope.epoch === projectEpoch();

    async function loadMoodBoardPage() {
        if (!legacy.state.currentProject) return;
        const scope = capture(), pid = scope.pid, serial = ++loading.current;
        try {
            const board = await legacy.api(`/projects/${pid}/mood-board`);
            const res = await legacy.api(`/projects/${pid}/mood-board/compose`, { method: 'POST', body: JSON.stringify({}) });
            if (!live(scope) || serial !== loading.current) return;
            setSpecs(res.spec_kinds || {});
            setEntries(board.entries || []);
            legacy.setStatus(`${(board.entries || []).length} board entr(ies)`);
        } catch (err) { if (live(scope) && serial === loading.current) legacy.setStatus('Could not read the mood board: ' + err.message); }
    }
    usePageLoader('loadMoodBoardPage', loadMoodBoardPage);

    const allowed = (kind) => (specs[kind] ? specs[kind].allowed : []).map(String);
    function chooseSpec(kind) { setDraft(d => ({ ...d, specKind: kind, specValue: allowed(kind)[0] || '' })); }

    async function moodBoardAdd() {
        const scope = capture();
        if (!scope.pid) return;
        const body = { kind: draft.kind, note: draft.note };
        if (draft.specKind) { body.spec_kind = draft.specKind; body.spec_value = draft.specValue || allowed(draft.specKind)[0]; }
        try {
            await legacy.api(`/projects/${scope.pid}/mood-board`, { method: 'POST', body: JSON.stringify(body) });
            if (!live(scope)) return;
            setDraft(d => ({ ...d, note: '' }));
            loadMoodBoardPage();
        } catch (err) { if (live(scope)) legacy.setStatus('Could not add: ' + err.message); }
    }

    async function moodBoardDelete(id) {
        const scope = capture();
        try { await legacy.api(`/mood-board/${id}`, { method: 'DELETE' }); if (live(scope)) loadMoodBoardPage(); }
        catch (err) { if (live(scope)) legacy.setStatus('Could not remove: ' + err.message); }
    }

    async function moodBoardCompose(apply) {
        const scope = capture();
        if (!scope.pid) return;
        try {
            const res = await legacy.api(`/projects/${scope.pid}/mood-board/compose`,
                { method: 'POST', body: JSON.stringify({ apply: !!apply }) });
            if (!live(scope)) return;
            setComposed({ apply, res });
            legacy.setStatus(apply ? 'Look applied' : 'Look previewed — not applied');
        } catch (err) { if (live(scope)) legacy.setStatus('Could not compose the look: ' + err.message); }
    }

    async function uploadMoodBoardImages(files) {
        const scope = capture();
        if (!scope.pid || !files.length || uploadBusy.current) return;
        const url = `/projects/${scope.pid}/mood-board/import`;
        const extra = { note: draft.note, influence_roles: [...roles], influence_note: influenceNote };
        uploadBusy.current = true; setUploading(true); setError('');
        try {
            for (const file of files) {
                legacy.checkUploadSize(file, url);
                const data = await new Promise((resolve, reject) => {
                    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('That image could not be read.')); reader.readAsDataURL(file);
                });
                if (!live(scope)) return;
                await legacy.api(url, { method: 'POST', body: JSON.stringify({ ...extra, data, name: file.name }) });
                if (!live(scope)) return;
            }
            legacy.setStatus('Moodboard images uploaded. Active images influence future location plates and storyboards.');
        } catch (err) { if (live(scope)) { setError('Not uploaded: ' + err.message); legacy.setStatus('Not uploaded: ' + err.message); } }
        finally { uploadBusy.current = false; if (live(scope)) { setUploading(false); loadMoodBoardPage(); } }
    }
    function uploadMoodBoardImage(event) {
        const files = Array.from(event.target.files || []); event.target.value = '';
        return uploadMoodBoardImages(files);
    }
    async function updateImage(id, body) {
        const scope = capture();
        try { await legacy.api(`/mood-board/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); if (live(scope)) await loadMoodBoardPage(); }
        catch (err) { if (live(scope)) setError(err.message); }
    }
    async function moveImage(id, direction) {
        const scope = capture(), ids = (entries || []).map(e => e.id), index = ids.indexOf(id), next = index + direction;
        if (index < 0 || next < 0 || next >= ids.length) return;
        [ids[index], ids[next]] = [ids[next], ids[index]];
        try { await legacy.api(`/projects/${scope.pid}/mood-board/order`, { method: 'POST', body: JSON.stringify({ ids }) }); if (live(scope)) await loadMoodBoardPage(); }
        catch (err) { if (live(scope)) setError(err.message); }
    }

    const res = composed && composed.res;
    // Search, sort and filter the entries as read (never re-read).
    const controls = useListControls(SURFACE, entries);
    const shown = controls.shown || [];

    return (
        <div className="page" id="page-moodboard">
            <div className="flex-between mb-16">
                <h2>Mood Board</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => moodBoardCompose(false)}>Preview style</button>
                    <button className="btn btn-primary" onClick={() => moodBoardCompose(true)} data-tooltip="Write this look onto the project" data-tooltip-pos="bottom">Apply look</button>
                </div>
            </div>
            <div className="card mb-16" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); uploadMoodBoardImages(Array.from(e.dataTransfer.files || [])); }}>
                <p className="text-sm">Drop film stills, photographs or paintings here. Active images provide visual influence for future location plates and storyboards. Identity, locations and products come from their own subject references.</p>
                <p className="text-sm text-muted">Images use the active selection immediately. Apply look writes the text notes and specs. Image slots are shared with subject references; final review refuses missing images or unsupported conditioning. Edit providers cannot use look images for a new camera view.</p>
                <RoleChoices roles={roles} onChange={setRoles} label="New image" />
                <label>Image influence notes<input aria-label="Image influence notes" maxLength={500} value={influenceNote} onChange={e => setInfluenceNote(e.target.value)} placeholder="Borrow the low angle and amber practical lights" /></label>
                {error && <p role="alert">{error}</p>}
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
                        title="Pin a film still, a photograph or a painting you already have">{uploading ? 'Uploading…' : 'Upload image'}
                        <input type="file" multiple disabled={uploading} data-import-target="mood-board-image" accept="image/png,image/jpeg,.png,.jpg,.jpeg"
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
            {entries && entries.length > 0 && <ListControlsBar list={controls} />}
            <div id="moodEntries" className="entity-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
                {entries && !entries.length && <div className="text-muted" style={{ gridColumn: '1/-1' }}>Nothing on the board yet.</div>}
                {entries && entries.length > 0 && shown.length === 0 && <ListNoMatch list={controls} />}
                {shown.map(e => <MoodEntry key={e.id} e={e} index={entries.indexOf(e)} count={entries.length} onUpdate={body => updateImage(e.id, body)} onMove={direction => moveImage(e.id, direction)} onRemove={() => moodBoardDelete(e.id)} />)}
            </div>
        </div>
    );
}

function RoleChoices({ roles, onChange, label }) {
    return <fieldset><legend>{label} influence roles</legend>{INFLUENCE_ROLES.map(role => <label key={role} style={{ display: 'inline-flex', marginRight: 12, gap: 4 }}>
        <input type="checkbox" aria-label={`${label} ${role}`} checked={roles.includes(role)} onChange={event => onChange(event.target.checked ? [...roles, role] : roles.length > 1 ? roles.filter(r => r !== role) : roles)} />{role}
    </label>)}</fieldset>;
}
function MoodEntry({ e, index, count, onRemove, onUpdate, onMove }) {
    const [broken, setBroken] = useState(false);
    const [roles, setRoles] = useState(e.influence_roles || ['style']), [note, setNote] = useState(e.influence_note || '');
    useEffect(() => { setBroken(false); setRoles(e.influence_roles || ['style']); setNote(e.influence_note || ''); }, [e]);
    return (
        <div className="card" data-entry-id={e.id}>
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
            {(e.image_url || e.image_path || e.asset_id) && <>
                <label><input type="checkbox" aria-label={`Use image ${index + 1} in generation`} checked={e.active !== 0} onChange={event => onUpdate({ active: event.target.checked })} />Use in generation</label>
                <RoleChoices roles={roles} onChange={setRoles} label={`Image ${index + 1}`} />
                <label>Influence notes<textarea aria-label={`Image ${index + 1} influence notes`} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
                <button className="btn btn-sm" onClick={() => onUpdate({ influence_roles: roles, influence_note: note })}>Save image influence</button>
                <button aria-label={`Move image ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
                <button aria-label={`Move image ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
            </>}
        </div>
    );
}
