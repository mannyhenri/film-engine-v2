// How consistency's list is mounted for src/pages/list-wiring.test.jsx: the Characters tab, with the lock state the
// page derives from the profiles (locked / draft / not locked) already on the rows.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const chars = [
            { id: 'c1', name: 'Maya', description: 'pilot', created_at: '2026-01-02' },
            { id: 'c2', name: 'Ray', description: 'medic', created_at: '2026-01-03' },
            { id: 'c3', name: 'Ines', description: 'cook', created_at: '2026-01-01' },
        ];
        const profiles = [
            { id: 'p1', profile_type: 'character', subject_id: 'c1', status: 'locked', refs: [] },
            { id: 'p2', profile_type: 'character', subject_id: 'c2', status: 'draft', refs: [] },
        ];
        installLegacy({ routes: {
            'GET /projects/p1/characters': { characters: chars }, 'GET /projects/p1/locations': { locations: [] },
            'GET /projects/p1/props': { props: [] }, 'GET /projects/p1/consistency/profiles': { profiles },
            'GET /projects/p1/assets': { assets: [] }, 'GET /projects/p1/consistency/audit': { ready: true, shots: [] },
        } });
        const Page = (await import('./ConsistencyPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadConsistency(); });
        const rows = chars.map((c, i) => ({ ...c, lock: ['locked', 'draft', 'not locked'][i] }));
        return { rows, keys: drawn('#consistencyCharacters [data-subject-id]', 'data-subject-id') };
    },
};
