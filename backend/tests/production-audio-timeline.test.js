const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTimeline, projectAudioTracks } = require('../lib/timeline');

test('late historical media requires an explicit selection in playback', () => {
    const assets = { a: [
        { id:'late-video',asset_type:'video_raw',file_path:'/late.mp4',duration_ms:3000,metadata:JSON.stringify({historical:true}) },
        { id:'late-frame',asset_type:'storyboard',file_path:'/late.png',version:2,metadata:JSON.stringify({historical:true}) },
    ] };
    assert.equal(buildTimeline([{id:'a'}],assets).entries[0].kind,'empty');
    assert.equal(buildTimeline([{id:'a',selected_video_asset_id:'late-video'}],assets).entries[0].video.asset_id,'late-video');
    assert.equal(buildTimeline([{id:'a',current_frame_version:2}],assets).entries[0].still.asset_id,'late-frame');
});
test('a selected board version resolves across image types and broken explicit selection stays unavailable', () => {
    const assets = { a: [
        {id:'chosen',asset_type:'storyboard',version:1,file_path:'/chosen.png'},
        {id:'other',asset_type:'keyframe',version:2,file_path:'/other.png'},
    ] };
    assert.equal(buildTimeline([{id:'a',current_frame_version:1}],assets).entries[0].still.asset_id,'chosen');
    const missing=buildTimeline([{id:'a',current_frame_version:9}],assets).entries[0];
    assert.equal(missing.kind,'empty');assert.equal(missing.unavailable_still.version,9);
});

test('a selected edited clip keeps its source range; every image holds exactly five seconds', () => {
    const tl = buildTimeline([
        { id: 'a', scene_number: 1, sort_order: 1, duration_ms: 9000 },
        { id: 'b', scene_number: 1, sort_order: 2, duration_ms: 1000 },
    ], {
        a: [{ id: 'selected', selected_video_asset_id: 'selected', asset_type: 'video_raw', file_path: '/clip.mp4', duration_ms: 8000,
            metadata: JSON.stringify({ edit: { source_in_ms: 2000, duration_ms: 3000 } }) }],
        b: [{ id: 'image', asset_type: 'storyboard', file_path: '/image.png' },
            { asset_type: 'audio_dialogue', file_path: '/line.mp3', file_name: 'b_0.mp3', duration_ms: 12000 }],
    });
    assert.equal(tl.entries[0].duration_ms, 3000);
    assert.equal(tl.entries[0].video.asset_id, 'selected');
    assert.equal(tl.entries[0].source_in_ms, 2000);
    assert.equal(tl.entries[1].duration_ms, 5000);
    assert.equal(tl.entries[1].duration_basis, 'fixed_five_second_image');
    assert.equal(tl.total_duration_ms, 8000);
});

test('an offline selected clip falls back to an available image without substituting another take', () => {
    const tl = buildTimeline([{ id: 'a', selected_video_asset_id: 'gone', duration_ms: 1000 }], { a: [
        { id: 'gone', selected_video_asset_id: 'gone', asset_type: 'video_raw', file_path: '/offline.mp4', offline: true, duration_ms: 3000 },
        { id: 'other', asset_type: 'video_raw', file_path: '/other.mp4', duration_ms: 4000 },
        { id: 'board', asset_type: 'storyboard', file_path: '/board.png' },
    ] });
    assert.equal(tl.entries[0].kind, 'still');
    assert.equal(tl.entries[0].duration_ms, 5000);
    assert.equal(tl.entries[0].unavailable_video.asset_id, 'gone');
});

test('timeline sounds preserve independent source edits and disclose effective prelap/postlap ranges', () => {
    const source = { path: '/sound.wav', duration_ms: 9000, sha256: 'recorded', offline: false };
    const entries = [{ shot_id: 'a', start_ms: 0, end_ms: 3000 }, { shot_id: 'b', start_ms: 3000, end_ms: 8000 }];
    const tracks = [
        { id: 'pre', shot_id: 'a', relationship: 'timeline_audio', source, offset_ms: -500, source_in_ms: 1000, duration_ms: 2000, gain_db: -4, muted: true, order: 0 },
        { id: 'seq', sequence_id: 'sequence', relationship: 'timeline_audio', source, offset_ms: 500, source_in_ms: 250, duration_ms: 1000, gain_db: 3, muted: false, order: 1 },
        { id: 'post', shot_id: 'b', relationship: 'timeline_audio', source, offset_ms: 4000, source_in_ms: 500, duration_ms: 2000, gain_db: 0, muted: false, order: 2 },
    ];
    const projected = projectAudioTracks(entries, tracks, { sequence: ['b', 'a'] }, 8000);
    const pre = projected.find(t => t.id === 'pre');
    assert.equal(pre.absolute_start_ms, -500);
    assert.equal(pre.timeline_start_ms, 0);
    assert.equal(pre.effective_source_in_ms, 1500);
    assert.equal(pre.timeline_used_duration_ms, 1500);
    assert.equal(pre.source_in_ms, 1000);
    assert.equal(pre.duration_ms, 2000);
    assert.equal(pre.muted, true);
    assert.deepEqual(pre.timeline_adjustments, [{ code: 'PRELAP_BEFORE_CUT', omitted_ms: 500 }]);
    assert.equal(projected.find(t => t.id === 'seq').absolute_start_ms, 500, 'sequence starts at its earliest narrative member, independent of membership array order');
    const post = projected.find(t => t.id === 'post');
    assert.equal(post.absolute_start_ms, 7000);
    assert.equal(post.timeline_used_duration_ms, 1000);
    assert.deepEqual(post.timeline_adjustments, [{ code: 'POSTLAP_AFTER_CUT', omitted_ms: 1000 }]);
    assert.equal(tracks[0].source_in_ms, 1000, 'projection does not rewrite edits');
});

