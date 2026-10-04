/*
 * The reference page (reference/fb8c770/src/index.html), for tests that hold a React page to the legacy markup it
 * was generated from: a page's slice of the reference, and a strict walk of what a person sees of a DOM tree.
 */
import fs from 'fs';
import path from 'path';

const REF = fs.readFileSync(path.resolve(__dirname, '../../reference/fb8c770/src/index.html'), 'utf8');

/** The legacy markup of one page: its `<div class="page" id="page-<id>">` element, and nothing after it. */
export function legacyMarkup(id) {
    const start = REF.indexOf(`<div class="page" id="page-${id}">`);
    if (start < 0) throw new Error(`page-${id} is not in the reference`);
    const end = REF.indexOf('<div class="page" id="page-', start + 10);
    // The page element alone: what follows it before the next page can be a modal's markup, which is not the page's.
    const doc = new DOMParser().parseFromString(`<body>${REF.slice(start, end < 0 ? undefined : end)}</body>`, 'text/html');
    return doc.getElementById(`page-${id}`).outerHTML;
}

/** Every inline handler of a piece of legacy markup: the element, the event, the function and its arguments. */
export function legacyHandlers(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const out = [];
    for (const el of doc.body.querySelectorAll('*')) {
        for (const attr of el.getAttributeNames().filter(a => /^on[a-z]+$/.test(a))) {
            const m = el.getAttribute(attr).match(/^([A-Za-z_$][\w$]*)\((.*)\)$/s);
            if (!m) throw new Error(`a handler that is not one call: ${el.getAttribute(attr)}`);
            out.push({ el, event: attr.slice(2), handler: m[1], args: m[2].trim() });
        }
    }
    return out;
}

/**
 * What a person sees of a tree, in order: each element's tag, attributes (inline handlers aside: React binds them),
 * style as the browser parses it, and what a field shows; every text node, collapsed as HTML collapses it (spaces,
 * tabs, line breaks; &nbsp; is content) and never dropped, since a space between two inline buttons is a gap.
 */
export function domWalk(root) {
    const out = [];
    const describe = (el) => {
        const attrs = [...el.attributes].filter(a => !/^on[a-z]+$/.test(a.name) && !['value', 'checked', 'selected', 'style'].includes(a.name))
            .map(a => `${a.name}=${a.value}`).sort();
        const style = el.getAttribute('style') ? `style=${el.style.cssText}` : '';
        const field = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? `field=${el.type === 'checkbox' ? el.checked : el.value}` : '';
        return [el.tagName.toLowerCase(), ...attrs, style, field].filter(Boolean).join(' ');
    };
    const visit = (n) => {
        if (n.nodeType === 1) { out.push('<' + describe(n)); n.childNodes.forEach(visit); out.push('>'); }
        else if (n.nodeType === 3) { const t = n.textContent.replace(/[ \t\n\r\f]+/g, ' '); if (t) out.push('"' + t); }
    };
    visit(root);
    return out;
}
