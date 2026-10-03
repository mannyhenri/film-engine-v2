/*
 * The one door from React into the legacy app's globals.
 *
 * A React page must not reimplement what the shared core already does: `api()`
 * (the busy spinner on the control you pressed, the refresh after a write, the
 * error mapping), the status bar, the modal stack, the project state. It reaches
 * them through `legacy.<name>`, and only names listed in LEGACY_GLOBALS.
 *
 * The list is read by tools/split-map.js: every name here is a core root, so the
 * split can never move it into a page chunk that has not loaded. And
 * tools/tests/react-pages.test.js holds every `legacy.<name>` used under src/ to
 * this list, so a page cannot reach a global the split does not keep in core.
 */
export const LEGACY_GLOBALS = [
    'api',          // fetch the API, with the app's spinner, refresh-after-write and errors
    'setStatus',    // the status bar
    'state',        // current project, current page, and the app's shared state
    'esc',          // HTML-escape (for the rare string still headed to innerHTML)
    'showModal',    // open a modal overlay by id, on the shared stack
    'closeModal',   // close it and give its depth back
    'navigateTo',   // go to another page
];

export const legacy = new Proxy({}, {
    get(_, name) {
        if (!LEGACY_GLOBALS.includes(name)) throw new Error(`legacy.${String(name)} is not in LEGACY_GLOBALS (src/lib/legacy.js)`);
        const v = window[name];
        if (v === undefined) throw new Error(`legacy.${String(name)}: the core has not defined it`);
        return v;
    },
});
