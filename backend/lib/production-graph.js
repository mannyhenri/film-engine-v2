/**
 * THE PRODUCTION GRAPH — eight pages read as one picture.
 *
 * Every node here is a view of something that already exists: a shot row and
 * its frames, a sequence row, a music cue, the assets a generation produced.
 * Asset versions remain the source of footage. Workspace geometry, mutable
 * draft recipes and explicit timeline audio edits are separate editing state;
 * none of them rewrites historical generation origins or narrative order.
 *
 * VERSIONS ARE ASSETS. film_shot_versions was the obvious home and holds no
 * rows: nothing but the render ledger writes it. Every frame, clip and sound
 * this engine has made is a film_assets row, so that is what a version node is,
 * and "selected" is the pointer the player already reads — current_frame_version
 * for a frame, selected_video_asset_id for a clip, generated_asset_id for a cue.
 */

const fs = require('fs');
const path = require('path');
const { flowOutputsOf } = require('./flow-outputs');
const recipes = require('./production-recipes');

const NODE_SIZE = Object.freeze({
    'depth-source': {w:260,h:220}, 'depth-map': {w:280,h:240}, 'depth-output': {w:260,h:220}, 'depth-preview': {w:260,h:220},
    shot: { w: 200, h: 180 },
    sequence: { w: 240, h: 280 },
    video: { w: 200, h: 178 },
    sound: { w: 200, h: 130 },
    audio: { w: 180, h: 110 },
    link: { w: 200, h: 150 },
    // In-betweens between two key shots: a strip of thumbnails, in time.
    inbetween: { w: 360, h: 150 },
});

const VIDEO_TYPES = ['video_final', 'video_synced', 'video_raw'];
const SOUND_KIND = Object.freeze({ sfx: 'sfx', ambient: 'ambient', score: 'music', source: 'music', transition: 'music' });
const LINK_MODES = Object.freeze(['shot_image', 'video_last_frame']);

function parseJson(text, fallback) {
    if (text == null || text === '') return fallback;
    try { const v = JSON.parse(text); return v == null ? fallback : v; } catch (_) { return fallback; }
}

function urlFor(filePath, version) {
    try { return require('./file-storage').urlForPath(filePath, version) || null; } catch (_) { return null; }
}

function metaOf(row) { return parseJson(row && row.metadata, {}) || {}; }

// ── Frames, clips, sounds ──────────────────────────────────────────────────

/** A shot's frames, oldest first, and which one is on the board. */
function shotFrames(db, shot) {
    const rows = db.prepare(
        `SELECT id, version, file_path, created_at, provider, provider_model, metadata FROM film_assets
          WHERE shot_id = ? AND asset_type IN ('storyboard', 'keyframe')
          ORDER BY version ASC, created_at ASC`).all(shot.id)
        // In-between stations are frames of a STRIP, not attempts at this shot.
        .filter(r => metaOf(r).station_index == null);
    const byVersion = new Map();
    for (const r of rows) byVersion.set(Number(r.version) || 0, r);   // newest row per version wins
    const list = [...byVersion.values()];
    const selected = require('./selected-frame').selectedFrame(db, shot.id);
    return list.map(r => ({
        asset_id: r.id,
        version: Number(r.version) || 0,
        url: urlFor(r.file_path, r.created_at),
        path: r.file_path,
        provider: r.provider || null,
        model: r.provider_model || null,
        selected: r.id === selected?.id,
    }));
}

function videoRow(r, selectedId, extra) {
    const m = metaOf(r);
    return {
        asset_id: r.id,
        kind: 'video',
        asset_type: r.asset_type,
        url: urlFor(r.file_path),
        path: r.file_path,
        duration_ms: Number(r.duration_ms) || 0,
        provider: r.provider || null,
        model: r.provider_model || null,
        created_at: r.created_at,
        prompt: m.prompt || null,
        edit: m.edit || null,
        audio_review: m.audio_review || null,
        audio_fingerprint: require('./nle-media').fingerprint(r),
        has_audio: m.has_audio === true,
        seed: m.seed != null ? m.seed : null,
        selected: r.id === selectedId,
        ...(extra || {}),
    };
}

/**
 * A shot's OWN clips. Anything a sequence made — a leg, a master, a native
 * multi-shot clip, an upload — belongs to the sequence and is listed there, or
 * the same file would appear as two versions of two different things.
 */
function shotVideos(db, shot, sequenceAssetIds) {
    const rows = db.prepare(
        `SELECT id, asset_type, file_path, duration_ms, provider, provider_model, created_at, metadata
           FROM film_assets WHERE shot_id = ? AND asset_type IN (${VIDEO_TYPES.map(() => '?').join(',')})
          ORDER BY created_at ASC`).all(shot.id, ...VIDEO_TYPES)
        .filter(r => !metaOf(r).sequence_id && !(sequenceAssetIds && sequenceAssetIds.has(r.id)));
    return rows.map((r, i) => videoRow(r, shot.selected_video_asset_id, { version: i + 1 }));
}

/** A sequence's own clips: the stitched master, a native clip, an upload. */
function sequenceVideos(db, seq) {
    const rows = db.prepare(
        `SELECT id, asset_type, file_path, duration_ms, provider, provider_model, created_at, metadata
           FROM film_assets
          WHERE project_id = ? AND asset_type IN (${VIDEO_TYPES.map(() => '?').join(',')})
            AND (json_extract(metadata, '$.sequence_id') = ? OR id = ?)
          ORDER BY created_at ASC`).all(seq.project_id, ...VIDEO_TYPES, seq.id, seq.output_asset_id || '');
    const legs = [], versions = [];
    for (const r of rows) {
        const m = metaOf(r);
        if (m.station_index != null) continue;
        // A LEG is part of a leg-by-leg version, not a version on its own.
        if (m.from && m.to && m.kind !== 'sequence_master' && m.kind !== 'native_multi_shot') legs.push(r);
        else versions.push(r);
    }
    return {
        versions: versions.map((r, i) => videoRow(r, seq.selected_video_asset_id, {
            version: i + 1, mode: metaOf(r).kind || 'upload',
        })),
        legs: legs.map(r => ({ asset_id: r.id, from: metaOf(r).from, to: metaOf(r).to,
            url: urlFor(r.file_path), duration_ms: Number(r.duration_ms) || 0 })),
    };
}

/**
 * A cue's generations. Written with `metadata.cue_id` from the production graph
 * on; the one it currently links (`generated_asset_id`) is always included, so a
 * cue generated before that still shows the version it has.
 */
function cueVersions(db, cue) {
    const rows = db.prepare(
        `SELECT id, asset_type, file_path, duration_ms, provider, provider_model, created_at, metadata
           FROM film_assets WHERE project_id = ?
            AND (json_extract(metadata, '$.cue_id') = ? OR id = ?)
          ORDER BY created_at ASC`).all(cue.project_id, cue.id, cue.generated_asset_id || '');
    return rows.map((r, i) => ({
        asset_id: r.id,
        kind: 'audio',
        version: i + 1,
        asset_type: r.asset_type,
        url: urlFor(r.file_path),
        path: r.file_path,
        duration_ms: Number(r.duration_ms) || 0,
        provider: r.provider || null,
        model: r.provider_model || null,
        created_at: r.created_at,
        prompt: metaOf(r).prompt || null,
        selected: r.id === cue.generated_asset_id,
    }));
}

// ── Linked frames ──────────────────────────────────────────────────────────

