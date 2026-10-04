// Video Shots: search, sort and filter the shot cards (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx
// and, on the page, src/pages/list-wiring.test.jsx). The default is the story order the shot list is read in.
export default {
    id: 'videoshots', noun: 'shots',
    search: ['shot_code', 'location'],
    sorts: [
        { id: 'story', label: 'Story order', order: (a, b) => (Number(a.scene_number) || 0) - (Number(b.scene_number) || 0) || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) },
        { id: 'code', label: 'Shot code', field: 'shot_code', dir: 'asc' },
        { id: 'longest', label: 'Longest first', field: 'duration_ms', dir: 'desc' },
    ],
    filters: [
        { id: 'scene', label: 'Scene', field: 'scene_number' },
        { id: 'status', label: 'Status', field: 'status' },
        { id: 'time', label: 'Time of day', field: 'time_of_day' },
    ],
};
