/**
 * The character sheet's MAIN picture (lib/character-sheet-main.js): the one picture every generation sends.
 *
 * Set-based over EVERY selector that picks a character's picture for generation or display:
 *   storyboard / video / Production starter (gatherShotReferences), Meshy image-to-3D (fromImageReference), the Seedance
 *   hand-off (gather), the expression identity (store().identity), and the character card's thumbnail (listCharacters).
 * With three views and no main, each keeps today's rule (front first). With a main, each picks the main, and only it.
 * Then the sheet itself: upload (the first finished sheet is the main, a later one a variation), make main, the two
 * ChatGPT prompts (the guides, the description, the studio picture attached), and refusals.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-cs-main-'));
process.env.FILM_DATA_DIR = path.join(TMP, 'data');
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();
const S = require('../lib/character-sheet-main');
const { gatherShotReferences } = require('../lib/shot-references');
const { fromImageReference, handleThreeD } = require('../routes/threed');
const { handleCharacters } = require('../routes/characters');

const assetsDir = path.join(TMP, 'film');
fs.mkdirSync(assetsDir, { recursive: true });
const pid = generateId(), june = generateId();
db.prepare('INSERT INTO film_projects (id, title, assets_dir) VALUES (?, ?, ?)').run(pid, 'Sheet test', assetsDir);
db.prepare('INSERT INTO film_characters (id, project_id, name, description, appearance_prompt, age_range) VALUES (?, ?, ?, ?, ?, ?)')
    .run(june, pid, 'JUNE', 'A watchful young woman in a charcoal coat.', 'Auburn hair pinned back, freckles, grey eyes.', '25-30');
// Real PNGs (ffmpeg makes them), each a different colour so their bytes differ.
const { resolveFfmpeg } = require('../lib/ffmpeg');
const COLORS = ['red', 'green', 'blue', 'yellow', 'purple', 'orange'];
let n = 0;
const png = () => {
    const f = path.join(TMP, `upload-${n}.png`);
    require('child_process').execFileSync(resolveFfmpeg().bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${COLORS[n++ % COLORS.length]}:s=64x32`, '-frames:v', '1', f]);
    return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
};
const PNG = png();
function plate(view, extra = {}) {
    const id = generateId(), file = path.join(TMP, `JUNE_${view}_${id.slice(0, 4)}.png`);
    fs.writeFileSync(file, path.basename(file));   // its own bytes, so a selector that returns bytes can be told apart
    db.prepare("INSERT INTO film_assets (id, project_id, character_id, asset_type, file_path, file_name, format, version, metadata) VALUES (?, ?, ?, 'character_sheet', ?, ?, 'png', 1, ?)")
        .run(id, pid, june, file, path.basename(file), JSON.stringify({ view, plate_role: 'reference', ...extra }));
    return { id, file };
}
const back = plate('back'), side = plate('side'), front = plate('front');

function call(handler, method, parts, body) {
    return new Promise(resolve => {
        const res = { status: 0, writeHead(c) { this.status = c; }, end(b) { resolve({ status: this.status, body: JSON.parse(b) }); } };
        Promise.resolve(handler({ method, body: body || {}, headers: {} }, res, parts, {})).catch(e => resolve({ status: 500, body: { error: e.message } }));
    });
}
// Every selector, as a function returning the file it would send (or show) for JUNE.
const SELECTORS = {
    // It sends the picture's bytes (a data URI): read back to the file they came from.
    'storyboard / video / Production (gatherShotReferences)': () => { const r = gatherShotReferences(pid, [{ id: june, name: 'JUNE' }], null, [], null, {}).find(x => x.kind === 'character');
        return r && r.uri ? fileWithBytes(Buffer.from(r.uri.split(',')[1], 'base64')) : null; },
    'Meshy image-to-3D (fromImageReference)': () => (fromImageReference('character', june, pid) || {}).file_path,
    'expression identity (store().identity)': () => require('../lib/character-expressions').store().identity(june).file_path,
    'character card thumbnail (listCharacters)': async () => { const r = await call(handleCharacters, 'GET', ['film', 'projects', pid, 'characters']); return String((r.body.characters || r.body)[0].reference_image_url || '').split('?')[0]; },   // its URL, without the version suffix
};
function fileWithBytes(bytes) {
    for (const row of db.prepare('SELECT file_path FROM film_assets WHERE character_id = ?').all(june)) {
        try { if (fs.readFileSync(row.file_path).equals(bytes)) return row.file_path; } catch (_) { /* gone */ }
    }
    return null;
}
const ends = (got, file) => String(got || '').endsWith(path.basename(file));

