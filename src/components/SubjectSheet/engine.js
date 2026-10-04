/*
 * The location and prop sheet engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. SubjectSheet.jsx renders the modal frame; this draws the sheet into it by id, as before. Kept in core: SS (the sheet state core reads), ssSection (the music chunk uses it) and what the character sheet shares (slotUpload, SHEET_MODE, sheetEditable, paintSheetModeButtons, toggleSheetMode).
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
    confirmPaidImage,
    esc,
    jsAttr,
    loadLocations,
    loadProps,
    openGallery,
    plateSrc,
    regeneratePlate,
    setStatus,
    sheetEditable,
    shootControl,
    showModal,
    slotUpload,
    ssSection,
    uploadControl,
} = Object.fromEntries([
    'api',
    'confirmPaidImage',
    'esc',
    'jsAttr',
    'loadLocations',
    'loadProps',
    'openGallery',
    'plateSrc',
    'regeneratePlate',
    'setStatus',
    'sheetEditable',
    'shootControl',
    'showModal',
    'slotUpload',
    'ssSection',
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
const { SS } = Object.fromEntries(['SS'].map(n => [n, live(n)]));
// Core's values, read live as legacy.X and assigned with setLegacy: API_BASE.

    /*
     * LIGHT: a technique (where the lights stand) and a mood (colour and
     * quantity), staged for THIS shot. The panel says where the lighting now
     * comes from — staged here, the shot's card, the location, or nothing —
     * because a shot that says nothing is lit by its location's choice.
     */
    // The techniques lib/lighting.js declares, in its order (held equal by tests/lighting.test.js):
    // the location sheet renders before any vocabulary request could return.
    const LIGHTING_TECHNIQUE_IDS = Object.freeze(['three-point', 'rembrandt', 'loop', 'butterfly', 'clamshell', 'split', 'broad', 'short', 'backlight', 'silhouette', 'top-light', 'under-light', 'window-motivated', 'practical-motivated', 'high-key', 'low-key', 'chiaroscuro']);

    /**
     * All four sides of a place, from the one plate it already has.
     *
     * A location with one plate hands every shot the same side of the street,
     * so a shot pointing the other way is given a picture of what is BEHIND
     * its camera and invents the rest — which is what blocked 2AA.
     *
     * The cost leads the confirmation, because this is the one control on the
     * page that spends more than one generation in a press.
     */
    /**
     * Sweep the compass: the sides this location is missing.
     *
     * Through the shared gate, so the generator, model, quality and size are a
     * choice. The plan is FREE and is what prices the sweep, so the number in
     * the confirmation is the number that will be charged.
     */
    const SWEEP_NOTE = 'Each side is anchored on the plate you already have, so they are four '
        + 'sides of one place rather than four places. The prompt is per side and is shown when '
        + 'each is generated; the choices here apply to the whole sweep.';

    async function sweepLocationCompass(locationId, btn) {
        return confirmPaidImage({
            title: 'Sweep the compass',
            capability: 'image',
            previewUrl: `/locations/${locationId}/plate/compass/plan`,
            note: SWEEP_NOTE,
            editable: false,
            notEditableWhy: 'Each side is generated from its own prompt, shown as it runs.',
            send: async choices => {
                setStatus('Photographing the other sides…', true);
                if (btn) btn.disabled = true;
                try {
                    const r = await api(`/locations/${locationId}/plate/compass`, {
                        method: 'POST', body: JSON.stringify(choices || {}),
                    });
                    const made = (r && r.generated) || [];
                    const missed = (r && r.not_attempted) || [];
                    setStatus(missed.length
                        ? `${made.length} side(s) made; not attempted: ${missed.join(', ')}`
                        : `${made.length} side(s) generated.`);
                    if (typeof loadLocations === 'function') loadLocations();
                } catch (err) { setStatus('Could not sweep: ' + err.message); }
                finally { if (btn) btn.disabled = false; }
            },
        });
    }

    async function openSubjectSheet(kind, id) {
        SS.kind = kind; SS.id = id; SS.data = null; SS.views = [];
        document.getElementById('ssName').textContent = 'Loading…';
        document.getElementById('ssChips').innerHTML = '';
        document.getElementById('ssBody').innerHTML = '<div class="text-muted">Loading…</div>';
        showModal('subjectSheetModal');
        await renderSubjectSheet();
    }

    /** Any spinner on the sheet. Clears in a finally, or it lies about working. */
    async function ssBusy(label, work) {
        const bar = document.getElementById('ssChips');
        const badge = document.createElement('span');
        badge.className = 'cs-chip cs-busy';
        badge.innerHTML = '<span class="cs-spinner"></span>' + esc(label || 'Working…');
        if (bar) bar.appendChild(badge);
        setStatus(label || 'Working…', true);
        try { return await work(); } finally { badge.remove(); }
    }

    async function renderSubjectSheet() {
        const body = document.getElementById('ssBody');
        if (!body || !SS.id) return;
        try {
            const plural = SS.kind + 's';
            const [subject, views, vocab, spec] = await Promise.all([
                api(`/${plural}/${SS.id}`),
                api(`/${plural}/${SS.id}/plate/views`).catch(() => ({ views: [] })),
                /*
                 * The categories the DATABASE will accept.
                 *
                 * The picker fell back to ['', whatever this prop already is],
                 * so it offered one option and a director could not change the
                 * category at all — the same "a picker must not offer what the
                 * database refuses" rule, failing from the other side by
                 * offering almost nothing. Served from the CHECK's own list.
                 */
                SS.kind === 'prop'
                    ? api('/card-vocabulary').catch(() => ({ prop_categories: [] }))
                    : Promise.resolve(null),
                // The registries the sheet is BUILT from, served rather than
                // mirrored: six sections and five views typed into the page go
                // stale the first time one is renamed.
                api('/sheet-spec').catch(() => null),
            ]);
            if (vocab && vocab.prop_categories) window.__propCategories = ['', ...vocab.prop_categories];
            if (spec) {
                SS.sections = spec.description_sections || [];
                SS.propViews = spec.prop_views || [];
                SS.times = spec.time_variants || [];
            }
            SS.data = subject[SS.kind] || subject;
            SS.views = views.views || [];
            document.getElementById('ssName').textContent = (SS.data.name || SS.kind).toUpperCase();
            document.getElementById('ssGenerateBtn').textContent =
                SS.kind === 'location' ? 'Generate plate' : 'Generate view';
            body.innerHTML = SS.kind === 'location' ? renderLocationSheet() : renderPropSheet();
        } catch (err) {
            // A renderer that paints a placeholder must have a path that
            // replaces it — a spinner that never resolves reads as the data
            // being gone rather than as a display fault.
            body.innerHTML = `<div class="empty-state"><h3>Could not open the sheet</h3>
                <p>${esc(err.message)}</p></div>`;
        }
    }

    /** A field a director types straight into. Saved on blur, never on a timer. */
    function ssField(field, value, opts) {
        const o = opts || {};
        /*
         * `readonly` rather than a different element: the box stays exactly the
         * same size, so leaving edit mode moves nothing on the page.
         */
        const ro = sheetEditable() ? '' : ' readonly tabindex="-1"';
        const view = sheetEditable() ? '' : ' ss-view';
        const common = `data-field="${field}" onchange="saveSheetField('${field}', this.value, this)"`;
        if (o.rows) {
            return `<textarea class="ss-input${view}" rows="${o.rows}" placeholder="${esc(o.placeholder || '')}"${ro} ${common}>${esc(value || '')}</textarea>`;
        }
        if (o.options) {
            return `<select class="ss-input${view}"${sheetEditable() ? '' : ' disabled'} ${common}>${
                o.options.map(v => `<option value="${esc(v)}"${String(value || '') === v ? ' selected' : ''}>${esc(v || '—')}</option>`).join('')
            }</select>`;
        }
        return `<input class="ss-input${view}" type="${o.type || 'text'}"${o.step ? ` step="${o.step}"` : ''}${ro}
            placeholder="${esc(o.placeholder || '')}" value="${esc(value == null ? '' : String(value))}" ${common}>`;
    }

    function ssPlateControls() {
        /*
         * The target is written as a LITERAL per kind rather than computed.
         *
         * The media-import contract is derived from the registered targets and
         * is checked by looking for the call — a computed target is invisible
         * to it, and an import nothing checks is one that quietly stops
         * working. Two lines rather than a ternary inside the call, for that.
         */
        const opts = { extra: {}, after: 'renderSubjectSheet',
            title: 'Use a picture you already have — a photograph, a render, art you were handed' };
        const upload = SS.kind === 'location'
            ? uploadControl('location-plate', `/locations/${SS.id}/plate/import`, opts)
            : uploadControl('prop-plate', `/props/${SS.id}/plate/import`, opts);
        return `<div class="btn-row" style="margin-top:8px;">
            <button class="btn btn-secondary btn-sm" onclick="${SS.kind === 'location'
                ? `generateLocationPlateFor('${SS.id}')` : `generatePropPlateFor('${SS.id}')`}">Generate</button>
            ${/*
                The SAME upload control the cards used, not a second one — it
                carries the registered import target that the media-import
                contract is derived from, and a bespoke input beside it is how
                one of the two stops being checked.
              */ ''}
            ${upload}
            <button class="btn btn-secondary btn-sm" onclick="openSubjectGallery()">Gallery</button>
        </div>`;
    }

    /* ── pieces both sheets use ────────────────────────────────────────── */

    /* The design marks what reaches the generator and what does not, four
       different ways. That distinction is the whole difference between a sheet
       and a form, so it is rendered rather than remembered. */
    const ssReach = kind => kind === 'not-sent'
        ? '<span class="ss-reach ss-not-sent">not sent</span>'
        : '<span class="ss-reach">&rarr; prompt</span>';

    function ssChips(list) {
        return `<div class="cs-chips">${list.filter(Boolean).map(c =>
            `<span class="cs-chip ${c.cls || ''}">${c.html || esc(c.text)}</span>`).join('')}</div>`;
    }

    /** One reference tile, with the star that means "this conditions a frame". */
    function ssRefs() {
        const gallery = (SS.data && SS.data.gallery) || [];
        const cats = {};
        gallery.forEach(g => {
            const c = (g.category || g.role || 'other');
            cats[c] = (cats[c] || 0) + 1;
        });
        const filters = `<div class="ss-ref-filters">
            <span class="ss-ref-filter on">All ${gallery.length}</span>
            ${Object.entries(cats).map(([c, n]) =>
                `<span class="ss-ref-filter">${esc(c)} ${n}</span>`).join('')}
        </div>
        <p class="ss-what">starred refs are attached to the prompt</p>`;
        const tiles = gallery.length
            ? `<div class="cs-refs">${gallery.slice(0, 12).map(g => {
                const sent = g.role === 'reference';
                return `<figure class="cs-tile">
                    ${g.image_url ? `<img src="${esc(plateSrc(g.image_url, 320))}" alt="">` : '<div class="cs-drop"></div>'}
                    <figcaption>${sent ? '<span class="ss-ref-star">&#9733;</span> ' : ''}${esc(g.note || g.role || '')}</figcaption>
                </figure>`;
            }).join('')}</div>`
            : '<p class="text-muted">Nothing gathered yet.</p>';
        return filters + tiles
            + `<button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="openSubjectGallery()">+ Drop reference</button>`;
    }

    /** The provenance the design prints under the plates. */
    /**
     * What this plate IS: seed where one was recorded, size, and the REAL
     * format.
     *
     * It fell back to the literal 'png' and so reported a JPEG plate as a PNG
     * -- the asset row said `format: jpg, mime_type: image/jpeg` and the file
     * on disk ended `.jpg`. Nothing shows a format we were not told; an
     * unknown one is simply omitted rather than guessed, because a confident
     * wrong answer here is worse than a shorter line.
     *
     * A space-between row, as the design draws it: what made the picture on
     * the left, what the file is on the right.
     */
    function ssPlateMeta() {
        const v = (SS.views || []).find(x => x.available) || null;
        if (!v) return '';
        const kb = v.bytes ? `${Math.round(v.bytes / 1024)} kB` : '';
        const left = [v.seed ? `seed ${esc(String(v.seed))}` : '', v.set ? esc(v.set) : '']
            .filter(Boolean).join(' — ');
        const right = [v.format ? esc(String(v.format)) : '', kb].filter(Boolean).join(' · ');
        if (!left && !right) return '';
        return `<p class="ss-plate-meta"><span>${left}</span><span>${right}</span></p>`;
    }

    /*
     * Which plate fills a slot.
     *
     * A slot that names no view means the DEFAULT plate — the view-less one
     * every location has had since before views existed. Matching the slot's
     * role instead left the master plate out of its own slot and the sheet
     * reported "Plates locked 0/1" for a location with two.
     */
    const ssViewFor = name => {
        const want = String(name || '').trim().toLowerCase();
        const views = SS.views || [];
        const bare = views.find(v => !String(v.view || '').trim());
        if (!want) return bare || views[0] || null;
        const named = views.find(v => String(v.view || '').trim().toLowerCase() === want);
        if (named) return named;
        /*
         * A view-less plate IS the front.
         *
         * Every plate generated before views existed carries no view name, and
         * lib/plate-views.js ranks front first for exactly this reason — it is
         * the identity plate, the one headlinePlate attaches to a shot. Without
         * this the turntable reported "locked 1/5" with the front slot showing
         * "generate →" for a prop whose plate is sitting right there.
         */
        return (SS.kind === 'prop' && want === 'front') ? bare || null : null;
    };

    function ssTile(v, label, caption, shape) {
        const url = v && v.available && v.image_url ? legacy.API_BASE + v.image_url : '';
        const cls = shape || 'cs-tile';
        /*
         * The number and the affordance are drawn INSIDE the tile, over the
         * picture -- the label top-left, `generate ->` bottom-left -- because
         * that is what the design draws and what the character sheet has always
         * done. Rendered beneath in a <figcaption>, with `generate ->` centred
         * in the empty box, a plate reads as a captioned photograph and the
         * sheet reads as unfinished, which is how it was reported three times.
         *
         * The caption (what the view IS) stays below: it is prose about the
         * plate rather than a marker on it, and laid over the picture it would
         * compete with the number.
         */
        return `<figure class="ss-slot" style="margin:0;">
            <div class="${cls}">
            ${url ? `<img src="${esc(url)}" alt="${esc(label)}" onclick="openPlateViewer('${esc(url)}', ${jsAttr(label)})">`
                  : `<div class="cs-drop ss-empty" style="width:100%;height:100%;"></div>`}
            <span class="ss-num">${esc(label)}</span>
            ${url ? '' : `<span class="ss-gen" onclick="generateSheetView(${jsAttr((v && v.view) || label)})">generate &rarr;</span>
                <span class="ss-up" onclick="event.stopPropagation();">${
                    slotUpload(SS.kind, SS.id, (v && v.view) || '', 'upload')}</span>`}
            </div>
            ${caption ? `<figcaption class="ss-slot-caption"><span class="ss-view-angle">${esc(caption)}</span></figcaption>` : ''}
        </figure>`;
    }

    /* ── location ──────────────────────────────────────────────────────── */

    /*
     * THE DIAGRAM IS A DIAGRAM, AND THE FIELD BEHIND IT IS PROSE.
     *
     * The compass grid draws its edges as labels -- east and west vertically,
     * in 62px gutters -- so it was built assuming "harbour window + door" and
     * the store capped every edge at 200 characters to keep that true. But
     * this field is what buildPlatePrompt now reads to generate each side, so
     * it has to be able to say what is on that side at length. The store
     * keeps the whole text; the diagram shows the head of it, hovering shows
     * the rest, and the editor has all of it.
     */
    function ssPlanLabel(text, max = 46) {
        const s = String(text || '').trim();
        if (!s) return '—';
        if (s.length <= max) return s;
        // Cut on a word, and prefer a clause end if there is one in range.
        const head = s.slice(0, max);
        const stop = Math.max(head.lastIndexOf(' — '), head.lastIndexOf(', '), head.lastIndexOf('. '));
        const cut = stop > max * 0.5 ? head.slice(0, stop) : head.slice(0, head.lastIndexOf(' ') + 1 || max);
        return cut.replace(/[\s,.;:—-]+$/, '') + '…';
    }

    function renderLocationSheet() {
        const l = SS.data || {};
        const S = SS.sections;
        const sections = SS.parse(l.description_sections, {});
        const flags = SS.list(l.continuity_flags, l.continuity_notes);
        const plan = SS.parse(l.orientation_plan, {});
        const planned = SS.parse(l.plate_plan, []);
        /*
         * FOUR SLOTS, as the design draws them -- its own badge reads "Plates
         * locked 3/4". A location that has never been planned is the common
         * case and was rendering the hero ALONE, because the 3-up row is only
         * emitted when there is more than one slot. The roles are the generic
         * coverage a location needs; the design's own names (Reverse, Counter,
         * Exterior) are one diner's content, so only the structure is copied.
         */
        const slots = planned.length ? planned : [
            { n: 1, role: 'Master', view: '', caption: 'the establishing plate' },
            { n: 2, role: 'Reverse', view: 'south', caption: 'the opposite side' },
            { n: 3, role: 'Detail', view: 'east', caption: 'a closer read of one part' },
            { n: 4, role: 'Exterior', view: 'west', caption: 'how it sits in its surroundings' },
        ];
        const made = slots.filter(x => ssViewFor(x.view)).length;
        const total = Object.values(sections).join(' ').length;
        const linked = l.linked_props || [];

        document.getElementById('ssChips').innerHTML = ssChips([
            { text: `${String(l.id || '').slice(0, 8)} · ${l.location_type || 'int/ext'}`, cls: 'ss-chip-id' },
            { text: `Plates locked ${made}/${slots.length}`, cls: 'ss-chip-plates' },
            { text: `Used in ${Number(l.scene_count) || 0} scenes`, cls: 'ss-chip-scenes' },
            flags.length ? { text: `Continuity: ${flags.length} flag(s)`, cls: 'ss-chip-flags' } : null,
        ]);

        return `
        <div class="ss-grid ls-grid">
          <div class="ss-col">
            ${ssSection('ls-plates', 'Master plates', 'canonical · fed to generation',
                /*
                 * The establishing plate leads, full width. It is not one of
                 * four — it is the one every shot in the scene is
                 * re-photographed against, and the design gives it its own
                 * block above the others for that reason.
                 */
                `<div class="ls-plates-hero">${
                    ssTile(ssViewFor(slots[0].view),
                        `${String(slots[0].n).padStart(2, '0')} · ${slots[0].role}`,
                        slots[0].caption, 'ls-plate')}</div>
                 ${slots.length > 1 ? `<div class="ls-plates-rest">${slots.slice(1).map(sl =>
                    ssTile(ssViewFor(sl.view), `${String(sl.n).padStart(2, '0')} · ${sl.role}`,
                        sl.caption, 'ls-plate')
                 ).join('')}</div>` : ''}${ssPlateMeta()}${ssPlateControls()}
                 <button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="ssEditPlatePlan()">Plan the views</button>`)}

            ${ssSection('ls-orientation', 'Orientation plan', 'keeps geography consistent across plates',
                `<div class="ss-plan">${l.orientation_plan_image_url ? `<img class="ss-plan-image" src="${esc(legacy.API_BASE + l.orientation_plan_image_url)}"
                    alt="Orientation plan for ${esc(l.name || 'location')}"
                    onclick="openPlateViewer('${esc(legacy.API_BASE + l.orientation_plan_image_url)}', ${jsAttr((l.name || 'Location') + ' — orientation plan')})">` : ''}
                 <div class="ss-plan-grid">
                    <span></span><span class="ss-plan-edge n" title="${esc(plan.north || '')}">North · ${esc(ssPlanLabel(plan.north))}</span><span></span>
                    <span class="ss-plan-edge w" title="${esc(plan.west || '')}">West · ${esc(ssPlanLabel(plan.west))}</span>
                    <div class="ss-plan-room">${[0,1,2].map((_, i) =>
                        `<span class="ss-plan-zone" title="${esc((plan.interior || [])[i] || '')}">${esc(ssPlanLabel((plan.interior || [])[i]))}</span>`).join('')}</div>
                    <span class="ss-plan-edge e" title="${esc(plan.east || '')}">East · ${esc(ssPlanLabel(plan.east))}</span>
                    <span></span><span class="ss-plan-edge s" title="${esc(plan.south || '')}">South · ${esc(ssPlanLabel(plan.south))}</span><span></span>
                 </div>${plan.marker ? `<p class="ss-plan-marker" title="${esc(plan.marker)}">&#9650; ${esc(ssPlanLabel(plan.marker, 160))}</p>` : ''}</div>
                 <div class="btn-row" style="margin-top:8px;">
                   <button class="btn btn-secondary btn-sm" onclick="ssEditPlan()">Edit the plan</button>
                   ${uploadControl('orientation-plan', `/locations/${SS.id}/orientation-plan/import`, {
                       extra: {}, after: 'renderSubjectSheet', title: 'Upload an LLM-generated orientation plan image'
                   })}
                   ${l.orientation_plan_image_url ? `<button class="btn btn-secondary btn-sm" onclick="ssDeletePlanImage()">Remove image</button>` : ''}
                   ${captureUploadControl(SS.id, { after: 'renderSubjectSheet' })}
                 </div>`)}

            ${ssSection('ls-variants', 'Time of day variants',
                'The same place at another hour, kept as its own plate rather than regraded.',
                `<div class="ss-variants">${SS.times.map(t => {
                    const have = ssViewFor(t);
                    return `<span class="ss-variant${have ? ' on' : ''}" onclick="generateLocationVariant('${t}')">${t}${have ? ' &#10003;' : ''}</span>`;
                }).join('')}</div>`)}

            

            
          </div>

          <div class="ss-col">
            ${ssSection('ls-description', 'Set description',
                '', `<p class="ss-what ss-desc-total">${total} chars · ${S.length} sections · prompt source ${ssReach('prompt')}</p>` +
                `<div class="btn-row" style="margin-bottom:8px;">
                    <button class="btn btn-secondary btn-sm" onclick="ssCopyDescription()">Copy all</button>
                    <button class="btn btn-secondary btn-sm" onclick="ssToggleSection('*')">Collapse all</button>
                 </div>
                 ${(!Object.keys(sections).length && String(l.description || '').trim())
                    ? `<div class="ss-import">
                        <p>This location was described before the sections existed
                        (${String(l.description).trim().length} characters). Move it into a section to keep it —
                        nothing is written until you choose.</p>
                        <div class="btn-row">${S.map(sec =>
                            `<button class="btn btn-secondary btn-sm" onclick="ssImportDescription('${sec.id}')">${esc(sec.label)}</button>`).join('')}</div>
                       </div>`
                    : ''}
                 ${S.map(sec => {
                    const text = sections[sec.id] || '';
                    return `<div class="ss-section" data-section="${sec.id}">
                        <div class="ss-section-head" onclick="ssToggleSection('${sec.id}')">
                            <span class="ss-section-label">${esc(sec.label)}</span>
                            <span class="ss-section-meta">${esc(sec.kind)} · ${text.length} chars</span>
                        </div>
                        <div class="ss-section-body">
                            <p class="ss-what">${esc(sec.what)}</p>
                            <textarea class="ss-input${sheetEditable() ? '' : ' ss-view'}" rows="4"
                                data-field="section_${sec.id}"${sheetEditable() ? '' : ' readonly tabindex="-1"'}
                                onchange="saveSheetSection('${sec.id}', this.value, this)">${esc(text)}</textarea>
                            ${sec.id === 'decoration' ? `<div class="ss-linked">${
                                linked.map(pr => `<span class="ss-linked-prop" onclick="openSubjectSheet('prop','${pr.id}')">${esc(pr.name)}</span>`).join('')
                                || '<span class="text-muted">No prop named here exists yet.</span>'
                            }</div>` : ''}
                        </div>
                    </div>`;
                 }).join('')}`)}

            <div class="ls-support-grid">
            ${ssSection('ls-lighting', 'Lighting default',
                'How it is lit unless a shot says otherwise.',
                ssField('lighting_default', l.lighting_default, { placeholder: 'golden-hour rake off the water, lit practicals' })
                + ssField('lighting_technique', l.lighting_technique, { options: [''].concat(LIGHTING_TECHNIQUE_IDS) })
                + ssField('lighting_key_side', l.lighting_key_side, { options: ['', 'right', 'left'] })
                + ssField('time_of_day_default', l.time_of_day_default, { placeholder: 'late afternoon' })
                + ssField('location_type', l.location_type, { options: ['', 'interior', 'exterior', 'practical', 'stage', 'backlot'] }),
                ssReach('prompt'))}

            ${ssSection('ls-atmosphere', 'Atmosphere',
                'Weather, haze, season — the standing conditions of the place.',
                ssField('atmosphere_notes', l.atmosphere_notes, { rows: 2, placeholder: 'immaculate, gleaming, air still' }),
                ssReach('prompt'))}

            ${ssSection('ls-sound', 'Sound notes',
                'Notes for whoever writes the ambient cue. This does not reach the image prompt.',
                ssField('sound_notes', l.sound_notes, { rows: 2, placeholder: 'gulls, a screen door, radio low behind the counter' }),
                ssReach('not-sent'))}
            </div>

            
          </div>
        </div>

        <!--
            THE FOOTER, full width beneath the two-column body.

            The design puts Concept art & references in a 1fr column with
            Scenes here and Continuity flags in a 300px one, BELOW the body
            rather than inside it (minmax(0,1fr) 300px, handoff line 236).
            Kept in the body, the references were pinned to half the card and
            the 300px column existed nowhere on the sheet.
        -->
        <div class="ls-footer">
          <div class="ss-col">
            ${ssSection('ls-references', 'Concept art & references',
                'Explorations and gathered images.', ssRefs())}
          </div>
          <div class="ss-col">
            ${ssSection('ls-scenes', 'Scenes here',
                'Derived from the scene headings that name this location.',
                (l.scenes || []).length
                    ? (l.scenes || []).map(sc => {
                        const hour = String(sc.time_of_day || '').toLowerCase();
                        const covered = !hour || ssViewFor(hour);
                        return `<div class="ss-scene-row">
                            <span>Sc. ${esc(String(sc.scene_number))}</span>
                            <span class="text-muted">${esc(sc.time_of_day || '')}${covered ? '' : ' · no plate'}</span>
                        </div>`;
                    }).join('')
                    : '<p class="text-muted">No scene here yet.</p>')}
            ${ssSection('ls-continuity', 'Continuity flags',
                'What must stay true in EVERY plate.',
                `<div>${flags.map((f, i) => `<div class="ss-flag">
                    <span>${esc(f)}</span>
                    <button class="btn btn-secondary btn-sm" onclick="ssRemoveFlag(${i})">&times;</button>
                 </div>`).join('') || '<p class="text-muted">Nothing to hold yet.</p>'}</div>
                 <button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="ssAddFlag()">Add flag</button>`)}
          </div>
        </div>`;
    }

    /* ── prop ──────────────────────────────────────────────────────────── */

    /*
     * VIEWS THAT ARE NOT ON THE TURNTABLE ARE STILL PICTURES.
     *
     * The turntable renders the five canonical slots and matches each by exact
     * name, so a plate generated as "rear", "three-quarter rear" or "interior"
     * was filed, paid for, sitting on disk -- and rendered NOWHERE. The sheet
     * showed one tile and looked like the generation had failed.
     *
     * A canonical set is right: which angles a turnaround needs is a fact about
     * turnarounds. But it cannot be the only thing the sheet can display, or the
     * naming of a view silently decides whether the director ever sees it.
     */
    function psExtraViews() {
        const canonical = new Set((SS.propViews || []).map(v => String(v.id).toLowerCase()));
        const extra = (SS.views || []).filter(v => {
            const name = String(v.view || '').trim();
            return name && !canonical.has(name.toLowerCase());
        });
        if (!extra.length) return '';
        return ssSection('ps-extra-views', 'Other views', 'off the turntable · still fed to generation',
            `<div class="ps-plates">${extra.map(v =>
                ssTile(v, v.view, 'named view · not one of the five', 'ps-plate')).join('')}</div>
             <p class="ss-note">Generated under a name the turntable does not carry. Rename or regenerate
             it as one of the five to have it count towards "locked".</p>`);
    }

    function renderPropSheet() {
        const p = SS.data || {};
        const states = SS.parse(p.continuity_states, []);
        const materials = SS.materials(p.materials_json, p.materials);
        const constraints = SS.list(p.constraints_json, p.constraints);
        const keywords = SS.list(p.keywords, '');
        /*
         * LOCKED COUNTS THE TURNTABLE, NOT EVERY PICTURE.
         *
         * It counted PICTURES and asked which were canonical. A subject can
         * hold two pictures for one slot — a view-less plate is the identity
         * plate and reads as `front`, while an explicit `front` view may also
         * exist — so one slot counted twice. Measured on the live install:
         * 9 views, 6 counted, 5 slots actually filled, front counted twice.
         *
         * Restricting the count to canonical names was the first attempt and
         * still returned 6/5, because both of those rows genuinely ARE front.
         * Only counting SLOTS can be bounded by the number of slots, which is
         * the shape the location and character sheets already had — and why
         * neither of them could ever print this.
         */
        const slotFilled = (id) => (SS.views || []).some(v =>
            v.available && String(v.view || 'front').trim().toLowerCase() === String(id).toLowerCase());
        const made = (SS.propViews || []).filter(slot => slotFilled(slot.id)).length;
        const mm = v => (Number(v) > 0 ? `${Math.round(Number(v) * 1000)} mm` : '—');
        const biggest = Math.max(Number(p.height_m) || 0, Number(p.width_m) || 0, Number(p.length_m) || 0);
        const verdict = !biggest ? 'size not declared'
            : biggest < 0.12 ? 'one-hand object' : biggest < 0.6 ? 'two-hand object'
            : biggest < 2 ? 'carried with effort' : 'set piece';

        document.getElementById('ssChips').innerHTML = ssChips([
            { text: `${String(p.id || '').slice(0, 8)} · ${p.category || 'generic'}`, cls: 'ss-chip-id' },
            { text: `Turntable locked ${made}/${SS.propViews.length}`, cls: 'ss-chip-plates' },
            { text: p.practical ? 'Handled on camera' : 'Not handled', cls: 'ss-chip-handled' },
            { text: `${states.length || 1} state(s)`, cls: 'ss-chip-states' },
        ]);

        return `
        <div class="ps-turntable">
            ${ssSection('ps-plates', 'Turntable · official views', 'canonical · fed to generation',
                /*
                 * Square, auto-fitting, as the prop design lays it out. A prop
                 * is photographed filling its own frame from every side, so
                 * five equal square views ARE the turntable — there is no hero
                 * among them the way a location has an establishing plate.
                 */
                `<div class="ps-plates">${SS.propViews.map(v =>
                    ssTile(ssViewFor(v.id), v.label, `${v.angle} · ${v.caption}`, 'ps-plate')).join('')}</div>
                 ${ssPlateMeta()}${ssPlateControls()}`)}
            ${psExtraViews()}
        </div>

        <div class="ss-grid ps-grid">
          <div class="ss-col">
            ${ssSection('ps-description', 'Object description',
                `${String(p.visual_prompt || '').length} chars · prompt source`,
                `<button class="btn btn-secondary btn-sm" style="margin-bottom:8px;" onclick="ssCopyDescription()">Copy</button>`
                + ssField('visual_prompt', p.visual_prompt, { rows: 5, placeholder: 'Chrome-and-amber tabletop jukebox selector, bolted at seated height…' })
                + `<div class="ss-keywords">${keywords.map((k, i) =>
                    `<span class="ss-keyword" onclick="ssRemoveKeyword(${i})">${esc(k)} &times;</span>`).join('')}
                   <span class="ss-keyword ss-add" onclick="ssAddKeyword()">+ keyword</span></div>
                   <p class="ss-what">The few words that must survive into every frame.</p>`
                + '<p class="ss-what">For a person; reaches no prompt.</p>'
                + ssField('description', p.description, { rows: 2, placeholder: 'A tabletop jukebox selector, one per booth.' }),
                ssReach('prompt'))}

            ${ssSection('ps-materials', 'Materials & finish', 'What it is made of and how it catches light.',
                `<div>${materials.map((m, i) => `<div class="ss-material">
                    <span class="ss-mat-swatch" style="background:${/^#[0-9A-F]{6}$/i.test(m.hex) ? m.hex : 'transparent'};"></span>
                    <strong>${esc(m.name)}</strong>
                    <span class="text-sm text-muted">${esc(m.role || '')}${m.hex ? ' · ' + esc(m.hex) : ''}</span>
                    <button class="btn btn-secondary btn-sm" onclick="ssRemoveMaterial(${i})">&times;</button>
                 </div>`).join('') || '<p class="text-muted">Nothing recorded.</p>'}</div>
                 <button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="ssAddMaterial()">Add material</button>`)}

            ${ssSection('ps-states', 'Continuity states', 'each state generates its own plate set',
                `<div class="ps-states-grid">${states.length ? states.map((st, i) => `<div class="ss-state">
                    <strong>${String.fromCharCode(65 + i)} · ${esc(st.name)}</strong>
                    ${st.scene ? `<span class="cs-pill">${esc(st.scene)}</span>` : '<span class="cs-pill">default</span>'}
                    <span class="text-sm text-muted">${esc(st.what || '')}</span>
                    <button class="btn btn-secondary btn-sm" onclick="removePropState(${i})">&times;</button>
                 </div>`).join('') : '<p class="text-muted">One state — as built. Add another when it changes.</p>'}</div>
                 <button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="addPropState()">Add state</button>`)}

            ${ssSection('ps-references', 'Concept art & references',
                'Explorations and gathered images.', ssRefs())}
          </div>

          <div class="ss-col">
            ${ssSection('ps-scale', 'Scale',
                'How big it is. Without this an image model reproduces whatever it was shown, at any size.',
                `<div class="ss-scale-bar">
                    <span class="ss-scale-hand">hand</span>
                    <span class="ss-scale-prop" style="width:${Math.max(8, Math.min(100, (biggest || 0) * 120))}%;">prop</span>
                 </div>
                 <p class="cs-prose">W ${mm(p.width_m)} · H ${mm(p.height_m)} · D ${mm(p.length_m)} &mdash; ${verdict}</p>
                 <div class="ss-spec-grid">
                    <label>Height (m) ${ssField('height_m', p.height_m, { type: 'number', step: '0.01' })}</label>
                    <label>Width (m) ${ssField('width_m', p.width_m, { type: 'number', step: '0.01' })}</label>
                    <label>Length (m) ${ssField('length_m', p.length_m, { type: 'number', step: '0.01' })}</label>
                 </div>`)}

            ${ssSection('ps-spec', 'Spec', 'Period, category, how many there are, and whether it has to work on camera.',
                `<div class="ss-spec-row"><span>Period</span>${ssField('period', p.period, { placeholder: '1952' })}</div>
                 <div class="ss-spec-row"><span>Category</span>${ssField('category', p.category, { options: (window.__propCategories || ['', p.category || '']) })}</div>
                 <div class="ss-spec-row"><span>Quantity</span>${ssField('quantity', p.quantity == null ? 1 : p.quantity, { type: 'number' })}</div>
                 <div class="ss-spec-row"><span>Practical</span>${ssField('practical', p.practical ? 'yes' : 'no', { options: ['no', 'yes'] })}</div>`)}

            ${ssSection('ps-appears', 'Appears in',
                'From the scene cards that NAME this prop — the same list that decides whether its plate reaches a frame.',
                ((p.shots || []).length
                    ? (p.shots || []).map(code => `<div class="ss-appear-row">
                        <span>${esc(code)}</span>
                        <span class="text-muted">state ${states.length ? 'A' : '—'}</span>
                       </div>`).join('')
                    : '<p class="text-muted">No shot names it yet.</p>')
                + `<div class="ss-open-set">${(p.locations || []).slice(0, 6).map(loc =>
                    `<span class="ss-linked-prop" onclick="openSubjectSheet('location','${loc.id}')">Open set &rarr; ${esc(loc.name)}</span>`).join('')
                    || '<span class="text-muted">No set to open.</span>'}</div>`)}

            ${ssSection('ps-constraints', 'Constraints', 'What it must never be or do.',
                `<div>${constraints.map((c, i) => `<div class="ss-constraint">
                    <span>${esc(c)}</span>
                    <button class="btn btn-secondary btn-sm" onclick="ssRemoveConstraint(${i})">&times;</button>
                 </div>`).join('') || '<p class="text-muted">Nothing recorded.</p>'}</div>
                 <button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="ssAddConstraint()">Add constraint</button>
                 <p class="ss-what">Production notes — for a person. These reach NO prompt.</p>
                 ${ssField('notes', p.notes, { rows: 2, placeholder: 'two built, one held back for the break' })}`)}
          </div>
        </div>`;
    }

    /* ── the ways in ───────────────────────────────────────────────────── */

    /* ── editing the structured half ───────────────────────────────────── */

    /** One description section. Merged, so writing one never clears another. */
    async function saveSheetSection(id, text, el) {
        const sections = { ...(SS.parse(SS.data.description_sections, {}) || {}), [id]: text };
        try {
            await api(`/locations/${SS.id}`, {
                method: 'PUT', body: JSON.stringify({ description_sections: sections }),
            });
            SS.data.description_sections = JSON.stringify(sections);
            if (el) el.style.borderColor = 'var(--gl-success, #166534)';
            // Redrawn so the character count and the total move with the text —
            // a count that does not is worse than none.
            renderSubjectSheet();
        } catch (err) {
            if (el) el.style.borderColor = 'var(--gl-danger, #7f1d1d)';
            setStatus('Error: ' + err.message);
        }
    }

    /**
     * Move an old one-paragraph description into a section.
     *
     * Every location written before the sections existed has its text in
     * `description`, and composing over it would replace an 856-character set
     * description with whatever was typed into one box. The route refuses that;
     * this is the way through — the director says WHICH section the old text
     * is, because only they know.
     */
    async function ssImportDescription(sectionId) {
        const text = String((SS.data && SS.data.description) || '').trim();
        if (!text) return;
        const sections = { ...(SS.parse(SS.data.description_sections, {}) || {}), [sectionId]: text };
        try {
            await api(`/locations/${SS.id}`, {
                method: 'PUT',
                // Deliberate: the old text is now IN the sections, so composing
                // over the column loses nothing.
                body: JSON.stringify({ description_sections: sections, replace_description: true }),
            });
            SS.data.description_sections = JSON.stringify(sections);
            await renderSubjectSheet();
            setStatus('Moved into the section. The description is now composed from the sections.');
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    /** Fold a section, or all of them. Six open at once is unreadable. */
    function ssToggleSection(id) {
        const all = id === '*';
        const nodes = document.querySelectorAll('#ssBody .ss-section');
        const anyOpen = [...nodes].some(n => !n.classList.contains('closed'));
        nodes.forEach(n => {
            if (all) n.classList.toggle('closed', anyOpen);
            else if (n.dataset.section === id) n.classList.toggle('closed');
        });
    }

    /** The whole description, assembled the way the prompt receives it. */
    function ssCopyDescription() {
        const text = SS.kind === 'prop'
            ? String((SS.data && SS.data.visual_prompt) || '')
            : SS.sections.map(sec => {
                const body = (SS.parse(SS.data.description_sections, {}) || {})[sec.id] || '';
                return body ? `${sec.label.toUpperCase()}\n${body}` : '';
            }).filter(Boolean).join('\n\n');
        if (!text) return setStatus('Nothing written yet.');
        navigator.clipboard.writeText(text)
            .then(() => setStatus(`${text.length} characters copied.`))
            .catch(() => setStatus('Could not reach the clipboard.'));
    }

    /** A generic list column: continuity flags, constraints, keywords. */
    async function ssSaveList(field, list) {
        const url = SS.kind === 'location' ? `/locations/${SS.id}` : `/props/${SS.id}`;
        try {
            await api(url, { method: 'PUT', body: JSON.stringify({ [field]: list }) });
            SS.data[field] = JSON.stringify(list);
            await renderSubjectSheet();
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    const ssReadList = field => SS.list(SS.data[field],
        field === 'continuity_flags' ? SS.data.continuity_notes
            : field === 'constraints_json' ? SS.data.constraints : '');

    function ssAddFlag() {
        const v = prompt('What must stay true in every plate?');
        if (v && v.trim()) ssSaveList('continuity_flags', [...ssReadList('continuity_flags'), v.trim()]);
    }

    function ssRemoveFlag(i) {
        const list = ssReadList('continuity_flags'); list.splice(i, 1);
        ssSaveList('continuity_flags', list);
    }

    function ssAddConstraint() {
        const v = prompt('What must it never be or do?');
        if (v && v.trim()) ssSaveList('constraints_json', [...ssReadList('constraints_json'), v.trim()]);
    }

    function ssRemoveConstraint(i) {
        const list = ssReadList('constraints_json'); list.splice(i, 1);
        ssSaveList('constraints_json', list);
    }

    function ssAddKeyword() {
        const v = prompt('A word that must survive into every frame:');
        if (v && v.trim()) ssSaveList('keywords', [...SS.list(SS.data.keywords, ''), v.trim()]);
    }

    function ssRemoveKeyword(i) {
        const list = SS.list(SS.data.keywords, ''); list.splice(i, 1);
        ssSaveList('keywords', list);
    }

    /** A material row: what it is, where it is, and its colour. */
    async function ssAddMaterial() {
        const name = prompt('Material — "polished chrome", "amber acrylic"?');
        if (!name || !name.trim()) return;
        const role = prompt('Where is it, and how does it behave? — "panel, backlit"') || '';
        const hex = prompt('Its colour as #rrggbb (optional) — a hex nobody can see is a string') || '';
        const list = SS.materials(SS.data.materials_json, SS.data.materials);
        list.push({ name: name.trim(), role: role.trim(), hex: hex.trim() });
        await ssSaveList('materials_json', list);
    }

    async function ssRemoveMaterial(i) {
        const list = SS.materials(SS.data.materials_json, SS.data.materials);
        list.splice(i, 1);
        await ssSaveList('materials_json', list);
    }

    /**
     * The plan of the room.
     *
     * This is what keeps four plates of one place describing the same place —
     * a plate carries no information about what is behind its own camera, so
     * without the plan each side is generated from prose that cannot say.
     */
    async function ssEditPlan() {
        const plan = SS.parse(SS.data.orientation_plan, {}) || {};
        const next = { interior: plan.interior || [], marker: plan.marker || '' };
        for (const edge of ['north', 'east', 'south', 'west']) {
            const v = prompt(`${edge.toUpperCase()} — what is on that side?`, plan[edge] || '');
            if (v === null) return;
            next[edge] = v.trim();
        }
        const inside = prompt('Exactly three room zones, comma separated — "counter and stools, centre aisle, booths"',
            (plan.interior || []).join(', '));
        if (inside !== null) next.interior = inside.split(',').map(x => x.trim()).filter(Boolean).slice(0, 3);
        const marker = prompt('Where does the action sit? — "corner booth, north end"', plan.marker || '');
        if (marker !== null) next.marker = marker.trim();
        try {
            await api(`/locations/${SS.id}`, { method: 'PUT', body: JSON.stringify({ orientation_plan: next }) });
            SS.data.orientation_plan = JSON.stringify(next);
            await renderSubjectSheet();
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    async function ssDeletePlanImage() {
        if (!confirm('Remove this orientation-plan image?\n\nThe scan moves to deleted/orientation so it can be recovered by hand. The structured compass plan stays.')) return;
        try {
            await api(`/locations/${SS.id}/orientation-plan`, { method: 'DELETE' });
            await renderSubjectSheet();
            setStatus('Orientation-plan image removed; compass data kept.');
        } catch (err) { setStatus('Could not remove the plan image: ' + err.message); }
    }

    /**
     * Which views this location is MEANT to have.
     *
     * An ungenerated view then shows as a labelled empty slot rather than an
     * absence nobody can see — which is the difference between "we still need
     * the reverse" and a sheet that looks finished.
     */
    async function ssEditPlatePlan() {
        const plan = SS.parse(SS.data.plate_plan, []) || [];
        const raw = prompt(
            'The views this location needs, one per line as "role | view name | caption".\n\n'
            + 'The view name is what a shot card asks for; leave it blank for the default plate.',
            (plan.length ? plan : [{ role: 'Master', view: '', caption: 'the establishing plate' }])
                .map(x => [x.role, x.view, x.caption].join(' | ')).join('\n'));
        if (raw === null) return;
        const next = raw.split('\n').map(line => {
            const [role, view, caption] = line.split('|').map(x => (x || '').trim());
            return { role, view, caption };
        }).filter(x => x.role);
        try {
            await api(`/locations/${SS.id}`, { method: 'PUT', body: JSON.stringify({ plate_plan: next }) });
            SS.data.plate_plan = JSON.stringify(next);
            await renderSubjectSheet();
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    /** Generate one named view — a planned slot, or an official prop view. */
    /**
     * Generate one view from a subject sheet.
     *
     * DELEGATES to regeneratePlate, which already carries the free preview, the
     * editable prompt and the provider/model/quality/size controls. This used
     * to send a bare confirm() and then POST to `/props/${SS.id}/plate/generate`
     * for anything that was not a location -- so pressing Generate on a
     * CHARACTER sheet posted a character's id to the props endpoint, and
     * nothing happened. Reported as exactly that: "no prompt was shown,
     * nothing, not even a spinner".
     */
    async function generateSheetView(view) {
        if (!SS.id || !SS.kind) return;
        return regeneratePlate(SS.kind, SS.id, view, () => renderSubjectSheet());
    }

    /**
     * Write one field.
     *
     * Merged by the route, so typing in one box cannot clear another — the
     * lesson the scene card and the provider config both paid for.
     */
    async function saveSheetField(field, value, el) {
        if (!SS.id) return;
        let v = value;
        if (field === 'practical') v = value === 'yes';
        if (['quantity', 'height_m', 'width_m', 'length_m'].includes(field)) {
            if (String(value).trim() === '') return;      // blank means unsaid, not zero
            v = Number(value);
        }
        try {
            await api(`/${SS.kind}s/${SS.id}`, { method: 'PUT', body: JSON.stringify({ [field]: v }) });
            SS.data[field] = v;
            if (el) el.style.borderColor = 'var(--gl-success, #166534)';
            setStatus('Saved');
        } catch (err) {
            if (el) el.style.borderColor = 'var(--gl-danger, #7f1d1d)';
            setStatus('Error: ' + err.message);
        }
    }

    async function addPropState() {
        const name = prompt('State name — clean, chipped, burnt?');
        if (!name || !name.trim()) return;
        const what = prompt('What is different about it?') || '';
        const scene = prompt('Which scene does it start in? (optional)') || '';
        let states = [];
        try { states = JSON.parse(SS.data.continuity_states || '[]') || []; } catch (_) { states = []; }
        states.push({ name: name.trim(), what: what.trim(), scene: scene.trim() });
        await savePropStates(states);
    }

    async function removePropState(i) {
        let states = [];
        try { states = JSON.parse(SS.data.continuity_states || '[]') || []; } catch (_) { states = []; }
        states.splice(i, 1);
        await savePropStates(states);
    }

    async function savePropStates(states) {
        try {
            await api(`/props/${SS.id}`, { method: 'PUT', body: JSON.stringify({ continuity_states: states }) });
            SS.data.continuity_states = JSON.stringify(states);
            await renderSubjectSheet();
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    /** The plate for whichever subject the sheet is open on. */
    function generateSheetPlate() {
        if (SS.kind === 'location') return generateLocationPlateFor(SS.id);
        return generatePropPlateFor(SS.id);
    }

    async function generateLocationPlateFor(id) {
        // Delegated: one gate, one preview, one set of controls.
        return regeneratePlate('location', id, null, () => {
            renderSubjectSheet();
            if (typeof loadLocations === 'function') loadLocations();
        });
    }

    async function generatePropPlateFor(id) {
        // Delegated: one gate, one preview, one set of controls.
        return regeneratePlate('prop', id, null, () => {
            renderSubjectSheet();
            if (typeof loadProps === 'function') loadProps();
        });
    }

    /**
     * Another view of the same place.
     *
     * A compass sweep and a time-of-day variant are the same operation with a
     * different view name — the location already stores views per name, and a
     * second mechanism for "the same place, different conditions" is how one of
     * them ends up not reaching gatherShotReferences.
     */
    /** From a subject sheet: sweep the compass, or photograph one named view. */
    async function generateLocationVariant(view) {
        if (view === 'compass') return sweepLocationCompass(SS.id);
        return regeneratePlate('location', SS.id, view, () => renderSubjectSheet());
    }

    /**
     * The gallery for whichever subject is open.
     *
     * Branched to literals rather than passing SS.kind through: the gallery
     * contract is checked by looking for the call per kind, and a computed
     * argument is invisible to it — a workspace nothing checks is one that
     * quietly loses its promote rule for one subject and not the others.
     */
    function openSubjectGallery() {
        if (!SS.id) return;
        const name = (SS.data && SS.data.name) || SS.kind;
        if (SS.kind === 'location') return openGallery('location', SS.id, name);
        return openGallery('prop', SS.id, name);
    }

    /**
     * The sheet as a printable document.
     *
     * Its own page rather than printing the app: the dark UI wastes a cartridge
     * and reads badly, which is why the screenplay export already does this.
     */
    function exportSubjectSheet() {
        if (!SS.data) return;
        const body = document.getElementById('ssBody');
        const w = window.open('', '_blank');
        if (!w) return setStatus('Allow pop-ups to export the sheet.');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8">
            <title>${esc(SS.data.name || SS.kind)}</title>
            <style>
              @page { size: A4; margin: 16mm; }
              body { font-family: Georgia, 'Times New Roman', serif; color: #111; }
              h1 { font-size: 20pt; margin: 0 0 4mm; letter-spacing: .02em; }
              h4 { font-size: 9pt; letter-spacing: .08em; text-transform: uppercase;
                   color: #555; margin: 6mm 0 2mm; border-bottom: .3pt solid #bbb; padding-bottom: 1mm; }
              .ss-what { font-size: 8pt; color: #666; margin: 0 0 2mm; }
              img { max-width: 46mm; margin: 0 2mm 2mm 0; }
              .ss-grid { column-count: 2; column-gap: 10mm; }
              .ss-input, button, .btn-row, label > input, label > select { display: none !important; }
              .ss-region { break-inside: avoid; }
            </style></head><body>
            <h1>${esc(SS.data.name || '')}</h1>${body.innerHTML}</body></html>`);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 400);
    }

    /*
     * A WORLD CAPTURE is not a plate, so it does not go through uploadControl.
     *
     * uploadControl accepts PNG and JPEG because a plate is a picture. A
     * capture is whichever of three media the director stood in the room and
     * shot — a 360 panorama, a short orbit clip, or a LiDAR scan — and the
     * server decides which from the bytes, not from the name the phone gave it.
     * Offering all three from one control is what keeps that one act one act.
     *
     * The shoot affordance comes from the shared helper, so the accept type
     * decides the capture device exactly as it does everywhere else.
     */
    function captureUploadControl(locationId, opts) {
        const o = opts || {};
        const accept = 'image/png,image/jpeg,video/mp4,video/quicktime,.png,.jpg,.jpeg,.mp4,.mov,.glb';
        const url = `/locations/${locationId}/capture/import`;
        const onchange = `uploadReferenceImage(event, 'world-capture', '${url}', {}, '${o.after || ''}')`;
        return `<label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0;"
                       title="${esc(o.title || 'A panorama, a short orbit clip, or a LiDAR scan of the real place')}"
                       onclick="event.stopPropagation();">${esc(o.label || 'Add capture')}
                    <input type="file" data-import-target="world-capture"
                           accept="${accept}" style="display:none"
                           onclick="event.stopPropagation();"
                           onchange="${onchange}">
                </label>${shootControl('world-capture', url, accept,
                    'data-import-target="world-capture"', onchange, o)}`;
    }

export {
    LIGHTING_TECHNIQUE_IDS,
    SWEEP_NOTE,
    sweepLocationCompass,
    openSubjectSheet,
    ssBusy,
    renderSubjectSheet,
    ssField,
    ssPlateControls,
    ssReach,
    ssChips,
    ssRefs,
    ssPlateMeta,
    ssViewFor,
    ssTile,
    ssPlanLabel,
    renderLocationSheet,
    psExtraViews,
    renderPropSheet,
    saveSheetSection,
    ssImportDescription,
    ssToggleSection,
    ssCopyDescription,
    ssSaveList,
    ssReadList,
    ssAddFlag,
    ssRemoveFlag,
    ssAddConstraint,
    ssRemoveConstraint,
    ssAddKeyword,
    ssRemoveKeyword,
    ssAddMaterial,
    ssRemoveMaterial,
    ssEditPlan,
    ssDeletePlanImage,
    ssEditPlatePlan,
    generateSheetView,
    saveSheetField,
    addPropState,
    removePropState,
    savePropStates,
    generateSheetPlate,
    generateLocationPlateFor,
    generatePropPlateFor,
    generateLocationVariant,
    openSubjectGallery,
    exportSubjectSheet,
    captureUploadControl,
};
