import { PAGES, CHUNKS, VENDORS } from '../pages/registry.js';

const chunkOfPage = new Map(PAGES.filter(p => p.chunk).map(p => [p.id, p.chunk]));
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
 * vendored libraries its chunk needs (three.js for the 3D pages), then the
 * chunk. A chunk is a classic script, so its functions become globals as they
 * were in the one-file app (inline onclick strings and window[name]() still
 * find them). Each file loads at most once: re-running a chunk would redeclare
 * its top-level names.
 */
async function ensure(page) {
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
