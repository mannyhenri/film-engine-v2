/*
 * The media input engine, shared. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. How any page takes a picture or a file in: the upload control and its size limits, the iPhone camera (shoot a plate, capture media), and a plate's thumbnail URL. Shared by the subject sheets, Characters/Locations/Props, Consistency, the mood board, Marketing, Music, Previs, the Production graph, Video Shots and others; MediaInput (boot-mounted, no dialogs) puts every name here on window.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { legacy, setLegacy } from '../../lib/legacy.js';

// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:
// a line reading `const esc = …` would be the first definition a backend test finds when it searches the page.
const {
    api,
    esc,
    jsAttr,
    loadLocations,
    setStatus,
} = Object.fromEntries([
    'api',
    'esc',
    'jsAttr',
    'loadLocations',
    'setStatus',
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
const { state } = Object.fromEntries(['state'].map(n => [n, live(n)]));
// Core's values, read live as legacy.X and assigned with setLegacy: API_BASE, PLATE_CAMERA_AFTER.

    /** The project's aspect ratio as a number, defaulting to 16:9. */
    function previsAspect() {
        const raw = (state.currentProject && state.currentProject.aspect_ratio) || '16:9';
        const m = String(raw).match(/^([\d.]+)\s*:\s*([\d.]+)$/);
        if (!m) return 16 / 9;
        const r = parseFloat(m[1]) / parseFloat(m[2]);
        return Number.isFinite(r) && r > 0 ? r : 16 / 9;
    }

    function csImg(url) {
        return url && !/^https?:/i.test(url) ? legacy.API_BASE + url : url;
    }

    /*
     * A plate at the size it will be DRAWN, not the size it was made.
     *
     * Measured on the live install: the reference plates total 77MB, single
     * files run 668KB to 1.2MB, and a character card paints one at 48x48. The
     * first visit to an area pulled full plates down to make thumbnails of
     * them — loadCharacters took 863ms cold and 4ms warm, which is why the
     * slowness was intermittent and never reproduced on demand.
     *
     * file-storage.js has served a cached thumbnail for any `?w=` since it was
     * written, and falls through to the original on any failure so it can
     * never take down the picture it is optimising. Nothing had ever asked:
     * four thumbnails existed on the whole install, all under storyboards/.
     *
     * Built like frameSrc rather than as a second idiom, because the cache
     * buster and the width have to share one query string — a plate URL
     * already carries `?v=`.
     */
    function plateSrc(url, width) {
        const abs = csImg(url);
        if (!abs || !width) return abs;
        return abs + (abs.includes('?') ? '&' : '?') + 'w=' + width;
    }

    /**
     * The upload control that sits beside every Generate.
     *
     * "Everywhere I can generate plates or boards, I should be able to upload
     * one too, say I'm working outside of film engine."
     *
     * ONE builder rather than four literals, on the precedent markupToolbar()
     * set — the grid and the viewer came to disagree about their own tools
     * precisely because each wrote its own copy. Here the four places are
     * characters, locations, props and the mood board, and they must accept the
     * same formats and report the same way.
     */
    /*
     * Which capture device, if any, can fill a control that accepts THIS.
     *
     * Returns a `capture` value, '' for a medium that names no camera facing,
     * or null for an accept a camera cannot produce at all — a .tar.gz bundle,
     * a .glb, a screenplay. Deriving it here rather than at each call site is
     * the same rule uploadControl itself exists for: a caller that cannot
     * choose the attribute cannot get it wrong, and a control added later is
     * armed correctly with nothing to remember.
     *
     * NOTE the affordance is ADDITIVE. On iOS a file input carrying `capture`
     * goes straight to the camera and the Photo Library option disappears, so
     * arming the existing upload would have traded picking a render made
     * outside Film Engine — the common case — for shooting a new one. Both are
     * rendered instead.
     */
    /*
     * The second affordance: shoot one now. Rendered only where captureFor says
     * a camera or a microphone could actually fill the control, so a bundle or
     * screenplay importer never offers it. On a desktop browser the attribute
     * is simply ignored and the control behaves as another file picker, which
     * is why it is safe to render unconditionally on the media surfaces.
     */
    /* ── SHOOTING A PLATE ON THE PHONE ──────────────────────────────────────
     *
     * In a browser, Shoot is `<input type="file" capture="environment">` and
     * that is all a browser offers: one photograph per tap, with nothing on
     * screen saying which view you are on.
     *
     * In the iOS app a native bridge is available, and it is worth having for
     * exactly one reason — a turnaround is FOUR views, and the engine attaches
     * the front one to every frame the character appears in. Walking them
     * through a file input means four trips out to this page and back, hunting
     * for the next control each time.
     *
     * THE PAGE STILL DECIDES EVERYTHING. It sends the subject, the views and
     * the import route; native opens the camera and posts back to that same
     * route. Deciding in two places is the second surface the iOS design
     * exists to avoid.
     */
    const PLATE_CAMERA = 'plateCamera';

    function nativeCamera() {
        try {
            return (window.webkit && window.webkit.messageHandlers
                && window.webkit.messageHandlers[PLATE_CAMERA]) || null;
        } catch (_) { return null; }   /* a sandbox that throws on access is "no" */
    }

    /*
     * The views to walk for a target. A character is a turnaround; everything
     * else is one plate, and `default` is the view-less name the engine already
     * stores a subject's headline plate under.
     */
    function plateViewsFor(target) {
        if (target === 'character-plate') {
            return [
                { key: 'front',      label: 'Front' },
                { key: 'side-left',  label: 'Left side' },
                { key: 'side-right', label: 'Right side' },
                { key: 'back',       label: 'Back' },
            ];
        }
        return [{ key: '__default__', label: 'Plate' }];
    }

    /** Ask the app to shoot. Returns immediately; the app calls back. */
    function shootPlate(target, url, subject, after) {
        const bridge = nativeCamera();
        if (!bridge) return;
        setLegacy('PLATE_CAMERA_AFTER', after || null);
        setStatus('Opening the camera\u2026');
        bridge.postMessage(JSON.stringify({
            url, apiBase: '', subject: subject || 'this subject',
            views: plateViewsFor(target),
            /*
             * WHERE it is going, so the camera budgets a take against the
             * ceiling that actually binds it. A walkthrough handed to Marble
             * gets 133 seconds at 1080p30 where the same mode shot for the cut
             * gets 200 — and a director who is shown the larger number
             * discovers the smaller one at upload, after the walk.
             */
            destination: captureDestination(target),
            /*
             * And what it may produce, so a footage session opens on the
             * transport rather than the shutter and its take is delivered.
             */
            media: captureMedia(target),
            /*
             * The delivery aspect, so the camera can guide the shape the plate
             * will actually be cropped to — a 9:16 deliverable guides 9:16.
             * previsAspect() is REUSED rather than the ratio parsed again here:
             * two readings of one project setting is how they come to disagree.
             */
            aspect: previsAspect(),
        }));
    }

    /*
     * WHICH TARGETS THE CONTROLLED CAMERA FILLS.
     *
     * MIRRORED from backend/lib/media-imports.js, where the rule is stated once
     * and derived from the epic's own constraint — a target gets the camera if
     * what it holds is PHOTOGRAPHED IN THE WORLD. The page cannot require a node
     * module (build.target: single-html), so it exists twice and
     * fcc-system-camera.test.js holds the two equal element by element — the
     * same arrangement body-limit.js and screenplay-blocks.js already have, and
     * for the same reason: two rules that disagree is how a fix survives in the
     * tests and not on the screen.
     *
     * `video-media` is DELIBERATELY absent though footage is photographed. The
     * controlled camera records a take and nothing delivers it yet (FCC-014), so
     * that surface keeps the system camera, which does deliver a clip today.
     */
    /*
     * SELF-CONTAINED, deliberately. Four separate test harnesses lift the
     * control builders out of this page by extracting FUNCTIONS, and a helper
     * that reads a module-level constant hands them a ReferenceError — which
     * `nativeCamera()` then swallows in its own try/catch, so the harness is
     * told there is no bridge and every "in the app" assertion quietly measures
     * the browser arm instead. That happened while this was being written. A
     * helper the harnesses can run on its own cannot fail that way.
     */
    /*
     * WHERE a capture for this target is going, and therefore which ceiling
     * binds it. MIRRORED from backend/lib/media-imports.js — the page cannot
     * require a node module (build.target: single-html), so the rule exists
     * twice and fcc-previz-capture.test.js holds the two equal over every
     * target the registry declares.
     *
     * Self-contained for the reason `shootsWithCamera` is: four harnesses lift
     * these builders out by extracting FUNCTIONS, and a helper that reads a
     * module-level constant hands them a ReferenceError.
     *
     * `footage` is the default because it is what every target but one is, and
     * inventing `world` by accident would silently shorten every take by a
     * third — Marble caps a video at 100MB where the upload accepts 150.
     */
    function captureDestination(target) {
        return String(target || '') === 'world-capture' ? 'world' : 'footage';
    }

    function shootsWithCamera(target) {
        return [
            'storyboard-image', 'world-capture', 'character-plate', 'location-plate',
            'prop-plate', 'mood-board-image', 'continuity-ref', 'video-media',
        ].indexOf(String(target || '')) !== -1;
    }

    /*
     * WHICH MEDIA a session for this target may produce.
     *
     * `captureDestination` answers which CEILING binds; this answers what the
     * camera is being opened to MAKE, and they are two different questions. A
     * plate and a take share the destination `footage`, and a world capture
     * takes both a panorama and a walkthrough — so a session told only where it
     * is going opens the stills shutter for a clip and delivers nothing.
     *
     * MIRRORED from backend/lib/media-imports.js, self-contained for the reason
     * the two rules beside it are: four harnesses lift these builders out by
     * extracting FUNCTIONS, and a helper reading a module-level constant hands
     * them a ReferenceError that `nativeCamera` then swallows.
     *
     * A LiDAR scan is deliberately absent from the world capture's list: the
     * target accepts one, and this camera cannot make one.
     */
    function captureMedia(target) {
        const t = String(target || '');
        if (t === 'world-capture') return ['image', 'video'];
        if (t === 'video-media') return ['video'];
        return ['image'];
    }

    /*
     * THE ONE FUNCTION THAT DECIDES WHICH CAMERA A SURFACE OPENS.
     *
     * It used to render `<input capture>` and nothing else — the SYSTEM camera:
     * one photograph, no exposure or focus lock, no white balance held across a
     * turnaround, no level, no peaking, no zebras, no format and no budget. The
     * controlled camera nine tasks of this epic built was reachable only because
     * `uploadControl` wrote its own bridge branch, so the plates got it and the
     * world capture and every capability control silently did not.
     *
     * A branch written at a call site is a branch the next call site does not
     * get. That is the shape this codebase has paid for as `Regen` versus
     * `Generate All`, as the ambient bed that reached two surfaces of three, and
     * as AUDIO_LANES laying out four elements in one exporter and three in the
     * other. So the decision lives HERE, once, and a caller that cannot choose
     * cannot get it wrong.
     *
     * It is asked about a TARGET rather than an accept string because an accept
     * string cannot answer: a previs image and a location plate accept exactly
     * the same bytes, and one is rendered from a staged camera while the other
     * is a photograph of a real place.
     */
    function shootControl(target, url, accept, targetAttr, onchange, opts) {
        const o = opts || {};
        // The app's own camera, where there is one and this target photographs.
        if (shootsWithCamera(target) && nativeCamera()) return plateShootButton(target, url, o);

        /*
         * A browser has no better camera to offer, so it keeps the one it has.
         * Retiring the system camera means REPLACING it where a replacement
         * exists — deleting it everywhere would take the affordance off every
         * desktop and every phone browser.
         */
        const capture = captureFor(accept);
        if (capture === null) return '';
        const audio = capture === '';
        const label = o.shootLabel || (audio ? 'Record' : 'Shoot');
        const title = audio
            ? 'Record audio with this device'
            : 'Shoot it now with this device\u2019s camera';
        return `<label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0;"
                       title="${esc(title)}"
                       onclick="event.stopPropagation();">${esc(label)}
                    <input type="file" ${targetAttr}
                           accept="${accept}" capture="${capture}" style="display:none"
                           onclick="event.stopPropagation();"
                           onchange="${onchange}">
                </label>`;
    }

    /*
     * MIRRORED from backend/lib/body-limit.js. The page cannot require a node
     * module (build.target: single-html), so the rule exists twice and
     * upload-size-guard.test.js holds the two equal over real URLs — the same
     * arrangement screenplay-pagination.js already uses, and for the same
     * reason: two rules that disagree is how a fix survives in the tests and
     * not on the screen.
     */
    const UPLOAD_BODY_LIMITS = { json: 10 * 1048576, file: 150 * 1048576, bundle: 500 * 1048576, chunk: 16 * 1048576 };

    /** The BODY ceiling this URL is allowed, matching what the server enforces. */
    function uploadLimitFor(url) {
        const parts = String(url || '').split('?')[0].split('/').filter(Boolean);
        if (parts[0] === 'projects' && parts[1] === 'import') return UPLOAD_BODY_LIMITS.bundle;
        // One piece of a resumable upload: the server's CHUNK_LIMIT.
        if (parts[0] === 'uploads' && parts[1]) return UPLOAD_BODY_LIMITS.chunk;
        const last = parts[parts.length - 1];
        const carriesFile = parts.length > 1 && (last === 'import' || last === 'media');
        return carriesFile ? UPLOAD_BODY_LIMITS.file : UPLOAD_BODY_LIMITS.json;
    }

    /*
     * Refuse an oversize file HERE, before it is sent.
     *
     * The server answers 413 correctly, but reaching it means pushing the whole
     * file — on a phone, over mobile data — to be told no, and what comes back
     * reads as "Backend offline". Checking first turns a apparent outage into a
     * sentence naming the size and the limit.
     *
     * The file ceiling is three quarters of the body ceiling because uploads
     * travel base64-encoded, which is a third larger than the bytes.
     */
    function checkUploadSize(file, url) {
        if (!file || typeof file.size !== 'number') return;
        const bodyMax = uploadLimitFor(url);
        const fileMax = Math.floor(bodyMax * 3 / 4);
        if (file.size <= fileMax) return;
        const mb = (n) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)}MB`;
        throw new Error(`${file.name || 'That file'} is ${mb(file.size)}. The limit for this `
            + `upload is about ${mb(fileMax)} — uploads travel base64-encoded, which is a third `
            + 'larger than the file itself.');
    }

    function captureFor(accept) {
        const a = String(accept || '');
        if (/image\/|video\//.test(a)) return 'environment';   // rear camera
        if (/audio\//.test(a)) return '';                       // a mic has no facing
        return null;
    }

    function uploadControl(target, url, opts) {
        const o = opts || {};
        return `<label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0;"
                       title="${esc(o.title || 'Use a picture you already have, made outside Film Engine')}"
                       onclick="event.stopPropagation();">${esc(o.label || 'Upload')}
                    <input type="file" data-import-target="${target}"
                           accept="image/png,image/jpeg,.png,.jpg,.jpeg" style="display:none"
                           onclick="event.stopPropagation();"
                           onchange="uploadReferenceImage(event, '${target}', '${url}', ${JSON.stringify(o.extra || {}).replace(/"/g, '&quot;')}, '${o.after || ''}')">
                </label>${shootControl(
                    target, url,
                    'image/png,image/jpeg,.png,.jpg,.jpeg',
                    `data-import-target="${target}"`,
                    `uploadReferenceImage(event, '${target}', '${url}', ${JSON.stringify(o.extra || {}).replace(/"/g, '&quot;')}, '${o.after || ''}')`,
                    o)}`;
    }

    /*
     * The native affordance, and it says what it will do. "Shoot" on a
     * character opens a four-view walk, not one photograph — a button that
     * takes longer than you expected is worse than one that said so.
     */
    function plateShootButton(target, url, o) {
        const views = plateViewsFor(target);
        const many = views.length > 1;
        const label = (o && o.shootLabel) || (many ? `Shoot ${views.length} views` : 'Shoot');
        const subject = (o && o.subject) || '';
        return `<button class="btn btn-secondary btn-sm" style="margin:0;"
                        title="${esc(many
                            ? 'Walk ' + views.map(v => v.label.toLowerCase()).join(', ') + ' in one pass'
                            : 'Shoot it now with this device\u2019s camera')}"
                        onclick="event.stopPropagation();shootPlate('${target}', '${url}', ${jsAttr(subject)}, '${o.after || ''}')">${esc(label)}</button>`;
    }

    /**
     * Send a picture the director already has, and put it where a generated one
     * would go.
     *
     * The refusal is rendered where the control is, not on the status bar — the
     * lesson the GLB importer paid for: a refusal one line high at the bottom of
     * the screen is indistinguishable from nothing having happened.
     */
    async function uploadReferenceImage(event, target, url, extra, after) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const label = event.target.closest('label');
        const original = label && label.firstChild && label.firstChild.textContent;
        if (label && label.firstChild) label.firstChild.textContent = 'Uploading… ';
        try {
            const data = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = () => reject(new Error('That file could not be read.'));
                r.readAsDataURL(file);
            });
            checkUploadSize(file, url);
            const res = await api(url, {
                method: 'POST',
                body: JSON.stringify({ data, name: file.name, ...(extra || {}) }),
            });
            setStatus(`${file.name} uploaded. ${res.note || 'Every shot referencing this subject uses it now.'}`);
            if (after && typeof window[after] === 'function') window[after]();
            else if (typeof loadLocations === 'function' && target === 'location-plate') loadLocations();
        } catch (err) {
            // Named on the control, because the file input is cleared straight
            // after and there would otherwise be no trace it was ever tried.
            setStatus(`${file.name} was not uploaded: ${err.message}`);
            if (label) {
                label.style.borderColor = 'var(--gl-danger,#ef4444)';
                label.title = 'Not uploaded: ' + err.message;
                setTimeout(() => { label.style.borderColor = ''; }, 6000);
            }
        } finally {
            if (label && label.firstChild && original) label.firstChild.textContent = original;
            event.target.value = '';
        }
    }

    /**
     * Upload footage or sound made outside Film Engine.
     *
     * Same shape as uploadControl() and deliberately a separate builder,
     * because these differ in the two things that matter: what the picker will
     * let you select, and whether the file belongs to a SHOT or a SCENE. A
     * music bed posted at a shot would attach a whole scene's score to one shot
     * and read as working; the server refuses it, and the control never offers
     * it in the first place.
     */
    function mediaUploadControl(capability, media, scope, ownerId, opts) {
        const o = opts || {};
        const accept = media === 'video'
            ? 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv'
            : 'audio/wav,audio/mpeg,audio/mp4,audio/flac,audio/ogg,.wav,.mp3,.m4a,.flac,.ogg';
        /*
         * A sequence has its own import route rather than sharing the shot one:
         * a clip dropped on a sequence must also mark that sequence complete
         * and point at the file, or the page still shows it as never run.
         */
        // A cue's audio has its own route: it must LINK the file to the cue, not
        // merely land it on the scene. An asset carries no level, no fades and
        // no place on the sheet, so an upload that stops at the scene is a file
        // nobody hears.
        const url = scope === 'cue'
            ? `/music-cues/${ownerId}/audio`
            : scope === 'sequence'
                ? `/sequences/${ownerId}/import`
                : `/${scope === 'scene' ? 'scenes' : 'shots'}/${ownerId}/media/${capability}/import`;
        return `<label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0;"
                       title="${esc(o.title || `Use ${media === 'video' ? 'a clip' : 'audio'} you made elsewhere — it is stored exactly where a generated one goes`)}"
                       onclick="event.stopPropagation();">${esc(o.label || 'Upload')}
                    <input type="file" data-import-target="${capability}-media"
                           accept="${accept}" style="display:none"
                           onclick="event.stopPropagation();"
                           onchange="uploadCapabilityMedia(event, '${capability}', '${url}', '${o.after || ''}', '${scope === 'shot' ? ownerId : ''}')">
                </label>${shootControl(
                    `${capability}-media`, url, accept,
                    `data-import-target="${capability}-media"`,
                    `uploadCapabilityMedia(event, '${capability}', '${url}', '${o.after || ''}', '${scope === 'shot' ? ownerId : ''}')`,
                    o)}`;
    }

    async function uploadCapabilityMedia(event, capability, url, after, shotId) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        /*
         * NOTHING STANDS BETWEEN THE FILE AND THE UPLOAD.
         *
         * This used to ask, with a native prompt(), whether the clip contained
         * more than one shot — before sending anything. Cancelling that dialog
         * abandoned the upload with nothing said, so pressing Escape on an
         * unexpected question silently discarded the clip and the symptom was
         * "playback doesn't include the video" for a file that had never
         * reached the server. A native modal also cannot be seen in a
         * screenshot, so the page merely appeared to have stopped.
         *
         * The question is asked afterwards, on the shot card, where the answer
         * is better informed anyway: a director who has watched the clip back
         * knows what is in it.
         */
        const label = event.target.closest('label');
        const original = label && label.firstChild && label.firstChild.textContent;
        /*
         * Media files are large and the read alone is slow, so the control has
         * to say it is working. A silent 40-second upload is indistinguishable
         * from a dead button, which is how the GLB import came to be reported
         * as broken when it was not.
         */
        if (label && label.firstChild) label.firstChild.textContent = 'Uploading… ';
        setStatus(`Uploading ${file.name} (${(file.size / 1048576).toFixed(1)}MB)…`, true);
        try {
            // Was a second copy of the ceiling, hardcoded at 112MB. One rule,
            // mirrored from the server and held equal to it by test.
            checkUploadSize(file, url);
            const data = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = () => reject(new Error('That file could not be read.'));
                r.readAsDataURL(file);
            });
            const res = await api(url, {
                method: 'POST',
                body: JSON.stringify({ data, name: file.name }),
            });
            /*
             * A refused coverage is reported ON ITS OWN. The upload succeeded
             * and the file is on its shot; saying "uploaded" alone would let a
             * director believe 1B and 1C are inside it when they still play
             * their own frames.
             */
            setStatus(`${file.name} uploaded as ${res.asset_type}`
                + (res.duration_ms ? ` (${(res.duration_ms / 1000).toFixed(1)}s)` : '')
                + '. It plays in Playback now.'
                + (capability === 'video' && shotId
                    ? ' If this one clip covers several shots, say so with “Covers…” on the card.' : ''));
            if (capability === 'video' && shotId) window.__lastUploadedClip = res.asset_id;
            if (after && typeof window[after] === 'function') window[after]();
        } catch (err) {
            setStatus(`${file.name} was not uploaded: ${err.message}`);
            if (label) {
                label.style.borderColor = 'var(--gl-danger,#ef4444)';
                label.title = 'Not uploaded: ' + err.message;
                setTimeout(() => { label.style.borderColor = ''; }, 8000);
            }
        } finally {
            if (label && label.firstChild && original) label.firstChild.textContent = original;
            event.target.value = '';
        }
    }

export {
    previsAspect,
    csImg,
    plateSrc,
    PLATE_CAMERA,
    nativeCamera,
    plateViewsFor,
    shootPlate,
    captureDestination,
    shootsWithCamera,
    captureMedia,
    shootControl,
    UPLOAD_BODY_LIMITS,
    uploadLimitFor,
    checkUploadSize,
    captureFor,
    uploadControl,
    plateShootButton,
    uploadReferenceImage,
    mediaUploadControl,
    uploadCapabilityMedia,
};
