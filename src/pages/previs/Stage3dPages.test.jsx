import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { installLegacy } from '../../test/setup.js';
import { legacyMarkup, legacyHandlers, domWalk } from '../../test/reference.js';

/*
 * The two 3D pages share one engine (engine.js, owned by Previs). Set-based over the two: each frame is the reference
 * markup element by element, each legacy handler calls the same function with the same arguments, each loader is
 * registered; while Previs is mounted every engine function is on window, and what the chunk bound at load
 * (mount.js) is bound, and unbound after.
 */
vi.mock('./engine.js', async (importOriginal) => {
    const real = await importOriginal();
    const wrapped = {};
    for (const [k, v] of Object.entries(real)) wrapped[k] = typeof v === 'function' ? vi.fn(v) : v;
    return wrapped;
});
const E = await import('./engine.js');
const PAGES = [
    { id: 'previs', Page: (await import('./PrevisPage.jsx')).default, json: (await import('./react.json')).default },
    { id: 'threed', Page: (await import('../threed/ThreeDPage.jsx')).default, json: (await import('../threed/react.json')).default },
];
let legacy;
beforeEach(() => {
    legacy = installLegacy();
    for (const v of Object.values(E)) if (vi.isMockFunction(v)) { v.mockClear(); v.mockImplementation(() => {}); }
});
afterEach(() => vi.restoreAllMocks());

const pathOf = (el, id) => { const p = []; for (let n = el; n && n.id !== `page-${id}`; n = n.parentElement) p.unshift([...n.parentElement.children].indexOf(n)); return p; };
const at = (p, id) => p.reduce((n, i) => n.children[i], document.getElementById(`page-${id}`));

describe.each(PAGES)('$id', ({ id, Page, json }) => {
    it('renders the reference markup element by element', () => {
        render(<Page />);
        const ref = new DOMParser().parseFromString(`<body>${legacyMarkup(id)}</body>`, 'text/html').getElementById(`page-${id}`);
        const theirs = domWalk(ref), mine = domWalk(document.getElementById(`page-${id}`));
        const first = theirs.findIndex((x, i) => x !== mine[i]);
        expect(first, `first difference at ${first}: reference ${theirs[first]} | React ${mine[first]}`).toBe(-1);
        expect(mine.length).toBe(theirs.length);
    });
    it('registers its loader and what it provides, and declares three.js', () => {
        render(<Page />);
        for (const n of [json.loader, ...json.provides]) expect(typeof window[n], n).toBe('function');
        expect(json.vendors).toEqual(['three']);
    });
    const handlers = legacyHandlers(legacyMarkup(id));
    if (handlers.length) it.each(handlers.map(b => [`${b.event} ${b.handler}(${b.args})`, b]))('%s calls the same function with the same arguments', (_, b) => {
        render(<Page />);
        const el = at(pathOf(b.el, id), id);
        expect(el && el.tagName).toBe(b.el.tagName);
        fireEvent[b.event === 'click' ? 'click' : b.event](el);
        const spy = Object.keys(E).includes(b.handler) ? E[b.handler] : legacy.fake[b.handler];
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]).toEqual(Function(`return [${b.args}]`)());
    });
});

describe('Previs owns the engine and what the chunk bound at load', () => {
    const MOUNT = fs.readFileSync(path.resolve(__dirname, 'mount.js'), 'utf8');
    const LISTENS = [...MOUNT.matchAll(/(document|window)\.addEventListener\("([a-z]+)", (h\d+)\)/g)].map(m => ({ target: m[1], type: m[2] }));
    it('binds every listener of mount.js while mounted, sets window.roomScanDone, and undoes all of it on unmount', () => {
        expect(LISTENS.length).toBe(12);
        const added = [], removed = [];
        for (const t of [window, document]) {
            const name = t === window ? 'window' : 'document';
            const add = t.addEventListener.bind(t), rem = t.removeEventListener.bind(t);
            vi.spyOn(t, 'addEventListener').mockImplementation((type, h, o) => { added.push(`${name}:${type}`); return add(type, h, o); });
            vi.spyOn(t, 'removeEventListener').mockImplementation((type, h, o) => { removed.push(`${name}:${type}`); return rem(type, h, o); });
        }
        const Owner = PAGES[0].Page;
        const { unmount } = render(<Owner />);
        const want = LISTENS.map(l => `${l.target}:${l.type}`).sort();
        expect(added.filter(a => want.includes(a)).sort()).toEqual(want);
        expect(typeof window.roomScanDone).toBe('function');
        const fns = Object.entries(E).filter(([, v]) => typeof v === 'function').map(([n]) => n);
        expect(fns.length).toBeGreaterThan(200);
        expect(fns.filter(n => typeof window[n] !== 'function')).toEqual([]);
        unmount();
        expect(removed.filter(r => want.includes(r)).sort()).toEqual(want);
        expect(window.roomScanDone).toBeUndefined();
    });
});