test('unplaced/offline sounds remain visible rather than being dropped', () => {
    const projected = projectAudioTracks([{ shot_id: 'a', start_ms: 0, end_ms: 5000 }], [
        { id: 'unplaced', shot_id: 'missing', source: { path: '/x.wav' }, offset_ms: 0, source_in_ms: 0, duration_ms: 1000 },
        { id: 'offline', shot_id: 'a', source: { path: '/gone.wav', offline: true }, offset_ms: 0, source_in_ms: 0, duration_ms: 1000 },
    ], {}, 5000);
    assert.equal(projected.length, 2);
    assert.equal(projected[0].status, 'unplaced');
    assert.equal(projected[0].absolute_start_ms, null);
    assert.equal(projected[1].status, 'offline');
});

test('membership in a covering clip does not invent an individual shot start time', () => {
    const coverage = new Map([['covered', { lead_shot_id: 'lead' }]]);
    const [track] = projectAudioTracks([{ shot_id: 'lead', start_ms: 0, end_ms: 5000 }], [
        { shot_id: 'covered', offset_ms: 100, source_in_ms: 0, duration_ms: 1000, source: { path: '/x.wav' } },
    ], {}, 5000, coverage);
    assert.equal(track.status, 'unplaced');
    assert.equal(track.absolute_start_ms, null);
    assert.match(track.placement_reason, /individual start time is not recorded/);
});

test('changed source bytes are an unavailable sound state while the original edit stays visible', () => {
    const [track] = projectAudioTracks([{ shot_id: 'a', start_ms: 0, end_ms: 5000 }], [
        { id: 'changed', shot_id: 'a', source_bytes_status: 'changed', current_source: { sha256: 'new' },
            source: { path: '/x.wav', sha256: 'original', offline: false }, offset_ms: 100, source_in_ms: 200, duration_ms: 1000 },
    ], {}, 5000);
    assert.equal(track.status, 'source_changed');
    assert.equal(track.source.sha256, 'original');
    assert.equal(track.timeline_used_duration_ms, 1000);
});

test('explicit timeline attachment suppresses only legacy audio with the same asset identity', () => {
    const tl = buildTimeline([{ id: 'a', duration_ms: 1000 }], { a: [
        { id: 'board', asset_type: 'storyboard', file_path: '/board.png' },
        { id: 'attached', asset_type: 'audio_dialogue', file_path: '/line0.mp3', file_name: 'a_0.mp3', duration_ms: 1000 },
        { id: 'legacy', asset_type: 'audio_dialogue', file_path: '/line1.mp3', file_name: 'a_1.mp3', duration_ms: 500 },
    ] }, { audioTracks: [{ id: 'track', asset_id: 'attached', shot_id: 'a', offset_ms: 0, source_in_ms: 0, duration_ms: 1000, source: { path: '/line0.mp3', asset_id: 'attached' } }] });
    assert.equal(tl.entries[0].audio, null, 'the automatically picked same asset must not play beside its explicit edit');
    assert.deepEqual(tl.entries[0].audio_lines.map(l => l.asset_id), ['legacy']);
    assert.equal(tl.audio_tracks.length, 1);
    const noIdentity = buildTimeline([{ id: 'a' }], { a: [
        { id: 'legacy', asset_type: 'audio_dialogue', file_path: '/same-name.mp3', file_name: 'a_0.mp3', duration_ms: 1000 },
    ] }, { audioTracks: [{ asset_id: 'different', shot_id: 'a', offset_ms: 0, source_in_ms: 0, duration_ms: 1000, source: { path: '/same-name.mp3' } }] });
    assert.equal(noIdentity.entries[0].audio_lines.length, 1, 'a matching filename/path alone is not the same asset');
});

