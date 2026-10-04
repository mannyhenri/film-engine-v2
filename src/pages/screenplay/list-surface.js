// The Screenplay: find a scene in the navigator (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx
// and, on the page, src/pages/list-wiring.test.jsx). Find, not filter: the scenes are the story in order, reordered
// only by dragging; matches are marked, and Enter goes to the scene in the editor.
export default {
    id: 'screenplay', noun: 'scenes',
    search: ['heading', 'cast'],
    sorts: [],
    why: 'the scenes are the story in order; the order is changed only by dragging a scene, which rewrites the screenplay',
    filters: [],
    mode: 'find',
};
