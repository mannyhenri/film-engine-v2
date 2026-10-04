// Every page rewritten as React (src/pages/<id>/react.json), and every React component that took code
// over from core (src/components/<Name>/react.json: no loader, mounted once at boot), is held to the
// same rules, so one converted halfway fails here. Set-based over the react.json files that exist.
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
const COMPONENTS_DIR = 'src/components';
const COMPONENTS = Object.fromEntries(fs.readdirSync(path.join(ROOT, COMPONENTS_DIR))
    .filter(n => exists(`${COMPONENTS_DIR}/${n}/react.json`))
    .map(n => [n, JSON.parse(read(`${COMPONENTS_DIR}/${n}/react.json`))]));
// A component's own markup (a verbatim frame.html) is its source too: the modal it renders may be written there.
const sourceOf = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter(f => /\.(jsx?|html)$/.test(f) && !f.includes('.test.') && f !== 'reach.js').map(f => read(`${dir}/${f}`)).join('\n');
const jsxOf = (id) => sourceOf(`${PAGES_DIR}/${id}`);
/** Every owner of legacy code, pages and components alike: what it registers on window, replaces and renders. */
const OWNERS = [
    ...Object.entries(REACT).map(([id, r]) => ({ owner: `page ${id}`, src: () => jsxOf(id), registers: [r.loader, ...(r.provides || [])], ...r })),
    ...Object.entries(COMPONENTS).map(([n, r]) => ({ owner: `component ${n}`, src: () => sourceOf(`${COMPONENTS_DIR}/${n}`), registers: r.provides || [], ...r })),
];
const registersOn = (src, fn) => new RegExp(`usePageLoader\\(\\s*'${fn}'`).test(src);
const LEGACY_FILES = ['public/legacy/core.js', 'public/legacy/production-graph.js', 'public/legacy/shell.js',
    ...fs.readdirSync(path.join(ROOT, 'public/legacy/chunks')).map(f => `public/legacy/chunks/${f}`)];
const identifiers = (code) => new Set(code.match(/[A-Za-z_$][\w$]*/g) || []);
/** A script with its comments blanked, by the parser's own comment ranges (a regex would read `/*` in a string as one). */
const blankComments = (code) => {
    const ranges = [];
    require('acorn').parse(code, { ecmaVersion: 'latest', onComment: (block, text, start, end) => ranges.push([start, end]) });
    let out = code;
    for (const [a, b] of ranges.reverse()) out = out.slice(0, a) + out.slice(a, b).replace(/[^\n]/g, ' ') + out.slice(b);
    return out;
};
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
        // Comments blanked in legacy JS, as the split does: a comment naming a function is not a call to it.
        // HTML comments too, wherever they are (markup files, and markup inside a template string): prose, never a use.
        const text = (f.endsWith('.js') ? blankComments(read(f)) : read(f)).replace(/<!--[\s\S]*?-->/g, '')
            .replace(/const loaders = \{[\s\S]*?\n\s*\};/, '').replace(/var [\w$, ]+;/g, '');
        const ids = identifiers(text);
        // A loader may be CALLED (the React page registers it on window before core runs); never defined.
        for (const o of OWNERS) for (const n of o.replaces) {
            if (o.registers.includes(n) ? new RegExp(`function\\s+${n}\\s*\\(`).test(text) : ids.has(n)) bad.push(`${f} still uses ${n} (${o.owner})`);
        }
        for (const o of OWNERS) for (const m of o.modals) if (text.includes(`id="${m}"`)) bad.push(`${f} still has modal ${m} (${o.owner})`);
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
        // Or a React page or component registers it on window (its loader, what it provides): legacy.X reads window.
        const registered = OWNERS.some(o => o.registers.includes(n));
        if (!onWindow && !registered) bad.push(`${n}: not a top-level function or window.${n} in core, nor registered by a React page or component, so React cannot reach it`);
    }
    assert.deepStrictEqual(bad, []);
});