test('actual Resolve writer roundtrip retains selected sources, explicit sound edits and rational timebase (media inspection mocked; no Resolve import)', () => {
    const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
    process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'film-audio-xml-'));
    const { db } = require('../db/database');
    require('../db/schema').ensureSchema();
    const ffmpeg = require('../lib/ffmpeg'), realInspect = ffmpeg.inspectMedia;
    ffmpeg.inspectMedia = () => ({ ok: true, hasAudio: false, durationSeconds: 2 });
    const { planResolve, writeResolve } = require('../lib/resolve-export');
    const { saveAudioTracks } = require('../lib/production-recipes');
    const { loadTimeline } = require('../routes/timeline');
    const { JSDOM } = require('jsdom');
    const { elapsedFrames, actualRate } = require('../lib/nle-export');
    const dir = process.env.FILM_DATA_DIR;
    const wav = Buffer.alloc(44 + 4000 * 48 * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC34AAAAASUVORK5CYII=', 'base64');
    const sourceFile = path.join(dir, 'whole.wav'), imageFile = path.join(dir, 'board.png');
    fs.writeFileSync(sourceFile, wav); fs.writeFileSync(imageFile, imageBytes);
    try {
        for (const fps of [24, 23.976, 29.97]) {
            const project = crypto.randomUUID(), scene = crypto.randomUUID(), a = crypto.randomUUID(), b = crypto.randomUUID(), seq = crypto.randomUUID();
            db.prepare('INSERT INTO film_projects(id,title,target_fps) VALUES (?,?,?)').run(project, `Fixture ${fps}`, fps);
            db.prepare('INSERT INTO film_scenes(id,project_id,scene_number) VALUES (?,?,1)').run(scene, project);
            for (const [id, code, order] of [[a, 'A', 0], [b, 'B', 1]]) db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,sort_order,duration_ms) VALUES (?,?,?,?,9000)').run(id, scene, code, order);
            const video = crypto.randomUUID(), unused = crypto.randomUUID(), image = crypto.randomUUID(), sound = crypto.randomUUID();
            const videoFile = path.join(dir, video + '.mp4'), unusedFile = path.join(dir, unused + '.mp4');
            fs.writeFileSync(videoFile, Buffer.from('selected opaque video fixture; inspection is mocked'));
            fs.writeFileSync(unusedFile, Buffer.from('unselected opaque video fixture; inspection is mocked'));
            const asset = (id, shot, type, file, duration, metadata = {}) => db.prepare(`INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,duration_ms,version,metadata)
                VALUES (?,?,?,?,?,?,?,1,?)`).run(id, project, shot, type, file, path.basename(file), duration, JSON.stringify(metadata));
            asset(video, a, 'video_raw', videoFile, 2000, { edit: { source_in_ms: 250, duration_ms: 1000 } });
            asset(unused, a, 'video_raw', unusedFile, 2000);
            asset(image, b, 'storyboard', imageFile, null);
            asset(sound, a, 'audio_sfx', sourceFile, 4000);
            db.prepare('UPDATE film_shots SET selected_video_asset_id=? WHERE id=?').run(video, a);
            db.prepare('INSERT INTO film_sequences(id,project_id,name,shot_ids) VALUES (?,?,?,?)').run(seq, project, 'Sequence', JSON.stringify([b, a]));
            const pre = saveAudioTracks(db, project, 'shot:' + a, [{ asset_id: sound, offset_ms: -250, source_in_ms: 500, duration_ms: 1000, gain_db: -6, muted: true }])[0];
            const post = saveAudioTracks(db, project, 'seq:' + seq, [{ asset_id: sound, offset_ms: 5500, source_in_ms: 1000, duration_ms: 1000, gain_db: 3, muted: false }])[0];
            const timeline = loadTimeline(project);
            assert.deepEqual(timeline.entries.map(e => [e.shot_id, e.duration_ms]), [[a, 1000], [b, 5000]]);
            assert.equal(timeline.audio_tracks.find(t => t.id === post.id).absolute_start_ms, 5500);
            const result = writeResolve(db, project, { dest: path.join(dir, 'package-' + fps) });
            const manifestPath = path.join(result.dest, 'manifest.json');
            const manifestText = fs.readFileSync(manifestPath, 'utf8'), manifest = JSON.parse(manifestText);
            assert.equal(manifest.status, 'package_written'); assert.equal(manifest.imported_into_resolve, false);
            assert.equal(manifest.timebase.actual_fps, actualRate(fps));
            const scriptPath = path.join(result.dest, result.script);
            // Parse Python syntax only. This never imports/executes the helper.
            require('child_process').execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', scriptPath], { timeout: 60000 });
            assert.equal(manifest.shots[0].asset_id, video); assert.equal(manifest.shots[1].asset_id, image);
            const xml = new JSDOM(fs.readFileSync(path.join(result.dest, result.xml), 'utf8'), { contentType: 'text/xml' }).window.document;
            const picture = [...xml.querySelectorAll('sequence > media > video > track > clipitem')];
            assert.deepEqual(picture.map(c => c.querySelector('name').textContent), ['A', 'B (board)']);
            assert.equal(Number(picture[1].querySelector('start').textContent), Number(picture[0].querySelector('end').textContent), 'quantized narrative cut is contiguous');
            assert.equal(Number(picture[0].querySelector('in').textContent), elapsedFrames(250, fps));
            assert.equal(Number(xml.querySelector('sequence > duration').textContent), elapsedFrames(6000, fps));
            const clips = [...xml.querySelectorAll('sequence > media > audio > track > clipitem')];
            assert.equal(clips.length, 2, 'explicit edits replace implicit sfx; conditioning references are never promoted');
            for (const track of manifest.audio_tracks) {
                assert.deepEqual(fs.readFileSync(path.join(result.dest, track.file)), wav, 'source audio stays whole');
                const clip = clips.find(c => c.querySelector('name').textContent === track.export_name);
                for (const [tag, field] of [['start', 'start'], ['end', 'end'], ['in', 'source_in'], ['out', 'source_out']]) assert.equal(Number(clip.querySelector(tag).textContent), track.xml_frames[field]);
                assert.equal(clip.querySelector('enabled').textContent, track.muted ? 'FALSE' : 'TRUE');
                assert.equal(Number(clip.querySelector('parameter > value').textContent), track.xml_audio.linear_gain);
            }
            const exportedPre = manifest.audio_tracks.find(t => t.id === pre.id);
            assert.equal(exportedPre.absolute_start_ms, -250); assert.equal(exportedPre.source_in_ms, 500);
            assert.equal(exportedPre.effective_source_in_ms, 750); assert.equal(exportedPre.timeline_used_duration_ms, 750);
            assert.ok(manifest.warnings.some(w => w.code === 'PRELAP_BEFORE_CUT'));
            assert.ok(manifest.warnings.some(w => w.code === 'POSTLAP_AFTER_CUT'));
            const copied = manifest.files.find(f => f.source_path === videoFile);
            assert.deepEqual(fs.readFileSync(path.join(result.dest, copied.to)), fs.readFileSync(videoFile));
            db.prepare('UPDATE film_shots SET selected_video_asset_id=? WHERE id=?').run(unused, a);
            assert.equal(planResolve(db, project).shots[0].asset_id, unused, 'new plan uses new selection while prior manifest stays immutable');
            assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifestText);
            fs.appendFileSync(sourceFile, 'changed');
            assert.equal(loadTimeline(project).audio_tracks[0].status, 'source_changed');
            assert.ok(planResolve(db, project).blocking.some(i => i.code === 'AUDIO_SOURCE_BYTES_CHANGED'));
            assert.throws(() => writeResolve(db, project, { dest: path.join(dir, 'changed-' + fps) }), { code: 'AUDIO_SOURCE_BYTES_CHANGED' });
            fs.unlinkSync(sourceFile);
            const offline = planResolve(db, project);
            assert.ok(offline.blocking.some(i => i.code === 'AUDIO_SOURCE_OFFLINE'));
            assert.equal(offline.audio_tracks.length, 2, 'offline edit and relink identity remain visible');
            fs.writeFileSync(sourceFile, wav);
            const movedPath = path.join(dir, 'replacement.wav'); fs.writeFileSync(movedPath, wav);
            db.prepare('UPDATE film_assets SET file_path=?,version=2 WHERE id=?').run(movedPath, sound);
            const frozen = loadTimeline(project).audio_tracks.find(t => t.id === pre.id);
            assert.equal(frozen.source.path, sourceFile); assert.equal(frozen.source.version, 1, 'asset row changes do not rewrite the attached source');
            saveAudioTracks(db, project, 'shot:' + a, [{ id: pre.id, asset_id: sound, offset_ms: -250, source_in_ms: 500, duration_ms: 1000, gain_db: 10000, muted: false }]);
            assert.ok(planResolve(db, project).blocking.some(i => i.code === 'AUDIO_GAIN_UNREPRESENTABLE'));
            // Move a subframe edit inside the cut so frame quantization, rather
            // than cut clipping, determines its interchange representation.
            saveAudioTracks(db, project, 'shot:' + a, [{ id: pre.id, asset_id: sound, offset_ms: 0, source_in_ms: 500, duration_ms: 1, gain_db: -6, muted: false }]);
            assert.ok(planResolve(db, project).warnings.some(i => i.code === 'AUDIO_BELOW_FRAME'));
        }
    } finally {
        ffmpeg.inspectMedia = realInspect;
        db.close(); fs.rmSync(dir, { recursive: true, force: true });
    }
});
