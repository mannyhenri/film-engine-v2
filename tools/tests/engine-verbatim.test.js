// A page engine module (Playback's player.js, the Production graph's engine.js, the Screenplay's engine.js)
// MOVED its legacy code: every declaration it exports is the reference source's declaration of the same name,
// character for character, except for the one mechanical rewrite a module needs to reach core VARIABLES
// (another script's `let` cannot be assigned or read live from a module):
//
//     X            ->  legacy.X               (a read of core variable X)
//     X = value;   ->  setLegacy('X', value); (an assignment to it)
//
// Undo exactly those two and the text must be identical. That is what lets the backend tests that read these
// functions' source keep testing the code that runs, and it is why an engine is reviewed by this test rather
// than by eye. Set-based over every engine module and every name it exports; a hand edit fails here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { readSource } = require('../split-lib');

const ROOT = path.join(__dirname, '..', '..');

/*
 * Declarations changed ON PURPOSE after the move, by name, each with its reason. An entry that no longer
 * differs from the reference fails, so the list cannot outlive the change it records.
 */
const CHANGED = {
    'src/pages/previs/engine.js': {
        worldSplatModule: "the splat viewer's import('./vendor/splat-viewer.js') resolved against the document in a classic script; in a module it would resolve against the module (and Vite rewrites it at build), so it is built from document.baseURI and marked @vite-ignore: the same URL, at run time",
    },
    'src/pages/productiongraph/engine.js': {
        loadProductionGraph: 'project-switch fix (3ee8beb): the in-flight load is keyed by project, so a switch never waits on the previous film',
        pgLoad: 'project-switch fix (3ee8beb): a switch resets every per-project field of PG, the queue, picks and palette included',
    },
};
// Pages and React components (src/components/<Name>/react.json) alike: an engine is an engine wherever it lives.
const ownModules = (dir) => fs.readdirSync(path.join(ROOT, dir))
    .filter(id => fs.existsSync(path.join(ROOT, dir, id, 'react.json')))
    .flatMap(id => fs.readdirSync(path.join(ROOT, dir, id))
        // A *.markup.js module holds markup as a string (a verbatim modal frame), not code.
        .filter(f => f.endsWith('.js') && !f.includes('.test.') && f !== 'reach.js' && f !== 'index.js' && !f.endsWith('.markup.js'))
        .map(f => `${dir}/${id}/${f}`));
const ENGINES = [...ownModules('src/pages'), ...ownModules('src/components')]
    .filter(f => /^export \{/m.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));

// Every top-level declaration of the reference's scripts, by name -> its source text.
const REFERENCE = (() => {
    const src = readSource(path.join(ROOT, 'reference/fb8c770/src/index.html'));
    const out = new Map();
    for (const code of [src.app, src.productionGraph]) {
        const ast = acorn.parse(code, { ecmaVersion: 'latest' });
        for (const n of ast.body) {
            const names = n.type === 'FunctionDeclaration' ? [n.id.name]
                : n.type === 'VariableDeclaration' ? n.declarations.map(d => d.id.name) : [];
            for (const name of names) out.set(name, code.slice(n.start, n.end));
        }
    }
    return out;
})();

/** The declaration's text with the two bridge rewrites undone. */
function undoRewrites(text) {
    const ast = parse(text, { sourceType: 'module' });
    const edits = [];
    traverse(ast, {
        CallExpression(p) {
            const { callee, arguments: a } = p.node;
            if (callee.type === 'Identifier' && callee.name === 'setLegacy' && a.length === 2 && a[0].type === 'StringLiteral') {
                edits.push([p.node.start, a[1].start, `${a[0].value} = `], [a[1].end, p.node.end, '']);
            }
        },
        MemberExpression(p) {
            const { object, property, computed } = p.node;
            if (!computed && object.type === 'Identifier' && object.name === 'legacy' && !p.scope.hasBinding('legacy', true)) {
                edits.push([p.node.start, p.node.end, property.name]);
            }
        },
    });
    let out = text;
    for (const [s, e, r] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, s) + r + out.slice(e);
    return out;
}

test('there are engines to check, and the reference was read (this runs over something)', () => {
    assert.ok(ENGINES.includes('src/pages/playback/player.js') && ENGINES.includes('src/pages/productiongraph/engine.js'), ENGINES.join(', '));
    assert.ok(REFERENCE.size > 1000, `only ${REFERENCE.size} reference declarations`);
});

for (const file of ENGINES) {
    test(`${file}: every declaration it exports is the reference's, verbatim but for the bridge rewrites`, () => {
        const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
        const exported = new Set(ast.body.filter(n => n.type === 'ExportNamedDeclaration' && !n.declaration)
            .flatMap(n => n.specifiers.map(s => s.local.name)));
        assert.ok(exported.size > 0, 'exports nothing');
        const seen = new Set();
        const bad = [];
        for (const n of ast.body) {
            const names = n.type === 'FunctionDeclaration' ? [n.id.name]
                : n.type === 'VariableDeclaration' ? n.declarations.map(d => d.id.name) : [];
            const mine = names.filter(x => exported.has(x));
            if (!mine.length) continue;
            for (const x of mine) seen.add(x);
            const ref = REFERENCE.get(mine[0]);
            if (ref === undefined) { bad.push(`${mine[0]}: not a top-level declaration of the reference`); continue; }
            const same = undoRewrites(code.slice(n.start, n.end)) === ref;
            const declared = (CHANGED[file] || {})[mine[0]];
            if (!same && !declared) bad.push(`${mine[0]}: differs from the reference`);
            if (same && declared) bad.push(`${mine[0]}: declared changed but is the reference's (stale entry)`);
        }
        for (const name of Object.keys(CHANGED[file] || {})) if (!seen.has(name)) bad.push(`${name}: declared changed and not exported`);
        const unseen = [...exported].filter(x => !seen.has(x));
        assert.deepStrictEqual(unseen, [], 'exported names with no top-level declaration in the module');
        assert.deepStrictEqual(bad, [], `${file}: hand-edited declarations`);
    });
}