/**
 * What a borrowed frame is RIGHT NOW. Resolved at generate time to the source's
 * selected version, never to the version it was when it was linked — the
 * director's latest choice is the one the next clip should start on.
 *
 * `side` decides which end of the source is borrowed: a sequence that STARTS on
 * another takes that sequence's LAST picture (it hands off), and one that ENDS
 * on another takes its FIRST.
 */
function resolveLinkedFrame(db, ref, side) {
    if (!ref || !ref.sequence_id) return { ok: false, reason: 'no frame is linked' };
    const src = db.prepare('SELECT * FROM film_sequences WHERE id = ?').get(ref.sequence_id);
    if (!src) return { ok: false, reason: 'the sequence this frame is borrowed from has been deleted' };
    const mode = LINK_MODES.includes(ref.mode) ? ref.mode : 'shot_image';

    if (mode === 'video_last_frame') {
        const assetId = src.selected_video_asset_id || src.output_asset_id;
        const asset = assetId ? db.prepare('SELECT id, file_path, project_id FROM film_assets WHERE id = ?').get(assetId) : null;
        if (!asset || !asset.file_path) {
            return { ok: false, reason: `${src.name || 'That sequence'} has no selected video to borrow a frame from` };
        }
        const { extractFrame, inspectMedia } = require('./ffmpeg');
        const fsDir = require('./file-storage').ensureDir(asset.project_id, 'storyboards');
        const out = path.join(fsDir, `linked_${src.id.slice(0, 8)}_${asset.id.slice(0, 8)}_${side === 'end' ? 'first' : 'last'}.png`);
        if (!fs.existsSync(out)) {
            let at = 0;
            if (side !== 'end') {
                const info = (() => { try { return inspectMedia(asset.file_path); } catch (_) { return null; } })();
                const secs = info && info.ok !== false ? Number(info.durationSeconds) || 0 : 0;
                at = secs > 0.1 ? secs - 0.05 : 0;
            }
            const got = extractFrame(asset.file_path, { out, atSeconds: at });
            if (!got.ok) return { ok: false, reason: `could not take a frame from ${src.name || 'that sequence'}'s video: ${got.reason}` };
        }
        return {
            ok: true, mode, side, path: out, url: urlFor(out),
            source_sequence_id: src.id, source_name: src.name,
            label: `${side === 'end' ? 'first' : 'last'} frame of ${src.name || 'sequence'} video`,
            fingerprint: `${src.id}:video:${asset.id}:${side}`,
        };
    }

    const ids = parseJson(src.shot_ids, []);
    const shotId = ref.shot_id && ids.includes(ref.shot_id) ? ref.shot_id
        : (side === 'end' ? ids[0] : ids[ids.length - 1]);
    const shot = shotId ? db.prepare('SELECT id, shot_code, current_frame_version FROM film_shots WHERE id = ?').get(shotId) : null;
    if (!shot) return { ok: false, reason: `${src.name || 'That sequence'} has no shot to borrow a frame from` };
    const frame = shotFrames(db, shot).find(f => f.selected);
    if (!frame) return { ok: false, reason: `${shot.shot_code} has no frame yet` };
    return {
        ok: true, mode, side, path: frame.path, url: frame.url,
        source_sequence_id: src.id, source_name: src.name,
        shot_id: shot.id, shot_code: shot.shot_code, version: frame.version,
        label: `${shot.shot_code} · v${frame.version}`,
        fingerprint: `${src.id}:shot:${shot.id}:v${frame.version}`,
    };
}

/** Both links of a sequence, and whether they moved since it last generated. */
function linkState(db, seq) {
    const start = parseJson(seq.start_frame_ref, null);
    const end = parseJson(seq.end_frame_ref, null);
    const out = {
        start: start ? { ref: start, ...resolveLinkedFrame(db, start, 'start') } : null,
        end: end ? { ref: end, ...resolveLinkedFrame(db, end, 'end') } : null,
    };
    out.fingerprint = linkFingerprintOf(out);
    // Never generated with a link = nothing to be stale against, the rule every
    // fingerprint here follows: NULL means "outside the workflow".
    out.stale = !!(seq.link_fingerprint && out.fingerprint && seq.link_fingerprint !== out.fingerprint);
    return out;
}

function linkFingerprintOf(state) {
    const parts = [];
    for (const side of ['start', 'end']) {
        const s = state && state[side];
        if (s) parts.push(`${side}=${s.ok ? s.fingerprint : 'unresolved'}`);
    }
    return parts.length ? parts.join('|') : null;
}

/**
 * Validate a frame reference before it is stored. A reference to the sequence
 * itself, to another project, or to a shot outside the source is refused rather
 * than kept and resolved to something nobody chose.
 */
function checkFrameRef(db, seq, ref) {
    if (ref === null) return { ok: true, value: null };
    if (!ref || typeof ref !== 'object') return { ok: false, error: 'a frame reference is { sequence_id, mode }' };
    if (ref.sequence_id === seq.id) return { ok: false, error: 'a sequence cannot borrow a frame from itself' };
    const src = db.prepare('SELECT id, project_id, shot_ids FROM film_sequences WHERE id = ?').get(ref.sequence_id);
    if (!src || src.project_id !== seq.project_id) return { ok: false, error: 'the linked sequence is not in this project' };
    const mode = ref.mode || 'shot_image';
    if (!LINK_MODES.includes(mode)) return { ok: false, error: `mode must be one of ${LINK_MODES.join(', ')}` };
    if (ref.shot_id && !parseJson(src.shot_ids, []).includes(ref.shot_id)) {
        return { ok: false, error: 'that shot is not in the linked sequence' };
    }
    return { ok: true, value: JSON.stringify({ sequence_id: src.id, mode, ...(ref.shot_id ? { shot_id: ref.shot_id } : {}) }) };
}

// ── Layout ─────────────────────────────────────────────────────────────────

const GAP = 24;

/**
 * Where every node goes if nobody has moved it: scene groups, with shots and
 * sequences in vertical narrative rows and their outputs to the right. A
 * sequence spanning scenes is housed by its first shot; its membership edges
 * still connect every member in its own scene. Deterministic, so a
 * reload places an untouched node exactly where it was.
 */
/** A collapsed group is drawn as one card this size (PGN-018). */
const COLLAPSED_GROUP = Object.freeze({ w: 240, h: 132 });

