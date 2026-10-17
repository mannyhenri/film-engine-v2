/**
 * Directing the sound
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Two things a director could not do: hear the scene's music and beds under
 * the cut, and say one word about the ambient bed.
 *
 * Music-making was retired on 2026-10-14: a scene's music is a FILE brought in
 * for it (the newest `audio_music` asset), and cues are sound effects and
 * ambient beds only. Score cues, sections and composition plans went with it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// db/database.js resolves FILM_DATA_DIR at import time, so this must come
// before the first local require or the suite opens the real database.
process.env.FILM_DATA_DIR = path.join(os.tmpdir(), 'film-engine-music-' + crypto.randomUUID().slice(0, 8));

const { sceneBeds, DEFAULT_BED_GAIN_DB, buildTimeline } = require('../lib/timeline');
const { buildAmbientPrompt } = require('../lib/music-prompt');

const SRC = path.join(__dirname, '..', '..', 'src', 'index.html');
const LIB = f => path.join(__dirname, '..', 'lib', f);
const ROUTE = f => path.join(__dirname, '..', 'routes', f);
const read = p => fs.readFileSync(p, 'utf8');

// ── 1. The beds reach the assembled film ───────────────────────────────────

const ENTRIES = [
    { index: 0, shot_id: 'a', scene_id: 's1', start_ms: 0, end_ms: 4000 },
    { index: 1, shot_id: 'b', scene_id: 's1', start_ms: 4000, end_ms: 9000 },
    { index: 2, shot_id: 'c', scene_id: 's2', start_ms: 9000, end_ms: 15000 },
];

test('a scene-scoped bed spans its whole scene, not one shot', () => {
    /*
     * The timeline's asset query reads `shot_id IS NOT NULL`, which is right
     * for a shot's picture and its dialogue and excludes a scene's music file
     * entirely — so it was invisible to the assembled film, which from the
     * outside is indistinguishable from it never having been brought in.
     */
    const beds = sceneBeds(ENTRIES, {
        s1: { audio_music: { file_path: '/x/1_score.mp3', duration_ms: 202000 } },
    }, {});
    assert.equal(beds.length, 1);
    assert.equal(beds[0].kind, 'music');
    assert.equal(beds[0].start_ms, 0);
    assert.equal(beds[0].end_ms, 9000, 'the bed stopped at the end of the first shot of its scene');
});

test('every scene-scoped kind gets a bed, not just the one that was reported', () => {
    // Set-based: music worked and ambient silently did not would look exactly
    // like a working feature to whoever generated a score first.
    const beds = sceneBeds(ENTRIES, {
        s1: { audio_music: { file_path: '/x/s.mp3' }, audio_ambient: { file_path: '/x/a.mp3' } },
        s2: { audio_ambient: { file_path: '/x/a2.mp3' } },
    }, {});
    assert.deepEqual(beds.map(b => `${b.scene_id}:${b.kind}`).sort(),
        ['s1:ambient', 's1:music', 's2:ambient']);
});

test('a bed with no cue sits at the level the finished mix uses', () => {
    // A player at unity is louder than the delivered film and sends everyone
    // reaching for the fader.
    const beds = sceneBeds(ENTRIES, {
        s1: { audio_music: { file_path: '/x/s.mp3' }, audio_ambient: { file_path: '/x/a.mp3' } },
    }, {});
    for (const bed of beds) {
        assert.equal(bed.gain_db, DEFAULT_BED_GAIN_DB[bed.kind]);
    }
    assert.ok(DEFAULT_BED_GAIN_DB.music < 0 && DEFAULT_BED_GAIN_DB.ambient < DEFAULT_BED_GAIN_DB.music,
        'the bed defaults do not match the mix: music under dialogue, ambient under music');
});

