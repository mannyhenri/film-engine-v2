/**
 * GRD-4670: the v2 release gates and their retained evidence. Set-based over the AT01–AT12 registry,
 * the release tracks, the evidence kinds and the retained artifacts lib/release-evidence.js declares:
 * for every track, every required AT is knocked out in turn (missing, stale, failing, screenshot-only,
 * requalification) and the gate must fail; it passes only with all of them for one version set.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-release-'));
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
const re = require('../lib/release-evidence');

const HEX = c => c.repeat(64);
const VERSIONS = {
    writing: { build: 'be78174', model: 'claude-opus-5-5', fixtures: HEX('a') },
    blender: { build: 'be78174', adapter: 'blender-4.2.3+board-gen-2', fixtures: HEX('b') },
    stereo: { build: 'be78174', adapter: 'flat_sbs', fixtures: HEX('c'), device_profile: 'Meta Quest 3 / Skybox 1.4.9' },
};
const other = (track) => ({ ...VERSIONS[track], build: 'deadbee' });
const clear = () => { for (const t of ['film_release_evidence', 'film_release_artifacts', 'film_releases']) db.prepare(`DELETE FROM ${t}`).run(); };

function passEvidence(track, at, versions = VERSIONS[track], over = {}) {
    const human = re.ACCEPTANCE_TESTS[at].human;
    const body = { at, kind: human ? 'human' : 'automated', result: 'pass', versions, report: `${at} report`, ...over };
    if (human) body.reviewer = 'Manny';
    if (at === 'AT06' && !over.verdict) body.verdict = { decision: 'release', basis: 'direct_instruction', reviewer: 'Manny', note: 'GRD-4664 marked Done on Manny\'s instruction, 5 Oct 2026' };
    return re.recordEvidence(db, track, body);
}
function fullTrack(track, versions = VERSIONS[track], skip = {}) {
    for (const at of re.TRACKS[track].required) if (at !== skip.at) passEvidence(track, at, versions);
    for (const kind of re.TRACKS[track].artifacts) if (kind !== skip.artifact) re.recordArtifact(db, track, { kind, versions, ref: `docs/${kind}.md` });
}

test('the registry is AT01–AT12 from the scope, each in at least one track', () => {
    const ids = Object.keys(re.ACCEPTANCE_TESTS);
    assert.deepEqual(ids, Array.from({ length: 12 }, (_, i) => `AT${String(i + 1).padStart(2, '0')}`));
    for (const [id, t] of Object.entries(re.ACCEPTANCE_TESTS)) {
        assert.ok(t.links.length >= 1 && t.links.every(l => /^(ST|WR|PL|BL)\d{2}$/.test(l)), `${id} links`);
        assert.ok(t.scenario.length > 20, `${id} scenario`);
        assert.ok(Object.values(re.TRACKS).some(tr => tr.required.includes(id)), `${id} is in no track`);
    }
    assert.deepEqual(re.ACCEPTANCE_TESTS.AT01.links, ['ST01', 'ST09', 'PL10']);
    assert.deepEqual(re.ACCEPTANCE_TESTS.AT11.links, ['WR01', 'PL04']);
});

test('each track requires exactly the scope\'s tests and version fields', () => {
    assert.deepEqual(Object.keys(re.TRACKS), ['writing', 'blender', 'stereo']);
    assert.deepEqual(re.TRACKS.writing.required, ['AT05', 'AT06', 'AT07', 'AT10', 'AT11']);
    assert.deepEqual(re.TRACKS.blender.required, ['AT08', 'AT09', 'AT10', 'AT12']);
    assert.deepEqual(re.TRACKS.stereo.required, ['AT01', 'AT02', 'AT03', 'AT04', 'AT12']);
    assert.ok(re.TRACKS.stereo.versionFields.includes('device_profile'));
    for (const t of Object.values(re.TRACKS)) assert.ok(t.versionFields.includes('build') && t.versionFields.includes('fixtures'));
    assert.ok(re.ACCEPTANCE_TESTS.AT06.human, 'the author verdict is a person\'s');
    assert.deepEqual([...re.ARTIFACTS], ['endpoint_inventory', 'fixture_manifest', 'automated_report', 'author_evaluation', 'drift_comparisons', 'stereo_device_review', 'dependency_license_checklist', 'known_limitations']);
    for (const a of re.ARTIFACTS) assert.ok(Object.values(re.TRACKS).some(t => t.artifacts.includes(a)), `${a} is retained by no track`);
});

for (const track of Object.keys(re.TRACKS)) {
    test(`${track}: passes only with every required test and artifact for one version set`, () => {
        clear(); fullTrack(track);
        const g = re.gate(db, track, VERSIONS[track]);
        assert.equal(g.passed, true, JSON.stringify(g.tests.filter(t => t.status !== 'passed')));
        assert.deepEqual(g.tests.map(t => t.at), re.TRACKS[track].required);
        assert.ok(g.tests.every(t => t.status === 'passed' && t.evidence_id));
        assert.equal(g.versions.build, 'be78174');
        assert.equal(g.artifacts.missing.length, 0);
    });

    for (const at of re.TRACKS[track].required) {
        test(`${track} / ${at}: missing, stale, failing, screenshot-only and requalified evidence each fail the gate`, () => {
            clear(); fullTrack(track, VERSIONS[track], { at });
            let g = re.gate(db, track, VERSIONS[track]);
            assert.equal(g.passed, false); assert.equal(g.tests.find(t => t.at === at).status, 'missing');

            passEvidence(track, at, other(track));                       // evidence for another build never carries over
            g = re.gate(db, track, VERSIONS[track]);
            assert.equal(g.passed, false); assert.equal(g.tests.find(t => t.at === at).status, 'stale');
            assert.match(g.tests.find(t => t.at === at).note, /deadbee|other version/);

            passEvidence(track, at, VERSIONS[track], { result: 'fail', ...(at === 'AT06' ? { verdict: { decision: 'hold', basis: 'direct_instruction', reviewer: 'Manny' } } : {}) });
            g = re.gate(db, track, VERSIONS[track]);
            assert.equal(g.passed, false); assert.equal(g.tests.find(t => t.at === at).status, 'failing');
            assert.ok(g.failures.some(f => f.at === at), 'a failure is visible in the report');

            clear(); fullTrack(track, VERSIONS[track], { at });
            re.recordEvidence(db, track, { at, kind: 'screenshot', result: 'pass', versions: VERSIONS[track], report: 'demo.png' });
            g = re.gate(db, track, VERSIONS[track]);
            assert.equal(g.passed, false, 'a demo screenshot alone never satisfies a gate');

            if (re.ACCEPTANCE_TESTS[at].human) {
                re.recordEvidence(db, track, { at, kind: 'automated', result: 'pass', versions: VERSIONS[track], report: 'auto' });
                assert.equal(re.gate(db, track, VERSIONS[track]).passed, false, `${at} needs a person's evidence, not only automation`);
            }

            clear(); fullTrack(track);
            const field = re.TRACKS[track].versionFields.find(f => f === 'model' || f === 'adapter');
            const changed = re.requalify(db, track, { field, from: VERSIONS[track][field], to: 'next-version', reason: 'provider changed the model' });
            assert.ok(changed.flagged >= re.TRACKS[track].required.length);
            g = re.gate(db, track, VERSIONS[track]);
            assert.equal(g.passed, false); assert.equal(g.tests.find(t => t.at === at).status, 'requalify');
        });
    }

    for (const kind of re.TRACKS[track].artifacts) {
        test(`${track}: a missing ${kind} artifact fails the gate and is named`, () => {
            clear(); fullTrack(track, VERSIONS[track], { artifact: kind });
            const g = re.gate(db, track, VERSIONS[track]);
            assert.equal(g.passed, false); assert.deepEqual(g.artifacts.missing, [kind]);
        });
    }
}

test('writing is independent of stereo: an empty stereo track never holds writing', () => {
    clear(); fullTrack('writing');
    assert.equal(re.gate(db, 'stereo', VERSIONS.stereo).passed, false);
    assert.equal(re.gate(db, 'writing', VERSIONS.writing).passed, true);
});

test('the author verdict shows its basis honestly', () => {
    clear(); fullTrack('writing');
    const g = re.gate(db, 'writing', VERSIONS.writing);
    assert.equal(g.author_verdict.decision, 'release');
    assert.equal(g.author_verdict.basis, 'direct_instruction');
    assert.equal(g.author_verdict.reviewer, 'Manny');
    assert.match(g.author_verdict.basis_label, /not a pilot report/i);
    assert.throws(() => passEvidence('writing', 'AT06', VERSIONS.writing, { verdict: { decision: 'release', basis: 'pilot_report', reviewer: 'Manny' } }), /pilot_id/);
    assert.throws(() => passEvidence('writing', 'AT06', VERSIONS.writing, { verdict: { decision: 'release', basis: 'gut_feel', reviewer: 'Manny' } }), /basis/);
    assert.throws(() => passEvidence('writing', 'AT06', VERSIONS.writing, { result: 'pass', verdict: { decision: 'hold', basis: 'direct_instruction', reviewer: 'Manny' } }), /hold/);
});

test('known limitations are visible in the report', () => {
    clear(); fullTrack('writing');
    re.recordArtifact(db, 'writing', { kind: 'known_limitations', versions: VERSIONS.writing, ref: 'No in-app blinded pilot has run; verdict by direct instruction.' });
    const g = re.gate(db, 'writing', VERSIONS.writing);
    assert.ok(g.known_limitations.some(l => /blinded pilot/.test(l)));
});

test('a release is recorded only on a passing gate, by a person, and never covers another version', () => {
    clear();
    assert.throws(() => re.release(db, 'writing', { versions: VERSIONS.writing, by: 'Manny', human_confirmed: true }), e => e.status === 409);
    fullTrack('writing');
    assert.throws(() => re.release(db, 'writing', { versions: VERSIONS.writing, by: 'Manny' }), e => e.status === 400);
    const r = re.release(db, 'writing', { versions: VERSIONS.writing, by: 'Manny', human_confirmed: true });
    assert.equal(r.track, 'writing'); assert.equal(r.report.passed, true);
    assert.equal(re.gate(db, 'writing', other('writing')).released, null, 'another version does not inherit the release');
    assert.equal(re.gate(db, 'writing', VERSIONS.writing).released.by, 'Manny');
});

test('invalid input is refused', () => {
    const bad = (fn, status) => assert.throws(fn, e => e.status === status, String(fn));
    bad(() => re.gate(db, 'audio', VERSIONS.writing), 404);
    bad(() => re.recordEvidence(db, 'opera', { at: 'AT05' }), 404);
    bad(() => re.recordEvidence(db, 'writing', { at: 'AT01', kind: 'automated', result: 'pass', versions: VERSIONS.writing, report: 'x' }), 400);   // not a writing test
    bad(() => re.recordEvidence(db, 'writing', { at: 'AT99', kind: 'automated', result: 'pass', versions: VERSIONS.writing, report: 'x' }), 400);
    bad(() => re.recordEvidence(db, 'writing', { at: 'AT05', kind: 'vibes', result: 'pass', versions: VERSIONS.writing, report: 'x' }), 400);
    bad(() => re.recordEvidence(db, 'writing', { at: 'AT05', kind: 'automated', result: 'maybe', versions: VERSIONS.writing, report: 'x' }), 400);
    bad(() => re.recordEvidence(db, 'writing', { at: 'AT05', kind: 'automated', result: 'pass', report: 'x' }), 400);
    for (const f of re.TRACKS.stereo.versionFields) {
        const v = { ...VERSIONS.stereo }; delete v[f];
        bad(() => re.recordEvidence(db, 'stereo', { at: 'AT01', kind: 'automated', result: 'pass', versions: v, report: 'x' }), 400);
    }
    bad(() => re.recordEvidence(db, 'writing', { at: 'AT05', kind: 'automated', result: 'pass', versions: { ...VERSIONS.writing, build: 'main' }, report: 'x' }), 400);
    bad(() => re.recordEvidence(db, 'writing', { at: 'AT05', kind: 'automated', result: 'pass', versions: { ...VERSIONS.writing, fixtures: 'v1' }, report: 'x' }), 400);
    bad(() => re.recordEvidence(db, 'writing', { at: 'AT05', kind: 'human', result: 'pass', versions: VERSIONS.writing, report: 'x' }), 400);    // no reviewer
    bad(() => re.recordEvidence(db, 'writing', { at: 'AT06', kind: 'human', reviewer: 'Manny', result: 'pass', versions: VERSIONS.writing, report: 'x' }), 400); // no verdict
    bad(() => re.recordArtifact(db, 'writing', { kind: 'stereo_device_review', versions: VERSIONS.writing, ref: 'x' }), 400);
    bad(() => re.gate(db, 'writing', { build: 'be78174' }), 400);
    bad(() => re.requalify(db, 'writing', { field: 'build', from: 'a', to: 'b', reason: 'x' }), 400);
});

test('the release-evidence document covers every test, track and procedure, with the honest status', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'release-evidence.md'), 'utf8');
    for (const id of Object.keys(re.ACCEPTANCE_TESTS)) assert.ok(doc.includes(id), id);
    for (const a of re.ARTIFACTS) assert.ok(doc.includes(a), a);
    for (const h of ['Supported workflows', 'Failure recovery', 'Approvals', 'Privacy and retention', 'Provenance', 'Fallbacks', 'Support', 'Current status']) assert.ok(doc.includes(h), h);
    assert.match(doc, /direct instruction/i); assert.match(doc, /GRD-4667/); assert.match(doc, /GRD-4669/);
});

test('over HTTP: evidence, report, and a release refused for an agent', async () => {
    clear();
    const { handleReleaseGates } = require('../routes/release-gates');
    const call = (method, url, body, extra = {}) => new Promise(resolve => { let status; const res = { writeHead(c) { status = c; }, end(s) { resolve({ status, body: JSON.parse(s) }); } };
        handleReleaseGates({ method, body, headers: {}, ...extra }, res, url.split('/').filter(Boolean)); });
    const reg = await call('GET', '/film/release-gates/registry');
    assert.equal(reg.status, 200); assert.equal(Object.keys(reg.body.tests).length, 12);
    const ev = await call('POST', '/film/release-gates/writing/evidence', { at: 'AT05', kind: 'automated', result: 'pass', versions: VERSIONS.writing, report: 'x' });
    assert.equal(ev.status, 201, JSON.stringify(ev.body));
    const bad = await call('POST', '/film/release-gates/writing/evidence', { at: 'AT05', kind: 'automated', result: 'pass', report: 'x' });
    assert.equal(bad.status, 400);
    assert.equal((await call('POST', '/film/release-gates/nope/report', { versions: VERSIONS.writing })).status, 404);
    const rep = await call('POST', '/film/release-gates/writing/report', { versions: VERSIONS.writing });
    assert.equal(rep.status, 200); assert.equal(rep.body.passed, false);
    fullTrack('writing');
    const agent = await call('POST', '/film/release-gates/writing/release', { versions: VERSIONS.writing, by: 'agent', human_confirmed: true }, { actor: 'agent' });
    assert.equal(agent.status, 403);
    const person = await call('POST', '/film/release-gates/writing/release', { versions: VERSIONS.writing, by: 'Manny', human_confirmed: true });
    assert.equal(person.status, 201, JSON.stringify(person.body));
});
