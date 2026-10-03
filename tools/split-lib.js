// Reading the source app: the one-file index.html of ../film-engine.
const fs = require('fs');
const acorn = require('acorn');

const parse = (code, onComment) => acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, onComment });

/** The pieces of index.html, in order: head styles, body markup, the five scripts. */
function readSource(file) {
    const text = fs.readFileSync(file, 'utf8');
    const bodyAt = text.indexOf('<body>');
    if (bodyAt < 0) throw new Error('no <body> in ' + file);
    const head = text.slice(0, bodyAt);
    const styles = [...head.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map(m => ({ attrs: m[1], css: m[2] }));
    const scripts = [];
    const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
    re.lastIndex = bodyAt;
    let m, between = [], last = null;
    while ((m = re.exec(text))) {
        if (last !== null) between.push(text.slice(last, m.index));
        scripts.push({ attrs: m[1], code: m[2], at: m.index });
        last = re.lastIndex;
    }
    if (scripts.length !== 5) throw new Error(`expected 5 scripts after <body>, found ${scripts.length}`);
    between.push(text.slice(last, text.lastIndexOf('</body>')));
    for (const gap of between) {
        if (gap.replace(/<!--[\s\S]*?-->/g, '').trim()) throw new Error('unexpected markup between scripts: ' + gap.trim().slice(0, 80));
    }
    const html = text.slice(bodyAt + '<body>'.length, scripts[0].at);
    const [three, gltf, app, productionGraph, shell] = scripts.map(s => s.code);
    if (!/production-graph-js/.test(scripts[3].attrs) || !/fe-redesign-js/.test(scripts[4].attrs)) throw new Error('script order changed in source');
    return { text, styles, html, three, gltf, app, productionGraph, shell };
}

/** navigateTo's loaders map: page -> the functions its loader calls. */
function loaderMap(app) {
    const nav = parse(app).body.find(s => s.type === 'FunctionDeclaration' && s.id.name === 'navigateTo');
    const decl = nav.body.body.find(s => s.type === 'VariableDeclaration' && s.declarations[0].id.name === 'loaders');
    const out = {};
    for (const p of decl.declarations[0].init.properties) {
        const v = p.value;
        out[p.key.name] = v.type === 'Identifier' ? [v.name] : [...app.slice(v.start, v.end).matchAll(/([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]);
    }
    return out;
}

/** Top-level function declarations, with their source span. */
function topLevelFunctions(code) {
    return parse(code).body.filter(s => s.type === 'FunctionDeclaration').map(s => ({ name: s.id.name, start: s.start, end: s.end }));
}

/** Top-level elements of an HTML fragment: [{tag, id, start, end, outer}]. */
function topLevelElements(html) {
    const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/g;
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
    const out = [];
    let depth = 0, cur = null, m;
    while ((m = tagRe.exec(html))) {
        if (m[0].startsWith('<!--')) continue;
        const [, close, rawTag, attrs, selfClose] = m;
        const tag = rawTag.toLowerCase();
        if (close) {
            depth--;
            if (depth === 0 && cur) { cur.end = tagRe.lastIndex; cur.outer = html.slice(cur.start, cur.end); out.push(cur); cur = null; }
            if (depth < 0) throw new Error('unbalanced markup near ' + m.index);
            continue;
        }
        if (VOID.has(tag) || selfClose) {
            if (depth === 0) out.push({ tag, id: (attrs.match(/\bid="([^"]+)"/) || [])[1], start: m.index, end: tagRe.lastIndex, outer: m[0] });
            continue;
        }
        if (depth === 0) cur = { tag, id: (attrs.match(/\bid="([^"]+)"/) || [])[1], cls: (attrs.match(/\bclass="([^"]+)"/) || [])[1] || '', start: m.index };
        depth++;
    }
    if (depth !== 0) throw new Error('unbalanced markup at end');
    return out;
}

/** The inner HTML of an element's outerHTML. */
const innerOf = (outer) => outer.slice(outer.indexOf('>') + 1, outer.lastIndexOf('</'));

const words = (text) => new Set(text.match(/[A-Za-z_$][\w$]*/g) || []);

/**
 * A top-level statement a React page replaced (src/pages/<id>/react.json "replaces"): a function
 * declaration of that name, or a const/let/var whose every declared name is replaced (the page's
 * own constants, e.g. BRAND_FIELDS_SERVED, which otherwise fall into core as dead code).
 */
function replacedStatement(node, replaced) {
    if (node.type === 'FunctionDeclaration') return replaced.has(node.id.name);
    if (node.type === 'VariableDeclaration') return node.declarations.every(d => d.id.type === 'Identifier' && replaced.has(d.id.name));
    // `window.X = X;` exposing a replaced function: the React page registers X on window itself (react.json
    // `provides`), and left behind this would read a function that no longer exists, at load.
    if (node.type === 'ExpressionStatement') {
        const e = node.expression;
        // `window.addEventListener('keydown', X);` binding a replaced function: the React page binds it on
        // mount (and unbinds it), so the page's handler acts only while the page exists.
        if (e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && !e.callee.computed
            && e.callee.object.type === 'Identifier' && e.callee.object.name === 'window' && e.callee.property.name === 'addEventListener'
            && e.arguments.length === 2 && e.arguments[1].type === 'Identifier' && replaced.has(e.arguments[1].name)) return true;
        return e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'MemberExpression' && !e.left.computed
            && e.left.object.type === 'Identifier' && e.left.object.name === 'window' && e.right.type === 'Identifier'
            && e.left.property.name === e.right.name && replaced.has(e.right.name);
    }
    return false;
}

/**
 * A whole classic script less what React replaced: each top-level statement replacedStatement() matches
 * leaves together with the text that leads into it (its comments), exactly as the app script's
 * statements do. Used for every script the split emits whole (production-graph.js, shell.js), so a
 * react.json can replace code wherever the source keeps it. Returns the text and the names it declares.
 */
function cutScript(code, replaced) {
    const ast = parse(code);
    let out = '', prev = 0;
    const declared = new Set();
    for (const n of ast.body) {
        if (n.type === 'FunctionDeclaration') declared.add(n.id.name);
        if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') declared.add(d.id.name);
        if (!replacedStatement(n, replaced)) out += code.slice(prev, n.end);
        prev = n.end;
    }
    return { code: out + code.slice(prev), declared };
}

/**
 * Calls of `names` that run while a script LOADS: its top-level statements, and the body of a function
 * it calls on the spot (an IIFE; shell.js is one). A call inside any other function body runs later,
 * when something calls that function. A React page or component registers what it provides when it
 * mounts, so a load-time call is the one kind that could find the name missing.
 * Returns [{ name, at }] (at: the character offset of the call).
 */
function loadTimeCalls(code, names) {
    const want = names instanceof Set ? names : new Set(names);
    const found = [];
    const isFn = (n) => n && /^(FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
    const calledName = (c) => c.type === 'Identifier' ? c.name
        : c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'window' ? c.property.name : null;
    const visit = (n) => {
        if (!n || typeof n.type !== 'string') return;
        if (n.type === 'FunctionDeclaration' || isFn(n) || n.type === 'ClassDeclaration' || n.type === 'ClassExpression') return;
        if (n.type === 'CallExpression' || n.type === 'NewExpression') {
            const name = calledName(n.callee);
            if (name && want.has(name)) found.push({ name, at: n.start });
            // An IIFE: its body runs now.
            const callee = n.callee.type === 'ParenthesizedExpression' ? n.callee.expression : n.callee;
            if (isFn(callee)) visit(callee.body);
        }
        for (const k of Object.keys(n)) {
            if (k === 'type' || k === 'start' || k === 'end') continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach(visit);
            else if (v && typeof v.type === 'string') visit(v);
        }
    };
    visit(parse(code));
    return found;
}

/*
 * The calls of a React-registered name that the legacy code makes while it LOADS, each with why it is
 * safe: main.jsx mounts App synchronously before any legacy script, and registration is a layout effect
 * (tools/tests/react-pages.test.js holds both). Any other load-time call fails the split: a new one is a
 * decision, made here, not an accident.
 */
const LOAD_TIME_CALLS = {
    loadProjects: 'core INIT: loadProjects().then(applyRoute) restores the route at boot (ProjectsPage registers it)',
};

module.exports = { LOAD_TIME_CALLS, cutScript, loadTimeCalls, replacedStatement, parse, readSource, loaderMap, topLevelFunctions, topLevelElements, innerOf, words };
