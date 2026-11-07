const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-storyboard-print-'));
process.env.FILM_DATA_DIR = DIR;
const { db, generateId } = require('../db/database');
const log = console.log;
try { console.log = () => {}; require('../db/schema').ensureSchema(); } finally { console.log = log; }
const { buildStoryboardPrint } = require('../lib/storyboard-print');
const { handleStoryboardPrint } = require('../routes/storyboard-print');
test.after(() => { db.close(); fs.rmSync(DIR, { recursive: true, force: true }); });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=', 'base64');

function fixture() {
    const project = generateId(), scenes = [generateId(), generateId()];
    db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(project, 'Paper <script>title</script>');
    scenes.forEach((id, i) => db.prepare('INSERT INTO film_scenes(id,project_id,scene_number,location) VALUES (?,?,?,?)').run(id, project, i + 1, 'Set'));
    const shots = [
        [scenes[1], '2B', 2], [scenes[0], '1A', 2], [scenes[1], '2A', 0],
        [scenes[0], '1C', 0], [scenes[0], '1B', 1],
    ].map(([scene, code, sort]) => {
        const id = generateId();
        db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,sort_order,scene_card_yaml,current_frame_version) VALUES (?,?,?,?,?,?)')
            .run(id, scene, code, sort, JSON.stringify({ camera: { lens: '50mm', movement: 'static' }, description: 'A door opens.' }), 1);
        return { id, code };
    });
    const selected = shots.find(s => s.code === '1C');
    const file = path.join(DIR, `${selected.id}-original.png`);
    fs.writeFileSync(file, PNG);
    const assetId = generateId();
    db.prepare('INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,version,metadata) VALUES (?,?,?,?,?,?,?)')
        .run(assetId, project, selected.id, 'storyboard', file, 1, '{}');
    db.prepare('INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,version) VALUES (?,?,?,?,?,?)')
        .run(generateId(), project, selected.id, 'storyboard', '/missing/newest.png', 2);
    return { project, shots, selected, file, assetId };
}
function route(method, project, query = {}) {
    let status, body;
    handleStoryboardPrint({ method }, { writeHead(s) { status = s; }, end(raw) { body = JSON.parse(raw); } }, ['film', 'projects', project, 'storyboard', 'print'], query);
    return { status, body };
}

