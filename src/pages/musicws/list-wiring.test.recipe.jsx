// How musicws's list (the Score's lanes) is mounted for src/pages/list-wiring.test.jsx.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';

export default {
    rowKey: r => r.id,
    async open() {
        const lane = (id, name, role) => ({ id, name, role, role_kind: 'audible', color: '#888', muted: 0, soloed: 0, gain_db: 0, pan: 0, clips: [], automation: [] });
        const rows = [lane('t1', 'Strings', 'score'), lane('t2', 'Room tone', 'ambience'), lane('t3', 'Jukebox', 'source')];
        const { fake } = installLegacy();
        const session = { id: 'ms1', name: 'Score A', status: 'draft', duration_ms: 60000 };
        Object.assign(fake.MW, { session, model: { session, tracks: rows, clips: [], markers: [], emotion_ranges: [], automation: [], warnings: [] },
            pxPerSec: 40, playheadMs: 0, instruments: [], open: {}, selection: null, saveNote: '', drift: null, sessions: [session], playing: false });
        const Owner = (await import('../music/MusicPage.jsx')).default;
        const Page = (await import('./MusicWorkstationPage.jsx')).default;
        render(<><Owner /><Page /></>);
        await act(async () => { window.mwRender(); });
        return { rows, keys: () => [...document.querySelectorAll('#mwRoot .mw-track-wrap')].filter(n => !n.classList.contains('list-hidden')).map(n => n.querySelector('[data-track]').getAttribute('data-track')) };
    },
};
