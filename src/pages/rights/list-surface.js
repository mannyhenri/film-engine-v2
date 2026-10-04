// Rights: search, sort and filter the register (src/lib/list-controls.jsx; src/pages/list-surfaces.test.jsx). The
// status has its own select on the page (#rightsFilter), so it is not a second filter here.
export default {
    id: 'rights', noun: 'records',
    search: ['subject', 'owner', 'source', 'territory', 'consent_reference', 'restrictions', 'notes'],
    sorts: [
        { id: 'order', label: 'As recorded', order: () => 0 },
        { id: 'subject', label: 'Subject A–Z', field: 'subject', dir: 'asc' },
        // What runs out first is what to renew first; a record that never expires goes last.
        { id: 'expiring', label: 'Expiring soonest', order: (a, b) => {
            const x = String(a.expires_on || '').slice(0, 10), y = String(b.expires_on || '').slice(0, 10);
            return (x ? 0 : 1) - (y ? 0 : 1) || x.localeCompare(y);
        } },
        { id: 'edited', label: 'Recently edited', field: 'updated_at', dir: 'desc' },
    ],
    filters: [
        { id: 'type', label: 'Type', field: 'rights_type' },
        { id: 'attaches', label: 'Attaches to', field: 'entity_type' },
        { id: 'origin', label: 'Origin', field: 'origin' },
    ],
};
