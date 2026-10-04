// The Style Book: search, sort and filter its shots (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx).
// The default keeps the book as served (this film's shots, then the library's, each in their own order). camera_text is
// derived by the page from the entry's camera (lens, shot type, movement...), so a lens is searchable.
export default {
    id: 'stylebook', noun: 'shots',
    search: ['name', 'description', 'tags', 'camera_text'],
    sorts: [
        { id: 'book', label: 'Book order', order: () => 0 },
        { id: 'name', label: 'Name A–Z', field: 'name', dir: 'asc' },
        { id: 'newest', label: 'Newest first', field: 'created_at', dir: 'desc' },
    ],
    filters: [{ id: 'scope', label: 'Where', field: 'scope' }],
};
