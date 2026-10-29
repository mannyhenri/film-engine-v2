/**
 * Generators (lib/generators.js, routes/generators.js): the Production tab's local AI tools.
 *
 * Run against the fixture engine folder (tests/fixtures/generators): two tools that speak the real
 * engines' CLI and progress JSON through fake_engine.py, and one broken manifest. Checks:
 *   - tools come from the manifests, a broken one is listed as not ready with the reason
 *   - the command line is built only from declared options, with values checked against the manifest,
 *     and a section is passed only to a section tool
 *   - a dropped file is probed for fps and frames, and non-media or missing paths are refused
 *   - jobs run one at a time, report progress and outputs, fail with the engine's own message,
 *     and Cancel stops a running engine
 *   - the routes answer and never hand the page the command line
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-generators-'));
process.env.FILM_GENERATORS_DIR = path.join(__dirname, 'fixtures', 'generators');
process.env.FILM_GENERATORS_OUT = path.join(TMP, 'out');
process.env.FILM_GENERATORS_STATE = path.join(TMP, 'state');
const gen = require('../lib/generators');
const { handleGenerators } = require('../routes/generators');
const { resolveFfmpeg } = require('../lib/ffmpeg');

const CLIP = path.join(TMP, 'clip.mp4');
const ff = resolveFfmpeg();
const haveFfmpeg = !!(ff && ff.available);
if (haveFfmpeg) {
    execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '2',
        '-pix_fmt', 'yuv420p', CLIP]);
}

const waitFor = async (pred, ms = 15000) => {
    const t0 = Date.now();
    while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 50)); }
};
const fresh = () => { gen._reset(); fs.rmSync(path.join(TMP, 'state'), { recursive: true, force: true }); };

test('tools come from their manifests; a broken one says why it is not ready', () => {
    const tools = gen.listTools();
    const byId = Object.fromEntries(tools.map(t => [t.id, t]));
    assert.deepStrictEqual(Object.keys(byId).sort(), ['broken', 'fake-cut', 'fake-depth', 'fake-image-upscale', 'fake-slowmo', 'fake-upscale']);
    assert.strictEqual(byId['fake-cut'].range, 'segments');
    assert.strictEqual(byId['fake-slowmo'].range, 'section');
    assert.strictEqual(byId['fake-upscale'].range, 'whole');
    assert.match(byId.broken.unavailable, /missing\.py is missing/);
    assert.throws(() => gen.getTool('broken'), /not ready/);
    assert.throws(() => gen.getTool('nope'), /no generator called nope/);
});

test('the command line holds only declared options, checked against the manifest', () => {
    const slow = gen.getTool('fake-slowmo'), up = gen.getTool('fake-upscale');
    const a = gen.buildArgs(slow, '/in.mov', { start: 10, end: 40, options: { factor: 2, scene: 9, compare: true, evil: '--rm' } }, '/o.mov', '/p.json');
    assert.deepStrictEqual(a.slice(1), ['/in.mov', '--start', '10', '--end', '40', '--factor', '2', '--scene', '0.6', '--compare', '--out', '/o.mov', '--progress', '/p.json']);
    // defaults when nothing is chosen; an unticked checkbox adds nothing
    const b = gen.buildArgs(slow, '/in.mov', {}, '/o', '/p');
    assert.deepStrictEqual(b.slice(2, 6), ['--factor', '4', '--scene', '0.3']);
    assert.ok(!b.includes('--compare'));
    // a whole-file tool never receives a section
    assert.ok(!gen.buildArgs(up, '/in.mov', { start: 1, end: 9 }, '/o', '/p').includes('--start'));
    assert.throws(() => gen.buildArgs(slow, '/in.mov', { options: { factor: 3 } }, '/o', '/p'), /not one of its choices/);
    assert.throws(() => gen.buildArgs(slow, '/in.mov', { start: 9, end: 9 }, '/o', '/p'), /end after it starts/);
});

test('a dropped file is probed; non-media and missing paths are refused', { skip: !haveFfmpeg && 'no ffmpeg' }, () => {
    fresh();
    const rec = gen.probeInput(CLIP);
    assert.strictEqual(rec.kind, 'video');
    assert.strictEqual(rec.fps, 24);
    assert.strictEqual(rec.frames, 48);
    assert.strictEqual(rec.width, 320);
    assert.deepStrictEqual(gen.getInput(rec.id).path, CLIP);
    const txt = path.join(TMP, 'notes.txt'); fs.writeFileSync(txt, 'hi');
    assert.throws(() => gen.probeInput(txt), /not a video, audio or image file/);
    assert.throws(() => gen.probeInput(path.join(TMP, 'gone.mov')), /there is no file/);
    assert.throws(() => gen.probeInput('relative.mov'), /full file path/);
});

test('jobs run one at a time, report progress and land their output', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    fresh(); delete process.env.FAKE_MODE;
    const input = gen.probeInput(CLIP);
    const j1 = gen.createJob({ tool: 'fake-slowmo', input_id: input.id, start: 12, end: 36, options: { factor: 2 } });
    const j2 = gen.createJob({ tool: 'fake-upscale', input_id: input.id });
    assert.strictEqual(gen.getJob(j1.id).status, 'running');
    assert.strictEqual(gen.getJob(j2.id).status, 'queued', 'a second job must wait for the GPU');
    assert.ok(!('_args' in j1) && !('progress_path' in j1), 'the page never sees the command line');
    await waitFor(() => gen.getJob(j2.id).status === 'done');
    const a = gen.getJob(j1.id), b = gen.getJob(j2.id);
    assert.strictEqual(a.status, 'done'); assert.strictEqual(a.done, 4); assert.strictEqual(a.total, 4);
    assert.deepStrictEqual(a.stats, { integrated_lufs: -14.02, true_peak_dbtp: -2.1 }, 'flat stats reach the job; nested ones do not');
    assert.strictEqual(a.note, 'a note from the engine');
    assert.strictEqual(a.outputs.length, 1);
    const ran = JSON.parse(fs.readFileSync(a.outputs[0], 'utf8'));
    assert.strictEqual(ran.input, CLIP);
    assert.deepStrictEqual(ran.args.slice(1, 7), ['--start', '12', '--end', '36', '--factor', '2']);
    assert.match(path.basename(a.outputs[0]), /clip - Fake SlowMo f12-36 \d{8}-\d{6}\.json$/);
    assert.ok(a.outputs[0].startsWith(path.join(TMP, 'out', 'Fake SlowMo')));
    assert.ok(new Date(b.started_at) >= new Date(a.finished_at), 'the queued job started only after the first finished');
    assert.strictEqual(gen.outputPath(j1.id, 0), a.outputs[0]);
    assert.throws(() => gen.outputPath(j1.id, 5), /not there/);
});

test('a failing engine reports its own message', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    fresh(); process.env.FAKE_MODE = 'fail';
    try {
        const input = gen.probeInput(CLIP);
        const j = gen.createJob({ tool: 'fake-upscale', input_id: input.id });
        await waitFor(() => gen.getJob(j.id).status !== 'running');
        assert.strictEqual(gen.getJob(j.id).status, 'failed');
        assert.match(gen.getJob(j.id).error, /told to fail/);
    } finally { delete process.env.FAKE_MODE; }
});

test('Cancel stops a running engine and starts the next', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    fresh(); process.env.FAKE_MODE = 'slow';
    try {
        const input = gen.probeInput(CLIP);
        const j = gen.createJob({ tool: 'fake-upscale', input_id: input.id });
        await waitFor(() => gen.getJob(j.id).done >= 1);
        delete process.env.FAKE_MODE;                     // the next job runs normally
        const next = gen.createJob({ tool: 'fake-upscale', input_id: input.id });
        assert.strictEqual(gen.getJob(next.id).status, 'queued');
        assert.strictEqual(gen.cancelJob(j.id).status, 'cancelled');
        await waitFor(() => gen.getJob(next.id).status === 'done');
        assert.strictEqual(gen.getJob(j.id).status, 'cancelled');
        assert.strictEqual(gen.getJob(j.id).outputs.length, 0);
    } finally { delete process.env.FAKE_MODE; }
});

test('results go to the chosen folder; a bad choice is refused with a reason', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    fresh(); delete process.env.FAKE_MODE;
    assert.deepStrictEqual(gen.getSettings(), { out_dir: null, default_out_dir: path.join(TMP, 'out') });
    const chosen = path.join(TMP, 'my renders', 'slowmo');                     // created when chosen
    assert.strictEqual(gen.setSettings({ out_dir: chosen }).out_dir, chosen);
    assert.ok(fs.statSync(chosen).isDirectory());
    const input = gen.probeInput(CLIP);
    const j = gen.createJob({ tool: 'fake-upscale', input_id: input.id });
    await waitFor(() => gen.getJob(j.id).status === 'done');
    assert.strictEqual(path.dirname(gen.getJob(j.id).outputs[0]), chosen, 'saved straight into the chosen folder');
    assert.throws(() => gen.setSettings({ out_dir: 'relative/dir' }), /full path/);
    fs.writeFileSync(path.join(TMP, 'afile'), 'x');
    assert.throws(() => gen.setSettings({ out_dir: path.join(TMP, 'afile') }), /not a folder|cannot create/);
    gen._reset();                                                             // a restart keeps the choice
    assert.strictEqual(gen.getSettings().out_dir, chosen);
    assert.strictEqual(gen.setSettings({ out_dir: null }).out_dir, null);     // and it can go back to the default
});

test('the routes answer and keep internals out', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    fresh();
    const call = async (method, url, body) => {
        const res = { status: 0, headers: {}, body: '', writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b || ''; } };
        await handleGenerators({ method, body, headers: {} }, res, url.split('/').filter(Boolean));
        return { status: res.status, data: res.body ? JSON.parse(res.body) : null };
    };
    const tools = await call('GET', '/film/generators/tools');
    assert.strictEqual(tools.status, 200);
    assert.ok(tools.data.tools.every(t => !('dir' in t)), 'engine folders stay on the server');
    const inp = await call('POST', '/film/generators/inputs', { path: CLIP });
    assert.strictEqual(inp.status, 200);
    const made = await call('POST', '/film/generators/jobs', { tool: 'fake-upscale', input_id: inp.data.input.id });
    assert.strictEqual(made.status, 202);
    assert.ok(!('_python' in made.data.job));
    await waitFor(() => gen.getJob(made.data.job.id).status === 'done');
    const list = await call('GET', '/film/generators/jobs');
    assert.strictEqual(list.data.jobs[0].id, made.data.job.id);
    assert.strictEqual((await call('POST', '/film/generators/jobs', { tool: 'broken', input_id: inp.data.input.id })).status, 409);
    assert.strictEqual((await call('POST', '/film/generators/inputs', { path: '/nope/x.mov' })).status, 404);
    assert.strictEqual((await call('GET', '/film/generators/elsewhere')).status, 404);
});

test('ProRes plays from an H.264 copy with every frame; a playable file is served as is', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    // The tab's player (Electron 33's Chromium) refuses ProRes, and every result here is ProRes.
    fresh();
    const prores = path.join(TMP, 'master.mov');
    execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=48', '-t', '1',
        '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', prores]);
    const rec = gen.probeInput(prores);
    assert.strictEqual(rec.codec, 'prores');
    assert.strictEqual(rec.preview, true, 'ProRes needs a preview');
    assert.strictEqual(gen.probeInput(CLIP).preview, false, 'H.264 plays as it is');
    assert.strictEqual(await gen.previewFile(CLIP), CLIP);

    const [a, b] = await Promise.all([gen.previewFile(prores), gen.previewFile(prores)]);
    assert.strictEqual(a, b, 'two requests share one conversion');
    assert.notStrictEqual(a, prores);
    const probe = f => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
        '-show_entries', 'stream=codec_name,nb_read_frames,r_frame_rate', '-of', 'csv=p=0', f]).toString().trim();
    const [codec, rate, n] = probe(a).split(',');
    assert.strictEqual(codec, 'h264');
    assert.strictEqual(rate, '48/1', 'the frame rate is kept, so frame numbers match the original');
    assert.strictEqual(n, probe(prores).split(',')[2], 'every frame is kept');
    assert.strictEqual(await gen.previewFile(prores), a, 'made once, then reused');

    const res = { status: 0, headers: {}, writeHead(s, h) { this.status = s; this.headers = h; }, end() {}, setHeader() {}, on() {}, once() {}, emit() {}, write() { return true; } };
    await handleGenerators({ method: 'GET', headers: {}, on() {} }, res, `/film/generators/inputs/${rec.id}/preview`.split('/').filter(Boolean));
    assert.notStrictEqual(res.status, 404);
});

test('a setting that applies only to some choices is left out of the command line when they are not made (every tool with "when")', () => {
    const depth = gen.getTool('fake-depth'), img = gen.getTool('fake-image-upscale');
    const has = (args, f) => args.includes(f);
    let a = gen.buildArgs(depth, '/in.mov', { options: { effect: 'dof', blur: 2, density: 1 } }, '/out', '/p');
    assert.ok(has(a, '--blur') && !has(a, '--density'), 'dof: blur, no fog density');
    a = gen.buildArgs(depth, '/in.mov', { options: { effect: 'fog', blur: 2, density: 1 } }, '/out', '/p');
    assert.ok(!has(a, '--blur') && has(a, '--density'), 'fog: density, no blur');
    a = gen.buildArgs(img, '/in.png', { options: { engine: 'gigapixel', size: '4k' } }, '/out', '/p');
    assert.ok(!has(a, '--size'), 'Gigapixel takes no size');
    a = gen.buildArgs(img, '/in.png', {}, '/out', '/p');
    assert.deepStrictEqual([a[a.indexOf('--engine') + 1], a[a.indexOf('--size') + 1]], ['ultrasharp', '4k'], 'defaults apply to the default choice');
});

test('images: a still is read for its size, runs only on an image tool, and a video tool refuses it (and the reverse)', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    fresh();
    const still = path.join(TMP, 'frame.png');
    execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=teal:s=320x180', '-frames:v', '1', still]);
    const img = gen.probeInput(still);
    assert.deepStrictEqual([img.kind, img.width, img.height, img.frames, img.preview], ['image', 320, 180, null, false]);
    const tiff = path.join(TMP, 'frame.tiff');
    execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=teal:s=320x180', '-frames:v', '1', tiff]);
    assert.strictEqual(gen.probeInput(tiff).preview, true, 'a TIFF is shown through a PNG copy');
    assert.match(await gen.previewFile(tiff), /\.png$/);
    const job = gen.createJob({ tool: 'fake-image-upscale', input_id: img.id, options: { engine: 'ultrasharp', size: '4k' } });
    await waitFor(() => gen.getJob(job.id).status === 'done');
    const done = gen.getJob(job.id);
    assert.match(done.outputs[0], /frame - Fake Image Upscale .*\.png$/);
    const args = JSON.parse(fs.readFileSync(done.outputs[0], 'utf8')).args;
    assert.deepStrictEqual([args[args.indexOf('--engine') + 1], args[args.indexOf('--size') + 1]], ['ultrasharp', '4k']);
    const vid = gen.probeInput(CLIP);
    assert.throws(() => gen.createJob({ tool: 'fake-upscale', input_id: img.id }), /needs a video/);
    assert.throws(() => gen.createJob({ tool: 'fake-image-upscale', input_id: vid.id }), /needs an image/);
});

// The real engine (~/Documents/Resolve Plugins/AI Image Upscale), when it is installed: a small image to 4K and to 2x.
const REAL = path.join(os.homedir(), 'Documents', 'Resolve Plugins', 'AI Image Upscale', 'image_upscale.py');
test('the real AI Image Upscale engine: 4x-UltraSharp to 4K and to 2x, at the size asked', { skip: (!haveFfmpeg || !fs.existsSync(REAL)) && 'engine not installed' }, () => {
    const src = path.join(TMP, 'real.png');
    execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=480x270', '-frames:v', '1', src]);
    for (const [size, want] of [['4k', '3840x2160'], ['2', '960x540']]) {
        const out = path.join(TMP, `real-${size}.png`), prog = path.join(TMP, `real-${size}.json`);
        execFileSync('python3', [REAL, src, '--out', out, '--size', size, '--progress', prog], { timeout: 300000 });
        const p = JSON.parse(fs.readFileSync(prog, 'utf8'));
        assert.strictEqual(p.stage, 'done');
        assert.strictEqual(p.stats.result, want);
        assert.strictEqual(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', out]).toString().trim(), want);
    }
    // Film grain: the same size, more fine texture than the clean result, and more at a higher setting.
    const texture = f => Number(execFileSync('/usr/local/bin/python3.10', ['-c', `import numpy as n;from PIL import Image;a=n.asarray(Image.open(${JSON.stringify(f)}).convert('L'),dtype=float);print(n.std(a[1:-1,1:-1]*4-a[:-2,1:-1]-a[2:,1:-1]-a[1:-1,:-2]-a[1:-1,2:]))`]).toString());
    const levels = {};
    for (const g of ['0', '0.3', '0.8']) {
        const out = path.join(TMP, `grain-${g}.png`), prog = path.join(TMP, `grain-${g}.json`);
        execFileSync('python3', [REAL, src, '--out', out, '--size', '2', '--grain', g, '--progress', prog], { timeout: 300000 });
        assert.strictEqual(JSON.parse(fs.readFileSync(prog, 'utf8')).stats.grain, `${Math.round(Number(g) * 100)}%`);
        levels[g] = texture(out);
    }
    assert.ok(levels['0.3'] > levels['0'] * 1.05 && levels['0.8'] > levels['0.3'] * 1.1, `grain did not rise with the setting: ${JSON.stringify(levels)}`);
});

// ── Segments: several pieces in one job (Lossless Cut) ───────────────────

test('a "segments" manifest must say how its pieces are passed; "section" and "whole" tools are unaffected', () => {
    const dir = path.join(TMP, 'engines-seg');
    const tool = (name, m) => {
        fs.mkdirSync(path.join(dir, name), { recursive: true });
        fs.writeFileSync(path.join(dir, name, 'run.py'), '');
        fs.writeFileSync(path.join(dir, name, 'generator.json'), JSON.stringify({ script: 'run.py', accepts: 'video', out: { flag: '--out', kind: 'dir' }, ...m }));
    };
    tool('No Flag', { id: 'no-flag', range: 'segments' });
    tool('Bad Flag', { id: 'bad-flag', range: 'segments', segments: { flag: 'segments' } });
    tool('Good', { id: 'good', range: 'segments', segments: { flag: '--segments' } });
    tool('Odd Range', { id: 'odd', range: 'pieces' });
    const was = process.env.FILM_GENERATORS_DIR;
    process.env.FILM_GENERATORS_DIR = dir;
    try {
        const byId = Object.fromEntries(gen.listTools().map(t => [t.id, t]));
        assert.match(byId['no-flag'].unavailable, /needs "segments"/);
        assert.match(byId['bad-flag'].unavailable, /needs "segments"/);
        assert.strictEqual(byId.good.unavailable, undefined);
        assert.match(byId.odd.unavailable, /"section", "whole" or "segments"/);
    } finally { process.env.FILM_GENERATORS_DIR = was; }
});

test('pieces reach the engine as one checked --segments argument, and only for a segments tool', () => {
    const cut = gen.getTool('fake-cut'), up = gen.getTool('fake-upscale'), slow = gen.getTool('fake-slowmo');
    const a = gen.buildArgs(cut, '/in.mov', { segments: [[0, 3.3], [3.3, 6.7], { start: 6.7, end: 10 }], options: { mode: 'smart' }, duration: 10 }, '/out', '/p');
    assert.deepStrictEqual(a.slice(1), ['/in.mov', '--segments', '0.000000-3.300000,3.300000-6.700000,6.700000-10.000000',
        '--mode', 'smart', '--all-tracks', '--out', '/out', '--progress', '/p']);
    assert.ok(!a.includes('--start'), 'a segments tool takes no single section');
    // an end past the file is allowed (it means "to the end"); the engine clamps it
    assert.match(gen.buildArgs(cut, '/in.mov', { segments: [[8, 99]], duration: 10 }, '/o', '/p').join(' '), /--segments 8\.000000-99\.000000/);
    const refused = [
        [undefined, /at least one piece/], [[], /at least one piece/],
        [[[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]], /at most 5 pieces/],
        [[[3, 3]], /piece 1 must end after it starts/], [[[0, 1], [5, 2]], /piece 2 must end after it starts/],
        [[[-1, 2]], /must end after it starts/], [[['a', 2]], /start and an end in seconds/], [[[1]], /start and an end/],
        [[[10.5, 12]], /starts after the end of the file/],
    ];
    for (const [segments, why] of refused) {
        assert.throws(() => gen.buildArgs(cut, '/in.mov', { segments, duration: 10 }, '/o', '/p'), why, JSON.stringify(segments));
    }
    // other tools never see --segments, whatever the page sends
    for (const t of [up, slow]) assert.ok(!gen.buildArgs(t, '/in.mov', { segments: [[0, 1]] }, '/o', '/p').includes('--segments'));
});

test('a segments job returns every piece, in order, with what the engine said about each (and nothing else)', { skip: !haveFfmpeg && 'no ffmpeg' }, async () => {
    fresh(); delete process.env.FAKE_MODE;
    const wav = path.join(TMP, 'tone.wav');
    execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', wav]);
    for (const file of [CLIP, wav]) {   // a video, and a bare audio file (the tool says audio_ok)
        const input = gen.probeInput(file);
        const want = [[0, 0.5], [0.5, 1.25], [1.5, 1.9]];
        const j = gen.createJob({ tool: 'fake-cut', input_id: input.id, segments: want, options: { mode: 'keyframe' } });
        assert.deepStrictEqual(j.segments, want);
        await waitFor(() => gen.getJob(j.id).status !== 'running' && gen.getJob(j.id).status !== 'queued');
        const done = gen.getJob(j.id);
        assert.strictEqual(done.status, 'done', done.error);
        assert.strictEqual(done.out_kind, 'dir');
        assert.deepStrictEqual(done.outputs.map(p => path.basename(p)), ['piece 01.json', 'piece 02.json', 'piece 03.json']);
        assert.ok(done.outputs.every(p => path.dirname(p) === done.out_path), 'every piece lands in the job\'s own folder');
        assert.deepStrictEqual(done.outputs.map(p => JSON.parse(fs.readFileSync(p, 'utf8')).segment), want);
        assert.strictEqual(done.pieces.length, 3);
        done.pieces.forEach((pc, i) => {
            assert.deepStrictEqual(Object.keys(pc).sort(), ['asked_end', 'asked_start', 'end', 'file', 'mode', 'n', 'note', 'reencoded', 'start']);
            assert.strictEqual(pc.file, done.outputs[i]);
            assert.deepStrictEqual([pc.asked_start, pc.asked_end], want[i]);
            assert.strictEqual(pc.start, Math.max(0, want[i][0] - 0.5));
            assert.deepStrictEqual(pc.reencoded, [[want[i][0], want[i][0] + 0.25]], 'a malformed range is dropped');
            assert.strictEqual(pc.note.length, 300);
        });
        assert.deepStrictEqual(gen.publicJob(done).pieces, done.pieces, 'the page sees each piece\'s real start and end');
    }
    const input = gen.probeInput(CLIP);
    assert.throws(() => gen.createJob({ tool: 'fake-cut', input_id: input.id, segments: [[5, 6]] }), /starts after the end of the file/);
    assert.throws(() => gen.createJob({ tool: 'fake-cut', input_id: input.id }), /at least one piece/);
});

// The real engine (~/Documents/Resolve Plugins/Lossless Cut), when it is installed: a clip split into pieces through
// a real job, each piece checked with ffprobe. (Its own matrix test lives beside it: tests/test_losslesscut.py.)
const REAL_CUT = path.join(os.homedir(), 'Documents', 'Resolve Plugins', 'Lossless Cut');
test('the real Lossless Cut engine through a job: every piece is the same codec, size and tracks, with nothing re-encoded',
    { skip: (!haveFfmpeg || !fs.existsSync(path.join(REAL_CUT, 'generator.json'))) && 'engine not installed' }, async () => {
        fresh();
        const src = path.join(TMP, 'cut-me.mov');
        execFileSync(ff.bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
            '-t', '6', '-c:v', 'libx264', '-g', '24', '-keyint_min', '24', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
        const was = process.env.FILM_GENERATORS_DIR;
        process.env.FILM_GENERATORS_DIR = path.dirname(REAL_CUT);
        try {
            const input = gen.probeInput(src);
            const j = gen.createJob({ tool: 'losslesscut', input_id: input.id, segments: [[0, 2.5], [2.5, 6]], options: { mode: 'keyframe', all_tracks: true } });
            await waitFor(() => !['running', 'queued'].includes(gen.getJob(j.id).status), 60000);
            const done = gen.getJob(j.id);
            assert.strictEqual(done.status, 'done', done.error);
            assert.strictEqual(done.outputs.length, 2);
            const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-of', 'json', '-show_streams', f]).toString()).streams
                .map(s => [s.codec_type, s.codec_name, s.width || null, s.height || null, s.pix_fmt || s.sample_rate].join(' '));
            for (const out of done.outputs) {
                assert.match(path.basename(out), /^cut-me - part 0[12] \(.+\)\.mov$/);
                assert.deepStrictEqual(probe(out), probe(src));
            }
            // a keyframe cut: the split at 2.5 s moves back to the keyframe at 2.0 s, for both pieces, and says so
            assert.deepStrictEqual(done.pieces.map(p => [p.start, p.end]), [[0, 2], [2, 6]]);
            assert.ok(done.pieces.every(p => p.mode === 'copy' && p.reencoded.length === 0));
            assert.match(done.pieces[1].note, /keyframe 0:02\.000 \(asked 0:02\.500\)/);
        } finally { process.env.FILM_GENERATORS_DIR = was; }
    });

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
