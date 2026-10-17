/**
 * DIRECTION: the Direct studio's saved choices (lib/production-direction.js, routes/production-studio.js).
 *
 *   - the read hands back each shot's card as the screenplay has it, with no direction until one is saved;
 *   - a saved direction comes back exactly, its revision counts up, and a stale revision is refused;
 *   - the card is never rewritten by saving direction;
 *   - a profile age is read from the character's description ("Ray Mercer, 57.");
 *   - the route answers GET, PUT studio, PUT/DELETE a shot, and refuses a shot from another film.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR
    || path.join(os.tmpdir(), 'film-engine-direction-' + crypto.randomUUID().slice(0, 8));
const { ensureSchema } = require('../db/schema');
ensureSchema();
const { db } = require('../db/database');
const dir = require('../lib/production-direction');
const { handleProductionStudio } = require('../routes/production-studio');

const P = crypto.randomUUID(), OTHER = crypto.randomUUID(), SC = crypto.randomUUID(), SH = crypto.randomUUID(), SH2 = crypto.randomUUID();
const CARD = { shot_code: '1D', description: 'The word lands.', direction: 'Ray stops.', notes: 'Ray, late forties, turns the cup.',
    dialogue: [{ character: 'JUNE', line: 'Dad.' }, { character: 'RAY MERCER', line: "I didn't have your other number." }],
    characters: ['RAY MERCER', 'JUNE'], camera: { lens: '40mm anamorphic', movement: 'pan-right', shot_type: 'close-up' },
    lighting: { notes: 'Half his face in the window light.', type: 'golden-hour' }, duration_seconds: 15 };

test.before(() => {
    for (const id of [P, OTHER]) db.prepare("INSERT INTO film_projects (id, title) VALUES (?, ?)").run(id, 'Direction ' + id.slice(0, 4));
    db.prepare("INSERT INTO film_scenes (id, project_id, scene_number, int_ext, location, time_of_day) VALUES (?, ?, 1, 'INT', 'THE DINER', 'LATE AFTERNOON')").run(SC, P);
    db.prepare("INSERT INTO film_locations (id, project_id, name, lighting_default, sound_notes) VALUES (?, ?, 'THE DINER', 'golden hour', 'room tone, gulls')").run(crypto.randomUUID(), P);
    db.prepare('INSERT INTO film_shots (id, scene_id, shot_code, scene_card_yaml, duration_ms) VALUES (?, ?, ?, ?, ?)').run(SH, SC, '1D', JSON.stringify(CARD), 15000);
    db.prepare('INSERT INTO film_shots (id, scene_id, shot_code, scene_card_yaml, duration_ms) VALUES (?, ?, ?, ?, ?)').run(SH2, SC, '1E', '', 5000);
    const ray = crypto.randomUUID();
    db.prepare("INSERT INTO film_characters (id, project_id, name, description) VALUES (?, ?, 'RAY MERCER', 'Ray Mercer, 57. Left nine years ago.')").run(ray, P);
    db.prepare("INSERT INTO film_assets (id, project_id, character_id, asset_type, file_path, file_name) VALUES ('ray-sheet', ?, ?, 'character_sheet', '/x/RAY.png', 'RAY.png')").run(P, ray);
    db.prepare("INSERT INTO film_characters (id, project_id, name, description, age_range) VALUES (?, ?, 'JUNE', 'June Mercer.', '20s')").run(crypto.randomUUID(), P);
});

test('the read hands back every shot card as written, the cast with ages, and each scene setting', () => {
    const r = dir.getDirection(db, P);
    assert.deepStrictEqual(Object.keys(r.shots).sort(), [SH, SH2].sort());
    const c = r.shots[SH].card;
    assert.deepStrictEqual(c.dialogue, CARD.dialogue);
    assert.deepStrictEqual(c.camera, CARD.camera);
    assert.strictEqual(c.duration_s, 15);
    assert.strictEqual(r.shots[SH].direction, null);
    assert.strictEqual(r.shots[SH2].card.duration_s, 5, 'a shot without a card still has its length');
    assert.deepStrictEqual(r.cast.map(x => [x.name, x.age]).sort(), [['JUNE', '20s'], ['RAY MERCER', '57']]);
    assert.deepStrictEqual(r.ref_owners, { 'ray-sheet': 'RAY MERCER' });
    assert.deepStrictEqual(r.scenes[SC], { number: 1, heading: 'INT. THE DINER', time_of_day: 'LATE AFTERNOON', setting: '', light: 'golden hour', atmosphere: '', sound: 'room tone, gulls' });
});

test('a saved direction comes back exactly, revisions count up, a stale one is refused, the card is untouched', () => {
    const data = { v: 1, dur: 12, lines: [{ id: 'l1', ch: 'JUNE', text: 'Dad?', orig: 'Dad.', t: 0.5 }], moves: [{ id: 'm1', type: 'rack', start: 3, end: 4 }] };
    assert.deepStrictEqual(dir.saveShot(db, P, SH, data), { revision: 1 });
    assert.deepStrictEqual(dir.saveShot(db, P, SH, { ...data, dur: 13 }, 1), { revision: 2 });
    assert.throws(() => dir.saveShot(db, P, SH, data, 1), e => e.status === 409 && e.code === 'DIRECTION_CONFLICT');
    const r = dir.getDirection(db, P);
    assert.deepStrictEqual(r.shots[SH].direction, { ...data, dur: 13 });
    assert.strictEqual(r.shots[SH].revision, 2);
    assert.deepStrictEqual(JSON.parse(db.prepare('SELECT scene_card_yaml FROM film_shots WHERE id = ?').get(SH).scene_card_yaml), CARD);
    dir.clearShot(db, P, SH);
    assert.strictEqual(dir.getDirection(db, P).shots[SH].direction, null);
});

test('a shot of another film, a non-object, or an oversized direction is refused', () => {
    assert.throws(() => dir.saveShot(db, OTHER, SH, { v: 1 }), e => e.status === 404);
    assert.throws(() => dir.saveShot(db, P, SH, [1, 2]), e => e.status === 400);
    assert.throws(() => dir.saveStudio(db, P, { big: 'x'.repeat(300 * 1024) }), e => e.status === 413);
});

function call(method, parts, body) {
    return new Promise(resolve => {
        const res = { status: 0, writeHead(s) { this.status = s; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } };
        handleProductionStudio({ method, body }, res, ['film', 'projects', P, 'production-studio', ...parts]);
    });
}

test('the route: GET the film, PUT the studio and a shot, DELETE a shot back to its card', async () => {
    let r = await call('PUT', ['direction', 'studio'], { data: { picked: [SH], grouped: false, mode: 'sep' } });
    assert.deepStrictEqual(r, { status: 200, body: { revision: 1 } });
    r = await call('PUT', ['direction', 'shots', SH], { data: { v: 1, dur: 9 } });
    assert.strictEqual(r.status, 200);
    r = await call('GET', ['direction']);
    assert.deepStrictEqual(r.body.studio, { picked: [SH], grouped: false, mode: 'sep' });
    assert.strictEqual(r.body.shots[SH].direction.dur, 9);
    r = await call('PUT', ['direction', 'studio'], { data: { picked: [] }, expected_revision: 0 });
    assert.strictEqual(r.status, 409);
    r = await call('DELETE', ['direction', 'shots', SH]);
    assert.deepStrictEqual(r, { status: 200, body: { cleared: true } });
    r = await call('POST', ['direction', 'shots', SH], {});
    assert.strictEqual(r.status, 405);
});

test('Runway: every video model the adapter sends is listed, named, priced, and tied to the Higgsfield model it is', async () => {
    const rw = require('../lib/runway-catalog');
    const { factsFor } = require('../lib/video-model-facts');
    const adapter = Object.keys(require('../lib/providers/runway').RUNWAY_VIDEO_MODELS);
    const list = rw.runwayModels();
    assert.deepStrictEqual(list.map(m => m.id).sort(), adapter.sort());
    for (const m of list) {
        assert.ok(rw.RUNWAY_MODELS[m.id], `${m.id}: no label`);
        assert.ok(Number.isFinite(m.credits_per_second) && m.credits_per_second > 0, `${m.id}: no rate`);
        for (const id of m.same_as) assert.ok(factsFor(id), `${m.id}: maps to unknown Higgsfield model ${id}`);
    }
    assert.deepStrictEqual(list.find(m => m.id === 'seedance2_5').same_as, ['seedance-2-5']);
    assert.strictEqual(list.find(m => m.id === 'gen4.5').own, true);
    const res = await new Promise(resolve => handleProductionStudio({ method: 'GET' },
        { writeHead(s) { this.s = s; }, end(t) { resolve({ status: this.s, body: JSON.parse(t) }); } }, ['film', 'production-studio', 'runway-models']));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.models.length, adapter.length);
    assert.strictEqual(res.body.usd_per_credit, 0.01);
});
