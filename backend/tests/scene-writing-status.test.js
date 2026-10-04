/**
 * GRD-4671: each scene holds its own writing readiness (Draft, Reviewing, Production ready), bound to
 * its identity and a fingerprint of its FULL current text, separate from film_scenes.status.
 *
 * Set-based over the ways the screenplay is written (WRITERS), because readiness that one path forgets
 * to reset is readiness claimed for text nobody reviewed, and an example test on the REST PUT passes
 * while autosave, a restore or a rename quietly keeps "Production ready" on changed text.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'), path = require('path'), crypto = require('crypto');
const { Writable } = require('stream');
process.env.FILM_DATA_DIR = path.join(os.tmpdir(), 'fe-scene-writing-' + crypto.randomUUID().slice(0, 8));
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const { handleScripts } = require('../routes/scripts');
const { handleScenes } = require('../routes/scenes');
const sw = require('../lib/scene-writing');

function call(handler, method, urlPath, body, extra = {}) {
    return new Promise(resolve => {
        const parts = urlPath.split('?')[0].split('/').filter(Boolean);
        const chunks = [];
        const res = new Writable({ write(c, _e, n) { chunks.push(c); n(); } });
        res.statusCode = 200;
        res.writeHead = function (code) { this.statusCode = code; return this; };
        res.setHeader = function () {};
        res.on('finish', () => {
            let parsed = Buffer.concat(chunks).toString();
            try { parsed = JSON.parse(parsed); } catch (_) { /* not json */ }
            resolve({ status: res.statusCode, body: parsed });
        });
        Promise.resolve(handler({ method, body: body || {}, headers: {}, ...extra }, res, parts, {}))
            .catch(err => resolve({ status: 500, body: { error: err.message, stack: err.stack } }));
    });
}

const SCENES = [
    'INT. KITCHEN - DAY\n\nMaya pours coffee.\n\nMAYA\nYou are late.',
    'EXT. STREET - DUSK\n\nA shadow crosses the road.\n\nRAY\n(quietly)\nKeep walking.',
    'INT. GARAGE - NIGHT\n\nRay works under the car.',
];
const draft = scenes => scenes.join('\n\n') + '\n';

async function seed(scenes = SCENES) {
    const projectId = generateId();
    db.prepare('INSERT INTO film_projects (id, title) VALUES (?, ?)').run(projectId, 'Readiness');
    const up = await call(handleScripts, 'POST', `/film/projects/${projectId}/script`, { fountain_content: draft(scenes) });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    return { projectId, scenes: active(projectId) };
}
const active = projectId => db.prepare(`SELECT * FROM film_scenes WHERE project_id = ? AND status != 'removed'
    ORDER BY CAST(scene_number AS INTEGER), scene_number`).all(projectId);
