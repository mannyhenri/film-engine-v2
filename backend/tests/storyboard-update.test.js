/**
 * Update storyboard: the Screenplay page's "put my screenplay changes on the board".
 *
 * What resync could not do is the reason this exists: a line rewritten in the
 * screenplay came back from resync as "changed or gone" and the card kept the
 * old words. So these hold the new behaviour (rewritten, added and cut lines
 * reach the right card) AND the restraint it keeps (a line never moves to
 * another card, the director's prose is never touched, no shot is created or
 * deleted) AND the contract of the two steps: the plan writes nothing, and the
 * apply writes only the plan that was reviewed.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Writable } = require('stream');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR
    || path.join(os.tmpdir(), 'film-engine-storyboard-update-' + crypto.randomUUID().slice(0, 8));

const { db, generateId } = require('../db/database');
const { ensureSchema } = require('../db/schema');
ensureSchema();

const { handleScripts } = require('../routes/scripts');
const { handleProductionReports } = require('../routes/production-reports');
const { planStoryboardUpdate, applyStoryboardUpdate, align, voiceOf } = require('../lib/storyboard-update');
const { drift, stampShot } = require('../lib/screenplay-drift');

function call(handler, method, urlPath, body) {
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
        Promise.resolve(handler({ method, body: body || {} }, res, parts, {}))
            .catch(err => resolve({ status: 500, body: { error: err.message } }));
    });
}

const DRAFT = `INT. DINER - DAY

Ray and June in a booth. A SALT SHAKER between them.

RAY
You look like her.

JUNE
People say that.

RAY
Coffee's still bad here.

JUNE
You called me at work.

RAY
I didn't have your other number.
`;

const card = (code, dialogue, extra = {}) => ({
    shot_code: code,
    description: `Shot ${code}: the booth, held.`,
    camera: { lens: '40mm', movement: 'static', shot_type: 'medium' },
    direction: `Direction for ${code}.`,
    duration_seconds: 6,
    notes: `Notes for ${code}.`,
    characters: ['RAY', 'JUNE'],
    props: [],
    dialogue,
    ...extra,
});

/** A film whose three cards carry the draft's five lines: 1A two, 1B one, 1C two. */
async function seed() {
    const projectId = generateId();
    db.prepare('INSERT INTO film_projects (id, title) VALUES (?, ?)').run(projectId, 'Update Test');
    db.prepare('INSERT INTO film_characters (id, project_id, name) VALUES (?, ?, ?)').run(generateId(), projectId, 'RAY');
    db.prepare('INSERT INTO film_characters (id, project_id, name) VALUES (?, ?, ?)').run(generateId(), projectId, 'JUNE');
    const up = await call(handleScripts, 'POST', `/film/projects/${projectId}/script`, { fountain_content: DRAFT });
    assert.strictEqual(up.status, 201, JSON.stringify(up.body));
    const scene = db.prepare('SELECT * FROM film_scenes WHERE project_id = ?').get(projectId);
    const shots = {};
    const cards = {
        '1A': card('1A', [{ character: 'RAY', line: 'You look like her.' }, { character: 'JUNE', line: 'People say that.' }]),
        '1B': card('1B', [{ character: 'RAY', line: "Coffee's still bad here." }]),
        '1C': card('1C', [{ character: 'JUNE', line: 'You called me at work.' }, { character: 'RAY', line: "I didn't have your other number." }]),
    };
    Object.entries(cards).forEach(([code, c], i) => {
        const id = generateId();
        db.prepare('INSERT INTO film_shots (id, scene_id, shot_code, scene_card_yaml, sort_order) VALUES (?, ?, ?, ?, ?)')
            .run(id, scene.id, code, JSON.stringify(c), i);
        stampShot(id, scene.id);
        shots[code] = id;
    });
    db.prepare(`INSERT INTO film_previs_blocking (id, shot_id, camera_json, subject_json, stage_json)
                VALUES (?, ?, '{}', '{}', '{}')`).run(generateId(), shots['1A']);
    return { projectId, sceneId: scene.id, shots };
}

/** Save a new draft, the way the Screenplay page's save does. */
async function rewrite(projectId, fountain) {
    const r = await call(handleScripts, 'POST', `/film/projects/${projectId}/script`, { fountain_content: fountain });
    assert.ok(r.status < 300, JSON.stringify(r.body));
}

const cardOf = (id) => JSON.parse(db.prepare('SELECT scene_card_yaml FROM film_shots WHERE id = ?').get(id).scene_card_yaml);
const linesOf = (id) => (cardOf(id).dialogue || []).map(d => `${d.character}: ${d.line}`);
const shotPlan = (plan, code) => plan.scenes.flatMap(sc => sc.shots).find(s => s.shot_code === code);

