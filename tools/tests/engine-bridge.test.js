// A React page's own .js module that took legacy code over verbatim (Playback's player.js, the Production
// graph's engine.js) reaches the core only through its bridge prelude: `const api = (...a) => legacy.api(...a)`.
//
// The trap this closes: in an ES module a name that is not declared falls through to the GLOBAL scope at run
// time, so a core name the bridge forgot still works on the day it ships. It works by accident. The split keeps
// in core only what LEGACY_GLOBALS names (src/lib/legacy.js), so the day that function moves into a page
// chunk, the engine throws a ReferenceError on a page that never loaded it, and no test that renders the page
// on its own would see it. So every free identifier of such a module must be declared in it (the bridge, an
// import, its own code) or be a name the browser itself provides. Set-based over every such module that exists.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
// Pages and React components (src/components/<Name>/react.json) alike: an engine is an engine wherever it lives.
const ownModules = (dir) => fs.readdirSync(path.join(ROOT, dir))
    .filter(id => fs.existsSync(path.join(ROOT, dir, id, 'react.json')))
    .flatMap(id => fs.readdirSync(path.join(ROOT, dir, id))
        // A *.markup.js module holds markup as a string (a verbatim modal frame), not code.
        .filter(f => f.endsWith('.js') && !f.includes('.test.') && f !== 'reach.js' && f !== 'index.js' && !f.endsWith('.markup.js'))
        .map(f => `${dir}/${id}/${f}`));
const MODULES = [...ownModules('src/pages'), ...ownModules('src/components')];

// What the browser provides: the window of a real DOM, plus the language's own globals.
const BROWSER = (() => {
    const { window } = new JSDOM('');
    const names = new Set([...Object.getOwnPropertyNames(window), ...Object.getOwnPropertyNames(globalThis)]);
    // Present in the app's browser and missing from jsdom.
    for (const n of ['ResizeObserver', 'IntersectionObserver', 'CSS', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'structuredClone', 'crypto', 'EventSource']) names.add(n);
    return names;
})();

function freeIdentifiers(code) {
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
    let globals = null;
    traverse(ast, { Program(p) { p.scope.crawl(); globals = Object.keys(p.scope.globals); } });
    return globals;
}

test('there are engine modules to check (this runs over something)', () => {
    assert.ok(MODULES.includes('src/pages/productiongraph/engine.js'), `found only: ${MODULES.join(', ')}`);
});

for (const file of MODULES) {
    test(`${file}: every core name it uses goes through its bridge`, () => {
        const free = freeIdentifiers(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        // A vendored library's global (THREE) is set by its own script, loaded before the page's loader
        // (react.json "vendors", tools/tests/page-vendors.test.js): not a core name, and not bridged.
        const vendorGlobals = new Set(Function(`return ${fs.readFileSync(path.join(ROOT, 'tools/split-map.js'), 'utf8').match(/const VENDORS = (\[[^\n]*\]);/)[1]}`)().map(v => v.global));
        // A name nothing defines, used only behind `typeof X` (the reference probes for an optional global, e.g.
        // `typeof FountainParser !== 'undefined'`): safe in a module too, where typeof of an undeclared name is 'undefined'.
        const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const probedOnly = (n) => new RegExp(`typeof\\s+${n}\\b`).test(code) && !fs.readFileSync(path.join(ROOT, 'public/legacy/core.js'), 'utf8').match(new RegExp(`\\b(function|const|let|var|class)\\s+${n}\\b`));
        const unbridged = free.filter(n => !BROWSER.has(n) && !vendorGlobals.has(n) && !probedOnly(n));
        assert.deepStrictEqual(unbridged, [], `${file} uses these without declaring them; each is a core name that `
            + 'must be bridged (const X = (...a) => legacy.X(...a), and X in LEGACY_GLOBALS) so the split keeps it in core');
    });
}

/*
 * The bridge is declared in destructuring statements (`const { api, esc } = Object.fromEntries([...])`), so no line
 * of an engine reads like the definition of a core name: backend tests find a definition by searching the page for
 * `const feStore` or `function api(`, and the first match must be core's. So:
 *   - every name the bridge declares is on LEGACY_GLOBALS (legacy[n] throws otherwise, and only when called);
 *   - the only plain top-level declarations an engine has are its moved ones (exported) and the `live` helper.
 */
const acorn = require('acorn');
let BRIDGED_TOTAL = 0;
const NEW_INTERNALS = {
    'src/pages/screenplay/engine.js': ['screenplayCardsResponse', 'screenplayCardsRequest', 'editingReviewCard', 'paintReviewCards', 'reviewCardsPrintHTML'],
};
const LEGACY_GLOBALS = (() => {
    const src = fs.readFileSync(path.join(ROOT, 'src/lib/legacy.js'), 'utf8');
    const list = src.slice(src.indexOf('export const LEGACY_GLOBALS = ['), src.indexOf('];', src.indexOf('export const LEGACY_GLOBALS = [')));
    return new Set([...list.replace(/\/\/[^\n]*/g, '').matchAll(/'([\w$]+)'/g)].map(m => m[1]));
})();
for (const file of MODULES) {
    test(`${file}: its bridge is on LEGACY_GLOBALS, and nothing but its moved code reads like a definition`, () => {
        const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
        const exported = new Set(ast.body.filter(n => n.type === 'ExportNamedDeclaration' && !n.declaration).flatMap(n => n.specifiers.map(s => s.local.name)));
        const bridged = [], plain = [];
        for (const n of ast.body) {
            if (n.type === 'FunctionDeclaration' && !exported.has(n.id.name)) plain.push(n.id.name);
            if (n.type !== 'VariableDeclaration') continue;
            for (const d of n.declarations) {
                if (d.id.type === 'ObjectPattern') bridged.push(...d.id.properties.map(p => p.value.name));
                else if (d.id.type === 'Identifier' && !exported.has(d.id.name) && d.id.name !== 'live') plain.push(d.id.name);
            }
        }
        // An engine may need no bridge at all (the Edits engine is one constant); the scan is proven across modules below.
        BRIDGED_TOTAL += bridged.length;
        assert.deepStrictEqual(bridged.filter(n => !LEGACY_GLOBALS.has(n)), [], 'bridged, and not on LEGACY_GLOBALS');
        const additions = NEW_INTERNALS[file] || [];
        assert.deepStrictEqual(plain.filter(n => !additions.includes(n)), [], 'top-level declarations that are neither moved code nor explicitly owned additions');
        assert.deepStrictEqual(additions.filter(n => !plain.includes(n)), [], 'declared private additions must exist and stay private');
    });
}

test('some engine declares a bridge (the bridge scan reads something)', () => {
    assert.ok(BRIDGED_TOTAL > 0, 'no engine declares any bridged name: the scan is broken');
});