test('with no main, every selector keeps today\'s rule: the front view', async () => {
    for (const [name, pick] of Object.entries(SELECTORS)) assert.ok(ends(await pick(), front.file), `${name} did not pick the front view`);
});

let mainId, mainFile;
test('the first finished sheet uploaded is the main; every selector then sends it, and the Seedance hand-off sends only it', async () => {
    const up = await call(handleCharacters, 'POST', ['film', 'characters', june, 'sheet', 'upload'], { data: PNG, name: 'june sheet.png' });
    assert.strictEqual(up.status, 201, JSON.stringify(up.body));
    assert.ok(up.body.main, 'it is the main');
    mainId = up.body.main.asset_id;
    mainFile = db.prepare('SELECT file_path FROM film_assets WHERE id = ?').get(mainId).file_path;
    assert.ok(fs.existsSync(mainFile));
    for (const [name, pick] of Object.entries(SELECTORS)) assert.ok(ends(await pick(), mainFile), `${name} did not pick the main`);
    const folder = path.join(TMP, 'seedance'); fs.mkdirSync(folder, { recursive: true });
    const mats = await require('../lib/seedance-prompt').gather(pid, { character_ids: [june], shots: [] }, folder).catch(e => { if (/ffmpeg/.test(e.message)) return null; throw e; });
    if (mats) {
        assert.strictEqual(mats.length, 1);
        assert.match(mats[0].about, /three-panel character sheet of ONE person/);
    }
    // The views are untouched: nothing was demoted.
    for (const p of [front, side, back]) assert.strictEqual(JSON.parse(db.prepare('SELECT metadata FROM film_assets WHERE id = ?').get(p.id).metadata).plate_role, 'reference');
});

test('a later sheet is a variation; making it (or an old view) main moves every selector to it', async () => {
    const up = await call(handleCharacters, 'POST', ['film', 'characters', june, 'sheet', 'upload'], { data: png(), name: 'june winter coat.png' });
    assert.strictEqual(up.body.main.asset_id, mainId, 'the main stays');
    const variation = up.body.variations.find(v => v.kind === 'sheet');
    assert.ok(variation, 'the new sheet is a variation');
    assert.deepStrictEqual(up.body.variations.slice(0, 1).map(v => v.kind), ['sheet'], 'finished sheets lead the variations');
    let r = await call(handleCharacters, 'PUT', ['film', 'characters', june, 'sheet', 'main'], { asset_id: variation.asset_id });
    assert.strictEqual(r.body.main.asset_id, variation.asset_id);
    const vFile = db.prepare('SELECT file_path FROM film_assets WHERE id = ?').get(variation.asset_id).file_path;
    for (const [name, pick] of Object.entries(SELECTORS)) assert.ok(ends(await pick(), vFile), `${name} did not follow the new main`);
    r = await call(handleCharacters, 'PUT', ['film', 'characters', june, 'sheet', 'main'], { asset_id: side.id });
    for (const [name, pick] of Object.entries(SELECTORS)) assert.ok(ends(await pick(), side.file), `${name} did not follow an old view made main`);
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM film_assets WHERE character_id = ? AND json_extract(metadata, '$.main_sheet') = 1").get(june).n, 1, 'one main at a time');
    await call(handleCharacters, 'PUT', ['film', 'characters', june, 'sheet', 'main'], { asset_id: mainId });
});

