/*
 * The music engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. The three music pages (Music & Sound, Music Cues, the Score workstation): the sound library and its cards, the cue sheet, the score session, its lanes, piano roll, mixer, takes, AI actions and DAW panel. MOVED from the legacy music chunk (generated from film-engine's page). React renders the three pages; this draws into them by id, as before.
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
    checkUploadSize,
    clearModal,
    closeModal,
    confirmPaidImage,
    esc,
    escapeHtml,
    getModalData,
    jsAttr,
    mediaUploadControl,
    mediaUrl,
    mwTime,
    setStatus,
    showModal,
    showModalHtml,
    ssSection,
    streamSSEPost,
} = Object.fromEntries([
    '_shotAction',
    'api',
    'checkUploadSize',
    'clearModal',
    'closeModal',
    'confirmPaidImage',
    'esc',
    'escapeHtml',
    'getModalData',
    'jsAttr',
    'mediaUploadControl',
    'mediaUrl',
    'mwTime',
    'setStatus',
    'showModal',
    'showModalHtml',
    'ssSection',
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
const { MW, state } = Object.fromEntries(['MW', 'state'].map(n => [n, live(n)]));
// Core's values, read live as legacy.X and assigned with setLegacy: API_BASE.

    // ══════════════════════════════════════════════════════════════
    // MUSIC CUES
    // ══════════════════════════════════════════════════════════════
    async function loadMusicCues() {
        if (!state.currentProject) return;
        try {
            const data = await api('/projects/' + state.currentProject.id + '/music-cues');
            state.musicCues = data.music_cues || [];
            const el = document.getElementById('musicCueList');
            if (state.musicCues.length === 0) {
                el.innerHTML = `<div class="empty-state"><div class="icon">&#127925;</div><h3>No music cues</h3><p>Add music cues for your scenes.</p></div>`;
            } else {
                const icons = { score: '&#127932;', source: '&#127911;', sfx: '&#128165;', ambient: '&#127811;', transition: '&#127796;' };
                el.innerHTML = state.musicCues.map(c => `
                    <div class="cue-card">
                        <div class="cue-icon ${c.cue_type}">${icons[c.cue_type] || '&#127925;'}</div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;">${esc(c.title || 'Untitled')}</div>
                            <div class="text-sm text-muted">${esc(c.description || '')}</div>
                            <div class="tag-row" style="margin-top:4px;">
                                <span class="badge">${c.cue_type}</span>
                                ${c.mood ? '<span class="tag">' + esc(c.mood) + '</span>' : ''}
                                ${c.genre ? '<span class="tag">' + esc(c.genre) + '</span>' : ''}
                                ${c.tempo_bpm ? '<span class="tag">' + c.tempo_bpm + ' BPM</span>' : ''}
                                ${cueRightsTag(c)}
                            </div>
                            <div class="card-actions" style="margin-top:8px;">
                                <button class="btn btn-secondary btn-sm" onclick="openCueRights('${c.id}')"
                                        title="Who owns this music, on what licence, where, until when">Rights</button>
                            </div>
                        </div>
                    </div>`).join('');
            }
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    /*
     * ── Rights on a cue ─────────────────────────────────────────────────────
     *
     * `PUT /film/music-cues/:id/rights` has existed since the rights work and
     * the Music Cues page rendered no control for ANY of its six fields, so who
     * owns a piece of music, on what licence, in which territory and until when
     * could only be recorded by curl or by an agent. Delivery is the wrong
     * moment to discover that nobody wrote it down.
     *
     * The vocabulary is SERVED, never typed here: the route validates
     * license_status and license_type against its own lists and refuses
     * anything else, so a page holding a second copy offers values that are
     * rejected the first time somebody adds a status.
     */
    let CUE_RIGHTS_VOCAB = null;

    /** A cue's rights state, as one readable tag. Unknown is worth showing. */
    function cueRightsTag(cue) {
        const status = cue.license_status || 'unknown';
        const colour = status === 'licensed' || status === 'public_domain' || status === 'original'
            ? 'var(--gl-success)'
            : status === 'expired' || status === 'rejected' ? 'var(--gl-danger,#ef4444)' : 'var(--gl-warning,#f59e0b)';
        return `<span class="tag" style="border-color:${colour};color:${colour};"
                      title="Licence status — a cue nobody has cleared cannot ship">${esc(status.replace('_', ' '))}</span>`;
    }

    async function openCueRights(cueId) {
        const cue = (state.musicCues || []).find(c => c.id === cueId);
        if (!cue) return setStatus('That cue is no longer on this project');
        if (!CUE_RIGHTS_VOCAB) {
            try {
                const data = await api(`/projects/${state.currentProject.id}/music-rights`);
                CUE_RIGHTS_VOCAB = data.vocabulary || null;
            } catch (err) { return setStatus('Could not read the rights vocabulary: ' + err.message); }
        }
        if (!CUE_RIGHTS_VOCAB) return setStatus('This server serves no rights vocabulary — it may predate it.');

        const opts = (list, current) => list.map(v =>
            `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v.replace(/_/g, ' '))}</option>`).join('');

        showModalHtml('cueRightsModal', `
            <div class="modal-header">
                <h3>Rights &mdash; ${esc(cue.title || 'Untitled cue')}</h3>
                <button class="modal-close" onclick="closeModal('cueRightsModal')">&times;</button>
            </div>
            <div class="modal-body">
                <p class="text-sm text-muted" style="margin-top:0;">
                    Recorded, not enforced: nothing here blocks a generation or an export. It is what a
                    delivery needs to be able to answer, and the moment to write it down is now rather
                    than at delivery.</p>
                <div class="form-group">
                    <label>Status</label>
                    <select id="cueRightsStatus" data-field="license_status">${opts(CUE_RIGHTS_VOCAB.license_status, cue.license_status || 'unknown')}</select>
                </div>
                <div class="form-group">
                    <label>Licence type</label>
                    <select id="cueRightsType" data-field="license_type">
                        <option value="">Not stated</option>
                        ${opts(CUE_RIGHTS_VOCAB.license_type, cue.license_type || '')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Holder</label>
                    <input type="text" id="cueRightsHolder" data-field="license_holder" maxlength="500"
                           value="${esc(cue.license_holder || '')}" placeholder="Who owns it — the label, the composer, you">
                </div>
                <div class="form-group">
                    <label>Territory</label>
                    <input type="text" id="cueRightsTerritory" data-field="license_territory" maxlength="200"
                           value="${esc(cue.license_territory || '')}" placeholder="e.g. worldwide, or UK &amp; Ireland">
                </div>
                <div class="form-group">
                    <label>Cost</label>
                    <input type="number" id="cueRightsCost" data-field="license_cost" min="0" step="0.01"
                           value="${cue.license_cost || 0}">
                </div>
                <div class="form-group">
                    <label>Expires</label>
                    <input type="date" id="cueRightsExpiry" data-field="license_expiry"
                           value="${esc((cue.license_expiry || '').slice(0, 10))}">
                    <span class="text-sm text-muted">Blank means it does not expire.</span>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('cueRightsModal')">Cancel</button>
                <button class="btn btn-primary" onclick="saveCueRights('${cue.id}')">Save rights</button>
            </div>`);
    }

    async function saveCueRights(cueId) {
        const val = id => (document.getElementById(id) || {}).value;
        /*
         * Every field is sent, including the blank ones. The route reads
         * `!== undefined`, so omitting a field leaves the stored value alone —
         * which would make CLEARING a holder or a territory impossible, and a
         * field you cannot empty is one that goes stale and stays wrong.
         */
        const body = {
            license_status: val('cueRightsStatus'),
            license_type: val('cueRightsType'),
            license_holder: val('cueRightsHolder'),
            license_territory: val('cueRightsTerritory'),
            license_cost: Number(val('cueRightsCost')) || 0,
            license_expiry: val('cueRightsExpiry'),
        };
        try {
            await api(`/music-cues/${cueId}/rights`, { method: 'PUT', body: JSON.stringify(body) });
            closeModal('cueRightsModal');
            setStatus('Rights saved');
            loadMusicCues();
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    /*
     * ── Sections a director types ───────────────────────────────────────────
     *
     * Held in a plain array beside the modal rather than in the DOM, because a
     * row rebuilt on every keystroke loses the caret in the field being typed
     * into — the same reason the screenplay editor stopped adopting its own
     * furniture.
     */
    let CUE_SECTIONS = [];

    function cueRenderSections() {
        const host = document.getElementById('cueSections');
        if (!host) return;
        if (!CUE_SECTIONS.length) {
            host.innerHTML = '<p class="text-sm text-muted">No sections &mdash; one prompt for the whole cue.</p>';
        } else {
            host.innerHTML = CUE_SECTIONS.map((sec, i) => `
                <div class="flex-row" style="gap:6px;align-items:flex-start;margin-bottom:6px;min-width:0;flex-wrap:wrap;">
                    <input type="text" style="flex:0 0 130px;" value="${escapeHtml(sec.name || '')}"
                           placeholder="under the argument" oninput="cueSectionEdit(${i},'name',this.value)">
                    <input type="text" style="flex:1 1 220px;min-width:0;" value="${escapeHtml(sec.direction || '')}"
                           placeholder="one held note, no drums" oninput="cueSectionEdit(${i},'direction',this.value)">
                    <input type="number" step="1" min="3" max="120" style="flex:0 0 76px;" value="${Number(sec.seconds) || ''}"
                           placeholder="sec" oninput="cueSectionEdit(${i},'seconds',this.value)">
                    <button class="btn btn-secondary btn-sm" onclick="cueRemoveSection(${i})">&times;</button>
                </div>`).join('');
        }
        const total = CUE_SECTIONS.reduce((sum, x) => sum + (Number(x.seconds) || 0), 0);
        const bad = CUE_SECTIONS.filter(x => Number(x.seconds) && (x.seconds < 3 || x.seconds > 120)).length;
        const label = document.getElementById('cueSectionTotal');
        if (label) {
            label.textContent = CUE_SECTIONS.length
                ? `${CUE_SECTIONS.length} section${CUE_SECTIONS.length === 1 ? '' : 's'} · ${total.toFixed(0)}s total`
                  + (bad ? ` · ${bad} outside 3–120s` : '')
                : '';
            label.style.color = bad ? 'var(--gl-warning, #d9a441)' : '';
        }
    }

    function cueAddSection() { CUE_SECTIONS.push({ name: '', direction: '', seconds: 30 }); cueRenderSections(); }

    function cueRemoveSection(i) { CUE_SECTIONS.splice(i, 1); cueRenderSections(); }

    function cueClearSections() { CUE_SECTIONS = []; cueRenderSections(); }

    function cueSectionEdit(i, field, value) {
        if (!CUE_SECTIONS[i]) return;
        CUE_SECTIONS[i][field] = field === 'seconds' ? Number(value) : value;
        if (field === 'seconds') cueRenderSections();
    }

    async function createMusicCue() {
        if (!state.currentProject) return;
        const data = getModalData('musicCueModal');

        /*
         * Two conversions the form cannot do for itself.
         *
         * Length is typed in SECONDS because that is how a cue is discussed,
         * and stored in milliseconds like every other duration here. Blank
         * stays blank — 0 would be a deliberate zero-length cue, and the
         * generator reads a falsy length as "score the measured cut", which is
         * what blank means.
         *
         * Instruments are typed as a comma list and stored as an array, which
         * is what the route JSON-stringifies and the prompt joins. Sending the
         * raw string would store `"solo cello, kit"` as a single instrument.
         */
        if (data.duration_s !== undefined && data.duration_s !== '') {
            data.duration_ms = Math.round(Number(data.duration_s) * 1000) || 0;
        }
        delete data.duration_s;
        if (typeof data.instruments === 'string') {
            data.instruments = data.instruments.split(',').map(x => x.trim()).filter(Boolean);
        }
        // Sections replace the length: the provider refuses a length alongside
        // a plan, and the sections' own durations are what it honours.
        const sections = CUE_SECTIONS.filter(x => (x.direction || '').trim() && Number(x.seconds) > 0);
        if (sections.length) { data.sections = sections; delete data.duration_ms; }

        try {
            await api('/projects/' + state.currentProject.id + '/music-cues', { method: 'POST', body: JSON.stringify(data) });
            closeModal('musicCueModal');
            clearModal('musicCueModal');
            cueClearSections();
            loadMusicCues();
            setStatus('Music cue created');
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    // ══════════════════════════════════════════════════════════════
    // MUSIC & SOUND
    // ══════════════════════════════════════════════════════════════
    /*
     * ── THE SOUND SHEET ────────────────────────────────────────────────────
     *
     * A scene is a CUE SHEET: several sounds, each categorised, each with its
     * own audio. This page rendered exactly two rows — one Score, one Ambient —
     * so three sound effects showed as none, and `source` and `transition`
     * could be written and never seen.
     *
     * Built from `ssSection` like the character, location and prop sheets, so
     * sound is the same furniture rather than a fourth idiom. The categories
     * ARE the schema's cue_type vocabulary; the test reads the migration's own
     * CHECK and compares, so a sixth type cannot be added without a home here.
     */
    const SOUND_CATEGORIES = [
        { type: 'score', label: 'Score', what: 'The music written for this scene.' },
        { type: 'source', label: 'Source music', what: 'Music playing inside the scene — a radio, a jukebox in shot.' },
        { type: 'transition', label: 'Transitions', what: 'A stinger carrying one cut into the next.' },
        { type: 'sfx', label: 'Sound effects', what: 'Specific sounds. As many as the scene needs.' },
        { type: 'ambient', label: 'Ambience', what: 'The bed the whole scene sits on.' },
    ];

    /**
     * A TRACK'S DETAILS LIVE UNDER THE TRACK, IN TABS.
     *
     * Everything about a lane was in one long column in the side inspector, so
     * editing the lane you are looking at meant reading a form somewhere else.
     * Every pane is RENDERED whether or not its tab is active and hidden with a
     * class: a control that only exists while its tab is open cannot be found,
     * cannot be checked, and the editor audit could not see it either.
     */
    const MW_TRACK_TABS = [
        { id: 'part', label: 'Part', what: 'the notes this lane plays' },
        { id: 'instrument', label: 'Instrument', what: 'which of your own sounds plays them' },
        { id: 'mix', label: 'Mix', what: 'level, pan, mute, solo and where it routes' },
        { id: 'takes', label: 'Takes', what: 'the audio on this lane, and which take is heard' },
        { id: 'automation', label: 'Automation', what: 'a parameter over time' },
        { id: 'lane', label: 'Lane', what: 'name, role, order and colour' },
    ];

    const MW_KIND_TABLE = { tracks: 'film_music_tracks', clips: 'film_music_clips', markers: 'film_music_markers',
        'emotion-ranges': 'film_music_emotion_ranges', automation: 'film_music_automation', session: 'film_music_sessions' };

    async function loadMusicWorkstation() {
        const root = document.getElementById('mwRoot');
        if (!root) return;
        if (!state.currentProject) { root.innerHTML = '<p class="text-muted">Open a project to score it.</p>'; return; }
        setStatus('Loading score sessions...');
        try {
            if (!MW.vocab) MW.vocab = await api('/music-sessions/vocabulary');
            const list = await api('/projects/' + state.currentProject.id + '/music-sessions');
            MW.sessions = list.sessions || [];
            const keep = MW.session && MW.sessions.find(s => s.id === MW.session.id);
            const pick = keep ? keep.id : (MW.sessions[0] && MW.sessions[0].id);
            if (pick) await mwLoadSession(pick);
            else { MW.session = null; MW.model = null; mwRender(); }
            setStatus('Ready');
        } catch (e) {
            root.innerHTML = `<p class="text-muted">The score sessions could not be loaded: ${esc(e.message)}</p>`;
            setStatus('Error: ' + e.message);
        }
    }

    /** Read one session whole: the model, its brief and its drift, then draw it. */
    async function mwLoadSession(id) {
        const root = document.getElementById('mwRoot');
        try {
            const [model, brief, drift, capabilities, jobsRead, instrumentsRead] = await Promise.all([
                api('/music-sessions/' + id),
                api('/music-sessions/' + id + '/brief').catch(e => ({ ok: false, brief: null, warnings: [e.message] })),
                api('/music-sessions/' + id + '/drift').catch(e => ({ ok: false, tracked: false, drifted: false, error: e.message })),
                api('/projects/' + state.currentProject.id + '/music/capabilities').catch(e => ({ error: e.message, workflows: [] })),
                api('/music-sessions/' + id + '/jobs').catch(() => ({ jobs: [] })),
                // The director's own sounds. A failure here is a picker that
                // says why, never a session that will not open.
                api('/instruments').catch(e => ({ instruments: [], error: e.message })),
            ]);
            MW.model = model; MW.session = model.session; MW.brief = brief; MW.drift = drift; MW.capabilities = capabilities; MW.jobs = jobsRead.jobs || [];
            MW.instruments = instrumentsRead.instruments || []; MW.instrumentsError = instrumentsRead.error || null;
            if (MW.selection && !mwFindRow(MW.selection.kind, MW.selection.id)) MW.selection = null;
            mwRender();
            // The DAW panel is fetched AFTER the editor is on screen and paints
            // only its own region: a missing sidecar must not delay the lanes.
            dawRefresh();
        } catch (e) {
            if (root) root.innerHTML = `<p class="text-muted">This session could not be loaded — the rows are still there, this is a display fault: ${esc(e.message)}</p>`;
        }
    }

    function mwPickSession(id) { if (id) mwLoadSession(id); }

    /** Which row the selection names, from the model rather than the DOM. */
    function mwFindRow(kind, id) {
        const m = MW.model; if (!m) return null;
        if (kind === 'session') return m.session;
        if (kind === 'tracks') return m.tracks.find(t => t.id === id) || null;
        if (kind === 'clips') { for (const t of m.tracks) { const c = (t.clips || []).find(x => x.id === id); if (c) return c; } return null; }
        if (kind === 'automation') { for (const t of m.tracks) { const a = (t.automation || []).find(x => x.id === id); if (a) return a; } return null; }
        if (kind === 'markers') return m.markers.find(x => x.id === id) || null;
        if (kind === 'emotion-ranges') return m.emotion_ranges.find(x => x.id === id) || null;
        return null;
    }

    function mwTrackOf(clipId) { return (MW.model.tracks || []).find(t => (t.clips || []).some(c => c.id === clipId)) || null; }

    function mwLengthMs() {
        const m = MW.model, b = MW.brief && MW.brief.brief;
        return Math.max(Number(m && m.duration_ms) || 0, Number(b && b.length && b.length.ms) || 0, 10000);
    }

    const mwX = ms => Math.round((Number(ms) || 0) / 1000 * MW.pxPerSec);

    const mwMs = px => Math.max(0, Math.round(px / MW.pxPerSec * 1000));

    // ── Rendering ──────────────────────────────────────────────────
    function mwRender() {
        const root = document.getElementById('mwRoot');
        if (!root) return;
        if (!MW.session) {
            root.innerHTML = `<div class="mw-bar">${mwSessionListHtml()}</div>
                <p class="text-muted" style="margin-top:12px;">No score session yet. Create one for an edit imported from Premiere, a picture sequence, or a scene, and the brief, the ruler and the lanes appear here.</p>`;
            return;
        }
        const m = MW.model;
        root.innerHTML = `
            <div class="mw-bar">
                ${mwSessionListHtml()}
                ${mwStatusHtml(m.session)}
                ${mwApprovalHtml(m.session)}
                <span class="mw-save text-sm text-muted" id="mwSaveNote">${esc(MW.saveNote)}</span>
            </div>
            ${mwDriftHtml(MW.drift)}
            ${(m.warnings || []).length ? `<div class="mw-warn text-sm">${m.warnings.map(w => esc(w)).join(' · ')}</div>` : ''}
            <div class="mw-grid">
                <div class="mw-main" ondragover="mwDragOver(event)" ondrop="mwDrop(event)">
                    ${mwPictureHtml(m)}
                    <div class="mw-transport">
                        <button class="btn btn-secondary btn-sm" onclick="mwTogglePlay()" id="mwPlayBtn">${MW.playing ? '&#10073;&#10073; Pause' : '&#9654; Play'}</button>
                        <button class="btn btn-secondary btn-sm" onclick="mwStop()">&#9632; Stop</button>
                        <span class="mw-clock" id="mwClock">${mwTime(MW.playheadMs)}</span>
                        <label class="text-sm text-muted">zoom <input type="range" min="10" max="200" value="${MW.pxPerSec}" oninput="mwZoom(this.value)" style="width:90px;vertical-align:middle;"></label>
                        <span class="mw-spacer"></span>
                        <button class="btn btn-secondary btn-sm" onclick="mwCreate('tracks', {})" data-mw-create="tracks">+ Track</button>
                        <button class="btn btn-secondary btn-sm" onclick="mwCreate('markers', { position_ms: MW.playheadMs, kind: 'hit' })" data-mw-create="markers">+ Hit at playhead</button>
                        <button class="btn btn-secondary btn-sm" onclick="mwCreate('emotion-ranges', { start_ms: MW.playheadMs, end_ms: MW.playheadMs + 4000, label: 'new' })" data-mw-create="emotion-ranges">+ Emotion range</button>
                        <label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0;">Import stems
                            <input type="file" multiple accept="audio/*,.wav,.bwf,.aiff,.aif,.flac,.mp3,.m4a" style="display:none" onchange="mwImportFiles(event.target); event.target.value='';">
                        </label>
                        <label class="text-sm text-muted"><input type="checkbox" id="mwNormalize48k"> 48 kHz working copy</label>
                    </div>
                    <div class="mw-scroll" id="mwScroll">
                        <div class="mw-timeline" style="width:${mwX(mwLengthMs()) + 240}px;">
                            ${mwRulerHtml(m, MW.brief)}
                            ${mwEmotionHtml(m)}
                            ${m.tracks.map(mwTrackHtml).join('')}
                            <div class="mw-playhead" id="mwPlayhead" style="left:${mwX(MW.playheadMs)}px;"></div>
                        </div>
                    </div>
                    <p class="text-sm text-muted" style="margin:8px 0 0;">Drop stem files anywhere on the lanes: each lands as its own track and clip at the playhead, untrimmed — the original is kept byte-for-byte.</p>
                </div>
                <div class="mw-side">
                    <div id="mwInspector">${mwInspectorHtml()}</div>
                    ${mwContextHtml(MW.brief)}
                    ${scoreAiPanelHtml(MW.capabilities)}
                    ${scoreAiJobsHtml(MW.jobs)}
                    <div id="mwDaw">${dawPanelHtml(dawState())}</div>
                    ${mwProviderHtml(MW.capabilities)}
                </div>
            </div>`;
        paintWaveforms(root);
    }

    function mwSessionListHtml() {
        const opts = MW.sessions.map(s => `<option value="${esc(s.id)}" ${MW.session && s.id === MW.session.id ? 'selected' : ''}>${esc(s.name || 'untitled')} · ${esc(s.status)}${s.picture ? ' · ' + esc(s.picture.name || s.picture.kind || '') : ''}</option>`).join('');
        return `<select class="form-control" style="max-width:320px;" onchange="mwPickSession(this.value)" title="Which score session to work in">
                    ${opts || '<option value="">no sessions</option>'}
                </select>
                <button class="btn btn-primary btn-sm" onclick="mwCreateSession()">+ Session</button>
                ${MW.session ? `<button class="btn btn-secondary btn-sm" onclick="mwSelect('session', '${esc(MW.session.id)}')">Session settings</button>` : ''}`;
    }

    /** The lifecycle, from the served transition table: the current state and where it may go. */
    function mwStatusHtml(session) {
        const table = (MW.vocab && MW.vocab.transitions && MW.vocab.transitions['film_music_sessions.status']) || {};
        // Approval selects a mix, so it is its own control, never a status write (MUS-020).
        const next = (table[session.status] || []).filter(s => s !== 'approved');
        const options = [session.status, ...next].map(s => `<option value="${esc(s)}" ${s === session.status ? 'selected' : ''}>${esc(s)}</option>`).join('');
        return `<label class="mw-status text-sm">status
                    <select class="form-control" data-mw="film_music_sessions:status" data-kind="session" data-id="${esc(session.id)}" onchange="mwFieldChanged(this)">${options}</select>
                </label>`;
    }

    /** The explicit approval: select the newest bounce as the film's score, or take it back. */
    function mwApprovalHtml(session) {
        if (session.status === 'approved') {
            return `<span class="text-sm">approved${session.approved_at ? ' ' + esc(session.approved_at) : ''} \u00b7 the film plays this mix</span>
                <button class="btn btn-secondary btn-sm" onclick="mwUnapprove()" title="The session returns to review and the scene music it replaced comes back">Take back approval</button>`;
        }
        if (session.status === 'review') {
            return `<button class="btn btn-primary btn-sm" onclick="mwApprove()" title="Select the newest bounce as the film's score. A bounce made before the session last changed is refused.">Approve newest bounce</button>`;
        }
        return '<span class="text-sm text-muted">move to review to approve</span>';
    }

    async function mwApprove() {
        if (!MW.session) return;
        try {
            const out = await api('/music-sessions/' + MW.session.id + '/approve', { method: 'POST', body: JSON.stringify({}) });
            mwNote('Approved bounce v' + out.version + ((out.warnings || []).length ? ' \u00b7 ' + out.warnings.join('; ') : '') + ' \u2014 the film now plays this mix, once, and the scene music under it is dropped');
        } catch (e) { mwNote('Not approved: ' + e.message); }
        await mwLoadSession(MW.session.id);
    }

    async function mwUnapprove() {
        if (!MW.session) return;
        try { await api('/music-sessions/' + MW.session.id + '/unapprove', { method: 'POST', body: JSON.stringify({}) }); mwNote('Approval taken back'); }
        catch (e) { mwNote('Could not take the approval back: ' + e.message); }
        await mwLoadSession(MW.session.id);
    }

    function mwDriftHtml(drift) {
        /*
         * A NEWER CUT. The session is pinned to the edit version it was written
         * against; a new version from Premiere changes nothing here until the
         * director says so — and it has to be SAID, or the score goes on being
         * timed to a cut the film no longer is.
         */
        const newer = drift && drift.newer_edit
            ? `<div class="mw-drift"><strong>Edit v${esc(drift.newer_edit.version)} is newer than the v${esc(drift.newer_edit.written_against)} this score is timed to.</strong>
                <span class="text-sm">Nothing moves until you say so. Moving re-times the brief to the new cut; your clips stay where they are, so check the hits.</span>
                <button class="btn btn-secondary btn-sm" onclick="mwMoveToEdit(${jsAttr(drift.newer_edit.id)})">Move this score to v${esc(drift.newer_edit.version)}</button></div>`
            : '';
        if (!drift || !drift.tracked) return newer + (drift && drift.error ? `<div class="mw-warn text-sm">Drift could not be read: ${esc(drift.error)}</div>` : '');
        if (!drift.drifted) return newer;
        const sides = ['script', 'picture', 'context'].filter(k => drift[k] && drift[k].changed);
        return `<div class="mw-drift">
            <strong>The ${esc(sides.join(' and ') || 'brief')} moved since this session was written.</strong>
            <span class="text-sm">The score is being judged against a picture or a screenplay that no longer exists. Rebase only once you accept the new cut.</span>
            <button class="btn btn-secondary btn-sm" onclick="mwRebase()">Rebase to the current brief</button>
        </div>` + newer;
    }

    /** Point this score at a newer edit version, then adopt its brief. */
    async function mwMoveToEdit(editId) {
        if (!MW.session) return;
        try {
            await api('/music-sessions/' + MW.session.id, { method: 'PUT', body: JSON.stringify({ edit_id: editId }) });
            await api('/music-sessions/' + MW.session.id + '/rebase', { method: 'POST', body: '{}' });
            await mwLoadSession(MW.session.id);
            setStatus('The score is now written against the newer cut');
        } catch (e) { setStatus('Could not move the score: ' + e.message); }
    }

    /*
     * THE PICTURE, when the score is written against an edit: the cut itself,
     * following the playhead, so a hit is placed while watching the frame it
     * lands on. Its own sound is on by default — scoring under dialogue is
     * scoring blind without it — and one switch turns it off.
     */
    function mwPictureHtml(m) {
        const e = m && m.picture && m.picture.kind === 'edit' ? m.picture.edit : null;
        if (!e || !e.video_url) return '';
        return `<div class="mw-picture" style="margin-bottom:8px;">
            <video id="mwPicture" src="${esc(legacy.API_BASE + e.video_url)}" preload="auto" playsinline
                   style="width:100%;max-height:34vh;background:#000;display:block;" ${MW.pictureMuted ? 'muted' : ''}></video>
            <div class="text-sm text-muted" style="display:flex;gap:12px;align-items:center;margin-top:4px;">
                <span>Edit v${esc(e.version)} · ${esc(e.name || '')} · ${mwTime(e.duration_ms)}</span>
                <label><input type="checkbox" ${MW.pictureMuted ? '' : 'checked'} onchange="mwPictureSound(this.checked)"> edit sound</label>
            </div></div>`;
    }

    function mwPictureSound(on) { MW.pictureMuted = !on; const v = document.getElementById('mwPicture'); if (v) v.muted = !on; }

    /** Put the picture where the playhead is, playing or not. */
    function mwPictureFollow(play) {
        const v = document.getElementById('mwPicture');
        if (!v) return;
        try { v.currentTime = MW.playheadMs / 1000; } catch (_) { /* not loaded yet */ }
        if (play) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else v.pause();
    }

    async function mwRebase() {
        if (!MW.session) return;
        try { await api('/music-sessions/' + MW.session.id + '/rebase', { method: 'POST', body: '{}' }); await mwLoadSession(MW.session.id); setStatus('Rebased'); }
        catch (e) { setStatus('Rebase failed: ' + e.message); }
    }

    /** The brief, read-only: what the music is written AGAINST. */
    function mwContextHtml(out) {
        const b = out && out.brief;
        if (!b) return `<section class="mw-panel"><h4>Story &amp; picture</h4><p class="text-sm text-muted">The brief could not be compiled${out && out.warnings ? ': ' + esc(out.warnings.join('; ')) : ''}.</p></section>`;
        const shots = (b.picture && b.picture.shots) || [];
        const passages = (b.screenplay && b.screenplay.passages) || [];
        const characters = b.characters || [];
        const cues = b.cues || [];
        const emotion = b.emotion || [];
        const row = (k, v) => `<div class="mw-kv"><span class="text-muted">${esc(k)}</span><span>${v}</span></div>`;
        return `<section class="mw-panel">
            <h4>Story &amp; picture</h4>
            ${row('picture', esc((b.picture && b.picture.name) || '') + ' · ' + shots.length + ' shots · ' + mwTime(b.length && b.length.ms))}
            ${row('length', esc((b.length && b.length.source) || ''))}
            ${row('look', esc([b.look && b.look.genre, b.look && b.look.style_preset].filter(Boolean).join(' · ') || 'none stated'))}
            <details open><summary>Shots</summary>
                ${shots.map(s => `<div class="mw-shot"><b>${esc(s.shot_code)}</b> <span class="text-muted">${mwTime(s.start_ms)} · ${mwTime(s.duration_ms)}${s.camera && s.camera.shot_type ? ' · ' + esc(s.camera.shot_type) : ''}</span><div class="text-sm">${esc(s.action || '')}</div>${(s.characters || []).length ? `<div class="text-sm text-muted">${esc(s.characters.join(', '))}</div>` : ''}</div>`).join('') || '<p class="text-sm text-muted">No shots.</p>'}
            </details>
            <details><summary>Screenplay${b.screenplay && b.screenplay.version ? ' v' + esc(b.screenplay.version) : ''}</summary>
                ${passages.map(p => `<div class="mw-passage"><b>${esc(p.heading || 'scene ' + p.scene_number)}</b><pre>${esc(p.text || '')}</pre></div>`).join('') || '<p class="text-sm text-muted">No passages.</p>'}
            </details>
            <details><summary>Cast (${characters.length})</summary>
                ${characters.map(c => `<div class="text-sm">${esc(c.name || c)}${c.line_count !== undefined ? ` <span class="text-muted">· ${c.line_count} lines</span>` : ''}</div>`).join('') || '<p class="text-sm text-muted">Nobody named.</p>'}
            </details>
            <details><summary>Cues written (${cues.length})</summary>
                ${cues.map(c => `<div class="text-sm"><b>${esc(c.cue_type || '')}</b> ${esc(c.description || '')}</div>`).join('') || '<p class="text-sm text-muted">No cues yet.</p>'}
            </details>
            <details><summary>Accepted emotion (${emotion.length})</summary>
                ${emotion.map(e => `<div class="text-sm">${mwTime(e.start_ms)}–${mwTime(e.end_ms)} <b>${esc(e.label || '')}</b> <span class="text-muted">v ${e.valence} · a ${e.arousal}</span></div>`).join('') || '<p class="text-sm text-muted">Nothing accepted yet.</p>'}
            </details>
            ${(out.warnings || []).length ? `<p class="text-sm text-muted">${esc(out.warnings.join(' · '))}</p>` : ''}
        </section>`;
    }

    /**
     * What the project's music provider can do, per workflow — and for every
     * "no", why. Read-only: the generating controls are MUS-014's; this says
     * which of them will exist, before anyone reaches for one.
     */
    function mwProviderHtml(caps) {
        if (!caps || !Array.isArray(caps.workflows) || !caps.workflows.length) {
            return `<section class="mw-panel"><h4>Provider</h4><p class="text-sm text-muted">${esc(caps && caps.error ? 'Could not read the provider\u2019s capabilities: ' + caps.error : 'No music provider resolved for this project.')}</p></section>`;
        }
        const p = caps.provider || {};
        const glyph = { available: '\u2713', planned: '\u25CB', unsupported: '\u2717' };
        return `<section class="mw-panel">
            <h4>Provider · ${esc(p.id || '?')}</h4>
            <p class="text-sm text-muted">${p.explicit ? 'pinned by this project' : 'not pinned — resolved from ' + esc(p.source || 'the defaults')}${p.serves_music === false ? ' · serves no music' : ''}</p>
            ${caps.workflows.map(w => `<div class="mw-cap mw-cap-${esc(w.status)}" title="${esc(w.what)}">
                <span class="mw-cap-glyph">${glyph[w.status] || '?'}</span>
                <span class="mw-cap-name">${esc(w.workflow.replace('music_', ''))}</span>
                <span class="text-sm text-muted">${esc(w.status)}${w.cost_hint ? ' · $' + Number(w.cost_hint.usd_per_unit * 60).toFixed(2) + '/min' : ''}</span>
                ${w.reason ? `<div class="text-sm text-muted mw-cap-reason">${esc(w.reason)}${w.alternatives && w.alternatives.length ? ' · could: ' + esc(w.alternatives.map(a => a.id).join(', ')) : ''}</div>` : ''}
            </div>`).join('')}
        </section>`;
    }

    /** The shared ruler: seconds, the shots from the brief, and the session's markers. */
    function mwRulerHtml(m, out) {
        const total = mwLengthMs();
        const b = out && out.brief;
        const shots = (b && b.picture && b.picture.shots) || [];
        const markers = m.markers || [];
        let ticks = '';
        const step = MW.pxPerSec >= 80 ? 1000 : MW.pxPerSec >= 30 ? 5000 : 10000;
        for (let t = 0; t <= total; t += step) ticks += `<span class="mw-tick" style="left:${mwX(t)}px;">${mwTime(t)}</span>`;
        const shotHtml = shots.map(s => `<span class="mw-shot-band" style="left:${mwX(s.start_ms)}px;width:${Math.max(2, mwX(s.duration_ms))}px;" title="${esc(s.shot_code)} · ${esc(s.action || '')}">${esc(s.shot_code)}</span>`).join('');
        const markerHtml = markers.map(k => `<span class="mw-marker mw-marker-${esc(k.kind)} ${MW.selection && MW.selection.id === k.id ? 'selected' : ''}" style="left:${mwX(k.position_ms)}px;" title="${esc(k.kind)} ${esc(k.label || '')}" onclick="event.stopPropagation(); mwSelect('markers', '${esc(k.id)}')">&#9660;<span class="mw-marker-label">${esc(k.label || k.kind)}</span></span>`).join('');
        return `<div class="mw-ruler" onclick="mwSeek(mwMs(event.offsetX))">
            <div class="mw-ruler-ticks">${ticks}</div>
            <div class="mw-ruler-shots">${shotHtml}</div>
            <div class="mw-ruler-markers">${markerHtml}</div>
        </div>`;
    }

    /** The emotional arc as ranges on the same ruler; a proposal is a dashed range until somebody accepts it. */
    function mwEmotionHtml(m) {
        const ranges = m.emotion_ranges || [];
        // A proposal is drawn dashed and counted here, because a range that
        // looks accepted and is not is how a score gets generated from an arc
        // nobody reviewed. Rejected ranges stay, faded: the lineage is readable.
        const pending = ranges.filter(r => r.status === 'proposed').length;
        return `<div class="mw-lane mw-emotion" title="Emotion: click a range to edit it">
            <div class="mw-lane-head"><b>Emotion</b><span class="text-sm text-muted">${pending ? pending + ' proposal' + (pending > 1 ? 's' : '') + ' pending — accept in the inspector' : 'valence / arousal'}</span></div>
            <div class="mw-lane-body">
                ${ranges.map(r => {
                    const hue = Math.round(120 + (Number(r.valence) || 0) * 120);
                    const alpha = 0.25 + (Number(r.intensity) || 0) * 0.5;
                    return `<div class="mw-range ${r.status === 'proposed' ? 'proposed' : ''} ${r.status === 'rejected' ? 'rejected' : ''} ${MW.selection && MW.selection.id === r.id ? 'selected' : ''}"
                        style="left:${mwX(r.start_ms)}px;width:${Math.max(6, mwX(r.end_ms) - mwX(r.start_ms))}px;background:hsla(${hue},70%,55%,${alpha});"
                        title="${esc(r.label)} · v ${r.valence} · a ${r.arousal} · ${esc(r.status)}${r.source === 'ai_proposal' ? ' (AI proposal)' : ''}${r.rationale ? ' — ' + esc(r.rationale) : ''}"
                        onclick="mwSelect('emotion-ranges', '${esc(r.id)}')">${esc(r.label || '')}</div>`;
                }).join('')}
            </div>
        </div>`;
    }

    function mwTrackHtml(t) {
        const sel = MW.selection && MW.selection.kind === 'tracks' && MW.selection.id === t.id;
        const open = !!MW.open[t.id];
        return `<div class="mw-track-wrap">
        <div class="mw-lane mw-track ${sel ? 'selected' : ''}" data-track="${esc(t.id)}" style="border-left-color:${esc(t.color || 'transparent')}">
            <div class="mw-lane-head" onclick="mwSelect('tracks', '${esc(t.id)}')">
                <b><button class="mw-chev ${open ? 'on' : ''}" title="${open ? 'Hide this track\u2019s details' : 'Show this track\u2019s details \u2014 part, instrument, mix, takes'}" aria-expanded="${open}" onclick="event.stopPropagation(); mwToggleTrack('${esc(t.id)}')">${open ? '\u25BE' : '\u25B8'}</button> ${esc(t.name || 'untitled')}</b>
                <span class="text-sm text-muted">${esc(t.role || t.role_kind)}</span>
                ${mwTrackPlayHtml(t)}
                <div class="mw-mini">
                    <button class="mw-toggle ${t.muted ? 'on' : ''}" title="Mute" data-mw="film_music_tracks:muted" data-kind="tracks" data-id="${esc(t.id)}" data-value="${t.muted ? 'false' : 'true'}" onclick="event.stopPropagation(); mwFieldChanged(this)">M</button>
                    <button class="mw-toggle ${t.soloed ? 'on' : ''}" title="Solo" data-mw="film_music_tracks:soloed" data-kind="tracks" data-id="${esc(t.id)}" data-value="${t.soloed ? 'false' : 'true'}" onclick="event.stopPropagation(); mwFieldChanged(this)">S</button>
                    <input type="range" min="-60" max="12" step="0.5" value="${Number(t.gain_db) || 0}" title="Gain ${t.gain_db} dB" data-mw="film_music_tracks:gain_db" data-kind="tracks" data-id="${esc(t.id)}" oninput="mwFieldChanged(this)" onclick="event.stopPropagation()">
                    <input type="range" min="-1" max="1" step="0.05" value="${Number(t.pan) || 0}" title="Pan ${t.pan}" data-mw="film_music_tracks:pan" data-kind="tracks" data-id="${esc(t.id)}" oninput="mwFieldChanged(this)" onclick="event.stopPropagation()">
                </div>
            </div>
            <div class="mw-lane-body" ondblclick="mwSeek(mwMs(event.offsetX))">
                ${(t.clips || []).map(c => mwClipHtml(c, t)).join('')}
            </div>
        </div>
        ${open ? mwTrackDetailsHtml(t, 'lane') : ''}
        </div>`;
    }

    function mwToggleTrack(id) {
        MW.open[id] = !MW.open[id];
        if (MW.open[id]) MW.selection = { kind: 'tracks', id };
        mwRepaint();
    }

    function mwTrackTab(id, tab) {
        MW.tab[id] = tab;
        // Paint the tab without rebuilding the lanes: a re-render would lose
        // the roll's scroll position and anything half-typed in another pane.
        for (const el of document.querySelectorAll(`[data-tabs="${id}"] .mw-tab`)) el.classList.toggle('on', el.dataset.tab === tab);
        for (const el of document.querySelectorAll(`[data-panes="${id}"] > .mw-pane`)) el.classList.toggle('on', el.dataset.pane === tab);
    }

    /**
     * WHICH SOUND PLAYS THIS LANE, AND THE BUTTON THAT PLAYS IT.
     *
     * A track carries its own notes and its own instrument, so composing is
     * write the part, choose the sound, press play. The button is disabled
     * with the reason rather than hidden: a lane with no notes and a lane
     * whose plugin is missing are different problems, and a control that
     * vanishes looks like the feature not existing.
     */
    function mwTrackPlayHtml(t) {
        const notes = (t.notes && Array.isArray(t.notes.notes)) ? t.notes.notes.length : 0;
        const inst = MW.instruments.find(i => i.id === t.instrument_id) || null;
        const why = !notes ? 'No notes on this lane yet \u2014 write a part in the inspector, or ask Claude for one.'
            : !t.instrument_id ? 'No instrument on this lane \u2014 choose one of your own sounds in the inspector.'
            : !inst ? 'That instrument is not in the library any more.'
            : !inst.available ? `${inst.name} cannot play: its plugin or its patch is missing.`
            : '';
        const busy = MW.rendering === t.id;
        return `<span class="mw-inst">
            <button class="btn btn-secondary btn-sm" ${why || busy ? 'disabled' : ''}
                title="${esc(why || `Play these ${notes} notes with ${inst ? inst.name : ''} \u2014 free, it runs on this machine`)}"
                onclick="event.stopPropagation(); mwPlayTrack('${esc(t.id)}')">${busy ? '\u2026' : '\u25B6'} Play</button>
            <span class="text-sm text-muted">${inst ? esc(inst.name) + (inst.library ? ' \u00b7 ' + esc(inst.library) : '') : (notes ? 'no instrument' : 'no part')}</span>
        </span>`;
    }

    /**
     * Play the track: its notes, through its instrument, into its own lane.
     * Free \u2014 it runs on this machine and no provider is billed, so there is
     * no confirmation to pass; a refusal names the stage it stopped at.
     */
    async function mwPlayTrack(trackId) {
        if (!MW.session || MW.rendering) return;
        MW.rendering = trackId; mwRepaint(); mwNote('Playing the part\u2026');
        try {
            const out = await api(`/music-sessions/${MW.session.id}/tracks/${trackId}/render`, { method: 'POST', body: '{}' });
            MW.rendering = null;
            await mwLoadSession(MW.session.id);
            /*
             * IT SAYS PLAY, SO IT PLAYS. The new take is auditioned in its
             * group's place and heard from its own head — what is SELECTED is
             * untouched, so nothing that ships changes (MUS-013). Rendering a
             * file and leaving it silent on the lane is indistinguishable from
             * a button that does nothing, which is how this was reported.
             */
            const made = out.clip || {};
            MW.audition = made.take_status === 'selected' || !made.take_group
                ? null : { group: made.take_group, clipId: made.id };
            mwRepaint();
            mwSeek(Number(made.start_ms) || 0);
            if (MW.playing) mwRestartAudio(); else await mwPlay();
            mwNote(out.note || `Played by ${out.instrument}.`);
        } catch (e) {
            MW.rendering = null; mwRepaint();
            mwNote('It did not play: ' + e.message);
        }
    }

    /**
     * A TRACK'S DETAILS, UNDER THE TRACK.
     *
     * Every pane is rendered and the inactive ones are hidden with a class,
     * never left unbuilt: a field that exists only while its tab is open is one
     * nobody can find and the editor audit cannot see. Mounted twice — under
     * the lane where the work is, and in the side inspector — from ONE builder,
     * because two statements of the same controls is how they come to disagree.
     */
    function mwTrackDetailsHtml(track) {
        const active = MW.tab[track.id] || 'part';
        const panes = mwTrackSections(track);
        const id = esc(track.id);
        return `<div class="mw-details" data-details="${id}">
            <div class="mw-tabs" data-tabs="${id}">
                ${MW_TRACK_TABS.map(t => `<button class="mw-tab ${t.id === active ? 'on' : ''}" data-tab="${t.id}" title="${esc(t.what)}" onclick="mwTrackTab('${id}', '${t.id}')">${esc(t.label)}</button>`).join('')}
            </div>
            <div class="mw-panes" data-panes="${id}">
                ${MW_TRACK_TABS.map(t => `<div class="mw-pane pane-${t.id} ${t.id === active ? 'on' : ''}" data-pane="${t.id}">${panes[t.id] || ''}</div>`).join('')}
            </div>
        </div>`;
    }

    /** Every field a track's validator accepts, filed under the tab it belongs to. */
    function mwTrackSections(row) {
        const m = MW.model || { tracks: [] };
        const c = (field, value, spec) => mwControl('film_music_tracks', 'tracks', row.id, field, value, spec);
        const trackOpts = (m.tracks || []).map(t => ({ value: t.id, label: t.name || 'untitled' }));
        const clips = row.clips || [];
        const takes = clips.length ? clips.map(x => `<div class="mw-take ${mwHeard(x) ? 'heard' : ''}">
                <b>${esc(x.name || x.id.slice(0, 6))}</b>
                <span class="text-sm text-muted">${esc(x.take_status)} · ${mwTime(x.duration_ms)}${mwHeard(x) ? ' · heard' : ''}</span>
                <button class="btn btn-secondary btn-sm" onclick="mwHear('${esc(x.id)}')">Hear it</button>
                ${x.take_status === 'selected' ? '' : `<button class="btn btn-secondary btn-sm" onclick="mwChooseTake('${esc(x.id)}')">Make this the take</button>`}
                <button class="btn btn-secondary btn-sm" onclick="mwSelect('clips', '${esc(x.id)}')">Edit</button>
            </div>`).join('')
            : '<p class="text-sm text-muted">Nothing on this lane yet. Write a part and press Play, or place an audio file you already have.</p>';
        return {
            part: mwPartPaneHtml(row),
            instrument: mwInstrumentControl(row)
                + `<div class="mw-sub">${mwTrackPlayHtml(row)} <span class="text-sm text-muted">Free — it runs on this machine and no provider is billed.</span></div>`,
            mix: c('gain_db', row.gain_db, { type: 'range', min: -96, max: 24, step: 0.5 })
                + c('pan', row.pan, { step: 0.05 })
                + c('muted', row.muted, { type: 'bool' }) + c('soloed', row.soloed, { type: 'bool' })
                + c('output_track_id', row.output_track_id, { type: 'select', options: trackOpts.filter(o => o.value !== row.id), empty: 'the master', label: 'routes to' }),
            takes: `<div class="mw-takes">${takes}</div>
                <div class="mw-sub"><button class="btn btn-secondary btn-sm" data-mw-create="clips" onclick="mwAddClipFromAsset('${esc(row.id)}')">+ Place an audio file at the playhead</button></div>`,
            automation: `<div class="mw-sub">${(row.automation || []).map(a => `<button class="btn btn-secondary btn-sm" onclick="mwSelect('automation', '${esc(a.id)}')">${esc(a.parameter)} (${(a.points || []).length})</button>`).join(' ')}
                <button class="btn btn-secondary btn-sm" data-mw-create="automation" onclick="mwCreate('automation', { track_id: '${esc(row.id)}', parameter: 'gain', points: [] })">+ Curve</button></div>`,
            lane: c('name', row.name) + c('role_kind', row.role_kind)
                + c('role', row.role, { note: 'Free text inside the kind: "cello", "strings", "music bus".' })
                + c('sort_order', row.sort_order, { type: 'number', step: 1 }) + c('color', row.color, { type: 'color' }),
        };
    }

    // ── The part: a piano roll over the same ruler the lane uses ───
    const MW_ROW_H = 12;

    const MW_BLACK = [1, 3, 6, 8, 10];

    const MW_PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    const mwPitchName = p => MW_PITCH_NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);

    /** The lane's part, in the one shape the validator accepts. */
    function mwNotesOf(track) {
        const n = track && track.notes;
        if (!n || typeof n !== 'object' || Array.isArray(n)) return { program: 0, drums: false, notes: [] };
        return { program: Number(n.program) || 0, drums: !!n.drums, notes: Array.isArray(n.notes) ? n.notes.map(x => ({ ...x })) : [] };
    }

    /** Show the pitches the part uses, padded — never all 128 rows of nothing. */
    function mwRollRange(notes) {
        if (!notes.length) return { lo: 55, hi: 79 };
        let lo = Math.min(...notes.map(n => Number(n.pitch) || 0));
        let hi = Math.max(...notes.map(n => Number(n.pitch) || 0));
        lo = Math.max(0, lo - 2); hi = Math.min(127, hi + 2);
        const pad = Math.ceil((24 - (hi - lo)) / 2);
        if (pad > 0) { lo = Math.max(0, lo - pad); hi = Math.min(127, hi + pad); }
        return { lo, hi };
    }

    function mwTempoBpm() {
        const map = (MW.model && MW.model.session && MW.model.session.tempo_map) || [];
        return Number(map[0] && map[0].bpm) || 120;
    }

    /** The grid a note lands on, in milliseconds — beats, turned into the cut's own unit. */
    function mwSnapMs() {
        const div = Number(MW.snapDiv) || 0;
        return div ? Math.max(1, Math.round((60000 / mwTempoBpm()) / div)) : 1;
    }

    const mwSnap = ms => { const s = mwSnapMs(); return Math.max(0, Math.round(ms / s) * s); };

    function mwPartPaneHtml(track) {
        const part = mwNotesOf(track);
        const n = part.notes.length;
        return `<div class="mw-part">
            <div class="mw-part-bar">
                <b>${n} note${n === 1 ? '' : 's'}</b>
                <label class="text-sm">Snap
                    <select onchange="MW.snapDiv = Number(this.value); mwRepaint();">
                        ${[[1, '1/4'], [2, '1/8'], [4, '1/16'], [0, 'off']].map(([v, l]) => `<option value="${v}" ${Number(MW.snapDiv) === v ? 'selected' : ''}>${l}</option>`).join('')}
                    </select>
                </label>
                <label class="text-sm">GM program
                    <input type="number" min="0" max="127" step="1" value="${part.program}" style="width:64px"
                        onchange="mwSetProgram('${esc(track.id)}', this.value)">
                </label>
                ${mwTrackPlayHtml(track)}
                <span class="text-sm text-muted">Click the grid to add a note · drag to move · drag its right edge for length · double-click to remove</span>
            </div>
            ${mwRollHtml(track, part)}
            <details><summary>The part as data</summary>
                ${mwControl('film_music_tracks', 'tracks', track.id, 'notes', part, { type: 'json', label: 'notes',
                    note: 'MILLISECONDS, never beats: { program, notes: [{ start_ms, duration_ms, pitch, velocity }] }. Ask Claude for a melody and it writes here.' })}
            </details>
        </div>`;
    }

    function mwRollHtml(track, part) {
        const p = part || mwNotesOf(track);
        const { lo, hi } = mwRollRange(p.notes);
        const height = (hi - lo + 1) * MW_ROW_H;
        const width = Math.max(240, mwX(mwLengthMs()));
        const beatPx = Math.max(6, mwX(60000 / mwTempoBpm()));
        const id = esc(track.id);
        let keys = '';
        for (let pitch = hi; pitch >= lo; pitch--) {
            const black = MW_BLACK.includes(((pitch % 12) + 12) % 12);
            keys += `<div class="mw-key ${black ? 'black' : ''}" style="height:${MW_ROW_H}px"
                title="${mwPitchName(pitch)} — a reference tone, not your instrument"
                onclick="mwPreviewPitch(${pitch})">${pitch % 12 === 0 ? mwPitchName(pitch) : ''}</div>`;
        }
        const notes = p.notes.map((note, i) => {
            const pitch = Number(note.pitch) || 0;
            if (pitch < lo || pitch > hi) return '';
            return `<div class="mw-note ${MW.rollSel === i ? 'sel' : ''}" data-i="${i}"
                style="left:${mwX(note.start_ms)}px;top:${(hi - pitch) * MW_ROW_H}px;width:${Math.max(4, mwX(note.duration_ms))}px;height:${MW_ROW_H - 1}px;opacity:${0.45 + 0.55 * Math.min(1, (Number(note.velocity) || 100) / 127)}"
                title="${mwPitchName(pitch)} at ${mwTime(note.start_ms)} for ${mwTime(note.duration_ms)}, velocity ${Number(note.velocity) || 100}"
                onpointerdown="mwRollPointerDown(event, '${id}', 'move', ${i})"
                ondblclick="event.stopPropagation(); mwRollDelete('${id}', ${i})"><span class="r"
                onpointerdown="event.stopPropagation(); mwRollPointerDown(event, '${id}', 'len', ${i})"></span></div>`;
        }).join('');
        return `<div class="mw-roll">
            <div class="mw-roll-keys" style="height:${height}px">${keys}</div>
            <div class="mw-roll-grid" data-lo="${lo}" data-hi="${hi}" data-track="${id}"
                style="width:${width}px;height:${height}px;background-size:${beatPx}px ${MW_ROW_H * 12}px, 100% ${MW_ROW_H}px;"
                onpointerdown="mwRollPointerDown(event, '${id}', 'new', -1)">${notes}</div>
        </div>`;
    }

    function mwSetProgram(trackId, value) {
        const track = mwFindRow('tracks', trackId); if (!track) return;
        const part = mwNotesOf(track);
        part.program = Math.max(0, Math.min(127, Number(value) || 0));
        mwSaveNotes(trackId, part);
    }

    /**
     * Writing notes by hand. Every gesture ends in one save of the WHOLE part,
     * because the validator takes a part rather than a note: a half-written
     * list refused mid-drag would leave the lane holding something it cannot
     * play, and the refusal would arrive with nothing to point at.
     */
    function mwRollPointerDown(ev, trackId, mode, index) {
        if (ev.button !== 0) return;
        const track = mwFindRow('tracks', trackId); if (!track) return;
        const part = mwNotesOf(track);
        const grid = (ev.currentTarget.closest && ev.currentTarget.closest('.mw-roll-grid')) || ev.currentTarget;
        const hi = Number(grid.dataset.hi);
        const rect = grid.getBoundingClientRect();
        const pitchAt = clientY => Math.max(0, Math.min(127, hi - Math.floor((clientY - rect.top) / MW_ROW_H)));

        if (mode === 'new') {
            const note = {
                start_ms: mwSnap(mwMs(ev.clientX - rect.left)),
                duration_ms: Math.max(60, mwSnapMs()),
                pitch: pitchAt(ev.clientY),
                velocity: 100,
            };
            part.notes.push(note);
            MW.rollSel = null;
            mwPreviewPitch(note.pitch);
            mwSaveNotes(trackId, part);
            return;
        }

        const note = part.notes[index]; if (!note) return;
        const el = ev.currentTarget.closest ? ev.currentTarget.closest('.mw-note') : null;
        MW.rollSel = index;
        MW.drag = { x0: ev.clientX, y0: ev.clientY, start: Number(note.start_ms) || 0, dur: Number(note.duration_ms) || 0, pitch: Number(note.pitch) || 0, moved: false };
        const onMove = e => {
            const d = MW.drag; if (!d) return;
            if (Math.abs(e.clientX - d.x0) > 2 || Math.abs(e.clientY - d.y0) > 2) d.moved = true;
            const dms = mwMs(Math.abs(e.clientX - d.x0)) * Math.sign(e.clientX - d.x0);
            d.next = mode === 'move'
                ? { start_ms: mwSnap(Math.max(0, d.start + dms)), duration_ms: d.dur, pitch: pitchAt(e.clientY) }
                : { start_ms: d.start, duration_ms: Math.max(30, mwSnap(d.dur + dms) || 30), pitch: d.pitch };
            if (el) {
                el.style.left = mwX(d.next.start_ms) + 'px';
                el.style.width = Math.max(4, mwX(d.next.duration_ms)) + 'px';
                el.style.top = ((hi - d.next.pitch) * MW_ROW_H) + 'px';
            }
        };
        const onUp = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            const d = MW.drag; MW.drag = null;
            if (!d || !d.moved || !d.next) return;
            if (mode === 'move' && d.next.pitch !== d.pitch) mwPreviewPitch(d.next.pitch);
            part.notes[index] = { ...part.notes[index], ...d.next };
            mwSaveNotes(trackId, part);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    function mwRollDelete(trackId, index) {
        const track = mwFindRow('tracks', trackId); if (!track) return;
        const part = mwNotesOf(track);
        if (!part.notes[index]) return;
        part.notes.splice(index, 1);
        MW.rollSel = null;
        mwSaveNotes(trackId, part);
    }

    /** One save per gesture, through the same validator an agent's write meets. */
    function mwSaveNotes(trackId, part) {
        const track = mwFindRow('tracks', trackId); if (!track) return;
        const notes = part.notes
            .map(n => ({
                start_ms: Math.max(0, Math.round(Number(n.start_ms) || 0)),
                duration_ms: Math.max(1, Math.round(Number(n.duration_ms) || 0)),
                pitch: Math.max(0, Math.min(127, Math.round(Number(n.pitch) || 0))),
                velocity: Math.max(1, Math.min(127, Math.round(Number(n.velocity) || 100))),
            }))
            .sort((a, b) => a.start_ms - b.start_ms || a.pitch - b.pitch);
        const value = { program: part.program, drums: part.drums, notes };
        track.notes = value;
        mwRepaint();
        mwSave('tracks', trackId, { notes: value }, 'film_music_tracks');
    }

    /**
     * A pitch you can hear while placing it. Deliberately a plain tone and
     * SAID to be one: the lane's real sound is a sample library rendered
     * offline, and a sine pretending to be it would be a worse lie than silence.
     */
    function mwPreviewPitch(pitch) {
        try {
            if (!MW.audio) MW.audio = new (window.AudioContext || window.webkitAudioContext)();
            if (MW.audio.state === 'suspended') MW.audio.resume();
            const osc = MW.audio.createOscillator();
            const gain = MW.audio.createGain();
            osc.type = 'triangle';
            osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
            const t = MW.audio.currentTime;
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
            osc.connect(gain); gain.connect(MW.audio.destination);
            osc.start(t); osc.stop(t + 0.32);
        } catch (_) { /* a reference tone is never worth an error on the page */ }
    }

    /** Hear one take in its group's place. Changes what is HEARD, never what is saved. */
    function mwHear(clipId) {
        const clip = mwFindRow('clips', clipId); if (!clip) return;
        MW.audition = (clip.take_status === 'selected' || !clip.take_group) ? null : { group: clip.take_group, clipId };
        mwRepaint();
        mwSeek(Number(clip.start_ms) || 0);
        if (MW.playing) mwRestartAudio(); else mwPlay();
    }

    /** A clip: positioned by start_ms, sized by duration_ms, with the sound library's waveform inside it. */
    function mwClipHtml(c, t) {
        const sel = MW.selection && MW.selection.kind === 'clips' && MW.selection.id === c.id;
        const w = Math.max(24, mwX(c.duration_ms));
        return `<div class="mw-clip ${sel ? 'selected' : ''} take-${esc(c.take_status)} ${c.loop_policy !== 'none' ? 'looping' : ''}" data-clip="${esc(c.id)}"
                style="left:${mwX(c.start_ms)}px;width:${w}px;"
                title="${esc(c.name || '')} · ${mwTime(c.start_ms)} for ${mwTime(c.duration_ms)} · offset ${mwTime(c.source_offset_ms)} · ${esc(c.take_status)}"
                onclick="event.stopPropagation(); mwSelect('clips', '${esc(c.id)}')"
                onpointerdown="mwClipPointerDown(event, '${esc(c.id)}', 'move')">
            <span class="mw-clip-handle left" onpointerdown="event.stopPropagation(); mwClipPointerDown(event, '${esc(c.id)}', 'trim-start')"></span>
            ${c.asset_id ? `<canvas class="snd-wave" data-asset="${esc(c.asset_id)}"></canvas>` : '<span class="text-sm text-muted">no audio</span>'}
            <span class="mw-clip-name">${esc(c.name || '')}${c.take_status !== 'selected' ? ` <em>${esc(c.take_status)}</em>` : ''}${c.loop_policy !== 'none' ? ' &#8635;' : ''}</span>
            <span class="mw-clip-handle right" onpointerdown="event.stopPropagation(); mwClipPointerDown(event, '${esc(c.id)}', 'trim-end')"></span>
        </div>`;
    }

    // ── Controls: one builder for every field the validators accept ─────────

    /** Options for an enum field, from the SERVED vocabulary — never a list typed here. */
    function mwEnumOptions(table, column, current, vocab) {
        const values = (vocab && vocab[table + '.' + column]) || [];
        return values.map(v => `<option value="${esc(v)}" ${String(v) === String(current) ? 'selected' : ''}>${esc(v)}</option>`).join('');
    }

    function mwControl(table, kind, id, field, value, spec) {
        const s = spec || {};
        const attrs = `data-mw="${table}:${field}" data-kind="${kind}" data-id="${esc(id)}"`;
        const vocab = (MW.vocab && MW.vocab.vocabulary) || {};
        const ranges = (MW.vocab && MW.vocab.ranges) || {};
        const key = table + '.' + field;
        let input;
        if (s.type === 'bool') input = `<input type="checkbox" ${attrs} ${value ? 'checked' : ''} onchange="mwFieldChanged(this)">`;
        else if (vocab[key]) input = `<select class="form-control" ${attrs} onchange="mwFieldChanged(this)">${mwEnumOptions(table, field, value, vocab)}</select>`;
        else if (s.type === 'select') input = `<select class="form-control" ${attrs} onchange="mwFieldChanged(this)"><option value="">${esc(s.empty || 'none')}</option>${(s.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(value || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
        else if (s.type === 'json') input = `<textarea class="form-control" rows="3" ${attrs} onchange="mwFieldChanged(this)">${esc(JSON.stringify(value === undefined ? [] : value))}</textarea>`;
        else if (s.type === 'text') input = `<textarea class="form-control" rows="3" ${attrs} onchange="mwFieldChanged(this)">${esc(value == null ? '' : value)}</textarea>`;
        else if (ranges[key] || s.type === 'range') {
            const r = ranges[key] || s;
            input = `<input type="range" min="${r.min}" max="${r.max}" step="${s.step || 0.01}" value="${Number(value) || 0}" ${attrs} oninput="mwFieldChanged(this)"> <span class="text-sm">${Number(value) || 0}</span>`;
        }
        else if (s.type === 'number') input = `<input type="number" class="form-control" ${s.min !== undefined ? `min="${s.min}"` : ''} ${s.step ? `step="${s.step}"` : ''} value="${value == null ? '' : value}" ${attrs} onchange="mwFieldChanged(this)">`;
        else if (s.type === 'color') input = `<input type="color" value="${/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#6366f1'}" ${attrs} onchange="mwFieldChanged(this)">`;
        else input = `<input type="text" class="form-control" value="${esc(value == null ? '' : value)}" ${attrs} onchange="mwFieldChanged(this)">`;
        return `<label class="mw-field"><span class="mw-field-name">${esc(s.label || field.replace(/_/g, ' '))}</span>${input}${s.note ? `<span class="text-sm text-muted">${esc(s.note)}</span>` : ''}</label>`;
    }

    /** The selected row, every field the validator accepts, and the way to remove it. */
    function mwInspectorHtml() {
        const sel = MW.selection;
        if (!sel) return `<section class="mw-panel"><h4>Inspector</h4><p class="text-sm text-muted">Select a track, a clip, a marker or an emotion range to edit every field it has. Drag a clip to move it; drag its edges to trim; double-click a lane to move the playhead.</p></section>`;
        const row = mwFindRow(sel.kind, sel.id);
        if (!row) return '<section class="mw-panel"><h4>Inspector</h4><p class="text-sm text-muted">That row is gone.</p></section>';
        const m = MW.model;
        const T = MW_KIND_TABLE[sel.kind];
        const c = (field, value, spec) => mwControl(T, sel.kind, row.id, field, value, spec);
        const trackOpts = m.tracks.map(t => ({ value: t.id, label: t.name || 'untitled' }));
        const shots = ((MW.brief && MW.brief.brief && MW.brief.brief.picture && MW.brief.brief.picture.shots) || []).map(s => ({ value: s.id, label: s.shot_code }));
        const assets = m.tracks.flatMap(t => t.clips || []).filter(x => x.asset_id).map(x => ({ value: x.asset_id, label: (x.name || x.asset_id) }));
        const ops = (m.operations || []).map(o => ({ value: o.id, label: `${o.kind} · ${o.status} · ${(o.created_at || '').slice(0, 16)}` }));
        let body = '';
        let title = '';
        if (sel.kind === 'session') {
            title = 'Session';
            body = c('name', row.name) + c('status', row.status) + c('sample_rate', row.sample_rate)
                + c('frame_rate', row.frame_rate, { type: 'number', step: 0.001 })
                + c('edit_id', row.edit_id, { label: 'edit id', note: 'A cut imported from Premiere. When set, it IS the picture: its length and its timing.' })
                + c('sequence_id', row.sequence_id, { label: 'picture sequence id', note: 'The ordered picture this score is for; a scene is the fallback.' })
                + c('scene_id', row.scene_id, { label: 'scene id' })
                + c('script_id', row.script_id, { label: 'screenplay version id', note: 'Stamped by the rebase; change it only to pin a draft on purpose.' })
                + c('tempo_map', row.tempo_map, { type: 'json', note: 'List of { at_ms, bpm, numerator, denominator }, sorted, starting at 0.' })
                + c('notes', row.notes, { type: 'text' });
        } else if (sel.kind === 'tracks') {
            /*
             * A TRACK IS EDITED UNDER ITS OWN LANE, NEVER HERE.
             *
             * Its details moved below the track, in tabs. Mounting them here as
             * well would be two live copies of one set of controls — the shape
             * this codebase keeps paying for — so this is a way back to them
             * and nothing else.
             */
            title = 'Track';
            body = `<p class="text-sm text-muted">\u201c${esc(row.name || 'untitled')}\u201d is edited under its own lane: part, instrument, mix, takes, automation.</p>
                <button class="btn btn-secondary btn-sm" onclick="mwShowTrack('${esc(row.id)}')">Show it under the lane</button>`;
        } else if (sel.kind === 'clips') {
            title = 'Clip';
            body = c('name', row.name)
                + c('start_ms', row.start_ms, { type: 'number', min: 0, step: 1, note: 'Where it sits in the session clock.' })
                + c('duration_ms', row.duration_ms, { type: 'number', min: 1, step: 1 })
                + c('source_offset_ms', row.source_offset_ms, { type: 'number', min: 0, step: 1, note: 'Where in the file it begins. 0 keeps the leading silence.' })
                + c('gain_db', row.gain_db, { type: 'range', min: -96, max: 24, step: 0.5 })
                + c('fade_in_ms', row.fade_in_ms, { type: 'number', min: 0, step: 1 }) + c('fade_out_ms', row.fade_out_ms, { type: 'number', min: 0, step: 1 })
                + c('loop_policy', row.loop_policy) + c('warp_policy', row.warp_policy)
                + c('take_group', row.take_group, { note: 'Clips sharing a group are takes of one part; one is selected.' }) + c('take_status', row.take_status)
                + c('source_kind', row.source_kind)
                + c('asset_id', row.asset_id, { type: 'select', options: assets, empty: 'no audio', label: 'audio asset' })
                + c('source_operation_id', row.source_operation_id, { type: 'select', options: ops, empty: 'none', label: 'made by operation' })
                + `<div class="mw-sub"><b>Takes in this group</b> ${mwTakeGroupHtml(row)}</div>`;
        } else if (sel.kind === 'emotion-ranges') {
            title = 'Emotion range';
            body = c('label', row.label) + c('start_ms', row.start_ms, { type: 'number', min: 0, step: 1 }) + c('end_ms', row.end_ms, { type: 'number', min: 1, step: 1 })
                + c('valence', row.valence, { step: 0.05 }) + c('arousal', row.arousal, { step: 0.05 }) + c('intensity', row.intensity, { step: 0.05 })
                + c('confidence', row.confidence, { step: 0.05 }) + c('source', row.source)
                + c('rationale', row.rationale, { type: 'text', note: 'Why this range: a proposal\u2019s argument, kept when it is accepted.' })
                + c('proposal_id', row.proposal_id, { label: 'proposal', note: 'Which proposal it came from; empty for a range a person wrote.' })
                + c('status', row.status, { note: 'A proposal stays proposed until a person accepts it here; nothing paid rests on a proposal.' });
        } else if (sel.kind === 'markers') {
            title = 'Marker';
            body = c('kind', row.kind) + c('position_ms', row.position_ms, { type: 'number', min: 0, step: 1 }) + c('label', row.label)
                + c('shot_id', row.shot_id, { type: 'select', options: shots, empty: 'no shot', label: 'shot' });
        } else if (sel.kind === 'automation') {
            title = 'Automation';
            const clips = (mwTrackOfAutomation(row.id) || { clips: [] }).clips.map(x => ({ value: x.id, label: x.name || x.id }));
            body = c('parameter', row.parameter) + c('interpolation', row.interpolation)
                + c('clip_id', row.clip_id, { type: 'select', options: clips, empty: 'the whole track', label: 'scoped to clip' })
                + c('points', row.points, { type: 'json', note: 'List of { at_ms, value }, sorted, inside the parameter\'s own range.' });
        }
        return `<section class="mw-panel">
            <div class="flex-between"><h4>${esc(title)}</h4>
                ${sel.kind !== 'session' ? `<button class="btn btn-secondary btn-sm" data-mw-delete="${sel.kind}" onclick="mwDelete('${sel.kind}', '${esc(row.id)}', this)">Delete</button>` : ''}
            </div>
            ${body}
        </section>`;
    }

    /**
     * The instrument picker: the director's own sounds, from their own
     * libraries. A plugin exposes its state and not its browser, so a sound
     * joins this list by being loaded in the plugin once and captured \u2014 said
     * here rather than left to be discovered.
     */
    function mwInstrumentControl(track) {
        const opts = MW.instruments.map(i => ({
            value: i.id,
            label: `${i.name}${i.library ? ' \u00b7 ' + i.library : ''}${i.available ? '' : ' (plugin missing)'}`,
        }));
        const picker = mwControl('film_music_tracks', 'tracks', track.id, 'instrument_id', track.instrument_id,
            { type: 'select', options: opts, empty: MW.instruments.length ? 'no instrument' : 'your library is empty', label: 'instrument' });
        const help = MW.instrumentsError
            ? `Your sounds could not be listed: ${esc(MW.instrumentsError)}`
            : MW.instruments.length
                ? 'One of your own sounds. Browse everything you own with instrument_catalogue; capture a new one from the plugin.'
                : 'Nothing here yet: start the instrument sidecar, capture a patch from a plugin you own, and it appears in this list. See docs/instrument-sidecar.md.';
        return picker + `<p class="text-sm text-muted" style="margin:-6px 0 10px;">${help}</p>`;
    }

    function mwTrackOfAutomation(id) { return (MW.model.tracks || []).find(t => (t.automation || []).some(a => a.id === id)) || null; }

    /** The other takes of this clip's group, so choosing one is one click. */
    function mwTakeGroupHtml(clip) {
        if (!clip.take_group) return '<span class="text-sm text-muted">no group</span>';
        const takes = MW.model.tracks.flatMap(t => t.clips || []).filter(x => x.take_group === clip.take_group);
        return takes.map(x => `<button class="btn btn-secondary btn-sm ${x.take_status === 'selected' ? 'active' : ''}" title="Make this the selected take" onclick="mwChooseTake('${esc(x.id)}')">${esc(x.name || x.id.slice(0, 6))} · ${esc(x.take_status)}</button>`).join(' ');
    }

    async function mwChooseTake(clipId) {
        const chosen = mwFindRow('clips', clipId); if (!chosen) return;
        const others = MW.model.tracks.flatMap(t => t.clips || []).filter(x => x.take_group === chosen.take_group && x.id !== clipId && x.take_status === 'selected');
        const ops = [{ op: 'update', kind: 'clips', id: clipId, data: { take_status: 'selected' } },
            ...others.map(x => ({ op: 'update', kind: 'clips', id: x.id, data: { take_status: 'candidate' } }))];
        try { await api('/music-sessions/' + MW.session.id + '/batch', { method: 'POST', body: JSON.stringify({ ops }) }); await mwLoadSession(MW.session.id); }
        catch (e) { mwNote('Save failed: ' + e.message); }
    }

    /** Place an existing audio asset — a generated cue, a library sound, a stem — on a track at the playhead, whole and untrimmed. */
    async function mwAddClipFromAsset(trackId) {
        if (!state.currentProject || !MW.session) return;
        // The sound library: every audio file the project holds, one card each,
        // with its measured length — the asset list is paged and answers by
        // newest, which on a boarded film is pictures all the way down.
        let assets = [];
        try { assets = ((await api('/projects/' + state.currentProject.id + '/sounds')).sounds || []).filter(a => a.url); }
        catch (e) { mwNote('Could not list the audio: ' + e.message); return; }
        if (!assets.length) { mwNote('This project has no audio files yet: generate a cue, or drop stems on the lanes.'); return; }
        const opts = assets.map(a => `<option value="${esc(a.id)}" data-ms="${Number(a.duration_ms) || 0}">${esc(a.file_name || a.id)} · ${esc(a.kind_label || a.kind || '')}${a.duration_ms ? ' · ' + mwTime(a.duration_ms) : ''}</option>`).join('');
        showModalHtml('mwPlaceClipModal', `
            <div class="modal-header"><h3>Place an audio file</h3><button class="modal-close" onclick="closeModal('mwPlaceClipModal')">&times;</button></div>
            <div class="modal-body">
                <label style="display:block;margin-bottom:10px;">Audio<select id="mwPlaceAsset" class="form-control">${opts}</select></label>
                <p class="text-sm text-muted">It lands at ${mwTime(MW.playheadMs)} for its whole measured length with no source offset; trim it on the lane afterwards.</p>
            </div>
            <div class="modal-footer"><button class="btn btn-primary" onclick="mwAddClipFromAssetSubmit('${esc(trackId)}')">Place</button></div>`);
    }

    async function mwAddClipFromAssetSubmit(trackId) {
        const sel = document.getElementById('mwPlaceAsset'); if (!sel || !sel.value) return;
        const opt = sel.options[sel.selectedIndex];
        const ms = Number(opt && opt.dataset.ms) || 0;
        closeModal('mwPlaceClipModal');
        await mwCreate('clips', { track_id: trackId, asset_id: sel.value, name: (opt && opt.textContent.split(' · ')[0]) || '', source_kind: 'imported',
            start_ms: MW.playheadMs, duration_ms: ms > 0 ? ms : 1000, source_offset_ms: 0 });
    }

    // ── Change → autosave ──────────────────────────────────────────

    /** A control changed: read which field, coerce, and save that one row. */
    function mwFieldChanged(el) {
        const [table, field] = String(el.dataset.mw || '').split(':');
        const kind = el.dataset.kind, id = el.dataset.id;
        if (!table || !field || !kind || !id) return;
        let value;
        if (el.dataset.value !== undefined) value = el.dataset.value === 'true';
        else if (el.type === 'checkbox') value = !!el.checked;
        else if (el.type === 'range' || el.type === 'number') value = el.value === '' ? null : Number(el.value);
        else if (el.tagName === 'TEXTAREA' && (field === 'points' || field === 'tempo_map'
            || (table === 'film_music_tracks' && field === 'notes'))) {
            try { value = JSON.parse(el.value || '[]'); } catch (e) { mwNote('Save failed: ' + field + ' is not valid JSON'); return; }
        } else value = el.value === '' && /_id$/.test(field) ? null : el.value;
        if (el.type === 'range' && el.nextElementSibling) el.nextElementSibling.textContent = value;
        if (field === 'sample_rate') value = Number(value);
        mwSave(kind, id, { [field]: value }, table);
    }

    /** One save per row, once it settles; the model is updated from what came back. */
    function mwSave(kind, id, patch, table) {
        const key = kind + ':' + id;
        MW.pending[key] = Object.assign(MW.pending[key] || {}, patch);
        clearTimeout(MW.timers[key]);
        mwNote('Saving…');
        MW.timers[key] = setTimeout(async () => {
            const body = MW.pending[key]; delete MW.pending[key];
            const sid = MW.session.id;
            const url = kind === 'session' ? `/music-sessions/${sid}` : `/music-sessions/${sid}/${kind}/${id}`;
            try {
                // refresh: false — this fires on every tick of a slider and
                // repaints the lanes itself; a full page reload mid-drag would
                // rebuild the thing being dragged.
                const out = await api(url, { method: 'PUT', body: JSON.stringify(body), refresh: false });
                const row = mwFindRow(kind, id);
                if (row) Object.assign(row, kind === 'session' ? (out.session || out) : out);
                if (kind === 'session' && MW.session) Object.assign(MW.session, out.session || out);
                mwNote('Saved');
                // A lifecycle move or a mixer change repaints what depends on it.
                if (kind === 'session' || kind === 'tracks' || kind === 'clips' || kind === 'markers' || kind === 'emotion-ranges') mwRepaint();
                if (MW.playing && (kind === 'tracks' || kind === 'clips')) mwRestartAudio();
            } catch (e) {
                mwNote('Save failed: ' + e.message + ' — the row was not changed');
                await mwLoadSession(sid);
            }
        }, kind === 'session' ? 500 : 350);
        void table;
    }

    function mwNote(text) { MW.saveNote = text; const el = document.getElementById('mwSaveNote'); if (el) el.textContent = text; }

    /** Repaint the lanes and inspector from the model without a round trip. */
    function mwRepaint() {
        const scroll = document.getElementById('mwScroll');
        const left = scroll ? scroll.scrollLeft : 0;
        mwRender();
        const again = document.getElementById('mwScroll'); if (again) again.scrollLeft = left;
    }

    function mwSelect(kind, id) {
        MW.selection = { kind, id };
        // A track's details are under its lane now, so selecting one opens
        // them: selecting with nothing appearing anywhere reads as a dead click.
        if (kind === 'tracks') MW.open[id] = true;
        mwRepaint();
    }

    /** Open a lane's details and put them where they can be seen. */
    function mwShowTrack(id) {
        MW.open[id] = true;
        MW.selection = { kind: 'tracks', id };
        mwRepaint();
        const el = document.querySelector(`[data-details="${id}"]`);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    async function mwCreate(kind, data) {
        if (!MW.session) return;
        try {
            const out = await api('/music-sessions/' + MW.session.id + '/' + kind, { method: 'POST', body: JSON.stringify(data || {}) });
            await mwLoadSession(MW.session.id);
            if (out && out.id) mwSelect(kind, out.id);
        } catch (e) { mwNote('Could not create: ' + e.message); }
    }

    /** Two clicks: the first arms the button, the second deletes. No native dialog. */
    async function mwDelete(kind, id, btn) {
        if (btn && !btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Delete — sure?'; setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Delete'; } }, 4000); return; }
        try {
            await api('/music-sessions/' + MW.session.id + '/' + kind + '/' + id, { method: 'DELETE' });
            MW.selection = null;
            await mwLoadSession(MW.session.id);
        } catch (e) { mwNote('Delete failed: ' + e.message); }
    }

    // ── New session ────────────────────────────────────────────────
    async function mwCreateSession() {
        if (!state.currentProject) return;
        const pid = state.currentProject.id;
        let sequences = [], scenes = [], edits = [];
        // A finished cut is what a film is scored to, so edits come first.
        try { edits = (await api('/projects/' + pid + '/edits')).edits || []; } catch (_) { edits = []; }
        try { sequences = (await api('/projects/' + pid + '/sequences')).sequences || []; } catch (_) { sequences = []; }
        try { scenes = (await api('/projects/' + pid + '/scenes')).scenes || []; } catch (_) { scenes = []; }
        const opts = [
            ...edits.map(e => `<option value="edit:${esc(e.id)}">Edit v${esc(e.version)} · ${esc(e.name || '')} · ${mwTime(e.duration_ms)}</option>`),
            ...sequences.map(s => `<option value="sequence:${esc(s.id)}">Sequence · ${esc(s.name || s.id)}</option>`),
            ...scenes.map(s => `<option value="scene:${esc(s.id)}">Scene ${esc(s.scene_number)} · ${esc(s.location || '')}</option>`),
        ].join('');
        showModalHtml('mwNewSessionModal', `
            <div class="modal-header"><h3>New score session</h3><button class="modal-close" onclick="closeModal('mwNewSessionModal')">&times;</button></div>
            <div class="modal-body">
                <label style="display:block;margin-bottom:10px;">Name<input id="mwNewName" class="form-control" placeholder="Reel 1 score"></label>
                <label style="display:block;margin-bottom:10px;">Picture<select id="mwNewPicture" class="form-control">${opts || '<option value="">no sequences or scenes yet</option>'}</select></label>
                <p class="text-sm text-muted">A session is written against an edit made in Premiere (the finished cut: its length, its timing, and stems that line up at 00:00), an ordered sequence, or a scene. It is stamped with the brief as it stands, so drift is sayable from the first read.</p>
            </div>
            <div class="modal-footer"><button class="btn btn-primary" onclick="mwCreateSessionSubmit()">Create</button></div>`);
    }

    async function mwCreateSessionSubmit() {
        const pick = String((document.getElementById('mwNewPicture') || {}).value || '');
        const [kind, id] = pick.split(':');
        const body = { name: (document.getElementById('mwNewName') || {}).value || '' };
        if (kind === 'edit') body.edit_id = id; else if (kind === 'sequence') body.sequence_id = id; else if (kind === 'scene') body.scene_id = id;
        try {
            const out = await api('/projects/' + state.currentProject.id + '/music-sessions', { method: 'POST', body: JSON.stringify(body) });
            closeModal('mwNewSessionModal');
            MW.session = out.session || out;
            await loadMusicWorkstation();
        } catch (e) { setStatus('Could not create the session: ' + e.message); }
    }

    // ── Ruler, playhead, zoom ──────────────────────────────────────
    function mwSeek(ms) {
        MW.playheadMs = Math.max(0, Math.round(Number(ms) || 0));
        const ph = document.getElementById('mwPlayhead'); if (ph) ph.style.left = mwX(MW.playheadMs) + 'px';
        const clock = document.getElementById('mwClock'); if (clock) clock.textContent = mwTime(MW.playheadMs);
        if (MW.playing) mwRestartAudio(); else mwPictureFollow(false);
    }

    function mwZoom(v) { MW.pxPerSec = Math.max(10, Math.min(200, Number(v) || 40)); mwRepaint(); }

    // ── Clip drag: move, trim start, trim end ──────────────────────
    function mwClipPointerDown(ev, clipId, mode) {
        if (ev.button !== 0) return;
        const clip = mwFindRow('clips', clipId); if (!clip) return;
        MW.drag = { id: clipId, mode, x0: ev.clientX, start: clip.start_ms, dur: clip.duration_ms, off: clip.source_offset_ms, moved: false };
        const el = ev.currentTarget.closest ? ev.currentTarget.closest('.mw-clip') : null;
        const onMove = e => {
            const d = MW.drag; if (!d) return;
            const dms = mwMs(Math.abs(e.clientX - d.x0)) * Math.sign(e.clientX - d.x0);
            if (Math.abs(e.clientX - d.x0) > 2) d.moved = true;
            let start = d.start, dur = d.dur, off = d.off;
            if (d.mode === 'move') start = Math.max(0, d.start + dms);
            else if (d.mode === 'trim-start') { const cut = Math.max(-d.off, Math.min(d.dur - 50, dms)); start = d.start + cut; dur = d.dur - cut; off = d.off + cut; }
            else if (d.mode === 'trim-end') dur = Math.max(50, d.dur + dms);
            d.next = { start_ms: Math.round(start), duration_ms: Math.round(dur), source_offset_ms: Math.round(off) };
            if (el) { el.style.left = mwX(start) + 'px'; el.style.width = Math.max(24, mwX(dur)) + 'px'; }
        };
        const onUp = () => {
            document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
            const d = MW.drag; MW.drag = null;
            if (!d || !d.moved || !d.next) return;
            const patch = d.mode === 'move' ? { start_ms: d.next.start_ms }
                : d.mode === 'trim-end' ? { duration_ms: d.next.duration_ms }
                : { start_ms: d.next.start_ms, duration_ms: d.next.duration_ms, source_offset_ms: d.next.source_offset_ms };
            Object.assign(clip, patch);
            mwSave('clips', clipId, patch);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    // ── Aligned import by drop ─────────────────────────────────────
    function mwDragOver(ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; }

    function mwDrop(ev) {
        ev.preventDefault();
        if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) mwImportFiles(ev.dataTransfer);
    }

    /** Every dropped file, aligned at the playhead, through the stem importer — one batch, or nothing. */
    async function mwImportFiles(holder) {
        if (!MW.session) { setStatus('Create a session before importing stems'); return; }
        const list = holder && holder.files && holder.files.length ? Array.from(holder.files) : [];
        if (!list.length) return;
        const url = '/music-sessions/' + MW.session.id + '/stems';
        try {
            for (const f of list) checkUploadSize(f, url);
            const read = f => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve({ name: f.name, data: reader.result });
                reader.onerror = () => reject(new Error('could not read ' + f.name));
                reader.readAsDataURL(f);
            });
            mwNote('Importing ' + list.length + ' stem' + (list.length > 1 ? 's' : '') + '…');
            const payload = {
                files: await Promise.all(list.map(read)),
                start_ms: MW.playheadMs,
                normalize_48k: !!(document.getElementById('mwNormalize48k') || {}).checked,
            };
            const out = await api(url, { method: 'POST', body: JSON.stringify(payload) });
            mwNote('Imported ' + (out.imported || []).length + ' at ' + mwTime(out.start_ms) + ((out.warnings || []).length ? ' · ' + out.warnings.join('; ') : ''));
            await mwLoadSession(MW.session.id);
        } catch (e) {
            mwNote('Import refused: ' + e.message);
            setStatus('Import refused: ' + e.message);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // DAW CONNECTION AND SYNC (MUS-019)
    //
    // One registry, one action per operation of the DAW contract, and each
    // names the PORTABLE path that does the same job with no DAW at all — a
    // package exported, imported or validated, or the workstation's own
    // playback. The panel paints into its own region (#mwDaw) and is fetched
    // after the editor renders, so a missing sidecar, a closed Live or a
    // version nobody reviewed changes this panel and nothing else.
    // ══════════════════════════════════════════════════════════════
    const DAW_ADAPTER = 'ableton';

    function dawState() {
        if (!MW.daw) MW.daw = { status: null, error: null, unconfigured: false, loaded: false, session: null, plan: null, resolutions: {}, pullPlan: null, audit: [], busy: null, result: null, pkg: null };
        return MW.daw;
    }

    function dawBase() { return '/music-sessions/' + MW.session.id + '/daw/' + DAW_ADAPTER; }

    function dawPaint() { const el = document.getElementById('mwDaw'); if (el) el.innerHTML = dawPanelHtml(dawState()); }

    /** Whether Live can be changed right now, and the reason when it cannot. */
    function dawCanChange(d) {
        if (d.busy) return { ok: false, why: 'an operation is running' };
        if (d.unconfigured) return { ok: false, why: 'the sidecar is not configured' };
        const s = d.status;
        if (!s || s.ok === false) return { ok: false, why: 'the sidecar is not reachable' };
        if (!s.connected) return { ok: false, why: 'Live is not answering' };
        if (!s.compatible) return { ok: false, why: 'Live is not the reviewed version' };
        return { ok: true, why: '' };
    }

    function dawUndecided(d) {
        const p = d.plan; if (!p || !p.conflicts) return [];
        return p.conflicts.filter(c => !d.resolutions[c.fe_key] || (d.resolutions[c.fe_key] === 'overwrite' && !c.choices));
    }

    function dawConnectionHtml(d) {
        if (!d.loaded) return '<p class="text-sm text-muted">Checking the connection to Live…</p>';
        if (d.unconfigured) return `<div class="mw-warn text-sm"><b>Not set up.</b> ${esc(d.error || '')}
            <div>To connect: install AbletonOSC at commit 0ca6821, run <code>node backend/ableton-sidecar.js</code> with an ABLETON_SIDECAR_TOKEN, and start this server with the same ABLETON_SIDECAR_TOKEN (and ABLETON_SIDECAR_URL if the sidecar is not on port 3190). The steps are in docs/ableton-sidecar.md.</div></div>`;
        const s = d.status || {};
        if (s.ok === false) return `<div class="mw-warn text-sm"><b>The sidecar is not reachable.</b> ${esc(s.error || '')}
            <div>Start it beside Live with <code>node backend/ableton-sidecar.js</code>, using the same token this server has, then check again.</div></div>`;
        if (!s.connected) return `<div class="mw-warn text-sm"><b>Live is not answering.</b> ${esc(s.reason || '')}
            <div>Open Live, and in Settings › Link, Tempo &amp; MIDI choose AbletonOSC as a Control Surface. Nothing else may hold UDP port 11001.</div></div>`;
        if (!s.compatible) return `<div class="mw-warn text-sm"><b>Live ${esc(s.version || '')} can be read, not changed.</b> ${esc(s.reason || '')}
            <div>Reads only until that version is reviewed. The package path below works either way.</div></div>`;
        return `<p class="text-sm"><b>Connected</b> · Live ${esc(s.version || '')} · AbletonOSC ${esc(s.pin || '')}<br><span class="text-muted">${esc(s.version_note || '')}</span></p>`;
    }

    function dawPortableHtml(d) {
        const pkg = d.pkg;
        return `<div class="mw-ai-row">
            <div class="text-sm">Works with no DAW connected. Any DAW, or any person, can open a package, and one exported from a DAW with its stems comes back here as candidate takes.</div>
            <button class="btn btn-sm btn-secondary" onclick="dawExportPackage()" ${d.busy ? 'disabled' : ''}>Export score package</button>
            <label class="btn btn-sm btn-secondary" style="cursor:pointer;margin:0;">Import a package
                <input type="file" accept=".zip,application/zip" style="display:none" onchange="dawImportPackage(this); this.value='';">
            </label>
            ${pkg ? `<div class="text-sm">${pkg.error ? esc(pkg.error) : `<a href="${esc(legacy.API_BASE + pkg.url)}" target="_blank" rel="noopener">score package</a> · ${esc((pkg.manifest && pkg.manifest.stems || []).length)} stems · ${esc(String(pkg.sha256 || '').slice(0, 12))}${pkg.reused ? ' · unchanged, the existing package' : ''}`}</div>` : ''}
        </div>`;
    }

    function dawSessionHtml(d) {
        if (!d.session) return '';
        const t = d.session.tracks || [];
        return `<div class="text-sm">${t.length} track(s) in the Live set: ${t.map(x => `${esc(x.name)} <span class="text-muted">(${esc(x.owner)})</span>`).join(', ') || 'none'}</div>`;
    }

    function dawPushHtml(d) {
        const can = dawCanChange(d);
        const p = d.plan;
        let body = '';
        if (p) {
            const undecided = dawUndecided(d);
            const row = (label, items, fmt) => items && items.length ? `<div class="text-sm"><b>${label}</b> ${items.map(fmt).join(', ')}</div>` : '';
            body = `${row('create', p.instructions.filter(i => i.action === 'create'), i => esc(i.name))}
                ${row('update', p.instructions.filter(i => i.action === 'update'), i => esc(i.name))}
                ${row('left alone (not Film Engine’s)', p.untouched, i => esc(i.name))}
                ${row('left in place (no longer in the session)', p.orphans, i => esc(i.name))}
                ${(p.conflicts || []).map(c => `<div class="text-sm mw-warn"><b>${esc(c.name)}</b> — ${esc(c.reason)}
                    <select class="form-control" onchange="dawResolve('${esc(c.fe_key)}', this.value)">
                        <option value="">decide…</option>
                        ${c.choices ? `<option value="overwrite" ${d.resolutions[c.fe_key] === 'overwrite' ? 'selected' : ''}>overwrite Live with Film Engine’s</option>` : ''}
                        <option value="keep_daw" ${d.resolutions[c.fe_key] === 'keep_daw' ? 'selected' : ''}>keep what is in Live</option>
                    </select></div>`).join('')}
                <button class="btn btn-sm btn-primary" onclick="dawPush()" ${!can.ok || undecided.length ? 'disabled' : ''}>Push this plan</button>
                ${undecided.length ? `<span class="text-sm text-muted">${undecided.length} conflict(s) to decide first</span>` : ''}`;
        }
        return `<div class="mw-ai-row">
            <button class="btn btn-sm btn-secondary" onclick="dawPlanPush()" ${can.ok ? '' : 'disabled'}>Plan a push</button>
            <button class="btn btn-sm btn-secondary" onclick="dawReadSession()" ${d.status && d.status.connected && !d.busy ? '' : 'disabled'}>Read the Live set</button>
            ${can.ok ? '' : `<span class="text-sm text-muted">${esc(can.why)}</span>`}
            ${dawSessionHtml(d)}
            ${body}
        </div>`;
    }

    function dawResultHtml(d) {
        const r = d.result;
        if (!r) return '';
        if (!r.ok) return `<div class="mw-warn text-sm">${esc(r.op)} failed: ${esc(r.error)}</div>`;
        if (r.op === 'push') {
            return `<div class="text-sm"><b>Pushed${r.replayed ? ' (already done — nothing sent twice)' : ''}.</b> Live cannot load audio over OSC: drag each stem onto its track at bar 1.1.1.
                ${(r.applied || []).map(a => `<div>${esc(a.action)} ${esc(a.fe_key)} → ${esc(a.stem_path || 'no stem')} at ${esc(a.place_at || '1.1.1')}</div>`).join('')}</div>`;
        }
        return `<div class="text-sm"><b>${esc(r.op)} done.</b></div>`;
    }

    function dawPullHtml(d) {
        const can = d.status && d.status.connected && !d.busy;
        const pp = d.pullPlan;
        const items = pp && pp.items || [];
        return `<div class="mw-ai-row">
            <button class="btn btn-sm btn-secondary" onclick="dawPlanPull()" ${can ? '' : 'disabled'}>What can come back</button>
            ${pp ? (items.length ? items.map(it => `<div class="text-sm">${esc(it.kind || 'render')} · ${esc(String(it.sha256 || '').slice(0, 12))}${it.already_pulled ? ' · already here' : ` <button class="btn btn-sm btn-secondary" onclick="dawPull('${esc(it.item_id)}')" ${can ? '' : 'disabled'}>Bring back</button>`}</div>`).join('')
                : `<div class="text-sm text-muted">Nothing to bring back. ${esc(pp.unavailable || '')} Stems exported from Live come in with Import a package above.</div>`) : ''}
        </div>`;
    }

    function dawTransportHtml(d) {
        const can = dawCanChange(d).ok;
        const dis = can ? '' : 'disabled';
        return `<div class="mw-ai-row text-sm">Live's transport
            <button class="btn btn-sm btn-secondary" onclick="dawTransport('play')" ${dis}>Play</button>
            <button class="btn btn-sm btn-secondary" onclick="dawTransport('stop')" ${dis}>Stop</button>
            <button class="btn btn-sm btn-secondary" onclick="dawTransport('locate')" ${dis}>Go to ${esc(mwTime(MW.playheadMs))}</button>
        </div>`;
    }

    function dawAuditHtml(d) {
        const list = d.audit || [];
        if (!list.length) return '<p class="text-sm text-muted">Nothing has been sent to Live from this session yet.</p>';
        return list.map(a => {
            const unknown = a.status === 'failed' && /outcome is unknown/.test(a.error || '');
            return `<div class="text-sm">${esc(a.op)} · ${esc(a.status)}${a.duration_ms != null ? ' · ' + esc(a.duration_ms) + ' ms' : ''}${a.completed_at ? ' · ' + esc(a.completed_at) : ''}
                ${a.error ? `<div class="text-muted">${esc(a.error)}</div>` : ''}
                ${unknown ? `<div>Read the Live set, then plan and push again: a track carrying its marker is never created twice. <button class="btn btn-sm btn-secondary" onclick="dawPlanPush()">Plan again</button></div>` : ''}
            </div>`;
        }).join('');
    }

    function dawPanelHtml(d) {
        const busy = { push: 'Pushing to Live…', plan: 'Planning…', pull: 'Bringing a render back…', transport: 'Moving Live’s transport…', package: 'Building the package…', import: 'Importing the package…', read: 'Reading the Live set…' };
        return `<section class="mw-panel"><h4>DAW · Ableton Live</h4>
            ${dawConnectionHtml(d)}
            <p class="text-sm text-muted">The workstation works the same with or without Live: nothing in the editor waits for it.</p>
            <button class="btn btn-sm btn-secondary" onclick="dawRefresh()" ${d.busy ? 'disabled' : ''}>Check again</button>
            ${d.busy ? `<div class="text-sm"><b>${esc(busy[d.busy] || 'Working…')}</b></div>` : ''}
            ${dawResultHtml(d)}
            <h5 class="text-sm">Push the score</h5>${dawPushHtml(d)}
            <h5 class="text-sm">Bring a mix back</h5>${dawPullHtml(d)}
            ${dawTransportHtml(d)}
            <h5 class="text-sm">Portable package</h5>${dawPortableHtml(d)}
            <h5 class="text-sm">History</h5>${dawAuditHtml(d)}
        </section>`;
    }

    // ── Actions ────────────────────────────────────────────────────
    async function dawRefresh() {
        const d = dawState();
        if (!MW.session) return;
        try {
            d.status = await api('/daw/' + DAW_ADAPTER + '/status');
            d.unconfigured = false; d.error = null;
        } catch (e) {
            const msg = e.message || '';
            d.unconfigured = /ABLETON_SIDECAR_TOKEN|ABLETON_SIDECAR_URL|not configured/.test(msg);
            d.error = msg;
            d.status = d.unconfigured ? null : { ok: false, connected: false, error: msg };
        }
        try { d.audit = (await api(dawBase() + '/audit')).audit || []; } catch (e) { d.audit = []; }
        d.loaded = true;
        dawPaint();
    }

    /** Run one operation with its progress shown, and its failure kept in the panel. */
    async function dawRun(kind, op, fn) {
        const d = dawState();
        d.busy = kind; dawPaint();
        try { const out = await fn(); if (op) d.result = { op, ok: true, ...out }; }
        catch (e) { d.result = { op: op || kind, ok: false, error: e.message }; }
        finally {
            d.busy = null;
            try { d.audit = (await api(dawBase() + '/audit')).audit || []; } catch (_) { /* history is optional */ }
            dawPaint();
        }
    }

    async function dawReadSession() {
        const d = dawState();
        return dawRun('read', null, async () => { d.session = await api('/daw/' + DAW_ADAPTER + '/session'); return {}; });
    }

    async function dawPlanPush() {
        const d = dawState();
        return dawRun('plan', null, async () => { d.plan = await api(dawBase() + '/push/plan'); d.resolutions = {}; d.result = null; return {}; });
    }

    function dawResolve(feKey, value) {
        const d = dawState();
        if (value) d.resolutions[feKey] = value; else delete d.resolutions[feKey];
        dawPaint();
    }

    async function dawPush() {
        const d = dawState();
        if (!d.plan || dawUndecided(d).length) return;
        const body = { plan_fingerprint: d.plan.plan_fingerprint, resolutions: d.resolutions };
        return dawRun('push', 'push', async () => {
            const out = await api(dawBase() + '/push', { method: 'POST', body: JSON.stringify(body) });
            d.plan = null; d.resolutions = {};
            return out;
        });
    }

    async function dawPlanPull() {
        const d = dawState();
        return dawRun('plan', null, async () => { d.pullPlan = await api(dawBase() + '/pull/plan'); return {}; });
    }

    async function dawPull(itemId) {
        const d = dawState();
        await dawRun('pull', 'pull', async () => {
            const out = await api(dawBase() + '/pull', { method: 'POST', body: JSON.stringify({ item_id: itemId }) });
            d.pullPlan = null;
            return out;
        });
        if (d.result && d.result.ok) await mwLoadSession(MW.session.id);
    }

    async function dawTransport(command) {
        const position_ms = command === 'locate' ? Math.round(MW.playheadMs) : undefined;
        // A person pressed this, so the command is supervised — nothing else sends it.
        return dawRun('transport', 'transport', () => api(dawBase() + '/transport', { method: 'POST', body: JSON.stringify({ command, position_ms, supervised: true }) }));
    }

    async function dawExportPackage() {
        const d = dawState();
        return dawRun('package', null, async () => {
            try { d.pkg = await api('/music-sessions/' + MW.session.id + '/package', { method: 'POST', body: JSON.stringify({}) }); }
            catch (e) { d.pkg = { error: 'The package could not be built: ' + e.message }; }
            return {};
        });
    }

    /** A package from any DAW or person: validated first (writes nothing), then imported into this session as candidate takes. */
    async function dawImportPackage(holder) {
        const d = dawState();
        const f = holder && holder.files && holder.files[0];
        if (!f || !MW.session) return;
        const url = '/projects/' + state.currentProject.id + '/music-packages/import';
        let reloaded = false;
        await dawRun('import', null, async () => {
            try {
                checkUploadSize(f, url);
                const data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('could not read ' + f.name));
                    reader.readAsDataURL(f);
                });
                const v = await api(url, { method: 'POST', body: JSON.stringify({ data, validate_only: true }) });
                if (!v.ok) { d.pkg = { error: 'Refused, nothing written: ' + (v.errors || []).join('; ') }; return {}; }
                const out = await api(url, { method: 'POST', body: JSON.stringify({ data, session_id: MW.session.id }) });
                d.pkg = null;
                d.result = { op: 'import', ok: true, ...out };
                reloaded = true;
            } catch (e) { d.pkg = { error: 'Import refused: ' + e.message }; }
            return {};
        });
        if (reloaded) await mwLoadSession(MW.session.id);
    }

    // ── Playback: the audio graph the mix is heard through ─────────

    /** What one clip plays at: track and clip gain summed in dB, mute, solo across the session, pan, and the fades in seconds. */
    // ══════════════════════════════════════════════════════════════
    // AI WORKSTATION CONTROLS (MUS-014)
    //
    // Every AI action the workstation has, in one registry, each held to three
    // rules: a spending action goes through the ONE shared confirmation, which
    // reads the free plan first and shows the provider, the inputs, the length,
    // the outputs, the cost and what happens to the takes already here; an
    // action the project's provider cannot do is DISABLED WITH THAT PROVIDER'S
    // OWN REASON, never hidden and never attempted; and an action that needs a
    // selection says what to select.
    //
    // The spending functions are scoreAi*, never mw*: the editing and playback
    // functions of the workstation spend nothing, and a test holds them to it.
    // Proposing the emotional arc is the connected agent's job (the engine
    // calls no model); what the page does is show the proposals and let a
    // person accept or reject them.
    // ══════════════════════════════════════════════════════════════
    const SCORE_AI_ACTIONS = [
        { id: 'emotion', label: 'Emotional arc: proposals', workflow: null, spends: false, needs: null, fn: 'scoreAiEmotion',
          what: 'The connected agent proposes the arc from the free brief (music_emotion_brief, music_emotion_propose); you accept or reject it here. Nothing here calls a model.' },
        { id: 'compose', label: 'Whole score', workflow: 'music_compose', spends: true, needs: null, fn: 'scoreAiCompose',
          what: 'A whole cue for the session’s length, from the accepted arc, on a new track.' },
        { id: 'section', label: 'Score the selection', workflow: 'music_compose', spends: true, needs: 'section', fn: 'scoreAiSection',
          what: 'A cue for the selected track (as a new take on it), or for the selected emotion range’s span on a new track.' },
        { id: 'parts', label: 'Native parts', workflow: 'music_parts', spends: true, needs: null, fn: 'scoreAiParts',
          what: 'The provider’s own separate instrument parts, each on its own track at one start — never mistaken for separated stems.' },
        { id: 'separate', label: 'Separate into stems', workflow: 'music_separate', spends: true, needs: 'clip', fn: 'scoreAiSeparate',
          what: 'The selected clip’s recording split into stems, aligned under it; the recording is kept.' },
        { id: 'reference', label: 'From this as a reference', workflow: 'music_reference', spends: true, needs: 'clip', fn: 'scoreAiReference',
          what: 'A new cue conditioned on the selected clip’s audio, on a new track.' },
        { id: 'video', label: 'From the picture', workflow: 'music_video', spends: true, needs: null, fn: 'scoreAiVideo',
          what: 'A cue conditioned on the project’s conformed film, or its newest clip.' },
        { id: 'inpaint', label: 'Inpaint at the playhead', workflow: 'music_inpaint', spends: true, needs: 'clip', fn: 'scoreAiInpaint',
          what: 'Four seconds of the selected clip from the playhead, regenerated in context, as a candidate take over that range.' },
        { id: 'regenerate', label: 'Regenerate as a new take', workflow: null, spends: true, needs: 'generated', fn: 'scoreAiRegenerate',
          what: 'The generation that made the selected clip, run again with the input it recorded, landing as a candidate take; the clip is kept.' },
        { id: 'audition', label: 'A/B audition', workflow: null, spends: false, needs: 'takes', fn: 'scoreAiAudition',
          what: 'Hear the next take of the selected clip’s group in its place, without selecting or saving anything.' },
        { id: 'approve', label: 'Approve this take', workflow: null, spends: false, needs: 'clip', fn: 'scoreAiApprove',
          what: 'Make the selected clip the selected take of its group — the explicit act no generation ever does for you.' },
    ];

    /** Can the project's provider do this workflow, and if not, its own words for why. */
    function scoreAiCapability(workflow, caps) {
        if (!workflow) return { ok: true, reason: null };
        const list = (caps && Array.isArray(caps.workflows)) ? caps.workflows : [];
        const w = list.find(x => x.workflow === workflow);
        const who = (caps && caps.provider && caps.provider.id) || 'the music provider';
        if (!w) return { ok: false, reason: `${who} declares nothing about ${workflow.replace('music_', '')}${caps && caps.error ? ' (' + caps.error + ')' : ''}` };
        if (w.status !== 'available') return { ok: false, reason: `${who} cannot ${workflow.replace('music_', '')} (${w.status}): ${w.reason || 'no reason given'}` };
        return { ok: true, reason: null };
    }

    /** Null when the selection satisfies the action, otherwise what to select. */
    function scoreAiNeed(a) {
        const sel = MW.selection;
        const clip = sel && sel.kind === 'clips' ? mwFindRow('clips', sel.id) : null;
        if (a.needs === 'clip') return clip && clip.asset_id ? null : 'Select a clip with audio on a lane first.';
        if (a.needs === 'section') return sel && ['tracks', 'clips', 'emotion-ranges'].includes(sel.kind) ? null : 'Select a track, a clip or an emotion range first.';
        // Made by a GENERATION, not an import or a separation: only a generate
        // job recorded an input that can be asked again.
        if (a.needs === 'generated') return clip && clip.source_operation_id && (MW.jobs || []).some(j => j.operation_id === clip.source_operation_id && j.kind === 'generate')
            ? null : 'Select a clip a generation made (an imported or separated clip has nothing to regenerate from).';
        if (a.needs === 'takes') {
            if (!clip || !clip.take_group) return 'Select a clip whose take group has more than one take.';
            const takes = (MW.model.tracks || []).flatMap(t => t.clips || []).filter(x => x.take_group === clip.take_group);
            return takes.length > 1 ? null : 'Select a clip whose take group has more than one take.';
        }
        return null;
    }

    function scoreAiPanelHtml(caps) {
        const rows = SCORE_AI_ACTIONS.map(a => {
            const cap = scoreAiCapability(a.workflow, caps);
            const why = cap.ok ? scoreAiNeed(a) : cap.reason;
            return `<div class="mw-ai-row">
                <button class="btn btn-sm ${a.spends ? 'btn-primary' : 'btn-secondary'}" data-ai-action="${esc(a.id)}" ${why ? 'disabled' : ''} onclick="${esc(a.fn)}()" title="${esc(a.what)}">${esc(a.label)}</button>
                <span class="text-sm text-muted">${a.spends ? 'spends — its plan is shown first' : 'free'}</span>
                ${why ? `<div class="text-sm text-muted mw-ai-why">${esc(why)}</div>` : ''}
            </div>`;
        }).join('');
        return `<section class="mw-panel mw-ai">
            <h4>AI actions</h4>
            <p class="text-sm text-muted">Nothing spends before you have read its plan: provider, inputs, length, outputs, cost, and what happens to the takes already here. Every result is a new take; nothing is replaced.</p>
            <label class="text-sm">Direction<textarea id="scoreAiPrompt" class="form-control" rows="2" placeholder="Underscore for this picture, following the accepted arc"></textarea></label>
            <div style="display:flex;gap:6px;margin:4px 0 8px;">
                <label class="text-sm">Key <input id="scoreAiKey" class="form-control" style="width:110px;" placeholder="e.g. D minor"></label>
                <label class="text-sm">Stems <select id="scoreAiStems" class="form-control" style="width:70px;"><option value="2">2</option><option value="6">6</option></select></label>
            </div>
            ${rows}
            <div id="scoreAiEmotionBox">${MW.emotionBox || ''}</div>
        </section>`;
    }

    function scoreAiSelectedClip() { const s = MW.selection; return s && s.kind === 'clips' ? mwFindRow('clips', s.id) : null; }

    function scoreAiInputs() {
        const p = document.getElementById('scoreAiPrompt'), k = document.getElementById('scoreAiKey');
        return { prompt: (p && p.value.trim()) || 'Underscore for this picture, following the accepted emotional arc', key: (k && k.value.trim()) || undefined };
    }

    /** The one paid path for every generating action: free plan, confirmation, then the spend. */
    async function scoreAiGenerate(workflow, input, title) {
        if (!MW.session) return;
        const sid = MW.session.id;
        const body = { workflow, ...input };
        return confirmPaidImage({
            title, capability: 'music',
            previewUrl: '/music-sessions/' + sid + '/generate/plan',
            previewBody: body,
            describe: scoreAiPlanHtml,
            send: async () => {
                setStatus(title + ' — generating…', true);
                try {
                    const out = await api('/music-sessions/' + sid + '/generate', { method: 'POST', body: JSON.stringify(body) });
                    setStatus(`${title}: ${(out.outputs || []).length} new take(s); nothing was replaced`);
                } catch (e) { setStatus('Error: ' + e.message); }
                await mwLoadSession(sid);
            },
        });
    }

    function scoreAiCompose() { return scoreAiGenerate('music_compose', { ...scoreAiInputs(), duration_ms: mwLengthMs() }, 'Whole score'); }

    function scoreAiSection() {
        const sel = MW.selection; if (!sel) return;
        const i = scoreAiInputs();
        if (sel.kind === 'emotion-ranges') {
            const r = mwFindRow('emotion-ranges', sel.id); if (!r) return;
            return scoreAiGenerate('music_compose', { ...i, start_ms: r.start_ms, duration_ms: Math.max(3000, r.end_ms - r.start_ms) }, `Score ${r.label || 'the range'}`);
        }
        const track = sel.kind === 'tracks' ? mwFindRow('tracks', sel.id) : mwTrackOf(sel.id);
        if (!track) return;
        return scoreAiGenerate('music_compose', { ...i, track_id: track.id, duration_ms: mwLengthMs() }, `Score ${track.name || 'the track'}`);
    }

    function scoreAiParts() {
        const w = ((MW.capabilities && MW.capabilities.workflows) || []).find(x => x.workflow === 'music_parts');
        const lim = (w && w.limits) || {};
        const roles = (lim.part_roles || []).slice(0, lim.max_parts || 4);
        return scoreAiGenerate('music_parts', { ...scoreAiInputs(), parts: roles, duration_ms: mwLengthMs() }, 'Native parts');
    }

    function scoreAiReference() {
        const clip = scoreAiSelectedClip(); if (!clip) return;
        return scoreAiGenerate('music_reference', { ...scoreAiInputs(), reference_asset_id: clip.asset_id, reference_kind: 'audio', duration_ms: mwLengthMs() }, 'From a reference');
    }

    async function scoreAiVideo() {
        let pic = null;
        try {
            for (const type of ['video_final', 'video_raw']) {
                const r = await api('/projects/' + state.currentProject.id + '/assets?type=' + type);
                pic = (r.assets || r || [])[0] || null;
                if (pic) break;
            }
        } catch (_) { pic = null; }
        if (!pic) { setStatus('There is no clip or conformed film in this project to condition on yet.'); return; }
        return scoreAiGenerate('music_video', { ...scoreAiInputs(), video_asset_id: pic.id, duration_ms: mwLengthMs() }, 'From the picture');
    }

    function scoreAiInpaint() {
        const clip = scoreAiSelectedClip(); if (!clip) return;
        const start = Math.max(0, Math.min(clip.duration_ms - 1000, Math.round(MW.playheadMs - clip.start_ms)));
        const end = Math.min(clip.duration_ms, start + 4000);
        return scoreAiGenerate('music_inpaint', { prompt: scoreAiInputs().prompt, clip_id: clip.id, range: { start_ms: start, end_ms: end } }, `Inpaint ${mwTime(start)}–${mwTime(end)} of ${clip.name || 'the clip'}`);
    }

    async function scoreAiRegenerate() {
        const clip = scoreAiSelectedClip(); if (!clip || !clip.source_operation_id) return;
        let job = null;
        try { job = await api('/music-sessions/' + MW.session.id + '/jobs/' + clip.source_operation_id); } catch (_) { job = null; }
        if (!job || job.kind !== 'generate' || !job.workflow || !job.input) {
            setStatus(job && job.kind === 'separate'
                ? 'This clip came from a separation; separate the source recording again instead.'
                : 'The generation that made this clip did not record its input, so it cannot be asked again; plan a new one.');
            return;
        }
        const track = mwTrackOf(clip.id);
        const again = { ...job.input };
        if (job.workflow !== 'music_inpaint' && job.workflow !== 'music_parts' && track) again.track_id = track.id;
        return scoreAiGenerate(job.workflow, again, 'Regenerate as a new take');
    }

    async function scoreAiSeparate() {
        const clip = scoreAiSelectedClip(); if (!clip) return;
        const sid = MW.session.id;
        const stems = Number((document.getElementById('scoreAiStems') || {}).value) || 2;
        return confirmPaidImage({
            title: `Separate ${clip.name || 'the clip'} into ${stems} stems`, capability: 'music',
            previewUrl: '/music-sessions/' + sid + '/separations/plan?clip_id=' + encodeURIComponent(clip.id) + '&stems=' + stems,
            describe: scoreAiSeparationPlanHtml,
            send: async () => {
                setStatus('Separating…', true);
                try {
                    const out = await api('/music-sessions/' + sid + '/separations', { method: 'POST', body: JSON.stringify({ clip_id: clip.id, stems, wait: true }) });
                    setStatus(out.status === 'complete' ? `Separated into ${(out.stems || []).length} stems; the recording is untouched` : `Separation ${out.status}${out.error_message ? ': ' + out.error_message : ''}`);
                } catch (e) { setStatus('Error: ' + e.message); }
                await mwLoadSession(sid);
            },
        });
    }

    /** A/B: hear the next take of the group in the selected take's place. Saves nothing. */
    function scoreAiAudition() {
        const clip = scoreAiSelectedClip(); if (!clip || !clip.take_group) return;
        const takes = (MW.model.tracks || []).flatMap(t => t.clips || []).filter(x => x.take_group === clip.take_group);
        if (takes.length < 2) return;
        const heard = takes.findIndex(x => mwHeard(x));
        const next = takes[(heard + 1) % takes.length];
        MW.audition = next.take_status === 'selected' ? null : { group: clip.take_group, clipId: next.id };
        mwNote(MW.audition ? `Auditioning ${next.name || 'the next take'} in place of the selected take — nothing saved` : 'Back to the selected take');
        mwRestartAudio(); mwRepaint();
    }

    async function scoreAiApprove() {
        const clip = scoreAiSelectedClip(); if (!clip) return;
        MW.audition = null;
        await mwChooseTake(clip.id);
        mwNote(`Approved ${clip.name || 'the take'} as the selected take of its group`);
    }

    /** The arc is proposed by the connected agent; the page lists the proposals and takes the decision. */
    async function scoreAiEmotion() {
        const sid = MW.session.id;
        try {
            const r = await api('/music-sessions/' + sid + '/emotion/proposals');
            const list = (r.proposals || []).filter(p => (p.ranges || []).some(x => x.status === 'proposed'));
            MW.emotionBox = `<div class="mw-panel" style="margin-top:8px;">
                <p class="text-sm">Ask your agent: <em>“run music_emotion_brief and music_emotion_propose for score session ${esc(sid)}”</em>. The engine calls no model; the proposal lands here, dashed on the Emotion lane, until you decide.</p>
                ${list.length ? list.map(p => `<div class="mw-ai-row">
                    <b class="text-sm">${esc((p.ranges || []).filter(x => x.status === 'proposed').map(x => x.label).join(' → '))}</b>
                    <div class="text-sm text-muted">${esc((p.ranges || []).filter(x => x.status === 'proposed').map(x => x.rationale || '').filter(Boolean).join(' · '))}</div>
                    <button class="btn btn-sm btn-primary" onclick="scoreAiAcceptProposal('${esc(p.proposal_id)}')">Accept</button>
                    <button class="btn btn-sm btn-secondary" onclick="scoreAiRejectProposal('${esc(p.proposal_id)}')">Reject</button>
                </div>`).join('') : '<p class="text-sm text-muted">No proposal is waiting.</p>'}
            </div>`;
        } catch (e) { MW.emotionBox = `<p class="text-sm text-muted">The proposals could not be read: ${esc(e.message)}</p>`; }
        mwRender();
    }

    async function scoreAiAcceptProposal(pid) {
        try { await api('/music-sessions/' + MW.session.id + '/emotion/proposals/' + pid + '/accept', { method: 'POST', body: JSON.stringify({}) }); mwNote('Accepted: generation now reads this arc'); }
        catch (e) { mwNote('Accept failed: ' + e.message); }
        MW.emotionBox = ''; await mwLoadSession(MW.session.id);
    }

    async function scoreAiRejectProposal(pid) {
        const ops = (MW.model.emotion_ranges || []).filter(r => r.proposal_id === pid && r.status === 'proposed')
            .map(r => ({ op: 'update', kind: 'emotion-ranges', id: r.id, data: { status: 'rejected' } }));
        try { if (ops.length) await api('/music-sessions/' + MW.session.id + '/batch', { method: 'POST', body: JSON.stringify({ ops }) }); mwNote('Rejected; the ranges stay, faded, for the lineage'); }
        catch (e) { mwNote('Reject failed: ' + e.message); }
        MW.emotionBox = ''; await mwLoadSession(MW.session.id);
    }

    // ── What the director reads before spending ─────────────────────
    function scoreAiUsd(c) { if (!c || c.usd == null) return null; const n = Number(c.usd); return '$' + n.toFixed(n < 0.01 ? 4 : 2); }

    function scoreAiPlanHtml(d) {
        const p = d.provider || {}, c = d.context || {}, o = d.outputs || {}, pl = d.placement || {}, s = d.sources || {};
        const line = (k, v) => v ? `<div class="text-sm"><span class="text-muted">${esc(k)}</span> ${v}</div>` : '';
        return `
            ${line('Provider', esc(p.id || '?') + (p.model ? ' · ' + esc(p.model) : '') + (p.note ? ' <span class="text-muted">(' + esc(p.note) + ')</span>' : ''))}
            ${line('Workflow', esc((d.workflow || '').replace('music_', '')))}
            ${line('Direction', d.prompt ? esc(d.prompt) : '')}
            ${line('Context', [c.tempo_bpm ? esc(c.tempo_bpm) + ' BPM' : '', c.time_signature ? esc(c.time_signature) : '', c.key ? 'key ' + esc(c.key) : ''].filter(Boolean).join(' · ') || 'no tempo or key')}
            ${line('Emotional arc', (c.emotion || []).length ? (c.emotion || []).map(r => esc(r.label) + ' ' + mwTime(r.start_ms) + '–' + mwTime(r.end_ms)).join(' → ') : 'none — generating without an accepted arc')}
            ${d.sections ? line('Sections', d.sections.map(x => esc(x.section_name) + ' ' + mwTime(x.duration_ms)).join(' · ')) : ''}
            ${line('Made from', [s.reference ? 'reference ' + esc(s.reference.file_name) + ' (' + esc(s.reference.kind) + ')' : '', s.video ? 'picture ' + esc(s.video.file_name) : '', s.source ? 'range ' + mwTime(s.source.range.start_ms) + '–' + mwTime(s.source.range.end_ms) + ' of the source' : ''].filter(Boolean).join(' · '))}
            ${line('Length', mwTime(d.duration_ms) + ` (${Math.round(Number(d.duration_ms) / 100) / 10} s)`)}
            ${line('Outputs', esc(o.count) + ' × ' + esc(o.kind) + ' (' + esc(o.source_kind) + ')' + (o.parts ? ': ' + esc(o.parts.join(', ')) : ''))}
            ${line('Lands', pl.new_track ? 'on a new track at ' + mwTime(pl.start_ms) : 'on the existing track at ' + mwTime(pl.start_ms))}
            ${line('Cost', scoreAiUsd(d.cost_hint) ? '<strong>' + scoreAiUsd(d.cost_hint) + '</strong>' + (d.cost_hint.inferred ? ' (inferred)' : '') : esc(d.cost_note || 'not priced'))}
            <p class="text-sm" style="margin-top:8px;">${esc(d.takes || '')}</p>
            ${(d.warnings || []).map(w => `<p class="text-sm" style="color:var(--warning,#b8860b);">${esc(w)}</p>`).join('')}`;
    }

    function scoreAiSeparationPlanHtml(d) {
        const p = d.provider || {}, v = d.variation || {}, src = d.source || {}, pl = d.placement || {}, c = d.cost_hint || {};
        return `
            <div class="text-sm"><span class="text-muted">Provider</span> ${esc(p.id || '?')} · ${esc(p.model || v.id || '')}</div>
            <div class="text-sm"><span class="text-muted">Variation</span> ${esc(v.id)} — ${esc(v.stems)} stems</div>
            <div class="text-sm"><span class="text-muted">Stems expected</span> ${esc((d.expected_stems || []).join(', '))}</div>
            <div class="text-sm"><span class="text-muted">Recording sent</span> ${esc(src.file_name || '')} (${mwTime(src.duration_ms)})</div>
            <div class="text-sm"><span class="text-muted">Lands</span> each stem on its own track at ${mwTime(pl.start_ms)}, offset ${mwTime(pl.source_offset_ms)}, for ${mwTime(pl.duration_ms)} — under the source clip</div>
            <div class="text-sm"><span class="text-muted">Cost</span> ${scoreAiUsd(c) ? '<strong>' + scoreAiUsd(c) + '</strong>' : 'not priced'}${c.note ? ' — ' + esc(c.note) : ''}</div>
            <p class="text-sm" style="margin-top:8px;">The recording is untouched: its file, its asset and its clip stay exactly as they are. A bad archive or a provider error registers nothing.</p>`;
    }

    function scoreAiRetryHtml(job) {
        return `
            <p class="text-sm">Runs this ${esc((job.workflow || job.kind || '').replace('music_', ''))} again as attempt ${Number(job.attempt || 1) + 1}, with the input it recorded, on ${esc(job.provider || 'the same provider')}. The failed attempt stays in the lineage.</p>
            ${job.reason ? `<p class="text-sm" style="color:var(--gl-danger,#ef4444);">${esc(job.reason)}</p>` : ''}
            ${(job.children || []).map(c => `<div class="text-sm text-muted">#${esc(c.seq)} ${esc(c.label || '')} · ${esc(c.status)}${c.error_message ? ' — ' + esc(c.error_message) : ''}</div>`).join('')}
            <p class="text-sm" style="margin-top:8px;">Every output is a new take; nothing already on the session is replaced.</p>`;
    }

    // ── Jobs ─────────────────────────────────────────────────────────
    function scoreAiJobsHtml(jobs) {
        const list = Array.isArray(jobs) ? jobs : [];
        if (!list.length) return '<section class="mw-panel"><h4>Jobs</h4><p class="text-sm text-muted">No generation or separation has run on this session yet.</p></section>';
        return `<section class="mw-panel"><h4>Jobs</h4>${list.map(j => `<div class="mw-ai-row">
            <div class="text-sm"><b>${esc((j.workflow || j.kind || '').replace('music_', ''))}</b> · ${esc(j.status)} · attempt ${esc(j.attempt)}${j.cost_usd ? ' · $' + Number(j.cost_usd).toFixed(3) : ''}${j.consistent === false ? ' · <em>stored status disagreed</em>' : ''}</div>
            ${(j.children || []).map(c => `<div class="text-sm text-muted">#${esc(c.seq)} ${esc(c.label || '')} · ${esc(c.status)}${c.take_number ? ' · take ' + esc(c.take_number) : ''}${c.acceptance ? ' · ' + esc(c.acceptance) : ''}</div>`).join('')}
            ${j.status === 'failed' ? `<div class="text-sm" style="color:var(--gl-danger,#ef4444);">${esc(j.reason || 'failed')}</div><button class="btn btn-sm btn-secondary" onclick="scoreAiRetry('${esc(j.operation_id)}')">Retry (spends)</button>` : ''}
            ${j.status === 'running' ? `<button class="btn btn-sm btn-secondary" onclick="scoreAiPoll('${esc(j.operation_id)}')">Check</button>` : ''}
        </div>`).join('')}</section>`;
    }

    async function scoreAiPoll(opId) {
        try { await api('/music-sessions/' + MW.session.id + '/jobs/' + opId + '/poll', { method: 'POST', body: JSON.stringify({}) }); }
        catch (e) { mwNote('Could not check the job: ' + e.message); }
        await mwLoadSession(MW.session.id);
    }

    async function scoreAiRetry(opId) {
        const sid = MW.session.id;
        return confirmPaidImage({
            title: 'Retry a failed job', capability: 'music',
            previewUrl: '/music-sessions/' + sid + '/jobs/' + opId,
            describe: scoreAiRetryHtml,
            send: async () => {
                setStatus('Retrying…', true);
                try {
                    const out = await api('/music-sessions/' + sid + '/jobs/' + opId + '/retry', { method: 'POST', body: JSON.stringify({ wait: true }) });
                    setStatus(`Retry ${out.status || 'sent'}${out.reason ? ': ' + out.reason : ''}`);
                } catch (e) { setStatus('Error: ' + e.message); }
                await mwLoadSession(sid);
            },
        });
    }

    /** Which take is heard: the selected one, or the one being auditioned in its group's place. */
    function mwHeard(c) {
        if (MW.audition && c.take_group && c.take_group === MW.audition.group) return c.id === MW.audition.clipId;
        return c.take_status === 'selected';
    }

    function mwClipLevel(track, clip, tracks) {
        const anySolo = (tracks || []).some(t => t.soloed);
        const silent = !!track.muted || (anySolo && !track.soloed);
        const db = (Number(track.gain_db) || 0) + (Number(clip.gain_db) || 0);
        const gain = silent ? 0 : Math.pow(10, db / 20);
        return {
            gain,
            pan: Math.max(-1, Math.min(1, Number(track.pan) || 0)),
            fade_in_s: (Number(clip.fade_in_ms) || 0) / 1000,
            fade_out_s: (Number(clip.fade_out_ms) || 0) / 1000,
        };
    }

    async function mwBuffer(assetId) {
        if (MW.buffers[assetId]) return MW.buffers[assetId];
        const row = await api('/assets/' + assetId).catch(() => null);
        // The serving route comes from the file's own directory, the rule
        // mediaUrl already states for dialogue against music.
        const src = row && row.file_path ? mediaUrl(row.file_path) : '';
        if (!src) throw new Error('no file for asset ' + assetId);
        const res = await fetch(src);
        const bytes = await res.arrayBuffer();
        const buf = await MW.audio.decodeAudioData(bytes);
        MW.buffers[assetId] = buf;
        return buf;
    }

    function mwTogglePlay() { if (MW.playing) mwPause(); else mwPlay(); }

    /** Schedule every audible clip from the playhead. Spends nothing: it reads files already made. */
    async function mwPlay() {
        if (!MW.model) return;
        if (!MW.audio) MW.audio = new (window.AudioContext || window.webkitAudioContext)();
        // A context made during a click is suspended by the time an awaited
        // render returns, so playing without resuming is silence with no error.
        if (MW.audio.state === 'suspended') { try { await MW.audio.resume(); } catch (_) { /* nothing to resume */ } }
        // A context started outside a gesture stays suspended and resume()
        // never settles; bounded, so a script-driven play cannot hang the page.
        if (MW.audio.state === 'suspended') await Promise.race([MW.audio.resume(), new Promise(r => setTimeout(r, 1500))]);
        if (MW.audio.state !== 'running') { mwNote('The browser needs a click before it will play audio — press Play.'); return; }
        mwStopSources();
        const ctx = MW.audio;
        const tracks = MW.model.tracks || [];
        const clips = tracks.flatMap(t => (t.clips || []).filter(c => c.asset_id && mwHeard(c)).map(c => ({ t, c })));
        const ready = await Promise.all(clips.map(async ({ t, c }) => { try { return { t, c, buf: await mwBuffer(c.asset_id) }; } catch (e) { return null; } }));
        const t0 = ctx.currentTime + 0.05;
        const from = MW.playheadMs / 1000;
        MW.ctxStart = t0; MW.msStart = MW.playheadMs; MW.playing = true;
        for (const item of ready) {
            if (!item) continue;
            const { t, c, buf } = item;
            const lvl = mwClipLevel(t, c, tracks);
            if (lvl.gain === 0) continue;
            const start = (Number(c.start_ms) || 0) / 1000, dur = (Number(c.duration_ms) || 0) / 1000, off = (Number(c.source_offset_ms) || 0) / 1000;
            const end = start + dur;
            if (end <= from) continue;
            const src = ctx.createBufferSource(); src.buffer = buf;
            const gain = ctx.createGain(); const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
            if (pan) { pan.pan.value = lvl.pan; src.connect(gain).connect(pan).connect(ctx.destination); }
            else src.connect(gain).connect(ctx.destination);
            const loops = c.loop_policy && c.loop_policy !== 'none';
            if (loops) { src.loop = true; src.loopStart = off; src.loopEnd = Math.min(buf.duration, off + Math.max(0.05, buf.duration - off)); }
            const late = Math.max(0, from - start);            // how far into the clip the playhead already is
            const when = t0 + Math.max(0, start - from);
            const playFor = end - Math.max(from, start);
            // Fades are ramps inside the clip; a playhead dropped mid-fade starts at that point of the ramp.
            const g = gain.gain;
            g.setValueAtTime(0.0001, when);
            if (lvl.fade_in_s > late) g.linearRampToValueAtTime(lvl.gain, when + (lvl.fade_in_s - late)); else g.setValueAtTime(lvl.gain, when);
            if (lvl.fade_out_s > 0) { g.setValueAtTime(lvl.gain, Math.max(when, when + playFor - lvl.fade_out_s)); g.linearRampToValueAtTime(0.0001, when + playFor); }
            try { src.start(when, off + late, loops ? undefined : Math.max(0.01, Math.min(playFor, buf.duration - off - late))); if (loops) src.stop(when + playFor); }
            catch (_) { continue; }
            MW.sources.push(src);
        }
        const btn = document.getElementById('mwPlayBtn'); if (btn) btn.innerHTML = '&#10073;&#10073; Pause';
        mwPictureFollow(true);
        cancelAnimationFrame(MW.raf);
        const tick = () => {
            if (!MW.playing) return;
            MW.playheadMs = MW.msStart + Math.max(0, (ctx.currentTime - MW.ctxStart) * 1000);
            const ph = document.getElementById('mwPlayhead'); if (ph) ph.style.left = mwX(MW.playheadMs) + 'px';
            const clock = document.getElementById('mwClock'); if (clock) clock.textContent = mwTime(MW.playheadMs);
            if (MW.playheadMs >= mwLengthMs()) { mwStop(); return; }
            MW.raf = requestAnimationFrame(tick);
        };
        MW.raf = requestAnimationFrame(tick);
    }

    function mwStopSources() { for (const s of MW.sources) { try { s.stop(); } catch (_) { /* already ended */ } } MW.sources = []; }

    function mwPause() {
        MW.playing = false; mwStopSources(); cancelAnimationFrame(MW.raf);
        mwPictureFollow(false);
        const btn = document.getElementById('mwPlayBtn'); if (btn) btn.innerHTML = '&#9654; Play';
    }

    function mwStop() { mwPause(); mwSeek(0); }

    /** A mixer change while playing: re-schedule from where the playhead is. */
    function mwRestartAudio() { if (!MW.playing) return; MW.playing = false; mwStopSources(); cancelAnimationFrame(MW.raf); mwPlay(); }

    function fmtDuration(ms) {
        if (!ms || ms < 0) return null;
        const s = Math.round(ms / 1000);
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function fmtSize(bytes) {
        if (!bytes) return null;
        return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB'
                                : Math.max(1, Math.round(bytes / 1024)) + ' KB';
    }

    function fmtAge(iso) {
        if (!iso) return null;
        const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
        if (!isFinite(days) || days < 0) return null;
        return days === 0 ? 'today' : days === 1 ? 'yesterday' : days + 'd ago';
    }

    /** Draw the peaks the server computed. Flat line when there are none. */
    function drawWaveform(canvas, peaks) {
        const ctx = canvas.getContext && canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
        const h = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = getComputedStyle(canvas).color || '#818cf8';
        const list = (peaks && peaks.length) ? peaks : new Array(48).fill(0.02);
        const bar = w / list.length;
        for (let i = 0; i < list.length; i++) {
            const barH = Math.max(1, list[i] * h * 0.92);
            ctx.fillRect(i * bar, (h - barH) / 2, Math.max(1, bar * 0.62), barH);
        }
    }

    /** Fetch peaks once per asset and paint every canvas waiting on them. */
    async function paintWaveforms(root) {
        for (const c of (root || document).querySelectorAll('canvas.snd-wave[data-asset]')) {
            if (c.dataset.painted) continue;
            c.dataset.painted = '1';
            try {
                const w = await api('/assets/' + c.dataset.asset + '/waveform');
                drawWaveform(c, w && w.peaks);
            } catch (_) { drawWaveform(c, null); }
        }
    }

    /*
     * ONE CARD PER FILE.
     *
     * The card carries what the row knows AND what only the file knows —
     * codec, sample rate, channels, bitrate — because those disagree more
     * often than anyone expects. Every audio file in this project was
     * requested as wav and arrived as 44.1kHz mp3, and no surface said so.
     */
    let SOUND_LIB = { sounds: [], facts: [], kinds: [] };

    let SOUND_FILTER = '';

    function soundFileCard(s) {
        const facts = [
            s.duration_ms ? fmtDuration(s.duration_ms) : null,
            s.codec ? String(s.codec).toUpperCase() : (s.format ? String(s.format).toUpperCase() : null),
            s.sample_rate ? (s.sample_rate / 1000).toFixed(1).replace(/\.0$/, '') + ' kHz' : null,
            s.channels ? (s.channels === 1 ? 'mono' : s.channels === 2 ? 'stereo' : s.channels + 'ch') : null,
            s.bitrate_kbps ? s.bitrate_kbps + ' kbps' : null,
            s.size_bytes ? fmtSize(s.size_bytes) : null,
        ].filter(Boolean);

        // Served composed, so the card and any other reader cannot disagree
        // about what a file is for.
        const belongs = s.belongs_to ? esc(s.belongs_to) : '';

        const origin = [s.imported ? 'imported' : (s.provider ? esc(s.provider) : null),
                        s.created_at ? fmtAge(s.created_at) : null].filter(Boolean).join(' &middot; ');

        return `<div class="snd-card" data-sound="${esc(s.id)}" data-kind="${esc(s.kind)}">
            <div class="snd-tile">
                ${s.url ? `<canvas class="snd-wave" data-asset="${esc(s.id)}"></canvas>
                           <button class="snd-play" onclick="sndPlay(this)" data-src="${esc(s.url)}">&#9654;</button>`
                        : '<span class="text-sm text-muted">file missing</span>'}
            </div>
            <div class="snd-meta">
                <strong title="${esc(s.file_name || '')}">${esc(s.file_name || '(unnamed)')}</strong>
                <div class="snd-cat">${esc(s.kind_label || s.kind)}${belongs ? ' &middot; ' + belongs : ''}</div>
                ${s.line ? `<div class="text-sm text-muted" style="margin-top:2px;">&ldquo;${esc(String(s.line).slice(0, 70))}&rdquo;</div>` : ''}
                <div class="snd-facts">${facts.join(' &middot; ')}</div>
                ${origin ? `<div class="snd-origin">${origin}${s.takes > 1 ? ' &middot; ' + s.takes + ' takes' : ''}</div>` : ''}
                ${s.format_mismatch ? `<div class="snd-warn" title="The name says one container and the bytes are another">filed .${esc(s.format)} &middot; actually ${esc(s.codec)}</div>` : ''}
            </div>
        </div>`;
    }

    async function loadSoundLibrary() {
        if (!state.currentProject) return;
        const grid = document.getElementById('soundLibGrid');
        if (!grid) return;
        grid.innerHTML = '<p class="text-sm text-muted" style="grid-column:1/-1;">Reading the library&hellip;</p>';
        try {
            SOUND_LIB = await api('/projects/' + state.currentProject.id + '/sounds');
            renderSoundLibrary();
        } catch (err) {
            // A renderer that paints a placeholder must have a path that
            // replaces it: a spinner that never resolves is worse than an error.
            grid.innerHTML = `<p class="text-sm text-muted" style="grid-column:1/-1;">Could not read the sound library: ${esc(err.message)}</p>`;
        }
    }

    function renderSoundLibrary() {
        const grid = document.getElementById('soundLibGrid');
        if (!grid) return;
        const all = SOUND_LIB.sounds || [];
        const shown = SOUND_FILTER ? all.filter(x => x.kind === SOUND_FILTER) : all;

        const filters = document.getElementById('soundLibFilters');
        if (filters) {
            filters.innerHTML = [{ id: '', label: 'All', count: all.length }]
                .concat((SOUND_LIB.kinds || []).filter(k => k.count))
                .map(k => `<span class="ss-ref-filter ${SOUND_FILTER === k.id ? 'on' : ''}"
                                 onclick="SOUND_FILTER='${esc(k.id)}';renderSoundLibrary();"
                                 style="cursor:pointer;">${esc(k.label)} ${k.count}</span>`).join('');
        }
        const count = document.getElementById('soundLibCount');
        if (count) count.textContent = all.length + ' file(s) in this film';

        grid.innerHTML = shown.length
            ? shown.map(soundFileCard).join('')
            : '<p class="text-sm text-muted" style="grid-column:1/-1;">No sound generated or imported yet.</p>';
        paintWaveforms(grid);
    }

    /* ── generating one sound from a prompt ─────────────────────────── */
    async function openSoundGenerator() {
        showModal('soundGenModal');
        const sel = document.getElementById('soundGenShot');
        // The shot list is loaded here rather than held, so a shot added since
        // the page opened is offered.
        try {
            const d = await api('/projects/' + state.currentProject.id + '/shotlist');
            sel.innerHTML = '<option value="">&mdash; no shot, just the prompt &mdash;</option>'
                + (d.shots || []).map(sh =>
                    `<option value="${esc(sh.id)}">Sc${esc(String(sh.scene_number || '?'))} / ${esc(sh.shot_code)}</option>`).join('');
        } catch (_) { /* the prompt alone still works */ }
        soundGenPreview();
    }

    async function soundGenPreview() {
        const out = document.getElementById('soundGenPreviewOut');
        const prompt = (document.getElementById('soundGenPrompt').value || '').trim();
        if (!prompt) { out.textContent = 'Say what the sound is.'; return; }
        const q = new URLSearchParams({
            preview: '1', prompt,
            kind: document.getElementById('soundGenKind').value,
            duration_s: String(Number(document.getElementById('soundGenSeconds').value) || 5),
        });
        const shot = document.getElementById('soundGenShot').value;
        if (shot) q.set('shot_id', shot);
        out.textContent = 'Reading what would be sent…';
        setStatus('Reading what would be sent…', true);
        try {
            // A GET, because it spends nothing: a free read posting to a
            // generating URL is indistinguishable from one that pays.
            const d = await api(`/projects/${state.currentProject.id}/sounds/generate?${q.toString()}`);
            out.textContent = d.prompt + '\n\n' + d.provider + ' · ' + d.duration_s + 's';
            setStatus('Preview ready — nothing spent');
        } catch (err) {
            out.textContent = 'Could not preview: ' + err.message;
            setStatus('Could not preview: ' + err.message);
        }
    }

    async function runSoundGenerate(btn) {
        const prompt = (document.getElementById('soundGenPrompt').value || '').trim();
        if (!prompt) { setStatus('Say what the sound is first'); return; }

        const kind = document.getElementById('soundGenKind').value;
        const shotId = document.getElementById('soundGenShot').value || '';
        const seconds = Number(document.getElementById('soundGenSeconds').value) || 5;
        const q = new URLSearchParams({ preview: '1', prompt, kind, duration_s: String(seconds) });
        if (shotId) q.set('shot_id', shotId);

        /*
         * Through the ONE shared confirmation, like every other paid button.
         * The modal's own preview is a convenience while composing; this is the
         * gate that spends, and it reads the SAME handler over GET, so what it
         * shows cannot differ from what is sent.
         */
        return confirmPaidImage({
            title: 'Before we spend a credit',
            capability: kind === 'music' ? 'music' : kind,
            previewUrl: `/projects/${state.currentProject.id}/sounds/generate?${q.toString()}`,
            note: shotId
                ? 'The shot adds its location, hour and action to what you wrote.'
                : 'Just the prompt — pick a shot to add its details.',
            editable: false,
            notEditableWhy: 'Edit the wording in the box behind this dialog.',
            send: async choices => {
                setStatus('Generating the sound…', true);
                try {
                    const d = await api('/projects/' + state.currentProject.id + '/sounds/generate', {
                        method: 'POST',
                        body: JSON.stringify({ prompt, kind, duration_s: seconds,
                            shot_id: shotId || undefined, ...(choices || {}) }),
                    });
                    setStatus('Generated ' + d.file_name);
                    closeModal('soundGenModal');
                    await loadSoundLibrary();
                } catch (err) { setStatus('Error: ' + err.message); }
            },
        });
    }

    function soundCueCard(cue, asset) {
        const url = asset && asset.url ? legacy.API_BASE + asset.url : '';
        const cat = SOUND_CATEGORIES.find(c => c.type === cue.cue_type) || { label: cue.cue_type };
        const title = cue.title || cue.description || '(untitled)';
        // Only facts the row actually holds. A missing one is omitted, never
        // shown as a blank or a zero.
        const facts = [
            asset && asset.format ? String(asset.format).toUpperCase() : null,
            fmtDuration(asset && asset.duration_ms),
            fmtSize(asset && asset.size_bytes),
        ].filter(Boolean);
        const origin = [asset && asset.provider, fmtAge(asset && asset.created_at)].filter(Boolean);

        return `<div class="snd-card" data-cue-id="${esc(cue.id)}">
            <div class="snd-tile">
                ${url ? `<canvas class="snd-wave" data-asset="${esc(asset.id || '')}"></canvas>
                         <audio src="${esc(url)}" preload="none"></audio>
                         <button class="snd-play" title="Play" onclick="sndPlay(this)">&#9654;</button>`
                      : '<div class="snd-empty">no audio yet</div>'}
            </div>
            <div class="snd-meta">
                <strong title="${esc(cue.description || '')}">${esc(title)}</strong>
                <span class="snd-cat">${esc(cat.label)}</span>
                ${facts.length ? `<span class="snd-facts">${esc(facts.join(' \u00b7 '))}</span>` : ''}
                ${origin.length ? `<span class="snd-origin">${esc(origin.join(' \u00b7 '))}</span>` : ''}
            </div>
            <div class="snd-actions">
                <button class="btn btn-secondary btn-sm" onclick="generateCueAudio('${esc(cue.id)}', this)">${url ? 'Regen' : 'Generate'}</button>
                ${mediaUploadControl('music', 'audio', 'cue', cue.id, { after: 'loadMusic', label: 'Upload' })}
                <button class="btn btn-secondary btn-sm" onclick="openCueMidi('${esc(cue.id)}')" title="The notes: parts written over a harmonic plan, and parts you played">MIDI</button>
                <button class="btn btn-secondary btn-sm" onclick="deleteSoundCue('${esc(cue.id)}')" title="Remove this cue. Audio it produced is kept.">&times;</button>
            </div>
        </div>`;
    }

    /*
     * A cue's NOTES (GRD-3994): the parts written over its plan, and a place to
     * drop a part you PLAYED. Composing is Claude's job over MCP
     * (music_midi_write); this panel is where a director sees what was written,
     * takes the .mid into a DAW, and replaces a part with their own performance.
     * Nothing here spends money.
     */
    async function openCueMidi(cueId) {
        let d, lib = { instruments: [] };
        try { d = await api('/music-cues/' + cueId + '/midi'); }
        catch (err) { setStatus('Could not read the notes: ' + err.message, true); return; }
        // The director's own instruments. A failure here is not fatal: the notes
        // are still readable and downloadable without anything to play them.
        try { lib = await api('/instruments'); } catch (err) { lib = { instruments: [], error: err.message }; }
        const n = d.notes;
        const parts = n ? n.parts : [];
        const len = d.length && d.length.ms
            ? (d.length.ms / 1000).toFixed(1) + 's, from the ' + d.length.source
            : 'no length yet — set a duration on the cue, or give the scene footage';
        const replace = p => `<label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0;" title="Replace this part with a .mid you played. Only this part changes.">Replace with played
                <input type="file" accept="audio/midi,audio/x-midi,.mid,.midi" style="display:none"
                       onchange="uploadCueMidiPart(event, '${esc(cueId)}', ${jsAttr(p.name)})"></label>`;
        const playable = (lib.instruments || []).filter(i => i.available);
        const picker = p => {
            if (!playable.length) return '<span class="text-muted text-sm">no instruments yet</span>';
            const chosen = (d.renders && d.renders[p.name] && d.renders[p.name].instrument_id) || '';
            return `<select class="form-input" style="max-width:190px;padding:2px 6px;" data-cue-part="${esc(p.name)}">
                ${playable.map(i => `<option value="${esc(i.id)}" ${i.id === chosen ? 'selected' : ''}>${esc(i.name)}${i.library ? ' \u00b7 ' + esc(i.library) : ''}</option>`).join('')}
            </select>`;
        };
        const heard = p => {
            const r = d.renders && d.renders[p.name];
            return r ? `<audio src="${esc(legacy.API_BASE + r.url)}" controls preload="none" style="height:28px;max-width:180px;"></audio>` : '';
        };
        const rows = parts.length
            ? parts.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.drums ? 'Drums' : (p.instrument || ''))}</td>
                    <td>${p.notes}</td><td>${p.source === 'performed' ? 'played' : 'written'}</td>
                    <td>${picker(p)}</td>
                    <td><button class="btn btn-secondary btn-sm" title="Play this part through the chosen instrument, on this machine. Free."
                            onclick="playCuePart('${esc(cueId)}', ${jsAttr(p.name)}, this)">Play</button></td>
                    <td>${heard(p)}</td>
                    <td>${replace(p)}</td></tr>`).join('')
            : '<tr><td colspan="8" class="text-muted text-sm">No notes yet. Ask Claude to write parts over a plan for this cue, or add a part you played below.</td></tr>';
        showModalHtml('cueMidiModal', `
            <div class="modal-header"><h3>Notes · ${esc(d.cue.title || 'cue')}</h3></div>
            <p class="text-sm text-muted">Length ${esc(len)}. ${n ? 'Version ' + n.version + '.' : ''}
               A part you play is kept when Claude rewrites the others.</p>
            <table class="data-table" style="width:100%;"><thead><tr><th>Part</th><th>Written for</th><th>Notes</th><th>From</th><th>Played by</th><th></th><th>Heard</th><th></th></tr></thead>
                <tbody>${rows}</tbody></table>
            ${playable.length ? '' : '<p class="text-sm text-muted">No instruments in your library yet. Capture a patch from a plugin you own, or scan your NKS presets \u2014 see docs/instrument-sidecar.md.</p>'}
            <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap;">
                <input id="cueMidiNewPart" class="form-input" placeholder="New part, e.g. melody" style="max-width:220px;">
                <label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0;">Add a played part
                    <input type="file" accept="audio/midi,audio/x-midi,.mid,.midi" style="display:none"
                           onchange="uploadCueMidiPart(event, '${esc(cueId)}', '')"></label>
                ${n ? `<a class="btn btn-secondary btn-sm" href="${esc(legacy.API_BASE + n.url)}" download>Download .mid</a>
                       <button class="btn btn-secondary btn-sm" title="Play these notes through the SoundFont installed on this machine. Free." onclick="renderCueInstruments('${esc(cueId)}', this)">Render with instruments</button>` : ''}
                <button class="btn btn-secondary btn-sm" style="margin-left:auto;" onclick="closeModal('cueMidiModal')">Close</button>
            </div>`);
    }

    /** Play a cue's notes through local instruments (FluidSynth). Free, and it becomes the cue's audio. */
    async function renderCueInstruments(cueId, btn) {
        if (btn) { btn.disabled = true; btn.textContent = 'Rendering\u2026'; }
        setStatus('Rendering the notes through the instruments on this machine\u2026', true);
        try {
            const r = await api('/music-cues/' + cueId + '/midi/render', { method: 'POST', body: '{}' });
            setStatus(r.note || 'Rendered', true);
            closeModal('cueMidiModal');
            loadMusic();
        } catch (err) {
            setStatus('Could not render: ' + err.message, true);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Render with instruments'; }
        }
    }

    /*
     * Play one part through one of your own instruments (Kontakt and the
     * libraries you own), on this machine. Free: nothing is billed, and the
     * result becomes that part's audio, which is how a composition is built
     * here part by part rather than in a DAW.
     */
    async function playCuePart(cueId, part, btn) {
        const row = btn.closest('tr');
        const select = row && row.querySelector('select[data-cue-part]');
        const instrumentId = select && select.value;
        if (!instrumentId) { setStatus('Pick an instrument for this part first', true); return; }
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Playing\u2026';
        setStatus('Playing ' + part + ' through your instrument\u2026', true);
        try {
            const r = await api('/music-cues/' + cueId + '/midi/parts/' + encodeURIComponent(part) + '/render', {
                method: 'POST', body: JSON.stringify({ instrument_id: instrumentId }),
            });
            setStatus(r.note || (part + ' played'), true);
            openCueMidi(cueId);
        } catch (err) {
            setStatus('Could not play that part: ' + err.message, true);
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    }

    /** Send a played .mid onto one part of a cue. The server rebuilds the file and keeps the original. */
    async function uploadCueMidiPart(event, cueId, partName) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const field = document.getElementById('cueMidiNewPart');
        const part = String(partName || (field && field.value) || '').trim();
        if (!part) { setStatus('Name the part this take becomes, then choose the file', true); event.target.value = ''; return; }
        const url = '/music-cues/' + cueId + '/midi/parts/' + encodeURIComponent(part) + '/import';
        setStatus('Importing ' + file.name + ' as ' + part + '…', true);
        try {
            checkUploadSize(file, url);
            const data = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = () => reject(new Error('That file could not be read.'));
                r.readAsDataURL(file);
            });
            const res = await api(url, { method: 'POST', body: JSON.stringify({ data, name: file.name }) });
            setStatus(res.note || (part + ' imported'), true);
            openCueMidi(cueId);
        } catch (err) {
            setStatus('Could not import that part: ' + err.message, true);
        } finally { event.target.value = ''; }
    }

    /** Play or pause the card you clicked, and stop whatever else was playing. */
    function sndPlay(btn) {
        const card = btn.closest('.snd-card');
        const a = card && card.querySelector('audio');
        if (!a) return;
        document.querySelectorAll('.snd-card audio').forEach(o => { if (o !== a) { o.pause(); } });
        document.querySelectorAll('.snd-play').forEach(b => { if (b !== btn) b.innerHTML = '&#9654;'; });
        if (a.paused) { a.play(); btn.innerHTML = '&#10073;&#10073;'; }
        else { a.pause(); btn.innerHTML = '&#9654;'; }
        a.onended = () => { btn.innerHTML = '&#9654;'; };
    }

    /** A scene's sounds, one region per category, in the sheet design. */
    function renderSoundSheet(sc, cues, assetById) {
        const mine = (cues || []).filter(c => c.scene_id === sc.id);
        const region = cat => {
            const rows = mine.filter(c => c.cue_type === cat.type);
            const inner = rows.length
                ? `<div class="snd-cards">${rows.map(c => soundCueCard(c, (assetById || {})[c.generated_asset_id])).join('')}</div>`
                : '<p class="text-muted text-sm">Nothing yet.</p>';
            return ssSection('snd-' + cat.type, cat.label, cat.what,
                inner + `<button class="btn btn-secondary btn-sm" style="margin-top:8px;"
                        onclick="addSoundCue('${esc(sc.id)}', '${cat.type}')">+ ${esc(cat.label)}</button>`);
        };
        return `<div class="ss-grid snd-grid">
            <div class="ss-col">${SOUND_CATEGORIES.slice(0, 3).map(region).join('')}</div>
            <div class="ss-col">${SOUND_CATEGORIES.slice(3).map(region).join('')}</div>
        </div>`;
    }

    /** Generate the audio for ONE cue — the cue written, not the scene's first. */
    function generateCueAudio(cueId, btn) {
        return confirmPaidImage({
            capability: 'music',
            title: 'Generate this cue',
            note: 'Generates the audio for this cue only. Others on the scene are untouched.',
            send: async choices => _shotAction(cueId, btn, 'Generate',
                '/music-cues/' + cueId + '/generate', 'Generating', loadMusic, choices),
        });
    }

    /** Add a cue of a category to a scene. Several of a kind is the point. */
    async function addSoundCue(sceneId, cueType) {
        if (!state.currentProject) return;
        const label = (SOUND_CATEGORIES.find(c => c.type === cueType) || {}).label || cueType;
        const title = prompt('What is this ' + label.toLowerCase() + '?', '');
        if (title === null) return;
        try {
            await api('/projects/' + state.currentProject.id + '/music-cues', {
                method: 'POST',
                body: JSON.stringify({ scene_id: sceneId, cue_type: cueType,
                                       title: title || label, description: title || '' }),
            });
            setStatus(label + ' cue added', true);
            loadMusic();
        } catch (err) { setStatus('Could not add the cue: ' + err.message, true); }
    }

    /** Remove a cue. The audio it produced is an asset and is deliberately kept. */
    async function deleteSoundCue(cueId) {
        if (!confirm('Remove this cue? Any audio it generated stays in the project.')) return;
        try {
            await api('/music-cues/' + cueId, { method: 'DELETE' });
            setStatus('Cue removed', true);
            loadMusic();
        } catch (err) { setStatus('Could not remove the cue: ' + err.message, true); }
    }

    async function loadMusic() {
        // The file library and the cue sheet are two different questions;
        // both load when the page opens.
        loadSoundLibrary();
        if (!state.currentProject) return;
        setStatus('Loading music...');
        const pid = state.currentProject.id;
        try {
            const [sceneData, jobData, provData, cueData] = await Promise.all([
                api('/projects/' + pid + '/scenes').catch(() => ({ scenes: [] })),
                api('/projects/' + pid + '/music/jobs').catch(() => ({ jobs: [] })),
                api('/projects/' + pid + '/providers').catch(() => ({ effective: {} })),
                api('/projects/' + pid + '/music-cues').catch(() => ({ music_cues: [] })),
            ]);
            /*
             * EVERY cue a scene holds, grouped by scene — not the first of each
             * kind. This kept one score and one ambient and dropped the rest, so
             * three sound effects showed as one and `source`, `sfx` and
             * `transition` were invisible however they were written.
             *
             * The two single-cue lookups stay: the scene-level "score this
             * scene" and the ambient direction box each act on one cue and have
             * to pick, exactly as the route does.
             */
            const cuesByScene = {};
            const ambientCues = {};
            const scoreCues = {};
            (cueData.music_cues || []).forEach(c => {
                if (!c.scene_id) return;
                (cuesByScene[c.scene_id] ||= []).push(c);
                if (c.cue_type === 'ambient') { if (!ambientCues[c.scene_id]) ambientCues[c.scene_id] = c; }
                else if (c.cue_type === 'score' && !scoreCues[c.scene_id]) scoreCues[c.scene_id] = c;
            });
            window.__cuesByScene = cuesByScene;
            window.__ambientCues = ambientCues;
            window.__scoreCues = scoreCues;
            const scenes = sceneData.scenes || [];
            // Latest job per (scene, gen_type).
            const jobKey = {};
            (jobData.jobs || []).forEach(j => { const k = j.scene_id + ':' + j.gen_type; if (!jobKey[k]) jobKey[k] = j; });
            // Keyed by id too, because a cue points at its own audio via
            // generated_asset_id — what makes two scores two files.
            const assetById = {};
            (jobData.assets || []).forEach(a => { if (a && a.id) assetById[a.id] = a; });
            const assetsByScene = {};
            (jobData.assets || []).forEach(a => {
                if (!a.scene_id) return;
                (assetsByScene[a.scene_id] ||= {})[a.asset_type] ||= a;
            });
            const musicProvider = (provData.effective && provData.effective.music) || 'gridlight';
            const ambientProvider = (provData.effective && provData.effective.ambient) || 'gridlight';

            const grid = document.getElementById('musicGrid');
            const banner = `<div style="grid-column:1/-1;background:var(--gl-bg-surface);border:1px solid var(--gl-border-subtle);border-radius:8px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">
                <span class="text-sm text-muted">Score: <strong style="color:var(--gl-text-primary);">${esc(musicProvider)}</strong> &middot; Ambient: <strong style="color:var(--gl-text-primary);">${esc(ambientProvider)}</strong></span>
                <a class="text-sm" style="cursor:pointer;color:var(--gl-accent,#818cf8);" onclick="navigateTo('settings')">Change in Settings →</a>
            </div>`;

            if (scenes.length === 0) {
                grid.innerHTML = banner + '<div class="empty-state" style="grid-column:1/-1;"><div class="icon">&#127925;</div><h3>No scenes</h3><p>Extract scenes from your screenplay first, then generate score and ambient audio.</p></div>';
                setStatus('No scenes');
                return;
            }

            // The upload control is BUILT AT THE CALL SITE and passed in, so
            // each scene-scoped capability is named where it is used. Derived
            // inside from `kind`, the two would be a ternary nothing outside
            // this function could find — including a reader looking for where
            // ambient can be uploaded.
            const audioRow = (label, sc, kind, provider, upload) => {
                const job = jobKey[sc.id + ':' + kind];
                const assetType = kind === 'score' ? 'audio_music' : 'audio_ambient';
                const asset = (assetsByScene[sc.id] || {})[assetType];
                const done = !!asset || (job && job.status === 'complete');
                const failed = job && job.status === 'failed';
                const url = asset && asset.url
                    ? legacy.API_BASE + asset.url
                    : legacy.API_BASE + '/film/music/' + pid + '/' + encodeURIComponent(sc.scene_number) + '_' + kind + '.wav';
                const badge = done ? '<span class="tag" style="background:var(--gl-success,#166534);">ready</span>'
                    : failed ? '<span class="tag" style="background:var(--gl-danger,#7f1d1d);">failed</span>'
                    : (job && job.status === 'generating') ? '<span class="tag">generating</span>' : '';
                const gen = kind === 'score' ? "generateScoreFor('" + sc.id + "', this)" : "generateAmbientFor('" + sc.id + "', this)";
                return `<div style="margin-top:8px;">
                    <div class="flex-between"><span class="text-sm">${label} ${badge}</span>
                        <span style="display:flex;gap:6px;">
                            <button class="btn btn-secondary btn-sm" onclick="${gen}">${done ? 'Regen' : 'Generate'}</button>
                            ${upload}
                        </span></div>
                    ${done ? '<audio src="' + url + '" controls preload="none" style="width:100%;margin-top:6px;" onerror="this.style.display=\'none\'"></audio>' : ''}
                </div>`;
            };

            grid.innerHTML = banner + scenes.map(sc => `
                <!--
                  A scene's sound is a SHEET, not a tile. The grid is
                  auto-fill/minmax(300px), which is right for a row of entity
                  cards and wrong here: it gave the whole sheet one 300px track
                  with the page empty beside it, and squeezed its own two
                  columns into that. Spanning every track is what gives the
                  categories room to sit side by side.
                -->
                <div class="entity-card" style="grid-column:1/-1;">
                    <div class="flex-between">
                        <strong style="font-size:13px;">Scene ${esc(String(sc.scene_number))}</strong>
                        <span class="text-sm text-muted">${esc(sc.location || '')}${sc.time_of_day ? ' &middot; ' + esc(sc.time_of_day) : ''}</span>
                    </div>
                    ${renderSoundSheet(sc, cueData.music_cues || [], assetById)}
                    <!--
                      The two scene-level rows stay: "score this scene" and "give
                      it a bed" are single actions, and they are how every
                      existing project's audio was made. The sheet above is the
                      cue sheet. The two coexist deliberately.
                    -->
                    ${audioRow('Score (scene)', sc, 'score', musicProvider,
                        mediaUploadControl('music', 'audio', 'scene', sc.id, { after: 'loadMusic', label: 'Upload' }))}
                    ${audioRow('Ambient (scene)', sc, 'ambient', ambientProvider,
                        mediaUploadControl('ambient', 'audio', 'scene', sc.id, { after: 'loadMusic', label: 'Upload' }))}
                    <!--
                      The bed was assembled from a lookup table on the location
                      NAME and the time of day, and a director had no way to say
                      a word about it. Saved as an ambient cue on this scene, so
                      it is durable and reaches the batch as well as the button.
                    -->
                    <div style="margin-top:6px;">
                        <!--
                          The direction, where the score IS.
                          The cue form lives on the Music Cues page behind
                          "+ Music Cue", so a director looking at a scene that
                          already has a score had no way to say anything about
                          it without generating something. Saving here writes
                          the cue and generates NOTHING — the next Regen picks
                          it up.
                        -->
                        <input type="text" id="score_${sc.id}" class="text-sm" style="width:100%;"
                               placeholder="Score direction: holds under the dialogue, lifts when she stands"
                               value="${esc((scoreCues[sc.id] || {}).description || '')}"
                               onchange="saveScoreDirection('${sc.id}', this.value, this)">
                    </div>
                    <div style="margin-top:6px;">
                        <input type="text" id="amb_${sc.id}" class="text-sm" style="width:100%;"
                               placeholder="Ambient direction: the fridge compressor cuts out halfway through"
                               value="${esc((ambientCues[sc.id] || {}).description || '')}"
                               onchange="saveAmbientDirection('${sc.id}', this.value, this)">
                    </div>
                    <div style="margin-top:6px;">
                        <input type="text" id="delivery_${sc.id}" data-field="delivery_direction" class="text-sm" style="width:100%;"
                               placeholder="Delivery direction: tense, hushed, talking over each other"
                               value="${esc(sc.delivery_direction || '')}"
                               onchange="saveSceneDelivery('${sc.id}', this.value, this)">
                    </div>
                </div>`).join('');

            const readyCount = scenes.filter(sc => assetsByScene[sc.id] && assetsByScene[sc.id].audio_music).length;
            setStatus(scenes.length + ' scene(s), ' + readyCount + ' scored');
            /*
             * Peaks arrive AFTER the cards do, never before. Awaiting a decoder
             * for every cue would make the sheet wait to show which sounds even
             * exist — the same mistake loadStoryboard made when it awaited the
             * drift report before painting a single frame.
             */
            paintWaveforms(grid);
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    /*
     * A paid action states its cost before it spends. This was a one-line
     * function and the first attempt at gating it put the confirm OUTSIDE the
     * body — a top-level `return` that broke the whole SPA at load, and which a
     * source-text check reported as gated. Written out properly so the guard is
     * unambiguously inside.
     */
    function generateScoreFor(sceneId, btn) {
        /*
         * The brief is FREE and builds the prompt the generator receives —
         * the same walk, so the words shown are the words sent rather than a
         * description of them.
         */
        return confirmPaidImage({
            capability: 'music',
            title: 'Score this scene',
            note: 'Written to the measured length of the cut, not a default.',
            previewUrl: `/scenes/${sceneId}/music/brief`,
            send: async choices => _shotAction(sceneId, btn, 'Generate',
                '/scenes/' + sceneId + '/music/generate', 'Scoring', loadMusic, choices),
        });
    }

    /**
     * Store the scene's ambient direction.
     *
     * An ambient cue is an ordinary music cue with cue_type 'ambient' — the
     * same table, the same tools, the same negative and level and fades. A
     * second store for "the same thing but for room tone" is how one of them
     * acquires a fix the other does not.
     */
    async function saveAmbientDirection(sceneId, text, el) {
        if (!state.currentProject) return;
        const existing = (window.__ambientCues || {})[sceneId];
        try {
            if (existing) {
                await api('/music-cues/' + existing.id, { method: 'PUT', body: JSON.stringify({ description: text }) });
            } else {
                const made = await api('/projects/' + state.currentProject.id + '/music-cues', {
                    method: 'POST',
                    body: JSON.stringify({ scene_id: sceneId, cue_type: 'ambient', title: 'Ambient', description: text }),
                });
                (window.__ambientCues = window.__ambientCues || {})[sceneId] = made;
            }
            if (el) el.style.borderColor = 'var(--gl-success, #166534)';
            setStatus('Ambient direction saved');
        } catch (err) {
            if (el) el.style.borderColor = 'var(--gl-danger, #7f1d1d)';
            setStatus('Error: ' + err.message);
        }
    }

    /**
     * Say something about a scene's score, without buying it again.
     *
     * "Still don't have a way to add details to the music generator when we
     * want (do not regenerate it again though)" — the details lived only in the
     * cue form on another page, reachable through a button called "+ Music
     * Cue", which is the wrong door for a scene that already has a score.
     *
     * Writes the cue and generates NOTHING. The next Regen picks it up, and so
     * does the free brief, so a director can read what it will send before
     * spending.
     */
    async function saveScoreDirection(sceneId, text, el) {
        if (!state.currentProject) return;
        const existing = (window.__scoreCues || {})[sceneId];
        try {
            if (existing) {
                await api('/music-cues/' + existing.id, {
                    method: 'PUT', body: JSON.stringify({ description: text }),
                });
                existing.description = text;
            } else {
                const made = await api('/projects/' + state.currentProject.id + '/music-cues', {
                    method: 'POST',
                    body: JSON.stringify({ scene_id: sceneId, cue_type: 'score', title: 'Score', description: text }),
                });
                (window.__scoreCues = window.__scoreCues || {})[sceneId] = made;
            }
            if (el) el.style.borderColor = 'var(--gl-success, #166534)';
            setStatus('Score direction saved — nothing generated. Press Regen when you want to hear it.');
        } catch (err) {
            if (el) el.style.borderColor = 'var(--gl-danger, #7f1d1d)';
            setStatus('Error: ' + err.message);
        }
    }

    /**
     * How this scene is PLAYED.
     *
     * Sits between the character's standing delivery and the line's own
     * parenthetical: more specific than how somebody always sounds, less
     * specific than how they say this one line. Existing takes are untouched
     * until they are regenerated — which is what Redo dialogue in Playback is
     * for.
     */
    async function saveSceneDelivery(sceneId, text, el) {
        try {
            await api('/scenes/' + sceneId, {
                method: 'PUT', body: JSON.stringify({ delivery_direction: text }),
            });
            if (el) el.style.borderColor = 'var(--gl-success, #166534)';
            setStatus('Delivery direction saved. Lines already spoken keep their take until you redo them.');
        } catch (err) {
            if (el) el.style.borderColor = 'var(--gl-danger, #7f1d1d)';
            setStatus('Error: ' + err.message);
        }
    }

    function generateAmbientFor(sceneId, btn) {
        /*
         * The ambient brief builds the same payload the generator receives,
         * including the scene's own direction and the location's sound notes —
         * two fields that were stored for years and reached nothing.
         *
         * An empty direction means the bed is assembled from the location name
         * and the hour and nothing else, which is worth seeing before paying
         * for it rather than after.
         */
        return confirmPaidImage({
            capability: 'ambient',
            title: 'Generate an ambient bed',
            note: 'A short loop tiled across the scene, not a full-length render.',
            previewUrl: `/scenes/${sceneId}/ambient/brief`,
            send: async choices => _shotAction(sceneId, btn, 'Generate',
                '/scenes/' + sceneId + '/ambient/generate', 'Ambient', loadMusic, choices),
        });
    }

    function generateAllMusic() {
        if (!state.currentProject) return;
        const prog = document.getElementById('musicProgress');
        const bar = document.getElementById('musicProgressBar');
        const lbl = document.getElementById('musicProgressLabel');
        prog.style.display = 'block';
        bar.style.width = '0%';
        lbl.textContent = 'Starting music generation...';
        let total = 1, done = 0;

        streamSSEPost(
            '/projects/' + state.currentProject.id + '/music/batch/stream',
            {},
            (ev) => {
                if (ev.type === 'status' && ev.total_scenes) { total = ev.total_scenes || 1; }
                else if (ev.type === 'scene_start') { lbl.textContent = 'Scene ' + (ev.scene_number || ''); }
                else if (ev.type === 'music_complete' || ev.type === 'music_failed') {
                    done++;
                    bar.style.width = Math.round((done / total) * 100) + '%';
                    lbl.textContent = done + '/' + total + ' scenes processed';
                }
            },
            () => { lbl.textContent = 'Done'; setStatus('Music batch complete'); setTimeout(() => { prog.style.display = 'none'; }, 1500); loadMusic(); },
            (err) => { setStatus('Error: ' + (err ? err.message : 'stream failed')); prog.style.display = 'none'; }
        );
    }

export {
    loadMusicCues,
    CUE_RIGHTS_VOCAB,
    cueRightsTag,
    openCueRights,
    saveCueRights,
    CUE_SECTIONS,
    cueRenderSections,
    cueAddSection,
    cueRemoveSection,
    cueClearSections,
    cueSectionEdit,
    createMusicCue,
    SOUND_CATEGORIES,
    MW_TRACK_TABS,
    MW_KIND_TABLE,
    loadMusicWorkstation,
    mwLoadSession,
    mwPickSession,
    mwFindRow,
    mwTrackOf,
    mwLengthMs,
    mwX,
    mwMs,
    mwRender,
    mwSessionListHtml,
    mwStatusHtml,
    mwApprovalHtml,
    mwApprove,
    mwUnapprove,
    mwDriftHtml,
    mwMoveToEdit,
    mwPictureHtml,
    mwPictureSound,
    mwPictureFollow,
    mwRebase,
    mwContextHtml,
    mwProviderHtml,
    mwRulerHtml,
    mwEmotionHtml,
    mwTrackHtml,
    mwToggleTrack,
    mwTrackTab,
    mwTrackPlayHtml,
    mwPlayTrack,
    mwTrackDetailsHtml,
    mwTrackSections,
    MW_ROW_H,
    MW_BLACK,
    MW_PITCH_NAMES,
    mwPitchName,
    mwNotesOf,
    mwRollRange,
    mwTempoBpm,
    mwSnapMs,
    mwSnap,
    mwPartPaneHtml,
    mwRollHtml,
    mwSetProgram,
    mwRollPointerDown,
    mwRollDelete,
    mwSaveNotes,
    mwPreviewPitch,
    mwHear,
    mwClipHtml,
    mwEnumOptions,
    mwControl,
    mwInspectorHtml,
    mwInstrumentControl,
    mwTrackOfAutomation,
    mwTakeGroupHtml,
    mwChooseTake,
    mwAddClipFromAsset,
    mwAddClipFromAssetSubmit,
    mwFieldChanged,
    mwSave,
    mwNote,
    mwRepaint,
    mwSelect,
    mwShowTrack,
    mwCreate,
    mwDelete,
    mwCreateSession,
    mwCreateSessionSubmit,
    mwSeek,
    mwZoom,
    mwClipPointerDown,
    mwDragOver,
    mwDrop,
    mwImportFiles,
    DAW_ADAPTER,
    dawState,
    dawBase,
    dawPaint,
    dawCanChange,
    dawUndecided,
    dawConnectionHtml,
    dawPortableHtml,
    dawSessionHtml,
    dawPushHtml,
    dawResultHtml,
    dawPullHtml,
    dawTransportHtml,
    dawAuditHtml,
    dawPanelHtml,
    dawRefresh,
    dawRun,
    dawReadSession,
    dawPlanPush,
    dawResolve,
    dawPush,
    dawPlanPull,
    dawPull,
    dawTransport,
    dawExportPackage,
    dawImportPackage,
    SCORE_AI_ACTIONS,
    scoreAiCapability,
    scoreAiNeed,
    scoreAiPanelHtml,
    scoreAiSelectedClip,
    scoreAiInputs,
    scoreAiGenerate,
    scoreAiCompose,
    scoreAiSection,
    scoreAiParts,
    scoreAiReference,
    scoreAiVideo,
    scoreAiInpaint,
    scoreAiRegenerate,
    scoreAiSeparate,
    scoreAiAudition,
    scoreAiApprove,
    scoreAiEmotion,
    scoreAiAcceptProposal,
    scoreAiRejectProposal,
    scoreAiUsd,
    scoreAiPlanHtml,
    scoreAiSeparationPlanHtml,
    scoreAiRetryHtml,
    scoreAiJobsHtml,
    scoreAiPoll,
    scoreAiRetry,
    mwHeard,
    mwClipLevel,
    mwBuffer,
    mwTogglePlay,
    mwPlay,
    mwStopSources,
    mwPause,
    mwStop,
    mwRestartAudio,
    fmtDuration,
    fmtSize,
    fmtAge,
    drawWaveform,
    paintWaveforms,
    SOUND_LIB,
    SOUND_FILTER,
    soundFileCard,
    loadSoundLibrary,
    renderSoundLibrary,
    openSoundGenerator,
    soundGenPreview,
    runSoundGenerate,
    soundCueCard,
    openCueMidi,
    renderCueInstruments,
    playCuePart,
    uploadCueMidiPart,
    sndPlay,
    renderSoundSheet,
    generateCueAudio,
    addSoundCue,
    deleteSoundCue,
    loadMusic,
    generateScoreFor,
    saveAmbientDirection,
    saveScoreDirection,
    saveSceneDelivery,
    generateAmbientFor,
    generateAllMusic,
};