const REVISED = DRAFT
    .replace('You look like her.', 'You look just like her.')                              // rewritten, on 1A
    .replace("RAY\nCoffee's still bad here.\n", "RAY\nCoffee's still bad here.\n\nJUNE\nEvery other Sunday.\n") // added, after 1B's line
    .replace("RAY\nI didn't have your other number.\n", '');                                 // cut, from 1C

test('the plan says which cards change and how, and writes absolutely nothing', async () => {
    const s = await seed();
    await rewrite(s.projectId, REVISED);
    const before = db.prepare('SELECT id, scene_card_yaml, scene_fingerprint FROM film_shots WHERE scene_id = ? ORDER BY id').all(s.sceneId);

    const plan = planStoryboardUpdate(s.projectId);
    assert.strictEqual(plan.applied, false);
    assert.strictEqual(plan.spends, 0);
    assert.strictEqual(plan.cards_to_update, 3, JSON.stringify(plan.scenes));
    assert.deepStrictEqual(shotPlan(plan, '1A').changes.map(c => [c.kind, c.from, c.to]),
        [['line_changed', 'You look like her.', 'You look just like her.']]);
    assert.deepStrictEqual(shotPlan(plan, '1B').changes.map(c => [c.kind, c.line, c.after]),
        [['line_added', 'Every other Sunday.', "Coffee's still bad here."]]);
    assert.deepStrictEqual(shotPlan(plan, '1C').changes.map(c => [c.kind, c.line]),
        [['line_removed', "I didn't have your other number."]]);

    const after = db.prepare('SELECT id, scene_card_yaml, scene_fingerprint FROM film_shots WHERE scene_id = ? ORDER BY id').all(s.sceneId);
    assert.deepStrictEqual(after, before, 'planning wrote to a card or a fingerprint');
});

test('confirming puts the new words on the cards, and the warning clears', async () => {
    const s = await seed();
    await rewrite(s.projectId, REVISED);
    assert.ok(drift(s.projectId).length > 0, 'nothing was behind, so the test proves nothing');

    const plan = planStoryboardUpdate(s.projectId);
    const done = applyStoryboardUpdate(s.projectId, plan.plan_id);
    assert.strictEqual(done.applied, true);
    assert.strictEqual(done.cards_to_update, 3);

    assert.deepStrictEqual(linesOf(s.shots['1A']), ['RAY: You look just like her.', 'JUNE: People say that.']);
    assert.deepStrictEqual(linesOf(s.shots['1B']), ["RAY: Coffee's still bad here.", 'JUNE: Every other Sunday.']);
    assert.deepStrictEqual(linesOf(s.shots['1C']), ['JUNE: You called me at work.']);
    assert.strictEqual(drift(s.projectId).length, 0, 'the board still says the screenplay changed');

    const again = planStoryboardUpdate(s.projectId);
    assert.strictEqual(again.cards_to_update, 0, `a second update would change more: ${JSON.stringify(again.scenes)}`);
    assert.strictEqual(again.cards_marked_current, 0);
});

test('the director’s work, the shots and what hangs off them are never touched', async () => {
    const s = await seed();
    await rewrite(s.projectId, REVISED);
    const shotsBefore = db.prepare('SELECT id, shot_code, sort_order FROM film_shots WHERE scene_id = ? ORDER BY sort_order').all(s.sceneId);
    applyStoryboardUpdate(s.projectId, planStoryboardUpdate(s.projectId).plan_id);

    assert.deepStrictEqual(db.prepare('SELECT id, shot_code, sort_order FROM film_shots WHERE scene_id = ? ORDER BY sort_order').all(s.sceneId),
        shotsBefore, 'a shot was created, deleted, renamed or reordered');
    for (const code of ['1A', '1B', '1C']) {
        const c = cardOf(s.shots[code]);
        assert.strictEqual(c.description, `Shot ${code}: the booth, held.`);
        assert.strictEqual(c.direction, `Direction for ${code}.`);
        assert.strictEqual(c.notes, `Notes for ${code}.`);
        assert.strictEqual(c.duration_seconds, 6);
        assert.deepStrictEqual(c.camera, { lens: '40mm', movement: 'static', shot_type: 'medium' });
    }
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM film_previs_blocking WHERE shot_id = ?').get(s.shots['1A']).c, 1,
        'the blocking went with the update');
});

test('a line never moves to another card: the cards keep the order the screenplay has', async () => {
    // The screenplay swaps two lines that sit on different cards. Moving them between
    // cards is a coverage decision; the update takes each off its card and puts the new
    // one beside the line before it, and says so.
    const s = await seed();
    const swapped = DRAFT.replace("RAY\nCoffee's still bad here.\n\nJUNE\nYou called me at work.\n",
        "JUNE\nYou called me at work.\n\nRAY\nCoffee's still bad here.\n");
    await rewrite(s.projectId, swapped);
    const plan = planStoryboardUpdate(s.projectId);
    applyStoryboardUpdate(s.projectId, plan.plan_id);
    const all = ['1A', '1B', '1C'].flatMap(code => linesOf(s.shots[code]));
    assert.deepStrictEqual(all, ['RAY: You look like her.', 'JUNE: People say that.', 'JUNE: You called me at work.',
        "RAY: Coffee's still bad here.", "RAY: I didn't have your other number."], 'the board no longer reads as the screenplay does');
    // Each line is on exactly one card.
    assert.strictEqual(new Set(all).size, all.length, 'a line was put on two cards');
});

