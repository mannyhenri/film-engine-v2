/*
 * The scenes engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. A scene's dialogue: one paid confirmation, then shot by shot. Only the Scenes page offers it; ScenesPage.jsx calls it as E.x.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { legacy } from '../../lib/legacy.js';

// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:
// a line reading `const esc = …` would be the first definition a backend test finds when it searches the page.
const {
    api,
    confirmPaidImage,
    loadScenes,
    setStatus,
} = Object.fromEntries([
    'api',
    'confirmPaidImage',
    'loadScenes',
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

    /* ── the table read ─────────────────────────────────────────────────── */

    /**
     * Hear a whole scene, before anything is shot.
     *
     * The question the shot-scoped route could not answer: how does this scene
     * PLAY. Free to read, paid to hear, and attached to no shot either way.
     */
    /**
     * Generate the dialogue for one scene's shots.
     *
     * The take the FILM uses: registered against each shot, and therefore what
     * playback, lip-sync and the mix all read. The old table read produced a
     * parallel set of audition files attached to nothing, which meant paying
     * twice for the same lines and throwing one set away.
     */
    /** Every shot in a scene, confirmed once and then run shot by shot. */
    async function generateSceneDialogue(sceneId, lineCount) {
        // Read the scene's shots here: nothing else on this page holds them,
        // and a lookup into an undefined global threw before anything showed.
        let shots = [];
        try {
            const r = await api(`/projects/${state.currentProject.id}/shotlist`);
            shots = ((r && (r.shots || r)) || []).filter(s => s.scene_id === sceneId);
        } catch (err) { setStatus('Could not read this scene\'s shots: ' + err.message, true); return; }
        if (!shots.length) { setStatus('This scene has no shots yet — break it down first.', true); return; }
        const first = shots[0];
        return confirmPaidImage({
            title: 'Generate the dialogue for this scene',
            capability: 'voice',
            previewUrl: first ? `/shots/${first.id}/voice/preview` : null,
            note: `${lineCount} line(s) across ${shots.length || 'the'} shot(s). The prompt shown `
                + 'is the first shot\'s; each shot is generated from its own lines, and the '
                + 'choices here apply to all of them.',
            editable: false,
            notEditableWhy: 'Each shot has its own lines — edit them on the shot card.',
            send: async choices => {
                let made = 0;
                for (const sh of shots) {
                    setStatus(`Generating ${sh.shot_code || ''}… (${made} of ${shots.length})`, true);
                    try {
                        await api(`/shots/${sh.id}/voice/generate`, {
                            method: 'POST', body: JSON.stringify(choices || {}),
                        });
                        made++;
                    } catch (err) {
                        // A provider that has started refusing will refuse the
                        // next one; stop rather than buying the same failure.
                        setStatus(`${made} of ${shots.length} — then: ${err.message}`);
                        return;
                    }
                }
                setStatus(`Dialogue generated for ${made} shot(s).`);
                if (typeof loadScenes === 'function') loadScenes();
            },
        });
    }

export {
    generateSceneDialogue,
};
