import { useState } from 'react';

/*
 * Search, sort and filter for any list that grows with the film (scenes, frames, shots, assets, jobs, cues...).
 *
 * A surface DECLARES its controls from its data's own fields (src/pages/<id>/list-surface.js), so a test can iterate
 * every search field, sort and filter of every surface:
 *
 *   { id, noun, search: ['name', 'description'],
 *     sorts:   [{ id, label, field, dir: 'asc'|'desc' } | { id, label, order: (a, b) => n }],   // the first is the default
 *     filters: [{ id, label, field }],                                                     // a select of the values present
 *     why:     'the running order is the film',   // REQUIRED when sorts is empty: an order that IS the content
 *     mode:    'find' }                           // search FINDS (marks, steps through) instead of removing rows
 *
 * It narrows what was READ (or what an engine drew from its own state) and never fetches: a second fetch path is how
 * two views of one list come to disagree. applyListControls is the pure part; an engine that draws HTML calls it on
 * its own rows before drawing, and React pages use the hook and the bar below. The sort chosen is remembered per
 * surface in this browser (storage may be unavailable, and then the default holds); the search and filters are not.
 */

const text = (v) => (v === null || v === undefined ? '' : String(v));
const cmp = (a, b) => text(a).localeCompare(text(b), undefined, { sensitivity: 'base', numeric: true });

/** The comparator a declared sort stands for. */
export function sortOrder(sort) {
    if (!sort) return () => 0;
    if (sort.order) return sort.order;
    const dir = sort.dir === 'desc' ? -1 : 1;
    return (a, b) => {
        const x = a[sort.field], y = b[sort.field];
        if (typeof x === 'number' || typeof y === 'number') return dir * ((Number(x) || 0) - (Number(y) || 0));
        return dir * cmp(x, y);
    };
}

/** The values a filter can take: those present in the rows, in order. */
export function filterValues(rows, filter) {
    return [...new Set((rows || []).map(r => text(r[filter.field])).filter(v => v !== ''))].sort(cmp);
}

/**
 * The pure part: rows -> the rows shown, for { query, sort, filters }. Never mutates rows. A query matches any search
 * field, ignoring case; each filter keeps rows whose field equals its value ('' = any); ties keep their input order.
 */
export function applyListControls(surface, rows, { query = '', sort, filters = {} } = {}) {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    // A find surface keeps every row in its order (the order is the content); findMatches says which match.
    if (surface.mode === 'find') return rows.slice();
    const sorter = sortOrder((surface.sorts || []).find(s => s.id === sort) || (surface.sorts || [])[0]);
    return rows
        .filter(r => !q || (surface.search || []).some(f => text(r[f]).toLowerCase().includes(q)))
        .filter(r => Object.entries(filters).every(([id, v]) => {
            if (!v) return true;
            const f = (surface.filters || []).find(x => x.id === id);
            return !f || text(r[f.field]) === v;
        }))
        .map((r, i) => [r, i]).sort(([a, i], [b, j]) => sorter(a, b) || i - j).map(([r]) => r);
}

/** For a find surface: the indexes of the rows the query matches, in order. */
export function findMatches(surface, rows, query = '') {
    const q = query.trim().toLowerCase();
    if (!rows || !q) return [];
    return rows.map((r, i) => [r, i]).filter(([r]) => (surface.search || []).some(f => text(r[f]).toLowerCase().includes(q))).map(([, i]) => i);
}

const storeKey = (id) => `fe_list_sort_${id}`;
function readSort(surface) {
    const ids = (surface.sorts || []).map(s => s.id);
    if (!ids.length) return undefined;
    try { const v = localStorage.getItem(storeKey(surface.id)); if (ids.includes(v)) return v; } catch (_) { /* default */ }
    return ids[0];
}

/** The state of a surface's controls, and the rows they show. */
export function useListControls(surface, rows) {
    const [sort, setSortState] = useState(() => readSort(surface));
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState({});
    const setSort = (v) => { setSortState(v); try { localStorage.setItem(storeKey(surface.id), v); } catch (_) { /* not kept */ } };
    const setFilter = (id, v) => setFilters(f => ({ ...f, [id]: v }));
    const narrowed = !!query.trim() || Object.values(filters).some(Boolean);
    const shown = applyListControls(surface, rows, { query, sort, filters });
    const matches = surface.mode === 'find' ? findMatches(surface, rows, query) : null;
    const clear = () => { setQuery(''); setFilters({}); };
    return { surface, rows, query, setQuery, sort, setSort, filters, setFilter, shown, matches, total: rows ? rows.length : 0, narrowed, clear };
}

/** The bar above a list: search, each filter, the sort, and how many are shown of how many. */
export function ListControlsBar({ list }) {
    const { surface, rows, query, setQuery, sort, setSort, filters, setFilter, shown, matches, total, narrowed } = list;
    if (!shown) return null;
    const count = matches ? (query.trim() ? `${matches.length} of ${total} ${surface.noun} match` : `${total} ${surface.noun}`)
        : narrowed ? `${shown.length} of ${total} ${surface.noun}` : `${total} ${surface.noun}`;
    return (
        <div className="list-controls" data-list-controls={surface.id}
             style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 12px', flexWrap: 'wrap' }}>
            <input type="search" className="input" data-list-search placeholder={surface.mode === 'find' ? `Find in ${surface.noun}` : `Search ${surface.noun}`} aria-label={`Search ${surface.noun}`}
                   value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: '1 1 220px', maxWidth: 360 }} />
            {(surface.filters || []).map(f => (
                <select key={f.id} data-list-filter={f.id} aria-label={f.label} value={filters[f.id] || ''} onChange={(e) => setFilter(f.id, e.target.value)}>
                    <option value="">{f.label}: all</option>
                    {filterValues(rows, f).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
            ))}
            {(surface.sorts || []).length > 1 && (
                <select data-list-sort aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                    {surface.sorts.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
            )}
            <span className="text-sm text-muted" data-list-count>{count}</span>
        </div>
    );
}

/** A search or filter that matched nothing: said across the list's row (a grid cell spans it), with the way back. */
export function ListNoMatch({ list }) {
    const q = list.query.trim();
    return (
        <div className="empty-state" style={{ gridColumn: '1 / -1' }} data-list-nomatch>
            <h3>No {list.surface.noun} match{q ? ` “${q}”` : ' these filters'}</h3>
            <button className="btn btn-secondary btn-sm" onClick={list.clear}>Clear search</button>
        </div>
    );
}
