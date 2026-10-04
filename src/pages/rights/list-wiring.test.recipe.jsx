// How rights's list is mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        try { localStorage.clear(); } catch (_) { /* none */ }
        const rows = [
            { id: 'r0', subject: 'Alpha likeness', owner: 'Ann', source: 'agency', territory: 'worldwide', consent_reference: 'REL-1', restrictions: 'none at all', notes: 'first',
              rights_type: 'likeness', entity_type: 'character', origin: 'original', status: 'cleared', expires_on: '2027-01-01', updated_at: '2026-01-01' },
            { id: 'r1', subject: 'Beta score', owner: 'Bob', source: 'label', territory: 'europe', consent_reference: 'REL-2', restrictions: 'no trailers', notes: 'second',
              rights_type: 'music_license', entity_type: 'music_cue', origin: 'licensed', status: 'expired', expires_on: '2026-06-01', updated_at: '2026-03-01' },
            { id: 'r2', subject: 'Gamma model', owner: 'Cat', source: 'vendor', territory: 'asia', consent_reference: 'REL-3', restrictions: 'internal', notes: 'third',
              rights_type: 'commercial_use', entity_type: 'asset', origin: 'generated', status: 'unknown', expires_on: null, updated_at: '2026-02-01' },
        ];
        installLegacy({ routes: { 'GET /projects/p1/rights': { rights: rows, by_status: {}, vocabulary: {
            status: ['unknown', 'cleared', 'expired'], rights_type: ['likeness', 'music_license', 'commercial_use'],
            entity_type: ['asset', 'character', 'music_cue'], origin: ['original', 'generated', 'licensed'] } } } });
        const Page = (await import('./RightsPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadRights(); });
        return { rows, keys: drawn('#rightsList [data-right-id]', 'data-right-id') };
    },
};