test("the cue's own level, fades and offset are honoured", () => {
    /*
     * volume_db, fade_in_ms, fade_out_ms and start_ms have been on
     * film_music_cues since migration 016 and only the offline mixer ever read
     * them. A player that ignores them plays a different mix from the one being
     * delivered.
     */
    const beds = sceneBeds(ENTRIES, { s1: { audio_ambient: { file_path: '/x/a.mp3' } } }, {
        s1: { ambient: { id: 'c1', volume_db: -3, fade_in_ms: 1500, fade_out_ms: 2000, start_ms: 2000 } },
    });
    assert.equal(beds[0].gain_db, -3);
    assert.equal(beds[0].fade_in_ms, 1500);
    assert.equal(beds[0].fade_out_ms, 2000);
    // start_ms is an offset INTO THE SCENE — the only reading that survives the
    // scene being moved, and what the mixer has always taken it as.
    assert.equal(beds[0].start_ms, 2000);
    assert.equal(beds[0].cue_id, 'c1');
});

test('buildTimeline carries the beds through, and grows none from nothing', () => {
    // Both halves. Asserting only the empty case passes against a timeline that
    // hardcodes `beds: []` — which is the state the feature was in.
    const shots = [{ id: 'a', shot_code: '1A', scene_id: 's1', scene_number: 1, duration_ms: 4000 }];
    assert.deepEqual(buildTimeline(shots, {}, {}).beds, [], 'a bedless project grew a bed');

    const withBed = buildTimeline(shots, {}, {
        sceneAssets: { s1: { audio_ambient: { file_path: '/x/1_room.mp3', duration_ms: 40000 } } },
        cues: { s1: { ambient: { id: 'c', volume_db: -5, fade_in_ms: 0, fade_out_ms: 0, start_ms: 0 } } },
    });
    assert.equal(withBed.beds.length, 1, 'the timeline never passes its scene assets to sceneBeds');
    assert.equal(withBed.beds[0].kind, 'ambient');
    assert.equal(withBed.beds[0].gain_db, -5);
    assert.equal(withBed.beds[0].end_ms, withBed.entries[0].end_ms);
});

test("the scene's music is its music file; cue beds are effects and ambient only", () => {
    /*
     * The route hands the timeline every cue with the audio it produced. A
     * music cue (score, source, transition) left in an old project plays
     * nothing of its own; the scene's newest imported music file is its music
     * bed, at the mix's music level, with no cue behind it.
     */
    const shots = [{ id: 'a', shot_code: '1A', scene_id: 's1', scene_number: 1, duration_ms: 4000 }];
    const tl = buildTimeline(shots, {}, {
        sceneAssets: { s1: { audio_music: { file_path: '/x/theme.wav', duration_ms: 30000 } } },
        cues: { s1: [
            { id: 'amb', cue_type: 'ambient', volume_db: -14, asset: { file_path: '/x/room.wav', duration_ms: 30000 } },
            { id: 'fx', cue_type: 'sfx', volume_db: 0, asset: { file_path: '/x/door.wav', duration_ms: 1000 } },
            { id: 'old', cue_type: 'score', volume_db: -2, asset: { file_path: '/x/old_score.wav', duration_ms: 30000 } },
        ] },
    });
    const byKind = Object.fromEntries(tl.beds.map(b => [b.kind, b]));
    assert.deepEqual(tl.beds.map(b => b.kind).sort(), ['ambient', 'music', 'sfx']);
    assert.ok(!tl.beds.some(b => b.path === '/x/old_score.wav'), 'a retired score cue still plays');
    assert.equal(byKind.music.path, '/x/theme.wav');
    assert.equal(byKind.music.cue_id, null);
    assert.equal(byKind.music.gain_db, DEFAULT_BED_GAIN_DB.music);
    assert.equal(byKind.ambient.gain_db, -14);
    assert.equal(byKind.ambient.cue_id, 'amb');
});

test('the timeline route reads scene-scoped audio and the cues', () => {
    const src = read(ROUTE('timeline.js'));
    assert.ok(/scene_id IS NOT NULL AND a\.shot_id IS NULL/.test(src),
        'the route never selects scene-scoped assets, so no bed can ever exist');
    assert.ok(/audio_music.*audio_ambient|audio_ambient.*audio_music/s.test(src));
    assert.ok(/film_music_cues/.test(src), 'the cue levels and fades are never read');
    assert.ok(/c\.cue_type IN \('sfx', 'ambient'\)/.test(src), 'the route reads music cues as beds');
    assert.ok(/ORDER BY a\.created_at DESC/.test(src) && /\|\|= row/.test(src),
        'the scene\'s NEWEST music file is not the one that plays');
});

