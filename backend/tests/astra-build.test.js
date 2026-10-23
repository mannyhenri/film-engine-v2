/**
 * Astra builds (lib/astra-build.js, lib/codex-astra.js, astra_check.py, blender-astra.py, routes/astra-builds.js):
 * a location or prop modelled in background Blender, guided by Astra through Codex.
 *
 * Codex is a FAKE here (a script standing in for the CLI: it logs what it was sent and answers with a canned
 * Blender script); Blender is the REAL one when installed, sandboxed exactly as in use. Checks:
 *   - the model is the newest Astra 6 or later in the Codex model list, and none is a clear error
 *   - the static gate refuses every banned construct and passes a plain modelling script
 *   - a prop build runs its rounds: Astra sees the references first, then references + review renders + its
 *     last script; the result is a GLB asset with prop_id, kind model_3d and source astra-blender
 *   - a failing or refused round is retried once, with the error in the prompt
 *   - a location build also becomes the next version of the location's world (a Previz set)
 *   - a second pass starts from the finished build's script and carries the details
 *   - Cancel stops a running build; the routes answer
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-astra-'));
process.env.FILM_DATA_DIR = path.join(TMP, 'data');
process.env.FILM_ASTRA_STATE = path.join(TMP, 'state');
process.env.FILM_ASTRA_MODELS_CACHE = path.join(TMP, 'models_cache.json');
process.env.FAKE_CODEX_LOG = path.join(TMP, 'codex.log');
process.env.FAKE_CODEX_COUNTER = path.join(TMP, 'codex.count');
process.env.CODEX_PATH = path.join(TMP, 'codex');

const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const astra = require('../lib/codex-astra');
const astraBuild = require('../lib/astra-build');
const { handleAstraBuilds } = require('../routes/astra-builds');
const blender = require('../lib/set-build').resolveBlender();
const haveBlender = blender.available;
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ── the fake Codex: logs each turn, answers by FAKE_CODEX_MODE ─────────────
const GOOD = `import bpy, math
# MARKER-ROUND
bpy.ops.mesh.primitive_cylinder_add(radius=0.02, depth=0.07, location=(0, 0, 0.035))
m = bpy.data.materials.new('Glass'); m.use_nodes = True
bpy.context.object.data.materials.append(m)
bpy.ops.mesh.primitive_cylinder_add(radius=0.021, depth=0.018, location=(0, 0, 0.079))
`;
const ROOM = `import bpy
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.05)); f = bpy.context.object; f.scale = (8, 5, 0.1); f.name = 'Floor'
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 2.5, 1.5)); w = bpy.context.object; w.scale = (8, 0.2, 3); w.name = 'Back wall'
bpy.ops.mesh.primitive_cube_add(size=1, location=(-2, 0, 0.5)); c = bpy.context.object; c.scale = (0.6, 4, 1); c.name = 'Counter'
light = bpy.data.objects.new('Window light', bpy.data.lights.new('Window light', 'AREA')); light.location = (0, -2, 2.5)
bpy.context.scene.collection.objects.link(light)
`;
fs.writeFileSync(process.env.CODEX_PATH, `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
const out = args[args.indexOf('-o') + 1];
const model = args[args.indexOf('-m') + 1];
const images = args.filter((a, i) => args[i - 1] === '-i');
let prompt = ''; process.stdin.on('data', d => prompt += d);
process.stdin.on('end', async () => {
  const n = Number(fs.existsSync(process.env.FAKE_CODEX_COUNTER) ? fs.readFileSync(process.env.FAKE_CODEX_COUNTER, 'utf8') : 0) + 1;
  fs.writeFileSync(process.env.FAKE_CODEX_COUNTER, String(n));
  fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ model, images: images.length, imagesExist: images.every(p => fs.existsSync(p)), prompt, argv: args }) + '\\n');
  const mode = process.env.FAKE_CODEX_MODE || 'good';
  if (mode === 'slow') await new Promise(r => setTimeout(r, 60000));
  let script = /THE LOCATION/.test(prompt) ? ${JSON.stringify(ROOM)} : ${JSON.stringify(GOOD)}.replace('MARKER-ROUND', 'MARKER-ROUND-' + n);
  if (mode === 'fail_once' && n === 1) script = 'import bpy\\nraise ValueError("boom on purpose")\\n';
  if (mode === 'refuse_once' && n === 1) script = 'import bpy\\nimport os\\nos.listdir("/")\\n';
  fs.writeFileSync(out, 'Building it.\\n\\n\\u0060\\u0060\\u0060python\\n' + script + '\\u0060\\u0060\\u0060\\n');
});
`, { mode: 0o755 });
fs.writeFileSync(process.env.FILM_ASTRA_MODELS_CACHE, JSON.stringify({ models: [{ slug: 'gpt-6.1-sol' }, { slug: 'gpt-6-astra' }, { slug: 'gpt-5.6-luna' }] }));

const turns = () => fs.existsSync(process.env.FAKE_CODEX_LOG) ? fs.readFileSync(process.env.FAKE_CODEX_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
function fresh(mode) {
    process.env.FAKE_CODEX_MODE = mode || 'good';
    for (const f of [process.env.FAKE_CODEX_LOG, process.env.FAKE_CODEX_COUNTER]) { try { fs.unlinkSync(f); } catch (_) { /* none */ } }
}