test('CONT\'D never reaches a card; a voice-over does', async () => {
    assert.strictEqual(voiceOf("CONT'D"), '');
    assert.strictEqual(voiceOf('V.O.'), 'V.O.');
    assert.strictEqual(voiceOf("O.S., CONT'D"), 'O.S.');
    const s = await seed();
    await rewrite(s.projectId, DRAFT
        .replace('JUNE\nYou called me at work.', "JUNE (CONT'D)\nYou called me at work.")
        .replace("RAY\nI didn't have your other number.", "RAY (V.O.)\nI didn't have your other number."));
    const plan = planStoryboardUpdate(s.projectId);
    assert.deepStrictEqual(plan.scenes.flatMap(sc => sc.shots).map(sh => sh.shot_code), ['1C'], JSON.stringify(plan.scenes));
    applyStoryboardUpdate(s.projectId, plan.plan_id);
    const lines = cardOf(s.shots['1C']).dialogue;
    assert.strictEqual(lines[0].extension, undefined, 'CONT\'D was written onto a card');
    assert.strictEqual(lines[1].extension, 'V.O.');
});

test('only the plan that was reviewed is applied: a screenplay edit in between is refused, and nothing is written', async () => {
    const s = await seed();
    await rewrite(s.projectId, REVISED);
    const reviewed = planStoryboardUpdate(s.projectId);
    await rewrite(s.projectId, REVISED.replace('People say that.', 'People always say that.'));
    const before = db.prepare('SELECT id, scene_card_yaml FROM film_shots WHERE scene_id = ? ORDER BY id').all(s.sceneId);

    assert.throws(() => applyStoryboardUpdate(s.projectId, reviewed.plan_id), err => err.code === 'PLAN_CHANGED'
        && err.plan && err.plan.plan_id !== reviewed.plan_id
        && shotPlan(err.plan, '1A').changes.some(c => c.to === 'People always say that.'));
    assert.deepStrictEqual(db.prepare('SELECT id, scene_card_yaml FROM film_shots WHERE scene_id = ? ORDER BY id').all(s.sceneId), before,
        'a plan nobody saw was written');
});

test('the route: GET plans, POST applies only with the plan id, and a moved plan answers 409 with the new one', async () => {
    const s = await seed();
    await rewrite(s.projectId, REVISED);
    const url = `/film/projects/${s.projectId}/storyboard-update`;
    const plan = await call(handleProductionReports, 'GET', url);
    assert.strictEqual(plan.status, 200);
    assert.strictEqual(plan.body.cards_to_update, 3);

    assert.strictEqual((await call(handleProductionReports, 'POST', url, {})).status, 400, 'applied without a reviewed plan');
    const stale = await call(handleProductionReports, 'POST', url, { plan_id: 'not-the-plan' });
    assert.strictEqual(stale.status, 409);
    assert.strictEqual(stale.body.plan.plan_id, plan.body.plan_id);

    const done = await call(handleProductionReports, 'POST', url, { plan_id: plan.body.plan_id });
    assert.strictEqual(done.status, 200, JSON.stringify(done.body));
    assert.strictEqual(done.body.applied, true);
    assert.strictEqual((await call(handleProductionReports, 'GET', `/film/projects/${generateId()}/storyboard-update`)).status, 404);
});

test('the alignment pairs a rewrite in place and never crosses', () => {
    const cardLines = [{ character: 'RAY', line: 'A.' }, { character: 'JUNE', line: 'Dad.' }, { character: 'RAY', line: 'C.' }];
    const script = [{ character: 'RAY', line: 'A.' }, { character: 'JUNE', line: 'Father.' }, { character: 'RAY', line: 'C.' }];
    assert.deepStrictEqual(align(cardLines, script).map(o => o.op), ['same', 'changed', 'same']);
    const moved = [{ character: 'RAY', line: 'C.' }, { character: 'RAY', line: 'A.' }];
    const ops = align([{ character: 'RAY', line: 'A.' }, { character: 'RAY', line: 'C.' }], moved);
    for (let i = 1; i < ops.length; i++) {
        if (ops[i].card !== undefined && ops[i - 1].card !== undefined) assert.ok(ops[i].card > ops[i - 1].card);
        if (ops[i].script !== undefined && ops[i - 1].script !== undefined) assert.ok(ops[i].script > ops[i - 1].script);
    }
});
