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
const PAGES = path.join(ROOT, 'src/pages');
const MODULES = fs.readdirSync(PAGES)
    .filter(id => fs.existsSync(path.join(PAGES, id, 'react.json')))
    .flatMap(id => fs.readdirSync(path.join(PAGES, id))
        .filter(f => f.endsWith('.js') && !f.includes('.test.') && f !== 'reach.js' && f !== 'index.js')
        .map(f => `src/pages/${id}/${f}`));

// What the browser provides: the window of a real DOM, plus the language's own globals.
const BROWSER = (() => {
    const { window } = new JSDOM('');
    const names = new Set([...Object.getOwnPropertyNames(window), ...Object.getOwnPropertyNames(globalThis)]);
    // Present in the app's browser and missing from jsdom.
    for (const n of ['ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'structuredClone', 'crypto']) names.add(n);
    return names;
})();

function freeIdentifiers(code) {
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
    let globals = null;
    traverse(ast, { Program(p) { p.scope.crawl(); globals = Object.keys(p.scope.globals); } });
    return globals;
}

test('there are engine modules to check (this runs over something)', () => {
    assert.ok(MODULES.includes('src/pages/playback/player.js'), `found only: ${MODULES.join(', ')}`);
});

for (const file of MODULES) {
    test(`${file}: every core name it uses goes through its bridge`, () => {
        const free = freeIdentifiers(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        const unbridged = free.filter(n => !BROWSER.has(n));
        assert.deepStrictEqual(unbridged, [], `${file} uses these without declaring them; each is a core name that `
            + 'must be bridged (const X = (...a) => legacy.X(...a), and X in LEGACY_GLOBALS) so the split keeps it in core');
    });
}
