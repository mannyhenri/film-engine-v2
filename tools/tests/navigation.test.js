// navigateTo as the port runs it: the real function from public/legacy/core.js,
// in a sandbox where a page's chunk takes time to arrive.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parse, readSource, loaderMap } = require('../split-lib');

const ROOT = path.join(__dirname, '..', '..');
const plan = require('../port-plan.json');
const core = fs.readFileSync(path.join(ROOT, 'public/legacy/core.js'), 'utf8');
const nav = parse(core).body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'navigateTo');
const LOADERS = loaderMap(readSource(path.join(ROOT, plan.source)).app);

function sandbox() {
    const calls = [];
    const pending = [];
    const el = () => ({ classList: { add() {}, remove() {}, contains: () => false } });
    const ctx = {
        calls, pending,
        state: { currentPage: null },
        PAGE_RELOAD: 'previous page loader',
        window: { __fePages: { ensure: (page) => new Promise(r => pending.push({ page, go: r })) } },
        document: { body: el(), querySelectorAll: () => [], getElementById: el, querySelector: () => null },
        applyNavFlow() {}, setStatus() {}, toggleWriterFocus() {}, console,
        setTimeout: (fn, ms) => { calls.push(`setTimeout(${fn.name || 'fn'}, ${ms})`); },
        initCollapsibleCards() {},
        revealNavGroupFor: (p) => calls.push(`revealNavGroupFor(${p})`),
        writeRoute: () => calls.push('writeRoute'),
    };
    for (const fns of Object.values(LOADERS)) for (const f of fns) ctx[f] = () => calls.push(`${f}()`);
    vm.createContext(ctx);
    vm.runInContext(`${core.slice(nav.start, nav.end)}; this.navigateTo = navigateTo; this.getReload = () => PAGE_RELOAD;`.replace(/\bPAGE_RELOAD\b/g, 'this.PAGE_RELOAD'), ctx);
    return ctx;
}
const flush = () => new Promise(r => setImmediate(r));

test('every page: loader, then initCollapsibleCards, revealNavGroupFor, writeRoute, in the source order, after its chunk is in', async () => {
    const bad = [];
    for (const [page, fns] of Object.entries(LOADERS)) {
        const ctx = sandbox();
        ctx.navigateTo(page);
        if (ctx.calls.length) bad.push(`${page}: ran ${ctx.calls.join(',')} before its chunk`);
        if (ctx.PAGE_RELOAD !== null) bad.push(`${page}: PAGE_RELOAD kept the previous page's loader while loading`);
        ctx.pending.forEach(p => p.go());
        await flush();
        const want = [...fns.map(f => `${f}()`), 'setTimeout(initCollapsibleCards, 60)', `revealNavGroupFor(${page})`, 'writeRoute'];
        if (JSON.stringify(ctx.calls) !== JSON.stringify(want)) bad.push(`${page}: ${ctx.calls.join(',')}`);
        if (typeof ctx.PAGE_RELOAD !== 'function') bad.push(`${page}: PAGE_RELOAD not set after load`);
    }
    assert.deepStrictEqual(bad, []);
});

test('a page left before its chunk arrives runs nothing: only the page you are on loads', async () => {
    const pages = Object.keys(LOADERS);
    const bad = [];
    for (let i = 0; i < pages.length; i++) {
        const a = pages[i], b = pages[(i + 1) % pages.length];
        const ctx = sandbox();
        ctx.navigateTo(a);
        ctx.navigateTo(b);
        // a's chunk lands after b's: the slow first click.
        ctx.pending.filter(p => p.page === b).forEach(p => p.go());
        await flush();
        ctx.pending.filter(p => p.page === a).forEach(p => p.go());
        await flush();
        const ranA = LOADERS[a].some(f => ctx.calls.includes(`${f}()`) && !LOADERS[b].includes(f));
        if (ranA) bad.push(`${a} -> ${b}: ${a}'s loader ran`);
        if (!ctx.calls.includes(`revealNavGroupFor(${b})`) || ctx.calls.includes(`revealNavGroupFor(${a})`)) bad.push(`${a} -> ${b}: wrong page finished`);
        const reload = ctx.PAGE_RELOAD;
        ctx.calls.length = 0;
        reload();
        if (!LOADERS[b].every(f => ctx.calls.includes(`${f}()`))) bad.push(`${a} -> ${b}: PAGE_RELOAD is not ${b}'s`);
    }
    assert.deepStrictEqual(bad, []);
});

test('no chunk registers a DOMContentLoaded or load listener (chunks arrive after both)', () => {
    // The chunks the split generates; with every page React there are none, and nothing to check.
    const dir = path.join(ROOT, 'public/legacy/chunks');
    const chunks = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/split-map.json'), 'utf8')).chunks).map(c => `${c}.js`);
    const bad = chunks.filter(f => /addEventListener\(\s*['"](DOMContentLoaded|load)['"]/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    assert.deepStrictEqual(bad, []);
});
