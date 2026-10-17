// Features the user took out of Film Engine (tools/split-lib.js RETIRED): cut from the reference as it is read, so no
// build, split or test page can bring them back. Set-based over the list: every retired page, name and modal is gone
// from what is generated and from React, and nothing that stays calls or opens one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { RETIRED, readSource } = require('../split-lib');
const { blankComments } = require('../core-ownership');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FEATURES = Object.entries(RETIRED || {});
const PAGES = FEATURES.flatMap(([, f]) => f.pages);
const NAMES = FEATURES.flatMap(([, f]) => f.names);
const MODALS = FEATURES.flatMap(([, f]) => f.modals);
const word = (n) => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`);
const SRC = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
    .filter(f => /\.(jsx?|mjs|html|json)$/.test(f) && !f.includes('.test.') && f !== 'index.html')
    .map(f => [`src/${f}`, f.endsWith('.json') ? read(`src/${f}`) : f.endsWith('.html') ? read(`src/${f}`).replace(/<!--[\s\S]*?-->/g, '') : blankComments(read(`src/${f}`), 'module')]);
const LEGACY = ['public/legacy/core.js', 'public/legacy/shell.js', 'public/legacy/production-graph.js',
    ...(fs.existsSync(path.join(ROOT, 'public/legacy/chunks')) ? fs.readdirSync(path.join(ROOT, 'public/legacy/chunks')).map(f => `public/legacy/chunks/${f}`) : [])]
    .map(f => [f, blankComments(read(f))]);

test('the retired list is read (this runs over something), and each feature says why', () => {
    assert.ok(FEATURES.length > 0 && PAGES.length > 0 && NAMES.length > 50, 'nothing retired');
    for (const [id, f] of FEATURES) assert.ok(typeof f.why === 'string' && f.why.length > 40, `${id}: no reason given`);
});

test('every retired name was a declaration of the original, and is not one any more as the reference is read', () => {
    const raw = fs.readFileSync(path.join(ROOT, 'reference/fb8c770/src/index.html'), 'utf8');
    const app = readSource(path.join(ROOT, 'reference/fb8c770/src/index.html')).app;
    const declared = (code, n) => new RegExp(`(?:function\\s+|(?:const|let|var)\\s+)${n.replace(/\$/g, '\\$')}\\b`).test(code);
    const bad = [];
    for (const n of NAMES) {
        if (!declared(raw, n)) bad.push(`${n}: not declared in the original, so retiring it says nothing`);
        if (declared(app, n)) bad.push(`${n}: still declared as the reference is read`);
    }
    assert.deepStrictEqual(bad, []);
});

test('every retired page is gone: no markup, no React page, no sidebar button, no route or registry entry', () => {
    const bad = [];
    for (const p of PAGES) {
        if (fs.existsSync(path.join(ROOT, 'src/pages', p))) bad.push(`src/pages/${p}: still there`);
        for (const [f, t] of [...SRC, ...LEGACY]) if (new RegExp(`(['"\`])${p}\\1|page-${p}\\b|data-page="${p}"|(?<![\\w$.])${p}\\s*:`).test(t)) bad.push(`${p}: still named in ${f}`);
    }
    for (const f of ['electron/smoke-pages.cjs', 'docs/split-map.json']) for (const p of PAGES) if (read(f).includes(`"${p}"`)) bad.push(`${p}: still in ${f}`);
    assert.deepStrictEqual(bad, []);
});

test('no retired name or modal is declared, called or opened by anything that stays (legacy code or React)', () => {
    const bad = [];
    for (const n of [...NAMES, ...MODALS]) for (const [f, t] of [...SRC, ...LEGACY]) if (word(n).test(t)) bad.push(`${n}: still named in ${f}`);
    for (const m of MODALS) if (fs.existsSync(path.join(ROOT, 'src/components/modals', m + '.html'))) bad.push(`${m}: its markup is still generated`);
    assert.deepStrictEqual(bad, []);
});

test('the split is up to date with the retirement (a build regenerates nothing retired)', () => {
    const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'tools/split-map.js'), '--check'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});
