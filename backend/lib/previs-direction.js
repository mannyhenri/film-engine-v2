/**
 * What a shot's Previz says, in the words a video prompt uses (Production › Generate).
 *
 * Previz decides the camera with numbers (a position, a turn, a lens, keys over time) and the stage with
 * people standing somewhere. Generate writes a prompt. Before this the two met only through the storyboard
 * picture: the keyed move and where everyone stood never reached the words a video model reads.
 *
 * Read only from what the director APPLIED (Previz › Apply to shot): an unapplied stage is an experiment,
 * the same rule generation already follows (capability-payloads: previsMode 'applied'). A shot with a stage
 * that is not applied says so (`state`), so Generate can point at the button instead of describing it.
 *
 * Space: the blocking stores the camera and subjects in the set's own units; the world version's
 * scale_factor turns them into metres (as the Plan does). Rotation is [yaw, pitch, roll] in degrees, yaw 0
 * facing −Z, a turn to the right lowering yaw (worldWalkCamera). Subjects face −Z at yaw 0, their yaw in
 * rotationDeg[1] (stageYaw).
 */
const crypto = require('crypto');

function parse(s, fallback) { try { const v = JSON.parse(s || ''); return v ?? fallback; } catch (_) { return fallback; } }
const R = Math.PI / 180;
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const r1 = (n) => Math.round(n * 10) / 10;
const metres = (n) => `${r1(Math.abs(n))} m`;

/** The pose at the start and the end of the move: keys first (what the director set), else the sampled path. */
function ends(row) {
    const keys = parse(row.camera_keys_json, []).filter(k => Array.isArray(k && k.position));
    const path = parse(row.path_json, []).filter(k => Array.isArray(k && k.position));
    const src = keys.length >= 2 ? keys.slice().sort((a, b) => (a.t || 0) - (b.t || 0)) : path.length >= 2 ? path : null;
    if (!src) return null;
    return { a: src[0], b: src[src.length - 1], count: src.length, from: keys.length >= 2 ? 'keys' : 'path' };
}

/** "dollies in 1.5 m and pans 30° left": the move from its first pose to its last, in the camera's own frame. */
function describeMove(a, b, scale, seconds, ease) {
    const yaw0 = Number((a.rotation || [])[0]) || 0;
    const fwd = [-Math.sin(yaw0 * R), -Math.cos(yaw0 * R)], right = [Math.cos(yaw0 * R), -Math.sin(yaw0 * R)];
    const d = [0, 1, 2].map(i => (Number(b.position[i]) - Number(a.position[i])) * scale);
    const along = d[0] * fwd[0] + d[2] * fwd[1], side = d[0] * right[0] + d[2] * right[1], up = d[1];
    const pan = wrap((Number((b.rotation || [])[0]) || 0) - yaw0);
    const tilt = (Number((b.rotation || [])[1]) || 0) - (Number((a.rotation || [])[1]) || 0);
    const fa = Number(a.focalMm) || 0, fb = Number(b.focalMm) || 0;
    const parts = [];
    if (Math.abs(along) >= 0.2) parts.push(`${along > 0 ? 'dollies in' : 'pulls back'} ${metres(along)}`);
    if (Math.abs(side) >= 0.2) parts.push(`trucks ${side > 0 ? 'right' : 'left'} ${metres(side)}`);
    if (Math.abs(up) >= 0.2) parts.push(`${up > 0 ? 'rises' : 'lowers'} ${metres(up)}`);
    // A turn to the right lowers yaw (see the header).
    if (Math.abs(pan) >= 5) parts.push(`pans ${Math.round(Math.abs(pan))}° ${pan < 0 ? 'right' : 'left'}`);
    if (Math.abs(tilt) >= 4) parts.push(`tilts ${tilt > 0 ? 'up' : 'down'} ${Math.round(Math.abs(tilt))}°`);
    if (fa && fb && Math.abs(fb - fa) >= 3) parts.push(`zooms ${fb > fa ? 'in' : 'out'} from ${Math.round(fa)}mm to ${Math.round(fb)}mm`);
    if (!parts.length) return 'The camera holds its position.';
    const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
    const easeWords = { 'ease-in': ', easing in', 'ease-out': ', easing out', 'ease-both': ', easing in and out', linear: ' at an even pace' }[ease] || '';
    return `Over ${r1(seconds)} seconds the camera ${list}${easeWords}.`;
}

/** Height and tilt as Generate's angle words (ANGLES in direct-model.js). */
function angleOf(pos, rot, scale) {
    const pitch = Number((rot || [])[1]) || 0, h = (Number((pos || [])[1]) || 0) * scale;
    if (pitch <= -60) return 'Overhead';
    if (pitch <= -12) return 'High';
    if (pitch >= 12) return h < 0.5 ? 'Ground' : 'Low';
    if (h > 0 && h < 0.5) return 'Ground';
    if (h >= 0.5 && h < 0.8) return 'Knee';
    if (h >= 0.8 && h < 1.2) return 'Hip';
    return 'Eye';
}

