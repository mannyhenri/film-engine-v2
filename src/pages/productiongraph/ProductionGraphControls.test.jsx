import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { installLegacy } from '../../test/setup.js';

/*
 * Every control the legacy Production graph markup bound (onclick="pgTidy()", onclick="pgZoomBy(1/1.15)"), found on
 * the React page and operated, must call the SAME engine function with the SAME arguments. Derived from the
 * reference markup, so a control the React page drops, or wires to the wrong function, fails.
 */
vi.mock('./engine.js', async (importOriginal) => {
    const real = await importOriginal();
    const wrapped = {};
    for (const [k, v] of Object.entries(real)) wrapped[k] = typeof v === 'function' ? vi.fn(v) : v;
    return wrapped;
});
const P = await import('./engine.js');
const { default: ProductionGraphPage } = await import('./ProductionGraphPage.jsx');

const REF = fs.readFileSync(path.resolve(__dirname, '../../../reference/fb8c770/src/index.html'), 'utf8');
const start = REF.indexOf('<div class="page" id="page-productiongraph">');
const LEGACY = REF.slice(start, REF.indexOf('<div class="page" id="page-', start + 10));
const doc = new DOMParser().parseFromString(`<body>${LEGACY}</body>`, 'text/html');
const BOUND = [];
for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of el.getAttributeNames().filter(a => /^on[a-z]+$/.test(a))) {
        const m = el.getAttribute(attr).match(/^([A-Za-z_$][\w$]*)\((.*)\)$/);
        BOUND.push({ el, event: attr.slice(2), handler: m[1], args: m[2].trim() });
    }
}
// The React element standing where the legacy one stood: by id, else by title, else by tag and text.
function counterpart(el) {
    if (el.id) return document.getElementById(el.id);
    if (el.title) return document.querySelector(`${el.tagName}[title="${el.title}"]`);
    const text = el.textContent.trim();
    return [...document.querySelectorAll(el.tagName)].find(x => x.textContent.trim() === text) || null;
}
const label = (b) => `${b.event} ${b.handler}(${b.args}) on <${b.el.tagName.toLowerCase()}${b.el.id ? '#' + b.el.id : ''}> "${(b.el.title || b.el.textContent).trim().slice(0, 30)}"`;

beforeEach(() => {
    installLegacy();
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    for (const v of Object.values(P)) if (vi.isMockFunction(v)) { v.mockClear(); v.mockImplementation(() => {}); }
});
afterEach(() => vi.restoreAllMocks());

describe('Production graph: every control the legacy page bound is bound on the React page', () => {
    it('the reference markup was read (this check runs over something)', () => {
        expect(BOUND.length).toBeGreaterThanOrEqual(7);
        for (const h of ['pgTidy', 'pgToggleLock', 'pgRunChanged', 'pgRunPending', 'pgZoomBy', 'pgFit']) expect(BOUND.map(b => b.handler)).toContain(h);
    });
    it.each(BOUND.map(b => [label(b), b]))('%s', (_, b) => {
        render(<ProductionGraphPage />);
        const el = counterpart(b.el);
        expect(el, 'no counterpart on the React page').toBeTruthy();
        // Operated as a person would: a checkbox is toggled by a click (which is what React listens to for it).
        if (b.event === 'click' || el.type === 'checkbox') fireEvent.click(el); else fireEvent[b.event](el, { target: {} });
        const spy = P[b.handler];
        expect(vi.isMockFunction(spy), `${b.handler} is not an engine export`).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);
        const call = spy.mock.calls[0];
        if (b.args === '') expect(call).toEqual([]);
        else if (b.args === 'event') expect(call[0]).toBeInstanceOf(window.Event);
        else expect(call).toEqual(Function(`return [${b.args}]`)());
    });
});
