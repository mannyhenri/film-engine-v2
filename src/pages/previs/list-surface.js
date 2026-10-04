// Previs: search and filter the shot list (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx and, on
// the page, src/pages/list-wiring.test.jsx). Not sorted: it is the shot list in story order, the order the film plays.
export default {
    id: 'previs', noun: 'shots',
    search: ['shot_code', 'location'],
    sorts: [],
    why: 'the shots stand in story order, as on every other page that lists them; picking one is by code or place',
    filters: [{ id: 'scene', label: 'Scene', field: 'scene_number' }],
};
