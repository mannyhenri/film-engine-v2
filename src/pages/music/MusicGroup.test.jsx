import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { legacyMarkup, legacyHandlers, domWalk, frameChildren } from '../../test/reference.js';

/*
 * The three music pages share one engine (engine.js, owned by Music & Sound). Set-based over the three: each frame
 * is the reference markup element by element, each legacy handler calls the same function with the same arguments,
 * each loader is registered, and while the owner is mounted every engine function is on window.
 */
vi.mock('./engine.js', async (importOriginal) => {
    const real = await importOriginal();
    const wrapped = {};
    for (const [k, v] of Object.entries(real)) wrapped[k] = typeof v === 'function' ? vi.fn(v) : v;
    return wrapped;
});
const E = await import('./engine.js');
const PAGES = [
    { id: 'music', Page: (await import('./MusicPage.jsx')).default, json: (await import('./react.json')).default },
    { id: 'musiccues', Page: (await import('../musiccues/MusicCuesPage.jsx')).default, json: (await import('../musiccues/react.json')).default },
    { id: 'musicws', Page: (await import('../musicws/MusicWorkstationPage.jsx')).default, json: (await import('../musicws/react.json')).default },
];
let legacy;
beforeEach(() => {
    legacy = installLegacy();
    for (const v of Object.values(E)) if (vi.isMockFunction(v)) { v.mockClear(); v.mockImplementation(() => {}); }
});
afterEach(() => vi.restoreAllMocks());

const pathOf = (el, id) => { const p = []; for (let n = el; n && n.id !== `page-${id}`; n = n.parentElement) p.unshift([...n.parentElement.children].indexOf(n)); return p; };
const at = (p, id) => p.reduce((n, i) => frameChildren(n)[i], document.getElementById(`page-${id}`));

describe.each(PAGES)('$id', ({ id, Page, json }) => {
    it('renders the reference markup element by element', () => {
        render(<Page />);
        const ref = new DOMParser().parseFromString(`<body>${legacyMarkup(id)}</body>`, 'text/html').getElementById(`page-${id}`);
        const theirs = domWalk(ref), mine = domWalk(document.getElementById(`page-${id}`));
        const first = theirs.findIndex((x, i) => x !== mine[i]);
        expect(first, `first difference at ${first}: reference ${theirs[first]} | React ${mine[first]}`).toBe(-1);
        expect(mine.length).toBe(theirs.length);
    });
    it('registers its loader, and every name it provides', () => {
        render(<Page />);
        for (const n of [json.loader, ...json.provides]) expect(typeof window[n], n).toBe('function');
    });
    it.each(legacyHandlers(legacyMarkup(id)).map(b => [`${b.event} ${b.handler}(${b.args})`, b]))('%s calls the same function with the same arguments', (_, b) => {
        render(<Page />);
        const el = at(pathOf(b.el, id), id);
        expect(el && el.tagName).toBe(b.el.tagName);
        fireEvent[b.event === 'click' ? 'click' : b.event](el);
        const spy = Object.keys(E).includes(b.handler) ? E[b.handler] : legacy.fake[b.handler];
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]).toEqual(Function(`return [${b.args}]`)());
    });
});

describe('the music engine is registered by its owner', () => {
    it('while Music & Sound is mounted, every engine function is on window; after, only what is provided by name', () => {
        const Owner = PAGES[0].Page;
        const { unmount } = render(<Owner />);
        const fns = Object.entries(E).filter(([, v]) => typeof v === 'function').map(([n]) => n);
        expect(fns.length).toBeGreaterThan(150); // the check runs over the engine, not over nothing
        expect(fns.filter(n => typeof window[n] !== 'function')).toEqual([]);
        unmount();
        const named = new Set(PAGES.flatMap(p => [p.json.loader, ...p.json.provides]));
        expect(fns.filter(n => !named.has(n) && typeof window[n] === 'function')).toEqual([]);
    });
});
