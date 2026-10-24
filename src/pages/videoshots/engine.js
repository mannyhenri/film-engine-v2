/*
 * The Video Shots engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. What a video shot card does that only the Video Shots page uses: generate the clip, lip-sync, post, stitch, replace the background (and ask what to replace it with), and set which shots one clip covers. MOVED from the legacy core (measured by tools/core-ownership.js as used by this page alone). The page calls these as E.x.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { legacy, setLegacy } from '../../lib/legacy.js';

// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:
// a line reading `const esc = …` would be the first definition a backend test finds when it searches the page.
const {
    _shotAction,
    api,
    closeModal,
    confirmPaidImage,
    confirmUpscale,
    frameBusy,
    loadVideoShots,
    markCurrentShot,
    setStatus,
    showModalHtml,
} = Object.fromEntries([
    '_shotAction',
    'api',
    'closeModal',
    'confirmPaidImage',
    'confirmUpscale',
    'frameBusy',
    'loadVideoShots',
    'markCurrentShot',
    'setStatus',
    'showModalHtml',
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
// Core's values, read live as legacy.X and assigned with setLegacy: CONFIRM_GEN_VIDEO_TIER.

    /** Send it, and say plainly where it landed and what is still unresolved. */
    /**
     * Say which shots one clip contains, on the card, after it is uploaded.
     *
     * This replaced a native prompt() asked BEFORE the upload, where cancelling
     * abandoned the clip with nothing said. Here nothing is at stake: the file
     * is already stored, and answering or not answering only changes how it
     * plays back.
     *
     * Only the shots that consecutively FOLLOW are offered, because that is the
     * only shape a clip can have and the server refuses the rest — a picker
     * offering what the server rejects is how a picker stops being believed.
     */
    async function setClipCoverage(shotId, btn) {
        const shots = state.videoShots || [];
        const at = shots.findIndex(s => s.id === shotId);
        if (at < 0) return;
        const here = shots[at];
        const following = shots.slice(at + 1);
        if (!following.length) {
            return setStatus(`${here.shot_code} is the last shot — there is nothing after it for a clip to cover.`);
        }

        const media = (state.videoAssetsByShot || {})[shotId] || {};
        const asset = media.video_raw || media.video_final || media.video_synced;
        if (!asset || !asset.id) return setStatus('This shot has no clip to describe yet.');

        const answer = await pickCoverageRun(here, following);
        if (answer === null) return;                       // closed it: nothing happens

        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        try {
            const ids = [shotId, ...following.slice(0, answer).map(s => s.id)];
            const res = await api(`/assets/${asset.id}/coverage`, {
                method: 'PUT', body: JSON.stringify({ shot_ids: answer ? ids : [] }),
            });
            setStatus(res.note || 'Coverage saved.');
            loadVideoShots();
        } catch (err) {
            setStatus('Could not set the coverage: ' + err.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Covers…'; }
        }
    }

    /** A small in-page chooser. Returns how many following shots, 0 to clear, or null. */
    function pickCoverageRun(here, following) {
        return new Promise(resolve => {
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;'
                + 'display:flex;align-items:center;justify-content:center;';
            const done = v => { box.remove(); resolve(v); };
            box.innerHTML = `<div class="card" style="max-width:460px;">
                <h3 style="margin:0 0 8px;">What does this clip contain?</h3>
                <p class="text-sm text-muted" style="margin:0 0 12px;line-height:1.5;">
                    If one video covers several shots, the shots inside it stop playing their own
                    storyboard frames and stop being reported as missing footage.
                </p>
                <div id="covChoices" style="display:flex;flex-direction:column;gap:6px;"></div>
            </div>`;
            const list = box.querySelector('#covChoices');
            const add = (label, value) => {
                const b = document.createElement('button');
                b.className = 'btn btn-secondary btn-sm';
                b.style.textAlign = 'left';
                b.textContent = label;
                b.onclick = () => done(value);
                list.appendChild(b);
            };
            add(`Just ${here.shot_code}`, 0);
            following.forEach((s, i) => add(`${here.shot_code} through ${s.shot_code}`, i + 1));
            const cancel = document.createElement('button');
            cancel.className = 'btn btn-secondary btn-sm';
            cancel.textContent = 'Cancel';
            cancel.style.marginTop = '6px';
            cancel.onclick = () => done(null);
            list.appendChild(cancel);
            // Closing it changes nothing — the clip is already uploaded.
            box.addEventListener('click', e => { if (e.target === box) done(null); });
            document.body.appendChild(box);
        });
    }

    /*
     * A turnaround from ONE orbit rather than three separate generations.
     *
     * Three plates are three independent rolls of the dice and can disagree
     * about the face, the wardrobe and the build; frames of one continuous
     * motion cannot. It is also cheaper — about 25 credits against 45.
     *
     * Goes through the same pre-spend confirmation as every other paid button,
     * built from the FREE preview, so the number under the button is the number
     * that will be charged.
     */
    /* ── Keep the actor, change the background ───────────────────────────
     *
     * The one control here that EDITS footage instead of making some. It is
     * two steps on purpose: the instruction is asked for first, then the
     * shared gate shows the assembled prompt and the real cost — because the
     * price depends on the clip's measured LENGTH, so a confirmation raised
     * before the source is known would show a number that is not the one
     * charged.
     */
    function askBackgroundInstruction() {
        return new Promise(resolve => {
            const id = 'bgInstructionModal';
            showModalHtml(id, `
                <h3 style="margin-top:0;">Replace the background</h3>
                <p class="text-sm text-muted" style="line-height:1.5;">
                  Describe the PLACE and nothing else. The people, their positions and the camera
                  are preserved by the model — describing them again is what makes it re-render them.
                </p>
                <div class="form-group">
                  <label>The new background</label>
                  <textarea id="bgInstructionText" rows="3"
                    placeholder="a rain-soaked street at night, sodium streetlights, wet asphalt"></textarea>
                </div>
                <div class="flex-between" style="margin-top:12px;">
                  <button class="btn btn-secondary btn-sm" onclick="bgInstructionDone(null)">Cancel</button>
                  <button class="btn btn-primary btn-sm" onclick="bgInstructionDone()">See what it would cost</button>
                </div>`);
            BG_INSTRUCTION = resolve;
            const box = document.getElementById('bgInstructionText');
            if (box) box.focus();
        });
    }

    let BG_INSTRUCTION = null;

    function bgInstructionDone(force) {
        const box = document.getElementById('bgInstructionText');
        const value = force === null ? null : ((box && box.value) || '').trim();
        closeModal('bgInstructionModal');
        const done = BG_INSTRUCTION; BG_INSTRUCTION = null;
        if (done) done(value);
    }

    async function replaceBackground(shotId, btn) {
        const instruction = await askBackgroundInstruction();
        if (!instruction) return;   // cancelled, or nothing said
        return confirmPaidImage({
            capability: 'video',
            title: 'Replace the background',
            note: 'The performance in this clip is kept and re-rendered somewhere else. Higgsfield '
                + 'bills this by the length of the clip handed IN, not the length asked for, so a '
                + 'longer take costs more for the same edit. The result lands as a NEW version — '
                + 'the take being edited survives.',
            previewUrl: `/shots/${shotId}/video/background/preview?instruction=`
                + encodeURIComponent(instruction),
            editable: false,
            notEditableWhy: 'The clause that holds the actor still is not editable — deleting it is '
                + 'what makes the model re-render the performance. Change the background above.',
            send: async () => {
                setStatus('Replacing the background…', true);
                if (btn) { btn.disabled = true; btn.dataset.was = btn.textContent; btn.textContent = 'Replacing…'; }
                try {
                    const res = await api(`/shots/${shotId}/video/background/generate`,
                        { method: 'POST', body: JSON.stringify({ instruction }) });
                    setStatus(res && res.ok
                        ? `Background replaced — v${res.version} on this shot. The previous take is still there.`
                        : `Could not replace the background (${(res && res.stage) || 'unknown'} stage): `
                          + ((res && res.reason) || 'no reason given'));
                    if (typeof loadVideoShots === 'function') loadVideoShots();
                } catch (err) {
                    setStatus('Could not replace the background: ' + err.message);
                } finally {
                    // A spinner still turning after a failure is worse than
                    // none: it says work is happening when nothing is.
                    if (btn) { btn.disabled = false; if (btn.dataset.was) btn.textContent = btn.dataset.was; }
                }
            },
        });
    }

    /**
     * Generate one shot's clip — after showing exactly what will be sent.
     *
     * This spent credits silently. The director's response was to generate on
     * Runway directly instead: "credits are super precious and didn't want to
     * waste them." Someone who cannot see what the engine would send does not
     * trust it with money, and the feature fails for a reason that has nothing
     * to do with how good the generation is.
     *
     * The preview is FREE and leads, the same shape every image path has had
     * since shot_prompt.
     */
    async function generateVideoFor(shotId) {
        /*
         * Footage goes through the same pre-spend surface as a frame, and for
         * the same reason — it is the more expensive half. A clip is $0.48
         * where a frame is $0.13, so being unable to choose the generator cost
         * more here, not less.
         *
         * The prompt is read-only: a motion prompt is composed from the shot
         * card and the approved camera path by a different builder, and the
         * editable-prompt work covered images only. Said rather than omitted.
         */
        markCurrentShot(shotId);
        return confirmPaidImage({
            capability: 'video',
            title: 'Generate this clip',
            note: 'Costs credits. The storyboard frame travels as the first keyframe, so the clip '
                + 'starts from the picture you approved.',
            previewUrl: `/shots/${shotId}/video/preview`,
            // Draft / production / hero, priced live from the free preview.
            videoTiers: true,
            editable: false,
            notEditableWhy: 'A motion prompt is composed from the shot card and the approved camera '
                + 'path. Change the card or the blocking, then preview again.',
            send: async choices => {
                const done = frameBusy(shotId, 'Generating');
                setStatus('Generating clip...', true);
                try {
                    const res = await api('/shots/' + shotId + '/video/generate',
                        { method: 'POST', body: JSON.stringify({
                            ...choices,
                            tier: legacy.CONFIRM_GEN_VIDEO_TIER || 'production',
                        }) });
                    done();
                    setStatus(res && res.provider ? `Clip generated via ${res.provider}.` : 'Clip generated.');
                    if (typeof loadVideoShots === 'function') loadVideoShots();
                } catch (err) { done(); setStatus('Could not generate: ' + err.message); }
            },
        });
    }

    function lipsyncShot(shotId, btn) { _shotAction(shotId, btn, 'Lip-sync', '/shots/' + shotId + '/lipsync/generate', 'Lip-syncing'); }

    function postShot(shotId, btn) {
        return confirmUpscale(shotId, null, body => _shotAction(shotId, btn, 'Upscale', '/shots/' + shotId + '/post/upscale', 'Upscaling', null, body));
    }

    function stitchShot(shotId, btn) { _shotAction(shotId, btn, 'Stitch', '/shots/' + shotId + '/video/stitch', 'Stitching'); }

export {
    setClipCoverage,
    pickCoverageRun,
    askBackgroundInstruction,
    BG_INSTRUCTION,
    bgInstructionDone,
    replaceBackground,
    generateVideoFor,
    lipsyncShot,
    postShot,
    stitchShot,
};
