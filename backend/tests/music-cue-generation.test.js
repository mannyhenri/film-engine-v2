/**
 * The cue you wrote is the cue that gets generated
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "routes/music-gen.js:222 — SELECT * FROM film_music_cues WHERE scene_id = ?
 *  ORDER BY start_ms LIMIT 1. No cue_type filter. Your ambient, sfx and score
 *  cues all sit at start_ms: 0, so the tie breaks arbitrarily and the ambient
 *  cue — 'Lot Air', crickets and highway — gets used as the score."
 *
 * Exactly right, and the important half is that it is INDEPENDENT of which tool
 * was reached for: the correct route selected its cue the same way, so a scene
 * carrying both an ambient bed and a score would have scored itself with
 * crickets whatever anyone pressed. Nothing errors. The file plays. It is the
 * wrong piece of music, and the only signal is a director listening to it.
 *
 * `ORDER BY start_ms LIMIT 1` is not a tie-break, it is a coin toss: SQLite is
 * free to return either row when the sort key is equal, and every cue on a
 * scene legitimately starts at 0.
 *
 * Two more in the same area, both real:
 *
 *  - NO TOOL COULD GENERATE A WRITTEN CUE. `music_cue_create`, `_update`,
 *    `_list` and `music_brief` all existed, and then there was nothing to
 *    generate with — so the only generation surface an agent could see was
 *    `node_gen_music`, which derives its own prompt from the scene and ignores
 *    the cue entirely. Cue-authoring no tool can act on is the "capability with
 *    no control" case, pointed the other way.
 *
 *  - `film_music_cues.generated_asset_id` has existed since migration 016 and
 *    is written by NOTHING. So a scene could hold a cue and an audio asset with
 *    no link between them, and "has this cue been generated" had no answer.
 *
 * SET-BASED OVER THE CUE VOCABULARY, derived from the CHECK constraint rather
 * than typed here: the failure is per-kind, and a filter that fixes the score
 * while ambient still selects anything is the same bug one row down.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR
    || path.join(os.tmpdir(), 'film-engine-mcue-' + crypto.randomUUID().slice(0, 8));

const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();

const ROOT = path.join(__dirname, '..');
const MUSIC_SRC = fs.readFileSync(path.join(ROOT, 'routes', 'music-gen.js'), 'utf8');

/** The kinds a cue may be, read from the constraint that enforces them. */
function cueKinds() {
    const sql = fs.readFileSync(
        path.join(ROOT, 'db', 'migrations', '016_film_music_and_color.sql'), 'utf8');
    const m = /cue_type IN \(([^)]*)\)/.exec(sql);
    assert.ok(m, 'the cue_type vocabulary could not be read from its migration');
    return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

test('the cue vocabulary is read from the constraint, and has several kinds', () => {
    const kinds = cueKinds();
    assert.ok(kinds.length >= 4, `expected the real vocabulary, saw ${JSON.stringify(kinds)}`);
    for (const needed of ['score', 'ambient', 'sfx']) {
        assert.ok(kinds.includes(needed), `${needed} is missing from the vocabulary`);
    }
});

// ---------------------------------------------------------------------------
// 1. No generation path may select a cue without saying which kind it wants
// ---------------------------------------------------------------------------

test('every cue lookup filters by kind', () => {
    /*
     * Derived from the source: any SELECT against film_music_cues that is
     * choosing ONE cue to generate from must say which kind. A bare
     * `ORDER BY start_ms LIMIT 1` picks whichever row SQLite hands back first
     * among rows that all legitimately start at 0.
     */
    const unfiltered = [];
    const lines = MUSIC_SRC.split('\n');
    lines.forEach((line, i) => {
        if (!/FROM film_music_cues/.test(line)) return;
        if (!/LIMIT 1/.test(line)) return;               // listing every cue is fine
        if (!/cue_type/.test(line)) {
            unfiltered.push(`music-gen.js:${i + 1} selects one cue with no cue_type filter — `
                + `every cue on a scene starts at 0, so this is a coin toss`);
        }
    });
    assert.deepStrictEqual(unfiltered, [], unfiltered.join('\n  '));
});

