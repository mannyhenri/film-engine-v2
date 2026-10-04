import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { legacyMarkup, legacyHandlers, domWalk } from '../../test/reference.js';

/*
 * Flows, as React: the frame is the reference markup element by element, each legacy handler calls the same
 * function with the same arguments, the loader is registered, the engine is on window while mounted, and the
 * canvas's two document listeners (which the legacy chunk bound at load) are bound while the page is mounted.
 */
vi.mock('./engine.js', async (importOriginal) => {
    const real = await importOriginal();
    const wrapped = {};
    for (const [k, v] of Object.entries(real)) wrapped[k] = typeof v === 'function' ? vi.fn(v) : v;
    return wrapped;
});
const E = await import('./engine.js');
const FlowsPage = (await import('./FlowsPage.jsx')).default;
const JSON_ = (await import('./react.json')).default;

let legacy;
beforeEach(() => {
    legacy = installLegacy();
    for (const v of Object.values(E)) if (vi.isMockFunction(v)) { v.mockClear(); v.mockImplementation(() => {}); }
});
afterEach(() => vi.restoreAllMocks());

const ID = 'flows';
const pathOf = (el) => { const p = []; for (let n = el; n && n.id !== `page-${ID}`; n = n.parentElement) p.unshift([...n.parentElement.children].indexOf(n)); return p; };
const at = (p) => p.reduce((n, i) => n.children[i], document.getElementById(`page-${ID}`));

describe('Flows: the frame and its handlers', () => {
    it('renders the reference markup element by element', () => {
        render(<FlowsPage />);
        const ref = new DOMParser().parseFromString(`<body>${legacyMarkup(ID)}</body>`, 'text/html').getElementById(`page-${ID}`);
        const theirs = domWalk(ref), mine = domWalk(document.getElementById(`page-${ID}`));
        const first = theirs.findIndex((x, i) => x !== mine[i]);
        expect(first, `first difference at ${first}: reference ${theirs[first]} | React ${mine[first]}`).toBe(-1);
        expect(mine.length).toBe(theirs.length);
    });

    it('registers its loader', () => {
        render(<FlowsPage />);
        expect(typeof window[JSON_.loader]).toBe('function');
    });

    it.each(legacyHandlers(legacyMarkup(ID)).map(b => [`${b.event} ${b.handler}(${b.args})`, b]))('%s calls the same function with the same arguments', (_, b) => {
        render(<FlowsPage />);
        const el = at(pathOf(b.el));
        expect(el && el.tagName).toBe(b.el.tagName);
        // fireEvent's names are camel-cased (mousedown -> mouseDown).
        const fire = { mousedown: 'mouseDown', mouseup: 'mouseUp', dblclick: 'dblClick', keydown: 'keyDown', keyup: 'keyUp' }[b.event] || b.event;
        fireEvent[fire](el);
        const spy = Object.keys(E).includes(b.handler) ? E[b.handler] : legacy.fake[b.handler];
        expect(spy).toHaveBeenCalledTimes(1);
        // The arguments as the browser evaluates the inline handler: `this` is the element, `event` the event fired.
        const EVENT = Symbol('event');
        const want = Function('event', `return [${b.args}]`).call(el, EVENT);
        const got = spy.mock.calls[0];
        expect(got.length).toBe(want.length);
        want.forEach((w, i) => {
            if (w === EVENT) expect(got[i] && got[i].type, `argument ${i} is the ${b.event} event`).toBe(b.event);
            else expect(got[i]).toEqual(w);
        });
    });

    it('every engine function is on window while mounted, and taken back after', () => {
        const { unmount } = render(<FlowsPage />);
        const fns = Object.entries(E).filter(([, v]) => typeof v === 'function').map(([n]) => n);
        expect(fns.length).toBeGreaterThan(30);
        expect(fns.filter(n => typeof window[n] !== 'function')).toEqual([]);
        unmount();
        expect(fns.filter(n => n !== JSON_.loader && typeof window[n] === 'function')).toEqual([]);
    });
});

describe('Flows: the canvas pointer, bound while the page is mounted', () => {
    const flow = () => ({ nodes: [{ id: 'n1', x: 0, y: 0 }], edges: [] });

    it('dragging a node moves it and marks the flow changed; panning moves the view', () => {
        E.svgPoint.mockImplementation(evt => ({ x: evt.clientX, y: evt.clientY }));
        render(<FlowsPage />);
        legacy.fake.FLOW = Object.assign(legacy.fake.FLOW || {}, { flow: flow(), drag: { id: 'n1', dx: 5, dy: 5 }, link: null, pan: null, view: { x: 0, y: 0 }, dirty: false });
        window.FLOW = legacy.fake.FLOW;
        fireEvent.mouseMove(document, { clientX: 105, clientY: 55 });
        expect(window.FLOW.flow.nodes[0]).toMatchObject({ x: 100, y: 50 });
        expect(window.FLOW.dirty).toBe(true);
        expect(E.flowCanvasRender).toHaveBeenCalled();
        fireEvent.mouseUp(document, { clientX: 105, clientY: 55 });
        expect(window.FLOW.drag).toBe(null);

        window.FLOW.pan = { x: 10, y: 20 };
        fireEvent.mouseMove(document, { clientX: 110, clientY: 120 });
        expect(window.FLOW.view).toEqual({ x: 100, y: 100 });
    });

    it('a wire let go on empty canvas offers the nodes that could take it', () => {
        render(<FlowsPage />);
        const link = { from: 'n1', port: 'image' };
        window.FLOW = legacy.fake.FLOW = Object.assign(legacy.fake.FLOW || {}, { flow: flow(), drag: null, link, pan: null, view: { x: 0, y: 0 } });
        fireEvent.mouseUp(document, { clientX: 40, clientY: 60 });
        expect(E.flowOpenNextNode).toHaveBeenCalledWith(link, 40, 60);
        expect(window.FLOW.link).toBe(null);
    });

    it('after the page unmounts, the document listeners are gone', () => {
        const { unmount } = render(<FlowsPage />);
        unmount();
        window.FLOW = legacy.fake.FLOW = Object.assign(legacy.fake.FLOW || {}, { flow: flow(), drag: { id: 'n1', dx: 0, dy: 0 }, link: null, pan: null, view: { x: 0, y: 0 } });
        E.svgPoint.mockImplementation(evt => ({ x: evt.clientX, y: evt.clientY }));
        fireEvent.mouseMove(document, { clientX: 70, clientY: 70 });
        expect(window.FLOW.flow.nodes[0]).toMatchObject({ x: 0, y: 0 });
    });
});
