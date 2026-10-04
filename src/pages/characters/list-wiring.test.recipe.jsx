// How the Characters list is mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 'c1', name: 'Ada', description: 'a pilot', age_range: '30s', gender: 'female', created_at: '2026-01-01', updated_at: '2026-01-05' },
            { id: 'c2', name: 'Bram', description: 'a medic', age_range: '50s', gender: 'male', created_at: '2026-01-03', updated_at: '2026-01-02' },
            { id: 'c3', name: 'Cleo', description: 'a sailor', age_range: '20s', gender: 'non-binary', created_at: '2026-01-02', updated_at: '2026-01-09' },
        ];
        installLegacy({ routes: { 'GET /projects/p1/characters': { characters: rows.map(r => ({ ...r })) } } });
        const Page = (await import('./CharactersPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadCharacters(); });
        return { rows, keys: drawn('#characterGrid [data-character-id]', 'data-character-id') };
    },
};
