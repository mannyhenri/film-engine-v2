// Legacy page markup -> JSX, mechanically, for a page whose markup is converted rather than retyped.
//
//   const { htmlToJsx } = require('./html-to-jsx');
//   htmlToJsx(html, { handler: (name) => `E.${name}` })   // -> JSX source text
//
// It refuses what it does not know (an attribute, a handler that is not one call with plain arguments)
// rather than guessing, so a converted page is the legacy markup or the conversion fails. The page's test
// then renders the result and compares its DOM to the legacy markup element by element; this tool is only
// trusted as far as that comparison goes.
//
// Inline handlers become React props calling the same function with the same arguments: `event` is the
// native event (what the legacy handler received), and `this` is the element (event.currentTarget).
// Values a person edits (value on input/textarea, checked, selected options) become defaultValue /
// defaultChecked, so React sets them once and the legacy code that reads and writes them owns them after.
const { JSDOM } = require('jsdom');

const ATTR = {
    class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
    contenteditable: 'contentEditable', spellcheck: 'spellCheck', colspan: 'colSpan', rowspan: 'rowSpan',
    autocomplete: 'autoComplete', autofocus: 'autoFocus', viewbox: 'viewBox', 'stroke-dasharray': 'strokeDasharray',
    'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-dashoffset': 'strokeDashoffset',
    'fill-rule': 'fillRule', 'clip-rule': 'clipRule',
};
const PLAIN = new Set(['id', 'title', 'type', 'placeholder', 'name', 'href', 'src', 'alt', 'role', 'width', 'height',
    'r', 'cx', 'cy', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'd', 'fill', 'stroke', 'transform', 'min', 'max', 'step', 'accept',
    'target', 'rel', 'rows', 'cols', 'draggable', 'disabled', 'hidden', 'multiple', 'value', 'checked', 'selected', 'style',
    'viewBox', 'download', 'lang', 'dir']);
const EVENTS = { onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onkeydown: 'onKeyDown', onkeyup: 'onKeyUp',
    onsubmit: 'onSubmit', onblur: 'onBlur', onfocus: 'onFocus', ondblclick: 'onDoubleClick', onmousedown: 'onMouseDown' };
const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'source', 'col', 'area', 'wbr']);
const BOOLEAN = new Set(['disabled', 'hidden', 'multiple', 'checked', 'selected', 'readonly', 'autofocus']);

