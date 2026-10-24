/*
 * The video pipeline. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. What the Production graph and Video Shots share of the legacy core: sequences (plan, preview, generate leg by leg or natively, stitch, delete), in-between strips (open, correct a station, approve), a shot's dialogue, and the upscale plan and its cost. MOVED verbatim (tools/extract-engine.js); a shared component (VideoPipeline.jsx) puts every export on window.
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
    esc,
    loadScenes,
    loadVideoShots,
    mediaUploadControl,
    setStatus,
    showModalHtml,
} = Object.fromEntries([
    'api',
    'confirmPaidImage',
    'esc',
    'loadScenes',
    'loadVideoShots',
    'mediaUploadControl',
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

    /** What the read is doing, while it does it. */
    /* ── the takes that ship ────────────────────────────────────────────── */

    /**
     * A shot's dialogue, and the whole film's.
     *
     * These routes have existed since phase 4 with no control on any page —
     * generation reachable only from curl or an agent. Unlike an audition,
     * THIS one registers against the shot and is what lip-sync and the mix
     * consume, so the confirmation says which it is.
     */
    /** The take the film uses. Through the one gate, like everything that spends. */
    async function generateVoiceForShot(shotId, shotCode) {
        return confirmPaidImage({
            title: `Generate the dialogue for ${shotCode || 'this shot'}`,
            capability: 'voice',
            previewUrl: `/shots/${shotId}/voice/preview`,
            note: 'Unlike an audition this is registered against the shot — it is the take that '
                + 'lip-sync and the mix will use.',
            send: async choices => {
                setStatus('Generating dialogue…', true);
                try {
                    await api(`/shots/${shotId}/voice/generate`, {
                        method: 'POST', body: JSON.stringify(choices || {}),
                    });
                    setStatus('Dialogue generated.');
                    if (typeof loadScenes === 'function') loadScenes();
                } catch (err) { setStatus('Could not generate: ' + err.message); }
            },
        });
    }

    async function loadSequences() {
        const host = document.getElementById('sequenceList');
        if (!host || !state.currentProject) return;
        let data;
        try { data = await api(`/projects/${state.currentProject.id}/sequences`); }
        catch (err) { host.innerHTML = `<p class="text-sm text-muted">Could not read sequences: ${esc(err.message)}</p>`; return; }

        const seqs = data.sequences || [];
        if (!seqs.length) { host.innerHTML = '<p class="text-sm text-muted">No sequences yet.</p>'; return; }

        host.innerHTML = seqs.map(q => {
            const codes = (q.shots || []).map(s => esc(s.shot_code || '')).join(' &rarr; ');
            const unframed = (q.shots || []).filter(s => !s.has_keyframe).map(s => s.shot_code);
            return `<div class="card" style="margin-bottom:10px;">
                <div class="flex-between">
                    <div>
                        <strong>${esc(q.name || 'Untitled sequence')}</strong>
                        <div class="text-sm text-muted" style="margin-top:2px;">${codes || 'no shots'}</div>
                    </div>
                    <span class="tag">${esc(q.status || 'draft')}</span>
                </div>
                ${q.description ? `<p class="text-sm" style="margin:8px 0 0;line-height:1.5;">${esc(q.description)}</p>` : ''}
                ${unframed.length ? `<p class="text-sm" style="margin:8px 0 0;color:var(--gl-warning,#f59e0b);">
                    ${esc(unframed.join(', '))} ${unframed.length === 1 ? 'has' : 'have'} no keyframe — generate ${unframed.length === 1 ? 'it' : 'them'} before this can run.</p>` : ''}
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                    <button class="btn btn-secondary btn-sm" onclick="previewSequence('${q.id}')"
                            title="See exactly what would be sent, and how many generations it costs — free">Preview &amp; cost</button>
                    <button class="btn btn-secondary btn-sm" onclick="stripSequence('${q.id}', this)"
                            title="A station a second instead of one picture per shot — planned for free before anything is bought">In-between strip</button>
                    <button class="btn btn-secondary btn-sm" onclick="openStrip('${q.id}')"
                            title="Read the strip station by station, and correct one — free">Stations</button>
                    <button class="btn btn-primary btn-sm" onclick="generateSequence('${q.id}', this)">Generate</button>
                    <button class="btn btn-secondary btn-sm" onclick="generateNextSequenceLeg('${q.id}', this)"
                            title="Buy only the next segment, review it, then continue">Generate next leg</button>
                    ${mediaUploadControl('video', 'video', 'sequence', q.id,
                        { after: 'loadSequences', label: 'Upload a clip',
                          title: 'Already made this in Higgsfield or elsewhere? Put it here instead of generating' })}
                    <button class="btn btn-secondary btn-sm" onclick="stitchSequence('${q.id}', this)"
                            title="Join this sequence's clips into one file — free, nothing is generated">Join into one file</button>
                    <button class="btn btn-secondary btn-sm" onclick="deleteSequence('${q.id}')">Delete</button>
                </div>
            </div>`;
        }).join('');
    }

    /**
     * The strip: a station a second, planned FREE before anything is bought.
     *
     * A shot reaches a video model as one picture and a sentence, so on a
     * five-second push-in the seconds between the ends are the model's
     * invention. This shows what the strip would be — how many stations per
     * shot, what each one is asked to change, and what it costs — and only then
     * offers to buy it. The free read leads for the same reason it leads on
     * every other paid control here: the check that matters is the one you
     * cannot skip by accident.
     *
     * Correcting a single station is deliberately not on this card. It is one
     * station of one shot and belongs beside that frame, not in a list of
     * sequences; it is reachable today through `sequence_station_update` and
     * `PUT /sequences/:id/stations/:shot/:index`. Named rather than dropped.
     */
    /** Paid: confirmed through the one gate, priced by the free plan. */
    /**
     * Generate the in-between strip: the stations between the approved frames.
     *
     * Through the one gate, priced by the FREE plan -- and the plan is read
     * with `expand=inbetweens`, or it prices the segments rather than the
     * strip, which is a different and much smaller number.
     */
    async function stripSequence(id) {
        return confirmPaidImage({
            title: 'Generate the in-between strip',
            capability: 'video',
            previewUrl: '/sequences/' + id + '/plan?expand=inbetweens',
            note: 'Each station is refined from the one before it, so the walk is serial and a '
                + 'refusal stops it.',
            editable: false,
            notEditableWhy: 'Each station has its own one-sentence instruction, shown as it runs.',
            send: async choices => {
                setStatus('Walking the strip...', true);
                try {
                    const out = await api(`/sequences/${id}/inbetweens`, { method: 'POST', body: JSON.stringify(choices || {}) });
                    /*
                     * A partial strip reported as a success is how a sequence
                     * gets joined through moments nobody has seen -- so what was
                     * NOT attempted is named rather than counted.
                     */
                    if (out.stopped_at != null) {
                        const na = (out.not_attempted || []).join(', ');
                        setStatus(`Stopped at station ${out.stopped_at}: ${out.error || 'refused'}`
                            + (na ? ` — not attempted: ${na}` : ''));
                    } else {
                        setStatus(`${(out.generated || []).length} station(s) generated.`);
                    }
                    if (typeof loadSequences === 'function') loadSequences();
                } catch (err) { setStatus('Could not generate: ' + err.message); }
            },
        });
    }

    /**
     * The strip, station by station — and correcting one.
     *
     * `PUT /film/sequences/:id/stations/:shot/:index` has existed since the
     * strip shipped and had no control, so a wrong in-between could only be
     * corrected from an agent. It is deliberately not on the sequence card: it
     * is one station of one shot, and it belongs beside that station.
     *
     * Correcting station 2 of 5 RE-RUNS 2, 3 and 4, because a chain re-inherits
     * from the frame that changed. That is stated in the confirmation rather
     * than discovered on the bill.
     */
    async function openStrip(id) {
        let data;
        try { data = await api(`/sequences/${id}/stations?cadence_s=1`); }
        catch (err) { return alert('Could not read the strip: ' + err.message); }

        const ap = data.approval || {};
        const badge = !ap.approved ? '<span class="tag">not signed off</span>'
            : ap.stale ? '<span class="tag" style="border-color:var(--gl-warning,#f59e0b);color:var(--gl-warning,#f59e0b);">approved · changed since</span>'
            : '<span class="tag" style="border-color:var(--gl-success);color:var(--gl-success);">approved</span>';

        const strips = (data.strips || []).map(st => `
            <h4 style="margin:12px 0 6px;">${esc(st.shot_code || st.shot_id)}
                <span class="text-sm text-muted">${st.count} station${st.count === 1 ? '' : 's'}</span>
                ${st.reason ? `<span class="text-sm text-muted"> — ${esc(st.reason)}</span>` : ''}
                ${st.thinned ? `<span class="tag">thinned from ${st.wanted}</span>` : ''}</h4>
            ${st.stations.map(station => `
                <div class="card" style="margin-bottom:6px;">
                    <div class="flex-between" style="gap:8px;flex-wrap:wrap;min-width:0;">
                        <div style="min-width:0;">
                            <div class="text-sm text-muted">
                                station ${station.index} &middot; ${(station.at_ms / 1000).toFixed(1)}s
                                ${station.approved_keyframe ? '&middot; the frame you approved'
                                  : station.generated ? '&middot; generated' : '&middot; not generated yet'}
                            </div>
                            <div>${esc(station.instruction || '—')}</div>
                        </div>
                        ${station.approved_keyframe ? '' : `
                        <div class="card-actions">
                            <button class="btn btn-secondary btn-sm"
                                    onclick="correctStation('${id}', '${st.shot_id}', ${station.index}, ${st.count})">Correct</button>
                        </div>`}
                    </div>
                </div>`).join('')}`).join('');

        showModalHtml('stripModal', `
            <div class="modal-header">
                <h3>Strip &mdash; ${esc(data.sequence_id ? '' : '')}stations ${badge}</h3>
                <button class="modal-close" onclick="closeModal('stripModal')">&times;</button>
            </div>
            <div class="modal-body">
                <p class="text-sm text-muted" style="margin-top:0;">
                    Station 0 of each shot is the frame you already approved and is never
                    regenerated. Every station after it is refined from the one before, which is
                    what stops the strip drifting apart &mdash; and is why correcting one re-runs
                    the ones after it.</p>
                ${strips || '<p class="text-sm text-muted">This sequence has no strip.</p>'}
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('stripModal')">Close</button>
                <button class="btn btn-primary" onclick="approveStrip('${id}')">Sign the strip off</button>
            </div>`);
    }

    async function correctStation(id, shotId, index, count) {
        const after = Math.max(0, (count - 1) - index);
        const instruction = prompt(
            `What should station ${index} do differently?\n\n`
            + `This re-runs station ${index}`
            + (after ? ` and the ${after} after it` : '')
            + ' — a chain re-inherits from the frame that changed, so leaving them would leave a '
            + 'strip whose second half descends from a picture that no longer exists.');
        if (instruction === null) return;
        if (!instruction.trim()) return setStatus('An empty instruction would change nothing');
        try {
            const out = await api(`/sequences/${id}/stations/${shotId}/${index}`,
                { method: 'PUT', body: JSON.stringify({ instruction: instruction.trim() }) });
            const made = (out.generated || []).length;
            let msg = `${made} station${made === 1 ? '' : 's'} regenerated.`;
            if (out.stopped_at != null) {
                msg += `\n\nStopped at station ${out.stopped_at}: ${out.error || 'the provider refused'}.`;
                if (out.not_attempted && out.not_attempted.length) msg += `\nNot attempted: ${out.not_attempted.join(', ')}.`;
            }
            alert(msg);
            openStrip(id);
        } catch (err) { alert('Could not correct that station: ' + err.message); }
    }

    async function approveStrip(id) {
        if (!confirm('Sign this strip off?\n\nVideo generation then refuses a strip that has changed '
            + 'since — which is what makes an approval worth having.')) return;
        try {
            const ok = await api(`/sequences/${id}/inbetweens/approve`, { method: 'POST', body: '{}' });
            alert(`Approved — ${ok.stations} stations.`);
            openStrip(id);
        } catch (err) { alert('Could not approve: ' + err.message); }
    }

    /**
     * What it would send, and what it would cost. Free, and it leads.
     *
     * This is the one control on the page that can spend several generations in
     * a press, and a confirmation that cannot name what it is about to buy is a
     * confirmation people learn to click past.
     */
    async function previewSequence(id) {
        try {
            const plan = await api(`/sequences/${id}/plan`);
            if (plan.refused) return alert('This sequence cannot run yet.\n\n' + plan.reason);
            const lines = (plan.segments || []).map((s, i) =>
                `${i + 1}. ${s.from} → ${s.to}  · ${s.duration_s}s · ${s.estimated_credits || '?'} credits · ${s.keyframes} frame${s.keyframes === 1 ? '' : 's'}\n   ${s.prompt}`);
            const total = (plan.segments || []).reduce((n, s) => n + (Number(s.estimated_credits) || 0), 0);
            const native = plan.native_multi_shot && plan.native_multi_shot.available
                ? `\n\nNative multi-shot cuts: ${plan.native_multi_shot.duration_s}s · ${plan.native_multi_shot.estimated_credits} credits (~$${Number(plan.native_multi_shot.estimated_usd).toFixed(2)}). This invents cuts from the shot descriptions; it is not endpoint interpolation.` : '';
            alert(`${plan.generations} generation${plan.generations === 1 ? '' : 's'} — ${total || '?'} credits total.\n`
                + (plan.degraded ? `\n${plan.degraded_reason}\n` : '')
                + (plan.needs_stitching ? '\nThis produces separate clips; join them in the timeline or your NLE.\n' : '')
                + '\n' + lines.join('\n\n') + native);
        } catch (err) { alert('Could not read the plan: ' + err.message); }
    }

    /** Paid: confirmed through the one gate, priced by the free plan. */
    async function generateNextSequenceLeg(id) {
        return confirmPaidImage({
            title: 'Generate the next leg',
            capability: 'video',
            previewUrl: '/sequences/' + id + '/plan',
            note: 'One segment at a time, so an unfinished sequence can be bought a leg at a time.',
            editable: false,
            notEditableWhy: 'Each segment is built from its own shots; edit those on the board.',
            send: async choices => {
                setStatus('Generating...', true);
                try {
                    await api('/sequences/' + id + '/generate', {
                        method: 'POST', body: JSON.stringify(choices || {}),
                    });
                    setStatus('Done.');
                    if (typeof loadSequences === 'function') loadSequences();
                } catch (err) { setStatus('Could not generate: ' + err.message); }
            },
        });
    }

    /** Paid: confirmed through the one gate, priced by the free plan. */
    async function generateNativeMultiShot(id) {
        return confirmPaidImage({
            title: 'Generate as one native multi-shot',
            capability: 'video',
            previewUrl: '/sequences/' + id + '/plan',
            note: 'The gateway\'s multi-shot recipe: real editorial cuts in one generation, and deliberately less deterministic than rendering each shot.',
            editable: false,
            notEditableWhy: 'Each segment is built from its own shots; edit those on the board.',
            send: async choices => {
                setStatus('Generating...', true);
                try {
                    await api('/sequences/' + id + '/generate-native', {
                        method: 'POST', body: JSON.stringify(choices || {}),
                    });
                    setStatus('Done.');
                    if (typeof loadSequences === 'function') loadSequences();
                } catch (err) { setStatus('Could not generate: ' + err.message); }
            },
        });
    }

    /** Paid: confirmed through the one gate, priced by the free plan. */
    async function generateSequence(id) {
        return confirmPaidImage({
            title: 'Generate this sequence',
            capability: 'video',
            previewUrl: '/sequences/' + id + '/plan',
            note: 'Each segment travels between two frames you have already approved.',
            editable: false,
            notEditableWhy: 'Each segment is built from its own shots; edit those on the board.',
            send: async choices => {
                setStatus('Generating...', true);
                try {
                    await api('/sequences/' + id + '/generate', {
                        method: 'POST', body: JSON.stringify(choices || {}),
                    });
                    setStatus('Done.');
                    if (typeof loadSequences === 'function') loadSequences();
                } catch (err) { setStatus('Could not generate: ' + err.message); }
            },
        });
    }

    /**
     * Join the clips into one file.
     *
     * Free and says so, because every other button on this card spends money
     * and a director should not have to guess which. It re-encodes footage
     * already paid for; no provider is called.
     */
    async function stitchSequence(id, btn) {
        const label = btn && btn.textContent;
        if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }
        setStatus('Joining the clips into one file…', true);
        try {
            const res = await api(`/sequences/${id}/stitch`, { method: 'POST', body: JSON.stringify({}) });
            setStatus(`One file: ${res.file_name} (${(res.bytes / 1048576).toFixed(1)}MB, ${res.clips} clips joined).`);
            loadSequences();
            if (typeof loadVideoShots === 'function') loadVideoShots();
        } catch (err) {
            /*
             * The refusals are the useful part and each has its own remedy, so
             * they are surfaced verbatim rather than flattened: nothing
             * generated yet, some segments missing (named), or no encoder.
             */
            setStatus('Could not join: ' + err.message);
            alert('Could not join this sequence into one file.\n\n' + err.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = label || 'Join into one file'; }
        }
    }

    async function deleteSequence(id) {
        if (!confirm('Delete this sequence?\n\nAny clips it already generated are kept on their shots — '
            + 'only the plan is removed.')) return;
        try {
            await api(`/sequences/${id}`, { method: 'DELETE' });
            setStatus('Sequence deleted. Its clips were kept.');
            loadSequences();
        } catch (err) { setStatus('Could not delete: ' + err.message); }
    }

    /*
     * THE UPSCALE CONFIRMATION, shared by the Video Shots button and the
     * production canvas. The free preview measures the clip and sizes the
     * upscale to the delivery; the upscaler is chosen here, each with its
     * price, and the one sent is the one selected.
     */
    const UPSCALE_DEFAULT_MODEL = 'topaz-video-upscale';

    function upscalePlanHtml(d) {
        const secs = Number((d.source || {}).seconds) || 0;
        const chosen = d.model || UPSCALE_DEFAULT_MODEL;
        // Grouped by who does the work: MuAPI's resold upscalers and Topaz's own
        // Starlight/Astra/Proteus. Each is priced FOR THIS CLIP by the server; a
        // Topaz model with no key is shown, disabled, with the reason.
        const opt = u => {
            const usd = u.estimated_usd != null ? u.estimated_usd : (secs ? u.usd_per_second * secs : null);
            const price = usd != null ? ` · about $${Number(usd).toFixed(2)}` : (u.usd_per_second != null ? ` · $${Number(u.usd_per_second).toFixed(2)}/s` : '');
            return `<option value="${esc(u.id)}" data-usd="${usd != null ? usd : ''}" data-note="${esc(u.note || '')}"
                ${u.configured === false ? 'disabled' : ''} ${u.id === chosen ? 'selected' : ''}>${esc(u.label)}${price}${u.configured === false ? ' (no key)' : ''}</option>`;
        };
        const ups = d.upscalers || [];
        const group = (prov, label) => {
            const rows = ups.filter(u => (u.provider || 'muapi') === prov);
            return rows.length ? `<optgroup label="${esc(label)}">${rows.map(opt).join('')}</optgroup>` : '';
        };
        const missingKeys = ['topaz', 'magnific'].filter(pv => ups.some(u => u.provider === pv && u.configured === false));
        return `<div class="text-sm" style="line-height:1.6;">
            <div><strong>${esc(d.shot_code || '')}</strong> &middot; ${esc((d.source || {}).file_name || '')}
              &middot; measured ${esc((d.source || {}).measured || 'unmeasured')}${secs ? ` &middot; ${secs.toFixed(1)}s` : ''}</div>
            <div>Delivery ${esc(d.target || '')}${d.reaches ? ` &middot; this reaches ${esc(String(d.reaches))}` : ''}</div>
            <div class="form-group" style="margin-top:8px;"><label>Upscaler</label>
              <select id="upscaleModel" onchange="upscaleCostLine(${secs})">${group('muapi', 'MuAPI')}${group('topaz', 'Topaz Labs')}${group('magnific', 'Magnific')}</select></div>
            <div id="upscaleCost">${secs ? '' : esc(d.estimate_unknown_why || '')}</div>
            <div id="upscaleNote" class="text-muted"></div>
            ${missingKeys.length ? `<div class="text-muted">${missingKeys.map(k => k === 'topaz' ? 'Topaz' : 'Magnific').join(' and ')} upscalers need an API key: Setup, AI providers.</div>` : ''}
            <div class="text-muted">MuAPI lists its prices without a unit, so they are read per second of the clip, which errs high. Topaz prices come from its own credit table at the size this clip reaches; Magnific publishes no per-frame rate, so its prices are Runway's resale figures. The result becomes this shot's selected clip; the original is kept.</div>
            ${(d.warnings || []).map(w => `<div style="color:var(--warning,#b8860b);">${esc(w)}</div>`).join('')}
          </div>`;
    }

    function upscaleCostLine(secs) {
        const sel = document.getElementById('upscaleModel');
        const box = document.getElementById('upscaleCost');
        const note = document.getElementById('upscaleNote');
        if (!sel || !sel.selectedOptions[0]) return;
        const o = sel.selectedOptions[0];
        if (note) note.textContent = o.dataset.note || '';
        if (!box) return;
        const usd = Number(o.dataset.usd);
        box.innerHTML = o.dataset.usd !== '' && Number.isFinite(usd)
            ? `About <strong>$${usd.toFixed(2)}</strong>${secs ? ` for ${secs.toFixed(1)}s` : ''}`
            : '';
    }

    function confirmUpscale(shotId, assetId, send) {
        const q = `?model=${encodeURIComponent(UPSCALE_DEFAULT_MODEL)}${assetId ? '&asset_id=' + encodeURIComponent(assetId) : ''}`;
        return confirmPaidImage({
            capability: 'post',
            title: 'Upscale this clip',
            note: 'Costs credits on MuAPI, Topaz or Magnific, whichever upscaler you pick. The clip is enlarged to the project\'s delivery size; nothing is re-generated.',
            previewUrl: `/shots/${shotId}/post/upscale/preview${q}`,
            describe: d => { setTimeout(() => upscaleCostLine(Number((d.source || {}).seconds) || 0), 0); return upscalePlanHtml(d); },
            armable: d => d.can_generate !== false,
            send: async () => {
                const model = (document.getElementById('upscaleModel') || {}).value || UPSCALE_DEFAULT_MODEL;
                return send({ model, ...(assetId ? { asset_id: assetId } : {}) });
            },
        });
    }

export {
    generateVoiceForShot,
    loadSequences,
    stripSequence,
    openStrip,
    correctStation,
    approveStrip,
    previewSequence,
    generateNextSequenceLeg,
    generateNativeMultiShot,
    generateSequence,
    stitchSequence,
    deleteSequence,
    UPSCALE_DEFAULT_MODEL,
    upscalePlanHtml,
    upscaleCostLine,
    confirmUpscale,
};
