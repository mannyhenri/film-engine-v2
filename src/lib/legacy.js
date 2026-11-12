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
    'mwTime',       // ms -> m:ss.t, as every timing in the app is shown (edits)
    'fmtBytes',     // bytes -> "12.3 MB" (edits)
    'checkUploadSize', // refuse a body over the server's per-request ceiling before sending it (edits)
    'streamSSEPost', // POST that answers as server-sent events, step by step (storyboard, previs)
    'downloadExport', // FCPXML / EDL / Premiere / SRT / FDX download; shared, stays in core (exportpage)
    'importBundle',   // import a project bundle into #importStatus; shared with the project list (exportpage)
    'mediaUploadControl',    // core's upload control for footage/sound made elsewhere, by capability (the Production graph)
    'generateVoiceForShot', // a shot's dialogue take (the Production studio)
    'PROJECT_LIST',          // the project list's filter (stage, archived) and drag state; core restores it from storage at boot (projects)
    'openProject',            // open a project (shared with the shell and the sidebar)
    'loadProjects', 'previewProjectFolder', 'loadScenes', // the project list engine's bridge (src/pages/projects/engine.js)
    'openFrameViewer',       // the frame viewer (core, shared with the board): Resume opens the shot you left (dashboard)
    'refreshProtectOptions', // the board's picker offers the ratios this job ships (deliverables)
    'uploadReferenceImage',   // upload a reference picture: size check, the label's "Uploading…", the error left on it
    'plateSrc',               // a plate's thumbnail URL at a width (the server caches it)
    'openPlateViewer',        // the full-size plate viewer, shared by every page that shows a plate
    'uploadControl',          // the shared upload + iPhone camera control, as markup (marketing; every plate uses it)
    'confirmPaidImage',       // the one confirmation every paid generation goes through: what is sent, what it costs
    'openCharacterSheet', 'openSubjectSheet', // the subject sheets (core: the board, graph and viewer open them too); a card click opens one
    'loadScreenplayPage',     // reload the screenplay editor after a location rename rewrote its headings (locations)
    // The location and prop sheet's engine (src/components/SubjectSheet/engine.js) reaches these through its bridge:
    'SS', 'ssSection', 'slotUpload', 'sheetEditable', 'toggleSheetMode', 'regeneratePlate', 'openGallery', 'loadProps',
    // ...and the character sheet's (src/components/CharacterSheet/engine.js):
    'csImg', 'renderSubjectSheet', 'shootControl', 'PLATE_CAMERA_AFTER',
    // The core dialogs' engine (src/components/CoreDialogs/engine.js) reaches these through its bridge:
    'folderPickerApply', 'frameViewerPaint', 'renderGlossary', 'renderProductionGuide', 'CONFIRM_GEN', 'CONFIRM_GEN_EDITED',
    'CONFIRM_GEN_FINAL_PROMPT', 'SHOT_CARD', 'guideTab', 'loadStoryboard', 'closeProductionGuide', 'getNavGuideEntries', 'openProductionGuide', 'renderGuideList', 'renderGuideNextLinks',
    'characterViewsHtml',     // stays core: core's renderCharacterViewsInto calls it (dead in the app, kept for its tests: split-lib KEPT_FOR_TESTS)
    'regenerateStoryboard',   // regenerate one shot's frame: its own confirmation, the busy veil (board, viewer, shot drawer)
    // The storyboard board: state core shares with the frame viewer, the anchor and markup...
    'FRAME_VIEWER', 'BOARD_ANCHOR', 'MARKUP',
    // ...what keeps the board's header and banners in step (core writes into them by id)...
    'markupPaintAll',
    'generateAllStoryboards', 'toggleBoardLock', 
    // ...and each card's shared parts, used by the viewer and the Production graph too.
    'frameSrc', 'protectSelection', 'protectOverlayHTML', 
    'directShot', 'exploreAngles', 'refineFrame', 
    'storyboardDialogueHtml', 'markupToolbar',
    'money', 'usd',          // how money is printed everywhere: $0.00, and finer under a dollar (budget, export, the confirmations)
    // Settings: the shell it updates after a save, the shared dialogs, and the connection state core owns.
    'paintProjectType', 'setStatusDot', 'confirmProjectDelete', 'backToProjectList', 'openFolderPicker',
    'feStore', 'checkHealth', 'DEFAULT_API_BASE', 'APP_AUTHOR',
    // A stored file's URL.
    'mediaUrl',
    // The Production graph engine (src/pages/productiongraph/engine.js): its two state objects and side panel, kept in
    // core, and the shared actions its nodes run.
    'PG', 'IB', 'pgRenderSide', 'confirmUpscale', 'generateNativeMultiShot', 'generateSequence', 'jsAttr',
    'markCurrentShot', 'showModalHtml', 'uploadCapabilityMedia',
    'setAnchor', 'stitchSequence', // called from the HTML the graph engine draws (a frame's anchor, a sequence's join)
    // The Screenplay engine (src/pages/screenplay/engine.js): the editor core keeps because Sync screenplay, scene edits
    // and the autosave share it...
    
    'escapeHtml', 'focusWordCount',
    'loadCharacters', 
    'loadLocations', 
    
    
    'toggleWriterFocus', 
    'typewriterButtons', 'updateConversionEstimate', 
    
    // core handlers the Screenplay page's buttons call
    // ...and the editor's shared state, read as legacy.X and assigned with setLegacy (a core `let`).
    'AI_PATH', 'API', 'MAX_CHUNK_SIZE', 'TYPEWRITER', 
    
    
    '_shotAction', 'clearModal', 'getModalData', // shared actions and dialog fields (the 3D stage and core dialogs engines)
    'previsAspect', 'WALK', 'WORLD', // the 3D stage engine's bridge (src/pages/previs/engine.js)
    // The storyboard engine's bridge (src/pages/storyboard/engine.js):
    'annotationFeedbackOn', 'confirmChoices', 'confirmExtras', 'confirmGenArm', 'cueExtensionOf', 'frameBusy', 'markupDisarm', 'markupDraw', 'markupLoad', 'markupPaintFeedBadge', 'paintGenOptions', 'renderBoardLock', 'streamSSE',
    'renderTitlePageCard', // the screenplay editor's title-page card (core keeps it: Sync screenplay redraws it)
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

/*
 * Assign one of the listed legacy globals. A top-level `let` of a classic script (BOARD_ANCHOR) is a
 * global binding but not a window property, so writing window[name] would create a second variable that
 * core never reads; the assignment runs in global scope instead. Only names on the list, and only names
 * that are not functions, so a page can set state core shares but never replace core's behaviour.
 */
export function setLegacy(name, value) {
    if (!LEGACY_GLOBALS.includes(name)) throw new Error(`setLegacy: ${name} is not in LEGACY_GLOBALS (src/lib/legacy.js)`);
    if (typeof legacy[name] === 'function') throw new Error(`setLegacy: ${name} is a function; a page may not replace core behaviour`);
    if (Object.prototype.hasOwnProperty.call(window, name)) { window[name] = value; return; }
    Function('v', `${name} = v;`)(value);
}
