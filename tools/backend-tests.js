#!/usr/bin/env node
/*
 * The backend suite, one file per process, 3 at a time (the ffmpeg tests time
 * out under heavier parallel load). Sub-tests listed in
 * backend/tests/SKIPPED-SUBTESTS.json are skipped by exact name in their own
 * file only, each with its reason; everything else runs. Exit 1 on any failure
 * or if no test file is found.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(__dirname, '..', 'backend');
// One log folder per checkout: two worktrees running this at once must not wipe each other's logs
// (each run deletes its folder at start and reads its own logs back as files finish).
const OUT = path.join(os.tmpdir(), 'fe-backend-tests-' + require('crypto').createHash('sha1').update(path.resolve(DIR)).digest('hex').slice(0, 8));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const skips = JSON.parse(fs.readFileSync(path.join(DIR, 'tests', 'SKIPPED-SUBTESTS.json'), 'utf8')).files;
const only = process.argv.slice(2);
const files = fs.readdirSync(path.join(DIR, 'tests')).filter(f => f.endsWith('.test.js') && (!only.length || only.includes(f))).sort();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function run(f) {
    return new Promise((resolve) => {
        const args = ['--test', ...(skips[f] || []).flatMap(s => ['--test-skip-pattern', `^${esc(s.name)}$`]), path.join('tests', f)];
        const log = fs.createWriteStream(path.join(OUT, f + '.log'));
        const p = spawn(process.execPath, args, { cwd: DIR });
        p.stdout.pipe(log); p.stderr.pipe(log);
        // Counted from the log once the log stream has FINISHED: the process can close before its last lines (the
        // "ℹ pass N" summary) are flushed to the file, and a file read then counted 0 (a summary of 4716 where the
        // logs held 4730).
        p.on('close', (code) => {
            log.end(() => {
                const text = fs.readFileSync(path.join(OUT, f + '.log'), 'utf8');
                // "ℹ pass N" on a terminal, "# pass N" when the output is piped (TAP).
                const n = (k) => +((text.match(new RegExp(`^(?:ℹ|#) ${k} (\\d+)`, 'm')) || [0, 0])[1]);
                resolve({ f, ok: code === 0, pass: n('pass'), fail: n('fail'), skipped: (skips[f] || []).length });
            });
        });
    });
}

(async () => {
    if (!files.length) { console.error('backend: no test files found'); process.exit(1); }
    const results = [];
    const queue = [...files];
    await Promise.all([0, 1, 2].map(async () => {
        while (queue.length) {
            const r = await run(queue.shift());
            results.push(r);
            console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.f}  (${r.pass} pass${r.fail ? `, ${r.fail} fail` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''})`);
        }
    }));
    const failed = results.filter(r => !r.ok);
    const sum = (k) => results.reduce((a, r) => a + r[k], 0);
    console.log(`backend: ${results.length - failed.length}/${results.length} test files pass; ${sum('pass')} sub-tests pass, ${sum('fail')} fail, ${sum('skipped')} skipped (listed in SKIPPED-SUBTESTS.json); logs in ${OUT}`);
    process.exit(failed.length ? 1 : 0);
})();
