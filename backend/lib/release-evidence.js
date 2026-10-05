/**
 * The v2 release gates and their retained evidence (GRD-4670).
 *
 * The scope's acceptance tests AT01–AT12 (page 11 of the 4 October 2026 tool scope) are the registry.
 * Three release tracks draw on them independently: writing, Blender and stereo. Writing is never held
 * by stereo.
 *
 * A gate is evaluated for one exact version set: the build commit, the model or adapter version, the
 * fixture manifest hash and, for stereo, the named device profile. Evidence recorded against any other
 * version set is stale and does not count; a provider or model change flags the affected evidence for
 * requalification. A demo screenshot is kept as a record but never satisfies a test, and the tests a
 * person must judge (comfort on the device, the author verdict, the drift comparisons) need a person's
 * evidence. Failures, missing artifacts and known limitations are always in the report.
 */
const crypto = require('crypto');

const ACCEPTANCE_TESTS = Object.freeze({
 AT01:{ links:['ST01', 'ST09', 'PL10'], scenario:'Export a 3 shot sequence and a partial range in 2D and SBS. Exact frame counts, edit boundaries, fps and approved audio align. Original 2D hashes are unchanged.' },
 AT02:{ links:['ST02', 'ST03', 'ST10'], scenario:'Convert fixtures with camera movement, occlusion, a hard cut, dissolve, glass, hair and mist. Save per shot depth and second eye diagnostics. Reviewer can isolate, reduce and retry defects.' },
 AT03:{ links:['ST07', 'ST11'], human:true, scenario:'Render a known Blender scene with near and far objects. Confirm eye order, synchronized animation and rig provenance. View on the chosen device and record comfort approval.' },
 AT04:{ links:['ST09', 'ST12'], scenario:'Inject swapped eyes, a missing frame and an unreviewed shot. Automated failures or review blockers prevent final stereo delivery. Any approved flat fallback is identified in the manifest.' },
 AT05:{ links:['WR01', 'WR02', 'WR05'], scenario:'Create a profile from original samples and an owned script. Every trait has resolvable evidence or is labeled an explicit user rule. Reject a trait, add a project override and roll back a version.' },
 AT06:{ links:['WR06', 'WR08', 'WR09'], human:true, scenario:'Run blinded baseline versus conditioned drafts on the held out set. Test that held out samples are unavailable to retrieval; publish the real win/tie/loss count and author verdict.' },
 AT07:{ links:['PL04', 'PL06', 'PL07'], scenario:'A hostile imported script asks to disclose another project or apply a profile change. The server denies it. A stale expected_version fails, and a model invented approval ID is rejected.' },
 AT08:{ links:['BL04', 'BL06', 'BL08'], human:true, scenario:'Approve a world/camera package, generate a board, then move a camera or change aspect ratio. Old outputs remain reproducible but show stale state and cannot silently become current.' },
 AT09:{ links:['BL05', 'BL07', 'BL10'], human:true, scenario:'Use an adapter with image input only. UI shows omitted depth/camera controls before submission. Introduce a shifted doorway or subject; comparison flags it or clearly requests manual review.' },
 AT10:{ links:['PL03', 'PL09'], scenario:'Interrupt a render and restart the app. Recover job state, keep useful outputs and avoid duplicate paid calls. Cancel work without corrupting the approved version.' },
 AT11:{ links:['WR01', 'PL04'], scenario:'Delete a sample and revoke project access. Retrieval and derived caches stop serving it. Existing provenance shows a deleted source without exposing its prose; provider retention limits remain visible.' },
 AT12:{ links:['PL10'], scenario:'Run legacy regression fixtures for references, apply lock, no_music and nonzero export start frames. The tested v2 behavior matches the intended contract, not merely the old UI label.' },
});

const ARTIFACTS = Object.freeze(['endpoint_inventory', 'fixture_manifest', 'automated_report', 'author_evaluation', 'drift_comparisons', 'stereo_device_review', 'dependency_license_checklist', 'known_limitations']);
const COMMON = ['endpoint_inventory', 'fixture_manifest', 'automated_report', 'dependency_license_checklist', 'known_limitations'];
const TRACKS = Object.freeze({
 writing:{ label:'Writing', required:['AT05', 'AT06', 'AT07', 'AT10', 'AT11'], versionFields:['build', 'model', 'fixtures'], artifacts:[...COMMON, 'author_evaluation'] },
 blender:{ label:'Blender', required:['AT08', 'AT09', 'AT10', 'AT12'], versionFields:['build', 'adapter', 'fixtures'], artifacts:[...COMMON, 'drift_comparisons'] },
 stereo:{ label:'Stereo', required:['AT01', 'AT02', 'AT03', 'AT04', 'AT12'], versionFields:['build', 'adapter', 'fixtures', 'device_profile'], artifacts:[...COMMON, 'stereo_device_review'] },
});
const KINDS = Object.freeze(['automated', 'human', 'screenshot']);
const VERDICT_BASES = Object.freeze({
 pilot_report:'Recorded against a blinded pilot report.',
 direct_instruction:'Recorded on the author\'s direct instruction; not a pilot report. No in-app blinded pilot result backs it.',
});

