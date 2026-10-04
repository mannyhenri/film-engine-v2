// How playback's list (the playlist) is mounted for src/pages/list-wiring.test.jsx.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';

export default {
    rowKey: r => r.shot_code,
    async open() {
        const entry = (index, shot_code, start_timecode) => ({ index, shot_id: 's' + index, shot_code, scene_id: 'sc1', start_ms: index * 4000, end_ms: index * 4000 + 4000,
            duration_ms: 4000, start_timecode, kind: 'still', missing: false, still: null, video: null, audio: null, audio_lines: [] });
        const rows = [entry(0, '1A', '00:00:00:00'), entry(1, '1B', '00:00:04:00'), entry(2, '2A', '00:00:08:00')];
        const { fake } = installLegacy({ routes: {
            'GET /projects/p1/timeline': { entries: rows, total_duration_ms: 12000, total_timecode: '00:00:12:00', beds: [] },
            'GET /projects/p1/timeline/notes': { notes: [] },
        } });
        const Page = (await import('./PlaybackPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadPlayback(); });
        const items = () => [...document.querySelectorAll('#pbPlaylist > .pb-playlist-item')];
        const code = (n) => n.querySelector('span').textContent;
        return {
            rows,
            keys: () => items().filter(n => !n.classList.contains('list-hidden')).map(code),
            marked: () => items().filter(n => n.classList.contains('list-find-match')).map(code),
            found: () => rows[fake.pb.index].shot_code,
        };
    },
};
