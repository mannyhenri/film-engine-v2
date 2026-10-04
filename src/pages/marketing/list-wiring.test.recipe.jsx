// How marketing's list is mounted for src/pages/list-wiring.test.jsx: the assets, and the keys it draws.
// `art` is what the page derives from image_path, so the rows carry the same.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

const asset = (o) => ({ ...o, art: o.image_path ? 'has artwork' : 'no artwork yet' });

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            asset({ id: 'k1', type: 'key_art', title: 'Teaser one', prompt: 'a lone figure', aspect_ratio: '2:3', image_path: '/x/refsheets/p1/one.png', created_at: '2026-10-03 08:00:00' }),
            asset({ id: 'k2', type: 'social_card', title: 'Blue hour card', prompt: 'the shadow at dusk', aspect_ratio: '1:1', created_at: '2026-10-01 08:00:00' }),
            asset({ id: 'k3', type: 'poster', title: 'Final poster', prompt: 'title over rain', aspect_ratio: '27:40', image_path: '/x/refsheets/p1/three.png', created_at: '2026-10-02 08:00:00' }),
        ];
        installLegacy({ routes: { 'GET /projects/p1/marketing': { marketing_assets: rows.map(({ art, ...r }) => r) } } });
        const Page = (await import('./MarketingPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadMarketing(); });
        return { rows, keys: drawn('#marketingGrid [data-asset-id]', 'data-asset-id') };
    },
};