// ── 2. Playing them ────────────────────────────────────────────────────────

test('playback plays each bed, with a switch, and stops it on pause', () => {
    const src = read(SRC);
    for (const id of ['pbMusic', 'pbAmbient', 'pbScore', 'pbAmbient2']) {
        assert.ok(src.includes(`id="${id}"`), `the page has no ${id}`);
    }
    const sync = src.match(/function pbSyncBeds\(\)[\s\S]*?\n    \}/);
    assert.ok(sync, 'nothing puts a bed where the playhead is');
    assert.ok(/checked/.test(sync[0]), 'pbSyncBeds ignores the switches');

    // Bound to what runs every frame AND to the transport — a bed left running
    // after Pause is worse than one that never played.
    const head = src.match(/function updatePlayhead\(\)[\s\S]*?\n    \}/);
    assert.ok(head && /pbSyncBeds\(/.test(head[0]), 'the playhead never syncs the beds');
    const toggle = src.match(/function pbTogglePlay\(\)[\s\S]*?\n    \}/);
    assert.ok(toggle && /pbSyncBeds\(/.test(toggle[0]), 'pausing leaves the score running');
});

test('a bed is seeded once and not restarted at every cut', () => {
    // Reloading a score on each shot boundary is the one behaviour that would
    // make a perfectly good cue sound broken.
    const src = read(SRC);
    const sync = src.match(/function pbSyncBeds\(\)[\s\S]*?\n    \}/)[0];
    assert.ok(/dataset\.bedPath !== src/.test(sync),
        'the bed source is set unconditionally, so it restarts on every frame');
    assert.ok(/Math\.abs\(el\.currentTime - into\) > /.test(sync),
        'currentTime is written every frame, which stutters continuous audio');
});

// ── 3. Ambient direction ───────────────────────────────────────────────────

test('the location\'s sound notes reach the ambient prompt', () => {
    /*
     * `film_locations.sound_notes` has existed since migration 006, has a
     * textarea on the Locations page placeholdered "Traffic two streets over, a
     * screen door, gulls...", and reached nothing but the call sheet. The one
     * field whose entire purpose is to describe how a place SOUNDS was invisible
     * to the only thing that generates how a place sounds.
     */
    const scene = { location: 'THE GLASS HARBOUR DINER', int_ext: 'INT', time_of_day: 'DAY' };
    const without = buildAmbientPrompt(scene, {}).prompt;
    const with_ = buildAmbientPrompt(scene, { sound_notes: 'a screen door, gulls' }).prompt;
    assert.notEqual(without, with_, 'sound_notes changes nothing about the bed');
    assert.ok(/screen door/.test(with_) && /gulls/.test(with_));
});

test('a scene\'s ambient direction leads, and is not invented', () => {
    const scene = { location: 'DINER', int_ext: 'INT', time_of_day: 'DAY' };
    const directed = buildAmbientPrompt(scene, {}, { direction: 'the fridge compressor cuts out halfway through' });
    assert.ok(directed.prompt.startsWith('the fridge compressor cuts out'),
        `the direction must lead — it is the specific thing about THIS scene: ${directed.prompt}`);
    // Nothing invented: a scene with no direction gets what it always got.
    assert.equal(buildAmbientPrompt(scene, {}, {}).prompt, buildAmbientPrompt(scene, {}).prompt);
});

test('the ambient bed is as long as the cut, not a thirty-second default', () => {
    // scene.estimated_duration is 0 on every scene in every real project, and 0
    // is falsy — exactly the defect the SCORE had until it was measured.
    const scene = { location: 'DINER', int_ext: 'INT', time_of_day: 'DAY', estimated_duration: 0 };
    const guessed = buildAmbientPrompt(scene, {}, {});
    assert.equal(guessed.bed_source, 'default');
    const measured = buildAmbientPrompt(scene, {}, { bed_ms: 202000 });
    assert.equal(measured.bed_duration_s, 202);
    assert.equal(measured.bed_source, 'measured');
});

