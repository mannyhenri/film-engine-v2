/*
 * EVERY dialog of the app is React-owned. Set-based over the reference's own modals (every top-level
 * .modal-overlay of the source page): each is owned by exactly one React page or component (react.json "modals"),
 * ModalHost renders no legacy markup at all, and with App mounted each dialog a component holds as verbatim markup
 * is the reference element (element by element), once, hidden, where the reference put it (in .main or not), and
 * every handler in it names something that exists: on window once App mounts, or one of core's own functions.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { render } from '@testing-library/react';
import { installLegacy } from '../test/setup.js';
import { domWalk } from '../test/reference.js';
import { MODALS } from './modals/index.js';
import App from '../App.jsx';

const ROOT = path.resolve(__dirname, '../..');
// The reference as the split reads it: without what the user retired (tools/split-lib.js RETIRED).
const { readSource } = createRequire(import.meta.url)('../../tools/split-lib.js');
const REF = new DOMParser().parseFromString(readSource(path.join(ROOT, 'reference/fb8c770/src/index.html')).text, 'text/html');
const REF_MODALS = [...REF.querySelectorAll('body > .modal-overlay, .main > .modal-overlay')].map(m => m.id);
const owners = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter(n => fs.existsSync(path.join(ROOT, dir, n, 'react.json')))
    .map(n => ({ owner: `${dir}/${n}`, dir: path.join(ROOT, dir, n), ...JSON.parse(fs.readFileSync(path.join(ROOT, dir, n, 'react.json'), 'utf8')) }));
const OWNERS = [...owners('src/pages'), ...owners('src/components')];
const CORE = fs.readFileSync(path.join(ROOT, 'public/legacy/core.js'), 'utf8');
const coreFn = (n) => new RegExp(`^\\s{0,4}(async\\s+)?function\\s+${n}\\s*\\(`, 'm').test(CORE);
const handlersOf = (el) => [...el.querySelectorAll('*'), el].flatMap(e => e.getAttributeNames().filter(a => /^on[a-z]+$/.test(a))
    .map(a => (e.getAttribute(a).match(/^\s*([A-Za-z_$][\w$]*)\s*\(/) || [])[1]).filter(Boolean));
// The components that hold dialogs as verbatim markup (their *.markup.js modules).
const VERBATIM = OWNERS.filter(o => o.owner.startsWith('src/components/') && fs.readdirSync(o.dir).some(f => f.endsWith('.markup.js')) && o.modals.length);

describe('every dialog is React-owned', () => {
    it('the reference was read (the checks run over something)', () => {
        expect(REF_MODALS.length).toBeGreaterThan(30);
    });

    it('ModalHost renders no legacy dialog', () => {
        expect(MODALS.map(m => m.id)).toEqual([]);
    });

    it('each of the reference\'s dialogs has exactly one React owner', () => {
        const bad = REF_MODALS.map(id => [id, OWNERS.filter(o => (o.modals || []).includes(id)).map(o => o.owner)])
            .filter(([, os]) => os.length !== 1).map(([id, os]) => `${id}: ${os.length ? os.join(' and ') : 'no owner'}`);
        expect(bad).toEqual([]);
    });

    it('with App mounted, each verbatim dialog is the reference element, once, hidden, where the reference put it; every handler exists', () => {
        installLegacy();
        render(<App />);
        const bad = [];
        for (const o of VERBATIM) for (const id of o.modals) {
            const mine = document.querySelectorAll(`[id="${id}"]`);
            if (mine.length !== 1) { bad.push(`${id}: ${mine.length} in the document`); continue; }
            const el = mine[0], ref = REF.getElementById(id);
            if (el.classList.contains('open')) bad.push(`${id}: open at boot`);
            if (!!ref.closest('.main') !== !!el.closest('.main')) bad.push(`${id}: ${ref.closest('.main') ? 'belongs in' : 'must not be in'} .main`);
            if (id === 'sceneCardModal') {
                expect(el.querySelector('#sceneCardHeading').tagName).toBe('P');
                expect(el.querySelector('#sceneCardNotes').tagName).toBe('TEXTAREA');
                expect(el.textContent).toContain('screenplay stays unchanged');
                expect(el.querySelector('[onclick="deleteIndexCard()"]')).toBeNull();
            } else {
                const theirs = domWalk(ref), ours = domWalk(el);
                const first = theirs.findIndex((x, i) => x !== ours[i]);
                if (first !== -1 || theirs.length !== ours.length) bad.push(`${id}: differs from the reference at ${first}: ${theirs[first]} | ${ours[first]}`);
            }
            for (const h of handlersOf(el)) if (typeof window[h] !== 'function' && !coreFn(h) && h !== 'document' && h !== 'event') bad.push(`${id}: ${h} is neither on window nor a core function`);
        }
        expect(VERBATIM.reduce((n, o) => n + o.modals.length, 0)).toBeGreaterThanOrEqual(23);
        expect(bad).toEqual([]);
    });
});
