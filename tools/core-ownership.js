#!/usr/bin/env node
/*
 * Who owns each declaration of the legacy core (public/legacy/core.js), measured from the code, for the plan to move
 * core into React. Writes docs/core-ownership.md; tools/tests/core-ownership.test.js holds the measurement.
 *
 *   node tools/core-ownership.js
 *
 * Nodes: every top-level declaration of core.js (a `var` without a value is a React loader's placeholder: wiring).
 * Edges: a core name in another declaration's text, comments blanked and strings kept, so the HTML core draws with
 *   onclick="X(…)" counts as a call. A property (`.X`) is not a reference, except legacy.X and window.X.
 * An owner is a React page (src/pages/<id>), a component (src/components/<Name>, a folder or a file), a shared module
 * (src/lib/<name>: lib:<name>) or the app (App.jsx, main.jsx); it reaches a core name that appears
 *   in its source the same way: legacy.X, a destructured bridge, setLegacy('X'), an inline handler in the HTML an engine
 *   or a markup module draws.
 * Load-time core: what core's own top-level statements (the INIT block, listeners), shell.js and production-graph.js
 *   reach, closed over the edges. It stays core whoever else uses it.
 * Owners propagate down the edges: a helper inherits every owner of every core declaration that calls it.
 *
 * Matching by name errs toward MORE reach (a name in a string of prose counts), which only keeps more in core. That is
 * the safe direction for a move; a name it cannot see at all (built at run time, window[name]) is in (c), named.
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** The code with its comments blanked, by the parser's own comment ranges. */
function blankComments(code, sourceType = 'script') {
    const ranges = [];
    try {
        acorn.parse(code, { ecmaVersion: 'latest', sourceType, onComment: (b, t, s, e) => ranges.push([s, e]) });
    } catch (_) {
        // JSX does not parse with acorn: fall back to the line and block comments a JSX file can hold.
        return code.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ').replace(/^\s*\/?\*[^\n]*$/gm, ' ');
    }
    let out = code;
    for (const [a, b] of ranges.reverse()) out = out.slice(0, a) + out.slice(a, b).replace(/[^\n]/g, ' ') + out.slice(b);
    return out;
}
// A property (`.X`) is not a reference, except through the two objects that ARE the globals: legacy.X (React's bridge)
// and window.X.
const tokens = (code) => new Set([...code.replace(/\b(legacy|window)\./g, '$1 ').matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)].map(m => m[0]));

/*
 * Source that names core functions without reaching them, read by nobody here, each with why. A stale entry (a file
 * that no longer exists) fails tools/tests/core-ownership.test.js.
 */
const EXEMPT = {
    'src/lib/legacy.js': 'the bridge itself: LEGACY_GLOBALS lists every name React may reach, which is a registry, not a use (counted, it made every bridged function look shared by one more owner)',
    'src/pages/registry.js': 'generated: the list of page components, which names no core function',
    'src/vendor/splat-viewer.js': 'a vendored bundle (three.js + Spark), minified: its short names would match core names by chance',
};

