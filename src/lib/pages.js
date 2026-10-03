import { PAGES } from '../pages/registry.js';

const CHUNKED = new Set(PAGES.filter(p => p.chunk).map(p => p.id));
const loading = new Map();

/*
 * window.__fePages.ensure(page): resolves once that page's code is in. A page's
 * chunk is a classic script, so its functions become globals as they were in
 * the one-file app (inline onclick strings and window[name]() still find them).
 * Loaded at most once: re-running it would redeclare its top-level names.
 */
function ensure(page) {
    if (!CHUNKED.has(page)) return Promise.resolve();
    if (!loading.has(page)) {
        loading.set(page, new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = new URL(`legacy/pages/${page}.js`, document.baseURI).href;
            s.dataset.page = page;
            s.onload = () => resolve();
            s.onerror = () => { loading.delete(page); s.remove(); reject(new Error(`could not load the ${page} page`)); };
            document.head.appendChild(s);
        }));
    }
    return loading.get(page);
}

export function installPageLoader() {
    window.__fePages = { ensure, loaded: () => [...loading.keys()] };
}
