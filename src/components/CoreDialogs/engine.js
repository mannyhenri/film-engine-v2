/*
 * The core dialogs engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. What only CoreDialogs' dialogs call (their inline handlers): the paid confirmation's answer, a new project, the glossary filter, the folder picker, onboarding, the production guide's tabs, the shot card. CoreDialogs puts every function here on window while mounted.
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
    clearModal,
    closeModal,
    closeProductionGuide,
    esc,
    folderPickerApply,
    frameViewerPaint,
    getModalData,
    getNavGuideEntries,
    loadStoryboard,
    navigateTo,
    openProductionGuide,
    openProject,
    regenerateStoryboard,
    renderGlossary,
    renderGuideList,
    renderGuideNextLinks,
    renderProductionGuide,
    setStatus,
    showModal,
} = Object.fromEntries([
    'api',
    'clearModal',
    'closeModal',
    'closeProductionGuide',
    'esc',
    'folderPickerApply',
    'frameViewerPaint',
    'getModalData',
    'getNavGuideEntries',
    'loadStoryboard',
    'navigateTo',
    'openProductionGuide',
    'openProject',
    'regenerateStoryboard',
    'renderGlossary',
    'renderGuideList',
    'renderGuideNextLinks',
    'renderProductionGuide',
    'setStatus',
    'showModal',
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
// Core's values, read live as legacy.X and assigned with setLegacy: CONFIRM_GEN, CONFIRM_GEN_EDITED, CONFIRM_GEN_FINAL_PROMPT, SHOT_CARD, feStore, guideTab.

    // ── Tour ordering ────────────────────────────────────────────────────────────
    // The first-open tour should NOT walk all 24 in nav order — that is a slog.
    // Walk the spine of an actual production, then point at the rest from the Guide.
    const TOUR_SEQUENCE = [
      'settings',     // spec first — expensive to change later
      'screenplay',   // write it
      'scenes',       // parse it
      'characters',   // cast it
      'consistency',  // lock it  ← the AI-native step people skip and regret
      'shotboard',    // plan it
      'storyboard',   // see it
      'videoshots',   // shoot it
      'music',        // score it
      'pipeline',     // automate it
      'budget',       // watch the spend
      'exportpage'    // hand off
    ];

    const ONBOARDING_PAGES = TOUR_SEQUENCE;

    let onboardingIndex = 0;

    function setGuideTab(tab) {
        setLegacy('guideTab', tab);
        document.querySelectorAll('.guide-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.guideTab === tab));
        renderProductionGuide();
    }

    function onboardingStorageKey(projectId) {
        return 'film_project_guide_seen_' + projectId;
    }

    function getOnboardingSteps() {
        const entries = getNavGuideEntries();
        return ONBOARDING_PAGES.map(page => entries.find(entry => entry.page === page)).filter(Boolean);
    }

    function getOnboardingState() {
        if (!state.currentProject) return { dismissed: true, index: 0 };
        try {
            const stored = JSON.parse(legacy.feStore.get(onboardingStorageKey(state.currentProject.id)) || '{}');
            return {
                dismissed: stored.dismissed === true,
                index: Number.isInteger(stored.index) ? Math.max(0, stored.index) : 0,
            };
        } catch (_) {
            return { dismissed: legacy.feStore.get(onboardingStorageKey(state.currentProject.id)) === '1', index: 0 };
        }
    }

    function setOnboardingState(update) {
        if (!state.currentProject) return;
        const current = getOnboardingState();
        legacy.feStore.set(onboardingStorageKey(state.currentProject.id), JSON.stringify({ ...current, ...update }));
    }

    function startProjectOnboarding(options = {}) {
        if (!state.currentProject) return;
        const steps = getOnboardingSteps();
        if (!steps.length) return;
        const stored = getOnboardingState();
        onboardingIndex = options.restart || stored.dismissed ? 0 : Math.min(stored.index || 0, steps.length - 1);
        setOnboardingState({ dismissed: false, index: onboardingIndex });
        closeProductionGuide();
        applyOnboardingSide();
        showModal('projectOnboardingModal');
        renderProjectOnboarding();
    }

    function maybeShowProjectOnboarding() {
        const stored = getOnboardingState();
        if (stored.dismissed) return;
        startProjectOnboarding();
    }

    function renderProjectOnboarding() {
        const steps = getOnboardingSteps();
        onboardingIndex = Math.min(onboardingIndex, Math.max(0, steps.length - 1));
        const step = steps[onboardingIndex] || steps[0];
        const dots = document.getElementById('onboardingStepper');
        const content = document.getElementById('onboardingContent');
        const next = document.getElementById('onboardingNextBtn');
        if (!dots || !content || !next || !step) return;
        if (step.page && state.currentPage !== step.page) navigateTo(step.page);
        setOnboardingState({ dismissed: false, index: onboardingIndex });
        dots.innerHTML = steps.map((_, i) => `<span class="onboarding-dot ${i === onboardingIndex ? 'active' : ''}"></span>`).join('');
        content.innerHTML = `
            <div class="guide-section-card" style="margin-bottom:0;">
                <div class="section-label">Step ${onboardingIndex + 1} of ${steps.length}</div>
                <h4>${esc(step.title)}</h4>
                <p class="text-sm text-muted mb-8">${esc(step.purpose)}</p>
                <div class="guide-meta-grid">
                    <div class="guide-meta"><div class="guide-meta-label">What It Does</div><div class="text-sm">${renderGuideList(step.does)}</div></div>
                    <div class="guide-meta"><div class="guide-meta-label">Next</div><div class="text-sm">${renderGuideNextLinks(step.next)}</div></div>
                </div>
                ${step.note ? `<div class="guide-note">${esc(step.note)}</div>` : ''}
            </div>
        `;
        next.textContent = onboardingIndex >= steps.length - 1 ? 'Finish' : 'Next';
    }

    function nextOnboardingStep() {
        const steps = getOnboardingSteps();
        if (onboardingIndex >= steps.length - 1) {
            dismissProjectOnboarding();
            openProductionGuide();
            return;
        }
        onboardingIndex += 1;
        renderProjectOnboarding();
    }

    function previousOnboardingStep() {
        onboardingIndex = Math.max(0, onboardingIndex - 1);
        renderProjectOnboarding();
    }

    /**
     * Flip the tour panel between the right and left edge.
     *
     * Right is the default because the nav lives on the left and the tour
     * points at it. But some pages put their own controls on the right, so
     * the panel needs an escape hatch rather than a fixed position the user
     * cannot argue with. Remembered across sessions.
     */
    function toggleOnboardingSide() {
        const dock = document.getElementById('projectOnboardingModal');
        if (!dock) return;
        const nowLeft = dock.classList.toggle('dock-left');
        try { localStorage.setItem('film_guide_dock_side', nowLeft ? 'left' : 'right'); } catch (e) { /* private mode */ }
    }

    function applyOnboardingSide() {
        const dock = document.getElementById('projectOnboardingModal');
        if (!dock) return;
        let side = 'right';
        try { side = localStorage.getItem('film_guide_dock_side') || 'right'; } catch (e) { /* private mode */ }
        dock.classList.toggle('dock-left', side === 'left');
    }

    function dismissProjectOnboarding() {
        if (state.currentProject) setOnboardingState({ dismissed: true, index: onboardingIndex });
        closeModal('projectOnboardingModal');
    }

    /**
     * Film or Spot, shown as the FIRST question.
     *
     * It is the highest-leverage choice in the modal: it sets the frame rate,
     * the runtime target and the deliverable set in one action, and every one
     * of those is expensive to discover late. A spot generated at 24fps for a
     * 29.97 CTV buy cannot be conformed afterwards, and a vertical placement
     * decided after the board is a crop that keeps a third of the frame.
     */
    function onProjectTypeChange() {
        const type = (document.getElementById('newProjectType') || {}).value || 'film';
        for (const el of document.querySelectorAll('#newProjectModal [data-when]')) {
            el.style.display = el.dataset.when === type ? '' : 'none';
        }
        // A spot's frame rate is a media-plan decision, not a taste one, so the
        // default moves to the rate air and CTV are bought at. Still editable.
        const fps = document.querySelector('#newProjectModal [data-field="target_fps"]');
        if (fps && type === 'spot' && [...fps.options].some(o => o.value === '29.97')) fps.value = '29.97';
        if (type === 'spot') loadNewProjectBrands();
    }

    async function loadNewProjectBrands() {
        const sel = document.getElementById('newProjectBrand');
        if (!sel || sel.options.length) return;
        try {
            const data = await api('/brands');
            sel.innerHTML = '<option value="">No brand yet</option>'
                + (data.brands || []).map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
        } catch (_) { sel.innerHTML = '<option value="">No brand yet</option>'; }
    }

    function folderPickerChoose() {
        closeModal('folderPickerModal');
        folderPickerApply();
    }

    async function createProject() {
        const data = getModalData('newProjectModal');
        if (!data.title) return;
        const type = (document.getElementById('newProjectType') || {}).value || 'film';
        const location = ((document.getElementById('newProjectLocation') || {}).value || '').trim();
        if (location) data.assets_parent = location;
        try {
            const p = await api('/projects', { method: 'POST', body: JSON.stringify(data) });
            // Where this answer was given becomes the default next time.
            if (location) api('/settings', { method: 'PUT', body: JSON.stringify({ projects_root: location }) }).catch(() => {});

            /*
             * A spot's own facts, and its deliverable set, in the same action.
             * Written AFTER creation rather than as part of it because the
             * create route owns a film's fields and this is deliberately
             * additive: a project is a film unless somebody says otherwise, and
             * everything already in this tool is one.
             *
             * Failures here are reported and do not undo the project: the
             * project exists and is usable, and losing it because a deliverable
             * package could not be applied would be the worse outcome.
             */
            if (type === 'spot') {
                const spot = {
                    client: (document.getElementById('newProjectClient') || {}).value || '',
                    campaign: (document.getElementById('newProjectCampaign') || {}).value || '',
                    brand_id: (document.getElementById('newProjectBrand') || {}).value || '',
                    target_duration_ms: Number((document.getElementById('newProjectLength') || {}).value) || 0,
                };
                try { await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(spot) }); }
                catch (err) { setStatus('Project created, but its spot details did not save: ' + err.message); }

                const pkg = (document.getElementById('newProjectPackage') || {}).value;
                if (pkg) {
                    try {
                        const out = await api(`/projects/${p.id}/deliverables/plan`,
                            { method: 'POST', body: JSON.stringify({ package: pkg }) });
                        /*
                         * The package sets the project's shape and RATE as well
                         * as its file list, so the confirmation says what it
                         * chose: a frame rate is not something to discover on
                         * an export, and a spot generated at the wrong one
                         * cannot be conformed afterwards.
                         */
                        const ps = out.project_settings;
                        if (ps) Object.assign(p, {
                            aspect_ratio: ps.aspect_ratio,
                            target_resolution: ps.target_resolution,
                            target_fps: ps.target_fps,
                        });
                        setStatus(`Spot created — ${out.created} deliverable(s)`
                            + (ps ? `, ${ps.target_resolution} @ ${ps.target_fps}fps` : '')
                            + `, shoot native: ${(out.native_ratios || []).join(', ') || 'none'}`);
                        if (ps) alert(`This spot is set up:\n\n`
                            + `${ps.target_resolution} · ${ps.aspect_ratio} · ${ps.target_fps}fps\n`
                            + `${out.created} deliverables\n`
                            + `Shot natively at: ${(out.native_ratios || []).join(', ') || 'nothing extra'}\n\n`
                            + ps.why);
                    } catch (err) { setStatus('Project created, but the deliverables did not: ' + err.message); }
                }
            }

            closeModal('newProjectModal');
            clearModal('newProjectModal');
            state.currentProject = p;
            openProject(p.id);
            if (type !== 'spot') setStatus(p.assets_dir ? `Project created — files in ${p.assets_dir}` : 'Project created');
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    function readBlockingPanel(p) {
        const pick = key => {
            const boxes = document.querySelectorAll(`[data-blocking="${key}"]`);
            if (!boxes.length) return undefined;
            return [...boxes].filter(b => b.checked).map(b => b.value);
        };
        const pinned = [...document.querySelectorAll('[data-keep-plate]')]
            .filter(b => b.checked).map(b => b.value);
        const dir = document.getElementById(p + 'Direction');
        const written = document.getElementById(p + 'Written');
        return {
            characters: pick('characters'),
            props: pick('props'),
            direction: dir ? dir.value.trim() : undefined,
            description: written ? written.value.trim() : undefined,
            keep_plates: pinned,
            location_view: (() => {
                const el = document.getElementById(p + 'LocationView');
                const v = el ? el.value : '';
                return v === '__new__' ? undefined : v;
            })(),
        };
    }

    /** What to save: undefined leaves it alone, null follows the film, a string is the shot's. */
    function shotCardStyleValue() {
        const box = document.getElementById('shotCardStyle');
        if (!box) return undefined;
        const had = typeof (legacy.SHOT_CARD.card.generation || {}).style === 'string';
        if (legacy.SHOT_CARD.styleMode === 'film') return had ? null : undefined;
        return box.value.trim();
    }

    function readDirectingPanel(p, existingCamera) {
        const camera = { ...(existingCamera || {}) };
        const val = id => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
        const set = (k, v) => { if (v === '' || v === null || v === undefined) delete camera[k]; else camera[k] = v; };
        set('shot_type', val(p + 'ShotType'));
        if (document.getElementById(p + 'Framing')) set('framing', val(p + 'Framing'));
        set('movement', val(p + 'Movement'));
        set('lens', val(p + 'Lens'));
        set('sensor', val(p + 'Sensor'));
        set('note', val(p + 'Note'));
        for (const [field, key] of [['HeightM', 'height_m'], ['Aperture', 'aperture'],
            ['FocusDistanceM', 'focus_distance_m']]) {
            const raw = val(p + field);
            set(key, raw === '' ? '' : Number(raw));
        }
        return camera;
    }

    async function saveShotCard(regenerate) {
        const shotId = legacy.SHOT_CARD.shotId;
        if (!shotId) return;
        const warn = document.getElementById('shotCardWarning');
        const fail = msg => {
            warn.style.display = 'block';
            warn.style.color = 'var(--gl-danger, #ef4444)';
            warn.textContent = msg;
        };
        const val = id => document.getElementById(id).value.trim();
        // Camera and lighting are MERGED into what the card already holds, not
        // rebuilt from these four fields — a card carries sensor, aperture and
        // height the editor does not show, and rebuilding would drop whatever
        // previs wrote the last time a shot was blocked.
        const camera = readDirectingPanel('shotCard', legacy.SHOT_CARD.card.camera);
        const lighting = typeof legacy.SHOT_CARD.card.lighting === 'string'
            ? { type: legacy.SHOT_CARD.card.lighting } : { ...(legacy.SHOT_CARD.card.lighting || {}) };
        const set = (obj, key, value) => { if (value) obj[key] = value; else delete obj[key]; };
        set(lighting, 'type', val('shotCardLighting'));
        set(lighting, 'technique', val('shotCardLightTechnique'));
        set(lighting, 'key_side', val('shotCardLightKeySide'));

        /*
         * Both halves are sent, and they stay two halves. `description` is the
         * screenplay's account of the shot and `direction` is what a director
         * added on top — kept apart so a script revision can replace its own
         * half without discarding the direction, and so the board can show the
         * writing rather than a paraphrase of it.
         *
         * A blank description is never SENT rather than being refused: the
         * route merges, so omitting it leaves whatever the screenplay put
         * there. Sending an empty string would quietly erase the shot's own
         * account of itself, and a shot with no description generates from
         * nothing at all.
         */
        const blocking = readBlockingPanel('shotCard');
        const body = { camera, lighting };

        /*
         * The motion fields, read straight off the panel. They are CARD-level
         * rather than camera-level: what the world does and where the shot ends
         * are facts about the shot, not about the lens.
         *
         * Empty clears, which is why each is sent even when blank — the two
         * states ("no environment motion" and "don't change it") are genuinely
         * different and the route merges, so an omitted field would be
         * unclearable from this panel.
         */
        {
            const txt = id => { const el = document.getElementById(id); return el ? String(el.value).trim() : null; };
            const env = txt('shotCardEnvMotion');
            const end = txt('shotCardEndState');
            const bts = txt('shotCardBeats');
            if (env !== null) body.environment_motion = env;
            if (end !== null) body.end_state = end;
            if (bts !== null) body.beats = bts.split('\n').map(x => x.trim()).filter(Boolean);
            // generation merges on the route; null clears the negative prompt.
            const neg = txt('shotCardNegPrompt');
            if (neg !== null) body.generation = { negative_prompt: neg || null };
            // The shot's own style: absent follows the film, '' is none, text is
            // this shot's. null on the route returns it to the film's.
            const st = shotCardStyleValue();
            if (st !== undefined) body.generation = { ...(body.generation || {}), style: st };
        }
        if (blocking.direction !== undefined) body.direction = blocking.direction;
        if (blocking.description) body.description = blocking.description;
        if (blocking.location_view !== undefined) body.location_view = blocking.location_view;
        // Lists REPLACE on the route, which is what makes removing a character
        // from a shot expressible — so they are only sent when the panel is
        // actually present, never as an empty array that would silently clear
        // a cast the editor never showed.
        if (blocking.characters !== undefined) body.characters = blocking.characters;
        if (blocking.props !== undefined) body.props = blocking.props;

        try {
            await api(`/shots/${shotId}`, { method: 'PUT', body: JSON.stringify(body) });
        } catch (err) {
            return fail('Could not save: ' + err.message);
        }
        closeModal('shotCardModal');
        if (regenerate) {
            const picked = document.querySelector('input[name="shotCardMode"]:checked');
            await regenerateStoryboard(shotId, picked ? picked.value : 'action', blocking.keep_plates);
        } else {
            setStatus('Card saved. The existing frame is now stale — regenerate to see the change.');
        }
        await loadStoryboard();
        // The viewer, if it is open over the grid, is still showing the old words.
        const modal = document.getElementById('frameViewerModal');
        if (modal && modal.classList.contains('open')) frameViewerPaint();
    }

    function confirmGenResolve(ok) {
        /*
         * Read the edited prompt BEFORE the modal closes.
         *
         * closeModal tears the field out of the DOM, so reading it afterwards
         * returns nothing and the edit is silently discarded — the user watches
         * their text vanish into a generation that ignored it.
         */
        const box = document.getElementById('confirmGenPrompt');
        setLegacy('CONFIRM_GEN_FINAL_PROMPT', (ok && box && legacy.CONFIRM_GEN_EDITED && box.value.trim())
            ? box.value.trim() : null);

        closeModal('confirmGenModal');
        const fn = legacy.CONFIRM_GEN;
        setLegacy('CONFIRM_GEN', null);
        if (fn) fn(!!ok);
    }

    function filterGlossary() {
        const val = document.getElementById('glossarySearch').value;
        renderGlossary(val);
    }

export {
    TOUR_SEQUENCE,
    ONBOARDING_PAGES,
    onboardingIndex,
    setGuideTab,
    onboardingStorageKey,
    getOnboardingSteps,
    getOnboardingState,
    setOnboardingState,
    startProjectOnboarding,
    maybeShowProjectOnboarding,
    renderProjectOnboarding,
    nextOnboardingStep,
    previousOnboardingStep,
    toggleOnboardingSide,
    applyOnboardingSide,
    dismissProjectOnboarding,
    onProjectTypeChange,
    loadNewProjectBrands,
    folderPickerChoose,
    createProject,
    readBlockingPanel,
    shotCardStyleValue,
    readDirectingPanel,
    saveShotCard,
    confirmGenResolve,
    filterGlossary,
};
