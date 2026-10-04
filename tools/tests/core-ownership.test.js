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
    // Core shrinks by design as owners take their code; the exact partition below is what proves the scan reads it.
    assert.ok(declared.length > 0, 'no core declarations read: the scan is broken');
    const placed = [...M.a, ...M.a2, ...M.e, ...M.b, ...M.c, ...M.d].map(x => x.name);
    assert.deepStrictEqual(placed.filter((n, i) => placed.indexOf(n) !== i), [], 'placed twice');
    assert.deepStrictEqual([...placed].sort(), [...new Set(declared)].sort(), 'the categories are not exactly core\'s declarations');
});

test('every owner is a real page or component', () => {
    const owners = new Set([...M.a, ...M.a2, ...M.e].map(x => x.owner).concat(M.b.flatMap(x => x.owners)));
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
    // (a) empties as owners take their code, which is the point; what proves the measurement works is its graph.
    assert.ok([...M.edges.values()].some(e => e.size > 0), 'core has no call edges: the measurement is broken');
    for (const x of [...M.a, ...M.a2]) {
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

test('an (a) declaration is called only by core code that moves with it; (a2) only BY NAME from code that stays', () => {
    // Moving f into owner O's engine breaks every core caller left behind that calls f in code. So an (a) member's
    // core callers are all (a) for the same owner; an (a2) member's staying callers name it only in a string
    // (onclick="f(", window[name]), which works once O provides f on window. Anything else is (e): one owner, held.
    const where = new Map([...M.a.map(x => [x.name, `a:${x.owner}`]), ...M.a2.map(x => [x.name, `a:${x.owner}`])]);
    const bad = [];
    for (const x of [...M.a, ...M.a2]) {
        for (const [caller, kinds] of M.callersOf(x.name)) {
            if (where.get(caller) === `a:${x.owner}`) continue;
            if (kinds.code) bad.push(`${x.name} (${x.owner}) is called in code by ${caller}, which stays`);
            else if (M.a.includes(x)) bad.push(`${x.name} is named by ${caller}, which stays: it must be provided (a2), not (a)`);
        }
    }
    assert.deepStrictEqual(bad, []);
    for (const x of M.e) assert.ok(x.heldBy.length > 0, `${x.name} is held and names no caller`);
});

test('the two cases the sheet moves found are measured as held or provided, not as plainly movable', () => {
    // Regressions from a real move: renderCharacterViewsInto (stays) calls characterViewsHtml; renderLocationViews
    // (stays) calls sweepLocationCompass. Wherever those live now, neither may be plain (a) while its caller stays.
    for (const [callee, caller] of [['characterViewsHtml', 'renderCharacterViewsInto'], ['sweepLocationCompass', 'renderLocationViews']]) {
        if (!M.ownersOf || !M.callersOf(callee)) continue; // moved out of core already: nothing to measure
        const plain = M.a.find(x => x.name === callee);
        const callerMoves = M.a.find(x => x.name === caller);
        assert.ok(!plain || callerMoves, `${callee} is plain (a) while ${caller} stays in core`);
    }
});

test('a group names a real component and page, each with a reason', () => {
    for (const [comp, [page, why]] of Object.entries(M.groups)) {
        assert.ok(fs.existsSync(path.join(ROOT, 'src/components', comp.split(':')[1])), `${comp} does not exist`);
        assert.ok(fs.existsSync(path.join(ROOT, 'src/pages', page.split(':')[1])), `${page} does not exist`);
        assert.ok(why && why.length > 20, `${comp}: no reason given`);
    }
});

test('a core name that legacy markup calls by name is never plainly movable', () => {
    // src/components/**/*.html stays as it is (sidebar, status bar): an onclick="f(…)" there names f, so f moves only if
    // its owner provides it on window (a2), and the report says the markup names it.
    const html = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }).filter(f => f.endsWith('.html') && f !== 'index.html');
    assert.ok(html.length > 0, 'no legacy markup found: the scan is broken');
    const named = new Set(html.flatMap(f => [...read(`src/${f}`).matchAll(/\bon[a-z]+="([^"]*)"/g)].flatMap(m => [...m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map(x => x[1]))));
    const plain = M.a.filter(x => named.has(x.name)).map(x => x.name);
    assert.deepStrictEqual(plain, [], 'called by name from legacy markup, measured as plainly movable');
});

test('nothing measured movable assigns a core value that stays in a way the bridge cannot rewrite', () => {
    // The verbatim move rewrites a read of core's X as legacy.X and `X = v` as setLegacy('X', v), and nothing else:
    // `X += 1` or `X++` on a core value that stays has no form in a module, so such a function is held (e).
    const core = read('public/legacy/core.js');
    const ast = acorn.parse(core, { ecmaVersion: 'latest' });
    const where = new Map([...M.a, ...M.a2].map(x => [x.name, x.owner]));
    const stays = (n) => !where.has(n);
    const bad = [];
    for (const n of ast.body) {
        const name = n.type === 'FunctionDeclaration' ? n.id.name : null;
        if (!name || !where.has(name)) continue;
        const walk = (x) => {
            if (!x || typeof x.type !== 'string') return;
            const target = x.type === 'UpdateExpression' ? x.argument : x.type === 'AssignmentExpression' && x.operator !== '=' ? x.left : null;
            if (target && target.type === 'Identifier' && M.callersOf(target.name) && stays(target.name)) bad.push(`${name}: ${core.slice(x.start, x.end)}`);
            for (const k of Object.keys(x)) { const v = x[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
        };
        walk(n.body);
    }
    assert.deepStrictEqual(bad, []);
});
