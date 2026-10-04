// How music's list (the sound library) is mounted for src/pages/list-wiring.test.jsx.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 's1', kind: 'audio_dialogue', kind_label: 'Dialogue', file_name: '1A_RAY_0.mp3', line: 'Get inside', belongs_to: '1A', provider: 'elevenlabs', created_at: '2026-10-01', duration_ms: 2000, size_bytes: 300 },
            { id: 's2', kind: 'audio_music', kind_label: 'Score', file_name: 'arrival.mp3', line: 'strings rise', belongs_to: 'Scene 2', provider: 'muapi', created_at: '2026-10-03', duration_ms: 90000, size_bytes: 9000 },
            { id: 's3', kind: 'audio_ambient', kind_label: 'Ambience', file_name: 'diner.wav', line: 'room hum', belongs_to: 'Scene 3', provider: 'gridlight', created_at: '2026-10-02', duration_ms: 30000, size_bytes: 50000 },
        ];
        installLegacy({ routes: { 'GET /projects/p1/sounds': { sounds: rows, kinds: [] } } });
        const Page = (await import('./MusicPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadSoundLibrary(); });
        return { rows, keys: drawn('#soundLibGrid > .snd-card', 'data-sound') };
    },
};
