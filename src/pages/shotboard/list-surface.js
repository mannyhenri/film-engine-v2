// The Shot Board: search, sort and filter its shots (src/lib/list-controls.jsx; src/pages/list-surfaces.test.jsx).
// The columns ARE the status, so status is not a filter here; the running order is the default sort (a drag onto a
// card still reorders the whole running order, whatever is shown).
export default {
    id: 'shotboard', noun: 'shots',
    search: ['shot_code', 'location', 'time_of_day', 'transition_in_type'],
    sorts: [
        { id: 'order', label: 'Running order', order: () => 0 },
        { id: 'shot', label: 'Shot code', field: 'shot_code', dir: 'asc' },
        { id: 'longest', label: 'Longest first', field: 'duration_ms', dir: 'desc' },
        { id: 'added', label: 'Recently added', field: 'created_at', dir: 'desc' },
    ],
    filters: [
        { id: 'scene', label: 'Scene', field: 'scene_number' },
        { id: 'time', label: 'Time of day', field: 'time_of_day' },
        { id: 'transition', label: 'Transition in', field: 'transition_in_type' },
    ],
};
