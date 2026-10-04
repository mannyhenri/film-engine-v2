// How deliverables's list is mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        try { localStorage.clear(); } catch (_) { /* none */ }
        const base = { width: 1920, height: 1080, fps: 30, caption_mode: 'sidecar', native: 0, sort_order: 0 };
        const rows = [
            { ...base, id: 'd0', key: 'a_16x9', label: 'Alpha cut', platform: 'youtube', aspect_ratio: '16:9', loudness_target: '-24 LKFS', notes: 'first', duration_ms: 30000, status: 'planned' },
            { ...base, id: 'd1', key: 'b_9x16', label: 'Beta reel', platform: 'meta', aspect_ratio: '9:16', loudness_target: '-14 LUFS', notes: 'second', duration_ms: 15000, status: 'ready' },
            { ...base, id: 'd2', key: 'c_1x1', label: 'Gamma square', platform: 'tiktok', aspect_ratio: '1:1', loudness_target: '-16 LUFS', notes: 'third', duration_ms: 6000, status: 'delivered' },
        ];
        installLegacy({ routes: {
            'GET /projects/p1/deliverables': { profiles: [], packages: [], deliverables: rows },
            'GET /projects/p1/deliverables/check': {},
        } });
        const Page = (await import('./DeliverablesPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadDeliverables(); });
        return { rows, keys: drawn('#deliverableList [data-deliverable-id]', 'data-deliverable-id') };
    },
};
