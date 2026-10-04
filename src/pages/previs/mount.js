/*
 * What the legacy stage3d chunk bound when it loaded: the scrub and camera gestures, the keyboard walk and the plan's
 * keys, the resize repaint, and window.roomScanDone (the iPhone app calls it when a RoomPlan scan finishes). The
 * Previs page binds them on mount (tools/make-react-page.js "mount") and unbinds them on unmount. GENERATED from the
 * chunk's load-time statements; every handler is the source's, verbatim but for the bridge rewrite (core values read
 * as legacy.X), and src/pages/previs/mount.test.jsx holds each one to the reference.
 */
import { legacy } from '../../lib/legacy.js';
import { CAMGESTURE, MESHLOOK, OPERATE_SCRUB, SCRUB, SETEDIT, SPLAT, STAGE, setBuildOpen, setEditRemove, setEditTurn, stageDeleteKey, stageHasPath, stageRenderBar, stageSave, stageSubjects, worldConsoleRender, worldDrawPath, worldFitFrame, worldGestureView, worldMeshRenderOnce, worldOperateApply, worldOperateValue, worldPaintFrame, worldViewMode, worldWalkEnsure, worldWalkKeep, worldWalkKey, worldWalkStep, worldWalkTurn } from './engine.js';

const live = (name) => new Proxy({}, {
    get: (_, k) => legacy[name][k],
    set: (_, k, v) => { legacy[name][k] = v; return true; },
    has: (_, k) => k in legacy[name],
});
const { state } = Object.fromEntries(['state'].map(n => [n, live(n)]));
const { setStatus } = Object.fromEntries(['setStatus'].map(n => [n, (...a) => legacy[n](...a)]));

