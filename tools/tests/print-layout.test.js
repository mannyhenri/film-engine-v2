// Every printed document laid out by Chromium (tools/print-layout-check.cjs, run in Electron):
// the storyboard for every paper × boards-per-page × frame aspect, and every sheet kind full and empty.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');

test('every printed document fits its paper in a real browser', { skip: !fs.existsSync(electron) && 'Electron is not installed', timeout: 300000 }, () => {
    let out;
    try { out = execFileSync(electron, [path.join(ROOT, 'tools', 'print-layout-check.cjs')], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 280000 }); }
    catch (err) { out = err.stdout || ''; if (!out.trim()) throw err; }
    const report = JSON.parse(out.trim().split('\n').pop());
    const { PAPERS, LAYOUTS } = require(path.join(ROOT, 'backend/lib/storyboard-print.js'));
    const kinds = fs.readFileSync(path.join(ROOT, 'src/lib/print-sheet.js'), 'utf8').match(/SHEET_KINDS = Object\.freeze\(\[([^\]]+)\]/)[1].split(',').length;
    // 7 frame aspects per storyboard layout; each sheet kind full and empty on two papers.
    assert.equal(report.checked, Object.keys(PAPERS).length * Object.keys(LAYOUTS).length * 7 + kinds * 2 * 2, 'every document was laid out');
    assert.deepStrictEqual(report.failures, []);
});
