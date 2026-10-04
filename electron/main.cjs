/*
 * Electron main. Starts the existing backend (backend/server.js, the same API
 * on :3100 and the same data folder) unless one already answers, then opens the
 * window: the vite dev server when FE_DEV_URL is set, else the built dist/.
 *
 *   --smoke   visit every page and exit 1 on any console error (CI / round checks)
 */
const { app, BrowserWindow, shell, ipcMain } = require('electron');

// The app's name in the menus (About / Hide / Quit Film Engine) and to the OS. Before ready, or the
// default menu is built with "Electron". The bold app-menu title and the Dock label come from the
// running bundle's Info.plist: tools/name-dev-electron.js renames the dev binary's (npm postinstall).
app.setName('Film Engine');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');

const SMOKE = process.argv.includes('--smoke');
// A smoke run gets its own throwaway Chromium profile: two checkouts can run it at once without sharing
// one profile, and a test run never writes into the person's own app storage (remembered page, settings).
if (SMOKE) app.setPath('userData', require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'fe-smoke-')));
// The iPhone app's icon in the macOS shape (tools/make-mac-icon.py from electron/icon-ios.png).
const ICON = path.join(__dirname, 'icon.png');
const BACKEND_VERSION = require('../backend/package.json').version;
let API = process.env.FE_API_BASE || 'http://localhost:3100';
let backend = null;
// The smoke run records what would leave the app instead of opening a browser.
const leftApp = [];
const openExternal = (url) => (SMOKE ? leftApp.push(url) : shell.openExternal(url));

function health(base) {
    return new Promise((resolve) => {
        const req = http.get(base + '/api/health', (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); } catch { resolve(null); } });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(1500, () => { req.destroy(); resolve(null); });
    });
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
        srv.on('error', reject);
    });
}

function stopBackend() {
    if (backend) { try { backend.kill(); } catch { /* already gone */ } backend = null; }
}

/** Kill what we started, then leave. app.exit() skips before-quit, so never call it bare. */
function quit(code) { stopBackend(); app.exit(code); }

/*
 * A backend already answering is reused only if it is THIS backend's version of
 * Film Engine. The smoke run always starts its own, on a free port, so it tests
 * backend/ here and not whatever happens to be on :3100.
 */
async function ensureBackend() {
    if (!SMOKE || process.env.FE_SMOKE_REUSE) {
        const h = await health(API);
        if (h && h.service === 'film-engine' && h.version === BACKEND_VERSION) return 'reused';
        if (h) console.warn(`[film-engine] ${API} answers as ${h.service} ${h.version}, not film-engine ${BACKEND_VERSION}: starting this app's own backend`);
    }
    if (SMOKE || await health(API)) API = `http://localhost:${await freePort()}`;
    // System node, not Electron's: better-sqlite3 stays built for it, no electron-rebuild.
    backend = spawn(process.env.FE_NODE || 'node', [path.join(__dirname, 'backend-runner.cjs')], {
        cwd: path.join(__dirname, '..', 'backend'),
        env: { ...process.env, PORT: String(new URL(API).port || 3100),
            // The smoke run is one client opening every page and several flows within a minute, against its own throwaway
            // backend: the general limit (200/min, for a person) would refuse its later checks. Generation keeps its limit.
            ...(SMOKE ? { RATE_LIMIT_MAX_GENERAL: process.env.RATE_LIMIT_MAX_GENERAL || '100000' } : {}) },
        stdio: ['pipe', 'inherit', 'inherit'],
    });
    backend.on('exit', (code) => { if (code) console.error(`[backend] exited ${code}`); backend = null; });
    for (let i = 0; i < 80; i++) {
        const h = await health(API);
        if (h && h.version === BACKEND_VERSION) return 'started';
        if (!backend) break;
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('backend did not come up on ' + API);
}

/*
 * What the page opens. Print previews (about:blank) and the provider OAuth
 * popup (it posts back to its opener) stay in the app; a file from this app's
 * API downloads; any other web page goes to the system browser. The main
 * window itself never navigates away from the app.
 */
function guardWindow(win) {
    const appUrl = win.webContents.getURL();
    win.webContents.setWindowOpenHandler(({ url, frameName }) => {
        if (!url || url === 'about:blank' || frameName === 'provider-oauth') {
            return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } };
        }
        if (url.startsWith(API + '/')) { win.webContents.downloadURL(url); return { action: 'deny' }; }
        if (/^https?:/i.test(url)) openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (url.split('#')[0] === appUrl.split('#')[0]) return; // a route change
        e.preventDefault();
        if (/^https?:/i.test(url)) openExternal(url);
    });
}

/*
 * window.prompt(), which Electron does not implement. The page's call blocks on
 * sendSync while main shows a small modal input window over it; the answer (or
 * null for Cancel / closing it) becomes event.returnValue.
 */
