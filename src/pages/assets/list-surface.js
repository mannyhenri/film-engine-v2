// Assets: search, sort and filter within the group pill shown (src/lib/list-controls.jsx; src/pages/list-surfaces.test.jsx).
// Newest first is the default: the route's own order.
export default {
    id: 'assets', noun: 'assets',
    search: ['file_name', 'file_path', 'asset_type', 'format'],
    sorts: [
        { id: 'newest', label: 'Newest first', field: 'created_at', dir: 'desc' },
        { id: 'oldest', label: 'Oldest first', field: 'created_at', dir: 'asc' },
        { id: 'name', label: 'Name A–Z', field: 'file_name', dir: 'asc' },
        { id: 'largest', label: 'Largest first', field: 'size_bytes', dir: 'desc' },
    ],
    filters: [
        { id: 'type', label: 'Type', field: 'asset_type' },
        { id: 'format', label: 'Format', field: 'format' },
    ],
};
