// Deliverables: search, sort and filter the files that leave the job (src/lib/list-controls.jsx;
// src/pages/list-surfaces.test.jsx). Their own order (the sequence order of the exported project) is the default.
export default {
    id: 'deliverables', noun: 'deliverables',
    search: ['key', 'label', 'platform', 'aspect_ratio', 'loudness_target', 'notes'],
    sorts: [
        { id: 'order', label: 'Sequence order', order: () => 0 },
        { id: 'key', label: 'Key A–Z', field: 'key', dir: 'asc' },
        { id: 'longest', label: 'Longest first', field: 'duration_ms', dir: 'desc' },
    ],
    filters: [
        { id: 'status', label: 'Status', field: 'status' },
        { id: 'platform', label: 'Platform', field: 'platform' },
        { id: 'aspect', label: 'Aspect', field: 'aspect_ratio' },
    ],
};
