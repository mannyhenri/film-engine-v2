/*
 * The scene drift engine, shared. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. Which scenes' shots were written from an earlier draft (the screenplay-drift report), and each scene's status label and icon in the screenplay editor. Shared by Scenes, the Storyboard and the Screenplay; SceneDrift (boot-mounted, no dialogs) puts every name here on window. DRIFT itself stays core: loadScreenplayDrift replaces it with a new object, and a component's window copy would keep the first; the engine assigns it with setLegacy.
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
} = Object.fromEntries([
    'api',
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
// Core's values, read live as legacy.X and assigned with setLegacy: DRIFT.

    // FILM-124: Update scene heading status icons in the screenplay editor
    function updateSceneStatusIcons() {
        const editor = document.getElementById('screenplayEditor');
        if (!editor || !state.scenes || state.scenes.length === 0) return;

        const sceneHeadings = editor.querySelectorAll('[data-element-type="scene-heading"]');

        sceneHeadings.forEach((heading, index) => {
            // Remove existing status icon if any
            const existingIcon = heading.querySelector('.scene-status-icon');
            if (existingIcon) existingIcon.remove();

            // Try to match scene by number or location
            const headingText = heading.textContent.trim();
            const sceneNumAttr = heading.dataset.sceneNumber;

            // Find matching scene in state
            let matchedScene = null;

            // First try by scene number attribute
            if (sceneNumAttr) {
                matchedScene = state.scenes.find(s => String(s.scene_number) === sceneNumAttr);
            }

            // Fallback: try by location
            if (!matchedScene) {
                const locMatch = headingText.match(/(?:INT|EXT|INT\.?\/EXT)[\.\s]+([^-]+)/i);
                if (locMatch) {
                    const location = locMatch[1].trim().toUpperCase();
                    matchedScene = state.scenes.find(s =>
                        s.location && s.location.toUpperCase() === location
                    );
                }
            }

            // Fallback: match by index if scene count matches heading count
            if (!matchedScene && state.scenes.length === sceneHeadings.length) {
                matchedScene = state.scenes[index];
            }

            // Add status icon if we found a matching scene
            if (matchedScene && matchedScene.status) {
                const icon = document.createElement('span');
                icon.className = `scene-status-icon ${matchedScene.status}`;
                icon.title = getSceneStatusLabel(matchedScene.status);

                // Icon based on status
                if (matchedScene.status === 'broken_down') {
                    icon.innerHTML = '✓';
                } else if (matchedScene.status === 'written') {
                    icon.innerHTML = '⏱';
                } else {
                    icon.innerHTML = '○';
                }

                heading.insertBefore(icon, heading.firstChild);
            }
        });
    }

    function getSceneStatusLabel(status) {
        const labels = {
            'written': 'Ready for breakdown',
            'broken_down': 'Breakdown complete',
            'pending': 'Not yet written',
            'removed': 'Removed from screenplay', failed: 'FAILED' };
        return labels[status] || status;
    }

    async function loadScreenplayDrift() {
        setLegacy('DRIFT', { shots: {}, scenes: [] });
        if (!state.currentProject) return;
        try {
            const res = await api(`/projects/${state.currentProject.id}/screenplay-drift`);
            legacy.DRIFT.scenes = res.scenes || [];
            for (const sc of legacy.DRIFT.scenes) {
                for (const sh of sc.shots_behind) {
                    legacy.DRIFT.shots[sh.shot_id] = { scene: sc.scene_number, generated: sh.generated };
                }
            }
        } catch (_) { /* the board still renders; the warning is additive */ }
    }

export {
    updateSceneStatusIcons,
    getSceneStatusLabel,
    loadScreenplayDrift,
};
