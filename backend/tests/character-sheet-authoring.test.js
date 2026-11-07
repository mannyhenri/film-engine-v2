/**
 * Putting things INTO the sheet, not just reading it.
 *
 * The sheet rendered six regions and three of them were read-only dead ends:
 * the reference band could only be filled from another modal, wardrobe said
 * "no wardrobe recorded yet" with no way to record any, and the palette said
 * "set one on a costume" pointing at a table with no UI. A region that shows
 * an empty state and offers no way out of it is a label, not a feature.
 *
 * Set-based over the ways IN, because each fails independently: a band you can
 * upload to but not generate into is half-built, and one that takes both but
 * files everything uncategorised makes the four filter pills decorative.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CS = require('../lib/character-sheet');
const SPA = fs.readFileSync(path.join(__dirname, '../../src/index.html'), 'utf8');

function bodyOf(name, src = SPA) {
    const i = src.indexOf(`function ${name}(`);
    if (i < 0) return '';
    let depth = 0, j = src.indexOf('{', i), end = j;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (!depth) { end = j; break; } }
    }
    return src.slice(i, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/* ── every way into the sheet ──────────────────────────────────────────── */

test('the authoring routes are declared, and each says how it gets its picture', () => {
    assert.ok(CS.AUTHORING.length >= 4, 'too few ways in to be the real set');
    for (const way of CS.AUTHORING) {
        assert.ok(['upload', 'generate', 'manual'].includes(way.source),
            `${way.id}: '${way.source}' is not a way a picture or a value arrives`);
        assert.ok(way.fn, `${way.id}: no function`);
        assert.ok(way.region, `${way.id}: does not say which region it fills`);
        assert.ok(CS.SHEET_REGIONS.some(r => r.id === way.region),
            `${way.id}: fills '${way.region}', which is not a region of the sheet`);
        assert.equal(typeof way.spends, 'boolean',
            `${way.id}: does not declare whether it spends`);
    }
});

test('every authoring action exists and is bound to a control', () => {
    for (const way of CS.AUTHORING) {
        assert.ok(new RegExp(`function ${way.fn}\\(`).test(SPA),
            `${way.fn}() does not exist`);
        assert.ok(new RegExp(`onclick="[^"]*\\b${way.fn}\\(`).test(SPA),
            `${way.fn}() is defined and nothing calls it — a handler wired to nothing looks `
            + 'identical to a working page until clicked');
    }
});

test('the reference band takes both an upload and a generation, with a category', () => {
    const ways = CS.AUTHORING.filter(w => w.region === 'references');
    assert.ok(ways.some(w => w.source === 'upload'), 'no way to add a picture you already have');
    assert.ok(ways.some(w => w.source === 'generate'), 'no way to generate a reference from a prompt');
    for (const w of ways) {
        const body = bodyOf(w.fn);
        assert.ok(/ref_category|category/.test(body),
            `${w.fn}() files nothing under a category, so the four filter pills are decorative`);
    }
});

test('wardrobe takes a title and a picture, both ways', () => {
    const ways = CS.AUTHORING.filter(w => w.region === 'wardrobe');
    assert.ok(ways.some(w => w.source === 'upload') && ways.some(w => w.source === 'generate'),
        'wardrobe cannot be both uploaded and generated');
    for (const w of ways) {
        assert.ok(/title|name|note/.test(bodyOf(w.fn)),
            `${w.fn}() stores no title — a wardrobe thumbnail with no name is not a checklist`);
    }
});

/* ── the palette ───────────────────────────────────────────────────────── */

test('a palette entry is a colour and a name, validated', () => {
    assert.deepEqual(CS.normaliseSwatch({ hex: '#5C1620', name: 'banyan' }),
        { hex: '#5c1620', name: 'banyan' });
    // Shorthand is expanded, so a stored value is always comparable.
    assert.equal(CS.normaliseSwatch({ hex: '#abc' }).hex, '#aabbcc');
    assert.equal(CS.normaliseSwatch({ hex: 'red' }), null,
        'a colour name the browser understands but a PDF generator may not was accepted');
    assert.equal(CS.normaliseSwatch({ hex: '#12345' }), null, 'a malformed hex was accepted');
    assert.equal(CS.normaliseSwatch(null), null);
});

test('a palette can be built by hand or lifted from a picture', () => {
    const ways = CS.AUTHORING.filter(w => w.region === 'palette');
    assert.ok(ways.some(w => w.source === 'manual'), 'no way to type a colour in');
    assert.ok(ways.some(w => w.source === 'upload' || w.source === 'generate'),
        'no way to take the palette from an image already in the sheet');
    // Lifting must be honest about being a sample, not a claim about the film.
    const lift = bodyOf(CS.AUTHORING.find(w => w.region === 'palette' && w.source !== 'manual').fn);
    assert.ok(/canvas|getImageData|drawImage/.test(lift),
        'the palette is not actually sampled from the image pixels');
});

test('the palette belongs to the character, not to one costume', () => {
    /*
     * The sheet used to point at film_costumes.color_palette, a table with no
     * UI and zero rows — so "set one on a costume" was advice about a surface
     * that did not exist. A palette is a fact about the character.
     */
    const migrations = fs.readdirSync(path.join(__dirname, '../db/migrations'))
        .map(f => fs.readFileSync(path.join(__dirname, '../db/migrations', f), 'utf8')).join('\n');
    assert.ok(/film_characters\s+ADD COLUMN palette_json/.test(migrations),
        'the palette has nowhere to live on the character');
});

/* ── spinners ──────────────────────────────────────────────────────────── */

