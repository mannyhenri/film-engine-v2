// How edits's list is mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
import { render, act, fireEvent } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const base = { frame_rate: 24, width: 1920, height: 1080, has_audio: 1, size_bytes: 10, available: 1, sessions: [] };
        const rows = [
            { ...base, id: 'e3', version: 3, name: 'Fine cut', file_name: 'fine.mp4', notes: 'locked', created_at: '2026-10-03', duration_ms: 60000, is_latest: 1 },
            { ...base, id: 'e2', version: 2, name: 'Rough cut', file_name: 'rough.mov', notes: 'temp music', created_at: '2026-10-02', duration_ms: 90000, is_latest: 0 },
            { ...base, id: 'e1', version: 1, name: 'Assembly', file_name: 'assembly.mp4', notes: 'first pass', created_at: '2026-10-01', duration_ms: 30000, is_latest: 0 },
        ];
        installLegacy({ routes: { 'GET /projects/p1/edits': { edits: rows } } });
        const Page = (await import('./EditsPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadEditsPage(); });
        return { rows, keys: drawn('#editsList [data-edit-id]', 'data-edit-id') };
    },
};
