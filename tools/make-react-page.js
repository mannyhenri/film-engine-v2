#!/usr/bin/env node
/*
 * Write a React page whose frame is the legacy markup, converted (tools/html-to-jsx.js), and whose behaviour is an
 * engine module moved from the legacy code (tools/extract-engine.js). The page:
 *   - registers its loader (and anything react.json provides) by name with usePageLoader;
 *   - if it OWNS the engine, puts every engine function on window while mounted, because the engine and core draw
 *     HTML with inline handlers that call them by name;
 *   - renders the frame once: the engine draws into it by id, so React never re-renders it.
 *
 *   node tools/make-react-page.js <spec.json>
 *   spec: { "id": "music", "component": "MusicPage", "markup": "(optional; else the reference's page)", "engine": "../music/engine.js",
 *           "loader": "loadMusic", "provides": [...], "ownsEngine": true, "about": "one paragraph" }
 *
 * Handlers resolve to the engine when it exports the name, else to core through legacy (LEGACY_GLOBALS). The page's
 * test must still compare the rendered DOM to the reference markup: this tool is trusted only that far.
 */
const fs = require('fs');
const path = require('path');
const { htmlToJsx } = require('./html-to-jsx');

const ROOT = path.join(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const pageDir = path.join(ROOT, 'src/pages', spec.id);
const enginePath = path.resolve(pageDir, spec.engine);
const engineSrc = fs.readFileSync(enginePath, 'utf8');
const exported = new Set(engineSrc.match(/^export \{([\s\S]*?)\};/m)[1].split(',').map(s => s.trim()).filter(Boolean));
for (const n of [spec.loader, ...(spec.provides || [])]) if (!exported.has(n)) throw new Error(`${n} is not exported by ${spec.engine}`);

const used = new Set();
// The markup: a file if the spec names one, else the page's own element in the reference (what the page's test
// compares against), so a page can be regenerated after its markup.html is gone.
function referenceMarkup(id) {
    const { JSDOM } = require('jsdom');
    const ref = fs.readFileSync(path.join(ROOT, 'reference/fb8c770/src/index.html'), 'utf8');
    const start = ref.indexOf(`<div class="page" id="page-${id}">`);
    if (start < 0) throw new Error(`page-${id} is not in the reference`);
    const end = ref.indexOf('<div class="page" id="page-', start + 10);
    const doc = new JSDOM(`<body>${ref.slice(start, end < 0 ? undefined : end)}</body>`).window.document;
    return doc.getElementById(`page-${id}`).outerHTML;
}
const markup = spec.markup ? fs.readFileSync(path.resolve(ROOT, spec.markup), 'utf8') : referenceMarkup(spec.id);
const jsx = htmlToJsx(markup, {
    depth: 2, handler: (n) => { used.add(n); return exported.has(n) ? `E.${n}` : `legacy.${n}`; },
});
const usesLegacy = [...used].some(n => !exported.has(n));
const imports = [
    spec.ownsEngine ? "import { useLayoutEffect } from 'react';" : null,
    "import { usePageLoader } from '../../lib/usePageLoader.js';",
    usesLegacy ? "import { legacy } from '../../lib/legacy.js';" : null,
    `import * as E from '${spec.engine}';`,
].filter(Boolean).join('\n');
const register = spec.ownsEngine ? `
    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        return () => {
            for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; }
        };
    }, []);` : '';
const provides = (spec.provides || []).length
    ? `    // What legacy code calls by name (react.json provides).\n${spec.provides.map(n => `    usePageLoader('${n}', E.${n});`).join('\n')}\n` : '';
const out = `${imports}

/*
 * ${spec.about.replace(/\n/g, '\n * ')}
 *
 * The frame is GENERATED from the legacy markup by tools/make-react-page.js (tools/html-to-jsx.js); its test holds it
 * to the reference markup element by element. Regenerate it rather than editing the frame by hand.
 */
${spec.ownsEngine ? "export const ENGINE = Object.entries(E).filter(([, v]) => typeof v === 'function');\n\n" : ''}export default function ${spec.component}() {
    usePageLoader('${spec.loader}', E.${spec.loader});
${provides}${register}
    return (
        <>
${jsx}        </>
    );
}
`;
fs.writeFileSync(path.join(pageDir, `${spec.component}.jsx`), out);
console.log(`src/pages/${spec.id}/${spec.component}.jsx: ${used.size} handlers (${[...used].filter(n => !exported.has(n)).join(', ') || 'none'} through core)`);
