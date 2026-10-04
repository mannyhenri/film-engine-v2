// How renderhistory's list is mounted for src/pages/list-wiring.test.jsx: a shot's render ledger, and the keys it draws.
import { render, act, fireEvent } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 'r1', version: 1, step: 'keyframe', model_id: 'nano-pro', mode: 'creative', inference_ms: 4000, created_at: '2026-10-01T08:00:00Z' },
            { id: 'r2', version: 3, step: 'video', model_id: 'kling-two', mode: 'locked', inference_ms: 9000, created_at: '2026-10-03T08:00:00Z' },
            { id: 'r3', version: 2, step: 'upscale', model_id: 'topaz-x', mode: 'draft', inference_ms: 2000, created_at: '2026-10-02T08:00:00Z' },
        ];
        installLegacy({ routes: {
            'GET /projects/p1/status-board': { scenes: [{ id: 's1', scene_number: 1, shots: [{ id: 'sh1', shot_code: '1A' }] }] },
            'GET /shots/sh1/renders': { renders: rows },
        } });
        const Page = (await import('./RenderHistoryPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadRenderPage(); });
        await act(async () => { fireEvent.change(document.getElementById('renderShotSelect'), { target: { value: 'sh1' } }); });
        return { rows, keys: drawn('#renderTableWrap tr[data-render-id]', 'data-render-id') };
    },
};
