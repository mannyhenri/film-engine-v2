// How flows's list (the flow picker) is mounted for src/pages/list-wiring.test.jsx.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';

export default {
    rowKey: r => r.id,
    async open() {
        const flows = [
            { id: 'f1', name: 'Shot to clip', is_builtin: 1, node_count: 4 },
            { id: 'f2', name: 'My variations', is_builtin: 0, node_count: 9 },
            { id: 'f3', name: 'Character sheet', is_builtin: 1, node_count: 6 },
        ];
        installLegacy({ routes: {
            'GET /flows/node-types': { node_types: {} },
            'GET /projects/p1/flows': { flows },
            'GET /flows/f1': { flow: { id: 'f1', name: 'Shot to clip', nodes: [], edges: [] } },
        } });
        window.escapeHtml = (t) => String(t);
        const Page = (await import('./FlowsPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadFlowsPage(); await new Promise(r => setTimeout(r, 0)); });
        const rows = [
            { order: 0, id: 'f1', name: 'Shot to clip', origin: 'built-in', nodes: 4 },
            { order: 1, id: 'f2', name: 'My variations', origin: 'this project or library', nodes: 9 },
            { order: 2, id: 'f3', name: 'Character sheet', origin: 'built-in', nodes: 6 },
        ];
        return { rows, keys: () => [...document.querySelectorAll('#flowSelect > option')].filter(o => !o.classList.contains('list-hidden')).map(o => o.value) };
    },
};
