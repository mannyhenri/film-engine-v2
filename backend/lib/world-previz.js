/**
 * Editable Blender worlds and camera-blocked previz (GRD-4665).
 *
 * THE EDITABLE WORLD IS THE .blend. A world version built or imported in Blender keeps its own copy
 * of the .blend, its hash, the files it links, its units and axes, the renderer and add-on versions,
 * and a hash of every object transform. Reopening the saved file must give those same values back.
 * A preview image (panorama, thumbnail) is never the editable world: a version with only previews
 * cannot be approved.
 *
 * WORKERS. Blender runs only as one of the workers below, each a fixed script in this folder,
 * launched headless with factory settings and with --disable-autoexec, so Python embedded in an
 * imported .blend never runs. Job files must sit in a job folder (no relative escapes). Blender
 * still runs as the server's user; there is no OS-level sandbox.
 *
 * THE LOCKED WORKFLOW. A shot opts in (previz_workflow = 'locked', which needs a pinned world).
 * Its board cannot be generated until the pinned world version is approved and the camera approval
 * is current. The camera approval's fingerprint includes the world version and the aspect ratio,
 * so changing camera, world or aspect makes it stale.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = path.resolve(__dirname, '..');
const WORKERS = Object.freeze({
 inspect:{ script:'blender-inspect.py', purpose:'open a .blend; report units, axes, versions, transforms, linked files and materials; export a GLB' },
 set_build:{ script:'blender-set.py', purpose:'build a set from plates or a layout' },
 previz:{ script:'blender-previz.py', purpose:'render previz stills and motion through a world' },
});
const REPORT_KEYS = Object.freeze(['missing_assets', 'unsupported_materials', 'scale_changes', 'substitutions']);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function fail(status, message, code, extra) { const e = new Error(message); e.status = status; e.code = code; Object.assign(e, extra || {}); throw e; }
const parse = (j, f) => { try { return j ? JSON.parse(j) : f; } catch { return f; } };

/** The exact argv for a worker. Unknown workers and job files outside a folder are refused. */
function workerArgs(name, jobPath) {
 const spec = WORKERS[name];
 if (!spec) fail(400, `${name} is not an allowed Blender worker (${Object.keys(WORKERS).join(', ')})`, 'UNKNOWN_WORKER');
 if (typeof jobPath !== 'string' || !path.isAbsolute(jobPath) || path.normalize(jobPath) !== jobPath || !/\.json$/.test(jobPath)) fail(400, 'The job file must be an absolute .json path', 'BAD_JOB');
 return ['-b', '--factory-startup', '--disable-autoexec', '--python', path.join(HERE, spec.script), '--', jobPath];
}
/** The worker a script path belongs to, or a refusal: no caller-chosen scripts. */
function workerForScript(script) {
 const name = Object.keys(WORKERS).find(k => path.join(HERE, WORKERS[k].script) === path.resolve(script));
 if (!name) fail(400, `${script} is not an allowed Blender worker script`, 'UNKNOWN_WORKER');
 return name;
}

// A file inside the project folder, resolved through symlinks: nothing outside it is read.
function projectFile(db, projectId, want) {
 const row = db.prepare('SELECT assets_dir FROM film_projects WHERE id = ?').get(projectId);
 if (!row || !row.assets_dir) fail(400, 'This project has no folder of its own to import from', 'NO_PROJECT_FOLDER');
 if (typeof want !== 'string' || !want.trim()) fail(400, 'file_path is required', 'BAD_PATH');
 let root, target;
 try { root = fs.realpathSync(row.assets_dir); } catch (_) { fail(400, 'The project folder cannot be read', 'NO_PROJECT_FOLDER'); }
 try { target = fs.realpathSync(path.resolve(root, want)); } catch (_) { fail(404, `No file at ${want}`, 'NO_FILE'); }
 if (target !== root && !target.startsWith(root + path.sep)) fail(400, `${want} is outside this project's folder`, 'OUTSIDE_PROJECT');
 return target;
}

