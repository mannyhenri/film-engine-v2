// Music Cues: search, sort and filter the cue list (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx
// and, on the page, src/pages/list-wiring.test.jsx). Timeline order first, as the route reads them.
export default {
    id: 'musiccues', noun: 'cues',
    search: ['title', 'description', 'mood', 'genre'],
    sorts: [
        { id: 'timeline', label: 'Timeline order', field: 'start_ms', dir: 'asc' },
        { id: 'title', label: 'Title A–Z', field: 'title', dir: 'asc' },
        { id: 'tempo', label: 'Fastest first', field: 'tempo_bpm', dir: 'desc' },
        { id: 'longest', label: 'Longest first', field: 'duration_ms', dir: 'desc' },
    ],
    filters: [
        { id: 'type', label: 'Type', field: 'cue_type' },
        { id: 'mood', label: 'Mood', field: 'mood' },
    ],
};
