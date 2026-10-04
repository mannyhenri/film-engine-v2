// Load-time core (d), split in two, because only one half must stay in a classic script:
//   RUNS       — executed while the scripts load: top-level statements and initialisers, IIFE bodies, and every
//                function they CALL synchronously (callbacks of forEach/map/…, a Promise executor), transitively;
//   REACHABLE  — reached from load-time code only through something that runs LATER: a listener, a timer, a promise
//                callback, a table of functions (the router's targets), a name in drawn HTML.
// The analyser is pure (code in, sets out), so its rules are held on fixtures; the real core is then held as a set.
const test = require('node:test');
const assert = require('node:assert');
const { analyse } = require('../load-time');

const FIXTURE = `
function init() { const page = PAGES.home; helper(); [1].forEach(x => eachRuns(x)); new Promise(r => execRuns(r)); }
function helper() { deeper(); }
function deeper() {}
function eachRuns() {}
function execRuns() {}
function onClick() { fromListener(LATER_DATA); }
const LATER_DATA = { a: 1 };
const CALLED = compute();
function compute() {}
function fromListener() {}
function tick() {}
function later() {}
function routed() {}
function named() {}
function neverRef() {}
const PAGES = { home: routed };
document.addEventListener('click', onClick);
setTimeout(tick, 10);
fetch('/x').then(() => later());
(function () { iifeRuns(); })();
function iifeRuns() {}
init();
document.body.innerHTML = '<button onclick="named()">x</button>';
`;

test('rules: what runs at load, and how the rest is reached', () => {
    const r = analyse([{ file: 'core.js', code: FIXTURE }]);
    const runs = [...r.runs].sort();
    assert.deepStrictEqual(runs, ['CALLED', 'PAGES', 'compute', 'deeper', 'eachRuns', 'execRuns', 'helper', 'iifeRuns', 'init'].sort());
    const via = Object.fromEntries([...r.reachable].map(([n, x]) => [n, x.via]));
    assert.deepStrictEqual(via, {
        onClick: 'listener', fromListener: 'through onClick', LATER_DATA: 'through onClick', tick: 'timer', later: 'promise',
        routed: 'table', named: 'by name',
    });
    assert.ok(!r.runs.has('neverRef') && !r.reachable.has('neverRef'), 'a declaration nothing names is neither');
    // Data runs nothing: PAGES runs because init reads it at load, LATER_DATA only waits for a click. CALLED's
    // initialiser calls compute, so it runs whoever reads it.
});

test('a function only REFERENCED at load does not run, even if it is passed somewhere', () => {
    const r = analyse([{ file: 'core.js', code: 'function f() {}\nfunction g() {}\nwindow.onresize = f;\nregister(g);\nfunction register() {}' }]);
    assert.ok(!r.runs.has('f') && !r.runs.has('g') && r.runs.has('register'));
    assert.strictEqual(r.reachable.get('f').via, 'listener');
    assert.strictEqual(r.reachable.get('g').via, 'reference');
});

test('the real core: every load-time declaration is in exactly one half, and the halves are honest', () => {
    const { measure } = require('../core-ownership');
    const { loadTime } = require('../load-time');
    const M = measure();
    const L = loadTime();
    const d = new Set(M.d.map(x => x.name));
    assert.ok(d.size > 0 && L.runs.size > 0 && L.reachable.size > 0, 'measures something');
    for (const n of d) assert.ok(L.runs.has(n) !== L.reachable.has(n), `${n}: in ${L.runs.has(n) ? 'both' : 'neither'} half`);
    for (const n of [...L.runs, ...L.reachable.keys()]) assert.ok(d.has(n), `${n}: not load-time in core-ownership`);
    // Every reachable one names where it was reached from, and that is a runner, a root, or another reachable one.
    for (const [n, x] of L.reachable) {
        assert.ok(x.from && x.via, `${n}: no entry`);
        assert.ok(x.root || L.runs.has(x.from) || L.reachable.has(x.from), `${n}: reached from ${x.from}, which is neither`);
    }
});
