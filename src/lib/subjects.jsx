import { useState } from 'react';
import { legacy } from './legacy.js';

/*
 * What the three subject pages (characters, locations, props) share. In the legacy app this was the
 * `subjects` chunk; with all three pages React, it is here.
 */

/**
 * Write the missing descriptions from the screenplay.
 *
 * The route has existed since the screenplay-to-entities work and was
 * reachable only over HTTP: no button, and deliberately no MCP tool, since
 * it hands the reasoning to a server-side LLM and the agent host IS the
 * model. So in the app, descriptions were typed by hand — and an entity
 * with no description generates a bare name, which is how a character
 * becomes a different person in every frame.
 *
 * Fills only what is BLANK. A description someone wrote is a decision, and
 * a button that quietly replaced it would be unusable twice.
 *
 * `reload` is the page's own loader (the legacy version took its name and looked it up on window).
 */
export async function describeFromScreenplay(reload) {
    if (!legacy.state.currentProject) return;
    legacy.setStatus('Reading the screenplay...', true);
    try {
        const r = await legacy.api('/projects/' + legacy.state.currentProject.id + '/entities/describe', {
            method: 'POST', body: JSON.stringify({}),
        });
        const n = r.described_count || (r.described || []).length;
        // Named, not counted. An entity that stays blank generates a bare
        // name and must not look like success.
        const missed = (r.still_blank || []).map(x => x.name || x).filter(Boolean);
        legacy.setStatus(
            (n ? `Described ${n} entit${n === 1 ? 'y' : 'ies'}` : (r.message || 'Nothing was blank'))
            + (missed.length ? ` — still blank: ${missed.join(', ')}` : '')
            + (r.provider ? ` (via ${r.provider})` : ''));
        if (typeof reload === 'function') await reload();
    } catch (err) {
        legacy.setStatus('Could not describe from the screenplay: ' + err.message);
    }
}

export const DESCRIBE_TITLE = 'Write the missing descriptions from the screenplay. Only fills what is blank — a description you wrote is a decision and is never overwritten.';

/**
 * A record as the legacy setModalData() put it into a form: a number field with no value shows EMPTY,
 * not 0 (a size of zero is not a thing, and showing one reads as a declared measurement); anything else
 * absent is ''. A value a select does not offer is '' too: assigning it to the legacy select left it with
 * no selection, so getModalData() read '' and the body left the field out.
 */
export function formFrom(record, fields, selects = {}) {
    const values = {};
    for (const f of fields) {
        const v = record ? record[f] : undefined;
        values[f] = (v === null || v === undefined) ? '' : String(v);
        if (selects[f] && !selects[f].includes(values[f])) values[f] = '';
    }
    return values;
}

/** The plate on a location or prop card: a banner across the top. */
export const BANNER_STYLE = { width: 'calc(100% + 24px)', height: 120, objectFit: 'cover', borderRadius: '8px 8px 0 0', margin: '-12px -12px 8px -12px', cursor: 'zoom-in' };

/*
 * Search and sort for a subject list (Characters, Locations, Props). The server sends the list in name order; this
 * filters and orders what was read, with no second request. A search matches the name and the fields the page lists,
 * ignoring case. The sort chosen is remembered per page in this browser (a convenience: storage may be unavailable,
 * and then the default holds); the search is not, so a returning visit always shows the whole list.
 */
export const SUBJECT_SORTS = [
    { id: 'name-asc', label: 'Name A–Z' },
    { id: 'name-desc', label: 'Name Z–A' },
    { id: 'added', label: 'Recently added' },
    { id: 'edited', label: 'Recently edited' },
];
export const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
const COMMON_ORDER = {
    'name-asc': byName,
    'name-desc': (a, b) => byName(b, a),
    added: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || byName(a, b),
    edited: (a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || byName(a, b),
};
const sortKey = (page) => `fe_subject_sort_${page}`;
function readSort(page, allowed) {
    try { const v = localStorage.getItem(sortKey(page)); return allowed.includes(v) ? v : 'name-asc'; } catch (_) { return 'name-asc'; }
}

/**
 * page: 'characters' | 'locations' | 'props'; rows: what was read (or null before the read); fields: the text fields a
 * search reads besides the name; sorts: the page's own [{ id, label, order(a, b) }], added after the common four.
 */
export function useSubjectList(page, rows, { fields = [], sorts = [] } = {}) {
    const options = [...SUBJECT_SORTS, ...sorts.map(({ id, label }) => ({ id, label }))];
    const [sort, setSortState] = useState(() => readSort(page, options.map(o => o.id)));
    const [query, setQuery] = useState('');
    const setSort = (v) => { setSortState(v); try { localStorage.setItem(sortKey(page), v); } catch (_) { /* not kept */ } };
    const q = query.trim().toLowerCase();
    const matches = (r) => !q || ['name', ...fields].some(f => String(r[f] ?? '').toLowerCase().includes(q));
    const order = (sorts.find(s => s.id === sort) || {}).order || COMMON_ORDER[sort] || byName;
    const shown = rows ? rows.filter(matches).sort(order) : null;
    return { query, setQuery, sort, setSort, options, shown, total: rows ? rows.length : 0 };
}

/** The bar above a subject grid: search, sort, and how many are shown. */
export function SubjectListBar({ list, noun }) {
    const { query, setQuery, sort, setSort, options, shown, total } = list;
    if (!shown) return null;
    return (
        <div className="subject-list-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 12px', flexWrap: 'wrap' }}>
            <input type="search" className="input" data-subject-search placeholder={`Search ${noun}`} aria-label={`Search ${noun}`}
                   value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: '1 1 220px', maxWidth: 360 }} />
            <select data-subject-sort aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <span className="text-sm text-muted" data-subject-count>{query.trim() ? `${shown.length} of ${total} ${noun}` : `${total} ${noun}`}</span>
        </div>
    );
}

/** A search that matched nothing: said across the grid's row, with the way back. */
export function SubjectNoMatch({ list, noun }) {
    return (
        <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
            <h3>No {noun} match “{list.query.trim()}”</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => list.setQuery('')}>Clear search</button>
        </div>
    );
}
