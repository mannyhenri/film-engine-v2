/**
 * Job Queue Clear (routes/jobs.js, migration 156): finished jobs leave the queue and come back on Restore; a job still
 * running is never cleared; nothing is deleted from the job tables, which other routes read.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-jobs-clear-'));
process.env.FILM_DATA_DIR = path.join(TMP, 'data');
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const { handleJobs } = require('../routes/jobs');

const pid = generateId();
db.prepare('INSERT INTO film_projects (id, title) VALUES (?, ?)').run(pid, 'Clear test');
const job = (status, when) => { const id = generateId(); db.prepare("INSERT INTO film_music_jobs (id, project_id, gen_type, status, prompt, created_at) VALUES (?, ?, 'score', ?, 'cue', ?)").run(id, pid, status, when); return id; };
const done = job('complete', '2026-10-22 10:00:00'), failed = job('failed', '2026-10-22 11:00:00'), running = job('generating', '2026-10-23 09:00:00');

function call(method, parts, body, query = {}) {
    return new Promise(resolve => {
        const res = { status: 0, writeHead(c) { this.status = c; }, end(b) { resolve({ status: this.status, body: JSON.parse(b) }); } };
        handleJobs({ method, body: body || {} }, res, ['film', 'projects', pid, 'jobs', ...parts], query);
    });
}

test('each job carries when it was made, newest first', async () => {
    const r = await call('GET', []);
    assert.deepStrictEqual(r.body.jobs.map(j => [j.id, j.created_at]), [[running, '2026-10-23 09:00:00'], [failed, '2026-10-22 11:00:00'], [done, '2026-10-22 10:00:00']]);
    assert.strictEqual(r.body.cleared, 0);
});

test('Clear hides every finished job and never a running one; Restore brings them back; the job rows stay', async () => {
    assert.strictEqual((await call('POST', ['clear'])).body.cleared, 2);
    let r = await call('GET', []);
    assert.deepStrictEqual(r.body.jobs.map(j => j.id), [running]);
    assert.strictEqual(r.body.cleared, 2);
    assert.strictEqual((await call('GET', [], null, { include_cleared: '1' })).body.jobs.length, 3);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM film_music_jobs WHERE project_id = ?').get(pid).n, 3, 'hidden, not deleted');
    // The running job finishes later: it shows, since only what was finished at Clear was cleared.
    db.prepare("UPDATE film_music_jobs SET status = 'complete' WHERE id = ?").run(running);
    assert.deepStrictEqual((await call('GET', [])).body.jobs.map(j => j.id), [running]);
    assert.strictEqual((await call('POST', ['restore'])).body.restored, 2);
    assert.strictEqual((await call('GET', [])).body.jobs.length, 3);
});

test('every finished state is cleared, as the job tables write it: a pipeline run ends completed_with_errors', async () => {
    const run = generateId();
    db.prepare("INSERT INTO film_pipeline_runs (id, project_id, status, created_at) VALUES (?, ?, 'completed_with_errors', '2026-10-21 09:00:00')").run(run, pid);
    assert.ok((await call('GET', [])).body.jobs.some(j => j.id === run));
    await call('POST', ['clear']);
    assert.ok(!(await call('GET', [])).body.jobs.some(j => j.id === run), 'a run that finished with errors is finished');
    await call('POST', ['restore']);
    db.prepare('DELETE FROM film_pipeline_runs WHERE id = ?').run(run);
});

test('naming jobs clears just those, and only if finished', async () => {
    const queued = job('pending', '2026-10-23 10:00:00');   // waiting to run
    assert.strictEqual((await call('POST', ['clear'], { job_ids: [done, queued] })).body.cleared, 1);
    assert.deepStrictEqual((await call('GET', [])).body.jobs.map(j => j.id).sort(), [running, failed, queued].sort());
    await call('POST', ['restore']);
});

// Set-based: every table the Job Queue reads (the view's own FROM list), one finished job in each.
test('every job table the queue reads: each job shows with its date, Clear hides it, Restore brings it back', async () => {
    await call('POST', ['restore']);
    const view = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'film_unified_generation_jobs'").get().sql;
    const tables = [...new Set([...view.matchAll(/FROM (film_\w+)/g)].map(m => m[1]))];
    assert.ok(tables.length >= 12, `the view reads ${tables.length} tables`);
    const sceneId = generateId(), shotId = generateId();
    db.prepare('INSERT INTO film_scenes (id, project_id, scene_number) VALUES (?, ?, 1)').run(sceneId, pid);
    db.prepare('INSERT INTO film_shots (id, scene_id, shot_code) VALUES (?, ?, ?)').run(shotId, sceneId, 'Z1');
    const subj = { character_id: generateId(), location_id: generateId(), prop_id: generateId() };
    db.prepare('INSERT INTO film_characters (id, project_id, name) VALUES (?, ?, ?)').run(subj.character_id, pid, 'JUNE');
    db.prepare('INSERT INTO film_locations (id, project_id, name) VALUES (?, ?, ?)').run(subj.location_id, pid, 'DINER');
    db.prepare('INSERT INTO film_props (id, project_id, name) VALUES (?, ?, ?)').run(subj.prop_id, pid, 'CUP');
    const made = {};
    for (const t of tables) {
        const cols = db.prepare(`PRAGMA table_info(${t})`).all();
        const fill = c => c.name === 'id' ? generateId() : c.name === 'project_id' ? pid : c.name === 'shot_id' ? shotId : c.name === 'scene_id' ? sceneId : subj[c.name] ? subj[c.name]
            : c.name === 'created_at' ? '2026-10-20 08:30:00' : /INT|REAL|NUM/i.test(c.type) ? 0 : /json|params|meta/i.test(c.name) ? '{}' : 'x';
        const need = cols.filter(c => ['id', 'project_id', 'created_at', 'status'].includes(c.name) || (c.notnull && c.dflt_value == null));
        let id = null;
        for (const status of ['complete', 'completed', 'done', 'failed']) {
            const vals = need.map(c => c.name === 'status' ? status : fill(c));
            try { db.prepare(`INSERT INTO ${t} (${need.map(c => c.name).join(', ')}) VALUES (${need.map(() => '?').join(', ')})`).run(...vals); id = vals[need.findIndex(c => c.name === 'id')]; break; }
            catch (e) { if (!/CHECK|constraint/i.test(e.message)) throw new Error(`${t}: ${e.message}`); }
        }
        assert.ok(id, `${t}: no finished status its CHECK accepts`);
        made[t] = id;
    }
    const listed = new Map((await call('GET', [])).body.jobs.map(j => [j.id, j]));
    const finished = new Set(['complete', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'canceled', 'interrupted']);
    for (const [t, id] of Object.entries(made)) {
        assert.ok(listed.has(id), `${t}: its job is not in the queue`);
        assert.strictEqual(listed.get(id).created_at, '2026-10-20 08:30:00', `${t}: no date`);
    }
    await call('POST', ['clear']);
    const after = new Set((await call('GET', [])).body.jobs.map(j => j.id));
    for (const [t, id] of Object.entries(made)) {
        const st = listed.get(id).status;
        if (finished.has(st)) assert.ok(!after.has(id), `${t}: a finished job (${st}) was not cleared`);
        else assert.ok(after.has(id), `${t}: status ${st} is not one the queue counts finished, so it stays`);
    }
    await call('POST', ['restore']);
    const back = new Set((await call('GET', [])).body.jobs.map(j => j.id));
    for (const [t, id] of Object.entries(made)) assert.ok(back.has(id), `${t}: not restored`);
    console.log('statuses per table:', Object.fromEntries(Object.entries(made).map(([t, id]) => [t, listed.get(id).status])));
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
