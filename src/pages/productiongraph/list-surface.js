// The Production graph: search and filter the nodes on the canvas (src/lib/list-controls.jsx; held by
// src/pages/list-surfaces.test.jsx and, on the page, src/pages/list-wiring.test.jsx). Not sorted, and nothing is
// hidden or moved: a node stands where it was placed or pinned, so what does not match is faded where it stands.
export default {
    id: 'productiongraph', noun: 'nodes',
    search: ['shot_code', 'title', 'scene_label', 'framing'],
    sorts: [],
    why: 'a node stands where the director placed or pinned it on the canvas; Tidy and pinned positions are the order',
    filters: [{ id: 'type', label: 'Node', field: 'type' }, { id: 'scene', label: 'Scene', field: 'scene_label' }],
};
