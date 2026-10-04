// How the Storyboard is mounted for src/pages/list-wiring.test.jsx: the page on frames, and the keys of what it draws.
// `frame` is the field the page derives from image_url; the rows carry it so what is expected is computed as drawn.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.shot_id,
    async open() {
        const rows = [
            { shot_id: 'a', shot_code: '1A', scene_number: 1, description: 'a booth', camera: 'wide', lighting: 'neon', status: 'complete', asset_version: 2, duration_ms: 4000, image_url: '/a.png', frame: 'has a frame' },
            { shot_id: 'b', shot_code: '2A', scene_number: 2, description: 'rain', camera: 'close', lighting: 'sodium', status: 'draft', asset_version: 1, duration_ms: 9000, image_url: null, frame: 'no frame yet' },
            { shot_id: 'c', shot_code: '3A', scene_number: 3, description: 'gulls', camera: 'aerial', lighting: 'dusk', status: 'review', asset_version: 5, duration_ms: 2000, image_url: '/c.png', frame: 'has a frame' },
        ];
        installLegacy({ routes: {
            'GET /projects/p1/storyboard': { frames: rows.map(({ frame, ...r }) => r) },
            'GET /projects/p1/board-lock': { locked: false },
        } });
        const Page = (await import('./StoryboardPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadStoryboard(); });
        return { rows, keys: drawn('#storyboardGrid [data-frame-shot]', 'data-frame-shot') };
    },
};
