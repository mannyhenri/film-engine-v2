/*
 * The character sheet's React half: the frame the engine draws into, and the names it puts on window.
 * What the sheet DRAWS is held in the real app (electron/main.cjs smoke "character sheet": every region of the
 * backend's registry for a real character) and by the backend tests that read engine.js.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { LEGACY_GLOBALS } from '../../lib/legacy.js';
import CharacterSheet, { ENGINE } from './CharacterSheet.jsx';
import REACT_JSON from './react.json';

const ROOT = path.resolve(__dirname, '../../..');
const ENGINE_SRC = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
// Every function the engine's HTML calls by name from an inline handler.
const HANDLERS = [...new Set([...ENGINE_SRC.matchAll(/\bon[a-z]+="(?:event\.stopPropagation\(\);\s*)?([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))]
    .filter(n => !['event', 'this', 'window', 'document'].includes(n));

describe('CharacterSheet', () => {
    it('renders its frame at boot, hidden, with every id the engine draws into', () => {
        installLegacy();
        render(<CharacterSheet />);
        const modal = document.getElementById('characterSheetModal');
        expect(modal && !modal.classList.contains('open')).toBe(true);
        for (const id of ['csName', 'csChips', 'csBody', 'csModeBtn']) expect(document.getElementById(id), id).toBeTruthy();
    });

    it('puts every engine function on window while mounted (the HTML it draws calls them by name), and takes them back after', () => {
        installLegacy();
        const view = render(<CharacterSheet />);
        expect(ENGINE.length).toBeGreaterThan(20);
        expect(ENGINE.filter(([n, fn]) => window[n] !== fn).map(([n]) => n)).toEqual([]);
        for (const n of REACT_JSON.provides) expect(typeof window[n], n).toBe('function');
        view.unmount();
        expect(ENGINE.filter(([n]) => typeof window[n] === 'function' && !REACT_JSON.provides.includes(n)).map(([n]) => n)).toEqual([]);
    });

    it('every handler its HTML calls is an engine function, a core name the split keeps (LEGACY_GLOBALS), or a name a React page or component provides', () => {
        expect(HANDLERS.length).toBeGreaterThan(10);
        const engine = new Set(ENGINE.map(([n]) => n));
        // What React registers on window by name (react.json loader and provides, pages and components).
        for (const dir of ['src/pages', 'src/components']) for (const id of fs.readdirSync(path.join(ROOT, dir))) {
            const f = path.join(ROOT, dir, id, 'react.json');
            if (fs.existsSync(f)) { const r = JSON.parse(fs.readFileSync(f, 'utf8')); for (const n of [r.loader, ...(r.provides || [])]) if (n) engine.add(n); }
        }
        const core = fs.readFileSync(path.join(ROOT, 'public/legacy/core.js'), 'utf8');
        const unknown = HANDLERS.filter(n => !engine.has(n) && !LEGACY_GLOBALS.includes(n)
            && !new RegExp(`^\\s{0,4}(async\\s+)?function\\s+${n}\\s*\\(`, 'm').test(core));
        expect(unknown).toEqual([]);
    });

    it('opening a sheet opens the modal on the shared stack, and the sheet mode is the one both sheets share', async () => {
        const { fake } = installLegacy({ routes: {} });
        render(<CharacterSheet />);
        try { await window.openCharacterSheet('c1'); } catch (_) { /* no fixture: this checks the wiring, not the drawing */ }
        expect(fake.showModal).toHaveBeenCalledWith('characterSheetModal');
        expect(window.sheetEditable()).toBe(false);
        window.toggleSheetMode();
        expect(window.sheetEditable()).toBe(true);
        window.toggleSheetMode();
    });
});
