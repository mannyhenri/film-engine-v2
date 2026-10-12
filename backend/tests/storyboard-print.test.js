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
    assert.deepEqual(Buffer.from(panel.image.data_uri.split(',')[1], 'base64'), PNG);
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
    assert.match(out.html, /size:\s*A4 landscape/); assert.match(out.html, /Text continues on page/);
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
    assert.ok(lines.every(l => l.width_units <= 24));
    assert.equal(lines[0].text, '界'.repeat(12));
    assert.equal(lines.find(l => l.text.startsWith(family)).text, family.repeat(12));
    assert.ok(parts.slice(1).every(p => p.lines[0].label), 'a continuation repeats its current field label');
});

test('ordinary words wrap at whitespace while oversized tokens split without losing text or offsets', () => {
    const f = fixture(), description = 'The runner begins crossing the room and checks the doorway.\n' + 'OversizedToken'.repeat(12);
    db.prepare('UPDATE film_shots SET scene_card_yaml=? WHERE id=?').run(JSON.stringify({ description }), f.selected.id);
    const out = buildStoryboardPrint(db, f.project);
    const lines = out.panels.filter(p => p.shot_id === f.selected.id).flatMap(p => p.lines).filter(l => l.field === 'description');
    assert.equal(lines[0].text, 'The runner begins ');
    assert.equal(lines[1].text, 'crossing the room and ');
    assert.equal(lines.map(l => l.text).join(''), description);
    assert.ok(lines.every(l => l.width_units <= 24));
    for (const line of lines) assert.equal(description.slice(line.start, line.end), line.text);
    assert.ok(lines.some(l => l.text.length === 24 && l.text.startsWith('OversizedToken')));
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
});
