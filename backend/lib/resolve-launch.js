'use strict';
/**
 * OPEN DAVINCI RESOLVE WITH THE FIRST EDIT ALREADY IN IT.
 *
 * The Resolve package (lib/resolve-export.js) has always carried its own
 * import script: it makes the project, a bin per folder, imports every file,
 * the timeline and the shot markers. The director still had to open Resolve
 * and run it from Workspace > Scripts. This does those two steps: it opens the
 * app, then runs the same script from outside, retrying while Resolve starts,
 * until Resolve's scripting answers.
 *
 * Running a script from outside Resolve needs Resolve's external scripting:
 * Preferences > System > General > "External scripting using: Local". When
 * that is off, or the app is not installed, nothing is lost: the package is
 * already written, and the answer says why it stopped and where it is.
 *
 * `run` is injectable so the tests never launch anything.
 */
const path = require('path');
const { spawn } = require('child_process');

const APP = { darwin: ['open', ['-a', 'DaVinci Resolve']], win32: ['cmd', ['/c', 'start', '', 'Resolve']], linux: ['/opt/resolve/bin/resolve', []] };
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

function defaultRun(cmd, args, opts = {}) {
    return new Promise(resolve => {
        let out = '';
        let child;
        try { child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) }, detached: !!opts.detached }); }
        catch (err) { return resolve({ code: 127, out: err.message }); }
        child.stdout && child.stdout.on('data', d => { out += d; });
        child.stderr && child.stderr.on('data', d => { out += d; });
        child.on('error', err => resolve({ code: 127, out: out + err.message }));
        if (opts.detached) { child.unref(); return resolve({ code: 0, out: '' }); }
        const timer = setTimeout(() => { try { child.kill(); } catch (_) {} resolve({ code: 124, out: out + ' (timed out)' }); }, opts.timeoutMs || 120000);
        child.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @returns {Promise<{imported:boolean, attempts:number, reason?:string, log:string[]}>}
 */
async function launchResolve(dest, opts = {}) {
    const platform = opts.platform || process.platform;
    const run = opts.run || defaultRun;
    const attempts = opts.attempts || 12;
    const waitMs = opts.waitMs === undefined ? 5000 : opts.waitMs;
    const log = [];
    // FILM_RESOLVE_LAUNCH=0: write the package only (CI, a machine without Resolve, a test server beside a real one).
    if (process.env.FILM_RESOLVE_LAUNCH === '0' && !opts.run) return { imported: false, attempts: 0, log, reason: 'Opening Resolve is turned off on this server (FILM_RESOLVE_LAUNCH=0).' };
    const app = APP[platform];
    if (!app) return { imported: false, attempts: 0, reason: `Opening Resolve is not supported on ${platform}`, log };
    const opened = await run(app[0], app[1], { detached: platform === 'linux' });
    log.push(`${app[0]} ${app[1].join(' ')} → ${opened.code}`);
    if (opened.code !== 0) {
        return { imported: false, attempts: 0, log,
            reason: `Could not open DaVinci Resolve (it may not be installed): ${String(opened.out || '').trim().slice(0, 200)}` };
    }
    /*
     * Free Resolve: nothing outside it can drive it, so don't spend a minute knocking. It is open (or brought to the
     * front); the import is one click in its Scripts menu (lib/resolve-lua.js installed it there).
     */
    if (opts.free) {
        return { imported: false, attempts: 0, log, needs_click: true, menu: opts.menu || 'Workspace › Scripts › Film Engine - Load Latest Cut',
            reason: `Resolve is open. Open any project (Untitled Project is fine), then ${opts.menu || 'Workspace › Scripts › Film Engine - Load Latest Cut'}: it makes a new project with this cut's timeline and media.` };
    }
    const script = path.join(dest, 'Import into Resolve.py');
    let last = '';
    for (let i = 1; i <= attempts; i++) {
        if (i > 1 || waitMs) await sleep(waitMs);
        const r = await run(PYTHON, [script], { cwd: dest, timeoutMs: 180000 });
        last = String(r.out || '').trim();
        log.push(`import attempt ${i} → ${r.code}`);
        if (r.code === 0) return { imported: true, attempts: i, log, output: last };
        if (r.code === 2) return { imported: false, attempts: i, log, reason: `Resolve opened but the timeline did not import: ${last.slice(-300)}` };
        if (r.code === 127) return { imported: false, attempts: i, log, reason: `Python 3 is needed to drive Resolve from Film Engine: ${last.slice(0, 200)}` };
    }
    return { imported: false, attempts, log,
        reason: 'Resolve did not answer its scripting connection. In Resolve: Preferences > System > General > External scripting using: Local (this needs DaVinci Resolve Studio), then send again, or run "Import into Resolve.py" from Workspace > Scripts.'
            + (last ? ` Last message: ${last.slice(-200)}` : '') };
}

module.exports = { launchResolve };
