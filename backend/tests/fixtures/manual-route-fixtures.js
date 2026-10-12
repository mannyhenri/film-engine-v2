'use strict';
/*
 * Manual-route fixtures: for each route-reviewed generation path, the state and
 * request body that carry the real route all the way to a manual vendor's final
 * review (the answer names FINAL_REQUEST_REVIEW_REQUIRED:<id>), and the paths in
 * the inventory that are not manual-vendor generation at all, each with why.
 *
 * Rows are made through the real routes (imports, card edits, cue and session
 * creation). The db is written directly only where no route can produce the
 * state (a stamped, stale frame: only a generation stamps one).
 *
 * Every media file is made locally (a PNG encoded here, an MP4 from the local
 * ffmpeg, a GLB header); nothing reaches the network.
 */
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { execFileSync } = require('child_process');

// ── Local media ─────────────────────────────────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
/** A real, decodable RGB PNG (a soft gradient, so it is not a blank frame). */
function png(width = 64, height = 36, tint = [40, 90, 160]) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 3 + 1)] = 0;
        for (let x = 0; x < width; x++) {
            const o = y * (width * 3 + 1) + 1 + x * 3;
            raw[o] = (tint[0] + x * 2) & 255; raw[o + 1] = (tint[1] + y * 3) & 255; raw[o + 2] = tint[2];
        }
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngUri = (...a) => 'data:image/png;base64,' + png(...a).toString('base64');
/** A real 4-second H.264 clip from the local ffmpeg (aleph2 takes 2–10s). */
function mp4Uri(seconds = 4) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-fixture-clip-')), out = path.join(dir, 'clip.mp4');
    try {
        execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=24:duration=${seconds}`,
            '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-y', out]);
        return 'data:video/mp4;base64,' + fs.readFileSync(out).toString('base64');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
/** A valid binary glTF holding one triangle mesh. */
function glbUri() {
    const bin = Buffer.alloc(36);
    [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4));
    const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }] };
    let json = Buffer.from(JSON.stringify(gltf));
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
    const head = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4, 'ascii'); return b; };
    const total = 12 + 8 + json.length + 8 + bin.length;
    const header = Buffer.alloc(12); header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
    return 'data:model/gltf-binary;base64,' + Buffer.concat([header, head(json.length, 'JSON'), json, head(bin.length, 'BIN\0'), bin]).toString('base64');
}

const ok = (out, what) => {
    if (typeof out.status !== 'number' || out.status >= 300) throw new Error(`fixture setup failed at ${what}: ${out.status} ${String(out.text).slice(0, 300)}`);
    try { return JSON.parse(out.text); } catch (_) { return {}; }
};
const MARKER = /FINAL_REQUEST_REVIEW_REQUIRED:([0-9a-f-]{8,})/i;

/** For a route that starts a background run and answers 202 at once: wait for the run row, return its text. */
function awaitRun(projectId) {
    return async (out, call) => {
        let runId = null; try { runId = JSON.parse(out.text).run_id; } catch (_) { runId = null; }
        if (!runId) return out;
        for (let i = 0; i < 100; i++) {
            const run = await call('GET', `/projects/${projectId}/production-graph/run-changed/${runId}`, {});
            if (MARKER.test(run.text) || !/"status":"running"|"status":"queued"/.test(run.text)) return run;
            await new Promise(r => setTimeout(r, 50));
        }
        return call('GET', `/projects/${projectId}/production-graph/run-changed/${runId}`, {});
    };
}

module.exports = {
    MARKER,
    /*
     * async ({db, call, project, ids}) => [{ path, method, url, body, followUp? }]
     *
     * `path` is the inventory pattern, `url` the concrete one. `followUp`, when
     * present, is `async (out, call) => {status, text}`: the route answers 202
     * and the review is recorded on the background run it started, so the text
     * to check is the run row's. `env`, when present, is set on process.env for
     * that call only (and restored after).
     */
    async generationCases({ db, call, project, ids }) {
        const cases = [];
        const shots = db.prepare(`SELECT s.id, s.shot_code, s.scene_id FROM film_shots s JOIN film_scenes sc ON sc.id = s.scene_id
            WHERE sc.project_id = ? ORDER BY CAST(sc.scene_number AS INTEGER), s.sort_order, s.shot_code`).all(project);
        const [shotA, shotB, , shotD] = shots;
        const add = (method, p, url, body, extra) => cases.push({ path: p, method, url, body: body || {}, ...(extra || {}) });

        /*
         * The demo writes each card's dialogue as one string ("KAI: Nakamura. ...")
         * where every reader expects a list of { character, line }: extractDialogue
         * (lib/dialogue-builder.js:21) finds no lines in it, and the score-session
         * context (lib/music-context.js:176) throws on it. PUT /shots/:id cannot
         * repair it: it re-validates the whole card, and the demo's cards fail
         * validation (no shot_code, lighting as a string) on fields the route
         * cannot edit. So the list is written to the card directly.
         */
        let firstWithDialogue = null;
        for (const s of db.prepare(`SELECT s.id, s.scene_card_yaml FROM film_shots s JOIN film_scenes sc ON sc.id = s.scene_id
            WHERE sc.project_id = ? ORDER BY CAST(sc.scene_number AS INTEGER), s.sort_order, s.shot_code`).all(project)) {
            let card = {}; try { card = JSON.parse(s.scene_card_yaml || '{}'); } catch (_) { card = {}; }
            if (typeof card.dialogue !== 'string') continue;
            card.dialogue = card.dialogue.split(/\n+/).map(t => t.match(/^\s*([^:]+):\s*(.+)$/)).filter(Boolean)
                .map(m => ({ character: m[1].trim(), line: m[2].trim(), emotion: 'neutral' }));
            db.prepare('UPDATE film_shots SET scene_card_yaml = ? WHERE id = ?').run(JSON.stringify(card), s.id);
            if (card.dialogue.length && !firstWithDialogue) firstWithDialogue = s.id;
        }

        // 14 · Character explore: reaches the review as it stands.
        add('POST', '/characters/ID/explore', `/characters/${ids.characters}/explore`, { count: 1 });

        // 15 · Already reaching the review.
        add('POST', '/projects/ID/sounds/generate', `/projects/${project}/sounds/generate`, { prompt: 'Rain drumming on a tin roof, distant thunder' });
        add('POST', '/scenes/ID/ambient/generate', `/scenes/${ids.scenes}/ambient/generate`, {});
        add('POST', '/scenes/ID/music/generate', `/scenes/${ids.scenes}/music/generate`, {});
        add('POST', '/shots/ID/storyboard/angles', `/shots/${shotA.id}/storyboard/angles`, {});

        // 2 · Marketing: a planned poster with its own prompt.
        const poster = ok(await call('POST', `/projects/${project}/marketing`, { type: 'poster', title: 'Neon Requiem — teaser',
            prompt: 'Teaser poster: a lone figure under a flickering neon sign in rain-slick streets, title NEON REQUIEM', aspect_ratio: '2:3' }), 'marketing create');
        add('POST', '/marketing/ID/generate', `/marketing/${poster.id}/generate`, {});

        // 4 · A score cue written on the first scene.
        const cue = ok(await call('POST', `/projects/${project}/music-cues`, { scene_id: ids.scenes, cue_type: 'score', title: 'Opening pulse',
            description: 'Low analog synth pulse under rain, slowly building tension', mood: 'tense', genre: 'synthwave', duration_ms: 30000 }), 'music cue create');
        add('POST', '/music-cues/ID/generate', `/music-cues/${cue.id}/generate`, {});

        // 6 · A score session generating a composition.
        const session = ok(await call('POST', `/projects/${project}/music-sessions`, { name: 'Main titles', scene_id: ids.scenes }), 'music session create');
        const sessionId = session.id || (session.session && session.session.id);
        add('POST', '/music-sessions/ID/generate', `/music-sessions/${sessionId}/generate`, {
            workflow: 'music_compose', prompt: 'Brooding synthwave main title, slow build, rain ambience', duration_ms: 30000, ignore_emotion: true });

        // 7 · The project music batch (SSE): its stream names the review per scene.
        add('POST', '/projects/ID/music/batch/stream', `/projects/${project}/music/batch/stream`, {});

        // 8, 9 · Dialogue: the demo's own lines, as a list (above).
        add('POST', '/shots/ID/voice/generate', `/shots/${firstWithDialogue}/voice/generate`, {});
        add('POST', '/projects/ID/voice/batch', `/projects/${project}/voice/batch`, {});

        // 10 · A sequence over a shot with an approved (imported) frame; station 1 rewritten.
        /*
         * A strip has stations only where the camera moves, and the move is read from
         * card.camera.movement (lib/shot-motion.js:281). The demo writes
         * camera_movement at the top of the card, which nothing reads, and PUT /shots/:id
         * refuses to edit a demo card (it fails validation on shot_code and lighting),
         * so the move is written to the card directly.
         */
        {
            const row = db.prepare('SELECT scene_card_yaml FROM film_shots WHERE id = ?').get(shotB.id);
            let card = {}; try { card = JSON.parse(row.scene_card_yaml || '{}'); } catch (_) { card = {}; }
            card.camera = { ...(card.camera && typeof card.camera === 'object' ? card.camera : {}), movement: 'dolly-in' };
            db.prepare('UPDATE film_shots SET scene_card_yaml = ?, duration_ms = 4000 WHERE id = ?').run(JSON.stringify(card), shotB.id);
        }
        ok(await call('POST', `/shots/${shotB.id}/storyboard/import`, { name: 'frame.png', data: pngUri(320, 180) }), 'storyboard import (sequence)');
        const seq = ok(await call('POST', `/projects/${project}/sequences`, { name: 'Alley walk', shot_ids: [shotB.id], move: true }), 'sequence create').sequence;
        add('PUT', '/sequences/ID/stations/ID/ID', `/sequences/${seq.id}/stations/${shotB.id}/1`, {});

        // 13a · Run to here on a shot with no frame: its keyframe step runs through executeStep.
        add('POST', '/projects/ID/production-graph/nodes/ID/run-to-here',
            `/projects/${project}/production-graph/nodes/${encodeURIComponent('shot:' + shotD.id)}/run-to-here`, {},
            { followUp: awaitRun(project) });

        // 13b · Run what changed: a stamped frame whose inputs moved is "redo". Only a
        // generation stamps a frame, so the stamp is written here on an imported one.
        const frame = ok(await call('POST', `/shots/${shotA.id}/storyboard/import`, { name: 'frame-a.png', data: pngUri(320, 180, [120, 40, 60]) }), 'storyboard import (run-changed)');
        db.prepare("UPDATE film_assets SET artefact_kind = 'keyframe', input_fingerprint = 'stale-fixture-fingerprint' WHERE id = ?").run(frame.asset_id);
        add('POST', '/projects/ID/production-graph/run-changed', `/projects/${project}/production-graph/run-changed`, {},
            { followUp: awaitRun(project) });

        return cases.concat(await module.exports.plannerAndFixedCases({ db, call, project, ids }));
    },

    /*
     * Generation routes that needed fixes to reach a manual review: rig (job kind,
     * model_url), background replacement (no public link for a manual vendor, the
     * project's own pin, no generated-audio setting on a footage edit). Expressions
     * is reviewed through the planner, which is the path the app's bridge takes for
     * it (POST /final-request-review/prepare with the slot's revision).
     */
    async plannerAndFixedCases({ db, call, project, ids }) {
        const plate = ok(await call('POST', `/characters/${ids.characters}/refsheet/import`, { data: pngUri(256, 256), view: 'front', name: 'front.png' }), 'identity plate import');
        const mesh = ok(await call('POST', `/projects/${project}/models/import`, { name: 'cipher.glb', data: glbUri() }), 'model import');
        const shot = db.prepare(`SELECT s.id FROM film_shots s JOIN film_scenes sc ON sc.id = s.scene_id WHERE sc.project_id = ?
            ORDER BY CAST(sc.scene_number AS INTEGER), s.sort_order, s.shot_code LIMIT 1 OFFSET 2`).get(project);
        ok(await call('POST', `/shots/${shot.id}/media/video/import`, { name: 'take.mp4', data: mp4Uri(4) }), 'video import');
        return [
            { path: '/characters/ID/expressions/ID/generate', method: 'POST', url: `/characters/${ids.characters}/expressions/slot-2/generate`, body: { revision: 0 },
                planner: { method: 'POST', url: '/final-request-review/prepare', body: { path: `/characters/${ids.characters}/expressions/slot-2/generate`, body: { revision: 0 } } },
                identity_asset_id: plate.asset_id },
            { path: '/models/ID/rig', method: 'POST', url: `/models/${mesh.asset_id}/rig`, body: { skeleton: 'humanoid' } },
            { path: '/shots/ID/video/background/generate', method: 'POST', url: `/shots/${shot.id}/video/background/generate`,
                body: { instruction: 'a rain-soaked neon alley at night, steam rising from grates' } },
        ];
    },

    /* Routes in the inventory that legitimately do not reach a manual vendor's review. */
    NOT_MANUAL_GENERATION: [
        { path: '/backups/folder/run', method: 'POST', reason: 'local: writes a database snapshot to the chosen folder (routes/backups.js:43, lib/backup-folder.js); no provider' },
        { path: '/characters/ID/refsheet/import', method: 'POST', reason: 'import: stores an uploaded plate through importMedia(\'character-plate\') (routes/characters.js:111-115); no provider' },
        { path: '/locations/ID/plate/import', method: 'POST', reason: 'import: importSubjectPlateRoute -> importMedia(\'location-plate\') (routes/locations.js:893, 464-473); no provider' },
        { path: '/props/ID/plate/import', method: 'POST', reason: 'import: importSubjectPlateRoute -> importMedia(\'prop-plate\') (routes/locations.js:914, 464-473); no provider' },
        { path: '/inbetweens/ID/frames/ID/select', method: 'POST', reason: 'editorial: selectTake moves a pointer in frames_json (routes/inbetweens.js:278-290); no provider' },
        { path: '/sequences/ID/inbetweens/approve', method: 'POST', reason: 'editorial: approveStrip fingerprints the strip as it stands (routes/sequences.js:829-850); no provider' },
        { path: '/sequences/ID/stitch', method: 'POST', reason: 'local: stitchSequence joins existing clips with the local ffmpeg (routes/sequences.js:1522-1558); no provider' },
        { path: '/shots/ID/video/stitch', method: 'POST', reason: 'kept Gridlight: stitchVideo generates and joins clips through callGridlight(VIDEO_ENDPOINT / STITCH_ENDPOINT) (routes/video-gen.js:1176, 1211), never the provider registry' },
        { path: '/shots/ID/lipsync/generate', method: 'POST', reason: 'kept Gridlight: only lib/providers/gridlight-adapter.js:43 declares lipsync, and routes/lipsync.js:32-36 falls back to get(\'gridlight\')' },
        { path: '/previz-workspace/explore', method: 'POST', reason: 'local: exploreWorkspace evaluates cameras with lib/cinematography against the set (routes/previz-workspace.js:13-25, 35); no provider' },
        { path: '/projects/ID/inbetweens', method: 'POST', reason: 'plans only: create inserts a film_inbetweens span of evenly timed empty frames (routes/inbetweens.js:123-144); generation is POST /inbetweens/:id/generate' },
        { path: '/music-sessions/ID/batch', method: 'POST', reason: 'editorial: runBatch applies create/update/delete ops on session children in one transaction (routes/music-sessions.js:418-456); no provider' },
        { path: '/models/batch/stream', method: 'POST', reason: 'not a route: a fragment of /projects/:id/models/batch/stream (src/index.html:22046); /film/models/batch/stream is refused as "Invalid asset ID" (routes/threed.js:175-176)' },
        { path: '/shots/ID/post/upscale/previewID', method: 'POST', reason: 'not a route: a fragment of the GET preview `/shots/${shotId}/post/upscale/preview${q}` (src/components/VideoPipeline/engine.js:465; routes/post-production.js:57)' },
    ],
};