function measure() {
    const core = read('public/legacy/core.js');
    const ast = acorn.parse(core, { ecmaVersion: 'latest' });
    const decls = new Map(); // name -> declaration text, comments blanked
    const bootText = [];
    for (const n of ast.body) {
        const text = blankComments(core.slice(n.start, n.end));
        if (n.type === 'FunctionDeclaration') decls.set(n.id.name, text);
        else if (n.type === 'VariableDeclaration') {
            for (const d of n.declarations) if (d.id.type === 'Identifier' && d.init) decls.set(d.id.name, text);
        } else bootText.push(text);
    }
    const names = new Set(decls.keys());
    const refs = (code, self) => [...tokens(code)].filter(t => names.has(t) && t !== self);

    // Core -> core edges.
    const edges = new Map([...decls].map(([n, t]) => [n, new Set(refs(t, n))]));

    // Load-time core: core's own statements, the shell and the graph setting's script, closed over the edges.
    const boot = new Set();
    const roots = [...bootText, blankComments(read('public/legacy/shell.js')), blankComments(read('public/legacy/production-graph.js'))]
        .flatMap(t => refs(t, null));
    const stack = [...roots];
    while (stack.length) { const n = stack.pop(); if (boot.has(n)) continue; boot.add(n); stack.push(...edges.get(n)); }

    // The owners, and the core names each reaches directly.
    const owners = [];
    const sourceOf = (dir) => fs.readdirSync(path.join(ROOT, dir), { recursive: true })
        .filter(f => /\.(jsx?|mjs)$/.test(f) && !/\.test\./.test(f) && !f.endsWith('reach.js') && !EXEMPT[`${dir}/${f}`])
        .map(f => blankComments(read(`${dir}/${f}`), 'module')).join('\n');
    for (const id of fs.readdirSync(path.join(ROOT, 'src/pages'))) {
        if (fs.existsSync(path.join(ROOT, 'src/pages', id, 'react.json'))) owners.push({ id: `page:${id}`, src: sourceOf(`src/pages/${id}`), files: [`src/pages/${id}`] });
    }
    const one = (f) => blankComments(read(f), 'module');
    const isSource = (f) => /\.(jsx?|mjs)$/.test(f) && !/\.test\./.test(f);
    for (const n of fs.readdirSync(path.join(ROOT, 'src/components'))) {
        const p = `src/components/${n}`;
        if (fs.statSync(path.join(ROOT, p)).isDirectory()) owners.push({ id: `component:${n}`, src: sourceOf(p), files: [p] });
        else if (isSource(n)) owners.push({ id: `component:${n.replace(/\.[^.]+$/, '')}`, src: one(p), files: [p] });
    }
    // Shared React code: each lib module is its own owner (whoever imports it reaches what it reaches), and the app.
    for (const n of fs.readdirSync(path.join(ROOT, 'src/lib')).filter(isSource).filter(n => !EXEMPT[`src/lib/${n}`])) owners.push({ id: `lib:${n.replace(/\.[^.]+$/, '')}`, src: one(`src/lib/${n}`), files: [`src/lib/${n}`] });
    owners.push({ id: 'app', src: ['src/App.jsx', 'src/main.jsx'].filter(f => fs.existsSync(path.join(ROOT, f))).map(one).join('\n'), files: ['src/App.jsx', 'src/main.jsx'] });
    const own = new Map([...names].map(n => [n, new Set()]));
    for (const o of owners) for (const n of refs(o.src, null)) own.get(n).add(o.id);

    // Owners flow down the edges to a fixpoint: a helper serves everyone its callers serve.
    let changed = true;
    while (changed) {
        changed = false;
        for (const [caller, callees] of edges) for (const f of callees) for (const o of own.get(caller)) {
            if (!own.get(f).has(o)) { own.get(f).add(o); changed = true; }
        }
    }
    const ownersOf = (n) => [...own.get(n)].sort();
    const a = [], b = [], c = [], d = [];
    for (const n of names) {
        const os = ownersOf(n);
        if (boot.has(n)) d.push({ name: n, owners: os });
        else if (os.length === 1) a.push({ name: n, owner: os[0] });
        else if (os.length > 1) b.push({ name: n, owners: os });
        else c.push({ name: n });
    }
    const byName = (x, y) => x.name.localeCompare(y.name);
    return { a: a.sort(byName), b: b.sort(byName), c: c.sort(byName), d: d.sort(byName), boot, edges, ownersOf, total: names.size, scanned: owners.flatMap(o => o.files), exempt: EXEMPT };
}

/** The report, as Markdown: the split by owner first, since that is what gets worked from. */
function report(M) {
    const lines = [];
    const byOwner = new Map();
    for (const x of M.a) byOwner.set(x.owner, [...(byOwner.get(x.owner) || []), x.name]);
    lines.push('# Who owns the legacy core', '',
        'GENERATED by `node tools/core-ownership.js` from `public/legacy/core.js` and the React owners; held by',
        '`tools/tests/core-ownership.test.js`. Every top-level declaration of core, in exactly one category. Matching is',
        'by name and errs toward more reach, which only keeps more in core.', '',
        `| category | declarations |`, `|---|---|`,
        `| (a) one owner: can move into that owner's engine | ${M.a.length} |`,
        `| (b) two or more owners: stays core, or a shared module | ${M.b.length} |`,
        `| (c) reached by nobody this can see: dead, or reached only by a name built at run time | ${M.c.length} |`,
        `| (d) load-time core (startup statements, shell.js, production-graph.js and what they reach) | ${M.d.length} |`,
        `| total | ${M.total} |`, '',
        '## (a) By owner', '');
    for (const [o, ns] of [...byOwner].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]))) {
        lines.push(`### ${o} (${ns.length})`, '', ns.map(n => `\`${n}\``).join(', '), '');
    }
    // The shared set by WHICH owners share it: a pair that is one feature (a page and its own dialogs) moves together.
    const sets = new Map();
    for (const x of M.b) { const k = x.owners.join(' + '); sets.set(k, (sets.get(k) || 0) + 1); }
    lines.push('## (b) By owner set', '', 'Which owners share what. Two owners that are one feature (a page and its own dialogs component) can move',
        'their shared declarations together into one engine; the rest stays core or becomes a shared module.', '',
        '| owners | declarations |', '|---|---|');
    for (const [k, n] of [...sets].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))) lines.push(`| ${k} | ${n} |`);
    lines.push('', '## (b) Shared', '', '| declaration | owners |', '|---|---|');
    for (const x of M.b) lines.push(`| \`${x.name}\` | ${x.owners.join(', ')} |`);
    lines.push('', '## (c) Reached by nobody this measurement can see', '',
        'Not deleted: each is either dead, or reached by a name built at run time (`window[name]`, a string the code',
        'assembles). Check each before removing it.', '', M.c.map(x => `\`${x.name}\``).join(', ') || '(none)', '',
        '## (d) Load-time core', '', M.d.map(x => `\`${x.name}\``).join(', '), '');
    return lines.join('\n');
}

module.exports = { measure, report };

if (require.main === module) {
    const M = measure();
    fs.writeFileSync(path.join(ROOT, 'docs/core-ownership.md'), report(M));
    console.log(`core: ${M.total} declarations — (a) ${M.a.length} one owner, (b) ${M.b.length} shared, (c) ${M.c.length} reached by nobody, (d) ${M.d.length} load-time`);
}
