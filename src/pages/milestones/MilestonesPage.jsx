import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { formBody } from '../../lib/forms.js';

/*
 * Milestones, as React: the production timeline, a create form and an edit form. Same routes,
 * bodies (formBody: the legacy form rules) and status lines as the legacy page.
 */
const PHASES = [['concept', 'Concept'], ['script', 'Script'], ['pre-production', 'Pre-Production'], ['storyboard', 'Storyboard'],
    ['production', 'Production'], ['post-production', 'Post-Production'], ['review', 'Review'], ['export', 'Export'], ['complete', 'Complete']];
const STATUSES = [['pending', 'Pending'], ['in_progress', 'In Progress'], ['completed', 'Completed'], ['skipped', 'Skipped']];
const NEW = { title: '', phase: 'concept', target_date: '', description: '' };
const EDIT = { status: 'pending', completion_pct: 0, target_date: '', description: '' };

export default function MilestonesPage() {
    const [milestones, setMilestones] = useState(null);
    const [draft, setDraft] = useState(NEW);
    const [editId, setEditId] = useState('');
    const [edit, setEdit] = useState(EDIT);
    const fail = (err) => legacy.setStatus('Error: ' + err.message);
    const projectId = () => legacy.state.currentProject && legacy.state.currentProject.id;

    async function loadMilestones() {
        if (!projectId()) return;
        try {
            const data = await legacy.api('/projects/' + projectId() + '/milestones');
            legacy.state.milestones = data.milestones || []; // shared, as the legacy page left it
            setMilestones(legacy.state.milestones);
        } catch (err) { fail(err); }
    }
    usePageLoader('loadMilestones', loadMilestones);

    async function createMilestone() {
        if (!projectId()) return;
        const body = formBody(draft);
        if (!body.title) return;
        try {
            await legacy.api('/projects/' + projectId() + '/milestones', { method: 'POST', body: JSON.stringify(body) });
            closeModal('milestoneModal');
            setDraft(NEW);
            loadMilestones();
            legacy.setStatus('Milestone created');
        } catch (err) { fail(err); }
    }

    function showEditMilestone(m) {
        setEditId(m.id);
        // As setModalData did: a missing value shows empty, never "null".
        setEdit({ status: m.status ?? 'pending', completion_pct: m.completion_pct ?? '', target_date: m.target_date ?? '', description: m.description ?? '' });
        openModal('editMilestoneModal');
    }

    async function updateMilestone() {
        if (!editId || !projectId()) return;
        try {
            await legacy.api('/projects/' + projectId() + '/milestones/' + editId, { method: 'PUT', body: JSON.stringify(formBody(edit, ['completion_pct'])) });
            closeModal('editMilestoneModal');
            loadMilestones();
            legacy.setStatus('Milestone updated');
        } catch (err) { fail(err); }
    }

    return (
        <div className="page" id="page-milestones">
            <div className="flex-between mb-16">
                <h2>Milestones</h2>
                <button className="btn btn-primary" onClick={() => openModal('milestoneModal')}>+ Milestone</button>
            </div>
            <div className="milestone-timeline" id="milestoneTimeline">
                {milestones && milestones.length === 0 && <p className="text-sm text-muted">No milestones.</p>}
                {milestones && milestones.map(m => (
                    <div key={m.id} className={'milestone-node ' + m.status}>
                        <div className="flex-between">
                            <div>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{m.title}</span>
                                <span className={'badge ' + m.phase} style={{ marginLeft: 8 }}>{m.phase}</span>
                                <span className={'badge ' + m.status} style={{ marginLeft: 4 }}>{m.status}</span>
                            </div>
                            <button className="btn btn-secondary btn-sm" onClick={() => showEditMilestone(m)}>Edit</button>
                        </div>
                        {m.description && <p className="text-sm text-muted" style={{ marginTop: 4 }}>{m.description}</p>}
                        <div className="milestone-progress"><div className="milestone-progress-fill" style={{ width: (m.completion_pct || 0) + '%' }} /></div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--gl-text-muted)', marginTop: 4 }}>
                            <span>{m.completion_pct || 0}% complete</span>
                            {m.target_date && <span>Target: {m.target_date}</span>}
                            {m.actual_date && <span>Actual: {m.actual_date}</span>}
                        </div>
                    </div>
                ))}
            </div>

            <Modal id="milestoneModal" title="New Milestone">
                <div className="form-group"><label>Title</label><input type="text" data-field="title" placeholder="Milestone title" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></div>
                <div className="form-group"><label>Phase</label>
                    <select data-field="phase" value={draft.phase} onChange={e => setDraft({ ...draft, phase: e.target.value })}>
                        {PHASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                </div>
                <div className="form-group"><label>Target Date</label><input type="date" data-field="target_date" value={draft.target_date} onChange={e => setDraft({ ...draft, target_date: e.target.value })} /></div>
                <div className="form-group"><label>Description</label><textarea data-field="description" rows="2" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></div>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={createMilestone}>Create</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('milestoneModal')}>Cancel</button>
                </div>
            </Modal>

            <Modal id="editMilestoneModal" title="Edit Milestone">
                <div className="form-group"><label>Status</label>
                    <select data-field="status" value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value })}>
                        {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                </div>
                <div className="form-group"><label>Completion %</label><input type="number" data-field="completion_pct" min="0" max="100" value={edit.completion_pct} onChange={e => setEdit({ ...edit, completion_pct: e.target.value })} /></div>
                <div className="form-group"><label>Target Date</label><input type="date" data-field="target_date" value={edit.target_date} onChange={e => setEdit({ ...edit, target_date: e.target.value })} /></div>
                <div className="form-group"><label>Description</label><textarea data-field="description" rows="2" value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></div>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={updateMilestone}>Save</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('editMilestoneModal')}>Cancel</button>
                </div>
            </Modal>
        </div>
    );
}
