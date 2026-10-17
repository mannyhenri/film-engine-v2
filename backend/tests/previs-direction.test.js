/**
 * PREVIZ → GENERATE: what a shot's applied Previz says, in prompt words (lib/previs-direction.js).
 *
 *   - every axis of a move is described, with its sign the right way round (set-based over the axes);
 *   - where each named person stands and which way they face, read from the opening frame;
 *   - through the real routes: PUT a blocking with keys and a person, apply it, and the direction read
 *     (Production › Generate's one load) carries the move, the staging and the camera fields;
 *   - an unapplied stage is reported as staged, not described as decided.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Writable } = require('stream');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR
    || path.join(os.tmpdir(), 'film-engine-previs-direction-' + crypto.randomUUID().slice(0, 8));
const { ensureSchema } = require('../db/schema');
ensureSchema();
const { db } = require('../db/database');
const { describeMove, describeStaging, angleOf } = require('../lib/previs-direction');
const { handlePrevis } = require('../routes/previs');
const dir = require('../lib/production-direction');

// yaw 0 faces −Z; forward is −Z, right is +X; a turn to the right lowers yaw.
const A = { position: [0, 1.6, 0], rotation: [0, 0, 0], focalMm: 35 };
const AXES = [
    { name: 'dolly in', b: { position: [0, 1.6, -1.5] }, want: /dollies in 1\.5 m/ },
    { name: 'pull back', b: { position: [0, 1.6, 2] }, want: /pulls back 2 m/ },
    { name: 'truck right', b: { position: [1, 1.6, 0] }, want: /trucks right 1 m/ },
    { name: 'truck left', b: { position: [-1, 1.6, 0] }, want: /trucks left 1 m/ },
    { name: 'rise', b: { position: [0, 2.6, 0] }, want: /rises 1 m/ },
    { name: 'lower', b: { position: [0, 0.6, 0] }, want: /lowers 1 m/ },
    { name: 'pan right', b: { rotation: [-30, 0, 0] }, want: /pans 30° right/ },
    { name: 'pan left', b: { rotation: [30, 0, 0] }, want: /pans 30° left/ },
    { name: 'tilt up', b: { rotation: [0, 10, 0] }, want: /tilts up 10°/ },
    { name: 'tilt down', b: { rotation: [0, -10, 0] }, want: /tilts down 10°/ },
    { name: 'zoom in', b: { focalMm: 50 }, want: /zooms in from 35mm to 50mm/ },
    { name: 'zoom out', b: { focalMm: 24 }, want: /zooms out from 35mm to 24mm/ },
];

for (const ax of AXES) {
    test(`a move that only ${ax.name}s is described as that, and only that`, () => {
        const text = describeMove(A, { ...A, ...ax.b }, 1, 4, 'ease-out');
        assert.match(text, ax.want);
        assert.match(text, /^Over 4 seconds the camera /);
        const others = AXES.filter(o => o !== ax && !o.want.source.startsWith(ax.want.source.split(' ')[0]));
        for (const o of others) assert.doesNotMatch(text, o.want, `${ax.name} also read as ${o.name}`);
    });
}

test('a move in a turned frame is read in the camera\'s own frame, and the set scale applies', () => {
    // Facing +X (yaw −90): moving +X is a dolly in; at scale 2 the 1 unit is 2 m.
    const a = { position: [0, 1.6, 0], rotation: [-90, 0, 0] };
    assert.match(describeMove(a, { ...a, position: [1, 1.6, 0] }, 2, 3, ''), /dollies in 2 m/);
    assert.equal(describeMove(a, a, 1, 3, ''), 'The camera holds its position.');
});

test('staging: side of frame, distance and facing for each named person; unnamed and behind-camera are left out', () => {
    const cam = { position: [0, 1.6, 0], rotation: [0, 0, 0] };
    const out = describeStaging([
        { name: 'MAYA', position: [-1, 0, -4], rotationDeg: [0, 180, 0] },     // left, mid distance, facing +Z = the camera
        { name: 'DRAGON', position: [0.2, 0, -8], rotationDeg: [0, 0, 0] },     // centre, background, back to camera
        { name: '', position: [0, 0, -3] },                                     // scaffolding
        { name: 'BEHIND', position: [0, 0, 3] },
    ], cam, 1, 35);
    assert.deepStrictEqual(out.lines, [
        'MAYA stands frame left, in the middle distance, facing the camera.',
        'DRAGON stands centre frame, in the background, with their back to the camera.',
    ]);
    assert.equal(out.facing, 'Front');
});

test('camera height and tilt become the studio\'s angle words', () => {
    assert.equal(angleOf([0, 1.6, 0], [0, 0, 0], 1), 'Eye');
    assert.equal(angleOf([0, 1.6, 0], [0, -20, 0], 1), 'High');
    assert.equal(angleOf([0, 0.3, 0], [0, 15, 0], 1), 'Ground');
    assert.equal(angleOf([0, 1.0, 0], [0, 0, 0], 1), 'Hip');
    assert.equal(angleOf([0, 6, 0], [0, -80, 0], 1), 'Overhead');
});

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

test('through the routes: an applied blocking reaches the direction read; an unapplied one is reported as staged', async () => {
    const P = crypto.randomUUID(), SC = crypto.randomUUID(), SH = crypto.randomUUID();
    db.prepare("INSERT INTO film_projects (id, title) VALUES (?, 'Previz to Generate')").run(P);
    db.prepare("INSERT INTO film_scenes (id, project_id, scene_number, int_ext, location, time_of_day) VALUES (?, ?, 1, 'INT', 'LAB', 'NIGHT')").run(SC, P);
    db.prepare("INSERT INTO film_characters (id, project_id, name) VALUES (?, ?, 'MAYA')").run(crypto.randomUUID(), P);
    db.prepare('INSERT INTO film_shots (id, scene_id, shot_code, scene_card_yaml, duration_ms) VALUES (?, ?, ?, ?, ?)')
        .run(SH, SC, '1A', JSON.stringify({ shot_code: '1A', description: 'Maya at the bench.', camera: { shot_type: 'medium', lens: '35mm' } }), 4000);

    assert.equal(dir.getDirection(db, P).shots[SH].previs, null, 'a shot never blocked has no Previz');

    const put = await callPrevis('PUT', `/film/shots/${SH}/previs`, {
        camera: { position: [0, 1.6, 0], rotation: [0, 0, 0], focalMm: 35 }, durationMs: 4000,
        // As the Previz client sends them (worldAddKey): the unit is always named; unnamed rotations are read as radians.
        cameraKeys: [{ t: 0, position: [0, 1.6, 0], rotation: [0, 0, 0], focalMm: 35, rotationUnit: 'degrees' }, { t: 1, position: [0, 1.6, -1.5], rotation: [30, 0, 0], focalMm: 35, rotationUnit: 'degrees' }],
        subjects: [{ name: 'MAYA', kind: 'human', position: [-1, 0, -4], rotationDeg: [0, 180, 0] }],
    });
    assert.ok(put.status < 300, 'PUT blocking: ' + JSON.stringify(put.body).slice(0, 200));
    const staged = dir.getDirection(db, P).shots[SH].previs;
    assert.equal(staged.applied, false, 'a stage that was never applied is not presented as decided');

    const applied = await callPrevis('POST', `/film/shots/${SH}/previs/apply`);
    assert.ok(applied.status < 300, 'apply: ' + JSON.stringify(applied.body).slice(0, 200));
    const pv = dir.getDirection(db, P).shots[SH].previs;
    assert.equal(pv.applied, true, `state ${pv.state}`);
    assert.match(pv.move, /dollies in 1\.5 m and pans 30° left/);
    assert.deepStrictEqual(pv.staging, ['MAYA stands frame left, in the middle distance, facing the camera.']);
    assert.equal(pv.lens, 35);
    assert.equal(pv.angle, 'Eye');
    assert.equal(pv.facing, 'Front');
    assert.ok(pv.sig && pv.sig !== staged.sig || pv.sig, 'a signature to tell a later change by');
});
