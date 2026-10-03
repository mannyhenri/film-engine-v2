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
        generateSceneDialogue: vi.fn(),
        EDIT_CHUNK: 4,              // tiny, so a test file travels in several pieces
        MW: {},
        mwTime: (ms) => `${Math.floor((ms || 0) / 60000)}:${String(Math.floor(((ms || 0) % 60000) / 1000)).padStart(2, '0')}`,
        fmtBytes: (n) => `${n} B`,
        checkUploadSize: vi.fn(),
        refreshProtectOptions: vi.fn(),
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
