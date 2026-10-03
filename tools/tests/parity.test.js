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

const chunkFiles = () => map ? Object.keys(map.chunks).map(c => `public/legacy/chunks/${c}.js`) : [];
const CORE_FILES = ['public/legacy/core.js', 'public/legacy/production-graph.js', 'public/legacy/shell.js'];

test('every ported page loads a chunk, and each chunk holds exactly its mapped functions', () => {
    assert.ok(map, 'docs/split-map.json missing');
    const registry = read('src/pages/registry.js');
    const bad = [];
    for (const id of ported) {
        const c = map.pages[id]?.chunk;
        if (!c || !map.chunks[c]?.pages.includes(id)) { bad.push(`${id}: no chunk in the map`); continue; }
        if (!registry.includes(`id: '${id}', Component: ${id[0].toUpperCase() + id.slice(1)}Page, chunk: '${c}'`)) bad.push(`${id}: registry does not load ${c}`);
    }
    for (const [c, m] of Object.entries(map.chunks)) {
        const file = `public/legacy/chunks/${c}.js`;
        if (!exists(file)) { bad.push(`${c}: no file`); continue; }
        const have = topLevelFunctions(read(file)).map(f => f.name).sort();
        if (JSON.stringify(have) !== JSON.stringify([...m.functions].sort())) bad.push(`${c}: file != map`);
    }
    assert.deepStrictEqual(bad, []);
});

test('no code is lost or duplicated: every top-level statement of the source is in core or one chunk, once', () => {
    const norm = (code) => acorn.parse(code, { ecmaVersion: 'latest' }).body.map(n => code.slice(n.start, n.end));
    const app = norm(src.app);
    // The port adds exactly one statement: core's var placeholders for loaders that live in chunks.
    const placeholder = `var ${map.core.loaderPlaceholders.join(', ')};`;
    const port = [...norm(read('public/legacy/core.js')), ...chunkFiles().flatMap(f => norm(read(f)))].filter(t => t !== placeholder);
    assert.strictEqual(port.length, app.length, 'statement count');
    // navigateTo is the one statement the port rewrites; everything else is byte-identical.
    const portSet = new Map();
    for (const t of port) portSet.set(t, (portSet.get(t) || 0) + 1);
    const missing = app.filter(t => !t.startsWith('function navigateTo(') && !portSet.get(t));
    assert.deepStrictEqual(missing.map(t => t.slice(0, 60)), []);
    for (const f of ['productionGraph', 'shell']) assert.ok(read(CORE_FILES[f === 'shell' ? 2 : 1]).includes(src[f]));
});

test('every function lives exactly once in core or one chunk', () => {
    const where = new Map();
    for (const f of [...CORE_FILES, ...chunkFiles()]) for (const fn of topLevelFunctions(read(f))) where.set(fn.name, (where.get(fn.name) || 0) + 1);
    const all = [...topLevelFunctions(src.app), ...topLevelFunctions(src.productionGraph), ...topLevelFunctions(src.shell)].map(f => f.name);
    const count = (n) => all.filter(m => m === n).length;
    assert.deepStrictEqual([...new Set(all)].filter(n => where.get(n) !== count(n)), []);
});

test('three.js is loaded before any code that uses it', () => {
    const uses = (f) => /\bTHREE\b/.test(read(f).replace(/typeof\s+(window\.)?THREE/g, ''));
    const boot = read('index.html');
    const atBoot = boot.includes('legacy/vendor/three.min.js');
    const bad = [];
    if (!atBoot) for (const f of CORE_FILES) if (uses(f)) bad.push(f);
    for (const [c, m] of Object.entries(map.chunks)) if (!atBoot && uses(`public/legacy/chunks/${c}.js`) && !m.deps.includes('three')) bad.push(c);
    assert.deepStrictEqual(bad, []);
});

test('every id a chunk looks up with getElementById exists in the boot markup', () => {
    const comps = (d) => fs.readdirSync(path.join(ROOT, d), { recursive: true }).filter(f => f.endsWith('.html')).map(f => read(path.join(d, f)));
    const boot = [...pageIds.map(id => read(`src/pages/${id}/markup.html`)), ...comps('src/components')].join('\n');
    const bad = [];
    for (const f of chunkFiles()) {
        for (const m of read(f).matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) {
            // ids the source never had in its static markup are created at runtime there too
            if (!src.html.includes(`id="${m[1]}"`)) continue;
            if (!boot.includes(`id="${m[1]}"`)) bad.push(`${f}: #${m[1]}`);
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
    const files = [...CORE_FILES, ...chunkFiles()];
    for (const f of files) acorn.parse(read(f), { ecmaVersion: 'latest', sourceType: 'script' });
});
