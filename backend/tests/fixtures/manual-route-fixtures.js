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

    /*
     * async ({db, call, project, ids}) => [{ path, url, body }]
     *
     * The gated paths the app reviews through the planner (gated minus
     * route_reviewed): each body is the route's own request body as the client
     * sends it, and the test hands it to POST /final-request-review/prepare.
     */
    async plannerCases({ db, call, project, ids }) {
        const shots = db.prepare(`SELECT s.id, s.shot_code, s.scene_id FROM film_shots s JOIN film_scenes sc ON sc.id = s.scene_id
            WHERE sc.project_id = ? ORDER BY CAST(sc.scene_number AS INTEGER), s.sort_order, s.shot_code`).all(project);
        const [shotA, shotB, shotC, shotD, shotE, shotF] = shots;
        const cases = [];
        const add = (p, url, body) => cases.push({ path: p, url, body: body || {} });

        /*
         * Project settings, through their own routes.
         *
         * Aspect 16:9: the demo is 2.39:1, and a subject plate carries the
         * project's ratio as is (lib/reference-plates.js:1012, routes/locations.js:94,
         * 238), which the review refuses for MuAPI ("Unsupported MuAPI
         * aspect_ratio", lib/final-request-validation.js:109). Reported, not fixed here.
         *
         * Video sound silent: every Runway clip is built with generate_audio true
         * (lib/video-prompt.js:374), and gen4.5 takes no generated audio
         * (lib/providers/runway.js:813); "silent" is the project's own choice that
         * turns it off (lib/video-audio-policy.js:17).
         */
        ok(await call('PUT', `/projects/${project}`, { aspect_ratio: '16:9' }), 'project aspect');
        ok(await call('PUT', `/projects/${project}/video/audio-policy`, { video_audio_policy: 'silent' }), 'video audio policy');

        // An approved (imported) frame on the first six shots; a 6s clip on the first.
        const frames = [];
        for (const [i, s] of [shotA, shotB, shotC, shotD, shotE, shotF].entries())
            frames.push(ok(await call('POST', `/shots/${s.id}/storyboard/import`, { name: `frame-${i}.png`, data: pngUri(320, 180, [40 + i * 40, 90, 160]) }), `storyboard import ${i}`));
        ok(await call('POST', `/shots/${shotA.id}/media/video/import`, { name: 'take.mp4', data: mp4Uri(6) }), 'video import');
        ok(await call('POST', `/characters/${ids.characters}/refsheet/import`, { data: pngUri(256, 256), view: 'front', name: 'front.png' }), 'identity plate import');
        ok(await call('POST', `/locations/${ids.locations}/plate/import`, { data: pngUri(320, 180), name: 'plate.png' }), 'location plate import');

        // Subjects: the bodies the character / subject sheets send.
        add('/characters/ID/refsheet/generate', `/characters/${ids.characters}/refsheet/generate`, { views: ['front'] });
        add('/characters/ID/refsheet/orbit', `/characters/${ids.characters}/refsheet/orbit`, {});
        add('/locations/ID/plate/generate', `/locations/${ids.locations}/plate/generate`, {});
        add('/locations/ID/plate/refine', `/locations/${ids.locations}/plate/refine`, { instruction: 'add rain puddles reflecting the neon' });
        add('/locations/ID/plate/compass', `/locations/${ids.locations}/plate/compass`, {});
        add('/props/ID/plate/generate', `/props/${ids.props}/plate/generate`, {});

        // Board frames.
        add('/shots/ID/storyboard/regenerate', `/shots/${shotA.id}/storyboard/regenerate`, {});
        add('/shots/ID/storyboard/refine', `/shots/${shotA.id}/storyboard/refine`, { instruction: 'make the neon sign flicker brighter', use_anchor: false });
        // Recompose takes its background from a view of the scene's own location
        // (routes/storyboard.js:2690-2733): a shot whose scene names a location, and a plate with a view.
        const placed = db.prepare(`SELECT s.id AS shot_id, l.id AS location_id FROM film_shots s JOIN film_scenes sc ON sc.id = s.scene_id
            JOIN film_locations l ON l.project_id = sc.project_id AND LOWER(l.name) = LOWER(sc.location)
            WHERE sc.project_id = ? ORDER BY CAST(sc.scene_number AS INTEGER), s.sort_order, s.shot_code LIMIT 1`).get(project);
        if (![shotA, shotB, shotC, shotD, shotE, shotF].some(s => s.id === placed.shot_id))
            ok(await call('POST', `/shots/${placed.shot_id}/storyboard/import`, { name: 'frame-placed.png', data: pngUri(320, 180, [200, 60, 90]) }), 'storyboard import (recompose)');
        ok(await call('POST', `/locations/${placed.location_id}/plate/import`, { data: pngUri(320, 180, [10, 140, 120]), view: 'reverse', name: 'reverse.png' }), 'location view import (recompose)');
        add('/shots/ID/storyboard/recompose', `/shots/${placed.shot_id}/storyboard/recompose`, { instruction: 'frame the figure on the left third', background_view: 'reverse' });
        // The upscale dialog's own body (src/pages/storyboard/UpscaleFrameDialog.jsx:27).
        const up = ok(await call('GET', `/shots/${shotA.id}/storyboard-upscale/preview?resolution=2K&provider=muapi`), 'storyboard upscale preview');
        add('/shots/ID/storyboard-upscale', `/shots/${shotA.id}/storyboard-upscale`, { provider: 'muapi', resolution: '2K', plan_token: up.plan_token, confirmed: true, cost_unknown_ack: true });

        // Footage. The single clip names its model: the default production tier
        // (hailuo3) is refused, see the report on lib/video-prompt.js:409.
        add('/shots/ID/video/generate', `/shots/${shotA.id}/video/generate`, { model: 'gen4.5' });
        // The upscale dialog sends the chosen model (src/index.html:45688-45689).
        add('/shots/ID/post/upscale', `/shots/${shotA.id}/post/upscale`, { model: 'magnific-video-upscaler' });
        /*
         * /shots/ID/repair is left out: with the project's video on Runway it
         * cannot be prepared for any body (see the report). Its body would be the
         * player's (src/pages/playback/player.js:868): { start_sec: 1, end_sec: 5,
         * resolution } inside the 6s clip.
         */

        // Batches and pipelines (src/pages/pipeline/PipelinePage.jsx:133, src/index.html:15261-15265).
        add('/projects/ID/storyboard/generate/stream', `/projects/${project}/storyboard/generate/stream`, {});
        add('/projects/ID/video/batch/stream', `/projects/${project}/video/batch/stream`, {});
        add('/shots/ID/pipeline/run/stream', `/shots/${shotA.id}/pipeline/run/stream`, { strict: false });
        add('/scenes/ID/pipeline/run', `/scenes/${shotA.scene_id}/pipeline/run`, {});
        add('/projects/ID/pipeline/run', `/projects/${project}/pipeline/run`, {});

        // Sequences. A first-and-last-frame move needs a model that takes a last
        // frame (gen4.5 takes the first only: lib/providers/video-model-fields.json).
        const seq = ok(await call('POST', `/projects/${project}/sequences`, { name: 'Opening', shot_ids: [shotA.id, shotB.id] }), 'sequence create').sequence;
        add('/sequences/ID/generate', `/sequences/${seq.id}/generate`, { model: 'veo3.1' });
        /*
         * Native multi-shot takes 3–5 shots, 5–15 s in all (lib/providers/runway.js:1088-1093),
         * and no three demo shots are that short (the shortest are 5, 6 and 6 s).
         * Three 4 s shots are written into the last scene through POST /shots.
         */
        const lastScene = db.prepare('SELECT id FROM film_scenes WHERE project_id = ? ORDER BY CAST(scene_number AS INTEGER) DESC LIMIT 1').get(project).id;
        const quick = ok(await call('POST', '/shots', { scene_id: lastScene, cards: [
            { shot_code: 'SC07-SH03', duration_ms: 4000, description: 'Kai turns from the window, rain streaking the glass behind him' },
            { shot_code: 'SC07-SH04', duration_ms: 4000, description: 'Close on the implant photo pinned to the evidence board' },
            { shot_code: 'SC07-SH05', duration_ms: 4000, description: 'Kai pulls on his coat and walks out into the neon corridor' },
        ] }), 'shots create (native)').shots;
        for (const [i, s] of quick.entries())
            ok(await call('POST', `/shots/${s.id}/storyboard/import`, { name: `quick-${i}.png`, data: pngUri(320, 180, [150, 40 + i * 50, 70]) }), `storyboard import (native ${i})`);
        const multi = ok(await call('POST', `/projects/${project}/sequences`, { name: 'Run of three', shot_ids: quick.map(s => s.id) }), 'sequence create (native)').sequence;
        add('/sequences/ID/generate-native', `/sequences/${multi.id}/generate-native`, {});
        /*
         * A strip has stations only where the camera moves, read from
         * card.camera.movement (lib/shot-motion.js:281); the demo writes
         * camera_movement, which nothing reads, and PUT /shots/:id refuses to
         * edit a demo card, so the move is written to the card directly (as in
         * generationCases above). Its own shot: a sequence takes its shots from
         * any other (move: true), which would leave the native one short.
         */
        {
            const row = db.prepare('SELECT scene_card_yaml FROM film_shots WHERE id = ?').get(shotF.id);
            let card = {}; try { card = JSON.parse(row.scene_card_yaml || '{}'); } catch (_) { card = {}; }
            card.camera = { ...(card.camera && typeof card.camera === 'object' ? card.camera : {}), movement: 'dolly-in' };
            db.prepare('UPDATE film_shots SET scene_card_yaml = ?, duration_ms = 4000 WHERE id = ?').run(JSON.stringify(card), shotF.id);
        }
        const strip = ok(await call('POST', `/projects/${project}/sequences`, { name: 'Push in', shot_ids: [shotF.id], move: true }), 'sequence create (strip)').sequence;
        add('/sequences/ID/inbetweens', `/sequences/${strip.id}/inbetweens`, {});

        // In-betweens: frames still to make, for the frame chain.
        const span = ok(await call('POST', `/projects/${project}/inbetweens`, { from_shot_id: shotB.id, to_shot_id: shotC.id, count: 2 }), 'inbetween span');
        add('/inbetweens/ID/generate', `/inbetweens/${span.id}/generate`, {});
        /*
         * And a span whose one frame has its picture, for the clip. Only a
         * generation makes a take (routes/inbetweens.js:248-266), and the manual
         * hand-over refuses an in-between image (lib/image-handoff.js:19), so the
         * take is written as that generation writes it.
         */
        const made = ok(await call('POST', `/projects/${project}/inbetweens`, { from_shot_id: shotA.id, to_shot_id: shotB.id, count: 1 }), 'inbetween span (made)');
        {
            const dir = path.dirname(db.prepare('SELECT file_path FROM film_assets WHERE id = ?').get(frames[0].asset_id).file_path);
            const fileName = `inbetween-${made.id}.ib01.png`, filePath = path.join(dir, fileName), bytes = png(320, 180, [90, 90, 200]);
            fs.writeFileSync(filePath, bytes);
            const at = made.frames[0].at_ms, assetId = require('crypto').randomUUID();
            db.prepare(`INSERT INTO film_assets (id, project_id, shot_id, asset_type, file_path, file_name, format, mime_type, size_bytes, provider, metadata)
                VALUES (?, ?, ?, 'other', ?, ?, 'png', 'image/png', ?, NULL, ?)`).run(assetId, project, shotA.id, filePath, fileName, bytes.length,
                JSON.stringify({ kind: 'inbetween_frame', inbetween_id: made.id, at_ms: at, frame_index: 0, direction: '', from_shot_id: shotA.id, to_shot_id: shotB.id }));
            db.prepare('UPDATE film_inbetweens SET frames_json = ? WHERE id = ?').run(JSON.stringify([{ at_ms: at, direction: '', asset_id: assetId }]), made.id);
        }
        // Two legs, each from one picture to the next: a model that takes a last frame.
        add('/inbetweens/ID/video', `/inbetweens/${made.id}/video`, { model: 'veo3.1' });

        // Flows: the shot-to-clip template, run on a shot and applied to another
        // with the apply plan's fingerprint (src/index.html:24392).
        const flow = ok(await call('POST', `/projects/${project}/flows/from-template`, { template_id: 'shot-to-clip', shot_id: shotA.id, scene_id: shotA.scene_id }), 'flow create');
        add('/flows/ID/run', `/flows/${flow.id}/run`, { shot_id: shotA.id });
        const plan = ok(await call('GET', `/flows/${flow.id}/apply-plan?project_id=${project}&targets=${encodeURIComponent('shot:' + shotB.id)}`), 'flow apply plan');
        add('/flows/ID/apply', `/flows/${flow.id}/apply`, { project_id: project, targets: ['shot:' + shotB.id], fingerprint: plan.fingerprint });
        // Repair with the player's own body (src/pages/playback/player.js): the project
        // pins video to Runway, which must still produce the hand-over review.
        add('/shots/ID/repair', `/shots/${shotA.id}/repair`, { start_sec: 1, end_sec: 5, resolution: '480p' });
        return cases;
    },

    /* Planner-set paths that do not reach a manual vendor's review, each with why. */
    NOT_MANUAL_PLANNER: [
        { path: '/projects/ID/models/batch/stream', reason: 'not a generation: the route answers 428 for every request (routes/threed.js:707-708, "3D batch requires per-subject approved native execution") and the planner refuses it the same way (lib/final-threed-request-plans.js:14); each subject is generated, and reviewed, through /characters|props|locations/:id/model/generate' },
    ],

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
