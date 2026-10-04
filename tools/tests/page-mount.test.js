// A page that takes over a legacy chunk also takes over what that chunk bound when it LOADED: document and window
// listeners, a window.callback the iPhone app calls, window.X = X exposures. The split drops those statements
// (split-lib replacedStatement, for an owner whose react.json declares "mount"); this proves every one it drops is
// done again by the page: an exposure names functions the page registers, and a binding is in the page's mount
// module with the reference's handler text, verbatim but for the bridge rewrite. Set-based over the dropped set.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { readSource, replacedStatement } = require('../split-lib');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGES = fs.readdirSync(path.join(ROOT, 'src/pages')).filter(id => fs.existsSync(path.join(ROOT, 'src/pages', id, 'react.json')))
    .map(id => ({ id, json: JSON.parse(read(`src/pages/${id}/react.json`)) }));
const REPLACED = new Map(PAGES.flatMap(p => p.json.replaces.map(n => [n, p.id])));
const MOUNTS = new Set(PAGES.filter(p => p.json.mount).map(p => p.id));
const APP = readSource(path.join(ROOT, 'reference/fb8c770/src/index.html')).app;
const STATEMENTS = acorn.parse(APP, { ecmaVersion: 'latest' }).body.filter(n => n.type === 'ExpressionStatement');
const squash = (s) => s.replace(/\blegacy\.(?=[A-Za-z_$])/g, '').replace(/\s+/g, ' ');

for (const { id, json } of PAGES.filter(p => p.json.mount)) {
    test(`${id}: everything its chunk bound at load, and the split drops, the page does again`, () => {
        const mount = read(`src/pages/${id}/${json.mount.replace(/^\.\//, '')}`);
        const dropped = STATEMENTS.filter(n => replacedStatement(n, REPLACED, { mounts: MOUNTS }) && [...APP.slice(n.start, n.end).matchAll(/[A-Za-z_$][\w$]*/g)].some(m => REPLACED.get(m[0]) === id));
        assert.ok(dropped.length > 0, `${id} declares a mount and the split drops nothing of its: the scan is broken`);
        const bad = [];
        for (const n of dropped) {
            const e = n.expression;
            const text = APP.slice(n.start, n.end);
            const exposed = e.type === 'AssignmentExpression' && e.right.type === 'Identifier' ? [e.right.name]
                : e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && e.callee.object.name === 'Object' ? e.arguments[1].properties.map(p => p.value.name) : null;
            if (exposed) { for (const x of exposed) if (!json.replaces.includes(x)) bad.push(`${x} is exposed on window by the chunk and the page does not own it`); continue; }
            const handler = e.type === 'CallExpression' ? e.arguments[1] : e.right;
            if (!squash(mount).includes(squash(APP.slice(handler.start, handler.end)))) bad.push(`not bound by the page: ${text.slice(0, 90)}`);
            if (e.type === 'CallExpression' && !new RegExp(`${e.callee.object.name}\\.addEventListener\\(${JSON.stringify(e.arguments[0].value)}`).test(mount)) bad.push(`not bound on ${e.callee.object.name} for ${e.arguments[0].value}: ${text.slice(0, 60)}`);
            if (e.type === 'AssignmentExpression' && !new RegExp(`window\\.${e.left.property.name} = h\\d+`).test(mount)) bad.push(`window.${e.left.property.name} is not set by the page`);
        }
        assert.deepStrictEqual(bad, []);
    });
}

test('a mount is declared by the page whose statements it binds, and the file exists (this runs over something)', () => {
    assert.ok(MOUNTS.size > 0, 'no page declares a mount');
    for (const { id, json } of PAGES.filter(p => p.json.mount)) assert.ok(fs.existsSync(path.join(ROOT, 'src/pages', id, json.mount)), `${id}: ${json.mount} is missing`);
});
