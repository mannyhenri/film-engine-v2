// Flows: search, sort and filter the flow picker (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx and,
// on the page, src/pages/list-wiring.test.jsx). The picker lists the project's flows and the library's.
export default {
    id: 'flows', noun: 'flows',
    search: ['name'],
    sorts: [
        { id: 'as-read', label: 'As listed', field: 'order', dir: 'asc' },
        { id: 'name', label: 'Name A–Z', field: 'name', dir: 'asc' },
        { id: 'biggest', label: 'Most nodes', field: 'nodes', dir: 'desc' },
    ],
    filters: [{ id: 'origin', label: 'Origin', field: 'origin' }],
};
