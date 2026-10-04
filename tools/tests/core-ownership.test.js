// The core plan rests on one measurement (tools/core-ownership.js): for every top-level declaration of
// public/legacy/core.js, which React owners reach it (directly, or through core code that reaches it), and so whether
// it can move into one owner's engine (a), is shared (b), is reached by nobody (c), or is load-time core (d).
// A wrong measurement moves code a second owner still calls, so this holds it: a partition of exactly core's
// declarations, a committed report equal to a fresh one, and every (a) member reached by its owner and nobody else.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { measure } = require('../core-ownership');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const M = measure();

test('it measures every declaration of core.js, each in exactly one category', () => {
    const declared = acorn.parse(read('public/legacy/core.js'), { ecmaVersion: 'latest' }).body
        .flatMap(n => n.type === 'FunctionDeclaration' ? [n.id.name] : n.type === 'VariableDeclaration' ? n.declarations.filter(d => d.id.type === 'Identifier' && d.init).map(d => d.id.name) : []);
    assert.ok(declared.length > 400, `only ${declared.length} core declarations: the scan is broken`);
    const placed = [...M.a.map(x => x.name), ...M.b.map(x => x.name), ...M.c.map(x => x.name), ...M.d.map(x => x.name)];
    assert.deepStrictEqual(placed.filter((n, i) => placed.indexOf(n) !== i), [], 'placed twice');
    assert.deepStrictEqual([...placed].sort(), [...new Set(declared)].sort(), 'the categories are not exactly core\'s declarations');
});

test('every owner is a real page or component', () => {
    const owners = new Set([...M.a.map(x => x.owner), ...M.b.flatMap(x => x.owners)]);
    for (const o of owners) {
        const [kind, id] = o.split(':');
        const ok = o === 'app' || (kind === 'page' && fs.existsSync(path.join(ROOT, 'src/pages', id)))
            || (kind === 'component' && fs.readdirSync(path.join(ROOT, 'src/components')).some(f => f === id || f.replace(/\.[^.]+$/, '') === id))
            || (kind === 'lib' && fs.readdirSync(path.join(ROOT, 'src/lib')).some(f => f.replace(/\.[^.]+$/, '') === id));
        assert.ok(ok, `${o} is not a page, component, lib module or the app`);
    }
});

test('every source file under src/ is read as some owner (a file nobody scans is reach nobody sees)', () => {
    const all = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
        .filter(f => /\.(jsx?|mjs)$/.test(f) && !/\.test\./.test(f) && !f.startsWith('test/') && !f.endsWith('reach.js')).map(f => `src/${f}`);
    const unscanned = all.filter(f => !M.exempt[f] && !M.scanned.some(s => f === s || f.startsWith(s + '/')));
    assert.deepStrictEqual(unscanned, []);
    assert.deepStrictEqual(Object.keys(M.exempt).filter(f => !fs.existsSync(path.join(ROOT, f))), [], 'an exemption names a file that is gone');
});

test('an (a) declaration is reached by its owner and by no other owner and no load-time code', () => {
    assert.ok(M.a.length > 0, 'nothing with one owner: the measurement found no edges');
    for (const x of M.a) {
        assert.deepStrictEqual(M.ownersOf(x.name), [x.owner], `${x.name}`);
        assert.ok(!M.boot.has(x.name), `${x.name} is reached at load`);
    }
});

test('load-time core includes the router, and a core helper inherits its callers\' owners', () => {
    assert.ok(M.d.some(x => x.name === 'navigateTo'), 'navigateTo is not load-time core');
    // Transitivity, checked on the measurement's own graph: no declaration has fewer owners than a core caller of it.
    for (const [caller, callees] of M.edges) for (const f of callees) {
        if (M.boot.has(f)) continue;
        const missing = M.ownersOf(caller).filter(o => !M.ownersOf(f).includes(o));
        assert.deepStrictEqual(missing, [], `${f} is called by ${caller} and lacks its owners`);
    }
});

test('the committed report is the measurement as it stands', () => {
    const { report } = require('../core-ownership');
    assert.strictEqual(read('docs/core-ownership.md'), report(M), 'docs/core-ownership.md is stale: run node tools/core-ownership.js');
});

test('every core name on LEGACY_GLOBALS is reached by an owner (the bridge exists because React uses them)', () => {
    const src = read('src/lib/legacy.js');
    const list = src.slice(src.indexOf('export const LEGACY_GLOBALS = ['), src.indexOf('];', src.indexOf('export const LEGACY_GLOBALS = [')));
    const globals = [...list.replace(/\/\/[^\n]*/g, '').matchAll(/'([\w$]+)'/g)].map(m => m[1]);
    const unreached = M.c.map(x => x.name).filter(n => globals.includes(n));
    assert.deepStrictEqual(unreached, [], 'on LEGACY_GLOBALS and measured as reached by nobody: the measurement cannot see legacy.X');
});