// Set-based over every field of film_characters that describes a person: each reaches both prompts; a placeholder does not.
test('every describing field reaches the prompts; the screenplay import\'s placeholder does not; the costume comes from the notes', async () => {
    const fields = { appearance_prompt: 'APPEARANCE-X', description: 'DESCRIPTION-X', age_range: '22-25', gender: 'Female', ethnicity: 'ETHNICITY-X',
        build: 'BUILD-X', hair: 'HAIR-X', distinguishing: 'SCAR-X', height_m: 1.68 };
    const id = generateId();
    db.prepare(`INSERT INTO film_characters (id, project_id, name, ${Object.keys(fields).join(', ')}, personality_notes) VALUES (?, ?, 'DESC TEST', ${Object.keys(fields).map(() => '?').join(', ')}, ?)`)
        .run(id, pid, ...Object.values(fields), 'Detected from screenplay (37 mentions)');
    const seen = [];
    await S.mainPicturePrompt(id, { ask: async q => { seen.push(q.prompt); return { text: 'x', model: 'm' }; } });
    const pic = path.join(TMP, 'studio-desc.png'); fs.writeFileSync(pic, 'png');
    db.prepare("INSERT INTO film_assets (id, project_id, character_id, asset_type, file_path, file_name, metadata) VALUES (?, ?, ?, 'reference_image', ?, 'studio-desc.png', '{\"medium_shot\":true}')").run('studio-desc', pid, id, pic);
    await S.sheetPrompt(id, { asset_id: 'studio-desc' }, { ask: async q => { seen.push(q.prompt); return { text: 'x', model: 'm' }; } });
    for (const q of seen) {
        for (const v of ['APPEARANCE-X', 'DESCRIPTION-X', '22-25', 'Female', 'ETHNICITY-X', 'BUILD-X', 'HAIR-X', 'SCAR-X', '1.68 m']) assert.ok(q.includes(v), `${v} did not reach the prompt`);
        assert.ok(!q.includes('Detected from screenplay'), 'the placeholder is not a description');
    }
    assert.match(seen[1], /Take the wardrobe from the WARDROBE \(or costume\) part of my notes/);
    assert.doesNotMatch(seen[1], /Use it for both identity and wardrobe/);
});

test('step 1: the main picture prompt is written from the description and the stored guide, as one block', async () => {
    let asked;
    const out = await S.mainPicturePrompt(june, { ask: async q => { asked = q; return { text: '```\nMedium shot studio photograph of a young woman... Photographed not generated.\n```', model: 'gpt-6-astra' }; } });
    assert.strictEqual(out.prompt, 'Medium shot studio photograph of a young woman... Photographed not generated.');
    assert.deepStrictEqual(asked.images, []);
    assert.match(asked.prompt, /image-prompt director for photoreal AI character face locks/, 'the guide');
    assert.match(asked.prompt, /skip the confirmation bullets/);
    assert.match(asked.prompt, /Auburn hair pinned back[\s\S]*A watchful young woman[\s\S]*25-30/, 'the description');
});

test('step 2: the sheet prompt is written from the studio picture (attached, and kept) and the stored guide', async () => {
    let asked;
    const out = await S.sheetPrompt(june, { data: PNG, name: 'studio.png' }, { ask: async q => { asked = q; return { text: 'A three-panel character reference sheet composed as one horizontal frame...', model: 'm' }; } });
    assert.match(out.prompt, /^A three-panel character reference sheet/);
    assert.strictEqual(asked.images.length, 1);
    assert.ok(fs.existsSync(asked.images[0]));
    assert.match(asked.prompt, /character-sheet prompt writer[\s\S]*LEFT PANEL — full body front view, headless/, 'the guide');
    const sheet = S.sheetOf(june);
    assert.deepStrictEqual(sheet.studio_portraits.map(p => p.asset_id), [out.studio_portrait_id], 'the studio picture is kept, apart');
    assert.ok(!sheet.variations.some(v => v.asset_id === out.studio_portrait_id), 'and is not a variation');
    // A picture already uploaded can be reused.
    const again = await S.sheetPrompt(june, { asset_id: out.studio_portrait_id }, { ask: async q => ({ text: 'x', model: 'm', q }) });
    assert.strictEqual(again.studio_portrait_id, out.studio_portrait_id);
});

