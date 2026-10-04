// How projects's list is mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        try { localStorage.clear(); } catch (_) { /* none */ }
        const rows = [
            { id: 'p0', title: 'Alpha', logline: 'fog rolls in', genre: 'Horror', status: 'script', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
            { id: 'p1', title: 'Bravo', logline: 'a heist', genre: 'Thriller', status: 'script', created_at: '2026-03-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' },
            { id: 'p2', title: 'Charlie', logline: 'two lovers', genre: 'Romance', status: 'script', created_at: '2026-02-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
        ];
        const legacy = installLegacy({ routes: { 'GET /projects': { projects: rows.map(r => ({ ...r })), status_counts: { script: 3 }, statuses: ['script'], archived_count: 0 } } });
        Object.assign(legacy.fake.PROJECT_LIST, { status: '', archived: false, dragId: null });
        const Page = (await import('./ProjectsPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadProjects(); });
        return { rows, keys: drawn('#projectList .project-card[data-project-id]', 'data-project-id') };
    },
};