function autoLayout(graph, collapsed) {
    const shut = collapsed instanceof Set ? collapsed : new Set();
    const pos = {};
    const groups = [];
    let sceneY = 8;
    const put = (key, x, y) => { pos[key] = { x, y }; };
    const nodeOf = new Map(graph.nodes.map(n => [n.key, n]));
    const h = key => (NODE_SIZE[(nodeOf.get(key) || {}).type] || { h: 120 }).h;

    for (const g of graph.groups) {
        const x0 = 20, y0 = sceneY + 68, rowX = x0 + 240;
        let colY = y0, right = rowX + 240;
        const placed = new Set();
        const place = (key, x, y) => {
            put(key, x, y); placed.add(key);
            right = Math.max(right, x + (NODE_SIZE[(nodeOf.get(key) || {}).type] || { w: 200 }).w);
        };
        for (const key of g.rows || [...g.shots, ...(g.sequence ? [g.sequence] : [])]) {
            place(key, rowX, colY);
            const children = (g.versions || []).filter(k => (nodeOf.get(k) || {}).parent === key);
            let childX = rowX + 280, rowHeight = h(key);
            for (const child of children) {
                place(child, childX, colY); childX += (NODE_SIZE[(nodeOf.get(child) || {}).type] || { w: 200 }).w + GAP;
                rowHeight = Math.max(rowHeight, h(child));
            }
            const links = [...(g.links_start || []), ...(g.links_end || [])].filter(k => (nodeOf.get(k) || {}).sequence_id === (nodeOf.get(key) || {}).id);
            for (const [i, link] of links.entries()) { place(link, x0 + 20, colY + i * (h(link) + GAP)); rowHeight = Math.max(rowHeight, (i + 1) * (h(link) + GAP)); }
            colY += rowHeight + GAP;
        }
        let vy = colY;
        for (const key of [...(g.versions || []), ...(g.audio_tracks || [])]) {
            if (placed.has(key)) continue;
            place(key, rowX + 280, vy); vy += h(key) + GAP;
        }
        for (const s of g.sounds) {
            place(s.key, rowX, vy);
            let sx = rowX + 280;
            for (const v of s.versions) { place(v, sx, vy); sx += 180 + GAP; }
            vy += Math.max(h(s.key), s.versions.length ? NODE_SIZE.audio.h : 0) + GAP;
        }
        const bottom = Math.max(colY, vy), width = right + 20 - x0;
        /*
         * A collapsed group is a card, and the groups after it close up. Its
         * members keep the positions they would have open — they are hidden,
         * not moved — so expanding restores them exactly.
         */
        if (shut.has(g.id)) {
            groups.push({ id: g.id, label: g.label, x: x0, y: sceneY, w: COLLAPSED_GROUP.w, h: COLLAPSED_GROUP.h, expanded_w: width, expanded_h: bottom - sceneY + 24 });
            sceneY += COLLAPSED_GROUP.h + 64;
            continue;
        }
        groups.push({ id: g.id, label: g.label, x: x0, y: sceneY, w: width, h: bottom - sceneY + 24 });
        sceneY = bottom + 88;
    }
    return { positions: pos, groups };
}

/** The groups a person collapsed on this project (PGN-018). */
function readCollapsed(db, projectId) {
    try {
        return new Set(db.prepare('SELECT group_key FROM production_group_layout WHERE project_id = ? AND collapsed = 1')
            .all(projectId).map(r => r.group_key));
    } catch (_) { return new Set(); }
}

/** Every node key a group draws: its shots, links, sequence, versions, sounds and their versions. */
function groupMembers(g) {
    return [...new Set([...(g.rows || []), ...(g.links_start || []), ...(g.shots || []), ...(g.sequences || (g.sequence ? [g.sequence] : [])), ...(g.links_end || []),
        ...(g.versions || []), ...(g.audio_tracks || []), ...(g.sounds || []).flatMap(x => [x.key, ...(x.versions || [])])])];
}

/**
 * What a collapsed card says about its group: how long it runs, how many of
 * its shots have footage, how many of its nodes are behind, and what is
 * running inside it. Computed for every group, so a card is right the moment
 * it is collapsed.
 */
function groupSummary(members, byKey, running) {
    const nodes = members.map(k => byKey.get(k)).filter(Boolean);
    const shots = nodes.filter(n => n.type === 'shot');
    const seqHasClip = id => { const q = id && byKey.get('seq:' + id); return !!(q && q.videos && q.videos.length); };
    const live = new Set((running || []).map(r => r.key));
    return {
        length_ms: shots.reduce((t, n) => t + (n.duration_ms || 0), 0),
        shots_total: shots.length,
        shots_done: shots.filter(n => (n.videos && n.videos.length) || (n.sequence_ids || [n.sequence_id]).some(seqHasClip)).length,
        behind: nodes.filter(n => n.impact && (n.impact.state === 'redo' || n.impact.state === 'waiting')).length,
        running: members.filter(k => live.has(k)).length,
    };
}

function readLayout(db, projectId) {
    const rows = db.prepare('SELECT node_key, x, y, pinned FROM production_node_layout WHERE project_id = ?').all(projectId);
    return new Map(rows.map(r => [r.node_key, { x: r.x, y: r.y, pinned: !!r.pinned }]));
}

function readGroupLayout(db, projectId) {
    return new Map(db.prepare('SELECT * FROM production_group_layout WHERE project_id = ?').all(projectId).map(r => [r.group_key, r]));
}

/** Geometry identities are project scoped; no content is accepted by this API. */
const LAYOUT_NODE_KEY=/^(depth|depth-source|depth-output|depth-preview|shot|seq|sound|ver|audio|ib):[0-9a-f-]{36}$|^link:[0-9a-f-]{36}:(start|end)$|^(board|request):[0-9a-f-]{36}$|^reference:[0-9a-f-]{36}:\d+$|^draft:(shot|seq):[0-9a-f-]{36}:(image|video)$|^draft-reference:(shot|seq):[0-9a-f-]{36}:(image|video):(\d+|r[0-9a-f]{16}-\d+|i[0-9a-f-]{36})$/i;
function draftGeometryReferences(recipe={},identities={}){
 identities=identities&&typeof identities==='object'&&!Array.isArray(identities)?identities:{};
 const fields=['reference_images','referenceImages','refImages','references','audio_references','reference_videos','keyframes','promptImage','init_image','image_url','image','end_image','last_frame','source_video','video_url','videoUri','video_uri'];
 const counts=new Map(),taken=new Set();
 return fields.flatMap(list=>(Array.isArray(recipe[list])?recipe[list]:recipe[list]?[recipe[list]]:[]).map((ref,index)=>{
  const entry={...(typeof ref==='string'?{uri:ref}:ref),list},identity=referenceGeometryIdentity(entry);let occurrence=counts.get(identity) || 0;counts.set(identity,occurrence+1);
  let id=identities[list]?.[index];if(typeof id!=='string'||!/^(r[0-9a-f]{16}-\d+|i[0-9a-f-]{36})$/i.test(id)||taken.has(id)){id=`${identity}-${occurrence}`;while(taken.has(id))id=`${identity}-${++occurrence}`;}
  taken.add(id);return {...entry,geometry_id:id};
 }));
}
function referenceGeometryIdentity(reference){
 const canonical=(value,depth=0)=>Array.isArray(value)?value.map(v=>canonical(v,depth+1)):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>depth>0 || !['reference_role','role','wire_role','order','position','geometry_id'].includes(k)).map(k=>[k,canonical(value[k],depth+1)])):value;
 const text=JSON.stringify(canonical(reference));let a=2166136261,b=2246822507;
 for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),3266489909);}
 return 'r'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
/** Resolve a synthetic card through its real graph owner, including Flows results. */
function layoutNodeOwner(db,graph,key){
 if(!LAYOUT_NODE_KEY.test(key))return null;
 const real=graph.nodes.find(n=>n.key===key);if(real)return real.parent || real.key;
 const draft=key.match(/^draft(?:-reference)?:(shot|seq):([0-9a-f-]{36}):(image|video)(?::(.+))?$/i);
 if(draft){
  const owner=graph.nodes.find(n=>n.key===`${draft[1]}:${draft[2]}`&&['shot','sequence'].includes(n.type));
  if(!owner || (owner.type==='sequence'&&draft[3]==='image'))return null;
  if(key.startsWith('draft:'))return owner.key;
  const recipe=owner.draft?.payload?.[draft[3]] || {};
  const references=draftGeometryReferences(recipe,owner.draft?.payload?.workspace_reference_ids?.[draft[3]]);
  if(/^\d+$/.test(draft[4] || ''))return Number(draft[4])<references.length?owner.key:null;
  const occurrences=new Map();
  for(const ref of references){const identity=referenceGeometryIdentity(ref),i=occurrences.get(identity) || 0;occurrences.set(identity,i+1);if((ref.geometry_id || `${identity}-${i}`)===draft[4])return owner.key;}
  return null;
 }
 const asset=key.match(/^(board|request|reference):([0-9a-f-]{36})(?::(\d+))?$/i);if(!asset)return null;
 const owner=graph.nodes.find(n=>['shot','sequence'].includes(n.type)&&[...(n.frames || []),...(n.flow_frames || []),...(n.videos || []),...graph.nodes.filter(v=>v.parent===n.key&&v.type==='video')].some(v=>v.asset_id===asset[2]));
 if(!owner)return null;
 if(asset[1]==='board'&&![...(owner.frames || []),...(owner.flow_frames || [])].some(v=>v.asset_id===asset[2]))return null;
 if(asset[1]==='reference'){
  const lineage=require('./production-lineage').assetLineage(db,asset[2]);
  const count=lineage?.status==='recorded'&&lineage.approved?.references_known!==false&&Array.isArray(lineage.approved?.references)?lineage.approved.references.length:1;
  if(Number(asset[3])>=count)return null;
 }
 return owner.key;
}

