import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useListControls, ListControlsBar, ListNoMatch } from './list-controls.jsx';

/*
 * Search, sort and filter for a list an ENGINE draws (an innerHTML string into an element by id), without changing the
 * engine: engine code is held verbatim to the reference (tools/tests/engine-verbatim.test.js), and backend tests read
 * its text. The bar sits just before the engine's element, in a host this adds (data-v2-added="list-controls", which
 * the reference-markup comparison leaves out). After every draw the engine makes, the items it drew are matched to its
 * own rows and narrowed in place (dim, for a canvas, fades rather than hides, so nothing moves):
 *
 *   filter  an item whose row is not shown gets .list-hidden (display: none);
 *   sort    the shown items are put in the chosen order (moved, never redrawn: their handlers stay theirs);
 *   find    every item stays where it is, and the matches get .list-find-match; Enter steps to the next, and hands
 *           that row to onFind (the Screenplay goes to the scene).
 *
 * Rows are read from the engine's own state at each draw (rows()), so nothing is fetched. An item is matched to its
 * row by a key when the engine draws one (keys: { row, el }), else by its position in the engine's draw; a draw whose item count is not its
 * row count is left alone and said (data-list-mismatch on the host), never guessed at.
 */
export default function DrawnListControls({ surface, container, item, rows, keys, dim = false, onFind, before }) {
    const [host, setHost] = useState(null);
    const drawnIn = useRef(null);
    const [data, setData] = useState(null);
    const list = useListControls(surface, data);
    const listRef = useRef(list);
    listRef.current = list;
    const [step, setStep] = useState(0);
    useEffect(() => { setStep(0); }, [list.query]);

    // Find the engine's element (it may be drawn later), put the bar's host before it, and re-read the rows after
    // every draw the engine makes.
    useLayoutEffect(() => {
        let el = null, h = null, watch = null, seen = -1;
        // A fresh draw: each item is the row at its position, so it is stamped with that row now, before any sort
        // moves it (matching by position later would match a moved item to the wrong row). A change that only moves
        // items already seen (the same items, the same count) is this component's own sort, not a draw; anything new,
        // or a different count, is the engine drawing again.
        const read = (records) => {
            if (!el) return;
            // Pages mount before the legacy core script runs, so core's state may not exist yet: then there is
            // nothing drawn to narrow, and the engine's first draw reads again.
            let now;
            try { now = (rows() || []).slice(); } catch (_) { return; }
            const drawnNow = [...el.querySelectorAll(item)];
            if (records && drawnNow.length === seen && drawnNow.every(n => n.__listSeen)) return;
            seen = drawnNow.length;
            drawnNow.forEach((n, i) => { n.__listRow = i; n.__listSeen = true; });
            setData(now);
        };
        const attach = () => {
            el = typeof container === 'function' ? container() : document.getElementById(container);
            if (!el || !el.parentNode) return false;
            h = document.createElement('div');
            h.setAttribute('data-v2-added', 'list-controls');
            h.style.gridColumn = '1 / -1'; // inside a grid it spans the row rather than taking a card's cell
            // The bar goes before the engine's element, or before `before` where that element sits inside something the
            // bar cannot (the graph's world is panned and zoomed inside its canvas).
            const at = (before && document.getElementById(before)) || el;
            at.parentNode.insertBefore(h, at);
            drawnIn.current = el;
            setHost(h);
            watch = new MutationObserver((records) => read(records));
            watch.observe(el, { childList: true });
            read(null);
            return true;
        };
        let wait = null;
        if (!attach()) {
            wait = new MutationObserver(() => { if (attach()) wait.disconnect(); });
            wait.observe(document.body, { childList: true, subtree: true });
        }
        return () => {
            if (wait) wait.disconnect();
            if (watch) watch.disconnect();
            if (h) h.remove();
            if (el) el.querySelectorAll('.list-hidden, .list-dim, .list-find-match').forEach(n => n.classList.remove('list-hidden', 'list-dim', 'list-find-match'));
        };
    }, []);

    // Narrow what was drawn, in place.
    useEffect(() => {
        if (!host || !data) return;
        const el = drawnIn.current;
        if (!el) return;
        const items = [...el.querySelectorAll(item)];
        const rowKey = keys ? keys.row : (r) => data.indexOf(r);
        const itemKey = keys ? keys.el : (n) => n.__listRow;
        if (!keys && items.length !== data.length) { host.setAttribute('data-list-mismatch', `${items.length} drawn, ${data.length} rows`); return; }
        host.removeAttribute('data-list-mismatch');
        // A row may be drawn as several elements (a lane's head and its body): each key holds all of them.
        const byKey = new Map();
        for (const n of items) { const k = String(itemKey(n)); byKey.set(k, [...(byKey.get(k) || []), n]); }
        {
            const hide = dim ? 'list-dim' : 'list-hidden';
            if (surface.mode === 'find') {
                const hit = new Set((list.matches || []).map(i => String(rowKey(data[i]))));
                for (const [k, ns] of byKey) for (const n of ns) n.classList.toggle('list-find-match', hit.has(k));
                const first = [...byKey].filter(([k]) => hit.has(k)).map(([, ns]) => ns[0]);
                const n = first[step % Math.max(first.length, 1)];
                if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' });
            } else {
                const shown = list.shown.map(r => String(rowKey(r)));
                const keep = new Set(shown);
                for (const [k, ns] of byKey) for (const n of ns) n.classList.toggle(hide, !keep.has(k));
                // Reorder only for a declared sort, only what is a direct child, and only when the order differs.
                if ((surface.sorts || []).length && !dim) {
                    const order = shown.flatMap(k => byKey.get(k) || []).filter(n => n.parentNode === el);
                    const now = [...el.children].filter(n => order.includes(n));
                    if (order.some((n, i) => now[i] !== n)) for (const n of order) el.appendChild(n);
                }
            }
        }
    }, [host, data, list.query, list.sort, JSON.stringify(list.filters), step]);

    if (!host) return null;
    const empty = surface.mode !== 'find' && list.narrowed && list.shown && !list.shown.length;
    return createPortal(
        <div onKeyDown={(e) => {
            if (e.key !== 'Enter' || surface.mode !== 'find' || !list.matches || !list.matches.length) return;
            const row = data[list.matches[step % list.matches.length]];
            if (onFind && row) onFind(row);
            setStep(s => s + 1);
        }}>
            {data && data.length > 0 && <ListControlsBar list={list} />}
            {empty && <ListNoMatch list={list} />}
        </div>,
        host,
    );
}
