/*
 * REGISTRY REACH: every entry of a backend registry that says "a person can do this from the page" is
 * checked on whichever side of the conversion its control stands.
 *
 *   legacy page  -> exactly as the backend test does: an onclick that calls the function, in the
 *                   reassembled page (src/index.html), with the React source blocks taken out (source
 *                   is not a control).
 *   React page   -> by RENDER: the page declares, in src/pages/<id>/reach.js, the fixture its render
 *                   needs and the button that carries each registry function. The page is rendered, its
 *                   loader run, the button clicked, and the click must REACH something (an API request or
 *                   a core function). Presence alone would pass a dead button.
 *   React component -> the same, from src/components/<Name>/reach.js, which says how core OPENS it
 *                   (`open: { call, args }`, a name it provides) in place of a page loader.
 *
 * An entry bound on neither side fails, naming it. The denominator is the backend's own registry,
 * imported, never a list typed here. Adding a React page means writing its reach.js, not editing this.
 *
 * It replaces the backend sub-test that can only read legacy onclick text:
 *   dialogue-audition.test.js "every scope is reachable from the page AND from an agent"
 * (skipped in backend/tests/SKIPPED-SUBTESTS.json, pointing here), and keeps ALL of its assertions.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { render, fireEvent, act, screen, cleanup } from '@testing-library/react';
import { installLegacy } from '../test/setup.js';

const ROOT = path.resolve(__dirname, '../..');
const require_ = createRequire(import.meta.url);
const backend = (m) => require_(path.join(ROOT, 'backend', m));

const REACH = Object.fromEntries([
    ...Object.entries(import.meta.glob('./*/reach.js', { eager: true })).map(([f, mod]) => [f.split('/')[1], mod.default]),
    ...Object.entries(import.meta.glob('../components/*/reach.js', { eager: true })).map(([f, mod]) => [`component:${f.split('/')[2]}`, mod.default]),
]);
const PAGES = import.meta.glob('./*/index.jsx');
const COMPONENTS = import.meta.glob('../components/*/*.jsx');
const reactJson = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src/pages', id, 'react.json'), 'utf8'));

/** The assembled page without the React source blocks: what the legacy side of the app draws and wires. */
const legacyPage = () => fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8')
    .replace(/<template data-react-source="[^"]*">[\s\S]*?<\/template>/g, '');

/** The React pages whose reach.js declares a control for `fn`. */
const reactControls = (fn) => Object.entries(REACH).flatMap(([page, r]) => (r.controls && r.controls[fn] ? [{ page, ...r.controls[fn], reach: r }] : []));

/** Render the page, run its loader, click the control; resolve true when the click reached the API or core. */
async function clickReaches(control) {
    const { page, button, type, reach } = control;
    const legacy = installLegacy({ routes: reach.fixture.routes || {}, project: reach.fixture.project ?? { id: 'p1' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    if (page.startsWith('component:')) {
        // A component: mounted as App mounts it, then opened the way core opens it (a name it provides).
        const name = page.slice('component:'.length);
        const Component = (await COMPONENTS[`../components/${name}/${name}.jsx`]()).default;
        render(<Component />);
        expect(reach.open && reach.open.call, `${name}/reach.js: says nothing about how core opens it (open: { call, args })`).toBeTruthy();
        await act(async () => { await window[reach.open.call](...(reach.open.args || [])); });
    } else {
        const Page = (await PAGES[`./${page}/index.jsx`]()).default;
        render(<Page />);
        await act(async () => { await window[reactJson(page).loader](); });
    }
    // A control that only exists after something is selected (the Production graph's shot drawer): the page's
    // reach.js says how to get there, with the page's own functions, before the click is counted.
    if (control.prepare) await act(async () => { await control.prepare(window); });
    const coreFns = Object.entries(legacy.fake).filter(([k, v]) => typeof v === 'function' && v.mock && k !== 'setStatus' && k !== 'api');
    const before = { api: legacy.calls.length, core: coreFns.map(([, v]) => v.mock.calls.length) };
    // A control that needs input first (Audition refuses an empty line) says what to type.
    if (type) fireEvent.change(document.getElementById(type.id), { target: { value: type.value } });
    const el = screen.queryByRole('button', { name: button });
    if (!el) return { ok: false, why: `no button "${button}" on the ${page} page` };
    /*
     * A button the page draws as HTML with an inline handler (the Production graph engine's drawer) carries its
     * call as onclick text. A browser runs that text against window; jsdom under vitest runs it in its own inner
     * context, which sees nothing the test defines, so it would throw "not defined" for a function that exists.
     * So the text is run as the browser runs it: against window, with the element as `this`.
     */
    const inline = el.getAttribute('onclick');
    await act(async () => {
        if (inline) await Function('event', inline).call(el, new MouseEvent('click', { bubbles: true }));
        else fireEvent.click(el);
    });
    const reached = legacy.calls.length > before.api || coreFns.some(([, v], i) => v.mock.calls.length > before.core[i]);
    return { ok: reached, why: reached ? '' : `"${button}" on ${page} was clicked and reached nothing` };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('dialogue scopes (voice-casting DIALOGUE_SCOPES): every scope is reachable from the page AND from an agent', () => {
    const VC = backend('lib/voice-casting');
    const tools = backend('lib/mcp-tools');
    const names = new Set((tools.listTools ? tools.listTools() : tools.TOOLS).map(t => t.name));

    it('the registry is read, not typed', () => {
        expect(VC.DIALOGUE_SCOPES.length).toBeGreaterThanOrEqual(4);
    });

    for (const scope of VC.DIALOGUE_SCOPES) {
        it(`${scope.id}: an agent can (MCP tool) and a person can (a control that works)`, async () => {
            expect(scope.tool, `${scope.id}: declares no MCP tool`).toBeTruthy();
            expect(names.has(scope.tool), `${scope.id}: names tool '${scope.tool}', which does not exist`).toBe(true);
            if (scope.ui === null) {
                expect(scope.why_no_ui && scope.why_no_ui.length > 20, `${scope.id}: has no UI and no reason for it`).toBe(true);
                return;
            }
            expect(scope.ui, `${scope.id}: declares no UI control`).toBeTruthy();
            const fn = scope.ui.replace(/\($/, '');
            if (new RegExp(`onclick="[^"]*\\b${fn}\\(`).test(legacyPage())) return;          // legacy: wired as the backend checks
            const controls = reactControls(fn);
            expect(controls.length, `${scope.id}: ${fn}() is wired by no legacy onclick, and no React page's or component's reach.js declares a control for it`).toBeGreaterThan(0);
            for (const c of controls) {
                const r = await clickReaches(c);
                expect(r.ok, `${scope.id}: ${r.why}`).toBe(true);
            }
        });
    }

    it('every control a reach.js declares names a registry function (no stale entries)', () => {
        const known = new Set(VC.DIALOGUE_SCOPES.filter(s => s.ui).map(s => s.ui.replace(/\($/, '')));
        const stale = Object.entries(REACH).flatMap(([page, r]) => Object.keys(r.controls || {}).filter(fn => !known.has(fn)).map(fn => `${page}: ${fn}`));
        expect(stale).toEqual([]);
    });
});
