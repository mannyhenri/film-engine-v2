// Code removed from the legacy core because nothing used it, in the original app or here: listed in tools/split-lib.js
// REMOVED, each with why, so a removal is visible and checkable rather than silent. Set-based over the list: each one
// was dead in the original (tools/core-ownership.js liveInOriginal), is gone from core, and nothing that remains, in
// legacy code or React, refers to it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { REMOVED } = require('../split-lib');
const { liveInOriginal, blankComments } = require('../core-ownership');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NAMES = Object.keys(REMOVED || {});

test('the removed list is read (this runs over something), and each entry says why', () => {
    assert.ok(NAMES.length > 0, 'nothing listed');
    for (const n of NAMES) assert.ok(typeof REMOVED[n] === 'string' && REMOVED[n].length > 20, `${n}: no reason given`);
});

test('every removed declaration was dead in the original app too', () => {
    assert.deepStrictEqual(liveInOriginal(NAMES), [], 'reached in the original: removing it would lose a feature');
});

test('every removed declaration is gone from the legacy code, and nothing that remains refers to it', () => {
    // Comments blanked: a sentence about a removed function is not a use of it.
    const legacy = ['public/legacy/core.js', 'public/legacy/shell.js', 'public/legacy/production-graph.js'].map(f => blankComments(read(f))).join('\n');
    const react = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
        .filter(f => /\.(jsx?|mjs|html)$/.test(f) && !f.includes('.test.') && f !== 'index.html')
        .map(f => (f.endsWith('.html') ? read(`src/${f}`).replace(/<!--[\s\S]*?-->/g, '') : blankComments(read(`src/${f}`), 'module'))).join('\n');
    const bad = [];
    for (const n of NAMES) {
        const word = new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`);
        if (word.test(legacy)) bad.push(`${n}: still named in the legacy code`);
        if (word.test(react)) bad.push(`${n}: still named in React source`);
    }
    assert.deepStrictEqual(bad, []);
});

test('no backend test reads a removed declaration (a test that holds it is a contract, and removing it is a new decision)', () => {
    // "Nothing in the original app calls it" is not "nothing uses it": film-engine's backend tests read some of core's
    // dead code as a registry (DAW_ACTIONS, ELEMENT_TYPES) or still assert a dead UI exists (the entity inspector).
    const dir = path.join(ROOT, 'backend/tests');
    const tests = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => [f, blankComments(read(`backend/tests/${f}`))]);
    const bad = [];
    for (const n of NAMES) {
        const word = new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`);
        const readers = tests.filter(([, t]) => word.test(t)).map(([f]) => f);
        if (readers.length) bad.push(`${n}: read by ${readers.join(', ')}`);
    }
    assert.deepStrictEqual(bad, []);
});

test('no backend test reads a removed declaration\'s TEXT either (a test can pin a line of code, not a name)', () => {
    // screenplay-pagination pins `const elementIndex = blocks.indexOf(block);`, a line inside addScreenplayComment, without
    // ever naming the function. So every string a backend test searches for (a literal of 20+ characters) must occur in
    // no removed declaration's original text.
    const acorn = require('acorn');
    const { readSource } = require('../split-lib');
    const app = readSource(path.join(ROOT, 'reference/fb8c770/src/index.html')).app;
    const textOf = new Map();
    for (const n of acorn.parse(app, { ecmaVersion: 'latest' }).body) {
        const names = n.type === 'FunctionDeclaration' ? [n.id.name] : n.type === 'VariableDeclaration' ? n.declarations.filter(d => d.id.type === 'Identifier').map(d => d.id.name) : [];
        for (const x of names) textOf.set(x, app.slice(n.start, n.end));
    }
    const literals = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'backend/tests')).filter(f => f.endsWith('.js'))) {
        const code = blankComments(read(`backend/tests/${f}`));
        for (const m of code.matchAll(/'((?:[^'\\\n]|\\.){20,})'|"((?:[^"\\\n]|\\.){20,})"|`([^`$\\]{20,})`/g)) literals.push([f, (m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1')]);
    }
    assert.ok(literals.length > 100, `only ${literals.length} test literals read: the scan is broken`);
    const bad = [];
    for (const n of NAMES) {
        const t = textOf.get(n);
        assert.ok(t, `${n} is not a declaration of the reference`);
        for (const [f, lit] of literals) if (t.includes(lit)) bad.push(`${n}: ${f} searches for "${lit.slice(0, 60)}"`);
    }
    assert.deepStrictEqual(bad, []);
});
