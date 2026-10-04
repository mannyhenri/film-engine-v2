// How notes's list is mounted for src/pages/list-wiring.test.jsx: a scene and shot chosen, with the open/resolved state
// the page derives already on the rows.
import { render, act, fireEvent } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const notes = [
            { id: 'n1', note_type: 'direction', priority: 'normal', author: 'Ana', created_at: '2026-01-02T00:00:00Z', resolved: 0, content: 'hold longer' },
            { id: 'n2', note_type: 'camera', priority: 'high', author: 'Bo', created_at: '2026-01-03T00:00:00Z', resolved: 1, content: 'go lower' },
            { id: 'n3', note_type: 'audio', priority: 'low', author: 'Cy', created_at: '2026-01-01T00:00:00Z', resolved: 0, content: 'more room tone' },
        ];
        installLegacy({ routes: {
            'GET /projects/p1/status-board': { scenes: [{ id: 's1', scene_number: 1, location: 'DINER', shots: [{ id: 'sh1', shot_code: '1A', status: 'draft' }] }] },
            'GET /shots/sh1/notes': { notes },
        } });
        const Page = (await import('./NotesPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadNotesPage(); });
        fireEvent.change(document.getElementById('noteSceneSelect'), { target: { value: 's1' } });
        await act(async () => { fireEvent.change(document.getElementById('noteShotSelect'), { target: { value: 'sh1' } }); });
        const rows = notes.map(n => ({ ...n, state: n.resolved ? 'resolved' : 'open' }));
        return { rows, keys: drawn('#notesList [data-note-id]', 'data-note-id') };
    },
};
