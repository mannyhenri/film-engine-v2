// Previz: the picture comes first. Everything stacked with the camera view in the stage column (the move dock or
// the open timeline, the storyboard footer) has a capped height, and the view grows into the rest with a floor
// of most of the stage. The user's screenshot: the timeline opened at a fixed 330px, the footer took 116px, and
// the view fell to 220px of a 700px stage (31%).
//
// Set-based: the stage's children are read from the engine's own markup (worldConsoleV2Html), each child's
// states from the functions that draw it (worldMoveDockHtml, previzWorkspace.footerHtml), and the rules from
// the desktop CSS the app runs (every stylesheet main.jsx imports, in order). A child added to the stage without
// a cap fails here by name.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ENGINE = read('src/pages/previs/engine.js');
const WORKSPACE = read('src/lib/previz-workspace.js');
// The cascade the app runs: every stylesheet main.jsx imports, in its order (later rules win, as in the browser).
const RUNTIME = [...read('src/main.jsx').matchAll(/^import '\.\/([^']+\.css)';/gm)].map(m => 'src/' + m[1]);
const SHEETS = { 'the app\'s stylesheets (main.jsx)': RUNTIME.map(read).join('\n') };

/** The body of a function in the engine, by name (balanced braces). */
function fnBody(src, name) {
    const at = src.search(new RegExp(`function ${name}\\s*\\(|\\b${name}\\s*\\(\\)\\s*\\{`));
    assert.ok(at >= 0, `${name} not found`);
    let i = src.indexOf('{', at), depth = 0;
    for (let j = i; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1); }
    return src.slice(i);
}

/** The stage column's direct children, each with the classes of the states it is drawn in. */
function stageChildren() {
    const html = fnBody(ENGINE, 'worldConsoleV2Html');
    const start = html.indexOf('<div class="pv-stage">');
    assert.ok(start >= 0, 'the stage column is not in worldConsoleV2Html');
    // Walk the template's tags from the stage's opening div; depth 1 = a direct child.
    const kids = [];
    let depth = 0;
    const re = /<(\/?)(div|aside)\b([^>]*)>|\$\{([A-Za-z.]+)\(\)\}/g;
    re.lastIndex = start;
    for (let m; (m = re.exec(html));) {
        if (m[4]) { if (depth === 1) kids.push({ call: m[4] }); continue; }
        if (m[1]) { if (--depth === 0) break; continue; }
        if (depth === 1) kids.push({ cls: (/class="([\w-]+)/.exec(m[3]) || [])[1] });
        depth++;
    }
    return kids.map(k => {
        if (k.cls === 'pv-move') {
            // Its content is worldMoveDockHtml: the dock, or the open timeline drawer.
            const states = [...fnBody(ENGINE, 'worldMoveDockHtml').matchAll(/return `<div class="([\w-]+)/g)].map(m => m[1]);
            return { name: k.cls, states };
        }
        if (k.call === 'previzWorkspace.footerHtml') {
            const root = /return `<div class="([\w-]+)/.exec(fnBody(WORKSPACE, 'footerHtml'));
            return { name: root[1], states: [root[1]] };
        }
        return { name: k.cls || k.call, states: [k.cls || k.call] };
    });
}

/** Desktop declarations for a class: rules outside any max-width query whose selector ends in it. */
function decls(css, cls, state) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = {};
    let i = 0;
    const walk = (text, desktop) => {
        const re = /([^{}]+)\{/g;
        let m;
        while ((m = re.exec(text))) {
            const sel = m[1].trim();
            let depth = 1, j = re.lastIndex;
            for (; j < text.length && depth; j++) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; }
            const body = text.slice(re.lastIndex, j - 1);
            re.lastIndex = j;
            if (sel.startsWith('@media')) { walk(body, desktop && !/max-width/.test(sel)); continue; }
            if (sel.startsWith('@')) continue;
            if (!desktop) continue;
            // A body/state class in front narrows the rule to a state the user chose (hide-right…): not the default.
            const hit = sel.split(',').map(s => s.trim()).some(s => !/^body\./.test(s) && (state
                ? new RegExp(`(^|[\\s>])\\.${state}\\s+(.*\\s)?\\.${cls}$`).test(s)
                : new RegExp(`(^|[\\s>])\\.${cls}$`).test(s) && !/\.pv-timeline-open\b/.test(s)));
            if (!hit) continue;
            for (const d of body.split(';')) { const k = d.split(':')[0].trim(); if (k) out[k] = d.slice(d.indexOf(':') + 1).trim(); }
        }
    };
    walk(css, true);
    void i;
    return out;
}

const px = (v) => (/^(\d+(\.\d+)?)px$/.exec(v || '') || [])[1];
const pct = (v) => (/^(\d+(\.\d+)?)%$/.exec(v || '') || [])[1];

test('the stage children are read from the markup (not blind)', () => {
    const kids = stageChildren();
    assert.deepStrictEqual(kids.map(k => k.name), ['pv-view', 'pv-move', 'pv-delivery']);
    assert.deepStrictEqual(kids.find(k => k.name === 'pv-move').states, ['pv-timeline-drawer', 'pv-movedock']);
});

for (const [sheet, css] of Object.entries(SHEETS)) {
    test(`${sheet}: the view grows and keeps most of the stage`, () => {
        const v = decls(css, 'pv-view');
        assert.match(v.flex || '', /^1\b/, 'the view does not grow into the stage');
        assert.ok(Number(pct(v['min-height'])) >= 55, `the view's floor is ${v['min-height'] || 'unset'}, not a share of the stage (>= 55%)`);
        // No state may lower it again (the open timeline set it back to 220px).
        const open = decls(css, 'pv-view', 'pv-timeline-open');
        assert.ok(!open['min-height'] || Number(pct(open['min-height'])) >= 55, `with the timeline open the view's floor is ${open['min-height']}`);
    });

    test(`${sheet}: every other child of the stage, in every state, is capped`, () => {
        const loose = [];
        for (const k of stageChildren().filter(k => k.name !== 'pv-view')) {
            for (const s of k.states) {
                // The drawer is capped where it sits: the stage's child (.pv-move) while the timeline is open, as a
                // share of the stage (a % on the drawer itself would resolve against an auto-height parent).
                const d = s === 'pv-timeline-drawer' ? { ...decls(css, s), ...decls(css, k.name, 'pv-timeline-open') } : decls(css, s);
                const cap = d['max-height'] || d.height;
                // A cap in px is a row of controls (<= 64px); a drawer may take a share of the stage (<= 30%).
                const ok = (px(cap) && Number(px(cap)) <= 64) || (pct(cap) && Number(pct(cap)) <= 30);
                if (!ok) loose.push(`${k.name} › ${s}: ${cap || 'no height cap'}`);
            }
        }
        assert.deepStrictEqual(loose, [], 'these take height from the view');
    });
}

test('the picture fills its view: the fit leaves at most 6px a side', () => {
    const fit = fnBody(ENGINE, 'worldFitFrame');
    const pads = [...fit.matchAll(/box\.(?:width|height)\s*-\s*(\d+)/g)].map(m => Number(m[1]));
    assert.ok(pads.length === 2, 'worldFitFrame no longer reads the view box');
    assert.ok(pads.every(p => p <= 12), `the frame is inset ${pads.join('/')}px inside the view`);
});
