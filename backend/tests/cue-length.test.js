/**
 * A cue is written to the length of the cut, not to a default.
 *
 * "If we generate a soundtrack for a clip, how do we know the final length and
 * feed the right prompt?"
 *
 * Today: we do not. `buildMusicPrompt` reads
 * `cue.duration_ms || scene.estimated_duration || 30000`, and
 * `estimated_duration` is **0** on every scene in both real projects — 0 is
 * falsy, so every cue falls through to a hardcoded thirty seconds. Measured:
 * Wingfall scene 1 holds 22.08s of real footage and scene 2 holds 10.05s, and
 * both would be scored at 30s.
 *
 * The engine already knows the right number. `measuredDurations()` reads the
 * real length of every clip off disk, and the conform and all three NLE
 * exporters use it to build the film. Music was the one thing still guessing.
 *
 * What it CANNOT know is a re-cut made in Premiere: there is no FCPXML, EDL or
 * xmeml parser anywhere in this repo — the NLE seam is one-way. That is a real
 * limit and is stated rather than papered over.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR
    || path.join(os.tmpdir(), 'film-engine-cuelen-' + crypto.randomUUID().slice(0, 8));

const { db } = require('../db/database');
require('../db/schema').ensureSchema();

const { sceneCutLength, cueSeconds } = require('../lib/clip-coverage');
const { _internal: { ambientOptions } } = require('../routes/music-gen');

const PROJECT = 'cl000000-0000-4000-8000-000000000001';
const SCENE = 'cl000000-0000-4000-8000-000000000002';

test.before(() => {
    db.prepare(`INSERT INTO film_projects (id, title, created_at, updated_at)
                VALUES (?, 'p', datetime('now'), datetime('now'))`).run(PROJECT);
    db.prepare(`INSERT INTO film_scenes (id, project_id, scene_number, location, estimated_duration, created_at)
                VALUES (?, ?, 1, 'DINER', 0, datetime('now'))`).run(SCENE, PROJECT);

    // Two shots with real clips of known length.
    for (const [i, ms] of [[1, 6000], [2, 4500]]) {
        const shot = `cl000000-0000-4000-8000-00000000010${i}`;
        db.prepare(`INSERT INTO film_shots (id, scene_id, shot_code, scene_card_yaml, created_at)
                    VALUES (?, ?, ?, '{}', datetime('now'))`).run(shot, SCENE, `1${'AB'[i - 1]}`);
        db.prepare(`INSERT INTO film_assets
              (id, project_id, shot_id, asset_type, file_path, file_name, mime_type, duration_ms, version, created_at)
            VALUES (?, ?, ?, 'video_raw', ?, ?, 'video/mp4', ?, 1, datetime('now'))`)
            .run(crypto.randomUUID(), PROJECT, shot, `/tmp/${shot}.mp4`, `${shot}.mp4`, ms);
    }
});

test('the cut length is the sum of the measured clips, not an estimate', () => {
    /*
     * 0 is falsy, which is why `scene.estimated_duration` never even reached
     * the prompt — the default swallowed it. The measured length has to be
     * computed from the clips that actually exist.
     */
    assert.strictEqual(sceneCutLength(db, SCENE), 10500,
        'the scene cut length is not the sum of its measured clips');
});

test('a scene with no footage yet reports nothing, not zero', () => {
    /*
     * "No footage" and "a zero-length scene" are different answers and zero
     * cannot tell them apart — that conflation is exactly what made
     * estimated_duration: 0 fall through to a 30-second default without
     * anybody noticing.
     */
    const empty = 'cl000000-0000-4000-8000-000000000003';
    db.prepare(`INSERT INTO film_scenes (id, project_id, scene_number, location, created_at)
                VALUES (?, ?, 2, 'STREET', datetime('now'))`).run(empty, PROJECT);
    assert.strictEqual(sceneCutLength(db, empty), null,
        'a scene with no clips reports 0 rather than "nothing measured"');
});

/*
 * Music-making was retired on 2026-10-14, so the length is no longer read by a
 * score prompt. It is read by the cue that remains: the ambient bed, through
 * `ambientOptions` -> `cueSeconds` (lib/clip-coverage.js, moved from
 * scene-score.js). The same three rules hold there.
 */
test('an ambient bed is written to the measured cut when there is one', () => {
    const scene = db.prepare('SELECT * FROM film_scenes WHERE id = ?').get(SCENE);
    const opts = ambientOptions(scene, {}, null);
    assert.strictEqual(opts.bed_source, 'footage', 'the bed does not say its length came from the footage');
    assert.strictEqual(opts.bed_ms, Math.round(10500 / 1000) * 1000,
        `the bed was written at ${opts.bed_ms}ms for a 10.5s cut`);
});

test('an explicit cue length still wins', () => {
    // A bed asked to run past its scene is a decision, not a mistake.
    const scene = db.prepare('SELECT * FROM film_scenes WHERE id = ?').get(SCENE);
    const opts = ambientOptions(scene, {}, { id: 'x', cue_type: 'ambient', duration_ms: 45000 });
    assert.strictEqual(opts.bed_ms, 45000);
    assert.strictEqual(opts.bed_source, 'cue');
    assert.deepStrictEqual(cueSeconds({ cue_ms: 45000, cut_ms: 10500, explain: true }),
        { seconds: 45, source: 'cue' });
});

test('with nothing measured it says so, and never invents a number', () => {
    /*
     * The default is not the problem; a silent default is. "No footage" and a
     * zero-length scene are different answers, so nothing measured is NULL.
     */
    assert.strictEqual(cueSeconds({}), null);
    assert.deepStrictEqual(cueSeconds({ explain: true }), { seconds: null, source: 'nothing measured' });
    const empty = db.prepare('SELECT * FROM film_scenes WHERE scene_number = 2 AND project_id = ?').get(PROJECT);
    const opts = ambientOptions(empty, {}, null);
    assert.strictEqual(opts.bed_source, 'nothing measured', 'a bed with no length does not say why');
});

test('an unshot scene is measured from its cards and its dialogue, the longer of the two', () => {
    assert.deepStrictEqual(cueSeconds({ card_ms: 15000, dialogue_ms: 8000, explain: true }),
        { seconds: 15, source: 'shot cards' });
    assert.deepStrictEqual(cueSeconds({ card_ms: 5000, dialogue_ms: 216000, explain: true }),
        { seconds: 216, source: 'dialogue' });
    // Footage, once there is any, beats both.
    assert.strictEqual(cueSeconds({ cut_ms: 10000, card_ms: 15000, dialogue_ms: 216000 }), 10);
});

test('a scene cue is measured from the engine\'s own assembly, not from an imported edit', () => {
    /*
     * lib/edit-cut.js reads Premiere's XML and EDLs back. A scene CUE is still
     * measured from the engine's assembly (sceneCutLength): the edit is a whole
     * film, and reading a scene's length out of a cut is a claim nobody has
     * built. Stated here so it is not assumed.
     */
    const lib = path.join(__dirname, '..', 'lib');
    const reader = fs.readFileSync(path.join(lib, 'edit-cut.js'), 'utf8');
    assert.match(reader, /function parseXmeml\(/, 'the xmeml reader is gone');
    assert.match(reader, /function parseEdl\(/, 'the EDL reader is gone');
    const coverage = fs.readFileSync(path.join(lib, 'clip-coverage.js'), 'utf8');
    assert.ok(!/film_edits|edit-cut/.test(coverage),
        'a scene cue now reads an edit — this test and the docs should say what it follows');
});
