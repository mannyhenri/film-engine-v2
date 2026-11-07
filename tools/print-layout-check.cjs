/*
 * Every printed document, laid out by a real browser engine.
 *
 *   electron tools/print-layout-check.cjs        (prints one JSON report; exit 1 on any failure)
 *
 * The storyboard's page plan is arithmetic (backend/lib/storyboard-print.js); this
 * is the check that Chromium agrees with it: for every paper × boards-per-page ×
 * frame aspect, the PDF has exactly the planned pages and nothing in a page,
 * board or line spills out of its box. The character, location and prop sheets
 * (src/lib/print-sheet.js) are rendered full and empty on Letter and A4: nothing
 * wider than the page, every picture inside its frame, and a sensible page count.
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { renderPlan, PAPERS, LAYOUTS } = require(path.join(ROOT, 'backend/lib/storyboard-print.js'));
const ASPECTS = [1, 4 / 3, 16 / 9, 1.85, 2.33, 2.39, 2.76];
const SHEET_PAPERS = { letter: 'Letter', a4: 'A4' };

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

/** A flat test picture of a given shape, as a data URI (the documents only ever see data or http URLs). */
const pictures = new Map();
function picture(w, h, rgb = [70, 90, 120]) {
    const key = `${w}x${h}:${rgb}`;
    if (!pictures.has(key)) {
        const buf = Buffer.alloc(w * h * 4);
        for (let i = 0; i < w * h; i++) { buf[i * 4] = rgb[2]; buf[i * 4 + 1] = rgb[1]; buf[i * 4 + 2] = rgb[0]; buf[i * 4 + 3] = 255; }
        pictures.set(key, 'data:image/png;base64,' + nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG().toString('base64'));
    }
    return pictures.get(key);
}

const words = (n, seed = 'The vampires drift between candlelit tombs while petals hang in the air') => Array.from({ length: n }, (_, i) => seed.split(' ')[i % seed.split(' ').length]).join(' ');

function storyboardShots(aspect) {
    const w = Math.round(aspect * 400), h = 400;
    const note = [['shot type: wide · movement: static', words(18)], ['shot type: medium · lens: 35mm · movement: slow push', words(60)], ['', ''], ['shot type: close-up', words(240)], ['shot type: insert', 'WWWWWWWWWW MMMMMMMMMM ' + '界'.repeat(40)]];
    return Array.from({ length: 11 }, (_, i) => {
        const [camera, action] = note[i % note.length];
        const fields = [camera && { key: 'camera', label: 'Camera', text: camera }, action && { key: 'description', label: 'Action', text: action },
            i % 3 === 0 && { key: 'dialogue.0', label: 'Dialogue', text: 'ALENNA: ' + words(30, 'You were faster once and the night was ours') }].filter(Boolean);
        const ready = i % 5 !== 2;
        return { shot_id: 's' + i, shot_number: String(i + 1).padStart(2, '0'), scene_number: 4, fields, metadata_status: 'recorded',
            camera_recorded: !!camera, description_recorded: !!action,
            image: ready ? { status: 'ready', version: 1, data_uri: picture(w, h), pixels: { width: w, height: h } }
                : { status: 'offline', version: 1, data_uri: null, note: 'Selected original unavailable' } };
    });
}

