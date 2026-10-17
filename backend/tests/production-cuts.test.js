/**
 * CUTS (Production's Cut tab): a rough edit from picked shots, footage or not, with sound wired to shots, sent to
 * DaVinci Resolve as one timeline. Set-based over what can vary:
 *   - every picture state a shot can be in (clip, storyboard board, nothing) is laid out and exported as itself;
 *   - every sound kind takes its own kind of file and no other, and lands on its own Resolve lane;
 *   - a sound starts at a shot plus an offset and plays its file's length, or runs to the end of a later shot;
 *   - only the cut's shots go to Resolve, in the cut's order and lengths; the film's beds and shot effects stay out;
 *   - a new version copies the cut and its sounds and leaves the old one as it was.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

process.env.FILM_DATA_DIR = path.join(os.tmpdir(), 'film-engine-cuts-' + crypto.randomUUID().slice(0, 8));
process.env.FILM_RESOLVE_LAUNCH = '0';
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const cuts = require('../lib/production-cuts');
const rx = require('../lib/resolve-export');
const { handleProductionCuts } = require('../routes/production-cuts');
const { resolveFfmpeg } = require('../lib/ffmpeg');

const ff = resolveFfmpeg();
const MEDIA = path.join(process.env.FILM_DATA_DIR, 'media');
fs.mkdirSync(MEDIA, { recursive: true });
const make = (name, args) => { const f = path.join(MEDIA, name); execFileSync(ff.bin, ['-nostdin', '-loglevel', 'error', '-y', ...args, f], { stdio: 'ignore' }); return f; };
const clip = (name, secs) => make(name, ['-f', 'lavfi', '-i', `color=c=red:s=320x180:d=${secs}`, '-pix_fmt', 'yuv420p']);
const tone = (name, secs) => make(name, ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`]);
const png = (name) => make(name, ['-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=0.1', '-frames:v', '1']);

const pid = generateId(), sc = generateId();
db.prepare(`INSERT INTO film_projects (id, title, target_resolution, target_fps) VALUES (?, 'Glass Harbour', '1920x1080', 24)`).run(pid);
db.prepare(`INSERT INTO film_scenes (id, project_id, scene_number, int_ext, location, time_of_day) VALUES (?, ?, 1, 'INT', 'DINER', 'DAY')`).run(sc, pid);
const shot = (code, i) => { const id = generateId(); db.prepare(`INSERT INTO film_shots (id, scene_id, shot_code, duration_ms, sort_order, scene_card_yaml) VALUES (?, ?, ?, 4000, ?, '{}')`).run(id, sc, code, i); return { id, code }; };
const S = ['1A', '1B', '1C', '1D'].map(shot);
function asset(shotId, type, file, ms, sceneId) {
    const id = generateId();
    db.prepare(`INSERT INTO film_assets (id, project_id, shot_id, scene_id, asset_type, file_path, file_name, format, duration_ms, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(id, pid, shotId, sceneId || null, type, file, path.basename(file), path.extname(file).slice(1), ms);
    return id;
}
// The picture states: 1A a clip (6s), 1B a storyboard board, 1C a clip, 1D nothing at all.
const v1 = asset(S[0].id, 'video_raw', clip('1A.mp4', 6), 6000);
db.prepare('UPDATE film_shots SET selected_video_asset_id = ? WHERE id = ?').run(v1, S[0].id);
asset(S[1].id, 'storyboard', png('1B.png'), null);
const v3 = asset(S[2].id, 'video_raw', clip('1C.mp4', 3), 3000);
db.prepare('UPDATE film_shots SET selected_video_asset_id = ? WHERE id = ?').run(v3, S[2].id);
// A sound file of every kind, plus the film-wide things a cut must NOT pull in: a scene bed and a shot's own effect.
const FILES = {
    music: asset(null, 'audio_music', tone('theme.wav', 20), 20000, sc),
    sfx: asset(S[1].id, 'audio_sfx', tone('door.wav', 1), 1000),
    ambient: asset(null, 'audio_ambient', tone('room.wav', 30), 30000, sc),
    dialogue: asset(null, 'audio_dialogue', tone('pickup_line.wav', 2), 2000, sc),
};
// 1A's own generated line: already in the edit as the shot's dialogue, so a dialogue node on the same file is a double.
const ownLine = asset(S[0].id, 'audio_dialogue', tone('1A_line.wav', 2), 2000);
const shotSfx = asset(S[2].id, 'audio_sfx', tone('shot_own_effect.wav', 1), 1000);

function call(method, parts, body) {
    return new Promise(resolve => {
        const res = { status: 0, writeHead(c) { this.status = c; }, end(b) { resolve({ status: this.status, body: JSON.parse(b) }); } };
        handleProductionCuts({ method, body: body || {} }, res, parts);
    });
}

test('the fixture covers every picture state and every sound kind (the checks run over something)', () => {
    assert.deepEqual(Object.keys(FILES).sort(), [...cuts.KINDS].sort());
});

test('every picture state is laid out as itself, in the cut\'s order, held for the cut\'s length', async () => {
    const r = await call('POST', ['film', 'projects', pid, 'cuts'], { name: 'Sc 1 rough', shot_ids: [S[2].id, S[0].id, S[1].id, S[3].id], holds: { [S[1].id]: 2500, [S[0].id]: 9000 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const c = r.body.cut;
    assert.equal(c.label, 'Sc 1 rough v1');
    assert.deepEqual(c.shots.map(s => [s.shot_code, s.picture]), [['1C', 'clip'], ['1A', 'clip'], ['1B', 'board'], ['1D', 'none']]);
    const at = Object.fromEntries(c.shots.map(s => [s.shot_code, [s.start_ms, s.duration_ms]]));
    assert.deepEqual(at['1C'], [0, 3000]);
    assert.deepEqual(at['1A'], [3000, 6000], 'a clip cannot be held longer than it is');
    assert.deepEqual(at['1B'], [9000, 2500], 'a board holds for the cut\'s length');
    assert.equal(c.total_ms, at['1D'][0] + at['1D'][1]);
});

test('every sound kind takes its own kind of file and refuses another', async () => {
    const c = (await call('POST', ['film', 'projects', pid, 'cuts'], { name: 'Kinds', shot_ids: [S[0].id] })).body.cut;
    for (const kind of cuts.KINDS) {
        const ok = await call('POST', ['film', 'cuts', c.id, 'sounds'], { kind, start_shot_id: S[0].id, asset_id: FILES[kind] });
        assert.equal(ok.status, 201, `${kind}: ${JSON.stringify(ok.body)}`);
        const other = Object.entries(FILES).find(([k]) => k !== kind)[1];
        const bad = await call('POST', ['film', 'cuts', c.id, 'sounds'], { kind, start_shot_id: S[0].id, asset_id: other });
        assert.equal(bad.status, 400, `${kind} took another kind's file`);
    }
    const outside = await call('POST', ['film', 'cuts', c.id, 'sounds'], { kind: 'sfx', start_shot_id: S[2].id });
    assert.equal(outside.status, 400, 'a sound starts at a shot in the cut');
});

test('a sound spans from its shot plus an offset to the end of a later shot, or plays its own length', async () => {
    let c = cuts.createCut(db, pid, { name: 'Spans', shot_ids: [S[0].id, S[1].id, S[2].id] });
    const shotAt = Object.fromEntries(c.shots.map(s => [s.shot_code, s]));
    const endOf = code => shotAt[code].start_ms + shotAt[code].duration_ms;
    c = cuts.addSound(db, c.id, { kind: 'music', start_shot_id: S[0].id, offset_ms: 500, end_shot_id: S[1].id, asset_id: FILES.music });
    c = cuts.addSound(db, c.id, { kind: 'sfx', start_shot_id: S[1].id, offset_ms: 1200, asset_id: FILES.sfx });
    c = cuts.addSound(db, c.id, { kind: 'ambient', start_shot_id: S[0].id, end_shot_id: S[2].id, asset_id: FILES.ambient });
    const by = Object.fromEntries(c.sounds.map(s => [s.kind, [s.start_ms, s.end_ms]]));
    assert.deepEqual(by.music, [500, endOf('1B')], 'to the end of 1B');
    assert.deepEqual(by.sfx, [shotAt['1B'].start_ms + 1200, shotAt['1B'].start_ms + 2200], 'its own length, from 1B + 1.2s');
    assert.deepEqual(by.ambient, [0, endOf('1C')], 'across the whole cut');
    // Take the start shot out of the cut: the sound is kept, and says why it does not play.
    c = cuts.updateCut(db, c.id, { shot_ids: [S[0].id, S[2].id] });
    const sfx = c.sounds.find(s => s.kind === 'sfx');
    assert.equal(sfx.placed, false);
    assert.match(sfx.why, /not in the cut/);
});

test('a new version copies the cut and its sounds; the old version is left as it was', () => {
    const v1c = cuts.createCut(db, pid, { name: 'Versions', shot_ids: [S[0].id, S[1].id] });
    cuts.addSound(db, v1c.id, { kind: 'music', start_shot_id: S[0].id, asset_id: FILES.music });
    const v2 = cuts.newVersion(db, v1c.id);
    assert.equal(v2.version, 2);
    assert.equal(v2.sounds.length, 1);
    cuts.updateCut(db, v2.id, { shot_ids: [S[1].id] });
    assert.deepEqual(cuts.getCut(db, v1c.id).shot_ids, [S[0].id, S[1].id]);
    assert.deepEqual(cuts.listCuts(db, pid).filter(x => x.name === 'Versions').map(x => x.version), [2, 1]);
});

test('Resolve gets only the cut: its shots in its order and lengths, every sound kind on its own lane, nothing film-wide', () => {
    let c = cuts.createCut(db, pid, { name: 'Send', shot_ids: [S[1].id, S[0].id], holds: { [S[1].id]: 3000 } });   // 1B board 0–3000, 1A 3000–9000
    for (const kind of cuts.KINDS) c = cuts.addSound(db, c.id, { kind, start_shot_id: S[0].id, asset_id: FILES[kind], label: `${kind} cue` });
    const plan = rx.planResolve(db, pid, { cut: cuts.row(db, c.id) });
    assert.deepEqual(plan.video.map(v => [v.name, v.start_ms, v.duration_ms, v.still]), [['1B (board)', 0, 3000, true], ['1A', 3000, 6000, false]]);
    assert.equal(plan.timeline_name, 'Send v1');
    for (const kind of cuts.KINDS) {
        const lane = plan.lanes[kind];
        assert.ok(lane.some(x => x.start_ms === 3000 && new RegExp(`${kind} cue`).test(x.file)), `${kind}: the wired sound is on its lane at 1A`);
    }
    // A dialogue node on 1A's own generated line is the line twice: left out, and said.
    c = cuts.addSound(db, c.id, { kind: 'dialogue', start_shot_id: S[0].id, asset_id: ownLine, label: 'double' });
    const again = rx.planResolve(db, pid, { cut: cuts.row(db, c.id) });
    const rel = again._files.find(f => f.from.endsWith('1A_line.wav')).to;
    assert.equal(again.lanes.dialogue.filter(x => x.file === rel).length, 1, 'the line plays once');
    assert.ok(again.warnings.some(w => w.code === 'CUT_SOUND_DUPLICATE'));
    const files = plan._files.map(f => path.basename(f.from));
    assert.ok(!files.includes('shot_own_effect.wav'), 'a shot not in the cut brings none of its effects');
    assert.ok(!plan.lanes.ambient.some(x => /scene_ambient/.test(x.file)), 'the film\'s scene beds stay out of a cut');
    assert.ok(!plan.shots.some(s => s.shot_code === '1C' || s.shot_code === '1D'), 'only the cut\'s shots');
});

test('sending a cut writes its package into the film\'s Resolve project as a timeline of its name', async () => {
    const c = cuts.createCut(db, pid, { name: 'Package', shot_ids: [S[0].id, S[1].id] });
    cuts.addSound(db, c.id, { kind: 'music', start_shot_id: S[0].id, end_shot_id: S[1].id, asset_id: FILES.music });
    const r = await call('POST', ['film', 'cuts', c.id, 'send-to-resolve']);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const script = fs.readFileSync(path.join(r.body.dest, 'Import into Resolve.py'), 'utf8');
    assert.match(script, /TIMELINE = "Package v1"/);
    assert.match(script, /REUSE_PROJECT = True/);
    assert.match(script, /pm\.LoadProject\(name\) if REUSE_PROJECT/);
    const out = require('child_process').spawnSync('python3', ['-m', 'py_compile', path.join(r.body.dest, 'Import into Resolve.py')]);
    assert.equal(out.status, 0, String(out.stderr));
    assert.ok(fs.readdirSync(r.body.dest, { recursive: true }).some(f => /theme/.test(String(f)) || /music/.test(String(f))), 'the wired music is in the package');
});

test.after(() => { assert.ok(shotSfx); fs.rmSync(process.env.FILM_DATA_DIR, { recursive: true, force: true }); });