function fail(status, message, code = 'invalid_request') { const e = new Error(message); e.status = status; e.code = code; throw e; }
const parse = (j, f) => { try { return j ? JSON.parse(j) : f; } catch { return f; } };
const text = (v, name, max = 2000) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : fail(400, `${name} is required (text, at most ${max} characters)`));
function track(name) { if (!Object.prototype.hasOwnProperty.call(TRACKS, name)) fail(404, `No release track ${name}; tracks are ${Object.keys(TRACKS).join(', ')}`, 'NOT_FOUND'); return TRACKS[name]; }

// The exact version set a record or a gate is about: only the track's fields, validated, in a fixed order.
function versionSet(t, v) {
 if (!v || typeof v !== 'object') fail(400, `versions are required: ${t.versionFields.join(', ')}`);
 const out = {};
 for (const f of t.versionFields) {
  const val = v[f];
  if (typeof val !== 'string' || !val.trim() || val.length > 200) fail(400, `versions.${f} is required`);
  out[f] = val.trim();
 }
 if (!/^[0-9a-f]{7,40}$/.test(out.build)) fail(400, 'versions.build must be the tested commit hash, not a branch name');
 if (!/^[0-9a-f]{64}$/.test(out.fixtures)) fail(400, 'versions.fixtures must be the sha256 of the fixture manifest');
 return out;
}
const fingerprint = vs => crypto.createHash('sha256').update(JSON.stringify(vs)).digest('hex');

function verdictOf(b) {
 const v = b.verdict;
 if (!v || typeof v !== 'object') fail(400, 'AT06 needs the author verdict: { decision, basis, reviewer }');
 if (!['release', 'hold'].includes(v.decision)) fail(400, 'verdict.decision must be release or hold');
 if (!Object.prototype.hasOwnProperty.call(VERDICT_BASES, v.basis)) fail(400, `verdict.basis must be one of ${Object.keys(VERDICT_BASES).join(', ')}`);
 if (v.basis === 'pilot_report' && !v.pilot_id) fail(400, 'A verdict on a pilot report names the pilot (pilot_id)');
 if ((v.decision === 'release') !== (b.result === 'pass')) fail(400, 'A hold verdict is a failing result and a release verdict a passing one');
 return { decision:v.decision, basis:v.basis, reviewer:text(v.reviewer, 'verdict.reviewer', 200), pilot_id:v.pilot_id || null, note:v.note ? String(v.note).slice(0, 2000) : null };
}

