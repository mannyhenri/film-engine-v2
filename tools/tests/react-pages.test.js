// Every page rewritten as React (src/pages/<id>/react.json) is held to the same rules, so a page
// converted halfway fails here. Set-based over the react.json files that exist.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const PAGES_DIR = 'src/pages';
const REACT = Object.fromEntries(fs.readdirSync(path.join(ROOT, PAGES_DIR))
    .filter(id => exists(`${PAGES_DIR}/${id}/react.json`))
    .map(id => [id, JSON.parse(read(`${PAGES_DIR}/${id}/react.json`))]));
const jsxOf = (id) => fs.readdirSync(path.join(ROOT, PAGES_DIR, id)).filter(f => f.endsWith('.jsx') && !f.includes('.test.')).map(f => read(`${PAGES_DIR}/${id}/${f}`)).join('\n');
const LEGACY_FILES = ['public/legacy/core.js', 'public/legacy/production-graph.js', 'public/legacy/shell.js',
    ...fs.readdirSync(path.join(ROOT, 'public/legacy/chunks')).map(f => `public/legacy/chunks/${f}`)];
const identifiers = (code) => new Set(code.match(/[A-Za-z_$][\w$]*/g) || []);
const legacyGlobals = (() => {
    const m = /LEGACY_GLOBALS\s*=\s*\[([\s\S]*?)\];/.exec(read('src/lib/legacy.js'));
    return [...m[1].matchAll(/'([\w$]+)'/g)].map(x => x[1]);
})();

test('there is at least one React page (the scan found its react.json files)', () => {
    assert.ok(Object.keys(REACT).length >= 1, 'no src/pages/*/react.json found: the scan is broken');
});

test('every React page is mounted as React, not as generated legacy markup', () => {
    const registry = read(`${PAGES_DIR}/registry.js`);
    const map = JSON.parse(read('docs/split-map.json'));
    const bad = [];
    for (const id of Object.keys(REACT)) {
        const index = read(`${PAGES_DIR}/${id}/index.jsx`);
        if (/GENERATED|LegacyElement|markup\.html/.test(index)) bad.push(`${id}: index.jsx is still the generated legacy wrapper`);
        if (exists(`${PAGES_DIR}/${id}/markup.html`)) bad.push(`${id}: a stale markup.html is left behind`);
        if (!new RegExp(`id: '${id}', Component: \\w+, chunk: null`).test(registry)) bad.push(`${id}: the registry still loads a chunk for it`);
        if (!map.react || !map.react[id]) bad.push(`${id}: the split map does not list it (run npm run split)`);
        if (!jsxOf(id).includes(`id="page-${id}"`)) bad.push(`${id}: its root is not id="page-${id}", so navigateTo cannot show it`);
    }
    assert.deepStrictEqual(bad, []);
});

test('every React page registers the loader navigateTo calls, and renders every modal it took over', () => {
    const bad = [];
    for (const [id, r] of Object.entries(REACT)) {
        const jsx = jsxOf(id);
        for (const fn of [r.loader, ...(r.provides || [])]) {
            if (!new RegExp(`usePageLoader\\(\\s*'${fn}'`).test(jsx)) bad.push(`${id}: never registers ${fn}`);
            if (!r.replaces.includes(fn)) bad.push(`${id}: registers ${fn} but react.json does not list it in replaces`);
        }
        for (const m of r.modals) if (!new RegExp(`<Modal\\s+id="${m}"`).test(jsx)) bad.push(`${id}: does not render modal ${m}`);
    }
    assert.deepStrictEqual(bad, []);
});

