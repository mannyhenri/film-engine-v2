/*
 * The character sheet engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. CharacterSheet.jsx renders the modal frame; this draws the sheet into it by id, as before. It also owns the sheet mode (view/edit) both sheets share, and slotUpload, which the location and prop sheet reaches by name. csImg stays in core: plateSrc, which every page uses, calls it.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { legacy } from '../../lib/legacy.js';
import { characterDoc, sheetHtml } from '../../lib/print-sheet.js';
import { configureExpressions, expressionSlotsHtml } from './expressions.jsx';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import MainSheet from './MainSheet.jsx';

/*
 * The sheet's top is MainSheet (React): the main picture every generation uses, its variations, the description and
 * the three steps that make it. What the sheet drew before (views, expressions, voice, references) follows, folded
 * under "More", unchanged: expressions and the views still feed what they fed.
 */
let MAIN_ROOT = null, MAIN_EL = null;
function mountMainSheet(el, characterId) {
    if (MAIN_ROOT && MAIN_EL !== el) { try { MAIN_ROOT.unmount(); } catch (_) { /* its node is gone */ } MAIN_ROOT = null; }
    if (!MAIN_ROOT) { MAIN_ROOT = createRoot(el); MAIN_EL = el; }
    MAIN_ROOT.render(createElement(MainSheet, { key: characterId, characterId }));
}

// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:
// a line reading `const esc = …` would be the first definition a backend test finds when it searches the page.
const {
    api,
    characterViewsHtml,
    closeModal,
    confirmPaidImage,
    csImg,
    esc,
    jsAttr,
    loadCharacters,
    plateSrc,
    renderSubjectSheet,
    setStatus,
    showModal,
    uploadControl,
} = Object.fromEntries([
    'api',
    'characterViewsHtml',
    'closeModal',
    'confirmPaidImage',
    'csImg',
    'esc',
    'jsAttr',
    'loadCharacters',
    'plateSrc',
    'renderSubjectSheet',
    'setStatus',
    'showModal',
    'uploadControl',
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

    async function showCharacterViews(charId) {
        try {
            const r = await api(`/characters/${charId}/refsheet/views`);
            const body = characterViewsHtml(r, charId);

            // Reuses the entity inspector rather than inventing a second
            // modal: two panels showing a subject's pictures is how they come
            // to disagree about which one is in use.
            document.getElementById('entityInspectTitle').textContent = `${r.character} — reference views`;
            document.getElementById('entityInspectBody').innerHTML = body;
            showModal('entityInspectModal');
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    async function deleteCharacterView(charId, view) {
        // Names what is lost and what is not. A plate cost money; the bytes
        // are set aside rather than destroyed, and saying so is the difference
        // between a confirmation people read and one they click through.
        if (!confirm(`Delete the ${view} view of this character?\n\n`
            + `It stops being used in every frame this character appears in, and stops being listed.\n`
            + `The picture file is moved to a "deleted" folder rather than destroyed, so it can be `
            + `put back by hand — but nothing in the app will do that for you.`)) return;
        try {
            await api(`/characters/${charId}/refsheet/views/${encodeURIComponent(view)}`, { method: 'DELETE' });
            setStatus(`${view} view deleted`);
            closeModal('entityInspectModal');
            loadCharacters();
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    /* ── the character sheet ───────────────────────────────────────────────
     *
     * The card carried eight buttons and clicking it did nothing. Every one of
     * those is something you do while LOOKING at the character, so they live
     * here. Built to design_handoff_character_card: official views top-left,
     * everything written top-right, wardrobe and palette under it, and a
     * full-width concept band across the bottom.
     */

    // Mirrors lib/character-sheet.js. The page cannot require a node module
    // (build.target: single-html), so the registries are duplicated and held in
    // lockstep by tests/character-sheet.test.js — the screenplay-pagination
    // precedent.
    const CS_VIEWS = [
        { id: 'front', label: 'Front', caption: 'front plate' },
        { id: 'side-left', label: 'Left', caption: 'left profile' },
        { id: 'side-right', label: 'Right', caption: 'right profile' },
        { id: 'back', label: 'Back', caption: 'back plate' },
    ];

    const CS_CATEGORIES = [
        { id: 'sketch', label: 'Sketch' }, { id: 'costume', label: 'Costume' },
        { id: 'face', label: 'Face' }, { id: 'mood', label: 'Mood' },
    ];

    const CS_LEGACY = { side: 'side-left', 'three-quarter': 'front', 'back-three-quarter': 'back', right: 'side-right', left: 'side-left', profile: 'side-left' };

    let SHEET = { id: null, character: null, gallery: [], costumes: [],
        filter: 'all', palette: [] };
    configureExpressions(() => SHEET, () => renderCharacterSheet());

    /**
     * Run something that spends, with a spinner on the button.
     *
     * A generation takes up to a minute, and without this the page looks
     * exactly as it did before the click — which reads as the button not
     * working and invites a second press on a paid action. The board learned
     * this once; the sheet had none of it.
     *
     * `finally` is the load-bearing part: a spinner that keeps turning after a
     * failure is worse than none, because it says work is still happening when
     * nothing is.
     */
    async function csBusy(label, work) {
        const bar = document.getElementById('csChips');
        const badge = document.createElement('span');
        badge.className = 'cs-chip cs-busy';
        badge.innerHTML = '<span class="cs-spinner"></span>' + esc(label || 'Working…');
        if (bar) bar.appendChild(badge);
        setStatus(label || 'Working…', true);
        try {
            return await work();
        } finally {
            badge.remove();
            setStatus('');
        }
    }

    async function openCharacterSheet(id) {
        SHEET = { id, character: null, gallery: [], costumes: [], filter: 'all' };
        document.getElementById('csName').textContent = 'Loading…';
        document.getElementById('csChips').innerHTML = '';
        document.getElementById('csBody').innerHTML = '<div class="text-muted" style="padding:40px;">Loading…</div>';
        showModal('characterSheetModal');
        await renderCharacterSheet();
    }

    /**
     * VIEW MODE / EDIT MODE.
     *
     * The reference sheets are a READ-ONLY document: a director opens one to
     * look at it, and a page of input boxes is a form, not a sheet. So a sheet
     * opens in view mode and an EDIT button at the top right — not in the
     * design, added because the design has no way to change anything — turns
     * the fields on.
     *
     * NO LAYOUT SHIFT, which is the acceptance bar. The same element is used in
     * both modes and only `readonly` and a border change: swapping an input for
     * a paragraph would reflow the whole column on every toggle, and the eye
     * reads that as the sheet breaking.
     *
     * PICTURES ARE NOT PART OF THE MODE. Uploading and generating stay
     * available in both, because looking at a sheet is exactly when you notice
     * a plate is wrong — locking them away in view mode would take the controls
     * you use most while reading.
     */
    let SHEET_MODE = 'view';

    function sheetEditable() { return SHEET_MODE === 'edit'; }

    /** The button says what pressing it will DO next, on both sheets. */
    function paintSheetModeButtons() {
        const label = sheetEditable() ? 'Done' : 'Edit';
        ['csModeBtn', 'ssModeBtn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.textContent = label;
        });
    }

    function toggleSheetMode() {
        SHEET_MODE = SHEET_MODE === 'view' ? 'edit' : 'view';
        paintSheetModeButtons();
        // Re-render whichever sheet is open; both keep their scroll position
        // because the box each field occupies does not change.
        const cs = document.getElementById('characterSheetModal');
        const ss = document.getElementById('subjectSheetModal');
        if (cs && cs.classList.contains('open')) renderCharacterSheet();
        else if (ss && ss.classList.contains('open')) renderSubjectSheet();
    }

    /**
     * One plate tile.
     *
     * `shape` names the sheet's own plate class, because a plate is the shape
     * of its SUBJECT: a location is landscape, a prop is square, a character is
     * a portrait turnaround. All three used to share the character's grid,
     * which showed a location in a portrait crop — the wrong picture of the
     * right place, which is what a plate exists to prevent.
     */
    /**
     * Upload a picture INTO ONE SLOT.
     *
     * The routes have always taken `body.view`, so a particular view has been
     * uploadable since plate uploads shipped -- what the page offered was one
     * Upload per subject, which fills the DEFAULT plate. On a sheet that draws
     * its plates as numbered slots that is the wrong picture: the only way to
     * fill 02 or the side view was to buy it, while the photograph the director
     * already had could only be dropped on the subject as a whole.
     */
    function slotUpload(kind, subjectId, view, label) {
        const target = kind === 'character' ? 'character-plate'
            : kind === 'location' ? 'location-plate' : 'prop-plate';
        const url = kind === 'character'
            ? `/characters/${subjectId}/refsheet/import`
            : `/${kind}s/${subjectId}/plate/import`;
        return uploadControl(target, url, {
            label: label || 'upload',
            title: 'Use a picture you already have for this view',
            extra: view ? { view: view } : {},
        });
    }

    async function renderCharacterSheet() {
        const body = document.getElementById('csBody');
        const sheet = SHEET, id = sheet.id, epoch = sheet.loadRequest = (sheet.loadRequest || 0) + 1;
        try {
            const [ch, gal, pal, expressions] = await Promise.all([
                api(`/characters/${id}`),
                api(`/characters/${id}/gallery`).catch(() => ({ items: [] })),
                api(`/characters/${id}/palette`).catch(() => ({ palette: [] })),
                api(`/characters/${id}/expressions`).catch(error => ({slots:[],error:error.message})),
            ]);
            if (SHEET !== sheet || SHEET.id !== id || epoch !== SHEET.loadRequest) return;
            SHEET.character = ch.character || ch;
            SHEET.gallery = gal.items || [];
            SHEET.palette = pal.palette || [];
            SHEET.expressions = expressions.slots || [];
            SHEET.expressionError = expressions.error || null;
        } catch (err) {
            if (SHEET !== sheet || SHEET.id !== id || epoch !== SHEET.loadRequest) return;
            // A renderer that paints a placeholder must have a path that
            // replaces it, or a failure reads as the character being gone.
            body.innerHTML = `<div class="empty-state" style="padding:40px;"><h3>Could not load this character</h3>
                <p>${esc(err.message)}</p></div>`;
            return;
        }
        const c = SHEET.character;
        document.getElementById('csName').textContent = c.name || 'Character';

        const plates = csPlatesByView();
        const locked = CS_VIEWS.filter(v => plates[v.id]).length;
        document.getElementById('csChips').innerHTML = `
            <span class="cs-chip ${locked === 4 ? 'ok' : 'warn'}">Views ${locked}/4</span>
            ${c.gender || c.age_range
                ? `<span class="cs-chip">${esc([c.age_range, c.gender].filter(Boolean).join(' · '))}</span>` : ''}
            <span class="cs-chip">${SHEET.gallery.length} reference(s)</span>`;

        body.innerHTML = `<div id="csMainRoot"></div>
            <details class="cs-more"${SHEET.moreOpen ? ' open' : ''} ontoggle="window.__csMoreToggle && window.__csMoreToggle(this.open)">
                <summary>More: views, expressions, voice and references</summary>${characterSheetHtml(c, plates)}</details>`;
        window.__csMoreToggle = open => { SHEET.moreOpen = open; };
        mountMainSheet(document.getElementById('csMainRoot'), id);
    }

    /**
     * Which picture holds each official view.
     *
     * Legacy names are folded in: a `side` plate predates the left/right split
     * and would otherwise be ranked, on disk, and unreachable from this sheet —
     * money spent and nothing to show for it.
     */
    function csPlatesByView() {
        const out = {};
        for (const item of SHEET.gallery) {
            if (!item.sendable) continue;
            const v = CS_VIEWS.some(x => x.id === item.view) ? item.view : CS_LEGACY[item.view];
            if (v && !out[v]) out[v] = item;
        }
        return out;
    }

    function characterSheetHtml(c, plates) {
        const spec = [
            ['Age', c.age_range], ['Gender', c.gender],
            ['Height', c.height_m ? c.height_m + ' m' : null], ['Build', c.build],
            ['Hair', c.hair], ['Distinguishing', c.distinguishing],
        ].filter(row => row[1]);

        const palette = csPalette();
        const refs = SHEET.gallery.filter(i => !i.sendable);
        const shown = SHEET.filter === 'all' ? refs
            : refs.filter(i => (i.metadata && i.metadata.ref_category) === SHEET.filter);

        return `
        <div class="cs-top">
          <div class="cs-col-l">
            <div class="cs-views-block">
              <div class="cs-label"><span>Official views</span><span class="rule"></span>
                <span class="note">canonical · fed to generation</span></div>
              <div class="cs-views">${CS_VIEWS.map(v => {
                  const p = plates[v.id];
                  return `<div class="cs-plate ${p ? 'locked' : 'pending'}"
                       onclick="${p ? `openPlateViewer(${jsAttr(csImg(p.image_url))}, ${jsAttr((c.name || '') + ' — ' + v.label)})`
                                    : `generateOfficialViews(${jsAttr(v.id)})`}">
                    ${p ? `<img src="${esc(plateSrc(p.image_url, 320))}" alt="">` : ''}
                    <span class="vlabel">${esc(v.label)}</span>
                    <span class="vcap">${p ? esc(v.caption) : 'generate →'}</span>
                    ${p ? '<span class="vdot"></span>'
                        : `<span class="cs-up" onclick="event.stopPropagation();">${
                            slotUpload('character', c.id, v.id, 'upload')}</span>`}
                  </div>`;
              }).join('')}</div>
            </div>

<div class="cs-physical">
              <div class="cs-label"><span>Physical spec</span><span class="rule"></span></div>
              ${spec.length
                  ? `<div class="cs-spec">${spec.map(([k, v]) =>
                        `<div class="cell"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>`
                  : `<p class="text-sm text-muted">Nothing recorded.
                       <a style="cursor:pointer;color:var(--gl-accent,#818cf8);"
                          onclick="closeModal('characterSheetModal'); editCharacter('${c.id}')">Add the physical spec</a>
                       — voice casting and the size in every prompt read these.</p>`}
            </div>

<div class="cs-palette">
              <div class="cs-label"><span>Palette</span><span class="rule"></span></div>
              ${palette.length
                  ? `<div class="cs-swatches">${palette.map((p, i) => `
                        <div class="cs-swatch" onclick="removePaletteSwatch(${i})"
                             title="Click to remove" style="cursor:pointer;">
                        <div class="chip" style="background:${esc(p.hex)};"></div>
                        <div class="cap">${esc(p.name || p.hex)}</div></div>`).join('')}</div>`
                  : '<p class="text-sm text-muted">No palette locked yet.</p>'}
              <div class="cs-add">
                <button class="btn btn-sm" onclick="addPaletteSwatch()">+ Colour</button>
                <button class="btn btn-sm" onclick="paletteFromImage()">From a picture</button>
              </div>
            </div>

<div class="cs-actions">
              <div class="cs-label"><span>Work on this character</span><span class="rule"></span></div>
              <div class="card-actions" style="flex-wrap:wrap;">
                <button class="btn btn-sm" onclick="generateCharacterImage('${c.id}')">Regen plate</button>
                <button class="btn btn-sm" onclick="orbitRefsheet('${c.id}')">Orbit sheet</button>
                <button class="btn btn-sm" onclick="showCharacterViews('${c.id}')">All views</button>
                <button class="btn btn-sm" onclick="openGallery('character', '${c.id}', ${jsAttr(c.name)})">Gallery</button>
                <button class="btn btn-sm" onclick="castCharacterVoice('${c.id}', ${jsAttr(c.name)})">Voice</button>
                ${uploadControl('character-plate', `/characters/${c.id}/refsheet/import`,
                    { extra: { view: 'front' }, after: 'renderCharacterSheet', title: 'Use a picture you already have' })}
              </div>
            </div>
          </div>

          <div class="cs-col-r">
            ${expressionSlotsHtml(c.id, SHEET.expressions, SHEET.expressionError)}
            
            <div class="cs-details">
              <div class="cs-label"><span>Character Description / Appearance</span>
                <span class="rule"></span>
                <span class="note">${(c.appearance_prompt || '').length} chars · prompt source</span></div>
              <div class="cs-prose">${esc(c.appearance_prompt || c.description || 'No character description written.')}</div>
              ${c.description && c.appearance_prompt && c.description !== c.appearance_prompt ? `<details><summary>Biography / story notes</summary><div class="cs-prose small">${esc(c.description)}</div></details>` : ''}
            </div>
            <!-- Side by side, as the reference sets them under one rule. Stacked
                 full width is what made this column run long and pushed the
                 reference strip below the fold. -->
            <div class="cs-two-up">
              <div>
                <button class="btn btn-sm" onclick="closeModal('characterSheetModal'); editCharacter('${c.id}')">Edit description / appearance</button>
              </div>
              <div>
                <div class="cs-label"><span>Personality</span><span class="rule"></span></div>
                <div class="cs-prose small">${esc(c.personality_notes || '—')}</div>
              </div>
            </div>

            <div class="cs-wardrobe">
              <div class="cs-label"><span>Wardrobe &amp; props</span><span class="rule"></span>
                <span class="note">continuity checklist</span></div>
              ${(() => {
                  // Wardrobe items ARE gallery pictures filed under `costume`,
                  // with the title as the note — one storage path and one
                  // upload flow, and the same picture the reference band shows.
                  const ward = SHEET.gallery.filter(i =>
                      (i.metadata && i.metadata.ref_category) === 'costume');
                  return ward.length
                      ? `<div class="cs-ward">${ward.map(w => `
                            <div class="item">
                              ${w.image_url
                                  ? `<img class="thumb" src="${esc(plateSrc(w.image_url, 320))}" alt=""
                                       onclick="openPlateViewer(${jsAttr(csImg(w.image_url))}, ${jsAttr(w.note || 'Wardrobe')})">`
                                  : '<div class="thumb"></div>'}
                              <div style="min-width:0;">
                                <div style="font-size:13px;color:#e8e8ea;">${esc(w.note || 'Wardrobe')}</div>
                                <div class="text-sm text-muted">${esc(w.role)}</div>
                              </div>
                            </div>`).join('')}</div>`
                      : '<p class="text-sm text-muted">No wardrobe recorded yet.</p>';
              })()}
              <div class="cs-add">
                <button class="btn btn-sm" onclick="addWardrobeItem()">+ Upload item</button>
                <button class="btn btn-sm" onclick="generateWardrobeItem()">Generate item</button>
              </div>
            </div>

            
          </div>
        </div>

        <div class="cs-refs">
          <div class="cs-label"><span>Concept art &amp; references</span>
            <div class="cs-pills">
              <span class="cs-pill ${SHEET.filter === 'all' ? 'active' : ''}"
                    onclick="csFilter('all')">All ${refs.length}</span>
              ${CS_CATEGORIES.map(cat => {
                  const n = refs.filter(i => (i.metadata && i.metadata.ref_category) === cat.id).length;
                  return `<span class="cs-pill ${SHEET.filter === cat.id ? 'active' : ''}"
                                onclick="csFilter('${cat.id}')">${esc(cat.label)} ${n}</span>`;
              }).join('')}
            </div>
            <span class="rule"></span>
            <span class="note">promoted refs are what conditions a frame</span></div>
          <div class="cs-tiles">
            ${shown.map(i => `
              <div class="cs-tile ${i.role === 'concept' ? '' : 'starred'}"
                   onclick="openPlateViewer(${jsAttr(csImg(i.image_url))}, ${jsAttr(c.name || '')})">
                ${i.image_url ? `<img src="${esc(plateSrc(i.image_url, 320))}" alt="">` : ''}
                <span class="tl">${esc((i.metadata && i.metadata.ref_category) || i.role)}${i.note ? ' · ' + esc(i.note) : ''}</span>
              </div>`).join('')}
            <div class="cs-tile cs-drop" onclick="addSheetReference()" title="A picture you already have">
              <div style="font-size:18px;">+</div><div>UPLOAD</div>
            </div>
            <div class="cs-tile cs-drop" onclick="generateSheetReference()" title="Generate one from a prompt — spends">
              <div style="font-size:18px;">✦</div><div>GENERATE</div>
            </div>
          </div>
        </div>`;
    }

    function csFilter(id) { SHEET.filter = id; renderCharacterSheet(); }

    /* ── putting things INTO the sheet ─────────────────────────────────────
     *
     * Three regions were read-only dead ends: the reference band could only be
     * filled from another modal, wardrobe said "no wardrobe recorded yet" with
     * no way to record any, and the palette pointed at a table with no UI. A
     * region that shows an empty state and offers no way out of it is a label.
     */

    /** Read a local file as a data URI. One reader for every upload here. */
    function csReadFile(accept) {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = accept || 'image/png,image/jpeg,image/webp';
            input.onchange = () => {
                const file = input.files && input.files[0];
                if (!file) { resolve(null); return; }
                const reader = new FileReader();
                reader.onload = () => resolve({ data: reader.result, name: file.name });
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(file);
            };
            input.click();
        });
    }

    function csCategoryPrompt(label) {
        const ids = CS_CATEGORIES.map(c => c.id);
        const answer = prompt(`${label}\n\nCategory — ${ids.join(', ')}:`, 'sketch');
        if (answer === null) return undefined;              // cancelled
        const v = String(answer).trim().toLowerCase();
        return ids.includes(v) ? v : 'sketch';
    }

    /** A picture you already have, filed under a category. */
    async function addSheetReference() {
        const category = csCategoryPrompt('Add a reference you already have.');
        if (category === undefined) return;
        const file = await csReadFile();
        if (!file) return;
        const note = prompt('What is it? (optional)') || '';
        try {
            await api(`/characters/${SHEET.id}/inspiration`, {
                method: 'POST',
                body: JSON.stringify({ data: file.data, note, category }),
            });
            setStatus('Reference added.');
            await renderCharacterSheet();
        } catch (err) { setStatus('Could not add it: ' + err.message); }
    }

    /** A reference generated from a prompt, filed under a category. */
    /** One reference study, filed under a category. */
    async function generateSheetReference() {
        const category = csCategoryPrompt('Generate a reference.');
        if (category === undefined) return;
        const instruction = prompt('What should it show?\n\ne.g. "three-quarter face study, hard side light"');
        if (!instruction) return;
        return confirmPaidImage({
            title: 'Generate a reference',
            capability: 'image',
            previewUrl: `/characters/${SHEET.id}/explore/preview?count=1`
                + `&instruction=${encodeURIComponent(instruction)}`,
            note: 'Filed as a concept. It conditions nothing until it is promoted to a reference.',
            send: async choices => csBusy('Generating reference…', async () => {
                try {
                    await api(`/characters/${SHEET.id}/explore`, {
                        method: 'POST',
                        body: JSON.stringify({ ...choices, count: 1, instruction, category }),
                    });
                    if (typeof openCharacterSheet === 'function') await openCharacterSheet(SHEET.id);
                } catch (err) { setStatus('Error: ' + err.message); }
            }),
        });
    }

    /**
     * A wardrobe or prop item: a title and a picture.
     *
     * Stored as a gallery item filed under `costume` with the title as its
     * note, rather than in film_costumes — one storage path, one upload flow,
     * and the thumbnail is the same picture the reference band can show.
     */
    async function addWardrobeItem() {
        const title = prompt('Wardrobe or prop — what is it?\n\ne.g. "Rust cardigan / worn open, mid-hip"');
        if (!title) return;
        const file = await csReadFile();
        if (!file) return;
        try {
            await api(`/characters/${SHEET.id}/inspiration`, {
                method: 'POST',
                body: JSON.stringify({ data: file.data, note: title, category: 'costume' }),
            });
            setStatus('Wardrobe item added.');
            await renderCharacterSheet();
        } catch (err) { setStatus('Could not add it: ' + err.message); }
    }

    /** The same item, generated from its own description. */
    /** A wardrobe or prop study, filed under costume. */
    async function generateWardrobeItem() {
        const title = prompt('Wardrobe or prop — what is it?\n\ne.g. "Rust cardigan / worn open, mid-hip"');
        if (!title) return;
        return confirmPaidImage({
            title: `Generate "${title}"`,
            capability: 'image',
            previewUrl: `/characters/${SHEET.id}/explore/preview?count=1`
                + `&instruction=${encodeURIComponent(title)}`,
            note: 'Filed under costume as a concept.',
            send: async choices => csBusy('Generating wardrobe…', async () => {
                try {
                    await api(`/characters/${SHEET.id}/explore`, {
                        method: 'POST',
                        body: JSON.stringify({ ...choices, count: 1, instruction: title,
                            category: 'costume', note: title }),
                    });
                    if (typeof openCharacterSheet === 'function') await openCharacterSheet(SHEET.id);
                } catch (err) { setStatus('Error: ' + err.message); }
            }),
        });
    }

    /* ── the palette ───────────────────────────────────────────────────── */
    async function csSavePalette(palette) {
        const res = await api(`/characters/${SHEET.id}/palette`, {
            method: 'PUT', body: JSON.stringify({ palette }),
        });
        SHEET.palette = res.palette || [];
        if (res.note) setStatus(res.note);
        await renderCharacterSheet();
    }

    /** A colour typed in, with a name. */
    async function addPaletteSwatch() {
        const hex = prompt('Colour — #rrggbb', '#c4643a');
        if (!hex) return;
        const name = prompt('What is it? (optional)', '') || '';
        try {
            await csSavePalette([...(SHEET.palette || []), { hex, name }]);
        } catch (err) { setStatus('Could not save the palette: ' + err.message); }
    }

    async function removePaletteSwatch(index) {
        const next = (SHEET.palette || []).filter((_, i) => i !== index);
        try { await csSavePalette(next); }
        catch (err) { setStatus('Could not save the palette: ' + err.message); }
    }

    /**
     * Colours lifted from a picture already in the sheet.
     *
     * Sampled from the actual pixels on a canvas — a palette guessed from a
     * filename or a prompt would be a claim about the film that nothing
     * supports. Quantised coarsely and counted, so the answer is the colours
     * that COVER the image rather than the most saturated stray pixel.
     */
    async function paletteFromImage() {
        const usable = (SHEET.gallery || []).filter(i => i.image_url && !i.source_url);
        if (!usable.length) {
            setStatus('No picture in the sheet to sample — add a reference first.');
            return;
        }
        const which = usable.length === 1 ? usable[0] : usable[Math.max(0, Number(
            prompt('Sample which picture?\n\n' + usable.map((i, n) =>
                `${n + 1}. ${(i.metadata && i.metadata.ref_category) || i.role}`
                + (i.note ? ' — ' + i.note : '')).join('\n'), '1')) - 1)] || usable[0];

        await csBusy('Sampling colours…', () => new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                try {
                    const c = document.createElement('canvas');
                    const w = c.width = 80, h = c.height = Math.max(1, Math.round(80 * img.height / img.width));
                    const ctx = c.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    const px = ctx.getImageData(0, 0, w, h).data;
                    /*
                     * Coverage, but NOT the backdrop.
                     *
                     * Straight "most common colour" on a character plate
                     * returns five greys: a plate is shot on a seamless
                     * backdrop, so the thing that covers the image is the thing
                     * nobody wants in the palette. Near-neutral bins are set
                     * aside and only used if the picture has nothing else —
                     * a monochrome reference is a legitimate palette, and
                     * returning empty would look broken.
                     */
                    const bins = {}, neutral = {};
                    for (let i = 0; i < px.length; i += 4) {
                        if (px[i + 3] < 128) continue;
                        const r = px[i], g = px[i + 1], b = px[i + 2];
                        const max = Math.max(r, g, b), min = Math.min(r, g, b);
                        const key = [r, g, b].map(v => Math.round(v / 24) * 24).join(',');
                        // Chroma, not HSL saturation: a dark rust and a pale
                        // linen are both wanted, and lightness must not decide.
                        const target = (max - min) < 26 ? neutral : bins;
                        target[key] = (target[key] || 0) + 1;
                    }
                    const pick = Object.keys(bins).length >= 3 ? bins : neutral;
                    const top = Object.entries(pick).sort((a, b) => b[1] - a[1]).slice(0, 5)
                        .map(([k]) => {
                            const [r, g, b] = k.split(',').map(Number);
                            return { hex: '#' + [r, g, b].map(v =>
                                Math.min(255, v).toString(16).padStart(2, '0')).join(''), name: '' };
                        });
                    /*
                     * APPENDED, never replaced.
                     *
                     * Sampling is a suggestion; the swatches somebody typed are
                     * decisions. Overwriting them means one click destroys the
                     * palette they built, with no undo. Duplicates are dropped
                     * so sampling twice does not fill the row with one colour.
                     */
                    const have = new Set((SHEET.palette || []).map(x => x.hex));
                    const added = top.filter(x => !have.has(x.hex));
                    await csSavePalette([...(SHEET.palette || []), ...added]);
                    setStatus(added.length
                        ? `${added.length} colour(s) added from the picture.`
                        : 'Nothing new — those colours are already in the palette.');
                } catch (err) {
                    // A cross-origin image taints the canvas and getImageData
                    // throws. Said plainly rather than surfacing a SecurityError.
                    setStatus('That picture cannot be sampled (it is served from another origin).');
                }
                resolve();
            };
            img.onerror = () => { setStatus('Could not load that picture.'); resolve(); };
            img.src = csImg(which.image_url);
        }));
    }

    /**
     * The locked palette.
     *
     * On the CHARACTER. It used to read film_costumes.color_palette — a real
     * column on a table with no UI and zero rows, so the empty state advised a
     * surface that does not exist.
     */
    function csPalette() { return SHEET.palette || []; }

    /**
     * Generate the official views — all four, or one.
     *
     * Previewed and confirmed like every other paid button. A named view
     * generates only that one, which is what the pending plate's own click
     * does; with no argument it asks whether to do all four.
     */
    /**
     * Generate the official views — all four, or one.
     *
     * Each view goes through the SHARED confirmation, so the prompt is shown
     * and editable and the provider, model, quality and size can be chosen. It
     * used to be a bare confirm() naming a count, which told a director how
     * many images they were buying and nothing about what any of them would be.
     *
     * A sweep confirms ONCE and then runs, because four dialogs to buy a
     * turnaround is a worse experience than one; the choices made in that one
     * apply to every view in the sweep, which is what a turnaround wants
     * anyway — four views generated on different models is four different
     * people.
     */
    async function generateOfficialViews(view) {
        if (!SHEET.id) return;
        const charId = SHEET.id;
        const c = SHEET.character || {};
        const wanted = view ? [view] : CS_VIEWS.map(v => v.id);
        const label = view ? (CS_VIEWS.find(v => v.id === view) || {}).label || view : 'all four views';

        return confirmPaidImage({
            title: `Generate ${label}`,
            capability: 'image',
            previewUrl: `/characters/${charId}/refsheet/preview${
                view ? `?view=${encodeURIComponent(view)}` : ''}`,
            note: `${wanted.length} image generation${wanted.length === 1 ? '' : 's'} for ${
                c.name || 'this character'}. Each replaces the current plate for its view, and `
                + 'every frame this character appears in is conditioned on one of them.',
            send: async choices => csBusy(`Generating ${wanted.length} view(s)…`, async () => {
                let made = 0;
                for (const v of wanted) {
                    try {
                        const result = await api(`/characters/${charId}/refsheet/generate`, {
                            method: 'POST', body: JSON.stringify({ ...choices, views: [v] }),
                        });
                        if (result.manual_handoff) {
                            setStatus(result.result ? 'ChatGPT image imported as a new version' : 'ChatGPT handoff saved — generate manually, then import the image');
                            break;
                        }
                        made++;
                        setStatus(`Generated ${made} of ${wanted.length}…`);
                    } catch (err) {
                        // Stop on a refusal rather than asking again: a refusal
                        // repeated is a refusal paid for.
                        setStatus(`${made} of ${wanted.length} — then: ${err.message}`);
                        break;
                    }
                }
                if (made === wanted.length) setStatus(`${made} view(s) generated.`);
                if (SHEET.id === charId && typeof openCharacterSheet === 'function') await openCharacterSheet(charId);
            }),
        });
    }

    /**
     * Export the sheet as a printable page.
     *
     * Its own print document rather than the app's dark UI: printing a black
     * page wastes a cartridge and reads badly, which is the same reason the
     * screenplay export builds its own.
     */
    async function exportCharacterSheet() {
        const c = SHEET.character;
        if (!c) return;
        // Opened before the sheet is read: a window opened after an await is a pop-up the browser blocks.
        const win = window.open('', '_blank');
        if (!win) { setStatus('Allow pop-ups to export the sheet'); return; }
        win.document.write('<!doctype html><title>Preparing the sheet…</title><p style="font:13px sans-serif">Preparing the sheet…</p>');
        /*
         * The sheet as the director makes it now (MainSheet, backend/lib/character-sheet-main.js): the MAIN picture,
         * the one every generation uses, on top; the variations below it; then the description.
         */
        let main = null, variations = [];
        try { const s = await api(`/characters/${c.id}/sheet`); main = s.main; variations = s.variations || []; }
        catch (err) { setStatus('Could not read the main picture: ' + err.message); }
        const ward = SHEET.gallery.filter(i => (i.metadata && i.metadata.ref_category) === 'costume');
        const palette = SHEET.palette || [];
        // Wardrobe has its own section, so it is not repeated in the contact
        // strip: the same picture twice on one page reads as a mistake.
        // Nor is a variation repeated among the references.
        const shown = new Set([main, ...variations].filter(Boolean).map(v => v.image_url));
        const refs = SHEET.gallery.filter(i => !i.sendable && i.image_url && !shown.has(i.image_url)
            && (i.metadata && i.metadata.ref_category) !== 'costume');

        // The printed sheet (src/lib/print-sheet.js): the same production-document design as the location, prop and storyboard prints.
        const html = sheetHtml(characterDoc({
            project: state.currentProject && state.currentProject.title, character: c,
            main: main && { src: csImg(main.image_url), kind: main.kind },
            variations: variations.map(v => ({ src: plateSrc(v.image_url, 480), kind: v.kind })),
            palette, wardrobe: ward.map(w => ({ src: w.image_url ? plateSrc(w.image_url, 320) : '', note: w.note })),
            references: refs.slice(0, 18).map(r => ({ src: plateSrc(r.image_url, 320) })),
        }));
        win.document.open();
        // Printed once every picture has loaded, so the sheet never prints with empty frames.
        win.document.write(html.replace('</body>', `<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };<\/script></body>`));
        win.document.close();
        setStatus('Character sheet opened for printing');
    }

    async function orbitRefsheet(characterId) {
        return confirmPaidImage({
            capability: 'video',
            title: 'Turnaround from one orbit',
            note: 'Generates a short clip that orbits the character, then cuts it into front, '
                + 'three-quarter, side and back. The views come from one motion, so they cannot '
                + 'disagree with each other the way three separate plates can.',
            previewUrl: `/characters/${characterId}/refsheet/orbit/preview`,
            editable: false,
            notEditableWhy: 'The orbit prompt is composed from the character description and the '
                + 'film\'s medium. Edit the character, then preview again.',
            send: async () => {
                setStatus('Generating orbit turnaround…', true);
                try {
                    const res = await api(`/characters/${characterId}/refsheet/orbit`,
                        { method: 'POST', body: JSON.stringify({}) });
                    const n = (res && res.views ? res.views.length : 0);
                    setStatus(n ? `Turnaround cut: ${res.views.map(v => v.view).join(', ')}`
                        : (res && res.error) || 'The orbit produced no frames.');
                    if (typeof loadCharacters === 'function') loadCharacters();
                } catch (err) { setStatus('Could not generate the orbit: ' + err.message); }
            },
        });
    }

    async function generateCharacterImage(charId) {
        /*
         * The prompt this plate is generated from, before it is bought. A plate
         * conditions EVERY frame its subject appears in, so it is the single
         * worst request to send unread — and it is editable, because the
         * commonest fix is a word in the appearance rather than a re-roll.
         */
        return confirmPaidImage({
            capability: 'image',
            title: 'Generate character plate',
            note: 'This picture becomes the reference for every frame this character appears in.',
            previewUrl: `/characters/${charId}/refsheet/preview?views=front`,
            send: async choices => {
                setStatus('Generating character reference image...', true);
                try {
                    const result = await api('/characters/' + charId + '/refsheet/generate', {
                        method: 'POST', body: JSON.stringify({ views: ['front'], ...choices }),
                    });
                    setStatus(result.manual_handoff ? (result.result ? 'ChatGPT image imported as a new version' : 'ChatGPT handoff saved — generate manually, then import the image') : 'Character image generated');
                    loadCharacters();
                } catch (err) { setStatus('Error generating image: ' + err.message); }
            },
        });
    }

export {
    showCharacterViews,
    deleteCharacterView,
    CS_VIEWS,
    CS_CATEGORIES,
    CS_LEGACY,
    SHEET,
    csBusy,
    openCharacterSheet,
    SHEET_MODE,
    sheetEditable,
    paintSheetModeButtons,
    toggleSheetMode,
    slotUpload,
    renderCharacterSheet,
    csPlatesByView,
    characterSheetHtml,
    csFilter,
    csReadFile,
    csCategoryPrompt,
    addSheetReference,
    generateSheetReference,
    addWardrobeItem,
    generateWardrobeItem,
    csSavePalette,
    addPaletteSwatch,
    removePaletteSwatch,
    paletteFromImage,
    csPalette,
    generateOfficialViews,
    exportCharacterSheet,
    orbitRefsheet,
    generateCharacterImage,
};