async function list(projectId) {
    const r = await call(handleScenes, 'GET', `/film/projects/${projectId}/scenes`);
    assert.equal(r.status, 200);
    return r.body.scenes.filter(s => s.status !== 'removed');
}
async function readiness(sceneId) {
    const r = await call(handleScenes, 'GET', `/film/scenes/${sceneId}/writing-status`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
}
async function mark(p, sceneId, status, extra = {}, req = {}) {
    const cur = await readiness(sceneId);
    return call(handleScenes, 'POST', `/film/scenes/${sceneId}/writing-status`,
        { project_id: p.projectId, status, expected_fingerprint: cur.fingerprint, ...extra }, req);
}
const statusOf = async (p, id) => (await list(p.projectId)).find(s => s.id === id).writing_status;

test('the three statuses are declared; new scenes start Draft', async () => {
    assert.deepEqual([...sw.WRITING_STATUSES], ['draft', 'reviewing', 'production_ready']);
    const p = await seed();
    for (const s of await list(p.projectId)) {
        assert.equal(s.writing_status, 'draft');
        assert.match(s.writing_fingerprint, /^[0-9a-f]{64}$/);
    }
});

test('a persisted three-scene fixture holds Production ready, Draft and Reviewing at once, apart from production status', async () => {
    const p = await seed();
    const [s1, s2, s3] = p.scenes;
    assert.equal((await mark(p, s1.id, 'production_ready')).status, 200);
    assert.equal((await mark(p, s3.id, 'reviewing')).status, 200);
    // A reload: nothing cached, everything read back from the database.
    const rows = await list(p.projectId);
    assert.deepEqual(rows.map(s => s.writing_status), ['production_ready', 'draft', 'reviewing']);
    assert.deepEqual(rows.map(s => s.status), ['written', 'written', 'written'], 'production status untouched');
    for (const s of [s1, s2, s3]) assert.equal((await readiness(s.id)).writing_status, rows.find(r => r.id === s.id).writing_status);
});

test('approved production status and approved shots never promote writing readiness', async () => {
    const p = await seed();
    const s = p.scenes[0];
    db.prepare(`UPDATE film_scenes SET status = 'approved' WHERE id = ?`).run(s.id);
    db.prepare('INSERT INTO film_shots (id, scene_id, shot_code, status) VALUES (?, ?, ?, ?)').run(generateId(), s.id, '1A', 'approved');
    const row = (await list(p.projectId)).find(r => r.id === s.id);
    assert.equal(row.status, 'approved');
    assert.equal(row.writing_status, 'draft');
});

/*
 * Every way scene 2's accepted text changes. Each must reset scene 2, and only scene 2.
 */
const NEW_S2 = 'EXT. STREET - DUSK\n\nA shadow crosses the road.\n\nRAY\n(quietly)\nRun.';     // dialogue only
const WRITERS = {
    restSceneDialogueEdit: p => call(handleScenes, 'PUT', `/film/scenes/${p.scenes[1].id}`, { fountain: NEW_S2 }),
    mcpStyleFindReplace: p => call(handleScenes, 'POST', `/film/scenes/${p.scenes[1].id}/edit`,
        { edits: [{ find: 'Keep walking.', replace: 'Run.' }] }),
    scriptLevelSave: p => call(handleScripts, 'POST', `/film/projects/${p.projectId}/script`, { fountain_content: draft([SCENES[0], NEW_S2, SCENES[2]]) }),
    editorAutosave: p => call(handleScripts, 'PUT', `/film/projects/${p.projectId}/script/1`, { fountain_content: draft([SCENES[0], NEW_S2, SCENES[2]]) }),
    scriptUpdateWithSync: p => call(handleScripts, 'PUT', `/film/projects/${p.projectId}/script/1`, { fountain_content: draft([SCENES[0], NEW_S2, SCENES[2]]), update_scenes: true }),
    historyRestoreToDifferentText: async p => {
        // Version 2 has different scene-2 text; restoring version 1 brings back different text again.
        await call(handleScenes, 'PUT', `/film/scenes/${p.scenes[1].id}`, { fountain: NEW_S2 });
        await sw.refresh(db, p.projectId);
        await mark(p, p.scenes[1].id, 'production_ready');
        return call(handleScenes, 'POST', `/film/scenes/${p.scenes[1].id}/history/1/restore`, {});
    },
    // A rename writes the document directly (characters.js, locations.js), bypassing reconcile.
    directDocumentWrite: p => {
        const v = db.prepare('SELECT MAX(version) v FROM film_scripts WHERE project_id = ?').get(p.projectId).v;
        db.prepare(`INSERT INTO film_scripts (id, project_id, version, content, format, fountain_content) VALUES (?, ?, ?, '', 'fountain', ?)`)
            .run(generateId(), p.projectId, v + 1, draft([SCENES[0], NEW_S2, SCENES[2]]));
        return { status: 200 };
    },
};

for (const [name, write] of Object.entries(WRITERS)) {
    test(`text change via ${name} resets only that scene to Draft and keeps its history`, async () => {
        const p = await seed();
        const [s1, s2, s3] = p.scenes;
        await mark(p, s1.id, 'production_ready');
        await mark(p, s2.id, 'production_ready');
        await mark(p, s3.id, 'reviewing');
        const before = (await readiness(s2.id)).fingerprint;
        const r = await write(p);
        assert.ok(r.status < 300, `${name}: ${JSON.stringify(r.body)}`);
        const rows = await list(p.projectId);
        const by = id => rows.find(s => s.id === id);
        assert.equal(by(s2.id).writing_status, 'draft', name);
        assert.equal(by(s1.id).writing_status, 'production_ready', `${name}: scene 1 untouched`);
        assert.equal(by(s3.id).writing_status, 'reviewing', `${name}: scene 3 untouched`);
        const h = (await readiness(s2.id)).history;
        const reset = h.find(e => e.kind === 'auto_reset');
        assert.ok(reset, `${name}: the reset is recorded`);
        assert.equal(reset.prior_status, 'production_ready');
        assert.equal(reset.new_status, 'draft');
        assert.ok(h.some(e => e.fingerprint === before && e.new_status === 'production_ready'), `${name}: old fingerprint kept`);
    });
}

test('identical text, a moved unchanged scene and an edit elsewhere preserve readiness', async () => {
    const p = await seed();
    const [s1, s2, s3] = p.scenes;
    await mark(p, s1.id, 'production_ready');
    await mark(p, s3.id, 'reviewing');
    // Saving identical text.
    await call(handleScripts, 'POST', `/film/projects/${p.projectId}/script`, { fountain_content: draft(SCENES) });
    assert.equal(await statusOf(p, s1.id), 'production_ready');
    // Editing a different scene.
    await call(handleScenes, 'PUT', `/film/scenes/${s2.id}`, { fountain: NEW_S2 });
    assert.equal(await statusOf(p, s1.id), 'production_ready');
    assert.equal(await statusOf(p, s3.id), 'reviewing');
    // Moving scene 3 above scene 2, text unchanged.
    await call(handleScripts, 'POST', `/film/projects/${p.projectId}/script`, { fountain_content: draft([SCENES[0], SCENES[2], NEW_S2]) });
    const rows = await list(p.projectId);
    assert.ok(rows.some(s => s.id === s3.id), 'scene 3 kept its identity');
    assert.equal(rows.find(s => s.id === s3.id).writing_status, 'reviewing');
    assert.equal(rows.find(s => s.id === s1.id).writing_status, 'production_ready');
});

test('replaced scenes and ambiguous identical scenes start Draft and never inherit readiness', async () => {
    const p = await seed();
    await mark(p, p.scenes[0].id, 'production_ready');
    await call(handleScripts, 'POST', `/film/projects/${p.projectId}/script`, { fountain_content: draft(SCENES), replace_scenes: true });
    for (const s of await list(p.projectId)) assert.equal(s.writing_status, 'draft', 'a recreated scene starts Draft');

    const q = await seed([SCENES[0], SCENES[2], SCENES[2]]);       // scenes 2 and 3 identical
    const r = await mark(q, q.scenes[1].id, 'production_ready');
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'ambiguous_identity');
    for (const s of await list(q.projectId)) assert.equal(s.writing_status, 'draft');
    // A ready scene that gains an identical twin can no longer be told apart: it reads Draft.
    const u = await seed();
    await mark(u, u.scenes[2].id, 'production_ready');
    await call(handleScripts, 'POST', `/film/projects/${u.projectId}/script`, { fountain_content: draft([...SCENES, SCENES[2]]) });
    for (const s of (await list(u.projectId)).filter(s => s.location === 'GARAGE')) assert.equal(s.writing_status, 'draft');
});