test('nothing in the legacy code still defines or calls what a React page replaced', () => {
    const bad = [];
    const files = [...LEGACY_FILES, ...fs.readdirSync(path.join(ROOT, 'src/components'), { recursive: true }).filter(f => f.endsWith('.html')).map(f => `src/components/${f}`),
        ...fs.readdirSync(path.join(ROOT, PAGES_DIR)).filter(id => exists(`${PAGES_DIR}/${id}/markup.html`)).map(id => `${PAGES_DIR}/${id}/markup.html`)];
    for (const f of files) {
        // navigateTo's loaders map names every page's loader; that entry is the call React answers.
        const text = read(f).replace(/const loaders = \{[\s\S]*?\n\s*\};/, '').replace(/var [\w$, ]+;/g, '');
        const ids = identifiers(text);
        // A loader may be CALLED (the React page registers it on window before core runs); never defined.
        for (const [id, r] of Object.entries(REACT)) for (const n of r.replaces) {
            if (n === r.loader || (r.provides || []).includes(n) ? new RegExp(`function\\s+${n}\\s*\\(`).test(text) : ids.has(n)) bad.push(`${f} still uses ${n} (${id})`);
        }
        for (const [id, r] of Object.entries(REACT)) for (const m of r.modals) if (text.includes(`id="${m}"`)) bad.push(`${f} still has modal ${m} (${id})`);
    }
    assert.deepStrictEqual(bad, []);
});

test('React reaches the legacy app only through LEGACY_GLOBALS, and each of those is on window', () => {
    const bad = [];
    // Code only: import paths ('…/legacy.js') and comments are not uses; legacy.js defines the door itself.
    const codeOnly = (t) => t.replace(/^\s*import[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    const files = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }).filter(f => /\.(jsx?|mjs)$/.test(f) && !f.includes('.test.') && f !== path.join('lib', 'legacy.js'));
    let used = 0;
    for (const f of files) {
        for (const m of codeOnly(read(`src/${f}`)).matchAll(/\blegacy\.([\w$]+)/g)) {
            used++;
            if (!legacyGlobals.includes(m[1])) bad.push(`src/${f}: legacy.${m[1]} is not in LEGACY_GLOBALS`);
        }
    }
    assert.ok(used > 0, 'found no legacy.<name> uses at all: the scan is broken');
    const core = LEGACY_FILES.slice(0, 3).map(read).join('\n');
    for (const n of legacyGlobals) {
        const onWindow = new RegExp(`^\\s{0,4}(async\\s+)?function\\s+${n}\\s*\\(|window\\.${n}\\s*=|^\\s{0,4}(let|const|var)\\s+${n}\\b`, 'm').test(core);
        if (!onWindow) bad.push(`${n}: not a top-level function or window.${n} in core, so React cannot reach it`);
    }
    assert.deepStrictEqual(bad, []);
});

test('every page loader the legacy code calls exists: declared in legacy code, or registered by a React page', () => {
    // The backend's page-handlers check of the same name reads the assembled page, where a React
    // page's loader is only a placeholder `var`; it is skipped there (SKIPPED-SUBTESTS.json) and
    // held here, where both halves of the app are visible.
    const code = LEGACY_FILES.map(read).join('\n');
    const declared = new Set([...code.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|(?:let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1] || m[2]));
    const reactLoaders = new Set(Object.values(REACT).flatMap(r => [r.loader, ...(r.provides || [])]));
    const calls = [...code.matchAll(/(?:^|[^\w.$])(load[A-Z][\w$]*)\s*\(/gm)].map(m => m[1]);
    assert.ok(calls.length > 20, 'the scan found almost no loader calls: it is not reading the legacy code');
    const missing = [...new Set(calls)].filter(n => !declared.has(n) && !reactLoaders.has(n));
    assert.deepStrictEqual(missing, [], 'called and defined nowhere — a removed page is not removed until its callers go with it');
    // And a React loader core calls must really be registered by its page (else the call throws).
    for (const [id, r] of Object.entries(REACT)) {
        for (const fn of [r.loader, ...(r.provides || [])]) {
            if (calls.includes(fn)) assert.ok(new RegExp(`usePageLoader\\(\\s*'${fn}'`).test(jsxOf(id)), `${fn} is called by core and ${id} never registers it`);
        }
    }
});