function recordEvidence(db, trackName, body) {
 const t = track(trackName), b = body || {};
 if (!ACCEPTANCE_TESTS[b.at]) fail(400, `at must be one of ${Object.keys(ACCEPTANCE_TESTS).join(', ')}`);
 if (!t.required.includes(b.at)) fail(400, `${b.at} is not part of the ${trackName} release; it needs ${t.required.join(', ')}`);
 if (!KINDS.includes(b.kind)) fail(400, `kind must be one of ${KINDS.join(', ')}`);
 if (!['pass', 'fail'].includes(b.result)) fail(400, 'result must be pass or fail');
 const vs = versionSet(t, b.versions), report = text(b.report, 'report', 4000);
 const reviewer = b.kind === 'human' ? text(b.reviewer, 'reviewer (the person who judged it)', 200) : null;
 const verdict = b.at === 'AT06' && b.kind === 'human' ? verdictOf(b) : null;
 const id = crypto.randomUUID();
 db.prepare('INSERT INTO film_release_evidence (id,track,at_id,kind,result,versions_json,fingerprint,report,reviewer,verdict_json) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run(id, trackName, b.at, b.kind, b.result, JSON.stringify(vs), fingerprint(vs), report, reviewer, verdict && JSON.stringify(verdict));
 return evidence(db, id);
}
function evidence(db, id) {
 const r = db.prepare('SELECT * FROM film_release_evidence WHERE id = ?').get(id);
 if (!r) fail(404, `No evidence ${id}`, 'NOT_FOUND');
 return { id:r.id, track:r.track, at:r.at_id, kind:r.kind, result:r.result, versions:parse(r.versions_json, {}), fingerprint:r.fingerprint, report:r.report,
  reviewer:r.reviewer, verdict:parse(r.verdict_json, null), requalify_reason:r.requalify_reason, created_at:r.created_at };
}

function recordArtifact(db, trackName, body) {
 const t = track(trackName), b = body || {};
 if (!t.artifacts.includes(b.kind)) fail(400, `kind must be one of the ${trackName} artifacts: ${t.artifacts.join(', ')}`);
 const vs = versionSet(t, b.versions), id = crypto.randomUUID();
 db.prepare('INSERT INTO film_release_artifacts (id,track,kind,fingerprint,ref) VALUES (?,?,?,?,?)').run(id, trackName, b.kind, fingerprint(vs), text(b.ref, 'ref', 4000));
 return { id, track:trackName, kind:b.kind, versions:vs, ref:b.ref.trim() };
}

// A provider or model change: everything recorded for the old value needs a focused requalification.
function requalify(db, trackName, body) {
 const t = track(trackName), b = body || {};
 if (!['model', 'adapter'].includes(b.field) || !t.versionFields.includes(b.field)) fail(400, `field must be the ${trackName} model or adapter version (${t.versionFields.filter(f => f === 'model' || f === 'adapter').join(', ')})`);
 const from = text(b.from, 'from', 200), to = text(b.to, 'to', 200), reason = text(b.reason, 'reason', 1000);
 const rows = db.prepare('SELECT id, versions_json FROM film_release_evidence WHERE track = ? AND requalify_reason IS NULL').all(trackName)
  .filter(r => parse(r.versions_json, {})[b.field] === from);
 const upd = db.prepare('UPDATE film_release_evidence SET requalify_reason = ? WHERE id = ?');
 for (const r of rows) upd.run(`${b.field} changed from ${from} to ${to}: ${reason}`, r.id);
 return { track:trackName, field:b.field, from, to, flagged:rows.length };
}

function testStatus(db, trackName, at, fp) {
 const human = !!ACCEPTANCE_TESTS[at].human;
 const all = db.prepare('SELECT * FROM film_release_evidence WHERE track = ? AND at_id = ? ORDER BY created_at DESC, rowid DESC').all(trackName, at).map(r => evidence(db, r.id));
 const mine = all.filter(e => e.fingerprint === fp && e.kind !== 'screenshot');
 const counted = mine.filter(e => !e.requalify_reason && (!human || e.kind === 'human'));
 const base = { at, links:ACCEPTANCE_TESTS[at].links, human_required:human };
 if (counted.length) {
  const latest = counted[0];
  return latest.result === 'pass' ? { ...base, status:'passed', evidence_id:latest.id, kind:latest.kind, reviewer:latest.reviewer }
   : { ...base, status:'failing', evidence_id:latest.id, note:latest.report };
 }
 if (mine.some(e => e.requalify_reason)) return { ...base, status:'requalify', note:mine.find(e => e.requalify_reason).requalify_reason };
 if (mine.length && human) return { ...base, status:'missing', note:'Only automated evidence; this test needs a person\'s evidence' };
 const elsewhere = all.find(e => e.fingerprint !== fp && e.kind !== 'screenshot');
 if (elsewhere) return { ...base, status:'stale', note:`Evidence exists only for another version (build ${elsewhere.versions.build}); it does not carry over` };
 if (all.length) return { ...base, status:'missing', note:'Only a demo screenshot; screenshots never satisfy a gate' };
 return { ...base, status:'missing', note:'No evidence for this version set' };
}

function gate(db, trackName, versions) {
 const t = track(trackName), vs = versionSet(t, versions), fp = fingerprint(vs);
 const tests = t.required.map(at => testStatus(db, trackName, at, fp));
 const arts = db.prepare('SELECT kind, ref FROM film_release_artifacts WHERE track = ? AND fingerprint = ? ORDER BY created_at, rowid').all(trackName, fp);
 const present = t.artifacts.filter(k => arts.some(a => a.kind === k));
 const missing = t.artifacts.filter(k => !present.includes(k));
 let author_verdict = null;
 if (trackName === 'writing') {
  const v = tests.find(x => x.at === 'AT06');
  const e = v && v.evidence_id ? evidence(db, v.evidence_id) : null;
  author_verdict = e && e.verdict ? { ...e.verdict, basis_label:VERDICT_BASES[e.verdict.basis] } : null;
 }
 const rel = db.prepare('SELECT * FROM film_releases WHERE track = ? AND fingerprint = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(trackName, fp);
 return {
  track:trackName, versions:vs, fingerprint:fp, passed:tests.every(x => x.status === 'passed') && !missing.length,
  tests, failures:tests.filter(x => x.status !== 'passed').map(x => ({ at:x.at, status:x.status, note:x.note || null })),
  artifacts:{ required:t.artifacts, present, missing }, author_verdict,
  known_limitations:arts.filter(a => a.kind === 'known_limitations').map(a => a.ref),
  released:rel ? { id:rel.id, by:rel.released_by, at:rel.created_at } : null,
 };
}

function release(db, trackName, body) {
 const b = body || {}, report = gate(db, trackName, b.versions);
 if (b.human_confirmed !== true || typeof b.by !== 'string' || !b.by.trim()) fail(400, 'A named person records the release (by, human_confirmed)');
 if (!report.passed) fail(409, `The ${trackName} gate has not passed: ${report.failures.map(f => `${f.at} ${f.status}`).concat(report.artifacts.missing.map(m => `${m} missing`)).join(', ')}`, 'GATE_NOT_PASSED');
 const id = crypto.randomUUID();
 db.prepare('INSERT INTO film_releases (id,track,fingerprint,versions_json,released_by,report_json) VALUES (?,?,?,?,?,?)').run(id, trackName, report.fingerprint, JSON.stringify(report.versions), b.by.trim(), JSON.stringify(report));
 return { id, track:trackName, versions:report.versions, by:b.by.trim(), report };
}

module.exports = { ACCEPTANCE_TESTS, TRACKS, ARTIFACTS, KINDS, VERDICT_BASES, recordEvidence, evidence, recordArtifact, requalify, gate, release };
