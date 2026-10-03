import { flushSync } from 'react-dom';

/*
 * Which project the React pages were mounted for.
 *
 * A React page keeps what it last drew (its state) and every answer still in flight for it. When the open project
 * changes, that is the PREVIOUS project's: a late answer painted A's board under B, wrote A's anchor onto B, and a
 * card re-rendering on its own after "All Projects" asked core for a frame of no project at all and threw, which
 * unmounted the whole app (the user's "the previous one is opened, and then no projects load").
 *
 * So the pages are mounted per project: when navigateTo runs for a different project than last time (it always
 * goes through window.__fePages.ensure first, src/lib/pages.js), the epoch moves on and Main remounts every React
 * page under the new one, synchronously, before the page's loader runs. A late answer for A then lands in a page
 * that no longer exists (React ignores it), and every page starts B empty, with its loaders registered again.
 */
let epoch = 0;
let mountedFor;            // undefined until the first navigation
const listeners = new Set();

export const projectEpoch = () => epoch;
export function subscribeProjectEpoch(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Called before each page's code and loader run: remounts the React pages if the open project changed. */
export function noteOpenProject() {
    const s = window.state;
    const id = (s && s.currentProject && s.currentProject.id) || null;
    if (mountedFor === undefined) { mountedFor = id; return false; }   // boot: the pages were mounted for this
    if (id === mountedFor) return false;
    mountedFor = id;
    epoch++;
    flushSync(() => listeners.forEach(fn => fn()));
    // navigateTo marked the page active on the root that was just replaced: mark the new one, and only it (a
    // remounted page may render itself active, as Projects does: it is the page the app boots on).
    const page = s && s.currentPage && document.getElementById('page-' + s.currentPage);
    document.querySelectorAll('.page.active').forEach(p => { if (p !== page) p.classList.remove('active'); });
    if (page) page.classList.add('active');
    return true;
}

/** Tests: forget what the pages were mounted for. */
export function resetProjectEpoch() { epoch = 0; mountedFor = undefined; listeners.clear(); }