/** A layout receipt contains workspace rows only; creative records are never restored. */
function workspaceLayout(db, projectId) {
    return { project_id: projectId,
        nodes: db.prepare('SELECT node_key,x,y,pinned,updated_at FROM production_node_layout WHERE project_id=? ORDER BY node_key').all(projectId),
        groups: db.prepare('SELECT group_key,collapsed,x,y,w,h,updated_at FROM production_group_layout WHERE project_id=? ORDER BY group_key').all(projectId) };
}
function layoutFingerprint(snapshot) {
    return require('crypto').createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
function arrangeWorkspaceLayout(db, projectId, input = {}) {
    if (!db.prepare('SELECT id FROM film_projects WHERE id=?').get(projectId)) throw Object.assign(new Error('Project not found'), {status:404});
    return db.transaction(() => {
        const before = workspaceLayout(db, projectId);
        if (input.undo !== undefined) {
            if (input.expected_fingerprint !== layoutFingerprint(before)) throw Object.assign(new Error('Layout changed after arrangement. Undo would overwrite a newer placement.'), {status:409});
            const snapshot = input.undo;
            // Deleted owners leave harmless project-scoped workspace rows. A genuine
            // receipt must still restore the surviving placements, without recreating owners.
            const nodeKey = LAYOUT_NODE_KEY;
            const finite = value => Number.isFinite(value), nullable = value => value === null || finite(value);
            if (!snapshot || snapshot.project_id !== projectId || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.groups)
                || new Set(snapshot.nodes.map(n=>n?.node_key)).size !== snapshot.nodes.length
                || new Set(snapshot.groups.map(g=>g?.group_key)).size !== snapshot.groups.length
                || snapshot.nodes.some(n=>!n || !nodeKey.test(n.node_key) || !finite(n.x) || !finite(n.y) || ![0,1].includes(n.pinned) || typeof n.updated_at !== 'string')
                || snapshot.groups.some(g=>!g || typeof g.group_key !== 'string' || !g.group_key.length || g.group_key.length>200 || g.group_key.includes('\0') || ![0,1].includes(g.collapsed) || !nullable(g.x) || !nullable(g.y)
                    || !nullable(g.w) || !nullable(g.h) || (g.w!==null && g.w<=0) || (g.h!==null && g.h<=0) || typeof g.updated_at !== 'string')) {
                throw Object.assign(new Error('The saved workspace layout cannot be restored to this graph.'), {status:400});
            }
            db.prepare('DELETE FROM production_node_layout WHERE project_id=?').run(projectId);
            db.prepare('DELETE FROM production_group_layout WHERE project_id=?').run(projectId);
            const nodePut=db.prepare('INSERT INTO production_node_layout(project_id,node_key,x,y,pinned,updated_at) VALUES(?,?,?,?,?,?)');
            const groupPut=db.prepare('INSERT INTO production_group_layout(project_id,group_key,collapsed,x,y,w,h,updated_at) VALUES(?,?,?,?,?,?,?,?)');
            for(const n of snapshot.nodes)nodePut.run(projectId,n.node_key,n.x,n.y,n.pinned,n.updated_at);
            for(const g of snapshot.groups)groupPut.run(projectId,g.group_key,g.collapsed,g.x,g.y,g.w,g.h,g.updated_at);
            return {undo:null,layout_fingerprint:layoutFingerprint(workspaceLayout(db,projectId))};
        }
        db.prepare('DELETE FROM production_node_layout WHERE project_id=?').run(projectId);
        db.prepare("UPDATE production_group_layout SET x=NULL,y=NULL,w=NULL,h=NULL,updated_at=datetime('now') WHERE project_id=?").run(projectId);
        return {undo:before,layout_fingerprint:layoutFingerprint(workspaceLayout(db,projectId))};
    }).immediate();
}

/** Persist one scene gesture, translating all members in the same transaction. */
function saveGroupLayout(db, projectId, groupKey, input) {
    const graph = buildGraph(db, projectId);
    if (!graph) throw Object.assign(new Error('Project not found'), { status: 404 });
    const group = graph.groups.find(g => g.key === groupKey);
    if (!group) throw Object.assign(new Error(`No group "${groupKey}" on this graph`), { status: 404 });
    if (!input || !['x', 'y', 'w', 'h', 'collapsed'].some(k => input[k] !== undefined)) throw Object.assign(new Error('Supply scene geometry or collapsed'), { status: 400 });
    for (const k of ['x', 'y', 'w', 'h', 'delta_x', 'delta_y']) {
        if (input[k] !== undefined && (!Number.isFinite(input[k]) || ((k === 'w' || k === 'h') && input[k] <= 0))) {
            throw Object.assign(new Error(`${k} must be a finite ${k === 'w' || k === 'h' ? 'positive ' : ''}number`), { status: 400, field: k });
        }
    }
    const translated = input.delta_x !== undefined || input.delta_y !== undefined;
    if (translated && !['x','y','delta_x','delta_y'].every(k=>Number.isFinite(input[k]))) throw Object.assign(new Error('A scene translation needs its anchor and both deltas'), {status:400});
    if (input.collapsed !== undefined && typeof input.collapsed !== 'boolean') throw Object.assign(new Error('collapsed must be true or false'), { status: 400, field: 'collapsed' });
    const prior = readGroupLayout(db, projectId).get(groupKey) || {};
    const dx = translated ? input.delta_x : input.x === undefined ? 0 : input.x - group.x, dy = translated ? input.delta_y : input.y === undefined ? 0 : input.y - group.y;
    // A member dragged left/up can expand the visible bounds. The automatic
    // layout anchor stays separate so resize/collapse never repositions nodes.
    const nextX = translated ? input.x : input.x === undefined ? prior.x ?? null : group.layout_x + dx;
    const nextY = translated ? input.y : input.y === undefined ? prior.y ?? null : group.layout_y + dy;
    db.transaction(() => {
        if (dx || dy) {
            const upsert = db.prepare(`INSERT INTO production_node_layout(project_id, node_key, x, y, pinned)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, node_key) DO UPDATE SET
                x = excluded.x, y = excluded.y, pinned = excluded.pinned, updated_at = datetime('now')`);
            const members = new Set(group.members);
            for (const node of graph.nodes) if (members.has(node.key)) upsert.run(projectId, node.key, node.x + dx, node.y + dy, node.pinned ? 1 : 0);
            // Projected cards have no creative rows. Translate their saved placements
            // by the same gesture delta, without pinning automatic real nodes.
            for(const [key,position] of readLayout(db,projectId))if(!members.has(key)&&members.has(layoutNodeOwner(db,graph,key)))upsert.run(projectId,key,position.x+dx,position.y+dy,position.pinned?1:0);
        }
        db.prepare(`INSERT INTO production_group_layout(project_id, group_key, collapsed, x, y, w, h)
            VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, group_key) DO UPDATE SET
            collapsed = excluded.collapsed, x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h, updated_at = datetime('now')`)
            .run(projectId, groupKey, (input.collapsed === undefined ? group.collapsed : input.collapsed) ? 1 : 0,
                nextX, nextY, input.w === undefined ? prior.w || null : input.w, input.h === undefined ? prior.h || null : input.h);
    }).immediate();
    return buildGraph(db, projectId).groups.find(g => g.key === groupKey);
}

