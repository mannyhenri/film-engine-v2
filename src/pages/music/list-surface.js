// Music & Sound: search, sort and filter the sound library, every audio file of the film (src/lib/list-controls.jsx;
// held by src/pages/list-surfaces.test.jsx and, on the page, src/pages/list-wiring.test.jsx). The kind chips the page
// already draws stay; this narrows within them.
export default {
    id: 'music', noun: 'sounds',
    search: ['file_name', 'line', 'belongs_to', 'kind_label'],
    sorts: [
        { id: 'newest', label: 'Newest first', field: 'created_at', dir: 'desc' },
        { id: 'oldest', label: 'Oldest first', field: 'created_at', dir: 'asc' },
        { id: 'longest', label: 'Longest first', field: 'duration_ms', dir: 'desc' },
        { id: 'largest', label: 'Largest file first', field: 'size_bytes', dir: 'desc' },
    ],
    filters: [{ id: 'provider', label: 'Made by', field: 'provider' }],
};