/** A scene carrying one cue of every kind, all starting at 0 — the real case. */
function sceneWithEveryKind() {
    const pid = generateId();
    db.prepare(`INSERT INTO film_projects (id, title, created_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))`).run(pid, 'cue kind probe');
    const sid = generateId();
    db.prepare(`INSERT INTO film_scenes (id, project_id, scene_number, location, time_of_day, description, created_at)
        VALUES (?, ?, 1, 'DRIVE-IN LOT', 'NIGHT', 'A car waits.', datetime('now'))`).run(sid, pid);

    const made = {};
    for (const kind of cueKinds()) {
        const cid = generateId();
        db.prepare(`INSERT INTO film_music_cues
            (id, project_id, scene_id, cue_type, title, description, start_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`)
            .run(cid, pid, sid, kind, `${kind} cue`, `written direction for the ${kind}`);
        made[kind] = cid;
    }
    return { projectId: pid, sceneId: sid, cues: made };
}

test('the sfx path picks the SFX cue, not whichever row came back first', () => {
    const { sceneId, cues } = sceneWithEveryKind();
    const music = require('../routes/music-gen');
    assert.ok(music._internal && music._internal.cueOfKind && music._internal.CUE_KIND_FOR,
        'cueOfKind is not reachable for testing — the selection cannot be checked');
    const picked = music._internal.cueOfKind(sceneId, music._internal.CUE_KIND_FOR.sfx);
    assert.ok(picked.chosen, 'no cue was selected at all');
    assert.strictEqual(picked.chosen.id, cues.sfx,
        `the sound effect was built from the "${picked.chosen.cue_type}" cue — this is the crickets bug`);
});

test('the ambient path picks the AMBIENT cue', () => {
    const { sceneId, cues } = sceneWithEveryKind();
    const music = require('../routes/music-gen');
    assert.ok(music._internal && music._internal.ambientOptions, 'ambientOptions is not reachable');
    const scene = db.prepare('SELECT * FROM film_scenes WHERE id = ?').get(sceneId);
    const opts = music._internal.ambientOptions(scene, {});
    assert.ok(opts.cue, 'the ambient path selected no cue');
    assert.strictEqual(opts.cue.id, cues.ambient,
        `the ambient bed was built from the "${opts.cue.cue_type}" cue`);
});

test('a chosen cue also names the cues it did not use, and never itself', () => {
    /*
     * Silently picking one cue is what made the coin toss invisible in the
     * first place, so the selection has to name the cues it declined to use.
     */
    const { sceneId, cues } = sceneWithEveryKind();
    const music = require('../routes/music-gen');
    for (const kind of Object.values(music._internal.CUE_KIND_FOR)) {
        const picked = music._internal.cueOfKind(sceneId, kind);
        assert.strictEqual(picked.chosen && picked.chosen.id, cues[kind], `${kind}: the wrong cue was chosen`);
        assert.ok(Array.isArray(picked.others) && picked.others.length >= 1,
            `${kind}: the scene carries other cues and the selection reports none of them`);
        assert.ok(!picked.others.some(c => c.id === cues[kind]),
            `${kind}: the chosen cue is listed among the ones that were declined`);
        const other = kind === 'sfx' ? 'ambient' : 'sfx';
        assert.ok(picked.others.some(c => c.id === cues[other]),
            `${kind}: the ${other} cue sitting unused is not named: ${JSON.stringify(picked.others)}`);
    }
});

// ---------------------------------------------------------------------------
// 2. A written cue can be generated, by an agent
// ---------------------------------------------------------------------------

test('a written cue has a tool that generates it', () => {
    const m = require('../lib/mcp-tools');
    const list = (m.buildTools ? m.buildTools() : m.TOOLS) || [];
    const tools = (Array.isArray(list) ? list : Object.values(list)).map(t => t.name);

    for (const authoring of ['music_cue_create', 'music_cue_update', 'music_cue_list']) {
        assert.ok(tools.includes(authoring), `${authoring} is missing — the premise has changed`);
    }
    assert.ok(tools.includes('music_cue_generate'),
        'cues can be written and no tool can generate one — the only generation surface an agent '
        + 'sees is node_gen_music, which ignores the cue and derives its own prompt');
});