// ── The graph ──────────────────────────────────────────────────────────────

/**
 * Everything the page draws, in one read.
 * @returns {{ nodes, edges, groups, running_order, meta }}
 */
function buildGraph(db, projectId) {
    const { ORDER_BY_SQL } = require('./running-order');
    const project = db.prepare('SELECT * FROM film_projects WHERE id = ?').get(projectId);
    if (!project) return null;
    const shots = db.prepare(
        `SELECT sh.*, s.scene_number, s.location, s.int_ext, s.time_of_day
           FROM film_shots sh JOIN film_scenes s ON s.id = sh.scene_id
          WHERE s.project_id = ? ORDER BY ${ORDER_BY_SQL}`).all(projectId);
    const sequences = db.prepare('SELECT * FROM film_sequences WHERE project_id = ? ORDER BY created_at').all(projectId);
    const cues = db.prepare('SELECT * FROM film_music_cues WHERE project_id = ? ORDER BY created_at, id').all(projectId);

    const nodes = [], edges = [];
    const edge = (from, fromPort, to, toPort, type, style) =>
        edges.push({ from, from_port: fromPort, to, to_port: toPort, type, style: style || 'solid' });

    // All real memberships survive. A canvas home and playback are separate.
    const owner = new Map();
    for (const q of sequences) for (const id of parseJson(q.shot_ids, [])) {
        if (!owner.has(id)) owner.set(id, []);
        if (!owner.get(id).includes(q.id)) owner.get(id).push(q.id);
    }

    const seqAssets = new Set();
    const seqData = new Map();
    for (const q of sequences) {
        const vids = sequenceVideos(db, q);
        vids.versions.forEach(v => seqAssets.add(v.asset_id));
        vids.legs.forEach(l => seqAssets.add(l.asset_id));
        seqData.set(q.id, vids);
    }

    // Previs decisions the director locked — shown on the node, read-only.
    const previs = new Map();
    try {
        for (const r of db.prepare(`SELECT b.shot_id, b.locked_parts_json, b.approved_fingerprint FROM film_previs_blocking b
                JOIN film_shots sh ON sh.id = b.shot_id JOIN film_scenes s ON s.id = sh.scene_id WHERE s.project_id = ?`).all(projectId)) {
            const locked = parseJson(r.locked_parts_json, []) || [];
            previs.set(r.shot_id, { locked: locked.length, approved: !!r.approved_fingerprint });
        }
    } catch (_) { /* a database before migration 116 has no locks to show */ }

    const shotNode = new Map();
    for (const sh of shots) {
        const card = parseJson(sh.scene_card_yaml, {}) || {};
        const frames = shotFrames(db, sh);
        const videos = shotVideos(db, sh, seqAssets);
        const sel = frames.find(f => f.selected) || null;
        const n = {
            key: `shot:${sh.id}`, type: 'shot', id: sh.id,
            shot_code: sh.shot_code, scene_id: sh.scene_id, scene_number: sh.scene_number,
            scene_label: `Sc ${sh.scene_number} · ${sh.location || ''}`.trim(),
            framing: (card.camera && card.camera.shot_type) || card.shot_type || '',
            duration_ms: Number(sh.duration_ms) || Number(card.duration_ms) || Math.round((Number(card.duration_seconds) || 0) * 1000) || 0,
            description: card.action || card.description || '',
            dialogue_lines: Array.isArray(card.dialogue) ? card.dialogue.length : 0,
            status: sh.status,
            // Compatibility primary plus all real memberships. Neither field
            // changes running_order or the selected clip's editorial coverage.
            sequence_id: (owner.get(sh.id) || [])[0] || null,
            sequence_ids: owner.get(sh.id) || [],
            frames, selected_frame: sel,
            videos, selected_video_asset_id: sh.selected_video_asset_id || null,
            state: frames.length ? 'ok' : 'no_frame',
            previs: previs.get(sh.id) || { locked: 0, approved: false },
            held: !!sh.held_at, held_at: sh.held_at || null,
        };
        nodes.push(n); shotNode.set(sh.id, n);
        for (const v of videos) {
            const vk = `ver:${v.asset_id}`;
            nodes.push({ key: vk, type: 'video', parent: n.key, parent_label: sh.shot_code, ...v });
            edge(n.key, 'video', vk, 'in', 'video', 'solid');
        }
        /*
         * What flows made for this shot (FOG-004): candidates, never counted as
         * the shot's own frames or clips and never selected unless a pointer
         * names them. An image sits on the shot as a frame version; a clip and
         * a sound are version nodes of their kind, wired from the shot.
         */
        n.flow_frames = [];
        n.flow_versions = [];
        for (const o of flowOutputsOf(db, sh.id)) {
            const url = urlFor(o.path, o.created_at);
            if (o.version === 'frame') {
                n.flow_frames.push({ ...o, url, source: 'flow', selected: false });
            } else if (o.version === 'clip' || o.version === 'sound') {
                const type = o.version === 'clip' ? 'video' : 'audio';
                const vk = `ver:${o.asset_id}`;
                const selected = type === 'video' && o.asset_id === sh.selected_video_asset_id;
                nodes.push({ key: vk, type, kind: type, parent: n.key, parent_label: sh.shot_code, source: 'flow',
                    asset_id: o.asset_id, as_type: o.as_type, url, path: o.path,
                    provider: o.provider, model: o.model, created_at: o.created_at,
                    flow_id: o.flow_id, apply_id: o.apply_id, run_id: o.run_id, flow_node: o.node, branch: o.branch, awaiting_pick: o.awaiting_pick,
                    version: null, selected });
                edge(n.key, type, vk, 'in', type, 'solid');
                n.flow_versions.push(vk);
            }
        }
    }

    const seqNode = new Map();
    for (const q of sequences) {
        const ids = [...new Set(parseJson(q.shot_ids, []))].filter(id => shotNode.has(id));
        const vids = seqData.get(q.id);
        const links = linkState(db, q);
        const members = ids.map(id => shotNode.get(id)).filter(Boolean);
        const n = {
            key: `seq:${q.id}`, type: 'sequence', id: q.id, name: q.name || 'Sequence',
            description: q.description || '',
            shot_ids: ids,
            shot_codes: members.map(m => m.shot_code),
            joins: parseJson(q.joins_json, []),
            duration_ms: members.reduce((t, m) => t + (m.duration_ms || 0), 0),
            links, videos: vids.versions, legs: vids.legs,
            selected_video_asset_id: q.selected_video_asset_id || null,
            ready: members.length > 0 && members.every(m => m.frames.length),
            status: q.status,
            held: !!q.held_at, held_at: q.held_at || null,
        };
        nodes.push(n); seqNode.set(q.id, n);
        members.forEach((m, i) => edge(m.key, 'image', n.key, `slot:${i}`, 'image', m.frames.length ? 'solid' : 'dotted'));
        for (const v of vids.versions) {
            const vk = `ver:${v.asset_id}`;
            nodes.push({ key: vk, type: 'video', parent: n.key, parent_label: n.name, ...v });
            edge(n.key, 'video', vk, 'in', 'video', 'solid');
        }
        for (const side of ['start', 'end']) {
            const l = links[side];
            if (!l) continue;
            const lk = `link:${q.id}:${side}`;
            nodes.push({ key: lk, type: 'link', sequence_id: q.id, side, ...l, stale: !!links.stale });
            edge(lk, 'frame', n.key, side === 'start' ? 'start' : 'endlink', 'image', 'dashed');
            if (l.source_sequence_id && seqNode.has(l.source_sequence_id)) {
                edge(`seq:${l.source_sequence_id}`, 'end', lk, 'in', 'image', 'dashed');
            }
        }
    }
    // Links to a sequence declared later in the list are wired now that it exists.
    for (const q of sequences) {
        for (const side of ['start', 'end']) {
            const l = seqNode.get(q.id).links[side];
            if (l && l.source_sequence_id && !edges.some(e => e.to === `link:${q.id}:${side}` && e.to_port === 'in')) {
                if (seqNode.has(l.source_sequence_id)) edge(`seq:${l.source_sequence_id}`, 'end', `link:${q.id}:${side}`, 'in', 'image', 'dashed');
            }
        }
    }

    const cueVersionMap = new Map();
    for (const c of cues) {
        const kind = SOUND_KIND[c.cue_type] || 'music';
        const versions = cueVersions(db, c);
        cueVersionMap.set(c.id, versions);
        const parentKey = c.sequence_id && seqNode.has(c.sequence_id) ? `seq:${c.sequence_id}`
            : c.shot_id && shotNode.has(c.shot_id) ? `shot:${c.shot_id}` : null;
        const n = {
            key: `sound:${c.id}`, type: 'sound', id: c.id, kind, cue_type: c.cue_type,
            title: c.title || '', description: c.description || '', mood: c.mood || '', genre: c.genre || '',
            negative_prompt: c.negative_prompt || '', duration_ms: Number(c.duration_ms) || 0,
            scene_id: c.scene_id, shot_id: c.shot_id, sequence_id: c.sequence_id,
            parent: parentKey, versions, selected_asset_id: c.generated_asset_id || null,
            held: !!c.held_at, held_at: c.held_at || null,
        };
        nodes.push(n);
        if (parentKey) edge(parentKey, 'scene', n.key, 'scene', 'scene', 'dashed');
        for (const v of versions) {
            const vk = `ver:${v.asset_id}`;
            nodes.push({ key: vk, type: 'audio', parent: n.key, parent_label: n.title || kind, ...v });
            edge(n.key, 'audio', vk, 'in', 'audio', 'solid');
        }
        if (!versions.length) edge(n.key, 'audio', null, null, 'audio', 'dotted');
    }

    // Editing state is separate from generation origins. Each edit track has
    // its own instance key even when several owners use the same source asset.
    for (const n of [...shotNode.values(), ...seqNode.values()]) {
        n.draft = recipes.readDraft(db, projectId, n.key);
        n.audio_tracks = recipes.readAudioTracks(db, projectId, n.key);
        for (const track of n.audio_tracks) {
            const key = `audio:${track.id}`;
            nodes.push({ key, type: 'audio', kind: 'audio', asset_id: track.asset_id,
                parent: n.key, parent_label: n.shot_code || n.name, relationship: 'timeline_audio',
                track_id: track.id, path: track.source.path, url: urlFor(track.source.path),
                duration_ms: track.duration_ms, source: track.source, track, selected: !track.muted });
            edges.push({ from: key, from_port: 'audio', to: n.key, to_port: 'sound',
                type: 'audio', style: 'solid', relationship: 'timeline_audio', label: 'Timeline audio' });
        }
    }

    // One independently movable group per scene. Membership is real sequence
    // data; a sequence spanning scenes has one home beside its first shot.
    const groups = [], placedSound = new Set();
    const scenes = db.prepare('SELECT id, scene_number, location FROM film_scenes WHERE project_id = ? ORDER BY scene_number, id').all(projectId);
    const sequenceHome = new Map();
    for (const q of sequences) {
        const first = shotNode.get(seqNode.get(q.id).shot_ids[0]);
        sequenceHome.set(q.id, first ? first.scene_id : null);
    }
    for (const scene of scenes) {
        const sceneShots = shots.filter(sh => sh.scene_id === scene.id), shotKeys = sceneShots.map(sh => `shot:${sh.id}`);
        const sceneSequences = sequences.filter(q => sequenceHome.get(q.id) === scene.id), sequenceKeys = sceneSequences.map(q => `seq:${q.id}`);
        const parentKeys = [...shotKeys, ...sequenceKeys];
        const sounds = cues.filter(c => (c.sequence_id ? sequenceKeys.includes(`seq:${c.sequence_id}`)
            : c.shot_id ? shotKeys.includes(`shot:${c.shot_id}`) : c.scene_id === scene.id))
            .map(c => ({ key: `sound:${c.id}`, versions: cueVersionMap.get(c.id).map(v => `ver:${v.asset_id}`) }));
        sounds.forEach(c => placedSound.add(c.key));
        // Put a sequence after its last member in this scene, retaining shot
        // narrative order while giving every sequence its own vertical row.
        const rows = [];
        for (const shot of sceneShots) {
            rows.push(`shot:${shot.id}`);
            for (const q of sceneSequences) {
                const members = seqNode.get(q.id).shot_ids.filter(id => shotNode.get(id).scene_id === scene.id);
                if (members[members.length - 1] === shot.id) rows.push(`seq:${q.id}`);
            }
        }
        const group = { id: `scene:${scene.id}`, scene_id: scene.id,
            label: `SC ${scene.scene_number} · ${(scene.location || '').toUpperCase()}`,
            shots: shotKeys, sequences: sequenceKeys, sequence: null, rows,
            links_start: sceneSequences.filter(q => seqNode.get(q.id).links.start).map(q => `link:${q.id}:start`),
            links_end: sceneSequences.filter(q => seqNode.get(q.id).links.end).map(q => `link:${q.id}:end`),
            versions: nodes.filter(n => (n.type === 'video' || n.source === 'flow') && parentKeys.includes(n.parent)).map(n => n.key),
            audio_tracks: nodes.filter(n => n.relationship === 'timeline_audio' && parentKeys.includes(n.parent)).map(n => n.key),
            sounds };
        groups.push(group);
    }
    const empty = sequences.filter(q => !sequenceHome.get(q.id));
    if (empty.length) {
        const sequenceKeys = empty.map(q => `seq:${q.id}`);
        const sounds = cues.filter(c => c.sequence_id && sequenceKeys.includes(`seq:${c.sequence_id}`))
            .map(c => ({ key: `sound:${c.id}`, versions: cueVersionMap.get(c.id).map(v => `ver:${v.asset_id}`) }));
        sounds.forEach(c => placedSound.add(c.key));
        groups.push({ id: 'unassigned-sequences', scene_id: null, label: 'UNASSIGNED SEQUENCES',
            shots: [], sequences: sequenceKeys, rows: sequenceKeys, sequence: null,
            links_start: empty.filter(q => seqNode.get(q.id).links.start).map(q => `link:${q.id}:start`),
            links_end: empty.filter(q => seqNode.get(q.id).links.end).map(q => `link:${q.id}:end`),
            versions: nodes.filter(n => sequenceKeys.includes(n.parent) && n.type === 'video').map(n => n.key),
            audio_tracks: nodes.filter(n => sequenceKeys.includes(n.parent) && n.relationship === 'timeline_audio').map(n => n.key), sounds });
    }
    /*
     * IN-BETWEENS between two key shots: a node in the group of the shot it
     * leaves from, wired from that shot's picture and on to the shot it arrives
     * at. The strip is the span's own frames, each at its second.
     */
    let spans = [];
    try { spans = db.prepare('SELECT id FROM film_inbetweens WHERE project_id = ? ORDER BY created_at').all(projectId); } catch (_) { spans = []; }
    for (const sp of spans) {
        let l = null;
        try { l = require('../routes/inbetweens').load(sp.id); } catch (_) { l = null; }
        if (!l || !shotNode.has(l.span.from_shot_id) || !shotNode.has(l.span.to_shot_id)) continue;
        const key = `ib:${sp.id}`;
        const urlOfKey = k => (k && k.frame ? urlFor(k.frame.file_path) : null);
        nodes.push({
            key, type: 'inbetween', id: sp.id,
            from_shot_id: l.span.from_shot_id, to_shot_id: l.span.to_shot_id,
            from_code: l.span.from_code, to_code: l.span.to_code, gap_ms: l.span.gap_ms,
            count: l.span.frames.length, made: l.span.frames.filter(f => f.asset_id).length,
            frames: [{ at_ms: 0, url: urlOfKey(l.from), key: true },
                ...l.span.frames.map(f => ({ at_ms: f.at_ms, url: f.url, directed: !!f.direction })),
                { at_ms: l.span.gap_ms, url: urlOfKey(l.to), key: true }],
            ranges: l.span.ranges.length, approval: l.approval, clip_asset_id: l.row.clip_asset_id || null,
        });
        edge(`shot:${l.span.from_shot_id}`, 'image', key, 'in', 'image', 'solid');
        edge(key, 'out', `shot:${l.span.to_shot_id}`, 'plates', 'image', 'dotted');
        const home = groups.find(g => (g.shots || []).includes(`shot:${l.span.from_shot_id}`)) || groups[0];
        if (home) home.versions = [key, ...(home.versions || [])];
    }
    const loose = nodes.filter(n => n.type === 'sound' && !placedSound.has(n.key));
    if (loose.length) {
        groups.push({ id: 'sounds', label: 'SOUNDS', shots: [], sequence: null, links_start: [], links_end: [], versions: [],
            sounds: loose.map(n => ({ key: n.key, versions: n.versions.map(v => `ver:${v.asset_id}`) })) });
    }

    const depth = require('./production-depth').graphProjection(db, projectId);
    nodes.push(...depth.nodes); edges.push(...depth.edges); groups.push(...depth.groups);
    const graph = { nodes, edges: edges.filter(e => e.to), groups };
    const collapsed = readCollapsed(db, projectId);
    const auto = autoLayout(graph, collapsed);
    const stored = readLayout(db, projectId);
    const savedGroups = readGroupLayout(db, projectId);
    const nodeGroup = new Map();
    for (const [i, group] of groups.entries()) {
        const saved = savedGroups.get(group.id), base = auto.groups[i];
        const shift = { x: saved && saved.x != null ? saved.x - base.x : 0,
            y: saved && saved.y != null ? saved.y - base.y : 0 };
        for (const key of groupMembers(group)) nodeGroup.set(key, shift);
    }
    for (const n of nodes) {
        const s = stored.get(n.key);
        const a = auto.positions[n.key] || { x: 40, y: 40 };
        const shift = nodeGroup.get(n.key) || { x: 0, y: 0 };
        // Unpinned rows are old automatic/group translations, not individual gestures.
        n.x = s && s.pinned ? s.x : a.x + shift.x; n.y = s && s.pinned ? s.y : a.y + shift.y;
        n.pinned = !!(s && s.pinned);
        n.w = (NODE_SIZE[n.type] || { w: 200 }).w; n.h = (NODE_SIZE[n.type] || { h: 120 }).h;
    }

    attachImpact(nodes, projectId);
    const running = runningWork(db, projectId);
    const byKey = new Map(nodes.map(n => [n.key, n]));
    const framed = nodes.filter(n => n.type === 'shot' && n.frames.length).length;
    const withVideo = nodes.filter(n => n.type === 'shot'
        && (n.videos.length || n.sequence_ids.some(id => seqNode.get(id).videos.length))).length;
    return {
        project_id: projectId,
        board_locked: !!project.board_locked_at,
        workspace_geometry: {nodes:Object.fromEntries(stored)},
        nodes, edges: graph.edges, groups: auto.groups.map((g, i) => {
            const model = graph.groups[i], members = groupMembers(model), saved = savedGroups.get(model.id) || {};
            const memberNodes = members.map(k => byKey.get(k)).filter(Boolean);
            const x = saved.x == null ? g.x : saved.x, y = saved.y == null ? g.y : saved.y;
            const left = Math.min(x, ...memberNodes.map(n => n.x - 20)), top = Math.min(y, ...memberNodes.map(n => n.y - 36));
            const width = Math.max(saved.w || 0, g.expanded_w || g.w, ...memberNodes.map(n => n.x + n.w + 20 - left));
            const height = Math.max(saved.h || 0, g.expanded_h || g.h, ...memberNodes.map(n => n.y + n.h + 20 - top));
            const shut = collapsed.has(model.id);
            return { ...g, key: model.id, scene_id: model.scene_id || null, rows: model.rows || [],
                sequences: model.sequences || [], x: left, y: top, layout_x: x, layout_y: y,
                w: shut ? COLLAPSED_GROUP.w : width, h: shut ? COLLAPSED_GROUP.h : height,
                expanded_w: width, expanded_h: height, minimum_w: saved.w || null, minimum_h: saved.h || null,
                manual_position: saved.x != null || saved.y != null,
                collapsed: shut, members,
                summary: groupSummary(members, byKey, running) };
        }),
        running_order: shots.map(s => s.id),
        running,
        meta: {
            shots: shots.length, framed, with_video: withVideo, need_frame: shots.length - framed,
            sequences: sequences.length, sounds: cues.length,
        },
    };
}