const js = (s) => JSON.stringify(s);
// A JSX attribute string takes no escapes and decodes entities, so a value with a backslash, a quote, a line break
// or an ampersand goes in as an expression; anything else stays a plain quoted string.
const attrValue = (v) => (/[\\"\n\r\t&]/.test(v) ? `{${js(v)}}` : js(v));
const camel = (p) => p.trim().replace(/^-(webkit|moz|ms)-/, (_, v) => v + '-').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function styleObject(text) {
    const parts = text.split(';').map(s => s.trim()).filter(Boolean).map(decl => {
        const i = decl.indexOf(':');
        if (i < 0) throw new Error(`style declaration without a colon: ${decl}`);
        return `${js(camel(decl.slice(0, i)))}: ${js(decl.slice(i + 1).trim())}`;
    });
    return `{{ ${parts.join(', ')} }}`;
}

// One call, plain arguments: f(), f(event), f(this.value), f('x'), f(1/1.15), f(false).
function handlerProp(code, resolve) {
    const m = code.trim().replace(/;$/, '').match(/^([A-Za-z_$][\w$]*)\((.*)\)$/s);
    if (!m) throw new Error(`a handler that is not one call: ${code}`);
    const args = m[2].trim();
    if (/[;{}]|=>|\bfunction\b/.test(args)) throw new Error(`a handler whose arguments are code: ${code}`);
    const mapped = args.replace(/\bthis\b/g, 'event.currentTarget').replace(/\bevent\b(?!\.currentTarget)/g, 'event.nativeEvent');
    return `{(event) => ${resolve(m[1])}(${mapped})}`;
}

function attrs(el, resolve) {
    const tag = el.tagName.toLowerCase();
    const out = [];
    for (const { name, value } of [...el.attributes]) {
        const n = name.toLowerCase();
        if (EVENTS[n]) { out.push(`${EVENTS[n]}=${handlerProp(value, resolve)}`); continue; }
        if (n === 'style') { out.push(`style=${styleObject(value)}`); continue; }
        if (n.startsWith('data-') || n.startsWith('aria-')) { out.push(`${n}=${attrValue(value)}`); continue; }
        if (n === 'value' && (tag === 'input' || tag === 'textarea')) { out.push(`defaultValue=${attrValue(value)}`); continue; }
        if (n === 'checked') { out.push('defaultChecked'); continue; }
        if (n === 'selected') continue; // the <select>'s defaultValue says which, below
        if (n === 'contenteditable') { out.push(`contentEditable=${js(value || 'true')}`, 'suppressContentEditableWarning'); continue; }
        const prop = ATTR[n] || (PLAIN.has(name) ? name : PLAIN.has(n) ? n : null);
        if (!prop) throw new Error(`<${tag}> has an attribute this converter does not know: ${name}`);
        if (BOOLEAN.has(n) && (value === '' || value === n)) { out.push(prop); continue; }
        out.push(`${prop}=${attrValue(value)}`);
    }
    if (tag === 'select') {
        const opts = [...el.querySelectorAll('option')];
        const sel = opts.find(o => o.hasAttribute('selected'));
        if (sel) out.push(`defaultValue=${attrValue(sel.getAttribute('value') ?? sel.textContent)}`);
    }
    if (tag === 'textarea' && el.textContent) out.push(`defaultValue=${attrValue(el.textContent)}`);
    return out;
}

// Text as JSX, exactly: whitespace collapsed as a browser renders it, and every space that survives
// collapsing written as {' '} where JSX would otherwise drop it (a line's edges, a text node of only space:
// the gap between two inline buttons). Braces and angle brackets are literals.
function text(s) {
    const t = s.replace(/\s+/g, ' ');
    if (t === '') return '';
    if (t === ' ') return "{' '}";
    // One text node, as the markup has it: a text with a space at either edge is one expression, not a space
    // node, a text node and another space node (React would render three where the browser had one).
    return t !== t.trim() || /[{}<>&]/.test(t) ? `{${js(t)}}` : t;
}

function node(n, resolve, depth) {
    const pad = '    '.repeat(depth);
    if (n.nodeType === 3) { const t = text(n.textContent); return t ? pad + t + '\n' : ''; }
    if (n.nodeType === 8) return `${pad}{/*${n.textContent.replace(/\*\//g, '* /')}*/}\n`;
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    const svg = n.namespaceURI === 'http://www.w3.org/2000/svg';
    const name = svg ? n.tagName : tag;
    const a = attrs(n, resolve);
    const open = `<${name}${a.length ? ' ' + a.join(' ') : ''}`;
    if (VOID.has(tag) || tag === 'textarea') return `${pad}${open} />\n`; // a textarea's text is its defaultValue
    const body = [...n.childNodes].map(k => node(k, resolve, depth + 1)).join('');
    return body ? `${pad}${open}>\n${body}${pad}</${name}>\n` : `${pad}${open}></${name}>\n`;
}

/** The markup's top-level elements as JSX, indented `depth` levels; `handler(name)` is the expression a call resolves to. */
function htmlToJsx(html, { handler, depth = 2 } = {}) {
    if (typeof handler !== 'function') throw new Error('htmlToJsx needs a handler(name) resolver');
    const { window } = new JSDOM(`<!DOCTYPE html><body><template>${html}</template></body>`);
    const frag = window.document.querySelector('template').content;
    return [...frag.childNodes].map(n => node(n, handler, depth)).join('');
}

module.exports = { htmlToJsx };