test('selected original bytes and narrative order produce four normal panels per landscape page without writes', () => {
    const f = fixture(), before = db.prepare('SELECT * FROM film_assets WHERE project_id=? ORDER BY id').all(f.project);
    const out = buildStoryboardPrint(db, f.project);
    assert.equal(out.paper, 'letter'); assert.equal(out.orientation, 'landscape');
    assert.deepEqual(out.shots.map(s => s.shot_number), ['1C', '1B', '1A', '2A', '2B']);
    assert.deepEqual(out.pages.filter(p => p.kind === 'shots').map(p => p.panel_ids.length), [4, 1]);
    const panel = out.panels.find(p => p.kind === 'shot' && p.shot_id === f.selected.id);
    assert.equal(panel.image.asset_id, f.assetId); assert.equal(panel.image.version, 1);
    assert.equal(panel.image.data_uri, undefined, 'the picture travels once, inside the page');
    assert.ok(out.html.includes(`<img src="data:image/png;base64,${PNG.toString('base64')}"`));
    assert.equal(panel.image.byte_length, PNG.length);
    assert.equal(panel.image.sha256, crypto.createHash('sha256').update(PNG).digest('hex'));
    assert.deepEqual(panel.image.pixels, { width: 1, height: 1 });
    assert.match(out.html, /@page\s*\{\s*size:\s*letter landscape/);
    assert.match(out.html, /grid-template-columns:\s*repeat\(2/);
    assert.ok(!out.html.includes('<script>')); assert.match(out.html, /&lt;script&gt;title&lt;\/script&gt;/);
    assert.ok(!out.html.includes('thumbnail')); assert.ok(!out.html.includes('high-resolution'));
    assert.deepEqual(db.prepare('SELECT * FROM film_assets WHERE project_id=? ORDER BY id').all(f.project), before);
    assert.deepEqual(fs.readFileSync(f.file), PNG);
});

test('two boards per page sit side by side with a larger picture and more description lines', () => {
    const f = fixture();
    db.prepare('UPDATE film_shots SET scene_card_yaml=? WHERE id=?').run(JSON.stringify({
        camera: { lens: '50mm' }, description: 'Word '.repeat(60),
    }), f.selected.id);
    const four = buildStoryboardPrint(db, f.project), two = buildStoryboardPrint(db, f.project, { perPage: 2 });
    assert.equal(four.per_page, 4); assert.equal(two.per_page, 2);
    assert.deepEqual(two.pages.filter(p => p.kind === 'shots').map(p => p.panel_ids.length), [2, 2, 1]);
    const lines = out => out.panels.find(p => p.kind === 'shot' && p.shot_id === f.selected.id).lines.length;
    assert.ok(lines(two) > lines(four));
    assert.equal(two.continuation_count, 0); assert.ok(four.continuation_count > 0);
    assert.equal(two.geometry.picture, 'left'); assert.equal(four.geometry.picture, 'above');
    assert.ok(two.geometry.image.height_pt > four.geometry.image.height_pt, 'two per page prints a larger picture');
    assert.match(two.html, /content="[^"]+:letter:2"/); assert.match(two.html, /2 per page/);
});

test('long Unicode camera, description and dialogue recover exactly across explicitly linked continuations', () => {
    const f = fixture();
    const description = '界🙂 e\u0301 <b>not markup</b>\n' + 'VeryLongUnbrokenWord'.repeat(80) + '\nFinal sentence.';
    const dialogue = [{ character: 'MAYA', text: 'こんにちは\n' + 'Dialogue without truncation. '.repeat(40) }];
    db.prepare('UPDATE film_shots SET scene_card_yaml=? WHERE id=?').run(JSON.stringify({
        camera: { lens: '35mm', custom_note: 'Camera note '.repeat(30) }, description, dialogue,
    }), f.selected.id);
    const out = buildStoryboardPrint(db, f.project, { paper: 'a4' });
    const shot = out.shots.find(s => s.shot_id === f.selected.id);
    const parts = out.panels.filter(p => p.shot_id === f.selected.id);
    assert.ok(parts.length > 2); assert.equal(parts[0].kind, 'shot');
    for (const field of shot.fields) {
        assert.equal(parts.flatMap(p => p.lines).filter(l => l.field === field.key).map(l => l.text).join(''), field.text);
    }
    assert.equal(shot.fields.find(f => f.key === 'description').text, description);
    assert.equal(shot.fields.find(f => f.key === 'dialogue.0').text, 'MAYA: ' + dialogue[0].text);
    assert.ok(parts.slice(1).every(p => p.kind === 'continuation' && p.source_page === 1 && p.source_slot === 1));
    assert.ok(parts[0].continues_on_pages.every(n => out.pages.find(p => p.number === n).kind === 'continuations'));
    assert.match(out.html, /size:\s*A4 landscape/); assert.match(out.html, /Notes continue on page/);
    assert.match(out.html, /not markup/); assert.ok(!out.html.includes('<b>not markup</b>'));
    assert.ok(!out.html.includes('text-overflow')); assert.ok(!out.html.includes('line-clamp'));
});

test('missing selected original stays missing rather than using another version or a thumbnail', () => {
    const f = fixture(); fs.unlinkSync(f.file);
    const thumbnail = path.join(DIR, 'thumb.png'); fs.writeFileSync(thumbnail, PNG);
    db.prepare('INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,version) VALUES (?,?,?,?,?,?)')
        .run(generateId(), f.project, f.selected.id, 'thumbnail', thumbnail, 1);
    let out = buildStoryboardPrint(db, f.project);
    let image = out.panels.find(p => p.shot_id === f.selected.id).image;
    assert.equal(image.status, 'offline'); assert.equal(image.asset_id, f.assetId); assert.equal(image.data_uri, null);
    assert.match(out.html, /Selected original unavailable/);
    db.prepare('UPDATE film_shots SET current_frame_version=99 WHERE id=?').run(f.selected.id);
    out = buildStoryboardPrint(db, f.project);
    image = out.panels.find(p => p.shot_id === f.selected.id).image;
    assert.equal(image.status, 'selection_missing'); assert.equal(image.version, 99);
});

test('CJK, emoji and ZWJ graphemes reserve double width and remain intact across continuation panels', () => {
    const f = fixture(), family = '👩‍👩‍👧‍👦';
    const description = '界'.repeat(120) + '\n' + family.repeat(120) + '\t' + 'A'.repeat(120);
    db.prepare('UPDATE film_shots SET scene_card_yaml=? WHERE id=?').run(JSON.stringify({ description }), f.selected.id);
    const out = buildStoryboardPrint(db, f.project), parts = out.panels.filter(p => p.shot_id === f.selected.id);
    const lines = parts.flatMap(p => p.lines).filter(l => l.field === 'description');
    assert.equal(lines.map(l => l.text).join(''), description);
    const U = out.line_width_units;
    assert.ok(lines.every(l => l.width_units <= U));
    assert.equal(lines[0].text, '界'.repeat(Math.floor(U / 2)));
    assert.equal(lines.find(l => l.text.startsWith(family)).text, family.repeat(Math.floor(U / 2)));
    assert.ok(parts.slice(1).every(p => p.lines[0].label), 'a continuation repeats its current field label');
});

test('ordinary words wrap at whitespace while oversized tokens split without losing text or offsets', () => {
    const f = fixture(), sentence = 'The runner begins crossing the room and checks the doorway. ';
    const description = sentence.repeat(3).trimEnd() + '\n' + 'OversizedToken'.repeat(12);
    db.prepare('UPDATE film_shots SET scene_card_yaml=? WHERE id=?').run(JSON.stringify({ description }), f.selected.id);
    const out = buildStoryboardPrint(db, f.project);
    const lines = out.panels.filter(p => p.shot_id === f.selected.id).flatMap(p => p.lines).filter(l => l.field === 'description');
    const U = out.line_width_units, prose = lines.filter(l => l.start < sentence.length * 3 - 1);
    assert.ok(prose.length > 1, 'the sentences wrap');
    // Every wrapped prose line breaks after a space, never inside a word, and stays within the width.
    for (const line of prose.slice(0, -1)) assert.match(line.text, /\s$/);
    assert.ok(prose[0].text.length > U - 'doorway. '.length, 'a line is filled before it wraps');
    assert.equal(lines.map(l => l.text).join(''), description);
    assert.ok(lines.every(l => l.width_units <= U));
    for (const line of lines) assert.equal(description.slice(line.start, line.end), line.text);
    assert.ok(lines.some(l => l.text.length === U && l.text.startsWith('OversizedToken')));
});

test('empty metadata has honest states and absent dialogue adds no invented dialogue section', () => {
    const f = fixture(); db.prepare('UPDATE film_shots SET scene_card_yaml=? WHERE id=?').run('{}', f.selected.id);
    let out = buildStoryboardPrint(db, f.project), shot = out.shots.find(s => s.shot_id === f.selected.id);
    assert.deepEqual(shot.fields, []);
    const panel = out.panels.find(p => p.shot_id === f.selected.id);
    assert.match(out.html, /Camera not recorded/); assert.match(out.html, /Description not recorded/);
    assert.ok(!panel.lines.some(l => l.field.startsWith('dialogue')));
    db.prepare('UPDATE film_shots SET scene_card_yaml=? WHERE id=?').run('broken card', f.selected.id);
    out = buildStoryboardPrint(db, f.project); shot = out.shots.find(s => s.shot_id === f.selected.id);
    assert.equal(shot.metadata_status, 'unreadable'); assert.match(out.html, /Shot metadata unreadable/);
});

test('read-only route validates paper and method and reports empty/missing projects', () => {
    const project = generateId(); db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(project, 'Empty');
    const empty = route('GET', project); assert.equal(empty.status, 200); assert.equal(empty.body.shot_count, 0);
    assert.match(empty.body.html, /No shots in narrative order/);
    assert.equal(route('GET', generateId()).status, 404);
    assert.equal(route('POST', project).status, 405);
    assert.equal(route('GET', project, { paper: 'unsupported' }).status, 400);
    assert.equal(route('GET', project, { per_page: '2' }).body.per_page, 2);
    assert.equal(route('GET', project, { per_page: '3' }).status, 400);
});

test('every paper × layout × frame aspect fits its page: boards, picture and every text line inside the printable area', () => {
    const { PAPERS, LAYOUTS, geometry, renderPlan } = require('../lib/storyboard-print');
    const ASPECTS = [1, 4 / 3, 16 / 9, 1.85, 2, 2.39, 2.76];
    const combos = [];
    for (const paper of Object.keys(PAPERS)) for (const perPage of Object.keys(LAYOUTS).map(Number)) for (const aspect of ASPECTS) combos.push({ paper, perPage, aspect });
    assert.equal(combos.length, Object.keys(PAPERS).length * Object.keys(LAYOUTS).length * ASPECTS.length);
    for (const { paper, perPage, aspect } of combos) {
        const g = geometry(paper, perPage, aspect), label = `${paper}/${perPage}/${aspect.toFixed(2)}`;
        // The page's own blocks add up to no more than the printable height, and boards tile it exactly.
        assert.ok(g.head_pt + g.gap_pt + g.content_pt + g.gap_pt + g.foot_pt <= g.page.height_pt, label + ' page height');
        assert.ok(g.cols * g.board.width_pt + (g.cols - 1) * g.gutter_pt <= g.page.width_pt + 0.01, label + ' board width');
        assert.ok(g.rows * g.board.height_pt + (g.rows - 1) * g.gutter_pt <= g.content_pt + 0.01, label + ' board height');
        // The picture keeps its aspect and fits the board; the text lines fit what is left.
        assert.ok(Math.abs(g.image.width_pt / g.image.height_pt - aspect) < 0.01, label + ' picture aspect');
        assert.ok(g.image.width_pt <= g.image_box.width_pt + 0.01 && g.image.height_pt <= g.image_box.height_pt + 0.01, label + ' picture in its box');
        assert.ok(g.normal_lines >= 3, label + ' at least three lines of notes under every picture');
        assert.ok(g.text_top_pt + g.normal_lines * g.line_pt <= g.board.height_pt + 0.01, label + ' notes fit the board');
        assert.ok(g.continuation_top_pt + g.continuation_lines * g.line_pt <= g.board.height_pt + 0.01, label + ' continuation fits');
        // A line of the widest characters still fits the text column (monospace advance 0.6em).
        assert.ok(g.line_width_units * g.font_pt * 0.6 <= g.text_width_pt - g.label_pt, label + ' line width');
        assert.ok(g.line_width_units >= 30, label + ' notes are not squeezed into a narrow column');
        // The rendered page carries exactly these numbers.
        const shots = [1, 2, 3].map(n => ({ shot_id: 's' + n, shot_number: '0' + n, scene_number: 1, fields: [{ key: 'description', label: 'Action', text: 'A door opens. '.repeat(n * 20) }],
            metadata_status: 'recorded', camera_recorded: true, description_recorded: true,
            image: { status: 'ready', version: 1, data_uri: 'data:image/png;base64,', pixels: { width: Math.round(aspect * 1000), height: 1000 } } }));
        const plan = renderPlan({ project_id: 'p', title: 'T' }, shots, { paper, perPage });
        assert.equal(plan.line_width_units, g.line_width_units, label);
        assert.ok(plan.panels.every(p => p.lines.length <= (p.kind === 'shot' ? g.normal_lines : g.continuation_lines)), label + ' panel line budget');
        assert.ok(plan.panels.flatMap(p => p.lines).every(l => l.width_units <= g.line_width_units), label + ' every line within width');
        assert.match(plan.html, new RegExp(`\\.print-page \\{[^}]*height: ${g.page.height_pt.toFixed(2)}pt`), label + ' fixed page height');
    }
});

/** The one picture a fixture page embeds. */
const embedded = html => { const all = [...html.matchAll(/<img src="([^"]+)"/g)]; assert.equal(all.length, 1); return all[0][1]; };
/** Width and height from a JPEG's start-of-frame marker. */
function jpegPixels(bytes) {
    for (let i = 2; i + 9 < bytes.length; i += 2 + bytes.readUInt16BE(i + 2)) {
        if (bytes[i] !== 0xff) throw Error('not a JPEG marker');
        if (bytes[i + 1] >= 0xc0 && bytes[i + 1] <= 0xc3) return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
    }
    throw Error('no JPEG frame header');
}

test('every paper × layout prints a picture larger than 300 dpi from a print-size copy; a smaller one keeps its original bytes', () => {
    const { resolveFfmpeg } = require('../lib/ffmpeg');
    const { geometry, PAPERS, LAYOUTS, PRINT_DPI } = require('../lib/storyboard-print');
    const bin = resolveFfmpeg();
    assert.ok(bin.available, 'ffmpeg is needed to make print copies');
    const f = fixture();
    // A 4K frame, the house standard size: larger than any board prints it at 300 dpi.
    const big = path.join(DIR, `${f.selected.id}-4k.png`);
    require('node:child_process').execFileSync(bin.bin, ['-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=3840x2160', '-frames:v', '1', big]);
    const original = fs.readFileSync(big), sha = crypto.createHash('sha256').update(original).digest('hex');
    db.prepare('UPDATE film_assets SET file_path=? WHERE id=?').run(big, f.assetId);
    for (const paper of Object.keys(PAPERS)) for (const perPage of Object.keys(LAYOUTS).map(Number)) {
        const label = `${paper} ${perPage}/page`;
        const out = buildStoryboardPrint(db, f.project, { paper, perPage }), g = geometry(paper, perPage, 16 / 9);
        const image = out.panels.find(p => p.kind === 'shot' && p.shot_id === f.selected.id).image;
        assert.equal(image.sha256, sha, label + ' the original is the one on record');
        assert.equal(image.byte_length, original.length, label);
        assert.deepEqual(image.pixels, { width: 3840, height: 2160 }, label);
        const src = embedded(out.html);
        assert.match(src, /^data:image\/jpeg;base64,/, label);
        const px = jpegPixels(Buffer.from(src.split(',')[1], 'base64')), printed = Math.max(g.image.width_pt, g.image.height_pt) / 72;
        assert.equal(Math.max(px.width, px.height), image.print.long_edge_px, label);
        assert.ok(px.width / (g.image.width_pt / 72) >= PRINT_DPI, `${label} ${px.width}px across ${printed.toFixed(2)}in is at least ${PRINT_DPI} dpi`);
        assert.ok(px.width < 3840, label + ' smaller than the original');
        assert.ok(image.print.byte_length < original.length, label + ' fewer bytes than the original');
        assert.ok(!out.html.includes(original.toString('base64').slice(0, 400)), label + ' the original bytes are not embedded');
        assert.ok(!out.html.includes('thumbnail'), label);
    }
    assert.deepEqual(fs.readFileSync(big), original, 'the original file is untouched');
    // Within the print size but heavy, as a photographic PNG frame is: re-encoded at its own size, never enlarged.
    const small = path.join(DIR, `${f.selected.id}-small.png`);
    require('node:child_process').execFileSync(bin.bin, ['-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-vf', 'noise=alls=30:allf=t', '-frames:v', '1', small]);
    db.prepare('UPDATE film_assets SET file_path=? WHERE id=?').run(small, f.assetId);
    const out = buildStoryboardPrint(db, f.project, { perPage: 2 });
    const image = out.panels.find(p => p.kind === 'shot' && p.shot_id === f.selected.id).image;
    assert.deepEqual(jpegPixels(Buffer.from(embedded(out.html).split(',')[1], 'base64')), { width: 1280, height: 720 });
    assert.equal(image.print.long_edge_px, 1280);
    assert.ok(image.print.byte_length < fs.statSync(small).size);
    // The first test covers the other side: a 1 × 1 original, smaller than any copy, prints from its own bytes.
});