/**
 * IS THIS NODE BEHIND? (PGN-004)
 *
 * One rule per node type, all reading lib/impact.js graphStates — the same
 * walk the impact report makes, so the graph and the report cannot disagree.
 * `untracked` is said out loud: a file made outside the workflow has no input
 * fingerprint, and calling it current would be a guess dressed as a fact.
 */
const IMPACT_STATES = Object.freeze(['current', 'redo', 'waiting', 'never', 'untracked']);

const IMPACT_WHY = Object.freeze({
    card: 'The screenplay was revised after this shot\'s card was written.',
    redo: 'What it was generated from has changed, and everything above it is current.',
    waiting: 'Something it is built from is being redone; redo that first.',
    never: 'Nothing has been generated yet.',
    untracked: 'Made outside the workflow, so whether it is behind cannot be known.',
    link: 'The frame it borrows from another sequence has changed.',
    member: 'A shot in this sequence is behind; redo its frame first.',
});
/** What to DO about each state — shown beside the why, on the node and in the drawer (PGN-005). */
const IMPACT_ACTION = Object.freeze({
    redo: 'Regenerate this now.',
    waiting: 'Wait: redo what it is built from first, then this.',
    never: 'Generate it when you are ready.',
    untracked: 'Regenerate it through Film Engine if you want it tracked.',
});
const BADGE_STAGES = ['voice', 'lipsync', 'sfx', 'post'];
const out_ = (state, why, extra) => Object.assign({ state, why: why || IMPACT_WHY[state] || '', action: IMPACT_ACTION[state] || '' }, extra || {});
const stageState = s => (s === 'redo' || s === 'waiting' || s === 'current') ? s : null;
const assetOf = (id, ctx) => (id && ctx.assets && ctx.assets[id]) || null;
const SOUND_STAGE = { score: 'music', source: 'music', transition: 'music', ambient: 'ambient', sfx: 'sfx' };

