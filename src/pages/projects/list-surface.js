// Projects: search and sort the project list (src/lib/list-controls.jsx; src/pages/list-surfaces.test.jsx). The stage
// chips and the Archived view stay the page's own (they read the server), and these work within them. The list's own
// order (what the director dragged it into) is the default, and the only order a drag may be saved from.
export default {
    id: 'projects', noun: 'projects',
    search: ['title', 'logline', 'genre'],
    sorts: [
        { id: 'order', label: 'My order', order: () => 0 },
        { id: 'title', label: 'Title A–Z', field: 'title', dir: 'asc' },
        { id: 'newest', label: 'Newest first', field: 'created_at', dir: 'desc' },
        { id: 'edited', label: 'Recently edited', field: 'updated_at', dir: 'desc' },
    ],
    filters: [{ id: 'genre', label: 'Genre', field: 'genre' }],
};