// ── a project with a prop and a location, each with a reference picture ───
const projectId = generateId();
const assetsDir = path.join(TMP, 'project');
fs.mkdirSync(assetsDir, { recursive: true });
db.prepare('INSERT INTO film_projects (id, title, assets_dir) VALUES (?, ?, ?)').run(projectId, 'Astra test', assetsDir);
const propId = generateId();
db.prepare('INSERT INTO film_props (id, project_id, name, description, height_m) VALUES (?, ?, ?, ?, ?)').run(propId, projectId, 'SALT SHAKER', 'A glass diner salt shaker with a steel cap.', 0.09);
const locId = generateId();
db.prepare('INSERT INTO film_locations (id, project_id, name, description) VALUES (?, ?, ?, ?)').run(locId, projectId, 'THE DINER', 'A long room, counter down the west side.');
function picture(name) {
    const p = path.join(TMP, name);
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', p]);
    return p;
}
for (const [col, id, name] of [['prop_id', propId, 'prop.png'], ['location_id', locId, 'loc.png']]) {
    const p = picture(name);
    db.prepare(`INSERT INTO film_assets (id, project_id, ${col}, asset_type, file_path, file_name, format, metadata) VALUES (?, ?, ?, 'reference_image', ?, ?, 'png', '{}')`)
        .run(generateId(), projectId, id, p, name);
}
// A picture of another prop whose FILE NAME starts with this one's: the old LIKE lookup would take it.
db.prepare(`INSERT INTO film_assets (id, project_id, prop_id, asset_type, file_path, file_name, format, metadata) VALUES (?, ?, ?, 'reference_image', ?, ?, 'png', '{}')`)
    .run(generateId(), projectId, null, picture('SALT SHAKER other.png'), 'SALT SHAKER other.png');

function call(method, url, body) {
    return new Promise(resolve => {
        const [p, qs] = url.split('?');
        const chunks = [];
        const res = { statusCode: 200, headers: {}, writeHead(s, h) { this.statusCode = s; Object.assign(this.headers, h || {}); }, setHeader() {},
            write(c) { chunks.push(Buffer.from(c)); return true; }, on() {}, once() {}, emit() {},
            end(c) { if (c) chunks.push(Buffer.from(c)); const raw = Buffer.concat(chunks); let data; try { data = JSON.parse(raw.toString()); } catch { data = raw; } resolve({ status: this.statusCode, headers: this.headers, data }); } };
        Promise.resolve(handleAstraBuilds({ method, body: body || {}, headers: {}, on() {} }, res, p.split('/').filter(Boolean), Object.fromEntries(new URLSearchParams(qs || ''))))
            .catch(err => resolve({ status: 500, data: { error: err.message } }));
    });
}
const waitDone = async id => { await astraBuild.idle(); return astraBuild.getBuild(id); };

test('Astra is the newest gpt-N-astra with N >= 6; none is a clear error', () => {
    assert.equal(astra.pickAstra(['gpt-6-astra', 'gpt-6.1-astra', 'gpt-5.9-astra', 'gpt-7-sol']), 'gpt-6.1-astra');
    assert.equal(astra.pickAstra(['gpt-6-astra', 'gpt-7-astra', 'gpt-6.4-astra']), 'gpt-7-astra');
    assert.equal(astra.pickAstra(['gpt-5.6-astra', 'gpt-6-sol']), null);
    assert.equal(astra.astraModel(), 'gpt-6-astra');
    const none = path.join(TMP, 'none.json');
    fs.writeFileSync(none, JSON.stringify({ models: [{ slug: 'gpt-5.6-astra' }, { slug: 'gpt-6-sol' }] }));
    assert.throws(() => astra.astraModel(none), /No Astra 6 or newer model in Codex/);
    const args = astra.execArgs('gpt-6-astra', ['/a.png'], '/o.txt');
    for (const flag of ['--sandbox', 'read-only', '--ephemeral', '--ignore-user-config', '-i', '/a.png', '-o', '/o.txt']) assert.ok(args.includes(flag), flag);
    assert.ok(args.includes('shell_tool') && args[args.indexOf('shell_tool') - 1] === '--disable', 'no shell for Astra');
});

