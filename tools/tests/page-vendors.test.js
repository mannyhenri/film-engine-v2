// A vendored library (three.js) is a global its script sets, loaded on demand before the code that needs it.
// It used to be a CHUNK's dependency; once a page's code moves into a React engine module there is no chunk, so the
// PAGE declares it (react.json "vendors"), the registry carries it, and __fePages.ensure loads it before the loader.
// Set-based over every page engine module and every vendor global: an engine that uses THREE on a page that does
// not declare three would throw "THREE is not defined" on the first 3D call, and only in the real app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SPLIT = read('tools/split-map.js');
const VENDORS = Function(`return ${SPLIT.match(/const VENDORS = (\[[^\n]*\]);/)[1]}`)();
const REGISTRY = read('src/pages/registry.js');
const PAGES = fs.readdirSync(path.join(ROOT, 'src/pages')).filter(id => fs.existsSync(path.join(ROOT, 'src/pages', id, 'react.json')));

function freeIdentifiers(code) {
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
    let globals = [];
    traverse(ast, { Program(p) { p.scope.crawl(); globals = Object.keys(p.scope.globals); } });
    return new Set(globals);
}
/** The engine modules a page imports from its own folder or another page's (music's pages share one). */
function enginesOf(id) {
    const dir = path.join(ROOT, 'src/pages', id);
    const own = fs.readdirSync(dir).filter(f => /\.jsx?$/.test(f) && !f.includes('.test.')).map(f => read(`src/pages/${id}/${f}`)).join('\n');
    return [...own.matchAll(/from '(\.\.?\/[^']+\.js)'/g)].map(m => path.join('src/pages', id, m[1])).filter(f => fs.existsSync(path.join(ROOT, f)));
}

test('the vendor table was read (this runs over something)', () => {
    assert.ok(VENDORS.some(v => v.global === 'THREE'), JSON.stringify(VENDORS));
});

for (const id of PAGES) {
    test(`${id}: every vendor global its engine uses is declared, and the registry carries it`, () => {
        const json = JSON.parse(read(`src/pages/${id}/react.json`));
        const declared = json.vendors || [];
        for (const v of declared) assert.ok(VENDORS.some(x => x.id === v), `${id}: declares an unknown vendor ${v}`);
        const used = new Set(enginesOf(id).flatMap(f => VENDORS.filter(v => freeIdentifiers(read(f)).has(v.global)).map(v => v.id)));
        assert.deepStrictEqual([...used].filter(v => !declared.includes(v)), [], `${id}: its engine uses these vendors and the page does not declare them`);
        const entry = REGISTRY.match(new RegExp(`\\{ id: '${id}',[^\\n]*\\}`));
        assert.ok(entry, `${id} is not in the registry`);
        const carried = (entry[0].match(/vendors: (\[[^\]]*\])/) || [, '[]'])[1];
        assert.deepStrictEqual(JSON.parse(carried.replace(/'/g, '"')), declared, `${id}: the registry does not carry its vendors`);
    });
}
