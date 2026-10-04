// Consistency: search, sort and filter the subjects of the tab shown (characters, locations or props; one list at a
// time, so the tab is the kind). The lock state is derived by the page from the subject's profile.
// (src/lib/list-controls.jsx; src/pages/list-surfaces.test.jsx)
export default {
    id: 'consistency', noun: 'subjects',
    search: ['name', 'description', 'lock'],
    sorts: [
        { id: 'name-asc', label: 'Name A–Z', field: 'name', dir: 'asc' },
        { id: 'name-desc', label: 'Name Z–A', field: 'name', dir: 'desc' },
        { id: 'added', label: 'Recently added', field: 'created_at', dir: 'desc' },
    ],
    filters: [{ id: 'lock', label: 'Lock', field: 'lock' }],   // 'locked' / 'draft' / 'not locked'
};
