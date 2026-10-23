/**
 * Seedance prompt (lib/seedance-prompt.js): Optimize with AI, the director's way. With real ffmpeg and a fake ChatGPT:
 *   - each character's approved views become ONE character sheet, side by side; a location's views one location sheet
 *   - expressions and inspiration stills never reach it (the gallery's own rule)
 *   - each recorded line lands at its time on one dialogue track, on a black-screen MP4 as long as the clip
 *   - ChatGPT gets the pictures in label order, the working prompt, the line timings and the stored guide (without its
 *     marketing closing line), and the hand-off folder holds every file named by the label the prompt binds
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-seedance-'));
process.env.FILM_DATA_DIR = path.join(TMP, 'data');
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const { resolveFfmpeg } = require('../lib/ffmpeg');
const SP = require('../lib/seedance-prompt');

const ff = resolveFfmpeg();
const haveFfmpeg = !!(ff && ff.available);
const assetsDir = path.join(TMP, 'film');
fs.mkdirSync(assetsDir, { recursive: true });
const projectId = generateId(), juneId = generateId(), dinerId = generateId(), shotId = generateId(), sceneId = generateId();
db.prepare('INSERT INTO film_projects (id, title, assets_dir) VALUES (?, ?, ?)').run(projectId, 'Seedance test', assetsDir);
db.prepare('INSERT INTO film_characters (id, project_id, name) VALUES (?, ?, ?)').run(juneId, projectId, 'JUNE');
db.prepare('INSERT INTO film_locations (id, project_id, name) VALUES (?, ?, ?)').run(dinerId, projectId, 'THE DINER');
db.prepare('INSERT INTO film_scenes (id, project_id, scene_number) VALUES (?, ?, 1)').run(sceneId, projectId);
db.prepare('INSERT INTO film_shots (id, scene_id, shot_code) VALUES (?, ?, ?)').run(shotId, sceneId, '1A');

const pic = (name, w, h, color) => { const f = path.join(TMP, name); if (haveFfmpeg) execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', f]); return f; };
const tone = (name, secs) => { const f = path.join(TMP, name); if (haveFfmpeg) execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=440:d=${secs}`, f]); return f; };
const asset = (cols, type, file, meta = {}) => {
    const id = generateId();
    const names = Object.keys(cols);
    db.prepare(`INSERT INTO film_assets (id, project_id, ${names.join(', ')}, asset_type, file_path, file_name, format, metadata) VALUES (?, ?, ${names.map(() => '?').join(', ')}, ?, ?, ?, 'png', ?)`)
        .run(id, projectId, ...Object.values(cols), type, file, path.basename(file), JSON.stringify(meta));
    return id;
};
let frameId;
if (haveFfmpeg) {
    asset({ character_id: juneId }, 'character_sheet', pic('JUNE_back.png', 400, 800, 'blue'), { view: 'back' });
    asset({ character_id: juneId }, 'character_sheet', pic('JUNE_front.png', 400, 800, 'red'), { view: 'front' });
    asset({ character_id: juneId }, 'character_sheet', pic('JUNE_side.png', 400, 800, 'green'), { view: 'side' });
    asset({ character_id: juneId }, 'reference_image', pic('JUNE_smile.png', 400, 800, 'white'), { view: 'front', reference_role: 'expression' });
    asset({ location_id: dinerId }, 'reference_image', pic('DINER_east.png', 1600, 900, 'gray'), { view: 'east' });
    asset({ location_id: dinerId }, 'reference_image', pic('DINER_south.png', 1600, 900, 'yellow'), { view: 'south' });
    frameId = asset({ shot_id: shotId }, 'storyboard', pic('1A.png', 1280, 720, 'purple'));
    asset({ shot_id: shotId }, 'audio_dialogue', tone('1A_JUNE_0.mp3', 1));
    asset({ shot_id: shotId }, 'audio_dialogue', tone('1A_RAY_1.mp3', 1));
}
const probe = (f, entries) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', f]).toString().trim();

const BODY = () => ({ label: '1A', prompt: 'June sets the cup down. {JUNE: "Late again."} {RAY: "Traffic."}', duration_s: 6, aspect: '16:9', model_label: 'Seedance 2.5',
    shots: [{ shot_id: shotId, code: '1A', offset_s: 0, lines: [{ index: 0, t: 1, ch: 'JUNE', name: 'June', text: 'Late again.' }, { index: 1, t: 3.5, ch: 'RAY', name: 'Ray', text: 'Traffic.' }] }],
    character_ids: [juneId], location_ids: [dinerId], prop_ids: [], storyboard_asset_ids: [frameId] });

test('the guide is stored in the app, without its marketing closing line', () => {
    const g = SP.guide();
    assert.match(g, /\[GOAL\]/);
    assert.match(g, /@Image/);
    assert.doesNotMatch(g, /dankieft|Closing line/);
});

test('sheets, frames and the dialogue MP4 are made, ChatGPT gets them in label order, and the folder names them', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    let asked;
    const ask = async (q) => { asked = q; return { model: 'gpt-6-astra', text: 'Here: {"prompt": "[GOAL] June in the diner. JUNE corresponds to @Image 1. The diner corresponds to @Image 2. Dialogue from @Video 1.", "references": [{"label": "@Image 1", "use": "June\'s look"}], "notes": ["Check the cup"]}' }; };
    const out = await SP.writeSeedancePrompt(projectId, BODY(), { ask });

    assert.deepStrictEqual(out.refs.map(r => [r.label, r.role, r.name]), [
        ['@Image 1', 'character sheet', 'JUNE'], ['@Image 2', 'location sheet', 'THE DINER'], ['@Image 3', 'storyboard frame', 'shot 1A'], ['@Video 1', 'dialogue audio', 'dialogue']]);
    // One sheet of June's three approved views, front first, at one height; the expression study is not in it.
    assert.strictEqual(probe(out.refs[0].file, 'stream=width,height'), `${3 * 450},900`);
    assert.strictEqual(probe(out.refs[1].file, 'stream=width,height'), `${2 * 1600},900`);
    // The dialogue: a black picture as long as the clip, with both lines on its track.
    const mp4 = out.refs[3].file;
    assert.ok(Math.abs(Number(probe(mp4, 'format=duration')) - 6) < 0.2, 'the MP4 is as long as the clip');
    assert.match(probe(mp4, 'stream=codec_type'), /video[\s\S]*audio|audio[\s\S]*video/);
    // Sound where each line is (1-2 s and 3.5-4.5 s), silence between and after.
    const level = (from, to) => { const r = require('child_process').spawnSync(ff.bin, ['-v', 'info', '-ss', String(from), '-t', String(to - from), '-i', mp4, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
        return Number((/max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr) || [])[1] ?? -999); };
    assert.ok(level(1.2, 1.8) > -20, 'June\'s line is at 1 s');
    assert.ok(level(3.7, 4.3) > -20, 'Ray\'s line is at 3.5 s');
    assert.ok(!(level(2.3, 3.2) > -60), 'silence between the lines');

    assert.deepStrictEqual(asked.images, out.refs.filter(r => r.kind === 'image').map(r => r.file), 'the pictures go in label order');
    assert.match(asked.prompt, /@Video 1 = the recorded dialogue on a black screen[\s\S]*0:01\.0 June: "Late again\."; 0:03\.5 Ray: "Traffic\."/);
    assert.match(asked.prompt, /THE DIRECTOR'S WORKING PROMPT:\nJune sets the cup down/);
    assert.match(asked.prompt, /THE GUIDE:[\s\S]*\[GOAL\]/);
    assert.match(asked.prompt, /Do not ask questions; draft now/);

    assert.strictEqual(out.prompt, '[GOAL] June in the diner. JUNE corresponds to @Image 1. The diner corresponds to @Image 2. Dialogue from @Video 1.');
    assert.strictEqual(out.refs[0].use, 'June\'s look');
    assert.strictEqual(out.refs[2].in_prompt, false, 'a material the prompt does not bind is flagged');
    assert.deepStrictEqual(fs.readdirSync(out.folder).sort(), ['00 prompt.txt', '01 @Image 1 - JUNE character sheet.png', '02 @Image 2 - THE DINER location sheet.png',
        '03 @Image 3 - shot 1A storyboard frame.png', '04 @Video 1 - dialogue (black screen).mp4']);
    assert.ok(out.folder.startsWith(path.join(assetsDir, '07 Delivery', 'Exports', 'Seedance hand-off')));
});

test('a recording the director chose wins: the part from where this clip starts, as long as the clip', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    // A 20 s "scene take": silence, then a tone from 10 s to 12 s. The clip starts 9 s into it, so the tone is at 1-3 s.
    const take = path.join(TMP, 'scene take.wav');
    execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=10', '-f', 'lavfi', '-i', 'sine=f=300:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=8',
        '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', take]);
    const out = await SP.writeSeedancePrompt(projectId, { ...BODY(), dialogue_file: { path: take, from_s: 9 } }, { ask: async () => ({ text: '{"prompt": "x @Video 1"}' }) });
    const v = out.refs.find(r => r.kind === 'video');
    assert.strictEqual(v.source, 'scene take.wav from 9 s');
    const level = (from, to) => { const r = require('child_process').spawnSync(ff.bin, ['-v', 'info', '-ss', String(from), '-t', String(to - from), '-i', v.file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
        return Number((/max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr) || [])[1] ?? -999); };
    assert.ok(level(1.3, 2.7) > -20, 'the take\'s 10-12 s is at 1-3 s in the clip');
    assert.ok(!(level(3.5, 5.5) > -60), 'and nothing else');
    await assert.rejects(SP.writeSeedancePrompt(projectId, { ...BODY(), dialogue_file: { path: '/nope.wav' } }, { ask: async () => ({ text: '{}' }) }), /not at \/nope.wav/);
});

test('as a job it reports each stage while ChatGPT writes, then holds the result to be read', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    let release; const gate = new Promise(r => { release = r; });
    const seen = [];
    const job = SP.startJob(projectId, BODY(), { ask: async () => { seen.push(SP.getJob(job.id).stage); await gate; return { text: '{"prompt": "done @Image 1"}', model: 'm' }; } });
    assert.strictEqual(job.status, 'running');
    for (let i = 0; i < 200 && !seen.length; i++) await new Promise(r => setTimeout(r, 25));
    const mid = SP.getJob(job.id);
    assert.strictEqual(mid.stage, 'writing');
    assert.match(mid.stage_label, /ChatGPT is writing the prompt from 3 pictures and the dialogue/);
    release();
    for (let i = 0; i < 200 && SP.getJob(job.id).status === 'running'; i++) await new Promise(r => setTimeout(r, 25));
    const end = SP.getJob(job.id);
    assert.strictEqual(end.status, 'done');
    assert.strictEqual(end.result.prompt, 'done @Image 1');
    assert.throws(() => SP.getJob('nope'), /gone/);
});

test('an answer with no prompt in it is an error, and an empty working prompt is refused before anything is made', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    await assert.rejects(SP.writeSeedancePrompt(projectId, BODY(), { ask: async () => ({ text: 'sorry' }) }), /had no prompt/);
    await assert.rejects(SP.writeSeedancePrompt(projectId, { ...BODY(), prompt: '  ' }, { ask: async () => assert.fail('asked') }), /prompt is empty/);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
