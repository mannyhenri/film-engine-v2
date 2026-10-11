/*
 * The Screenplay's dialogs, as a React component. The set is DERIVED, not typed: every top-level modal of the
 * reference that the Screenplay page reaches (its handlers call the engine, or what opens it is reached from the
 * page; see DIALOGS below). The component must
 * own exactly that set (react.json modals), render each one as the reference element (element by element, hidden at
 * boot), and every handler in them must name a function that is on window once App has mounted.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { domWalk } from '../../test/reference.js';
import * as SCREENPLAY from '../../pages/screenplay/engine.js';
import App from '../../App.jsx';

const ROOT = path.resolve(__dirname, '../../..');
const REF = new DOMParser().parseFromString(fs.readFileSync(path.join(ROOT, 'reference/fb8c770/src/index.html'), 'utf8'), 'text/html');
const handlersOf = (el) => [...el.querySelectorAll('*'), el].flatMap(e => e.getAttributeNames().filter(a => /^on[a-z]+$/.test(a))
    .map(a => (e.getAttribute(a).match(/^\s*([A-Za-z_$][\w$]*)\s*\(/) || [])[1]).filter(Boolean));
const ENGINE = new Set(Object.keys(SCREENPLAY).filter(k => typeof SCREENPLAY[k] === 'function'));
const CORE = fs.readFileSync(path.join(ROOT, 'public/legacy/core.js'), 'utf8');
const ENGINE_SRC = fs.readFileSync(path.join(ROOT, 'src/pages/screenplay/engine.js'), 'utf8');
const FRAME_SRC = fs.readFileSync(path.join(ROOT, 'src/pages/screenplay/ScreenplayPage.jsx'), 'utf8');
// Core's top-level functions, by name -> body (4-space-indented declarations of the generated core).
const CORE_FNS = new Map([...CORE.matchAll(/^ {4}(?:async )?function ([A-Za-z_$][\w$]*)\(/gm)].map((m, i, all) =>
    [m[1], CORE.slice(m.index, all[i + 1] ? all[i + 1].index : CORE.length)]));
// The Screenplay page's own element ids (its reference markup): what core draws INTO when it draws the screenplay.
const FRAME_IDS = [...REF.getElementById('page-screenplay').querySelectorAll('[id]')].map(e => e.id);
const calls = (body, f) => new RegExp(`(^|[^\\w$.])${f.replace(/\$/g, '\\$')}\\(`).test(body);
/*
 * A dialog is the Screenplay's when the function that OPENS it (showModal('<id>')) is reached from the Screenplay page:
 * the engine itself; a core function the page's frame calls; or a core function called by core code that draws into
 * one of the page's own elements (the index-card view, the version list). Or when its handlers call the engine.
 */
const openersOf = (id) => {
    const out = [];
    if (ENGINE_SRC.includes(`showModal('${id}')`)) out.push('engine');
    for (const [f, body] of CORE_FNS) if (body.includes(`showModal('${id}')`)) out.push(f);
    return out;
};
// Reached in at most two calls (a button core draws into the version list calls compareSelectedVersions, which calls
// showVersionDiff, which opens versionDiffModal); a call inside an onclick string core draws counts as a call.
const drawsIntoFrame = (body) => FRAME_IDS.some(id => body.includes(`'${id}'`));
const reachedFromScreenplay = (f, depth = 2) => f === 'engine' || calls(FRAME_SRC, f) || calls(ENGINE_SRC, f)
    || [...CORE_FNS].some(([g, body]) => g !== f && calls(body, f) && (drawsIntoFrame(body) || (depth > 0 && reachedFromScreenplay(g, depth - 1))));
const DIALOGS = [...REF.querySelectorAll('body > .modal-overlay, .main > .modal-overlay')]
    .filter(m => handlersOf(m).some(h => ENGINE.has(h)) || openersOf(m.id).some(f => reachedFromScreenplay(f)))
    .map(m => m.id).sort();
const jsonPath = path.join(__dirname, 'react.json');
const JSON_ = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : { modals: [] };

describe('the Screenplay dialogs component', () => {
    it('the set was derived from the reference (the check runs over something)', () => {
        expect(DIALOGS.length).toBeGreaterThanOrEqual(7);
    });

    it('owns exactly the dialogs the Screenplay page reaches', () => {
        expect([...JSON_.modals].sort()).toEqual(DIALOGS);
    });

    it('with App mounted, each dialog is the reference element, once, hidden; and every handler in it is on window', () => {
        installLegacy();
        render(<App />);
        const bad = [];
        for (const id of DIALOGS) {
            const mine = document.querySelectorAll(`[id="${id}"]`);
            if (mine.length !== 1) { bad.push(`${id}: ${mine.length} in the document`); continue; }
            if (mine[0].classList.contains('open')) bad.push(`${id}: open at boot`);
            if (id === 'sceneCardModal') {
                expect(mine[0].querySelector('#sceneCardHeading').tagName).toBe('P');
                expect(mine[0].querySelector('#sceneCardNotes')).not.toBeNull();
                expect(mine[0].textContent).toContain('screenplay stays unchanged');
                expect(mine[0].querySelector('[onclick="deleteIndexCard()"]')).toBeNull();
            }
            if (id !== 'sceneCardModal') {
                const theirs = domWalk(REF.getElementById(id)), ours = domWalk(mine[0]);
                const first = theirs.findIndex((x, i) => x !== ours[i]);
                if (first !== -1 || theirs.length !== ours.length) bad.push(`${id}: differs from the reference at ${first}: ${theirs[first]} | ${ours[first]}`);
            }
            // On window once App mounts (the Screenplay engine, registered by its page), or core's own (not loaded here).
            for (const h of handlersOf(mine[0])) if (typeof window[h] !== 'function' && !CORE_FNS.has(h) && h !== 'document') bad.push(`${id}: ${h} is neither on window nor a core function`);
        }
        expect(bad).toEqual([]);
    });
});
