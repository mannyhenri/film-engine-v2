// The Storyboard: search, sort and filter its frames (src/lib/list-controls.jsx; src/pages/list-surfaces.test.jsx).
// Story order is the default and keeps the board as the film runs; the others are for finding work.
export default {
    id: 'storyboard', noun: 'frames',
    search: ['shot_code', 'description', 'camera', 'lighting'],
    sorts: [
        { id: 'story', label: 'Story order', order: () => 0 },           // the board's own order (scene, then shot)
        { id: 'shot', label: 'Shot code', field: 'shot_code', dir: 'asc' },
        { id: 'version', label: 'Latest version first', field: 'asset_version', dir: 'desc' },
        { id: 'longest', label: 'Longest first', field: 'duration_ms', dir: 'desc' },
    ],
    filters: [
        { id: 'scene', label: 'Scene', field: 'scene_number' },
        { id: 'frame', label: 'Frame', field: 'frame' },                // 'has a frame' / 'no frame yet' (the page derives it)
        { id: 'status', label: 'Status', field: 'status' },
    ],
};
