/**
 * Previz › Apply to shot reaches Production › Generate with the FRAMING Previz shows, and with when it was applied.
 *
 * The bug: Apply sent nothing about framing (the blocking has no shot_type column), so Generate took the card's old
 * shot_type ("dolly", read as Medium) whatever the camera framed; and Generate could not tell an Apply made after
 * its own edits from one made before. Set-based over every crew framing (lib/framing FRAMINGS).
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Writable } = require('stream');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR
    || path.join(os.tmpdir(), 'film-engine-previz-apply-' + crypto.randomUUID().slice(0, 8));
const { ensureSchema } = require('../db/schema');
ensureSchema();
const { db } = require('../db/database');
const { handlePrevis } = require('../routes/previs');
const dir = require('../lib/production-direction');
const { FRAMINGS } = require('../lib/framing');

function callPrevis(method, urlPath, body) {
    return new Promise(resolve => {
        const parts = urlPath.split('?')[0].split('/').filter(Boolean);
        const req = { method, body: body || {} };
        const chunks = [];
        const res = new Writable({ write(c, _e, n) { chunks.push(c); n(); } });
        res.statusCode = 200;
        res.writeHead = function (code) { this.statusCode = code; return this; };
        res.setHeader = function () {};
        res.on('finish', () => { const raw = Buffer.concat(chunks).toString(); let p = raw; try { p = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: p }); });
        Promise.resolve(handlePrevis(req, res, parts, {})).catch(err => resolve({ status: 500, body: { error: err.message } }));
    });
}

function shotWithStage() {
    const P = crypto.randomUUID(), SC = crypto.randomUUID(), SH = crypto.randomUUID();
    db.prepare("INSERT INTO film_projects (id, title) VALUES (?, 'Apply framing')").run(P);
    db.prepare("INSERT INTO film_scenes (id, project_id, scene_number, int_ext, location, time_of_day) VALUES (?, ?, 1, 'INT', 'DINER', 'DAY')").run(SC, P);
    // As The Glass Harbour's 1A: a card whose shot_type is a rig word, not a size.
    db.prepare('INSERT INTO film_shots (id, scene_id, shot_code, scene_card_yaml, duration_ms) VALUES (?, ?, ?, ?, ?)')
        .run(SH, SC, '1A', JSON.stringify({ shot_code: '1A', description: 'The diner.', camera: { shot_type: 'dolly', lens: '12mm' } }), 4000);
    return { P, SH };
}

for (const f of FRAMINGS) {
    test(`Apply with the framing Previz shows (${f.short}) makes it the framing Generate reads`, async () => {
        const { P, SH } = shotWithStage();
        const put = await callPrevis('PUT', `/film/shots/${SH}/previs`, { camera: { position: [0, 1.6, 0], rotation: [0, 0, 0], focalMm: 14 }, durationMs: 4000 });
        assert.ok(put.status < 300, JSON.stringify(put.body).slice(0, 200));
        const applied = await callPrevis('POST', `/film/shots/${SH}/previs/apply`, { framing: f.id });
        assert.ok(applied.status < 300, JSON.stringify(applied.body).slice(0, 200));
        assert.equal(applied.body.camera_after.framing, f.id);
        const pv = dir.getDirection(db, P).shots[SH].previs;
        assert.equal(pv.applied, true, `state ${pv.state}`);
        assert.equal(pv.framing, f.label, 'Generate reads the framing Previz showed, not the card\'s "dolly"');
        assert.equal(pv.lens, 14);
        assert.ok(pv.applied_at, 'when it was applied, so Generate can tell which is newer');
    });
}

test('an Apply with no framing, or one that is not a crew framing, leaves the card\'s; the direction read says when it was saved', async () => {
    const { P, SH } = shotWithStage();
    await callPrevis('PUT', `/film/shots/${SH}/previs`, { camera: { position: [0, 1.6, 0], rotation: [0, 0, 0], focalMm: 14 }, durationMs: 4000 });
    for (const body of [{}, { framing: 'dolly' }, { framing: '<b>' }]) {
        const r = await callPrevis('POST', `/film/shots/${SH}/previs/apply`, body);
        assert.ok(r.status < 300, JSON.stringify(r.body).slice(0, 200));
        assert.equal(r.body.camera_after.framing, undefined);
        assert.equal(dir.getDirection(db, P).shots[SH].previs.framing, 'dolly');
    }
    assert.equal(dir.getDirection(db, P).shots[SH].updated_at, null, 'nothing saved in Generate yet');
    dir.saveShot(db, P, SH, { v: 1, cam: { framing: 'MS' } });
    assert.match(String(dir.getDirection(db, P).shots[SH].updated_at), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});
