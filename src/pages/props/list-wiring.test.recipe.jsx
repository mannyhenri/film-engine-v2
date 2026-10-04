// How the Props list is mounted for src/pages/list-wiring.test.jsx: the page on rows (category pill: all), and the keys
// of what it draws.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 'p1', name: 'Lamp', description: 'brass', category: 'set_dressing', created_at: '2026-01-01', updated_at: '2026-01-05' },
            { id: 'p2', name: 'Van', description: 'rusty', category: 'vehicle', created_at: '2026-01-03', updated_at: '2026-01-02' },
            { id: 'p3', name: 'Knife', description: 'bone handle', category: 'weapon', created_at: '2026-01-02', updated_at: '2026-01-09' },
        ];
        installLegacy({ routes: { 'GET /projects/p1/props': { props: rows.map(r => ({ ...r })) }, 'GET /card-vocabulary': { prop_categories: [] } } });
        const Page = (await import('./PropsPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadProps(); });
        return { rows, keys: drawn('#propGrid [data-prop-id]', 'data-prop-id') };
    },
};