test('refusals: no studio picture, an expression as main, another character\'s picture, no description', async () => {
    await assert.rejects(S.sheetPrompt(june, {}, { ask: async () => assert.fail('asked') }), /studio picture is needed/);
    const ex = plate('front', { reference_role: 'expression' });
    assert.throws(() => S.setMain(june, ex.id), /expression/);
    const ray = generateId();
    db.prepare('INSERT INTO film_characters (id, project_id, name) VALUES (?, ?, ?)').run(ray, pid, 'RAY');
    assert.throws(() => S.setMain(ray, front.id), /not one of this character/);
    await assert.rejects(S.mainPicturePrompt(ray, { ask: async () => assert.fail('asked') }), /no description yet/);
    assert.strictEqual((await call(handleCharacters, 'GET', ['film', 'characters', june, 'sheet'])).body.main.asset_id, mainId);
});

test('the prompts are jobs kept per character: started at once, read back from the sheet while writing and when done', async () => {
    let release; const gate = new Promise(r => { release = r; });
    const ask = async () => { await gate; return { text: 'Studio prompt. Photographed not generated.', model: 'gpt-6-astra' }; };
    const { prompts, done } = S.startPrompt(june, 'main', {}, { ask });
    assert.strictEqual(prompts.main.status, 'writing');
    assert.throws(() => S.startPrompt(june, 'main', {}, { ask }), /already writing/);
    // The director leaves and comes back: the sheet, read fresh, still says it is being written.
    assert.strictEqual(S.sheetOf(june).prompts.main.status, 'writing');
    release(); await done;
    const back = S.sheetOf(june).prompts.main;
    assert.deepStrictEqual([back.status, back.prompt, back.model], ['done', 'Studio prompt. Photographed not generated.', 'gpt-6-astra']);
    // The sheet prompt from a new picture: the picture is kept first, the job reads it from disk.
    const sheetJob = S.startPrompt(june, 'sheet', { data: png(), name: 'studio.png' }, { ask: async q => ({ text: `sheet from ${q.images.length} picture`, model: 'm' }) });
    await sheetJob.done;
    const sp = S.sheetOf(june).prompts.sheet;
    assert.strictEqual(sp.prompt, 'sheet from 1 picture');
    assert.ok(S.sheetOf(june).studio_portraits.some(p => p.asset_id === sp.studio_portrait_id));
    // A failure is kept and said; checks that can be made at once refuse at once.
    await S.startPrompt(june, 'main', {}, { ask: async () => { throw new Error('ChatGPT is not signed in'); } }).done;
    assert.deepStrictEqual([S.sheetOf(june).prompts.main.status, S.sheetOf(june).prompts.main.error], ['failed', 'ChatGPT is not signed in']);
    assert.throws(() => S.startPrompt(june, 'sheet', {}), /studio picture is needed/);
    // The route answers 202 at once with the job's state.
    const r = await call(handleCharacters, 'POST', ['film', 'characters', june, 'sheet', 'prompt', 'nope'], {});
    assert.strictEqual(r.status, 404);
});

test('a prompt still being written when the app stopped reads as interrupted, not as writing forever', () => {
    const fresh = generateId();
    db.prepare('INSERT INTO film_characters (id, project_id, name) VALUES (?, ?, ?)').run(fresh, pid, 'MARA');
    db.prepare("INSERT INTO film_character_sheet_prompts (character_id, kind, status) VALUES (?, 'main', 'writing')").run(fresh);
    // A fresh process sweeps on its first read; simulated by re-requiring the module.
    delete require.cache[require.resolve('../lib/character-sheet-main')];
    const S2 = require('../lib/character-sheet-main');
    assert.strictEqual(S2.promptsOf(fresh).main.status, 'interrupted');
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
