import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * Render History, as React. Every shot of the film in one picker (from the status board, read once
 * and shared through legacy state as the legacy page did), and the selected shot's render ledger.
 */
export default function RenderHistoryPage() {
    const [shots, setShots] = useState([]);
    const [shotId, setShotId] = useState('');
    // null: no shot chosen yet; []: a shot with no renders.
    const [renders, setRenders] = useState(null);
    const fail = (err) => legacy.setStatus('Error: ' + err.message);

    async function loadRenderPage() {
        const st = legacy.state;
        if (!st.currentProject) return;
        try {
            if (!st.statusBoard) st.statusBoard = await legacy.api('/projects/' + st.currentProject.id + '/status-board');
            const all = [];
            (st.statusBoard?.scenes || []).forEach(s => (s.shots || []).forEach(sh => all.push({ ...sh, scene_number: s.scene_number })));
            setShots(all);
            setShotId('');
            setRenders(null);
        } catch (err) { fail(err); }
    }
    usePageLoader('loadRenderPage', loadRenderPage);

    async function onShotChange(e) {
        const id = e.target.value;
        setShotId(id);
        if (!id) return;
        try {
            const data = await legacy.api('/shots/' + id + '/renders');
            setRenders(data.renders || []);
        } catch (err) { fail(err); }
    }

    // Search, sort and filter the shot's ledger as read (never re-read).
    const controls = useListControls(SURFACE, renders);
    const shown = controls.shown || [];

    return (
        <div className="page" id="page-renderhistory">
            <div className="page-header"><h2>Render History</h2></div>
            <div className="mb-16">
                <label className="text-sm text-muted" style={{ marginRight: 8 }}>Shot:</label>
                <select id="renderShotSelect" style={{ width: 'auto', display: 'inline-block', minWidth: 200 }} value={shotId} onChange={onShotChange}>
                    <option value="">Select shot...</option>
                    {shots.map(s => <option key={s.id} value={s.id}>Sc{s.scene_number}/{s.shot_code}</option>)}
                </select>
            </div>
            {renders && renders.length > 0 && <ListControlsBar list={controls} />}
            <div id="renderTableWrap">
                {renders && renders.length > 0 && shown.length === 0 && <ListNoMatch list={controls} />}
                {renders === null && <p className="text-sm text-muted">Select a shot to view render history.</p>}
                {renders && renders.length === 0 && <p className="text-sm text-muted">No renders for this shot.</p>}
                {shown.length > 0 && (
                    <table className="render-table">
                        <tbody>
                            <tr><th>Ver</th><th>Step</th><th>Model</th><th>Seed</th><th>Steps</th><th>Guidance</th><th>Mode</th><th>Duration</th><th>Date</th></tr>
                            {shown.map((r, i) => (
                                <tr key={r.id || i} data-render-id={r.id}>
                                    <td>{r.version}</td>
                                    <td><span className="badge">{r.step}</span></td>
                                    <td>{r.model_id || '-'}</td>
                                    <td>{r.seed ?? '-'}</td>
                                    <td>{r.steps || '-'}</td>
                                    <td>{r.guidance || '-'}</td>
                                    <td><span className={'badge ' + (r.mode === 'locked' ? 'approved' : '')}>{r.mode}</span></td>
                                    <td>{r.inference_ms ? (r.inference_ms / 1000).toFixed(1) + 's' : '-'}</td>
                                    <td className="text-muted">{new Date(r.created_at).toLocaleDateString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
