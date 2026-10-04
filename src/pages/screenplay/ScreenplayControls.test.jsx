import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { installLegacy } from '../../test/setup.js';

/*
 * Every control the legacy Screenplay markup bound (onclick="setViewMode('cards')", onchange="setElementType(this.value)",
 * onkeydown="onEditorKeydown(event)"), found on the React page and operated, must call the SAME function with the SAME
 * arguments: an engine function, or the core function it named. Derived from the reference markup.
 */
vi.mock('./engine.js', async (importOriginal) => {
    const real = await importOriginal();
    const wrapped = {};
    for (const [k, v] of Object.entries(real)) wrapped[k] = typeof v === 'function' ? vi.fn(v) : v;
    return wrapped;
});
const P = await import('./engine.js');
const { default: ScreenplayPage } = await import('./ScreenplayPage.jsx');

const REF = fs.readFileSync(path.resolve(__dirname, '../../../reference/fb8c770/src/index.html'), 'utf8');
const start = REF.indexOf('<div class="page" id="page-screenplay">');
const LEGACY = REF.slice(start, REF.indexOf('<div class="page" id="page-', start + 10));
const doc = new DOMParser().parseFromString(`<body>${LEGACY}</body>`, 'text/html');
const BOUND = [];
for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of el.getAttributeNames().filter(a => /^on[a-z]+$/.test(a))) {
        const m = el.getAttribute(attr).match(/^([A-Za-z_$][\w$]*)\((.*)\)$/);
        BOUND.push({ el, path: pathOf(el), event: attr.slice(2), handler: m[1], args: m[2].trim() });
    }
}
// Where the element stands in the page, as child indexes: the React page is the same tree (ScreenplayPage.test.jsx).
function pathOf(el) {
    const p = [];
    for (let n = el; n && n.id !== 'page-screenplay'; n = n.parentElement) p.unshift([...n.parentElement.children].indexOf(n));
    return p;
}
const at = (p) => p.reduce((n, i) => n.children[i], document.getElementById('page-screenplay'));
const label = (b) => `${b.event} ${b.handler}(${b.args}) on <${b.el.tagName.toLowerCase()}${b.el.id ? '#' + b.el.id : ''}> ${b.path.join('.')}`;
let legacy;
beforeEach(() => {
    legacy = installLegacy();
    for (const v of Object.values(P)) if (vi.isMockFunction(v)) { v.mockClear(); v.mockImplementation(() => {}); }
});
afterEach(() => vi.restoreAllMocks());

describe('Screenplay: every control the legacy page bound is bound on the React page', () => {
    it('the reference markup was read (this check runs over something)', () => {
        expect(BOUND.length).toBe(47);
    });
    it.each(BOUND.map(b => [label(b), b]))('%s', (_, b) => {
        render(<ScreenplayPage />);
        const el = at(b.path);
        expect(el && el.tagName, 'no element at that place').toBe(b.el.tagName);
        const spy = Object.keys(P).includes(b.handler) ? P[b.handler] : legacy.fake[b.handler];
        expect(vi.isMockFunction(spy), `${b.handler} is neither an engine export nor a core fake`).toBe(true);
        if (b.event === 'click') fireEvent.click(el);
        else if (b.event === 'change') fireEvent.change(el, { target: { value: el.value } });
        else fireEvent[{ input: 'input', keydown: 'keyDown', keyup: 'keyUp' }[b.event]](el, { key: 'a' });
        expect(spy).toHaveBeenCalledTimes(1);
        const call = spy.mock.calls[0];
        const expected = Function('event', 'el', `return [${b.args.replace(/\bthis\b/g, 'el')}]`)(spy.mock.calls[0][0], el);
        if (/\bevent\b/.test(b.args)) expect(call[0]).toBeInstanceOf(window.KeyboardEvent);
        else expect(call).toEqual(expected);
    });
});
