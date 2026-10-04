#!/usr/bin/env node
/*
 * Move a set of the reference app's top-level declarations into an engine module, VERBATIM, the way the
 * Production graph's and the Screenplay's engines were moved, so tools/tests/engine-verbatim.test.js and
 * engine-bridge.test.js hold the result:
 *
 *   - each declaration's text exactly as the reference has it, with the comments that lead into it, in source order;
 *   - core FUNCTIONS it calls: one destructuring bridge, each name a lazy wrapper over legacy.<name>;
 *   - core OBJECTS it uses (a const whose value is an object, array, Map...): one destructuring of live proxies;
 *   - core VALUES (a let, or a const primitive): every read rewritten to legacy.X and every plain assignment to
 *     setLegacy('X', value) — the one rewrite the verbatim test undoes;
 *   - export { every declared name }.
 *
 * It prints what to add to LEGACY_GLOBALS (src/lib/legacy.js), and who outside the set still calls into it (core,
 * chunks and legacy markup): those are the names the component must PROVIDE (react.json), or that stay in core.
 *
 *   node tools/extract-engine.js <spec.json>
 *   spec: { "names": [...], "out": "src/components/X/engine.js", "title": "The X engine", "about": "..." }
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { readSource } = require('./split-lib');

const ROOT = path.join(__dirname, '..');
const REF = path.join(ROOT, 'reference/fb8c770/src/index.html');

function topLevel(code) {
    const ast = acorn.parse(code, { ecmaVersion: 'latest' });
    const out = [];
    let prev = 0;
    for (const n of ast.body) {
        const names = n.type === 'FunctionDeclaration' ? [n.id.name]
            : n.type === 'VariableDeclaration' ? n.declarations.filter(d => d.id.type === 'Identifier').map(d => d.id.name)
                : n.type === 'ClassDeclaration' ? [n.id.name] : [];
        out.push({ node: n, names, lead: code.slice(prev, n.start), text: code.slice(n.start, n.end) });
        prev = n.end;
    }
    return out;
}

function extract(spec) {
    const src = readSource(REF);
    const app = topLevel(src.app);
    const want = new Set(spec.names);
    const chosen = app.filter(s => s.names.length && s.names.some(n => want.has(n)));
    const partial = chosen.filter(s => !s.names.every(n => want.has(n)));
    if (partial.length) throw new Error('a declaration declares names both in and out of the set: ' + partial.map(s => s.names.join(',')).join('; '));
    const found = new Set(chosen.flatMap(s => s.names));
    const missing = spec.names.filter(n => !found.has(n));
    if (missing.length) throw new Error('not top-level declarations of the reference app: ' + missing.join(', '));

    // What core declares at top level (the reference's three scripts), less the set.
    const core = new Map();
    for (const code of [src.app, src.productionGraph]) for (const s of topLevel(code)) for (const n of s.names) if (!want.has(n)) core.set(n, s.node);

    // Each chosen declaration with its leading comments (the text after the previous statement: comments only).
    // ...and the indentation the declaration had: backend tests bound a function by the next `\n    function `.
    const lead = (l) => {
        const t = l.replace(/^\s*\n/, '');
        const indent = (/(?:^|\n)([ \t]*)$/.exec(l) || [, ''])[1];
        return (/\S/.test(t) ? t.replace(/\s+$/, '') + '\n' : '') + indent;
    };
    const body = chosen.map(s => lead(s.lead) + s.text).join('\n\n');

    // Free identifiers of the body, classified.
    const ast = parse(body, { sourceType: 'module', ranges: true });
    let globals = [];
    traverse(ast, { Program(p) { p.scope.crawl(); globals = Object.keys(p.scope.globals); } });
    const fns = [], objects = [], values = [];
    const isObjectInit = (node) => node.type === 'VariableDeclaration' && node.kind === 'const' && node.declarations.every(d => d.init && /^(ObjectExpression|ArrayExpression|NewExpression)$/.test(d.init.type));
    for (const g of globals.sort()) {
        const n = core.get(g);
        if (!n) continue; // a browser global (engine-bridge.test.js holds that it is one)
        if (n.type === 'FunctionDeclaration' || (n.type === 'VariableDeclaration' && n.declarations.every(d => d.init && /Function/.test(d.init.type)))) fns.push(g);
        else if (isObjectInit(n)) objects.push(g);
        else values.push(g);
    }

    // Rewrite core VALUES: reads -> legacy.X, `X = v` -> setLegacy('X', v).
    const edits = [];
    const valueSet = new Set(values);
    traverse(ast, {
        Identifier(p) {
            const name = p.node.name;
            if (!valueSet.has(name) || p.scope.hasBinding(name)) return;
            if (!p.isReferencedIdentifier() && !(p.parentPath.isAssignmentExpression() && p.parentPath.node.left === p.node)) return;
            const parent = p.parentPath;
            if (parent.isAssignmentExpression() && parent.node.left === p.node) {
                if (parent.node.operator !== '=') throw new Error(`compound assignment to core value ${name}: rewrite by hand`);
                edits.push({ start: parent.node.start, end: parent.node.end, text: `setLegacy('${name}', ${body.slice(parent.node.right.start, parent.node.right.end)})` });
                parent.skip();
                return;
            }
            if (parent.isUpdateExpression()) throw new Error(`${name}++/-- on a core value: rewrite by hand`);
            if (parent.isObjectProperty() && parent.node.shorthand && parent.node.value === p.node) {
                edits.push({ start: parent.node.start, end: parent.node.end, text: `${name}: legacy.${name}` });
                return;
            }
            edits.push({ start: p.node.start, end: p.node.end, text: `legacy.${name}` });
        },
    });
    // Assignments' own right-hand sides may hold reads: apply innermost-last by sorting and skipping nested.
    edits.sort((a, b) => b.start - a.start);
    let out = body;
    let floor = Infinity;
    for (const e of edits) { if (e.end > floor) continue; out = out.slice(0, e.start) + e.text + out.slice(e.end); floor = e.start; }

    const names = chosen.flatMap(s => s.names);
    const list = (xs) => xs.map(n => `    ${n},`).join('\n');
    const header = `/*\n * ${spec.title}. MOVED VERBATIM from the reference app (film-engine ${path.basename(path.dirname(path.dirname(path.dirname(REF))))}),\n`
        + ` * by tools/extract-engine.js: same names, same bodies. ${spec.about || ''}\n *\n`
        + ` * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is\n`
        + ` * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.\n`
        + ` * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).\n */\n`;
    const imports = `import { legacy${values.length ? ', setLegacy' : ''} } from '${path.relative(path.dirname(path.join(ROOT, spec.out)), path.join(ROOT, 'src/lib/legacy.js')).replace(/\\/g, '/')}';\n`;
    const fnBlock = fns.length ? `\n// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:\n// a line reading \`const esc = …\` would be the first definition a backend test finds when it searches the page.\nconst {\n${list(fns)}\n} = Object.fromEntries([\n${fns.map(n => `    '${n}',`).join('\n')}\n].map(n => [n, (...a) => legacy[n](...a)]));\n` : '';
    const liveFn = objects.length ? `const live = (name) => new Proxy({}, {\n    get: (_, k) => legacy[name][k],\n    set: (_, k, v) => { legacy[name][k] = v; return true; },\n    has: (_, k) => k in legacy[name],\n    ownKeys: () => Reflect.ownKeys(legacy[name]),\n    getOwnPropertyDescriptor: (_, k) => { const d = Reflect.getOwnPropertyDescriptor(legacy[name], k); if (d) d.configurable = true; return d; },\n    deleteProperty: (_, k) => delete legacy[name][k],\n});\n// Core's objects, as live proxies, in one destructuring statement for the same reason.\nconst { ${objects.join(', ')} } = Object.fromEntries([${objects.map(n => `'${n}'`).join(', ')}].map(n => [n, live(n)]));\n` : '';
    const file = header + imports + fnBlock + liveFn + (values.length ? `// Core's values, read live as legacy.X and assigned with setLegacy: ${values.join(', ')}.\n` : '')
        + '\n' + out + '\n\nexport {\n' + list(names) + '\n};\n';
    return { file, names, fns, objects, values };
}

