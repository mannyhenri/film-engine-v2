/*
 * The music engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. The Music & Sound page: the sound library and its cards, and
 * each scene's ambient bed and imported music. MOVED from the legacy music chunk (generated from film-engine's page).
 * React renders the page; this draws into it by id, as before. Music-making (Music Cues, the Score workstation, score
 * generation) was retired by the user (tools/split-lib.js RETIRED).
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
    esc,
    mediaUploadControl,
    setStatus,
    showModal,
} = Object.fromEntries([
    '_shotAction',
    'api',
    'closeModal',
    'confirmPaidImage',
    'esc',
    'mediaUploadControl',
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
// Core's values, read live as legacy.X and assigned with setLegacy: API_BASE.

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
            capability: kind,
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

    async function loadMusic() {
        // The file library and each scene's sound are two different questions;
        // both load when the page opens.
        loadSoundLibrary();
        if (!state.currentProject) return;
        setStatus('Loading sound...');
        const pid = state.currentProject.id;
        try {
            const [sceneData, jobData, provData, cueData] = await Promise.all([
                api('/projects/' + pid + '/scenes').catch(() => ({ scenes: [] })),
                api('/projects/' + pid + '/music/jobs').catch(() => ({ jobs: [] })),
                api('/projects/' + pid + '/providers').catch(() => ({ effective: {} })),
                api('/projects/' + pid + '/music-cues').catch(() => ({ music_cues: [] })),
            ]);
            // The ambient direction box acts on one cue, the scene's first ambient one, exactly as the route does.
            const ambientCues = {};
            (cueData.music_cues || []).forEach(c => {
                if (c.scene_id && c.cue_type === 'ambient' && !ambientCues[c.scene_id]) ambientCues[c.scene_id] = c;
            });
            window.__ambientCues = ambientCues;
            const scenes = sceneData.scenes || [];
            // Latest job per (scene, gen_type).
            const jobKey = {};
            (jobData.jobs || []).forEach(j => { const k = j.scene_id + ':' + j.gen_type; if (!jobKey[k]) jobKey[k] = j; });
            const assetsByScene = {};
            (jobData.assets || []).forEach(a => {
                if (!a.scene_id) return;
                (assetsByScene[a.scene_id] ||= {})[a.asset_type] ||= a;
            });
            const ambientProvider = (provData.effective && provData.effective.ambient) || 'gridlight';

            const grid = document.getElementById('musicGrid');
            const banner = `<div style="grid-column:1/-1;background:var(--gl-bg-surface);border:1px solid var(--gl-border-subtle);border-radius:8px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">
                <span class="text-sm text-muted">Ambient: <strong style="color:var(--gl-text-primary);">${esc(ambientProvider)}</strong></span>
                <a class="text-sm" style="cursor:pointer;color:var(--gl-accent,#818cf8);" onclick="navigateTo('settings')">Change in Settings →</a>
            </div>`;

            if (scenes.length === 0) {
                grid.innerHTML = banner + '<div class="empty-state" style="grid-column:1/-1;"><div class="icon">&#127925;</div><h3>No scenes</h3><p>Extract scenes from your screenplay first, then generate ambient audio or bring in music.</p></div>';
                setStatus('No scenes');
                return;
            }

            // The upload control is BUILT AT THE CALL SITE and passed in, so
            // each scene-scoped capability is named where it is used.
            // Music is brought in, never generated: its row has no Generate button.
            const audioRow = (label, sc, kind, upload) => {
                const job = jobKey[sc.id + ':' + kind];
                const assetType = kind === 'music' ? 'audio_music' : 'audio_ambient';
                const asset = (assetsByScene[sc.id] || {})[assetType];
                const done = !!asset || (job && job.status === 'complete');
                const failed = job && job.status === 'failed';
                const url = asset && asset.url
                    ? legacy.API_BASE + asset.url
                    : legacy.API_BASE + '/film/music/' + pid + '/' + encodeURIComponent(sc.scene_number) + '_' + kind + '.wav';
                const badge = done ? '<span class="tag" style="background:var(--gl-success,#166534);">ready</span>'
                    : failed ? '<span class="tag" style="background:var(--gl-danger,#7f1d1d);">failed</span>'
                    : (job && job.status === 'generating') ? '<span class="tag">generating</span>' : '';
                const gen = kind === 'ambient'
                    ? `<button class="btn btn-secondary btn-sm" onclick="generateAmbientFor('${sc.id}', this)">${done ? 'Regen' : 'Generate'}</button>` : '';
                return `<div style="margin-top:8px;">
                    <div class="flex-between"><span class="text-sm">${label} ${badge}</span>
                        <span style="display:flex;gap:6px;">
                            ${gen}
                            ${upload}
                        </span></div>
                    ${done && asset ? '<audio src="' + url + '" controls preload="none" style="width:100%;margin-top:6px;" onerror="this.style.display=\'none\'"></audio>' : ''}
                </div>`;
            };

            grid.innerHTML = banner + scenes.map(sc => `
                <!--
                  A scene's sound spans every track of the grid: a row of two
                  rows and three directions needs the page's width.
                -->
                <div class="entity-card" style="grid-column:1/-1;">
                    <div class="flex-between">
                        <strong style="font-size:13px;">Scene ${esc(String(sc.scene_number))}</strong>
                        <span class="text-sm text-muted">${esc(sc.location || '')}${sc.time_of_day ? ' &middot; ' + esc(sc.time_of_day) : ''}</span>
                    </div>
                    ${audioRow('Ambient (scene)', sc, 'ambient',
                        mediaUploadControl('ambient', 'audio', 'scene', sc.id, { after: 'loadMusic', label: 'Upload' }))}
                    ${audioRow('Music (scene)', sc, 'music',
                        mediaUploadControl('music', 'audio', 'scene', sc.id, { after: 'loadMusic', label: 'Upload' }))}
                    <!--
                      The bed was assembled from a lookup table on the location
                      NAME and the time of day, and a director had no way to say
                      a word about it. Saved as an ambient cue on this scene, so
                      it is durable and reaches the button.
                    -->
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

            const bedCount = scenes.filter(sc => assetsByScene[sc.id] && assetsByScene[sc.id].audio_ambient).length;
            setStatus(scenes.length + ' scene(s), ' + bedCount + ' with an ambient bed');
            // Peaks arrive AFTER the cards do, never before.
            paintWaveforms(grid);
        } catch (err) { setStatus('Error: ' + err.message); }
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

export {
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
    sndPlay,
    loadMusic,
    saveAmbientDirection,
    saveSceneDelivery,
    generateAmbientFor,
};
