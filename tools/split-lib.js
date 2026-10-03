// Reading the source app: the one-file index.html of ../film-engine.
const fs = require('fs');
const acorn = require('acorn');

const parse = (code) => acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });

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

module.exports = { parse, readSource, loaderMap, topLevelFunctions, topLevelElements, innerOf, words };