test('the static gate refuses every banned construct and passes a plain modelling script', () => {
    const banned = {
        'import os': 'import bpy\nimport os\n', 'from subprocess': 'from subprocess import run\n', 'import socket': 'import socket\n',
        '__import__': "__import__('os')\n", exec: "exec('1')\n", eval: "eval('1')\n", 'open(': "open('/etc/passwd')\n", compile: "compile('1','x','exec')\n",
        'os.': 'os.listdir(".")\n', 'sys.': 'sys.exit()\n', getattr: "getattr(bpy, 'app')\n",
        'save_mainfile': 'import bpy\nbpy.ops.wm.save_mainfile()\n', 'export': "import bpy\nbpy.ops.export_scene.gltf(filepath='/x.glb')\n",
        'import op': "import bpy\nbpy.ops.import_scene.gltf(filepath='/x.glb')\n", 'dunder': 'x = ().__class__.__bases__\n',
        'image save': 'import bpy\nbpy.data.images[0].save()\n', 'libraries': "import bpy\nbpy.data.libraries.load('/x.blend')\n",
        'bpy.app': 'import bpy\nbpy.app.handlers\n', 'text as module': "import bpy\nbpy.data.texts['x'].as_module()\n",
    };
    for (const [what, src] of Object.entries(banned)) assert.ok(astraBuild.checkScript(src).length > 0, `${what} must be refused`);
    assert.deepEqual(astraBuild.checkScript(GOOD), []);
    assert.deepEqual(astraBuild.checkScript(ROOM), []);
});

test('the sandbox profile denies the network and every write outside the job folder', () => {
    const p = astraBuild.sandboxProfile([TMP]);
    assert.match(p, /\(deny network\*\)/);
    assert.match(p, /\(deny file-write\*\)/);
    assert.match(p, new RegExp(`allow file-write\\* \\(subpath "${fs.realpathSync(TMP).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\)`));
    assert.match(p, /\.ssh/); assert.match(p, /\.codex/);
});

test('a prop build runs its rounds and lands a GLB asset of the prop', { skip: !haveBlender && 'no Blender' }, async () => {
    fresh('good');
    const b = astraBuild.createBuild(projectId, { subject_kind: 'prop', subject_id: propId, rounds: 2 });
    assert.equal(b.status, 'queued');
    const done = await waitDone(b.id);
    assert.equal(done.status, 'done', done.error);
    assert.equal(done.model, 'gpt-6-astra');
    assert.equal(done.history.length, 2);
    assert.ok(done.history.every(r => r.ok));
    assert.deepEqual(done.renders.map(r => r.view), ['front', 'three_quarter_left', 'three_quarter_right', 'top']);
    assert.equal(done.final_round, 2);

    const t = turns();
    assert.equal(t.length, 2);
    assert.equal(t[0].images, 1, 'round 1 sees the one reference picture of THIS prop (not the look-alike file name)');
    assert.equal(t[1].images, 1 + 4, 'round 2 sees the reference and its four review renders');
    assert.ok(t.every(x => x.imagesExist));
    assert.match(t[0].prompt, /SALT SHAKER/);
    assert.match(t[0].prompt, /Real size: height 0.09 m/);
    assert.match(t[1].prompt, /PREVIOUS SCRIPT[\s\S]*MARKER-ROUND-1/);
    assert.ok(t.every(x => x.model === 'gpt-6-astra'));

    const a = db.prepare('SELECT * FROM film_assets WHERE id = ?').get(done.asset_id);
    assert.equal(a.prop_id, propId);
    const meta = JSON.parse(a.metadata);
    assert.equal(meta.kind, 'model_3d');
    assert.equal(meta.subject_kind, 'prop');
    assert.equal(meta.subject_id, propId);
    assert.equal(meta.source, 'astra-blender');
    assert.equal(meta.build_id, b.id);
    assert.equal(meta.round, 2);
    assert.equal(fs.readFileSync(a.file_path).toString('ascii', 0, 4), 'glTF');
    assert.match(fs.readFileSync(a.file_path).toString('latin1'), /"name":"Glass"/, 'the material survives the export');
    assert.equal(done.world_version_id, null, 'a prop is not a set');
});

test('a failing round is retried once, with the error in the prompt; a refused one too', { skip: !haveBlender && 'no Blender' }, async () => {
    fresh('fail_once');
    let done = await waitDone(astraBuild.createBuild(projectId, { subject_kind: 'prop', subject_id: propId, rounds: 1 }).id);
    assert.equal(done.status, 'done', done.error);
    assert.equal(done.history[0].tries, 2);
    assert.match(turns()[1].prompt, /THE LAST RUN FAILED[\s\S]*boom on purpose/);

    fresh('refuse_once');
    done = await waitDone(astraBuild.createBuild(projectId, { subject_kind: 'prop', subject_id: propId, rounds: 1 }).id);
    assert.equal(done.status, 'done', done.error);
    assert.equal(done.history[0].tries, 2);
    assert.match(turns()[1].prompt, /refused before running[\s\S]*import os is not allowed/);
});

