/*
 * The desktop app opens where you left it. In a browser the address bar keeps
 * #/<project>/<page> across reloads; Electron starts each launch with no hash,
 * which always landed on the project list, where every phase menu is hidden
 * until a film is open. So the route is remembered, and restored on a launch
 * that brings none, before the app's code reads it (applyRoute runs after its
 * project list loads; a film that is gone falls back to the list, as it does
 * for any stale link). Storage that throws simply means no memory.
 */
const KEY = 'fe_last_route';
const ROUTE = /^#\/[0-9a-fA-F-]{36}\/[A-Za-z0-9_-]+$/; // as readRoute in core.js

function read() { try { return localStorage.getItem(KEY); } catch { return null; } }
function save() {
    try { if (ROUTE.test(location.hash)) localStorage.setItem(KEY, location.hash); } catch { /* no memory */ }
}

export function restoreRoute() {
    const last = read();
    // replaceState, not location.hash: no hashchange, the app's own boot applies it.
    if (!location.hash && last && ROUTE.test(last)) history.replaceState(null, '', last);
    // writeRoute uses replaceState (no event), so save on leaving and every few seconds.
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
    setInterval(save, 3000);
    window.__feRoute = { save, last: read };
}
