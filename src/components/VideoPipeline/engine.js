/*
 * The video pipeline. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. What the Production graph reaches of the legacy core's video pipeline: generating a sequence (leg by leg or natively) and stitching it, a shot's dialogue, and the upscale plan and its cost. MOVED verbatim (tools/extract-engine.js); a shared component (VideoPipeline.jsx) puts every export on window.
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
    setStatus,
} = Object.fromEntries([
    'api',
    'confirmPaidImage',
    'esc',
    'loadScenes',
    'setStatus',
].map(n => [n, (...a) => legacy[n](...a)]));

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

    /*
     * THE UPSCALE CONFIRMATION, for the production canvas. The free preview measures the clip and sizes the
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
    generateNativeMultiShot,
    generateSequence,
    stitchSequence,
    UPSCALE_DEFAULT_MODEL,
    upscalePlanHtml,
    upscaleCostLine,
    confirmUpscale,
};