/** Who outside the set names one of its declarations: the legacy files and markup the app still runs. */
function callers(names) {
    const files = ['public/legacy/core.js', 'public/legacy/production-graph.js', 'public/legacy/shell.js',
        ...fs.readdirSync(path.join(ROOT, 'public/legacy/chunks')).map(f => 'public/legacy/chunks/' + f),
        ...fs.readdirSync(path.join(ROOT, 'src/components/modals')).filter(f => f.endsWith('.html')).map(f => 'src/components/modals/' + f)];
    const out = {};
    for (const f of files) {
        const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const n of names) if (new RegExp(`(^|[^\\w$.])${n.replace(/\$/g, '\\$')}\\b`).test(text.replace(new RegExp(`(function\\s+|(let|const|var)\\s+)${n}\\b`, 'g'), ''))) (out[n] = out[n] || []).push(f);
    }
    return out;
}

module.exports = { extract, callers };

if (require.main === module) {
    const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const r = extract(spec);
    fs.mkdirSync(path.dirname(path.join(ROOT, spec.out)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, spec.out), r.file);
    const lg = fs.readFileSync(path.join(ROOT, 'src/lib/legacy.js'), 'utf8');
    const needed = [...r.fns, ...r.objects, ...r.values].filter(n => !new RegExp(`'${n}'`).test(lg));
    console.log(`${spec.out}: ${r.names.length} declarations; bridge ${r.fns.length} functions, ${r.objects.length} objects, ${r.values.length} values`);
    console.log('add to LEGACY_GLOBALS:', needed.join(', ') || '(none)');
    console.log('called from outside the set (provide, or keep in core):');
    for (const [n, fs_] of Object.entries(callers(r.names))) console.log(`  ${n}: ${fs_.join(', ')}`);
}
