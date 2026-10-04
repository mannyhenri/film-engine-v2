/*
 * Every list that grows with the film can be searched, sorted and filtered (the user, 2026-10-04: "sort, filter and
 * search in every area where there will be a lot of items"). REQUIRED is the set, from the code (each page's main list
 * that grows per scene, shot, frame, asset, job or subject), with its owner. A surface is WIRED when its page declares
 * it (src/pages/<id>/list-surface.js); one not yet wired is named in PENDING, so the set cannot quietly shrink, and a
 * pending entry that is already wired fails (move it out).
 *
 * Each wired surface is held, by the pure function its page and any engine both use (src/lib/list-controls.jsx), over
 * rows generated from its OWN declared fields: every search field finds the row it is on and only that row, every sort
 * orders by what it says, every filter narrows to its value, and nothing is ever fetched to do it. An order that is the
 * content (sorts: []) must say why; a find surface keeps every row and marks the matches.
 */
import { describe, it, expect } from 'vitest';
import { applyListControls, findMatches, filterValues, sortOrder } from '../lib/list-controls.jsx';

import { REQUIRED, PENDING } from './list-surfaces.registry.js';

// Every declared surface: a page may declare more than one (export default one, or an array).
const DECLARED = Object.entries(import.meta.glob('./*/list-surface.js', { eager: true }))
    .flatMap(([f, m]) => [].concat(m.default).map(s => ({ page: f.split('/')[1], ...s })));
const WIRED = new Set(DECLARED.map(s => s.page));

describe('the set of lists that grow with the film', () => {
    it('every required surface is wired or named pending; nothing pending is already wired', () => {
        const problems = [];
        for (const id of Object.keys(REQUIRED)) {
            if (!WIRED.has(id) && !PENDING.has(id)) problems.push(`${id} (${REQUIRED[id]}): neither wired nor pending`);
            if (WIRED.has(id) && PENDING.has(id)) problems.push(`${id}: wired, so remove it from PENDING`);
        }
        for (const id of PENDING) if (!REQUIRED[id]) problems.push(`${id}: pending but not required`);
        expect(problems).toEqual([]);
    });
});

/** Rows from a surface's own fields: row i has a distinct value in every field (text 'v<i> field', numbers i). */
function rowsFor(surface, n = 3) {
    const fields = new Set([...(surface.search || []), ...(surface.filters || []).map(f => f.field),
        ...(surface.sorts || []).filter(s => s.field).map(s => s.field)]);
    return Array.from({ length: n }, (_, i) => Object.fromEntries([...fields].map(f => [f, `v${i} ${f}`]).concat([['__i', i]])));
}

describe.each(DECLARED.map(s => [`${s.page}${s.id && s.id !== s.page ? ` (${s.id})` : ''}`, s]))('%s', (_, surface) => {
    it('declares what it is: an id, a noun, the fields it searches; sorts, or why its order is the content', () => {
        expect(surface.id && surface.noun).toBeTruthy();
        expect((surface.search || []).length, 'searches nothing').toBeGreaterThan(0);
        if (!(surface.sorts || []).length) expect(String(surface.why || '').length, 'no sorts and no reason the order is the content').toBeGreaterThan(10);
    });

    it('every search field finds the row it is on, ignoring case, and only that row', () => {
        const rows = rowsFor(surface);
        for (const f of surface.search) {
            const q = `V1 ${f}`.toUpperCase();
            if (surface.mode === 'find') {
                expect(applyListControls(surface, rows, { query: q }).length, `${f}: find removed rows`).toBe(rows.length);
                expect(findMatches(surface, rows, q), f).toEqual([1]);
            } else {
                expect(applyListControls(surface, rows, { query: q }).map(r => r.__i), f).toEqual([1]);
            }
        }
    });

    it('every sort orders by what it says (ascending and descending by its field; a custom order is a comparator)', () => {
        const rows = rowsFor(surface).reverse();
        for (const s of surface.sorts || []) {
            const got = applyListControls(surface, rows, { sort: s.id }).map(r => r.__i);
            if (s.field) expect(got, s.id).toEqual(s.dir === 'desc' ? [2, 1, 0] : [0, 1, 2]);
            else expect(typeof sortOrder(s), s.id).toBe('function');
        }
    });

    it('every filter offers the values present and narrows to the one chosen', () => {
        const rows = rowsFor(surface);
        for (const f of surface.filters || []) {
            const values = filterValues(rows, f);
            expect(values.length, f.id).toBe(3);
            expect(applyListControls(surface, rows, { filters: { [f.id]: values[2] } }).map(r => r.__i), f.id).toEqual([2]);
        }
    });

    it('a query that matches nothing shows nothing, or (find) marks nothing and keeps everything', () => {
        const rows = rowsFor(surface);
        const shown = applyListControls(surface, rows, { query: 'zzz-nothing' });
        if (surface.mode === 'find') { expect(shown.length).toBe(rows.length); expect(findMatches(surface, rows, 'zzz-nothing')).toEqual([]); }
        else expect(shown).toEqual([]);
    });
});
