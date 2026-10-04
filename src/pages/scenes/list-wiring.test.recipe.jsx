// How the Scenes list is mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => 'scene-' + r.id,
    async open() {
        const rows = [
            { id: 's1', scene_number: 1, int_ext: 'INT.', location: 'DINER', time_of_day: 'NIGHT', characters_present: 'RAY', description: 'a booth', status: 'written', shot_count: 3, dialogue_lines: 12 },
            { id: 's2', scene_number: 2, int_ext: 'EXT.', location: 'STREET', time_of_day: 'DAY', characters_present: 'JUNE', description: 'rain', status: 'complete', shot_count: 9, dialogue_lines: 2 },
            { id: 's3', scene_number: 3, int_ext: 'INT./EXT.', location: 'PIER', time_of_day: 'DUSK', characters_present: 'NOOR', description: 'gulls', status: 'draft', shot_count: 1, dialogue_lines: 30 },
        ];
        installLegacy({ routes: { 'GET /projects/p1/scenes': { scenes: rows.map(r => ({ ...r })) } } });
        const Page = (await import('./ScenesPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadScenes(); });
        return { rows, keys: drawn('#scenesList .scene-row', 'id') };
    },
};
