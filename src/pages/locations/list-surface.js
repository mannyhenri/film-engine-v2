// Locations: search, sort and filter (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx).
export default {
    id: 'locations', noun: 'locations',
    search: ['name', 'description', 'lighting_default', 'time_of_day_default'],
    sorts: [
        { id: 'name-asc', label: 'Name A–Z', field: 'name', dir: 'asc' },
        { id: 'name-desc', label: 'Name Z–A', field: 'name', dir: 'desc' },
        { id: 'added', label: 'Recently added', field: 'created_at', dir: 'desc' },
        { id: 'edited', label: 'Recently edited', field: 'updated_at', dir: 'desc' },
        { id: 'scenes', label: 'Most scenes', field: 'scene_count', dir: 'desc' },
    ],
    filters: [{ id: 'time', label: 'Time of day', field: 'time_of_day_default' }],
};
