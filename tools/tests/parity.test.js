// Parity between the source app (../film-engine/src/index.html) and this port.
// Every check iterates a set taken from the source, never a hand-picked example.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { readSource, loaderMap, topLevelFunctions } = require('../split-lib');

const ROOT = path.join(__dirname, '..', '..');
const plan = require('../port-plan.json');
const src = readSource(path.join(ROOT, plan.source));
const ported = plan.rounds.slice(0, plan.currentRound).flat();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const map = exists('docs/split-map.json') ? JSON.parse(read('docs/split-map.json')) : null;

const LOADERS = loaderMap(src.app);
const pageIds = [...new Set([...src.html.matchAll(/id="page-([a-z0-9]+)"/g)].map(m => m[1]))];

test('the source registry: 37 pages, each with a loader', () => {
    assert.strictEqual(pageIds.length, 37);
    assert.deepStrictEqual([...pageIds].sort(), Object.keys(LOADERS).sort());
    assert.deepStrictEqual([...ported, ...plan.rounds.slice(plan.currentRound).flat()].sort(), [...pageIds].sort());
});

test('every page has a markup component and a registry entry', () => {
    assert.ok(exists('src/pages/registry.js'), 'src/pages/registry.js missing');
    const registry = read('src/pages/registry.js');
    const missing = pageIds.filter(id => !exists(`src/pages/${id}/index.jsx`) || !exists(`src/pages/${id}/markup.html`) || !registry.includes(`'${id}'`));
    assert.deepStrictEqual(missing, []);
});

test('every ported page has its own script chunk holding exactly its mapped functions', () => {
    assert.ok(map, 'docs/split-map.json missing');
    const bad = [];
    for (const id of ported) {
        const file = `public/legacy/pages/${id}.js`;
        if (!exists(file)) { bad.push(`${id}: no chunk`); continue; }
        const have = topLevelFunctions(read(file)).map(f => f.name).sort();
        const want = [...(map.pages[id]?.functions || [])].sort();
        if (JSON.stringify(have) !== JSON.stringify(want)) bad.push(`${id}: chunk != map`);
    }
    assert.deepStrictEqual(bad, []);
});

test('no function is lost or duplicated: each source function lives exactly once in core or one chunk', () => {
    const where = new Map();
    const add = (file) => { for (const f of topLevelFunctions(read(file))) where.set(f.name, [...(where.get(f.name) || []), file]); };
    for (const f of ['public/legacy/core.js', 'public/legacy/production-graph.js', 'public/legacy/shell.js']) add(f);
    for (const id of ported) if (exists(`public/legacy/pages/${id}.js`)) add(`public/legacy/pages/${id}.js`);
    const all = [...topLevelFunctions(src.app), ...topLevelFunctions(src.productionGraph), ...topLevelFunctions(src.shell)].map(f => f.name);
    const problems = all.filter(n => (where.get(n) || []).length !== all.filter(m => m === n).length);
    assert.deepStrictEqual(problems, []);
});

test('every id a page chunk looks up with getElementById exists in the boot markup', () => {
    const comps = (d) => fs.readdirSync(path.join(ROOT, d), { recursive: true }).filter(f => f.endsWith('.html')).map(f => read(path.join(d, f)));
    const boot = [...pageIds.map(id => read(`src/pages/${id}/markup.html`)), ...comps('src/components')].join('\n');
    const bad = [];
    for (const id of ported) {
        const code = read(`public/legacy/pages/${id}.js`);
        for (const m of code.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) {
            // ids the source itself never had in its static markup are created at runtime there too
            if (!src.html.includes(`id="${m[1]}"`)) continue;
            if (!boot.includes(`id="${m[1]}"`)) bad.push(`${id}: #${m[1]}`);
        }
    }
    assert.deepStrictEqual(bad, []);
});

test('every name run by string (after:/reload:) is a function declaration, so it is on window', () => {
    const decls = new Set([...topLevelFunctions(src.app), ...topLevelFunctions(src.productionGraph), ...topLevelFunctions(src.shell)].map(f => f.name));
    const names = [...src.app.matchAll(/\b(?:after|reload)\s*:\s*'([A-Za-z_$][\w$]*)'/g)].map(m => m[1]);
    assert.ok(names.length > 0);
    assert.deepStrictEqual(names.filter(n => !decls.has(n)), []);
});

test('generated files are in sync with the source (npm run split leaves no diff)', () => {
    const { generate } = require('../split-map');
    const out = generate({ write: false });
    const stale = Object.entries(out).filter(([f, text]) => !exists(f) || read(f) !== text).map(([f]) => f);
    assert.deepStrictEqual(stale, []);
});

test('every chunk and the core parse as classic scripts', () => {
    const files = ['public/legacy/core.js', 'public/legacy/production-graph.js', 'public/legacy/shell.js', ...ported.map(id => `public/legacy/pages/${id}.js`)];
    for (const f of files) acorn.parse(read(f), { ecmaVersion: 'latest', sourceType: 'script' });
});
