import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * Notes & Reviews, as React. Replaces the legacy functions listed in react.json:
 * the same routes, the same markup (ids and classes), the same status messages.
 */
const NOTE_TYPES = ['general', 'direction', 'revision', 'camera', 'lighting', 'performance', 'continuity', 'vfx', 'audio', 'color'];
const PRIORITIES = ['normal', 'low', 'high', 'critical'];
const EMPTY_NOTE = { note_type: 'general', priority: 'normal', content: '', author: '' };
const label = (s) => s[0].toUpperCase() + s.slice(1);

export default function NotesPage() {
    const [scenes, setScenes] = useState([]);
    const [sceneId, setSceneId] = useState('');
    const [shotId, setShotId] = useState('');
    // null: no shot chosen yet (the prompt shows); []: a shot with no notes.
    const [notes, setNotes] = useState(null);
    const [draft, setDraft] = useState(EMPTY_NOTE);
    const [review, setReview] = useState({ decision: 'approve', notes: '' });

    const fail = (err) => legacy.setStatus('Error: ' + err.message);

    async function loadNotesPage() {
        if (!legacy.state.currentProject) return;
        try {
            const data = await legacy.api('/projects/' + legacy.state.currentProject.id + '/status-board');
            legacy.state.statusBoard = data;
            setScenes(data.scenes || []);
            setSceneId(''); setShotId(''); setNotes(null);
        } catch (err) { fail(err); }
    }
    usePageLoader('loadNotesPage', loadNotesPage);

    async function loadShotNotes(id = shotId) {
        if (!id) return;
        try {
            const data = await legacy.api('/shots/' + id + '/notes');
            setNotes(data.notes || []);
        } catch (err) { fail(err); }
    }

    const shots = scenes.find(s => s.id === sceneId)?.shots || [];

    function onSceneChange(e) { setSceneId(e.target.value); setShotId(''); setNotes([]); }
    function onShotChange(e) { setShotId(e.target.value); if (e.target.value) loadShotNotes(e.target.value); }

    function requireShot(then) { if (!shotId) { legacy.setStatus('Select a shot first'); return; } then(); }

    async function addNote() {
        if (!shotId || !draft.content) return;
        try {
            await legacy.api('/shots/' + shotId + '/notes', { method: 'POST', body: JSON.stringify(draft) });
            closeModal('addNoteModal');
            setDraft(EMPTY_NOTE);
            loadShotNotes();
            legacy.setStatus('Note added');
        } catch (err) { fail(err); }
    }

    async function resolveNote(noteId) {
        try {
            await legacy.api('/notes/' + noteId, { method: 'PUT', body: JSON.stringify({ resolved: true }) });
            loadShotNotes();
            legacy.setStatus('Note resolved');
        } catch (err) { fail(err); }
    }

    async function submitReview() {
        if (!shotId) return;
        const approved = review.decision === 'approve';
        try {
            await legacy.api('/shots/' + shotId + '/review', { method: 'POST', body: JSON.stringify({ approved, notes: review.notes.trim() }) });
            closeModal('reviewShotModal');
            setReview(r => ({ ...r, notes: '' }));
            loadShotNotes();
            legacy.setStatus('Review submitted — shot ' + (approved ? 'approved' : 'rejected'));
        } catch (err) { fail(err); }
    }

    return (
        <div className="page" id="page-notes">
            <div className="page-header"><h2>Notes &amp; Reviews</h2></div>
            <div className="flex-between mb-16">
                <div>
                    <label className="text-sm text-muted" style={{ marginRight: 8 }}>Scene:</label>
                    <select id="noteSceneSelect" style={{ width: 'auto', display: 'inline-block', minWidth: 180 }} value={sceneId} onChange={onSceneChange}>
                        <option value="">Select scene...</option>
                        {scenes.map(s => <option key={s.id} value={s.id}>Sc {s.scene_number} — {s.location || ''}</option>)}
                    </select>
                    <label className="text-sm text-muted" style={{ margin: '0 8px' }}>Shot:</label>
                    <select id="noteShotSelect" style={{ width: 'auto', display: 'inline-block', minWidth: 160 }} value={shotId} onChange={onShotChange}>
                        <option value="">Select shot...</option>
                        {shots.map(s => <option key={s.id} value={s.id}>{s.shot_code} ({s.status})</option>)}
                    </select>
                </div>
                <div className="btn-row">
                    <button className="btn btn-primary btn-sm" onClick={() => requireShot(() => openModal('addNoteModal'))}>+ Note</button>
                    <button className="btn btn-success btn-sm" onClick={() => requireShot(() => openModal('reviewShotModal'))}>Review Shot</button>
                </div>
            </div>
            <div id="notesList">
                {notes === null && sceneId === '' && <p className="text-sm text-muted">Select a scene and shot to view notes.</p>}
                {notes && shotId && notes.length === 0 && <p className="text-sm text-muted">No notes for this shot.</p>}
                {notes && shotId && notes.map(n => (
                    <div key={n.id} className={'note-item' + (n.resolved ? ' resolved' : '')}>
                        <div className="note-header">
                            <span className={'badge ' + n.note_type}>{n.note_type}</span>
                            <span className={'badge ' + n.priority}>{n.priority}</span>
                            <span className="text-sm text-muted">{n.author || 'unknown'}</span>
                            <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>{new Date(n.created_at).toLocaleString()}</span>
                            {n.resolved
                                ? <span className="badge completed">Resolved</span>
                                : <button className="btn btn-sm btn-secondary" onClick={() => resolveNote(n.id)}>Resolve</button>}
                        </div>
                        <div className="note-content">{n.content}</div>
                    </div>
                ))}
            </div>

            <Modal id="addNoteModal" title="Add Note">
                <div className="form-group"><label>Note Type</label>
                    <select data-field="note_type" value={draft.note_type} onChange={e => setDraft({ ...draft, note_type: e.target.value })}>
                        {NOTE_TYPES.map(t => <option key={t} value={t}>{t === 'vfx' ? 'VFX' : label(t)}</option>)}
                    </select>
                </div>
                <div className="form-group"><label>Priority</label>
                    <select data-field="priority" value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
                        {PRIORITIES.map(p => <option key={p} value={p}>{label(p)}</option>)}
                    </select>
                </div>
                <div className="form-group"><label>Content</label><textarea data-field="content" rows="3" placeholder="Note content..." value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} /></div>
                <div className="form-group"><label>Author</label><input type="text" data-field="author" placeholder="Director" value={draft.author} onChange={e => setDraft({ ...draft, author: e.target.value })} /></div>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={addNote}>Add Note</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('addNoteModal')}>Cancel</button>
                </div>
            </Modal>

            <Modal id="reviewShotModal" title="Review Shot">
                <div className="form-group"><label>Decision</label>
                    <select id="reviewDecision" value={review.decision} onChange={e => setReview({ ...review, decision: e.target.value })}>
                        <option value="approve">Approve</option>
                        <option value="reject">Reject</option>
                    </select>
                </div>
                <div className="form-group"><label>Notes</label><textarea id="reviewNotes" rows="3" placeholder="Review notes..." value={review.notes} onChange={e => setReview({ ...review, notes: e.target.value })} /></div>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={submitReview}>Submit Review</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('reviewShotModal')}>Cancel</button>
                </div>
            </Modal>
        </div>
    );
}