test('every page loader the legacy code calls exists: declared in legacy code, or registered by a React page', () => {
    // The backend's page-handlers check of the same name reads the assembled page, where a React
    // page's loader is only a placeholder `var`; it is skipped there (SKIPPED-SUBTESTS.json) and
    // held here, where both halves of the app are visible.
    const code = LEGACY_FILES.map(read).join('\n');
    const declared = new Set([...code.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|(?:let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1] || m[2]));
    const reactLoaders = new Set(OWNERS.flatMap(o => o.registers));
    const calls = [...code.matchAll(/(?:^|[^\w.$])(load[A-Z][\w$]*)\s*\(/gm)].map(m => m[1]);
    assert.ok(calls.length > 20, 'the scan found almost no loader calls: it is not reading the legacy code');
    const missing = [...new Set(calls)].filter(n => !declared.has(n) && !reactLoaders.has(n));
    assert.deepStrictEqual(missing, [], 'called and defined nowhere — a removed page is not removed until its callers go with it');
    // And a React loader core calls must really be registered by its page (else the call throws).
    for (const o of OWNERS) for (const fn of o.registers) {
        if (calls.includes(fn)) assert.ok(registersOn(o.src(), fn), `${fn} is called by core and ${o.owner} never registers it`);
    }
});

/* ── React components that took code over from core ─────────────────────────────────────────── */

test('there is at least one React component with a react.json (the scan found it)', () => {
    assert.ok(Object.keys(COMPONENTS).length >= 1, `no ${COMPONENTS_DIR}/*/react.json found: the scan is broken`);
});

test('every React component: no loader, mounted by App through the generated list, registers what it provides, renders its modals', () => {
    const list = read(`${COMPONENTS_DIR}/react-components.js`);
    const map = JSON.parse(read('docs/split-map.json'));
    const bad = [];
    for (const [n, r] of Object.entries(COMPONENTS)) {
        const src = sourceOf(`${COMPONENTS_DIR}/${n}`);
        if ('loader' in r) bad.push(`${n}: a component has no loader (navigateTo never shows it); only provides`);
        for (const k of ['provides', 'replaces', 'modals']) if (!Array.isArray(r[k])) bad.push(`${n}: react.json has no "${k}" list`);
        if (!new RegExp(`from './${n}/${n}\\.jsx'`).test(list)) bad.push(`${n}: not in ${COMPONENTS_DIR}/react-components.js (run npm run split)`);
        if (!map.reactComponents || !map.reactComponents[n]) bad.push(`${n}: the split map does not list it (run npm run split)`);
        for (const fn of r.provides || []) {
            if (!registersOn(src, fn)) bad.push(`${n}: never registers ${fn}`);
            if (!r.replaces.includes(fn)) bad.push(`${n}: provides ${fn} but react.json does not list it in replaces`);
        }
        // Through the shared <Modal>, or as its own overlay (a sheet with its own header): an element with the id and modal-overlay.
        for (const m of r.modals || []) if (!new RegExp(`<Modal\\s+id="${m}"|className="modal-overlay[^"]*"\\s+id="${m}"|class="modal-overlay[^"]*"\\s+id="${m}"`).test(src)) bad.push(`${n}: does not render modal ${m}`);
    }
    assert.match(read('src/App.jsx'), /REACT_COMPONENTS\.map/, 'App does not mount the React components');
    assert.deepStrictEqual(bad, []);
});

test('no name and no modal has two owners, across pages and components', () => {
    const seen = new Map();
    const bad = [];
    for (const o of OWNERS) {
        for (const [kind, list] of [['replaces', o.replaces], ['registers', o.registers], ['modal', o.modals]]) {
            for (const n of new Set(list)) {
                const key = `${kind === 'modal' ? 'modal' : 'name'}:${n}`;
                if (kind === 'registers' && o.replaces.includes(n)) continue; // the same name, already counted under replaces
                if (seen.has(key) && seen.get(key) !== o.owner) bad.push(`${n}: owned by ${seen.get(key)} and ${o.owner}`);
                seen.set(key, o.owner);
            }
        }
    }
    assert.ok(seen.size > 20, 'the scan found almost no owned names');
    assert.deepStrictEqual(bad, []);
});

/*
 * BOOT ORDER. A name React registers (a loader, or something provided) exists once the page or component
 * has MOUNTED. Core may call one while it loads only because of three facts, each held here: the module
 * script that mounts App comes before the legacy scripts; main.jsx renders App synchronously (flushSync);
 * and registration is a LAYOUT effect, done by the end of that synchronous render. And each such call is
 * named below, so a new one is a decision, not an accident.
 */
const { LOAD_TIME_CALLS } = require('../split-lib'); // one list, read by the split too

test('boot order: App is mounted, synchronously, with every registration in place, before any legacy script runs', () => {
    const boot = read('index.html');
    const mod = boot.indexOf('src="/src/main.jsx"');
    const firstLegacy = boot.search(/src="\.\/legacy\//);
    assert.ok(mod > -1 && firstLegacy > -1 && mod < firstLegacy, 'main.jsx no longer comes before the legacy scripts');
    assert.match(read('src/main.jsx'), /flushSync\(\(\) => root\.render\(<App \/>\)\)/, 'App is no longer rendered synchronously');
    assert.match(read('src/lib/usePageLoader.js'), /useLayoutEffect\(\(\) => \{[\s\S]*?window\[loaderName\] = fn;/, 'registration is no longer a layout effect');
});

test('every load-time call of a React-registered name is named, and its owner registers it at mount', () => {
    const { loadTimeCalls } = require('../split-lib');
    const owned = new Map(OWNERS.flatMap(o => o.registers.map(n => [n, o])));
    const bad = [];
    for (const f of LEGACY_FILES) {
        for (const c of loadTimeCalls(read(f), new Set(owned.keys()))) {
            if (!LOAD_TIME_CALLS[c.name]) bad.push(`${f}: ${c.name}() runs at load; React registers it at mount. Move the call into a function, or name it in LOAD_TIME_CALLS with why it is safe`);
            else if (!registersOn(owned.get(c.name).src(), c.name)) bad.push(`${c.name}: called at load and ${owned.get(c.name).owner} does not register it with usePageLoader`);
        }
    }
    for (const n of Object.keys(LOAD_TIME_CALLS)) if (!owned.has(n)) bad.push(`LOAD_TIME_CALLS names ${n}, which no React page or component registers: remove it`);
    assert.deepStrictEqual(bad, []);
});

test('loadTimeCalls finds what runs at load and nothing that runs later', () => {
    const { loadTimeCalls } = require('../split-lib');
    const code = 'a(); window.b(); function f() { a(); } const g = () => a(); (function () { c(); })(); x.on("e", () => a()); const v = d();';
    assert.deepStrictEqual(loadTimeCalls(code, ['a', 'b', 'c', 'd']).map(x => x.name), ['a', 'b', 'c', 'd']);
});

test('cutScript drops what React replaced from a whole script, with its lead comment, and keeps the rest byte for byte', () => {
    const { cutScript } = require('../split-lib');
    const code = '// a\nfunction a() {}\n/* b: replaced */\nfunction b() { a(); }\nwindow.b = b;\nlet B_STATE = { x: 1 };\nconst keep = 2;\n';
    const r = cutScript(code, new Set(['b', 'B_STATE']));
    assert.strictEqual(r.code, '// a\nfunction a() {}\nconst keep = 2;\n');
    assert.deepStrictEqual([...r.declared].sort(), ['B_STATE', 'a', 'b', 'keep']);
});