let lastPrompt = null; // the open prompt window, for the smoke run
ipcMain.on('fe-prompt', (event, message, value) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const win = new BrowserWindow({
        parent, modal: !!parent, width: 440, height: 170, resizable: false, minimizable: false, maximizable: false,
        show: !SMOKE, frame: false, backgroundColor: '#151517',
        webPreferences: { preload: path.join(__dirname, 'prompt-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    lastPrompt = win;
    let done = false;
    const finish = (answer) => {
        if (done) return;
        done = true;
        ipcMain.removeListener('fe-prompt-answer', onAnswer);
        event.returnValue = answer;
        if (!win.isDestroyed()) win.close();
        if (lastPrompt === win) lastPrompt = null;
    };
    const onAnswer = (e, answer) => { if (e.sender === win.webContents) finish(answer); };
    ipcMain.on('fe-prompt-answer', onAnswer);
    win.on('closed', () => finish(null));
    win.loadFile(path.join(__dirname, 'prompt.html'), { query: { message, value } });
});

async function createWindow() {
    const win = new BrowserWindow({
        width: 1440, height: 900, show: !SMOKE,
        title: 'Film Engine',
        icon: ICON,
        backgroundColor: '#0b0b0c',
        // No grey title bar on macOS: the traffic lights sit inside the app's top bar (src/styles/desktop.css).
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 26, y: 34 } } : {}),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
            additionalArguments: [`--fe-api-base=${API}`],
        },
    });
    if (process.env.FE_SMOKE_URL) await win.loadURL(process.env.FE_SMOKE_URL); // e.g. the original one-file app, for a parity run
    else if (process.env.FE_DEV_URL) await win.loadURL(process.env.FE_DEV_URL);
    else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    guardWindow(win);
    return win;
}

