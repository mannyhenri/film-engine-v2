// How productiongraph's list (the nodes on the canvas) is mounted for src/pages/list-wiring.test.jsx.
import { vi, onTestFinished } from 'vitest';
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import FIXTURE from './fixtures/graph.json';

// The page's own fixture, with a shot size on the first shot (the fixture has none, and the surface searches it).
const GRAPH = { ...FIXTURE, nodes: FIXTURE.nodes.map((n, i) => (i === 0 ? { ...n, framing: 'close-up' } : n)) };

export default {
    rowKey: r => r.key,
    async open() {
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        onTestFinished(() => raf.mockRestore());
        const P = GRAPH.project_id;
        const stub = installLegacy({ routes: { [`GET /projects/${P}/production-graph`]: GRAPH }, project: { id: P } });
        const real = stub.fake.api;
        stub.fake.api = window.api = async (p, o = {}) => {
            try { return await real(p, o); } catch (e) { if (/no fake route/.test(e.message) && (o.method || 'GET') === 'GET') return {}; throw e; }
        };
        stub.fake.PG.graph = null; stub.fake.PG.byKey = new Map(); stub.fake.PG.sel = null;
        const Page = (await import('./ProductionGraphPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadProductionGraph(); await new Promise(r => setTimeout(r, 0)); });
        const rows = stub.fake.PG.graph.nodes;
        return { rows, keys: () => [...document.querySelectorAll('#pgWorld > .pg-node')].filter(n => !n.classList.contains('list-dim')).map(n => n.getAttribute('data-key')) };
    },
};