test('a location build becomes the next version of its world: a Previz set', { skip: !haveBlender && 'no Blender' }, async () => {
    fresh('good');
    const done = await waitDone(astraBuild.createBuild(projectId, { subject_kind: 'location', subject_id: locId, rounds: 1 }).id);
    assert.equal(done.status, 'done', done.error);
    assert.ok(done.renders.some(r => r.view === 'interior_eye_level'), 'a location is also seen from inside');
    const world = db.prepare('SELECT * FROM film_worlds WHERE location_id = ?').get(locId);
    assert.ok(world, 'the location got a world');
    assert.equal(done.world_id, world.id);
    const v = db.prepare('SELECT * FROM film_world_versions WHERE id = ?').get(done.world_version_id);
    assert.equal(v.world_id, world.id);
    assert.equal(db.prepare('SELECT location_id FROM film_assets WHERE id = ?').get(done.asset_id).location_id, locId);
});

test('a second pass starts from the finished script and carries the details', { skip: !haveBlender && 'no Blender' }, async () => {
    fresh('good');
    const first = await waitDone(astraBuild.createBuild(projectId, { subject_kind: 'prop', subject_id: propId, rounds: 1 }).id);
    assert.throws(() => astraBuild.createBuild(projectId, { subject_kind: 'prop', subject_id: propId, from_build_id: first.id }), /needs details/);
    fresh('good');
    const second = await waitDone(astraBuild.createBuild(projectId, { subject_kind: 'prop', subject_id: propId, rounds: 1, from_build_id: first.id, details: 'add a chrome band and finger smudges' }).id);
    assert.equal(second.status, 'done', second.error);
    const t = turns();
    assert.match(t[0].prompt, /SECOND PASS/);
    assert.match(t[0].prompt, /add a chrome band and finger smudges/);
    assert.match(t[0].prompt, /PREVIOUS SCRIPT[\s\S]*MARKER-ROUND/);
    assert.equal(t[0].images, 1 + 4, 'it sees the finished model\'s renders');
    const meta = JSON.parse(db.prepare('SELECT metadata FROM film_assets WHERE id = ?').get(second.asset_id).metadata);
    assert.equal(meta.details, 'add a chrome band and finger smudges');
    assert.equal(meta.from_build_id, first.id);
});

test('Cancel stops a running build', { skip: !haveBlender && 'no Blender' }, async () => {
    fresh('slow');
    const b = astraBuild.createBuild(projectId, { subject_kind: 'prop', subject_id: propId, rounds: 2 });
    const t0 = Date.now();
    while (astraBuild.getBuild(b.id).status !== 'running' || !turns().length) { if (Date.now() - t0 > 15000) throw new Error('never started'); await new Promise(r => setTimeout(r, 50)); }
    astraBuild.cancelBuild(b.id);
    const done = await waitDone(b.id);
    assert.equal(done.status, 'cancelled');
    assert.ok(Date.now() - t0 < 20000, 'it stopped well before the fake Codex would have answered');
});

test('the routes answer; the server reaches them', { skip: !haveBlender && 'no Blender' }, async () => {
    fresh('good');
    const st = await call('GET', '/film/astra-builds/status');
    assert.equal(st.status, 200);
    assert.equal(st.data.model, 'gpt-6-astra');
    assert.equal(st.data.blender.found, true);
    assert.equal(st.data.sandbox.ok, true);
    assert.equal((await call('POST', `/film/projects/${projectId}/astra-builds`, { subject_kind: 'character', subject_id: propId })).status, 400);
    const made = await call('POST', `/film/projects/${projectId}/astra-builds`, { subject_kind: 'prop', subject_id: propId, rounds: 1 });
    assert.equal(made.status, 202);
    await astraBuild.idle();
    const one = await call('GET', `/film/astra-builds/${made.data.build.id}`);
    assert.equal(one.data.build.status, 'done');
    const list = await call('GET', `/film/projects/${projectId}/astra-builds?subject_kind=prop&subject_id=${propId}`);
    assert.ok(list.data.builds.some(x => x.id === made.data.build.id));
    assert.ok(list.data.builds.every(x => !('out_dir' in x) && !('rounds_log' in x)), 'no file paths reach the page');
    const png = await call('GET', one.data.build.renders[0].url);
    assert.notEqual(png.status, 404);
    assert.equal((await call('GET', `/film/astra-builds/${made.data.build.id}/render/9/0`)).status, 404);
    assert.equal((await call('GET', '/film/astra-builds/nope')).status, 404);
    assert.match(SERVER, /parts\[1\] === 'astra-builds' \|\| \(parts\[1\] === 'projects' && parts\[2\] && parts\[3\] === 'astra-builds'\)/);
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temp */ } });
