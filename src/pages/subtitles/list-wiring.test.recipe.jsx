// How subtitles's list is mounted for src/pages/list-wiring.test.jsx: one language's cues, and the keys it draws.
// duration_ms and kind are what the page derives (end - start; closed caption or subtitle), so the rows carry the same.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

const cue = (o) => ({ language: 'en', shot_id: null, style: '', ...o, duration_ms: o.end_ms - o.start_ms, kind: o.is_cc ? 'closed caption' : 'subtitle' });

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            cue({ id: 'c1', text: 'Get inside.', start_ms: 1000, end_ms: 3000, speaker: 'RAY', position: 'bottom', is_cc: 0 }),
            cue({ id: 'c2', text: '[door slams]', start_ms: 4000, end_ms: 9000, speaker: 'NARRATOR', position: 'top', is_cc: 1 }),
            cue({ id: 'c3', text: 'Not tonight.', start_ms: 10000, end_ms: 11000, speaker: 'JUNE', position: 'middle', is_cc: 0 }),
        ];
        installLegacy({ routes: {
            'GET /projects/p1/languages': { languages: ['en'] },
            'GET /projects/p1/subtitles?language=en': { subtitles: rows.map(({ duration_ms, kind, ...r }) => r) },
            'GET /projects/p1/shotlist': { shots: [] },
        } });
        const Page = (await import('./SubtitlesPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadSubtitles(); });
        return { rows, keys: drawn('#subtitleList [data-cue-id]', 'data-cue-id') };
    },
};
