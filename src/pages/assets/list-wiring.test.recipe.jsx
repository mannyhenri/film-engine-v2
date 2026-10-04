// How assets's list is mounted for src/pages/list-wiring.test.jsx: the All pill, so the controls see every asset.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 'a1', asset_type: 'keyframe', file_name: 'alpha.png', file_path: '/d/k/alpha.png', format: 'png', size_bytes: 300, created_at: '2026-01-03T00:00:00Z' },
            { id: 'a2', asset_type: 'video_raw', file_name: 'bravo.mp4', file_path: '/d/v/bravo.mp4', format: 'mp4', size_bytes: 900, created_at: '2026-01-02T00:00:00Z' },
            { id: 'a3', asset_type: 'audio_music', file_name: 'charlie.wav', file_path: '/d/a/charlie.wav', format: 'wav', size_bytes: 100, created_at: '2026-01-01T00:00:00Z' },
        ];
        installLegacy({ routes: { 'GET /projects/p1/assets': { assets: rows } } });
        const Page = (await import('./AssetsPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadAssets(); });
        return { rows, keys: drawn('#assetTableWrap tr[data-asset-id]', 'data-asset-id') };
    },
};
