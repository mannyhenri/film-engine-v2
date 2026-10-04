// How musiccues's list is mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';

export default {
    rowKey: r => r.title,
    async open() {
        const rows = [
            { id: 'q1', cue_type: 'score', title: 'Arrival', description: 'strings swell', mood: 'tense', genre: 'orchestral', start_ms: 0, tempo_bpm: 80, duration_ms: 30000 },
            { id: 'q2', cue_type: 'ambient', title: 'Diner hum', description: 'room tone', mood: 'calm', genre: 'ambient', start_ms: 30000, tempo_bpm: 60, duration_ms: 90000 },
            { id: 'q3', cue_type: 'source', title: 'Jukebox', description: 'radio song', mood: 'warm', genre: 'rock', start_ms: 60000, tempo_bpm: 120, duration_ms: 15000 },
        ];
        installLegacy({ routes: { 'GET /projects/p1/music-cues': { music_cues: rows } } });
        const Page = (await import('./MusicCuesPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadMusicCues(); });
        // An item names its cue by its title (the engine draws no id on it).
        return { rows, keys: () => [...document.querySelectorAll('#musicCueList > .cue-card')].filter(n => !n.classList.contains('list-hidden')).map(n => n.querySelector('div[style*="font-weight:600"]').textContent) };
    },
};
