import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

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

export default function JobsQueuePage() {
    const [view, setView] = useState(null); // null | { loading } | { error } | { data }

    async function loadJobsQueuePage() {
        const pid = legacy.state.currentProject && legacy.state.currentProject.id;
        if (!pid) { legacy.setStatus('Open a project first'); return; }
        setView({ loading: true });
        try { setView({ data: await legacy.api(`/projects/${pid}/jobs`) }); }
        catch (err) { setView({ error: err.message }); }
    }
    usePageLoader('loadJobsQueuePage', loadJobsQueuePage);

    const data = view?.data;
    const s = data?.summary || {};
    return (
        <div className="page" id="page-jobsqueue">
            <div className="flex-between mb-16">
                <h2>Job Queue</h2>
                <button className="btn btn-secondary" onClick={() => loadJobsQueuePage()}>Refresh</button>
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
            <div id="jobsQueueList">
                {data && !data.jobs.length && <div className="card"><p className="text-muted">No generation jobs for this project yet.</p></div>}
                {data && data.jobs.map(job => (
                    <div className="card mb-8" key={job.id}>
                        <div className="flex-between">
                            <div><strong>{job.job_type}</strong> <span className="text-sm text-muted">{job.id}</span></div>
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
