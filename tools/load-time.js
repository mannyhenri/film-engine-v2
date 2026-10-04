#!/usr/bin/env node
/*
 * Load-time core (category (d) of tools/core-ownership.js), split in two. Only the first half must stay in a classic
 * script; the second can move once whatever reaches it (the listener, the timer, the table) reaches it another way.
 *
 *   RUNS       executed while the scripts load: core.js, shell.js and production-graph.js's top-level statements and
 *              initialisers, the bodies of IIFEs, and every function they CALL synchronously, transitively. A call is
 *              synchronous when it is a plain call, a callback of an array method that runs it at once (SYNC_METHODS),
 *              or a Promise executor. An async function's whole body counts as run: that errs toward keeping it.
 *   REACHABLE  reached from load-time code only through something that runs LATER, with how (`via`):
 *              listener   an addEventListener argument, or a function assigned to an on* property;
 *              timer      setTimeout / setInterval / requestAnimationFrame / requestIdleCallback / queueMicrotask;
 *              promise    a then / catch / finally callback;
 *              table      a value in an object or array literal (the router's targets);
 *              by name    a name inside a string (the HTML core draws: onclick="f()");
 *              callback   inside some other function that is not called at load;
 *              reference  any other use that is not a call;
 *              through X  reached from X, which is itself only reachable.
 *
 *   node tools/load-time.js     (prints the counts; the report is part of docs/core-ownership.md)
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const SYNC_METHODS = new Set(['forEach', 'map', 'filter', 'some', 'every', 'reduce', 'reduceRight', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'sort', 'from']);
const TIMERS = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask']);
const PROMISE = new Set(['then', 'catch', 'finally']);
const isFn = (n) => n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration');
const children = (n) => {
    const out = [];
    for (const k of Object.keys(n)) {
        if (k === 'type' || k === 'start' || k === 'end') continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') out.push([x, k]); } else if (v && typeof v.type === 'string') out.push([v, k]);
    }
    return out;
};
/** The name a callee resolves to: f(), window.f(), legacy.f(). */
const calleeName = (c) => {
    if (c.type === 'Identifier') return c.name;
    if (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && (c.object.name === 'window' || c.object.name === 'legacy')) return c.property.name;
    return null;
};
const methodName = (c) => (c.type === 'MemberExpression' && !c.computed ? c.property.name : null);

const isFreeze = (c) => c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'Object' && c.property.name === 'freeze';
/** A name that is not a reference: a property after a dot (except window. and legacy.), or an object literal's key. */
const isPropertyName = (n, parent, key) => !!parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed
    && !(parent.object.type === 'Identifier' && (parent.object.name === 'window' || parent.object.name === 'legacy')))
    || (parent.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand));

/** Is this function node called right away where it stands (an IIFE, an array method's callback, a Promise executor)? */
function invokedNow(fn, parent, key) {
    if (!parent) return false;
    if (parent.type === 'CallExpression' && key === 'callee') return true;
    if (parent.type === 'CallExpression' && key === 'arguments') return SYNC_METHODS.has(methodName(parent.callee));
    if (parent.type === 'NewExpression' && key === 'arguments') return parent.callee.type === 'Identifier' && parent.callee.name === 'Promise';
    return false;
}

