import { describe, it, expect, vi, afterEach } from 'vitest';
import { domWalk } from '../../test/reference.js';
import { render, act, fireEvent } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { installLegacy } from '../../test/setup.js';
import ScreenplayPage, { ENGINE } from './ScreenplayPage.jsx';
import * as E from './engine.js';
import REACT_JSON from './react.json';
import { LEGACY_GLOBALS } from '../../lib/legacy.js';

/*
 * The page's frame is generated from the legacy markup (tools/html-to-jsx.js). These checks hold the result to
 * the reference markup itself, so the conversion is only as trusted as this comparison: element by element.
 */
const REF = fs.readFileSync(path.resolve(__dirname, '../../../reference/fb8c770/src/index.html'), 'utf8');
const LEGACY = (() => {
    const start = REF.indexOf('<div class="page" id="page-screenplay">');
    return REF.slice(start, REF.indexOf('<div class="page" id="page-', start + 10));
})();
const LEGACY_HANDLERS = [...new Set([...LEGACY.matchAll(/\bon[a-z]+="([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))];
const byId = (id) => document.getElementById(id);
afterEach(() => vi.restoreAllMocks());

function openPage() {
    const legacy = installLegacy();
    const view = render(<ScreenplayPage />);
    return { legacy, view };
}

// The shared walker (src/test/reference.js), with its one named exemption: a list's bar host (data-v2-added).
const walk = domWalk;

describe('Screenplay: the React page is the legacy markup', () => {
    it('the reference markup was read (this check runs over something)', () => {
        expect(LEGACY.length).toBeGreaterThan(20000);
        expect(LEGACY_HANDLERS.length).toBeGreaterThan(30);
    });
    it('renders the reference markup element by element: tags, attributes, styles, text and what each field shows', () => {
        openPage();
        const ref = new DOMParser().parseFromString(`<body>${LEGACY}</body>`, 'text/html').getElementById('page-screenplay');
        const mine = walk(byId('page-screenplay'));
        const theirs = walk(ref);
        const first = theirs.findIndex((x, i) => x !== mine[i]);
        expect(first, `first difference at item ${first}: reference ${theirs[first]} | React ${mine[first]}`).toBe(-1);
        expect(mine.length).toBe(theirs.length);
    });
});

describe('Screenplay: what the page and its HTML call', () => {
    it('every handler of the legacy markup is an engine function on window while mounted, or a core function on LEGACY_GLOBALS', () => {
        const { view } = openPage();
        const engine = new Set(ENGINE.map(([n]) => n));
        expect(LEGACY_HANDLERS.filter(n => engine.has(n) && window[n] !== E[n])).toEqual([]);
        expect(LEGACY_HANDLERS.filter(n => !engine.has(n) && !LEGACY_GLOBALS.includes(n))).toEqual([]);
        view.unmount();
        expect(LEGACY_HANDLERS.filter(n => engine.has(n) && !REACT_JSON.provides.includes(n) && typeof window[n] === 'function')).toEqual([]);
    });
    it('every name legacy code calls (react.json provides) is an engine function, registered while mounted', () => {
        openPage();
        expect(REACT_JSON.provides.length).toBeGreaterThan(0);
        for (const n of REACT_JSON.provides) { expect(typeof E[n], n).toBe('function'); expect(typeof window[n], n).toBe('function'); }
    });
});

describe('Screenplay: the loader', () => {
    it('reads the versions, the latest Fountain and the suggestions: the editor core is the page\'s own engine now', async () => {
        // loadScriptVersions, loadLatestFountain and checkScreenplaySuggestions moved from core into engine.js (the editor
        // core only this page and its dialogs use, tools/core-ownership.js), so the loader is held to the reads they make.
        const { legacy } = openPage();
        legacy.fake.api.mockImplementation(async (path) => (/fountain$/.test(path) ? { fountain: '' } : {}));
        await act(async () => { window.loadScreenplayPage(); await new Promise(r => setTimeout(r, 0)); });
        const reads = legacy.fake.api.mock.calls.map(([path]) => path);
        expect(reads).toEqual(expect.arrayContaining(['/projects/p1/scripts', '/projects/p1/script/latest/fountain', '/projects/p1/screenplay/suggestions']));
    });
});
