// How moodboard's list is mounted for src/pages/list-wiring.test.jsx: the board's entries, and the keys it draws.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 'e1', kind: 'palette', note: 'teal shadows', spec_kind: 'colour', spec_value: 'teal', created_at: '2026-10-01 08:00:00' },
            { id: 'e2', kind: 'lens', note: 'long glass', spec_kind: 'lens', spec_value: '85', created_at: '2026-10-03 08:00:00' },
            { id: 'e3', kind: 'texture', note: 'grainy stock', spec_kind: 'grain', spec_value: 'heavy', created_at: '2026-10-02 08:00:00' },
        ];
        installLegacy({ routes: { 'GET /projects/p1/mood-board': { entries: rows }, 'POST /projects/p1/mood-board/compose': { spec_kinds: {} } } });
        const Page = (await import('./MoodBoardPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadMoodBoardPage(); });
        return { rows, keys: drawn('#moodEntries [data-entry-id]', 'data-entry-id') };
    },
};
