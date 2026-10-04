// How titles's two lists are mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
// Credits are drawn grouped by section, in the served section order; the fixture puts each credit in its own section, in
// section order, with names and roles in that same order, so every order the surface declares is also the drawn order.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open(id) {
        try { localStorage.clear(); } catch (_) { /* none */ }
        const credits = [
            { id: 'c0', name: 'Ada', section: 'cast', role: 'Actor', character_name: 'MAYA', sort_order: 0 },
            { id: 'c1', name: 'Bo', section: 'crew', role: 'Boom', character_name: 'NOBODY', sort_order: 0 },
            { id: 'c2', name: 'Cy', section: 'special_thanks', role: 'Caterer', character_name: 'ZED', sort_order: 0 },
        ];
        const cards = [
            { id: 't0', text: 'Alpha', subtext: 'first', card_type: 'main_title', duration_ms: 3000, position_in_timeline: 'opening' },
            { id: 't1', text: 'Bravo', subtext: 'second', card_type: 'card', duration_ms: 5000, position_in_timeline: 'midpoint' },
            { id: 't2', text: 'Charlie', subtext: 'third', card_type: 'end_title', duration_ms: 1000, position_in_timeline: 'closing' },
        ];
        installLegacy({ routes: {
            'GET /projects/p1/credits': { sections: ['cast', 'crew', 'special_thanks'], credits },
            'GET /projects/p1/title-cards': { card_types: ['main_title', 'end_title', 'card'], title_cards: cards },
        } });
        const Page = (await import('./TitlesPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadTitles(); });
        return id === 'titles-cards'
            ? { rows: cards, keys: drawn('#titleCardList [data-card-id]', 'data-card-id') }
            : { rows: credits, keys: drawn('#creditList [data-credit-id]', 'data-credit-id') };
    },
};
