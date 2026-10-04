// The Score: search and filter its lanes (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx and, on
// the page, src/pages/list-wiring.test.jsx). Not sorted: the lanes stand in the order the composer set.
export default {
    id: 'musicws', noun: 'lanes',
    search: ['name', 'role'],
    sorts: [],
    why: 'the lanes stand in the order the composer set them; the mix and the bounce read that order',
    filters: [{ id: 'role', label: 'Role', field: 'role' }],
};
