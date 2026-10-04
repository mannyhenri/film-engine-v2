// Titles & Credits: two lists, each searched, sorted and filtered (src/lib/list-controls.jsx;
// src/pages/list-surfaces.test.jsx). Both keep their served order (credits by section then billing, cards by their
// order) as the default: that is the order the roll and the film run in.
export default [
    {
        id: 'titles', noun: 'credits',
        search: ['name', 'role', 'character_name', 'section'],
        sorts: [
            { id: 'order', label: 'Billing order', order: () => 0 },
            { id: 'name', label: 'Name A–Z', field: 'name', dir: 'asc' },
            { id: 'role', label: 'Role A–Z', field: 'role', dir: 'asc' },
        ],
        filters: [{ id: 'section', label: 'Section', field: 'section' }],
    },
    {
        id: 'titles-cards', noun: 'title cards',
        search: ['text', 'subtext', 'position_in_timeline'],
        sorts: [
            { id: 'order', label: 'Card order', order: () => 0 },
            { id: 'text', label: 'Text A–Z', field: 'text', dir: 'asc' },
            { id: 'longest', label: 'Longest hold first', field: 'duration_ms', dir: 'desc' },
        ],
        filters: [{ id: 'type', label: 'Type', field: 'card_type' }],
    },
];
