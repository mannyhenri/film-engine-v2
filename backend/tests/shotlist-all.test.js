/**
 * The shot list answers EVERY shot unless a page is asked for.
 *
 * It answered 50 by default, and seven of its eight callers never asked for more: the Shot Board, scene
 * dialogue (which filters a scene's shots out of what came back, so a scene past the 50th shot read as
 * "no shots yet"), the subtitles shot picker, the export, the music session's picture, previs. Nothing
 * failed; a film past 50 shots simply lost the rest wherever it was listed. Paging stays, for a caller
 * that asks for it with `limit` or `page`.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR
    || path.join(os.tmpdir(), 'film-engine-shotlist-' + crypto.randomUUID().slice(0, 8));
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
const { handleShots } = require('../routes/shots');

const projectId = crypto.randomUUID();
const N = 130;
db.prepare('INSERT INTO film_projects (id, title) VALUES (?, ?)').run(projectId, 'Long');
const sceneId = crypto.randomUUID();
db.prepare('INSERT INTO film_scenes (id, project_id, scene_number) VALUES (?, ?, ?)').run(sceneId, projectId, 1);
const insert = db.prepare("INSERT INTO film_shots (id, scene_id, shot_code, sort_order, status) VALUES (?, ?, ?, ?, 'pending')");
for (let i = 0; i < N; i++) insert.run(crypto.randomUUID(), sceneId, 'S' + String(i).padStart(3, '0'), i);

function list(query) {
    return new Promise((resolve, reject) => {
        const res = { writeHead(s) { this.statusCode = s; }, end(b) { try { resolve({ status: this.statusCode, body: JSON.parse(b) }); } catch (e) { reject(e); } } };
        handleShots({ method: 'GET' }, res, ['film', 'projects', projectId, 'shotlist'], query);
    });
}

test('with no limit and no page, every shot comes back', async () => {
    const r = await list({});
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.shots.length, N, `answered ${r.body.shots.length} of ${N} shots — every caller that did not page lost the rest`);
    assert.strictEqual(r.body.total, N);
    assert.deepStrictEqual(r.body.shots.slice(0, 2).map(s => s.shot_code), ['S000', 'S001'], 'still in running order');
});

test('a caller that asks for a page still gets that page', async () => {
    const r = await list({ limit: '50', page: '3' });
    assert.strictEqual(r.body.shots.length, N - 100);
    assert.strictEqual(r.body.shots[0].shot_code, 'S100');
    assert.strictEqual(r.body.total, N);
    assert.strictEqual((await list({ limit: '1000' })).body.shots.length, N, 'an explicit large limit returns every shot up to the 200 cap');
});
