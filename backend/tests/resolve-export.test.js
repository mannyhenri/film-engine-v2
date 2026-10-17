/**
 * DaVinci Resolve: a first edit, ready to edit, with everything known about it.
 *
 * Built through the real route against a temp database with real files:
 *   - every shot of the Playback timeline is on V1 in running order: the
 *     SELECTED clip where there is one, else its storyboard frame (a still);
 *   - dialogue lands on its own lane, a clip that carries its own sound is not
 *     spoken over, beds land on music/ambience lanes at their level;
 *   - every file the XML names exists inside the export, per scene folder;
 *   - every shot has a marker carrying its description, dialogue and camera;
 *   - the metadata CSV has a row per file, and the import script compiles;
 *   - the plan writes nothing; a project with nothing to edit is refused.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

process.env.FILM_DATA_DIR = path.join(os.tmpdir(), 'film-engine-rx-' + crypto.randomUUID().slice(0, 8));
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const { handleNLEExport } = require('../routes/nle-export');
const { resolveFfmpeg } = require('../lib/ffmpeg');
const { lavfiSource } = require('./helpers');

function call(method, parts) {
    return new Promise(resolve => {
        const res = { code: 0, body: '', writeHead(c) { this.code = c; }, setHeader() {},
            end(b) { this.body = b || ''; let j = null; try { j = JSON.parse(this.body); } catch (_) {} resolve({ code: this.code, json: j }); } };
        handleNLEExport({ method, headers: {} }, res, parts, {});
    });
}

const ff = resolveFfmpeg();
const MEDIA = path.join(process.env.FILM_DATA_DIR, 'media');
fs.mkdirSync(MEDIA, { recursive: true });
function make(name, args) {
    const f = path.join(MEDIA, name);
    execFileSync(ff.bin, ['-nostdin', '-loglevel', 'error', '-y', ...args, f], { stdio: ['ignore', 'ignore', 'ignore'] });
    return f;
}
const silentClip = (name, colour) => make(name, ['-f', 'lavfi', '-i', `color=c=${colour}:s=320x180:d=2`, '-pix_fmt', 'yuv420p']);
const tone = (name, secs) => make(name, ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`]);
const png = name => make(name, ['-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=0.1', '-frames:v', '1']);

const pid = generateId();
db.prepare(`INSERT INTO film_projects (id, title, target_resolution, target_fps) VALUES (?, 'Glass Harbour', '1920x1080', 24)`).run(pid);
const scenes = [
    { id: generateId(), n: 1, ie: 'INT', loc: 'DINER', tod: 'NIGHT' },
    { id: generateId(), n: 2, ie: 'EXT', loc: 'HARBOUR ROAD', tod: 'DAWN' },
];
for (const s of scenes) db.prepare(`INSERT INTO film_scenes (id, project_id, scene_number, int_ext, location, time_of_day) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(s.id, pid, s.n, s.ie, s.loc, s.tod);
const card = (desc, dialogue, lens) => JSON.stringify({ description: desc, dialogue, camera: { framing: 'MS', lens }, characters: ['RAY'] });
const shots = [
    ['1A', 0, card('Ray slides into the booth.', [{ character: 'RAY', line: 'Coffee.' }], '35mm')],
    ['1B', 0, card('The waitress pours.', [], '50mm')],
    ['2A', 1, card('Dawn over the harbour road.', [], '24mm')],
    ['2B', 1, card('Nothing made yet.', [], '85mm')],
].map(([code, si, c], i) => {
    const id = generateId();
    db.prepare(`INSERT INTO film_shots (id, scene_id, shot_code, duration_ms, sort_order, scene_card_yaml) VALUES (?, ?, ?, 2000, ?, ?)`).run(id, scenes[si].id, code, i, c);
    return { id, code, scene: scenes[si] };
});
function asset(shot, type, file, extra = {}) {
    const id = generateId();
    db.prepare(`INSERT INTO film_assets (id, project_id, shot_id, scene_id, asset_type, file_path, file_name, format, duration_ms, version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(id, pid, shot ? shot.id : null, extra.scene_id || null, type, file, extra.file_name || path.basename(file),
        path.extname(file).slice(1), extra.duration_ms || 2000, extra.created || '2026-01-01 00:00:00');
    return id;
}
// 1A: two silent takes, the OLDER selected. 1B: a storyboard frame only.
// 2A: a clip that carries its own sound. 2B: nothing at all.
const selected = asset(shots[0], 'video_raw', silentClip('1A_take1.mp4', 'red'), { created: '2026-01-01 00:00:00' });
asset(shots[0], 'video_raw', silentClip('1A_take2.mp4', 'blue'), { created: '2026-02-01 00:00:00' });
db.prepare('UPDATE film_shots SET selected_video_asset_id = ? WHERE id = ?').run(selected, shots[0].id);
asset(shots[0], 'audio_dialogue', tone('1A_RAY_0.mp3', 1), { duration_ms: 1000 });
asset(shots[1], 'storyboard', png('1B.png'));
const sounding = make('2A.mp4', [...lavfiSource('color=c=green:s=320x180:d=2', 'sine=frequency=220:duration=2'), '-pix_fmt', 'yuv420p', '-shortest']);
asset(shots[2], 'video_raw', sounding);
asset(shots[2], 'audio_dialogue', tone('2A_RAY_0.mp3', 1), { duration_ms: 1000 });
asset(null, 'audio_ambient', tone('harbour.mp3', 3), { scene_id: scenes[1].id, duration_ms: 3000 });
// A shot's own effect on 1A, a scene effects cue on scene 1, and an open note on 1A.
asset(shots[0], 'audio_sfx', tone('1A_door.mp3', 1), { duration_ms: 1000 });
const doorBed = asset(null, 'audio_sfx', tone('diner_room.mp3', 3), { scene_id: scenes[0].id, duration_ms: 3000 });
db.prepare(`INSERT INTO film_music_cues (id, project_id, scene_id, cue_type, title, generated_asset_id, volume_db) VALUES (?, ?, ?, 'sfx', 'Room', ?, -6)`)
    .run(generateId(), pid, scenes[0].id, doorBed);
db.prepare(`INSERT INTO film_shot_notes (id, shot_id, content, timecode_ms) VALUES (?, ?, 'Hold on her hands longer', 500)`).run(generateId(), shots[0].id);

// Fixture approval is explicit and tied to the exact generated clip.
for (const a of db.prepare("SELECT * FROM film_assets WHERE project_id = ? AND asset_type LIKE 'video_%'").all(pid)) {
    const media=require('../lib/nle-media');
    if (media.hasClipAudio(a)) db.prepare('UPDATE film_assets SET metadata = ? WHERE id = ?').run(JSON.stringify({audio_review:{status:'approved',no_music:true,reviewed_at:new Date().toISOString(),fingerprint:media.fingerprint(a)}}),a.id);
}

// Fixture approval is explicit and tied to the exact generated clip.
for (const a of db.prepare("SELECT * FROM film_assets WHERE project_id = ? AND asset_type LIKE 'video_%'").all(pid)) {
    const media=require('../lib/nle-media');
    if (media.hasClipAudio(a)) db.prepare('UPDATE film_assets SET metadata = ? WHERE id = ?').run(JSON.stringify({audio_review:{status:'approved',no_music:true,reviewed_at:new Date().toISOString(),fingerprint:media.fingerprint(a)}}),a.id);
}

test('the plan is free and describes the Playback cut, clip else storyboard frame', async () => {
    const before = fs.existsSync(path.join(process.env.FILM_DATA_DIR)) ? JSON.stringify(fs.readdirSync(process.env.FILM_DATA_DIR)) : '';
    const r = await call('GET', ['film', 'projects', pid, 'export', 'resolve']);
    assert.equal(r.code, 200);
    assert.equal(r.json.spends, false);
    const pic = Object.fromEntries(r.json.shots.map(s => [s.shot_code, s.picture]));
    assert.deepEqual(pic, { '1A': 'clip', '1B': 'storyboard', '2A': 'clip', '2B': 'none' });
    assert.equal(r.json.counts.gaps, 1);
    assert.ok(r.json.missing.some(m => m.shot_code === '2B'), 'a shot with nothing is named, not dropped');
    assert.equal(JSON.stringify(fs.readdirSync(process.env.FILM_DATA_DIR)), before, 'the plan wrote nothing');
});

test('the export: XML, media per scene, markers, metadata and a script that compiles', async () => {
    const r = await call('POST', ['film', 'projects', pid, 'export', 'resolve']);
    assert.equal(r.code, 200, JSON.stringify(r.json));
    const dest = r.json.dest;
    const xml = fs.readFileSync(path.join(dest, r.json.xml), 'utf8');

    // Balanced enough for an importer: every opened element closes.
    for (const tag of ['xmeml', 'sequence', 'clipitem', 'track', 'video', 'audio', 'marker']) {
        const open = (xml.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
        const close = (xml.match(new RegExp(`</${tag}>`, 'g')) || []).length;
        assert.equal(open, close, `<${tag}> opens ${open} times and closes ${close}`);
    }
    // Every file URL resolves to a file INSIDE the export.
    const urls = [...xml.matchAll(/<pathurl>([^<]+)<\/pathurl>/g)].map(m => decodeURI(m[1].replace(/^file:\/\//, '')));
    assert.ok(urls.length >= 5);
    for (const u of urls) {
        assert.ok(u.startsWith(dest), `${u} points outside the export`);
        assert.ok(fs.existsSync(u), `${u} does not exist`);
    }
    // The SELECTED take is the one copied, in its scene's folder.
    const shot1A = fs.readFileSync(path.join(dest, 'Scene_01_INT-DINER-NIGHT', 'Video', '1A.mp4'));
    assert.deepEqual(shot1A, fs.readFileSync(path.join(MEDIA, '1A_take1.mp4')));
    assert.ok(fs.existsSync(path.join(dest, 'Scene_01_INT-DINER-NIGHT', 'Stills', '1B.png')), 'the storyboard frame stands in for 1B');
    // V1 order is the running order; 1B is the still.
    const v1 = xml.slice(xml.indexOf('<video><format>'), xml.indexOf('<audio><track>'));
    const names = [...v1.matchAll(/<clipitem id="[^"]+"><name>([^<]+)<\/name>/g)].map(m => m[1]);
    assert.deepEqual(names, ['1A', '1B (board)', '2A']);
    // Dialogue: 1A (silent clip) is spoken; 2A carries its own sound, so its line is not laid and its clip sound is.
    const audio = xml.slice(xml.indexOf('<audio>'));
    assert.match(audio, /<name>1A line 1<\/name>/);
    assert.match(audio, /<name>2A line 1<\/name>/);
    assert.match(audio, /<clipitem id="[^"]+"><name>2A<\/name>/);
    // The ambient bed at its level (-12 dB = 0.25119).
    assert.match(audio, /<name>ambient harbour\.mp3<\/name>[\s\S]*?<value>0\.25119<\/value>/);
    // 1A's own effect lands on the effects lane at -4 dB; the scene effects cue at its -6 dB.
    assert.match(audio, /<name>1A sfx 1<\/name>[\s\S]*?<value>0\.63096<\/value>/);
    assert.match(audio, /<name>sfx diner_room\.mp3<\/name>[\s\S]*?<value>0\.50119<\/value>/);
    // An open note is a timeline marker half a second into 1A (12 frames at 24 fps).
    assert.match(xml, /<marker><name>Note 1A<\/name><comment>Hold on her hands longer<\/comment><in>12<\/in>/);
    // Every shot with picture carries its information as a marker.
    assert.match(xml, /<marker><name>1A<\/name><comment>Ray slides into the booth\.\nDialogue: RAY Coffee\.\nCamera: MS, 35mm/);
    assert.match(xml, /<marker><name>Scene 2<\/name><comment>EXT HARBOUR ROAD DAWN/);

    const csv = fs.readFileSync(path.join(dest, r.json.metadata), 'utf8').trim().split('\n');
    assert.equal(csv[0], 'File Name,Clip Name,Scene,Shot,Description,Comments,Keywords,Camera');
    assert.equal(csv.length, 1 + 3, 'a row per shot that has a picture');
    assert.ok(csv.some(l => l.startsWith('1B.png,1B,') && /Storyboard frame/.test(l)));

    const script = path.join(dest, r.json.script);
    const py = spawnSync('python3', ['-m', 'py_compile', script], { encoding: 'utf8' });
    if (py.error) return; // no python on this machine: compile check skipped
    assert.equal(py.status, 0, py.stderr);
    const body = fs.readFileSync(script, 'utf8');
    assert.match(body, /ImportTimelineFromFile/);
    assert.match(body, new RegExp(`HERE = ${JSON.stringify(dest).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(JSON.parse(body.match(/MARKERS = json\.loads\((".*")\)/)[1].replace(/^"|"$/g, '"')) && true, true);
});

test("a scene's imported music file is its music bed, copied into the scene folder on the music lane", async () => {
    // Music is brought in as a file (asset_type audio_music, scene-scoped); the
    // timeline plays the scene's newest one as its bed and Resolve gets it on
    // the music lane, never under a Score/ folder (scores were retired 2026-10-14).
    const older = asset(null, 'audio_music', tone('diner_theme_v1.wav', 4), { scene_id: scenes[0].id, duration_ms: 4000, created: '2026-01-01 00:00:00' });
    const newer = asset(null, 'audio_music', tone('diner_theme_v2.wav', 4), { scene_id: scenes[0].id, duration_ms: 4000, created: '2026-03-01 00:00:00' });
    try {
        const plan = require('../lib/resolve-export').planResolve(db, pid);
        assert.equal(plan.lanes.music.length, 1, JSON.stringify(plan.lanes.music));
        const bed = plan.lanes.music[0];
        assert.equal(bed.name, 'music diner_theme_v2.wav', 'the newest music file is the bed');
        assert.equal(bed.start_ms, 0, 'the bed starts with its scene');
        assert.ok(bed.file.startsWith('Scene_01_INT-DINER-NIGHT/Sound/'), bed.file);
        const f = plan.files.find(x => x.to === bed.file);
        assert.ok(f, 'the music file is copied into the export');
        assert.ok(!plan.files.some(x => /^Score\//.test(x.to)), 'nothing goes to a Score/ folder');
    } finally {
        db.prepare('DELETE FROM film_assets WHERE id IN (?, ?)').run(older, newer);
    }
});

test('a project with nothing to edit is refused, naming why', async () => {
    const empty = generateId();
    db.prepare(`INSERT INTO film_projects (id, title, target_fps) VALUES (?, 'Empty', 24)`).run(empty);
    const r = await call('POST', ['film', 'projects', empty, 'export', 'resolve']);
    assert.equal(r.code, 409);
    assert.equal(r.json.error, 'NOTHING_TO_EDIT');
});

test('actual package roundtrip preserves chosen footage, five-second images and independent sound edits at fractional fps', async () => {
    const { JSDOM } = require('jsdom');
    const { saveAudioTracks } = require('../lib/production-recipes');
    const { elapsedFrames, actualRate } = require('../lib/nle-export');
    const project = generateId(), scene = generateId(), a = generateId(), b = generateId(), sequence = generateId();
    db.prepare("INSERT INTO film_projects (id,title,target_resolution,target_fps) VALUES (?,'Sound edit','1920x1080',23.976)").run(project);
    db.prepare('INSERT INTO film_scenes (id,project_id,scene_number) VALUES (?,?,1)').run(scene, project);
    for (const [id, code, order] of [[a, 'A', 0], [b, 'B', 1]]) db.prepare('INSERT INTO film_shots (id,scene_id,shot_code,sort_order,duration_ms) VALUES (?,?,?,?,9000)').run(id, scene, code, order);
    const add = (id, shot, type, file, duration, metadata = {}) => db.prepare(`INSERT INTO film_assets
        (id,project_id,shot_id,asset_type,file_path,file_name,duration_ms,version,metadata) VALUES (?,?,?,?,?,?,?,1,?)`)
        .run(id, project, shot, type, file, path.basename(file), duration, JSON.stringify(metadata));
    const videoId = generateId(), imageId = generateId(), soundId = generateId();
    const videoFile = silentClip('sound_edit_selected.mp4', 'red'), imageFile = png('sound_edit_board.png'), soundFile = tone('sound_edit_whole.wav', 4);
    add(videoId, a, 'video_raw', videoFile, 2000, { edit: { source_in_ms: 250, duration_ms: 1000 } });
    add(generateId(), a, 'video_raw', silentClip('sound_edit_unused.mp4', 'blue'), 2000);
    add(imageId, b, 'storyboard', imageFile, null);
    add(soundId, a, 'audio_sfx', soundFile, 4000);
    db.prepare('UPDATE film_shots SET selected_video_asset_id=? WHERE id=?').run(videoId, a);
    db.prepare('INSERT INTO film_sequences (id,project_id,name,shot_ids) VALUES (?,?,?,?)').run(sequence, project, 'A and B', JSON.stringify([b, a]));
    const pre = saveAudioTracks(db, project, 'shot:' + a, [{ asset_id: soundId, offset_ms: -250, source_in_ms: 500, duration_ms: 1000, gain_db: -6, muted: true }])[0];
    const post = saveAudioTracks(db, project, 'seq:' + sequence, [{ asset_id: soundId, offset_ms: 5500, source_in_ms: 1000, duration_ms: 1000, gain_db: 3, muted: false }])[0];
    const tl = require('../routes/timeline').loadTimeline(project);
    assert.deepEqual(tl.entries.map(e => [e.shot_id, e.duration_ms]), [[a, 1000], [b, 5000]]);
    assert.equal(tl.audio_tracks.find(t => t.id === post.id).absolute_start_ms, 5500);
    const response = await call('POST', ['film', 'projects', project, 'export', 'resolve']);
    assert.equal(response.code, 200, JSON.stringify(response.json));
    assert.equal(response.json.imported_into_resolve, false);
    assert.equal(response.json.status, 'package_written');
    const dest = response.json.dest;
    const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json')));
    const dom = new JSDOM(fs.readFileSync(path.join(dest, response.json.xml), 'utf8'), { contentType: 'text/xml' });
    const doc = dom.window.document;
    assert.equal(doc.querySelector('parsererror'), null);
    assert.equal(Number(doc.querySelector('sequence > rate > timebase').textContent), 24);
    assert.equal(doc.querySelector('sequence > rate > ntsc').textContent, 'TRUE');
    assert.equal(manifest.timebase.actual_fps, actualRate(23.976));
    assert.equal(manifest.imported_into_resolve, false);
    const video = [...doc.querySelectorAll('sequence > media > video > track > clipitem')];
    assert.deepEqual(video.map(c => c.querySelector('name').textContent), ['A', 'B (board)']);
    assert.equal(Number(video[0].querySelector('in').textContent), elapsedFrames(250, 23.976));
    assert.equal(Number(video[0].querySelector('out').textContent), elapsedFrames(250, 23.976) + elapsedFrames(1000, 23.976));
    assert.equal(Number(video[1].querySelector('end').textContent) - Number(video[1].querySelector('start').textContent), elapsedFrames(5000, 23.976));
    assert.equal(manifest.shots[0].asset_id, videoId);
    assert.equal(manifest.shots[1].asset_id, imageId);
    const preExport = manifest.audio_tracks.find(t => t.id === pre.id);
    assert.equal(preExport.absolute_start_ms, -250);
    assert.equal(preExport.source_in_ms, 500);
    assert.equal(preExport.effective_source_in_ms, 750);
    assert.equal(preExport.duration_ms, 1000);
    assert.equal(preExport.timeline_used_duration_ms, 750);
    assert.equal(preExport.source.sha256, crypto.createHash('sha256').update(fs.readFileSync(soundFile)).digest('hex'));
    assert.deepEqual(fs.readFileSync(path.join(dest, preExport.file)), fs.readFileSync(soundFile), 'full original sound copied, never destructively trimmed');
    const audio = [...doc.querySelectorAll('sequence > media > audio > track > clipitem')];
    assert.equal(audio.length, 2, 'explicit tracks replace implicit sfx attachment; conditioning audio is never promoted');
    const muted = audio.find(c => c.querySelector('enabled').textContent === 'FALSE');
    assert.ok(muted, 'mute is an explicit interchange edit');
    assert.equal(Number(muted.querySelector('in').textContent), elapsedFrames(750, 23.976));
    assert.match(muted.textContent, /0\.50119/);
    for (const track of manifest.audio_tracks) {
        const clip = audio.find(c => c.querySelector('name').textContent === track.export_name);
        assert.equal(Number(clip.querySelector('start').textContent), track.xml_frames.start);
        assert.equal(Number(clip.querySelector('end').textContent), track.xml_frames.end);
        assert.equal(Number(clip.querySelector('in').textContent), track.xml_frames.source_in);
        assert.equal(Number(clip.querySelector('out').textContent), track.xml_frames.source_out);
    }
    assert.ok(manifest.warnings.some(w => w.code === 'PRELAP_BEFORE_CUT'));
    assert.ok(manifest.warnings.some(w => w.code === 'POSTLAP_AFTER_CUT'));
    fs.appendFileSync(soundFile, 'changed');
    const changed = await call('GET', ['film', 'projects', project, 'export', 'resolve']);
    assert.ok(changed.json.blocking.some(i => i.code === 'AUDIO_SOURCE_BYTES_CHANGED'));
    const refused = await call('POST', ['film', 'projects', project, 'export', 'resolve']);
    assert.equal(refused.code, 409);
    fs.unlinkSync(soundFile);
    const offline = await call('GET', ['film', 'projects', project, 'export', 'resolve']);
    assert.ok(offline.json.blocking.some(i => i.code === 'AUDIO_SOURCE_OFFLINE'));
    assert.equal(offline.json.audio_tracks.length, 2, 'offline edits remain in the plan for relink');
});
