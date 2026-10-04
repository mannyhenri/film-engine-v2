// A top-level variable the split puts in a page chunk exists only once that page has been opened. If
// core code reads it, core throws a ReferenceError until then: Apply Style Book did exactly that with
// _styleBook (in the Style Book chunk, read by core's applyStyleBookEntry) and failed on a fresh app.
// Set-based over every top-level let/const/var of every chunk, against every identifier core's CODE
// uses (comments and strings do not count, so a name mentioned in prose is not a reference).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parse } = require('../split-lib');

const ROOT = path.join(__dirname, '..', '..');
const strip = (c) => c.replace(/^\/\* GENERATED[^\n]*\n/, '');
const read = (p) => strip(fs.readFileSync(path.join(ROOT, p), 'utf8'));

/** Every Identifier node in a program: a reference or a binding, never text inside a string or comment. */
function identifiers(ast) {
    const out = new Set();
    (function walk(n) {
        if (!n || typeof n.type !== 'string') return;
        if (n.type === 'Identifier') out.add(n.name);
        for (const k of Object.keys(n)) {
            if (k === 'type' || k === 'start' || k === 'end') continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v);
        }
    })(ast);
    return out;
}

test('core code reads no top-level variable that lives in a page chunk', () => {
    const coreAst = parse(read('public/legacy/core.js'));
    const coreDeclared = new Set(coreAst.body.flatMap(n => n.type === 'VariableDeclaration' ? n.declarations.map(d => d.id.name) : n.type === 'FunctionDeclaration' ? [n.id.name] : []));
    const coreUses = identifiers(coreAst);
    // The chunks the split generates (docs/split-map.json): every page may be React, and then there are none, and
    // no chunk file may be left on disk either (a stale one is read by nothing and tested by everything).
    const chunks = Object.keys(JSON.parse(read('docs/split-map.json')).chunks).map(c => `${c}.js`);
    const onDisk = fs.existsSync(path.join(ROOT, 'public/legacy/chunks')) ? fs.readdirSync(path.join(ROOT, 'public/legacy/chunks')) : [];
    assert.deepStrictEqual(onDisk.filter(f => !chunks.includes(f)), [], 'chunk files the split does not generate are on disk');
    if (!chunks.length) return; // no page chunk: core can read nothing that lives in one
    let vars = 0;
    const bad = [];
    for (const f of chunks) {
        for (const n of parse(read(`public/legacy/chunks/${f}`)).body) {
            if (n.type !== 'VariableDeclaration') continue;
            for (const d of n.declarations) {
                if (d.id.type !== 'Identifier') continue;
                vars++;
                if (coreUses.has(d.id.name) && !coreDeclared.has(d.id.name)) bad.push(`${d.id.name} (chunks/${f})`);
            }
        }
    }
    assert.ok(vars > 10, `only ${vars} chunk variables found: the scan is not reading the chunks`);
    assert.deepStrictEqual(bad, [], 'core reads these before their page chunk may have loaded, and throws until it has');
});
