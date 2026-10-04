import { PAGES, CHUNKS, VENDORS } from '../pages/registry.js';
import { noteOpenProject } from './project-epoch.js';

const chunkOfPage = new Map(PAGES.filter(p => p.chunk).map(p => [p.id, p.chunk]));
// A React page whose engine uses a vendored library (three.js) declares it (react.json "vendors"): there is no chunk
// to carry the dependency, and the engine's first call would find no THREE.
const vendorsOfPage = new Map(PAGES.filter(p => p.vendors && p.vendors.length).map(p => [p.id, p.vendors]));
const loading = new Map(); // script url -> promise

/** A classic script, added once; resolves on its load event. */
function script(file) {
    const url = new URL(`legacy/${file}`, document.baseURI).href;
    if (!loading.has(url)) {
        loading.set(url, new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.async = false; // in insertion order, like the source's script tags
            s.onload = () => resolve();
            s.onerror = () => { loading.delete(url); s.remove(); reject(new Error(`could not load ${file}`)); };
            document.head.appendChild(s);
        }));
    }
    return loading.get(url);
}

/*
 * window.__fePages.ensure(page): resolves once that page's code is in: the
 * vendored libraries a React page declares (three.js for the 3D pages), or
 * those its chunk needs, then the chunk. A chunk is a classic script, so its functions become globals as they
 * were in the one-file app (inline onclick strings and window[name]() still
 * find them). Each file loads at most once: re-running a chunk would redeclare
 * its top-level names.
 */
async function ensure(page) {
    // navigateTo comes through here before every page's loader: a different project than the pages were mounted
    // for remounts them first (src/lib/project-epoch.js), so nothing of the last project is drawn or answered into.
    noteOpenProject();
    for (const dep of vendorsOfPage.get(page) || []) for (const f of VENDORS[dep]) await script(f);
    const chunk = chunkOfPage.get(page);
    if (!chunk) return;
    for (const dep of CHUNKS[chunk].deps) for (const f of VENDORS[dep]) await script(f);
    await script(`chunks/${chunk}.js`);
}

export function installPageLoader() {
    window.__fePages = {
        ensure,
        loaded: () => [...chunkOfPage].filter(([, c]) => loading.has(new URL(`legacy/chunks/${c}.js`, document.baseURI).href)).map(([p]) => p),
    };
}