test('transitions validate on the server: stale fingerprint, wrong project, bad status; retries are idempotent', async () => {
    const p = await seed();
    const s = p.scenes[0];
    const other = await seed();
    const events = () => db.prepare('SELECT COUNT(*) n FROM film_scene_writing_events WHERE scene_id = ?').get(s.id).n;
    const cases = {
        stale: [{ project_id: p.projectId, status: 'reviewing', expected_fingerprint: '0'.repeat(64) }, 409, 'version_conflict'],
        missingFingerprint: [{ project_id: p.projectId, status: 'reviewing' }, 400, 'invalid_request'],
        wrongProject: [{ project_id: other.projectId, status: 'reviewing', expected_fingerprint: (await readiness(s.id)).fingerprint }, 403, 'forbidden'],
        badStatus: [{ project_id: p.projectId, status: 'approved', expected_fingerprint: (await readiness(s.id)).fingerprint }, 400, 'invalid_request'],
    };
    for (const [name, [body, status, code]] of Object.entries(cases)) {
        const r = await call(handleScenes, 'POST', `/film/scenes/${s.id}/writing-status`, body);
        assert.equal(r.status, status, name); assert.equal(r.body.code, code, name);
        assert.equal(events(), 0, `${name} wrote nothing`);
        assert.equal(await statusOf(p, s.id), 'draft', name);
    }
    const key = { idempotency_key: 'ready-scene-1' };
    assert.equal((await mark(p, s.id, 'production_ready', key)).status, 200);
    const fp = (await readiness(s.id)).fingerprint;
    const again = await call(handleScenes, 'POST', `/film/scenes/${s.id}/writing-status`, { project_id: p.projectId, status: 'production_ready', expected_fingerprint: fp, ...key });
    assert.equal(again.status, 200); assert.equal(events(), 1, 'a retry adds no event');
    const clash = await call(handleScenes, 'POST', `/film/scenes/${s.id}/writing-status`, { project_id: p.projectId, status: 'reviewing', expected_fingerprint: fp, ...key });
    assert.equal(clash.status, 409); assert.equal(clash.body.code, 'idempotency_conflict');
});

