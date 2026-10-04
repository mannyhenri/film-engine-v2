// Edits: search and sort the edit versions (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx and, on
// the page, src/pages/list-wiring.test.jsx). Newest version first, as the route reads them.
export default {
    id: 'edits', noun: 'edits',
    search: ['name', 'file_name', 'notes'],
    sorts: [
        { id: 'newest', label: 'Newest version', field: 'version', dir: 'desc' },
        { id: 'oldest', label: 'Oldest version', field: 'version', dir: 'asc' },
        { id: 'longest', label: 'Longest first', field: 'duration_ms', dir: 'desc' },
    ],
    filters: [],
};
