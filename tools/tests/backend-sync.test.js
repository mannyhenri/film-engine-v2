// backend/ is film-engine's backend at the pinned commit: every file identical,
// or removed with a reason (REMOVED-TESTS.txt), or a declared local change.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const plan = require('../port-plan.json');
const REPO = path.join(ROOT, plan.sourceRepo);
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { maxBuffer: 1 << 30 });
let available = false;
try { git('cat-file', '-e', plan.sourceCommit); available = true; } catch { /* no source repo here */ }

test('the pinned source page is what the port is generated from', () => {
    const vendored = fs.readFileSync(path.join(ROOT, plan.source));
    if (!available) return; // checked on machines that have film-engine; the vendored copy is the input either way
    assert.ok(vendored.equals(git('show', `${plan.sourceCommit}:src/index.html`)), `${plan.source} is not film-engine's src/index.html at ${plan.sourceCommit}`);
});

test('backend/ matches film-engine backend/ at the pinned commit, file by file', { skip: !available && `${plan.sourceRepo} with ${plan.sourceCommit.slice(0, 7)} is not here` }, () => {
    const theirs = git('ls-tree', '-r', '--name-only', plan.sourceCommit, 'backend').toString().trim().split('\n');
    const removed = new Set(fs.readFileSync(path.join(ROOT, 'backend/tests/REMOVED-TESTS.txt'), 'utf8').split('\n').map(l => l.split(/\s/)[0]).filter(l => l.endsWith('.js')).map(f => 'backend/tests/' + f));
    const local = plan.backendLocalChanges;
    const bad = [];
    for (const f of theirs) {
        const mine = path.join(ROOT, f);
        if (removed.has(f)) { if (fs.existsSync(mine)) bad.push(`${f}: listed as removed but present`); continue; }
        if (!fs.existsSync(mine)) { bad.push(`${f}: missing and not listed in REMOVED-TESTS.txt`); continue; }
        const same = fs.readFileSync(mine).equals(git('show', `${plan.sourceCommit}:${f}`));
        if (!same && !local[f]) bad.push(`${f}: differs and is not a declared local change`);
        if (same && local[f]) bad.push(`${f}: declared as changed but identical`);
    }
    for (const f of Object.keys(local)) if (!theirs.includes(f) && !fs.existsSync(path.join(ROOT, f))) bad.push(`${f}: declared but absent`);
    // Every tracked file in this backend/ is theirs, or declared.
    const ours = execFileSync('git', ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard', 'backend'], { maxBuffer: 1 << 30 }).toString().trim().split('\n');
    for (const f of ours) if (!theirs.includes(f) && !local[f]) bad.push(`${f}: in this backend only, not declared`);
    for (const f of removed) if (!theirs.includes(f)) bad.push(`${f}: listed as removed but film-engine never had it`);
    assert.deepStrictEqual(bad, []);
});

// Everything copied from film-engine outside backend/ (the pinned page, docs the tests read,
// design specs, vendored files, a script): plan.copiedFromSource maps each v2 path to its path in
// film-engine, and each must equal film-engine at the pinned commit. Every file under the folders
// that hold copies is either listed there or named in plan.v2OwnFiles, so a stale copy and a new
// v2 file cannot hide each other.
const COPY_DIRS = ['reference', 'docs/plans', 'docs/adr', 'scripts', 'src/vendor', 'src/assets', 'design_handoff_character_card', 'design_handoff_world_engine_previz'];
const COPY_FILES = ['docs/claude-desktop-guide.md'];

test('every file copied from film-engine outside backend/ matches it at the pinned commit', () => {
    const copied = plan.copiedFromSource || {};
    assert.ok(Object.keys(copied).length, 'tools/port-plan.json has no copiedFromSource map');
    const own = new Set(plan.v2OwnFiles || []);
    const walk = (d) => fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d), { recursive: true, withFileTypes: true })
        .filter(e => e.isFile() && e.name !== '.DS_Store').map(e => path.relative(ROOT, path.join(e.parentPath || e.path, e.name))) : [];
    const present = [...COPY_DIRS.flatMap(walk), ...COPY_FILES.filter(f => fs.existsSync(path.join(ROOT, f)))];
    const bad = [];
    for (const f of present) if (!copied[f] && !own.has(f)) bad.push(`${f}: neither in copiedFromSource nor v2OwnFiles`);
    for (const f of own) if (copied[f]) bad.push(`${f}: listed as both copied and v2-only`);
    for (const [mine, theirs] of Object.entries(copied)) {
        if (!fs.existsSync(path.join(ROOT, mine))) { bad.push(`${mine}: listed but absent`); continue; }
        if (!available) continue;
        let source;
        try { source = git('show', `${plan.sourceCommit}:${theirs}`); } catch { bad.push(`${mine}: film-engine has no ${theirs} at ${plan.sourceCommit.slice(0, 7)}`); continue; }
        if (!fs.readFileSync(path.join(ROOT, mine)).equals(source)) bad.push(`${mine}: differs from film-engine ${theirs} at ${plan.sourceCommit.slice(0, 7)}`);
    }
    if (available) for (const f of own) {
        try { git('cat-file', '-e', `${plan.sourceCommit}:${f}`); bad.push(`${f}: named v2-only but film-engine has it at that path`); } catch { /* truly v2-only */ }
    }
    assert.deepStrictEqual(bad, []);
});