const NODE_IMPACT = Object.freeze({
    shot(n, ctx) {
        const st = (ctx.shots && ctx.shots[n.id]) || {};
        const badges = BADGE_STAGES.map(stage => ({ stage, state: stageState(st[stage]) }))
            .filter(b => b.state === 'redo' || b.state === 'waiting');
        if (!n.frames || !n.frames.length) return out_('never', null, { badges });
        if (st.scene_card === 'redo') return out_('redo', IMPACT_WHY.card, { badges, cause: 'card' });
        const kf = stageState(st.keyframe);
        return out_(kf || 'untracked', null, { badges });
    },
    video(n, ctx) { return out_(assetOf(n.asset_id, ctx) || 'untracked'); },
    audio(n, ctx) { return out_(assetOf(n.asset_id, ctx) || 'untracked'); },
    sequence(n, ctx) {
        const links = n.links || {};
        if (links.stale) return out_('redo', IMPACT_WHY.link);
        const behind = (n.shot_ids || []).some(id => {
            const st = (ctx.shots && ctx.shots[id]) || {};
            return st.scene_card === 'redo' || st.keyframe === 'redo' || st.keyframe === 'waiting';
        });
        if (behind) return out_('waiting', IMPACT_WHY.member);
        if (!n.videos || !n.videos.length) return out_('never');
        return out_('current');
    },
    link(n) { return n.stale ? out_('redo', IMPACT_WHY.link) : out_('current'); },
    inbetween(n) {
        if (!n.made) return out_('never');
        if (n.approval && n.approval.stale) return out_('redo', 'The strip changed after it was approved.');
        if (n.made < n.count) return out_('waiting', `${n.count - n.made} of ${n.count} frames have no picture yet.`);
        return out_('current');
    },
    sound(n, ctx) {
        if (!n.selected_asset_id) return out_('never');
        const own = assetOf(n.selected_asset_id, ctx);
        if (own) return out_(own);
        const stage = SOUND_STAGE[n.cue_type];
        const sc = stage && ctx.scenes && ctx.scenes[n.scene_id] && stageState(ctx.scenes[n.scene_id][stage]);
        if (sc === 'waiting' || sc === 'redo') return out_(sc);
        return out_('untracked');
    },
});

