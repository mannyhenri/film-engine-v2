/*
 * GRD-4659: the v2 reuse inventory (docs/v2-reuse-inventory.json) is evidence, not prose. Held as sets:
 * every audited area has an entry; every entry names code and tests that exist in this checkout and a status from
 * the closed set; every fixture the ticket names is either run (its tests exist) or recorded as an explicit gap;
 * every overlapping Jira ticket the epic names has a reuse decision; every child of the epic sits in the ordered
 * plan exactly once; and nothing promises a date, an estimate or a performance number.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'docs', 'v2-reuse-inventory.json');
const inv = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// From the ticket's requirements: the areas the audit must cover (now), and the later paths it inventories.
const AREAS = ['electron-ipc', 'react-panels', 'project-script-records', 'approvals', 'provider-adapters', 'jobs',
    'assets-provenance', 'mcp', 'writing-style', 'scene-readiness', 'blender-previz', 'render-export'];
const STATUSES = ['verified', 'missing', 'changed'];
// From the ticket's acceptance criteria.
const FIXTURES = ['reference', 'apply-lock', 'no_music', 'nonzero-export-start'];
// From the epic's "Existing work".
const OVERLAPPING = ['GRD-4566', 'GRD-4568', 'GRD-4571', 'GRD-4453', 'GRD-3598', 'GRD-1096', 'GRD-4600'];
const DECISIONS = ['reuse', 'integrate', 'lead-only', 'related'];
// The epic's 13 children.
const CHILDREN = Array.from({ length: 13 }, (_, i) => `GRD-${4659 + i}`);

test('the inventory exists and covers every audited area', () => {
    assert.ok(fs.existsSync(FILE), 'docs/v2-reuse-inventory.json is missing');
    const got = inv().capabilities.map(c => c.area);
    for (const a of AREAS) assert.ok(got.includes(a), `no entry for ${a}`);
});

test('every capability names real code, real tests and a status from the closed set', () => {
    const problems = [];
    for (const c of inv().capabilities) {
        if (!STATUSES.includes(c.status)) problems.push(`${c.area}: status ${c.status}`);
        if (!c.evidence || c.evidence.length < 20) problems.push(`${c.area}: no evidence`);
        if (c.status !== 'missing' && !(c.paths || []).length) problems.push(`${c.area}: ${c.status} but names no code`);
        for (const p of c.paths || []) if (!exists(p)) problems.push(`${c.area}: ${p} does not exist`);
        for (const t of c.tests || []) if (!exists(t)) problems.push(`${c.area}: test ${t} does not exist`);
        if (c.status === 'verified' && !(c.tests || []).length) problems.push(`${c.area}: verified without a test`);
    }
    assert.deepEqual(problems, []);
});

test('every named fixture is run (its tests exist) or kept as an explicit v2 gap', () => {
    const fx = inv().fixtures;
    const problems = [];
    for (const name of FIXTURES) {
        const f = fx.find(x => x.name === name);
        if (!f) { problems.push(`${name}: not recorded`); continue; }
        if (!['verified', 'gap'].includes(f.status)) problems.push(`${name}: status ${f.status}`);
        if (f.status === 'verified' && !(f.tests || []).length) problems.push(`${name}: verified without a test`);
        if (f.status === 'gap' && !(f.gap || '').length) problems.push(`${name}: a gap must say what is missing`);
        for (const t of f.tests || []) if (!exists(t)) problems.push(`${name}: ${t} does not exist`);
    }
    assert.deepEqual(problems, []);
});

test('every overlapping Jira ticket has a reuse decision and a reason', () => {
    const t = inv().tickets;
    const problems = [];
    for (const key of OVERLAPPING) {
        const d = t.find(x => x.key === key);
        if (!d) problems.push(`${key}: no decision`);
        else if (!DECISIONS.includes(d.decision) || !(d.reason || '').length) problems.push(`${key}: ${d.decision} without a reason`);
    }
    assert.deepEqual(problems, []);
});

test('the ordered plan places every child of the epic exactly once, and its dependencies come first', () => {
    const plan = inv().plan;
    const keys = plan.map(p => p.key);
    for (const k of CHILDREN) assert.equal(keys.filter(x => x === k).length, 1, `${k} appears ${keys.filter(x => x === k).length} times`);
    for (const [i, p] of plan.entries()) for (const d of p.after || []) {
        assert.ok(keys.indexOf(d) > -1 && keys.indexOf(d) < i, `${p.key} is placed before its dependency ${d}`);
    }
});

test('no dates, estimates or performance promises', () => {
    const text = fs.readFileSync(FILE, 'utf8');
    for (const k of ['"due"', '"estimate"', '"eta"', '"deadline"', '"story_points"']) assert.ok(!text.includes(k), `inventory carries ${k}`);
    assert.ok(!/\b\d+\s*(ms|fps|seconds|minutes|hours|days|weeks)\b/i.test(text), 'inventory promises a time or speed');
});