/** Where each named subject stands in the opening frame: side of frame, distance, which way they face. */
function describeStaging(subjects, cam, scale, focalMm) {
    const yaw = (Number((cam.rotation || [])[0]) || 0) * R;
    const fwd = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
    const halfFov = Math.atan(18 / Math.max(8, Number(focalMm) || 35));   // 36mm-wide frame
    const out = [];
    let facingOfLead = null;
    for (const su of subjects) {
        const name = String((su && su.name) || '').trim();
        if (!name || !Array.isArray(su.position)) continue;
        const dx = (Number(su.position[0]) - Number(cam.position[0])) * scale, dz = (Number(su.position[2]) - Number(cam.position[2])) * scale;
        const depth = dx * fwd[0] + dz * fwd[1], lat = dx * right[0] + dz * right[1];
        if (depth <= 0.2) continue;                              // behind the camera: not in the shot
        const ang = Math.atan2(lat, depth);
        if (Math.abs(ang) > halfFov * 1.05) { out.push(`${name} is just out of frame to the ${lat > 0 ? 'right' : 'left'}.`); continue; }
        const side = Math.abs(ang) < halfFov / 3 ? 'centre frame' : lat > 0 ? 'frame right' : 'frame left';
        const dist = depth < 2 ? 'close to camera' : depth > 6 ? 'in the background' : 'in the middle distance';
        // The subject's own facing against the direction back to the camera.
        const sy = (Number((su.rotationDeg || [])[1]) || 0) * R;
        const face = [-Math.sin(sy), -Math.cos(sy)], back = [-dx, -dz], len = Math.hypot(back[0], back[1]) || 1;
        const dot = (face[0] * back[0] + face[1] * back[1]) / len;
        const facing = dot > 0.7 ? 'facing the camera' : dot < -0.7 ? 'with their back to the camera' : dot > 0.2 ? 'turned three-quarters toward the camera' : 'in profile';
        if (facingOfLead === null) facingOfLead = dot > 0.7 ? 'Front' : dot < -0.7 ? 'Back' : dot > 0.2 ? 'Three-quarter' : 'Profile';
        out.push(`${name} stands ${side}, ${dist}, ${facing}.`);
    }
    return { lines: out, facing: facingOfLead };
}

/**
 * One shot's Previz for Generate, or null when the shot has none.
 * { state: 'applied'|'staged'|'card_ahead'|'conflict', applied, sig, framing, angle, facing, lens, move, staging[], keys, seconds }
 */
function previsForShot(db, shotId) {
    let row;
    try { row = db.prepare('SELECT * FROM film_previs_blocking WHERE shot_id = ?').get(shotId); } catch (_) { return null; }
    if (!row) return null;
    const shot = db.prepare('SELECT scene_card_yaml, scene_id FROM film_shots WHERE id = ?').get(shotId);
    const card = parse(shot && shot.scene_card_yaml, {}) || {};
    let state = 'staged';
    try {
        const scene = db.prepare('SELECT project_id FROM film_scenes WHERE id = ?').get(shot.scene_id);
        const known = scene ? [...db.prepare('SELECT name FROM film_characters WHERE project_id = ?').all(scene.project_id),
            ...db.prepare('SELECT name FROM film_props WHERE project_id = ?').all(scene.project_id)].map(r => r.name) : [];
        const now = require('./decision-contract').applicationFingerprints(row, card, { knownNames: known });
        const stageMoved = now.stage !== row.applied_fingerprint, cardMoved = now.card !== row.applied_card_fingerprint;
        state = !row.applied_fingerprint || !row.applied_card_fingerprint ? 'staged'
            : stageMoved && cardMoved ? 'conflict' : stageMoved ? 'staged' : cardMoved ? 'card_ahead' : 'applied';
    } catch (_) { state = 'staged'; }

    let scale = 1;
    try {
        const v = row.world_version_id && db.prepare('SELECT scale_factor FROM film_world_versions WHERE id = ?').get(row.world_version_id);
        if (v && Number(v.scale_factor) > 0) scale = Number(v.scale_factor);
    } catch (_) { /* no world: the stage is already in metres */ }

    const camera = parse(row.camera_json, {}) || {};
    const cc = card.camera || {};
    const span = ends(row);
    const start = span ? span.a : camera;
    const seconds = (Number(row.duration_ms) || 4000) / 1000;
    const legs = parse(row.moves_json, []);
    const ease = (span && span.b && span.b.ease) || (Array.isArray(legs) && legs[0] && legs[0].ease) || '';
    const lensMm = Number(start.focalMm) || Number(camera.focalMm) || Number((/(\d{2,3})\s*mm/.exec(String(cc.lens || '')) || [])[1]) || 0;
    const move = span ? describeMove(span.a, span.b, scale, seconds, ease) : null;
    const staging = Array.isArray(start.position)
        ? describeStaging(parse(row.subjects_json, []), start, scale, lensMm) : { lines: [], facing: null };
    const out = {
        state, applied: state === 'applied',
        framing: cc.shot_type || '', angle: Array.isArray(start.position) ? angleOf(start.position, start.rotation, scale) : null,
        facing: staging.facing, lens: lensMm ? Math.round(lensMm) : null,
        move, staging: staging.lines, keys: span ? span.count : 0, seconds,
        applied_at: row.applied_at || null,
    };
    out.sig = crypto.createHash('sha256').update(JSON.stringify([out.framing, out.angle, out.facing, out.lens, out.move, out.staging])).digest('hex').slice(0, 16);
    return out;
}

module.exports = { previsForShot, describeMove, describeStaging, angleOf };
