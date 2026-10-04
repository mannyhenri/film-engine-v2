import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * Deliverables, as React: one row per file that leaves the job. Replaces the
 * legacy functions listed in react.json, with the same routes, bodies, markup
 * and status lines. The profiles, packages and vocabularies are SERVED with the
 * list (the route validates against them), never typed here.
 */
const CAPTIONS = ['none', 'sidecar', 'burned'];
const STATUSES = ['planned', 'ready', 'delivered', 'dropped'];
const blank = (d = {}) => ({
    delKey: d.key || '', delLabel: d.label || '', delProfile: d.profile_id || '', delAspect: d.aspect_ratio || '16:9',
    delWidth: String(d.width || 1920), delHeight: String(d.height || 1080), delFps: String(d.fps || 29.97),
    delDuration: ((d.duration_ms || 30000) / 1000).toFixed(1), delPlatform: d.platform || '', delLoudness: d.loudness_target || '',
    delCaption: d.caption_mode || 'sidecar', delStatus: d.status || 'planned', delNative: !!d.native,
    delOrder: String(d.sort_order || 0), delNotes: d.notes || '',
});
const WARN = 'var(--gl-warning,#f59e0b)';

function Verdict({ v }) {
    if (!v) return null;
    const cut = (v.cut_duration_ms / 1000).toFixed(1);
    const parts = [];
    if (v.target_duration_ms) {
        const target = (v.target_duration_ms / 1000).toFixed(1);
        parts.push(<span key="t" style={{ color: v.on_target ? 'var(--gl-success)' : WARN, fontWeight: 600 }}>{cut}s / {target}s</span>);
    } else if (v.cut_duration_ms) {
        parts.push(<span key="t" className="text-sm text-muted">cut runs {cut}s &mdash; no target set</span>);
    }
    if (v.native_ratios && v.native_ratios.length) parts.push(<span key="n" className="tag">shoot native: {v.native_ratios.join(', ')}</span>);
    if (v.needs_native_shots) parts.push(
        <span key="w" className="text-sm" style={{ color: WARN }}>No shot is flagged to be shot at a vertical ratio, so every vertical placement
            will be a crop of the master &mdash; losing two-thirds of the width.</span>);
    if (!parts.length) return null;
    return <div className="tag-row">{parts.flatMap((p, i) => i ? [' ', p] : [p])}</div>;
}

