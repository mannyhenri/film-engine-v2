/*
 * The storyboard engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. What only the Storyboard reaches of core: the anchor, impact and drift notices, frame versions, recompose, re-sync, the background picker, a frame's import, sending and audit, and the board's shared card parts. StoryboardPage.jsx calls them as E.x and puts every one on window while mounted (the HTML core and this engine draw calls them by name), and its own dialogs (background picker, frame versions) reach them that way.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { legacy, setLegacy } from '../../lib/legacy.js';

// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:
// a line reading `const esc = …` would be the first definition a backend test finds when it searches the page.
const {
    annotationFeedbackOn,
    api,
    checkUploadSize,
    closeModal,
    confirmChoices,
    confirmExtras,
    confirmGenArm,
    confirmPaidImage,
    cueExtensionOf,
    esc,
    escapeHtml,
    frameBusy,
    frameViewerPaint,
    loadScreenplayDrift,
    loadStoryboard,
    markCurrentShot,
    markupDisarm,
    markupDraw,
    markupLoad,
    markupPaintFeedBadge,
    navigateTo,
    paintGenOptions,
    plateSrc,
    setStatus,
    showModal,
    showModalHtml,
    streamSSE,
} = Object.fromEntries([
    'annotationFeedbackOn',
    'api',
    'checkUploadSize',
    'closeModal',
    'confirmChoices',
    'confirmExtras',
    'confirmGenArm',
    'confirmPaidImage',
    'cueExtensionOf',
    'esc',
    'escapeHtml',
    'frameBusy',
    'frameViewerPaint',
    'loadScreenplayDrift',
    'loadStoryboard',
    'markCurrentShot',
    'markupDisarm',
    'markupDraw',
    'markupLoad',
    'markupPaintFeedBadge',
    'navigateTo',
    'paintGenOptions',
    'plateSrc',
    'setStatus',
    'showModal',
    'showModalHtml',
    'streamSSE',
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
const { WORLD, state } = Object.fromEntries(['WORLD', 'state'].map(n => [n, live(n)]));
// Core's values, read live as legacy.X and assigned with setLegacy: API_BASE, CONFIRM_GEN, DRIFT, FRAME_VIEWER.

    /**
     * Fill the banner strip above the board, after the frames are painted.
     *
     * Guarded on still being on the same board: these take seconds on a real
     * project, and a director who has navigated away in the meantime should not
     * have a banner from the previous film appear over the new one.
     */
    async function loadBoardBanners() {
        const projectAtStart = state.currentProject && state.currentProject.id;
        await loadScreenplayDrift();
        await loadImpact();
        const host = document.getElementById('boardBanners');
        if (!host) return;
        if (!state.currentProject || state.currentProject.id !== projectAtStart) return;
        // One strip for both notices now — impactBanner() composes them, so the
        // board gets a single line rather than two stacked paragraphs.
        host.innerHTML = impactBanner();
        /*
         * The per-frame marks read the same two reports, so they are repainted
         * once the reports are in. Without this the banner would say six shots
         * are behind and no frame would carry a mark — a warning with nothing
         * to point at, which is the state the tag exists to prevent.
         */
        for (const f of (legacy.FRAME_VIEWER.frames || [])) {
            const cell = document.querySelector(`[data-facets="${f.shot_id}"]`);
            if (cell) cell.innerHTML = storyboardFacetTags(f);
        }
    }

    /** Normalise browser-supported images to the one durable board format. */
    function storyboardImportButton(frame) {
        return `<label class="btn btn-secondary btn-sm" style="cursor:pointer;" title="Use a local image as this shot's storyboard frame">
            Import<input data-import-target="storyboard-image" type="file" accept="image/*" style="display:none" onchange="importStoryboardImage(event,'${frame.shot_id}')">
        </label>`;
    }

    function importImageAsPng(file) {
        return new Promise((resolve, reject) => {
            if (!file || !String(file.type || '').startsWith('image/')) return reject(new Error('Choose an image file.'));
            const url = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
                    canvas.getContext('2d').drawImage(image, 0, 0);
                    resolve(canvas.toDataURL('image/png'));
                } catch (err) { reject(err); }
                finally { URL.revokeObjectURL(url); }
            };
            image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The selected image could not be read.')); };
            image.src = url;
        });
    }

    async function importStoryboardImage(event, shotId) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        setStatus('Importing storyboard frame…');
        try {
            const data = await importImageAsPng(file);
            checkUploadSize(file, `/shots/${shotId}/storyboard/import`);
            const result = await api(`/shots/${shotId}/storyboard/import`, {
                method: 'POST', body: JSON.stringify({ name: file.name, data }),
            });
            setStatus(`Imported ${file.name} as storyboard v${result.version}.`);
            await loadStoryboard();
        } catch (err) { setStatus('Storyboard import failed: ' + err.message); }
        finally { event.target.value = ''; }
    }

    /**
     * What the version button says, and what it means.
     *
     * Restoring moves FORWARD: pick v3 and it comes back as v6, so v4 and v5
     * survive rather than being destroyed to undo one choice. Right, and it
     * makes the number stop describing the picture — the card read "v6" over
     * v3's frame with nothing to explain it, which reads as the restore having
     * failed and picking the wrong version.
     *
     * So the label names both when they differ: `v6 ← v3`. When they agree,
     * which is the normal case, it stays a plain number.
     */
    function frameVersionLabel(f) {
        const v = f.asset_version || 1;
        const shows = f.asset_shows_version;
        return (shows && shows !== v) ? `v${v} \u2190 v${shows}` : `v${v}`;
    }

    function frameVersionTitle(f) {
        const v = f.asset_version || 1;
        const shows = f.asset_shows_version;
        return (shows && shows !== v)
            ? `Attempt ${v}, showing the picture from attempt ${shows} — restoring adds a new version `
                + 'rather than deleting the ones after it. Click to see every attempt.'
            : 'Every attempt at this shot \u2014 go back to one';
    }

    // ── Every attempt at a shot, and the way back to one ───────────────────
    //
    // Regeneration overwrites the frame at a fixed name, and the outgoing
    // picture has been archived to {code}_v{n}.png for a while — so the
    // attempts were all on disk and there was no way to look at them. Kept and
    // unreachable is barely better than not kept: the reason to keep them is
    // that generation is a coin flip you already paid for, and v2 is often the
    // one you wanted.


    /**
     * Put a picture on a different shot.
     *
     * "There is a shot I'd like to put to 2A from 2B." Generation is a coin
     * flip you already paid for, and the frame that came back on one shot is
     * sometimes the right shot for another — without this the only way there
     * was to regenerate and hope, paying twice for a picture already on the
     * board.
     *
     * The picker lists the project's other shots by code, because a shot id is
     * not something anyone can choose between. Shots that already have frames
     * say so, since sending to one means its current frame moves into history
     * rather than being replaced — true, and worth knowing before choosing.
     */
    async function sendFrameTo(shotId, version) {
        if (!state.currentProject) return;
        let board;
        try {
            board = await api(`/projects/${state.currentProject.id}/storyboard`);
        } catch (err) { return setStatus('Could not read the shot list: ' + err.message); }

        const others = (board.frames || []).filter(f => f.shot_id !== shotId);
        if (!others.length) return setStatus('There is no other shot in this project to send it to.');

        const lines = others.map((f, i) =>
            `${i + 1}. ${f.shot_code}${f.scene_number != null ? ` (Sc${f.scene_number})` : ''}`
            + (f.has_frame || f.image_url ? ' — has a frame' : ''));
        const pick = prompt(
            `Send v${version} to which shot?\n\n`
            + 'It is COPIED: this shot keeps the version, and the target gains one.\n'
            + "A shot that already has a frame keeps it in its history.\n\n"
            + lines.join('\n') + '\n\nType the number:');
        if (!pick) return;
        const idx = parseInt(pick, 10) - 1;
        const target = others[idx];
        if (!target) return setStatus('That is not one of the shots listed.');

        setStatus(`Sending v${version} to ${target.shot_code}...`, true);
        try {
            const r = await api(`/shots/${shotId}/frames/${version}/send`, {
                method: 'POST', body: JSON.stringify({ target_shot_id: target.shot_id }),
            });
            setStatus(`${r.from_shot_code} v${r.from_version} is now ${r.to_shot_code} v${r.to_version}. `
                + (r.caution || ''));
            closeFrameVersions();
            await loadStoryboard();
        } catch (err) {
            setStatus('Could not send that frame: ' + err.message);
        }
    }

    async function openFrameVersions(shotId) {
        let data;
        try {
            data = await api(`/shots/${shotId}/frames`);
        } catch (err) { return setStatus('Could not read the versions: ' + err.message); }

        // Everything is listed, including attempts whose picture was never
        // kept. They are real history — they record that a generation happened
        // and what it cost — and hiding them would rewrite the ledger. What
        // changes is that they cannot be chosen and say why.
        const versions = data.versions || [];
        if (!versions.length) return setStatus('This shot has no generated frames yet.');

        document.getElementById('frameVersionsTitle').textContent =
            `${data.shot_code} \u2014 ${versions.length} attempt(s), ${data.restorable_count} restorable`;

        document.getElementById('frameVersionsBody').innerHTML = versions.map(v => {
            // A version you cannot choose is shown differently from one you can,
            // or the grid reads as a chooser with dead entries in it.
            const border = v.is_current ? 'var(--gl-brand-pink,#ec4899)'
                : v.restorable ? 'var(--gl-border-subtle)' : 'rgba(148,163,184,.25)';
            // Cache-busted per version. Without this the browser serves one
            // cached image for every row that shares a filename, which is what
            // made seven attempts look identical even after the API was fixed.
            const src = `${legacy.API_BASE}${v.url}${v.url.includes('?') ? '&' : '?'}v=${v.version}`;
            const made = v.created_at ? String(v.created_at).replace('T', ' ').slice(0, 16) : '';
            const by = [v.provider, v.provider_model].filter(Boolean).join(' \u00b7 ');

            return `
            <div style="border:1px solid ${border};border-radius:6px;overflow:hidden;
                        ${v.restorable || v.is_current ? '' : 'opacity:.55;'}">
                <img src="${src}" style="width:100%;display:block;background:#000;"
                     onerror="this.style.display='none'">
                <div style="padding:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div class="text-sm" style="min-width:0;">
                        <strong>v${v.version}</strong>${v.is_current ? ' &middot; on the board' : ''}${
                            v.shows_version && v.shows_version !== v.version
                                ? ' <span class="text-muted">(shows v' + v.shows_version + ')</span>' : ''}
                        <br><span class="text-muted">${esc(v.origin || '')}</span>
                        ${by ? '<br><span class="text-muted">' + esc(by) + '</span>' : ''}
                        ${made ? '<br><span class="text-muted">' + esc(made) + '</span>' : ''}
                        ${v.reason ? '<br><span class="text-muted" style="font-style:italic;">'
                            + esc(v.reason) + '</span>' : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                    ${v.restorable
                        ? `<button class="btn btn-primary btn-sm"
                             onclick="restoreFrameVersion('${shotId}', ${v.version})">Select</button>`
                        : ''}
                    ${v.exists && !v.reason
                        ? `<button class="btn btn-secondary btn-sm"
                             title="Keep this picture and change one thing about it. The result is a new version; this one stays."
                             onclick="closeFrameVersions(); refineFrame('${shotId}', ${v.version})">Refine</button>`
                        : ''}
                    ${v.exists && !v.reason
                        ? `<button class="btn btn-secondary btn-sm"
                             title="Keep this performance and framing, and put a different background behind it."
                             onclick="recomposeFrame('${shotId}', ${v.version})">New background&hellip;</button>`
                        : ''}
                    ${v.exists && !v.reason
                        ? `<button class="btn btn-secondary btn-sm"
                             title="Put this picture on a different shot. It is copied — this shot keeps it too."
                             onclick="sendFrameTo('${shotId}', ${v.version})">Send to&hellip;</button>`
                        : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
        document.getElementById('frameVersionsNote').textContent = data.note || '';
        showModal('frameVersionsModal');
    }

    function closeFrameVersions() {
        closeModal('frameVersionsModal');
    }

    async function restoreFrameVersion(shotId, version) {
        try {
            const r = await api(`/shots/${shotId}/frames/${version}/restore`, { method: 'POST' });
            setStatus(r.note || `v${version} restored.`);
            closeFrameVersions();
            await loadStoryboard();
            const modal = document.getElementById('frameViewerModal');
            if (modal && modal.classList.contains('open')) frameViewerPaint();
        } catch (err) { setStatus('Could not restore that version: ' + err.message); }
    }

    // ── The frame you are currently shooting from ──────────────────────────
    //
    // Point at the frame that has the scene right and the next shot you Regen
    // keeps all of it — location, dressing, subject placement — and changes
    // only the camera to whatever that shot's own card asks for. It also
    // replaces the plates it makes redundant, so a subject already standing in
    // the anchor does not spend one of three reference slots being described in
    // the abstract.
    //
    // ONE at a time, and only when you set one. The first version derived an
    // anchor per scene automatically, so anchoring 1A lit up an anchor on 2A as
    // well — anchoring is something you pick up while working on 1B and 1C and
    // put down afterwards, not a property every scene has.
    const ANCHOR = { frames: [] };

    function anchorShotId() {
        return (state.currentProject && state.currentProject.anchor_shot_id) || null;
    }

    function renderAnchorChip() {
        const chip = document.getElementById('anchorChip');
        const text = document.getElementById('anchorChipText');
        if (!chip || !text) return;
        const id = anchorShotId();
        if (!id) { chip.style.display = 'none'; return; }
        const f = (ANCHOR.frames || []).find(x => x.shot_id === id);
        text.textContent = '\u2693 shooting from ' + (f ? f.shot_code : 'a frame');
        chip.style.display = 'inline-flex';
    }

    async function setAnchor(shotId) {
        if (!state.currentProject) return;
        try {
            const r = await api('/projects/' + state.currentProject.id + '/anchor', {
                method: 'PUT', body: JSON.stringify({ shot_id: shotId }),
            });
            state.currentProject.anchor_shot_id = r.anchor_shot_id;
            setStatus(`Shooting from ${r.shot_code}. Press Regen on another shot to rebuild it `
                + 'from that frame — same set, same placement, new camera.');
            loadStoryboard();
        } catch (err) {
            // The common refusal is anchoring a frame that does not exist yet,
            // and the message says so rather than "400".
            setStatus('Could not anchor that: ' + err.message);
        }
    }

    async function clearAnchor() {
        if (!state.currentProject) return;
        try {
            await api('/projects/' + state.currentProject.id + '/anchor', { method: 'DELETE' });
            state.currentProject.anchor_shot_id = null;
            setStatus('Anchor cleared. Shots generate from their own card and their plates again.');
            loadStoryboard();
        } catch (err) { setStatus('Could not clear the anchor: ' + err.message); }
    }

    /**
     * The anchor control on a frame.
     *
     * Three states needing three different actions: this frame is the anchor
     * (put it down), another frame is (take it instead), or none is (pick this
     * one up). A single button would make the first two indistinguishable.
     */
    function anchorButton(f) {
        if (f.anchor && f.anchor.is_anchor) {
            return `<button class="btn btn-sm" style="border-color:var(--gl-brand-pink,#ec4899);"
                onclick="clearAnchor()"
                title="Everything you Regen is being built from this frame. Click to put it down.">&#9875; shooting from this</button>`;
        }
        // Nothing to shoot from until it has been generated.
        if (!f.image_url) return '';
        const held = anchorShotId() ? 'Shoot from this one instead' : 'Shoot the next shots from this frame';
        return `<button class="btn btn-secondary btn-sm" onclick="setAnchor('${f.shot_id}')"
            title="${held} — its location, dressing and subject placement, re-shot on each shot's own lens and angle">&#9875;</button>`;
    }

    function renderAnnotationFeedbackToggle() {
        const box = document.getElementById('annotFeedbackToggle');
        const text = document.getElementById('annotFeedbackText');
        if (!box || !text) return;
        const on = annotationFeedbackOn();
        box.checked = on;
        text.textContent = on ? 'Marks steer generation' : 'Marks are notes only';
    }

    /** The grid card's image calls this on load; kept as its own name. */
    function storyboardDrawAnnotations(shotId) {
        markupDraw('annot-' + shotId, 'img-' + shotId, shotId);
        // The badge is state about the marks, not about the picture, but this
        // is the one callback that fires for every card after a board reload.
        markupLoad(shotId).then(() => markupPaintFeedBadge(shotId));
    }

    /**
     * Change what a frame is generated from.
     *
     * The card is the only thing a regeneration reads, so a frame that came
     * back wrong could not be fixed inside the app at all: you could regenerate
     * it from exactly the same words, forever. This is the loop closing — look
     * at the frame, change the description, generate again.
     */
    /**
     * The facets under a frame, as the way in to changing them.
     *
     * They read as labels and were labels: the board said "establishing ·
     * 40mm anamorphic · push-in · blue-hour" and there was nowhere to edit any
     * of it. Each is the thing it describes, so clicking it opens the card at
     * the field it came from — the answer to "where do I change this" should be
     * the thing itself, not a menu somewhere else.
     */
    function storyboardFacetTags(f) {
        const light = (f.lighting && typeof f.lighting === 'object') ? f.lighting : {};
        // The EFFECTIVE camera, not the card's. On a blocked shot they are
        // different, and the card's is exactly the set of values generation is
        // going to ignore — so the board was showing the wrong lens with total
        // confidence.
        const e = f.effective || {};
        const facet = k => (e[k] && e[k].value) || '';
        const from = k => (e[k] && e[k].source) || 'card';
        // The shot SIZE is the one the prompt says (lib/framing, via the
        // effective camera). A size word in shot_type is not shown beside it.
        const SIZE_WORDS = ['establishing', 'wide', 'medium', 'close-up', 'extreme-close-up'];
        const shotType = facet('shot_type');
        const facets = [
            ['shotCardFraming', facet('framing') ? String(facet('framing')).toUpperCase() : '', from('framing')],
            ['shotCardShotType', shotType, from('shot_type')],
            ['shotCardLens', facet('lens'), from('lens')],
            ['shotCardMovement', facet('movement'), from('movement')],
            ['shotCardLighting', light.type || (typeof f.lighting === 'string' ? f.lighting : ''), 'card'],
        ].filter(([field, v]) => !(field === 'shotCardShotType' && (SIZE_WORDS.includes(v) || !v)));
        const WHERE = {
            blocking: ['staged in previs — this beats the card', 'var(--gl-brand-cyan, #38bdf8)'],
            film: ['the production default — no shot chose this', 'var(--gl-text-muted, #94a3b8)'],
            card: ['written on the scene card', ''],
        };
        const tags = facets.filter(([, v]) => v).map(([field, v, src]) => {
            const [why, colour] = WHERE[src] || WHERE.card;
            // A staged facet opens previs, a written one opens the card. The
            // way in should be the place the value actually comes from.
            const go = src === 'blocking'
                ? `previsOpenFromBoard('${f.shot_id}')`
                : `editShotCard('${f.shot_id}','${field}')`;
            return `<span class="tag" style="cursor:pointer;${colour ? 'border-color:' + colour + ';color:' + colour + ';' : ''}"
                   title="${esc(why)} — click to change"
                   onclick="${go}">${esc(v)}</span>`;
        }).join('');
        // An unset facet is worth showing as unset: a frame with no lighting
        // named is generating without one, which reads as a choice only if you
        // can see it was never made.
        const missing = facets.filter(([, v]) => !v).length;
        const add = missing
            ? `<span class="tag" style="cursor:pointer;opacity:.6;"
                     title="${missing} of shot size, lens, movement and lighting are not set"
                     onclick="editShotCard('${f.shot_id}')">+ ${missing} unset</span>`
            : '';
        const dur = f.duration_ms ? `<span class="tag">${(f.duration_ms / 1000).toFixed(1)}s</span>` : '';
        return screenplayDriftTag(f) + impactTag(f) + dialogueTag(f) + tags + add + dur + storyboardPrevisTag(f);
    }

    /**
     * Does this shot SPEAK, and is the speaker in frame?
     *
     * The board showed framing, lens, movement, lighting and duration, and
     * said nothing about the one field that decides the voice track. A shot
     * with a line and a shot without are different shots to direct and
     * different shots to generate, and you could not tell them apart here.
     *
     * A voice-over is marked differently on purpose, because it is the
     * opposite instruction: the line is heard and NO mouth in frame moves.
     */
    function dialogueTag(f) {
        const lines = Array.isArray(f.dialogue) ? f.dialogue.filter(Boolean) : [];
        if (!lines.length) return '';
        const off = lines.every(l => {
            const ext = cueExtensionOf(l).replace(/[\s.]+/g, '');
            return /^(VO|OS|OC)$/i.test(ext);
        });
        const colour = off ? 'var(--gl-warning,#f59e0b)' : 'var(--gl-brand-cyan,#38bdf8)';
        const first = String(lines[0].line || '').slice(0, 70);
        const label = off ? `V.O. \u00d7${lines.length}` : `speaks \u00d7${lines.length}`;
        return `<span class="tag" style="cursor:pointer;border-color:${colour};color:${colour};"
            title="${esc(first)}${lines.length > 1 ? ' \u2026' : ''}"
            onclick="editShotCard('${f.shot_id}')">${label}</span>`;
    }

    /**
     * Whether this shot was staged, and whether the sign-off still stands.
     *
     * Locking a move in previs changed nothing visible on the board, so the
     * whole experiment-then-commit loop had no evidence anywhere except the
     * stage you left. Three states, because "approved" and "approved, then
     * restaged" are what the loop turns on — and the second one is a 409 at
     * generation time that the director had no way to see coming.
     */
    function storyboardPrevisTag(f) {
        const p = f.previs || {};
        if (!p.blocked) {
            return `<span class="tag" style="cursor:pointer;opacity:.55;"
                title="not staged — the frame comes from the written card"
                onclick="previsOpenFromBoard('${f.shot_id}')">block in previs</span>`;
        }
        const [label, colour, why] = p.approved && p.stale
            ? ['staged · changed since approval', 'var(--gl-warning, #f59e0b)',
               'approved, then restaged — generation refuses until you re-approve']
            : p.approved
                ? ['approved', 'var(--gl-success, #22c55e)', 'signed off as it stands']
                : ['staged', 'var(--gl-brand-cyan, #38bdf8)', 'blocked but not approved'];
        return `<span class="tag" style="cursor:pointer;border-color:${colour};color:${colour};"
            title="${esc(why)}" onclick="previsOpenFromBoard('${f.shot_id}')">${label}</span>`;
    }

    /** Open the 3D stage on this shot, from the frame you were looking at. */
    async function previsOpenFromBoard(shotId) {
        closeModal('frameViewerModal');
        markupDisarm();
        // The console opens on this shot rather than the first: the page's
        // loader reads the choice before it picks a default.
        WORLD.shotId = shotId;
        navigateTo('previs');
    }

    /**
     * A LINE, NOT A LECTURE.
     *
     * This was two full-width cards of prose stacked above the board, and the
     * director's verdict on them was "intrusive" — which is the correct word
     * for a paragraph that appears every time you open a page and whose only
     * affordance is a button saying "ignore". The explanation was good and it
     * was still wrong, because a warning read once is documentation and a
     * warning read forty times is furniture.
     *
     * So: one line, the count, and the actions. The prose that used to be the
     * banner is still here, one click away under "why", for the first time
     * someone meets it. Everything that reads as an instruction to the person
     * — what to fix, in what order — belongs in the audit and the resync plan,
     * which are the things that can actually be acted on.
     */
    function noticeStrip(items) {
        const live = items.filter(Boolean);
        if (!live.length) return '';
        const rows = live.map(it => `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;
                 padding:5px 0;line-height:1.4;">
            <span style="width:7px;height:7px;border-radius:50%;background:${it.colour};flex:none;"></span>
            <span class="text-sm" style="color:${it.colour};font-weight:600;">${it.title}</span>
            <span class="text-sm text-muted">${it.detail}</span>
            <span style="flex:1;"></span>
            ${it.actions}
        </div>
        <div id="${it.id}Why" class="text-sm text-muted" hidden
             style="margin:0 0 6px 15px;padding:8px 10px;border-left:2px solid ${it.colour};line-height:1.55;">
            ${it.why}
        </div>`).join('');
        return `<div class="card" style="grid-column:1/-1;padding:6px 12px;">${rows}</div>`;
    }

    function toggleWhy(id) {
        const el = document.getElementById(id);
        if (el) el.hidden = !el.hidden;
    }

    /** The screenplay half of the strip. */
    function screenplayDriftNotice() {
        if (!legacy.DRIFT.scenes.length) return null;
        const shots = legacy.DRIFT.scenes.reduce((n, s) => n + s.shots_behind.length, 0);
        const where = legacy.DRIFT.scenes.map(s => `scene ${esc(s.scene_number)}`).join(', ');
        return {
            id: 'drift',
            colour: 'var(--gl-warning,#f59e0b)',
            title: 'Screenplay changed',
            detail: `${shots} shot${shots === 1 ? '' : 's'} \u00b7 ${where}`,
            actions: `
                <button class="btn btn-primary btn-sm" onclick="previewResync()"
                        title="Show exactly what a resync would change. Nothing is written until you say so.">Resync\u2026</button>
                <button class="btn btn-secondary btn-sm" onclick="runShotAudit()"
                        title="Check every card for subjects that would reach the model as neither picture nor description \u2014 free">Audit</button>
                <button class="btn btn-ghost btn-sm" onclick="toggleWhy('driftWhy')">why</button>
                <button class="btn btn-ghost btn-sm" onclick="acceptScreenplayDrift(this)"
                        title="Record these cards as still matching the screenplay \u2014 free">Still matches</button>`,
            why: `${where} changed after ${shots === 1 ? 'this card was' : 'these cards were'} written, so
                ${shots === 1 ? 'it still describes' : 'they still describe'} the previous version of the story.
                Nothing is blocked. <strong>Resync</strong> reconciles what can be reconciled without a
                judgement \u2014 who and what is in each frame, dialogue that still matches word for word \u2014
                and shows you the plan first. It never rewrites a description and never deletes a shot.
                Anything needing a decision comes back as a list. The affected frames are marked below.`,
        };
    }

    /** "I read the new scene, and these cards still hold." One act, stated. */
    async function acceptScreenplayDrift(btn) {
        if (!state.currentProject) return;
        const shots = legacy.DRIFT.scenes.reduce((n, s) => n + s.shots_behind.length, 0);
        if (!confirm(`Record ${shots} shot card(s) as still matching the screenplay?\n\n`
            + 'Only if you have re-read the changed scene and the cards still describe it. No card is changed '
            + 'and nothing is regenerated. If a card genuinely no longer fits, edit that card instead.')) return;
        const label = btn && btn.textContent;
        if (btn) { btn.disabled = true; btn.textContent = 'Recording…'; }
        try {
            const r = await api(`/projects/${state.currentProject.id}/screenplay-drift/accept`, { method: 'POST', body: '{}' });
            setStatus(r.note);
            loadStoryboard();
        } catch (err) {
            setStatus('Could not record it: ' + err.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = label || 'These cards still match the screenplay'; }
        }
    }

    /** The per-frame mark, so the banner has somewhere to point. */
    function screenplayDriftTag(f) {
        const d = legacy.DRIFT.shots[f.shot_id];
        if (!d) return '';
        const made = d.generated.length
            ? `${d.generated.length} generated artefact(s) were built on the old words`
            : 'nothing has been generated from it yet';
        return `<span class="tag" style="cursor:pointer;border-color:var(--gl-warning,#f59e0b);color:var(--gl-warning,#f59e0b);"
            title="scene ${esc(d.scene)} was rewritten after this card — ${esc(made)}"
            onclick="editShotCard('${f.shot_id}')">script changed</span>`;
    }

    /**
     * What a change has broken, all the way down the chain.
     *
     * Drift covers screenplay → card. This covers everything below it: card →
     * keyframe → clip → lip-sync → post. The two are separate reports and one
     * banner, because a director does not care which subsystem noticed.
     */
    let IMPACT = { shots: {}, redo_now: 0, waiting: 0 };

    async function loadImpact() {
        IMPACT = { shots: {}, redo_now: 0, waiting: 0 };
        if (!state.currentProject) return;
        try {
            const res = await api(`/projects/${state.currentProject.id}/impact`);
            IMPACT.redo_now = res.redo_now || 0;
            IMPACT.waiting = res.waiting || 0;
            for (const shot of (res.shots || [])) IMPACT.shots[shot.shot_id] = shot;
        } catch (_) { /* the board still renders; this is additive */ }
    }

    /**
     * The mark on a frame whose downstream work is behind.
     *
     * Says the stage and which of the two states it is in, because "redo the
     * keyframe" and "the clip will need redoing after that" are different
     * instructions and a single red dot conflates them.
     */
    function impactTag(f) {
        const shot = IMPACT.shots[f.shot_id];
        if (!shot) return '';
        // The card's own state is already carried by the drift tag; showing it
        // twice on the same frame reads as two separate problems.
        const stages = shot.stages.filter(st => st.stage !== 'scene_card');
        if (!stages.length) return '';
        const redo = stages.filter(st => st.state === 'redo');
        const waiting = stages.filter(st => st.state === 'waiting');
        const label = redo.length
            ? `redo ${redo.map(r => esc(r.stage)).join(', ')}`
            : `${waiting.length} stage(s) waiting`;
        const why = stages.map(st => `${st.stage}: ${st.why}`).join(' \u00b7 ');
        const colour = redo.length ? 'var(--gl-danger,#ef4444)' : 'var(--gl-text-muted,#94a3b8)';
        return `<span class="tag" style="cursor:default;border-color:${colour};color:${colour};"
            title="${esc(why)}">${label}</span>`;
    }

    /** The generated-work half of the strip. */
    function impactNotice() {
        if (!IMPACT.redo_now && !IMPACT.waiting) return null;
        const parts = [];
        if (IMPACT.redo_now) parts.push(`${IMPACT.redo_now} to redo`);
        if (IMPACT.waiting) parts.push(`${IMPACT.waiting} waiting`);
        return {
            id: 'impact',
            colour: 'var(--gl-danger,#ef4444)',
            title: 'Generated work behind its inputs',
            detail: parts.join(' \u00b7 '),
            actions: `
                <button class="btn btn-ghost btn-sm" onclick="toggleWhy('impactWhy')">why</button>
                <button class="btn btn-ghost btn-sm" onclick="acceptAllStale(this)"
                        title="Record everything as still current for the inputs it has now \u2014 free">Still current</button>`,
            why: `Do the <em>redo</em> items first \u2014 the waiting ones are only behind because something
                above them is, and regenerating one now would build on the same old inputs and cost money to
                produce something still wrong. &ldquo;Behind&rdquo; means the inputs a frame was made from have
                changed since: a card, a description, the style, or how the engine builds prompts. It does
                <strong>not</strong> mean the picture is wrong.`,
        };
    }

    /** Both notices, one strip, ordered as the work is done. */
    function impactBanner() {
        return noticeStrip([screenplayDriftNotice(), impactNotice()]);
    }

    /**
     * RESYNC, PREVIEWED.
     *
     * The plan is shown before anything is written, and the apply is a second
     * deliberate click. That is not ceremony: the last thing in this codebase
     * that reconciled a screenplay against a board did it on the default path
     * with no preview, and took sixteen shots, their blocking and their
     * annotations with it through an ON DELETE CASCADE.
     */
    async function previewResync() {
        if (!state.currentProject) return;
        showModalHtml('resyncModal', '<h3>Resync</h3><p class="text-sm text-muted">Working out what would change\u2026</p>');
        let plan;
        try {
            plan = await api(`/projects/${state.currentProject.id}/shots-resync`,
                { method: 'POST', body: JSON.stringify({ apply: false }) });
        } catch (err) {
            return showModalHtml('resyncModal',
                `<h3>Resync</h3><p class="text-sm">Could not build the plan: ${esc(err.message)}</p>
                 <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal('resyncModal')">Close</button></div>`);
        }

        const changes = (plan.plan || []).flatMap(sc => sc.shots.map(sh =>
            `<li><strong>${esc(sh.shot_code)}</strong> \u2014 ${sh.updates.map(u => esc(u.field)).join(', ')}</li>`)).join('');
        const asks = (plan.plan || []).flatMap(sc => sc.needs_a_person.map(n =>
            `<li><strong>${esc(n.shot_code || ('scene ' + sc.scene_number))}</strong> \u2014
                 ${esc(String(n.kind).replace(/_/g, ' '))}${n.line ? `: <em>${esc(n.line)}</em>` : ''}
                 <br><span class="text-muted">${esc(n.why)}</span></li>`)).join('');

        showModalHtml('resyncModal', `
            <h3>Resync \u2014 ${plan.cards_changed} card${plan.cards_changed === 1 ? '' : 's'} would change</h3>
            <p class="text-sm text-muted" style="line-height:1.55;">
                Nothing has been written. Resync refreshes only what follows from the screenplay without a
                judgement. It <strong>never</strong> rewrites a description, and it <strong>never</strong>
                deletes a shot. Camera, direction note, duration, shot code and the shot itself are untouched.
            </p>
            ${changes ? `<h4 class="text-sm" style="margin:14px 0 4px;">Would be reconciled</h4>
                <ul class="text-sm" style="margin:0;padding-left:20px;line-height:1.7;">${changes}</ul>` : ''}
            ${asks ? `<h4 class="text-sm" style="margin:14px 0 4px;">Left for you \u2014 ${plan.needs_a_person} item(s)</h4>
                <ul class="text-sm" style="margin:0;padding-left:20px;line-height:1.7;">${asks}</ul>` : ''}
            ${!changes && !asks ? '<p class="text-sm">Everything already matches the screenplay.</p>' : ''}
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeModal('resyncModal')">Cancel</button>
                ${changes ? `<button class="btn btn-primary" onclick="applyResync(this)">Resync ${plan.cards_changed} card${plan.cards_changed === 1 ? '' : 's'}</button>` : ''}
            </div>`);
    }

    async function applyResync(btn) {
        if (!state.currentProject) return;
        if (btn) { btn.disabled = true; btn.textContent = 'Resyncing\u2026'; }
        try {
            const r = await api(`/projects/${state.currentProject.id}/shots-resync`,
                { method: 'POST', body: JSON.stringify({ apply: true }) });
            closeModal('resyncModal');
            setStatus(`${r.cards_changed} card(s) reconciled. ${r.needs_a_person} item(s) still need you.`);
            await loadScreenplayDrift();
            loadStoryboard();
        } catch (err) {
            setStatus('Resync failed: ' + err.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
        }
    }

    /** The pre-flight, on demand. Free, and it spends nothing. */
    async function runShotAudit() {
        if (!state.currentProject) return;
        showModalHtml('auditModal', '<h3>Audit</h3><p class="text-sm text-muted">Checking every card\u2026</p>');
        let r;
        try {
            r = await api(`/projects/${state.currentProject.id}/shot-audit`);
        } catch (err) {
            return showModalHtml('auditModal',
                `<h3>Audit</h3><p class="text-sm">Could not run it: ${esc(err.message)}</p>
                 <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal('auditModal')">Close</button></div>`);
        }
        const tone = { error: 'var(--gl-danger,#ef4444)', warning: 'var(--gl-warning,#f59e0b)', info: 'var(--gl-text-muted,#94a3b8)' };
        const rows = (r.findings || []).map(f => `<li style="margin-bottom:8px;">
            <span class="tag" style="border-color:${tone[f.severity]};color:${tone[f.severity]};">${esc(f.severity)}</span>
            <strong>${esc(f.shot_code)}</strong> \u2014 ${esc(String(f.type).replace(/_/g, ' '))}${f.subject ? `: ${esc(f.subject)}` : ''}
            <br><span class="text-sm text-muted">${esc(f.why)}</span>
            ${f.fix ? `<br><span class="text-sm" style="opacity:.8;">\u2192 ${esc(f.fix)}</span>` : ''}
        </li>`).join('');
        showModalHtml('auditModal', `
            <h3>Audit \u2014 ${r.shots_checked} shot${r.shots_checked === 1 ? '' : 's'}</h3>
            <p class="text-sm text-muted" style="line-height:1.55;">
                ${r.counts.error} error \u00b7 ${r.counts.warning} warning \u00b7 ${r.counts.info} note.
                ${esc(r.note)}
            </p>
            ${rows ? `<ul class="text-sm" style="margin:12px 0 0;padding-left:20px;line-height:1.6;">${rows}</ul>`
                   : '<p class="text-sm">Nothing to report.</p>'}
            <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal('auditModal')">Close</button></div>`);
    }

    /**
     * "All of this is still the film I want."
     *
     * The per-asset accept has existed since fingerprinting shipped and is
     * unusable at the scale a real project reaches: improvements to how prompts
     * are built move every fingerprint, so seventy artefacts report behind and
     * each needs its own click. That is how a report gets dismissed
     * permanently — and then the real warning is dismissed with it.
     *
     * The claim is the director's, not the engine's, so it is one deliberate
     * act with the consequence stated.
     */
    async function acceptAllStale(btn) {
        if (!state.currentProject) return;
        /*
         * BOTH HALVES, CARDS FIRST. The "behind" report is rooted in the shot
         * cards: a card the screenplay moved on without is the top of every
         * chain below it. Accepting only the generated work left that root in
         * place, so the button could be pressed forever and the banner stayed —
         * which is how this was reported. "All still current" includes the
         * cards, and says so.
         */
        const cards = legacy.DRIFT.scenes.reduce((n, s) => n + s.shots_behind.length, 0);
        if (!confirm('Record all of this as still current?\n\n'
            + (cards ? `- ${cards} shot card(s) still match the screenplay as it stands now\n` : '')
            + '- the generated pictures are still the film you want, for the inputs they have now\n\n'
            + 'Nothing is regenerated, no card is changed and nothing is spent. '
            + 'If a subject or a shot card genuinely did change, fix that one instead.')) return;

        const label = btn && btn.textContent;
        if (btn) { btn.disabled = true; btn.textContent = 'Accepting…'; }
        try {
            if (cards) await api(`/projects/${state.currentProject.id}/screenplay-drift/accept`, { method: 'POST', body: '{}' });
            const r = await api(`/projects/${state.currentProject.id}/staleness/accept`,
                { method: 'POST', body: JSON.stringify({}) });
            const kinds = Object.entries(r.by_kind || {}).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`);
            setStatus(`${r.accepted} accepted as current${kinds.length ? ' — ' + kinds.join(', ') : ''}.`
                + (r.warning ? ' ' + r.warning : ''));
            loadStoryboard();
        } catch (err) {
            setStatus('Could not accept: ' + err.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = label || 'This is all still current'; }
        }
    }

    /**
     * A frame's URL, keyed to the version it is.
     *
     * The path never changes when a frame is regenerated — the file is
     * overwritten at the same name — so the browser served the cached image and
     * the board looked identical after a successful, paid-for regeneration.
     * "Nothing happened" was literally what the screen showed, and the honest
     * response to that is to click regenerate again.
     *
     * Keyed on asset_version rather than Date.now(), so an unchanged frame
     * still comes from cache. Busting on every render would re-download every
     * image on the board each time the page refreshed, which on a feature-length
     * board is a lot of bytes to spend hiding one bug.
     */
    /**
     * Where a frame's picture comes from.
     *
     * `width` asks the server for a thumbnail. A board card is ~260px and a
     * frame is generated at the delivery size, so without it the grid fetches
     * 1.5MB per card — 20MB to paint thirteen postage stamps, every time the
     * page is opened. That is the whole reason moving between sections drags.
     *
     * The full picture is still what the VIEWER loads: the moment you are
     * actually judging a frame is the moment resolution matters.
     *
     * `v` stays keyed to asset_version rather than to a timestamp — busting on
     * every render would re-download an unchanged board on each refresh, which
     * is a lot of bytes spent hiding one bug.
     */
    /**
     * Draw what a placement would KEEP over every board tile.
     *
     * The number this exists for: a 9:16 centre crop of a 16:9 frame keeps 32%
     * of its width, 4:5 keeps 45%, 1:1 keeps 56%. Nobody believes those until
     * they see them over their own shot, which is why it is drawn on the board
     * rather than stated on a settings page.
     *
     * A centre crop is assumed, and that is honest rather than lazy: it is the
     * worst case and the default any reframing tool starts from. What it cannot
     * show is a subject that Auto Reframe would follow — but a subject can only
     * be followed inside pixels that exist, which is the whole argument for
     * shooting the vertical natively instead.
     */
    /** Shoot this shot at its own ratio. '' goes back to inheriting the project's. */
    async function setShotAspect(shotId, ratio) {
        try {
            await api(`/shots/${shotId}`, { method: 'PUT', body: JSON.stringify({ aspect_ratio: ratio }) });
            setStatus(ratio ? `Shot will be generated at ${ratio}` : 'Shot follows the project ratio');
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    /** The model choice for a batch, captured from the shared confirmation. */
    let BATCH_CHOICES = null;

    async function generateAllStoryboards() {
        if (!state.currentProject) return;

        /*
         * The batch had NO confirmation at all — the most expensive control in
         * the app, generating every unshot frame in the film, went straight to
         * the provider. Every single-frame path was gated and this one was not,
         * which is the wrong way round.
         *
         * The prompt is READ-ONLY here and says why: a batch composes one
         * prompt PER SHOT, so there is no single text to edit, and offering one
         * would silently apply it to every frame in the film. The model choice
         * still applies — that is a decision about the whole run.
         */
        BATCH_CHOICES = null;
        const shots = (state.shots || []);
        const todo = shots.filter(x => !x.has_keyframe && !x.keyframe);
        const first = (todo[0] || shots[0] || {});
        const shotId = first.shot_id || first.id;
        if (shotId) {
            const go = await new Promise(resolve => confirmPaidImage({
                title: `Generate ${todo.length || shots.length} frame(s)`,
                note: `This generates every shot that has no frame yet — ${todo.length || shots.length} `
                    + 'of them — and each one costs credits. The prompt below is the FIRST shot, '
                    + 'shown so you can see the shape of what is sent.',
                previewUrl: `/shots/${shotId}/prompt`,
                editable: false,
                notEditableWhy: 'A batch composes a different prompt for every shot, so there is no '
                    + 'single text to edit. Regenerate one frame to edit its prompt.',
                send: choices => { BATCH_CHOICES = choices; resolve(true); },
            }).then(() => resolve(BATCH_CHOICES !== null)));
            if (!go) return;
        }

        const prog = document.getElementById('storyboardProgress');
        const bar = document.getElementById('storyboardProgressBar');
        const lbl = document.getElementById('storyboardProgressLabel');
        const pct = document.getElementById('storyboardProgressPct');
        const imgProg = document.getElementById('storyboardImageProgress');
        const imgLbl = document.getElementById('storyboardImageLabel');
        const imgStep = document.getElementById('storyboardImageStep');
        const imgBar = document.getElementById('storyboardImageBar');
        prog.style.display = 'block';
        imgProg.style.display = 'none';
        bar.style.width = '0%';
        lbl.textContent = 'Starting storyboard generation...';
        pct.textContent = '0%';

        let totalShots = 1;

        const useRefs = document.getElementById('useReferencesToggle').checked;
        /*
         * The batch is a GET stream, so the model choice rides in the query
         * rather than a body — captured from the confirmation above. Without
         * this the picker would be shown, chosen, and ignored.
         */
        const batchQ = new URLSearchParams({
            ...(useRefs ? { use_references: 'true' } : {}),
            ...((BATCH_CHOICES && BATCH_CHOICES.quality) ? { quality: BATCH_CHOICES.quality } : {}),
        }).toString();
        const storyboardUrl = '/projects/' + state.currentProject.id + '/storyboard/generate/stream'
            + (batchQ ? `?${batchQ}` : '');

        streamSSE(
            storyboardUrl,
            (ev) => {
                if (ev.type === 'status' && ev.total_shots) {
                    totalShots = ev.total_shots;
                }

                if (ev.type === 'scene') {
                    lbl.textContent = 'Scene ' + ev.scene_number + (ev.location ? ' — ' + ev.location : '');
                }

                if (ev.type === 'progress') {
                    const shotP = ((ev.shot_index || 0) / totalShots) * 100;
                    if (ev.phase === 'generating') {
                        bar.style.width = shotP + '%';
                        pct.textContent = Math.round(shotP) + '%';
                        lbl.textContent = 'Generating ' + (ev.shot_code || '...');
                        imgProg.style.display = 'block';
                        imgLbl.textContent = 'Preparing...';
                        imgStep.textContent = '';
                        imgBar.style.width = '0%';
                    } else if (ev.phase === 'complete') {
                        const doneP = (((ev.shot_index || 0) + 1) / totalShots) * 100;
                        bar.style.width = doneP + '%';
                        pct.textContent = Math.round(doneP) + '%';
                        lbl.textContent = ev.shot_code + ' complete';
                        imgProg.style.display = 'none';
                        // Refresh the image in the grid if visible
                        const grid = document.getElementById('storyboardGrid');
                        if (ev.image_url && grid) {
                            const imgs = grid.querySelectorAll('img');
                            imgs.forEach(img => {
                                if (img.src.includes(ev.shot_code)) {
                                    img.src = legacy.API_BASE + ev.image_url + '?t=' + Date.now();
                                    img.style.display = 'block';
                                }
                            });
                        }
                    }
                }

                // Per-image generation progress (step-by-step like gridlight-chat)
                if (ev.type === 'image_progress') {
                    imgProg.style.display = 'block';
                    if (ev.message) {
                        imgLbl.textContent = ev.message;
                    }
                    if (typeof ev.step === 'number' && ev.total_steps) {
                        const stepPct = Math.round((ev.step / ev.total_steps) * 100);
                        imgBar.style.width = stepPct + '%';
                        imgStep.textContent = 'Step ' + ev.step + '/' + ev.total_steps + ' (' + stepPct + '%)';
                        imgLbl.textContent = 'Generating...';
                    }
                }
            },
            () => {
                bar.style.width = '100%';
                pct.textContent = '100%';
                lbl.textContent = 'Complete!';
                imgProg.style.display = 'none';
                setTimeout(() => { prog.style.display = 'none'; }, 2000);
                loadStoryboard();
                setStatus('Storyboard generation complete');
            },
            () => {
                prog.style.display = 'none';
                imgProg.style.display = 'none';
                setStatus('Storyboard generation failed');
            }
        );
    }

    /** The location's views, as a picture-led choice rather than an id. */
    let BACKGROUND_PICKER = null;

    function backgroundPickerResolve(choice) {
        closeModal('backgroundPickerModal');
        const fn = BACKGROUND_PICKER;
        BACKGROUND_PICKER = null;
        if (fn) fn(choice || null);
    }

    /**
     * Every view as a picture you click.
     *
     * The first draft asked for a number typed into a window.prompt. That
     * fails the whole purpose: this feature exists because a director could not
     * tell which way a plate faced, and "type 2" asks them to hold the geometry
     * in their head — the exact thing that has gone wrong on every reverse
     * angle so far. A view IS a picture; choosing one means looking at it.
     *
     * Asset ids never appear. They are what the API takes; they are not what a
     * director chooses between.
     */
    function renderBackgroundChoices(views) {
        const el = document.getElementById('backgroundPickerChoices');
        if (!el) return;
        /*
         * Unavailable views are SHOWN and disabled, not hidden.
         *
         * Dropping them silently makes a view a director photographed simply
         * vanish, which reads as the app losing their work. Shown with the
         * reason, it reads as what it is: the picture is gone, photograph it
         * again.
         */
        el.innerHTML = views.map((v, i) => v.available === false
            ? `<div class="btn btn-secondary" style="padding:0;overflow:hidden;text-align:left;
                        display:block;opacity:.5;cursor:not-allowed;" aria-disabled="true">
                 <div style="padding:28px 10px;" class="text-muted text-sm">Picture unavailable</div>
                 <div style="padding:7px 9px;" class="text-sm">${escapeHtml(v.label)}
                   <div class="text-muted">${escapeHtml(v.unavailable_reason || 'Photograph this view again.')}</div>
                 </div>
               </div>`
            : `<button class="btn btn-secondary" style="padding:0;overflow:hidden;text-align:left;display:block;"
                    onclick="backgroundPickerResolve(BACKGROUND_PICKER_VIEWS[${i}])">
              <img src="${escapeHtml(plateSrc(v.image_url, 480))}" alt="${escapeHtml(v.label)}"
                   style="width:100%;display:block;">
              <div style="padding:7px 9px;" class="text-sm">${escapeHtml(v.label)}</div>
            </button>`).join('');
    }

    let BACKGROUND_PICKER_VIEWS = [];

    async function pickBackgroundView(shotId) {
        let shot;
        try { shot = await api(`/shots/${shotId}`); } catch (err) {
            setStatus('Could not read the shot: ' + err.message); return null;
        }
        const locName = shot.location;
        if (!locName) { setStatus('This scene names no location, so there are no views to choose.'); return null; }

        let views = [];
        try {
            const locs = await api(`/projects/${state.currentProject.id}/locations`);
            const rows = locs.locations || locs;
            const loc = (Array.isArray(rows) ? rows : []).find(l =>
                String(l.name).toLowerCase() === String(locName).toLowerCase());
            if (loc) views = (await api(`/locations/${loc.id}/plate/views`)).views || [];
        } catch (_) { views = []; }

        // Kept, not filtered: an unavailable view is rendered disabled with its
        // reason, so a view a director photographed never simply disappears.
        if (!views.some(v => v.available !== false)) {
            setStatus(`${locName} has no photographed views yet. Open Direct and photograph the one you need.`);
            return null;
        }

        BACKGROUND_PICKER_VIEWS = views;
        document.getElementById('backgroundPickerTitle').textContent =
            `Which background goes behind them? — ${locName}`;
        renderBackgroundChoices(views);
        showModal('backgroundPickerModal');
        return new Promise(resolve => { BACKGROUND_PICKER = resolve; });
    }

    /**
     * The film facts first; the mechanics one disclosure down.
     *
     * A director decides with "which performance, which background, what is
     * held" — not with a character budget and a reference ordering. Those stay
     * available because they are the only free feedback loop, but they are not
     * the interface.
     */
    async function confirmRecompose(shotId, fromVersion, background, instruction) {
        const body = document.getElementById('confirmGenBody');
        const title = document.getElementById('confirmGenTitle');
        if (!body) return true;
        title.textContent = 'Change the background, keep the performance';
        body.innerHTML = '<span class="text-muted text-sm">Reading what would be sent&hellip;</span>';
        confirmGenArm(false);
        showModal('confirmGenModal');
        const decision = new Promise(resolve => { setLegacy('CONFIRM_GEN', resolve); });

        try {
            const q = new URLSearchParams({ background_asset_id: background.asset_id });
            if (fromVersion) q.set('from_version', fromVersion);
            if (instruction) q.set('instruction', instruction);
            const d = await api(`/shots/${shotId}/storyboard/recompose-preview?${q}`);
            const esc = escapeHtml;
            body.innerHTML = `
              <!-- Both pictures, side by side. Which FRAME is being kept is the
                   load-bearing decision here, and it was shown only as a name —
                   seeing it beside the background is also what catches a
                   version-pointer mistake before the money goes. -->
              <div class="form-group">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  <div>
                    <label>Keeping this performance</label>
                    ${d.keeping.image_url
                        ? `<img src="${esc(plateSrc(d.keeping.image_url, 480))}" alt=""
                               style="width:100%;border-radius:6px;display:block;">`
                        : '<div class="text-muted text-sm">no picture</div>'}
                    <div class="text-sm"><strong>${esc(d.keeping.from)}</strong></div>
                    <div class="text-sm text-muted">${esc(d.keeping.what)}</div>
                  </div>
                  <div>
                    <label>Putting it here</label>
                    ${d.background.image_url
                        ? `<img src="${esc(plateSrc(d.background.image_url, 480))}" alt=""
                               style="width:100%;border-radius:6px;display:block;">`
                        : '<div class="text-muted text-sm">no picture</div>'}
                    <div class="text-sm"><strong>${esc(d.background.location)}</strong></div>
                    <div class="text-sm text-muted">${esc(d.background.view)}</div>
                  </div>
                </div>
              </div>
              ${d.anchor_bypassed
                  ? `<div class="text-sm" style="color:var(--warning,#b8860b);margin-bottom:8px;">
                       ${esc(d.anchor_bypassed)}</div>` : ''}
              <div class="form-group">
                <label>Holding</label>
                <div class="text-sm">${d.holding.map(esc).join(' &middot; ')}</div>
                <label style="margin-top:6px;">Taking from the background</label>
                <div class="text-sm">${d.adopting.map(esc).join(' &middot; ')}</div>
              </div>
              <div class="form-group">
                <label>Cost</label>
                <div class="text-sm">${d.spend && d.spend.provider
                    ? `${esc(d.spend.provider)}${d.spend.native_quantity
                        ? ` &middot; ${d.spend.native_quantity} ${esc(d.spend.native_unit || 'units')}` : ''}`
                      + `${Number.isFinite(d.spend.usd) ? ` &middot; about $${d.spend.usd.toFixed(2)}` : ''}`
                      + `${d.spend.estimated ? ' <span class="text-muted">(estimated rate)</span>' : ''}`
                    : '<span class="text-muted">Cost could not be read.</span>'}</div>
                ${d.spend && d.spend.first_attempt_only
                    ? `<div class="text-sm text-muted" style="line-height:1.45;">First attempt only. If
                         ${esc(d.spend.provider)} declines, the next provider is tried
                         ${(d.spend.fallback_chain || []).length > 1
                             ? `(${esc((d.spend.fallback_chain || []).slice(1).join(', '))})` : ''}
                         and a declined attempt may still be billed.</div>` : ''}
                <div class="text-sm text-muted" style="line-height:1.45;">The frame you are working from
                  stays in the version list either way.</div>
              </div>
              ${await confirmExtras(d.prompt, d.ceiling)}
              <details>
                <summary style="cursor:pointer;font-size:12px;">Technical details</summary>
                <div style="padding:8px 0 0;">
                  <div class="text-sm text-muted">${esc(d.note)}</div>
                  <ul style="margin:4px 0 8px 16px;padding:0;">${d.references.map(r =>
                    `<li class="text-sm"><strong>${esc(r.role)}</strong> ${esc(r.subject)}
                       <span class="text-muted">&mdash; ${esc(r.why)}</span></li>`).join('')}</ul>
                  <div class="text-sm text-muted">${d.prompt_chars} characters</div>
                  <pre style="white-space:pre-wrap;font-size:11px;line-height:1.5;margin:4px 0 0;padding:8px;
                              border-radius:6px;background:rgba(148,163,184,.10);">${esc(d.prompt)}</pre>
                  <div class="text-sm text-muted" style="margin-top:6px;">Negative</div>
                  <pre style="white-space:pre-wrap;font-size:11px;line-height:1.5;margin:2px 0 0;padding:8px;
                              border-radius:6px;background:rgba(148,163,184,.10);">${esc(d.negative_prompt)}</pre>
                </div>
              </details>`;
            paintGenOptions(); confirmGenArm(true);
        } catch (err) {
            body.innerHTML = `<p class="text-sm" style="color:var(--gl-danger,#ef4444);">
                Could not read what would be sent: ${escapeHtml(err.message)}. Nothing will be
                generated — close this and try again.</p>`;
        }
        return decision;
    }

    /** Shared by both surfaces. */
    async function runRecompose(shotId, fromVersion) {
        const background = await pickBackgroundView(shotId);
        if (!background) return;
        const instruction = prompt(
            'Anything to add? (optional)\n\n'
            + 'The performance, framing and wardrobe are kept from the frame; the place, light and '
            + 'grade come from the background. Leave blank unless you want something on top.') || '';

        const ok = await confirmRecompose(shotId, fromVersion, background, instruction.trim());
        if (!ok) return;
        const choices = confirmChoices();

        const done = frameBusy(shotId, 'Recomposing');
        setStatus('Recomposing...', true);
        try {
            const r = await api(`/shots/${shotId}/storyboard/recompose`, {
                method: 'POST',
                body: JSON.stringify({
                    instruction: instruction.trim(),
                    ...(fromVersion ? { version: fromVersion } : {}),
                    ...(background ? { background } : {}),
                    ...choices,
                }),
            });
            done();
            setStatus(r && r.provider ? `Recomposed via ${r.provider}.` : 'Recomposed.');
            await loadStoryboard();
        } catch (err) { done(); setStatus('Could not recompose: ' + err.message); }
    }

    /** From the board — you are looking at the version you want to keep. */
    async function recomposeFrame(shotId, version) {
        markCurrentShot(shotId);
        closeFrameVersions();
        await runRecompose(shotId, version);
    }

    /*
     * Locking the board: "I feel it's done."
     *
     * Every frame on a finished board was paid for, judged and kept, and every
     * one sits behind a Regen button that costs money and REPLACES the picture.
     * Nothing distinguished a draft from the shot, so the only protection was
     * remembering. The state is shown on the button itself rather than in the
     * status bar, because a locked board whose buttons still look armed reads
     * as the buttons being broken.
     */
    let BOARD_LOCK = { locked: false, locked_at: null };

    async function loadBoardLock() {
        if (!state.currentProject) return;
        try {
            BOARD_LOCK = await api(`/projects/${state.currentProject.id}/board-lock`);
        } catch (_) { BOARD_LOCK = { locked: false, locked_at: null }; }
        renderBoardLock();
    }

    function renderBoardLock() {
        const btn = document.getElementById('boardLockBtn');
        if (!btn) return;
        btn.textContent = BOARD_LOCK.locked ? '🔒 Locked — unlock' : 'Lock board';
        btn.title = BOARD_LOCK.locked
            ? `Locked ${BOARD_LOCK.locked_at || ''}. Generating, refining and restoring are refused. `
              + 'Editing cards and previewing prompts still work.'
            : 'Lock the board when you are happy with it — nothing that replaces a frame will run until you unlock';
        // The buttons that spend money say so, rather than failing on click.
        document.querySelectorAll('[onclick*="generateAllStoryboards"], [onclick*="regenerateStoryboard"], [onclick*="refineFrame"], [data-import-target="storyboard-image"]')
            .forEach(b => { if (b.id !== 'boardLockBtn') b.disabled = !!BOARD_LOCK.locked; });
    }

    async function toggleBoardLock() {
        if (!state.currentProject) return;
        const url = `/projects/${state.currentProject.id}/board-lock`;
        try {
            if (BOARD_LOCK.locked) {
                BOARD_LOCK = await api(url, { method: 'DELETE' });
                setStatus('Board unlocked. Frames can be generated again.');
            } else {
                BOARD_LOCK = await api(url, { method: 'PUT', body: JSON.stringify({}) });
                setStatus(`Board locked — ${BOARD_LOCK.frames} frame${BOARD_LOCK.frames === 1 ? '' : 's'} held. `
                    + 'Nothing that replaces a frame will run until you unlock.');
            }
            renderBoardLock();
        } catch (err) {
            setStatus('Could not change the lock: ' + err.message);
        }
    }

    /**
     * Insert a shot between two others.
     *
     * POST /shots has existed since the first week and `shot_create` reaches it
     * over MCP, and the board had no control at all — so a director who
     * realised a scene needed a cutaway between 2A and 2B could not add one
     * without leaving the app. A capability with no control is indistinguishable
     * from one that does not exist.
     *
     * It lands in the SAME SCENE as the shot it follows, because a shot belongs
     * to a scene and asking which scene at insert time is asking a question the
     * click already answered.
     *
     * The code is suggested rather than imposed: shot codes are a convention a
     * production owns (2A, 2B, 2B-insert, 2Bx), and renumbering everything after
     * an insertion would rewrite codes a director has already used in notes,
     * conversation and the run plan.
     */
    async function insertShotAfter(afterShotId) {
        const board = (state.storyboard && state.storyboard.frames) || null;
        let after = board && board.find(f => f.shot_id === afterShotId);
        if (!after) {
            try {
                const d = await api(`/projects/${state.currentProject.id}/storyboard`);
                after = (d.frames || []).find(f => f.shot_id === afterShotId);
            } catch (err) { return setStatus('Could not read the board: ' + err.message); }
        }
        if (!after) return setStatus('That shot is no longer on the board.');

        const description = prompt(
            `New shot straight after ${after.shot_code}.\n\n`
            + `It will be numbered ${after.shot_code}A — the way a script supervisor numbers an insert, `
            + 'so nothing already written down gets renamed.\n\n'
            + 'What happens in this shot? Describe only what is IN the frame: an image model draws '
            + 'whatever you name, so "off frame" and "we never see" put those things in the picture.');
        if (!description || !description.trim()) return;

        try {
            const r = await api(`/shots/${afterShotId}/insert-after`, {
                method: 'POST',
                body: JSON.stringify({ card: { description: description.trim() } }),
            });
            setStatus(r.note || `${r.shot_code} added.`);
            await loadStoryboard();
        } catch (err) {
            setStatus('Could not add the shot: ' + err.message);
        }
    }

    /** Play from this shot, deliberately. */
    function playFromShot(shotId) {
        markCurrentShot(shotId);
        navigateTo('playback');
    }

export {
    loadBoardBanners,
    storyboardImportButton,
    importImageAsPng,
    importStoryboardImage,
    frameVersionLabel,
    frameVersionTitle,
    sendFrameTo,
    openFrameVersions,
    closeFrameVersions,
    restoreFrameVersion,
    ANCHOR,
    anchorShotId,
    renderAnchorChip,
    setAnchor,
    clearAnchor,
    anchorButton,
    renderAnnotationFeedbackToggle,
    storyboardDrawAnnotations,
    storyboardFacetTags,
    dialogueTag,
    storyboardPrevisTag,
    previsOpenFromBoard,
    noticeStrip,
    toggleWhy,
    screenplayDriftNotice,
    acceptScreenplayDrift,
    screenplayDriftTag,
    IMPACT,
    loadImpact,
    impactTag,
    impactNotice,
    impactBanner,
    previewResync,
    applyResync,
    runShotAudit,
    acceptAllStale,
    setShotAspect,
    BATCH_CHOICES,
    generateAllStoryboards,
    BACKGROUND_PICKER,
    backgroundPickerResolve,
    renderBackgroundChoices,
    BACKGROUND_PICKER_VIEWS,
    pickBackgroundView,
    confirmRecompose,
    runRecompose,
    recomposeFrame,
    BOARD_LOCK,
    loadBoardLock,
    renderBoardLock,
    toggleBoardLock,
    insertShotAfter,
    playFromShot,
};
