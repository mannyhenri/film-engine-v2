// Subtitles: search, sort and filter the cues of the language shown (src/lib/list-controls.jsx; held by
// src/pages/list-surfaces.test.jsx). Time order is the default: a cue list is read as the film plays. The language is
// chosen by the page's own picker. `kind` is derived by the page: closed caption / subtitle. Export always writes every
// cue of the language, whatever is searched.
export default {
    id: 'subtitles', noun: 'cues',
    search: ['text', 'speaker'],
    sorts: [
        { id: 'time', label: 'Time order', order: () => 0 },
        { id: 'speaker', label: 'Speaker', field: 'speaker', dir: 'asc' },
        { id: 'longest', label: 'Longest first', field: 'duration_ms', dir: 'desc' },
    ],
    filters: [
        { id: 'speaker', label: 'Speaker', field: 'speaker' },
        { id: 'position', label: 'Position', field: 'position' },
        { id: 'kind', label: 'Kind', field: 'kind' },
    ],
};
