// The Mood Board: search, sort and filter its entries (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx).
// The default keeps the board as arranged (its own order); the others are for finding a reference.
export default {
    id: 'moodboard', noun: 'entries',
    search: ['note', 'kind', 'spec_kind', 'spec_value'],
    sorts: [
        { id: 'board', label: 'Board order', order: () => 0 },
        { id: 'newest', label: 'Newest first', field: 'created_at', dir: 'desc' },
        { id: 'kind', label: 'Kind', field: 'kind', dir: 'asc' },
    ],
    filters: [
        { id: 'kind', label: 'Kind', field: 'kind' },
        { id: 'spec', label: 'Setting', field: 'spec_kind' },
    ],
};
