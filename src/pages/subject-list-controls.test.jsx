/*
 * Search and sort on the three subject lists (Characters, Locations, Props). Set-based over the three pages and, on
 * each, over every field its search reads and every sort its menu offers: a search finds a subject by each field,
 * case-insensitively; each sort orders as it says; a search with no match says so across the grid and offers Clear;
 * the sort chosen is remembered for the page; the count says how many are shown of how many.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { installLegacy } from '../test/setup.js';
import CharactersPage from './characters/CharactersPage.jsx';
import LocationsPage from './locations/LocationsPage.jsx';
import PropsPage from './props/PropsPage.jsx';

const T = (d) => `2026-0${d}-01 10:00:00`;
const PAGES = [
    {
        id: 'characters', Page: CharactersPage, loader: 'loadCharacters', key: 'characters', grid: 'characterGrid',
        rows: [
            { id: 'c1', name: 'Mara', description: 'A pilot', age_range: '30s', gender: 'female', created_at: T(1), updated_at: T(5) },
            { id: 'c2', name: 'theo', description: 'Her brother', age_range: '20s', gender: 'male', created_at: T(3), updated_at: T(2) },
            { id: 'c3', name: 'Ines', description: 'A medic', age_range: '50s', gender: 'non-binary', created_at: T(2), updated_at: T(9) },
        ],
        fields: { description: ['brother', 'theo'], age_range: ['50S', 'Ines'], gender: ['FEMALE', 'Mara'] },
        sorts: { 'name-desc': ['theo', 'Mara', 'Ines'] },
    },
    {
        id: 'locations', Page: LocationsPage, loader: 'loadLocations', key: 'locations', grid: 'locationGrid',
        rows: [
            { id: 'l1', name: 'Dock', description: 'Wet boards', lighting_default: 'sodium', time_of_day_default: 'night', scene_count: 2, created_at: T(2), updated_at: T(3) },
            { id: 'l2', name: 'attic', description: 'Dust', lighting_default: 'window', time_of_day_default: 'day', scene_count: 7, created_at: T(1), updated_at: T(8) },
            { id: 'l3', name: 'Kitchen', description: 'Tiles', lighting_default: 'fluorescent', time_of_day_default: 'dawn', scene_count: 0, created_at: T(4), updated_at: T(1) },
        ],
        fields: { description: ['TILES', 'Kitchen'], lighting_default: ['sodium', 'Dock'], time_of_day_default: ['Day', 'attic'] },
        sorts: { 'name-desc': ['Kitchen', 'Dock', 'attic'], scenes: ['attic', 'Dock', 'Kitchen'] },
    },
    {
        id: 'props', Page: PropsPage, loader: 'loadProps', key: 'props', grid: 'propGrid',
        rows: [
            { id: 'p1', name: 'Lamp', description: 'Brass', category: 'set_dressing', created_at: T(3), updated_at: T(2) },
            { id: 'p2', name: 'van', description: 'Rusty', category: 'vehicle', created_at: T(1), updated_at: T(7) },
            { id: 'p3', name: 'Knife', description: 'Bone handle', category: 'weapon', created_at: T(2), updated_at: T(4) },
        ],
        fields: { description: ['BONE', 'Knife'], category: ['vehicle', 'van'] },
        sorts: { 'name-desc': ['van', 'Lamp', 'Knife'], category: ['Lamp', 'van', 'Knife'] },
    },
];
// What every page offers, whatever else it adds; computed from the rows, so each holds on each page's data.
const COMMON = {
    'name-asc': (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map(r => r.name),
    added: (rows) => [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(r => r.name),
    edited: (rows) => [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(r => r.name),
};

beforeEach(() => { try { localStorage.clear(); } catch (_) { /* none */ } });

async function open(p) {
    installLegacy({ routes: { [`GET /projects/p1/${p.key}`]: { [p.key]: p.rows.map(r => ({ ...r })) }, 'GET /card-vocabulary': { prop_categories: [] } } });
    const view = render(<p.Page />);
    await act(async () => { await window[p.loader](); });
    return view;
}
const shown = (p) => [...document.querySelectorAll(`#${p.grid} .entity-card h3`)].map(h => h.textContent);
const search = () => document.querySelector(`.page.active [data-subject-search], [data-subject-search]`);
const sorter = () => document.querySelector('[data-subject-sort]');
const type = (v) => fireEvent.change(search(), { target: { value: v } });

describe.each(PAGES)('$id: search and sort', (p) => {
    it('has a search box and a sort menu offering at least the common sorts and its own', async () => {
        await open(p);
        expect(search(), 'no search box').toBeTruthy();
        const offered = [...sorter().options].map(o => o.value);
        for (const k of [...Object.keys(COMMON), ...Object.keys(p.sorts)]) expect(offered, k).toContain(k);
    });

    it('starts in name order, every subject shown, and says how many', async () => {
        await open(p);
        expect(sorter().value).toBe('name-asc');
        expect(shown(p)).toEqual(COMMON['name-asc'](p.rows));
        expect(document.querySelector('[data-subject-count]').textContent).toBe(`${p.rows.length} ${p.key}`);
    });

    it('a search finds a subject by its name and by each field it lists, ignoring case', async () => {
        await open(p);
        type(p.rows[0].name.toUpperCase().slice(0, 3));
        expect(shown(p)).toContain(p.rows[0].name);
        for (const [field, [q, want]] of Object.entries(p.fields)) {
            type(q);
            expect(shown(p), `${field}: "${q}"`).toEqual([want]);
            expect(document.querySelector('[data-subject-count]').textContent).toBe(`1 of ${p.rows.length} ${p.key}`);
        }
    });

    it('every sort orders as it says', async () => {
        await open(p);
        for (const [k, order] of Object.entries(COMMON)) {
            fireEvent.change(sorter(), { target: { value: k } });
            expect(shown(p), k).toEqual(order(p.rows));
        }
        for (const [k, order] of Object.entries(p.sorts)) {
            fireEvent.change(sorter(), { target: { value: k } });
            expect(shown(p), k).toEqual(order);
        }
    });

    it('no match says so across the row, and Clear brings everything back', async () => {
        await open(p);
        type('zzz-nothing');
        expect(shown(p)).toEqual([]);
        const msg = document.querySelector(`#${p.grid} > .empty-state`);
        expect(msg && msg.textContent).toContain('zzz-nothing');
        expect(msg.style.gridColumn).toBe('1 / -1');
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(search().value).toBe('');
        expect(shown(p).length).toBe(p.rows.length);
    });

    it('the sort is remembered for the page; the search is not', async () => {
        const last = Object.keys(p.sorts).at(-1);
        await open(p);
        fireEvent.change(sorter(), { target: { value: last } });
        type('x');
        cleanup();
        await open(p);
        expect(sorter().value).toBe(last);
        expect(search().value).toBe('');
    });
});