test('every path that builds a bed reads the direction', () => {
    /*
     * Several sites build the ambient payload. A fix applied to two of three
     * means a scene generated from the Music page sounds different from the
     * same scene generated from the batch, and only whoever used the third
     * path ever finds out.
     */
    const route = read(ROUTE('music-gen.js'));
    /*
     * Each call WITH the function it sits in, because the assignment check has
     * to be scoped. Searched file-wide, `const ambient = {}` in the batch path
     * passed on the strength of `const ambient = ambientOptions(...)` in a
     * different function — the same scoping mistake the prop-modal check
     * already paid for.
     */
    const enclosing = (src, at) => {
        const starts = [...src.slice(0, at).matchAll(/\n(?:async )?function \w+\(/g)];
        const from = starts.length ? starts[starts.length - 1].index : 0;
        const next = src.indexOf('\nfunction ', at);
        return src.slice(from, next > 0 ? next : src.length);
    };
    const ambientCalls = [...route.matchAll(/buildAmbientPrompt\([^)]*\)/g)]
        .map(m => ({ text: m[0], scope: enclosing(route, m.index) }));
    assert.ok(ambientCalls.length >= 2, 'the ambient build sites moved');
    for (const { text: call, scope } of ambientCalls) {
        /*
         * The third argument must BE ambientOptions' output -- either called
         * inline, or a variable assigned from it in this file. Matching the
         * name `ambient` alone passed against `const ambient = {}`, which is
         * the failure this check exists for; and refusing a variable outright
         * would forbid an ordinary refactor, which is how a check gets
         * loosened until it protects nothing.
         */
        const arg = (/buildAmbientPrompt\([^,]*,[^,]*,\s*([^)]*)\)/.exec(call) || [])[1] || '';
        const inline = /ambientOptions\(/.test(arg);
        const viaVar = /^[A-Za-z_$][\w$]*$/.test(arg.trim())
            && new RegExp(`\\b${arg.trim()}\\s*=\\s*ambientOptions\\(`).test(scope);
        assert.ok(inline || viaVar,
            `this path generates a bed with no direction and no measured length: ${call}`);
    }
    // The orchestrator and the flow canvas too — the whole point of that file.
    const payloads = read(LIB('capability-payloads.js'));
    assert.ok(/buildAmbientPrompt\(ctx\.scene, ctx\.location, ctx\.ambient/.test(payloads),
        'the orchestrated ambient payload ignores the scene\'s direction');
    assert.ok(/ambientCue/.test(payloads), 'loadShotContext never reads an ambient cue');
});

// ── 4. It is settable, everywhere ─────────────────────────────────────────

test('a sound cue\'s negative is settable by a person and by an agent', () => {
    const src = read(SRC);
    assert.ok(/pgCuePut\('\$\{n\.id\}', \{ negative_prompt: this\.value \}\)/.test(src),
        'no control for the cue negative');

    const tools = require('../lib/mcp-tools').listTools();
    for (const name of ['music_cue_create', 'music_cue_update']) {
        const tool = tools.find(t => t.name === name);
        assert.ok(tool, `${name} is gone`);
        assert.ok(tool.inputSchema.properties.negative_prompt, `${name} cannot set negative_prompt`);
        assert.deepEqual(tool.inputSchema.properties.cue_type.enum, ['sfx', 'ambient'],
            `${name} offers a cue kind the route refuses`);
    }

    // And the route stores it.
    const assets = read(ROUTE('assets.js'));
    assert.ok(/negative_prompt/.test(assets), 'the cue route never stores the negative');
});

/*
 * The route, exercised. A source check that the word `negative_prompt` appears
 * passes against a route that writes '' into it.
 */
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
const { handleAssets } = require('../routes/assets');

function cueCall(method, urlParts, body) {
    return new Promise(resolve => {
        const res = {
            writeHead(status) { this._s = status; },
            end(payload) { resolve({ status: this._s, body: payload ? JSON.parse(payload) : null }); },
        };
        handleAssets({ method, body }, res, urlParts, {});
    });
}

const PROJECT = 'ad000000-0000-4000-8000-0000000000a1';
test.before(() => {
    db.prepare(`INSERT OR IGNORE INTO film_projects (id, title, created_at, updated_at)
                VALUES (?, 'p', datetime('now'), datetime('now'))`).run(PROJECT);
});

test('the negative survives a real write and read back, and a music cue is refused', async () => {
    const made = await cueCall('POST', ['film', 'projects', PROJECT, 'music-cues'], {
        cue_type: 'ambient', title: 'room tone',
        description: 'a fridge hum, distant traffic',
        negative_prompt: 'music, voices',
    });
    assert.equal(made.status, 201, JSON.stringify(made.body));

    const back = db.prepare('SELECT * FROM film_music_cues WHERE id = ?').get(made.body.id);
    assert.equal(back.cue_type, 'ambient');
    assert.equal(back.negative_prompt, 'music, voices');

    // A merge, not a swap: refining one sentence must not clear the negative.
    const upd = await cueCall('PUT', ['film', 'music-cues', made.body.id], { description: 'the fridge cuts out' });
    assert.equal(upd.status, 200);
    const merged = db.prepare('SELECT description, negative_prompt FROM film_music_cues WHERE id = ?').get(made.body.id);
    assert.equal(merged.description, 'the fridge cuts out');
    assert.equal(merged.negative_prompt, 'music, voices', 'editing the description dropped the negative');

    // Rewriting the negative through the update path stores what was sent.
    const rewritten = await cueCall('PUT', ['film', 'music-cues', made.body.id], { negative_prompt: 'birdsong' });
    assert.equal(rewritten.status, 200);
    assert.equal(db.prepare('SELECT negative_prompt FROM film_music_cues WHERE id = ?').get(made.body.id).negative_prompt, 'birdsong');

    // Music cues were retired: a score is refused on create and on update, for free.
    const score = await cueCall('POST', ['film', 'projects', PROJECT, 'music-cues'], { cue_type: 'score', title: 'theme' });
    assert.equal(score.status, 400, 'a score cue was stored');
    assert.match(score.body.error, /music cues were retired/);
    const toScore = await cueCall('PUT', ['film', 'music-cues', made.body.id], { cue_type: 'score' });
    assert.equal(toScore.status, 400, 'an ambient cue was turned into a score');
    assert.equal(db.prepare('SELECT cue_type FROM film_music_cues WHERE id = ?').get(made.body.id).cue_type, 'ambient');
});

test('every cue verb the route dispatches is reachable through the server', () => {
    /*
     * routes/assets.js has dispatched PUT and DELETE on /film/music-cues/:id
     * since the update route was written, and server.js only ever forwarded
     * `/rights` — so music_cue_update and music_cue_delete were listed,
     * described, schema'd, and answered 404 on every call, and the ambient
     * direction saved from the page would have too. A handler nothing routes to
     * looks identical to a working one until somebody presses it.
     */
    const server = read(path.join(__dirname, '..', 'server.js'));
    assert.ok(/parts\[1\] === 'music-cues' && parts\[2\] && !parts\[3\]/.test(server),
        'the server does not route a bare /film/music-cues/:id, so update and delete 404');

    const assets = read(ROUTE('assets.js'));
    const bare = assets.match(/urlParts\[1\] === 'music-cues' && urlParts\[2\] && !urlParts\[3\][\s\S]{0,400}/);
    assert.ok(bare, 'the cue route no longer handles a bare id');
    for (const verb of ['PUT', 'DELETE']) {
        assert.ok(bare[0].includes(`'${verb}'`), `the route claims no ${verb} — this test is now stale`);
    }
});

test('an ambient direction has somewhere to be written', () => {
    const src = read(SRC);
    assert.ok(/function saveAmbientDirection\(/.test(src), 'nothing writes an ambient direction');
    assert.ok(/onchange="saveAmbientDirection\(/.test(src),
        'saveAmbientDirection is defined and bound to nothing — indistinguishable from a working page');
    assert.ok(/cue_type: 'ambient'/.test(src),
        'the direction is stored somewhere other than as an ambient cue');
});
