/*
 * Three backend sub-tests read the subject pages' legacy SOURCE, which the React pages do not have:
 *   character-sheet.test.js "a character card has exactly two buttons" (the card-actions row in loadCharacters)
 *   character-sheet.test.js "clicking the card opens the sheet" (onclick="openCharacterSheet(" in loadCharacters)
 *   page-handlers.test.js   "a successful location save is not reported as an error" (saveLocation's body)
 *   screenplay-to-entities.test.js "describing from the screenplay is reachable in the app"
 *     (function describeFromScreenplay and three onclick="describeFromScreenplay(" in the page script)
 * All four are skipped (SKIPPED-SUBTESTS.json) and every assertion is held here, by render: the card is
 * drawn and counted, clicked and followed; the location save is run down its screenplay-updated branch.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { installLegacy } from '../test/setup.js';
import { LEGACY_GLOBALS } from '../lib/legacy.js';
import CharactersPage from './characters/CharactersPage.jsx';
import LocationsPage from './locations/LocationsPage.jsx';
import PropsPage from './props/PropsPage.jsx';

const CORE = fs.readFileSync(path.resolve(__dirname, '../../public/legacy/core.js'), 'utf8');
const definedInCore = (n) => new RegExp(`^\\s{0,4}(async\\s+)?function\\s+${n}\\s*\\(`, 'm').test(CORE);

describe('the character card (character-sheet.test.js, moved)', () => {
    async function cardOf() {
        installLegacy({ routes: { 'GET /projects/p1/characters': { characters: [
            // Missing gender and age, and a plate: the "+ gender & age" link and the plate are on the card too,
            // and neither is an action button.
            { id: 'c1', name: 'Mara', reference_image_url: '/p.png' },
        ] } } });
        render(<CharactersPage />);
        await act(async () => { await window.loadCharacters(); });
        return screen.getByText('Mara').closest('.entity-card');
    }

    it('a character card has exactly two buttons', async () => {
        const card = await cardOf();
        const row = card.querySelector('.card-actions');
        expect(row, 'no card-actions row to count').toBeTruthy();
        expect([...row.querySelectorAll('button')].map(b => b.textContent.trim())).toEqual(['Edit', 'Delete']);
        expect(card.querySelectorAll('button').length, 'a button outside the action row').toBe(2);
    });

    it('clicking the card opens the sheet, and core defines the sheet', async () => {
        const card = await cardOf();
        fireEvent.click(card);
        expect(window.openCharacterSheet).toHaveBeenCalledWith('c1');
        expect(LEGACY_GLOBALS).toContain('openCharacterSheet');
        expect(definedInCore('openCharacterSheet'), 'openCharacterSheet does not exist').toBe(true);
    });
});

describe('a successful location save is not reported as an error (page-handlers.test.js, moved)', () => {
    it('the screenplay-updated branch reaches only what exists, and reports success', async () => {
        const { status } = installLegacy({ routes: {
            'GET /projects/p1/locations': { locations: [{ id: 'l1', name: 'Dock' }] },
            'PUT /locations/l1': { screenplay_update: { updated: true, occurrences: 1, new_version: 2 } },
        } });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<LocationsPage />);
        await act(async () => { await window.loadLocations(); });
        fireEvent.click(within(screen.getByText('Dock').closest('.entity-card')).getByText('Edit'));
        fireEvent.change(document.querySelector('#locationModal [data-field="name"]'), { target: { value: 'Pier' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(status.filter(s => /^Error/.test(s))).toEqual([]);
        expect(status).toContain('Location saved. Screenplay updated: 1 occurrence(s) renamed (v2)');
        // What that branch calls in core is a real core function (the original bug: a name nothing defined).
        expect(window.loadScreenplayPage).toHaveBeenCalled();
        expect(definedInCore('loadScreenplayPage'), 'saveLocation reloads the screenplay through a loader nothing defines').toBe(true);
        confirm.mockRestore();
    });
});

describe('describing from the screenplay is reachable in the app (screenplay-to-entities.test.js, moved)', () => {
    // On all three entity pages, because the gap is per page: a button on characters alone leaves
    // locations and props typed by hand.
    const PAGES = [
        { Page: CharactersPage, loader: 'loadCharacters', list: '/projects/p1/characters', key: 'characters' },
        { Page: LocationsPage, loader: 'loadLocations', list: '/projects/p1/locations', key: 'locations' },
        { Page: PropsPage, loader: 'loadProps', list: '/projects/p1/props', key: 'props' },
    ];
    for (const { Page, loader, list, key } of PAGES) {
        it(`${key}: the button calls the describe route, reports what stayed blank, and reloads`, async () => {
            const { calls, status } = installLegacy({ routes: {
                [`GET ${list}`]: { [key]: [] },
                'POST /projects/p1/entities/describe': { described_count: 1, still_blank: [{ name: 'Rook' }] },
            } });
            render(<Page />);
            await act(async () => { await window[loader](); });
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Describe from screenplay' })); });
            expect(calls.filter(c => c.method === 'POST').map(c => c.path)).toEqual(['/projects/p1/entities/describe']);
            // An entity that stayed blank is reported, so it does not look like success.
            expect(status).toContain('Described 1 entity \u2014 still blank: Rook');
            expect(calls.filter(c => c.path === list).length).toBe(2);
        });
    }
});
