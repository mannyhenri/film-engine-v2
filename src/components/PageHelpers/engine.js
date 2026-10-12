/*
 * Page helpers, shared. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. A value made safe for an inline handler attribute (jsAttr), and a legacy form's fields read and cleared by data-field (getModalData, clearModal). Shared by the sheets, the media and folder components, Music, Previs, the Production graph and CoreDialogs; PageHelpers (boot-mounted, no dialogs) puts every name here on window.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { legacy } from '../../lib/legacy.js';

// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:
// a line reading `const esc = …` would be the first definition a backend test finds when it searches the page.
const {
    API,
} = Object.fromEntries([
    'API',
].map(n => [n, (...a) => legacy[n](...a)]));

    function getModalData(modalId) {
        const modal = document.getElementById(modalId);
        const data = {};
        modal.querySelectorAll('[data-field]').forEach(el => {
            const val = el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value.trim();
            if (val !== '' && val !== 0) data[el.dataset.field] = val;
        });
        return data;
    }

    function clearModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.querySelectorAll('[data-field]').forEach(el => {
            el.value = el.type === 'range' || el.type === 'number' ? (el.min || 0) : '';
        });
    }

    /**
     * A JS string literal safe inside a double-quoted HTML attribute.
     *
     * `JSON.stringify` emits DOUBLE quotes, which terminate onclick="…" — the
     * handler is cut off mid-argument and the browser silently keeps the
     * truncated prefix. Every source check still passes, because the text is
     * all present in the template; only the rendered attribute is broken.
     * That is the grep-versus-behaviour failure this codebase has paid for
     * more than once.
     */
    function jsAttr(value) {
        return "'" + String(value === undefined || value === null ? '' : value)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '&quot;')
            .replace(/\n/g, ' ') + "'";
    }

    // ══════════════════════════════════════════════════════════════
    // SSE STREAMING HELPER
    // ══════════════════════════════════════════════════════════════
    function streamSSE(path, onEvent, onDone, onError) {
        if (/\/(generate[^/]*|regenerate[^/]*|run|batch|angles|upscale|face-restore|composite|retexture|animate|rig)(?:\/|$)/.test(path)) {
            const error = new Error('Final review is unavailable for this streaming batch action. Nothing was sent to a provider.');
            if (typeof window.setStatus === 'function') window.setStatus(error.message);
            onError?.(error);
            return { close() {} };
        }
        const es = new EventSource(API() + path);
        es.onmessage = e => {
            const data = JSON.parse(e.data);
            if (data.done) { es.close(); onDone?.(data); }
            else onEvent(data);
        };
        es.onerror = () => { es.close(); onError?.(); };
        return es;
    }

export {
    getModalData,
    clearModal,
    jsAttr,
    streamSSE,
};
