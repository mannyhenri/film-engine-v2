import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * The Job Queue, as React. Replaces the legacy loader and its status badge: the same route, markup and
 * lines. The loader is also called by name from the nav button (onclick="navigateTo('jobsqueue');
 * loadJobsQueuePage()"), which the React loader answers.
 */
function StatusBadge({ status }) {
    const color = status === 'pass' || status === 'complete' || status === 'cleared' ? '#16a34a'
        : status === 'fail' || status === 'failed' || status === 'blocked' ? '#dc2626'
            : '#f59e0b';
    return <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 999, background: color + '22', color, fontSize: 11, fontWeight: 700 }}>{status || 'unknown'}</span>;
}

/*
 * When a job happened: its date and time where you are, and how long ago. The jobs' created_at is SQLite's
 * datetime('now') (UTC, no zone written) on most tables and ISO on some, so a bare one is read as UTC.
 */
export function whenOf(at, now = Date.now()) {
    if (!at) return '';
    const s = String(at);
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) || !/\d{2}:\d{2}/.test(s) ? s : s.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return s;
    const mins = Math.round((now - d.getTime()) / 60000);
    const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
    return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${ago}`;
}
const FINISHED = new Set(['complete', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'canceled', 'interrupted']);   // as routes/jobs.js

export default function JobsQueuePage() {
    const [view, setView] = useState(null); // null | { loading } | { error } | { data }
    const [showCleared, setShowCleared] = useState(false);
    const pidNow = () => legacy.state.currentProject && legacy.state.currentProject.id;

    async function loadJobsQueuePage(all = showCleared) {
        const pid = pidNow();
        if (!pid) { legacy.setStatus('Open a project first'); return; }
        setView(v => (v && v.data ? v : { loading: true }));
        try { setView({ data: await legacy.api(`/projects/${pid}/jobs${all ? '?include_cleared=1' : ''}`) }); }
        catch (err) { setView({ error: err.message }); }
    }
    // Clear: the finished jobs leave the list (and the badge); they are only hidden, so Restore brings them back.
    async function clearFinished() {
        try {
            const r = await legacy.api(`/projects/${pidNow()}/jobs/clear`, { method: 'POST', body: '{}', refresh: false });
            legacy.setStatus(`${r.cleared} finished job${r.cleared === 1 ? '' : 's'} cleared from the queue.`);
            await loadJobsQueuePage();
        } catch (err) { legacy.setStatus('Clear failed: ' + err.message); }
    }
    async function restore() {
        try { await legacy.api(`/projects/${pidNow()}/jobs/restore`, { method: 'POST', body: '{}', refresh: false }); setShowCleared(false); await loadJobsQueuePage(false); }
        catch (err) { legacy.setStatus('Restore failed: ' + err.message); }
    }
    usePageLoader('loadJobsQueuePage', loadJobsQueuePage);

    const data = view?.data;
    const s = data?.summary || {};
    // Search, sort and filter the jobs that were read (never re-read); the summary above counts every job.
    const controls = useListControls(SURFACE, data ? data.jobs : null);
    return (
        <div className="page" id="page-jobsqueue">
            <div className="flex-between mb-16">
                <h2>Job Queue</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {data && data.cleared > 0 && <label className="text-sm text-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" checked={showCleared} onChange={e => { setShowCleared(e.target.checked); loadJobsQueuePage(e.target.checked); }} /> Show cleared ({data.cleared})</label>}
                    {data && data.cleared > 0 && <button className="btn btn-secondary" onClick={restore}>Restore cleared</button>}
                    <button className="btn btn-secondary" disabled={!data || !data.jobs.some(j => FINISHED.has(j.status))} onClick={clearFinished}
                        title="Hide every complete, failed and cancelled job from this list. Running jobs stay. Nothing is deleted.">Clear finished jobs</button>
                    <button className="btn btn-secondary" onClick={() => loadJobsQueuePage()}>Refresh</button>
                </div>
            </div>
            <div id="jobsQueueSummary" className="mb-16">
                {view?.loading && <div className="card">Loading queue...</div>}
                {view?.error && <div className="card"><p style={{ color: '#dc2626' }}>{view.error}</p></div>}
                {data && (
                    <div className="stat-grid">
                        <div className="stat-card"><div className="stat-value">{data.total || 0}</div><div className="stat-label">Total jobs</div></div>
                        <div className="stat-card"><div className="stat-value">{s.active || 0}</div><div className="stat-label">Active</div></div>
                        <div className="stat-card"><div className="stat-value">{s.failed || 0}</div><div className="stat-label">Failed</div></div>
                        <div className="stat-card"><div className="stat-value">{s.complete || 0}</div><div className="stat-label">Complete</div></div>
                    </div>
                )}
            </div>
            <ListControlsBar list={controls} />
            <div id="jobsQueueList">
                {data && data.jobs.length > 0 && !controls.shown.length && <ListNoMatch list={controls} />}
                {data && !data.jobs.length && <div className="card"><p className="text-muted">No generation jobs for this project yet.</p></div>}
                {data && controls.shown.map(job => (
                    <div className="card mb-8" key={job.id} data-job-id={job.id} data-job-active={job.is_active ? 'true' : 'false'}>
                        <div className="flex-between">
                            <div><strong>{job.job_type}</strong> {job.created_at && <><span className="text-sm" title={String(job.created_at)}>{whenOf(job.created_at)}</span> </>}<span className="text-sm text-muted">{job.id}</span></div>
                            <StatusBadge status={job.status} />
                        </div>
                        <p className="text-sm text-muted">{job.prompt || job.model || 'No prompt/model recorded'}</p>
                        {job.error_message && <p className="text-sm" style={{ color: '#dc2626' }}>{job.error_message}</p>}
                    </div>
                ))}
            </div>
        </div>
    );
}
