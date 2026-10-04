/*
 * A fake of the legacy core, for React page tests: every name in LEGACY_GLOBALS,
 * so a page under test reaches exactly what it reaches in the app. api() is a
 * route table the test fills; showModal/closeModal behave like the real stack
 * (the `open` class on the overlay by id).
 */
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { LEGACY_GLOBALS } from '../lib/legacy.js';

export function installLegacy({ routes = {}, project = { id: 'p1' } } = {}) {
    const calls = [];
    const status = [];
    const fake = {
        api: vi.fn(async (path, opts = {}) => {
            const method = opts.method || 'GET';
            calls.push({ method, path, body: opts.body ? JSON.parse(opts.body) : undefined });
            const handler = routes[`${method} ${path}`];
            if (!handler) throw new Error(`no fake route for ${method} ${path}`);
            return typeof handler === 'function' ? handler(opts.body ? JSON.parse(opts.body) : undefined) : handler;
        }),
        setStatus: vi.fn((text) => status.push(text)),
        state: { currentProject: project, currentPage: null },
        esc: (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
        showModal: vi.fn((id) => document.getElementById(id)?.classList.add('open')),
        closeModal: vi.fn((id) => document.getElementById(id)?.classList.remove('open')),
        navigateTo: vi.fn(),
        // Shaped like the real one: the bare origin (http://localhost:3100); routes are under /film.
        // A fake that ended in /film hid two links the original app built without it (subtitles, edits upload).
        API_BASE: 'http://api.test',
        DRIFT: { shots: {}, scenes: [] },
        loadScreenplayDrift: vi.fn(async () => {}),
        updateSceneStatusIcons: vi.fn(),
        EDIT_CHUNK: 4,              // tiny, so a test file travels in several pieces
        MW: {},
        mwTime: (ms) => `${Math.floor((ms || 0) / 60000)}:${String(Math.floor(((ms || 0) % 60000) / 1000)).padStart(2, '0')}`,
        fmtBytes: (n) => `${n} B`,
        checkUploadSize: vi.fn(),
        refreshProtectOptions: vi.fn(),
        openFrameViewer: vi.fn(async () => {}),
        PROJECT_LIST: { status: '', archived: false, dragId: null },
        openProject: vi.fn(),
        // As core builds it: a label + hidden file input addressed by capability (the test reads the call).
        mediaUploadControl: vi.fn((capability, media, scope, id, o = {}) => `<label class="btn btn-secondary btn-sm">${o.label || 'Upload'}<input type="file" data-import-target="${capability}-media"></label>`),
        loadSequences: vi.fn(),
        generateVideoFor: vi.fn(), generateVoiceForShot: vi.fn(), setClipCoverage: vi.fn(), lipsyncShot: vi.fn(),
        postShot: vi.fn(), replaceBackground: vi.fn(), stitchShot: vi.fn(),
        downloadExport: vi.fn(),
        importBundle: vi.fn(),
        streamSSEPost: vi.fn(),   // a test drives it: (path, body, onEvent, onDone, onError)
        uploadReferenceImage: vi.fn(),
        plateSrc: (url, w) => `plate:${url}@${w}`,
        openPlateViewer: vi.fn(),
        uploadControl: vi.fn((target, url, o) => `<label class="btn btn-secondary btn-sm">${(o && o.label) || 'Upload'}<input type="file" data-import-target="${target}" data-url="${url}"></label>`),
        confirmPaidImage: vi.fn(),
        openCharacterSheet: vi.fn(), openSubjectSheet: vi.fn(), loadScreenplayPage: vi.fn(),
        // The location and prop sheet's core half (src/components/SubjectSheet/engine.js bridges these).
        SS: { kind: null, id: null, data: null, views: [], sections: [], propViews: [], times: [], collapsed: {} },
        ssSection: vi.fn((anchorId, title, what, inner) => `<section id="${anchorId}"><h3>${title}</h3>${inner}</section>`),
        slotUpload: vi.fn(() => '<label class="slot-upload">Upload</label>'), sheetEditable: vi.fn(() => false), toggleSheetMode: vi.fn(),
        regeneratePlate: vi.fn(),
        openGallery: vi.fn(), loadProps: vi.fn(),
        characterViewsHtml: vi.fn(() => ''), shootControl: vi.fn(() => ''),
        folderPickerApply: vi.fn(), frameViewerPaint: vi.fn(), renderGlossary: vi.fn(), renderProductionGuide: vi.fn(),
        CONFIRM_GEN: {}, CONFIRM_GEN_EDITED: false, CONFIRM_GEN_FINAL_PROMPT: '', SHOT_CARD: {}, guideTab: 'overview', loadStoryboard: vi.fn(), renderProjectOnboarding: vi.fn(), onboardingIndex: 0,
        loadProjects: vi.fn(async () => {}), previewProjectFolder: vi.fn(), loadScenes: vi.fn(async () => {}),
        csImg: (url) => `http://api.test${url}`, renderSubjectSheet: vi.fn(),
        PRODUCTION_GRAPH_ON: false, flowBackToGraph: vi.fn(),
        regenerateStoryboard: vi.fn(),
        FRAME_VIEWER: { frames: [] }, BOARD_ANCHOR: null, MARKUP: { cache: {} },
        markupPaintAll: vi.fn(), generateAllStoryboards: vi.fn(), toggleBoardLock: vi.fn(),
        frameSrc: (f, w) => `frame:${f.shot_code}@${w}`,
        protectSelection: (v) => (v ? [v] : []), protectOverlayHTML: (r, ratios) => `<i class="protect">${ratios.join(',')}@${r.toFixed(2)}</i>`,
        directShot: vi.fn(), exploreAngles: vi.fn(), refineFrame: vi.fn(),
        storyboardDialogueHtml: (d) => (d && d.length ? `<p class="dlg">${d.length} lines</p>` : ''),
        // The storyboard engine's bridge (core): what its moved functions call.
        annotationFeedbackOn: vi.fn(() => false), confirmChoices: vi.fn(), confirmExtras: vi.fn(), confirmGenArm: vi.fn(), cueExtensionOf: vi.fn(),
        frameBusy: vi.fn(), markupDisarm: vi.fn(), markupDraw: vi.fn(), markupLoad: vi.fn(), markupPaintFeedBadge: vi.fn(), paintGenOptions: vi.fn(),
        renderBoardLock: vi.fn(), BOARD_LOCK: { locked: false },
        markupToolbar: (id) => `<span class="markup-tools">markup ${id}</span>`,
        paintProjectType: vi.fn(), setStatusDot: vi.fn(), confirmProjectDelete: vi.fn(async () => true), backToProjectList: vi.fn(), openFolderPicker: vi.fn(),
        saveProductionGraphFlag: vi.fn(), feStore: { set: vi.fn(), remove: vi.fn(), get: vi.fn() }, checkHealth: vi.fn(), DEFAULT_API_BASE: 'http://default.test', APP_AUTHOR: null,
        money: (n) => '$' + (Number(n) || 0).toFixed(2), usd: (n) => '$' + (Number(n) || 0).toFixed(3),
        pb: { timeline: null, notes: [], index: 0, playing: false, raf: null, localMs: 0 },
        PG: { graph: null, byKey: new Map(), sel: null, zoom: 0.9, pan: { x: 0, y: 0 }, scene: 'all', busy: new Map(), drawerCache: {},
            play: { index: 0, playing: false, t0: 0, timer: null, stills: true, audio: true }, fitted: false, menuFor: null,
            running: new Map(), pollTimer: null, behindOnly: false, queue: null, queueOpen: false, picked: new Set(), add: null, selBeforeClick: null },
        IB: { setup: null, span: null, sel: 0, rangeEdit: null, price: null },
        pgRenderSide: vi.fn(), FLOW: {}, confirmUpscale: vi.fn(), generateNativeMultiShot: vi.fn(), generateSequence: vi.fn(),
        jsAttr: (v) => JSON.stringify(String(v)).replace(/"/g, '&quot;'), markCurrentShot: vi.fn(), showModalHtml: vi.fn(), uploadCapabilityMedia: vi.fn(), setAnchor: vi.fn(), stitchSequence: vi.fn(),
        mediaUrl: (p) => (p ? 'http://api.test' + (p.startsWith('/') ? p : '/film/' + p) : ''),
        loadAnalysis: vi.fn(), onEditorInput: vi.fn(), openTitlePageModal: vi.fn(), setViewMode: vi.fn(), toggleLockSceneNumbers: vi.fn(),
        // The Screenplay engine's bridge: core's editor functions, and its shared state at core's initial values.
        acceptAutoDetectSuggestion: vi.fn(), afterCardEdit: vi.fn(), captureEditorState: vi.fn(), checkScreenplaySuggestions: vi.fn(), clearAutoDetectSuggestion: vi.fn(), createBlock: vi.fn(), editorToFountain: vi.fn(), escapeHtml: vi.fn(), focusWordCount: vi.fn(), getCurrentBlock: vi.fn(), hideAutocomplete: vi.fn(), isKnownCharacter: vi.fn(), loadCharacters: vi.fn(), loadLatestFountain: vi.fn(), loadLocations: vi.fn(), loadRevisionInfo: vi.fn(), loadScriptTiming: vi.fn(), loadScriptVersions: vi.fn(), normalizeEditor: vi.fn(), parseFountainToHTML: vi.fn(), renderFountainToEditor: vi.fn(), renderScriptGutter: vi.fn(), saveScreenplay: vi.fn(), selectAutocompleteItem: vi.fn(), serializeEditorToFountain: vi.fn(), setBlockElementType: vi.fn(), setCursorToBlock: vi.fn(), spBlock: vi.fn(), timingRowsForHeadings: vi.fn(), toggleWriterFocus: vi.fn(), triggerAutoSave: vi.fn(), triggerSceneNavUpdate: vi.fn(), twBurst: vi.fn(), typewriterButtons: vi.fn(), updateConversionEstimate: vi.fn(), updateCurrentSceneHighlight: vi.fn(), updateEditorStats: vi.fn(), updateSaveStatus: vi.fn(), updateSceneNavigator: vi.fn(), updateSceneNumbers: vi.fn(), updateScriptStats: vi.fn(),
        AI_PATH: { connected: false, checked: 0 }, API: () => 'http://api.test/film', AUTO_FORMAT_RULES: {}, MAX_CHUNK_SIZE: 7000, SCRIPT_TIMING: null, TYPEWRITER: {}, autoDetectTimer: null, autocompleteItems: [], autocompleteSelectedIndex: 0, autocompleteVisible: false, currentFountainContent: '', currentScriptVersion: null, editorDirty: false, redoStack: [], screenplaySuggestions: { unmatched_characters: [], unmatched_locations: [] }, undoStack: [],
        _shotAction: vi.fn(), clearModal: vi.fn(), getModalData: vi.fn(() => ({})),
        previsAspect: vi.fn(() => 16 / 9), WALK: { on: false, from: null, moved: false }, WORLD: { overlays: null, lens: 35, mode: 'keep', pinned: null, world: null }, P_DEG: Math.PI / 180,
    };
    const missing = LEGACY_GLOBALS.filter(n => !(n in fake));
    if (missing.length) throw new Error('the test fake lacks ' + missing.join(', ') + ' (src/test/setup.js)');
    Object.assign(window, fake);
    return { calls, status, fake };
}

/*
 * A grid child that is not a card takes a card's place (the backend's grid-children rule, which reads
 * legacy writes and so cannot see a React page). `.entity-grid` is a real CSS grid: every direct child
 * occupies a cell, so anything that is not a card must span the whole row or it pushes the cards across.
 * Checked after EVERY React test, on whatever it rendered, so each page is held to it with nothing to remember.
 */
const GRID_ITEM = /(^|\s)(card|entity-card|empty-state|home-panel)(\s|$)/;
export function gridChildProblems(root = document) {
    const bad = [];
    for (const grid of root.querySelectorAll('.entity-grid')) {
        for (const el of grid.children) {
            if (GRID_ITEM.test(el.className) || /^1\s*\/\s*-1$/.test(el.style.gridColumn)) continue;
            bad.push(`#${grid.id || '(grid)'} > <${el.tagName.toLowerCase()} class="${el.className}">${el.textContent.slice(0, 40)}`);
        }
    }
    return bad;
}

afterEach(() => {
    const bad = gridChildProblems();
    cleanup();
    for (const n of LEGACY_GLOBALS) delete window[n];
    if (bad.length) throw new Error('a direct child of a CSS grid is neither a card nor full-width, so it takes a card\'s cell:\n  ' + bad.join('\n  '));
});

/*
 * The storyboard's own card parts and board actions, moved from core into src/pages/storyboard/engine.js. Its tests
 * mock the engine with these (vi.mock('./engine.js', ...)): the same markers the legacy fakes drew, so a test reads
 * which part the page put where.
 */
export const BOARD_ENGINE_FAKES = () => ({
    ANCHOR: { frames: [] },
    loadBoardLock: vi.fn(), renderAnnotationFeedbackToggle: vi.fn(), renderAnchorChip: vi.fn(), loadBoardBanners: vi.fn(),
    clearAnchor: vi.fn(), storyboardDrawAnnotations: vi.fn(), setShotAspect: vi.fn(),
    anchorButton: (f) => `<button class="anchor-btn">anchor ${f.shot_code}</button>`,
    storyboardImportButton: (f) => `<label><input data-import-target="storyboard-image" data-shot="${f.shot_id}"></label>`, openFrameVersions: vi.fn(),
    frameVersionTitle: () => 'versions title', frameVersionLabel: (f) => `v${f.asset_version || 1}`, playFromShot: vi.fn(), insertShotAfter: vi.fn(),
    storyboardFacetTags: (f) => `<span class="facet">facets ${f.shot_code}</span>`,
});
