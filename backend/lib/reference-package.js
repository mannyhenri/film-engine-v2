/**
 * Pinned reference packages and composition drift review (GRD-4666).
 *
 * A REFERENCE PACKAGE is the approved picture of a shot, frozen: aligned passes rendered from one
 * scene, camera and frame (beauty, plus depth, normals and an object mask when asked); each file's
 * hash; the world and blocking versions it was rendered from; the full camera specification; the
 * composition intent, with landmarks and subject bounds projected into the frame; and a person's
 * approval. The database refuses updates. A shot pins one approved package, and board jobs then
 * read the package's camera, never the latest camera on the stage.
 *
 * NEGOTIATION. A provider declares which reference controls it takes (`referenceControls`, else
 * just `reference_image` when it accepts reference images). Every control it cannot take is named
 * as omitted, with a warning that camera and geometry may drift. Generating in that weakened mode
 * needs a person's approval for that exact negotiation.
 *
 * DRIFT REVIEW. A board is compared with the package landmark by landmark, in every drift category.
 * Board positions come from marks a person or a tool placed; anything unmarked is "unverified" and
 * routes the review to a person. Framing drift (a different aspect) is measured from the image. A
 * board is disposed of by a person; known deviations are approved before the board is pinned for
 * video, and carried into the motion review.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PASS_SPECS = Object.freeze({
 beauty:{ format:'png', precision:'8-bit sRGB', units:'display colour', convention:'the frame as rendered (Workbench flat, or Cycles when other passes are asked for)', invalid:'none' },
 depth:{ format:'exr', precision:'32-bit float', units:'metres along the camera view axis (Blender Z pass)', convention:'single channel; nearer is smaller', invalid:'background and anything past clip end read 10000000000 (1e10) or more' },
 normal:{ format:'exr', precision:'32-bit float', units:'unit vectors, -1 to 1', convention:'world space, Blender axes (x east, y north, z up)', invalid:'background is (0, 0, 0)' },
 object_mask:{ format:'exr', precision:'32-bit float holding whole numbers', units:'object index', convention:'0 is the set; staged subjects are 1, 2, 3 in staging order (subject_index maps each to its name)', invalid:'none' },
});
const REFERENCE_CONTROLS = Object.freeze(['reference_image', 'camera_pose', 'depth', 'normal', 'object_mask']);
const DRIFT_CATEGORIES = Object.freeze(['framing', 'eyeline', 'horizon', 'prop', 'door_window', 'placement']);
const DISPOSITIONS = Object.freeze(['accept', 'accept_with_deviations', 'redo', 'reject']);
const DRIFT_TOLERANCE = 0.05;      // of the frame's width (positions) or height (lines)

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function fail(status, message, code, extra) { const e = new Error(message); e.status = status; e.code = code; Object.assign(e, extra || {}); throw e; }
const parse = (j, f) => { try { return j ? JSON.parse(j) : f; } catch { return f; } };
const wp = () => require('./world-previz');

// ── projection, in the stage's own axes (y up) ─────────────────────────────
function viewOf(camera) {
 const pick = require('./previs-pick');
 const f = Number(camera.focalMm) || 35, sw = Number(camera.sensor_width_mm) || 24.89;
 const aspect = camera.width / camera.height;
 const vFov = 2 * Math.atan(Math.tan(Math.atan(sw / 2 / f)) / aspect) * 180 / Math.PI;
 const eye = camera.position || [0, 1.6, 0];
 const target = camera.target || [eye[0], eye[1], eye[2] - 1];
 const view = { x:0, y:0, w:camera.width, h:camera.height };
 return { project:p => { const r = pick.projectPoint(p, eye, target, vFov, view); return r ? [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10] : null; }, eye, target };
}
function composition(camera, intent, subjects) {
 const v = viewOf(camera);
 const fwd = [v.target[0] - v.eye[0], 0, v.target[2] - v.eye[2]], l = Math.hypot(fwd[0], fwd[2]) || 1;
 const far = [v.eye[0] + fwd[0] / l * 10000, v.eye[1], v.eye[2] + fwd[2] / l * 10000];
 const horizon = v.project(far);
 const landmarks = (intent.landmarks || []).map(m => ({ ...m, screen:v.project(m.position) }));
 const subj = subjects.map(s => {
  const [w, h, d] = Array.isArray(s.sizeM) ? s.sizeM : [0.5, 1.7, 0.3], p = s.position;
  const corners = [];
  for (const dx of [-w / 2, w / 2]) for (const dy of [0, h]) for (const dz of [-d / 2, d / 2]) { const c = v.project([p[0] + dx, p[1] + dy, p[2] + dz]); if (c) corners.push(c); }
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
  const eyeline = v.project([p[0], p[1] + h * 0.93, p[2]]);
  return { name:s.name || 'subject', screen:v.project([p[0], p[1] + h / 2, p[2]]),
   bounds:corners.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null, eyeline_y:eyeline ? eyeline[1] : null };
 });
 return { text:String(intent.text || ''), landmarks, subjects:subj, horizon_y:horizon ? horizon[1] : null };
}

// ── packages ───────────────────────────────────────────────────────────────
/** Render the asked passes for one still frame of the saved shot (the previz worker, Cycles CPU). */
async function renderPassesWithBlender(plan, outDir, kinds) {
 const job = { ...require('./previs-video').renderJob(plan, outDir), passes:kinds.filter(k => k !== 'beauty'), render_engine:'CYCLES_CPU' };
 const result = await require('./set-build').runBlender(job, 600000, { script:path.join(__dirname, '..', 'blender-previz.py') });
 const passes = { beauty:path.join(outDir, 'frames', 'frame_00001.png'), ...(result.passes || {}) };
 return { passes, renderer:result.renderer, subject_index:result.subject_index || {} };
}
async function createPackage(db, shotId, body, { renderPasses } = {}) {
 const b = body || {};
 const kinds = Array.isArray(b.passes) && b.passes.length ? b.passes : ['beauty'];
 if (kinds.some(k => !PASS_SPECS[k]) || !kinds.includes('beauty')) fail(400, `passes must include beauty and come from: ${Object.keys(PASS_SPECS).join(', ')}`, 'invalid_request');
 const intent = b.intent || {};
 if (typeof intent.text !== 'string' || !intent.text.trim()) fail(400, 'intent.text: what the composition is for, in words', 'invalid_request');
 if (intent.landmarks !== undefined && (!Array.isArray(intent.landmarks) || intent.landmarks.some(m => !m || typeof m.id !== 'string' || !DRIFT_CATEGORIES.includes(m.category)
  || !Array.isArray(m.position) || m.position.length !== 3 || !m.position.every(Number.isFinite)))) fail(400, `intent.landmarks: { id, category (${DRIFT_CATEGORIES.join(', ')}), position [x,y,z] }`, 'invalid_request');
 const plan = require('./previs-video').plan(shotId, { kind:'still' });
 const blocking = require('../routes/previs').loadBlocking(shotId);
 const camera = { ...(blocking.camera || {}), width:plan.width, height:plan.height, sensor_width_mm:plan.sensor_width_mm, sensor_fit:plan.sensor_fit,
  aspectRatio:plan.aspect_ratio, at_ms:plan.frames[0].t_ms, mode:plan.mode };
 const os = require('os');
 const work = fs.mkdtempSync(path.join(os.tmpdir(), 'film-engine-refpkg-'));
 try {
  const out = await (renderPasses ? renderPasses(plan, work, kinds) : renderPassesWithBlender(plan, work, kinds));
  const { saveFile } = require('./file-storage');
  const id = crypto.randomUUID();
  const version = (db.prepare('SELECT MAX(version) v FROM film_reference_packages WHERE shot_id = ?').get(shotId).v || 0) + 1;
  const passes = kinds.map(k => {
   const src = out.passes && out.passes[k];
   if (!src || !fs.existsSync(src)) fail(502, `The render produced no ${k} pass`, 'RENDER_FAILED');
   const bytes = fs.readFileSync(src);
   const stored = saveFile(plan.project_id, 'references', `${plan.shot_code}_ref_v${version}_${k}.${PASS_SPECS[k].format}`, bytes);
   return { kind:k, path:stored, sha256:sha(bytes), bytes:bytes.length, ...PASS_SPECS[k] };
  });
  const comp = composition(camera, intent, blocking.subjects || []);
  const versions = { world_version_id:plan.versions.world_version_id, world_fingerprint:plan.versions.world_fingerprint, blocking_fingerprint:plan.versions.blocking_fingerprint };
  const fingerprint = sha(JSON.stringify({ shotId, version, versions, camera, intent:comp, passes:passes.map(p => [p.kind, p.sha256]) }));
  db.prepare(`INSERT INTO film_reference_packages (id,project_id,shot_id,version,world_version_id,world_fingerprint,blocking_fingerprint,camera_json,intent_json,passes_json,renderer,package_fingerprint)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, plan.project_id, shotId, version, versions.world_version_id, versions.world_fingerprint, versions.blocking_fingerprint,
   JSON.stringify(camera), JSON.stringify({ ...comp, subject_index:out.subject_index || {} }), JSON.stringify(passes), out.renderer || null, fingerprint);
  return getPackage(db, id);
 } finally { try { fs.rmSync(work, { recursive:true, force:true }); } catch (_) { /* harmless */ } }
}
function getPackage(db, id) {
 const r = db.prepare('SELECT * FROM film_reference_packages WHERE id = ?').get(id);
 if (!r) fail(404, 'Reference package not found', 'NOT_FOUND');
 const approval = db.prepare(`SELECT approved_by, created_at FROM film_reference_approvals WHERE package_id = ? AND kind = 'package' ORDER BY rowid DESC LIMIT 1`).get(id);
 return { id:r.id, shot_id:r.shot_id, version:r.version, versions:{ world_version_id:r.world_version_id, world_fingerprint:r.world_fingerprint, blocking_fingerprint:r.blocking_fingerprint },
  camera:parse(r.camera_json, {}), intent:parse(r.intent_json, {}), passes:parse(r.passes_json, []), renderer:r.renderer, package_fingerprint:r.package_fingerprint,
  approved:!!approval, approved_by:approval ? approval.approved_by : null, approved_at:approval ? approval.created_at : null, created_at:r.created_at };
}
function approvePackage(db, id, body) {
 const p = getPackage(db, id), b = body || {};
 if (b.approval_fingerprint !== p.package_fingerprint) fail(409, 'This approval is not for this exact package', 'STALE_APPROVAL', { current_fingerprint:p.package_fingerprint });
 if (b.human_confirmed !== true || typeof b.approved_by !== 'string' || !b.approved_by.trim()) fail(400, 'A named person must confirm the package approval', 'invalid_request');
 db.prepare(`INSERT INTO film_reference_approvals (id,package_id,kind,fingerprint,approved_by) VALUES (?,?,'package',?,?)`).run(crypto.randomUUID(), id, p.package_fingerprint, b.approved_by.trim().slice(0, 100));
 return getPackage(db, id);
}
function pinPackage(db, shotId, id) {
 const p = getPackage(db, id);
 if (p.shot_id !== shotId) fail(400, 'That package belongs to another shot', 'invalid_request');
 if (!p.approved) fail(409, 'A person must approve the package before it is pinned', 'NOT_APPROVED');
 db.prepare('UPDATE film_previs_blocking SET pinned_package_id = ? WHERE shot_id = ?').run(id, shotId);
 return packageState(db, shotId);
}
/** The pinned package, and whether the stage has moved on from it (camera, aspect, world). */
function packageState(db, shotId) {
 const row = db.prepare('SELECT pinned_package_id, world_version_id, camera_json FROM film_previs_blocking WHERE shot_id = ?').get(shotId);
 if (!row || !row.pinned_package_id) return { pinned:null, stale:false, reasons:[] };
 const p = getPackage(db, row.pinned_package_id), cam = parse(row.camera_json, {}), reasons = [];
 if (row.world_version_id !== p.versions.world_version_id) reasons.push('world');
 const aspectNow = cam.aspectRatio || p.camera.aspectRatio;
 if (aspectNow !== p.camera.aspectRatio) reasons.push('aspect');
 if (wp().blockingFingerprint(shotId) !== p.versions.blocking_fingerprint && !reasons.includes('aspect') && !reasons.includes('world')) reasons.push('camera');
 return { pinned:{ id:p.id, version:p.version, package_fingerprint:p.package_fingerprint }, stale:reasons.length > 0, reasons };
}
/** For the board payload: the pinned, approved package's camera in place of the stage's. */
function pinnedCamera(db, shotId) {
 const row = db.prepare('SELECT pinned_package_id FROM film_previs_blocking WHERE shot_id = ?').get(shotId);
 if (!row || !row.pinned_package_id) return null;
 const p = getPackage(db, row.pinned_package_id);
 if (!p.approved) return null;
 const { width, height, sensor_width_mm, sensor_fit, at_ms, mode, ...camera } = p.camera;
 return { camera, package:{ id:p.id, version:p.version, package_fingerprint:p.package_fingerprint } };
}

// ── negotiation ────────────────────────────────────────────────────────────
const OMISSION = { reference_image:'this provider takes no reference images', camera_pose:'this provider cannot be given a camera pose; the camera is described in words only',
 depth:'this provider cannot be conditioned on a depth pass', normal:'this provider cannot be conditioned on a normal pass', object_mask:'this provider cannot be given an object mask' };
function negotiate(db, packageId, adapter) {
 const p = getPackage(db, packageId), a = adapter || {};
 const declared = Array.isArray(a.referenceControls) ? a.referenceControls : (a.supportsReferenceImages ? ['reference_image'] : []);
 const available = new Set(['reference_image', 'camera_pose', ...p.passes.map(x => x.kind).filter(k => k !== 'beauty')]);
 const submitted = REFERENCE_CONTROLS.filter(c => declared.includes(c) && available.has(c));
 const omitted = REFERENCE_CONTROLS.filter(c => !submitted.includes(c)).map(c => ({ control:c, reason:declared.includes(c) ? 'this package has no such pass' : OMISSION[c] }));
 const weakened = omitted.length > 0;
 const body = { package_id:p.id, package_fingerprint:p.package_fingerprint, provider_id:a.id || null, submitted, omitted:omitted.map(o => o.control) };
 return { ...body, omitted, weakened, warning:weakened ? `${a.id || 'This provider'} will not receive ${omitted.map(o => o.control).join(', ')}: camera and geometry may drift from the approved package.` : null,
  negotiation_fingerprint:sha(JSON.stringify(body)) };
}
function approveWeakened(db, packageId, body) {
 const b = body || {};
 const n = negotiate(db, packageId, adapterFor(b.provider_id, b.adapter));
 if (b.negotiation_fingerprint !== n.negotiation_fingerprint) fail(409, 'This approval is not for this exact negotiation', 'STALE_APPROVAL', { current_fingerprint:n.negotiation_fingerprint });
 if (b.human_confirmed !== true || typeof b.approved_by !== 'string' || !b.approved_by.trim()) fail(400, 'A named person must approve the weakened reference mode', 'invalid_request');
 db.prepare(`INSERT INTO film_reference_approvals (id,package_id,kind,provider_id,fingerprint,approved_by) VALUES (?,?,'weakened',?,?,?)`).run(crypto.randomUUID(), packageId, b.provider_id, n.negotiation_fingerprint, b.approved_by.trim().slice(0, 100));
 return n;
}
const adapters = new Map();
function adapterFor(id, given) { if (given) { adapters.set(given.id, given); return given; } if (adapters.has(id)) return adapters.get(id); try { return require('./providers').get(id) || { id }; } catch (_) { return { id }; } }
/** Before a board generation: a stale pinned package, or a weakened mode nobody approved, refuses. */
function generationRefusal(db, shotId, adapter) {
 const st = packageState(db, shotId);
 if (!st.pinned) return null;
 if (st.stale) return { ok:false, code:'PACKAGE_STALE', reasons:st.reasons, error:`The pinned reference package no longer matches the shot (${st.reasons.join(', ')} changed); build and approve a new package.` };
 if (adapter) adapters.set(adapter.id, adapter);
 const n = negotiate(db, st.pinned.id, adapter);
 if (!n.weakened) return null;
 const ok = db.prepare(`SELECT 1 FROM film_reference_approvals WHERE package_id = ? AND kind = 'weakened' AND provider_id = ? AND fingerprint = ?`).get(st.pinned.id, n.provider_id, n.negotiation_fingerprint);
 return ok ? null : { ok:false, code:'WEAKENED_REFERENCE_NOT_APPROVED', negotiation:n, error:n.warning + ' A person must approve this weakened reference mode first.' };
}

// ── boards: registering, renderer-based, comparing, disposing ──────────────
function pngSize(buf) { return buf && buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG' ? { width:buf.readUInt32BE(16), height:buf.readUInt32BE(20) } : null; }
function registerBoardImage(db, shotId, bytes, meta) {
 const shot = db.prepare('SELECT s.shot_code, sc.project_id FROM film_shots s JOIN film_scenes sc ON sc.id = s.scene_id WHERE s.id = ?').get(shotId);
 if (!shot) fail(404, 'Shot not found', 'NOT_FOUND');
 const sb = require('../routes/storyboard');
 sb.ensureStoryboardDir(shot.project_id);
 sb.archiveExistingFrame(shot.project_id, shotId, shot.shot_code);
 const live = sb.storyboardImagePath(shot.project_id, shot.shot_code);
 fs.writeFileSync(live, bytes);
 const asset = sb.registerStoryboardAsset(shot.project_id, shotId, live, `${shot.shot_code}.png`, meta || {});
 sb.archiveExistingFrame(shot.project_id, shotId, shot.shot_code);
 const row = db.prepare('SELECT * FROM film_assets WHERE id = ?').get(asset.id || asset.asset_id);
 return { id:row.id, version:row.version, metadata:parse(row.metadata, {}) };
}
/** An exact-geometry shot can take the package's own beauty render as its board. */
function renderedBoard(db, shotId) {
 const st = packageState(db, shotId);
 if (!st.pinned) fail(409, 'Pin an approved reference package first', 'NO_PACKAGE');
 if (st.stale) fail(409, `The pinned package is stale (${st.reasons.join(', ')})`, 'PACKAGE_STALE');
 const p = getPackage(db, st.pinned.id), beauty = p.passes.find(x => x.kind === 'beauty');
 return registerBoardImage(db, shotId, fs.readFileSync(beauty.path), { provider:'renderer', source:'renderer', reference_package_id:p.id, package_fingerprint:p.package_fingerprint, renderer:p.renderer });
}
function compareBoard(db, body) {
 const b = body || {}, p = getPackage(db, b.package_id);
 const asset = db.prepare('SELECT * FROM film_assets WHERE id = ?').get(b.board_asset_id);
 if (!asset || asset.shot_id !== p.shot_id) fail(404, 'That board is not one of this shot\'s', 'NOT_FOUND');
 let size = null; try { size = pngSize(fs.readFileSync(asset.file_path)); } catch (_) { size = null; }
 const marks = b.marks || {}, W = p.camera.width, H = p.camera.height, checks = [];
 const dist = (a, e) => Math.hypot((a[0] - e[0]) / W, (a[1] - e[1]) / W);
 // Framing: measured from the board itself.
 const boardAspect = size ? size.width / size.height : null, pkgAspect = W / H;
 checks.push({ id:'frame', category:'framing', status:boardAspect === null ? 'unverified' : Math.abs(boardAspect - pkgAspect) / pkgAspect > 0.02 ? 'drift' : 'ok',
  expected:{ aspect:Math.round(pkgAspect * 1000) / 1000 }, found:boardAspect ? { aspect:Math.round(boardAspect * 1000) / 1000 } : null });
 const point = (id, category, expected, label) => {
  const m = marks[id];
  if (!expected) checks.push({ id, category, label, status:'unverified', reason:'not in frame in the package' });
  else if (!Array.isArray(m)) checks.push({ id, category, label, status:'unverified', expected, reason:'not marked on the board' });
  else { const d = dist(m, expected); checks.push({ id, category, label, status:d > DRIFT_TOLERANCE ? 'drift' : 'ok', expected, found:m, delta:Math.round(d * 1000) / 1000 }); }
 };
 for (const l of p.intent.landmarks || []) point(l.id, l.category, l.screen, l.name);
 for (const s of p.intent.subjects || []) point(`subject:${s.name}`, 'placement', s.screen, s.name);
 const line = (id, category, expected, found, label) => {
  if (expected === null || expected === undefined) checks.push({ id, category, label, status:'unverified', reason:'not in frame in the package' });
  else if (typeof found !== 'number') checks.push({ id, category, label, status:'unverified', expected, reason:'not marked on the board' });
  else { const d = Math.abs(found - expected) / H; checks.push({ id, category, label, status:d > DRIFT_TOLERANCE ? 'drift' : 'ok', expected, found, delta:Math.round(d * 1000) / 1000 }); }
 };
 line('horizon', 'horizon', p.intent.horizon_y, marks.horizon, 'Horizon');
 for (const s of p.intent.subjects || []) line(`eyeline:${s.name}`, 'eyeline', s.eyeline_y, (marks.eyeline || {})[s.name], `${s.name}'s eyeline`);
 const comparison = { package_id:p.id, package_fingerprint:p.package_fingerprint, board_asset_id:asset.id, board:size, checks,
  manual_review:checks.some(c => c.status === 'unverified'), drift:checks.filter(c => c.status === 'drift').map(c => c.id),
  uncertainty:checks.filter(c => c.status === 'unverified').map(c => ({ id:c.id, reason:c.reason })) };
 const fingerprint = sha(JSON.stringify(comparison)), id = crypto.randomUUID();
 db.prepare('INSERT INTO film_board_reviews (id,package_id,shot_id,board_asset_id,comparison_json,comparison_fingerprint) VALUES (?,?,?,?,?,?)').run(id, p.id, p.shot_id, asset.id, JSON.stringify(comparison), fingerprint);
 return { review_id:id, ...comparison, comparison_fingerprint:fingerprint };
}
function reviewRow(db, id) { const r = db.prepare('SELECT * FROM film_board_reviews WHERE id = ?').get(id); if (!r) fail(404, 'Board review not found', 'NOT_FOUND'); return r; }
function dispose(db, body) {
 const b = body || {}, r = reviewRow(db, b.review_id), c = parse(r.comparison_json, {});
 if (b.comparison_fingerprint !== r.comparison_fingerprint) fail(409, 'This decision is not about this comparison', 'STALE_APPROVAL');
 if (!DISPOSITIONS.includes(b.disposition)) fail(400, `disposition must be one of ${DISPOSITIONS.join(', ')}`, 'invalid_request');
 const deviations = Array.isArray(b.deviations) ? b.deviations : [];
 if (deviations.some(d => !d || typeof d.check !== 'string' || typeof d.note !== 'string' || !d.note.trim())) fail(400, 'Each deviation names a check and why it is accepted', 'invalid_request');
 const open = c.checks.filter(x => x.status !== 'ok').map(x => x.id);
 if (b.disposition === 'accept' && open.length) fail(409, `These are not ok yet: ${open.join(', ')}. Accept them as known deviations, or redo the board.`, 'UNRESOLVED_DRIFT', { open });
 if (b.disposition === 'accept_with_deviations') {
  const missing = open.filter(id => !deviations.some(d => d.check === id));
  if (missing.length) fail(409, `Every open check must be an approved deviation: ${missing.join(', ')}`, 'UNRESOLVED_DRIFT', { open:missing });
 }
 if (b.human_confirmed !== true || typeof b.by !== 'string' || !b.by.trim()) fail(400, 'A named person decides the board', 'invalid_request');
 db.prepare(`UPDATE film_board_reviews SET disposition = ?, deviations_json = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`)
  .run(b.disposition, JSON.stringify(deviations.map(d => ({ check:d.check, note:d.note.trim() }))), b.by.trim().slice(0, 100), r.id);
 return { review_id:r.id, disposition:b.disposition, deviations };
}
function pinForVideo(db, shotId, body) {
 const r = reviewRow(db, (body || {}).review_id);
 if (r.shot_id !== shotId) fail(400, 'That review is for another shot', 'invalid_request');
 if (!['accept', 'accept_with_deviations'].includes(r.disposition)) fail(409, 'A person must accept the board (with any deviations) before it is pinned for video', 'NOT_DISPOSED');
 const p = getPackage(db, r.package_id), blocking = require('../routes/previs').loadBlocking(shotId) || {};
 let support = {};
 try { const vr = require('./video-reference'); support = { contracts:Object.keys(vr.CONTRACTS || {}), default:vr.KEYFRAME_ONLY ? 'keyframe_only' : null, roles:vr.ROLES || null }; } catch (_) { support = { contracts:[] }; }
 const refs = { start_frame:{ asset_id:r.board_asset_id }, end_frame:null,
  trajectory:{ keys:(blocking.cameraKeys || []).length ? blocking.cameraKeys : (blocking.path || []).slice(0, 64), movement:blocking.movement || null, duration_ms:blocking.durationMs || null },
  support, package:{ id:p.id, package_fingerprint:p.package_fingerprint }, deviations:parse(r.deviations_json, []) };
 const id = crypto.randomUUID();
 db.prepare('INSERT INTO film_video_pins (id,shot_id,review_id,package_id,refs_json) VALUES (?,?,?,?,?)').run(id, shotId, r.id, p.id, JSON.stringify(refs));
 return { id, shot_id:shotId, refs };
}
function reviewMotion(db, body) {
 const b = body || {};
 const pin = db.prepare('SELECT * FROM film_video_pins WHERE id = ?').get(b.video_pin_id);
 if (!pin) fail(404, 'Video pin not found', 'NOT_FOUND');
 const findings = Array.isArray(b.findings) ? b.findings : null;
 if (!findings || findings.some(f => !f || !DRIFT_CATEGORIES.includes(f.category) || typeof f.note !== 'string')) fail(400, `findings: each { category (${DRIFT_CATEGORIES.join(', ')}), t_ms, note }`, 'invalid_request');
 if (b.human_confirmed !== true || typeof b.by !== 'string' || !b.by.trim()) fail(400, 'A named person reviews the motion', 'invalid_request');
 const carried = parse(pin.refs_json, {}).deviations || [];
 const id = crypto.randomUUID();
 db.prepare('INSERT INTO film_motion_reviews (id,video_pin_id,video_asset_id,findings_json,carried_json,reviewer) VALUES (?,?,?,?,?,?)').run(id, pin.id, b.video_asset_id || null, JSON.stringify(findings), JSON.stringify(carried), b.by.trim().slice(0, 100));
 return { id, video_pin_id:pin.id, findings, carried_deviations:carried };
}

// ── copying a shot ─────────────────────────────────────────────────────────
function copyShot(db, shotId) {
 const s = db.prepare('SELECT * FROM film_shots WHERE id = ?').get(shotId);
 if (!s) fail(404, 'Shot not found', 'NOT_FOUND');
 const { generateId } = require('../db/database');
 const codes = db.prepare('SELECT shot_code FROM film_shots WHERE scene_id = ?').all(s.scene_id).map(r => r.shot_code);
 let code = `${s.shot_code}-copy`, n = 2; while (codes.includes(code)) code = `${s.shot_code}-copy${n++}`;
 const id = generateId();
 db.transaction(() => {
  db.prepare(`INSERT INTO film_shots (id, scene_id, shot_code, scene_card_yaml, copied_from_shot_id, copied_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`).run(id, s.scene_id, code, s.scene_card_yaml, shotId);
  // A copy is a shot written from the same draft: record it, so it can be flagged as behind like any other.
  require('./screenplay-drift').stampShot(id, s.scene_id);
  const b = db.prepare('SELECT * FROM film_previs_blocking WHERE shot_id = ?').get(shotId);
  if (b) {
   // The setup travels; approvals, pins of packages and the locked workflow are the original's own decisions.
   const keep = ['camera_json', 'subject_json', 'stage_json', 'rig', 'movement', 'path_json', 'moves_json', 'subjects_json', 'duration_ms', 'director_json', 'camera_keys_json', 'world_version_id', 'range_json'];
   const cols = keep.filter(c => c in b);
   db.prepare(`INSERT INTO film_previs_blocking (id, shot_id, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`).run(generateId(), id, ...cols.map(c => b[c]));
  }
 })();
 return { id, shot_code:code, copied_from_shot_id:shotId };
}

module.exports = { PASS_SPECS, REFERENCE_CONTROLS, DRIFT_CATEGORIES, DISPOSITIONS, createPackage, getPackage, approvePackage, pinPackage, packageState, pinnedCamera,
 negotiate, approveWeakened, generationRefusal, registerBoardImage, renderedBoard, compareBoard, dispose, pinForVideo, reviewMotion, copyShot, composition };
