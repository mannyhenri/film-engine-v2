import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../test/setup.js';
import TitlesPage from './titles/TitlesPage.jsx';
import RightsPage from './rights/RightsPage.jsx';

/*
 * The original drew these six selects with core's vocabOptions(), which shows each served value with its underscores
 * as spaces ("special thanks", "commercial use") and keeps the value as the server wrote it. The React pages had lost
 * the label half (found by tools/core-ownership.js: vocabOptions was live in the original and reached by nobody here).
 * Set-based over every select vocabOptions drew, with values that carry an underscore.
 */
const SELECTS = [
    { page: TitlesPage, loader: 'loadTitles', open: '+ Credit', ids: ['creditSection'],
      routes: { 'GET /projects/p1/credits': { sections: ['cast', 'special_thanks'], credits: [] }, 'GET /projects/p1/title-cards': { card_types: ['main_title', 'end_title'], title_cards: [] } } },
    { page: TitlesPage, loader: 'loadTitles', open: '+ Title card', ids: ['cardType'],
      routes: { 'GET /projects/p1/credits': { sections: ['cast', 'special_thanks'], credits: [] }, 'GET /projects/p1/title-cards': { card_types: ['main_title', 'end_title'], title_cards: [] } } },
    { page: RightsPage, loader: 'loadRights', open: '+ Record', ids: ['rightType', 'rightStatus', 'rightOrigin', 'rightEntityType'],
      routes: { 'GET /projects/p1/rights': { vocabulary: { status: ['unknown', 'not_cleared'], rights_type: ['commercial_use', 'music_license'], entity_type: ['music_cue', 'asset'], origin: ['public_domain', 'original'] }, by_status: {}, rights: [] } } },
];

describe('vocabulary selects show the value with spaces and keep the value', () => {
    it('covers the six selects the original drew with vocabOptions', () => {
        expect(SELECTS.flatMap(s => s.ids)).toHaveLength(6);
    });
    for (const s of SELECTS) for (const id of s.ids) {
        it(`#${id}`, async () => {
            installLegacy({ routes: s.routes });
            const Page = s.page;
            render(<Page />);
            await act(async () => { await window[s.loader](); });
            fireEvent.click(screen.getByRole('button', { name: s.open }));
            const opts = [...document.getElementById(id).querySelectorAll('option')].filter(o => o.value);
            expect(opts.some(o => o.value.includes('_')), `#${id} has no underscored value to check`).toBe(true);
            for (const o of opts) expect(o.textContent, o.value).toBe(o.value.replace(/_/g, ' '));
        });
    }
});
