// Render History: search, sort and filter a shot's render ledger (src/lib/list-controls.jsx; held by
// src/pages/list-surfaces.test.jsx). The default keeps the ledger as served (by step, newest version first).
export default {
    id: 'renderhistory', noun: 'renders',
    search: ['step', 'model_id', 'mode'],
    sorts: [
        { id: 'ledger', label: 'By step, newest version', order: () => 0 },
        { id: 'newest', label: 'Newest first', field: 'created_at', dir: 'desc' },
        { id: 'version', label: 'Highest version', field: 'version', dir: 'desc' },
        { id: 'slowest', label: 'Slowest first', field: 'inference_ms', dir: 'desc' },
    ],
    filters: [
        { id: 'step', label: 'Step', field: 'step' },
        { id: 'mode', label: 'Mode', field: 'mode' },
        { id: 'model', label: 'Model', field: 'model_id' },
    ],
};
