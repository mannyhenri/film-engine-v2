/*
 * The other half of src/pages/list-surfaces.test.jsx. That test holds what each surface DECLARES; this one holds that
 * the page USES it: the page is mounted on rows, its own bar is typed into, and what it draws must be exactly what
 * applyListControls says for those rows. One search per declared field, every filter, every sort, and a query that
 * matches nothing. A find surface keeps every row and marks the matches.
 *
 * Set-based over every surface declared in src/pages/<page>/list-surface.js: each needs its page's recipe.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, act } from '@testing-library/react';
import { applyListControls, findMatches, filterValues } from '../lib/list-controls.jsx';
import { REQUIRED } from './list-surfaces.registry.js';

const SURFACES = Object.fromEntries(Object.entries(import.meta.glob('./*/list-surface.js', { eager: true }))
    .flatMap(([f, m]) => [].concat(m.default).map(s => [s.id, { page: f.split('/')[1], ...s }])));

afterEach(() => { vi.restoreAllMocks(); });

/*
 * Each wired surface's page declares how it is mounted, beside its list-surface.js: list-wiring.test-recipe.jsx exports
 * { rowKey, open() }, open() mounting the page on rows and returning { rows, keys(), marked() }. Rows give every
 * declared field a distinct value, so each control narrows.
 */
const WIRING = Object.fromEntries(Object.entries(import.meta.glob('./*/list-wiring.test-recipe.jsx', { eager: true }))
    .map(([f, m]) => [f.split('/')[1], m.default]));

// Wired surfaces whose recipe is still to be written, each with who writes it. An entry here that has a recipe fails.
const NO_RECIPE_YET = { characters: 'v2', locations: 'v2', props: 'v2' };
const WIRED = [...new Set(Object.values(SURFACES).map(s => s.page))].sort();

describe('every wired list is held by its page', () => {
    it('each wired page has a recipe (or is named, with who writes it); every recipe is for a wired page', () => {
        expect(WIRED.filter(p => !WIRING[p] && !NO_RECIPE_YET[p]), 'wired, no recipe').toEqual([]);
        expect(Object.keys(WIRING).filter(p => !WIRED.includes(p)), 'a recipe for a page that declares no surface').toEqual([]);
        expect(Object.keys(NO_RECIPE_YET).filter(p => WIRING[p]), 'has a recipe now: remove it from NO_RECIPE_YET').toEqual([]);
        expect(Object.keys(NO_RECIPE_YET).filter(p => !REQUIRED[p]), 'not a required surface').toEqual([]);
    });
});

const bar = (id) => document.querySelector(`[data-list-controls="${id}"]`);
const set = async (el, value) => { await act(async () => { fireEvent.change(el, { target: { value } }); }); };

describe.each(Object.values(SURFACES).filter(s => WIRING[s.page]).map(s => [s.id, s]))('%s', (id, declared) => {
    const w = WIRING[declared.page];
    it('declares its surface, and its page draws the bar', async () => {
        await w.open(id);
        expect(bar(id), 'no bar on the page').toBeTruthy();
    });

    it('what it draws is what applyListControls says: every search field, every filter, every sort, no match', async () => {
        const surface = declared;
        const { rows, keys, marked } = await w.open(id);
        const b = bar(id);
        expect(b).toBeTruthy();
        const all = rows.map(w.rowKey);
        const want = (ctl) => applyListControls(surface, rows, ctl).map(w.rowKey);
        const search = b.querySelector('[data-list-search]');
        expect(keys(), 'the page draws the rows as read').toEqual(want({}));

        for (const f of surface.search) {
            const q = String(rows[1][f] ?? '');
            expect(q, `fixture row 1 has no ${f}`).not.toBe('');
            await set(search, q);
            if (surface.mode === 'find') {
                expect(keys(), `find on ${f} removed rows`).toEqual(all);
                expect(marked(), `find on ${f}`).toEqual(findMatches(surface, rows, q).map(i => all[i]));
            } else {
                expect(want({ query: q }).length, `${f}: the fixture does not narrow`).toBeLessThan(rows.length);
                expect(keys(), `search ${f}="${q}"`).toEqual(want({ query: q }));
            }
        }
        await set(search, '');

        for (const f of surface.filters || []) {
            const sel = b.querySelector(`[data-list-filter="${f.id}"]`);
            expect(sel, `no ${f.id} filter`).toBeTruthy();
            for (const v of filterValues(rows, f)) {
                await set(sel, v);
                expect(keys(), `${f.id}=${v}`).toEqual(want({ filters: { [f.id]: v } }));
            }
            await set(sel, '');
        }

        if ((surface.sorts || []).length > 1) {
            const sel = b.querySelector('[data-list-sort]');
            for (const s of surface.sorts) {
                await set(sel, s.id);
                expect(keys(), `sort ${s.id}`).toEqual(want({ sort: s.id }));
            }
        }

        await set(search, 'zzz-nothing');
        if (surface.mode === 'find') {
            expect(keys()).toEqual(all);
            expect(marked()).toEqual([]);
        } else {
            expect(keys()).toEqual([]);
            expect(document.querySelector('[data-list-nomatch]'), 'a search that matched nothing says so').toBeTruthy();
        }
    });
});
