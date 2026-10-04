import { useRef, useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from './engine.js'; // the upload piece size, moved from core (only this page uses it)

/*
 * Edits made in an editor, brought back, as React. Replaces the legacy functions
 * listed in react.json: the same routes, bodies, markup and status lines.
 *
 * One deliberate change: Rename asked with window.prompt(), which Electron does
 * not implement (it throws), so it is a small dialog here (editRenameModal).
 */
const ELLIPSIS = (list, n) => list.slice(0, n).join(', ') + (list.length > n ? '…' : '');

/** One imported version. Module-level, so a re-render (upload progress) keeps an open <details> open. */
function EditCard({ e, act }) {
    const c = e.cut;
    const facts = [legacy.mwTime(e.duration_ms), e.frame_rate ? `${Math.round(e.frame_rate * 1000) / 1000} fps` : '',
        e.width ? `${e.width}×${e.height}` : '', e.has_audio ? 'with sound' : 'no sound', e.size_bytes ? legacy.fmtBytes(e.size_bytes) : '']
        .filter(Boolean).join(' · ');
    return (
        <div className="card mb-16" data-edit-id={e.id}>
            <div className="flex-between">
                <h3 style={{ margin: 0 }}>v{e.version} · {e.name || ''}{e.is_latest && <> <span className="badge">latest</span></>}</h3>
                <div className="btn-row" style={{ margin: 0 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => act.scoreThisEdit(e.id, e.version)}>Score this edit</button>
                    <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>{c ? 'Replace XML / EDL' : 'Add XML / EDL'}
                        <input type="file" accept=".xml,.edl,application/xml,text/xml,text/plain" style={{ display: 'none' }} onChange={ev => act.importEditCut(e.id, ev.target)} />
                    </label>
                    {c && <button className="btn btn-secondary btn-sm" onClick={() => act.rematchEditCut(e.id)}>Re-match shots</button>}
                    <button className="btn btn-secondary btn-sm" onClick={() => act.renameEdit(e.id)}>Rename</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => act.deleteEditVersion(e.id, e.version)}>Delete</button>
                </div>
            </div>
            <div className="text-sm text-muted" style={{ margin: '4px 0 8px' }}>{facts}</div>
            {e.available && e.video_url
                ? <video src={legacy.API_BASE + e.video_url} controls preload="metadata" playsInline style={{ width: '100%', maxHeight: '40vh', background: '#000', display: 'block' }} />
                : <p className="text-sm" style={{ color: 'var(--danger,#e66)' }}>The picture file is missing from the project folder.</p>}
            <div className="text-sm" style={{ marginTop: 8 }}>
                {c ? <>
                    <strong>{c.summary.events}</strong> events in “{c.sequence || ''}”, <strong>{c.summary.matched}</strong> of them Film Engine shots
                    {` (${c.summary.by.file} by file, ${c.summary.by.code} by shot code)`}
                    {c.summary.unmatched ? ` · not ours: ${ELLIPSIS(c.summary.unmatched_names, 6)}` : ''}
                    {c.summary.shots_not_in_cut.length ? ` · shots not in this cut: ${ELLIPSIS(c.summary.shots_not_in_cut, 8)}` : ''}
                </> : 'No cut yet — add the XML or EDL this edit was exported with, so the score knows which shot plays where.'}
            </div>
            {e.sessions.length > 0 && (
                <div className="text-sm" style={{ marginTop: 4 }}>Scored in: {e.sessions.map((x, i) => (
                    <span key={x.id}>{i > 0 && ', '}<a href="#" onClick={ev => act.openScoreSession(ev, x.id)}>{x.name || 'untitled'}</a> ({x.status})</span>
                ))}</div>
            )}
            {e.file_path && <div className="text-sm text-muted" style={{ marginTop: 4, userSelect: 'all' }}>{e.file_path}</div>}
            {c && c.events.length > 0 && (
                <details style={{ marginTop: 8 }}><summary className="text-sm">The cut, event by event</summary>
                    <table className="text-sm" style={{ borderCollapse: 'collapse', marginTop: 6 }}><tbody>
                        {c.events.map((ev, i) => (
                            <tr key={i}>
                                <td style={{ padding: '2px 8px 2px 0' }}>{legacy.mwTime(ev.start_ms)}</td>
                                <td style={{ padding: '2px 8px' }}>{legacy.mwTime(ev.duration_ms)}</td>
                                <td style={{ padding: '2px 8px' }}><strong>{ev.shot_code || '—'}</strong></td>
                                <td style={{ padding: '2px 8px' }}>{ev.name || ev.file_name || ''}</td>
                                <td style={{ padding: '2px 0' }} className="text-muted">{ev.matched_by ? 'by ' + ev.matched_by : 'not a Film Engine shot'}</td>
                            </tr>
                        ))}
                    </tbody></table>
                </details>
            )}
        </div>
    );
}

export default function EditsPage() {
    // { noProject } | { error } | { edits }
    const [view, setView] = useState({ edits: null });
    const [progress, setProgress] = useState('');
    const [importing, setImporting] = useState(false);
    const [renaming, setRenaming] = useState({ id: null, name: '' });
    const editsRef = useRef([]);

    async function loadEditsPage() {
        if (!legacy.state.currentProject) { setView({ noProject: true }); return; }
        try {
            const r = await legacy.api(`/projects/${legacy.state.currentProject.id}/edits`);
            legacy.state.edits = r.edits || [];
            editsRef.current = legacy.state.edits;
            setView({ edits: legacy.state.edits });
        } catch (err) { setView({ error: err.message }); }
    }
    usePageLoader('loadEditsPage', loadEditsPage);

    async function importEditFile(input) {
        const file = input.files && input.files[0];
        if (!file || !legacy.state.currentProject) return;
        setImporting(true);
        try {
            const opened = await legacy.api('/uploads', { method: 'POST', body: JSON.stringify({ total_bytes: file.size, mime: file.type || 'application/octet-stream', name: file.name }) });
            let at = 0, failures = 0;
            while (at < file.size) {
                const piece = file.slice(at, Math.min(file.size, at + E.EDIT_CHUNK));
                // The whole edit has no ceiling (it travels in pieces), but each piece does,
                // and one over it is refused here rather than as a 413.
                legacy.checkUploadSize(piece, `/uploads/${opened.id}`);
                try {
                    // /film/uploads: the original built ${API_BASE}/uploads, which the server never routed (404).
                    const res = await fetch(`${legacy.API_BASE}/film/uploads/${opened.id}`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(at) }, body: piece,
                    });
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
                    at = body.received; failures = 0;
                } catch (err) {
                    if (++failures > 5) throw err;
                    // Ask the server where it got to, and carry on from there.
                    const st = await legacy.api(`/uploads/${opened.id}`).catch(() => null);
                    if (st) at = st.received;
                    await new Promise(r => setTimeout(r, 1000 * failures));
                }
                setProgress(`Uploading ${file.name}: ${Math.floor(at / file.size * 100)}% of ${legacy.fmtBytes(file.size)}`);
            }
            setProgress('Measuring the picture…');
            const r = await legacy.api(`/projects/${legacy.state.currentProject.id}/edits/import`, { method: 'POST', body: JSON.stringify({ upload_id: opened.id, name: file.name.replace(/\.[^.]+$/, '') }) });
            setProgress(`Imported as edit v${r.edit.version} (${legacy.mwTime(r.edit.duration_ms)}). Add the XML or EDL it was exported with to see which shot plays where.`);
            loadEditsPage();
        } catch (err) {
            setProgress(`${file.name} was not imported: ${err.message}`);
        } finally {
            setImporting(false);
            input.value = '';
        }
    }

    async function importEditCut(editId, input) {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            legacy.checkUploadSize(file, `/edits/${editId}/cut`);
            const text = await file.text();
            const r = await legacy.api(`/edits/${editId}/cut`, { method: 'POST', body: JSON.stringify({ text, name: file.name }) });
            const sm = r.edit.cut.summary;
            legacy.setStatus(`${file.name}: ${sm.events} events, ${sm.matched} matched to shots${sm.unmatched ? `, ${sm.unmatched} not ours` : ''}`);
            loadEditsPage();
        } catch (err) { legacy.setStatus(`${file.name} was not read: ${err.message}`); }
        finally { input.value = ''; }
    }

    async function rematchEditCut(editId) {
        try { await legacy.api(`/edits/${editId}/cut/rematch`, { method: 'POST', body: '{}' }); loadEditsPage(); legacy.setStatus('Matched against the shots as they are now'); }
        catch (err) { legacy.setStatus('Could not re-match: ' + err.message); }
    }

    function renameEdit(editId) {
        const e = editsRef.current.find(x => x.id === editId);
        setRenaming({ id: editId, name: e ? e.name || '' : '' });
        openModal('editRenameModal');
    }
    async function saveRename() {
        try {
            await legacy.api(`/edits/${renaming.id}`, { method: 'PUT', body: JSON.stringify({ name: renaming.name }) });
            closeModal('editRenameModal');
            loadEditsPage();
        } catch (err) { legacy.setStatus('Could not rename: ' + err.message); }
    }

    async function deleteEditVersion(editId, version) {
        if (!window.confirm(`Delete edit v${version}?\n\nThe files move to 05 Edit/deleted, so they can be recovered by hand.`)) return;
        try { await legacy.api(`/edits/${editId}`, { method: 'DELETE' }); loadEditsPage(); legacy.setStatus(`Edit v${version} deleted`); }
        catch (err) {
            // Refused while a score is written against it: say so, and offer the choice.
            if (/written against this edit/.test(err.message) && window.confirm(err.message + '\n\nDelete anyway and leave those scores with no picture?')) {
                try { await legacy.api(`/edits/${editId}?force=true`, { method: 'DELETE' }); loadEditsPage(); } catch (e2) { legacy.setStatus('Could not delete: ' + e2.message); }
            } else legacy.setStatus('Not deleted: ' + err.message);
        }
    }

    /** Open a score session timed to this edit, and go to it. */
    async function scoreThisEdit(editId, version) {
        try {
            const out = await legacy.api(`/projects/${legacy.state.currentProject.id}/music-sessions`, {
                method: 'POST', body: JSON.stringify({ edit_id: editId, name: `Score — edit v${version}` }),
            });
            legacy.MW.session = out.session;
            legacy.navigateTo('musicws');
        } catch (err) { legacy.setStatus('Could not open a score for this edit: ' + err.message); }
    }

    function openScoreSession(e, sessionId) { e.preventDefault(); legacy.MW.session = { id: sessionId }; legacy.navigateTo('musicws'); }

    const actions = { scoreThisEdit, importEditCut, rematchEditCut, renameEdit, deleteEditVersion, openScoreSession };

    return (
        <div className="page" id="page-edits">
            <div className="flex-between mb-16">
                <h2>Edit</h2>
                <div>
                    <label className={'btn btn-primary' + (importing ? ' disabled' : '')} style={{ cursor: 'pointer', margin: 0 }} id="editImportLabel">Import an edit&hellip;
                        <input type="file" id="editImportFile" accept="video/mp4,video/quicktime,video/x-matroska,.mp4,.mov,.mkv" style={{ display: 'none' }} onChange={e => importEditFile(e.target)} />
                    </label>
                </div>
            </div>
            <p className="text-sm text-muted" style={{ maxWidth: 760, lineHeight: 1.5 }}>
                Export your cut from Premiere (H.264 or ProRes) and import it here. Then add the
                {' '}<strong>Final Cut Pro XML</strong> (File &rarr; Export &rarr; Final Cut Pro XML) or an <strong>EDL</strong>
                {' '}it was cut from, so Film Engine knows which shot plays where. Every import is a new version &mdash;
                nothing is overwritten &mdash; and the files are kept in the project&rsquo;s <em>05 Edit</em> folder.
                {' '}<strong>Score this edit</strong> opens a score session timed to the cut, whose stems drop onto the
                Premiere sequence at 00:00.
            </p>
            <div id="editImportProgress" className="text-sm" style={{ margin: '8px 0' }}>{progress}</div>
            <div id="editsList">
                {view.noProject && <p className="text-muted">Open a project to see its edits.</p>}
                {view.error && <p className="text-sm" style={{ color: 'var(--danger,#e66)' }}>The edits could not be read: {view.error}</p>}
                {view.edits === null && !view.noProject && !view.error && <p className="text-muted">Loading&hellip;</p>}
                {view.edits && !view.edits.length && <p className="text-muted">No edit yet. Export your cut from Premiere and import it with the button above.</p>}
                {view.edits && view.edits.map(e => <EditCard key={e.id} e={e} act={actions} />)}
            </div>

            <Modal id="editRenameModal" title="Name this version" footer={<>
                <button className="btn btn-secondary" onClick={() => closeModal('editRenameModal')}>Cancel</button>
                <button className="btn btn-primary" onClick={saveRename}>Save</button>
            </>}>
                <div className="form-group"><input type="text" id="editRenameName" value={renaming.name} onChange={e => setRenaming(r => ({ ...r, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveRename(); }} /></div>
            </Modal>
        </div>
    );
}
