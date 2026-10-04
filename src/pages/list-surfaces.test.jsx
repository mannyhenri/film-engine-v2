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

const REQUIRED = {
    // film-engine-v2 agent
    characters: 'v2', locations: 'v2', props: 'v2', scenes: 'v2', storyboard: 'v2', shotboard: 'v2', consistency: 'v2',
    assets: 'v2', jobsqueue: 'v2', notes: 'v2', renderhistory: 'v2', moodboard: 'v2', stylebook: 'v2', marketing: 'v2',
    subtitles: 'v2', titles: 'v2', rights: 'v2', deliverables: 'v2', projects: 'v2',
    // film-engine agent
    productiongraph: 'fe', videoshots: 'fe', playback: 'fe', music: 'fe', musiccues: 'fe', musicws: 'fe', screenplay: 'fe',
    previs: 'fe', threed: 'fe', flows: 'fe', edits: 'fe', budget: 'fe',
};
// Not wired yet, each with its owner (REQUIRED); an owner removes a name here in the commit that wires it.
const PENDING = new Set([
    'scenes', 'storyboard', 'shotboard', 'consistency', 'assets', 'jobsqueue', 'notes', 'renderhistory', 'moodboard',
    'stylebook', 'marketing', 'subtitles', 'titles', 'rights', 'deliverables', 'projects',
    'productiongraph', 'videoshots', 'playback', 'music', 'musiccues', 'musicws', 'screenplay', 'previs', 'threed', 'flows',
    'edits', 'budget',
]);

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