export default function DeliverablesPage() {
    // null: not loaded; { error }; or the served vocabularies and rows.
    const [data, setData] = useState(null);
    const [verdict, setVerdict] = useState(null);
    const [pkg, setPkg] = useState('');
    const [editing, setEditing] = useState({ id: null, form: blank() });

    async function loadDeliverableVerdict(pid) {
        try { setVerdict(await legacy.api(`/projects/${pid}/deliverables/check`)); }
        catch { setVerdict(null); }
    }

    async function loadDeliverables() {
        if (!legacy.state.currentProject) return;
        const pid = legacy.state.currentProject.id;
        let res;
        try { res = await legacy.api(`/projects/${pid}/deliverables`); }
        catch (err) { setData({ error: err.message }); return; }
        const packages = res.packages || [];
        legacy.state.deliverableRows = res.deliverables || [];
        // The board and playback pickers offer what this job ships.
        try { legacy.refreshProtectOptions(); } catch { /* pickers may not be on screen */ }
        setData({ profiles: res.profiles || [], packages, rows: legacy.state.deliverableRows });
        setPkg(p => (packages.includes(p) ? p : packages[0] || ''));
        loadDeliverableVerdict(pid);
    }
    usePageLoader('loadDeliverables', loadDeliverables);

    async function applyDeliverablePackage() {
        if (!pkg) return;
        const existing = (legacy.state.deliverableRows || []).length;
        if (existing && !window.confirm(`Apply the ${pkg} package?\n\nThis REPLACES the ${existing} deliverable(s) `
            + 'already here. A package is a statement about the whole job rather than an addition to it, '
            + 'so applying one twice should not leave you with twelve rows.')) return;
        try {
            const out = await legacy.api(`/projects/${legacy.state.currentProject.id}/deliverables/plan`, { method: 'POST', body: JSON.stringify({ package: pkg }) });
            legacy.setStatus(`${out.created} deliverable(s) planned`);
            loadDeliverables();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    function openDeliverable(id) {
        const d = id ? (legacy.state.deliverableRows || []).find(x => x.id === id) || {} : {};
        setEditing({ id: id || null, form: blank(d) });
        openModal('deliverableModal');
    }

    async function saveDeliverable() {
        const { id, form: f } = editing;
        // As the legacy form, which read each field directly: values as typed, numbers via Number() || 0.
        const body = {
            key: f.delKey, label: f.delLabel, profile_id: f.delProfile,
            aspect_ratio: f.delAspect, width: Number(f.delWidth) || 0,
            height: Number(f.delHeight) || 0, fps: Number(f.delFps) || 0,
            duration_ms: Math.round((Number(f.delDuration) || 0) * 1000),
            platform: f.delPlatform, loudness_target: f.delLoudness,
            caption_mode: f.delCaption, status: f.delStatus,
            native: !!f.delNative,
            sort_order: Number(f.delOrder) || 0,
            notes: f.delNotes,
        };
        if (!body.key) return legacy.setStatus('A deliverable needs a key — it is the sequence name');
        try {
            await legacy.api(id ? `/deliverables/${id}` : `/projects/${legacy.state.currentProject.id}/deliverables`,
                { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
            closeModal('deliverableModal');
            legacy.setStatus(id ? 'Deliverable updated' : 'Deliverable added');
            loadDeliverables();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function deleteDeliverable(id) {
        if (!window.confirm('Remove this deliverable?\n\nNothing generated is affected — this is the list of '
            + 'files that leave the job.')) return;
        try { await legacy.api(`/deliverables/${id}`, { method: 'DELETE' }); loadDeliverables(); legacy.setStatus('Deliverable removed'); }
        catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    const f = editing.form;
    const set = (k) => (e) => setEditing(ed => ({ ...ed, form: { ...ed.form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } }));
    const profiles = data?.profiles || [];
    const platforms = [...new Set(profiles.map(p => p.platform))].filter(Boolean);
    const rows = data?.rows;
    // Search, sort and filter what was read (never re-read).
    const controls = useListControls(SURFACE, rows || null);
    const shown = controls.shown || [];

    return (
        <div className="page" id="page-deliverables">
            <div className="flex-between mb-16">
                <h2>Deliverables</h2>
                <div>
                    <select id="deliverablePackage" style={{ width: 'auto', display: 'inline-block', minWidth: 170, marginRight: 8 }} value={pkg} onChange={e => setPkg(e.target.value)}>
                        {(data?.packages || []).map(p => <option key={p} value={p}>{p} package</option>)}
                    </select>
                    <button className="btn btn-secondary" onClick={applyDeliverablePackage}
                        title="Replaces the current set — a package is a statement about the whole job">Apply package</button>
                    <button className="btn btn-primary" onClick={() => openDeliverable()}>+ Deliverable</button>
                </div>
            </div>
            <p className="text-sm text-muted mb-8">
                One row per file that leaves the job. A film has one shape; a commercial has
                fourteen to twenty-two. This set is decided <strong>before anything is
                generated</strong>, because it is what says which shots must be <em>shot</em>
                {' '}vertical rather than cropped later &mdash; a 9:16 crop of a 16:9 frame keeps 32% of
                its width, and Auto Reframe cannot invent the two-thirds that were never generated.
            </p>
            <div id="deliverableVerdict" className="mb-8"><Verdict v={verdict} /></div>
            <ListControlsBar list={controls} />
            <div id="deliverableList">
                {data?.error && <p className="text-sm text-muted">Could not read the deliverables: {data.error}</p>}
                {rows && !rows.length && (
                    <p className="text-sm text-muted">No deliverables. Apply a package, or add one at a time. A film needs none of this &mdash; leave it empty and everything behaves exactly as it always has.</p>
                )}
                {rows && rows.length > 0 && !shown.length && <ListNoMatch list={controls} />}
                {shown.map(d => (
                    <div className="card" style={{ marginBottom: 6 }} key={d.id} data-deliverable-id={d.id}>
                        <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                            <div style={{ minWidth: 0 }}>
                                <strong>{d.label || d.key}</strong>
                                <span className="text-sm text-muted"> &middot; {d.key}</span>
                                <div className="tag-row" style={{ marginTop: 4 }}>
                                    <span className="tag">{d.aspect_ratio}</span>
                                    <span className="tag">{d.width}&times;{d.height}</span>
                                    <span className="tag">{d.fps} fps</span>
                                    <span className="tag">{(d.duration_ms / 1000).toFixed(0)}s</span>
                                    {d.platform && <span className="tag">{d.platform}</span>}
                                    {d.loudness_target && <span className="tag">{d.loudness_target}</span>}
                                    <span className="tag">captions: {d.caption_mode}</span>
                                    {!!d.native && <span className="tag" style={{ borderColor: WARN, color: WARN }} title="Must be GENERATED at this ratio — a crop to it loses the product">shoot native</span>}
                                    <span className="badge">{d.status}</span>
                                </div>
                            </div>
                            <div className="card-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => openDeliverable(d.id)}>Edit</button>
                                <button className="btn btn-secondary btn-sm" onClick={() => deleteDeliverable(d.id)}>Delete</button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Always rendered (empty until + Deliverable / Edit), so the static render has every field. */}
            <Modal id="deliverableModal" title={editing.id ? 'Edit deliverable' : 'New deliverable'} footer={<>
                <button className="btn btn-secondary" onClick={() => closeModal('deliverableModal')}>Cancel</button>
                <button className="btn btn-primary" onClick={saveDeliverable}>Save</button>
            </>}>
                <div className="form-group"><label>Key</label>
                    <input type="text" id="delKey" data-field="key" maxLength={60} value={f.delKey} onChange={set('delKey')} placeholder="e.g. 15_9x16" />
                    <span className="text-sm text-muted">This is the sequence name in Premiere, and how Media Encoder queues it.</span></div>
                <div className="form-group"><label>Label</label>
                    <input type="text" id="delLabel" data-field="label" maxLength={120} value={f.delLabel} onChange={set('delLabel')} /></div>
                <div className="form-group"><label>Profile</label>
                    <select id="delProfile" data-field="profile_id" value={f.delProfile} onChange={set('delProfile')}>
                        <option value="">Hand-built</option>
                        {profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select></div>
                <div className="form-group"><label>Aspect ratio</label>
                    <input type="text" id="delAspect" data-field="aspect_ratio" maxLength={12} value={f.delAspect} onChange={set('delAspect')} /></div>
                <div className="form-group"><label>Width</label>
                    <input type="number" id="delWidth" data-field="width" min="2" step="2" value={f.delWidth} onChange={set('delWidth')} /></div>
                <div className="form-group"><label>Height</label>
                    <input type="number" id="delHeight" data-field="height" min="2" step="2" value={f.delHeight} onChange={set('delHeight')} /></div>
                <div className="form-group"><label>Frame rate</label>
                    <input type="number" id="delFps" data-field="fps" min="1" step="0.01" value={f.delFps} onChange={set('delFps')} />
                    <span className="text-sm text-muted">Chosen at generation and never conformed &mdash; conforming 24p to 29.97 for a CTV buy cannot be fixed in the grade.</span></div>
                <div className="form-group"><label>Duration (seconds)</label>
                    <input type="number" id="delDuration" data-field="duration_ms" min="0.1" step="0.1" value={f.delDuration} onChange={set('delDuration')} /></div>
                <div className="form-group"><label>Platform</label>
                    <select id="delPlatform" data-field="platform" value={f.delPlatform} onChange={set('delPlatform')}>
                        <option value="">Unspecified</option>
                        {platforms.map(p => <option key={p} value={p}>{p}</option>)}
                    </select></div>
                <div className="form-group"><label>Loudness target</label>
                    <input type="text" id="delLoudness" data-field="loudness_target" maxLength={40} value={f.delLoudness} onChange={set('delLoudness')} placeholder="-24 LKFS" />
                    <span className="text-sm text-muted">Carried into the handoff. Media Encoder normalises on export; nothing here measures it.</span></div>
                <div className="form-group"><label>Captions</label>
                    <select id="delCaption" data-field="caption_mode" value={f.delCaption} onChange={set('delCaption')}>
                        {CAPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select></div>
                <div className="form-group"><label>Status</label>
                    <select id="delStatus" data-field="status" value={f.delStatus} onChange={set('delStatus')}>
                        {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select></div>
                <div className="form-group">
                    <label><input type="checkbox" id="delNative" data-field="native" checked={f.delNative} onChange={set('delNative')} /> Shoot native</label>
                    <span className="text-sm text-muted">Generated at this ratio rather than cropped to it. A 9:16 crop of a 16:9 frame keeps 32% of its width.</span></div>
                <div className="form-group"><label>Order</label>
                    <input type="number" id="delOrder" data-field="sort_order" min="0" value={f.delOrder} onChange={set('delOrder')} />
                    <span className="text-sm text-muted">The order the sequences appear in the exported project.</span></div>
                <div className="form-group"><label>Notes</label>
                    <textarea id="delNotes" data-field="notes" rows="2" maxLength={2000} value={f.delNotes} onChange={set('delNotes')} /></div>
            </Modal>
        </div>
    );
}
