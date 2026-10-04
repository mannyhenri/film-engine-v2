import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * Rights, as React. Recorded, never enforced: nothing here blocks a generation or an export.
 * The vocabularies (types, statuses, origins, what a record attaches to) are SERVED by the route, so
 * the form never offers a value the route would refuse. Same routes, bodies and status lines as the
 * legacy page; this form sends its values as typed (it never used the trimming form helper).
 */
const FIELDS = ['subject', 'rights_type', 'status', 'origin', 'entity_type', 'entity_id', 'owner', 'source',
    'license_url', 'consent_reference', 'territory', 'expires_on', 'restrictions', 'notes'];
const DEFAULT_ORIGINS = ['original', 'generated', 'licensed', 'public_domain', 'unknown'];

function recordToForm(r) {
    const f = {};
    for (const k of FIELDS) f[k] = r[k] ?? '';
    f.rights_type = r.rights_type || 'commercial_use';
    f.status = r.status || 'unknown';
    f.origin = r.origin || 'unknown';
    f.entity_type = r.entity_type || 'asset';
    f.expires_on = String(r.expires_on || '').slice(0, 10);
    return f;
}
const tone = (status) => status === 'cleared' ? 'var(--gl-success)'
    : status === 'expired' || status === 'blocked' ? 'var(--gl-danger,#ef4444)' : 'var(--gl-warning,#f59e0b)';

