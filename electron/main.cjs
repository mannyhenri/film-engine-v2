/*
 * Electron main. Starts the existing backend (backend/server.js, the same API
 * on :3100 and the same data folder) unless one already answers, then opens the
 * window: the vite dev server when FE_DEV_URL is set, else the built dist/.
 *
 *   --smoke   visit every page and exit 1 on any console error (CI / round checks)
 */
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');

const SMOKE = process.argv.includes('--smoke');
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
        env: { ...process.env, PORT: String(new URL(API).port || 3100) },
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

async function createWindow() {
    const win = new BrowserWindow({
        width: 1440, height: 900, show: !SMOKE,
        title: 'Film Engine',
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
    const { PAGES: ALL, CHUNKED } = require('./smoke-pages.cjs');
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
        const ok = state.active === 'page-' + id && errors.length === before;
        report.push({ id, ok, chunk: state.chunk, active: state.active });
    }
    // Cold starts on deep links to chunked pages: the chunk (and its libraries) must load before its loader runs.
    const deeps = [PAGES.find(p => p !== 'projects' && p !== 'dashboard' && CHUNKED.includes(p)), CHUNKED.includes('previs') && 'previs'].filter(Boolean);
    for (const deep of (project && !process.env.FE_SMOKE_URL && !process.env.FE_SMOKE_PAGES) ? deeps : []) {
        current = 'deeplink:' + deep;
        const before = errors.length;
        const url = new URL(win.webContents.getURL());
        url.hash = `#/${project}/${deep}`;
        await win.loadURL(url.href);
        // Poll, so a slow machine fails on a real problem rather than on a fixed wait.
        for (let t = 0; t < 40; t++) {
            if (await js(`!!(window.__fePages && window.__fePages.loaded().includes(${JSON.stringify(deep)}))`).catch(() => false)) break;
            await new Promise(r => setTimeout(r, 250));
        }
        await new Promise(r => setTimeout(r, 1000)); // let its loader paint
        const st = await js(`({ active: document.querySelector('.page.active')?.id, chunk: !!(window.__fePages && window.__fePages.loaded().includes(${JSON.stringify(deep)})), three: typeof THREE !== 'undefined' })`);
        const ok = st.active === 'page-' + deep && st.chunk && errors.length === before && (deep !== 'previs' || st.three);
        report.push({ id: 'deeplink→' + deep, ok, chunk: st.chunk, active: st.active, want: 'page-' + deep });
    }
    if (process.env.FE_SMOKE_SHAPES) require('fs').writeFileSync(process.env.FE_SMOKE_SHAPES, JSON.stringify(shapes, null, 1));
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
    for (const r of report) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(16)} ${r.chunk ? 'chunk loaded' : 'core only'}${r.active === (r.want || 'page-' + r.id) ? '' : '  active=' + r.active}`);
    for (const e of errors) console.log(`  console error [${e.page}] ${e.message} ${e.at || ''}`);
    console.log(`smoke: ${report.filter(r => r.ok).length}/${report.length} pages clean, ${errors.length} console errors, project=${project || 'none'}`);
    return errors.length === 0 && report.every(r => r.ok);
}

app.whenReady().then(async () => {
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
