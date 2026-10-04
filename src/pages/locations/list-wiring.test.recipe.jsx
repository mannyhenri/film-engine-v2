// How the Locations list is mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 'l1', name: 'Attic', description: 'dust', lighting_default: 'window', time_of_day_default: 'day', scene_count: 2, created_at: '2026-01-01', updated_at: '2026-01-05' },
            { id: 'l2', name: 'Dock', description: 'wet boards', lighting_default: 'sodium', time_of_day_default: 'night', scene_count: 7, created_at: '2026-01-03', updated_at: '2026-01-02' },
            { id: 'l3', name: 'Kitchen', description: 'tiles', lighting_default: 'fluorescent', time_of_day_default: 'dawn', scene_count: 0, created_at: '2026-01-02', updated_at: '2026-01-09' },
        ];
        installLegacy({ routes: { 'GET /projects/p1/locations': { locations: rows.map(r => ({ ...r })) } } });
        const Page = (await import('./LocationsPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadLocations(); });
        return { rows, keys: drawn('#locationGrid [data-location-id]', 'data-location-id') };
    },
};
