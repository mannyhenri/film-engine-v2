// How videoshots's list is mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
import { render, act, fireEvent } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 'a', shot_code: '1A', location: 'DINER', status: 'draft', scene_number: 1, sort_order: 0, time_of_day: 'NIGHT', duration_ms: 4000 },
            { id: 'b', shot_code: '2A', location: 'STREET', status: 'approved', scene_number: 2, sort_order: 0, time_of_day: 'DAY', duration_ms: 9000 },
            { id: 'c', shot_code: '3A', location: 'ROOF', status: 'review', scene_number: 3, sort_order: 0, time_of_day: 'DUSK', duration_ms: 2000 },
        ];
        installLegacy({ routes: { 'GET /projects/p1/shotlist': { shots: rows }, 'GET /projects/p1/video': { jobs: [], assets: [] }, 'GET /projects/p1/providers': { effective: {} } } });
        const Page = (await import('./VideoShotsPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadVideoShots(); });
        return { rows, keys: drawn('#videoshotsGrid [data-shot-id]', 'data-shot-id') };
    },
};
