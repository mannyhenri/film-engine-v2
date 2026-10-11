const ACTIVE = ['running','validating','encoding','cancelling'];
const TABLES = new Set(['production_depth_jobs','production_composite_jobs']);

/** Reconcile only confirmed exited owners; never resume their inference. */
function reconcileProcessingJobs(db, table, owned, projectId) {
    if (!TABLES.has(table)) throw Error('Unknown processing job table');
    const scoped = projectId === undefined ? '' : ' AND project_id=?';
    const jobs = db.prepare(`SELECT id,status,owner_pid,owner_token FROM ${table} WHERE status IN (${ACTIVE.map(()=>'?')})${scoped}`)
        .all(...ACTIVE, ...(projectId === undefined ? [] : [projectId]));
    for (const job of jobs) {
        if (owned.has(job.id) || !Number.isSafeInteger(job.owner_pid) || job.owner_pid < 1) continue;
        try {process.kill(job.owner_pid, 0);} catch (error) {
            if (error.code !== 'ESRCH') continue;
            db.prepare(`UPDATE ${table} SET status='interrupted',phase='Previous worker stopped; inspect and review before retry',owner_pid=0,owner_token='',finished_at=datetime('now') WHERE id=? AND status=? AND owner_pid=? AND owner_token=?`)
                .run(job.id, job.status, job.owner_pid, job.owner_token);
        }
    }
}

module.exports = {reconcileProcessingJobs};
