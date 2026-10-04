// Marketing: search, sort and filter the assets (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx).
// The type is chosen by the page's own picker (it asks the route for one type), so it is not a filter here too.
// The default keeps the route's order (newest first). `art` is derived by the page: has artwork / no artwork yet.
export default {
    id: 'marketing', noun: 'assets',
    search: ['title', 'prompt', 'type', 'aspect_ratio'],
    sorts: [
        { id: 'newest', label: 'Newest first', order: () => 0 },
        { id: 'title', label: 'Title A–Z', field: 'title', dir: 'asc' },
        { id: 'oldest', label: 'Oldest first', field: 'created_at', dir: 'asc' },
    ],
    filters: [
        { id: 'art', label: 'Artwork', field: 'art' },
        { id: 'aspect', label: 'Aspect', field: 'aspect_ratio' },
    ],
};
