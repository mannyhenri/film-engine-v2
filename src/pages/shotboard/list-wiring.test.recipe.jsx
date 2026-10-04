// How shotboard's list is mounted for src/pages/list-wiring.test.jsx. Every row is 'pending', so the one column draws
// the shown shots in shown order (the columns themselves split by status).
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 'a', shot_code: '1A', status: 'pending', scene_number: 1, location: 'DINER', time_of_day: 'NIGHT', transition_in_type: 'cut', duration_ms: 4000, created_at: '2026-01-02' },
            { id: 'b', shot_code: '2B', status: 'pending', scene_number: 2, location: 'STREET', time_of_day: 'DAY', transition_in_type: 'dissolve', duration_ms: 9000, created_at: '2026-01-03' },
            { id: 'c', shot_code: '3C', status: 'pending', scene_number: 3, location: 'ROOF', time_of_day: 'DUSK', transition_in_type: 'wipe-left', duration_ms: 2000, created_at: '2026-01-01' },
        ];
        installLegacy({ routes: {
            'GET /projects/p1/deliverables/check': { target_duration_ms: 0 },
            'GET /projects/p1/shotlist?limit=200&page=1': { shots: rows, total: rows.length },
        } });
        const Page = (await import('./ShotBoardPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadShotBoard(); });
        return { rows, keys: drawn('#kanbanBoard .kanban-card[data-shot]', 'data-shot') };
    },
};
