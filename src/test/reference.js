/*
 * The reference page (reference/fb8c770/src/index.html), for tests that hold a React page to the legacy markup it
 * was generated from: a page's slice of the reference, and a strict walk of what a person sees of a DOM tree.
 */
import path from 'path';
import { createRequire } from 'module';

// As the split reads it (tools/split-lib.js readSource): without what the user retired (RETIRED).
const { readSource } = createRequire(import.meta.url)('../../tools/split-lib.js');
const REF = readSource(path.resolve(__dirname, '../../reference/fb8c770/src/index.html')).text;

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

/** The names of what v2 adds on purpose beside legacy markup (data-v2-added="<name>"); anything else is a difference. */
export const V2_ADDED = ['list-controls', 'update-storyboard'];

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
        // What v2 adds on purpose beside legacy markup, named: the bar of a list an engine draws (src/lib/drawn-list.jsx),
        // and the Screenplay's Update storyboard button (src/components/UpdateStoryboard).
        if (n.nodeType === 1 && n.hasAttribute('data-v2-added')) {
            if (!V2_ADDED.includes(n.getAttribute('data-v2-added'))) throw new Error(`unknown data-v2-added="${n.getAttribute('data-v2-added')}"`);
            return;
        }
        if (n.nodeType === 1) { out.push('<' + describe(n)); n.childNodes.forEach(visit); out.push('>'); }
        else if (n.nodeType === 3) { const t = n.textContent.replace(/[ \t\n\r\f]+/g, ' '); if (t) out.push('"' + t); }
    };
    visit(root);
    return out;
}

/** An element's children as the reference markup has them: leaving out what v2 adds on purpose (data-v2-added). */
export const frameChildren = (n) => [...n.children].filter(c => !c.hasAttribute('data-v2-added'));
