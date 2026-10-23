/**
 * Unified generation job queue.
 *
 * GET  /film/projects/:id/jobs                    the jobs, newest first; cleared ones left out (?include_cleared=1 shows them)
 * GET  /film/projects/:id/jobs/summary
 * POST /film/projects/:id/jobs/clear              clear the finished jobs from the queue (complete, failed, cancelled);
 *                                                 { job_ids } clears just those. Hidden, never deleted (migration 156).
 * POST /film/projects/:id/jobs/restore            bring every cleared job back
 */
const { db } = require('../db/database');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES = new Set(['pending', 'queued', 'generating', 'processing', 'running', 'planned']);
const VALID_STATUSES = new Set([...ACTIVE_STATUSES, 'paused', 'complete', 'failed', 'cancelled']);
// Finished, in every spelling the job tables use (a pipeline run ends 'completed_with_errors').
const FINISHED = ['complete', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'canceled', 'interrupted'];

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function projectExists(projectId) {
    return db.prepare('SELECT id FROM film_projects WHERE id = ?').get(projectId);
}

function handleJobs(req, res, urlParts, query) {
    if (urlParts[1] !== 'projects' || !urlParts[2] || urlParts[3] !== 'jobs') {
        return json(res, 404, { error: 'Not found' });
    }

    const projectId = urlParts[2];
    if (!UUID_RE.test(projectId)) return json(res, 400, { error: 'Invalid project ID' });
    if (!projectExists(projectId)) return json(res, 404, { error: 'Project not found' });
    if (req.method === 'POST' && urlParts[4] === 'clear') return clearJobs(req, res, projectId);
    if (req.method === 'POST' && urlParts[4] === 'restore') {
        const n = db.prepare('DELETE FROM film_job_queue_cleared WHERE project_id = ?').run(projectId).changes;
        return json(res, 200, { restored: n });
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

    if (urlParts[4] === 'summary') return getJobSummary(res, projectId, query);
    if (!urlParts[4]) return listJobs(res, projectId, query);
    return json(res, 404, { error: 'Not found' });
}

function normalizeStatus(status) {
    if (status === 'generating') return 'processing';
    if (status === 'running') return 'processing';
    return status || 'unknown';
}

function listJobs(res, projectId, query) {
    const params = [projectId];
    let sql = 'SELECT * FROM film_unified_generation_jobs WHERE project_id = ?';
    const cleared = db.prepare('SELECT COUNT(*) n FROM film_job_queue_cleared WHERE project_id = ?').get(projectId).n;
    if (!(query.include_cleared === '1' || query.include_cleared === 'true')) {
        sql += ' AND id NOT IN (SELECT job_id FROM film_job_queue_cleared WHERE project_id = ?)';
        params.push(projectId);
    }

    if (query.status && VALID_STATUSES.has(query.status)) {
        sql += ' AND status = ?';
        params.push(query.status);
    }

    if (query.type) {
        sql += ' AND job_type LIKE ?';
        params.push(`${String(query.type).slice(0, 40)}%`);
    }

    sql += ' ORDER BY created_at DESC';
    if (query.limit) {
        const limit = Math.max(1, Math.min(500, Number(query.limit) || 100));
        sql += ` LIMIT ${limit}`;
    }

    const jobs = db.prepare(sql).all(...params).map(row => ({
        ...row,
        normalized_status: normalizeStatus(row.status),
        is_active: ACTIVE_STATUSES.has(row.status),
    }));

    json(res, 200, {
        project_id: projectId,
        total: jobs.length,
        cleared,
        summary: summarize(jobs),
        jobs,
    });
}

/** Clear finished jobs from the queue: all of them, or the ones named. A running job is never cleared. */
function clearJobs(req, res, projectId) {
    const body = req.body || {};
    const finished = db.prepare(`SELECT id FROM film_unified_generation_jobs WHERE project_id = ? AND status IN (${FINISHED.map(() => '?').join(',')})`)
        .all(projectId, ...FINISHED).map(r => r.id);
    const ids = Array.isArray(body.job_ids) ? finished.filter(id => body.job_ids.map(String).includes(id)) : finished;
    const add = db.prepare('INSERT OR IGNORE INTO film_job_queue_cleared (project_id, job_id) VALUES (?, ?)');
    let n = 0;
    db.transaction(() => { for (const id of ids) n += add.run(projectId, id).changes; })();
    return json(res, 200, { cleared: n });
}

function getJobSummary(res, projectId, query) {
    const rows = db.prepare('SELECT * FROM film_unified_generation_jobs WHERE project_id = ?').all(projectId);
    const jobs = rows.map(row => ({ ...row, normalized_status: normalizeStatus(row.status) }));
    const type = query.type ? String(query.type).slice(0, 40) : '';
    const filtered = type ? jobs.filter(job => job.job_type.startsWith(type)) : jobs;
    json(res, 200, {
        project_id: projectId,
        total: filtered.length,
        summary: summarize(filtered),
    });
}

function summarize(jobs) {
    const by_status = {};
    const by_type = {};
    for (const job of jobs) {
        const status = normalizeStatus(job.status);
        by_status[status] = (by_status[status] || 0) + 1;
        by_type[job.job_type] = (by_type[job.job_type] || 0) + 1;
    }
    return {
        active: jobs.filter(job => ACTIVE_STATUSES.has(job.status)).length,
        failed: jobs.filter(job => job.status === 'failed').length,
        complete: jobs.filter(job => job.status === 'complete').length,
        by_status,
        by_type,
    };
}

module.exports = { handleJobs, summarize };
