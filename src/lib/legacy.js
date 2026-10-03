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
    'API_BASE',     // the API's address (a top-level `let`: read live, Settings can change it)
    'loadScreenplayDrift',    // fill DRIFT from the screenplay-drift report (the storyboard reads it too)
    'DRIFT',                  // which scenes' shots were written from an earlier draft (a top-level `let`)
    'updateSceneStatusIcons', // the status icon beside each scene heading in the screenplay editor
    'generateSceneDialogue',  // a scene's dialogue: one paid confirmation, then shot by shot (shared with screenplay)
    'EDIT_CHUNK',   // the upload piece size the server accepts per PUT (edits); a top-level const
    'MW',           // the music workstation's state: "Score this edit" sets MW.session before navigating (edits)
    'mwTime',       // ms -> m:ss.t, as every timing in the app is shown (edits)
    'fmtBytes',     // bytes -> "12.3 MB" (edits)
    'checkUploadSize', // refuse a body over the server's per-request ceiling before sending it (edits)
    'streamSSEPost', // POST that answers as server-sent events: the live pipeline run, step by step (pipeline)
    'refreshProtectOptions', // the board and playback pickers offer the ratios this job ships (deliverables)
    'uploadReferenceImage',   // upload a reference picture: size check, the label's "Uploading…", the error left on it
    'plateSrc',               // a plate's thumbnail URL at a width (the server caches it)
    'openPlateViewer',        // the full-size plate viewer, shared by every page that shows a plate
];


export const legacy = new Proxy({}, {
    get(_, name) {
        if (!LEGACY_GLOBALS.includes(name)) throw new Error(`legacy.${String(name)} is not in LEGACY_GLOBALS (src/lib/legacy.js)`);
        // A function declaration or window.<name> is on window; a top-level let/const of a classic
        // script is a global binding but not a window property, so it is read in global scope. Only
        // names on the list above get here, so no other text is ever evaluated.
        let v = window[name];
        if (v === undefined) { try { v = Function(`return typeof ${name} === 'undefined' ? undefined : ${name}`)(); } catch (_) { v = undefined; } }
        if (v === undefined) throw new Error(`legacy.${String(name)}: the core has not defined it`);
        return v;
    },
});
