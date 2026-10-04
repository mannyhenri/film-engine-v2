// 3D Models: search, sort and filter its two lists, the characters and props a model can be made from, and the models
// made (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx and, on the page, list-wiring.test.jsx).
export default [
    {
        id: 'threed-subjects', noun: 'subjects',
        search: ['name'],
        sorts: [
            { id: 'as-read', label: 'Characters, then props', field: 'order', dir: 'asc' },
            { id: 'name', label: 'Name A–Z', field: 'name', dir: 'asc' },
        ],
        filters: [{ id: 'kind', label: 'Kind', field: 'kind' }],
    },
    {
        id: 'threed-models', noun: 'models',
        search: ['file_name', 'kind'],
        sorts: [
            { id: 'as-read', label: 'As made', field: 'order', dir: 'asc' },
            { id: 'name', label: 'File A–Z', field: 'file_name', dir: 'asc' },
        ],
        filters: [{ id: 'kind', label: 'Kind', field: 'kind' }, { id: 'format', label: 'Format', field: 'format' }],
    },
];