async function sheetBuilders() {
    // src/ is ES modules for Vite while this package is CommonJS: load the file's own text as a module.
    const code = fs.readFileSync(path.join(ROOT, 'src/lib/print-sheet.js'), 'utf8');
    return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

function sheetFixtures(S) {
    const tall = picture(300, 400, [120, 80, 60]), wide = picture(640, 360), square = picture(400, 400, [60, 110, 80]), scope = picture(956, 400);
    const long = words(150);
    const fixtures = {
        character: {
            full: S.characterDoc({ project: 'Blade Eternal', character: { name: 'Alenna Vasquez-Delacroix', age_range: '30s', gender: 'female', height_m: 1.68, build: 'lean, wiry', hair: 'black, braided, singed at the ends', distinguishing: 'scar through the left brow; ' + words(30), appearance_prompt: long, description: words(80), personality_notes: words(60) },
                main: { src: scope, kind: 'sheet' }, variations: [tall, wide, square, tall, wide, square].map((src, i) => ({ src, kind: ['front', 'three-quarter', 'side', 'back', 'action', 'night'][i] })),
                palette: ['#1b1b1f', '#8a1c1c', '#d9a441', '#3d4a5c', '#efe6d8', 'not-a-colour'].map((hex, i) => ({ hex, name: ['Coat black', 'Blood red', 'Candle gold', 'Steel', 'Bone', 'Ash'][i] })),
                wardrobe: Array.from({ length: 6 }, (_, i) => ({ src: i === 5 ? '' : tall, note: 'Long leather coat ' + i })), references: Array.from({ length: 15 }, (_, i) => ({ src: i % 2 ? wide : square, note: 'ref ' + i })) }),
            empty: S.characterDoc({ project: 'Blade Eternal', character: { name: 'Extra' } }),
        },
        location: {
            full: S.locationDoc({ project: 'Blade Eternal', location: { name: 'San Miguel Cemetery — Día de Muertos', location_type: 'exterior', time_of_day_default: 'night', scene_count: 6, lighting_default: 'thousands of candles, warm practicals, cold moon rim', lighting_technique: 'practical-motivated', lighting_key_side: 'left', atmosphere_notes: words(80), sound_notes: words(40), linked_props: [{ name: 'Candles' }, { name: 'Marigold arch' }, { name: 'Skull masks' }] },
                sections: ['Overview', 'Architecture', 'Decoration', 'Ground', 'Sky', 'Light'].map((label, i) => ({ label, text: words(45 + i * 10) })),
                slots: [{ src: scope, label: '01 · Master', note: 'the establishing plate' }, { src: wide, label: '02 · Reverse', note: 'the opposite side' }, { src: '', label: '03 · Detail', note: 'a closer read' }, { src: wide, label: '04 · Exterior', note: 'its surroundings' }],
                plan: { north: 'the chapel with its blue-lit bell tower ' + words(20), south: 'the iron gates', east: 'rows of tombs', west: 'the marigold arch', interior: ['central path', 'family plot', words(12)], marker: 'camera starts at the gate looking north' },
                planImage: square, scenes: [1, 2, 4, 7, 9, 12].map((n, i) => ({ scene_number: n, time_of_day: 'night', covered: i !== 3 })),
                flags: ['The bell tower is always lit blue', words(25), 'Candles never go out'], references: Array.from({ length: 12 }, (_, i) => ({ src: wide, note: 'mood ' + i, sent: i < 2 })) }),
            empty: S.locationDoc({ project: 'Blade Eternal', location: { name: 'Corridor' }, slots: [{ src: '', label: '01 · Master' }, { src: '', label: '02 · Reverse' }, { src: '', label: '03 · Detail' }, { src: '', label: '04 · Exterior' }] }),
        },
        prop: {
            full: S.propDoc({ project: 'Blade Eternal', prop: { name: 'Alenna’s Sword', category: 'weapon', period: '18th century', practical: true, quantity: 3, height_m: 0.95, width_m: 0.12, length_m: 0.04, visual_prompt: words(140), description: words(50), notes: words(40), shots: ['01', '02', '04', '07', '11', '14', '15'], locations: [{ name: 'San Miguel Cemetery' }] },
                views: ['Front', 'Back', 'Left', 'Right', 'Top'].map((label, i) => ({ src: i === 4 ? '' : square, label, note: '0° · identity' })), extraViews: [{ src: wide, label: 'Detail · hilt' }],
                materials: [{ name: 'Blued steel', role: 'blade', hex: '#2b3440' }, { name: 'Wrapped leather', role: 'grip', hex: '#4a2f22' }, { name: 'Brass', role: 'guard', hex: '#b08d3c' }],
                states: [{ name: 'Clean', what: 'as forged' }, { name: 'Bloodied', scene: 'Sc. 4', what: words(20) }], constraints: ['Never curved', words(18)], keywords: ['blued steel', 'brass guard', 'leather grip', 'nicked edge'],
                references: Array.from({ length: 7 }, () => ({ src: wide, note: 'reference' })) }),
            empty: S.propDoc({ project: 'Blade Eternal', prop: { name: 'Key' }, views: ['Front', 'Back', 'Left', 'Right', 'Top'].map(label => ({ src: '', label })) }),
        },
    };
    return fixtures;
}

// PRINT_CHECK_OUT=<dir> also writes each PDF there, to look at.
const keep = (name, buf) => { if (process.env.PRINT_CHECK_OUT) fs.writeFileSync(path.join(process.env.PRINT_CHECK_OUT, name.replace(/[^\w.-]+/g, '_') + '.pdf'), buf); return buf; };
const pdfPages = buf => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

async function measure(win, html, kind) {
    const file = path.join(os.tmpdir(), `fe-print-check-${process.pid}.html`);
    fs.writeFileSync(file, html);
    await win.loadFile(file);
    await win.webContents.executeJavaScript('Promise.all(Array.from(document.images, i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))');
    // Measured as printed: Chromium applies print media while laying out for the PDF, so the checks use the print rules too.
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
    const problems = await win.webContents.executeJavaScript(`(() => {
        const out = [], over = (el, what) => { if (el.scrollWidth > el.clientWidth + 1) out.push(what + ' wider than its box: ' + el.scrollWidth + ' > ' + el.clientWidth);
            if (el.scrollHeight > el.clientHeight + 1) out.push(what + ' taller than its box: ' + el.scrollHeight + ' > ' + el.clientHeight); };
        const inside = (a, b, what) => { const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
            if (r.left < s.left - 1 || r.right > s.right + 1 || r.top < s.top - 1 || r.bottom > s.bottom + 1) out.push(what + ' outside its frame'); };
        if (${JSON.stringify(kind)} === 'storyboard') {
            document.querySelectorAll('.print-page').forEach((p, i) => over(p, 'page ' + (i + 1)));
            document.querySelectorAll('.board').forEach((b, i) => over(b, 'board ' + i));
            document.querySelectorAll('.value').forEach((v, i) => { if (v.scrollWidth > v.clientWidth + 1) out.push('note line ' + i + ' wider than its column: ' + v.textContent.slice(0, 40)); });
            document.querySelectorAll('.frame img').forEach((im, i) => inside(im, im.closest('.frame'), 'picture ' + i));
        } else {
            if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('page wider than the paper');
            document.querySelectorAll('.frame img').forEach((im, i) => inside(im, im.closest('.frame'), 'picture ' + i));
            document.querySelectorAll('.sheet *').forEach(el => { const s = getComputedStyle(el);
                if (s.display !== 'inline' && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && s.overflow === 'visible') out.push((el.tagName.toLowerCase() + '.' + el.className).replace(/\.$/, '') + ' wider than its box (' + el.scrollWidth + ' > ' + el.clientWidth + ')'); });
        }
        return out;
    })()`);
    win.webContents.debugger.detach();
    return problems;
}

app.whenReady().then(async () => {
    const report = { checked: 0, failures: [] };
    const fail = (what, why) => report.failures.push(`${what}: ${why}`);
    try {
        const win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { offscreen: true } });
        for (const paper of Object.keys(PAPERS)) for (const perPage of Object.keys(LAYOUTS).map(Number)) for (const aspect of ASPECTS) {
            const what = `storyboard ${paper} ${perPage}/page ${aspect.toFixed(2)}:1`;
            const plan = renderPlan({ id: 'p', title: 'Blade Eternal' }, storyboardShots(aspect), { paper, perPage });
            for (const p of await measure(win, plan.html, 'storyboard')) fail(what, p);
            const pdf = keep(what, await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true }));
            const want = Math.max(1, plan.pages.length), got = pdfPages(pdf);
            if (got !== want) fail(what, `PDF has ${got} pages, the plan has ${want}`);
            report.checked++;
        }
        const S = await sheetBuilders(), fixtures = sheetFixtures(S);
        for (const kind of S.SHEET_KINDS) for (const [variant, doc] of Object.entries(fixtures[kind] || {})) for (const [paper, pageSize] of Object.entries(SHEET_PAPERS)) {
            const what = `${kind} sheet (${variant}) ${paper}`;
            const html = S.sheetHtml({ ...doc, date: '2026-10-25' }).replace('size: portrait;', `size: ${pageSize} portrait;`);
            for (const p of await measure(win, html, 'sheet')) fail(what, p);
            const pages = pdfPages(keep(what, await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })));
            if (variant === 'empty' && pages !== 1) fail(what, `an empty sheet takes ${pages} pages`);
            if (variant === 'full' && (pages < 1 || pages > 3)) fail(what, `a full sheet takes ${pages} pages`);
            report.checked++;
        }
        for (const kind of S.SHEET_KINDS) if (!fixtures[kind]) fail(kind, 'no fixture for this sheet kind');
    } catch (err) { fail('run', err.stack || err.message); }
    process.stdout.write(JSON.stringify(report) + '\n');
    app.exit(report.failures.length ? 1 : 0);
});
