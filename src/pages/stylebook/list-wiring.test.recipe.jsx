// How stylebook's list is mounted for src/pages/list-wiring.test.jsx: the book's shots, and the keys it draws.
// camera_text is what the page derives from each camera (its values joined), so the rows carry the same.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

const shot = (o) => ({ media: [], ...o, camera_text: Object.values(o.camera || {}).join(' ') });

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            shot({ id: 'b1', name: 'Ozu low', description: 'tatami height', tags: 'interior', scope: 'library', camera: { lens: '40mm' }, created_at: '2026-10-01 08:00:00' }),
            shot({ id: 'b2', name: 'Whip pan', description: 'fast swing', tags: 'action', scope: 'project', camera: { lens: '24mm', movement: 'whip' }, created_at: '2026-10-03 08:00:00' }),
            shot({ id: 'b3', name: 'Crane up', description: 'rising reveal', tags: 'exterior', scope: 'library', camera: { lens: '18mm' }, created_at: '2026-10-02 08:00:00' }),
        ];
        installLegacy({ routes: { 'GET /projects/p1/style-book': { entries: rows.map(({ camera_text, ...r }) => r), note: '' } } });
        const Page = (await import('./StyleBookPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadStyleBook(); });
        return { rows, keys: drawn('#styleBookGrid [data-entry-id]', 'data-entry-id') };
    },
};