test('the cue-generation tool is addressed by CUE, not by scene', () => {
    /*
     * A scene holds several cues at once. A scene-addressed tool has to guess
     * which one is meant, which is the bug this file exists for, one level up.
     */
    const m = require('../lib/mcp-tools');
    const list = (m.buildTools ? m.buildTools() : m.TOOLS) || [];
    const tool = (Array.isArray(list) ? list : Object.values(list)).find(t => t.name === 'music_cue_generate');
    assert.ok(tool, 'music_cue_generate is missing');
    const props = Object.keys((tool.inputSchema || tool.input_schema || {}).properties || {});
    assert.ok(props.includes('cue_id'), `it takes ${JSON.stringify(props)} — a cue must be named directly`);
    const required = (tool.inputSchema || tool.input_schema || {}).required || tool.required || [];
    assert.ok(required.includes('cue_id'), 'cue_id is optional, so the cue can still be guessed');
});

// ---------------------------------------------------------------------------
// 3. A generated cue is linked to what it produced
// ---------------------------------------------------------------------------

test('generating from a cue records which asset it produced', () => {
    /*
     * `generated_asset_id` has existed since migration 016 and was written by
     * nothing, so "has this cue been generated" had no answer and a scene could
     * hold a cue and an audio file with no link between them.
     */
    const cols = db.prepare('PRAGMA table_info(film_music_cues)').all().map(c => c.name);
    assert.ok(cols.includes('generated_asset_id'), 'the column is gone — the premise has changed');

    const music = require('../routes/music-gen');
    assert.ok(music._internal && typeof music._internal.linkCueAsset === 'function',
        'nothing links a cue to the asset it produced');

    const { sceneId, cues } = sceneWithEveryKind();
    const assetId = generateId();
    const scene = db.prepare('SELECT * FROM film_scenes WHERE id = ?').get(sceneId);
    db.prepare(`INSERT INTO film_assets (id, project_id, scene_id, asset_type, file_name, version)
        VALUES (?, ?, ?, 'audio_sfx', 'x.wav', 1)`).run(assetId, scene.project_id, sceneId);

    music._internal.linkCueAsset(cues.sfx, assetId);
    const row = db.prepare('SELECT generated_asset_id FROM film_music_cues WHERE id = ?').get(cues.sfx);
    assert.strictEqual(row.generated_asset_id, assetId, 'the cue was not linked to its asset');

    // And it must not touch any other cue on the scene.
    const other = db.prepare('SELECT generated_asset_id FROM film_music_cues WHERE id = ?').get(cues.ambient);
    assert.strictEqual(other.generated_asset_id, null, 'linking one cue wrote to another');
});

test('every path that generates from a cue links the asset back', () => {
    /*
     * Derived from the source: each site that inserts a generated audio asset
     * must also link it. A path that persists and does not link leaves the same
     * unanswerable question the column was added for.
     */
    const lines = MUSIC_SRC.split('\n');
    const inserts = [];
    // The shared cue path (sfx and ambient cues alike) names its asset type as a parameter, so its
    // site is found by function; the scene ambient bed names its type literally.
    const cueFnStart = lines.findIndex(l => /async function runCueGeneration\(/.test(l));
    assert.ok(cueFnStart >= 0, 'runCueGeneration is gone — the cue path cannot be checked');
    const cueFnEnd = lines.findIndex((l, i) => i > cueFnStart && /^}/.test(l));
    lines.forEach((line, i) => {
        if (i > cueFnStart && i < cueFnEnd && /INSERT INTO film_assets/.test(line)) inserts.push(i + 1);
        else if (/'audio_ambient'/.test(line) && /VALUES/.test(line)) inserts.push(i + 1);
    });
    assert.ok(inserts.some(at => at > cueFnStart && at < cueFnEnd), 'the cue path stores no asset any more');
    assert.ok(inserts.length >= 2, `expected the cue path and the ambient bed, found ${inserts.length}`);

    /*
     * PER SITE, not a total. Counting calls passes while one path has stopped
     * linking, because the others make up the number -- proven by mutation.
     */
    const unlinked = [];
    for (const at of inserts) {
        const window = lines.slice(at - 1, at + 14).join('\n');
        if (!/linkCueAsset\(/.test(window)) {
            unlinked.push(`music-gen.js:${at} stores a generated audio asset and never links it to its cue`);
        }
    }
    assert.deepStrictEqual(unlinked, [], unlinked.join('\n  '));
});
