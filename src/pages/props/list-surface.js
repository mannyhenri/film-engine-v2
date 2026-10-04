// Props: search and sort (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx). The category is filtered
// by the page's own pills, so it is a sort here, not a second category filter.
export default {
    id: 'props', noun: 'props',
    search: ['name', 'description', 'category'],
    sorts: [
        { id: 'name-asc', label: 'Name A–Z', field: 'name', dir: 'asc' },
        { id: 'name-desc', label: 'Name Z–A', field: 'name', dir: 'desc' },
        { id: 'added', label: 'Recently added', field: 'created_at', dir: 'desc' },
        { id: 'edited', label: 'Recently edited', field: 'updated_at', dir: 'desc' },
        { id: 'category', label: 'Category', field: 'category', dir: 'asc' },
    ],
};