test('UI and MCP share one service: same status and fingerprint, MCP transitions through the same validation', async () => {
    const tools = require('../lib/mcp-tools');
    for (const name of ['scene_writing_status_read', 'scene_writing_status_set']) assert.ok(tools.hasTool(name), name);
    const p = await seed();
    const s = p.scenes[1];
    const rest = await readiness(s.id);
    const mcp = tools.presentResult(await tools.callTool('scene_writing_status_read', { scene_id: s.id }));
    assert.equal(mcp.writing_status, rest.writing_status); assert.equal(mcp.fingerprint, rest.fingerprint);
    const stale = await tools.callTool('scene_writing_status_set', { project_id: p.projectId, scene_id: s.id, status: 'reviewing', expected_fingerprint: 'f'.repeat(64) });
    assert.ok(tools.isFailure(stale), 'a stale MCP transition fails');
    const ok = tools.presentResult(await tools.callTool('scene_writing_status_set', { project_id: p.projectId, scene_id: s.id, status: 'reviewing', expected_fingerprint: rest.fingerprint, reason: 'sent to the director' }));
    assert.equal(ok.writing_status, 'reviewing');
    const last = (await readiness(s.id)).history.at(-1);
    assert.equal(last.actor, 'agent'); assert.equal(last.reason, 'sent to the director');
    assert.equal(last.fingerprint, rest.fingerprint);
});

test('Production ready changes nothing else: no render, export, spend or production status', async () => {
    const p = await seed();
    const tables = ['film_scripts', 'film_shots', 'film_assets', 'film_scenes'];
    const snapshot = () => tables.map(t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n).join(',')
        + db.prepare('SELECT group_concat(status) s FROM film_scenes WHERE project_id = ?').get(p.projectId).s;
    const before = snapshot();
    for (const s of p.scenes) assert.equal((await mark(p, s.id, 'production_ready')).status, 200);
    assert.equal(snapshot(), before);
});

test('downstream warns about readiness without a new hard block', async () => {
    const { WARNINGS, preSpendEnvelope } = require('../lib/approval-envelope');
    const w = WARNINGS.find(x => x.id === 'scene_writing_not_ready');
    assert.ok(w, 'the warning is declared');
    assert.notEqual(w.severity, 'block');
    const env = preSpendEnvelope({ sceneWriting: { status: 'draft', scene_id: 's1' } });
    assert.ok(env.warnings.some(x => x.id === 'scene_writing_not_ready'));
    assert.ok(!env.warnings.some(x => x.severity === 'block'));
    assert.ok(!preSpendEnvelope({ sceneWriting: { status: 'production_ready' } }).warnings.some(x => x.id === 'scene_writing_not_ready'));
    // The scene list carries it to the page that offers generation.
    const p = await seed();
    const row = (await list(p.projectId))[0];
    assert.equal(row.writing_status, 'draft');
});

test('text changed and changed back, with no read in between, still ends readiness given to the first text', async () => {
    const p = await seed();
    const s2 = p.scenes[1];
    await mark(p, s2.id, 'production_ready');
    await call(handleScenes, 'PUT', `/film/scenes/${s2.id}`, { fountain: NEW_S2 });
    await call(handleScenes, 'PUT', `/film/scenes/${s2.id}`, { fountain: SCENES[1] });   // back to the approved text
    assert.equal(await statusOf(p, s2.id), 'draft');
});