test('everything that spends shows a spinner while it runs', () => {
    /*
     * A generation takes up to a minute. Without a spinner the page looks
     * exactly as it did before the click, which reads as the button not
     * working and invites a second press — a paid action, bought twice. The
     * board already learned this; the sheet had none.
     */
    assert.ok(/function csBusy\(/.test(SPA), 'no shared busy helper');
    const spending = CS.AUTHORING.filter(w => w.spends).map(w => w.fn)
        .concat(['generateOfficialViews']);
    for (const fn of spending) {
        const body = bodyOf(fn);
        assert.ok(/csBusy\(/.test(body),
            `${fn}() spends and shows no spinner — the page looks unchanged for up to a minute`);
    }
});

test('the spinner is a real animation, and it is cleared on failure too', () => {
    assert.ok(/@keyframes\s+cs-spin|animation:[^;]*spin/.test(SPA),
        'the busy state does not animate, so it reads as a frozen page');
    const body = bodyOf('csBusy');
    assert.ok(/finally|catch/.test(body),
        'a failed generation would leave the spinner turning for ever — worse than no spinner');
});

/* ── gender ────────────────────────────────────────────────────────────── */

test('gender is chosen from the vocabulary casting actually reads', () => {
    /*
     * It was already on the card, in the edit form and in the sheet spec — as
     * FREE TEXT, which is why voiceGender() has to match with a regex. A picker
     * makes "F", "woman" and "female" one value, and the one the caster reads.
     */
    assert.ok(CS.GENDERS.length >= 3, 'too few options to cover a cast');
    const { voiceGender } = require('../lib/voice-casting');
    for (const g of CS.GENDERS) {
        assert.ok(g.id && g.label, 'a gender option with no value or label');
        assert.ok(voiceGender({ gender: g.id }) !== null,
            `'${g.id}' is offered on the form and voice casting cannot read it`);
    }
    // The form must offer them, not a free-text box.
    const modal = SPA.slice(SPA.indexOf('id="characterModal"'), SPA.indexOf('id="characterModal"') + 4000);
    assert.ok(/data-field="gender"[\s\S]{0,40}>|<select[^>]*data-field="gender"/.test(modal),
        'the gender field is missing from the edit form');
    assert.ok(/<select[^>]*data-field="gender"/.test(modal),
        'gender is still a free-text input, so casting has to guess what was typed');
});

/* ── the PDF ───────────────────────────────────────────────────────────── */

/*
 * The export gathers the sheet's data; the page itself is the shared print renderer (src/lib/print-sheet.js,
 * which also prints the location, prop and storyboard sheets). So these read the PRINTED page, rendered from a
 * full character, rather than the export's source text.
 */
const PRINT = import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../../src/lib/print-sheet.js')).toString('base64'));
async function printedSheet() {
    const { characterDoc, sheetHtml } = await PRINT;
    return sheetHtml(characterDoc({ project: 'P', character: { name: 'Maya', age_range: '30s', gender: 'female', build: 'lean', description: 'She runs.' },
        main: { src: 'data:main', kind: 'sheet' }, variations: [{ src: 'data:v1', kind: 'side' }], palette: [{ hex: '#112233', name: 'Ink' }],
        wardrobe: [{ src: 'data:w', note: 'Coat' }], references: [{ src: 'data:r' }] }));
}

test('the exported sheet carries every region', async () => {
    // Set-based over the regions: an export that drops the palette is a sheet
    // somebody hands to a costume designer with the colours missing.
    const body = bodyOf('exportCharacterSheet');
    assert.ok(/characterDoc\(/.test(body) && /sheetHtml\(/.test(body), 'the export does not print through the shared sheet renderer');
    for (const [from, field] of [['palette', 'palette'], ['ward', 'wardrobe'], ['refs', 'references'], ['variations', 'variations'], ['main', 'main']]) {
        assert.ok(new RegExp(`\\b${field}\\b`).test(body) && body.includes(from), `the export hands the printed sheet no ${field}`);
    }
    const sheet = await printedSheet();
    for (const region of CS.SHEET_REGIONS) {
        const words = { views: 'Main picture', physical: 'Physical spec', details: 'Description',
            wardrobe: 'Wardrobe', palette: 'Palette', references: 'Concept art' }[region.id];
        assert.ok(sheet.includes(words),
            `the PDF has no '${words}' section — the sheet on paper is not the sheet on screen`);
    }
});

test('the exported sheet puts the main picture on top, the variations below it, then the description', async () => {
    // The order the director's sheet draws (MainSheet): the picture every generation uses leads the page.
    const body = bodyOf('exportCharacterSheet');
    assert.ok(body.includes('/sheet`'), 'the export does not read the main picture and its variations');
    const sheet = await printedSheet();
    const at = ['data:main', 'data:v1', '>Description<'].map(w => sheet.indexOf(w));
    assert.ok(at.every(i => i >= 0), `a part is missing from the export: ${at}`);
    assert.deepEqual([...at].sort((x, y) => x - y), at, 'the export is not main, then variations, then description');
});

test('the PDF does not print flush to the paper edge', async () => {
    const sheet = await printedSheet();
    const m = sheet.match(/@page\s*\{[^}]*margin:\s*([^;}]+)/);
    assert.ok(m, 'the print document sets no page margin');
    for (const side of m[1].trim().split(/\s+/)) {
        const [, n, unit] = side.match(/^([\d.]+)(mm|in|cm)$/) || [];
        assert.ok(n, `unreadable margin ${side}`);
        const mm = unit === 'mm' ? Number(n) : unit === 'cm' ? Number(n) * 10 : Number(n) * 25.4;
        assert.ok(mm >= 18, `a ${mm}mm margin runs the content into the edge of the paper`);
    }
});