export default function bindOnMount() {
    const off = [];
    const h0 = e => {
        const el = e.target && e.target.closest && e.target.closest('.we-scrub');
        if (!el || state.currentPage !== 'previs') return;
        const a = OPERATE_SCRUB.find(x => x.id === el.dataset.scrub);
        if (!a) return;
        SCRUB.drag = { a, el, x: e.clientX, moved: false };
        document.body.style.cursor = 'ew-resize';
        e.preventDefault();
    };
    document.addEventListener("pointerdown", h0);
    off.push(() => document.removeEventListener("pointerdown", h0));
    const h1 = e => {
        const g = SCRUB.drag;
        if (!g) return;
        const dx = e.clientX - g.x;
        if (!dx) return;
        g.x = e.clientX;
        const rate = g.a.rate * (e.shiftKey ? 0.2 : e.altKey ? 5 : 1);
        worldOperateApply(g.a.id, dx * rate);
        g.moved = true;
        const v = worldOperateValue(g.a.id);
        document.querySelectorAll(`.we-scrub[data-scrub="${g.a.id}"]`).forEach(n => { n.textContent = v == null ? '—' : v.toFixed(g.a.fmt); });
    };
    window.addEventListener("pointermove", h1);
    off.push(() => window.removeEventListener("pointermove", h1));
    const h2 = () => {
        const g = SCRUB.drag;
        if (!g) return;
        SCRUB.drag = null;
        document.body.style.cursor = '';
        if (g.moved) worldWalkKeep();
    };
    window.addEventListener("pointerup", h2);
    off.push(() => window.removeEventListener("pointerup", h2));
    const h3 = e => {
        const el = e.target && e.target.closest && e.target.closest('.we-scrub');
        if (!el) return;
        const a = OPERATE_SCRUB.find(x => x.id === el.dataset.scrub);
        const cur = worldOperateValue(a.id);
        if (!a || cur == null) return;
        const input = document.createElement('input');
        input.type = 'number'; input.step = 'any'; input.value = cur.toFixed(a.fmt); input.className = 'we-scrub-in';
        el.replaceWith(input); input.focus(); input.select();
        let done = false;
        const commit = ok => {
            if (done) return; done = true;
            const v = Number(input.value);
            if (ok && Number.isFinite(v) && v !== cur) { worldOperateApply(a.id, v - cur); worldWalkKeep(); }
            else worldConsoleRender();
        };
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter') commit(true); if (ev.key === 'Escape') commit(false); });
        input.addEventListener('blur', () => commit(true));
    };
    document.addEventListener("dblclick", h3);
    off.push(() => document.removeEventListener("dblclick", h3));
    const h4 = () => {
        if (state.currentPage === 'previs' && document.getElementById('pvView')) {
            worldFitFrame(); worldPaintFrame(); worldDrawPath();
            // The 3D views sized themselves when they opened; a fold or a
            // window resize must resize them too, or they draw at the old size.
            const frame = document.getElementById('weFrame');
            const box = frame && frame.getBoundingClientRect();
            if (box && box.width > 2) {
                for (const v of [MESHLOOK, SPLAT]) {
                    if (!v.renderer || !v.camera) continue;
                    v.renderer.setSize(Math.round(box.width), Math.round(box.height), false);
                    v.camera.aspect = box.width / Math.max(1, box.height);
                    v.camera.updateProjectionMatrix();
                }
                if (MESHLOOK.renderer) worldMeshRenderOnce();
            }
        }
    };
    window.addEventListener("resize", h4);
    off.push(() => window.removeEventListener("resize", h4));
    const h5 = e => {
        if (!worldGestureView(e.target)) return;
        e.preventDefault();
        worldWalkEnsure();
        const m = (e.shiftKey ? 1.0 : 0.25) * Math.max(-3, Math.min(3, -e.deltaY / 100));
        worldWalkStep(m, 0, 0);
    };
    document.addEventListener("wheel", h5);
    off.push(() => document.removeEventListener("wheel", h5));
    const h6 = e => {
        if (!worldGestureView(e.target)) return;
        CAMGESTURE.drag = { x: e.clientX, y: e.clientY, slide: e.button === 2 || e.shiftKey };
        e.preventDefault();
    };
    document.addEventListener("pointerdown", h6);
    off.push(() => document.removeEventListener("pointerdown", h6));
    const h7 = e => { if (worldGestureView(e.target)) e.preventDefault(); };
    document.addEventListener("contextmenu", h7);
    off.push(() => document.removeEventListener("contextmenu", h7));
    const h8 = e => {
        const g = CAMGESTURE.drag;
        if (!g) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!dx && !dy) return;
        g.x = e.clientX; g.y = e.clientY;
        worldWalkEnsure();
        if (g.slide) worldWalkStep(0, -dx * 0.01, dy * 0.01);
        else worldWalkTurn(-dx * 0.2, -dy * 0.15);
    };
    window.addEventListener("pointermove", h8);
    off.push(() => window.removeEventListener("pointermove", h8));
    const h9 = () => { CAMGESTURE.drag = null; };
    window.addEventListener("pointerup", h9);
    off.push(() => window.removeEventListener("pointerup", h9));
    const h10 = worldWalkKey;
    document.addEventListener("keydown", h10);
    off.push(() => document.removeEventListener("keydown", h10));
    const h11 = e => {
        if (state.currentPage !== 'previs' || worldViewMode() !== 'plan') return;
        if (SETEDIT.on) {
            const t = e.target && e.target.tagName;
            if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || SETEDIT.sel == null) return;
            if (e.key === 'Delete' || e.key === 'Backspace') { setEditRemove(); e.preventDefault(); }
            else if (e.key === 'q' || e.key === 'e') setEditTurn((e.shiftKey ? 45 : 15) * (e.key === 'q' ? 1 : -1));
            return;
        }
        if (STAGE.sel == null) return;
        const t = e.target && e.target.tagName;
        if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
        const subs = stageSubjects();
        const su = subs[STAGE.sel];
        if (!su) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && STAGE.keySel != null && stageHasPath(su)) {
            e.preventDefault(); return stageDeleteKey();
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            subs.splice(STAGE.sel, 1); STAGE.sel = null; STAGE.keySel = null; STAGE.pending = null; e.preventDefault(); stageSave();
        } else if (e.key === 'q' || e.key === 'e') {
            const step = (e.shiftKey ? 45 : 15) * (e.key === 'q' ? 1 : -1);
            su.rotationDeg = [0, ((su.rotationDeg || [])[1] || 0) + step, 0]; stageSave();
        } else return;
        stageRenderBar(); worldPaintFrame();
    };
    document.addEventListener("keydown", h11);
    off.push(() => document.removeEventListener("keydown", h11));
    const h12 = function (json) {
        let r = {};
        try { r = JSON.parse(json); } catch (_) { r = {}; }
        if (r.cancelled) return setStatus('Scan cancelled');
        if (!r.ok) return setStatus('Scan not built: ' + (r.error || 'unknown error'), true);
        let built = {};
        try { built = JSON.parse(r.response || '{}'); } catch (_) { built = {}; }
        const rep = built.report || {};
        setStatus(`Scanned ${r.rooms} room${r.rooms === 1 ? '' : 's'}: ${rep.walls || 0} walls, ${rep.openings || 0} doors and windows, `
            + `${rep.objects || 0} pieces of furniture${rep.stories && rep.stories.length > 1 ? `, ${rep.stories.length} storeys` : ''}. `
            + 'It is the location\'s new world version: pin a shot to it to walk it.');
        if (document.getElementById('setBuildModal') && document.getElementById('setBuildModal').classList.contains('open')) setBuildOpen();
    };
    window.roomScanDone = h12;
    off.push(() => { if (window.roomScanDone === h12) delete window.roomScanDone; });
    return () => { for (const f of off.reverse()) f(); };
}
