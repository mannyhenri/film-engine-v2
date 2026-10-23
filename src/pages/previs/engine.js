/*
 * The 3D stage engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. The two 3D pages: Previs, the World Engine console (the views of a world, the camera, lights, staging and paths, set builds, scouting, the plan, the move timeline and its export) and the 3D models page. MOVED from the legacy stage3d chunk (generated from film-engine's page). React renders the two pages; this draws into them by id, as before. Its document and window listeners are bound by mount.js while the Previs page is mounted.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { previzWorkspace } from '../../lib/previz-workspace.js';
import { legacy, setLegacy } from '../../lib/legacy.js';

// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:
// a line reading `const esc = …` would be the first definition a backend test finds when it searches the page.
const {
    _shotAction,
    api,
    checkUploadSize,
    closeModal,
    confirmPaidImage,
    esc,
    jsAttr,
    mediaUrl,
    previsAspect,
    setStatus,
    showModal,
    showModalHtml,
    streamSSEPost,
} = Object.fromEntries([
    '_shotAction',
    'api',
    'checkUploadSize',
    'closeModal',
    'confirmPaidImage',
    'esc',
    'jsAttr',
    'mediaUrl',
    'previsAspect',
    'setStatus',
    'showModal',
    'showModalHtml',
    'streamSSEPost',
].map(n => [n, (...a) => legacy[n](...a)]));
const live = (name) => new Proxy({}, {
    get: (_, k) => legacy[name][k],
    set: (_, k, v) => { legacy[name][k] = v; return true; },
    has: (_, k) => k in legacy[name],
    ownKeys: () => Reflect.ownKeys(legacy[name]),
    getOwnPropertyDescriptor: (_, k) => { const d = Reflect.getOwnPropertyDescriptor(legacy[name], k); if (d) d.configurable = true; return d; },
    deleteProperty: (_, k) => delete legacy[name][k],
});
// Core's objects, as live proxies, in one destructuring statement for the same reason.
const { AI_PATH, WALK, WORLD, state } = Object.fromEntries(['AI_PATH', 'WALK', 'WORLD', 'state'].map(n => [n, live(n)]));
// Core's values, read live as legacy.X and assigned with setLegacy: API_BASE.

    // ══════════════════════════════════════════════════════════════
    // NAVIGATION
    // ══════════════════════════════════════════════════════════════
    // ── Previs ────────────────────────────────────────────────────────────
    //
    // The old stage (inspector, grey-box canvas, toolbar) was removed; the
    // Previs page is the World Engine console. What survives is the one thing
    // the console reads from here — the vocabulary GET /film/previs/taxonomy
    // serves, which its timeline names moves from — and the projection maths
    // below it (previsProject, previsAim, previsFrameView, previsFullView).
    const PREVIS = { taxonomy: null };

    const P_DEG = Math.PI / 180;

    async function loadPrevisPage() {
        /*
         * The Previs page IS the World Engine console. The old stage below it
         * — the inspector, the grey-box canvas, the twelve-button toolbar — was
         * removed; the blocking it wrote is still read by generation, and the
         * console reads and writes it through /shots/:id/previs.
         *
         * The console loads its OWN shots. worldLoadShots existed and nothing
         * called it: the rail was always empty and the old stage's dropdown
         * was the only way to pick a shot.
         */
        await worldLoadFlags();
        const note = document.getElementById('previsConsoleOff');
        if (note) note.style.display = worldEngineOn() ? 'none' : '';
        if (!state.currentProject || !worldEngineOn()) return worldConsoleRender();
        try { if (!PREVIS.taxonomy) PREVIS.taxonomy = await api('/previs/taxonomy'); } catch (_) { /* the timeline shows its moves without it */ }
        await Promise.all([worldLoadShots(state.currentProject.id), worldLoadScoutable(state.currentProject.id)]);
        const shots = WORLD.shots || [];
        if (WORLD.scout && (WORLD.scoutable || []).some(w => w.world.id === WORLD.scout.worldId)) {
            return worldScoutSelect(WORLD.scout.worldId);
        }
        const pick = WORLD.shotId && shots.some(s => s.id === WORLD.shotId) ? WORLD.shotId : null;
        if ((WORLD.scoutable || []).length) return worldScoutSelect(WORLD.scoutable[0].world.id);
        if (pick) await worldRailSelect(pick);
        // No shot yet, but a location has a set (a phone scan, a Blender
        // build): open it to walk, rather than a console with nothing in it.
        else if ((WORLD.scoutable || []).length) await worldScoutSelect(WORLD.scoutable[0].world.id);
        else worldConsoleRender();
    }

    // ── Maths ────────────────────────────────────────────────────────────
    const pSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

    const pCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

    const pDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    function pNorm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

    /**
     * World -> screen for one eye.
     *
     * A view basis built from eye/target, then a perspective divide. vFovDeg is
     * where the optics enter: the camera pane is given the REAL vertical angle
     * of view for its lens and sensor, which is what makes the two panes
     * disagree in exactly the way a longer lens does.
     */
    function previsProject(point, eye, target, vFovDeg, view) {
        const forward = pNorm(pSub(target, eye));
        /*
         * The near-vertical fallback the SERVER's basis() and this file's own
         * previsGroundPoint both carry, and this — the forward projection —
         * did not. Looking straight down makes forward parallel to the up
         * reference, the cross product collapses, and every projected point
         * comes back NaN. It degenerated on the client only, which is exactly
         * the case the TOP view preset asks for.
         */
        const reference = Math.abs(forward[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
        const right = pNorm(pCross(forward, reference));
        const up = pCross(right, forward);

        const d = pSub(point, eye);
        const x = pDot(d, right);
        const y = pDot(d, up);
        const z = pDot(d, forward);
        if (z <= 0.02) return null;                     // behind the eye

        // Projected into `view` — a rect, not the canvas. The camera pane's
        // shape is a layout accident; the SHOT's shape is the project's aspect
        // ratio, and squeezing the image to the pane would make a 2.39:1
        // composition unreadable in a portrait column.
        const f = 1 / Math.tan(vFovDeg * P_DEG / 2);
        const aspect = view.w / view.h;
        return {
            x: view.x + (x / z) * (f / aspect) * view.w / 2 + view.w / 2,
            y: view.y - (y / z) * f * view.h / 2 + view.h / 2,
            z,
        };
    }

    /** The whole canvas, as a viewport rect. */
    function previsFullView(canvas) {
        return { x: 0, y: 0, w: canvas.width, h: canvas.height };
    }

    /** The largest rect inside the canvas at the project's aspect ratio. */
    function previsFrameView(canvas) {
        const ratio = previsAspect();
        let w = canvas.width;
        let h = w / ratio;
        if (h > canvas.height) { h = canvas.height; w = h * ratio; }
        return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
    }

    /**
     * Where a camera at `pose` is looking — yaw/pitch applied to -Z.
     *
     * The X term was +sin(yaw) and the whole rest of the engine turns the other
     * way: yawVector — which samplePath's orbit, analyzePath's naming and
     * solveShot's azimuth all go through — has +yaw turning toward -X. So
     * pressing pan-left swung this pane RIGHT while the provider was told
     * pan-left, and a shot solved at an azimuth pointed the camera away from
     * its own subject. Dragging the camera was written for the library's
     * convention too, so the pane also turned the wrong way under the mouse.
     *
     * Held to lib/shot-motion.js aimVector by test, because a mirrored camera
     * looks perfectly plausible until you compare it with the shot you get.
     */
    function previsAim(pose) {
        const yaw = (pose.rotation[0] || 0) * P_DEG;
        const pitch = (pose.rotation[1] || 0) * P_DEG;
        const dir = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
        return [pose.position[0] + dir[0] * 5, pose.position[1] + dir[1] * 5, pose.position[2] + dir[2] * 5];
    }

    /**
     * Reorder the sidebar into production phases.
     *
     * The existing nav buttons are MOVED rather than rebuilt: every tooltip,
     * icon and handler already in the markup survives, and only the grouping
     * and the order come from the server. Rebuilding them would mean a second
     * copy of the nav, and two copies drift.
     *
     * Order comes from GET /film/nav-flow, which derives it from the same
     * PROJECT_PHASES the status machine advances a project through — so the
     * menu and the phase a project reports itself in cannot disagree.
     */
    /* ══ World Engine console (phase 2) ══════════════════════════════════════
     *
     * The previs screen, redesigned around the question a director is actually
     * asking: how does this change the shot I am looking at. The camera frame
     * is the hero; everything else supports it.
     *
     * INJECTED, never shipped as hidden markup. With WORLD_ENGINE off this
     * builds nothing at all, so the existing previs screen — and every test
     * that reads it — is untouched. A console that shipped as display:none
     * would still change the page, and "byte-identical with the flag off"
     * would stop being true the day it landed.
     */
    let WORLD_FLAGS = null;

    async function worldLoadFlags() {
        if (WORLD_FLAGS) return WORLD_FLAGS;
        try {
            const res = await api('/settings');
            WORLD_FLAGS = (res && res.settings) || {};
        } catch (_) { WORLD_FLAGS = {}; }
        return WORLD_FLAGS;
    }

    /*
     * `!!value` is not enough. film_app_settings stores TEXT, so a flag written
     * as `false` came back as the STRING "false" — truthy — and the console
     * rendered with the switch off. Fixed at the store too; this stays because
     * rows written before that fix are still strings.
     */
    function worldFlagOn(name) {
        const v = WORLD_FLAGS && WORLD_FLAGS[name];
        const s = String(v == null ? '' : v).trim().toLowerCase();
        return !(s === '' || s === '0' || s === 'false' || s === 'off');
    }

    function worldEngineOn() { return worldFlagOn('world_engine'); }

    /* ── WHICH FLAG GATES WHICH REGION ──────────────────────────────────────
     *
     * Six boolean settings gate the World Engine. `world_engine` is the master
     * — it decides whether the console exists at all. The other five each gate
     * ONE region of the design, and until now every one of them was declared
     * in app-settings.js, returned by GET /settings, fetched into WORLD_FLAGS
     * and read by nothing: a director could switch off the one flag documented
     * as unlocking spending and watch the button that spends stay put.
     *
     * The values are the DESIGN'S OWN REGION SLUGS, so a flag cannot gate
     * something the handoff does not draw — the placement test derives the
     * same slugs from the same headings and the two are held equal.
     *
     * A MAP RATHER THAN A CHECK PER REGION, because three of these five gate
     * regions that are not built yet. When ICP-018 adds Direct the Shot it
     * wraps it in worldRegionOn('direct-the-shot') and the flag is live on the
     * day it lands, instead of being remembered later or not at all.
     */
    const WORLD_FLAG_REGIONS = Object.freeze({
        marble_generation: 'create-spatial-world',
        cinematography_ai: 'direct-the-shot',
        reference_match:   'match-reference-composition',
        camera_explore:    'explore-shot',
        world_splats:      'spatial-world',
    });

    /*
     * An UNGATED region renders. That default is deliberate: most of the
     * console is not behind a flag, and defaulting to hidden would make every
     * region built from here on invisible until somebody remembered to add it
     * to the map — a failure that looks exactly like the region not existing.
     */
    function worldRegionOn(slug) {
        const flag = Object.keys(WORLD_FLAG_REGIONS).find(f => WORLD_FLAG_REGIONS[f] === slug);
        return flag ? worldFlagOn(flag) : true;
    }

    /*
     * The eleven composition overlays the design draws. Thirds and Horizon are
     * on by default and the other nine are off: an overlay drawn over a frame
     * nobody asked to have marked up is noise, and noise is what makes a real
     * guide unreadable.
     */
    function worldOverlays() {
        return [
            { id: 'thirds',    label: 'Thirds',            on: true },
            { id: 'center',    label: 'Center',            on: false },
            { id: 'horizon',   label: 'Horizon',           on: true },
            { id: 'vanishing', label: 'Vanishing points',  on: false },
            { id: 'eyelines',  label: 'Eyelines',          on: false },
            { id: 'line180',   label: '180° line',         on: false },
            { id: 'headroom',  label: 'Headroom',          on: false },
            { id: 'leadroom',  label: 'Lead room',         on: false },
            { id: 'silhouette',label: 'Silhouette',        on: false },
            { id: 'grayscale', label: 'Grayscale / value', on: false },
            { id: 'layers',    label: 'FG / MG / BG',      on: false },
        ];
    }

    /* The board frame laid over the set at half strength, to line the camera up with it. */
    function worldToggleBoardOnion() {
        WORLD.boardOnion = !WORLD.boardOnion;
        const f = document.getElementById('weFrame');
        if (f) f.classList.toggle('pv-onion', !!(WORLD.boardOnion && worldBoardSrc() && worldViewMode() !== 'plan'));
    }

    function worldToggleOverlay(id) {
        if (!WORLD.overlays) WORLD.overlays = {};
        WORLD.overlays[id] = !WORLD.overlays[id];
        worldPaintFrame();
    }

    /** The twelve primes the design puts on the panel. */
    function worldLenses() {
        return [12, 14, 18, 21, 24, 28, 35, 40, 50, 65, 85, 135];
    }

    /*
     * DERIVED from the sensor, not looked up. A table agrees with
     * previs-camera today and drifts the first time a sensor is added — and the
     * console would then disagree with the stage about what the same lens sees.
     * Same formula, stated once on each side and held equal by test.
     */
    function worldFovFor(focalMm, sensorWidthMm, sensorHeightMm) {
        const f = Number(focalMm) || 50;
        const deg = (rad) => rad * 180 / Math.PI;
        return {
            hDeg: deg(2 * Math.atan((Number(sensorWidthMm) || 24.89) / (2 * f))),
            vDeg: deg(2 * Math.atan((Number(sensorHeightMm) || 18.66) / (2 * f))),
        };
    }

    /*
     * The two framing modes, and they are opposites.
     *
     * KEEP POSITION — the camera holds and the subject's size follows the lens,
     * which is what actually happens when you change a prime and stand still.
     * MAINTAIN SIZE — occupancy is PINNED at the value in effect when the mode
     * was engaged, and the camera dollies instead. The relation is the optics:
     * doubling the focal length doubles the distance that holds a subject the
     * same size. Not a fudge factor.
     */
    function worldApplyLens(state, newFocalMm) {
        const from = Number(state.focalMm) || 50;
        const to = Number(newFocalMm) || from;
        const ratio = to / from;
        if (state.mode === 'maintain') {
            const pinned = state.pinned == null ? state.occupancy : state.pinned;
            return { focalMm: to, distanceM: (Number(state.distanceM) || 0) * ratio,
                     occupancy: pinned, pinned, mode: 'maintain' };
        }
        return {
            focalMm: to,
            distanceM: Number(state.distanceM) || 0,
            occupancy: Math.min(1, (Number(state.occupancy) || 0) * ratio),
            pinned: null, mode: 'keep',
        };
    }

    /** The shape of the frame, from the project — never a constant. */
    function worldFrameRatio(project) {
        const raw = String((project && project.aspect_ratio) || '').trim();
        const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(raw);
        if (m && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]);
        return 16 / 9;
    }

    /*
     * Distances come from the world, and say so when they cannot.
     *
     * An uncalibrated reconstruction has no metres to give: `metres` is null
     * rather than the raw world units dressed up as a measurement, which is the
     * same rule lib/world-scale.js holds on the server.
     */
    function worldMeasurements(version, subjects) {
        const f = version && Number(version.scale_factor);
        const usable = Number.isFinite(f) && f > 0 ? f : null;
        return {
            state: usable ? 'SCALE CALIBRATED' : 'APPROXIMATE SCALE',
            factor: usable,
            subjects: (subjects || []).map(s => ({
                name: s.name,
                units: s.distance,
                metres: usable == null ? null : s.distance * usable,
            })),
        };
    }

    function worldOverlayMenuHtml() {
        const st = WORLD.overlays || {};
        const technical = `<div class="pv-overlay-views">
            <span class="pv-menu-label">Technical views</span>
            <button class="pv-menu-action${worldViewMode() === 'geo' ? ' active' : ''}" onclick="worldSetViewMode('geo')">Geometry</button>
            <button class="pv-menu-action${worldViewMode() === 'depth' ? ' active' : ''}" onclick="worldSetViewMode('depth')">Depth</button>
        </div>`;
        const src = worldBoardSrc();
        const board = `<div class="pv-overlay-views">
            <span class="pv-menu-label">Storyboard frame</span>
            ${src ? `<button class="pv-menu-action${worldViewMode() === 'board' ? ' active' : ''}" onclick="worldSetViewMode('board')">Board view</button>
            <label class="we-ov-row"><input type="checkbox" id="pvBoardOnion" ${WORLD.boardOnion ? 'checked' : ''}
                onchange="worldToggleBoardOnion()"><span>Board over the shot</span></label>`
                : '<span class="we-hint">This shot has no storyboard frame yet.</span>'}
        </div>`;
        return technical + board + worldOverlays().map(o => {
            const on = st[o.id] === undefined ? o.on : st[o.id];
            return `<label class="we-ov-row"><input type="checkbox" data-overlay="${o.id}"
                ${on ? 'checked' : ''} onchange="worldToggleOverlay('${o.id}')">
                <span>${esc(o.label)}</span></label>`;
        }).join('');
    }

    /* ── DIRECT THE SHOT ────────────────────────────────────────────────────
     *
     * The director states an INTENTION; the connected model proposes a camera;
     * the engine validates it. Nothing here decides, and that ordering is the
     * whole design rather than a nicety.
     *
     * THE DESIGN SHIPS A DELTA TABLE AND IT IS DEMO DATA — it says so twice.
     * "More heroic -> 21mm, h 0.42m, tilt +17" looks exactly like an
     * implementation, and baking it in would make every heroic shot in every
     * film the same angle, computed by a formula nobody can argue with. The
     * codebase already records what that costs for style presets: a rigid rule
     * gets switched off the first time it overrules a director, and takes the
     * useful part with it. So the panel shows the FACTS and the BIAS and asks.
     *
     * The chips are built from the engine's own INTENTS, fetched with the
     * brief, so an eighth intention appears here with nothing to remember and
     * the page can never offer one the route would refuse.
     */
    const DIRECT = { intent: null, brief: null, proposal: null, result: null };

    /** `cinematic_depth` is a key; a director should not be reading snake_case. */
    function directIntentLabel(id) {
        return 'More ' + String(id).replace(/_/g, ' ');
    }

    function worldDirectPanelHtml() {
        const intents = (DIRECT.brief && DIRECT.brief.intents) || WORLD_INTENTS_FALLBACK;
        const chips = intents.map(i =>
            `<button class="we-chip-btn${DIRECT.intent === i ? ' active' : ''}"
                     onclick="worldDirectIntent('${i}')">${esc(directIntentLabel(i))}</button>`).join('');
        return `
              <div class="we-panel" data-region="direct-the-shot">
                <div class="we-panel-head">
                  <span class="we-label">DIRECT THE SHOT</span>
                  <span class="we-live">CHANGES THE CAMERA, NOT THE IMAGE</span>
                </div>
                <div class="we-direct">
                  <div class="we-direct-l">
                    <div class="we-chips">${chips}</div>
                    <input id="weDirectCustom" class="we-input" type="text"
                           placeholder="Custom direction — e.g. hold the creature in the near foreground and let the figure read small"
                           onchange="worldDirectIntent(null)">
                  </div>
                  <div class="we-direct-r" id="weDirectOut">
                    <p class="we-hint">Choose an intention. The facts this shot offers are handed
                    to your connected model over MCP, which proposes the camera — the engine never
                    proposes one, so nothing here decides for you.</p>
                  </div>
                </div>
                <div class="we-actions">
                  <textarea id="weDirectProposal" class="we-input" rows="2"
                            placeholder='The proposal, as the model returns it — the keys are listed in the brief under you_may_change'></textarea>
                  <button class="we-btn" onclick="worldDirectCheck()">CHECK — FREE</button>
                  <button class="we-btn we-amber" onclick="worldDirectApply()">APPLY CAMERA CHANGE</button>
                </div>
              </div>`;
    }

    /* The seven the engine declares, mirrored only for the first paint before
     * a brief has been fetched. The BRIEF is the source; this is what the panel
     * draws while it is still being asked for. */
    const WORLD_INTENTS_FALLBACK = ['heroic', 'vulnerable', 'oppressive', 'intimate',
                                    'chaotic', 'isolated', 'cinematic_depth'];

    /*
     * FREE. Fetches the brief for this intention — the facts about the shot as
     * it stands, plus the bias description — and shows what to ask for. It
     * proposes nothing, which is what buildBrief's own note says.
     */
    async function worldDirectIntent(intent) {
        DIRECT.intent = intent;
        DIRECT.result = null;
        const out = document.getElementById('weDirectOut');
        const shotId = WORLD.shotId;
        if (!shotId) { if (out) out.innerHTML = '<p class="we-hint">Open a shot first.</p>'; return; }
        if (out) out.innerHTML = '<p class="we-hint">Reading the facts&hellip;</p>';
        try {
            const q = intent ? `?intent=${encodeURIComponent(intent)}` : '';
            DIRECT.brief = await api(`/shots/${shotId}/direct${q}`);
            worldDirectShowResult();
        } catch (err) {
            // A renderer that paints a placeholder must have a path that
            // replaces it; a spinner that never resolves is worse than an error.
            if (out) out.innerHTML = `<p class="we-hint">Could not read the shot: ${esc(err.message)}</p>`;
        }
    }

    /** The proposal the model returned, as the model returned it. */
    function worldDirectProposal() {
        const box = document.getElementById('weDirectProposal');
        const raw = ((box && box.value) || '').trim();
        if (!raw) return { error: 'Paste the proposal your model returned.' };
        try {
            const p = JSON.parse(raw);
            /*
             * Every field the CONTRACT permits travels. Narrowing the set here
             * would silently drop a roll or a truck the model deliberately
             * asked for, and it has no way to discover that.
             */
            const allowed = ['focalLengthMm', 'cameraHeightM', 'dollyM', 'truckM', 'pedestalM',
                             'panDeg', 'tiltDeg', 'rollDeg', 'targetOccupancy', 'framingTarget', 'rig'];
            const out = {};
            for (const k of allowed) if (p[k] !== undefined) out[k] = p[k];
            // Anything else is left in so the ROUTE refuses it by name — the
            // page silently dropping an unknown field would hide the mistake.
            for (const k of Object.keys(p)) if (!(k in out)) out[k] = p[k];
            return { proposal: out };
        } catch (err) {
            return { error: 'That is not valid JSON: ' + err.message };
        }
    }

    async function worldDirectSend(apply) {
        const shotId = WORLD.shotId;
        const out = document.getElementById('weDirectOut');
        if (!shotId) return;
        const got = worldDirectProposal();
        if (got.error) { if (out) out.innerHTML = `<p class="we-hint">${esc(got.error)}</p>`; return; }
        if (out) out.innerHTML = '<p class="we-hint">Checking against the geometry&hellip;</p>';
        try {
            DIRECT.result = await api(`/shots/${shotId}/direct`,
                { method: 'POST', body: JSON.stringify({ ...got.proposal, ...(apply ? { apply: true } : {}) }) });
            DIRECT.result.applied = !!apply;
        } catch (err) {
            /*
             * A REFUSAL IS AN ANSWER, and it belongs here rather than on the
             * status bar at the bottom of the screen: this is where the choice
             * was made. The route names the checks that caught it, and the
             * remedy when a world has no scale to place a metric camera in.
             */
            DIRECT.result = { error: err.message, failures: err.failures || [], remedy: err.remedy };
        }
        worldDirectShowResult();
    }

    const worldDirectCheck = () => worldDirectSend(false);

    const worldDirectApply = () => worldDirectSend(true);

    /** The deltas, from the camera the ROUTE returned — never computed here. */
    function worldDirectShowResult() {
        const out = document.getElementById('weDirectOut');
        if (!out) return;
        const b = DIRECT.brief;
        const r = DIRECT.result;
        const rows = [];
        if (r && r.camera && b && b.facts && b.facts.camera) {
            const was = b.facts.camera;
            const now = r.camera;
            const pair = (k, a, c, u) => (a == null && c == null) ? null
                : `<div class="we-row"><span>${k}</span><span>${esc(String(a))} → ${esc(String(c))}${u || ''}</span></div>`;
            rows.push(pair('LENS', was.focal_mm, now.focalMm, 'mm'));
            rows.push(pair('HEIGHT', was.height, now.position ? now.position[1] : null, 'm'));
            rows.push(pair('TILT', was.rotation_deg ? was.rotation_deg[0] : null,
                           now.rotation ? now.rotation[0] : null, '°'));
        }
        const failures = (r && r.failures) || [];
        out.innerHTML = `
            ${DIRECT.intent ? `<div class="we-label">${esc(directIntentLabel(DIRECT.intent).toUpperCase())} — PROPOSED CAMERA</div>` : ''}
            ${b && b.bias ? `<p class="we-hint">${esc(b.bias)}</p>` : ''}
            ${b ? `<p class="we-hint">${esc(b.note || '')} ${AI_PATH.connected
                    ? 'Ask ' + esc(AI_PATH.client || 'your agent') + ' for a camera — it can call cinematography_brief and camera_propose directly.'
                    : 'Connect an agent host (Claude Desktop) to the MCP server and ask it for a camera; nothing here will propose one.'}</p>` : ''}
            ${rows.filter(Boolean).join('') || ''}
            ${r && r.error ? `<p class="we-hint" style="color:var(--gl-danger,#ef4444);">${esc(r.error)}</p>` : ''}
            ${failures.length ? `<ul class="we-hint">${failures.map(f =>
                `<li>${esc(typeof f === 'string' ? f : (f.why || f.check || JSON.stringify(f)))}</li>`).join('')}</ul>` : ''}
            ${r && r.remedy ? `<p class="we-hint">${esc(r.remedy)}</p>` : ''}
            ${r && r.applied && !r.error ? '<p class="we-hint">Applied to the shot.</p>' : ''}`;
    }

    /* ── EXPLORE SHOT ───────────────────────────────────────────────────────
     *
     * Six cameras in ONE world from ONE blocking, comparable side by side.
     * The categories are the engine's own EXPLORE_CATEGORIES, fetched with the
     * brief; the CAMERAS come from the connected model and are validated by
     * the route, exactly as Direct the Shot works — the design's tile table is
     * demo data for the third time and baking it in would give every film the
     * same six angles.
     *
     * A CANDIDATE THAT CANNOT BE SHOT IS NAMED. acceptCandidates drops it and
     * says why; swallowing that gives a director six asked for and four shown
     * with nothing saying the other two were impossible.
     */
    const EXPLORE = { brief: null, cats: [], accepted: [], rejected: [], shortfall: 0,
                      compare: false, picks: [], result: null };

    function worldExploreTilesHtml() {
        const cats = EXPLORE.cats.length ? EXPLORE.cats : WORLD_EXPLORE_FALLBACK;
        return cats.map((c) => {
            const got = EXPLORE.accepted.find(a => a.key === c.key);
            const bad = EXPLORE.rejected.find(r => r.key === c.key);
            const cam = got && got.camera;
            const picked = EXPLORE.picks.indexOf(c.key);
            const cls = picked === 0 ? ' pick-a' : picked === 1 ? ' pick-b' : '';
            const spec = cam
                ? `${cam.focalMm != null ? cam.focalMm + 'mm' : ''}`
                  + `${cam.position ? ' · ' + Number(cam.position[1]).toFixed(2) + 'm' : ''}`
                : (bad ? 'cannot be shot' : 'no camera yet');
            return `
                  <button class="we-tile${cls}${bad ? ' bad' : ''}"
                          onclick="worldExploreTap('${c.key}')">
                    <span class="we-tile-thumb">${EXPLORE.thumbs && EXPLORE.thumbs[c.key]
                        ? `<img class="we-tile-img" src="${EXPLORE.thumbs[c.key]}" alt="">` : ''}<span class="we-tile-key">${esc(c.key)}</span></span>
                    <span class="we-tile-body">
                      <span class="we-tile-name">${esc(c.name)}</span>
                      <span class="we-tile-intent">${esc(c.intent)}</span>
                      <span class="we-tile-spec">${esc(spec)}</span>
                    </span>
                  </button>`;
        }).join('');
    }

    /* The engine's six, mirrored only for the first paint before a brief has
     * been fetched. The BRIEF is the source. */
    const WORLD_EXPLORE_FALLBACK = [
        { key: 'A', name: 'Neutral Wide',          intent: 'Orientation / geography' },
        { key: 'B', name: 'Heroic Low',            intent: 'Power / dominance' },
        { key: 'C', name: 'Long Lens Compression', intent: 'Claustrophobic / observational' },
        { key: 'D', name: 'Extreme Foreground',    intent: 'Scale / threat' },
        { key: 'E', name: 'Over the Shoulder',     intent: 'Alignment / complicity' },
        { key: 'F', name: 'Dutch / Unstable',      intent: 'Disorientation / panic' },
    ];

    function worldExplorePanelHtml() {
        return `
              <div class="we-panel" data-region="explore-shot">
                <div class="we-panel-head">
                  <span class="we-label">EXPLORE SHOT — SIX CAMERAS, ONE WORLD</span>
                  <button class="we-btn${EXPLORE.compare ? ' we-amber' : ''}"
                          onclick="worldExploreToggleCompare()">${
                    EXPLORE.compare ? `COMPARING ${EXPLORE.picks.length}/2` : 'COMPARE'}</button>
                  <button class="we-btn we-amber" onclick="worldExploreBrief()">&#10022; EXPLORE AGAIN</button>
                </div>
                <div class="we-tiles" id="weExploreTiles">${worldExploreTilesHtml()}</div>
                <textarea id="weExploreCandidates" class="we-input" rows="2"
                          placeholder="The six cameras, as your model returns them — an array of proposals, each with its key"></textarea>
                <button class="we-btn" onclick="worldExploreAccept()">CHECK THE SIX — FREE</button>
                <div id="weExploreOut" class="we-rows"></div>
              </div>`;
    }

    /** FREE. The categories and the facts, from the engine. */
    async function worldExploreBrief() {
        if (WORLD.scout) return previzWorkspace.explore('brief');
        const out = document.getElementById('weExploreOut');
        const shotId = WORLD.shotId;
        if (!shotId) { if (out) out.innerHTML = '<p class="we-hint">Open a shot first.</p>'; return; }
        if (out) out.innerHTML = '<p class="we-hint">Reading the world&hellip;</p>';
        try {
            EXPLORE.brief = await api(`/shots/${shotId}/direct/explore`);
            EXPLORE.cats = (EXPLORE.brief && EXPLORE.brief.categories) || [];
            worldExploreShow();
        } catch (err) {
            if (out) out.innerHTML = `<p class="we-hint">Could not read the world: ${esc(err.message)}</p>`;
        }
    }

    /** The six the model returned, as it returned them. */
    function worldExploreCandidates() {
        const box = document.getElementById('weExploreCandidates');
        const raw = ((box && box.value) || '').trim();
        if (!raw) return { error: 'Paste the six cameras your model proposed.' };
        try {
            const v = JSON.parse(raw);
            const list = Array.isArray(v) ? v : (v.candidates || []);
            if (!list.length) return { error: 'That contains no candidates.' };
            return { candidates: list };
        } catch (err) { return { error: 'That is not valid JSON: ' + err.message }; }
    }

    /** The ROUTE decides which can be shot. The page filters nothing. */
    async function worldExploreAccept() {
        if (WORLD.scout) return previzWorkspace.explore('accept');
        const shotId = WORLD.shotId;
        const out = document.getElementById('weExploreOut');
        if (!shotId) return;
        const got = worldExploreCandidates();
        if (got.error) { if (out) out.innerHTML = `<p class="we-hint">${esc(got.error)}</p>`; return; }
        if (out) out.innerHTML = '<p class="we-hint">Checking each against the geometry&hellip;</p>';
        try {
            const r = await api(`/shots/${shotId}/direct/explore`,
                { method: 'POST', body: JSON.stringify({ candidates: got.candidates }) });
            EXPLORE.accepted = r.accepted || [];
            EXPLORE.rejected = r.rejected || [];
            EXPLORE.shortfall = r.shortfall || 0;
        } catch (err) {
            EXPLORE.rejected = [];
            if (out) out.innerHTML = `<p class="we-hint">${esc(err.message)}</p>`;
            return;
        }
        worldExploreShow();
    }

    /** Normal mode loads; compare mode selects. */
    function worldExploreTap(key) {
        if (EXPLORE.compare) return worldExplorePick(key);
        return worldExploreLoad(key);
    }

    /*
     * Loading goes through the SAME directing route every other camera goes
     * through, so a coverage camera cannot skip the geometry checks — and it
     * does NOT navigate away: the console updates in place, which is what the
     * design asks for and what makes trying six angles cheap.
     */
    async function worldExploreLoad(key) {
        if (WORLD.scout) return previzWorkspace.loadExplore(key);
        const got = EXPLORE.accepted.find(a => a.key === key);
        const out = document.getElementById('weExploreOut');
        if (!got) { if (out) out.innerHTML = '<p class="we-hint">That camera has not been checked yet.</p>'; return; }
        try {
            const body = Object.assign({}, got);
            delete body.camera; delete body.warnings;
            const r = await api(`/shots/${WORLD.shotId}/direct`,
                { method: 'POST', body: JSON.stringify(Object.assign(body, { apply: true })) });
            EXPLORE.result = { loaded: key, camera: r.camera };
        } catch (err) {
            EXPLORE.result = { error: err.message, failures: err.failures || [] };
        }
        worldExploreShow();
    }

    function worldExploreToggleCompare() {
        EXPLORE.compare = !EXPLORE.compare;
        EXPLORE.picks = [];
        EXPLORE.result = null;
        worldExploreShow();
    }

    /*
     * Two, FIFO past two. Without a cap a third pick either does nothing —
     * which reads as the tile being broken — or silently replaces one the
     * director cannot see.
     */
    function worldExplorePick(key) {
        if (!EXPLORE.compare) return;
        const at = EXPLORE.picks.indexOf(key);
        if (at > -1) EXPLORE.picks.splice(at, 1);
        else { EXPLORE.picks.push(key); if (EXPLORE.picks.length > 2) EXPLORE.picks.shift(); }
        if (EXPLORE.picks.length === 2) return worldExploreCompare();
        EXPLORE.result = null;
        worldExploreShow();
    }

    /** The comparison is the ENGINE's, never the page's arithmetic. */
    async function worldExploreCompare() {
        if (WORLD.scout) return previzWorkspace.explore('compare');
        const [ka, kb] = EXPLORE.picks;
        const a = EXPLORE.accepted.find(x => x.key === ka);
        const b = EXPLORE.accepted.find(x => x.key === kb);
        if (!a || !b) { EXPLORE.result = { error: 'Both cameras must be checked first.' }; return worldExploreShow(); }
        try {
            EXPLORE.result = { comparison: await api(`/shots/${WORLD.shotId}/direct/compare`, {
                method: 'POST',
                body: JSON.stringify({ a: { camera: a.camera }, b: { camera: b.camera },
                                       a_name: a.name || ka, b_name: b.name || kb }),
            }) };
        } catch (err) { EXPLORE.result = { error: err.message }; }
        worldExploreShow();
    }

    function worldExploreShow() {
        const tiles = document.getElementById('weExploreTiles');
        if (tiles) tiles.innerHTML = worldExploreTilesHtml();
        // Rendered thumbnails, when the world's splat can be drawn. Never awaited.
        if (typeof worldFlagOn === 'function' && typeof worldExploreThumbs === 'function'
            && worldFlagOn('previs_console')) worldExploreThumbs().catch(() => {});
        const out = document.getElementById('weExploreOut');
        if (!out) return;
        const r = EXPLORE.result || {};
        const cmp = r.comparison;
        const rows = cmp ? cmp.axes.map(ax =>
            `<div class="we-row3"><span>${esc(ax.label)}</span><span>${esc(String(ax.a == null ? '—' : ax.a))}</span>`
            + `<span>${esc(String(ax.b == null ? '—' : ax.b))}</span></div>`).join('') : '';
        out.innerHTML = `
            ${EXPLORE.compare && EXPLORE.picks.length < 2
                ? '<p class="we-hint">Pick two cameras to compare.</p>' : ''}
            ${cmp ? `<div class="we-row3 head"><span></span><span>${esc(cmp.names[0])}</span>`
                    + `<span>${esc(cmp.names[1])}</span></div>${rows}` : ''}
            ${EXPLORE.shortfall ? `<p class="we-hint">${EXPLORE.shortfall} of the six could not be `
                + 'shot, so this coverage is incomplete.</p>' : ''}
            ${EXPLORE.rejected.length ? `<ul class="we-hint">${EXPLORE.rejected.map(x =>
                `<li>${esc(x.key || x.name || 'a camera')}: ${esc((x.failures || [])
                    .map(f => f.detail || f.check).join('; ') || 'cannot be shot')}</li>`).join('')}</ul>` : ''}
            ${r.loaded ? `<p class="we-hint">Loaded camera ${esc(r.loaded)} into this shot.</p>` : ''}
            ${r.error ? `<p class="we-hint" style="color:var(--gl-danger,#ef4444);">${esc(r.error)}</p>` : ''}
            ${EXPLORE.brief ? `<p class="we-hint">The six cameras come from your connected model over
                MCP — it calls camera_explore_brief and proposes one per category. Nothing here
                proposes a camera.</p>` : ''}`;
    }

    /* ── THE REMAINING REGIONS, EACH FED FROM REAL STATE ────────────────────
     *
     * The handoff says it twice: "All numeric data is demo data. Wire to real
     * state." Maple Street, Maya, the Dragon, 25.7m, COOKE S4. A console wired
     * to those renders perfectly in a screenshot and describes nothing.
     *
     * So every panel here reads WORLD — the shots, the pinned world version,
     * the saved blocking, the project's own delivery settings — and a panel
     * with nothing to read SAYS SO rather than showing a plausible number. An
     * invented 1.55m is indistinguishable from a real one and wrong in every
     * project that has not been blocked.
     */

    /** A metre value, or a dash. Never a default: a default is a lie with units. */
    function weM(v) { return Number.isFinite(Number(v)) ? Number(v).toFixed(2) + 'm' : '—'; }

    function weDeg(v) { return Number.isFinite(Number(v)) ? Number(v).toFixed(1) + '°' : '—'; }

    /* ── Left rail: the project's shots ──────────────────────────────────── */
    function worldRailHtml() {
        return previzWorkspace.railHtml();
    }

    /** The project's shots, once. */
    async function worldLoadShots(projectId) {
        try {
            const r = await api(`/projects/${projectId}/shotlist`);
            WORLD.shots = (r && (r.shots || r)) || [];
        } catch (_) { WORLD.shots = []; }
    }

    /*
     * Selecting a shot loads what that shot ALREADY HAS — its saved blocking,
     * its pinned world version — and updates the console IN PLACE. The design
     * is explicit that it does not navigate away, and that is what makes
     * moving between six shots cheap.
     */
    async function worldRailSelect(shotId) {
        if (WORLD.scout) { WORLD.scout = null; WALK.on = false; WALK.from = null; WALK.moved = false; }
        const selection = WORLD.selectionRevision = (WORLD.selectionRevision || 0) + 1;
        WORLD.shotId = shotId;
        WORLD.blocking = null;
        WORLD.pin = null;
        const [blocking] = await Promise.all([
            api(`/shots/${shotId}/previs`).catch(() => null),
            worldLoadForShot(shotId, selection),
        ]);
        if (selection !== WORLD.selectionRevision || WORLD.shotId !== shotId) return;
        WORLD.blocking = blocking;
        worldHydrateMove();
        worldConsoleRender();
    }

    /* ── Spatial World: the world's own geometry, not a splat ────────────── */
    function worldSpatialHtml(world, version) {
        const b = version && version.bounds_json ? parse_(version.bounds_json) : (version && version.bounds);
        const subjects = ((WORLD.blocking && WORLD.blocking.blocking
            && WORLD.blocking.blocking.subjects) || []);
        const scaled = version && Number(version.scale_factor) > 0;
        return `
            <div class="we-panel" data-region="spatial-world">
              <div class="we-panel-head">
                <span class="we-label">SPATIAL WORLD</span>
                ${['PERSP', 'TOP', 'SIDE'].map(v =>
                  `<button class="we-btn${WORLD.view === v ? ' we-amber' : ''}"
                           onclick="worldSetView('${v}')">${v}</button>`).join('')}
              </div>
              ${world ? `
                <div class="we-rows">
                  <div class="we-row"><span>STATE</span><span>${
                    esc(scaled ? 'SCALE CALIBRATED' : 'APPROXIMATE SCALE')}</span></div>
                  ${b && b.length === 3 ? `<div class="we-row"><span>EXTENT</span><span>${
                    b.map(x => weM(x)).join(' × ')}</span></div>` : ''}
                  ${subjects.map(su => `<div class="we-row"><span>${esc(su.name || 'unnamed')}</span>`
                    + `<span>${su.position ? weM(Math.hypot(su.position[0] || 0, su.position[2] || 0)) : '—'}</span></div>`).join('')}
                </div>
                <p class="we-hint">The splat viewport is not rendered here — see the ADR on Spark.
                What is shown is the geometry this world actually reports.</p>`
                : '<p class="we-hint">No world generated for this location yet.</p>'}
            </div>`;
    }

    function parse_(v) { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; } }

    function worldSetView(v) { WORLD.view = v; worldConsoleRender(); }

    /* ── Camera Operate: six nudges, every one a PROPOSAL FIELD ──────────── */

    /*
     * Each axis is a field the proposal contract permits, so a nudge travels
     * the SAME validated road as an intention and a coverage camera — one
     * apply path, and a nudge that would put the camera inside a wall is
     * refused by the same check.
     *
     * Raw X/Y/Z is deliberately absent: the design puts it in Advanced.
     */
    const OPERATE_AXES = Object.freeze([
        { group: 'TRANSLATION', field: 'dollyM',     label: 'Dolly',    step: 0.25, unit: 'm' },
        { group: 'TRANSLATION', field: 'truckM',     label: 'Truck',    step: 0.25, unit: 'm' },
        { group: 'TRANSLATION', field: 'pedestalM',  label: 'Pedestal', step: 0.10, unit: 'm' },
        { group: 'ROTATION',    field: 'panDeg',     label: 'Pan',      step: 2,    unit: '°' },
        { group: 'ROTATION',    field: 'tiltDeg',    label: 'Tilt',     step: 2,    unit: '°' },
        { group: 'ROTATION',    field: 'rollDeg',    label: 'Roll',     step: 2,    unit: '°' },
    ]);

    /*
     * THE VALUES ARE THE CONTROLS. Each is a number you drag sideways to change
     * (Shift finer, Alt coarser) or double-click to type, as in a 3D
     * application; the step buttons stay for a precise nudge. A drag moves the
     * camera live and is kept when it is let go, through the same validated
     * proposal as everything else, so a camera inside a wall is refused.
     */
    const OPERATE_SCRUB = Object.freeze([
        { id: 'distance', label: 'Distance to subject', unit: 'm', rate: 0.01, fmt: 2 },
        { id: 'height',   label: 'Height above floor',  unit: 'm', rate: 0.005, fmt: 2 },
        { id: 'side',     label: 'Side to side (truck)', unit: 'm', rate: 0.01, fmt: 2 },
        { id: 'pan',      label: 'Pan (left +)',        unit: '°', rate: 0.25, fmt: 1 },
        { id: 'tilt',     label: 'Tilt (up +)',         unit: '°', rate: 0.2,  fmt: 1 },
        { id: 'roll',     label: 'Roll',                unit: '°', rate: 0.2,  fmt: 1 },
        { id: 'lens',     label: 'Lens',                unit: 'mm', rate: 0.2, fmt: 0, min: 8, max: 300 },
    ]);

    function worldOperateScale() {
        const f = Number(WORLD.version && WORLD.version.scale_factor);
        return Number.isFinite(f) && f > 0 ? f : 1;
    }

    /** The framing subject, in the camera's stored units. */
    function worldOperateSubject() {
        const subs = stageSubjects();
        const t = subs.find(s => s.isTarget) || subs[0];
        return t && Array.isArray(t.position) ? t.position : null;
    }

    function worldOperateCamera() {
        return (WALK.on && worldWalkCamera())
            || (WORLD.blocking && WORLD.blocking.blocking && WORLD.blocking.blocking.camera) || null;
    }

    function worldOperateValue(id) {
        const c = worldOperateCamera();
        const k = worldOperateScale();
        if (id === 'lens') return WORLD.lens || (c && c.focalMm) || 35;
        if (!c || !Array.isArray(c.position)) return null;
        const r = c.rotation || [0, 0, 0];
        if (id === 'pan') return r[0] || 0;
        if (id === 'tilt') return r[1] || 0;
        if (id === 'roll') return r[2] || 0;
        if (id === 'side') return c.position[0] * k;
        if (id === 'height') {
            const floor = WORLD.geometry && WORLD.geometry.bounds && Array.isArray(WORLD.geometry.bounds.min)
                ? WORLD.geometry.bounds.min[1] : 0;
            return c.position[1] * k - floor;
        }
        if (id === 'distance') {
            const t = worldOperateSubject();
            if (!t) return null;
            return Math.hypot((c.position[0] - t[0]) * k, (c.position[2] - t[2]) * k);
        }
        return null;
    }

    /** Move the (walking) camera by a change in one value. */
    function worldOperateApply(id, delta) {
        if (!delta) return;
        if (id === 'lens') return worldOperateLens(Math.max(8, Math.min(300, worldOperateValue('lens') + delta)));
        worldWalkEnsure();
        const c = worldWalkCamera();
        if (!c) return;
        const k = worldOperateScale();
        const yaw = (c.rotation[0] || 0) * Math.PI / 180;
        if (id === 'pan' || id === 'tilt' || id === 'roll') {
            const i = { pan: 0, tilt: 1, roll: 2 }[id];
            c.rotation[i] = (c.rotation[i] || 0) + delta;
            if (id === 'tilt') c.rotation[1] = Math.max(-85, Math.min(85, c.rotation[1]));
        } else if (id === 'height') {
            c.position[1] += delta / k;
        } else if (id === 'side') {
            c.position[0] += Math.cos(yaw) * delta / k; c.position[2] -= Math.sin(yaw) * delta / k;
        } else if (id === 'distance') {
            // Farther from the subject is backward along the camera's own axis.
            c.position[0] += Math.sin(yaw) * delta / k; c.position[2] += Math.cos(yaw) * delta / k;
        }
        WALK.moved = true;
        worldWalkRepaint();
    }

    /*
     * A LENS CHANGE, AND IN MAINTAIN-SIZE A DOLLY WITH IT. Maintain size worked
     * out a new distance and moved nothing, so the button looked broken. The
     * subject keeps its size when the distance scales with the focal length,
     * which is the dolly-zoom.
     */
    function worldOperateLens(mm) {
        const before = worldOperateValue('lens');
        WORLD.lens = Math.round(mm * 10) / 10;
        worldWalkEnsure();
        if (WORLD.mode === 'maintain' && before > 0) {
            const d = worldOperateValue('distance');
            if (d != null) worldOperateApply('distance', d * (WORLD.lens / before) - d);
        }
        WALK.moved = true;
        worldWalkRepaint();
    }

    /*
     * THE SHOT, IN THE WORDS A CREW USES. Framing is how much of the subject
     * the frame holds; angle is where the camera sits relative to the eyes.
     * They are two axes — the scene card's single shot_type cannot say "a
     * low-angle wide", this can — and the lens stays the finer control: a
     * framing is solved as a DISTANCE for the lens you have, on the framing
     * subject, keeping the side you are shooting it from. Kept on the shot
     * through the same validated proposal as every other camera change.
     */
    const SHOT_FRAMINGS = Object.freeze([
        { id: 'ews', label: 'Extreme wide', short: 'EWS', cover: 8.0,  aim: 0.50 },
        { id: 'ws',  label: 'Wide',         short: 'WS',  cover: 3.2,  aim: 0.50 },
        { id: 'fs',  label: 'Full',         short: 'FS',  cover: 2.1,  aim: 0.52 },
        { id: 'mws', label: 'Medium wide (cowboy)', short: 'MWS', cover: 1.35, aim: 0.66 },
        { id: 'ms',  label: 'Medium',       short: 'MS',  cover: 0.95, aim: 0.74 },
        { id: 'mcu', label: 'Medium close-up', short: 'MCU', cover: 0.62, aim: 0.83 },
        { id: 'cu',  label: 'Close-up',     short: 'CU',  cover: 0.40, aim: 0.90 },
        { id: 'ecu', label: 'Extreme close-up', short: 'ECU', cover: 0.16, aim: 0.93 },
    ]);

    // Camera height as a share of the subject's height, and where it looks.
    const SHOT_ANGLES = Object.freeze([
        { id: 'eye',      label: 'Eye level',      h: 0.94 },
        { id: 'shoulder', label: 'Shoulder',       h: 0.82 },
        { id: 'hip',      label: 'Hip',            h: 0.55 },
        { id: 'knee',     label: 'Knee',           h: 0.28 },
        { id: 'ground',   label: "Ground (worm's eye)", m: 0.15 },
        { id: 'low',      label: 'Low angle',      h: 0.45, lookUp: true },
        { id: 'high',     label: 'High angle',     h: 1.35 },
        { id: 'overhead', label: "Overhead (bird's eye)", over: true },
    ]);

    function worldShotSubject() {
        const subs = stageSubjects();
        const t = subs.find(s => s.isTarget) || subs[0];
        if (!t || !Array.isArray(t.position)) return null;
        const k = worldOperateScale();
        const h = Array.isArray(t.sizeM) ? Number(t.sizeM[1]) || 1.7 : 1.7;
        return { name: t.name || 'subject', x: t.position[0] * k, y: (t.position[1] || 0) * k, z: t.position[2] * k, h };
    }

    /*
     * NOBODY STAGED: FRAME WHAT THE CAMERA IS LOOKING AT. Scouting a set with a
     * client, the framing and angle buttons answered "stage the subject first"
     * instead of moving the camera. With no one staged they now frame a
     * stand-in: a person of 1.7 m standing where the camera's line of sight
     * meets the set (pulled off a wall), on the floor below that point. It is
     * kept while the camera stays where a framing put it, so WS then CU then
     * Low angle all work on the same spot instead of creeping into the wall.
     */
    function worldImpliedSubject() {
        const pose = worldCameraPose();
        if (!pose) return null;
        const keep = WORLD.impliedSubject;
        const sig = JSON.stringify([pose.eye.map(n => +n.toFixed(3)), (pose.target || []).map(n => +n.toFixed(3))]);
        if (keep && keep.sig === sig && keep.versionId === (WORLD.version && WORLD.version.id)) return keep.subject;
        const [ex, ey, ez] = pose.eye;
        let dx = pose.target[0] - ex, dy = pose.target[1] - ey, dz = pose.target[2] - ez;
        const dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        const T = window.THREE, root = MESHLOOK.root;
        const cast = (o, d, far) => {
            if (!T || !root) return null;
            const rc = new T.Raycaster(new T.Vector3(...o), new T.Vector3(...d), 0.05, far);
            const hit = rc.intersectObject(root, true).find(h => h.object && h.object.isMesh && h.object.visible);
            return hit || null;
        };
        // How far the stand-in stands: where the view meets the set, 0.4 m short
        // of a wall, between 0.8 m and 12 m; 3 m when the view meets nothing.
        const hit = cast([ex, ey, ez], [dx, dy, dz], 40);
        const flatLen = Math.hypot(dx, dz) || 1;
        let reach = hit ? Math.hypot(hit.point.x - ex, hit.point.z - ez) - 0.4 : 3;
        if (!(reach > 0.8)) reach = 0.8;
        reach = Math.min(12, reach);
        const x = ex + (dx / flatLen) * reach, z = ez + (dz / flatLen) * reach;
        const ground = cast([x, ey, z], [0, -1, 0], 30);
        const y = ground ? ground.point.y : ey - 1.6;
        const subject = { name: 'what the camera sees', x, y, z, h: 1.7, implied: true };
        WORLD.impliedSubject = { sig: null, versionId: WORLD.version && WORLD.version.id, subject };
        return subject;
    }

    /** After a framing moves the camera, keep its stand-in for the next button. */
    function worldImpliedSubjectKeep() {
        const keep = WORLD.impliedSubject, pose = worldCameraPose();
        if (!keep || !pose) return;
        keep.sig = JSON.stringify([pose.eye.map(n => +n.toFixed(3)), (pose.target || []).map(n => +n.toFixed(3))]);
    }

    /** What the camera frames now, named: the nearest framing by coverage at the subject. */
    function worldShotNow() {
        const c = worldOperateCamera(), t = worldShotSubject() || (WORLD.impliedSubject && WORLD.impliedSubject.subject);
        if (!c || !t || !Array.isArray(c.position)) return {};
        const k = worldOperateScale();
        const d = Math.hypot(c.position[0] * k - t.x, c.position[2] * k - t.z);
        const v = worldFovFor(WORLD.lens || c.focalMm || 35).vDeg * Math.PI / 180;
        const cover = 2 * d * Math.tan(v / 2);
        let best = null;
        for (const f of SHOT_FRAMINGS) {
            const e = Math.abs(Math.log(cover / f.cover));
            if (!best || e < best.e) best = { id: f.id, e };
        }
        const camH = c.position[1] * k - t.y;
        let angle = null, bestA = Infinity;
        for (const a of SHOT_ANGLES) {
            if (a.over) continue;
            const ah = a.m != null ? a.m : a.h * t.h;
            const e = Math.abs(ah - camH);
            if (e < bestA) { bestA = e; angle = a.id; }
        }
        if ((c.rotation || [])[1] < -60) angle = 'overhead';
        return { framing: best && best.id, angle, dutch: Math.abs((c.rotation || [])[2] || 0) > 5, cover };
    }

    /*
     * Place the camera for a framing and an angle. Either may be left as it is
     * (null keeps what the camera already has). Distance along the current
     * bearing from the subject, height from the angle, and the camera aimed
     * at the framing's point on the subject — the face for a close-up, the
     * middle of the body for a full shot.
     */
    function worldShotPlace(framingId, angleId, dutch) {
        worldWalkEnsure();
        const t = worldShotSubject() || worldImpliedSubject();
        if (!t) return setStatus('Open the 3D view of a set first: the framing is measured on what the camera sees.');
        const c = worldWalkCamera();
        if (!c) return;
        const k = worldOperateScale();
        const now = worldShotNow();
        const F = SHOT_FRAMINGS.find(f => f.id === (framingId || now.framing)) || SHOT_FRAMINGS[4];
        const A = SHOT_ANGLES.find(a => a.id === (angleId || now.angle)) || SHOT_ANGLES[0];
        const v = worldFovFor(WORLD.lens || c.focalMm || 35).vDeg * Math.PI / 180;
        const dist = (F.cover / 2) / Math.tan(v / 2);
        const aimY = t.y + F.aim * t.h;
        let cx = c.position[0] * k, cz = c.position[2] * k;
        let bx = cx - t.x, bz = cz - t.z;
        const bl = Math.hypot(bx, bz) || 1;
        bx /= bl; bz /= bl;
        let camY, px, pz;
        if (A.over) {
            // Straight down from above, pulled back a little so the frame is not all scalp.
            camY = t.y + t.h + Math.max(1.5, dist);
            px = t.x + bx * 0.3; pz = t.z + bz * 0.3;
        } else {
            camY = t.y + (A.m != null ? A.m : A.h * t.h);
            px = t.x + bx * dist; pz = t.z + bz * dist;
        }
        const horiz = Math.hypot(t.x - px, t.z - pz) || 1e-6;
        const yaw = Math.atan2(-(t.x - px), -(t.z - pz)) * 180 / Math.PI;
        const tilt = A.over ? -85 : Math.atan2(aimY - camY, horiz) * 180 / Math.PI;
        c.position = [px / k, camY / k, pz / k];
        const roll = dutch === undefined ? ((c.rotation || [])[2] || 0) : (dutch ? 15 : 0);
        c.rotation = [yaw, Math.max(-85, Math.min(85, tilt)), roll];
        WALK.moved = true;
        worldWalkRepaint();
        if (t.implied) {
            worldImpliedSubjectKeep();
            setStatus(`${F.label}, ${A.label.toLowerCase()}: framed on a person-sized spot where the camera was looking. Stage someone on the Plan to frame them instead.`);
        }
        worldWalkKeep();
    }

    /*
     * WHO THE SHOT IS ON. Framing, the angle's height and the lighting rig are
     * all measured on the framing subject — which was simply whoever was
     * staged first. Any staged person, piece of furniture or model can be the
     * subject; the names are the ones given on the Plan (rename "Woman" to the
     * character there).
     */
    function worldShotOnHtml() {
        const subs = stageSubjects();
        if (!subs.length) return '<p class="we-hint">Nobody is staged yet, so framing and angle work on what the camera is looking at. Add people on the Plan view to frame them.</p>';
        const cur = Math.max(0, subs.findIndex(x => x.isTarget));
        return `<div class="we-oprow"><span class="we-oplabel">Shot on</span>
            <select class="we-shoton" onchange="worldShotOn(Number(this.value))">${subs.map((x, i) =>
                `<option value="${i}"${i === cur ? ' selected' : ''}>${esc(x.name || ('subject ' + (i + 1)))}</option>`).join('')}</select>
            <button class="we-btn" onclick="worldSetViewMode('plan')" title="Rename or move them on the Plan view">Rename / move</button></div>`;
    }

    function worldShotOn(i) {
        const subs = stageSubjects();
        if (!subs[i]) return;
        subs.forEach((x, k) => { if (k === i) x.isTarget = true; else delete x.isTarget; });
        stageSave();
        worldConsoleRender();
        setStatus(`The shot is on ${subs[i].name || 'subject ' + (i + 1)}: framing, angle and lighting are measured on them`);
    }

    function worldShotHtml() {
        const now = worldShotNow();
        const t = worldShotSubject();
        const chip = (fn, id, label, on, title) =>
            `<button class="we-shotchip${on ? ' active' : ''}" onclick="${fn}" title="${esc(title || label)}">${esc(label)}</button>`;
        return `
            <div class="we-panel we-shotpanel">
              <div class="we-label">SHOT</div>
              ${worldShotOnHtml()}
              <div class="we-opgroup">FRAMING</div>
              <div class="we-shotchips">${SHOT_FRAMINGS.map(f =>
                  chip(`worldShotPlace('${f.id}', null)`, f.id, f.short, now.framing === f.id, f.label)).join('')}</div>
              <div class="we-opgroup">ANGLE</div>
              <div class="we-shotchips">${SHOT_ANGLES.map(a =>
                  chip(`worldShotPlace(null, '${a.id}')`, a.id, a.label, now.angle === a.id)).join('')}
                  ${chip(`worldShotPlace(null, null, ${now.dutch ? 'false' : 'true'})`, 'dutch', 'Dutch', now.dutch, 'Tilt the horizon 15°')}</div>
              <p class="we-hint">Framing is solved for the lens below; change the lens to go granular. Keeps the side you shoot from.</p>
            </div>`;
    }

    const PV_LIGHT = { vocab: null };

    async function worldLightVocab() {
        if (PV_LIGHT.vocab) return PV_LIGHT.vocab;
        try { PV_LIGHT.vocab = await api('/card-vocabulary'); } catch (_) { PV_LIGHT.vocab = { lighting: [], lighting_techniques: [] }; }
        if (typeof worldConsoleRender === 'function' && state.currentPage === 'previs') worldConsoleRender();
        return PV_LIGHT.vocab;
    }

    function worldLightHtml() {
        const v = PV_LIGHT.vocab;
        if (!v) { worldLightVocab(); return '<div class="we-panel"><p class="we-hint">Loading lighting…</p></div>'; }
        const lit = (WORLD.blocking && WORLD.blocking.lighting) || {};
        const src = lit.sources || {};
        const from = id => src[id] ? ` <span class="we-live">from the ${src[id] === 'previs' ? 'Previs stage' : src[id]}</span>` : '';
        const chip = (fn, label, on, title) =>
            `<button class="we-shotchip${on ? ' active' : ''}" onclick="${fn}" title="${esc(title || label)}">${esc(label)}</button>`;
        const tech = (v.lighting_techniques || []).map(t =>
            chip(`worldLightSet({ technique: ${lit.technique === t.id ? 'null' : `'${t.id}'`} })`, t.label, lit.technique === t.id)).join('');
        const moods = (v.lighting || []).map(m =>
            chip(`worldLightSet({ type: ${lit.type === m ? 'null' : `'${m}'`} })`, m.replace(/-/g, ' '), lit.type === m)).join('');
        const where = lit.location ? esc(lit.location.name) : 'this location';
        return `
            <div class="we-panel we-lightpanel">
              <div class="we-label">LIGHTING <span class="we-live">${lit.technique || lit.type ? '' : 'not set'}</span></div>
              <div class="we-opgroup">TECHNIQUE${from('technique')}</div>
              <div class="we-shotchips">${tech}</div>
              <div class="we-opgroup">KEY LIGHT FROM${from('key_side')}</div>
              <div class="we-shotchips">
                ${chip("worldLightSet({ key_side: 'left' })", 'Camera left', lit.key_side === 'left')}
                ${chip("worldLightSet({ key_side: 'right' })", 'Camera right', lit.key_side !== 'left')}</div>
              <div class="we-opgroup">MOOD${from('type')}</div>
              <div class="we-shotchips">${moods}</div>
              ${lit.notes ? `<p class="we-hint">Note${from('notes')}: ${esc(lit.notes)}</p>` : ''}
              <div class="we-shotchips">
                ${chip(`worldLightShow()`, WORLD.showLights === false ? 'Show lights in Look' : 'Lights on in Look', WORLD.showLights !== false)}
                <button class="we-btn" onclick="worldLightSet(null)" title="Stop staging lighting here: the shot's card, else ${where}, decides">Clear staged</button>
              </div>
              <p class="we-hint">Staged here for this shot; <b>Apply</b> writes it to the shot, and the board frame is generated with it.
              A shot with no lighting of its own takes ${where}'s; the film's general look is the mood board's style.
              Lights are set from the saved camera, so they stay put while you walk.</p>
            </div>`;
    }

    async function worldLightSet(change) {
        if (WORLD.scout) return previzWorkspace.light(change);
        const shotId = WORLD.shotId, selection = WORLD.selectionRevision;
        if (!WORLD.shotId) return;
        const lit = (WORLD.blocking && WORLD.blocking.lighting) || {};
        let next = null;
        if (change) {
            next = { technique: lit.technique || undefined, type: lit.type || undefined,
                     key_side: lit.key_side || undefined, notes: (lit.sources && lit.sources.notes === 'previs') ? lit.notes : undefined };
            for (const [k, val] of Object.entries(change)) { if (val == null) delete next[k]; else next[k] = val; }
            for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        }
        try {
            await api(`/shots/${shotId}/previs/director`, { method: 'PUT',
                body: JSON.stringify({ lighting: next }) });
        } catch (err) { return setStatus('Lighting not saved: ' + err.message); }
        if (WORLD.shotId === shotId && WORLD.selectionRevision === selection) await worldRefreshBlocking(shotId, selection);
        worldMeshRequestRender();
    }

    function worldLightShow() { WORLD.showLights = WORLD.showLights === false; worldConsoleRender(); worldMeshRequestRender(); worldPaintFrame(); }

    function worldOperateHtml() {
        /*
         * THE AXES ALWAYS RENDER. Hiding them until a camera is saved would
         * leave a shot nobody has blocked — which is most of them — with no
         * way to move the camera at all, and a nudge IS meaningful there: the
         * route builds the proposal from the shot's blocking and validates it
         * either way.
         */
        const scrubs = OPERATE_SCRUB.map(a => {
            const v = worldOperateValue(a.id);
            return `<div class="we-oprow">
                <span class="we-oplabel">${esc(a.label)}</span>
                <span class="we-scrub" data-scrub="${a.id}" title="Drag sideways to change (Shift finer, Alt coarser); double-click to type"
                      >${v == null ? '—' : v.toFixed(a.fmt)}</span><span class="we-scrub-u">${esc(a.unit)}</span>
              </div>`;
        }).join('');
        // Directions named in words: "−0.25" said nothing about which way.
        const words = { dollyM: ['in', 'out'], truckM: ['left', 'right'], pedestalM: ['down', 'up'],
                        panDeg: ['right', 'left'], tiltDeg: ['down', 'up'], rollDeg: ['−', '+'] };
        const groups = ['TRANSLATION', 'ROTATION'].map(g => `
                <div class="we-opgroup">${g} · STEP</div>
                ${OPERATE_AXES.filter(a => a.group === g).map(a => {
                    const [lo, hi] = words[a.field] || ['−', '+'];
                    // A negative dolly is forward (camera-local −Z), so "in" sends the negative step.
                    return `<div class="we-oprow">
                    <span class="we-oplabel">${esc(a.label)} (${esc(a.unit)})</span>
                    <button class="we-btn" onclick="worldNudge('${a.field}', ${-a.step})">${lo} ${a.step}</button>
                    <button class="we-btn" onclick="worldNudge('${a.field}', ${a.step})">${hi} ${a.step}</button>
                  </div>`; }).join('')}`).join('');
        return `
            <div class="we-panel" data-region="camera-operate">
              <div class="we-label">CAMERA OPERATE</div>
              ${scrubs}
              ${groups}
              <p class="we-hint">Every move is checked against the geometry before it is kept.
              Scroll in the view to dolly, drag to look, right-drag to slide.</p>
            </div>`;
    }

    const SCRUB = { drag: null };

    /** A nudge is a PROPOSAL, validated like every other camera change. */
    async function worldNudge(field, amount) {
        if (WORLD.scout) {
            const axis = { dollyM: ['distance', -1], truckM: ['side', 1], pedestalM: ['height', 1], panDeg: ['pan', 1], tiltDeg: ['tilt', 1], rollDeg: ['roll', 1] }[field];
            if (axis) { worldOperateApply(axis[0], amount * axis[1]); previzWorkspace.changed(); }
            return;
        }
        const shotId = WORLD.shotId, selection = WORLD.selectionRevision;
        if (!WORLD.shotId) return;
        const axis = OPERATE_AXES.find(a => a.field === field);
        try {
            // The proposal contract: the move under `changes`, and a rationale.
            // Sent flat, every nudge was refused ("the proposal changes
            // nothing") and the only sign was a line on the status bar.
            await api(`/shots/${shotId}/direct`, { method: 'POST', body: JSON.stringify({
                rationale: `Camera Operate: ${axis ? axis.label : field} ${amount > 0 ? '+' : ''}${amount}${axis ? axis.unit : ''}`,
                changes: { [field]: amount }, apply: true,
            }) });
            const blocking = await api(`/shots/${shotId}/previs`);
            if (WORLD.shotId !== shotId || WORLD.selectionRevision !== selection) return;
            WORLD.blocking = blocking;
        } catch (err) { setStatus('That move was refused: ' + err.message); }
        worldConsoleRender();
    }

    /* ── Blocking: what is actually staged ───────────────────────────────── */
    const BLOCKING_REPS = Object.freeze(['CARD', 'PROXY', 'MESH']);

    function worldBlockingHtml() {
        const subjects = ((WORLD.blocking && WORLD.blocking.blocking
            && WORLD.blocking.blocking.subjects) || []);
        return `
            <div class="we-panel" data-region="blocking">
              <div class="we-label">BLOCKING</div>
              ${subjects.length ? subjects.map((su, i) => `
                <div class="we-blockrow">
                  <span>
                    <span class="we-shot-name">${esc(su.name || 'unnamed')}</span>
                    <span class="we-tile-spec">${su.height != null ? weM(su.height) : ''}</span>
                  </span>
                  <span>${BLOCKING_REPS.map(r =>
                    `<button class="we-btn${(su.rep || 'PROXY') === r ? ' we-amber' : ''}"
                             onclick="worldSetRep(${i}, '${r}')">${r}</button>`).join('')}</span>
                </div>`).join('')
                : '<p class="we-hint">Nothing is staged in this shot yet.</p>'}
            </div>`;
    }

    function worldSetRep(i, rep) {
        const subs = ((WORLD.blocking && WORLD.blocking.blocking
            && WORLD.blocking.blocking.subjects) || []);
        if (subs[i]) subs[i].rep = rep;
        worldConsoleRender();
    }

    /* ── The two strips ──────────────────────────────────────────────────── */
    function worldSecondaryHtml(project) {
        const cam = (WORLD.blocking && WORLD.blocking.blocking && WORLD.blocking.blocking.camera) || {};
        const scene = WORLD.scene || {};
        const panel = (title, aside, rows) => `
                <div class="we-quiet">
                  <div class="we-panel-head"><span class="we-label">${esc(title)}</span>
                    <span class="we-live">${esc(aside || '—')}</span></div>
                  ${rows.map(([k, v]) => `<div class="we-row"><span>${esc(k)}</span>`
                    + `<span>${esc(v == null || v === '' ? '—' : String(v))}</span></div>`).join('')}
                </div>`;
        return `
            <div class="we-secondary" data-region="secondary-strip">
              ${panel('LIGHTING', scene.time_of_day, [
                  ['Key', scene.lighting_default], ['Notes', scene.sound_notes ? '' : ''],
              ])}
              ${panel('CAMERA BODY & RIG', cam.sensorId, [
                  ['Sensor', cam.sensorId], ['Rig', WORLD.blocking && WORLD.blocking.blocking
                      ? WORLD.blocking.blocking.rig : null],
              ])}
              ${panel('PLATE & OUTPUT', project && project.aspect_ratio, [
                  ['Plate size', project && project.target_resolution],
                  ['Frame rate', project && project.frame_rate],
              ])}
            </div>`;
    }

    /*
     * ONE OPEN AT A TIME, from the design. Two open at once renders the
     * four-column grid twice and the strip is no longer collapsed.
     */
    const ADVANCED_CHIPS = Object.freeze([
        { key: 'xyz',    label: 'Exact X / Y / Z' },
        { key: 'curves', label: 'Movement curves' },
        { key: 'focus',  label: 'Focus & DOF' },
        { key: 'lens',   label: 'Lens family & distortion' },
        { key: 'ai',     label: 'AI parameters' },
    ]);

    function worldAdvancedRows(key) {
        const cam = (WORLD.blocking && WORLD.blocking.blocking && WORLD.blocking.blocking.camera) || {};
        const rows = {
            xyz: cam.position ? [['X', weM(cam.position[0])], ['Y', weM(cam.position[1])],
                                 ['Z', weM(cam.position[2])],
                                 ['ROT', (cam.rotation || []).map(r => weDeg(r)).join(' / ')]] : [],
            curves: ((WORLD.blocking && WORLD.blocking.blocking
                && WORLD.blocking.blocking.moves) || []).map((mv, i) =>
                    [`LEG ${String(i + 1).padStart(2, '0')}`, mv.ease || 'linear']),
            focus: [['FOCUS', cam.focusDistanceM != null ? weM(cam.focusDistanceM) : null],
                    ['APERTURE', cam.fStop != null ? 'f' + cam.fStop : null]]
                    .filter(r => r[1] != null),
            lens: [['FOCAL', cam.focalMm != null ? cam.focalMm + 'mm' : null],
                   ['SENSOR', cam.sensorId || null]].filter(r => r[1] != null),
            /*
             * NOT a model name typed here. The design's "dp-agent v4" is demo
             * data for a product that does not exist; what is true is which
             * path an AI request takes, which the engine already reports.
             */
            ai: [['PATH', AI_PATH.connected ? (AI_PATH.client || 'agent host over MCP') : 'no agent connected'],
                 ['PROPOSALS', 'written by the connected model, validated here']],
        };
        return rows[key] || [];
    }

    function worldAdvancedHtml() {
        const open = WORLD.adv || null;
        const rows = open ? worldAdvancedRows(open) : [];
        return `
            <div class="we-advanced" data-region="advanced-strip">
              <div class="we-label">ADVANCED</div>
              <div class="we-chips">${ADVANCED_CHIPS.map(c =>
                `<button class="we-chip-btn${open === c.key ? ' active' : ''}"
                         onclick="worldToggleAdvanced('${c.key}')">${
                  open === c.key ? '▾' : '▸'} ${esc(c.label)}</button>`).join('')}</div>
              ${open ? (rows.length
                ? `<div class="we-advgrid">${rows.map(([k, v]) =>
                    `<div class="we-row"><span>${esc(k)}</span><span>${esc(String(v))}</span></div>`).join('')}</div>`
                : '<p class="we-hint">Nothing recorded for this shot yet.</p>') : ''}
            </div>`;
    }

    function worldToggleAdvanced(key) {
        WORLD.adv = WORLD.adv === key ? null : key;
        worldConsoleRender();
    }

    function worldConsoleHtml(project, world, version) {
        if (worldFlagOn('previs_console')) return worldConsoleV2Html(project, world, version);
        const ratio = worldFrameRatio(project);
        const m = worldMeasurements(version, []);
        const lenses = worldLenses().map(mm =>
            `<button class="we-lens${mm === WORLD.lens ? ' active' : ''}"
                     onclick="worldSetLens(${mm})">${mm}</button>`).join('');
        return `
        <div class="we-console">
          <div class="we-head">
            <div>
              <span class="we-title">${esc((world && world.name) || 'No world yet')}</span>
              <span class="we-meta">${esc(version ? 'v' + version.version : 'no version')} · ${esc(m.state)}</span>
              ${world && world.locked ? '<span class="we-chip">WORLD LOCKED</span>' : ''}
            </div>
            <div>
              ${worldRegionOn('create-spatial-world')
                ? '<button class="we-btn" onclick="worldOpenCreate()">NEW WORLD</button>' : ''}
            </div>
          </div>
          <div class="we-main">
            <div class="we-rail">${worldRailHtml()}</div>
            <div class="we-center">
              <div class="we-panel we-camera">
                <div class="we-panel-head">
                  <span class="we-label">CAMERA VIEW</span>
                  <span class="we-live" id="weCamSpec"></span>
                  <button class="we-btn" onclick="worldToggleOverlayMenu()">OVERLAYS · <span id="weOvCount">0</span></button>
                  ${worldRegionOn('match-reference-composition')
                    ? '<button class="we-btn we-amber" onclick="worldOpenMatchReference()">MATCH REFERENCE</button>' : ''}
                </div>
                <div class="we-ov-menu" id="weOverlayMenu" style="display:none;">${worldOverlayMenuHtml()}</div>
                <div class="we-frame" id="weFrame"
                     style="aspect-ratio:${ratio}; max-width:min(100%, calc(52vh * ${ratio}));">
                  <canvas id="weFrameCanvas"></canvas>
                  <div class="we-readout" id="weReadout"></div>
                  <div class="we-plate-note">GEOMETRIC PLATE — NOT FINAL</div>
                </div>
                <div class="we-actions">
                  <button class="we-render" onclick="worldRenderPlate()">RENDER GENERATION PLATE</button>
                </div>
              </div>
              ${worldRegionOn('direct-the-shot') ? worldDirectPanelHtml() : ''}
              ${worldRegionOn('explore-shot') ? worldExplorePanelHtml() : ''}
              ${worldTimelineHtml()}
            </div>
            <div class="we-right">
              ${worldRegionOn('spatial-world') ? worldSpatialHtml(world, version) : ''}
              ${worldShotHtml()}
              <div class="we-panel">
                <div class="we-label">LENS <span class="we-live" id="weLensNow">${WORLD.lens}mm</span></div>
                <div class="we-lenses">${lenses}</div>
                <div class="we-modes">
                  <button class="we-mode${WORLD.mode === 'maintain' ? '' : ' active'}" data-mode="keep"
                          onclick="worldSetMode('keep')">KEEP POSITION</button>
                  <button class="we-mode${WORLD.mode === 'maintain' ? ' active' : ''}" data-mode="maintain"
                          onclick="worldSetMode('maintain')">MAINTAIN SIZE</button>
                </div>
                <p class="we-hint" id="weModeHint"></p>
              </div>
              <div class="we-panel">
                <div class="we-label">MEASUREMENTS <span class="we-live">${esc(m.state)}</span></div>
                <div id="weMeasure" class="we-rows"></div>
              </div>

              <div class="we-panel">
                <div class="we-label">GENERATION RISK
                  <span class="we-live" id="weRiskGrade">—</span></div>
                <div id="weRisk" class="we-rows">
                  <button class="we-btn" onclick="worldScoreComplexity()">Score this shot — free</button>
                </div>
              </div>

              ${worldOperateHtml()}
              ${worldBlockingHtml()}
              <div class="we-panel">
                <div class="we-label">HANDOVER
                  <span class="we-live" id="weExportState">—</span></div>
                <div id="weExport" class="we-rows">
                  <button class="we-btn" onclick="worldCheckExport()">What can be exported — free</button>
                </div>
              </div>
            </div>
          </div>
          ${worldSecondaryHtml(project)}
          ${worldAdvancedHtml()}
        </div>`;
    }

    /* ── THE CONSOLE AS ONE SCREEN (previs_console) ──────────────────────
     *
     * The same regions the handoff draws, rearranged so nothing scrolls: the
     * camera view takes whatever height the window has, the move sits under
     * it the way a timeline sits under a viewer, and the right column's
     * panels go behind four tabs. Every region is the SAME function the
     * two-column layout calls, so a region cannot behave differently here.
     *
     * Inactive tabs are hidden, not omitted: the score, measurement and
     * handover writers find their elements by id, and a tab that is not open
     * must still be where their answer lands.
     */
    const PV_TABS = Object.freeze([
        { id: 'camera',  label: 'Camera' },
        { id: 'light',   label: 'Light' },
        { id: 'direct',  label: 'Shot brief' },
        { id: 'explore', label: 'Explore' },
        { id: 'scene',   label: 'Scene' },
    ]);

    /* What each state is called on a chip, and the one-line reason behind it. */
    const PV_DECISION_STATES = Object.freeze({
        none:       { mark: '–', text: 'not set',       tip: 'Nothing staged for this yet.' },
        trying:     { mark: '○', text: 'trying',        tip: 'Changed here, not on the shot yet — Apply sends it to the scene card.' },
        applied:    { mark: '✓', text: 'applied',       tip: 'On the scene card: generation sends this. Click to lock it.' },
        locked:     { mark: '●', text: 'locked',        tip: 'Locked: generation will send exactly this. Click to unlock.' },
        card_ahead: { mark: '!', text: 'board changed', tip: 'Changed on the Shot Board after it was applied here.' },
        conflict:   { mark: '!', text: 'conflict',      tip: 'Changed here AND on the Shot Board since it was applied.' },
        stale:      { mark: '!', text: 'changed',       tip: 'Locked, then changed. Apply and lock again, or unlock it.' },
    });

    function worldDecisionsHtml() {
        const shot = (WORLD.shots || []).find(s => s.id === WORLD.shotId);
        const decisions = (WORLD.blocking && WORLD.blocking.decisions) || [];
        if (!shot && WORLD.scout) {
            return `<div class="pv-decisions"><span class="pv-shot-code">SET</span>
                <span class="pv-shot-name">${esc(WORLD.scout.name)}</span>
                <span class="pv-dim">Scouting: walk the set as the camera. Nothing is kept until you make a shot from a view.</span>
                <div class="pv-spacer"></div>
                <button class="pv-btn pv-primary" onclick="worldScoutMakeShot()">Make a shot from this camera</button></div>`;
        }
        if (!shot) {
            return `<div class="pv-decisions"><span class="pv-dec-label">DECISIONS</span>
                <span class="pv-dim">Pick a shot to see what is decided for it.</span></div>`;
        }
        const trying = decisions.filter(d => d.state === 'trying').length;
        const lockable = decisions.filter(d => d.state === 'applied').length;
        const allLocked = decisions.some(d => d.state === 'locked') && !lockable && !trying;
        const chips = decisions.map(d => {
            const st = PV_DECISION_STATES[d.state] || PV_DECISION_STATES.none;
            return `<button class="pv-dec pv-dec-${esc(d.state)}" title="${esc(d.label + ' — ' + st.tip)}"
                        onclick="worldDecisionClick('${esc(d.id)}')">
                      <span class="pv-dec-mark">${st.mark}</span>${esc(d.label)}
                      <span class="pv-dec-state">${esc(st.text)}</span></button>`;
        }).join('');
        return `
          <div class="pv-decisions">
            <span class="pv-shot-code">${esc(shot.shot_code || '')}</span>
            <span class="pv-shot-name">${esc(shot.location || shot.description || '')}</span>
            <span class="pv-dec-label">DECISIONS</span>
            <div class="pv-dec-row">${chips || '<span class="pv-dim">Nothing blocked yet — move the camera to start.</span>'}</div>
            <div class="pv-spacer"></div>
            ${trying ? `<button class="pv-btn" onclick="worldApplyDecisions()">Apply ${trying} to the shot</button>` : ''}
            ${allLocked
                ? '<button class="pv-btn" onclick="worldLockShot(false)">Unlock shot</button>'
                : `<button class="pv-btn pv-primary" onclick="worldLockShot(true)"${decisions.length ? '' : ' disabled'}>Lock shot</button>`}
          </div>`;
    }

    async function worldRefreshBlocking(shotId = WORLD.shotId, selection = WORLD.selectionRevision) {
        if (!shotId) return;
        try {
            const blocking = await api(`/shots/${shotId}/previs`);
            if (WORLD.shotId !== shotId || WORLD.selectionRevision !== selection) return;
            WORLD.blocking = blocking;
        } catch (_) { /* keep this selection's existing blocking */ }
        if (WORLD.shotId !== shotId || WORLD.selectionRevision !== selection) return;
        worldHydrateMove();
        worldConsoleRender();
    }

    /** What Apply sends with it: the framing Previz shows now (shot size by coverage), which the stage alone cannot say. */
    function worldApplyBody() {
        let now = {};
        try { now = worldShotNow() || {}; } catch (_) { now = {}; }
        return JSON.stringify(now.framing ? { framing: now.framing } : {});
    }

    async function worldApplyDecisions() {
        const shotId = WORLD.shotId, selection = WORLD.selectionRevision;
        if (!WORLD.shotId) return;
        try {
            await api(`/shots/${shotId}/previs/apply`, { method: 'POST', body: worldApplyBody() });
            setStatus('Applied to the shot — generation now sends it');
        } catch (err) { setStatus('Could not apply: ' + err.message); }
        if (WORLD.shotId === shotId && WORLD.selectionRevision === selection) await worldRefreshBlocking(shotId, selection);
    }

    /* Clicking a chip does the next sensible thing for it — never something that spends. */
    async function worldDecisionClick(id) {
        const shotId = WORLD.shotId, selection = WORLD.selectionRevision;
        const d = ((WORLD.blocking && WORLD.blocking.decisions) || []).find(x => x.id === id);
        if (!d || !WORLD.shotId) return;
        if (d.state === 'trying') return worldApplyDecisions();
        const route = d.state === 'applied' ? 'lock' : (d.state === 'locked' || d.state === 'stale') ? 'unlock' : null;
        if (!route) {
            return setStatus(d.state === 'none' ? `${d.label}: nothing staged to lock yet`
                : `${d.label}: re-seed from the Shot Board before locking`, d.state !== 'none');
        }
        try {
            await api(`/shots/${shotId}/previs/${route}`,
                { method: 'POST', body: JSON.stringify({ decisions: [id] }) });
            setStatus(`${d.label} ${route === 'lock' ? 'locked' : 'unlocked'}`);
        } catch (err) { setStatus(err.message); }
        if (WORLD.shotId === shotId && WORLD.selectionRevision === selection) await worldRefreshBlocking(shotId, selection);
    }

    /* Lock shot = apply what is still being tried, then lock everything applied and sign it off. */
    async function worldLockShot(lock) {
        const shotId = WORLD.shotId, selection = WORLD.selectionRevision;
        if (!WORLD.shotId) return;
        const decisions = (WORLD.blocking && WORLD.blocking.decisions) || [];
        try {
            if (lock && decisions.some(d => d.state === 'trying')) {
                await api(`/shots/${shotId}/previs/apply`, { method: 'POST', body: worldApplyBody() });
            }
            await api(`/shots/${shotId}/previs/${lock ? 'lock' : 'unlock'}`,
                { method: 'POST', body: JSON.stringify({ all: true }) });
            setStatus(lock ? 'Shot locked — production will send exactly these decisions' : 'Shot unlocked');
        } catch (err) { setStatus(err.message); }
        if (WORLD.shotId === shotId && WORLD.selectionRevision === selection) await worldRefreshBlocking(shotId, selection);
    }

    function worldSetTab(id) {
        WORLD.tab = id;
        if (id === 'light') WORLD.tool = 'lights';
        else if (WORLD.tool === 'lights') WORLD.tool = 'select';
        worldConsoleRender();
    }

    function worldToggleTimeline() { WORLD.timelineOpen = !WORLD.timelineOpen; worldConsoleRender(); }

    async function worldToolSelect(id) {
        WORLD.tool = id;
        if (id === 'walk') return worldWalkToggle();
        if (id === 'people') {
            if (worldViewMode() !== 'plan') await worldSetViewMode('plan');
            return stageOpenAdd('people');
        }
        if (id === 'edit') {
            if (worldViewMode() !== 'plan') await worldSetViewMode('plan');
            return setEditStart();
        }
        if (id === 'lights') return worldSetTab('light');
        worldConsoleRender();
    }

    function worldToolRailHtml() {
        const active = SETEDIT.on ? 'edit' : WALK.on ? 'walk' : WORLD.tab === 'light' ? 'lights' : (WORLD.tool || 'select');
        const tool = (id, label, title) => `<button class="pv-tool${active === id ? ' active' : ''}"
            onclick="worldToolSelect('${id}')" title="${esc(title)}">${pvIcon(id, 22)}<span>${label}</span></button>`;
        return `<div class="pv-toolrail" role="toolbar" aria-label="Previs tools">
            ${tool('select', 'Select', 'Select and frame the shot')}
            ${tool('walk', 'Walk', 'Walk the set with the keyboard and mouse')}
            ${tool('people', 'People', 'Add people, furniture or a model to the Plan')}
            ${tool('edit', 'Edit set', 'Move, turn or remove furniture in the built set')}
            ${tool('lights', 'Lights', 'Open the lighting inspector')}
        </div>`;
    }

    /* The approved Previs artifact uses one quiet line-icon family throughout.
       Keeping the paths here prevents platform emoji and font glyphs from
       changing the controls' meaning or alignment. */
    const PV_ICONS = Object.freeze({
        select: '<path d="M5 3l14 8-6 2-2 6z"></path>',
        walk: '<circle cx="12" cy="12" r="3"></circle><path d="M2 12h3M19 12h3M12 2v3M12 19v3"></path>',
        people: '<circle cx="10" cy="6" r="3"></circle><path d="M4 21v-3a6 6 0 0 1 12 0v3M19 8v6M16 11h6"></path>',
        edit: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"></path><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"></path>',
        lights: '<path d="M9 18h6M10 21h4"></path><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"></path>',
        'chevron-down': '<path d="M6 9l6 6 6-6"></path>',
        'chevron-up': '<path d="M6 15l6-6 6 6"></path>',
        'look-around': '<path d="M21 12a9 4 0 1 1-4-3.3"></path><path d="M17 5v4h4"></path>',
        more: '<circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none"></circle>',
        play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"></path>',
        timeline: '<path d="M4 7h16M4 12h16M4 17h10"></path>',
    });

    function pvIcon(name, size = 18) {
        return `<svg class="pv-icon" data-pv-icon="${esc(name)}" width="${size}" height="${size}" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PV_ICONS[name] || ''}</svg>`;
    }

    function worldDecisionSummaryHtml() {
        const decisions = (WORLD.blocking && WORLD.blocking.decisions) || [];
        const decided = decisions.filter(d => d.state === 'applied' || d.state === 'locked').length;
        const total = decisions.length || 7;
        const trying = decisions.filter(d => d.state === 'trying').length;
        const lockable = decisions.some(d => d.state === 'applied' || d.state === 'trying');
        const allLocked = decisions.some(d => d.state === 'locked') && !lockable;
        const dots = Array.from({ length: Math.min(total, 10) }, (_, i) =>
            `<span class="pv-decision-dot${i < decided ? ' done' : ''}"></span>`).join('');
        return `<details class="pv-decision-menu">
              <summary class="pv-btn"><span class="pv-decision-dots">${dots}</span>${decided} of ${total} decided</summary>
              <div class="pv-decision-pop">${worldDecisionsHtml()}</div>
            </details>
            ${trying ? `<button class="pv-btn" onclick="worldApplyDecisions()">Apply to shot</button>` : ''}
            ${allLocked
                ? '<button class="pv-btn" onclick="worldLockShot(false)">Unlock shot</button>'
                : `<button class="pv-btn pv-primary" onclick="worldLockShot(true)"${decisions.length ? '' : ' disabled'}>Lock shot</button>`}`;
    }

    function worldMoreMenuHtml() {
        return `<details class="pv-more">
          <summary class="pv-btn pv-more-button" aria-label="More actions">${pvIcon('more')}</summary>
          <div class="pv-more-menu" role="menu" aria-label="More actions">
            <span class="pv-menu-label">This shot</span>
            <button class="pv-more-item" onclick="worldRenderPlate()"><b>Render the frame</b><span>The board frame from this camera</span></button>
            ${worldRegionOn('match-reference-composition') ? '<button class="pv-more-item" onclick="worldOpenMatchReference()"><b>Match a reference</b><span>Line the camera up to a picture you like</span></button>' : ''}
            <button class="pv-more-item" onclick="worldScoreComplexity()"><b>Risk check</b><span>How likely this shot is to come back wrong · <i id="weRiskGrade">—</i></span></button>
            <span class="pv-menu-label">The set</span>
            <button class="pv-more-item" onclick="setBuildOpen()"><b>Build or rebuild the set</b><span>From the location's photos or scan · free</span></button>
            <button class="pv-more-item" onclick="worldSetTab('scene')"><b>Other versions of this set</b><span>Choose the world version and inspect the scene</span></button>
            ${worldRegionOn('create-spatial-world') ? '<button class="pv-more-item" onclick="worldOpenCreate()"><b>New world</b><span>Start a set from scratch</span></button>' : ''}
            <span class="pv-menu-label">Workspace</span>
            ${PV_FOLDS.map(f => `<button class="pv-more-item" onclick="pvToggleFold('${f.id}')"><b>${pvFolded(f.id) ? 'Show' : 'Hide'} ${f.id === 'left' ? 'shot list' : f.id === 'right' ? 'inspector' : 'move dock'}</b><span>${esc(f.tip)}</span></button>`).join('')}
            <span class="pv-menu-label">Hand off</span>
            <button class="pv-more-item" onclick="worldSetTab('scene');worldCheckExport()"><b>Handover to the crew</b><span>Camera, lens, marks and plan · <i id="weExportState">—</i></span></button>
            <button class="pv-more-item" onclick="previzVideoExport(this)"><b>Export previz video</b><span>The move through the set as an MP4 · free</span></button>
          </div>
        </details>`;
    }

    function worldShotPickerHtml(shots) {
        const shot = shots.find(s => s.id === WORLD.shotId);
        return `<details class="pv-shot-picker">
          <summary class="pv-btn"><span class="pv-shot-badge">${esc(shot ? shot.shot_code : (WORLD.scout ? 'SET' : '—'))}</span>
            <span class="pv-shot-current">${esc(shot ? (shot.location || shot.description || 'Shot') : (WORLD.scout ? WORLD.scout.name : 'Choose a shot'))}</span>
            <span class="pv-dim">${esc(WORLD.version ? 'set v' + WORLD.version.version : '')}</span>${pvIcon('chevron-down', 16)}</summary>
          <div class="pv-shot-menu">${shots.length ? shots.map(sh => `<button class="pv-more-item${sh.id === WORLD.shotId ? ' active' : ''}"
              onclick="worldRailSelect('${sh.id}')"><b>${esc(sh.shot_code || '')}</b><span>${esc(sh.location || sh.description || '')}</span></button>`).join('')
              : '<span class="pv-dim">No shots yet — break the screenplay down first.</span>'}</div>
        </details>`;
    }

    function worldMoveDockHtml() {
        const dur = (WORLD.durationMs || 4000) / 1000;
        if (WORLD.timelineOpen) return `<div class="pv-timeline-drawer">
            <button class="pv-btn pv-timeline-close" onclick="worldToggleTimeline()" aria-label="Close timeline">Close timeline</button>
            ${worldTimelineHtml()}
          </div>`;
        const hasMove = (WORLD.moves || []).length || (WORLD.keys || []).length;
        const lenIn = `<input class="pv-num pv-len" type="number" min="0.5" max="60" step="0.5" value="${dur.toFixed(1)}" onchange="worldSetLength(this.value)" aria-label="Length of the move in seconds" title="Length of the move. Keys keep their time in seconds; past the last key the camera holds.">`;
        const shotMs = ((WORLD.shots || []).find(s => s.id === (WORLD.shotId || WORLD.targetId)) || {}).duration_ms || 0;
        const shotLen = shotMs > 0 && Math.abs(shotMs - (WORLD.durationMs || 4000)) >= 50
            ? `<button class="pv-btn pv-shotlen" onclick="worldSyncShotLength()" title="The shot's length on its storyboard card is what Generate and the cut use">Shot is ${(shotMs / 1000).toFixed(1)} s · make it ${dur.toFixed(1)} s</button>` : '';
        return `<div class="pv-movedock">
          <button class="pv-play" onclick="worldPlayMove()" aria-label="Play the move">${pvIcon('play')}</button>
          <span class="pv-time">${((WORLD.t || 0) * dur).toFixed(1)} <span>/ ${lenIn} s</span></span>${shotLen}
          <div class="pv-move-summary"><span class="pv-playhead" style="left:${Math.round((WORLD.t || 0) * 100)}%"></span>
            ${hasMove ? '<span>Camera move and authored keys</span>' : '<span>No move yet — the camera holds. Add a key to start one.</span>'}</div>
          <button class="pv-btn" onclick="worldAddKey()">+ Key</button>
          <button class="pv-btn" onclick="worldToggleTimeline()">${pvIcon('timeline', 16)}Timeline${pvIcon('chevron-up', 16)}</button>
          <canvas id="wePathCanvas" class="we-path pv-path-hidden"></canvas>
        </div>`;
    }

    function worldConsoleV2Html(project, world, version) {
        const m = worldMeasurements(version, []);
        const tab = WORLD.tab || 'camera';
        const lenses = worldLenses().map(mm =>
            `<button class="we-lens${mm === WORLD.lens ? ' active' : ''}"
                     onclick="worldSetLens(${mm})">${mm}</button>`).join('');
        const shots = WORLD.shots || [];
        const pane = (id, html) => `<div class="pv-tabpane${tab === id ? '' : ' pv-hidden'}" data-tab="${id}">${html}</div>`;
        const tabs = PV_TABS.filter(t => t.id !== 'scene')
            .filter(t => t.id !== 'direct' || worldRegionOn('direct-the-shot'))
            .filter(t => t.id !== 'explore' || worldRegionOn('explore-shot'))
            .map(t => `<button class="pv-tab${tab === t.id ? ' active' : ''}" onclick="worldSetTab('${t.id}')">${t.label}</button>`).join('');
        return `
        <div class="pv-console${WORLD.timelineOpen ? ' pv-timeline-open' : ''}">
          <header class="pv-topbar">
            ${previzWorkspace.titleHtml()}
            <div class="pv-view-switch"><div class="pv-seg">${worldModeButtonsHtml()}</div>${worldLookAroundButtonHtml()}
              <button class="pv-btn pv-quiet" onclick="worldToggleOverlayMenu()">Overlays${pvIcon('chevron-down', 16)}</button></div>
            <div class="pv-top-actions">${previzWorkspace.pickerHtml()}${worldMoreMenuHtml()}</div>
          </header>
          <div class="pv-grid">
            <div class="pv-stage">
              <div class="pv-view" id="pvView">
                <div class="we-frame pv-frame pv-mode-${esc(worldViewMode())}${WORLD.boardOnion && worldBoardSrc() && worldViewMode() !== 'plan' ? ' pv-onion' : ''}" id="weFrame">
                  ${worldBoardSrc() ? `<img class="pv-board-img" id="pvBoardImg" alt="Storyboard frame" src="${esc(worldBoardSrc())}">` : ''}
                  <canvas id="weFrameCanvas"></canvas>
                  <div class="we-readout" id="weReadout"></div>
                  <div class="we-plate-note" id="pvModeNote">${esc(PV_MODE_NOTES[worldViewMode()] || PV_MODE_NOTES.geo)}</div>
                </div>
                ${worldToolRailHtml()}
                ${worldViewMode() === 'plan' ? planFloorPickerHtml() : ''}
                <div class="pv-float pv-float-l">
                  <span class="we-live" id="weCamSpec"></span>
                </div>
                <div class="pv-float pv-walkbar" id="weWalkBar">${worldWalkBarHtml()}</div>
                <div class="pv-float pv-stagebar" id="pvStageBar"></div>
                <div class="pv-float pv-float-r">
                  <span class="pv-chip">${esc(project.aspect_ratio || '16:9')} · ${worldViewMode() === 'plan' ? 'plan' : 'camera view'}</span>
                  <span class="pv-hidden-count" id="weOvCount">0</span>
                </div>
                <div class="we-ov-menu pv-ov-menu" id="weOverlayMenu" style="display:none;">${worldOverlayMenuHtml()}</div>
              </div>
              <div class="pv-move">${worldMoveDockHtml()}</div>
              ${previzWorkspace.footerHtml()}
            </div>
            <aside class="pv-side pv-inspector">
              <div class="pv-tabs">${tabs}</div>
              <div class="pv-tabbody">
                ${pane('light', worldLightHtml())}
                ${pane('camera', `
                  ${worldShotHtml()}
                  <div class="we-panel">
                    <div class="we-label">LENS <span class="we-live" id="weLensNow">${WORLD.lens}mm</span></div>
                    <div class="we-lenses">${lenses}</div>
                    <div class="we-modes">
                      <button class="we-mode${WORLD.mode === 'maintain' ? '' : ' active'}" data-mode="keep"
                              onclick="worldSetMode('keep')">KEEP POSITION</button>
                      <button class="we-mode${WORLD.mode === 'maintain' ? ' active' : ''}" data-mode="maintain"
                              onclick="worldSetMode('maintain')">MAINTAIN SIZE</button>
                    </div>
                    <p class="we-hint" id="weModeHint"></p>
                  </div>
                  ${worldOperateHtml()}
                  <div class="we-panel">
                    <div class="we-label">MEASUREMENTS <span class="we-live">${esc(m.state)}</span></div>
                    <div id="weMeasure" class="we-rows"></div>
                  </div>
                  <div class="we-panel">
                    <div class="we-label">GENERATION RISK</div>
                    <div id="weRisk" class="we-rows">
                      <button class="we-btn" onclick="worldScoreComplexity()">Score this shot — free</button>
                    </div>
                  </div>`)}
                ${worldRegionOn('direct-the-shot') ? pane('direct', previzWorkspace.briefHtml()) : ''}
                ${worldRegionOn('explore-shot') ? pane('explore', worldExplorePanelHtml()) : ''}
                ${pane('scene', `
                  ${worldBlockingHtml()}
                  ${worldRegionOn('spatial-world') ? worldSpatialHtml(world, version) : ''}
                  ${worldSecondaryHtml(project)}
                  <div class="we-panel">
                    <div class="we-label">HANDOVER</div>
                    <div id="weExport" class="we-rows">
                      <button class="we-btn" onclick="worldCheckExport()">What can be exported — free</button>
                    </div>
                  </div>
                  ${worldAdvancedHtml()}`)}
              </div>
            </aside>
          </div>
        </div>`;
    }

    /*
     * The frame is the shape of the film and as large as the view allows —
     * fitted in script because CSS cannot hold an aspect ratio against BOTH a
     * width and a height limit (the note on the frame's rule says why a
     * height cap alone breaks the shape).
     */
    function worldFitFrame() {
        const host = document.getElementById('pvView');
        const frame = document.getElementById('weFrame');
        if (!host || !frame) return;
        const ratio = worldFrameRatio(state.currentProject || {}) || (16 / 9);
        const box = host.getBoundingClientRect();
        const w = Math.max(160, box.width - 6), h = Math.max(90, box.height - 6);   // 3px a side: the picture fills its view
        const fw = w / h > ratio ? h * ratio : w;
        frame.style.width = Math.round(fw) + 'px';
        frame.style.height = Math.round(fw / ratio) + 'px';
    }

    const PV_MODE_NOTES = Object.freeze({
        look:  'SPLAT PREVIEW — THE SHOT REACHES THE FRAME AS WORDS, WITH THE LOCATION PLATE',
        pano:  '360° — DRAG TO LOOK AROUND FROM THE CAMERA · NOT THE SHOT',
        geo:   'GEOMETRIC PLATE — FOR READING THE SHOT; NOT SENT TO A BOARD FRAME',
        depth: 'DEPTH — NEAR IS LIGHT',
        plan:  'PLAN — THE COLLIDER FROM ABOVE',
        board: 'STORYBOARD FRAME — THE PICTURE THE BOARD SHOWS FOR THIS SHOT',
    });

    /*
     * The shot's storyboard frame, the version the board is SHOWING, as the
     * server keyed it (a regenerated frame gets a new ?v=). Null when the shot
     * has no frame yet. Previs shows it as its own view, and over the set.
     */
    function worldBoardSrc() {
        const k = WORLD.scout ? WORLD.targetFrame : WORLD.blocking && WORLD.blocking.keyframe;
        return k && k.src ? mediaUrl(k.src) : null;
    }

    const SPLAT = { mod: null, loading: null, info: null, infoFor: null, canvas: null, renderer: null,
        scene: null, camera: null, mesh: null, meshUrl: null, pano: null, panoUrl: null, running: false, infoLoading: null,
        error: null, look: { yaw: 0, pitch: 0 } };

    function worldViewMode() {
        if (!worldFlagOn('previs_console')) return 'geo';
        // A shot with no frame cannot show the Board view; fall back to what it has.
        if (WORLD.viewMode && !(WORLD.viewMode === 'board' && !worldBoardSrc())) return WORLD.viewMode;
        // A shot with no set to stand in opens on its storyboard frame.
        if (!WORLD.version && worldBoardSrc()) return 'board';
        // Open on the set itself when this version has splats; geometry otherwise.
        const info = SPLAT.info;
        // A scene built in Blender is drawn textured, splats or no splats.
        if (info && info.mesh) return 'look';
        if (!worldFlagOn('world_splats') || (info && (!info.enabled || !info.splats.length))) return 'geo';
        return 'look';
    }

    function worldModeButtonsHtml() {
        const vm = worldViewMode();
        const info = SPLAT.info;
        let shotOff = '';
        if (info && !info.mesh && !info.enabled) shotOff = ' disabled title="Switch world_splats on in Setup to see the finished set"';
        else if (info && !info.mesh && info.enabled && !info.splats.length) shotOff = ' disabled title="This world version recorded no splat"';
        if (!WORLD.version) shotOff = ' disabled title="This shot is not in a 3D set yet: build or scan the location, or pin the shot to a world"';
        const boardOff = worldBoardSrc() ? '' : ' disabled title="This shot has no storyboard frame yet"';
        return `<button class="pv-seg-btn${vm !== 'plan' && vm !== 'board' ? ' active' : ''}"${shotOff}
                    onclick="worldSetViewMode('look')" title="The 3D previz set, from the shot's camera">3D view</button>
                <button class="pv-seg-btn${vm === 'board' ? ' active' : ''}"${boardOff}
                    onclick="worldSetViewMode('board')" title="The shot's storyboard frame">Current shot</button>
                <button class="pv-seg-btn${vm === 'plan' ? ' active' : ''}"
                    onclick="worldSetViewMode('plan')">Plan</button>`;
    }

    function worldLookAroundButtonHtml() {
        const info = SPLAT.info;
        const off = info && !info.mesh && info.enabled && !info.panorama && !info.splats.length
            ? ' disabled title="This world version has neither a splat nor a panorama"' : '';
        return `<button class="pv-btn pv-quiet${worldViewMode() === 'pano' ? ' active' : ''}"${off}
                    onclick="worldSetViewMode('pano')">${pvIcon('look-around')}Look around</button>`;
    }

    async function worldSetViewMode(id) {
        const selection = WORLD.selectionRevision, versionId = WORLD.version?.id;
        const request = WORLD.viewModeRevision = (WORLD.viewModeRevision || 0) + 1;
        if (['plan', 'geo', 'depth'].includes(id)) await worldEnsureGeometry();
        if (request !== WORLD.viewModeRevision || selection !== WORLD.selectionRevision || versionId !== WORLD.version?.id) return;
        WORLD.viewMode = id;
        SPLAT.look = { yaw: 0, pitch: 0 };
        worldConsoleRender();
    }

    /** Dense collider data is needed for explicit geometry views, not walking a textured set. */
    async function worldEnsureGeometry() {
        const versionId = WORLD.version?.id, selection = WORLD.selectionRevision;
        if (!versionId || (WORLD.geometryFor === versionId && WORLD.geometry && WORLD.geometry.representation !== 'bounds-only')) return WORLD.geometry;
        if (WORLD.geometryLoading?.versionId === versionId && WORLD.geometryLoading.selection === selection) return WORLD.geometryLoading.promise;
        const promise = api(`/world-versions/${versionId}/geometry?budget=250000`).then(geometry => {
            if (selection !== WORLD.selectionRevision || WORLD.version?.id !== versionId) return null;
            WORLD.geometry = geometry; WORLD.geometryFor = versionId;
            return geometry;
        }).catch(err => {
            if (selection === WORLD.selectionRevision && WORLD.version?.id === versionId) setStatus('Geometry view: ' + err.message);
            return null;
        }).finally(() => {
            if (WORLD.geometryLoading?.promise === promise) WORLD.geometryLoading = null;
        });
        WORLD.geometryLoading = {versionId, selection, promise};
        return promise;
    }

    /** What this version can draw — asked once per version, free. */
    async function worldSplatInfo() {
        const vid = WORLD.version && WORLD.version.id;
        if (!vid) return null;
        const source = previzWorkspace.source;
        if (source?.world_version_id === vid && source.mesh) {
            SPLAT.infoLoading = null;
            SPLAT.infoFor = vid;
            SPLAT.info = {world_version_id:vid, mesh:source.mesh, enabled:true, splats:[], panorama:null,
                scale_factor: Number(WORLD.version.scale_factor) || 1};
            return SPLAT.info;
        }
        if (SPLAT.infoFor === vid && SPLAT.info) return SPLAT.info;
        if (SPLAT.infoLoading?.version === vid) return SPLAT.infoLoading.promise;
        SPLAT.infoFor = vid; SPLAT.info = null;
        const promise = api(`/world-versions/${vid}/splats`).catch(() => ({ world_version_id: vid, enabled: false, splats: [], panorama: null, scale_factor: 1 })).then(info => {
            if (WORLD.version?.id !== vid || SPLAT.infoFor !== vid || SPLAT.infoLoading?.promise !== promise) return null;
            SPLAT.info = info;
            return info;
        });
        SPLAT.infoLoading = { version: vid, promise };
        return promise;
    }

    /*
     * The renderer module, loaded once. Same origin first — the dev server and
     * a built page both serve src/ — then the API's own copy, so a page opened
     * from anywhere still finds it.
     */
    async function worldSplatModule() {
        if (SPLAT.mod) return SPLAT.mod;
        if (!SPLAT.loading) {
            SPLAT.loading = import(/* @vite-ignore */ new URL('./vendor/splat-viewer.js', document.baseURI).href)
                .catch(() => import(legacy.API_BASE + '/film/vendor/splat-viewer.js'))
                .then(m => (SPLAT.mod = m));
        }
        return SPLAT.loading;
    }

    /*
     * The pose the painter uses, in the mesh's space: the staged camera scaled
     * by the version's factor, or the painter's own default. Look MUST share it
     * — two poses would be two shots.
     */
    function worldCameraPose(camOverride) {
        const f = Number(WORLD.version && WORLD.version.scale_factor);
        const k = Number.isFinite(f) && f > 0 ? f : 1;
        const preview = camOverride ? null : worldPreviewCamera();
        const staged = camOverride || preview
            || (WORLD.blocking && WORLD.blocking.blocking && WORLD.blocking.blocking.camera) || null;
        const cam = (staged && Array.isArray(staged.position))
            ? Object.assign({}, staged, { position: staged.position.map(n => n * k) })
            : worldDefaultCamera(WORLD.geometry);
        if (!cam || !Array.isArray(cam.position)) return null;
        const target = Array.isArray(cam.target)
            ? cam.target : previsAim({ position: cam.position, rotation: cam.rotation || [0, 0, 0] });
        const focal = (camOverride || preview) ? ((camOverride || preview).focalMm || WORLD.lens) : (WORLD.lens || cam.focalMm || 35);
        return { eye: cam.position, target, roll: (cam.rotation && cam.rotation[2]) || 0,
                 vDeg: worldFovFor(focal).vDeg, hDeg: worldFovFor(focal).hDeg, scale: k };
    }

    /* Keep ONE GL canvas alive across re-renders: moving a node keeps its context. */
    function worldSplatCanvas() {
        if (!SPLAT.canvas) {
            SPLAT.canvas = document.createElement('canvas');
            SPLAT.canvas.id = 'pvGL';
            SPLAT.canvas.className = 'pv-gl';
            let drag = null;
            SPLAT.canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; SPLAT.canvas.setPointerCapture(e.pointerId); });
            SPLAT.canvas.addEventListener('pointermove', e => {
                if (!drag || worldViewMode() !== 'pano') return;
                SPLAT.look.yaw -= (e.clientX - drag.x) * 0.25;
                SPLAT.look.pitch = Math.max(-80, Math.min(80, SPLAT.look.pitch + (e.clientY - drag.y) * 0.2));
                drag = { x: e.clientX, y: e.clientY };
                worldSplatRenderOnce();
            });
            SPLAT.canvas.addEventListener('pointerup', () => { drag = null; });
        }
        return SPLAT.canvas;
    }

    function worldSplatStop() {
        if (SPLAT.renderer && SPLAT.running) SPLAT.renderer.setAnimationLoop(null);
        SPLAT.running = false;
        if (SPLAT.canvas) SPLAT.canvas.style.display = 'none';
    }

    function worldAimCamera(camera, pose, THREE) {
        camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
        camera.up.set(0, 1, 0);
        camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
        if (pose.roll) camera.rotateZ(pose.roll * Math.PI / 180);
        camera.fov = pose.vDeg;
        camera.updateProjectionMatrix();
    }

    /** Show the Look or 360° view in the frame, or put it away. */
    async function worldSplatSync() {
        const vm = worldViewMode(), versionId = WORLD.version?.id;
        const frame = document.getElementById('weFrame');
        if (vm !== 'look' && vm !== 'pano') worldMeshStop();
        if (!frame || (vm !== 'look' && vm !== 'pano')) return worldSplatStop();
        const info = await worldSplatInfo();
        if (WORLD.version?.id !== versionId || worldViewMode() !== vm || document.getElementById('weFrame') !== frame) return;
        if (info && info.mesh) { worldSplatStop(); return worldMeshSync(vm, info, versionId); }
        worldMeshStop();
        const note = document.getElementById('pvModeNote');
        if (!info || !info.enabled || (vm === 'look' && !info.splats.length)
            || (vm === 'pano' && !info.panorama && !info.splats.length)) {
            worldSplatStop();
            if (note) note.textContent = (info && info.note) || 'Nothing to render for this world version.';
            return;
        }
        const canvas = worldSplatCanvas();
        if (canvas.parentElement !== frame) frame.insertBefore(canvas, frame.firstChild);
        canvas.style.display = '';
        let mod;
        try {
            if (note && !SPLAT.mod) note.textContent = 'Loading the splat renderer…';
            mod = await worldSplatModule();
        } catch (err) {
            SPLAT.error = err.message;
            if (note) note.textContent = 'The splat renderer did not load: ' + err.message;
            return;
        }
        if (WORLD.version?.id !== versionId || worldViewMode() !== vm || document.getElementById('weFrame') !== frame) return;
        const { THREE, SparkRenderer, SplatMesh } = mod;
        if (!SPLAT.renderer) {
            SPLAT.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
            SPLAT.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            SPLAT.scene = new THREE.Scene();
            SPLAT.scene.add(new SparkRenderer({ renderer: SPLAT.renderer }));
            SPLAT.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 1000);
        }
        const box = frame.getBoundingClientRect();
        SPLAT.renderer.setSize(Math.max(2, Math.round(box.width)), Math.max(2, Math.round(box.height)), false);
        SPLAT.camera.aspect = Math.max(0.1, box.width / Math.max(1, box.height));

        // 360° looks around from the camera INSIDE the splat when there is one;
        // the provider's panorama (taken from the world's own centre) is the
        // fallback for a version that recorded no splat.
        const panoFromSplat = vm === 'pano' && info.splats.length > 0;
        // Look is where a director judges the set, so it gets the full tier (the
        // last listed); thumbnails keep the smallest.
        const want = (vm === 'look' || panoFromSplat) ? info.splats[info.splats.length - 1] : null;
        if (want && SPLAT.meshUrl !== want.url) {
            if (SPLAT.mesh) { SPLAT.scene.remove(SPLAT.mesh); if (SPLAT.mesh.dispose) SPLAT.mesh.dispose(); }
            if (note) note.textContent = `Loading the ${want.kind.replace('splat_', '')} splat…`;
            SPLAT.mesh = new SplatMesh({ url: mediaUrl(want.url) });
            // Marble writes splats y-down (OpenCV); the collider is y-up glTF.
            SPLAT.mesh.quaternion.set(1, 0, 0, 0);
            SPLAT.meshUrl = want.url;
            SPLAT.scene.add(SPLAT.mesh);
            SPLAT.mesh.initialized.then(() => {
                const n = document.getElementById('pvModeNote');
                if (n && (worldViewMode() === 'look' || worldViewMode() === 'pano')) n.textContent = PV_MODE_NOTES[worldViewMode()];
                // Spark sorts on a worker; a few renders let the order settle.
                [0, 120, 400, 900].forEach(ms => setTimeout(worldSplatRenderOnce, ms));
                if (worldViewMode() === 'explore' || (EXPLORE.accepted || []).length) worldExploreThumbs();
            }).catch(err => { const n = document.getElementById('pvModeNote'); if (n) n.textContent = 'The splat did not load: ' + err.message; });
        }
        if (SPLAT.mesh) { SPLAT.mesh.scale.setScalar(info.scale_factor || 1); SPLAT.mesh.visible = vm === 'look' || panoFromSplat; }

        if (vm === 'pano' && !panoFromSplat && SPLAT.panoUrl !== info.panorama.url) {
            if (SPLAT.pano) SPLAT.scene.remove(SPLAT.pano);
            const geo = new THREE.SphereGeometry(400, 64, 32);
            geo.scale(-1, 1, 1);
            const tex = new THREE.TextureLoader().setCrossOrigin('anonymous').load(mediaUrl(info.panorama.url));
            tex.colorSpace = THREE.SRGBColorSpace;
            SPLAT.pano = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
            SPLAT.panoUrl = info.panorama.url;
            SPLAT.scene.add(SPLAT.pano);
        }
        if (SPLAT.pano) SPLAT.pano.visible = vm === 'pano' && !panoFromSplat;
        SPLAT.panoFromSplat = panoFromSplat;

        if (!SPLAT.running) {
            SPLAT.running = true;
            SPLAT.renderer.setAnimationLoop(() => worldSplatRenderOnce());
        }
        // Once now as well: an animation loop does not tick in a hidden tab,
        // and the frame should be right the moment the tab is looked at.
        worldSplatRenderOnce();
        if (note && !(want && SPLAT.mesh && !SPLAT.mesh.isInitialized)) note.textContent = PV_MODE_NOTES[vm];
    }

    function worldSplatRenderOnce() {
        if (!SPLAT.renderer || !SPLAT.mod) return;
        const THREE = SPLAT.mod.THREE;
        const p = worldCameraPose();
        const mode = worldViewMode();
        if (!p || !document.getElementById('pvGL')) return worldSplatStop();
        if (mode === 'pano') {
            // The panorama is a place, not a shot: stand at its centre,
            // start facing where the shot faces, and let the drag turn you.
            const d = [p.target[0] - p.eye[0], p.target[1] - p.eye[1], p.target[2] - p.eye[2]];
            const baseYaw = Math.atan2(d[0], d[2]) * 180 / Math.PI;
            const yaw = (baseYaw + SPLAT.look.yaw) * Math.PI / 180;
            const pitch = SPLAT.look.pitch * Math.PI / 180;
            const o = SPLAT.panoFromSplat ? p.eye : [0, 0, 0];
            SPLAT.camera.position.set(o[0], o[1], o[2]);
            SPLAT.camera.up.set(0, 1, 0);
            SPLAT.camera.lookAt(o[0] + Math.sin(yaw) * Math.cos(pitch), o[1] + Math.sin(pitch), o[2] + Math.cos(yaw) * Math.cos(pitch));
            SPLAT.camera.fov = Math.max(p.vDeg, 60);
            SPLAT.camera.updateProjectionMatrix();
        } else {
            worldAimCamera(SPLAT.camera, p, THREE);
        }
        SPLAT.renderer.render(SPLAT.scene, SPLAT.camera);
    }

    /*
     * A SCENE BUILT IN BLENDER, drawn as itself.
     *
     * The collider of an imported version IS the textured set (Blender exports
     * its materials into the GLB), so Look draws it with the page's own three
     * r149 and GLTFLoader, on its own canvas -- the splat module carries a
     * different three, and a GL context belongs to one renderer. Same pose as
     * the painter (worldCameraPose), so what you frame here is the shot.
     */
    const MESHLOOK = { canvas: null, renderer: null, scene: null, camera: null, url: null, root: null, error: null, versionId: null, loadingVersion: null, loadRevision: 0, worldSha256: null, loadController:null, renderFrame:null, width:null, height:null };

    /**
     * Blender exports its lights in physical units (a sun of strength 3 is
     * 2049 lux; a 100 W lamp is about 432 cd), and this renderer's lights are
     * not physical, so read as they come every set is pure white. Each is put
     * back into the units it was authored in (lux / 683 is Blender's W/m²,
     * cd × 4π / 683 its watts), then scaled to this renderer's range. Returns
     * whether the scene brought its own sun, which then replaces ours.
     */
    function meshLookLights(root) {
        let hasSun = false;
        root.traverse(o => {
            if (!o.isLight) return;
            if (o.isDirectionalLight) { hasSun = true; o.intensity = Math.min(2.5, (o.intensity / 683) * 0.45); }
            else if (o.isPointLight || o.isSpotLight) {
                /*
                 * A lamp needs a reach. With none (glTF leaves `range` unset)
                 * this renderer's lights do not fall off at all, so every
                 * street lamp in Bromwich lit the whole town at full strength
                 * and the set read as blown-out white. The reach grows with
                 * the lamp's power: about 12 m for a 2,400 cd street lamp.
                 */
                const cd = o.intensity;
                o.intensity = Math.min(1.5, (cd * 16 * Math.PI * Math.PI / 683) / 60);
                o.decay = 2;
                if (!(o.distance > 0)) o.distance = Math.max(4, Math.min(30, Math.sqrt(Math.max(cd, 0)) / 4));
            }
        });
        return hasSun;
    }

    function worldMeshStop() { if (MESHLOOK.canvas) MESHLOOK.canvas.style.display = 'none'; }

    function worldMeshRelease() {
        if (MESHLOOK.renderFrame != null) { window.cancelAnimationFrame(MESHLOOK.renderFrame); MESHLOOK.renderFrame = null; }
        MESHLOOK.loadController?.abort(); MESHLOOK.loadController = null;
        MESHLOOK.loadRevision++;
        if (MESHLOOK.root) previzWorkspace.disposeModel(MESHLOOK.root);
        MESHLOOK.root = null; MESHLOOK.url = null; MESHLOOK.loadingVersion = null;
        MESHLOOK.versionId = null; MESHLOOK.worldSha256 = null;
        const staged = MESHLOOK.scene?.getObjectByName('staged');
        if (staged) MESHLOOK.scene.remove(staged);
        for (const model of Object.values(STAGE.gltf || {})) Promise.resolve(model).then(root => previzWorkspace.disposeModel(root)).catch(() => {});
        STAGE.gltf = {}; STAGE.lookSig = null;
        worldMeshStop();
    }

    function worldMeshRequestRender() {
        if (MESHLOOK.renderFrame != null) return;
        MESHLOOK.renderFrame = window.requestAnimationFrame(() => {
            MESHLOOK.renderFrame = null;
            worldMeshRenderOnce();
        });
    }

    function worldMeshCanvas() {
        if (!MESHLOOK.canvas) {
            const c = document.createElement('canvas');
            c.id = 'pvGLMesh';
            c.className = 'pv-gl';
            let drag = null;
            c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); });
            c.addEventListener('pointermove', e => {
                if (!drag) return;
                const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
                drag = { x: e.clientX, y: e.clientY };
                if (worldViewMode() === 'pano') {
                    SPLAT.look.yaw -= dx * 0.25;
                    SPLAT.look.pitch = Math.max(-80, Math.min(80, SPLAT.look.pitch + dy * 0.2));
                    worldMeshRequestRender();
                }
            });
            c.addEventListener('pointerup', () => { drag = null; });
            MESHLOOK.canvas = c;
        }
        return MESHLOOK.canvas;
    }

    async function worldMeshSync(vm, info, versionId = WORLD.version?.id) {
        const frame = document.getElementById('weFrame');
        const note = document.getElementById('pvModeNote');
        const T = window.THREE;
        if (!frame || WORLD.version?.id !== versionId || info.world_version_id !== versionId) return;
        if (!T || !T.GLTFLoader) { if (note) note.textContent = 'The 3D renderer is not loaded on this page.'; return; }
        const canvas = worldMeshCanvas();
        if (canvas.parentElement !== frame) frame.insertBefore(canvas, frame.firstChild);
        canvas.style.display = '';
        if (!MESHLOOK.renderer) {
            MESHLOOK.renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
            MESHLOOK.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            if (T.sRGBEncoding !== undefined) MESHLOOK.renderer.outputEncoding = T.sRGBEncoding;
            MESHLOOK.renderer.toneMapping = T.ACESFilmicToneMapping;
            MESHLOOK.renderer.toneMappingExposure = 1;
            MESHLOOK.scene = new T.Scene();
            MESHLOOK.scene.background = new T.Color(0x14161a);
            // A soft sky and one sun, so a scene exported without lights still
            // reads; Blender's own lights, when exported, add to these.
            MESHLOOK.hemi = new T.HemisphereLight(0xffffff, 0x3a3a3a, 0.9);
            MESHLOOK.scene.add(MESHLOOK.hemi);
            const sun = new T.DirectionalLight(0xffffff, 0.8);
            sun.position.set(5, 10, 7);
            MESHLOOK.scene.add(sun);
            MESHLOOK.sun = sun;
            MESHLOOK.camera = new T.PerspectiveCamera(40, 16 / 9, 0.02, 2000);
            /*
             * A WORK LIGHT ON THE CAMERA. Inside a room the sun is outside the
             * walls and the sky light is the same on every wall, so a scanned
             * office read as one flat grey from eye height. A soft light that
             * travels with the camera shades each surface by its angle and its
             * distance, which is what makes a room readable while walking it.
             * It steps back whenever the shot has its own lighting rig.
             */
            MESHLOOK.work = new T.PointLight(0xfff4e6, 0.45, 0, 1.2);
            MESHLOOK.scene.add(MESHLOOK.work);
        }
        const box = frame.getBoundingClientRect();
        const width = Math.max(2, Math.round(box.width)), height = Math.max(2, Math.round(box.height));
        if (MESHLOOK.width !== width || MESHLOOK.height !== height) {
            MESHLOOK.renderer.setSize(width, height, false);
            MESHLOOK.width = width; MESHLOOK.height = height;
        }
        // Use the actual raster dimensions so browser capture and native projection agree.
        MESHLOOK.camera.aspect = canvas.width / canvas.height;
        if (MESHLOOK.url !== info.mesh.url || MESHLOOK.loadingVersion !== versionId || MESHLOOK.expectedSha256 !== info.mesh.sha256) {
            MESHLOOK.loadController?.abort();
            if (MESHLOOK.root) previzWorkspace.disposeModel(MESHLOOK.root);
            MESHLOOK.root = null; MESHLOOK.versionId = null; MESHLOOK.worldSha256 = null; MESHLOOK.loadingVersion = versionId;
            const loadRevision = ++MESHLOOK.loadRevision;
            MESHLOOK.url = info.mesh.url;
            MESHLOOK.expectedSha256 = info.mesh.sha256;
            MESHLOOK.loadController = new AbortController();
            if (note) note.textContent = 'Loading the scene…';
            previzWorkspace.loadModel(T,mediaUrl(info.mesh.url), {worldVersionId:versionId, expectedSha256:info.mesh.sha256, signal:MESHLOOK.loadController.signal}).then(root => {
                if (MESHLOOK.loadRevision !== loadRevision || WORLD.version?.id !== versionId || MESHLOOK.url !== info.mesh.url) return previzWorkspace.disposeModel(root);
                MESHLOOK.root = root; MESHLOOK.versionId = versionId; MESHLOOK.worldSha256 = root.userData.previz_asset_sha256; MESHLOOK.error = null;
                // The same scale the painter applies on read (1 for a scene in metres).
                MESHLOOK.root.scale.setScalar(info.scale_factor || 1);
                MESHLOOK.scene.add(MESHLOOK.root);
                MESHLOOK.sun.visible = !meshLookLights(MESHLOOK.root);
                STAGE.lookSig = null; stageSyncLook();
                const n = document.getElementById('pvModeNote');
                if (n) n.textContent = MESH_MODE_NOTES[worldViewMode()] || '';
                worldMeshRequestRender();
            }).catch(err => {
                if (MESHLOOK.loadRevision !== loadRevision || WORLD.version?.id !== versionId) return;
                MESHLOOK.error = (err && err.message) || String(err);
                const n = document.getElementById('pvModeNote');
                if (n) n.textContent = 'The scene did not load: ' + ((err && err.message) || err);
            });
        } else if (note) note.textContent = MESH_MODE_NOTES[vm] || '';
        stageSyncLook();
        worldMeshRequestRender();
    }

    const MESH_MODE_NOTES = Object.freeze({
        look: '3D SET PREVIEW · SAVE THIS CAMERA VIEW AS A NEW STORYBOARD VERSION',
        pano: '360° — DRAG TO LOOK AROUND FROM THE CAMERA · NOT THE SHOT',
    });

    function worldMeshRenderOnce() {
        if (MESHLOOK.renderFrame != null) { window.cancelAnimationFrame(MESHLOOK.renderFrame); MESHLOOK.renderFrame = null; }
        if (!MESHLOOK.renderer || !document.getElementById('pvGLMesh')) return;
        const p = worldCameraPose();
        if (!p) return;
        const cam = MESHLOOK.camera;
        if (worldViewMode() === 'pano') {
            const d = [p.target[0] - p.eye[0], p.target[1] - p.eye[1], p.target[2] - p.eye[2]];
            const yaw = (Math.atan2(d[0], d[2]) * 180 / Math.PI + SPLAT.look.yaw) * Math.PI / 180;
            const pitch = SPLAT.look.pitch * Math.PI / 180;
            const o = p.eye;
            cam.position.set(o[0], o[1], o[2]);
            cam.up.set(0, 1, 0);
            cam.lookAt(o[0] + Math.sin(yaw) * Math.cos(pitch), o[1] + Math.sin(pitch), o[2] + Math.cos(yaw) * Math.cos(pitch));
            cam.fov = Math.max(p.vDeg, 60);
            cam.updateProjectionMatrix();
        } else {
            worldAimCamera(cam, p, window.THREE);
        }
        meshLookRig();
        if (MESHLOOK.work) {
            MESHLOOK.work.position.copy(cam.position);
            MESHLOOK.work.visible = !MESHLOOK.rig;
        }
        MESHLOOK.renderer.render(MESHLOOK.scene, cam);
    }

    /*
     * THE SHOT'S LIGHTING, LIT. The rig the server placed for the technique
     * (key, fill, rim…) as lights in the Look view, tinted by the mood; the key
     * casts shadows so the direction reads. While a rig is on, the set's own
     * exported sun and the viewer's default light step back, and the sky dims
     * to the mood's ambient: a low-key shot must look dark.
     */
    function meshLookRig() {
        const T = window.THREE;
        if (!T || !MESHLOOK.scene) return;
        const lit = WORLD.blocking && WORLD.blocking.lighting;
        const on = WORLD.showLights !== false && lit && ((lit.rig && lit.rig.length) || lit.mood);
        const sig = on ? JSON.stringify([lit.rig, lit.mood, (worldCameraPose() || {}).scale]) : 'off';
        if (MESHLOOK.rigSig === sig) return;
        MESHLOOK.rigSig = sig;
        if (MESHLOOK.rig) { MESHLOOK.scene.remove(MESHLOOK.rig); MESHLOOK.rig = null; }
        const setSetLights = visible => {
            if (MESHLOOK.root) MESHLOOK.root.traverse(o => { if (o.isLight) o.visible = visible; });
            if (MESHLOOK.sun) MESHLOOK.sun.visible = visible && !(MESHLOOK.root && meshLookHasSun(MESHLOOK.root));
        };
        if (!on) {
            setSetLights(true);
            if (MESHLOOK.hemi) { MESHLOOK.hemi.intensity = 0.9; MESHLOOK.hemi.color.set(0xffffff); }
            if (MESHLOOK.renderer) MESHLOOK.renderer.shadowMap.enabled = false;
            return;
        }
        const f = (worldCameraPose() || {}).scale || 1;
        const g = new T.Group();
        g.name = 'rig';
        MESHLOOK.renderer.shadowMap.enabled = true;
        for (const l of (lit.rig || [])) {
            const d = new T.DirectionalLight(new T.Color(l.colour), 1.7 * (l.ratio || 1));
            d.position.set(l.position[0] * f, l.position[1] * f, l.position[2] * f);
            d.target.position.set(l.target[0] * f, l.target[1] * f, l.target[2] * f);
            if (l.role === 'key') {
                d.castShadow = true;
                d.shadow.mapSize.set(1024, 1024);
                const sc = d.shadow.camera;
                sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 0.1; sc.far = 30;
                d.shadow.bias = -0.0005;
                // A soft source is a blurred shadow.
                d.shadow.radius = 1 + 6 * (l.soft || 0);
            }
            g.add(d); g.add(d.target);
        }
        MESHLOOK.scene.add(g);
        MESHLOOK.rig = g;
        setSetLights(!(lit.rig && lit.rig.length));
        if (MESHLOOK.hemi && lit.mood) {
            MESHLOOK.hemi.intensity = 0.25 + 1.1 * lit.mood.ambient;
            MESHLOOK.hemi.color.set(lit.mood.colour);
        }
        const cast = o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } };
        if (MESHLOOK.root) MESHLOOK.root.traverse(cast);
        MESHLOOK.scene.traverse(o => { if (o.parent && o.parent.name === 'staged') o.traverse(cast); });
    }

    function meshLookHasSun(root) {
        let has = false;
        root.traverse(o => { if (o.isDirectionalLight) has = true; });
        return has;
    }

    function worldWalkCamera() {
        const b = WORLD.blocking && WORLD.blocking.blocking;
        if (!b) return null;
        if (!b.camera || !Array.isArray(b.camera.position)) {
            // Start from where the frame is standing now, in the mesh's space,
            // turned into a position and a rotation the proposal can carry.
            const f = Number(WORLD.version && WORLD.version.scale_factor);
            const k = Number.isFinite(f) && f > 0 ? f : 1;
            const d = worldDefaultCamera(WORLD.geometry);
            if (!d) return null;
            const v = [d.target[0] - d.position[0], d.target[1] - d.position[1], d.target[2] - d.position[2]];
            const len = Math.hypot(v[0], v[1], v[2]) || 1;
            b.camera = Object.assign({}, b.camera || {}, {
                position: d.position.map(n => n / k),
                rotation: [Math.atan2(-v[0], -v[2]) * 180 / Math.PI, Math.asin(v[1] / len) * 180 / Math.PI, 0],
            });
        }
        if (!Array.isArray(b.camera.rotation)) b.camera.rotation = [0, 0, 0];
        return b.camera;
    }

    function worldWalkToggle() {
        WALK.on = !WALK.on;
        if (WALK.on && !WALK.from) {
            const b = WORLD.blocking && WORLD.blocking.blocking;
            const saved = b && b.camera && Array.isArray(b.camera.position) ? b.camera : null;
            WALK.from = saved
                ? { position: saved.position.slice(), rotation: (saved.rotation || [0, 0, 0]).slice(), saved: true }
                : { position: [0, 0, 0], rotation: [0, 0, 0], saved: false };
            worldWalkCamera();
        }
        worldConsoleRender();
    }

    function worldWalkRepaint() {
        WALK.moved = true;
        previzWorkspace.changed();
        worldPaintFrame();
        worldSplatRenderOnce();
        const bar = document.getElementById('weWalkBar');
        if (bar) bar.innerHTML = worldWalkBarHtml();
        worldOperateRefreshValues();
    }

    /*
     * CAMERA OPERATE FOLLOWS THE WALK. Every move -- a key, the wheel, a drag,
     * a nudge -- rewrites the panel's numbers in place, so the right panel
     * always says where the camera is standing. In place rather than a full
     * render, which would rebuild the canvas the gesture is on.
     */
    function worldOperateRefreshValues() {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        for (const a of OPERATE_SCRUB) {
            const v = worldOperateValue(a.id);
            document.querySelectorAll(`.we-scrub[data-scrub="${a.id}"]`).forEach(n => {
                if (n.classList && n.classList.contains('dragging')) return;
                n.textContent = v == null ? '—' : v.toFixed(a.fmt);
            });
        }
    }

    /*
     * Walking starts by itself the moment the camera is moved with the mouse:
     * a gesture that needed a button pressed first read as a camera that
     * cannot be moved. Nothing is kept until "Use this camera".
     */
    function worldWalkEnsure() {
        WORLD.previewT = null;
        if (WALK.on) return;
        const b = WORLD.blocking && WORLD.blocking.blocking;
        const saved = b && b.camera && Array.isArray(b.camera.position) ? b.camera : null;
        WALK.on = true;
        WALK.from = saved
            ? { position: saved.position.slice(), rotation: (saved.rotation || [0, 0, 0]).slice(), saved: true }
            : { position: [0, 0, 0], rotation: [0, 0, 0], saved: false };
        worldWalkCamera();
        // Repaint only the walk bar and the button: a full console render would
        // rebuild the canvas the gesture is on and drop the drag.
        const btn = document.querySelector('[onclick="worldWalkToggle()"]');
        if (btn) { btn.classList.add('pv-amber'); btn.textContent = 'Walking'; }
    }

    /*
     * The 3D views take the mouse the way a 3D application does. Delegated
     * from the document, so the console re-rendering its frame cannot unbind
     * it. Plan and 360° keep their own gestures.
     *   wheel            dolly forward / back (Shift: faster)
     *   drag             look around (pan / tilt)
     *   right- or Shift-drag   slide sideways and up / down (truck / pedestal)
     */
    const CAMGESTURE = { drag: null };

    function worldGestureView(target) {
        if (state.currentPage !== 'previs' || !target || !target.closest) return false;
        if (!target.closest('#weFrame')) return false;
        if (target.closest('.pv-float, .pv-btn, button, input, select, textarea')) return false;
        const vm = worldViewMode();
        return vm !== 'plan' && vm !== 'pano' && (!!WORLD.shotId || !!WORLD.scout);
    }

    function worldWalkTurn(yawDeg, pitchDeg) {
        const c = worldWalkCamera();
        if (!c) return;
        c.rotation[0] = ((c.rotation[0] + yawDeg + 540) % 360) - 180;
        c.rotation[1] = Math.max(-85, Math.min(85, c.rotation[1] + pitchDeg));
        worldWalkRepaint();
    }

    /** Metres along the camera's own ground axes: forward, right, up. */
    function worldWalkStep(fwdM, rightM, upM) {
        const c = worldWalkCamera();
        if (!c) return;
        const f = Number(WORLD.version && WORLD.version.scale_factor);
        const k = Number.isFinite(f) && f > 0 ? f : 1;
        const yaw = c.rotation[0] * Math.PI / 180;
        const fwd = [-Math.sin(yaw), -Math.cos(yaw)];
        const right = [Math.cos(yaw), -Math.sin(yaw)];
        if (WORLD.scout && !upM && previzWorkspace.step(c, fwd[0] * fwdM + right[0] * rightM, fwd[1] * fwdM + right[1] * rightM, k)) {
            previzWorkspace.changed(); return worldWalkRepaint();
        }
        c.position[0] += (fwd[0] * fwdM + right[0] * rightM) / k;
        c.position[2] += (fwd[1] * fwdM + right[1] * rightM) / k;
        c.position[1] += upM / k;
        worldWalkRepaint();
    }

    function worldWalkKey(e) {
        if (!WALK.on || state.currentPage !== 'previs') return;
        const t = e.target && e.target.tagName;
        if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (e.target && e.target.isContentEditable)) return;
        const m = e.shiftKey ? 1.0 : 0.25;          // metres a press
        const k = e.key.toLowerCase();
        const moves = {
            w: () => worldWalkStep(m, 0, 0), s: () => worldWalkStep(-m, 0, 0),
            a: () => worldWalkStep(0, -m, 0), d: () => worldWalkStep(0, m, 0),
            r: () => worldWalkStep(0, 0, m / 2), f: () => worldWalkStep(0, 0, -m / 2),
            arrowleft: () => worldWalkTurn(e.shiftKey ? 10 : 3, 0), arrowright: () => worldWalkTurn(e.shiftKey ? -10 : -3, 0),
            arrowup: () => worldWalkTurn(0, 2), arrowdown: () => worldWalkTurn(0, -2),
        };
        if (moves[k]) { e.preventDefault(); moves[k](); }
    }

    function worldWalkBarHtml() {
        if (!WALK.on) return '';
        const c = worldWalkCamera();
        const f = Number(WORLD.version && WORLD.version.scale_factor);
        const k = Number.isFinite(f) && f > 0 ? f : null;
        const at = c && k ? c.position.map(n => (n * k).toFixed(2)).join(' / ') + ' m' : '';
        if (WORLD.scout) {
            return `<span class="we-live">SCOUTING ${esc(WORLD.scout.name)} · W/S A/D R/F · arrows or drag to turn · Shift faster${at ? ' · ' + esc(at) : ''}</span>
            <span class="pv-dim">Browser materials and work lights are approximate.</span>`;
        }
        return `<span class="we-live">WALK · W/S A/D R/F · arrows or drag to turn · Shift faster${at ? ' · ' + esc(at) : ''}</span>
            <button class="pv-btn pv-primary" onclick="worldWalkKeep()"${WALK.moved ? '' : ' disabled'}>Use this camera</button>
            <button class="pv-btn" onclick="worldWalkUndo()"${WALK.moved ? '' : ' disabled'}>Put it back</button>`;
    }

    /*
     * Keep the walked camera: the difference from the saved one, as the moves
     * and turns the proposal contract speaks, plus the lens. The route builds
     * the camera from the saved blocking and validates it against the geometry.
     */
    async function worldWalkKeep() {
        if (WORLD.scout) { WALK.moved = false; previzWorkspace.changed(); worldConsoleRender(); return; }
        const shotId = WORLD.shotId, selection = WORLD.selectionRevision;
        const c = worldWalkCamera();
        if (!c || !WALK.from || !WORLD.shotId) return;
        const f = Number(WORLD.version && WORLD.version.scale_factor);
        if (!(Number.isFinite(f) && f > 0)) {
            return setStatus('Calibrate this world first: a camera cannot be kept in metres in a world with no unit.');
        }
        const d = i => (c.position[i] - WALK.from.position[i]) * f;
        const r = i => (c.rotation[i] || 0) - (WALK.from.rotation[i] || 0);
        // Dolly and truck are the camera's OWN axes, read at the pose it started
        // from: a world-axis delta would dolly sideways for a camera facing east.
        const yaw0 = (WALK.from.rotation[0] || 0) * Math.PI / 180;
        const dolly = d(0) * Math.sin(yaw0) + d(2) * Math.cos(yaw0);
        const truck = d(0) * Math.cos(yaw0) - d(2) * Math.sin(yaw0);
        const proposal = {
            rationale: 'Walked to in Previs and chosen by eye.',
            changes: {
                truckM: +truck.toFixed(3), pedestalM: +d(1).toFixed(3), dollyM: +dolly.toFixed(3),
                panDeg: +r(0).toFixed(2), tiltDeg: +r(1).toFixed(2), rollDeg: +r(2).toFixed(2),
                focalLengthMm: WORLD.lens,
            },
            apply: true,
        };
        try {
            await api(`/shots/${shotId}/direct`, { method: 'POST', body: JSON.stringify(proposal) });
            if (WORLD.shotId !== shotId || WORLD.selectionRevision !== selection) return;
            WALK.on = false; WALK.from = null; WALK.moved = false;
            setStatus('Camera kept on the shot. Apply it to the shot, then generate the board frame from it.');
        } catch (err) {
            // Say why — "cannot be shot" alone sends the director hunting.
            const why = err.data && Array.isArray(err.data.failures)
                ? err.data.failures.map(f => f.detail || f.check).join('; ') : '';
            return setStatus('That camera was refused: ' + (why || err.message) + ' — press "Put it back" or move it again.');
        }
        await worldRefreshBlocking(shotId, selection);
    }

    async function worldWalkUndo() {
        WALK.on = false; WALK.from = null; WALK.moved = false;
        await worldRefreshBlocking();
    }

    /*
     * SCOUTING A LOCATION. Previs belongs to shots, so a location whose set
     * exists (a phone scan, a Blender build) and no shot yet was visible only
     * as a 3D asset. Scouting opens the location's newest set version with a
     * free camera: walk it, look, choose an angle, and "Make a shot from this
     * camera" turns the view into a shot in a scene at that location, pinned
     * to this version, with the camera saved on it. Nothing is written until
     * then.
     */
    async function worldLoadScoutable(projectId) {
        WORLD.scoutable = [];
        try {
            const [ws, ls] = await Promise.all([
                api(`/projects/${projectId}/worlds`),
                api(`/projects/${projectId}/locations`).catch(() => ({ locations: [] })),
            ]);
            const names = new Map(((ls && ls.locations) || []).map(l => [l.id, l.name]));
            WORLD.scoutable = scoutableWorlds((ws && ws.worlds) || [], names);
        } catch (_) { WORLD.scoutable = []; }
    }

    /** The worlds a person can walk: those with a version, newest version first. */
    function scoutableWorlds(worlds, names) {
        return worlds.filter(w => !w.archived_at).map(w => {
            const vs = (w.versions || []).slice().sort((a, b) => (b.version || 0) - (a.version || 0));
            if (!vs.length) return null;
            return { world: w, version: vs[0], name: (w.location_id && names.get(w.location_id)) || w.name || 'Location' };
        }).filter(Boolean);
    }

    async function worldScoutSelect(worldId) {
        const s = (WORLD.scoutable || []).find(x => x.world.id === worldId);
        if (!s) return;
        // A refresh of the selected set is not another camera selection.
        if (WORLD.scout?.worldId === worldId && WORLD.scout.versionId === s.version.id && WORLD.version?.id === s.version.id) {
            WORLD.world = s.world; WORLD.version = s.version;
            if (!WORLD.scoutLoading && previzWorkspace.source?.world_version_id !== s.version.id) await previzWorkspace.opened({preserve:true});
            return worldConsoleRender();
        }
        const selection = WORLD.selectionRevision = (WORLD.selectionRevision || 0) + 1;
        worldMeshRelease();
        WORLD.scoutLoading = selection;
        previzWorkspace.sourceGeneration++;
        previzWorkspace.changed();
        previzWorkspace.source = null; previzWorkspace.room = null;
        if (!previzWorkspace.creation?.shot && !previzWorkspace.creation?.sending) previzWorkspace.creation = null;
        WORLD.shotId = null;
        WORLD.pin = null;
        WORLD.scout = { worldId, versionId: s.version.id, locationId: s.world.location_id || null, name: s.name };
        WORLD.world = s.world;
        WORLD.version = s.version;
        WORLD.blocking = { blocking: { camera: null, subjects: [] }, decisions: [], scout: true };
        WALK.on = true; WALK.moved = false;
        WALK.from = { position: [0, 0, 0], rotation: [0, 0, 0], saved: false };
        WORLD.geometry = null; WORLD.geometryFor = null;
        await previzWorkspace.opened();
        if (selection !== WORLD.selectionRevision) return;
        if (['plan', 'geo', 'depth'].includes(worldViewMode())) await worldEnsureGeometry();
        if (selection !== WORLD.selectionRevision) return;
        WORLD.scoutLoading = null;
        worldConsoleRender();
        if (previzWorkspace.source) setStatus(`Walk ${s.name} with W/S/A/D or the mouse. Choose a target shot, then review and save a draft.`);
    }

    /** The next free shot code in a scene: 1A, 1B, ... */
    function scoutShotCode(sceneNumber, taken) {
        const used = new Set((taken || []).map(c => String(c).toUpperCase()));
        for (let i = 0; i < 26 * 27; i++) {
            const letters = i < 26 ? String.fromCharCode(65 + i)
                : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
            const code = `${sceneNumber}${letters}`;
            if (!used.has(code.toUpperCase())) return code;
        }
        return `${sceneNumber}X${Date.now() % 1000}`;
    }

    /** The scene a scouted shot belongs in: one at this location, by its heading. */
    function scoutSceneFor(scenes, locationName) {
        const want = String(locationName || '').trim().toUpperCase();
        const at = (scenes || []).filter(sc => sc.status !== 'removed');
        return at.find(sc => String(sc.location || '').trim().toUpperCase() === want)
            || at.find(sc => want && String(sc.location || '').toUpperCase().includes(want))
            || null;
    }

    async function worldScoutMakeShot() {
        return previzWorkspace.previzCreateTarget();
    }

    /*
     * EXPLORE, RENDERED. Each accepted camera is drawn through its own lens
     * from the same splat the Look view shows, so six tiles are six pictures
     * of the set rather than six hatched boxes. Free — nothing leaves the page.
     */
    async function worldExploreThumbs() {
        const cams = (EXPLORE.accepted || []).filter(a => a.camera && Array.isArray(a.camera.position));
        if (!cams.length) return;
        const info = await worldSplatInfo();
        if (!info || !info.enabled || !info.splats.length) return;
        let mod;
        try { mod = await worldSplatModule(); } catch (_) { return; }
        const { THREE, SparkRenderer, SplatMesh } = mod;
        EXPLORE.thumbs = EXPLORE.thumbs || {};
        const url = info.splats[0].url;               // the smallest tier is plenty at 320 px
        if (!SPLAT.thumb) {
            const c = document.createElement('canvas');
            const r = new THREE.WebGLRenderer({ canvas: c, antialias: false, preserveDrawingBuffer: true });
            r.setSize(320, 180, false);
            const s = new THREE.Scene();
            s.add(new SparkRenderer({ renderer: r }));
            SPLAT.thumb = { canvas: c, renderer: r, scene: s, camera: new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 1000), url: null, mesh: null };
        }
        const T = SPLAT.thumb;
        if (T.url !== url) {
            if (T.mesh) T.scene.remove(T.mesh);
            T.mesh = new SplatMesh({ url: mediaUrl(url) });
            T.mesh.quaternion.set(1, 0, 0, 0);
            T.mesh.scale.setScalar(info.scale_factor || 1);
            T.scene.add(T.mesh);
            T.url = url;
            try { await T.mesh.initialized; } catch (_) { return; }
        }
        // A timer, not requestAnimationFrame: rAF never fires in a hidden tab.
        const frame = () => new Promise(r => setTimeout(r, 60));
        for (const a of cams) {
            const pose = worldCameraPose(a.camera);
            if (!pose) continue;
            worldAimCamera(T.camera, pose, THREE);
            // Spark sorts on a worker; give it a few frames to settle.
            for (let i = 0; i < 6; i++) { T.renderer.render(T.scene, T.camera); await frame(); }
            T.renderer.render(T.scene, T.camera);
            EXPLORE.thumbs[a.key] = T.canvas.toDataURL('image/jpeg', 0.82);
        }
        const tiles = document.getElementById('weExploreTiles');
        if (tiles) tiles.innerHTML = worldExploreTilesHtml();
    }

    /*
     * PLAN — the collider from above. A height map, not a wireframe: every
     * vertex lifts its cell to the tallest thing standing there, so the floor
     * reads dark, the counter and booths mid, the walls bright. Then the cast
     * where they are staged, and every camera as the wedge it actually sees.
     */
    /* ── STAGING: people, furniture and your own models, placed in the set ──
     *
     * "Low-poly man, woman, children of both genders, and I can move them in
     * the previz… and position the monsters I generate in Meshy."
     *
     * The Plan view is where things are placed: each subject is drawn as its
     * real footprint with an arrow for the way it faces. Click to select, drag
     * to move, drag the round handle (or Q / E) to turn, Delete to remove. The
     * Look view draws the same subjects as their real low-poly models. Every
     * change is saved through the subjects-only route, so the camera, its keys
     * and the director's notes are never touched by staging.
     */
    const STAGE = { sel: null, drag: null, timer: null, library: null, gltf: {}, lookSig: null, pending: null, keySel: null };

    // Editing the set's own objects (see EDITING THE SET below).
    const SETEDIT = { on: false, build: null, items: [], sel: null, drag: null, dirty: false, busy: false };

    function stageSubjects() {
        if (!WORLD.blocking) WORLD.blocking = {};
        if (!WORLD.blocking.blocking) WORLD.blocking.blocking = {};
        if (!Array.isArray(WORLD.blocking.blocking.subjects)) WORLD.blocking.blocking.subjects = [];
        return WORLD.blocking.blocking.subjects;
    }

    function stageYaw(su) { return ((su.rotationDeg || [])[1] || 0) * Math.PI / 180; }

    function stageSize(su) {
        const d = { human: [0.5, 1.7, 0.3], cube: [1, 1, 1], sphere: [1, 1, 1], mesh: [1, 1.8, 1], imageplane: [1, 1.7, 0.02] };
        return Array.isArray(su.sizeM) ? su.sizeM : (d[su.kind] || [1, 1, 1]);
    }

    /** The footprint's corners and the turning handle, in plan pixels. yaw 0 faces north (-Z, the top). */
    function stageShape(su, X, Z, f) {
        const [w, , d] = stageSize(su);
        const t = stageYaw(su);
        const px = su.position[0], pz = su.position[2];
        const rx = Math.cos(t), rz = -Math.sin(t);          // the subject's right
        const bx = Math.sin(t), bz = Math.cos(t);           // its back
        const pt = (lx, lz) => [X((px + lx * rx + lz * bx) * f), Z((pz + lx * rz + lz * bz) * f)];
        return {
            corners: [pt(-w / 2, -d / 2), pt(w / 2, -d / 2), pt(w / 2, d / 2), pt(-w / 2, d / 2)],
            centre: pt(0, 0), nose: pt(0, -d / 2), handle: pt(0, -d / 2 - 0.45),
        };
    }

    function stageColour(su) {
        if (su.setObject) return su.edited ? '#5fc7a8' : '#7aa4c4';
        if (su.model && su.model.asset_id) return '#a58ad8';
        if (su.kind === 'human' || (su.model && ['man', 'woman', 'boy', 'girl'].includes(su.model.library))) return '#d98a5f';
        if (su.model && su.model.library) return '#bda47c';
        return '#8e8e97';
    }

    function stageDrawFootprint(ctx, su, selected, X, Z, s, f) {
        if (!Array.isArray(su.position)) return;
        const g = stageShape(su, X, Z, f);
        const col = stageColour(su);
        ctx.beginPath();
        g.corners.forEach(([x, z], k) => (k ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
        ctx.closePath();
        ctx.fillStyle = col + (selected ? 'cc' : '88'); ctx.fill();
        ctx.lineWidth = selected ? 2.5 : 1.5; ctx.strokeStyle = selected ? '#ffffff' : col; ctx.stroke();
        // which way it faces
        ctx.beginPath(); ctx.moveTo(g.centre[0], g.centre[1]); ctx.lineTo(g.nose[0], g.nose[1]);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
        if (selected) {
            ctx.beginPath(); ctx.arc(g.handle[0], g.handle[1], 6, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff'; ctx.fill();
        }
        if (su.isTarget) { ctx.beginPath(); ctx.arc(g.centre[0], g.centre[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#6690ff'; ctx.fill(); }
        if (su.name) {
            ctx.fillStyle = '#f3e3d6'; ctx.font = '600 12px -apple-system, sans-serif';
            ctx.fillText(String(su.name), g.centre[0] + 10, g.centre[1] + 4);
        }
    }

    /** A subject's path from above: her route, its keys, the selected key ringed. */
    function stageDrawPath(ctx, su, selected, X, Z, f) {
        if (!stageHasPath(su)) return;
        const keys = su.path.slice().sort((a, b) => a.t - b.t);
        const t0 = keys[0].t, t1 = keys[keys.length - 1].t;
        ctx.save();
        ctx.strokeStyle = selected ? 'rgba(255,170,90,0.95)' : 'rgba(217,138,95,0.55)';
        ctx.lineWidth = selected ? 2 : 1.25;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        const N = Math.max(2, Math.min(200, keys.length * 12));
        for (let n = 0; n <= N; n++) {
            const p = subjectPoseAt(su, t0 + (t1 - t0) * n / N).position;
            if (n) ctx.lineTo(X(p[0] * f), Z(p[2] * f)); else ctx.moveTo(X(p[0] * f), Z(p[2] * f));
        }
        ctx.stroke();
        ctx.setLineDash([]);
        keys.forEach((k, j) => {
            const x = X(k.position[0] * f), z = Z(k.position[2] * f);
            ctx.beginPath(); ctx.arc(x, z, selected ? 5 : 3.5, 0, Math.PI * 2);
            ctx.fillStyle = selected ? '#ffb46a' : '#d98a5f'; ctx.fill();
            if (selected && j === STAGE.keySel) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
            if (selected) { ctx.fillStyle = '#f3e3d6'; ctx.font = '10px -apple-system, sans-serif'; ctx.fillText((k.t / 1000).toFixed(1) + 's', x + 7, z - 6); }
        });
        ctx.restore();
    }

    /** Which key of the selected subject's path is under a point, if any. */
    function stagePathKeyHit(px, pz) {
        const xf = WORLD.planXf, su = STAGE.sel != null ? stageSubjects()[STAGE.sel] : null;
        if (!xf || !stageHasPath(su)) return null;
        const keys = su.path.slice().sort((a, b) => a.t - b.t);
        const f = xf.f || 1;
        for (let j = keys.length - 1; j >= 0; j--) {
            if (Math.hypot(px - xf.X(keys[j].position[0] * f), pz - xf.Z(keys[j].position[2] * f)) < 7) return su.path.indexOf(keys[j]);
        }
        return null;
    }

    function stageHit(px, pz) { return stageHitIn(stageShownSubjects(), STAGE.sel, px, pz); }

    function stageHitIn(subs, sel, px, pz) {
        const xf = WORLD.planXf;
        if (!xf) return null;
        if (sel != null && subs[sel]) {
            const h = stageShape(subs[sel], xf.X, xf.Z, xf.f).handle;
            if (Math.hypot(px - h[0], pz - h[1]) < 10) return { i: sel, turn: true };
        }
        const [wx, wz] = xf.inv(px, pz).map(v => v / (xf.f || 1));
        for (let i = subs.length - 1; i >= 0; i--) {
            const su = subs[i];
            if (!Array.isArray(su.position)) continue;
            const [w, , d] = stageSize(su);
            const t = stageYaw(su), dx = wx - su.position[0], dz = wz - su.position[2];
            const lx = dx * Math.cos(t) - dz * Math.sin(t), lz = dx * Math.sin(t) + dz * Math.cos(t);
            const pad = 6 / (xf.s * (xf.f || 1));
            if (Math.abs(lx) <= w / 2 + pad && Math.abs(lz) <= d / 2 + pad) return { i, turn: false };
        }
        return null;
    }

    /* The plan's own view: zoom about the cursor, drag empty floor to pan. */
    const PLANVIEW = { key: null, zoom: 1, cx: null, cz: null, pan: null, level: 'auto' };

    function planZoomAt(px, pz, factor) {
        const xf = WORLD.planXf;
        if (!xf) return;
        const [wx, wz] = xf.inv(px, pz);
        const fitS = xf.s / (xf.zoom || 1);
        PLANVIEW.zoom = Math.max(0.25, Math.min(40, (xf.zoom || 1) * factor));
        const sNew = fitS * PLANVIEW.zoom;
        // Keep the floor point under the cursor where it is.
        PLANVIEW.cx = wx - (px - xf.w / 2) / sNew;
        PLANVIEW.cz = wz - (pz - xf.h / 2) / sNew;
        worldPaintFrame();
    }

    function planFit() { PLANVIEW.zoom = 1; PLANVIEW.cx = null; PLANVIEW.cz = null; worldPaintFrame(); }

    function stageBindPlan() {
        const c = document.getElementById('weFrameCanvas');
        if (!c || c.dataset.stageBound) return;
        c.dataset.stageBound = '1';
        c.addEventListener('mousedown', e => {
            if (worldViewMode() !== 'plan') return;
            const r = c.getBoundingClientRect();
            const px = e.clientX - r.left, pz = e.clientY - r.top;
            if (SETEDIT.on) {
                const sh = stageHitIn(SETEDIT.items, SETEDIT.sel, px, pz);
                SETEDIT.sel = sh ? sh.i : null;
                if (sh) {
                    const it = SETEDIT.items[sh.i];
                    const [wx, wz] = WORLD.planXf.inv(px, pz).map(v => v / (WORLD.planXf.f || 1));
                    SETEDIT.drag = { i: sh.i, turn: sh.turn, ox: wx - it.position[0], oz: wz - it.position[2] };
                } else PLANVIEW.pan = { x: e.clientX, y: e.clientY };
                e.preventDefault();
                stageRenderBar(); worldPaintFrame();
                return;
            }
            // A key of the selected subject's path: select it (Delete removes it).
            const keyHit = stagePathKeyHit(px, pz);
            if (keyHit != null) { STAGE.keySel = keyHit; e.preventDefault(); stageRenderBar(); worldPaintFrame(); return; }
            const hit = stageHit(px, pz);
            if (!hit || hit.i !== STAGE.sel) STAGE.keySel = null;
            STAGE.sel = hit ? hit.i : null;
            if (hit) {
                const su = stageShownSubject(stageSubjects()[hit.i], hit.i);
                const [wx, wz] = WORLD.planXf.inv(px, pz).map(v => v / (WORLD.planXf.f || 1));
                STAGE.drag = { i: hit.i, turn: hit.turn, ox: wx - su.position[0], oz: wz - su.position[2], moved: false };
                e.preventDefault();
            } else {
                // The camera itself: its dot moves it, and anywhere else on its
                // wedge turns it to face the cursor. Both are a walk, kept with
                // "Use this camera". Empty floor pans the plan.
                const live = worldCameraPose();
                const xf = WORLD.planXf;
                if (live && xf) {
                    const ex = xf.X(live.eye[0]), ez = xf.Z(live.eye[2]);
                    if (Math.hypot(px - ex, pz - ez) < 12) STAGE.camDrag = { turn: e.shiftKey };
                }
                if (!STAGE.camDrag) PLANVIEW.pan = { x: e.clientX, y: e.clientY };
                e.preventDefault();
            }
            stageRenderBar(); worldPaintFrame();
        });
        c.addEventListener('wheel', e => {
            if (worldViewMode() !== 'plan') return;
            e.preventDefault();
            const r = c.getBoundingClientRect();
            planZoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
        }, { passive: false });
        c.addEventListener('dblclick', e => { if (worldViewMode() === 'plan' && !stageHit(e.offsetX, e.offsetY)) planFit(); });
        window.addEventListener('mousemove', e => {
            if (PLANVIEW.pan && WORLD.planXf) {
                const xf = WORLD.planXf;
                PLANVIEW.cx = xf.cx - (e.clientX - PLANVIEW.pan.x) / xf.s;
                PLANVIEW.cz = xf.cz - (e.clientY - PLANVIEW.pan.y) / xf.s;
                PLANVIEW.pan = { x: e.clientX, y: e.clientY };
                return worldPaintFrame();
            }
            if (STAGE.camDrag && WORLD.planXf) {
                const r = c.getBoundingClientRect();
                const [wx, wz] = WORLD.planXf.inv(e.clientX - r.left, e.clientY - r.top);
                worldWalkEnsure();
                const cam = worldWalkCamera();
                if (!cam) return;
                const k = WORLD.planXf.f || 1;
                if (STAGE.camDrag.turn) {
                    // Aim at the cursor; yaw 0 looks north (-Z), turning left is positive.
                    const ex = cam.position[0] * k, ez = cam.position[2] * k;
                    cam.rotation[0] = Math.atan2(-(wx - ex), -(wz - ez)) * 180 / Math.PI;
                } else {
                    cam.position = [wx / k, cam.position[1], wz / k];
                }
                return worldWalkRepaint();
            }
            if (SETEDIT.drag && WORLD.planXf) {
                const d = SETEDIT.drag, it = SETEDIT.items[d.i];
                if (!it) return;
                const r = c.getBoundingClientRect();
                const [wx, wz] = WORLD.planXf.inv(e.clientX - r.left, e.clientY - r.top).map(v => v / (WORLD.planXf.f || 1));
                if (d.turn) {
                    let deg = Math.atan2(-(wx - it.position[0]), -(wz - it.position[2])) * 180 / Math.PI;
                    if (!e.altKey) deg = Math.round(deg / 15) * 15;
                    it.rotationDeg = [0, deg, 0];
                } else it.position = [wx - d.ox, it.position[1] || 0, wz - d.oz];
                it.edited = true; SETEDIT.dirty = true;
                return worldPaintFrame();
            }
            const g = STAGE.drag;
            if (!g || !WORLD.planXf) return;
            const r = c.getBoundingClientRect();
            const [wx, wz] = WORLD.planXf.inv(e.clientX - r.left, e.clientY - r.top).map(v => v / (WORLD.planXf.f || 1));
            const stored = stageSubjects()[g.i];
            if (!stored) return;
            /*
             * A subject with a path is not moved: where she is dragged is
             * HELD (drawn there) until "+ Key here" keeps it at the playhead's
             * time. Moving her stored spot would move nothing she does.
             */
            const moving = stageHasPath(stored);
            const shown = stageShownSubject(stored, g.i);
            const su = moving ? (STAGE.pending && STAGE.pending.i === g.i ? STAGE.pending
                : (STAGE.pending = { i: g.i, position: shown.position.slice(), rotationDeg: (shown.rotationDeg || [0, 0, 0]).slice() })) : stored;
            if (g.turn) {
                // Face the cursor; yaw 0 is north (-Z), turning left is positive.
                let deg = Math.atan2(-(wx - su.position[0]), -(wz - su.position[2])) * 180 / Math.PI;
                if (!e.altKey) deg = Math.round(deg / 15) * 15;
                su.rotationDeg = [0, deg, 0];
                if (moving) su.turned = true;
            } else {
                su.position = [wx - g.ox, su.position[1] || 0, wz - g.oz];
            }
            g.moved = true;
            worldPaintFrame();
        });
        window.addEventListener('mouseup', () => {
            if (SETEDIT.drag) { SETEDIT.drag = null; stageRenderBar(); }
            PLANVIEW.pan = null;
            STAGE.camDrag = null;
            const g = STAGE.drag;
            STAGE.drag = null;
            if (g && g.moved && STAGE.pending && STAGE.pending.i === g.i) {
                stageRenderBar();
                setStatus('Held here — press "+ Key here" to keep it at ' + (stageNowMs() / 1000).toFixed(2) + 's; scrubbing lets it go');
            } else if (g && g.moved) stageSave();
        });
    }

    /** Save the whole list, a moment after the last change, touching nothing else. */
    function stageSave() {
        if (WORLD.scout) { stageSyncLook(); previzWorkspace.changed(); return; }
        clearTimeout(STAGE.timer);
        stageSyncLook();
        STAGE.timer = setTimeout(async () => {
            if (!WORLD.shotId) return setStatus('Pick a shot to stage in');
            try {
                // refresh: false — the plan repaints itself, and a reload mid-drag would drop the piece being moved.
                const r = await api(`/shots/${WORLD.shotId}/previs/subjects`,
                    { method: 'PUT', body: JSON.stringify({ subjects: stageSubjects() }), refresh: false });
                if (r && r.blocking) WORLD.blocking.blocking = r.blocking;
                setStatus(`Staged ${stageSubjects().length} in the shot`);
                // The lighting rig is placed on the framing subject: re-read it, repaint without a re-render.
                try {
                    const g = await api(`/shots/${WORLD.shotId}/previs`);
                    if (g && g.lighting) { WORLD.blocking.lighting = g.lighting; worldPaintFrame(); worldMeshRequestRender(); }
                } catch (_) { /* the rig catches up on the next load */ }
            } catch (err) { setStatus('Staging not saved: ' + err.message); }
        }, 350);
    }

    function stageRenderBar() {
        const bar = document.getElementById('pvStageBar');
        if (!bar) return;
        const plan = worldViewMode() === 'plan';
        bar.classList.toggle('editing', plan && SETEDIT.on);
        if (plan && SETEDIT.on) return setEditRenderBar(bar);
        const su = STAGE.sel != null ? stageSubjects()[STAGE.sel] : null;
        const html = !plan ? '' : `<button class="pv-btn" onclick="setEditStart()" title="Move, turn or remove the set's own furniture, then rebuild it">Edit set</button>
            <button class="pv-btn pv-primary" onclick="stageOpenAdd()">＋ Add people, furniture or a model</button>
            ${su ? `<input class="pv-stage-name" value="${esc(su.name || '')}" placeholder="Name (named subjects reach the prompt)"
                        onchange="stageRename(this.value)">
                <button class="pv-btn" onclick="stageTurn(15)" title="Turn left 15° (Q)">↺</button>
                <button class="pv-btn" onclick="stageTurn(-15)" title="Turn right 15° (E)">↻</button>
                <button class="pv-btn${su.isTarget ? ' pv-amber' : ''}" onclick="stageTarget()" title="Frame the shot on this subject">Frame on</button>
                <button class="pv-btn" onclick="stageRemove()" title="Remove (Delete)">Remove</button>
                ${stagePathBarHtml(su)}`
                : '<span class="pv-dim">Click a subject to select it · drag to move · drag the white dot or Q/E to turn</span>'}`;
        // Rebuilt only when it changes: the plan repaints every frame of a move,
        // and rebuilding would close an open picker and drop a half-typed name.
        if (bar.dataset.html === html && bar.innerHTML) return;
        bar.dataset.html = html;
        bar.innerHTML = html;
    }

    function stageRename(v) { const su = stageSubjects()[STAGE.sel]; if (su) { su.name = String(v || '').trim(); stageSave(); worldPaintFrame(); } }

    function stageTurn(deg) { const su = stageSubjects()[STAGE.sel]; if (su) { su.rotationDeg = [0, ((su.rotationDeg || [])[1] || 0) + deg, 0]; stageSave(); worldPaintFrame(); } }

    function stageTarget() {
        const subs = stageSubjects(); const su = subs[STAGE.sel];
        if (!su) return;
        const on = !su.isTarget; subs.forEach(o => { delete o.isTarget; }); if (on) su.isTarget = true;
        stageSave(); stageRenderBar(); worldPaintFrame();
    }

    function stageRemove() { const subs = stageSubjects(); if (STAGE.sel != null) { subs.splice(STAGE.sel, 1); STAGE.sel = null; STAGE.keySel = null; STAGE.pending = null; stageSave(); stageRenderBar(); worldPaintFrame(); } }

    /* ── EDITING THE SET: its own furniture, moved, turned or removed ───────
     *
     * "I should be able to grab an object and move it, like the chair in the
     * corner is 180 degrees opposite to reality."
     *
     * A built set is a layout (lib/set-build.js): walls, openings and floors as
     * measured, and objects placed in it. Edit set draws those objects on the
     * Plan as footprints, in the same coordinates as staged people (layout x, y
     * is world x, -z, and yaw means the same in both: 0 faces north, turning left
     * is positive). Nothing is written until "Rebuild set": the edited objects
     * go to POST /set-builds/:id/edit, which keeps every wall and camera of the
     * attempt it came from, builds and finishes the next world version in
     * Blender (free), and the shot is pinned to it.
     */

    /** A layout object as a footprint the staging painter can draw: [w, h, d], world position, yaw. */
    function setEditItem(o, i) {
        let w = 0.6, d = 0.6, h = 1;
        if (Array.isArray(o.size)) [w, d, h] = o.size;
        else if (o.shape === 'cylinder') { w = d = 2 * (o.radius || 0.3); h = o.height || 1; }
        else if (o.shape === 'sphere') { w = d = h = 2 * (o.radius || 0.3); }
        const at = Array.isArray(o.at) ? o.at : [0, 0, 0];
        return { setObject: true, src: i, name: o.name || o.asset || o.shape || 'object',
                 position: [at[0], at[2] || 0, -at[1]], rotationDeg: [0, o.yaw || 0, 0], sizeM: [w, h, d], edited: false };
    }

    async function setEditStart() {
        const vid = WORLD.version && WORLD.version.id;
        if (!vid) return setStatus('This shot has no set yet: build or pin one first.');
        try {
            const b = await api(`/set-builds?world_version_id=${encodeURIComponent(vid)}`);
            const objects = (b && b.layout && b.layout.objects) || [];
            SETEDIT.build = b;
            SETEDIT.items = objects.map(setEditItem);
            SETEDIT.removed = 0;
            SETEDIT.sel = null; SETEDIT.dirty = false; SETEDIT.on = true;
            setStatus(`Editing the ${WORLD.world && WORLD.world.name || ''} set: ${objects.length} objects. Nothing changes until Rebuild set.`);
        } catch (err) {
            return setStatus(/404|not built/.test(err.message)
                ? 'This world version was not built from a set layout (a Marble world or an imported model), so it has no objects to edit.'
                : 'Could not read the set: ' + err.message, true);
        }
        stageRenderBar(); worldPaintFrame();
    }

    function setEditCancel() {
        if (SETEDIT.dirty && !confirm('Discard the changes to the set?')) return;
        Object.assign(SETEDIT, { on: false, items: [], sel: null, drag: null, dirty: false });
        stageRenderBar(); worldPaintFrame();
    }

    function setEditTurn(deg) {
        const it = SETEDIT.items[SETEDIT.sel];
        if (!it) return;
        it.rotationDeg = [0, ((it.rotationDeg || [])[1] || 0) + deg, 0];
        it.edited = true; SETEDIT.dirty = true;
        stageRenderBar(); worldPaintFrame();
    }

    function setEditRemove() {
        if (SETEDIT.sel == null) return;
        SETEDIT.items.splice(SETEDIT.sel, 1); SETEDIT.sel = null;
        SETEDIT.removed = (SETEDIT.removed || 0) + 1; SETEDIT.dirty = true;
        stageRenderBar(); worldPaintFrame();
    }

    /** The edited footprints back into layout objects: only position and yaw change. */
    function setEditObjects() {
        const src = (SETEDIT.build && SETEDIT.build.layout && SETEDIT.build.layout.objects) || [];
        const r3 = n => Math.round(n * 1000) / 1000;
        return SETEDIT.items.map(it => {
            const o = JSON.parse(JSON.stringify(src[it.src]));
            const z0 = Array.isArray(o.at) ? (o.at[2] || 0) : 0;
            o.at = [r3(it.position[0]), r3(-it.position[2]), z0];
            if (o.shape !== 'cylinder' && o.shape !== 'sphere') o.yaw = r3(((it.rotationDeg || [])[1] || 0));
            return o;
        });
    }

    async function setEditRebuild() {
        if (!SETEDIT.build || SETEDIT.busy) return;
        const shotId = WORLD.scout ? null : WORLD.shotId, selection = WORLD.selectionRevision, projectId = state.currentProject.id, scoutId = WORLD.scout && WORLD.scout.worldId, buildId = SETEDIT.build.id;
        SETEDIT.busy = true; stageRenderBar();
        setStatus('Rebuilding the set in Blender — about half a minute, free…', true);
        try {
            const out = await api(`/set-builds/${buildId}/edit`, { method: 'POST',
                body: JSON.stringify({ objects: setEditObjects() }) });
            const vid = out && out.version && out.version.id;
            if (!vid) throw new Error('the rebuild made no world version');
            Object.assign(SETEDIT, { on: false, items: [], sel: null, drag: null, dirty: false, busy: false });
            if (shotId) {
                await api(`/shots/${shotId}/world`, { method: 'POST', body: JSON.stringify({ world_version_id: vid }) });
                if (WORLD.shotId === shotId && WORLD.selectionRevision === selection) await worldRailSelect(shotId);
            } else if (scoutId && WORLD.selectionRevision === selection) {
                await worldLoadScoutable(projectId);
                await worldScoutSelect(scoutId);
            }
            setStatus(`Set rebuilt as version ${out.version.version}${WORLD.shotId ? ', and this shot is on it' : ''}. Earlier versions stay.`);
        } catch (err) {
            SETEDIT.busy = false;
            setStatus('The set was not rebuilt: ' + err.message);
        }
        stageRenderBar(); worldPaintFrame();
    }

    function setEditRenderBar(bar) {
        const it = SETEDIT.items[SETEDIT.sel];
        const n = SETEDIT.items.filter(x => x.edited).length + (SETEDIT.removed || 0);
        bar.innerHTML = `
            <span class="pv-amber" style="font-weight:600">Editing the set</span>
            ${it ? `<span>${esc(it.name)}</span>
                <button class="pv-btn" onclick="setEditTurn(15)" title="Turn left 15° (Q)">↺</button>
                <button class="pv-btn" onclick="setEditTurn(-15)" title="Turn right 15° (E)">↻</button>
                <button class="pv-btn" onclick="setEditTurn(180)" title="Turn it round">180°</button>
                <button class="pv-btn" onclick="setEditRemove()" title="Remove (Delete)">Remove</button>`
                : '<span class="pv-dim">Click a piece of the set · drag to move · drag the white dot or Q/E to turn</span>'}
            <button class="pv-btn pv-primary" onclick="setEditRebuild()" ${n && !SETEDIT.busy ? '' : 'disabled'}
                title="Build the next version of the set with these changes (free, in Blender) and keep this shot on it">${SETEDIT.busy ? 'Rebuilding…' : `Rebuild set${n ? ` (${n})` : ''}`}</button>
            <button class="pv-btn" onclick="setEditCancel()" ${SETEDIT.busy ? 'disabled' : ''}>Done</button>`;
    }

    async function stageOpenAdd(tab) {
        if (!STAGE.library) {
            try { STAGE.library = await api('/previs-library'); } catch (err) { return setStatus(err.message); }
        }
        let models = [];
        try {
            const r = await api(`/projects/${state.currentProject.id}/assets?type=other`);
            models = (r.assets || r || []).map(a => {
                let m = a.metadata; try { m = typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch (_) { m = {}; }
                return /^model_/.test(m.kind || '') ? { id: a.id, label: m.subject_name || a.file_name, kind: m.subject_kind || '',
                    subject: m.subject_id || '', made: m.source === 'astra-blender' ? 'Blender' : m.subject_kind === 'imported' ? 'imported' : 'Meshy' } : null;
            }).filter(Boolean);
        } catch (_) { models = []; }
        /*
         * A film's own cast and props by name, each subject's newest model first (the 3D Models page makes them:
         * characters on Meshy, props in Blender). A location is not staged: it is the set (the 3D SETS rail).
         * Anything else (an imported .glb, a model of no subject) stays under "Other models".
         */
        const ofKind = k => models.filter(m => m.kind === k);
        const other = models.filter(m => !['character', 'prop', 'location'].includes(m.kind));
        STAGE.models = models;
        const t = tab || (ofKind('character').length ? 'characters' : 'people');
        const entries = STAGE.library.entries || [];
        const item = (label, sub, onclick) => `<button class="stage-item" onclick="${onclick}"><b>${esc(label)}</b><span>${esc(sub)}</span></button>`;
        const size = e => e.size_m.map(v => v.toFixed(2)).join(' × ') + ' m';
        let body = '';
        if (t === 'people') body = entries.filter(e => e.category === 'people').map(e => item(e.label, size(e), `stageAdd('lib', '${e.id}')`)).join('');
        else if (t === 'characters' || t === 'props') {
            const list = ofKind(t === 'characters' ? 'character' : 'prop');
            body = list.length ? list.map((m, i) => item(m.label, (list.findIndex(x => x.subject === m.subject) === i ? 'newest · ' : 'earlier · ') + m.made,
                `stageAdd('model', '${m.id}')`)).join('')
                : `<p class="pv-dim">No ${t === 'characters' ? 'character' : 'prop'} models yet. Make them on Write &amp; Design › 3D Models.</p>`;
        }
        else if (t === 'models') body = other.length ? other.map(m => item(m.label, m.made === 'imported' ? 'imported .glb' : 'this project', `stageAdd('model', '${m.id}')`)).join('')
            : '<p class="pv-dim">No other 3D models. Upload a .glb on Write &amp; Design › 3D Models.</p>';
        else {
            const cats = STAGE.library.categories.filter(c => c !== 'people');
            body = cats.map(c => {
                const es = entries.filter(e => e.category === c);
                return es.length ? `<div class="stage-cat">${esc(c)}</div>` + es.map(e => item(e.label, size(e), `stageAdd('lib', '${e.id}')`)).join('') : '';
            }).join('');
        }
        const tabBtn = (id, label) => `<button class="pv-tab${t === id ? ' active' : ''}" onclick="stageOpenAdd('${id}')">${label}</button>`;
        showModalHtml('stageAddModal', `
            <h3>Stage in this shot</h3>
            <div class="pv-tabs">${tabBtn('characters', 'Characters')}${tabBtn('props', 'Props')}${tabBtn('people', 'People')}${tabBtn('furniture', 'Furniture')}${tabBtn('models', 'Other models')}</div>
            <div class="stage-grid">${body}</div>
            <p class="text-sm text-muted">Placed a few metres in front of the camera, at real size. Move and turn it on the Plan view.</p>
            <div class="btn-row"><button class="btn btn-secondary" onclick="closeModal('stageAddModal')">Close</button></div>`);
        showModal('stageAddModal');
    }

    async function stageAdd(source, id) {
        if (source === 'lib' && !STAGE.library) {
            try { STAGE.library = await api('/previs-library'); } catch (err) { return setStatus(err.message); }
        }
        const subs = stageSubjects();
        const live = worldCameraPose();
        const f = (live && live.scale) || 1;
        let at = [0, 0, 0], yaw = 0;
        if (live) {
            const dx = live.target[0] - live.eye[0], dz = live.target[2] - live.eye[2];
            const n = Math.hypot(dx, dz) || 1;
            at = [(live.eye[0] + dx / n * 2.5) / f, 0, (live.eye[2] + dz / n * 2.5) / f];
            yaw = Math.atan2(dx, dz) * 180 / Math.PI;       // turned to face the camera
        }
        let su;
        if (source === 'lib') {
            const e = (STAGE.library.entries || []).find(x => x.id === id);
            const [w, d, h] = e.size_m;
            const person = e.category === 'people';
            const n = subs.filter(o => o.model && o.model.library === id).length;
            su = { kind: person ? 'human' : 'mesh', name: e.label.split(',')[0] + (n ? ' ' + (n + 1) : ''),
                   model: { library: id }, sizeM: [w, h, d], position: at, rotationDeg: [0, person ? yaw : 0, 0] };
        } else {
            // A character's or prop's model keeps its subject's name and link, so the shot says who is standing there.
            const m = (STAGE.models || []).find(x => x.id === id) || {};
            su = { kind: m.kind === 'character' ? 'human' : 'mesh', name: m.kind === 'character' || m.kind === 'prop' ? m.label : '', model: { asset_id: id },
                   ...(m.subject ? { subject: { kind: m.kind, id: m.subject } } : {}),
                   sizeM: [1, 1.8, 1], position: at, rotationDeg: [0, m.kind === 'character' ? yaw : 0, 0], fitToModel: true };
        }
        subs.push(su);
        STAGE.sel = subs.length - 1;
        closeModal('stageAddModal');
        if (worldViewMode() !== 'plan') worldSetViewMode('plan');
        stageRenderBar(); worldPaintFrame(); stageSave();
    }

    /** The staged subjects as their real models, in the Look view's own scene. */
    function stageSyncLook() {
        const T = window.THREE;
        if (!T || !MESHLOOK.scene || !T.GLTFLoader) return;
        const subs = stageSubjects();
        const sig = JSON.stringify(subs.map(s => [s.kind, s.model, s.position, s.rotationDeg, s.sizeM, s.fitToModel]));
        if (sig === STAGE.lookSig) return;
        STAGE.lookSig = sig;
        const old = MESHLOOK.scene.getObjectByName('staged');
        if (old) MESHLOOK.scene.remove(old);
        const group = new T.Group(); group.name = 'staged';
        MESHLOOK.scene.add(group);
        const f = (worldCameraPose() || {}).scale || 1;
        const place = (obj, su, si) => {
            const box = new T.Box3().setFromObject(obj);
            const dim = box.getSize(new T.Vector3());
            const want = stageSize(su);
            const holder = new T.Group();
            obj.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
            holder.add(obj);
            // A project model keeps its own proportions (fitted by height); a
            // library entry is stretched to the size it was placed at.
            if (su.fitToModel) holder.scale.setScalar(dim.y > 0 ? want[1] / dim.y : 1);
            else holder.scale.set(want[0] / Math.max(dim.x, 1e-6), want[1] / Math.max(dim.y, 1e-6), want[2] / Math.max(dim.z, 1e-6));
            holder.scale.multiplyScalar(f);
            holder.position.set(su.position[0] * f, (su.position[1] || 0) * f, su.position[2] * f);
            holder.rotation.y = stageYaw(su);
            holder.userData.si = si;
            holder.userData.previz_asset_sha256 = obj.userData.previz_asset_sha256;
            group.add(holder);
            stageLookPose();
        };
        subs.forEach((su, si) => {
            if (!Array.isArray(su.position)) return;
            const m = su.model || (su.kind === 'human' ? { library: 'man' } : null);
            if (!m) {
                const geo = su.kind === 'sphere' ? new T.SphereGeometry(0.5, 16, 12) : new T.BoxGeometry(1, 1, 1);
                place(new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0x9a9aa2 })), su, si);
                return;
            }
            const url = mediaUrl(m.library ? `/film/previs-library/${m.library}/file` : `/film/models/${m.asset_id}/file`);
            if (!STAGE.gltf[url]) STAGE.gltf[url] = previzWorkspace.loadModel(T, url, {batch:false});
            STAGE.gltf[url].then(scene => {
                if (STAGE.lookSig !== sig) return;
                place(scene.clone(true), su, si);
                worldMeshRequestRender();
            }).catch(() => { delete STAGE.gltf[url]; /* capture refuses a subject that is not drawn */ });
        });
        worldMeshRequestRender();
    }

    /* ── A SUBJECT THAT MOVES, AND THE FLOORS OF A HOUSE ─────────────────────
     *
     * "The camera follows a girl running from the top floor down through five
     * levels of the house." A staged subject may carry `path`: timed keys
     * { t (ms into the shot), position, rotationDeg? }. subjectPoseAt is the
     * ONE sampler, mirrored from lib/previs-subject-path.js and held equal to
     * it by tests/previs-subject-path.test.js: the Plan and Look views draw
     * her where the render puts her. Recording a path: select her, scrub the
     * playhead, drag her where she should be, press "+ Key here".
     */
    function subjectPoseAt(su, tMs) {
        const DEG = 180 / Math.PI;
        const base = su && Array.isArray(su.position) ? su.position.map(Number) : [0, 0, 0];
        const baseYaw = Number(((su && su.rotationDeg) || [])[1]) || 0;
        const keys = (su && Array.isArray(su.path) ? su.path : [])
            .filter(k => k && Number.isFinite(Number(k.t)) && Array.isArray(k.position) && k.position.length === 3)
            .slice().sort((a, b) => a.t - b.t);
        if (!keys.length) return { position: base, yawDeg: baseYaw, moving: false };
        const yawOf = k => (Array.isArray(k.rotationDeg) ? Number(k.rotationDeg[1]) || 0 : null);
        if (keys.length === 1) {
            const y = yawOf(keys[0]);
            return { position: keys[0].position.map(Number), yawDeg: y == null ? baseYaw : y, moving: false };
        }
        const T = Number(tMs) || 0;
        const travel = (a, b) => {
            const dx = b.position[0] - a.position[0], dz = b.position[2] - a.position[2];
            return Math.hypot(dx, dz) > 0.01 ? Math.atan2(-dx, -dz) * DEG : null;
        };
        let i = 0;
        while (i < keys.length - 2 && keys[i + 1].t < T) i++;
        const a = keys[i], b = keys[i + 1];
        const f = b.t > a.t ? Math.max(0, Math.min(1, (T - a.t) / (b.t - a.t))) : 0;
        const position = a.position.map((v, x) => Number(v) + (Number(b.position[x]) - Number(v)) * f);
        const ya = yawOf(a), yb = yawOf(b);
        let yawDeg;
        if (ya != null && yb != null) {
            yawDeg = ya + ((((yb - ya) % 360) + 540) % 360 - 180) * f;
        } else {
            yawDeg = travel(a, b);
            for (let j = i - 1; yawDeg == null && j >= 0; j--) yawDeg = travel(keys[j], keys[j + 1]);
            for (let j = i + 1; yawDeg == null && j < keys.length - 1; j++) yawDeg = travel(keys[j], keys[j + 1]);
            if (yawDeg == null) yawDeg = ya != null ? ya : (yb != null ? yb : baseYaw);
        }
        const moving = T > a.t && T < b.t && travel(a, b) != null;
        yawDeg = ((((yawDeg + 180) % 360) + 360) % 360) - 180;
        if (yawDeg === -180) yawDeg = 180;
        return { position, yawDeg: yawDeg + 0, moving };
    }

    /** Where the playhead is, in milliseconds into the shot. */
    function stageNowMs() { return Math.round((WORLD.t || 0) * (WORLD.durationMs || 4000)); }

    function stageHasPath(su) { return !!(su && Array.isArray(su.path) && su.path.length); }

    /**
     * A subject as it is drawn NOW: at the playhead on her path, or where she
     * was just dragged to (not yet a key). A copy: the stored row is untouched.
     */
    function stageShownSubject(su, i) {
        if (!su || !stageHasPath(su)) return su;
        const p = STAGE.pending && STAGE.pending.i === i ? STAGE.pending : null;
        if (p) return Object.assign({}, su, { position: p.position, rotationDeg: p.rotationDeg || su.rotationDeg });
        const pose = subjectPoseAt(su, stageNowMs());
        return Object.assign({}, su, { position: pose.position, rotationDeg: [0, pose.yawDeg, 0] });
    }

    function stageShownSubjects() { return stageSubjects().map(stageShownSubject); }

    /** The staged people in Look follow the playhead too. */
    function stageLookPose() {
        const g = MESHLOOK.scene && MESHLOOK.scene.getObjectByName('staged');
        if (!g) return;
        const subs = stageSubjects();
        const f = (worldCameraPose() || {}).scale || 1;
        for (const h of g.children) {
            const su = subs[h.userData && h.userData.si];
            if (!su || !stageHasPath(su)) continue;
            const s = stageShownSubject(su, h.userData.si);
            h.position.set(s.position[0] * f, (s.position[1] || 0) * f, s.position[2] * f);
            h.rotation.y = stageYaw(s);
        }
    }

    /** Keep the selected subject's spot at the playhead as a key of her path. */
    function stageKeyHere() {
        const i = STAGE.sel, su = stageSubjects()[i];
        if (!su) return;
        const t = stageNowMs();
        const shown = stageShownSubject(su, i);
        const p = STAGE.pending && STAGE.pending.i === i ? STAGE.pending : null;
        const r3 = n => Math.round(n * 1000) / 1000;
        const key = { t, position: shown.position.map(r3) };
        if (p && p.turned) key.rotationDeg = [0, r3(((shown.rotationDeg || [])[1]) || 0), 0];
        let path = Array.isArray(su.path) ? su.path.slice() : [];
        // Her first key after the start also keeps where she stood at the start.
        if (!path.length && t > 0) path.push({ t: 0, position: su.position.map(r3) });
        path = path.filter(k => Math.abs(k.t - t) > 20).concat([key]).sort((a, b) => a.t - b.t);
        su.path = path;
        STAGE.pending = null; STAGE.keySel = path.indexOf(key);
        stageSave(); stageRenderBar(); worldPaintFrame(); stageLookPose(); worldMeshRequestRender();
        setStatus(`${su.name || 'Subject'}: key ${STAGE.keySel + 1} of ${path.length} at ${(t / 1000).toFixed(2)}s — scrub, drag her, and add the next`);
    }

    function stageDeleteKey() {
        const su = stageSubjects()[STAGE.sel];
        if (!su || !stageHasPath(su) || STAGE.keySel == null) return;
        su.path.splice(STAGE.keySel, 1);
        if (!su.path.length) delete su.path;
        STAGE.keySel = null;
        stageSave(); stageRenderBar(); worldPaintFrame(); stageLookPose(); worldMeshRequestRender();
    }

    function stageClearPath() {
        const i = STAGE.sel, su = stageSubjects()[i];
        if (!su || !stageHasPath(su)) return;
        if (!confirm(`Clear ${su.name || 'this subject'}'s path? She stays where the playhead shows her.`)) return;
        const shown = stageShownSubject(su, i);
        su.position = shown.position.slice(); su.rotationDeg = (shown.rotationDeg || [0, 0, 0]).slice();
        delete su.path; STAGE.keySel = null; STAGE.pending = null;
        stageSave(); stageRenderBar(); worldPaintFrame(); stageLookPose(); worldMeshRequestRender();
    }

    /**
     * FOLLOW: a Steadicam that walks the selected subject's own path a set
     * distance behind her. The server writes ordinary camera keys through the
     * timeline route, so everything downstream reads them unchanged.
     */
    async function stageFollow() {
        const i = STAGE.sel, su = stageSubjects()[i];
        if (!su || (!WORLD.scout && !WORLD.shotId)) return;
        if (!stageHasPath(su) || su.path.length < 2) return setStatus('Give her a path first: two keys at least');
        const num = (id, d) => { const v = Number((document.getElementById(id) || {}).value); return Number.isFinite(v) && v > 0 ? v : d; };
        if ((WORLD.keys || []).length && !confirm('Replace this shot\'s camera keys with a follow?')) return;
        try {
            if (WORLD.scout) {
                await previzWorkspace.follow(su,num('pvFollowDist',2.5),num('pvFollowHeight',1.6));
                return setStatus('The workspace camera follows the local subject path.');
            }
            const out = await api(`/shots/${WORLD.shotId}/previs/timeline`, { method: 'PUT',
                body: JSON.stringify({ follow: { subject: i, distance_m: num('pvFollowDist', 2.5), height_m: num('pvFollowHeight', 1.6) } }) });
            if (out && out.blocking) {
                WORLD.blocking = Object.assign({}, WORLD.blocking || {}, { blocking: out.blocking });
                worldHydrateMove();
            }
            worldConsoleRender();
            setStatus(`The camera follows ${su.name || 'her'}: ${(WORLD.keys || []).length} keys. Play the move to see it.`);
        } catch (err) { setStatus('Follow not set: ' + err.message); }
    }

    /**
     * THE FLOORS OF A SET, for the Plan. From the layout it was built from
     * (slab tops, wall bases) when there is one, else from the geometry:
     * horizontal surfaces by area (by count of vertices when there are no
     * triangles), kept only where something stands on them — so a ceiling
     * with nothing above is not a floor. Heights in the plan's own metres.
     */
    function planLevels(src) {
        const s = src || {};
        const L = s.layout;
        const cluster = (hs, gap) => {
            const out = [];
            for (const h of hs.slice().sort((a, b) => a - b)) {
                const c = out[out.length - 1];
                if (c && h - c.last < gap) { c.last = h; c.top = Math.max(c.top, h); } else out.push({ last: h, top: h });
            }
            return out.map(c => c.top);
        };
        if (L && (Array.isArray(L.slabs) || Array.isArray(L.walls))) {
            const hs = [];
            for (const sl of (L.slabs || [])) if (Number.isFinite(Number(sl && sl.z))) hs.push(Number(sl.z));
            for (const w of (L.walls || [])) hs.push(w && Number.isFinite(Number(w.z0)) ? Number(w.z0) : 0);
            if (L.room) hs.push(0);
            return cluster(hs, 0.5);
        }
        const V = Array.isArray(s.vertices) ? s.vertices : [];
        if (!V.length) return [];
        const T = Array.isArray(s.triangles) ? s.triangles : [];
        const BIN = 0.1;
        const weight = new Map();
        if (T.length) {
            for (const t of T) {
                const a = V[t[0]], b = V[t[1]], c = V[t[2]];
                if (!a || !b || !c) continue;
                if (Math.max(a[1], b[1], c[1]) - Math.min(a[1], b[1], c[1]) > 0.02) continue;
                const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
                const k = Math.round(a[1] / BIN);
                weight.set(k, (weight.get(k) || 0) + Math.abs(ux * vz - uz * vx) / 2);
            }
        } else {
            for (const v of V) { const k = Math.round(v[1] / BIN); weight.set(k, (weight.get(k) || 0) + 1); }
        }
        let most = 0;
        for (const w of weight.values()) most = Math.max(most, w);
        const least = T.length ? Math.max(4, most * 0.1) : Math.max(4, V.length * 0.02);
        const cands = [...weight.entries()].filter(([, w]) => w >= least).map(([k]) => k * BIN);
        const supported = (h) => {
            if (T.length) {
                const mark = h + 1.0;
                return T.some(t => {
                    const a = V[t[0]], b = V[t[1]], c = V[t[2]];
                    if (!a || !b || !c) return false;
                    const lo = Math.min(a[1], b[1], c[1]), hi = Math.max(a[1], b[1], c[1]);
                    return lo <= mark && hi >= mark && lo >= h - 0.3;
                });
            }
            let n = 0;
            for (const v of V) if (v[1] > h + 0.3 && v[1] < h + 2.0) n++;
            return n >= Math.max(3, V.length * 0.005);
        };
        return cluster(cands, 0.5).filter(supported);
    }

    /** Which floor a height stands on: the highest level at or just above it. */
    function planLevelIndex(levels, y) {
        let idx = 0;
        (levels || []).forEach((l, i) => { if (l <= Number(y) + 0.3) idx = i; });
        return idx;
    }

    /** The floors of the world on show: the layout's when it was built from one, cached per version. */
    function planLevelsFor(geo) {
        const vid = WORLD.version && WORLD.version.id;
        const key = (vid || '') + ':' + ((geo && geo.vertices) || []).length;
        const c = WORLD.planLevelsCache || (WORLD.planLevelsCache = {});
        if (vid && c.layoutFor !== vid) {
            c.layoutFor = vid; c.layout = null; c.key = null;
            api(`/set-builds?world_version_id=${encodeURIComponent(vid)}`)
                .then(b => { c.layout = (b && b.layout) || null; c.key = null; worldPaintFrame(); })
                .catch(() => { /* not built from a layout: the geometry decides */ });
        }
        if (c.key === key && c.levels) return c.levels;
        c.key = key;
        c.levels = c.layout ? planLevels({ layout: c.layout }) : planLevels(geo || {});
        return c.levels;
    }

    /** The floor the plan is cut on: the one chosen, else the selected subject's, else the camera's. */
    function planActiveLevel(levels, f) {
        if (PLANVIEW.level !== 'auto' && PLANVIEW.level != null && levels[PLANVIEW.level] != null) return PLANVIEW.level;
        const su = STAGE.sel != null ? stageShownSubject(stageSubjects()[STAGE.sel], STAGE.sel) : null;
        if (su && Array.isArray(su.position)) return planLevelIndex(levels, (su.position[1] || 0) * f);
        const live = worldCameraPose();
        return live ? planLevelIndex(levels, live.eye[1] - 1.0) : 0;
    }

    function planSetFloor(v) { PLANVIEW.level = v === 'auto' ? 'auto' : Number(v); worldPaintFrame(); }

    /** The floor picker, only when a set has more than one floor. */
    function planFloorPickerHtml() {
        const pl = WORLD.planFloors;
        if (!pl || !pl.levels || pl.levels.length < 2) return '';
        const floors = pl.levels.map((l, i) => ({ l, i })).reverse().map(({ l, i }) =>
            `<button class="pv-floor-button${PLANVIEW.level === i ? ' active' : ''}" onclick="planSetFloor('${i}')">
                <span>${i + 1}</span>Floor ${i + 1}<small>${l.toFixed(1)} m</small></button>`).join('');
        return `<nav class="pv-floors" id="pvFloorPick" aria-label="Floors"
            title="The plan is cut 1.2 m above the chosen floor.">
              <b>Floors</b>${floors}
              <button class="pv-floor-follow${PLANVIEW.level === 'auto' ? ' active' : ''}" onclick="planSetFloor('auto')">Follow (${pl.active + 1})</button>
            </nav>`;
    }

    function planFloorPickerSync() {
        const view = document.getElementById('pvView');
        const current = document.getElementById('pvFloorPick');
        const html = worldViewMode() === 'plan' ? planFloorPickerHtml() : '';
        if (!html) { if (current) current.remove(); return; }
        if (current && current.dataset.html === html) return;
        const holder = document.createElement('div');
        holder.innerHTML = html;
        const next = holder.firstElementChild;
        next.dataset.html = html;
        if (current) current.replaceWith(next);
        else if (view) view.appendChild(next);
    }

    /** The selected subject's path controls, in the Plan's staging bar. */
    function stagePathBarHtml(su) {
        if (!su) return '';
        const n = stageHasPath(su) ? su.path.length : 0;
        return `<span class="pv-dim">Path: ${n ? `${n} key${n === 1 ? '' : 's'}` : 'none'}</span>
            <button class="pv-btn" onclick="stageKeyHere()" title="Keep where she is now as a key at the playhead's time">＋ Key here</button>
            ${STAGE.keySel != null && n ? `<button class="pv-btn" onclick="stageDeleteKey()" title="Remove the selected key">✕ Key ${STAGE.keySel + 1}</button>` : ''}
            ${n ? '<button class="pv-btn" onclick="stageClearPath()" title="Remove her path; she stays where she is shown">Clear path</button>' : ''}
            ${n > 1 ? `<span class="pv-follow"><button class="pv-btn" onclick="stageFollow()" title="Camera keys that trail her along her own path (a Steadicam follow)">Follow her</button>
                <input id="pvFollowDist" class="pv-num" type="number" min="0.5" step="0.5" value="2.5" title="Metres behind her"> m behind,
                <input id="pvFollowHeight" class="pv-num" type="number" min="0.2" step="0.1" value="1.6" title="Camera height above her floor"> m high</span>` : ''}`;
    }

    /* ── THE MOVE, RENDERED: a previz video, free and local (Blender) ───── */
    async function previzVideoExport(btn) {
        // A failure said only in the status line under the page went unseen: the director saw Blender start and no video.
        const failed = (msg) => {
            setStatus(msg);
            showModalHtml('previzVideoModal', `<h3>Previz video not made</h3><p class="text-sm">${esc(msg)}</p>
                <div class="btn-row"><button class="btn btn-secondary" onclick="closeModal('previzVideoModal')">Close</button></div>`);
            showModal('previzVideoModal');
        };
        if (!WORLD.shotId) return failed(WORLD.scout
            ? 'The video renders a shot\'s saved move. Press Apply to shot, open that shot (Current shot), then export.'
            : 'Open a shot first.');
        const label = btn ? btn.textContent : '';
        const done = () => { if (btn) { btn.disabled = false; btn.textContent = label; } };
        if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
        try {
            await api(`/shots/${WORLD.shotId}/previs/render-video`, { method: 'POST', body: '{}' });
        } catch (err) { done(); return failed('Previz video not started: ' + err.message); }
        const shot = WORLD.shotId;
        const poll = async () => {
            let r;
            try { r = await api(`/shots/${shot}/previs/videos`); } catch (err) { done(); return failed(err.message); }
            const job = r && r.job;
            if (job && (job.status === 'running' || job.status === 'encoding')) {
                // Frame 0 is Blender loading the set: minutes the first time for a heavy one, seconds once it is cached.
                if (btn) btn.textContent = job.status === 'encoding' ? 'Encoding…' : job.frame ? `Rendering ${job.frame}/${job.frames}` : 'Loading the set…';
                return setTimeout(poll, 1000);
            }
            done();
            if (job && job.status === 'failed') return failed('Previz video failed: ' + String(job.error || '').slice(0, 600));
            const v = r && r.videos && r.videos[0];
            if (!v) return failed('The previz video was not registered');
            const url = mediaUrl(v.url);
            showModalHtml('previzVideoModal', `<h3>Previz · v${esc(String(v.version))}</h3>
                <video src="${esc(url)}" controls autoplay style="width:100%;max-height:70vh;background:#000"></video>
                <p class="text-sm text-muted">${esc(String(v.width))}×${esc(String(v.height))} · ${esc(String(v.fps))} fps · kept in 03 Previs. <a href="${esc(url)}" download>Download</a></p>
                <div class="btn-row"><button class="btn btn-secondary" onclick="closeModal('previzVideoModal')">Close</button></div>`);
            showModal('previzVideoModal');
        };
        poll();
    }

    function worldPaintPlan(ctx, c) {
        // The Plan's floor, drawn once per set, floor and view (below); kept on the Plan's own state.
        const PLAN_BASE = PLANVIEW.base || (PLANVIEW.base = { key: null, canvas: null, ids: new WeakMap(), n: 0 });
        const hasGeo = !!(WORLD.geometry && Array.isArray(WORLD.geometry.vertices) && WORLD.geometry.vertices.length);
        // With no world yet, people and furniture can still be staged on a
        // plain twelve-metre floor rather than on nothing.
        const geo = hasGeo ? WORLD.geometry : { vertices: [], bounds: { min: [-6, 0, -6], max: [6, 3, 6] }, scale_state: 'SCALE CALIBRATED' };
        const b = geo.bounds || {};
        const min = b.min || [Infinity, Infinity, Infinity], max = b.max || [-Infinity, -Infinity, -Infinity];
        if (!b.min) for (const v of geo.vertices) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
        const pad = 28;
        const sx = (c.width - pad * 2) / Math.max(1e-6, max[0] - min[0]);
        const sz = (c.height - pad * 2) / Math.max(1e-6, max[2] - min[2]);
        // Fitted to the set, then the view's own zoom and centre (wheel, drag).
        const fit = Math.min(sx, sz);
        const pv = PLANVIEW;
        if (pv.key !== WORLD.shotId) { pv.key = WORLD.shotId; pv.zoom = 1; pv.cx = null; pv.cz = null; pv.level = 'auto'; STAGE.pending = null; STAGE.keySel = null; }
        const s = fit * pv.zoom;
        const cx = pv.cx != null ? pv.cx : (min[0] + max[0]) / 2;
        const cz = pv.cz != null ? pv.cz : (min[2] + max[2]) / 2;
        const X = x => c.width / 2 + (x - cx) * s, Z = z => c.height / 2 + (z - cz) * s;
        // Kept, so a click can be turned back into a place on the floor.
        WORLD.planXf = { X, Z, s, cx, cz, w: c.width, h: c.height, zoom: pv.zoom,
                         inv: (px, pz) => [cx + (px - c.width / 2) / s, cz + (pz - c.height / 2) / s] };

        const cell = Math.max(2, Math.round(Math.min(c.width, c.height) / 160));
        const cols = Math.ceil(c.width / cell), rows = Math.ceil(c.height / cell);
        /*
         * A CUT, like an architect's plan. Taking the tallest point per cell
         * paints the ceiling over the whole room; cutting at 60% of the room's
         * height shows what stands on the floor, and a wall still reads as the
         * brightest thing because it reaches the cut everywhere it stands.
         */
        let cut = min[1] + (max[1] - min[1]) * 0.6;
        /*
         * FLOORS. A house is several plans: with more than one floor the cut
         * is 1.2 m above the floor on show, and only what stands between that
         * floor and the next is drawn. One floor (or no metres to measure in)
         * keeps the single cut above.
         */
        const live0 = worldCameraPose();
        const f0 = live0 ? live0.scale : 1;
        const levels = hasGeo && String(geo.scale_state || '') === 'SCALE CALIBRATED' ? planLevelsFor(geo) : [];
        const multi = levels.length > 1;
        const active = multi ? planActiveLevel(levels, f0) : 0;
        WORLD.planFloors = { levels, active };
        let lo = -Infinity, base = min[1];
        if (multi) {
            base = levels[active];
            lo = base - 0.15;
            const next = levels[active + 1];
            cut = Math.min(base + 1.2, next != null ? next - 0.05 : Infinity);
        }
        const onFloor = (y) => !multi || planLevelIndex(levels, y) === active;
        /*
         * THE FLOOR IS DRAWN ONCE. Re-reading every vertex and section-cutting every triangle on every repaint
         * (each step of a walk, each drag, each frame of Play) is ~700k vertices and 250k triangles on Horton
         * Mansion, 30ms of arithmetic and 46k cells painted per frame. What it draws only changes with the set,
         * the floor on show and the view (zoom, centre, size), so it is kept as a picture and the frame redraws
         * only what moves on top of it: cameras, people, lights.
         */
        // The geometry OBJECT, not only its version: an edited set is new geometry under the same version id.
        if (hasGeo && !PLAN_BASE.ids.has(geo)) PLAN_BASE.ids.set(geo, ++PLAN_BASE.n);
        const baseKey = [hasGeo ? PLAN_BASE.ids.get(geo) : 'none', geo.vertices.length, hasGeo, geo.scale_state, c.width, c.height, s, cx, cz, cut, lo, cell].join('|');
        if (PLAN_BASE.key !== baseKey || !PLAN_BASE.canvas) {
            const bc = PLAN_BASE.canvas || (PLAN_BASE.canvas = document.createElement('canvas'));
            bc.width = c.width; bc.height = c.height;
            const ctx = bc.getContext('2d');
            ctx.fillStyle = '#0f0f12';
            ctx.fillRect(0, 0, c.width, c.height);
            if (!hasGeo) {
                ctx.fillStyle = '#8e8e97'; ctx.font = '13px -apple-system, sans-serif';
                ctx.fillText('No set for this world yet — stage on an empty floor, or build the set first.', 20, 30);
            }
            const hmap = new Float32Array(cols * rows).fill(-Infinity);
            for (const v of geo.vertices) {
                if (v[1] > cut || v[1] < lo) continue;
                const i = Math.floor(X(v[0]) / cell), j = Math.floor(Z(v[2]) / cell);
                if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
                const k = j * cols + i;
                if (v[1] > hmap[k]) hmap[k] = v[1];
            }
            const floor = base, span = Math.max(1e-6, cut - base);
            for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
                const h = hmap[j * cols + i];
                if (h === -Infinity) continue;
                const t = Math.min(1, Math.max(0, (h - floor) / span));
                const g = Math.round(38 + t * 150);
                ctx.fillStyle = `rgb(${g},${g + 3},${g + 8})`;
                ctx.fillRect(i * cell, j * cell, cell, cell);
            }
            if (multi && Array.isArray(geo.triangles)) {
                // An architect's section: where each wall of this floor meets the cut.
                ctx.strokeStyle = 'rgba(232,232,240,0.9)'; ctx.lineWidth = 1.5;
                ctx.beginPath();
                const V = geo.vertices;
                for (const t of geo.triangles) {
                    const p = [V[t[0]], V[t[1]], V[t[2]]];
                    if (!p[0] || !p[1] || !p[2]) continue;
                    const pts = [];
                    for (let k = 0; k < 3; k++) {
                        const a = p[k], b = p[(k + 1) % 3];
                        if ((a[1] - cut) * (b[1] - cut) < 0) {
                            const u = (cut - a[1]) / (b[1] - a[1]);
                            pts.push([a[0] + (b[0] - a[0]) * u, a[2] + (b[2] - a[2]) * u]);
                        }
                    }
                    if (pts.length === 2 && Math.min(p[0][1], p[1][1], p[2][1]) >= lo) {
                        ctx.moveTo(X(pts[0][0]), Z(pts[0][1])); ctx.lineTo(X(pts[1][0]), Z(pts[1][1]));
                    }
                }
                ctx.stroke();
            }
            // one metre, when there are metres
            if (String(geo.scale_state || '') === 'SCALE CALIBRATED') {
                ctx.strokeStyle = '#b7b7be'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(pad, c.height - 14); ctx.lineTo(pad + s, c.height - 14); ctx.stroke();
                ctx.fillStyle = '#b7b7be'; ctx.font = '11px -apple-system, sans-serif'; ctx.fillText('1 m', pad + s + 6, c.height - 10);
            }
            PLAN_BASE.key = baseKey;
        }
        ctx.drawImage(PLAN_BASE.canvas, 0, 0);
        const wedge = (pose, stroke, fill, label) => {
            const ex = X(pose.eye[0]), ez = Z(pose.eye[2]);
            const dx = pose.target[0] - pose.eye[0], dz = pose.target[2] - pose.eye[2];
            const a = Math.atan2(dz, dx), half = (pose.hDeg / 2) * Math.PI / 180, L = Math.min(c.width, c.height) * 0.35;
            ctx.beginPath(); ctx.moveTo(ex, ez);
            ctx.lineTo(ex + Math.cos(a - half) * L, ez + Math.sin(a - half) * L);
            ctx.lineTo(ex + Math.cos(a + half) * L, ez + Math.sin(a + half) * L);
            ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.beginPath(); ctx.arc(ex, ez, 5, 0, Math.PI * 2); ctx.fillStyle = stroke; ctx.fill();
            if (label) { ctx.fillStyle = stroke; ctx.font = '600 12px -apple-system, sans-serif'; ctx.fillText(label, ex + 8, ez - 8); }
        };
        for (const a of (EXPLORE.accepted || [])) {
            const p = a.camera && worldCameraPose(a.camera);
            if (p) wedge(p, 'rgba(183,183,190,0.75)', 'rgba(255,255,255,0.04)', a.key);
        }
        const live = worldCameraPose();
        // Something on another floor is drawn faint: it is there, not here.
        const faint = (y, draw) => { ctx.save(); if (!onFloor(y)) ctx.globalAlpha = 0.3; draw(); ctx.restore(); };
        if (live) faint(live.eye[1] - 1.0, () => wedge(live, '#6690ff', 'rgba(102,144,255,0.16)', 'CAMERA'));
        const f = live ? live.scale : 1;
        WORLD.planXf.f = f;
        if (SETEDIT.on) SETEDIT.items.forEach((it, i) => stageDrawFootprint(ctx, it, i === SETEDIT.sel, X, Z, s, f));
        else {
            stageSubjects().forEach((su, i) => stageDrawPath(ctx, su, i === STAGE.sel, X, Z, f));
            stageSubjects().forEach((su, i) => {
                const shown = stageShownSubject(su, i);
                if (shown && Array.isArray(shown.position)) faint((shown.position[1] || 0) * f, () => stageDrawFootprint(ctx, shown, i === STAGE.sel, X, Z, s, f));
            });
        }
        // The lighting rig, seen from above: each light, its role, and where it points.
        const lit = WORLD.blocking && WORLD.blocking.lighting;
        if (WORLD.showLights !== false && lit && Array.isArray(lit.rig)) {
            for (const l of lit.rig) {
                const lx = X(l.position[0] * f), lz = Z(l.position[2] * f);
                const tx = X(l.target[0] * f), tz = Z(l.target[2] * f);
                ctx.strokeStyle = 'rgba(255,214,102,0.45)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(lx, lz); ctx.lineTo(tx, tz); ctx.stroke(); ctx.setLineDash([]);
                ctx.fillStyle = l.colour || '#ffd666';
                ctx.beginPath(); ctx.arc(lx, lz, 7, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#ffd666'; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.fillStyle = '#ffd666'; ctx.font = '600 11px -apple-system, sans-serif';
                ctx.fillText(String(l.role || '').toUpperCase(), lx + 10, lz + 4);
            }
        }
    }

    /* ── SHOTS IN THE PHASE PANEL ──────────────────────────────────────────
     *
     * The shot list belongs with the rest of the navigation, in the app's own
     * left panel, rather than as a third column eating the view. Added under
     * the Plan pages while the one-screen console is open, removed the moment
     * it is not — the panel is shared by every page.
     */
    /*
     * Folding the panels away, for more frame. Three independent folds, the
     * panels on each side of the view; remembered per browser, applied only
     * while Previs is open (the app's left panel is shared by every page and
     * must come back the moment you leave).
     */
    const PV_FOLDS = [
        { id: 'left', icon: '◧', tip: 'Hide or show the left panel (the shot list)' },
        { id: 'right', icon: '◨', tip: 'Hide or show the right panel (Camera, Direct, Explore, Scene)' },
        { id: 'bottom', icon: '⬓', tip: 'Hide or show the bottom bar (the move timeline)' },
    ];

    function pvFolds() {
        try { return JSON.parse(localStorage.getItem('pv_folds') || '{}') || {}; } catch (_) { return {}; }
    }

    function pvFolded(id) { return !!pvFolds()[id]; }

    function pvApplyFolds(page) {
        const on = page === 'previs';
        const f = pvFolds();
        for (const { id } of PV_FOLDS) document.body.classList.toggle('pv-hide-' + id, on && !!f[id]);
    }

    function pvToggleFold(id) {
        const f = pvFolds();
        f[id] = !f[id];
        try { localStorage.setItem('pv_folds', JSON.stringify(f)); } catch (_) { /* per-browser convenience only */ }
        pvApplyFolds(state.currentPage);
        document.querySelectorAll(`.pv-fold[data-fold="${id}"]`).forEach(b => b.classList.toggle('pv-folded', !!f[id]));
        // The frame, the painters and the 3D views all size from their host.
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }

    async function worldToggleArchived() {
        WORLD.showArchived = !WORLD.showArchived;
        WORLD.archived = [];
        if (WORLD.showArchived && state.currentProject) {
            try { WORLD.archived = (await api(`/projects/${state.currentProject.id}/worlds?archived=only`)).worlds || []; }
            catch (err) { setStatus('Could not read archived sets: ' + err.message); }
        }
        worldSyncPanelShots(state.currentPage);
    }

    async function worldRestoreArchived(id) {
        try {
            await api(`/worlds/${id}`, { method: 'PATCH', body: JSON.stringify({ archived: false }) });
            WORLD.archived = (WORLD.archived || []).filter(w => w.id !== id);
            await worldLoadScoutable(state.currentProject.id);
            worldConsoleRender();
            setStatus('Set restored. Its versions are preserved.');
        } catch (err) { setStatus('Could not restore set: ' + err.message); }
    }

    function worldSyncPanelShots(page) {
        pvApplyFolds(page);
        const panel = document.querySelector('.fe-panel');
        let box = document.getElementById('fePanelShots');
        const want = page === 'previs' && worldEngineOn() && worldFlagOn('previs_console') && !!panel;
        document.body.classList.toggle('pv-shots-in-panel', want);
        if (!want) { if (box) box.remove(); return; }
        if (!box) {
            box = document.createElement('div');
            box.id = 'fePanelShots';
            box.className = 'fe-panel-shots';
            panel.appendChild(box);
        }
        const shots = WORLD.shots || [];
        const scout = WORLD.scoutable || [];
        const sig = previzWorkspace.revision + '|' + previzWorkspace.railRevision + '|' + previzWorkspace.source?.world_sha256 + '|' + (previzWorkspace.source?.rooms?.length || 0) + '|' + shots.map(s => s.id).join(',') + '|' + WORLD.shotId + '|'
            + scout.map(x => x.world.id).join(',') + '|' + (WORLD.scout ? WORLD.scout.worldId : '')
            + '|' + !!WORLD.showArchived + '|' + (WORLD.archived || []).map(w => w.id).join(',');
        if (box.dataset.sig === sig) return;
        box.dataset.sig = sig;
        box.innerHTML = previzWorkspace.railHtml();

    }

    /* ── Camera movement (phase 4) ────────────────────────────────────────
     *
     * A surface over the move model that already exists. `previs-blocking`
     * samples compound moves, composes concurrent legs and interpolates a pose
     * at any moment; this panel writes `moves_json` and `camera_keys_json` and
     * nothing else. A timeline with its own store would be a second answer to
     * what move a shot has.
     */

    /*
     * The four curves plus HOLD. Hold is not a curve — it is the absence of
     * travel — which is why it is listed here and not in the library's EASINGS,
     * whose set the viewer is pinned to.
     *
     * HANDHELD is deliberately NOT here. The design draws it as a fifth ease
     * chip, but handheld is a RIG in this engine and already carries its own
     * noise amplitude; offering it in two places would be two ways to say one
     * thing, and they would drift.
     */
    function worldEases() {
        return [
            { id: 'linear',      label: 'LINEAR' },
            { id: 'ease-in',     label: 'EASE IN' },
            { id: 'ease-out',    label: 'EASE OUT' },
            { id: 'ease-in-out', label: 'EASE BOTH' },
            { id: 'hold',        label: 'HOLD' },
        ];
    }

    function worldTimelineHtml() {
        const dur = (WORLD.durationMs || 4000) / 1000;
        const ticks = [];
        for (let i = 0; i <= Math.round(dur); i++) ticks.push(`<span>${i.toFixed(1)}s</span>`);

        /*
         * A LANE SHOWS ONLY WHAT IT CARRIES.
         *
         * Both lanes rendered every leg, so the ROTATION lane announced
         * "DOLLY IN" — a translation. The panel was stating something false
         * about the move, which is worse than showing nothing.
         *
         * Derived from the movement taxonomy the server already serves, never
         * from a list here: a movement added later lands in the right lane with
         * nothing to remember.
         */
        const affects = (lane, movement) => {
            const tax = (PREVIS.taxonomy && PREVIS.taxonomy.movements) || {};
            const def = tax[movement] || tax[String(movement)];
            if (!def) return true;                       // unknown: show it rather than hide it
            const some = (v) => Array.isArray(v) && v.some(n => Math.abs(Number(n) || 0) > 1e-9);
            if (lane === 'pos') return some(def.translate) || (def.focalScale && def.focalScale !== 1);
            return some(def.rotate) || def.space === 'subject';   // an orbit turns the camera
        };

        const legRow = (lane, allLegs) => (allLegs.filter(l => affects(lane, l.movement))).map((l, i) => {
            const pct = Math.max(4, Math.round((l.weight || 1) / Math.max(1, allLegs.reduce((a, x) => a + (x.weight || 1), 0)) * 100));
            return `<div class="we-clip we-clip-${lane}" style="width:${pct}%;"
                         onclick="worldSelectLeg(${i})" title="${esc(l.movement || 'static')}">
                      <div class="we-clip-t">${esc((l.movement || 'static').replace(/-/g, ' ').toUpperCase())}</div>
                      <div class="we-clip-s">${esc(l.ease || WORLD.ease || 'ease-out')}</div>
                    </div>`;
        }).join('') || (allLegs.length
            // The design's own label for a lane with nothing in it.
            ? '<div class="we-clip-empty">HOLD</div>'
            // Keys are a move too (drawn as markers on this lane): "no legs" read as if nothing was set.
            : (WORLD.keys || []).length >= 2 ? `<div class="we-clip-empty">keyed move · ${(WORLD.keys || []).length} keys</div>`
            : (WORLD.keys || []).length === 1 ? '<div class="we-clip-empty">1 key — move the camera and add another</div>'
            : '<div class="we-clip-empty">no legs — add one to build a move</div>');

        const keys = (WORLD.keys || []).map((k, i) =>
            `<button class="we-key" style="left:${Math.round((k.t || 0) * 100)}%;"
                     onclick="worldSeekTo(${k.t || 0})" title="key ${i + 1}"></button>`).join('');

        const eases = worldEases().map(e =>
            `<button class="we-ease${(WORLD.ease || 'ease-out') === e.id ? ' active' : ''}"
                     onclick="worldSetEase('${e.id}')">${e.label}</button>`).join('');

        const blocking = (WORLD.blocking && WORLD.blocking.blocking) || {};
        const pathSubjects = (blocking.subjects || []).filter(s => Array.isArray(s.path) && s.path.length);
        const peopleKeys = pathSubjects.flatMap(s => s.path.map(k => {
            const t = Math.max(0, Math.min(1, (Number(k.t) || 0) / (WORLD.durationMs || 4000)));
            return `<button class="we-key we-key-person" style="left:${Math.round(t * 100)}%;"
                onclick="worldSeekTo(${t})" title="${esc(s.name || 'person')} at ${(t * dur).toFixed(1)}s"></button>`;
        })).join('');
        const lighting = (WORLD.blocking && WORLD.blocking.lighting) || {};
        const lightLabel = lighting.technique || lighting.type || 'holds for the shot';
        const floorLabel = pathSubjects.length ? 'follows the moving subject' : 'follows the camera';
        const lenIn = `<input class="pv-num pv-len" type="number" min="0.5" max="60" step="0.5" value="${dur.toFixed(1)}" onchange="worldSetLength(this.value)" aria-label="Length of the move in seconds" title="Length of the move. Keys keep their time in seconds; past the last key the camera holds.">`;
        const shotMs = ((WORLD.shots || []).find(s => s.id === (WORLD.shotId || WORLD.targetId)) || {}).duration_ms || 0;
        const shotLen = shotMs > 0 && Math.abs(shotMs - (WORLD.durationMs || 4000)) >= 50
            ? `<button class="pv-btn pv-shotlen" onclick="worldSyncShotLength()" title="The shot's length on its storyboard card is what Generate and the cut use">Shot is ${(shotMs / 1000).toFixed(1)} s · make it ${dur.toFixed(1)} s</button>` : '';

        return `
        <div class="we-panel we-timeline">
          <div class="we-panel-head">
            <span class="we-label">CAMERA MOVEMENT</span>
            <span class="we-live">${lenIn} s</span>${shotLen}
            <button class="we-btn" onclick="worldPlayMove()">▶ PLAY MOVE</button>
            <button class="we-btn" onclick="worldAddKey()">+ KEY</button>
            <button class="we-btn" onclick="worldAddLeg()">+ LEG</button>
            <button class="we-btn" onclick="previzVideoExport(this)" title="Render this move through the set to an MP4 in Blender, with the people on their paths. Free, on this Mac; kept in 03 Previs.">EXPORT PREVIZ VIDEO</button>
          </div>
          <div class="we-ruler">${ticks.join('')}</div>
          <div class="we-lane"><span class="we-lane-l">POSITION</span>
            <div class="we-track">${legRow('pos', WORLD.moves || [])}${keys}
              <div class="we-playhead" style="left:${Math.round((WORLD.t || 0) * 100)}%;"></div></div></div>
          <div class="we-lane"><span class="we-lane-l">ROTATION</span>
            <div class="we-track">${legRow('rot', WORLD.moves || [])}
              <div class="we-playhead" style="left:${Math.round((WORLD.t || 0) * 100)}%;"></div></div></div>
          <div class="we-lane"><span class="we-lane-l">EASE</span>
            <div class="we-eases">${eases}</div></div>
          <div class="we-lane pv-context-lane"><span class="we-lane-l">PEOPLE</span>
            <div class="we-track">${peopleKeys || '<div class="we-clip-empty">no subject path</div>'}</div></div>
          <div class="we-lane pv-context-lane"><span class="we-lane-l">LIGHTS</span>
            <div class="we-track"><div class="we-clip-empty">${esc(lightLabel)}</div></div></div>
          <div class="we-lane pv-context-lane"><span class="we-lane-l">FLOORS</span>
            <div class="we-track"><div class="we-clip-empty">${esc(floorLabel)}</div></div></div>
          <canvas id="wePathCanvas" class="we-path"></canvas>
        </div>`;
    }

    function worldSetEase(id) {
        WORLD.ease = id;
        if (WORLD.selectedLeg != null && WORLD.moves[WORLD.selectedLeg]) {
            WORLD.moves[WORLD.selectedLeg].ease = id;
        }
        worldTimelineSave();
        worldConsoleRender();
    }

    function worldSelectLeg(i) { WORLD.selectedLeg = i; worldConsoleRender(); }

    function worldAddLeg() {
        WORLD.moves = (WORLD.moves || []).concat([{ movement: 'dolly-in', weight: 1, ease: WORLD.ease || 'ease-out' }]);
        worldTimelineSave();
        worldConsoleRender();
    }

    /*
     * The move as saved: legs, keys and length come from the shot's blocking.
     * They were held only in the page, so a reload showed an empty timeline and
     * the next save wrote that emptiness back over what the shot had.
     */
    function worldHydrateMove() {
        const b = WORLD.blocking && WORLD.blocking.blocking;
        WORLD.moves = b && Array.isArray(b.moves) ? b.moves.slice() : [];
        WORLD.keys = b && Array.isArray(b.cameraKeys) ? b.cameraKeys.map(k => Object.assign({}, k)) : [];
        WORLD.durationMs = b && b.durationMs > 0 ? b.durationMs : (WORLD.durationMs || 4000);
        // The lens is the saved camera's: the console showed its own 35mm over a 24mm shot.
        if (b && b.camera && Number(b.camera.focalMm) > 0) WORLD.lens = Number(b.camera.focalMm);
    }

    /*
     * Snapshot the camera as it stands now — the one being looked through,
     * walked or saved — at the playhead. It read a WORLD.camera nothing ever
     * set, so every key was the default pose, outside the set.
     */
    function worldAddKey() {
        const cam = worldWalkCamera() || ((WORLD.blocking && WORLD.blocking.blocking && WORLD.blocking.blocking.camera) || null);
        if (!cam || !Array.isArray(cam.position)) return setStatus('Open a shot with a camera first');
        const t = WORLD.t || 0;
        const key = {
            t,
            position: cam.position.slice(),
            rotation: (cam.rotation || [0, 0, 0]).slice(),
            focalMm: WORLD.lens || cam.focalMm || 35,
            // The persisted unit is always degrees — a radian/degree confusion
            // at this boundary silently rewrites every authored move.
            rotationUnit: 'degrees',
        };
        /*
         * KEY, MOVE THE CAMERA, KEY: the second press must make a move.
         *
         * The dock has no playhead of its own, so both presses landed at the same moment and the second replaced
         * the first: one key, no move, and Play did nothing. A key pressed again at the moment the last one was
         * added (the playhead not moved since) is the NEXT key: it goes to the end of the move, and keys already
         * at the end make the move longer by one more segment of the average length, each earlier key keeping
         * its time in seconds (squeezing them sped up the move already set). A key at a moment the director
         * moved the playhead to still replaces the one there, which is how a key is corrected.
         */
        let keys = (WORLD.keys || []).slice();
        const there = keys.find(k => Math.abs((k.t || 0) - t) <= 1e-3);
        const same = there && there.position.every((v, i) => Math.abs(v - key.position[i]) < 1e-4)
            && (there.rotation || [0, 0, 0]).every((v, i) => Math.abs(v - key.rotation[i]) < 1e-3) && there.focalMm === key.focalMm;
        if (there && !same && WORLD.lastKeyT != null && Math.abs(WORLD.lastKeyT - t) <= 1e-3) {
            const last = Math.max(...keys.map(k => k.t || 0));
            if (last < 1 - 1e-3) key.t = 1;
            else {
                const old = WORLD.durationMs || 4000, n = keys.length;
                const next = Math.min(60000, Math.round(old + old / Math.max(1, n - 1)));
                keys = keys.map(k => Object.assign({}, k, { t: (k.t || 0) * old / next }));
                WORLD.durationMs = next;
                key.t = 1;
            }
        }
        // A key at the same moment replaces the one there, rather than stacking.
        WORLD.keys = keys.filter(k => Math.abs((k.t || 0) - key.t) > 1e-3).concat([key]).sort((a, b) => a.t - b.t);
        WORLD.t = key.t;
        WORLD.lastKeyT = key.t;
        worldTimelineSave();
        worldConsoleRender();
        setStatus(WORLD.keys.length < 2
            ? `Key 1 at ${Math.round(key.t * 100)}% — move the camera, then press + Key again for where it ends`
            : `Key ${WORLD.keys.findIndex(k => k === key) + 1} of ${WORLD.keys.length} at ${(key.t * (WORLD.durationMs || 4000) / 1000).toFixed(1)} s — press Play to see the move`);
    }

    /*
     * THE MOVE'S LENGTH, IN SECONDS. Keys are stored as a share of the move (0..1), so the length alone
     * stretched them. Longer: each key keeps its second and the camera holds after the last one, which is
     * where a next move starts (playhead to the end, move the camera, + Key). Shorter than the last key:
     * the keys are squeezed to fit, since a key past the end would never play.
     */
    function worldSetLength(seconds) {
        const old = WORLD.durationMs || 4000;
        const want = Math.round(Math.max(0.5, Math.min(60, Number(seconds))) * 1000);
        if (!Number.isFinite(want) || want === old) return worldConsoleRender();
        const lastMs = Math.max(0, ...(WORLD.keys || []).map(k => (k.t || 0) * old));
        const keep = want >= lastMs;
        WORLD.keys = (WORLD.keys || []).map(k => Object.assign({}, k, { t: keep ? (k.t || 0) * old / want : (k.t || 0) }));
        WORLD.durationMs = want;
        WORLD.lastKeyT = null;
        worldTimelineSave();
        worldConsoleRender();
        setStatus(`The move is ${(want / 1000).toFixed(1)} s` + (keep ? ((WORLD.keys || []).length && want > lastMs
            ? ` — the camera holds after ${(lastMs / 1000).toFixed(1)} s. Move the playhead to the end, set the camera and + Key for the next move.` : '')
            : ' — the keys were squeezed to fit.'));
    }

    /** The shot's own length (its storyboard card), set to the move's: what Generate and the cut read. Scouting, the target shot's. */
    async function worldSyncShotLength() {
        const shot = (WORLD.shots || []).find(s => s.id === (WORLD.shotId || WORLD.targetId));
        if (!shot) return;
        const seconds = Math.round((WORLD.durationMs || 4000) / 100) / 10;
        try {
            await api(`/shots/${shot.id}`, { method: 'PUT', refresh: false, body: JSON.stringify({ duration_seconds: seconds }) });
            shot.duration_ms = Math.round(seconds * 1000);
            worldConsoleRender();
            setStatus(`${shot.shot_code || 'The shot'} is now ${seconds.toFixed(1)} s on its card`);
        } catch (err) { setStatus(err.message); }
    }

    /*
     * THE PLAYHEAD POSES THE CAMERA. It moved a line over the timeline and left
     * the picture where it was, so Play Move showed nothing about the move.
     * The pose is read from the path the server sampled from the keys or legs,
     * and it is a preview: moving the camera by hand ends it.
     */
    function worldPoseAtT(t) {
        const b = WORLD.blocking && WORLD.blocking.blocking;
        let path = b && Array.isArray(b.path) ? b.path.filter(k => Array.isArray(k.position)) : [];
        /*
         * No sampled path, but keys: the keys ARE the move. Scouting a set with no target shot keeps its keys
         * here and never reaches the server that samples a path (worldTimelineSave), so Play moved the playhead
         * over keys and the camera stood still. The keys are in the same space as a sampled path (the camera's).
         */
        if (path.length < 2) path = (WORLD.keys || []).filter(k => Array.isArray(k.position)).slice().sort((a, b2) => (a.t || 0) - (b2.t || 0));
        if (path.length < 2) return null;
        const T = Math.max(0, Math.min(1, t));
        let i = 0;
        while (i < path.length - 2 && (path[i + 1].t == null ? (i + 1) / (path.length - 1) : path[i + 1].t) < T) i++;
        const a = path[i], c = path[i + 1];
        const ta = a.t == null ? i / (path.length - 1) : a.t, tc = c.t == null ? (i + 1) / (path.length - 1) : c.t;
        const f = tc > ta ? (T - ta) / (tc - ta) : 0;
        const lerp = (x, y) => x + (y - x) * f;
        const ang = (x, y) => x + ((((y - x) % 360) + 540) % 360 - 180) * f;
        const ra = a.rotation || [0, 0, 0], rc = c.rotation || ra;
        return {
            position: a.position.map((v, k) => lerp(v, c.position[k])),
            rotation: ra.map((v, k) => ang(v, rc[k])),
            focalMm: lerp(a.focalMm || WORLD.lens || 35, c.focalMm || a.focalMm || WORLD.lens || 35),
        };
    }

    function worldPreviewCamera() {
        // Play shows the move even while walking: the walk camera is where the director stands between plays.
        if (WORLD.previewT == null || (WALK.on && !WORLD.playing)) return null;
        return worldPoseAtT(WORLD.previewT);
    }

    function worldSeekTo(t) {
        WORLD.t = Math.max(0, Math.min(1, Number(t) || 0));
        // A playhead the director moved: the next + Key lands here, not at the end (worldAddKey).
        if (!WORLD.playing) WORLD.lastKeyT = null;
        STAGE.pending = null;
        stageLookPose();
        WORLD.previewT = worldPoseAtT(WORLD.t) ? WORLD.t : null;
        worldPaintFrame();
        if (typeof worldMeshRenderOnce === 'function') worldMeshRequestRender();
        if (typeof worldSplatRenderOnce === 'function') worldSplatRenderOnce();
        worldDrawPath();
        // The dock under the view too: with the timeline closed, Play moved the camera and nothing that shows time.
        const heads = document.querySelectorAll('.we-playhead, .pv-playhead');
        for (const h of heads) h.style.left = Math.round(WORLD.t * 100) + '%';
        const clock = document.querySelector('.pv-time');
        if (clock && clock.firstChild && clock.firstChild.nodeType === 3) clock.firstChild.nodeValue = (WORLD.t * (WORLD.durationMs || 4000) / 1000).toFixed(1) + ' ';
    }

    /*
     * Plays the INTERPOLATED path. Snapping to the nearest key made a 24-key
     * path repainted at 60fps move 24 times and stand still between — how
     * densely a path was sampled is a storage decision and must not be visible
     * in the shot.
     */
    function worldPlayMove() {
        if (WORLD.playing) { WORLD.playing = false; return; }
        const kb = WORLD.blocking && WORLD.blocking.blocking;
        if (!(kb && Array.isArray(kb.path) && kb.path.length >= 2) && !(WORLD.moves || []).length && (WORLD.keys || []).length < 2) {
            return setStatus((WORLD.keys || []).length ? 'One key holds the camera still: move the camera and press + Key again to make a move' : 'No move yet: press + Key, move the camera, and press + Key again');
        }
        WORLD.playing = true;
        WORLD.lastKeyT = null;
        const started = Date.now();
        const dur = WORLD.durationMs || 4000;
        const step = () => {
            if (!WORLD.playing) return;
            /*
             * A BACKGROUNDED TAB STOPS PLAYING, IT DOES NOT STALL.
             *
             * requestAnimationFrame does not fire in a hidden tab, so switching
             * away mid-move left `playing` true forever — and the next press of
             * Play then read as the toggle and turned it OFF. A director would
             * press Play, see nothing, and press it again to no effect.
             */
            if (typeof document !== 'undefined' && document.hidden) { WORLD.playing = false; return; }
            const t = Math.min(1, (Date.now() - started) / dur);
            worldSeekTo(t);
            if (t < 1) requestAnimationFrame(step); else WORLD.playing = false;
        };
        requestAnimationFrame(step);
    }

    /** The sampled path, drawn top-down with its keyframes and the playhead. */
    function worldDrawPath() {
        const c = document.getElementById('wePathCanvas');
        if (!c) return;
        const rect = c.getBoundingClientRect();
        c.width = Math.max(1, Math.round(rect.width));
        c.height = Math.max(1, Math.round(rect.height));
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        const keys = (WORLD.path && WORLD.path.length ? WORLD.path : WORLD.keys) || [];
        if (keys.length < 2) return;

        const xs = keys.map(k => k.position[0]), zs = keys.map(k => k.position[2]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minZ = Math.min(...zs), maxZ = Math.max(...zs);
        const pad = 12;
        const sx = (v) => pad + (maxX - minX < 1e-6 ? 0.5 : (v - minX) / (maxX - minX)) * (c.width - pad * 2);
        const sy = (v) => pad + (maxZ - minZ < 1e-6 ? 0.5 : (v - minZ) / (maxZ - minZ)) * (c.height - pad * 2);

        ctx.strokeStyle = 'rgba(95,211,196,0.65)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        keys.forEach((k, i) => (i ? ctx.lineTo(sx(k.position[0]), sy(k.position[2]))
                                  : ctx.moveTo(sx(k.position[0]), sy(k.position[2]))));
        ctx.stroke();

        ctx.fillStyle = '#5fd3c4';
        for (const k of (WORLD.keys || [])) {
            ctx.beginPath();
            ctx.arc(sx(k.position[0]), sy(k.position[2]), 3.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /*
     * Writes the EXISTING columns. `moves_json` holds the legs and
     * `camera_keys_json` the authored poses — the same two the previs screen
     * and the video payload already read.
     */
    async function worldTimelineSave() {
        if (WORLD.scout) { previzWorkspace.changed(); return; }
        if (!WORLD.shotId) return;
        try {
            // The timeline route replaces the move and nothing else. The whole
            // /previs PUT rebuilt the blocking from defaults, so saving a key
            // put the camera back at its default and wiped the staged people.
            // refresh: false — the timeline repaints itself; a reload would drop an unsaved walk.
            const out = await api(`/shots/${WORLD.shotId}/previs/timeline`, {
                method: 'PUT',
                refresh: false,
                body: JSON.stringify({
                    moves: WORLD.moves || [],
                    cameraKeys: WORLD.keys || [],
                    durationMs: WORLD.durationMs || 4000,
                }),
            });
            if (out && out.blocking) {
                // A key added mid-walk must not snap the camera back to the saved one.
                const walked = WALK.on && WORLD.blocking && WORLD.blocking.blocking && WORLD.blocking.blocking.camera;
                WORLD.blocking = Object.assign({}, WORLD.blocking || {}, { blocking: out.blocking });
                if (walked) WORLD.blocking.blocking.camera = walked;
            }
        } catch (err) { setStatus(err.message); }
    }

    /*
     * RENDER GENERATION PLATE — the terminal action of this screen.
     *
     * The pixels are drawn HERE, from the camera pane, because that canvas is
     * already the projection of this shot: same lens, same sensor, same
     * blocking. Rendering server-side would be a second renderer that could
     * disagree with the one the director has been looking at.
     *
     * Deliberately WITHOUT the composition overlays. Thirds and horizon lines
     * are for a person reading the frame; baked into a plate they become marks
     * an image model faithfully reproduces.
     */
    async function worldRenderPlate() {
        const src = document.getElementById('weFrameCanvas');
        if (!src || !WORLD.shotId) return setStatus('Open a shot first');
        try {
            // Re-paint without the overlays, then restore what the director had.
            // Thirds and a horizon line baked into a plate are composition
            // guides an image model would faithfully reproduce IN the frame.
            const showing = WORLD.overlays;
            WORLD.overlays = Object.fromEntries(worldOverlays().map(o => [o.id, false]));
            worldPaintFrame();
            const png = src.toDataURL('image/png');

            /*
             * The depth pass, from the SAME camera in the same breath.
             * `PLATE_OUTPUTS` has declared depth since the bridge shipped and
             * nothing rendered it, so the export named a file that could not
             * exist. Painted into an offscreen canvas so the pane the director
             * is looking at never flashes grey.
             */
            let depth = null;
            try {
                /*
                 * Painted into the SAME canvas, not an offscreen one.
                 *
                 * The view rect comes from `canvas.parentElement`, so a
                 * detached canvas has no rect and the pass threw — silently,
                 * into a catch, which is exactly how the export went on
                 * reporting a depth file that was never produced. Using this
                 * canvas also makes it structurally impossible for the depth
                 * to be a different camera or a different crop from the plate
                 * it accompanies. `toDataURL` is synchronous, so the grey pass
                 * never reaches the screen.
                 */
                const dctx = src.getContext('2d');
                dctx.clearRect(0, 0, src.width, src.height);
                worldPaintGeometry(dctx, src, 'depth');
                depth = src.toDataURL('image/png');
            } catch (_) { depth = null; }

            WORLD.overlays = showing;
            worldPaintFrame();

            const res = await api(`/shots/${WORLD.shotId}/generation-plate`, {
                method: 'POST',
                body: JSON.stringify({ image: png, depth, move: WORLD.moveForPlate || {} }),
            });
            const kb = (res.outputs || [res.stored]).map(o =>
                `${o.kind === 'plate_depth' ? 'depth' : 'plate'} ${Math.round(o.bytes / 1024)} KB`).join(', ');
            setStatus(`Stored — ${kb}. `
                + 'It now leads this shot\'s references on every generation path.');
            worldConsoleRender();
        } catch (err) { setStatus(err.message); }
    }

    function worldToggleOverlayMenu() {
        const el = document.getElementById('weOverlayMenu');
        if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    function worldSetLens(mm) {
        // Scouting: the lens is part of the view being chosen, kept with the shot.
        if (WORLD.scout) { worldOperateLens(mm); return worldConsoleRender(); }
        if (WORLD.shotId && WORLD.blocking && WORLD.blocking.blocking) {
            worldOperateLens(mm);
            return worldWalkKeep();
        }
        const next = worldApplyLens(
            { focalMm: WORLD.lens, distanceM: WORLD.distanceM || 10,
              occupancy: WORLD.occupancy || 0.3, pinned: WORLD.pinned, mode: WORLD.mode }, mm);
        WORLD.lens = next.focalMm;
        WORLD.distanceM = next.distanceM;
        WORLD.occupancy = next.occupancy;
        WORLD.pinned = next.pinned;
        worldPaintFrame();
        worldConsoleRender();
    }

    function worldSetMode(mode) {
        WORLD.mode = mode;
        // Engaging maintain-size PINS whatever the subject fills right now.
        WORLD.pinned = mode === 'maintain' ? (WORLD.occupancy || 0.3) : null;
        worldConsoleRender();
    }

    /*
     * The world, seen from this shot's camera. Grey-box on purpose.
     *
     * What a director judges here is where things stand and how the frame
     * reads — the same reason lib/glb-parser strips materials. It reuses
     * `previsProject` rather than deriving a second projection: two projections
     * is how the camera pane and the stage come to disagree about where the
     * subject is, which this codebase has already paid for with a mirrored yaw.
     */
    function worldPaintGeometry(ctx, canvas, mode) {
        const geo = WORLD.geometry;
        if (!geo || !Array.isArray(geo.vertices) || !Array.isArray(geo.triangles)) return;

        // The shot's own camera when previs has one; otherwise a standing eye
        // at the centre of the world looking down its long axis, so an
        // unblocked shot shows the room rather than nothing.
        /*
         * An unblocked shot carries `camera: {}` — TRUTHY, so a plain `||`
         * picked the empty object, the painter found no position and returned
         * in silence. A camera is only a camera when it has somewhere to be.
         */
        const preview = worldPreviewCamera();
        const staged = preview || (WORLD.blocking && WORLD.blocking.blocking && WORLD.blocking.blocking.camera) || null;
        /*
         * ONE SPACE, AND IT IS THE MESH'S.
         *
         * `/geometry` applies the scale on read, so these vertices are METRES
         * on a calibrated world — while a saved camera is stored in the
         * reconstruction's own units, which is what `validateCamera` compares
         * against the raw bounds. Projecting one against the other puts the
         * camera 1.75x too close on this diner and looks like a framing bug.
         * `scaleTriple` is a pure multiply, so the camera crosses into the
         * mesh's space the same way the vertices did.
         */
        const f = Number(WORLD.version && WORLD.version.scale_factor);
        const toMesh = (pt) => ((Number.isFinite(f) && f > 0 && Array.isArray(pt))
            ? pt.map(n => n * f) : pt);
        const cam = (staged && Array.isArray(staged.position))
            ? Object.assign({}, staged, { position: toMesh(staged.position) })
            : worldDefaultCamera(geo);
        if (!cam || !Array.isArray(cam.position)) return;

        const fov = worldFovFor((preview && preview.focalMm) || WORLD.lens || cam.focalMm || 35);
        const view = previsFrameView ? previsFrameView(canvas) : previsFullView(canvas);
        const eye = cam.position;
        /*
         * A staged camera has a rotation and that is what it is pointed at. The
         * DEFAULT camera carries an explicit target instead: aiming it down an
         * axis put the eye flat against the end wall, which renders a grey
         * slab rather than a room.
         */
        const target = Array.isArray(cam.target)
            ? cam.target
            : previsAim({ position: eye, rotation: cam.rotation || [0, 0, 0] });

        /*
         * SOLID, DEPTH-SORTED — not a wireframe.
         *
         * A wireframe of 20,000 triangles is line noise: every far surface
         * shows through every near one, so neither a director nor an image
         * model can tell which wall is in front. Filling them back-to-front
         * gives the painter's algorithm's occlusion for free, and shading by
         * distance is what makes the room read as a room. This is exactly the
         * grey-box the plate promises — geometry, no materials.
         */
        const faces = [];
        for (const tri of geo.triangles) {
            const a = geo.vertices[tri[0]], b = geo.vertices[tri[1]], d = geo.vertices[tri[2]];
            if (!a || !b || !d) continue;
            const pa = previsProject(a, eye, target, fov.vDeg, view);
            const pb = previsProject(b, eye, target, fov.vDeg, view);
            const pd = previsProject(d, eye, target, fov.vDeg, view);
            // A triangle with a vertex behind the lens is DROPPED rather than
            // clipped: a partial polygon painter draws a wrong edge, and at
            // this density the silhouette survives the loss.
            if (!pa || !pb || !pd) continue;
            /*
             * A triangle smaller than a pixel paints nothing and still costs a
             * fill. On a 111k-face mesh most of them are exactly that, and
             * dropping them took the repaint from ~980 ms to something a lens
             * tap can wait for. Twice the area, because this is the cross
             * product, not the area itself.
             */
            const area2 = Math.abs((pb.x - pa.x) * (pd.y - pa.y) - (pd.x - pa.x) * (pb.y - pa.y));
            if (area2 < 1) continue;
            faces.push({ pa, pb, pd, z: (pa.z + pb.z + pd.z) / 3 });
        }
        // Far first, so near surfaces paint over what they hide.
        faces.sort((f1, f2) => f2.z - f1.z);

        const near = faces.length ? faces[faces.length - 1].z : 1;
        const far = faces.length ? faces[0].z : 2;
        const span = Math.max(1e-6, far - near);

        ctx.save();
        ctx.beginPath();
        ctx.rect(view.x, view.y, view.w, view.h);
        ctx.clip();
        for (const f of faces) {
            // Near is bright, far falls away — the only depth cue an untextured
            // solid has, and what stops the room reading as one flat mass.
            const t = 1 - Math.min(1, Math.max(0, (f.z - near) / span));
            /*
             * DEPTH IS THE SAME RENDER READ AS DISTANCE.
             *
             * A separate depth renderer is how the two come to describe
             * different cameras — it is one pass with the value taken from z
             * instead of from a shading ramp. Neutral grey across the whole
             * range, because a depth map with a colour cast is one a compositor
             * has to correct before using.
             */
            const v = mode === 'depth'
                ? Math.round(t * 255)
                : Math.round(34 + t * 150);
            ctx.fillStyle = mode === 'depth'
                ? `rgb(${v},${v},${v})`
                : `rgb(${v},${v + 6},${v + 12})`;
            ctx.beginPath();
            ctx.moveTo(f.pa.x, f.pa.y); ctx.lineTo(f.pb.x, f.pb.y); ctx.lineTo(f.pd.x, f.pd.y);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    /** A standing eye in the middle of the world, looking down its long axis. */
    /*
     * WHERE A SCOUT STANDS. A scanned location is not one box: The Lodgers'
     * office came back as 26 walls, and the middle of its bounding box was a
     * pocket 40 cm from a wall, so walking it opened on one flat slab. The
     * collider is sliced at eye height and at desk height; a spot counts only
     * if a ray from it hits a wall in every direction (inside, not out in the
     * empty corner of an L), the most open such spot is chosen, and the camera
     * faces the longest clear view. Null when the geometry says nothing.
     */
    function scoutStartCamera(geo) {
        const b = geo && geo.bounds;
        const V = geo && geo.vertices, Tr = geo && geo.triangles;
        if (!b || !Array.isArray(V) || !Array.isArray(Tr) || !Tr.length) return null;
        const floor = b.min[1];
        const eye = floor + 1.6, desk = floor + 0.9;
        const slice = h => {
            const segs = [];
            for (const t of Tr) {
                const p = t.map(i => V[i]);
                if (p.some(q => !q)) continue;
                const pts = [];
                for (let e = 0; e < 3; e++) {
                    const a = p[e], c = p[(e + 1) % 3];
                    if ((a[1] - h) * (c[1] - h) < 0) {
                        const u = (h - a[1]) / (c[1] - a[1]);
                        pts.push([a[0] + u * (c[0] - a[0]), a[2] + u * (c[2] - a[2])]);
                    }
                }
                if (pts.length === 2) segs.push(pts);
            }
            return segs;
        };
        const eyeSegs = slice(eye), all = eyeSegs.concat(slice(desk));
        if (!eyeSegs.length) return null;
        const segDist = (x, z, s) => {
            const [a, c] = s, dx = c[0] - a[0], dz = c[1] - a[1];
            const L = dx * dx + dz * dz || 1e-9;
            const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L));
            return Math.hypot(x - a[0] - u * dx, z - a[1] - u * dz);
        };
        const ray = (x, z, dx, dz, segs) => {
            let best = Infinity;
            for (const [a, c] of segs) {
                const ex = c[0] - a[0], ez = c[1] - a[1];
                const den = dx * ez - dz * ex;
                if (Math.abs(den) < 1e-9) continue;
                const t = ((a[0] - x) * ez - (a[1] - z) * ex) / den;
                const u = ((a[0] - x) * dz - (a[1] - z) * dx) / den;
                if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
            }
            return best;
        };
        const dirs = n => Array.from({ length: n }, (_, i) => [Math.sin(i * 2 * Math.PI / n), Math.cos(i * 2 * Math.PI / n)]);
        const eight = dirs(8);
        const step = Math.max(0.2, Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 30);
        let pick = null;
        for (let x = b.min[0] + step / 2; x < b.max[0]; x += step) {
            for (let z = b.min[2] + step / 2; z < b.max[2]; z += step) {
                if (!eight.every(([dx, dz]) => Number.isFinite(ray(x, z, dx, dz, eyeSegs)))) continue;
                let clear = Infinity;
                for (const sg of all) { clear = Math.min(clear, segDist(x, z, sg)); if (clear < (pick ? pick.clear : 0)) break; }
                if (!pick || clear > pick.clear) pick = { x, z, clear };
            }
        }
        if (!pick) return null;
        let view = null;
        for (const [dx, dz] of dirs(48)) {
            const d = ray(pick.x, pick.z, dx, dz, eyeSegs);
            if (Number.isFinite(d) && (!view || d > view.d)) view = { dx, dz, d };
        }
        if (!view) return null;
        const yaw = Math.atan2(-view.dx, -view.dz) * 180 / Math.PI;
        return { position: [pick.x, eye, pick.z], rotation: [yaw, -4, 0], clear: pick.clear, view: view.d };
    }

    function worldDefaultCamera(geo) {
        const b = geo && geo.bounds;
        if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) return null;
        const mid = (i) => (b.min[i] + b.max[i]) / 2;
        const spanX = b.max[0] - b.min[0], spanZ = b.max[2] - b.min[2];
        /*
         * `/geometry` applies the scale on READ, so these bounds are already
         * metres on a calibrated world — dividing by the factor again would
         * put the eye at 0.9 m in a 3 m room. On an uncalibrated one there are
         * no metres, so the height is taken as a fraction of the room instead
         * of a number pretending to be a measurement.
         */
        const calibrated = String(geo.scale_state || '') === 'SCALE CALIBRATED';
        const eyeUp = calibrated ? 1.6 : (b.max[1] - b.min[1]) * 0.55;
        const eyeY = b.min[1] + eyeUp;
        /*
         * Stood INSIDE the room, a tenth of its length off the end wall, and
         * aimed at the middle. On the end wall itself the near plane is buried
         * in geometry and the frame is one flat slab.
         */
        const inset = 0.1;
        const pos = spanZ >= spanX
            ? [mid(0), eyeY, b.max[2] - spanZ * inset]
            : [b.max[0] - spanX * inset, eyeY, mid(2)];
        return { position: pos, target: [mid(0), eyeY, mid(2)] };
    }

    function worldPaintFrame() {
        const c = document.getElementById('weFrameCanvas');
        if (!c) return;
        const box = c.parentElement.getBoundingClientRect();
        const width = Math.max(1, Math.round(box.width)), height = Math.max(1, Math.round(box.height));
        if (c.width !== width) c.width = width;
        if (c.height !== height) c.height = height;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        const viewMode = worldViewMode();
        c.style.pointerEvents = viewMode === 'plan' ? 'auto' : '';
        stageBindPlan();
        if (viewMode === 'plan') { worldPaintPlan(ctx, c); planFloorPickerSync(); worldSplatSync(); stageRenderBar(); return; }
        const bar = document.getElementById('pvStageBar');
        if (bar && bar.innerHTML) bar.innerHTML = '';
        if (viewMode === 'geo' || viewMode === 'depth') worldPaintGeometry(ctx, c, viewMode === 'depth' ? 'depth' : undefined);
        worldSplatSync();
        const st = WORLD.overlays || {};
        const on = (id) => (st[id] === undefined
            ? (worldOverlays().find(o => o.id === id) || {}).on : st[id]);
        ctx.save();
        if (on('thirds')) {
            ctx.strokeStyle = 'rgba(255,255,255,0.11)'; ctx.lineWidth = 1;
            for (const f of [1 / 3, 2 / 3]) {
                ctx.beginPath(); ctx.moveTo(c.width * f, 0); ctx.lineTo(c.width * f, c.height); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, c.height * f); ctx.lineTo(c.width, c.height * f); ctx.stroke();
            }
        }
        if (on('horizon')) {
            ctx.strokeStyle = 'rgba(224,172,82,0.6)';
            ctx.beginPath(); ctx.moveTo(0, c.height * 0.46); ctx.lineTo(c.width, c.height * 0.46); ctx.stroke();
        }
        if (on('center')) {
            ctx.strokeStyle = 'rgba(255,255,255,0.28)';
            ctx.beginPath(); ctx.arc(c.width / 2, c.height / 2, 13, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
        const n = worldOverlays().filter(o => on(o.id)).length;
        const badge = document.getElementById('weOvCount');
        if (badge) badge.textContent = String(n);
    }

    /*
     * A location's set, built in Blender from its own plates (lib/set-build.js).
     *
     * The page cannot write the layout: reading a photograph of a room and
     * saying where the counter is is judgement, and the connected agent is the
     * model here. So this modal says exactly what to ask, shows every attempt
     * the agent has rendered with its comparison sheets, and finishes one:
     * projecting, exporting and importing are mechanical and free, so a person
     * can press that button as well as an agent can.
     */
    const SETBUILD = { locationId: null };

    async function setBuildOpen(locationId) {
        let locs = [];
        try { locs = (await api(`/projects/${state.currentProject.id}/locations`)).locations || []; } catch (_) { locs = []; }
        const pick = locationId || SETBUILD.locationId || (WORLD.world && WORLD.world.location_id) || (locs[0] && locs[0].id);
        SETBUILD.locationId = pick;
        const loc = locs.find(l => l.id === pick);
        let brief = null, builds = [];
        if (pick) {
            try { brief = await api(`/locations/${pick}/set-build/brief`); } catch (_) { brief = null; }
            try { builds = (await api(`/locations/${pick}/set-builds`)).builds || []; } catch (_) { builds = []; }
        }
        showModalHtml('setBuildModal', setBuildHtml(locs, loc, brief, builds));
        showModal('setBuildModal');
    }

    function setBuildHtml(locs, loc, brief, builds) {
        const opts = locs.map(l => `<option value="${esc(l.id)}"${loc && l.id === loc.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
        const plates = brief ? brief.plates : [];
        const blender = brief ? brief.blender : null;
        const ask = loc ? `Build the set for "${loc.name}" from its plates (set_build_brief, then set_build_render).` : '';
        const attempts = builds.map(b => `
            <div class="sb-attempt">
              <div class="sb-head"><b>Attempt ${b.attempt}</b> <span class="pv-chip">${esc(b.status)}</span>
                ${b.note ? `<span class="text-sm text-muted">${esc(b.note)}</span>` : ''}
                <span style="flex:1"></span>
                ${b.status === 'rendered' ? `<button class="btn btn-primary btn-sm" onclick="setBuildFinish('${b.id}', this)">Finish → world + 3D asset</button>` : ''}
                ${b.status === 'finished' ? '<span class="text-sm">In the world, and kept as a 3D model</span>' : ''}
              </div>
              ${b.error ? `<p class="text-sm" style="color:var(--danger,#e66)">${esc(b.error)}</p>` : ''}
              <div class="sb-sheets">${b.sheets.map(sh => `<figure><img src="${legacy.API_BASE}${sh.url}" alt="${esc(sh.view)}" loading="lazy"
                    onclick="openPlateViewer(this.src, ${jsAttr('Attempt ' + b.attempt + ' · ' + sh.view)})"><figcaption>${esc(sh.view)}: plate | render, blended below</figcaption></figure>`).join('')}</div>
            </div>`).join('');
        return `
            <h3>Build the set in Blender</h3>
            <p class="text-sm text-muted">Free: Blender runs on this Mac. Claude reads the plates and writes the room;
               the engine builds it, renders it from each plate's camera beside the plate, and, when you finish an
               attempt, paints the plates onto it and makes it this location's world and a 3D model.</p>
            <div class="form-group"><label>Location</label>
              <select onchange="setBuildOpen(this.value)">${opts}</select></div>
            <p class="text-sm">${plates.length} plate${plates.length === 1 ? '' : 's'}${plates.length ? ': ' + plates.map(p => esc(p.view)).join(', ') : ' (generate or upload one first)'}
               · Blender ${blender && blender.available ? esc(blender.version) : `<b>not found</b> (${esc((blender && blender.reason) || '')})`}</p>
            ${ask ? `<div class="form-group"><label>Ask Claude</label>
              <div class="sb-ask"><code>${esc(ask)}</code>
              <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard && navigator.clipboard.writeText(${jsAttr(ask)}); setStatus('Copied')">Copy</button></div></div>` : ''}
            ${loc ? roomScanHtml(loc) : ''}
            <div class="sb-attempts">${attempts || '<p class="text-sm text-muted">No attempts yet.</p>'}</div>
            <div class="btn-row"><button class="btn btn-secondary" onclick="setBuildOpen()">Refresh</button>
              <button class="btn btn-secondary" onclick="closeModal('setBuildModal')">Close</button></div>`;
    }

    /*
     * OR SCAN IT. On the Film Engine iPhone app (a Pro, with LiDAR) the phone
     * scans the room — several rooms and floors in one session — and the
     * engine builds it here, measured, with no plates needed. Anywhere else, a
     * RoomPlan JSON exported by another app can be imported the same way.
     */
    function roomScanHtml(loc) {
        const bridge = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.roomScan);
        const can = bridge && window.__filmEngineRoomScan !== false;
        const why = bridge && !can ? (window.__filmEngineRoomScanWhyNot || 'This phone cannot scan.') : '';
        return `
            <div class="form-group"><label>Or scan it with an iPhone (LiDAR)</label>
              <p class="text-sm text-muted">Measured, not guessed: walls, doors, windows, floors, stairs and furniture at their
                 real size. Scan room after room in one session — walk between them and up the stairs — and they keep their
                 places, storeys included. Then the app guides you through a photo of every wall, each kept with where the phone
                 stood, so the photos line up with the scan and become this location's plates. It works offline: send it
                 here later. Furniture becomes Previs library models; Claude then adds every object the photos show. Free.</p>
              <div class="btn-row" style="justify-content:flex-start">
                ${bridge
                    ? `<button class="btn btn-primary btn-sm" ${can ? '' : 'disabled'} onclick="roomScanStart(${jsAttr(loc.id)}, ${jsAttr(loc.name)})">Scan with this iPhone</button>
                       ${why ? `<span class="text-sm text-muted">${esc(why)}</span>` : ''}`
                    : `<span class="text-sm text-muted">In the Film Engine app on an iPhone Pro: Scan a location, then Send it to this location. Or import a RoomPlan JSON:</span>`}
                <label class="btn btn-secondary btn-sm">Import RoomPlan JSON
                  <input type="file" accept="application/json,.json" style="display:none" onchange="roomScanImport(${jsAttr(loc.id)}, this)"></label>
              </div></div>`;
    }

    function roomScanStart(locationId, name) {
        try {
            window.webkit.messageHandlers.roomScan.postMessage(JSON.stringify({
                url: `/locations/${locationId}/room-scan/import`, apiBase: '', location: name || '' }));
        } catch (err) { setStatus('The scanner is not available: ' + err.message); }
    }

    async function roomScanImport(locationId, input) {
        const file = input.files && input.files[0];
        if (!file) return;
        try { checkUploadSize(file, `/locations/${locationId}/room-scan/import`); }
        catch (err) { input.value = ''; return setStatus(err.message); }
        let structure;
        try { structure = JSON.parse(await file.text()); } catch (_) { return setStatus('That file is not JSON'); }
        setStatus('Building the scan in Blender…');
        try {
            const r = await api(`/locations/${locationId}/room-scan/import`, { method: 'POST',
                body: JSON.stringify({ structure, name: file.name }) });
            window.roomScanDone(JSON.stringify({ ok: true, rooms: 1, response: JSON.stringify(r) }));
        } catch (err) { setStatus('Scan not built: ' + err.message); }
        input.value = '';
    }

    async function setBuildFinish(buildId, btn) {
        if (btn) { btn.disabled = true; btn.textContent = 'Painting the plates on and exporting…'; }
        try {
            const r = await api(`/set-builds/${buildId}/finish`, { method: 'POST' });
            setStatus(`Set finished: ${r.world.name} v${r.version.version}, and kept as a 3D model. Pin a shot to it to walk it.`);
            await setBuildOpen();
        } catch (err) {
            setStatus(err.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Finish → world + 3D asset'; }
        }
    }

    function worldOpenCreate() {
        showModalHtml('worldCreateModal', `
            <h3>Create spatial world</h3>
            <p class="text-sm text-muted">A world is a persistent set many shots are framed inside.
               Creating it is free; generating it is not.</p>
            <div class="form-group"><label>Name</label>
                <input id="worldCreateName" type="text" placeholder="e.g. the cul-de-sac"></div>
            <div class="btn-row">
              <button class="btn btn-primary" onclick="worldCreate()">Create</button>
              <button class="btn btn-secondary" onclick="closeModal('worldCreateModal')">Cancel</button>
            </div>`);
        showModal('worldCreateModal');
    }

    /*
     * Generation risk, before the money rather than after it.
     *
     * Three of the seven inputs are derived and four are readings the engine
     * cannot make — so those are OFFERED as fields rather than silently scored
     * as zero. A grade computed from four undeclared zeroes and presented as a
     * measurement is the "confident number on a guess" this whole phase is
     * written against.
     */
    async function worldScoreComplexity() {
        if (!WORLD.shotId) return setStatus('Open a shot first');
        try {
            const r = await api(`/shots/${WORLD.shotId}/complexity`);
            WORLD.risk = r;
            worldPaintRisk(r);
        } catch (err) { setStatus(err.message); }
    }

    function worldPaintRisk(r) {
        const grade = document.getElementById('weRiskGrade');
        if (grade) {
            grade.textContent = `${r.grade} · ${r.score}`;
            grade.style.color = r.grade === 'HIGH' ? '#e06a52'
                : r.grade === 'MEDIUM' ? '#e0ac52' : '#5fd6c4';
        }
        const host = document.getElementById('weRisk');
        if (!host) return;
        const rows = r.inputs.map(l => {
            const ask = /^ask/.test(r.derived_from[l.id] || '');
            return `<div class="we-row">
                <span>${esc(l.label)}${ask ? ' <span style="opacity:.5;">· you</span>' : ''}</span>
                <input type="number" step="${l.id === 'occlusion' ? '0.1' : '1'}" min="0"
                       value="${l.value}" data-risk="${esc(l.id)}"
                       onchange="worldRescore()" style="width:64px;">
                <span style="opacity:.55;">+${l.points}</span>
              </div>`;
        }).join('');
        host.innerHTML = rows
            + (r.suggestion
                ? `<p class="text-sm" style="margin:8px 0 0;color:#e06a52;">${esc(r.suggestion.text)}</p>`
                : '<p class="text-sm text-muted" style="margin:8px 0 0;">No split suggested at this grade.</p>')
            + `<p class="text-sm text-muted" style="margin:6px 0 0;">Marked <em>· you</em> are readings the
                 engine cannot make from a scene card — they start at zero and are yours to set.</p>`;
    }

    async function worldRescore() {
        const inputs = {};
        for (const el of document.querySelectorAll('[data-risk]')) {
            inputs[el.dataset.risk] = Number(el.value) || 0;
        }
        try {
            const r = await api(`/shots/${WORLD.shotId}/complexity`, {
                method: 'POST', body: JSON.stringify({ inputs }),
            });
            // The derivation sources come back with every response, so the
            // "· you" marks survive a rescore rather than vanishing after the
            // first edit.
            WORLD.risk = r;
            worldPaintRisk(r);
        } catch (err) { setStatus(err.message); }
    }

    /*
     * What could be handed over, and what is missing from it.
     *
     * The manifest rather than the bytes: whether each of the seven outputs
     * exists is the question worth answering before packaging a 25 MB splat,
     * and an output that does not exist yet is named with its reason.
     */
    async function worldCheckExport() {
        if (!WORLD.shotId) return setStatus('Open a shot first');
        try {
            const x = await api(`/shots/${WORLD.shotId}/world-export`);
            const state = document.getElementById('weExportState');
            if (state) {
                const ready = x.outputs.filter(o => o.available).length;
                state.textContent = `${ready} of ${x.outputs.length}`;
                state.style.color = x.complete ? '#5fd6c4' : '#e0ac52';
            }
            const host = document.getElementById('weExport');
            if (host) {
                host.innerHTML = x.outputs.map(o => `
                    <div class="we-row" title="${esc(o.why)}">
                      <span style="${o.available ? '' : 'opacity:.55;'}">${esc(o.filename)}</span>
                      <span style="opacity:.6;">${esc(o.kind)}</span>
                      <span style="color:${o.available ? '#5fd6c4' : '#e0ac52'};">${o.available ? 'ready' : 'missing'}</span>
                    </div>`).join('')
                  + (x.complete ? ''
                     : `<p class="text-sm text-muted" style="margin:8px 0 0;">`
                       + x.outputs.filter(o => !o.available)
                           .map(o => `${esc(o.filename)} — ${esc(o.reason)}`).join('<br>')
                       + `</p>`)
                  + `<p class="text-sm text-muted" style="margin:6px 0 0;">Every file names world
                       <strong>${esc(x.provenance.world_name || '—')}</strong> v${esc(String(x.provenance.world_version))}
                       · ${esc(x.provenance.scale_state)}.</p>`;
            }
        } catch (err) { setStatus(err.message); }
    }

    /*
     * Match Reference Composition — V1, manual assist.
     *
     * The director loads the frame they want and MARKS it: two points on the
     * horizon, a box round the subject. Nothing is detected — spec §30 puts
     * detection in V2 and solving against the reconstruction in V3 — so the
     * surface asks for exactly the marks the solver takes, and shows what each
     * one buys, because a mark whose value is invisible does not get made.
     */
    const WMATCH = { tool: 'horizon', img: null, horizon: null, box: null, drag: null, solved: null };

    function worldOpenMatchReference() {
        WMATCH.horizon = null; WMATCH.box = null; WMATCH.solved = null; WMATCH.tool = 'horizon';
        showModalHtml('worldMatchModal', `
            <h3>Match reference composition</h3>
            <p class="text-sm text-muted">Load the frame you want and mark it. This is a
               <strong>manual-assist</strong> solve — nothing is detected for you — and it is an
               approximation of the camera, not a reconstruction of it. Everything it cannot
               work out from your marks is named rather than guessed.</p>

            <div class="btn-row" style="margin-bottom:8px;">
              <input type="file" id="wmFile" accept="image/*" onchange="wmLoadImage(this)"
                     style="max-width:230px;">
              <button class="btn btn-secondary" id="wmToolHorizon" onclick="wmSetTool('horizon')">Horizon</button>
              <button class="btn btn-secondary" id="wmToolBox" onclick="wmSetTool('box')">Subject box</button>
              <button class="btn btn-secondary" onclick="wmClearMarks()">Clear marks</button>
            </div>
            <p class="text-sm text-muted" id="wmHint" style="margin:0 0 6px;"></p>

            <div style="position:relative;background:#111;border:1px solid var(--border);
                        min-height:200px;display:flex;align-items:center;justify-content:center;">
              <canvas id="wmCanvas" width="720" height="405"
                      style="max-width:100%;cursor:crosshair;"></canvas>
            </div>

            <div class="btn-row" style="margin-top:10px;align-items:center;">
              <label class="text-sm">Subject height
                <input type="number" id="wmHeight" step="0.01" min="0" placeholder="1.75"
                       style="width:90px;"> m</label>
              <label class="text-sm">Lens (if known)
                <input type="number" id="wmFocal" step="1" min="0" placeholder="—"
                       style="width:80px;"> mm</label>
            </div>

            <div class="btn-row" style="margin-top:10px;">
              <button class="btn btn-primary" onclick="wmSolve()">Solve — free</button>
              <button class="btn btn-secondary" id="wmApplyBtn" disabled onclick="wmApply()">Apply to camera</button>
              <button class="btn btn-secondary" onclick="closeModal('worldMatchModal')">Close</button>
            </div>

            <div id="wmReport" style="margin-top:10px;"></div>`);
        showModal('worldMatchModal');
        wmSetTool('horizon');
        wmBindCanvas();
        wmPaint();
    }

    function wmSetTool(t) {
        WMATCH.tool = t;
        for (const [id, name] of [['wmToolHorizon', 'horizon'], ['wmToolBox', 'box']]) {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('btn-primary', name === t);
        }
        const hint = document.getElementById('wmHint');
        if (hint) {
            hint.textContent = t === 'horizon'
                ? 'Drag along the horizon — or along anything you know is level. This alone gives the camera roll exactly.'
                : 'Drag a box round the subject. With their real height it also gives the camera height, because the horizon crosses a standing figure at eye level.';
        }
    }

    function wmLoadImage(input) {
        const file = input && input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => { WMATCH.img = img; wmPaint(); };
            // A reference that will not decode says so rather than leaving an
            // empty canvas that looks like the tool is broken.
            img.onerror = () => setStatus('That file could not be read as an image');
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }

    function wmClearMarks() {
        WMATCH.horizon = null; WMATCH.box = null; WMATCH.solved = null;
        const btn = document.getElementById('wmApplyBtn');
        if (btn) btn.disabled = true;
        const rep = document.getElementById('wmReport');
        if (rep) rep.innerHTML = '';
        wmPaint();
    }

    function wmBindCanvas() {
        const c = document.getElementById('wmCanvas');
        if (!c || c.dataset.bound === '1') return;
        c.dataset.bound = '1';
        // Normalised against the canvas's own rect, so a mark lands where it
        // was drawn whatever size the modal is showing the image at.
        const at = (e) => {
            const r = c.getBoundingClientRect();
            return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
                    Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
        };
        c.addEventListener('mousedown', (e) => { WMATCH.drag = { from: at(e), to: at(e) }; wmPaint(); });
        c.addEventListener('mousemove', (e) => { if (WMATCH.drag) { WMATCH.drag.to = at(e); wmPaint(); } });
        const finish = (e) => {
            if (!WMATCH.drag) return;
            const from = WMATCH.drag.from, to = at(e);
            WMATCH.drag = null;
            // A click rather than a drag is not a mark — it would be a
            // zero-length horizon, which has no angle at all.
            if (Math.abs(to[0] - from[0]) < 0.01 && Math.abs(to[1] - from[1]) < 0.01) return wmPaint();
            if (WMATCH.tool === 'horizon') WMATCH.horizon = { a: from, b: to };
            else WMATCH.box = { x: Math.min(from[0], to[0]), y: Math.min(from[1], to[1]),
                                w: Math.abs(to[0] - from[0]), h: Math.abs(to[1] - from[1]) };
            wmPaint();
        };
        c.addEventListener('mouseup', finish);
        c.addEventListener('mouseleave', () => { if (WMATCH.drag) { WMATCH.drag = null; wmPaint(); } });
    }

    function wmPaint() {
        const c = document.getElementById('wmCanvas');
        if (!c) return;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        if (WMATCH.img) {
            ctx.drawImage(WMATCH.img, 0, 0, c.width, c.height);
        } else {
            ctx.fillStyle = '#161616'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
            ctx.fillText('Load the frame you want to match', c.width / 2, c.height / 2);
        }
        const X = (n) => n * c.width, Y = (n) => n * c.height;

        if (WMATCH.horizon) {
            ctx.strokeStyle = '#e0ac52'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(X(WMATCH.horizon.a[0]), Y(WMATCH.horizon.a[1]));
            ctx.lineTo(X(WMATCH.horizon.b[0]), Y(WMATCH.horizon.b[1])); ctx.stroke();
        }
        if (WMATCH.box) {
            ctx.strokeStyle = '#5fd6c4'; ctx.lineWidth = 2;
            ctx.strokeRect(X(WMATCH.box.x), Y(WMATCH.box.y), X(WMATCH.box.w), Y(WMATCH.box.h));
        }
        if (WMATCH.drag) {
            ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
            const f = WMATCH.drag.from, t = WMATCH.drag.to;
            if (WMATCH.tool === 'horizon') {
                ctx.beginPath(); ctx.moveTo(X(f[0]), Y(f[1])); ctx.lineTo(X(t[0]), Y(t[1])); ctx.stroke();
            } else {
                ctx.strokeRect(X(Math.min(f[0], t[0])), Y(Math.min(f[1], t[1])),
                               X(Math.abs(t[0] - f[0])), Y(Math.abs(t[1] - f[1])));
            }
            ctx.setLineDash([]);
        }
    }

    function wmMarks() {
        const marks = {};
        if (WMATCH.horizon) marks.horizon = WMATCH.horizon;
        if (WMATCH.box) marks.subject_box = WMATCH.box;
        const h = Number((document.getElementById('wmHeight') || {}).value);
        if (h > 0) marks.subject_height_m = h;
        const f = Number((document.getElementById('wmFocal') || {}).value);
        if (f > 0) marks.focal_mm = f;
        return marks;
    }

    async function wmSolve() {
        if (!WORLD.shotId) return setStatus('Open a shot first');
        const btn = document.getElementById('wmApplyBtn');
        // Disarmed BEFORE the request: a gate whose purpose is inspection
        // before applying must never stay armed across a failed inspection.
        if (btn) btn.disabled = true;
        try {
            const res = await api(`/shots/${WORLD.shotId}/match-reference`, {
                method: 'POST', body: JSON.stringify({ marks: wmMarks() }),
            });
            WMATCH.solved = res;
            document.getElementById('wmReport').innerHTML = wmReportHtml(res);
            if (btn) btn.disabled = !Object.keys(res.proposal.changes || {}).length;
        } catch (err) { setStatus(err.message); }
    }

    function wmReportHtml(res) {
        const m = res.match || {};
        const pct = Math.round((m.confidence || 0) * 100);
        const rows = Object.entries(m.estimates || {}).map(([id, e]) => {
            const label = id.replace(/_/g, ' ');
            if (e.value === null) {
                return `<tr><td style="opacity:.65;">${esc(label)}</td>
                        <td style="opacity:.5;">— needs ${esc((e.blocked_by || []).join(', '))}</td></tr>`;
            }
            const v = Array.isArray(e.value) ? e.value.map(n => n.toFixed(2)).join(', ')
                : typeof e.value === 'number'
                    ? (e.unit === 'fraction' ? Math.round(e.value * 100) + '%' : e.value.toFixed(2) + ' ' + (e.unit === 'class' ? '' : e.unit))
                    : String(e.value);
            return `<tr><td>${esc(label)}</td><td><strong>${esc(v)}</strong></td></tr>`;
        }).join('');
        return `
          <div style="border:1px solid var(--border);padding:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <strong>MATCH REFERENCE</strong>
              <span class="text-sm">Confidence <strong>${pct}%</strong></span>
            </div>
            <div style="height:4px;background:#222;margin-bottom:8px;">
              <div style="height:4px;width:${pct}%;background:${pct >= 60 ? '#5fd6c4' : '#e0ac52'};"></div>
            </div>
            <table class="text-sm" style="width:100%;">${rows}</table>
            <p class="text-sm text-muted" style="margin:8px 0 0;">${esc(m.note || '')}</p>
          </div>`;
    }

    async function wmApply() {
        if (!WORLD.shotId || !WMATCH.solved) return;
        const changes = (WMATCH.solved.proposal || {}).changes || {};
        const pct = Math.round(((WMATCH.solved.match || {}).confidence || 0) * 100);
        if (!confirm(`Apply this camera to the shot?\n\n`
            + Object.entries(changes).map(([k, v]) =>
                `  ${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`).join('\n')
            + `\n\nConfidence ${pct}%. This is an approximation, and it writes camera fields only — `
            + `the blocking, the subjects and the world are untouched.`)) return;
        try {
            const res = await api(`/shots/${WORLD.shotId}/match-reference`, {
                method: 'POST',
                body: JSON.stringify({ marks: wmMarks(), apply: true }),
            });
            setStatus(`Camera matched at ${pct}% confidence — an approximation, not a reconstruction.`);
            closeModal('worldMatchModal');
            // The console re-reads the shot, so the matched camera is what it shows.
            await worldRailSelect(WORLD.shotId);
        } catch (err) { setStatus(err.message); }
    }

    /*
     * Bind the console to the shot that is open.
     *
     * `WORLD.world` / `WORLD.version` were written by `worldCreate` and by
     * nothing else, and `WORLD.shotId` was READ in three places and assigned in
     * none — so the console rendered once, before any shot was selected, and
     * said "No world yet" for the rest of the session on a shot with a
     * calibrated world pinned to it. Render Generation Plate and the timeline
     * save answered "Open a shot first" for the same reason.
     *
     * A shot with no pin clears the pair rather than keeping the previous
     * shot's world, which would show one shot's geometry under another's name.
     */
    async function worldLoadForShot(shotId, selectionToken) {
        if (!worldEngineOn()) return;
        const selection = selectionToken == null
            ? (WORLD.selectionRevision = (WORLD.selectionRevision || 0) + 1) : selectionToken;
        worldMeshRelease();
        previzWorkspace.sourceGeneration++;
        previzWorkspace.source = null;
        WORLD.shotId = shotId || null;
        WORLD.world = null;
        WORLD.version = null;
        WORLD.geometry = null;
        WORLD.geometryFor = null;
        WORLD.pin = null;
        worldConsoleRender();
        if (!shotId) return;
        const current = () => selection === WORLD.selectionRevision && WORLD.shotId === shotId;
        try {
            const pin = await api(`/shots/${shotId}/world`);
            if (!current()) return;
            if (pin && pin.world_version_id) {
                const [w, vs, source] = await Promise.all([
                    api(`/worlds/${pin.world_id}`).catch(() => null),
                    api(`/worlds/${pin.world_id}/versions`).catch(() => null),
                    api(`/previz-workspace/world/${pin.world_version_id}`).catch(() => null),
                ]);
                if (!current()) return;
                WORLD.pin = pin;
                WORLD.world = (w && w.world) || { id: pin.world_id };
                WORLD.version = ((vs && vs.versions) || []).find(v => v.id === pin.world_version_id) || pin;
                WORLD.version.newer_version = pin.newer_version;
                WORLD.version.newer_version_id = pin.newer_version_id;
                previzWorkspace.source = source;
                WORLD.geometry = source?.geometry || null;
                WORLD.geometryFor = pin.world_version_id;
                if (['plan', 'geo', 'depth'].includes(worldViewMode())) await worldEnsureGeometry();
            }
        } catch (_) { /* A failed read leaves this shot empty, never on another shot's set. */ }
        if (current()) worldConsoleRender();
    }

    async function worldCreate() {
        const name = (document.getElementById('worldCreateName') || {}).value || '';
        if (!name.trim()) return setStatus('A world needs a name');
        try {
            const res = await api(`/projects/${state.currentProject.id}/worlds`,
                { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
            WORLD.world = res.world;
            closeModal('worldCreateModal');
            worldConsoleRender();
            setStatus(`World "${res.world.name}" created — generating it is a separate, paid step`);
        } catch (err) { setStatus(err.message); }
    }

    /*
     * Builds the console, or nothing at all. The container is created HERE
     * rather than sitting in the page, so with the flag off the previs screen
     * is exactly the screen it was.
     */
    function worldScrollKey(el, host) {
        if (el.id) return '#' + el.id;
        const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/)[0] : el.tagName;
        const same = [...host.querySelectorAll(el.tagName + (cls && cls !== el.tagName ? '.' + CSS.escape(cls) : ''))];
        return `${el.tagName}.${cls}:${same.indexOf(el)}`;
    }

    function worldScrollSnapshot(host) {
        const out = { inner: [], outer: [] };
        for (const el of host.querySelectorAll('*')) {
            if (el.scrollTop > 0 || el.scrollLeft > 0) out.inner.push([worldScrollKey(el, host), el.scrollTop, el.scrollLeft]);
        }
        // The page around the console scrolls too.
        for (let el = host.parentElement; el; el = el.parentElement) {
            if (el.scrollTop > 0) out.outer.push([el, el.scrollTop]);
        }
        out.win = window.scrollY || 0;
        return out;
    }

    function worldScrollRestore(host, snap) {
        if (!snap) return;
        for (const [key, top, left] of snap.inner) {
            let el = null;
            if (key.startsWith('#')) el = host.querySelector(key.replace(/^#(.*)$/, (m, id) => '#' + CSS.escape(id)));
            else {
                const [tagCls, idx] = key.split(':');
                const [tag, cls] = tagCls.split('.');
                const list = [...host.querySelectorAll(tag + (cls && cls !== tag ? '.' + CSS.escape(cls) : ''))];
                el = list[Number(idx)] || null;
            }
            if (el) { el.scrollTop = top; el.scrollLeft = left; }
        }
        for (const [el, top] of snap.outer) el.scrollTop = top;
        if (snap.win) window.scrollTo(0, snap.win);
    }

    function worldConsoleRender() {
        if (!worldEngineOn()) return;
        const page = document.getElementById('page-previs');
        if (!page) return;
        let host = document.getElementById('worldConsole');
        if (!host) {
            host = document.createElement('div');
            host.id = 'worldConsole';
            page.insertBefore(host, page.firstChild);
        }
        /*
         * KEEP WHERE THE DIRECTOR WAS SCROLLED. Every button on the right
         * re-renders the console, and replacing its HTML put every scrolled
         * panel (and the page) back at the top, so a click halfway down the
         * Light tab jumped the screen. Scroll positions are keyed by id or by
         * class and order, and put back after the redraw.
         */
        const scrolls = worldScrollSnapshot(host);
        host.innerHTML = worldConsoleHtml(state.currentProject || {}, WORLD.world, WORLD.version);
        worldScrollRestore(host, scrolls);
        const hint = document.getElementById('weModeHint');
        if (hint) {
            hint.textContent = WORLD.mode === 'maintain'
                ? `Camera dollies automatically to hold the subject at ${Math.round((WORLD.pinned || 0) * 100)}% of frame.`
                : 'Camera holds. Subject size follows the lens.';
        }
        if (document.getElementById('pvView')) worldFitFrame();
        worldSyncPanelShots(state.currentPage);
        if (worldFlagOn('previs_console') && WORLD.version && SPLAT.infoFor !== WORLD.version.id) {
            worldSplatInfo().then(() => {
                const seg = document.querySelector('.pv-seg');
                if (seg) seg.innerHTML = worldModeButtonsHtml();
            });
        }
        worldPaintFrame();
        worldDrawPath();
    }

    // ══════════════════════════════════════════════════════════════
    // 3D MODELS
    // ══════════════════════════════════════════════════════════════
    async function loadThreeD() {
        if (!state.currentProject) return;
        setStatus('Loading 3D models...');
        const pid = state.currentProject.id;
        try {
            const [chars, props, models] = await Promise.all([
                api('/projects/' + pid + '/characters').catch(() => ({ characters: [] })),
                api('/projects/' + pid + '/props').catch(() => ({ props: [] })),
                api('/projects/' + pid + '/models').catch(() => ({ models: [], jobs: [] })),
            ]);
            const characters = chars.characters || chars || [];
            const propList = props.props || props || [];

            const subjEl = document.getElementById('threedSubjects');
            const subjects = [
                ...characters.map(c => ({ kind: 'character', id: c.id, name: c.name })),
                ...propList.map(p => ({ kind: 'prop', id: p.id, name: p.name })),
            ];
            subjEl.innerHTML = subjects.length ? subjects.map(s => `
                <div class="entity-card">
                    <div class="entity-card-header">
                        <div class="entity-avatar" style="background:var(--gl-bg-elevated);">${s.kind === 'prop' ? '&#127917;' : '&#128100;'}</div>
                        <div>
                            <h3 style="font-size:13px;">${esc(s.name || 'Untitled')}</h3>
                            <p class="text-sm text-muted">${esc(s.kind)}</p>
                        </div>
                    </div>
                    <div style="margin-top:8px;">
                        <button class="btn btn-primary btn-sm" onclick="generateModelFor('${s.kind}','${s.id}', this)">Generate 3D</button>
                    </div>
                </div>`).join('')
                : '<div class="empty-state" style="grid-column:1/-1;"><div class="icon">&#129513;</div><h3>No characters or props</h3><p>Add characters or props first, then generate 3D models.</p></div>';

            const modelList = models.models || [];
            const modEl = document.getElementById('threedModels');
            modEl.innerHTML = modelList.length ? modelList.map(m => `
                <div class="entity-card">
                    <div class="entity-card-header">
                        <div class="entity-avatar" style="background:var(--gl-bg-elevated);">&#129513;</div>
                        <div>
                            <h3 style="font-size:13px;">${esc(m.file_name || 'model')}</h3>
                            <p class="text-sm text-muted">${esc((m.metadata && m.metadata.kind) || 'model_3d')}</p>
                        </div>
                    </div>
                    <div class="tag-row" style="margin-top:8px;">
                        <span class="tag">${esc(m.format || 'glb')}</span>
                    </div>
                    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
                        ${m.model_url ? '<a class="btn btn-secondary btn-sm" href="' + legacy.API_BASE + esc(m.model_url) + '" target="_blank" rel="noopener">Download</a>' : ''}
                        <button class="btn btn-secondary btn-sm" onclick="rigModel('${m.asset_id}', this)">Rig</button>
                    </div>
                </div>`).join('')
                : '<div class="empty-state" style="grid-column:1/-1;"><div class="icon">&#129513;</div><h3>No models yet</h3><p>Generate 3D models from your characters and props.</p></div>';

            setStatus(modelList.length + ' 3D model(s)');
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    async function generateModelFor(kind, id, btn) {
        /*
         * The description this mesh is built from, before it is bought. A mesh
         * takes minutes and costs credits, and it is built from words most
         * directors have never read back — the preview is usually the first
         * time anyone sees what a subject's own description amounts to.
         */
        return confirmPaidImage({
            capability: 'model3d',
            title: 'Generate a 3D model',
            note: 'A mesh takes a few minutes. It is built from the subject\u2019s description.',
            previewUrl: `/${kind}s/${id}/model/preview`,
            send: async choices => _shotAction(id, btn, 'Generate',
                `/${kind}s/${id}/model/generate`, 'Modelling',
                () => { if (typeof loadThreeD === 'function') loadThreeD(); }, choices),
        });
    }

    /** Rigging is a paid provider operation, so it is confirmed like one. */
    async function rigModel(assetId, btn) {
        return confirmPaidImage({
            title: 'Rig this model',
            capability: 'model3d',
            previewUrl: `/models/${assetId}/rig/preview`,
            note: 'Rigging runs on the 3D provider and costs credits.',
            editable: false,
            notEditableWhy: 'Rigging takes the mesh, not a prompt.',
            send: async choices => {
                if (btn) { btn.disabled = true; btn.textContent = 'Rigging…'; }
                setStatus('Rigging model…', true);
                try {
                    await api('/models/' + assetId + '/rig', {
                        method: 'POST', body: JSON.stringify(choices || {}),
                    });
                    setStatus('Model rigged.');
                    loadThreeD();
                } catch (err) { setStatus('Error: ' + err.message); }
                finally { if (btn) { btn.disabled = false; btn.textContent = 'Rig'; } }
            },
        });
    }

    /**
     * An import that failed has to say so where the person is looking.
     *
     * This wrote one line to the status bar at the bottom of the screen and
     * then cleared the file input, so a refused GLB was indistinguishable from
     * nothing having happened — which is exactly how it was reported: "I tried
     * uploading two models and they never showed."
     *
     * The refusal now stays on the page until it is read or another import is
     * tried, and it carries the reason the parser gave, which names the remedy
     * (compression off, an external .bin, a points-only export). Same rule the
     * markup toolbar and the regenerate spinner already follow: feedback
     * belongs on the thing you touched.
     */
    function reportImportFailure(fileName, reason) {
        setStatus('3D import failed: ' + reason);
        const page = document.getElementById('page-threed');
        if (!page) return;
        let box = document.getElementById('importFailureBanner');
        if (!box) {
            box = document.createElement('div');
            box.id = 'importFailureBanner';
            box.className = 'card';
            box.style.cssText = 'margin-bottom:16px;border-color:var(--gl-danger,#ef4444);';
            page.insertBefore(box, page.firstChild.nextSibling || page.firstChild);
        }
        box.innerHTML = `<strong>${esc(fileName)} was not imported</strong>
            <p class="text-sm" style="margin:6px 0 0;line-height:1.5;">${esc(reason)}</p>
            <button class="btn btn-secondary btn-sm" style="margin-top:8px;"
                    onclick="this.parentElement.remove()">Dismiss</button>`;
        box.scrollIntoView({ block: 'nearest' });
    }

    async function importThreeDModel(event) {
        const file = event.target.files && event.target.files[0];
        if (!file || !state.currentProject) return;
        const projectId = state.currentProject.id;
        setStatus('Importing 3D model…');
        try {
            const data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('The selected GLB could not be read.'));
                reader.readAsDataURL(file);
            });
            const normalized = String(data).replace(/^data:[^;]*;base64,/, 'data:model/gltf-binary;base64,');
            checkUploadSize(file, `/projects/${projectId}/models/import`);
            const imported = await api(`/projects/${projectId}/models/import`, {
                method: 'POST', body: JSON.stringify({ name: file.name, data: normalized }),
            });
            const stale = document.getElementById('importFailureBanner');
            if (stale) stale.remove();
            setStatus(`${file.name} imported.`);
            if (!state.currentProject || state.currentProject.id !== projectId) return;
            await loadThreeD();
        } catch (err) { reportImportFailure(file.name, err.message); }
        finally { event.target.value = ''; }
    }

    function generateAllModels() {
        /*
         * A paid action states its cost before it spends. Six of these were
         * silent, which is why a director generated elsewhere rather than
         * risk credits on something they could not see.
         */
        if (!state.currentProject) return;
        /*
         * A batch sends a DIFFERENT prompt per subject, so no single prompt is
         * the truth about what is bought. One is shown as a REPRESENTATIVE and
         * labelled as one — showing it unlabelled would imply the batch sends
         * that text, and showing none leaves the largest spend in the app
         * approved on a count alone.
         */
        return (async () => {
            let sample = null;
            const subject = (state.characters || [])[0] || (state.props || [])[0] || null;
            const kind = (state.characters || []).length ? 'character' : 'prop';
            if (subject) {
                try { sample = await api(`/${kind}s/${subject.id}/model/preview`); } catch (_) { sample = null; }
            }
            if (!confirm(`Generate a 3D model for EVERY character and prop?\n\n`
                + 'One paid generation per subject. Generate a single one first to see whether the '
                + 'meshes are usable for your previs before buying them all.'
                + (sample && sample.prompt
                    ? `\n\nEach subject sends its own prompt. ${subject.name || 'The first'} would send:\n\n`
                      + String(sample.prompt).slice(0, 400)
                    : ''))) return;
            return generateAllModelsRun();
        })();
    }

    function generateAllModelsRun() {
        if (!state.currentProject) return;
        const prog = document.getElementById('threedProgress');
        const bar = document.getElementById('threedProgressBar');
        const lbl = document.getElementById('threedProgressLabel');
        prog.style.display = 'block';
        bar.style.width = '0%';
        lbl.textContent = 'Starting 3D generation...';
        let total = 1, done = 0;

        streamSSEPost(
            '/projects/' + state.currentProject.id + '/models/batch/stream',
            {},
            (ev) => {
                if (ev.type === 'status' && ev.total_subjects) { total = ev.total_subjects || 1; }
                else if (ev.type === 'subject_start') { lbl.textContent = 'Generating ' + (ev.name || ev.id || '...'); }
                else if (ev.type === 'subject_complete' || ev.type === 'subject_failed') {
                    done++;
                    const p = Math.round((done / total) * 100);
                    bar.style.width = p + '%';
                    lbl.textContent = done + '/' + total + ' processed';
                }
            },
            () => {
                lbl.textContent = 'Done';
                setStatus('3D batch complete');
                setTimeout(() => { prog.style.display = 'none'; }, 1500);
                loadThreeD();
            },
            (err) => { setStatus('Error: ' + (err ? err.message : 'stream failed')); prog.style.display = 'none'; }
        );
    }

export {
    PREVIS,
    P_DEG,
    loadPrevisPage,
    pSub,
    pCross,
    pDot,
    pNorm,
    previsProject,
    previsFullView,
    previsFrameView,
    previsAim,
    WORLD_FLAGS,
    worldLoadFlags,
    worldFlagOn,
    worldEngineOn,
    WORLD_FLAG_REGIONS,
    worldRegionOn,
    worldOverlays,
    worldToggleBoardOnion,
    worldToggleOverlay,
    worldLenses,
    worldFovFor,
    worldApplyLens,
    worldFrameRatio,
    worldMeasurements,
    worldOverlayMenuHtml,
    DIRECT,
    directIntentLabel,
    worldDirectPanelHtml,
    WORLD_INTENTS_FALLBACK,
    worldDirectIntent,
    worldDirectProposal,
    worldDirectSend,
    worldDirectCheck,
    worldDirectApply,
    worldDirectShowResult,
    EXPLORE,
    worldExploreTilesHtml,
    WORLD_EXPLORE_FALLBACK,
    worldExplorePanelHtml,
    worldExploreBrief,
    worldExploreCandidates,
    worldExploreAccept,
    worldExploreTap,
    worldExploreLoad,
    worldExploreToggleCompare,
    worldExplorePick,
    worldExploreCompare,
    worldExploreShow,
    weM,
    weDeg,
    worldRailHtml,
    worldLoadShots,
    worldRailSelect,
    worldSpatialHtml,
    parse_,
    worldSetView,
    OPERATE_AXES,
    OPERATE_SCRUB,
    worldOperateScale,
    worldOperateSubject,
    worldOperateCamera,
    worldOperateValue,
    worldOperateApply,
    worldOperateLens,
    SHOT_FRAMINGS,
    SHOT_ANGLES,
    worldShotSubject,
    worldImpliedSubject,
    worldImpliedSubjectKeep,
    worldShotNow,
    worldApplyBody,
    worldShotPlace,
    worldShotOnHtml,
    worldShotOn,
    worldShotHtml,
    PV_LIGHT,
    worldLightVocab,
    worldLightHtml,
    worldLightSet,
    worldLightShow,
    worldOperateHtml,
    SCRUB,
    worldNudge,
    BLOCKING_REPS,
    worldBlockingHtml,
    worldSetRep,
    worldSecondaryHtml,
    ADVANCED_CHIPS,
    worldAdvancedRows,
    worldAdvancedHtml,
    worldToggleAdvanced,
    worldConsoleHtml,
    PV_TABS,
    PV_DECISION_STATES,
    worldDecisionsHtml,
    worldRefreshBlocking,
    worldApplyDecisions,
    worldDecisionClick,
    worldLockShot,
    worldSetTab,
    worldToggleTimeline,
    worldToolSelect,
    worldToolRailHtml,
    PV_ICONS,
    pvIcon,
    worldDecisionSummaryHtml,
    worldMoreMenuHtml,
    worldShotPickerHtml,
    worldMoveDockHtml,
    worldConsoleV2Html,
    worldFitFrame,
    PV_MODE_NOTES,
    worldBoardSrc,
    SPLAT,
    worldViewMode,
    worldModeButtonsHtml,
    worldLookAroundButtonHtml,
    worldSetViewMode,
    worldEnsureGeometry,
    worldSplatInfo,
    worldSplatModule,
    worldCameraPose,
    worldSplatCanvas,
    worldSplatStop,
    worldAimCamera,
    worldSplatSync,
    worldSplatRenderOnce,
    MESHLOOK,
    meshLookLights,
    worldMeshStop,
    worldMeshRelease,
    worldMeshRequestRender,
    worldMeshCanvas,
    worldMeshSync,
    MESH_MODE_NOTES,
    worldMeshRenderOnce,
    meshLookRig,
    meshLookHasSun,
    worldWalkCamera,
    worldWalkToggle,
    worldWalkRepaint,
    worldOperateRefreshValues,
    worldWalkEnsure,
    CAMGESTURE,
    worldGestureView,
    worldWalkTurn,
    worldWalkStep,
    worldWalkKey,
    worldWalkBarHtml,
    worldWalkKeep,
    worldWalkUndo,
    worldLoadScoutable,
    scoutableWorlds,
    worldScoutSelect,
    scoutShotCode,
    scoutSceneFor,
    worldScoutMakeShot,
    worldExploreThumbs,
    STAGE,
    SETEDIT,
    stageSubjects,
    stageYaw,
    stageSize,
    stageShape,
    stageColour,
    stageDrawFootprint,
    stageDrawPath,
    stagePathKeyHit,
    stageHit,
    stageHitIn,
    PLANVIEW,
    planZoomAt,
    planFit,
    stageBindPlan,
    stageSave,
    stageRenderBar,
    stageRename,
    stageTurn,
    stageTarget,
    stageRemove,
    setEditItem,
    setEditStart,
    setEditCancel,
    setEditTurn,
    setEditRemove,
    setEditObjects,
    setEditRebuild,
    setEditRenderBar,
    stageOpenAdd,
    stageAdd,
    stageSyncLook,
    subjectPoseAt,
    stageNowMs,
    stageHasPath,
    stageShownSubject,
    stageShownSubjects,
    stageLookPose,
    stageKeyHere,
    stageDeleteKey,
    stageClearPath,
    stageFollow,
    planLevels,
    planLevelIndex,
    planLevelsFor,
    planActiveLevel,
    planSetFloor,
    planFloorPickerHtml,
    planFloorPickerSync,
    stagePathBarHtml,
    previzVideoExport,
    worldPaintPlan,
    PV_FOLDS,
    pvFolds,
    pvFolded,
    pvApplyFolds,
    pvToggleFold,
    worldToggleArchived,
    worldRestoreArchived,
    worldSyncPanelShots,
    worldEases,
    worldTimelineHtml,
    worldSetEase,
    worldSelectLeg,
    worldAddLeg,
    worldHydrateMove,
    worldAddKey,
    worldSetLength,
    worldSyncShotLength,
    worldPoseAtT,
    worldPreviewCamera,
    worldSeekTo,
    worldPlayMove,
    worldDrawPath,
    worldTimelineSave,
    worldRenderPlate,
    worldToggleOverlayMenu,
    worldSetLens,
    worldSetMode,
    worldPaintGeometry,
    scoutStartCamera,
    worldDefaultCamera,
    worldPaintFrame,
    SETBUILD,
    setBuildOpen,
    setBuildHtml,
    roomScanHtml,
    roomScanStart,
    roomScanImport,
    setBuildFinish,
    worldOpenCreate,
    worldScoreComplexity,
    worldPaintRisk,
    worldRescore,
    worldCheckExport,
    WMATCH,
    worldOpenMatchReference,
    wmSetTool,
    wmLoadImage,
    wmClearMarks,
    wmBindCanvas,
    wmPaint,
    wmMarks,
    wmSolve,
    wmReportHtml,
    wmApply,
    worldLoadForShot,
    worldCreate,
    worldScrollKey,
    worldScrollSnapshot,
    worldScrollRestore,
    worldConsoleRender,
    loadThreeD,
    generateModelFor,
    rigModel,
    reportImportFailure,
    importThreeDModel,
    generateAllModels,
    generateAllModelsRun,
};