export default function RightsPage() {
    const [data, setData] = useState(null);      // { rights, by_status, vocabulary }
    const [loadError, setLoadError] = useState('');
    const [filter, setFilter] = useState('');
    // Always a form, so its fields are on the page (and in the static render the UI tests read).
    const [editing, setEditing] = useState({ id: null, derived: false, form: recordToForm({}) });

    async function loadRights() {
        if (!legacy.state.currentProject) return;
        try {
            const d = await legacy.api(`/projects/${legacy.state.currentProject.id}/rights`);
            legacy.state.rightsRows = d.rights || [];
            setData(d); setLoadError('');
        } catch (err) { setLoadError(err.message); }
    }
    usePageLoader('loadRights', loadRights);

    const vocab = data && data.vocabulary;
    const rows = (data && data.rights) || [];
    const inStatus = filter ? rows.filter(r => r.status === filter) : rows;
    // Search, sort and filter within the status chosen above (never re-read).
    const controls = useListControls(SURFACE, data ? inStatus : null);
    const shown = controls.shown || [];
    const counts = (data && data.by_status) || {};

    function openRight(r) {
        if (!vocab) return legacy.setStatus('This server serves no rights vocabulary — it may predate it.');
        setEditing({ id: r ? r.id : null, derived: !!r && r.origin === 'derived', form: recordToForm(r || {}) });
        openModal('rightModal');
    }
    const set = (k) => (e) => setEditing(ed => ({ ...ed, form: { ...ed.form, [k]: e.target.value } }));

    async function saveRight() {
        const { id, derived, form } = editing;
        const body = { ...form };
        if (derived) delete body.origin; // a derived file's origin is computed, never declared here
        if (!body.subject.trim()) return legacy.setStatus('A rights record needs a subject');
        try {
            await legacy.api(id ? `/rights/${id}` : `/projects/${legacy.state.currentProject.id}/rights`,
                { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
            closeModal('rightModal');
            legacy.setStatus(id ? 'Record updated' : 'Record added');
            loadRights();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function deleteRight(id) {
        if (!window.confirm('Remove this rights record?\n\nThe clearance it documents is not affected — this '
            + 'only removes the note that you had it.')) return;
        try { await legacy.api(`/rights/${id}`, { method: 'DELETE' }); loadRights(); legacy.setStatus('Record removed'); }
        catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    // As core's vocabOptions drew them: the served value kept, its underscores shown as spaces.
    const options = (list) => (list || []).map(v => <option key={v} value={v}>{String(v).replace(/_/g, ' ')}</option>);
    const f = editing.form;
    const v = vocab || {};

    return (
        <div className="page" id="page-rights">
            <div className="flex-between mb-16">
                <h2>Rights</h2>
                <div>
                    <select id="rightsFilter" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 'auto', display: 'inline-block', minWidth: 150, marginRight: 8 }}>
                        <option value="">All statuses</option>
                        {options(vocab && vocab.status)}
                    </select>
                    <button className="btn btn-primary" onClick={() => openRight(null)}>+ Record</button>
                </div>
            </div>
            <p className="text-sm text-muted mb-8">
                What has been cleared, by whom, where and until when. Recorded, never enforced:
                nothing here blocks a generation or an export. It is what a delivery has to be able
                to answer, and the moment to write it down is while you know the answer rather than
                at delivery.
            </p>
            <div id="rightsSummary" className="mb-8">
                {Object.keys(counts).length > 0 && (
                    <div className="tag-row">{Object.entries(counts).map(([k, n]) => (
                        <span key={k} className="tag" style={k === 'cleared' ? { borderColor: 'var(--gl-success)', color: 'var(--gl-success)' } : undefined}>{k}: {n}</span>
                    ))}</div>
                )}
            </div>
            <ListControlsBar list={controls} />
            <div id="rightsList">
                {loadError && <p className="text-sm text-muted">Could not read the register: {loadError}</p>}
                {!loadError && data && !inStatus.length && <p className="text-sm text-muted">Nothing recorded{filter ? ' with that status.' : ' yet.'}</p>}
                {!loadError && inStatus.length > 0 && !shown.length && <ListNoMatch list={controls} />}
                {!loadError && shown.map(r => (
                    <div key={r.id} className="card" data-right-id={r.id} style={{ marginBottom: 6 }}>
                        <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                            <div style={{ minWidth: 0 }}>
                                <strong>{r.subject || ''}</strong>
                                <div className="text-sm text-muted">
                                    {(r.rights_type || '').replace(/_/g, ' ')}
                                    {r.owner ? ' · ' + r.owner : ''}
                                    {r.territory ? ' · ' + r.territory : ''}
                                    {r.expires_on ? ' · until ' + String(r.expires_on).slice(0, 10) : ''}
                                </div>
                                <div className="tag-row" style={{ marginTop: 4 }}>
                                    <span className="tag" style={{ borderColor: tone(r.status), color: tone(r.status) }}>{r.status || 'unknown'}</span>
                                    <span className="tag">{r.entity_type || 'asset'}</span>
                                    {r.restrictions && <span className="tag">restricted</span>}
                                </div>
                            </div>
                            <div className="card-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => openRight(r)}>Edit</button>
                                <button className="btn btn-secondary btn-sm" onClick={() => deleteRight(r.id)}>Delete</button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <Modal id="rightModal" title={editing.id ? 'Edit record' : 'New rights record'} footer={<>
                <button className="btn btn-secondary" onClick={() => closeModal('rightModal')}>Cancel</button>
                <button className="btn btn-primary" onClick={saveRight}>Save</button>
            </>}>
                    <div className="form-group"><label>Subject</label>
                        <input type="text" id="rightSubject" data-field="subject" maxLength={500} value={f.subject} onChange={set('subject')}
                            placeholder="What this record is about — a person, a track, a model" />
                        <span className="text-sm text-muted">Required.</span></div>
                    <div className="form-group"><label>Type</label>
                        <select id="rightType" data-field="rights_type" value={f.rights_type} onChange={set('rights_type')}>{options(v.rights_type)}</select></div>
                    <div className="form-group"><label>Status</label>
                        <select id="rightStatus" data-field="status" value={f.status} onChange={set('status')}>{options(v.status)}</select></div>
                    {editing.derived
                        ? <div className="form-group"><label>Origin</label><span className="text-sm text-muted">Derived — this file's rights are computed from what it was made from, so they follow the sources rather than being declared here.</span></div>
                        : <div className="form-group"><label>Origin</label>
                            <select id="rightOrigin" data-field="origin" value={f.origin} onChange={set('origin')}>{options(v.origin || DEFAULT_ORIGINS)}</select>
                            <span className="text-sm text-muted">What the material is: your own, generated by a provider, licensed, public domain, or not known. Nothing is assumed.</span></div>}
                    <div className="form-group"><label>What it attaches to</label>
                        <select id="rightEntityType" data-field="entity_type" value={f.entity_type} onChange={set('entity_type')}>{options(v.entity_type)}</select></div>
                    <div className="form-group"><label>Its id</label>
                        <input type="text" id="rightEntityId" data-field="entity_id" maxLength={100} value={f.entity_id} onChange={set('entity_id')} placeholder="Optional — the character, asset or cue this is about" /></div>
                    <div className="form-group"><label>Owner</label>
                        <input type="text" id="rightOwner" data-field="owner" maxLength={500} value={f.owner} onChange={set('owner')} placeholder="Who holds the right" /></div>
                    <div className="form-group"><label>Source</label>
                        <input type="text" id="rightSource" data-field="source" maxLength={500} value={f.source} onChange={set('source')} placeholder="Where it came from" /></div>
                    <div className="form-group"><label>Licence URL</label>
                        <input type="text" id="rightUrl" data-field="license_url" maxLength={1000} value={f.license_url} onChange={set('license_url')} placeholder="https://…" /></div>
                    <div className="form-group"><label>Consent reference</label>
                        <input type="text" id="rightConsent" data-field="consent_reference" maxLength={500} value={f.consent_reference} onChange={set('consent_reference')} placeholder="The signed release, by its own reference" />
                        <span className="text-sm text-muted">For a likeness or a voice: what you would produce if asked.</span></div>
                    <div className="form-group"><label>Territory</label>
                        <input type="text" id="rightTerritory" data-field="territory" maxLength={200} value={f.territory} onChange={set('territory')} placeholder="e.g. worldwide, or UK & Ireland" /></div>
                    <div className="form-group"><label>Expires</label>
                        <input type="date" id="rightExpires" data-field="expires_on" value={f.expires_on} onChange={set('expires_on')} />
                        <span className="text-sm text-muted">Blank means it does not expire.</span></div>
                    <div className="form-group"><label>Restrictions</label>
                        <textarea id="rightRestrictions" data-field="restrictions" rows="2" maxLength={2000} value={f.restrictions} onChange={set('restrictions')} />
                        <span className="text-sm text-muted">What you may NOT do with it. Read by a person, not by the engine.</span></div>
                    <div className="form-group"><label>Notes</label>
                        <textarea id="rightNotes" data-field="notes" rows="2" maxLength={2000} value={f.notes} onChange={set('notes')} /></div>
            </Modal>
        </div>
    );
}
