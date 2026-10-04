// Characters: search, sort and filter (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx).
export default {
    id: 'characters', noun: 'characters',
    search: ['name', 'description', 'age_range', 'gender'],
    sorts: [
        { id: 'name-asc', label: 'Name A–Z', field: 'name', dir: 'asc' },
        { id: 'name-desc', label: 'Name Z–A', field: 'name', dir: 'desc' },
        { id: 'added', label: 'Recently added', field: 'created_at', dir: 'desc' },
        { id: 'edited', label: 'Recently edited', field: 'updated_at', dir: 'desc' },
    ],
    filters: [{ id: 'gender', label: 'Gender', field: 'gender' }],
};
