/*
 * Electron main. Starts the existing backend (backend/server.js, the same API
 * on :3100 and the same data folder) unless one already answers, then opens the
 * window: the vite dev server when FE_DEV_URL is set, else the built dist/.
 *
 *   --smoke   visit every page and exit 1 on any console error (CI / round checks)
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const API = process.env.FE_API_BASE || 'http://localhost:3100';
const SMOKE = process.argv.includes('--smoke');
let backend = null;

function health() {
    return new Promise((resolve) => {
        const req = http.get(API + '/api/health', (res) => { res.resume(); resolve(res.statusCode === 200); });
        req.on('error', () => resolve(false));
        req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    });
}

async function ensureBackend() {
    if (await health()) return 'reused';
    // System node, not Electron's: better-sqlite3 stays built for it, no electron-rebuild.
    backend = spawn(process.env.FE_NODE || 'node', ['server.js'], {
        cwd: path.join(__dirname, '..', 'backend'),
        env: { ...process.env, PORT: String(new URL(API).port || 3100) },
        stdio: ['ignore', 'inherit', 'inherit'],
    });
    backend.on('exit', (code) => { if (code) console.error(`[backend] exited ${code}`); backend = null; });
    for (let i = 0; i < 60; i++) {
        if (await health()) return 'started';
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('backend did not come up on ' + API);
}

async function createWindow() {
    const win = new BrowserWindow({
        width: 1440, height: 900, show: !SMOKE,
        title: 'Film Engine',
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
    });
    if (process.env.FE_SMOKE_URL) await win.loadURL(process.env.FE_SMOKE_URL); // e.g. the original one-file app, for a parity run
    else if (process.env.FE_DEV_URL) await win.loadURL(process.env.FE_DEV_URL);
    else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    return win;
}

async function smoke(win) {
    const { PAGES, CHUNKED } = require('./smoke-pages.cjs');
    const errors = [];
    win.webContents.on('console-message', (_e, level, message, line, source) => {
        if (level >= 3) errors.push({ page: current, message, at: `${path.basename(source || '')}:${line}` });
    });
    win.webContents.on('render-process-gone', (_e, d) => { errors.push({ page: current, message: 'renderer gone: ' + d.reason }); });
    let current = 'boot';
    const js = (code) => win.webContents.executeJavaScript(code, true);
    await new Promise(r => setTimeout(r, 2500));
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
        const state = await js(`({ active: document.querySelector('.page.active')?.id, chunk: !!(window.__fePages && window.__fePages.loaded().includes(${JSON.stringify(id)})),
            shape: (() => { const el = document.getElementById('page-' + ${JSON.stringify(id)}); return el ? { elements: el.querySelectorAll('*').length, text: el.innerText.replace(/\\s+/g, ' ').trim().length } : null; })() })`);
        shapes[id] = state.shape;
        const ok = state.active === 'page-' + id && errors.length === before;
        report.push({ id, ok, chunk: state.chunk, active: state.active });
    }
    // Cold start on a deep link to a chunked page: the chunk must load before its loader runs.
    const deep = PAGES.find(p => p !== 'projects' && p !== 'dashboard' && CHUNKED.includes(p));
    if (project && deep && !process.env.FE_SMOKE_URL) {
        current = 'deeplink:' + deep;
        const before = errors.length;
        const url = new URL(win.webContents.getURL());
        url.hash = `#/${project}/${deep}`;
        await win.loadURL(url.href);
        await new Promise(r => setTimeout(r, 3500));
        const st = await js(`({ active: document.querySelector('.page.active')?.id, chunk: !!(window.__fePages && window.__fePages.loaded().includes(${JSON.stringify(deep)})) })`);
        report.push({ id: 'deeplink→' + deep, ok: st.active === 'page-' + deep && st.chunk && errors.length === before, chunk: st.chunk, active: st.active, want: 'page-' + deep });
    }
    if (process.env.FE_SMOKE_SHAPES) require('fs').writeFileSync(process.env.FE_SMOKE_SHAPES, JSON.stringify(shapes, null, 1));
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
        if (SMOKE) { const ok = await smoke(win); app.exit(ok ? 0 : 1); }
    } catch (err) {
        console.error(err);
        app.exit(1);
    }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (backend) backend.kill(); });
