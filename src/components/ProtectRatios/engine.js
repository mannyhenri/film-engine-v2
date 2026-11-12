/*
 * The protect-ratio engine, shared. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. The ratios a job ships (its deliverables), offered as the board's protect frame. Shared by Deliverables and the Storyboard; ProtectRatios (boot-mounted, no dialogs) puts every name here on window.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { legacy } from '../../lib/legacy.js';

// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:
// a line reading `const esc = …` would be the first definition a backend test finds when it searches the page.
const {
    esc,
} = Object.fromEntries([
    'esc',
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

    /*
     * ONE renderer for the protect frame, because there are now two surfaces
     * that draw it and a second copy is how the board and the playback come to
     * disagree about what a placement keeps.
     *
     * `frameRatio` is the PICTURE's ratio, never the container's. A board tile
     * is letterboxed inside its cell and the playback stage is the project's
     * shape while the clip may be a hair off it — measuring the container would
     * draw a guide that is right about the box and wrong about the shot.
     */
    function protectBoxFor(frameRatio, want) {
        let w = 100, h = 100;
        if (want < frameRatio) w = (want / frameRatio) * 100;   // narrower: side bars
        else h = (frameRatio / want) * 100;                     // taller: top and bottom
        return { w, h, left: (100 - w) / 2, top: (100 - h) / 2 };
    }

    function protectOverlayHTML(frameRatio, ratios) {
        const parsed = (ratios || [])
            .map(r => { const [w, h] = String(r).split(':').map(Number); return { r, v: w / h }; })
            .filter(x => Number.isFinite(x.v) && x.v > 0)
            .sort((a, b) => a.v - b.v);
        if (!parsed.length || !Number.isFinite(frameRatio) || frameRatio <= 0) return '';

        /*
         * The NARROWEST placement carries the mask, because it is the one that
         * decides whether the shot survives. Drawing a mask per ratio would
         * stack four translucent blacks and make the tightest crop the
         * brightest region on screen, which is exactly backwards.
         */
        const tight = protectBoxFor(frameRatio, parsed[0].v);
        let html = `<div style="position:absolute;left:${tight.left}%;top:${tight.top}%;`
            + `width:${tight.w}%;height:${tight.h}%;`
            + `box-shadow:0 0 0 9999px rgba(0,0,0,0.55);`
            + `outline:2px solid var(--gl-brand-pink,#ff4d8d);"></div>`;

        // Every other placement as an outline only — the frame it would take,
        // without a second opinion about brightness.
        for (const p of parsed.slice(1)) {
            const b = protectBoxFor(frameRatio, p.v);
            html += `<div style="position:absolute;left:${b.left}%;top:${b.top}%;`
                + `width:${b.w}%;height:${b.h}%;`
                + `outline:1px dashed rgba(255,255,255,0.8);"></div>`;
        }

        const label = parsed.map(p => `${esc(p.r)} ${Math.round(protectBoxFor(frameRatio, p.v).w)}%`)
            .join('  ·  ');
        html += `<div style="position:absolute;left:6px;bottom:6px;font-size:11px;font-weight:600;`
            + `color:#fff;text-shadow:0 1px 2px #000;white-space:nowrap;">`
            + `keeps ${label} of the width</div>`;
        return html;
    }

    /*
     * The ratios THIS JOB actually ships, read from the deliverable set.
     *
     * A hardcoded 9:16/4:5/1:1 list asks the director to remember which
     * placements the campaign bought. The deliverable rows already say, and
     * they are the same rows `needs_native_shots` is computed from — so the
     * guide on the board and the warning on the deliverables page are answering
     * from one source rather than two.
     *
     * Falls back to the standard three when nothing is planned yet, because a
     * spot with no deliverables is usually a spot nobody has scoped, not a spot
     * that ships one file.
     */
    function protectRatiosPlanned() {
        const rows = (state.deliverableRows || []);
        const seen = [];
        for (const d of rows) {
            const r = String(d.aspect_ratio || '').trim();
            if (r && !seen.includes(r)) seen.push(r);
        }
        return seen;
    }

    function protectOptionsHTML(selected) {
        const planned = protectRatiosPlanned();
        const opts = ['<option value="">off</option>'];
        if (planned.length) {
            opts.push(`<option value="all">all planned (${planned.length})</option>`);
            for (const r of planned) opts.push(`<option value="${esc(r)}">${esc(r)}</option>`);
        }
        for (const r of ['9:16', '4:5', '1:1', '16:9']) {
            if (!planned.includes(r)) opts.push(`<option value="${r}">${r}</option>`);
        }
        const html = opts.join('');
        return selected ? html.replace(`value="${selected}"`, `value="${selected}" selected`) : html;
    }

    /** Expand a select value into the list of ratios to draw. */
    function protectSelection(value) {
        if (!value) return [];
        if (value === 'all') return protectRatiosPlanned();
        return [value];
    }

    /** Keep the board's picker offering what the job actually ships. */
    function refreshProtectOptions() {
        for (const id of ['boardProtectRatio']) {
            const sel = document.getElementById(id);
            if (!sel) continue;
            const keep = sel.value;
            sel.innerHTML = protectOptionsHTML(keep);
            // A ratio that is no longer planned must not stay silently selected.
            if (sel.value !== keep) { sel.value = ''; }
        }
    }

export {
    protectBoxFor,
    protectOverlayHTML,
    protectRatiosPlanned,
    protectOptionsHTML,
    protectSelection,
    refreshProtectOptions,
};