async function smoke(win) {
    const { PAGES: ALL, CHUNKED, REACT = {} } = require('./smoke-pages.cjs');
    const PAGES = process.env.FE_SMOKE_PAGES ? ALL.filter(p => process.env.FE_SMOKE_PAGES.split(',').includes(p)) : ALL;
    const errors = [];
    win.webContents.on('console-message', (_e, level, message, line, source) => {
        if (level >= 3) errors.push({ page: current, message, at: `${path.basename(source || '')}:${line}` });
    });
    win.webContents.on('render-process-gone', (_e, d) => { errors.push({ page: current, message: 'renderer gone: ' + d.reason }); });
    let current = 'boot';
    const js = (code) => win.webContents.executeJavaScript(code, true);
    await new Promise(r => setTimeout(r, 2500));
    if (!process.env.FE_SMOKE_URL) {
        const base = await js('API_BASE');
        if (base !== API) errors.push({ page: 'boot', message: `the page talks to ${base}, not the backend main started (${API})` });
        else console.log(`page API_BASE = ${base}`);
    }
    const project = await js(`api('/projects').then(r => (Array.isArray(r) ? r : (r.projects || []))[0]?.id || null).catch(() => null)`);
    if (project) await js(`openProject(${JSON.stringify(project)}, 'dashboard')`).catch(e => errors.push({ page: 'openProject', message: String(e) }));
    await new Promise(r => setTimeout(r, 1500));
    const report = [];
    const shapes = {};
    for (const id of PAGES) {
        current = id;
        const before = errors.length;
        await js(`navigateTo(${JSON.stringify(id)})`).catch(e => errors.push({ page: id, message: String(e) }));
        await new Promise(r => setTimeout(r, Number(process.env.FE_SMOKE_WAIT || 1200)));
        // Then wait for the page to settle: the same shape three reads in a row, 0.5 s apart (20 s at most).
        const shapeOf = `(() => { const el = document.getElementById('page-' + ${JSON.stringify(id)}); return el ? el.querySelectorAll('*').length + ':' + el.innerText.length : ''; })()`;
        for (let last = '', same = 0, t = 0; same < 2 && t < 40; t++) {
            await new Promise(r => setTimeout(r, 500));
            const now = await js(shapeOf);
            same = now === last ? same + 1 : 0; last = now;
        }
        const state = await js(`({ active: document.querySelector('.page.active')?.id, chunk: !!(window.__fePages && window.__fePages.loaded().includes(${JSON.stringify(id)})),
            shape: (() => { const el = document.getElementById('page-' + ${JSON.stringify(id)}); return el ? { elements: el.querySelectorAll('*').length, text: el.innerText.replace(/\\s+/g, ' ').trim().length } : null; })() })`);
        shapes[id] = state.shape;
        // A React page must have registered the loader navigateTo calls, or the visit loaded nothing.
        const reactOk = !REACT[id] || await js(`typeof window[${JSON.stringify(REACT[id])}] === 'function'`);
        const ok = state.active === 'page-' + id && errors.length === before && reactOk;
        report.push({ id, ok, chunk: state.chunk, active: state.active, react: !!REACT[id] });
    }
    /*
     * The storyboard in the real app: React draws the cards and core writes INTO them by id, so a card
     * that lost an id breaks the regenerate veil, the markup or the drift marks with no error at all.
     * On a project with frames: every card carries img-/annot-/data-facets, and the shared frame viewer
     * opens from the board (viewing only; nothing here generates or spends).
     */
    if (project && PAGES.includes('storyboard')) {
        current = 'storyboard ids';
        const before = errors.length;
        await js(`navigateTo('storyboard')`);
        for (let t = 0; t < 40; t++) {
            if (await js(`!!(window.FRAME_VIEWER && document.querySelector('#storyboardGrid > .card, #storyboardGrid > .empty-state'))`).catch(() => false)) break;
            await new Promise(r => setTimeout(r, 250));
        }
        const st = await js(`(() => {
            const cards = [...document.querySelectorAll('#storyboardGrid > .card')];
            const ids = (FRAME_VIEWER.frames || []).map(f => f.shot_id);
            const missing = ids.filter(id => !document.getElementById('img-' + id) || !document.getElementById('annot-' + id) || !document.querySelector('[data-facets="' + id + '"]'));
            return { cards: cards.length, frames: ids.length, missing, first: ids[0] || null };
        })()`);
        let viewer = 'no frames';
        if (st.first) {
            await js(`openFrameViewer(${JSON.stringify(st.first)})`).catch(e => errors.push({ page: 'storyboard', message: String(e) }));
            await new Promise(r => setTimeout(r, 800));
            viewer = await js(`document.getElementById('frameViewerModal')?.classList.contains('open') ? 'open' : 'closed'`);
            await js(`closeModal('frameViewerModal')`).catch(() => {});
        }
        const ok = st.cards === st.frames && !st.missing.length && (!st.first || viewer === 'open') && errors.length === before;
        report.push({ id: 'storyboard ids', ok, want: 'storyboard ids', active: ok ? `storyboard ids (${st.cards} cards, viewer ${viewer})` : `cards=${st.cards} frames=${st.frames} missing=${st.missing.join(',')} viewer=${viewer}` });
    }
    /*
     * The Production graph's engine (src/pages/productiongraph/engine.js) draws the graph into the React page by id:
     * every node the server sent is on the canvas, and selecting a shot opens its drawer. Viewing only; it reads the
     * graph, changes no setting and generates nothing.
     */
    if (project && PAGES.includes('productiongraph')) {
        current = 'graph draws';
        const before = errors.length;
        await js(`navigateTo('productiongraph')`);
        for (let t = 0; t < 40; t++) {
            if (await js(`!!(window.PG && PG.graph && PG.graph.project_id === state.currentProject.id && document.querySelector('#pgWorld [data-key]'))`).catch(() => false)) break;
            await new Promise(r => setTimeout(r, 250));
        }
        const st = await js(`(() => {
            const nodes = (PG.graph && PG.graph.nodes) || [];
            const missing = nodes.filter(n => pgVisible(n) && !pgCollapsedOf(n.key) && !document.querySelector('#pgWorld [data-key="' + CSS.escape(n.key) + '"]')).map(n => n.key);
            const shot = nodes.find(n => n.type === 'shot');
            if (shot) pgSelect(shot.key);
            return { nodes: nodes.length, missing, shot: shot ? shot.shot_code : null };
        })()`).catch(e => ({ error: String(e) }));
        await new Promise(r => setTimeout(r, 600));
        const drawer = await js(`(document.getElementById('pgDrawerBody')?.textContent || '').trim().length`).catch(() => 0);
        const ok = !st.error && st.nodes > 0 && !st.missing.length && (!st.shot || drawer > 0) && errors.length === before;
        report.push({ id: 'graph draws', ok, want: 'graph draws', active: ok ? `graph draws (${st.nodes} nodes, drawer for ${st.shot})` : `error=${st.error || ''} nodes=${st.nodes} missing=${(st.missing || []).join(',')} drawer=${drawer}` });
    }
    /*
     * The Screenplay page's engine (src/pages/screenplay/engine.js) drives the editor React renders: the project's real
     * Fountain is drawn into it as blocks, the index cards draw a card per scene heading, the statistics panel opens,
     * and back in the editor the blocks are the same. Reading only: nothing is typed, and no request but a GET is made.
     */
    if (project && PAGES.includes('screenplay')) {
        current = 'screenplay editor';
        const before = errors.length;
        await js(`navigateTo('screenplay')`);
        for (let t = 0; t < 40; t++) {
            if (await js(`document.querySelectorAll('#screenplayEditor [data-element-type]').length > 0`).catch(() => false)) break;
            await new Promise(r => setTimeout(r, 250));
        }
        const st = await js(`(async () => {
            // Nothing may be written while the check looks: every request that is not a GET is counted.
            const realFetch = window.fetch; let writes = 0;
            window.fetch = (u, o) => { if (o && o.method && o.method !== 'GET') writes++; return realFetch(u, o); };
            const ed = document.getElementById('screenplayEditor');
            const blocks = ed.querySelectorAll('[data-element-type]').length;
            const headings = ed.querySelectorAll('[data-element-type="scene-heading"]').length;
            setViewMode('cards');
            await new Promise(r => setTimeout(r, 300));
            const cards = document.querySelectorAll('#indexCardsGrid > *').length;
            setViewMode('editor');
            toggleScriptStats();
            const stats = document.getElementById('scriptStatsContent').classList.contains('open');
            toggleScriptStats();
            await new Promise(r => setTimeout(r, 300));
            window.fetch = realFetch;
            return { blocks, headings, cards, stats, after: ed.querySelectorAll('[data-element-type]').length, writes };
        })()`).catch(e => ({ error: String(e) }));
        const ok = !st.error && st.blocks > 0 && st.headings > 0 && st.cards === st.headings && st.stats && st.after === st.blocks && st.writes === 0 && errors.length === before;
        report.push({ id: 'screenplay editor', ok, want: 'screenplay editor', active: ok ? `screenplay editor (${st.blocks} blocks, ${st.cards} cards)` : JSON.stringify(st) });
    }
    /*
     * The music engine (src/pages/music/engine.js) draws all three music pages React renders: the sound library's count
     * and the cue grid on Music & Sound, the list on Music Cues, and the score session (or why there is none) in place
     * of the Score's placeholder. Viewing only: nothing is generated, saved or played.
     */
    if (project && ['music', 'musiccues', 'musicws'].every(p => PAGES.includes(p))) {
        current = 'music pages';
        const before = errors.length;
        const drawn = {
            music: `(document.getElementById('soundLibCount').textContent.trim().length > 0) && document.getElementById('musicGrid').children.length > 0`,
            musiccues: `document.getElementById('musicCueList').innerHTML.trim().length > 0`,
            musicws: `!/Loading the score session/.test(document.getElementById('mwRoot').textContent)`,
        };
        const got = {};
        for (const [page, test] of Object.entries(drawn)) {
            await js(`navigateTo('${page}')`);
            got[page] = false;
            for (let t = 0; t < 40 && !got[page]; t++) {
                got[page] = await js(test).catch(() => false);
                if (!got[page]) await new Promise(r => setTimeout(r, 250));
            }
        }
        const ok = Object.values(got).every(Boolean) && errors.length === before;
        report.push({ id: 'music pages', ok, want: 'music pages', active: ok ? 'music pages (library, cue grid, cue list, score)' : JSON.stringify(got) + ` errors=${errors.length - before}` });
    }
    /*
     * The 3D stage engine (src/pages/previs/engine.js) draws both 3D pages React renders: the World Engine console on
     * Previs (its view and shot rail), and the models page, with three.js loaded first (react.json vendors). Viewing
     * only: no world is generated and nothing is saved.
     */
    if (project && ['previs', 'threed'].every(p => PAGES.includes(p))) {
        current = '3d pages';
        const before = errors.length;
        const drawn = {
            previs: `typeof THREE !== 'undefined' && !!document.querySelector('#page-previs #pvView')`,
            threed: `typeof THREE !== 'undefined' && document.getElementById('page-threed').querySelectorAll('[id]').length > 3 && !/Loading/.test(document.getElementById('page-threed').textContent.slice(0, 400))`,
        };
        const got = {};
        for (const [page, test] of Object.entries(drawn)) {
            await js(`navigateTo('${page}')`);
            got[page] = false;
            for (let t = 0; t < 40 && !got[page]; t++) {
                got[page] = await js(test).catch(() => false);
                if (!got[page]) await new Promise(r => setTimeout(r, 250));
            }
        }
        const ok = Object.values(got).every(Boolean) && errors.length === before;
        report.push({ id: '3d pages', ok, want: '3d pages', active: ok ? '3d pages (console drawn, models page, three.js loaded)' : JSON.stringify(got) + ` errors=${errors.length - before}` });
    }
    // A launch with no address reopens the film and page you were on.
    if (project && !process.env.FE_SMOKE_URL && !process.env.FE_SMOKE_PAGES) {
        current = 'reopen';
        const before = errors.length;
        await js(`openProject(${JSON.stringify(project)}, 'notes').then(() => new Promise(r => setTimeout(r, 1500))).then(() => window.__feRoute.save())`);
        const url = new URL(win.webContents.getURL());
        url.hash = '';
        await win.loadURL(url.href.replace(/#$/, ''));
        for (let t = 0; t < 40; t++) {
            if (await js(`!!(state.currentProject && state.currentPage === 'notes')`).catch(() => false)) break;
            await new Promise(r => setTimeout(r, 250));
        }
        const st = await js(`({ active: document.querySelector('.page.active')?.id, film: state.currentProject && state.currentProject.id })`);
        const ok = st.active === 'page-notes' && st.film === project && errors.length === before;
        report.push({ id: 'reopen last film', ok, want: 'page-notes', active: ok ? 'page-notes' : `${st.active} film=${st.film}` });
    }
    // Cold starts on deep links: what a page needs must load before its loader runs: a chunked page's chunk (and its
    // libraries), and Previs's three.js, which it declares itself (react.json vendors) now that it has no chunk. Previs
    // is always checked, so this does not vanish when the last chunk does.
    const deeps = [PAGES.find(p => p !== 'projects' && p !== 'dashboard' && CHUNKED.includes(p)), PAGES.includes('previs') && 'previs'].filter(Boolean);
    for (const deep of (project && !process.env.FE_SMOKE_URL && !process.env.FE_SMOKE_PAGES) ? deeps : []) {
        current = 'deeplink:' + deep;
        const before = errors.length;
        const url = new URL(win.webContents.getURL());
        url.hash = `#/${project}/${deep}`;
        await win.loadURL(url.href);
        // Poll, so a slow machine fails on a real problem rather than on a fixed wait.
        const chunked = CHUNKED.includes(deep);
        const ready = chunked ? `!!(window.__fePages && window.__fePages.loaded().includes(${JSON.stringify(deep)}))`
            : `typeof THREE !== 'undefined' && !!document.querySelector('#page-previs #pvView')`;
        for (let t = 0; t < 40; t++) {
            if (await js(ready).catch(() => false)) break;
            await new Promise(r => setTimeout(r, 250));
        }
        await new Promise(r => setTimeout(r, 1000)); // let its loader paint
        const st = await js(`({ active: document.querySelector('.page.active')?.id, loaded: ${ready}, three: typeof THREE !== 'undefined' })`);
        const ok = st.active === 'page-' + deep && st.loaded && errors.length === before && (deep !== 'previs' || st.three);
        report.push({ id: 'deeplink→' + deep, ok, chunk: chunked, active: st.active, want: 'page-' + deep });
    }
    if (process.env.FE_SMOKE_SHAPES) require('fs').writeFileSync(process.env.FE_SMOKE_SHAPES, JSON.stringify(shapes, null, 1));
    // The top bar's Sync screenplay: present in the rail, and its dialog compares (a dry run) when pressed.
    if (project && !process.env.FE_SMOKE_URL && !process.env.FE_SMOKE_PAGES) {
        current = 'sync';
        const before = errors.length;
        const there = await js(`!!document.querySelector('.fe-top .fe-rail #syncScreenplayBtn')`);
        await js(`document.getElementById('syncScreenplayBtn').click(); true`);
        let shown = '';
        for (let t = 0; t < 40; t++) {
            shown = await js(`(() => { const m = document.getElementById('syncScreenplayModal'); return m && m.classList.contains('open') ? m.querySelector('.modal-body').textContent : ''; })()`);
            if (/Descriptions are never rewritten|Could not compare/.test(shown)) break;
            await new Promise(r => setTimeout(r, 250));
        }
        /*
         * A modal can always be closed by its ×. On macOS the bar is the window's drag region, hit-tested by the
         * window system above the page, so a tall modal's × inside the bar's rectangle dragged the window. While a
         * modal is open nothing may drag (desktop.css); the × closes it; dragging is back once it is closed.
         */
        const region = `(() => { const r = (el, p) => getComputedStyle(el, p).getPropertyValue('-webkit-app-region').trim();
            return { bar: r(document.querySelector('.fe-top')), strip: r(document.documentElement, '::before'), overlay: r(document.getElementById('syncScreenplayModal')) }; })()`;
        const mac = await js(`document.documentElement.classList.contains('fe-desktop-mac')`);
        await js(`document.documentElement.classList.add('fe-desktop-mac'); true`);
        const open = await js(region);
        await js(`document.querySelector('#syncScreenplayModal .modal-close').click(); true`);
        const closedByX = await js(`!document.getElementById('syncScreenplayModal').classList.contains('open')`);
        const after = await js(region);
        if (!mac) await js(`document.documentElement.classList.remove('fe-desktop-mac'); true`);
        const closable = open.bar === 'no-drag' && open.strip === 'no-drag' && open.overlay === 'no-drag' && closedByX && after.bar === 'drag' && after.strip === 'drag';
        report.push({ id: 'modal closes by ×', ok: closable, want: 'modal closes by ×', active: closable ? 'modal closes by ×' : `open=${JSON.stringify(open)} closedByX=${closedByX} after=${JSON.stringify(after)}` });
        await js(`closeModal('syncScreenplayModal'); true`);
        const ok = there && /Descriptions are never rewritten/.test(shown) && errors.length === before;
        report.push({ id: 'sync screenplay', ok, want: 'sync screenplay', active: ok ? 'sync screenplay' : `inRail=${there} dialog=${shown.slice(0, 80)}` });
    }
    /*
     * Switching project from inside one: the user's report, "we open a storyboard/production for a project, go into
     * another one, the previous one is opened, and then no projects load". Open A on the storyboard (the graph's side
     * panel loads A's graph in the background), go back to the list straight away, then open B straight away. The list
     * must show and STAY (nothing may reopen A), and B's storyboard, route and graph must all be B's.
     */
    if (project && !process.env.FE_SMOKE_URL && !process.env.FE_SMOKE_PAGES) {
        current = 'switch';
        const before = errors.length;
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const ids = await js(`(async () => { try {
            let r = await api('/projects'); let list = Array.isArray(r) ? r : (r.projects || []);
            if (list.length < 2) { await api('/projects', { method: 'POST', body: JSON.stringify({ title: 'Smoke second project' }) }); r = await api('/projects'); list = Array.isArray(r) ? r : (r.projects || []); }
            return list.slice(0, 2).map(p => p.id);
        } catch (e) { return 'setup: ' + e.message; } })()`);
        if (!Array.isArray(ids)) console.error('switch project', ids);
        const [A, B] = Array.isArray(ids) ? ids : [];
        // Where the app is, at each step.
        const where = `({ project: state.currentProject && state.currentProject.id, page: state.currentPage, hash: location.hash,
            active: document.querySelector('.page.active')?.id, cards: document.querySelectorAll('#page-projects .project-card').length,
            graph: (typeof PG !== 'undefined' && PG.graph) ? PG.graph.project_id : null })`;
        // The graph on (its side panel then loads the open project's graph in the background, on every switch), and
        // A slow: every read naming A answers 1.2s late, so A's loads are still in flight when B is opened.
        let step = 'flag';
        const js0 = js; const jsStep = async (code) => { try { return await js0(code); } catch (e) { throw new Error(`switch project, step ${step}: ${String(code).slice(0, 80)}`); } };
        const thrown = [];
        const back = async () => { const r = await jsStep(`(() => { try { backToProjectList(); return true; } catch (e) { return String(e && e.stack || e); } })()`); if (r !== true) thrown.push(r); };
        const flag = await jsStep(`api('/settings').then(r => !!(r.settings && r.settings.production_graph)).catch(() => false)`);
        const on = await jsStep(`api('/settings', { method: 'PUT', body: JSON.stringify({ production_graph: true }) }).then(() => applyProductionFlag()).then(() => true, e => 'flag: ' + e.message)`);
        if (on !== true) console.error('switch project', on);
        await jsStep(`window.__feApi = window.__feApi || api; window.api = (path, ...rest) => String(path).includes(${JSON.stringify(A)})
            ? new Promise(r => setTimeout(r, 1200)).then(() => window.__feApi(path, ...rest)) : window.__feApi(path, ...rest); true`);
        await jsStep(`openProject(${JSON.stringify(A)}, 'productiongraph'); true`);
        await wait(1400);                                  // A open on the graph, its graph read still in flight
        await back();
        await wait(2500);
        const list = await jsStep(where);
        await jsStep(`openProject(${JSON.stringify(B)}, 'storyboard'); true`);
        await wait(150);
        await back();
        await wait(80);
        await jsStep(`openProject(${JSON.stringify(B)}, 'storyboard'); true`);
        await wait(2000);
        const onBoard = await jsStep(where);
        await jsStep(`navigateTo('productiongraph'); true`);
        await wait(3000);
        const onB = await jsStep(where);
        const listOk = list.project === null && list.page === 'projects' && list.active === 'page-projects' && list.cards >= 2 && /^#\/projects/.test(list.hash);
        const bOk = onBoard.project === B && onBoard.page === 'storyboard' && onBoard.active === 'page-storyboard' && onBoard.hash.includes(B)
            && onB.project === B && onB.active === 'page-productiongraph' && onB.graph === B;
        const ok = listOk && bOk && !thrown.length && errors.length === before;
        report.push({ id: 'switch project', ok, want: 'switch project', active: ok ? 'switch project' : `list=${JSON.stringify(list)} onBoard=${JSON.stringify(onBoard)} onB=${JSON.stringify(onB)} A=${A} B=${B} errors=${errors.length - before} thrown=${thrown.join(' | ').slice(0, 600)}` });
        await jsStep(`window.api = window.__feApi; true`);
        await jsStep(`api('/settings', { method: 'PUT', body: JSON.stringify({ production_graph: ${flag} }) }).then(() => applyProductionFlag()).then(() => true, () => false)`);
        await back();
        await wait(500);
    }
    /*
     * The location, prop and character sheets (React components SubjectSheet and CharacterSheet, their engines moved
     * verbatim): a real location, prop and character open, and each sheet draws EVERY region the backend's registry
     * declares (lib/subject-sheets.js, lib/character-sheet.js), by its anchor, with no console error. Set-based over the registry, so a region the engine stops drawing fails here.
     */
    if (project && !process.env.FE_SMOKE_URL && !process.env.FE_SMOKE_PAGES) {
        current = 'sheets';
        const before = errors.length;
        const { LOCATION_REGIONS, PROP_REGIONS } = require('../backend/lib/subject-sheets');
        const found = await js(`(async () => { try {
            const r = await api('/projects'); const list = Array.isArray(r) ? r : (r.projects || []);
            for (const p of list.slice(0, 2)) {           // a couple: every project at once trips the rate limit
                const [l, q] = await Promise.all([api('/projects/' + p.id + '/locations'), api('/projects/' + p.id + '/props')]);
                const c = await api('/projects/' + p.id + '/characters');
                if ((l.locations || []).length && (q.props || []).length && (c.characters || []).length) return { project: p.id, location: l.locations[0].id, prop: q.props[0].id, character: c.characters[0].id };
            }
            const p = list[0];
            const l = await api('/projects/' + p.id + '/locations', { method: 'POST', body: JSON.stringify({ name: 'Smoke dock' }) });
            const q = await api('/projects/' + p.id + '/props', { method: 'POST', body: JSON.stringify({ name: 'Smoke lamp' }) });
            const c = await api('/projects/' + p.id + '/characters', { method: 'POST', body: JSON.stringify({ name: 'Smoke Mara' }) });
            return { project: p.id, location: (l.location || l).id, prop: (q.prop || q).id, character: (c.character || c).id };
        } catch (e) { return 'setup: ' + e.message; } })()`);
        const results = [];
        if (typeof found === 'string') results.push(found);
        else {
            await js(`openProject(${JSON.stringify(found.project)}, 'locations').then(() => true)`);
            await new Promise(r => setTimeout(r, 1500));
            for (const [kind, id, regions] of [['location', found.location, LOCATION_REGIONS], ['prop', found.prop, PROP_REGIONS]]) {
                const drawn = await js(`openSubjectSheet(${JSON.stringify(kind)}, ${JSON.stringify(id)}).then(() => ({
                    open: document.getElementById('subjectSheetModal').classList.contains('open'),
                    name: document.getElementById('ssName').textContent,
                    anchors: [...document.querySelectorAll('#ssBody [data-region]')].map(e => e.dataset.region) }), e => ({ error: e.message }))`);
                const missing = drawn.error ? ['(threw: ' + drawn.error + ')'] : regions.map(r => r.anchor).filter(a => !drawn.anchors.includes(a));
                if (!drawn.open || /Loading/.test(drawn.name || '') || missing.length) results.push(`${kind}: open=${drawn.open} name=${drawn.name} missing=${missing.join(',')}`);
                await js(`closeModal('subjectSheetModal'); true`);
            }
            // The character sheet (React component CharacterSheet): every region of lib/character-sheet.js SHEET_REGIONS, by class.
            const { SHEET_REGIONS } = require('../backend/lib/character-sheet');
            const cs = await js(`openCharacterSheet(${JSON.stringify(found.character)}).then(() => ({
                open: document.getElementById('characterSheetModal').classList.contains('open'),
                name: document.getElementById('csName').textContent,
                missing: ${JSON.stringify(SHEET_REGIONS.map(r => r.anchor))}.filter(a => !document.querySelector('#csBody .' + a)) }), e => ({ error: e.message }))`);
            if (cs.error || !cs.open || /Loading/.test(cs.name || '') || cs.missing.length) results.push(`character: ${cs.error || ''} open=${cs.open} name=${cs.name} missing=${(cs.missing || []).join(',')}`);
            await js(`closeModal('characterSheetModal'); true`);
            await js(`backToProjectList(); true`);
        }
        const ok = !results.length && errors.length === before;
        report.push({ id: 'subject sheets', ok, want: 'subject sheets', active: ok ? 'subject sheets' : `${results.join(' | ')} errors=${errors.length - before}` });
    }
    /*
     * Flows (React page, the graph chunk's engine moved verbatim): opened in a project, its node palette draws one
     * button for every node type the server serves (in the four kinds the palette groups), with no console error.
     */
    if (project && !process.env.FE_SMOKE_URL && !process.env.FE_SMOKE_PAGES) {
        current = 'flows';
        const before = errors.length;
        await js(`openProject(${JSON.stringify(project)}, 'flows').then(() => true)`);
        let st = null;
        for (let t = 0; t < 40; t++) {
            st = await js(`(async () => {
                const types = await api('/flows/node-types');
                const want = Object.values(types).filter(d => ['input', 'generator', 'transform', 'output'].includes(d.kind)).length;
                return { want, drawn: document.querySelectorAll('#flowPalette .flow-node-btn').length, active: document.querySelector('.page.active')?.id };
            })()`).catch(e => ({ error: e.message }));
            if (st && st.want && st.drawn === st.want) break;
            await new Promise(r => setTimeout(r, 250));
        }
        const ok = !!st && !st.error && st.want > 0 && st.drawn === st.want && st.active === 'page-flows' && errors.length === before;
        report.push({ id: 'flows palette', ok, want: 'flows palette', active: ok ? 'flows palette' : JSON.stringify(st) + ` errors=${errors.length - before}` });
        await js(`backToProjectList(); true`);
    }
    // What the page opens: print previews stay in the app, API files download, other sites leave.
    if (!process.env.FE_SMOKE_URL && !process.env.FE_SMOKE_PAGES) {
        current = 'windows';
        const downloads = [];
        win.webContents.session.on('will-download', (_e, item) => { downloads.push(item.getURL()); item.cancel(); });
        const before = BrowserWindow.getAllWindows().length;
        await js(`(() => { const w = window.open('', '_blank'); w.document.write('<p>print</p>'); return true; })()`);
        await new Promise(r => setTimeout(r, 800));
        const printOk = BrowserWindow.getAllWindows().length === before + 1;
        for (const w of BrowserWindow.getAllWindows()) if (w !== win) w.destroy();
        await js(`window.open('https://example.com/vendor', '_blank'); window.open(API_BASE + '/api/health', '_blank'); true`);
        await js(`location.href = 'https://example.com/away'; true`).catch(() => {});
        await new Promise(r => setTimeout(r, 1500));
        const stayed = BrowserWindow.getAllWindows().length === before && !/example\.com/.test(win.webContents.getURL());
        const ok = printOk && stayed && leftApp.includes('https://example.com/vendor') && leftApp.includes('https://example.com/away') && downloads.some(u => u.endsWith('/api/health'));
        report.push({ id: 'window guard', ok, want: 'window guard', active: ok ? 'window guard' : `print=${printOk} stayed=${stayed} external=${JSON.stringify(leftApp)} downloads=${JSON.stringify(downloads)}` });
    }
    // (After the window guard, which counts windows: prompt windows close asynchronously.)
    // window.prompt() works (Electron has none; the app provides it): OK returns the text, Cancel null.
    if (!process.env.FE_SMOKE_URL && !process.env.FE_SMOKE_PAGES) {
        current = 'prompt';
        const answerWith = async (fill) => {
            const pending = js(`window.prompt('Name this version', 'v1')`);
            for (let t = 0; t < 40 && !(lastPrompt && !lastPrompt.webContents.isLoading()); t++) await new Promise(r => setTimeout(r, 100));
            if (!lastPrompt) return 'no prompt window';
            await lastPrompt.webContents.executeJavaScript(fill);
            return pending;
        };
        const ok = await answerWith(`document.getElementById('value').value = 'Fine cut'; document.getElementById('ok').click();`);
        const cancel = await answerWith(`document.getElementById('cancel').click();`);
        const prefilled = await answerWith(`document.getElementById('ok').click();`);
        const pass = ok === 'Fine cut' && cancel === null && prefilled === 'v1';
        report.push({ id: 'window.prompt', ok: pass, want: 'window.prompt', active: pass ? 'window.prompt' : `ok=${ok} cancel=${cancel} prefilled=${prefilled}` });
    }
    for (const r of report) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(16)} ${r.react ? 'react' : r.chunk ? 'chunk loaded' : 'core only'}${r.active === (r.want || 'page-' + r.id) ? '' : '  active=' + r.active}`);
    for (const e of errors) console.log(`  console error [${e.page}] ${e.message} ${e.at || ''}`);
    console.log(`smoke: ${report.filter(r => r.ok).length}/${report.length} pages clean, ${errors.length} console errors, project=${project || 'none'}`);
    return errors.length === 0 && report.every(r => r.ok);
}

app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.dock) app.dock.setIcon(ICON);
    try {
        const how = await ensureBackend();
        console.log(`[film-engine] backend ${how} at ${API}`);
        const win = await createWindow();
        if (SMOKE) { const ok = await smoke(win); quit(ok ? 0 : 1); }
    } catch (err) {
        console.error(err);
        quit(1);
    }
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', stopBackend);
process.on('exit', stopBackend);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => quit(130));
