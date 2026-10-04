// Notes & Reviews: search, sort and filter the notes of the shot chosen (src/lib/list-controls.jsx;
// src/pages/list-surfaces.test.jsx). The route's order is the default; 'state' (open / resolved) is derived by the page.
export default {
    id: 'notes', noun: 'notes',
    search: ['content', 'author', 'note_type', 'priority'],
    sorts: [
        { id: 'listed', label: 'As listed', order: () => 0 },
        { id: 'newest', label: 'Newest first', field: 'created_at', dir: 'desc' },
        { id: 'oldest', label: 'Oldest first', field: 'created_at', dir: 'asc' },
        { id: 'priority', label: 'Priority', order: (a, b) => ['critical', 'high', 'normal', 'low'].indexOf(a.priority) - ['critical', 'high', 'normal', 'low'].indexOf(b.priority) },
    ],
    filters: [
        { id: 'type', label: 'Type', field: 'note_type' },
        { id: 'priority', label: 'Priority', field: 'priority' },
        { id: 'state', label: 'State', field: 'state' },
    ],
};