const transformsHash = objects => sha(JSON.stringify((objects || []).map(o => [o.name, o.location, o.rotation, o.scale]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))));
function reportOf(insp) {
 const units = insp.units || {};
 const scale = [];
 if (units.system && units.system !== 'METRIC') scale.push({ detail:`The scene uses ${units.system} units (${units.length_unit || 'unknown'}); the stage reads metres` });
 if (units.scale_length !== undefined && Number(units.scale_length) !== 1) scale.push({ detail:`Unit scale is ${units.scale_length}, not 1: lengths are converted` });
 return {
  missing_assets:[...(insp.libraries || []), ...(insp.images || [])].filter(a => a && a.exists === false).map(a => ({ path:a.path })),
  unsupported_materials:(insp.materials || []).filter(m => m && Array.isArray(m.unsupported) && m.unsupported.length).map(m => ({ name:m.name, unsupported:m.unsupported })),
  scale_changes:scale, substitutions:Array.isArray(insp.substitutions) ? insp.substitutions : [],
 };
}
/** Record what makes a version editable. Called by import and by the set build (which saves set.blend). */
function recordEditableSource(db, versionId, blendPath, insp, projectId) {
 const bytes = fs.readFileSync(blendPath);
 const { saveFile } = require('./file-storage');
 const stored = saveFile(projectId, 'worlds', `world_${versionId}.blend`, bytes);
 const source = {
  blend:{ path:stored, sha256:sha(bytes), bytes:bytes.length, original_name:path.basename(blendPath) },
  linked_assets:[...(insp.libraries || []).map(l => ({ ...l, kind:'library' })), ...(insp.images || []).map(i => ({ ...i, kind:'image' }))].map(a => {
   const resolved = a.resolved_path || path.resolve(path.dirname(blendPath), a.path.replace(/^\/\//, ''));
   const readable = !a.packed && fs.existsSync(resolved);
   return { path:a.path, resolved_path:resolved, kind:a.kind, source:a.source || null, packed:!!a.packed,
    exists:a.packed || (a.exists !== false && readable), sha256:readable ? sha(fs.readFileSync(resolved)) : null };
  }),
  units:insp.units || null, axes:insp.axes || null, renderer:insp.renderer || null, addons:insp.addons || [],
  transforms_hash:transformsHash(insp.objects), objects:(insp.objects || []).length,
 };
 db.prepare('UPDATE film_world_versions SET editable_source_json = ?, import_report_json = ? WHERE id = ?').run(JSON.stringify(source), JSON.stringify(reportOf(insp)), versionId);
 return source;
}

/** Run the inspect worker on a .blend: what Blender itself says about it. */
async function inspectWithBlender(blendPath) {
 const os = require('os');
 const out = fs.mkdtempSync(path.join(os.tmpdir(), 'film-engine-inspect-'));
 try {
  const result = await require('./set-build').runBlender({ mode:'inspect', out_dir:out, blend:blendPath }, 240000, { script:path.join(HERE, WORKERS.inspect.script) });
  return { ...result, glb:fs.readFileSync(result.glb) };
 } finally { try { fs.rmSync(out, { recursive:true, force:true }); } catch (_) { /* a temp folder left behind is harmless */ } }
}

async function importBlend(db, worldId, body, { inspect } = {}) {
 const worlds = require('./worlds'), world = worlds.getWorld(db, worldId);
 if (!world) fail(404, 'World not found', 'NOT_FOUND');
 const blendPath = projectFile(db, world.project_id, body && body.file_path);
 if (!/\.blend$/i.test(blendPath)) fail(400, 'Import a .blend file', 'NOT_BLEND');
 const insp = await (inspect || inspectWithBlender)(blendPath);
 if (!insp || !Buffer.isBuffer(insp.glb)) fail(502, 'Blender did not export the scene, so nothing was imported', 'INSPECT_FAILED');
 const v = worlds.importVersion(db, worldId, { glb:insp.glb, source:'blender', reason:(body && body.reason) || `Imported ${path.basename(blendPath)} from Blender` });
 recordEditableSource(db, v.id, blendPath, insp, world.project_id);
 return worlds.getVersion(db, v.id);
}

function versionRow(db, id) { const v = db.prepare('SELECT * FROM film_world_versions WHERE id = ?').get(id); if (!v) fail(404, 'World version not found', 'NOT_FOUND'); return v; }
const editableSource = (db, id) => parse(versionRow(db, id).editable_source_json, null);
function importReport(db, id) { const r = parse(versionRow(db, id).import_report_json, null) || {}; return Object.fromEntries(REPORT_KEYS.map(k => [k, Array.isArray(r[k]) ? r[k] : []])); }
function editability(db, id) {
 const src = editableSource(db, id);
 const kinds = db.prepare('SELECT kind FROM film_world_assets WHERE world_version_id = ?').all(id).map(r => r.kind);
 const source = src && src.blend ? 'blend' : kinds.includes('collider') ? 'glb' : null;
 return { editable:!!source, source, previews_only:!source && kinds.some(k => ['panorama', 'thumbnail'].includes(k)), preview_kinds:kinds.filter(k => ['panorama', 'thumbnail'].includes(k)) };
}
/** What a world approval is about: the editable source, the collider bytes and the scale. */
function worldFingerprint(db, id) {
 const v = versionRow(db, id), src = parse(v.editable_source_json, null);
 const collider = db.prepare(`SELECT a.file_path FROM film_world_assets w JOIN film_assets a ON a.id = w.asset_id WHERE w.world_version_id = ? AND w.kind = 'collider'`).get(id);
 let colliderHash = null;
 try { colliderHash = collider && collider.file_path ? sha(fs.readFileSync(collider.file_path)) : null; } catch (_) { colliderHash = null; }
 return sha(JSON.stringify({ id:v.id, blend:src && src.blend ? src.blend.sha256 : null, transforms:src ? src.transforms_hash : null, collider:colliderHash, scale:v.scale_factor }));
}
function approveWorld(db, id, body) {
 const b = body || {};
 const e = editability(db, id);
 if (!e.editable) fail(409, e.previews_only ? 'This version has only preview images; a preview is not the editable world' : 'This version has no editable world to approve', 'NOT_EDITABLE');
 if (b.approval_fingerprint !== worldFingerprint(db, id)) fail(409, 'This approval is not for this exact world version', 'STALE_APPROVAL', { current_fingerprint:worldFingerprint(db, id) });
 if (b.human_confirmed !== true) fail(400, 'A person must confirm the world approval', 'invalid_request');
 if (typeof b.approved_by !== 'string' || !b.approved_by.trim()) fail(400, 'approved_by: who approves', 'invalid_request');
 db.prepare(`UPDATE film_world_versions SET status = 'approved', approval_fingerprint = ?, approved_at = datetime('now'), approved_by = ? WHERE id = ?`).run(b.approval_fingerprint, b.approved_by.trim().slice(0, 100), id);
 return versionRow(db, id);
}
/** Reopen the saved .blend and compare it with what was recorded. */
async function reopenCheck(db, id, { inspect } = {}) {
 const src = editableSource(db, id);
 if (!src || !src.blend) fail(409, 'This version has no saved .blend to reopen', 'NOT_EDITABLE');
 const differences = [];
 let bytes = null;
 try { bytes = fs.readFileSync(src.blend.path); } catch (_) { differences.push({ field:'blend_path', recorded:src.blend.path, now:'missing' }); }
 if (bytes && sha(bytes) !== src.blend.sha256) differences.push({ field:'blend_sha256', recorded:src.blend.sha256, now:sha(bytes) });
 if (bytes) {
  const insp = await (inspect || inspectWithBlender)(src.blend.path);
  const cmp = (field, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) differences.push({ field, recorded:a, now:b }); };
  cmp('units', src.units, insp.units || null); cmp('axes', src.axes, insp.axes || null);
  cmp('renderer', src.renderer, insp.renderer || null); cmp('addons', src.addons, insp.addons || []);
  cmp('transforms', src.transforms_hash, transformsHash(insp.objects));
 }
 return { ok:!differences.length, differences };
}

const blockingFingerprint = shotId => require('../routes/previs').blockingFingerprint(shotId);
function setWorkflow(db, shotId, workflow) {
 if (!['free', 'locked'].includes(workflow)) fail(400, 'workflow must be free or locked', 'invalid_request');
 const row = db.prepare('SELECT world_version_id FROM film_previs_blocking WHERE shot_id = ?').get(shotId);
 if (workflow === 'locked' && (!row || !row.world_version_id)) fail(409, 'Pin the shot to a world before locking its workflow', 'NO_WORLD');
 if (!row) fail(409, 'This shot has no previs yet', 'NO_BLOCKING');
 db.prepare('UPDATE film_previs_blocking SET previz_workflow = ? WHERE shot_id = ?').run(workflow, shotId);
 return boardGate(db, shotId);
}
/** Whether Generate board is available for a shot, and why not. */
function boardGate(db, shotId) {
 const row = db.prepare('SELECT world_version_id, previz_workflow, approved_fingerprint FROM film_previs_blocking WHERE shot_id = ?').get(shotId);
 if (!row || row.previz_workflow !== 'locked') return { locked:false, available:true, reasons:[] };
 const reasons = [];
 const v = row.world_version_id && db.prepare('SELECT status, approval_fingerprint FROM film_world_versions WHERE id = ?').get(row.world_version_id);
 if (!v || v.status !== 'approved' || v.approval_fingerprint !== worldFingerprint(db, row.world_version_id)) reasons.push('world_not_approved');
 if (!row.approved_fingerprint) reasons.push('camera_not_approved');
 else if (row.approved_fingerprint !== blockingFingerprint(shotId)) reasons.push('camera_approval_stale');
 return { locked:true, available:!reasons.length, reasons };
}
/** The refusal every board-generating path gives a locked shot that is not ready. */
function boardRefusal(db, shotId) {
 const g = boardGate(db, shotId);
 if (g.available) return null;
 return { ok:false, code:'PREVIZ_NOT_APPROVED', reasons:g.reasons,
  error:`Generate board is unavailable for this locked shot until ${g.reasons.map(r => ({ world_not_approved:'the exact world version is approved', camera_not_approved:'the camera is approved', camera_approval_stale:'the camera is approved again (it changed since)' })[r]).join(' and ')}.` };
}

module.exports = { WORKERS, REPORT_KEYS, workerArgs, workerForScript, importBlend, recordEditableSource, editableSource, importReport, editability,
 worldFingerprint, approveWorld, reopenCheck, setWorkflow, boardGate, boardRefusal, blockingFingerprint, inspectWithBlender, transformsHash };