function analyse(scripts) {
    const decls = new Map(); // name -> { node (function or init), file }
    const roots = [];        // { label, node }: a statement that runs at load
    for (const { file, code } of scripts) {
        const ast = acorn.parse(code, { ecmaVersion: 'latest' });
        for (const n of ast.body) {
            if (n.type === 'FunctionDeclaration') decls.set(n.id.name, { node: n, file });
            else if (n.type === 'VariableDeclaration') {
                // A var with no value is a React loader's placeholder: wiring, not a declaration (as in core-ownership).
                for (const d of n.declarations) if (d.id.type === 'Identifier' && d.init) decls.set(d.id.name, { node: d.init, file, isVar: true });
            } else roots.push({ label: `${file} at load`, node: n, code });
        }
        for (const n of ast.body) if (n.type === 'VariableDeclaration') for (const d of n.declarations) {
            if (d.id.type === 'Identifier' && d.init) roots.push({ label: d.id.name, node: d.init, code, isInit: true });
        }
        for (const [, d] of decls) if (d.file === file) d.code = code;
    }
    const names = new Set(decls.keys());

    // RUNS: walk what executes now, entering a function only where it is invoked now.
    const runs = new Set();
    const queue = [];
    const run = (name) => { if (names.has(name) && !runs.has(name)) { runs.add(name); queue.push(name); } };
    const walkNow = (n, parent, key) => {
        if (!n) return;
        if (isFn(n) && parent !== null && !invokedNow(n, parent, key)) return;
        if (n.type === 'CallExpression' || n.type === 'NewExpression') {
            const name = calleeName(n.callee);
            if (name) run(name);
            // An identifier handed to something that runs it now: arr.forEach(f), new Promise(f).
            const now = n.type === 'NewExpression' ? n.callee.type === 'Identifier' && n.callee.name === 'Promise' : SYNC_METHODS.has(methodName(n.callee));
            if (now) for (const a of n.arguments) { const an = calleeName(a); if (an) run(an); }
        }
        // A variable read by code that runs now is needed now. (Only its value: reading it runs nothing more.)
        if (n.type === 'Identifier' && decls.get(n.name)?.isVar && !isPropertyName(n, parent, key)) run(n.name);
        for (const [c, k] of children(n)) walkNow(c, n, k);
    };
    // An initialiser runs at load whatever reads it; its variable counts as run only when that runs code (a call),
    // not when it is data (an object, Object.freeze of one, an empty Map): data is needed only by what reads it.
    const callsNow = (n, parent, key) => {
        if (!n || (isFn(n) && !invokedNow(n, parent, key))) return false;
        if ((n.type === 'CallExpression' && !isFreeze(n.callee)) || (n.type === 'NewExpression' && !(n.callee.type === 'Identifier' && /^(Weak)?(Map|Set)$/.test(n.callee.name) && !n.arguments.length))) return true;
        return children(n).some(([c, k]) => callsNow(c, n, k));
    };
    for (const r of roots) { if (r.isInit && callsNow(r.node, null, null)) run(r.label); walkNow(r.node, null, null); }
    while (queue.length) {
        const d = decls.get(queue.shift());
        if (d.node && !d.isVar) walkNow(d.node.body, d.node, 'body');
    }

    // REACHABLE: every name a runner or a root refers to, then onward; the first referrer decides how.
    const reachable = new Map();
    const refsOf = (node, code) => {
        const out = new Map(); // name -> via
        const visit = (n, stack) => {
            if (!n) return;
            if (n.type === 'Identifier' && names.has(n.name)) {
                const [parent, key] = stack[stack.length - 1] || [];
                if (!isPropertyName(n, parent, key) && !out.has(n.name)) out.set(n.name, classify(stack));
            }
            if ((n.type === 'Literal' && typeof n.value === 'string') || n.type === 'TemplateElement') {
                const s = n.type === 'Literal' ? n.value : n.value.raw;
                for (const m of s.matchAll(/[A-Za-z_$][\w$]*/g)) if (names.has(m[0]) && !out.has(m[0])) out.set(m[0], 'by name');
            }
            for (const [c, k] of children(n)) visit(c, [...stack, [n, k]]);
        };
        visit(node, []);
        return out;
    };
    const queue2 = [];
    const reach = (name, from, via, root) => {
        if (runs.has(name) || reachable.has(name)) return;
        reachable.set(name, { from, via, ...(root ? { root: true } : {}) });
        queue2.push(name);
    };
    // Seeds: the statements that run at load, and everything that runs (a function's body, a variable's initialiser).
    // A data initialiser nothing runs is not a seed: what it names is reached only if the variable is.
    for (const r of roots) if (!r.isInit) for (const [n, via] of refsOf(r.node, r.code)) reach(n, r.label, via, true);
    for (const n of runs) {
        const d = decls.get(n);
        if (d.node) for (const [t, via] of refsOf(d.isVar ? d.node : d.node.body, d.code)) if (t !== n) reach(t, n, via);
    }
    while (queue2.length) {
        const n = queue2.shift();
        const d = decls.get(n);
        if (d.node) for (const [t] of refsOf(d.isVar ? d.node : d.node.body, d.code)) if (t !== n) reach(t, n, `through ${n}`);
    }
    return { runs, reachable, files: Object.fromEntries([...decls].map(([n, d]) => [n, d.file])) };
}

/** How a reference reaches its target, from the path of [node, key] from its referrer down to it. */
function classify(stack) {
    // Innermost first: the first function on the path that is not invoked now defers it.
    for (let i = stack.length - 1; i >= 0; i--) {
        const [n] = stack[i];
        if (!isFn(n)) continue;
        const [parent, key] = stack[i - 1] || [];
        if (invokedNow(n, parent, key)) continue;
        return deferredBy(parent, key, stack[i - 2]) || 'callback';
    }
    const [parent, key] = stack[stack.length - 1] || [];
    const how = deferredBy(parent, key, stack[stack.length - 2]);
    if (how) return how;
    if (parent && ((parent.type === 'Property' && key === 'value') || parent.type === 'ArrayExpression')) return 'table';
    return 'reference';
}
/** What `parent` does with the value at `key`: hand it to a listener, a timer, a promise, or an on* property. */
function deferredBy(parent, key) {
    if (!parent) return null;
    if (parent.type === 'CallExpression' && key === 'arguments') {
        const name = calleeName(parent.callee) || methodName(parent.callee);
        if (name === 'addEventListener') return 'listener';
        if (TIMERS.has(name)) return 'timer';
        if (PROMISE.has(methodName(parent.callee))) return 'promise';
    }
    if (parent.type === 'AssignmentExpression' && key === 'right' && parent.left.type === 'MemberExpression'
        && !parent.left.computed && /^on/.test(parent.left.property.name)) return 'listener';
    return null;
}

/** The real thing: core.js, shell.js and production-graph.js, reported for core's declarations only. */
function loadTime() {
    const read = (f) => fs.readFileSync(path.join(ROOT, 'public/legacy', f), 'utf8');
    const r = analyse(['core.js', 'shell.js', 'production-graph.js'].map(file => ({ file, code: read(file) })));
    const core = (n) => r.files[n] === 'core.js';
    return {
        runs: new Set([...r.runs].filter(core)),
        reachable: new Map([...r.reachable].filter(([n]) => core(n))),
        all: r,
    };
}

module.exports = { analyse, loadTime };

if (require.main === module) {
    const L = loadTime();
    const byVia = {};
    for (const [, x] of L.reachable) { const k = x.via.startsWith('through') ? 'through' : x.via; byVia[k] = (byVia[k] || 0) + 1; }
    console.log(`load-time core: ${L.runs.size} run at load, ${L.reachable.size} only reachable (${Object.entries(byVia).map(([k, v]) => `${k} ${v}`).join(', ')})`);
}