/** Attach `impact` to every node. Never throws: a graph with no states is still a graph. */
function attachImpact(nodes, projectId) {
    let ctx = { shots: {}, scenes: {}, assets: {} };
    try { ctx = require('./impact').graphStates(projectId); } catch (_) { /* states unavailable */ }
    for (const n of nodes) {
        const rule = NODE_IMPACT[n.type];
        try { n.impact = rule ? rule(n, ctx) : out_('untracked'); } catch (_) { n.impact = out_('untracked'); }
    }
}

/**
 * WHAT IS RUNNING, AND ON WHICH NODE (PGN-003).
 *
 * A job row already says what it was for; these rules read that attribution
 * into a graph key, most specific first — a sequence leg is generated FOR a
 * shot, but the node that is running is the sequence. A job no rule places is
 * still listed, with no key, so nothing running is hidden.
 */
const RUNNING_RULES = Object.freeze([
    { id: 'music_cue', key: (j, m) => m.music_cue_id ? 'sound:' + m.music_cue_id : null },
    { id: 'sequence', key: (j, m) => m.sequence_id ? 'seq:' + m.sequence_id : null },
    { id: 'storyboard_frame', key: (j, m) => m.storyboard_frame && m.storyboard_frame.shot_id ? 'shot:' + m.storyboard_frame.shot_id : null },
    { id: 'shot', key: j => j.shot_id ? 'shot:' + j.shot_id : null },
]);

/**
 * A pending row is RUNNING only while something is still heard from it. A row
 * silent for longer than this is a job the caller stopped waiting for — that
 * belongs to the queue's "awaiting collection", not to a spinner that never
 * stops.
 */
const RUNNING_SILENCE_SEC = 180;

/** Which graph node a job row belongs to, by the attribution it carries (or null). */
function jobNodeKey(j) {
    let meta = {};
    try { meta = JSON.parse((j && j.meta) || '{}') || {}; } catch (_) { meta = {}; }
    for (const r of RUNNING_RULES) { const key = r.key(j || {}, meta); if (key) return key; }
    return null;
}

function runningWork(db, projectId) {
    try {
        if (!db || !projectId) return [];
        const rows = db.prepare(`SELECT * FROM film_generation_jobs
            WHERE project_id = ? AND status = 'pending'
              AND COALESCE(heartbeat_at, started_at, created_at) >= datetime('now', ?)
              AND NOT (json_valid(meta) AND COALESCE(json_extract(meta, '$.stopped_waiting'), 0))
            ORDER BY COALESCE(started_at, created_at)`).all(projectId, `-${RUNNING_SILENCE_SEC} seconds`);
        let registry = null;
        try { registry = require('./providers'); } catch (_) { registry = null; }
        return rows.map(j => {
            const key = jobNodeKey(j);
            const adapter = registry && registry.get(j.provider);
            return {
                job_id: j.id, key, provider: j.provider, capability: j.capability,
                percent: j.percent === null || j.percent === undefined ? null : Number(j.percent),
                phase: j.phase || null,
                started_at: j.started_at || j.created_at,
                heartbeat_at: j.heartbeat_at || null,
                reports: (adapter && adapter.reportsProgress) || 'none',
            };
        });
    } catch (_) { return []; }
}

/** Every node with no selected output yet, held or not. */
function pendingAll(graph) {
    const out = [];
    for (const n of graph.nodes) {
        if (n.type === 'shot' && !n.frames.length) out.push({ key: n.key, action: 'frame', label: n.shot_code, held: !!n.held });
        if (n.type === 'sound' && !n.selected_asset_id) out.push({ key: n.key, action: 'sound', label: n.title || n.kind, held: !!n.held });
    }
    return out;
}

/** What "Run pending" would make: nothing held (PGN-017). */
function pendingWork(graph) { return pendingAll(graph).filter(p => !p.held); }

/** What "Run pending" leaves alone because it is held, named on the confirmation. */
function pendingHeld(graph) { return pendingAll(graph).filter(p => p.held); }

module.exports = {    NODE_SIZE, LINK_MODES, SOUND_KIND,
    LAYOUT_NODE_KEY, layoutNodeOwner, referenceGeometryIdentity, workspaceLayout, layoutFingerprint, arrangeWorkspaceLayout,
    buildGraph, autoLayout, readLayout, readGroupLayout, saveGroupLayout, readCollapsed, groupMembers, COLLAPSED_GROUP, pendingWork, pendingHeld, runningWork, jobNodeKey, IMPACT_STATES, IMPACT_WHY, IMPACT_ACTION, NODE_IMPACT, attachImpact, RUNNING_RULES, RUNNING_SILENCE_SEC,
    shotFrames, shotVideos, sequenceVideos, cueVersions,
    resolveLinkedFrame, linkState, linkFingerprintOf, checkFrameRef,};
