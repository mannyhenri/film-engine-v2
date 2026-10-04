// The cost ledger: search, sort and filter its entries (src/lib/list-controls.jsx; held by
// src/pages/list-surfaces.test.jsx and, on the page, src/pages/list-wiring.test.jsx). Newest first, as the route reads them.
export default {
    id: 'budget', noun: 'cost entries',
    search: ['description', 'model_used', 'cost_type'],
    sorts: [
        { id: 'newest', label: 'Newest first', field: 'created_at', dir: 'desc' },
        { id: 'oldest', label: 'Oldest first', field: 'created_at', dir: 'asc' },
        { id: 'largest', label: 'Largest first', field: 'amount', dir: 'desc' },
        { id: 'smallest', label: 'Smallest first', field: 'amount', dir: 'asc' },
    ],
    filters: [{ id: 'type', label: 'Type', field: 'cost_type' }],
};
