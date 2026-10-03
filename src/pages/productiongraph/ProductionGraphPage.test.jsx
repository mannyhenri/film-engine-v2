import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { installLegacy } from '../../test/setup.js';
import ProductionGraphPage, { ENGINE } from './ProductionGraphPage.jsx';
import * as E from './engine.js';
import GRAPH from './fixtures/graph.json';
import REACT_JSON from './react.json';
import { LEGACY_GLOBALS } from '../../lib/legacy.js';

/*
 * The legacy page's own markup, from the reference the split is generated from: the ids the engine draws into
 * and the handlers it was driven by. Derived, so the React page cannot quietly drop one.
 */
const REF = fs.readFileSync(path.resolve(__dirname, '../../../reference/fb8c770/src/index.html'), 'utf8');
const LEGACY = (() => {
    const start = REF.indexOf('<div class="page" id="page-productiongraph">');
    return REF.slice(start, REF.indexOf('<div class="page" id="page-', start + 10));
})();
const LEGACY_IDS = [...LEGACY.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const LEGACY_HANDLERS = [...new Set([...LEGACY.matchAll(/\bon[a-z]+="([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))];
// Every function the engine names in the HTML it draws (nodes, drawer, menus, queue, in-betweens).
const ENGINE_SRC = fs.readFileSync(path.resolve(__dirname, 'engine.js'), 'utf8');
const NOT_ENGINE = new Set(['event', 'this', 'PG', 'IB', 'window', 'document']);
const RENDERED_HANDLERS = [...new Set([...ENGINE_SRC.matchAll(/\bon[a-z]+="([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))]
    .filter(n => !NOT_ENGINE.has(n));

const P = GRAPH.project_id;
const ROUTES = { [`GET /projects/${P}/production-graph`]: GRAPH };
const byId = (id) => document.getElementById(id);

beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function openPage(routes = {}) {
    // Any read the graph makes beyond the graph itself answers empty, and is recorded.
    const legacy = installLegacy({ routes: { ...ROUTES, ...routes }, project: { id: P } });
    const real = legacy.fake.api;
    legacy.fake.api = window.api = vi.fn(async (p, o = {}) => {
        try { return await real(p, o); } catch (e) { if (/no fake route/.test(e.message) && (o.method || 'GET') === 'GET') return {}; throw e; }
    });
    legacy.fake.PG.graph = null; legacy.fake.PG.byKey = new Map(); legacy.fake.PG.sel = null;
    const view = render(<ProductionGraphPage />);
    return { legacy, view };
}

describe('Production graph: the page keeps everything the engine draws into and is driven by', () => {
    it('the reference markup and the engine source were read (these checks run over something)', () => {
        expect(LEGACY_IDS.length).toBeGreaterThan(15);
        expect(LEGACY_HANDLERS.length).toBeGreaterThan(5);
        expect(RENDERED_HANDLERS.length).toBeGreaterThan(40);
    });
    it('renders every id the legacy page had, once', () => {
        openPage();
        for (const id of LEGACY_IDS) expect(document.querySelectorAll(`[id="${id}"]`).length, id).toBe(1);
    });
    it('every handler the legacy markup and the engine HTML call is an engine function on window while mounted, and gone after', () => {
        const { view } = openPage();
        const engine = new Set(ENGINE.map(([n]) => n));
        const ours = [...LEGACY_HANDLERS, ...RENDERED_HANDLERS].filter(n => engine.has(n));
        expect(ours.length).toBeGreaterThan(40);
        expect(ours.filter(n => window[n] !== E[n]), 'an engine handler not on window').toEqual([]);
        view.unmount();
        expect(ours.filter(n => !REACT_JSON.provides.includes(n) && typeof window[n] === 'function'), 'left on window after unmount').toEqual([]);
    });
    it('every core function the engine HTML calls is on LEGACY_GLOBALS, so the split keeps it in core', () => {
        // The engine draws onclick="refineFrame(…)": a second way it reaches core, besides its bridge. A core name
        // only reached that way could be moved into a page chunk by the split, and the click would throw.
        const engine = new Set(ENGINE.map(([n]) => n));
        const core = [...LEGACY_HANDLERS, ...RENDERED_HANDLERS].filter(n => !engine.has(n));
        expect(core.length).toBeGreaterThan(0);
        expect(core.filter(n => !LEGACY_GLOBALS.includes(n))).toEqual([]);
    });
    it('every name core calls (react.json provides) is an engine function, registered while mounted', () => {
        openPage();
        expect(REACT_JSON.provides.length).toBeGreaterThan(0);
        for (const n of REACT_JSON.provides) {
            expect(typeof E[n], n).toBe('function');
            expect(typeof window[n], n).toBe('function');
        }
    });
});

describe('Production graph: it draws the project from the real response', () => {
    it('loads the graph and draws a node for every node the server sent', async () => {
        openPage();
        await act(async () => { await window.loadProductionGraph(); });
        const world = byId('pgWorld');
        for (const n of GRAPH.nodes) {
            expect(world.querySelector(`[data-key="${n.key}"]`), `${n.type} ${n.key}`).toBeTruthy();
        }
        expect(window.PG.graph.project_id).toBe(P);
        expect(world.textContent).toContain('1A');
        expect(world.textContent).toContain('Arrival');
    });
});

describe('Production graph: Run what changed spends only through the shared confirmation', () => {
    // Held here from backend run-changed-run "the header offers it…" (skipped there: it read onclick text).
    it('reads the free plan in confirmPaidImage, posts nothing before it, and its send posts the run route', async () => {
        const { legacy } = openPage({ [`POST /projects/${P}/production-graph/run-changed`]: { run_id: 'r1', plan: { items: [1, 2] } } });
        legacy.fake.confirmPaidImage = window.confirmPaidImage = vi.fn();
        await act(async () => { await E.pgRunChanged(); });
        expect(legacy.fake.confirmPaidImage).toHaveBeenCalledTimes(1);
        const opts = legacy.fake.confirmPaidImage.mock.calls[0][0];
        expect(opts.previewUrl).toBe(`/projects/${P}/production-graph/run-changed/plan`);
        expect(legacy.calls.filter(c => c.method === 'POST'), 'it spent before the confirmation').toEqual([]);
        await act(async () => { await opts.send(); });
        expect(legacy.calls.filter(c => c.method === 'POST').map(c => c.path)).toEqual([`/projects/${P}/production-graph/run-changed`]);
    });
});

describe('Production graph: switching film while a graph is still loading', () => {
    it('the new film gets its own graph (a load in flight for the old one is not handed back), and nothing of the old view carries over', async () => {
        const B = 'b0000000-0000-4000-8000-00000000000b';
        let releaseA = null;
        const { legacy } = openPage({
            // A's first read answers at once; its second (the reload in flight at the switch) answers late.
            [`GET /projects/${P}/production-graph`]: () => releaseA === null ? (releaseA = false, GRAPH) : new Promise(r => { releaseA = () => r(GRAPH); }),
            [`GET /projects/${B}/production-graph`]: { ...GRAPH, project_id: B },
        });
        await act(async () => { await window.loadProductionGraph(); });     // A's graph is on screen
        legacy.fake.PG.queue = { items: ['A queue'] }; legacy.fake.PG.queueOpen = true;
        legacy.fake.PG.picked = new Set(['n1']); legacy.fake.PG.busy = new Map([['n1', 'run']]); legacy.fake.PG.add = { kind: 'shot' };
        let first;
        act(() => { first = window.loadProductionGraph(); });               // A reloads; this answer is slow
        window.state.currentProject = { id: B };                             // switch to B
        await act(async () => { await window.loadProductionGraph(); });    // B asks while A is still in flight
        expect(window.PG.graph.project_id, 'B got A\'s in-flight load back, so B was never asked for').toBe(B);
        expect(window.PG.queue, 'A\'s queue strip carried over to B').not.toEqual({ items: ['A queue'] });
        expect([...window.PG.picked]).toEqual([]);
        expect([...window.PG.busy.keys()]).toEqual([]);
        expect(window.PG.add).toBe(null);
        expect(window.PG.queueOpen).toBe(false);
        await act(async () => { releaseA(); await first; });                 // A's late answer changes nothing
        expect(window.PG.graph.project_id).toBe(B);
    });
});
