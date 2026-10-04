// Scenes: search, sort and filter (src/lib/list-controls.jsx; src/pages/list-surfaces.test.jsx). Story order (the scene
// numbers) is the default.
export default {
    id: 'scenes', noun: 'scenes',
    search: ['location', 'int_ext', 'time_of_day', 'characters_present', 'description'],
    sorts: [
        { id: 'story', label: 'Story order', order: () => 0 },
        { id: 'shots', label: 'Most shots', field: 'shot_count', dir: 'desc' },
        { id: 'dialogue', label: 'Most dialogue', field: 'dialogue_lines', dir: 'desc' },
        { id: 'location', label: 'Location', field: 'location', dir: 'asc' },
    ],
    filters: [
        { id: 'status', label: 'Production status', field: 'status' },
        { id: 'writing', label: 'Writing', field: 'writing_status' },
        { id: 'int_ext', label: 'INT/EXT', field: 'int_ext' },
        { id: 'time', label: 'Time of day', field: 'time_of_day' },
    ],
};
