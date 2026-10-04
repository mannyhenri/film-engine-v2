/*
 * The location and prop sheet's React half: the frame the engine draws into, and the names it puts on window.
 * What the sheet DRAWS is held in the real app (electron/main.cjs smoke "subject sheets": every region of the
 * backend's registry, for a real location and a real prop) and by the backend tests that read engine.js.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { LEGACY_GLOBALS } from '../../lib/legacy.js';
import SubjectSheet, { ENGINE } from './SubjectSheet.jsx';
import REACT_JSON from './react.json';

const ROOT = path.resolve(__dirname, '../../..');
const ENGINE_SRC = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
// Every function the engine's HTML calls by name from an inline handler.
const HANDLERS = [...new Set([...ENGINE_SRC.matchAll(/\bon[a-z]+="(?:event\.stopPropagation\(\);\s*)?([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))]
    .filter(n => !['event', 'this', 'window', 'document'].includes(n));

describe('SubjectSheet', () => {
    it('renders its frame at boot, hidden, with every id the engine draws into', () => {
        installLegacy();
        render(<SubjectSheet />);
        const modal = document.getElementById('subjectSheetModal');
        expect(modal && !modal.classList.contains('open')).toBe(true);
        for (const id of ['ssName', 'ssChips', 'ssBody', 'ssGenerateBtn', 'ssModeBtn']) expect(document.getElementById(id), id).toBeTruthy();
    });

    it('puts every engine function on window while mounted (the HTML it draws calls them by name), and takes them back after', () => {
        installLegacy();
        const view = render(<SubjectSheet />);
        expect(ENGINE.length).toBeGreaterThan(35);
        expect(ENGINE.filter(([n, fn]) => window[n] !== fn).map(([n]) => n)).toEqual([]);
        for (const n of REACT_JSON.provides) expect(typeof window[n], n).toBe('function');
        view.unmount();
        expect(ENGINE.filter(([n]) => typeof window[n] === 'function' && !REACT_JSON.provides.includes(n)).map(([n]) => n)).toEqual([]);
    });

    it('every handler its HTML calls is an engine function or a core name the split keeps (LEGACY_GLOBALS)', () => {
        expect(HANDLERS.length).toBeGreaterThan(10);
        const engine = new Set(ENGINE.map(([n]) => n));
        const core = fs.readFileSync(path.join(ROOT, 'public/legacy/core.js'), 'utf8');
        const unknown = HANDLERS.filter(n => !engine.has(n) && !LEGACY_GLOBALS.includes(n)
            && !new RegExp(`^\\s{0,4}(async\\s+)?function\\s+${n}\\s*\\(`, 'm').test(core));
        expect(unknown).toEqual([]);
    });

    it('opening a sheet draws into the frame and opens the modal on the shared stack', async () => {
        const { fake } = installLegacy({ routes: {
            'GET /locations/l1': { location: { id: 'l1', name: 'Dock' } },
            'GET /locations/l1/plate/views': { views: [] },
            'GET /sheet-spec': { description_sections: [], prop_views: [], time_variants: [] },
        } });
        render(<SubjectSheet />);
        // The engine's helpers that stay in core are faked; this checks the wiring, not the drawing.
        try { await window.openSubjectSheet('location', 'l1'); } catch (_) { /* a faked helper may not draw */ }
        expect(fake.showModal).toHaveBeenCalledWith('subjectSheetModal');
        expect(fake.SS.kind).toBe('location');
        expect(fake.SS.id).toBe('l1');
    });
});
