/*
 * The Production graph engine: the canvas, its nodes and edges, the drawer, the queue strip, the menus, the add
 * palette, in-betweens, playback under the graph. MOVED VERBATIM from public/legacy/production-graph.js (generated
 * from film-engine's page): same names, same bodies. React renders the page (ProductionGraphPage.jsx) and the page's
 * shell; this draws the graph into it by id, as before.
 *
 * Kept verbatim on purpose: eleven backend test files read and execute these functions from the page source, so
 * the text they check is the code that runs. Do not reformat it; change it as code, with its tests.
 *
 * What stays in core (public/legacy/production-graph.js): the feature flag and its boot (PRODUCTION_GRAPH_ON,
 * PG_OLD_PAGES, applyProductionFlag, saveProductionGraphFlag, the DOMContentLoaded listener), the side panel that
 * flag draws (pgRenderSide), and the graph's two state objects PG and IB, which inline handlers and the side panel
 * read as globals. The page registers every function here on window at mount (pages mount before the legacy
 * scripts run), so core and the HTML this engine draws call them by name, as they always did.
 *
 * The core names this code uses are reached through the bridge below, by the same names, so the bodies stay as
 * they were; tools/tests/engine-bridge.test.js holds that none is reached any other way.
 */
import { legacy } from '../../lib/legacy.js';

const api = (...a) => legacy.api(...a);
const closeModal = (...a) => legacy.closeModal(...a);
const confirmPaidImage = (...a) => legacy.confirmPaidImage(...a);
const confirmUpscale = (...a) => legacy.confirmUpscale(...a);
const esc = (...a) => legacy.esc(...a);
const generateNativeMultiShot = (...a) => legacy.generateNativeMultiShot(...a);
const generateSequence = (...a) => legacy.generateSequence(...a);
const jsAttr = (...a) => legacy.jsAttr(...a);
const markCurrentShot = (...a) => legacy.markCurrentShot(...a);
const mediaUploadControl = (...a) => legacy.mediaUploadControl(...a);
const mediaUrl = (...a) => legacy.mediaUrl(...a);
const navigateTo = (...a) => legacy.navigateTo(...a);
const pgRenderSide = (...a) => legacy.pgRenderSide(...a);
const regenerateStoryboard = (...a) => legacy.regenerateStoryboard(...a);
const setStatus = (...a) => legacy.setStatus(...a);
const showModal = (...a) => legacy.showModal(...a);
const showModalHtml = (...a) => legacy.showModalHtml(...a);
const toggleBoardLock = (...a) => legacy.toggleBoardLock(...a);
const uploadCapabilityMedia = (...a) => legacy.uploadCapabilityMedia(...a);
const uploadControl = (...a) => legacy.uploadControl(...a);
const uploadReferenceImage = (...a) => legacy.uploadReferenceImage(...a);
const live = (name) => new Proxy({}, {
    get: (_, k) => legacy[name][k],
    set: (_, k, v) => { legacy[name][k] = v; return true; },
    has: (_, k) => k in legacy[name],
    ownKeys: () => Reflect.ownKeys(legacy[name]),
    getOwnPropertyDescriptor: (_, k) => { const d = Reflect.getOwnPropertyDescriptor(legacy[name], k); if (d) d.configurable = true; return d; },
    deleteProperty: (_, k) => delete legacy[name][k],
});
const FLOW = live('FLOW');
const IB = live('IB');
const PG = live('PG');
const state = live('state');

// (PRODUCTION_GRAPH_ON: kept in core, public/legacy/production-graph.js)


// (PG_OLD_PAGES: kept in core, public/legacy/production-graph.js)

const PG_PORT_COLOR = { image: '#c07ce0', video: '#e2c15a', audio: '#57c98a', scene: '#8a8aff', plates: '#56c8d8' };
const PG_JOINS = [
    ['cut', 'Cut'], ['continuous', 'Continuous move'], ['dissolve', 'Dissolve'],
    ['match_cut', 'Match cut'], ['whip_pan', 'Whip pan'], ['morph', 'Morph'],
];
const PG_KIND = { sfx: { label: 'Sound effect', cue: 'sfx', gen: 'gen.sfx', cap: 'sfx' },
    ambient: { label: 'Room tone', cue: 'ambient', gen: 'gen.ambient', cap: 'ambient' },
    music: { label: 'Music', cue: 'score', gen: 'gen.music', cap: 'music' } };

// (PG: kept in core, public/legacy/production-graph.js)


// (applyProductionFlag: kept in core, public/legacy/production-graph.js)


// (saveProductionGraphFlag: kept in core, public/legacy/production-graph.js)


// ── Loading ───────────────────────────────────────────────────────────────

/** "1:05", or "1:02:05" past an hour, since a SQLite UTC timestamp. */
function pgElapsed(startedAt, now) {
    const t = Date.parse(String(startedAt || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(startedAt || '')) ? '' : 'Z'));
    if (!Number.isFinite(t)) return '';
    const sec = Math.max(0, Math.floor(((now || Date.now()) - t) / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
    const pad = v => String(v).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s2)}` : `${m}:${pad(s2)}`;
}

/**
 * What a running node shows (PGN-003). A real bar and "42%" only when the
 * provider sent a percentage; otherwise the moving bar, elapsed time and a
 * plain "no percentage from this provider" — an invented number is worse than
 * none. A click whose job row has not appeared yet shows the local label.
 */
function pgProgressHtml(live, busy, now) {
    if (!live && !busy) return '';
    if (!live) return `<div class="pg-progress"><div></div></div><div class="pg-badge run">${esc(busy)}</div>`;
    const elapsed = pgElapsed(live.started_at, now);
    const phase = live.phase || busy || 'running';
    const pct = live.percent === null || live.percent === undefined || !Number.isFinite(Number(live.percent))
        ? null : Math.max(0, Math.min(100, Math.round(Number(live.percent))));
    if (pct === null) {
        return `<div class="pg-progress"><div></div></div>
            <div class="pg-badge run" title="${esc(live.provider || '')} sends no percentage">${esc(phase)}${elapsed ? ' · ' + elapsed : ''}<span class="pg-note">no percentage from this provider</span></div>`;
    }
    return `<div class="pg-progress fixed"><div style="width:${pct}%"></div></div>
        <div class="pg-badge run" title="${esc(live.provider || '')}">${esc(phase)} · ${pct}%${elapsed ? ' · ' + elapsed : ''}</div>`;
}

/**
 * Keep the running list fresh while anything runs. The page's live channel
 * only fires on writes from ANOTHER connection, so progress from a generation
 * this page started would never arrive; this polls the free running list
 * instead, and stops itself when nothing is running.
 */
async function pgPollRunning() {
    clearTimeout(PG.pollTimer);
    PG.pollTimer = null;
    if (!state.currentProject || state.currentPage !== 'productiongraph') return;
    const pid = state.currentProject.id;
    let list = null;
    try {
        const r = await api('/projects/' + pid + '/production-graph/running');
        list = (r && r.running) || [];
    } catch (_) { list = null; }
    if (!state.currentProject || state.currentProject.id !== pid) return;
    if (list) pgSetRunning(list);
    pgLoadQueue();
    if (PG.running.size || PG.busy.size) PG.pollTimer = setTimeout(pgPollRunning, 1500);
}

/** New running list: re-render when WHICH nodes run changes, else repaint the slots in place. */
function pgSetRunning(list) {
    const next = new Map();
    for (const r of list || []) if (r && r.key) next.set(r.key, r);
    const same = next.size === PG.running.size && [...next.keys()].every(k => PG.running.has(k));
    PG.running = next;
    if (!same) return pgRender();
    document.querySelectorAll('#pgCanvas [data-run]').forEach(el => {
        const k = el.getAttribute('data-run');
        el.innerHTML = pgProgressHtml(PG.running.get(k), PG.busy.get(k));
    });
}

async function loadProductionGraph() {
    if (!state.currentProject) return;
    // One load at a time: the side panel and the page both ask, and two renders
    // racing is how a click lands on a node that was just replaced.
    if (PG.inflight) return PG.inflight;
    PG.inflight = pgLoad().finally(() => { PG.inflight = null; });
    return PG.inflight;
}

async function pgLoad() {
    pgInitCanvas();
    const pid = state.currentProject.id;
    try {
        const g = await api('/projects/' + pid + '/production-graph');
        if (!state.currentProject || state.currentProject.id !== pid) return;
        // Another film: nothing about the view carries over.
        if (PG.graph && PG.graph.project_id !== pid) {
            PG.sel = null; PG.fitted = false; PG.scene = 'all'; PG.timeline = null; PG.play.index = 0; PG.drawerCache = {};
        }
        PG.graph = g;
        PG.byKey = new Map(g.nodes.map(n => [n.key, n]));
        PG.running = new Map((g.running || []).filter(r => r && r.key).map(r => [r.key, r]));
        if (PG.sel && !PG.byKey.has(PG.sel)) PG.sel = null;
        pgRender();
        if (!PG.fitted) { pgFit(); PG.fitted = true; }
        pgRenderDrawer();
        pgRenderPlayback();
        pgRenderSide();
        if (PG.running.size || PG.busy.size) pgPollRunning();
        pgLoadQueue();
    } catch (err) {
        const c = document.getElementById('pgCanvas');
        if (c) c.querySelector('.pg-empty').textContent = 'Could not load the graph: ' + err.message;
    }
}

function pgNode(key) { return PG.byKey.get(key); }
/** A served path (/film/…) with the API's origin, the rule mediaUrl already states. */
function pgSrc(url) { return url ? mediaUrl(url) : ''; }
/** A thumbnail: through pgSrc (the API origin, not the page server), the width joined onto any query already there. */
function pgThumb(url, w) { if (!url) return ''; const u = pgSrc(url); return u + (u.includes('?') ? '&' : '?') + 'w=' + (w || 96); }
function pgShots() { return (PG.graph ? PG.graph.nodes : []).filter(n => n.type === 'shot'); }
function pgSecs(ms) { return ms ? (Math.round(ms / 100) / 10) + 's' : '—'; }

// ── Canvas ────────────────────────────────────────────────────────────────

/**
 * A group's box, or — collapsed (PGN-018) — one card: how long it runs, shots
 * with footage out of all of them, how many of its nodes are behind, and what
 * is running inside it. The fold button toggles it, per project.
 */
function pgGroupHtml(gr) {
    const key = String(gr.key || '');
    const fold = `<button class="pg-group-fold" title="${gr.collapsed ? 'Expand — every node returns exactly where it was' : 'Collapse into one card'}"
        onclick="event.stopPropagation();pgToggleCollapse('${esc(key)}')">${gr.collapsed ? '▸' : '▾'}</button>`;
    const box = `left:${gr.x}px;top:${gr.y}px;width:${gr.w}px;height:${gr.h}px;`;
    if (!gr.collapsed) return `<div class="pg-group" data-group="${esc(key)}" style="${box}"><div class="pg-group-label">${esc(gr.label || '')}</div>${fold}</div>`;
    const s = gr.summary || {};
    return `<div class="pg-group collapsed" data-group="${esc(key)}" style="${box}"><div class="pg-group-label">${esc(gr.label || '')}</div>${fold}
        <div class="pg-group-card">
          <div><b>${pgSecs(s.length_ms)}</b>length</div>
          <div><b>${s.shots_done || 0} / ${s.shots_total || 0}</b>shots done</div>
          <div class="${s.behind ? 'warn' : ''}"><b>${s.behind || 0} behind</b>out of date</div>
          <div><b>${s.running || 0} running</b>now</div>
        </div></div>`;
}

/** Is this node inside a collapsed group? Then it is hidden, never moved. */
function pgInCollapsed(n) {
    return !!(PG.graph && (PG.graph.groups || []).some(g => g.collapsed && (g.members || []).includes(n.key)));
}

/** Collapse or expand a group through its route; the layout of its members is never touched. */
async function pgToggleCollapse(key) {
    const gr = PG.graph && (PG.graph.groups || []).find(g => g.key === key);
    if (!gr) return;
    try {
        await api(`/projects/${PG.graph.project_id}/production-graph/groups/${encodeURIComponent(key)}`,
            { method: 'PUT', body: JSON.stringify({ collapsed: !gr.collapsed }) });
        await loadProductionGraph();
    } catch (err) { setStatus('Could not change the group: ' + err.message); }
}

function pgVisible(n) {
    if (pgInCollapsed(n)) return false;
    if (PG.behindOnly && PG.graph && !pgBehindKeep(n, PG.graph.nodes)) return false;
    if (PG.scene === 'all') return true;
    if (n.type === 'shot') return n.scene_id === PG.scene;
    if (n.type === 'sequence') return n.shot_ids.some(id => { const s = pgNode('shot:' + id); return s && s.scene_id === PG.scene; });
    if (n.parent) { const p = pgNode(n.parent); return !p || pgVisible(p); }
    if (n.type === 'sound') return n.scene_id === PG.scene;
    if (n.type === 'link') { const s = pgNode('seq:' + n.sequence_id); return !s || pgVisible(s); }
    return true;
}

function pgPort(dir, type, port, extra) {
    const cls = ['pg-port', dir, 't-' + (type || 'none')].concat(extra || []).join(' ');
    return `<span class="${cls}" data-port="${port}" data-dir="${dir}" data-type="${type || 'none'}"></span>`;
}

function pgNodeHtml(n, raw) {
    // Every node type is decorated with its out-of-date state in one place (PGN-005).
    // A hold is drawn the same way on every node type that can carry one (PGN-016).
    if (!raw) return pgHoldDecorate(pgImpactDecorate(pgNodeHtml(n, true), n), n);
    const sel = PG.sel === n.key ? ' sel' : '';
    const busy = PG.busy.get(n.key);
    const pos = `left:${n.x}px;top:${n.y}px;`;
    // One repaintable slot per node: the poller rewrites its inside every
    // second or so without re-rendering the canvas (PGN-003).
    const live = PG.running.get(n.key);
    const run = (busy || live) ? `<div class="pg-run" data-run="${esc(n.key)}">${pgProgressHtml(live, busy)}</div>` : '';
    if (n.type === 'inbetween') return pgInbetweenNodeHtml(n, sel, pos, run);
    if (n.type === 'shot') {
        const f = n.selected_frame;
        const inSeq = n.sequence_id ? pgNode('seq:' + n.sequence_id) : null;
        const borrowed = pgBorrowedBy(n);
        const frame = f
            ? `<div class="pg-frame"><img src="${esc(pgSrc(f.url) + (String(f.url).includes('?') ? '&w=320' : '?w=320'))}" alt="" loading="lazy">
                 <div class="pg-pips">${n.frames.slice(-6).map(x => `<span class="${x.selected ? 'on' : ''}"></span>`).join('')}</div>
                 ${borrowed ? `<div class="pg-badge link">↗ ${esc(borrowed)}</div>` : ''}${run}</div>`
            : `<div class="pg-frame none"><span>No frame yet</span><div style="display:flex;gap:6px;">
                 <button class="pg-sbtn primary" onclick="event.stopPropagation();pgRunNode('${n.key}')">Generate</button>
                 <button class="pg-sbtn" onclick="event.stopPropagation();pgSelect('${n.key}')">Upload</button></div>${run}</div>`;
        const hasVideo = n.videos.length || (inSeq && inSeq.videos.length);
        return `<div class="pg-node pg-shot${sel}${f ? '' : ' failed'}" data-key="${n.key}" style="${pos}width:200px;height:180px;">
            <div class="pg-nh"><div class="pg-nt"><span class="pg-title">${esc(n.shot_code)}</span>
              ${f ? `<span class="pg-vtag">v${f.version}/${n.frames.length}</span>` : '<span class="pg-pill fail">no frame</span>'}${pgFlowBadge(n)}</div>
              <div class="pg-sub">shot${n.framing ? ' · ' + esc(n.framing) : ''} · ${pgSecs(n.duration_ms)}${pgPrevisTag(n)}</div>
              <span class="pg-hport">${pgPort('out', 'scene', 'scene')}</span></div>
            ${frame}
            <div class="pg-row" style="margin-top:4px;">${pgPort('in', 'plates', 'plates')}<span>plates</span><span>image</span>
              ${pgPort('out', f ? 'image' : null, 'image')}</div>
            <div class="pg-row end"><span>video</span>${pgPort('out', 'video', 'video', hasVideo ? [] : ['hollow'])}</div>
        </div>`;
    }
    if (n.type === 'sequence') {
        const rows = Math.max(n.shot_codes.length, 3);
        const outs = [['video', 'video', n.videos.length ? [] : ['hollow']], ['scene', 'scene', []], ['end frame', 'image', ['dashed'], 'end']];
        let body = `<div class="pg-row tall">${pgPort('in', 'image', 'start', ['dashed'])}<span class="dim">${n.links.start ? '↳ start frame' : 'start frame'}</span></div>`;
        for (let i = 0; i < rows; i++) {
            const code = n.shot_codes[i];
            const o = outs[i];
            body += `<div class="pg-row tall">${code ? pgPort('in', 'image', 'slot:' + i) : ''}
                <span class="${code ? 'strong' : 'dim'}">${code ? `${i + 1} · ${esc(code)}` : ''}</span>
                ${o ? `<span>${o[0]}</span>${pgPort('out', o[1], o[3] || o[0], o[2])}` : ''}</div>`;
        }
        body += `<div class="pg-row tall">${pgPort('in', 'image', 'slot:new', ['hollow'])}<span class="dim">+ shot</span></div>`
            + `<div class="pg-row tall">${pgPort('in', 'image', 'endlink', ['dashed'])}<span class="dim">${n.links.end ? '↳ end frame' : 'end frame'}</span></div>`;
        const joins = (n.joins || []).map((j, i) => j && n.shot_codes[i + 1] ? `<div class="pg-join">
            <div class="pg-join-k${j.type !== 'cut' ? ' moves' : ''}">${i + 1}→${i + 2} · ${esc((PG_JOINS.find(x => x[0] === j.type) || [0, j.type])[1])}</div>
            ${j.prompt ? `<div class="pg-join-t">${esc(j.prompt)}</div>` : ''}</div>` : '').join('');
        return `<div class="pg-node pg-seq${sel}" data-key="${n.key}" style="${pos}width:240px;min-height:280px;padding-bottom:10px;">
            <div class="pg-nh"><div class="pg-nt"><span class="pg-title">${esc(n.name)}</span>
              ${n.links.stale ? '<span class="pg-pill stale">stale</span>' : ''}</div>
              <div class="pg-sub">sequence · ${n.shot_codes.length} shot${n.shot_codes.length === 1 ? '' : 's'} · ${pgSecs(n.duration_ms)}</div></div>
            ${run ? `<div style="position:relative;height:6px;">${run}</div>` : ''}
            ${body}${joins ? `<div class="pg-joins">${joins}</div>` : ''}</div>`;
    }
    if (n.type === 'video') {
        const parent = pgNode(n.parent);
        const all = (parent && parent.videos) || [];
        return `<div class="pg-node ver${sel}" data-key="${n.key}" style="${pos}width:200px;height:178px;">
            <div class="pg-nh"><div class="pg-nt"><span class="pg-title">${pgVersionTitle(n, all)}</span>
              ${n.selected ? '<span class="pg-pill play">▶ playing</span>' : ''}</div>
              <div class="pg-sub">video · ${esc(n.provider || 'upload')} · ${pgSecs(n.duration_ms)}</div></div>
            <div class="pg-row" style="margin-top:3px;justify-content:flex-start;">${pgPort('in', 'video', 'in')}<span>from ${esc(n.parent_label || '')}</span></div>
            <div class="pg-vthumb">${n.url ? `<video src="${esc(pgSrc(n.url))}#t=0.1" preload="metadata" muted playsinline></video>` : ''}
              <div class="pg-playdot"><svg width="12" height="12" viewBox="0 0 14 14"><path d="M4 2 L12 7 L4 12 Z" fill="#f4f4f5"/></svg></div></div>
        </div>`;
    }
    if (n.type === 'audio') {
        const parent = pgNode(n.parent);
        // A flow's sound hangs off a SHOT, which has no cue versions (FOG-004).
        const all = (parent && parent.versions) || [];
        return `<div class="pg-node ver${sel}" data-key="${n.key}" style="${pos}width:180px;height:110px;">
            <div class="pg-nh"><div class="pg-nt"><span class="pg-title">${pgVersionTitle(n, all)}</span>
              ${n.selected ? '<span class="pg-pill play">▶ playing</span>' : ''}</div>
              <div class="pg-sub">audio · ${pgSecs(n.duration_ms)}</div></div>
            <div class="pg-row" style="margin-top:3px;">${pgPort('in', 'audio', 'in')}</div>
            <div class="pg-wave" data-wave="${n.asset_id}"></div></div>`;
    }
    if (n.type === 'sound') {
        const k = PG_KIND[n.kind] || PG_KIND.music;
        const parent = n.parent ? pgNode(n.parent) : null;
        const matches = parent && n.duration_ms && Math.abs(parent.duration_ms - n.duration_ms) < 500;
        const empty = !n.versions.length ? `<div class="pg-node empty" data-key="${n.key}:empty" data-empty-for="${n.key}"
              style="left:${n.x + 240}px;top:${n.y}px;width:180px;height:110px;">
            <div class="pg-nh" style="border-bottom-style:dashed;"><div class="pg-title" style="color:#b7b7be;">No version yet</div><div class="pg-sub">audio</div></div>
            <div class="pg-row" style="margin-top:3px;">${pgPort('in', 'audio', 'in')}</div>
            <div class="pg-nbtns"><button class="pg-sbtn primary" onclick="event.stopPropagation();pgRunNode('${n.key}')">Generate</button>
              <button class="pg-sbtn" onclick="event.stopPropagation();pgSelect('${n.key}')">Upload</button></div></div>` : '';
        return `<div class="pg-node${sel}" data-key="${n.key}" style="${pos}width:200px;height:130px;">
            <div class="pg-nh"><div class="pg-title">${esc(n.title || k.label)}</div>
              <div class="pg-sub">${k.gen} · ${pgSecs(n.duration_ms || (parent && parent.duration_ms))}${matches || (!n.duration_ms && parent) ? ' · matches' : ''}</div></div>
            <div class="pg-row" style="margin-top:3px;">${pgPort('in', 'scene', 'scene')}<span>scene</span><span>audio</span>
              ${pgPort('out', n.versions.length ? 'audio' : null, 'audio')}</div>
            <div class="pg-ntext">${esc(n.description || 'No direction yet — open it to write one.')}</div>
            ${run}</div>${empty}`;
    }
    if (n.type === 'link') {
        const img = n.ok && n.url ? `<img src="${esc(pgSrc(n.url) + (String(n.url).includes('?') ? '&w=320' : '?w=320'))}" alt="" loading="lazy">` : `<div class="pg-slate">${esc(n.reason || 'unresolved')}</div>`;
        return `<div class="pg-node link${sel}" data-key="${n.key}" style="${pos}width:200px;height:150px;">
            <div class="pg-nh"><div class="pg-nt"><span class="pg-title">↳ ${esc(n.ok ? n.label : 'Linked frame')}</span></div>
              <div class="pg-sub">linked frame · from ${esc(n.source_name || '?')}</div>
              <span style="position:absolute;left:-6.5px;top:15px;">${pgPort('in', 'image', 'in', ['dashed'])}</span></div>
            <div class="pg-frame" style="height:84px;opacity:.85;">${img}</div>
            <div class="pg-row end" style="margin-top:4px;"><span>${n.side === 'end' ? 'end frame' : 'start frame'}</span>${pgPort('out', 'image', 'frame')}</div></div>`;
    }
    return '';
}

/** A shot whose frame another sequence borrows says so on its own node. */
function pgBorrowedBy(shot) {
    for (const n of (PG.graph ? PG.graph.nodes : [])) {
        if (n.type === 'link' && n.ok && n.shot_id === shot.id) {
            const into = pgNode('seq:' + n.sequence_id);
            return (n.side === 'start' ? 'starts ' : 'ends ') + (into ? into.name : 'a sequence');
        }
    }
    return '';
}

function pgRender() {
    const world = document.getElementById('pgWorld');
    const canvas = document.getElementById('pgCanvas');
    if (!world || !PG.graph) return;
    const g = PG.graph;
    canvas.querySelector('.pg-empty').textContent = g.nodes.length ? '' : 'No shots yet. Break the screenplay into shots, then come back.';
    const groups = (g.groups || []).map(gr => pgGroupHtml(gr)).join('');
    // Never `.map(pgNodeHtml)`: map passes the index as `raw`, which drew every
    // node but the first without its out-of-date state and its hold badge.
    const nodes = g.nodes.filter(pgVisible).map(n => pgNodeHtml(n)).join('');
    world.innerHTML = groups + '<svg class="pg-edges" id="pgEdges" width="1" height="1"></svg>' + nodes;
    for (const k of PG.picked) { const el = world.querySelector(`.pg-node[data-key="${k}"]`); if (el) el.classList.add('picked'); }
    pgApplyView();
    pgHeader();
    requestAnimationFrame(() => { pgDrawEdges(); pgPaintWaves(); pgMinimap(); });
}

function pgPortCenter(key, port, dir) {
    const world = document.getElementById('pgWorld');
    const el = world && world.querySelector(`.pg-node[data-key="${key}"] .pg-port[data-port="${port}"][data-dir="${dir}"]`)
        || (world && world.querySelector(`.pg-node[data-key="${key}"] .pg-port[data-dir="${dir}"]`));
    if (!el) return null;
    const wr = world.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - wr.left) / PG.zoom, y: (r.top + r.height / 2 - wr.top) / PG.zoom };
}

function pgPath(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M${a.x} ${a.y} C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
}

function pgDrawEdges(ghost) {
    const svg = document.getElementById('pgEdges');
    if (!svg || !PG.graph) return;
    const paths = [];
    for (const e of PG.graph.edges) {
        const from = pgNode(e.from), to = pgNode(e.to);
        if (!from || !to || !pgVisible(from) || !pgVisible(to)) continue;
        const a = pgPortCenter(e.from, e.from_port, 'out');
        const toPort = e.to_port && e.to_port.startsWith('slot:') ? e.to_port : e.to_port;
        const b = pgPortCenter(e.to, toPort, 'in');
        if (!a || !b) continue;
        const hot = PG.sel && (PG.sel === e.from || PG.sel === e.to);
        paths.push(`<path d="${pgPath(a, b)}" stroke="${pgEdgeColor(e.style === 'dotted' ? '#5f5f67' : (PG_PORT_COLOR[e.type] || '#6c6cff'), e.to ? pgNode(e.to) : null)}"
            class="${e.style !== 'solid' ? e.style : ''}${hot ? ' hot' : ''}"></path>`);
    }
    // A sound with no version still points at its empty slot.
    for (const n of PG.graph.nodes) {
        if (n.type !== 'sound' || n.versions.length || !pgVisible(n)) continue;
        const a = pgPortCenter(n.key, 'audio', 'out'), b = pgPortCenter(n.key + ':empty', 'in', 'in');
        if (a && b) paths.push(`<path d="${pgPath(a, b)}" stroke="#57c98a" class="dotted"></path>`);
    }
    if (ghost) paths.push(`<path d="${pgPath(ghost.a, ghost.b)}" class="fedge-ghost" style="stroke:#f5c451;stroke-dasharray:5 4;"></path>`);
    svg.innerHTML = paths.join('');
}

async function pgPaintWaves() {
    for (const el of document.querySelectorAll('#pgWorld .pg-wave[data-wave]')) {
        if (el.dataset.painted) continue;
        el.dataset.painted = '1';
        try {
            const w = await api('/assets/' + el.dataset.wave + '/waveform');
            const peaks = (w && w.peaks) || [];
            const step = Math.max(1, Math.floor(peaks.length / 38));
            const bars = [];
            for (let i = 0; i < peaks.length && bars.length < 38; i += step) bars.push(peaks[i]);
            // Normalised to the loudest peak, so a quiet bed still reads as a shape.
            const top = Math.max(...bars.map(p => Math.abs(p)), 0.001);
            el.innerHTML = bars.map(p => `<span style="height:${Math.max(2, Math.round(Math.abs(p) / top * 26))}px"></span>`).join('');
        } catch (_) { /* a card with no picture of its sound still plays it */ }
    }
}

function pgApplyView() {
    const world = document.getElementById('pgWorld');
    const canvas = document.getElementById('pgCanvas');
    if (!world) return;
    world.style.transform = `translate(${PG.pan.x}px, ${PG.pan.y}px) scale(${PG.zoom})`;
    canvas.style.backgroundPosition = `${PG.pan.x}px ${PG.pan.y}px`;
    canvas.style.backgroundSize = `${18 * PG.zoom}px ${18 * PG.zoom}px`;
    const z = document.getElementById('pgZoom');
    if (z) z.textContent = Math.round(PG.zoom * 100) + '%';
    pgMinimap();
}

/** The card a node is hidden inside, when its group is collapsed; else null. */
function pgCollapsedOf(key) {
    return (PG.graph && (PG.graph.groups || []).find(g => g.collapsed && (g.members || []).includes(key))) || null;
}

/** What is drawn as a box: the nodes still shown, and every collapsed card (its members are hidden). */
function pgBoxes() {
    const g = PG.graph;
    if (!g) return [];
    return g.nodes.filter(pgVisible).concat((g.groups || []).filter(x => x.collapsed));
}

function pgBounds() {
    // A collapsed card stands in for its members, so Fit must frame it too:
    // leaving it out puts a collapsed sequence off-screen with nothing pointing to it.
    const ns = PG.graph ? PG.graph.nodes.filter(pgVisible).concat((PG.graph.groups || []).filter(x => x.collapsed)) : [];
    if (!ns.length) return { x: 0, y: 0, w: 1000, h: 600 };
    const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
    const x2 = ns.map(n => n.x + (n.w || 200)), y2 = ns.map(n => n.y + (n.h || 180));
    const x = Math.min(...xs) - 20, y = Math.min(...ys) - 20;
    return { x, y, w: Math.max(...x2) - x + 40, h: Math.max(...y2) - y + 40 };
}

function pgFit() {
    const c = document.getElementById('pgCanvas');
    if (!c) return;
    const b = pgBounds();
    const z = Math.max(0.25, Math.min(1.2, Math.min(c.clientWidth / b.w, c.clientHeight / b.h)));
    PG.zoom = z;
    PG.pan = { x: -b.x * z + 8, y: -b.y * z + 8 };
    pgApplyView();
    requestAnimationFrame(() => pgDrawEdges());
}

function pgZoomBy(f, cx, cy) {
    const c = document.getElementById('pgCanvas');
    const r = c.getBoundingClientRect();
    const px = cx == null ? r.width / 2 : cx - r.left, py = cy == null ? r.height / 2 : cy - r.top;
    const z = Math.max(0.2, Math.min(2, PG.zoom * f));
    PG.pan.x = px - (px - PG.pan.x) * (z / PG.zoom);
    PG.pan.y = py - (py - PG.pan.y) * (z / PG.zoom);
    PG.zoom = z;
    pgApplyView();
    pgDrawEdges();
}

function pgMinimap() {
    const m = document.getElementById('pgMinimap');
    const c = document.getElementById('pgCanvas');
    if (!m || !c || !PG.graph) return;
    const b = pgBounds();
    const s = Math.min(148 / b.w, 76 / b.h);
    // Collapsed cards are drawn too: a card that is on the canvas and missing from the map reads as lost.
    const boxes = pgBoxes().map(n =>
        `<div style="left:${10 + (n.x - b.x) * s}px;top:${10 + (n.y - b.y) * s}px;width:${Math.max(2, (n.w || 200) * s)}px;height:${Math.max(2, (n.h || 180) * s)}px;"></div>`);
    const vx = (-PG.pan.x / PG.zoom - b.x) * s + 10, vy = (-PG.pan.y / PG.zoom - b.y) * s + 10;
    boxes.push(`<div class="vp" style="left:${vx}px;top:${vy}px;width:${c.clientWidth / PG.zoom * s}px;height:${c.clientHeight / PG.zoom * s}px;"></div>`);
    m.innerHTML = boxes.join('');
}

function pgPanTo(key) {
    const n = pgNode(key), c = document.getElementById('pgCanvas');
    if (!n || !c) return;
    const drawer = document.getElementById('pgDrawer');
    const visibleW = c.clientWidth - (drawer && drawer.classList.contains('open') ? 420 : 0);
    PG.pan.x = visibleW / 2 - (n.x + (n.w || 200) / 2) * PG.zoom;
    PG.pan.y = c.clientHeight / 2 - (n.y + (n.h || 180) / 2) * PG.zoom;
    pgApplyView();
    pgDrawEdges();
}

// ── Pointer: pan, drag a node, wire a port ─────────────────────────────────

function pgWorldPoint(ev) {
    const c = document.getElementById('pgCanvas').getBoundingClientRect();
    return { x: (ev.clientX - c.left - PG.pan.x) / PG.zoom, y: (ev.clientY - c.top - PG.pan.y) / PG.zoom };
}

function pgInitCanvas() {
    const c = document.getElementById('pgCanvas');
    if (!c || c.dataset.wired) return;
    c.dataset.wired = '1';
    let gesture = null;

    c.addEventListener('mousedown', ev => {
        if (ev.button !== 0) return;
        pgCloseMenu();
        const port = ev.target.closest('.pg-port[data-dir="out"]');
        const nodeEl = ev.target.closest('.pg-node[data-key]');
        if (ev.target.closest('button, input, textarea, select, label, video')) return;
        if (port && nodeEl) {
            gesture = { kind: 'wire', from: nodeEl.dataset.key, port: port.dataset.port, type: port.dataset.type,
                a: pgPortCenter(nodeEl.dataset.key, port.dataset.port, 'out') };
            pgHintTargets(gesture);
            ev.preventDefault();
            return;
        }
        if (nodeEl && !nodeEl.dataset.emptyFor) {
            const n = pgNode(nodeEl.dataset.key);
            if (!n) return;
            gesture = { kind: 'node', key: n.key, sx: ev.clientX, sy: ev.clientY, x0: n.x, y0: n.y, moved: false, el: nodeEl };
            return;
        }
        gesture = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, px: PG.pan.x, py: PG.pan.y, moved: false };
        c.classList.add('panning');
    });

    window.addEventListener('mousemove', ev => {
        if (!gesture) return;
        if (gesture.kind === 'pan') {
            const dx = ev.clientX - gesture.sx, dy = ev.clientY - gesture.sy;
            if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
            PG.pan.x = gesture.px + dx; PG.pan.y = gesture.py + dy;
            pgApplyView();
        } else if (gesture.kind === 'node') {
            const dx = (ev.clientX - gesture.sx) / PG.zoom, dy = (ev.clientY - gesture.sy) / PG.zoom;
            if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
            if (!gesture.moved) return;
            const n = pgNode(gesture.key);
            n.x = Math.round(gesture.x0 + dx); n.y = Math.round(gesture.y0 + dy);
            gesture.el.style.left = n.x + 'px'; gesture.el.style.top = n.y + 'px';
            const empty = document.querySelector(`#pgWorld .pg-node[data-empty-for="${n.key}"]`);
            if (empty) { empty.style.left = (n.x + 240) + 'px'; empty.style.top = n.y + 'px'; }
            pgDrawEdges();
        } else if (gesture.kind === 'wire') {
            pgDrawEdges({ a: gesture.a, b: pgWorldPoint(ev) });
        }
    });

    window.addEventListener('mouseup', async ev => {
        const g = gesture; gesture = null;
        c.classList.remove('panning');
        if (!g) return;
        if (g.kind === 'pan' && !g.moved) {
            // Remembered for a double-click's "sequence from the selected shot".
            if (PG.sel) PG.selBeforeClick = PG.sel;
            if (ev.target.closest && ev.target.closest('#pgCanvas') && !ev.target.closest('.pg-furniture, .pg-minimap')) pgSelect(null);
        } else if (g.kind === 'node') {
            // Shift+click picks shots for "a sequence from the picked shots" (PGN-019),
            // and shots or sequences for "Apply flow…" (FOG-003).
            if (!g.moved && ev.shiftKey && (g.key.startsWith('shot:') || g.key.startsWith('seq:'))) { pgTogglePick(g.key); return; }
            if (!g.moved) { pgSelect(g.key); return; }
            const n = pgNode(g.key);
            n.pinned = true;
            try {
                await api(`/projects/${state.currentProject.id}/production-graph/layout`, {
                    method: 'PUT', body: JSON.stringify({ nodes: [{ key: n.key, x: n.x, y: n.y }] }) });
            } catch (err) { setStatus('Could not keep that position: ' + err.message); }
            pgMinimap();
        } else if (g.kind === 'wire') {
            pgClearHints();
            pgDrawEdges();
            const target = document.elementFromPoint(ev.clientX, ev.clientY);
            const port = target && target.closest('.pg-port[data-dir="in"]');
            const nodeEl = target && target.closest('.pg-node[data-key]');
            if (port && nodeEl) await pgWire(g, nodeEl.dataset.key, port.dataset.port, port.dataset.type);
        }
    });

    // Double-click empty canvas: the add palette, at the pointer (PGN-019).
    c.addEventListener('dblclick', ev => {
        if (ev.target.closest('.pg-node, button, input, textarea, select, .pg-furniture, .pg-minimap')) return;
        ev.preventDefault();
        pgOpenAddPalette(ev.clientX, ev.clientY, pgWorldPoint(ev));
    });

    c.addEventListener('wheel', ev => {
        ev.preventDefault();
        if (ev.ctrlKey || ev.metaKey || Math.abs(ev.deltaY) > Math.abs(ev.deltaX) * 2 && !ev.shiftKey) {
            pgZoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev.clientX, ev.clientY);
        } else {
            PG.pan.x -= ev.deltaX; PG.pan.y -= ev.deltaY;
            pgApplyView();
        }
    }, { passive: false });

    c.addEventListener('contextmenu', ev => {
        const nodeEl = ev.target.closest('.pg-node[data-key]');
        const group = ev.target.closest('.pg-group');
        if (!nodeEl && !group) return;
        ev.preventDefault();
        pgOpenMenu(ev.clientX, ev.clientY, nodeEl ? nodeEl.dataset.key : null, group);
    });

    c.addEventListener('dragover', ev => {
        const t = ev.dataTransfer.types;
        if (t.includes('text/pg-add') || t.includes('Files')) ev.preventDefault();
    });
    c.addEventListener('drop', ev => {
        // A file from the desktop: find which of this project's files it is,
        // or offer it to the node it landed on (PGN-015).
        const dropped = pgDroppedFile(ev.dataTransfer);
        if (dropped) {
            ev.preventDefault();
            const nodeEl = ev.target.closest && ev.target.closest('.pg-node[data-key]');
            return pgDropFile(dropped, nodeEl ? nodeEl.dataset.key : null);
        }
        const what = ev.dataTransfer.getData('text/pg-add');
        if (!what) return;
        ev.preventDefault();
        pgAddAt(what, pgWorldPoint(ev));
    });

    document.getElementById('pgMinimap').addEventListener('click', ev => {
        const r = ev.currentTarget.getBoundingClientRect(), b = pgBounds();
        const s = Math.min(148 / b.w, 76 / b.h);
        const wx = (ev.clientX - r.left - 10) / s + b.x, wy = (ev.clientY - r.top - 10) / s + b.y;
        PG.pan.x = c.clientWidth / 2 - wx * PG.zoom; PG.pan.y = c.clientHeight / 2 - wy * PG.zoom;
        pgApplyView(); pgDrawEdges();
    });

    // Ctrl+B (Cmd+B) holds or releases the selected node — not while typing (PGN-016).
    document.addEventListener('keydown', ev => {
        if (state.currentPage !== 'productiongraph' || !(ev.ctrlKey || ev.metaKey) || String(ev.key).toLowerCase() !== 'b') return;
        if (!PG.sel || /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target && ev.target.tagName) || '') || (ev.target && ev.target.isContentEditable)) return;
        ev.preventDefault();
        pgToggleHold(PG.sel);
    });
    document.addEventListener('keydown', ev => {
        if (ev.key !== 'Escape' || state.currentPage !== 'productiongraph') return;
        if (document.querySelector('.modal-overlay.open')) return;
        pgCloseMenu();
        pgSelect(null);
    });
    window.addEventListener('resize', () => { if (state.currentPage === 'productiongraph') { pgDrawEdges(); pgRenderPlayback(); } });
}

/** Which in-ports this out-port may land on — type-checked by colour, as drawn. */
function pgCanWire(g, toKey, toPort, toType) {
    const from = pgNode(g.from), to = pgNode(toKey);
    if (!from || !to || from.key === to.key) return false;
    if (g.type === 'image' && from.type === 'shot' && to.type === 'sequence' && /^slot:/.test(toPort)) return true;
    // Shot picture onto another shot: in-betweens between the two.
    if (g.type === 'image' && from.type === 'shot' && to.type === 'shot' && toPort === 'plates') return true;
    if (g.type === 'scene' && (from.type === 'shot' || from.type === 'sequence') && to.type === 'sound') return true;
    if (g.port === 'end' && from.type === 'sequence' && to.type === 'sequence' && (toPort === 'start' || toPort === 'endlink')) return true;
    return false;
}

function pgHintTargets(g) {
    document.querySelectorAll('#pgWorld .pg-port[data-dir="in"]').forEach(p => {
        const nodeEl = p.closest('.pg-node');
        if (nodeEl && pgCanWire(g, nodeEl.dataset.key, p.dataset.port, p.dataset.type)) p.classList.add('hint');
    });
}
function pgClearHints() { document.querySelectorAll('#pgWorld .pg-port.hint').forEach(p => p.classList.remove('hint')); }

/**
 * The wiring rules. Shot → sequence adds membership (a shot belongs to ONE, so
 * wiring it elsewhere asks to move it); shot/sequence → sound gives the sound
 * its scene; sequence end → another sequence's start makes a linked frame, never
 * membership. Versions are made by the server and never wired by hand.
 */
async function pgWire(g, toKey, toPort, toType) {
    if (!pgCanWire(g, toKey, toPort, toType)) {
        setStatus('Those two do not connect — a port only takes a wire of its own colour.');
        return;
    }
    const from = pgNode(g.from), to = pgNode(toKey);
    if (from.type === 'shot' && to.type === 'shot') return ibOpenSetup(from, to);
    try {
        if (from.type === 'shot' && to.type === 'sequence') {
            if (to.shot_ids.includes(from.id)) return;
            const body = { shot_ids: to.shot_ids.concat(from.id) };
            try {
                await api('/sequences/' + to.id, { method: 'PUT', body: JSON.stringify(body) });
            } catch (err) {
                if (!/SHOT_IN_SEQUENCE|belongs to one sequence/.test(err.message)) throw err;
                const other = from.sequence_id ? pgNode('seq:' + from.sequence_id) : null;
                if (!confirm(`${from.shot_code} is already in ${other ? other.name : 'another sequence'}. A shot belongs to one sequence.\n\nMove it to ${to.name}?`)) return;
                await api('/sequences/' + to.id, { method: 'PUT', body: JSON.stringify({ ...body, move: true }) });
            }
            setStatus(`${from.shot_code} is now shot ${body.shot_ids.length} of ${to.name}.`);
        } else if (to.type === 'sound') {
            await api('/music-cues/' + to.id, { method: 'PUT', body: JSON.stringify(
                from.type === 'sequence' ? { sequence_id: from.id } : { shot_id: from.id }) });
            setStatus(`${to.title || 'The sound'} now takes its scene details from ${from.type === 'sequence' ? from.name : from.shot_code}.`);
        } else if (from.type === 'sequence' && to.type === 'sequence') {
            const field = toPort === 'start' ? 'start_frame_ref' : 'end_frame_ref';
            await api('/sequences/' + to.id, { method: 'PUT', body: JSON.stringify({ [field]: { sequence_id: from.id, mode: 'shot_image' } }) });
            setStatus(`${to.name} now ${toPort === 'start' ? 'starts' : 'ends'} on a frame borrowed from ${from.name}.`);
        }
        await loadProductionGraph();
    } catch (err) { setStatus('Could not wire that: ' + err.message); }
}

// ── Selection, header, menu ────────────────────────────────────────────────

function pgSelect(key) {
    PG.sel = key || null;
    document.querySelectorAll('#pgWorld .pg-node.sel').forEach(el => el.classList.remove('sel'));
    if (key) {
        const el = document.querySelector(`#pgWorld .pg-node[data-key="${key}"]`);
        if (el) el.classList.add('sel');
        const n = pgNode(key);
        if (n && n.type === 'shot') markCurrentShot(n.id);
        pgPlayheadTo(key);
    }
    pgDrawEdges();
    pgRenderDrawer();
    pgRenderSide();
}

function pgHeader() {
    const g = PG.graph;
    const m = g.meta || {};
    const meta = document.getElementById('pgMeta');
    if (meta) meta.textContent = `${m.shots} shot${m.shots === 1 ? '' : 's'} · ${m.framed} framed · ${m.with_video} with video · ${m.need_frame} need a frame`;
    const chips = document.getElementById('pgScenes');
    if (chips) {
        const scenes = [];
        for (const s of pgShots()) if (!scenes.some(x => x.id === s.scene_id)) scenes.push({ id: s.scene_id, label: s.scene_label });
        chips.innerHTML = `<button class="pg-chip${PG.scene === 'all' ? ' on' : ''}" onclick="pgScene('all')">All scenes</button>`
            + scenes.map(s => `<button class="pg-chip${PG.scene === s.id ? ' on' : ''}" onclick="pgScene('${s.id}')">${esc(s.label)}</button>`).join('');
    }
    const legend = document.getElementById('pgLegend');
    if (legend) legend.innerHTML = pgLegendHtml(g.nodes || [], !!PG.behindOnly);
    const lock = document.getElementById('pgLockBtn');
    if (lock) lock.textContent = g.board_locked ? '🔒 Unlock board' : 'Lock board';
    const run = document.getElementById('pgRunBtn');
    if (run) {
        const n = (g.pending || []).length;
        run.textContent = n ? `Run pending (${n})` : 'Nothing pending';
        run.disabled = !n || (g.board_locked && (g.pending || []).some(p => p.action === 'frame'));
    }
}

function pgScene(id) { PG.scene = id; pgRender(); pgFit(); pgRenderSide(); }

/**
 * HOW EACH OUT-OF-DATE STATE LOOKS (PGN-005). One table, keyed exactly by the
 * server's IMPACT_STATES — a test holds the two equal, so a state added there
 * cannot arrive undrawn here.
 */
const PG_IMPACT_LOOK = Object.freeze({
    current: { label: 'current', color: '#57c98a' },
    redo: { label: 'redo', color: '#f06a4a' },
    waiting: { label: 'waiting', color: '#e3b341' },
    never: { label: 'not made', color: '#6b6b75' },
    untracked: { label: 'untracked', color: '#8f8fb0' },
});

function pgBehind(n) {
    const s = n && n.impact && n.impact.state;
    return s === 'redo' || s === 'waiting' || !!(n && n.impact && (n.impact.badges || []).length);
}

/** Behind, or the parent of something behind — so a stale clip keeps the shot it belongs to. */
function pgBehindKeep(n, nodes) {
    if (pgBehind(n)) return true;
    return (nodes || []).some(c => c.parent === n.key && pgBehind(c));
}

function pgImpactPill(n) {
    const im = n && n.impact;
    if (!im) return '';
    const look = PG_IMPACT_LOOK[im.state];
    const badges = (im.badges || []).map(b => `<span class="pg-imp-b imp-${esc(b.state)}">${esc(b.stage)} ${esc(b.state)}</span>`).join('');
    if ((!look || im.state === 'current') && !badges) return '';
    const tip = [im.why, im.action].filter(Boolean).join(' ');
    const main = look && im.state !== 'current' ? `<span class="pg-imp-s imp-${esc(im.state)}">${esc(look.label)}</span>` : '';
    return `<div class="pg-imp" title="${esc(tip)}">${main}${badges}</div>`;
}

/** The node's own class and pill, applied to the node's opening tag. */
function pgImpactDecorate(html, n) {
    const im = n && n.impact;
    if (!im || !PG_IMPACT_LOOK[im.state]) return html;
    const marked = html.replace('class="pg-node', `class="pg-node imp-${im.state}`);
    const pill = pgImpactPill(n);
    if (!pill) return marked;
    const open = marked.indexOf('>');
    return open < 0 ? marked : marked.slice(0, open + 1) + pill + marked.slice(open + 1);
}

// ── Double-click to add (PGN-019) ──────────────────────────────────────────

/** Every cue type the cue route accepts (routes/assets.js VALID_CUE_TYPES), as the palette names it. */
const PG_ADD_CUE_TYPES = Object.freeze({ score: 'Score', source: 'Source music', sfx: 'Sound effect', ambient: 'Room tone', transition: 'Transition' });

/**
 * The code an inserted shot will get — a mirror of lib/shot-insert-code.js,
 * held equal by test, so the code the palette shows is the code written.
 */
function pgNextInsertCode(anchorCode, usedCodes) {
    const used = new Set((usedCodes || []).map(c => String(c || '').toUpperCase()));
    let code = String(anchorCode || '') + 'A';
    let guard = 0;
    while (used.has(code.toUpperCase()) && guard++ < 25) {
        code = code.slice(0, -1) + String.fromCharCode(code.charCodeAt(code.length - 1) + 1);
    }
    return used.has(code.toUpperCase()) ? null : code;
}

/** The shot whose card centre is nearest the pointer. */
function pgNearestShot(shots, at) {
    let best = null, d = Infinity;
    for (const s of shots || []) {
        const cx = s.x + (s.w || 220) / 2, cy = s.y + (s.h || 170) / 2;
        const dd = (cx - at.x) ** 2 + (cy - at.y) ** 2;
        if (dd < d) { d = dd; best = s; }
    }
    return best;
}

/**
 * What the palette offers at this point: a shot inserted after the nearest shot
 * (with the code it will get), a cue of every type in that shot's scene, and a
 * sequence from the picked shots (or the selected one) in film order.
 */
function pgAddEntries(graph, at, picked, selKey, patterns, templates) {
    const shots = ((graph && graph.nodes) || []).filter(n => n.type === 'shot');
    const out = [];
    const near = pgNearestShot(shots, at);
    if (near) {
        const code = pgNextInsertCode(near.shot_code, shots.filter(s => s.scene_id === near.scene_id).map(s => s.shot_code));
        if (code) out.push({ kind: 'shot', after: near.id, code, label: `Shot after ${near.shot_code} — becomes ${code}` });
        // Coverage patterns (PGN-020): several shots and their sequence in one step.
        for (const p of patterns || []) out.push({ kind: 'pattern', pattern: p.id, after: near.id,
            label: `Pattern: ${p.label} after ${near.shot_code}` });
    }
    /*
     * The templates shelf (FOG-006): every ready-made flow, next to the
     * patterns, applied to the picks and the selection through FOG-003's apply.
     * Listed even with nothing to run on, saying why, so the shelf is found.
     */
    if ((templates || []).length) {
        const byKey = new Map(((graph && graph.nodes) || []).map(n => [n.key, n]));
        const targets = pgApplyTargets(picked || [], selKey, byKey);
        const on = targets.length ? ` → ${targets.length} selected` : '';
        for (const t of templates) out.push({ kind: 'template', template: t.id, targets,
            label: `Template: ${t.name}${on}`,
            ...(targets.length ? {} : { refused: 'Pick a shot or a sequence first (Shift+click): a flow runs once per shot.' }) });
    }
    for (const [t, l] of Object.entries(PG_ADD_CUE_TYPES)) {
        out.push({ kind: 'sound', cue_type: t, scene_id: near ? near.scene_id : null,
            label: `${l} cue · ${t}${near ? ' · scene of ' + near.shot_code : ''}` });
    }
    const keys = picked && picked.length ? picked : (selKey && String(selKey).startsWith('shot:') ? [selKey] : []);
    const order = (graph && graph.running_order) || [];
    const ids = [...new Set(keys.map(k => String(k).slice('shot:'.length)))]
        .filter(id => shots.some(s => s.id === id))
        .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (ids.length) {
        const codes = ids.map(id => shots.find(s => s.id === id).shot_code);
        out.push({ kind: 'sequence', shot_ids: ids, name: codes.length > 1 ? `${codes[0]}–${codes[codes.length - 1]}` : codes[0],
            label: `Sequence from ${codes.join(', ')}` });
    }
    return out;
}

/** Every word typed must appear in the label; nothing typed shows everything. */
function pgFilterEntries(entries, query) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    return (entries || []).filter(e => words.every(w => String(e.label || '').toLowerCase().includes(w)));
}

/** Pick or unpick a shot (or a sequence, for "Apply flow…") — a picked sequence never joins "a sequence from the picked shots". */
function pgTogglePick(key) {
    if (PG.picked.has(key)) PG.picked.delete(key); else PG.picked.add(key);
    const el = document.querySelector(`#pgWorld .pg-node[data-key="${key}"]`);
    if (el) el.classList.toggle('picked', PG.picked.has(key));
    setStatus(PG.picked.size ? `${PG.picked.size} picked — right-click one to apply a flow to them, or double-click the canvas to make a sequence of the picked shots.` : 'Nothing picked.');
}

async function pgOpenAddPalette(clientX, clientY, at) {
    pgCloseAddPalette();
    if (!PG.graph) return;
    if (!PG.patterns) {
        try { PG.patterns = (await api(`/projects/${PG.graph.project_id}/production-graph/patterns`)).patterns || []; }
        catch (_) { PG.patterns = []; }
    }
    if (!PG.templates) {
        try { PG.templates = (await api('/flow-templates')).templates || []; }
        catch (_) { PG.templates = []; }
    }
    const entries = pgAddEntries(PG.graph, at, [...PG.picked], PG.sel || PG.selBeforeClick, PG.patterns, PG.templates);
    PG.add = { at, entries, shown: entries, index: 0, step: 'pick', entry: null };
    const el = document.createElement('div');
    el.id = 'pgAddPalette'; el.className = 'pg-add';
    el.style.left = Math.min(clientX, window.innerWidth - 340) + 'px';
    el.style.top = Math.min(clientY, window.innerHeight - 320) + 'px';
    el.innerHTML = `<input id="pgAddInput" placeholder="Add a shot, a cue or a sequence…" autocomplete="off" spellcheck="false">
        <div class="pg-add-list" id="pgAddList"></div>`;
    document.body.appendChild(el);
    const input = el.querySelector('#pgAddInput');
    input.addEventListener('input', () => {
        if (!PG.add || PG.add.step !== 'pick') return;
        PG.add.shown = pgFilterEntries(PG.add.entries, input.value);
        PG.add.index = 0;
        pgRenderAddPalette();
    });
    input.addEventListener('keydown', pgAddKey);
    input.addEventListener('blur', () => setTimeout(() => { if (PG.add && document.activeElement !== input) pgCloseAddPalette(); }, 150));
    pgRenderAddPalette();
    input.focus();
}

function pgRenderAddPalette() {
    const list = document.getElementById('pgAddList');
    const a = PG.add;
    if (!list || !a) return;
    if (a.step === 'pattern') {
        const p = a.preview;
        list.innerHTML = !p ? '<div class="pg-add-hint">Reading what it would make…</div>'
            : p.error ? `<div class="pg-add-hint">${esc(p.error)}</div>`
            : p.shots.map(s => `<div class="pg-add-item">${esc(s.code)} · ${esc(s.shot_type)} — ${esc(s.role)}</div>`).join('')
                + `<div class="pg-add-hint">One sequence, joins: ${esc(p.joins.map(j => j.type).join(', '))}. Free — nothing is generated. Enter creates · Esc cancels.</div>`;
        return;
    }
    if (a.step === 'describe') {
        list.innerHTML = `<div class="pg-add-hint">What happens in ${esc(a.entry.code)}? Enter adds it after ${esc(a.entry.label.replace(/^Shot after (\S+).*/, '$1'))}; Escape cancels.</div>`;
        return;
    }
    list.innerHTML = (a.shown || []).map((e, i) => `<div class="pg-add-item${i === a.index ? ' on' : ''}">${esc(e.label)}</div>`).join('')
        + `<div class="pg-add-hint">${(a.shown || []).length ? '↑↓ to choose · Enter to add · Esc to cancel' : 'Nothing matches.'}${
            PG.picked.size ? '' : ' · Shift+click shots to add a sequence of them'}</div>`;
}

function pgCloseAddPalette() {
    const el = document.getElementById('pgAddPalette');
    if (el) el.remove();
    PG.add = null;
}

/** The palette is keyboard only: arrows move, Enter picks (a shot then asks what happens in it), Escape cancels. */
function pgAddKey(ev) {
    const a = PG.add;
    if (!a) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); return pgCloseAddPalette(); }
    if (a.step === 'pattern') {
        if (ev.key === 'Enter' && a.preview && !a.preview.error) {
            ev.preventDefault();
            const entry = a.entry, at = a.at;
            pgCloseAddPalette();
            return pgAddPick(entry, at);
        }
        return;
    }
    if (a.step === 'describe') {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            const text = ev.target.value, entry = a.entry, at = a.at;
            pgCloseAddPalette();
            return pgAddPick(entry, at, text);
        }
        return;
    }
    const list = a.shown || [];
    if (ev.key === 'ArrowDown') { ev.preventDefault(); a.index = Math.min(list.length - 1, a.index + 1); return pgRenderAddPalette(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); a.index = Math.max(0, a.index - 1); return pgRenderAddPalette(); }
    if (ev.key === 'Enter') {
        ev.preventDefault();
        const entry = list[a.index];
        if (!entry) return;
        if (entry.kind === 'shot') {
            a.step = 'describe'; a.entry = entry;
            ev.target.value = ''; ev.target.placeholder = `What happens in ${entry.code}?`;
            return pgRenderAddPalette();
        }
        // A pattern shows what it would make first, for free; a second Enter makes it.
        if (entry.kind === 'pattern') {
            a.step = 'pattern'; a.entry = entry; a.preview = null;
            pgRenderAddPalette();
            return pgPatternPreview(entry);
        }
        const at = a.at;
        pgCloseAddPalette();
        return pgAddPick(entry, at);
    }
}

/** The pattern's free preview: the shots, codes and joins it would make. */
async function pgPatternPreview(entry) {
    let preview;
    try {
        preview = await api(`/projects/${state.currentProject.id}/production-graph/patterns/${encodeURIComponent(entry.pattern)}/preview?after=${encodeURIComponent(entry.after)}`);
    } catch (err) { preview = { error: err.message }; }
    if (PG.add && PG.add.entry === entry) { PG.add.preview = preview; pgRenderAddPalette(); }
}

/** Add it through the route that already makes it, then place it where the palette opened. */
async function pgAddPick(entry, at, text) {
    const pid = state.currentProject.id;
    let key = null;
    // A template is not a node to place: it is saved as a flow and applied (FOG-006 → FOG-003).
    if (entry.kind === 'template') {
        if (entry.refused || !(entry.targets || []).length) return setStatus(entry.refused || 'Pick a shot or a sequence first.');
        try {
            const f = await api(`/projects/${pid}/flows/from-template`, { method: 'POST', body: JSON.stringify({ template_id: entry.template }) });
            return pgApplyFlow(f.id, entry.targets);
        } catch (err) { return setStatus('Could not make a flow from that template: ' + err.message); }
    }
    try {
        if (entry.kind === 'shot') {
            const description = String(text || '').trim();
            if (!description) return setStatus('A shot needs a line saying what happens in it; nothing was added.');
            const r = await api(`/shots/${entry.after}/insert-after`, { method: 'POST', body: JSON.stringify({ card: { description } }) });
            key = 'shot:' + (r.shot_id || (r.shot && r.shot.id));
        } else if (entry.kind === 'sound') {
            if (!entry.scene_id) return setStatus('A cue scores a scene; there are no shots yet to find one from.');
            const r = await api(`/projects/${pid}/music-cues`, { method: 'POST',
                body: JSON.stringify({ cue_type: entry.cue_type, title: entry.label.split(' cue')[0], scene_id: entry.scene_id }) });
            key = 'sound:' + r.id;
        } else if (entry.kind === 'pattern') {
            const r = await api(`/projects/${pid}/production-graph/patterns/${encodeURIComponent(entry.pattern)}`,
                { method: 'POST', body: JSON.stringify({ after_shot_id: entry.after }) });
            key = 'seq:' + r.sequence_id;
            setStatus(`Added ${(r.shot_ids || []).length} shots and their sequence. Nothing was generated.`);
        } else if (entry.kind === 'sequence') {
            // A plan row, free: the same helper the graph's empty sequence uses.
            const r = await pgCreateSequence({ name: entry.name, shot_ids: entry.shot_ids });
            key = 'seq:' + r.sequence.id;
            if (PG.picked) PG.picked.clear();
        }
        if (key) {
            await api(`/projects/${pid}/production-graph/layout`, { method: 'PUT',
                body: JSON.stringify({ nodes: [{ key, x: Math.round(at.x), y: Math.round(at.y) }] }) });
            PG.sel = key;
        }
        await loadProductionGraph();
    } catch (err) { setStatus('Could not add it: ' + err.message); }
}

/** A held node is dimmed and carries a "held" badge: batch runs skip it, the film keeps it (PGN-016). */
function pgHoldDecorate(html, n) {
    if (!n || !n.held) return html;
    const marked = html.replace('class="pg-node', 'class="pg-node held');
    const open = marked.indexOf('>');
    const badge = `<div class="pg-held" title="Held${n.held_at ? ' since ' + esc(n.held_at) : ''} \u2014 batch runs skip it; it stays in the film. Ctrl+B releases it.">held</div>`;
    return open < 0 ? marked : marked.slice(0, open + 1) + badge + marked.slice(open + 1);
}

/** The node types that can be held, and the update route each already has (lib/graph-hold.js HOLDABLE). */
const PG_HOLD_ROUTES = Object.freeze({
    shot: id => `/shots/${id}`,
    sequence: id => `/sequences/${id}`,
    sound: id => `/music-cues/${id}`,
});

/** Hold or release a node through its own update route. */
async function pgToggleHold(key) {
    const n = pgNode(key);
    if (!n || !PG_HOLD_ROUTES[n.type]) return;
    const hold = !n.held;
    try {
        await api(PG_HOLD_ROUTES[n.type](n.id), { method: 'PUT', body: JSON.stringify({ held: hold }) });
        setStatus(hold ? 'Held \u2014 batch runs will skip it. It stays in the film.' : 'Released \u2014 batch runs include it again.');
        await loadProductionGraph();
    } catch (err) { setStatus('Could not change the hold: ' + err.message); }
}

/** An edge into a node that is behind takes that state's colour. */
function pgEdgeColor(base, to) {
    const s = to && to.impact && to.impact.state;
    return (s === 'redo' || s === 'waiting') ? PG_IMPACT_LOOK[s].color : base;
}

function pgLegendHtml(nodes, on) {
    const counts = {};
    for (const n of nodes || []) { const s = n.impact && n.impact.state; if (s) counts[s] = (counts[s] || 0) + 1; }
    const behind = (nodes || []).filter(pgBehind).length;
    const keys = Object.keys(PG_IMPACT_LOOK);
    return keys.map(s => `<span class="pg-leg imp-${s}" title="${esc(PG_IMPACT_LOOK[s].label)}"><i></i>${counts[s] || 0} ${esc(PG_IMPACT_LOOK[s].label)}</span>`).join('')
        + `<button class="pg-chip${on ? ' on' : ''}" onclick="pgToggleBehind()" title="Show only what is behind and what it belongs to">Only what's behind (${behind})</button>`;
}

/**
 * The confirmation's body for "Run what changed" (PGN-007): every item with its
 * price, the total, everything left out with why, and a budget refusal said
 * before the button that would spend.
 */
function pgRunChangedDescribe(plan) {
    const p = plan || {};
    const money = v => '$' + (Number(v) || 0).toFixed(2);
    const who = it => esc(it.shot_code || (it.scene_id ? 'scene' : it.key || ''));
    const items = (p.items || []).map(it => `<li><b>${who(it)}</b> · ${esc(it.stage)} · ${money(it.cost)}${it.why ? `<div class="text-muted" style="font-size:12px;">${esc(it.why)}</div>` : ''}</li>`).join('');
    const skipped = (p.skipped || []).map(it => `<li><b>${who(it)}</b> · ${esc(it.stage)} — ${esc(it.reason)}</li>`).join('');
    const refused = p.refused
        ? `<p style="color:#f06a4a;">Over budget: this run would take the project past its budget${p.budget && p.budget.limit ? ` of ${money(p.budget.limit)}` : ''}. Nothing will run unless you raise the budget.</p>` : '';
    return `${refused}<p>${(p.items || []).length} to redo, in this order, about <b>${money(p.total_cost)}</b>. Each runs one at a time; anything waiting runs once what it waits on is done.</p>
        ${items ? `<ol style="padding-left:18px;margin:6px 0;">${items}</ol>` : '<p class="text-muted">Nothing can be redone right now.</p>'}
        ${skipped ? `<details><summary>Left out (${(p.skipped || []).length})</summary><ul style="padding-left:18px;">${skipped}</ul></details>` : ''}`;
}

/** "Run what changed": the free plan in the one confirmation, then the run in the background. */
async function pgRunChanged() {
    if (!state.currentProject) return;
    const pid = state.currentProject.id;
    return confirmPaidImage({
        capability: 'image',
        title: 'Run what changed',
        previewUrl: `/projects/${pid}/production-graph/run-changed/plan`,
        describe: pgRunChangedDescribe,
        send: async () => {
            try {
                const r = await api(`/projects/${pid}/production-graph/run-changed`, { method: 'POST', body: '{}' });
                setStatus(r && r.run_id ? `Running ${r.plan.items.length} item(s) that changed…` : (r && r.message) || 'Nothing is behind.');
                pgPollRunning();
            } catch (err) { setStatus('Run what changed failed: ' + err.message, true); }
        },
    });
}

/** The queue strip's buckets — exactly the server's QUEUE_BUCKETS (PGN-011). */
const PG_QUEUE_LABELS = Object.freeze({
    running: 'Running', waiting: 'Waiting', paused: 'Waiting for a pick', done_today: 'Done today',
    awaiting_collection: 'Waiting to be collected', failed: 'Failed',
});

/**
 * The strip, from one queue read. Collapsed: the counts. Open: every bucket,
 * each item panning to its node; Collect only where a provider holds the job,
 * Re-run only on a failure — through the node's own run and its confirmation.
 */
function pgQueueHtml(q, open, labelOf) {
    if (!q) return '';
    const name = it => (it.key && labelOf ? labelOf(it.key) : '') || it.shot_code || it.provider || 'job';
    const counts = Object.keys(PG_QUEUE_LABELS).map(b => `<span class="pg-qcount" data-count="${b}">${esc(PG_QUEUE_LABELS[b])} ${Number((q.counts || {})[b] || 0)}</span>`).join('');
    const head = `<div class="pg-qhead"><button class="pg-sbtn" onclick="pgToggleQueue()">${open ? 'Hide queue' : 'Queue'}</button>${counts}</div>`;
    if (!open) return head;
    const total = Object.keys(PG_QUEUE_LABELS).reduce((n, b) => n + (q[b] || []).length, 0);
    if (!total) return head + '<div class="pg-qempty">Nothing running, waiting or finished today.</div>';
    const row = (b, it) => {
        const go = it.key ? ` onclick="pgQueueGo('${esc(it.key)}')" role="button" tabindex="0"` : '';
        const detail = it.kind === 'flow_run'
            ? [it.flow_name, b === 'failed' ? (it.error || 'failed') : (b === 'paused' ? 'waiting for a pick' : '')].filter(Boolean).join(' · ')
            : b === 'running'
            ? [it.phase, it.percent != null ? Math.round(it.percent) + '%' : null].filter(Boolean).join(' · ')
            : (b === 'failed' ? (it.error || 'failed') : (it.stage || it.capability || ''));
        // A flow run (FOG-007): a paused one opens its shot, where the variations are picked; a live one can be cancelled.
        const flowAct = it.kind === 'flow_run'
            ? `${b === 'paused' && it.key ? `<button class="pg-sbtn primary" onclick="event.stopPropagation();pgQueueGo('${esc(it.key)}')" title="Open the shot: its variations are in the drawer">Pick</button>` : ''}${
               it.cancel ? `<button class="pg-sbtn" onclick="event.stopPropagation();pgFlowCancelRun('${esc(it.run_id)}')" title="Stops before its next node; anything it made stays on the shot">Cancel run</button>` : ''}${
               it.flow_id ? `<button class="pg-sbtn" onclick="event.stopPropagation();pgEditFlow('${esc(it.flow_id)}')" title="Open this flow on the Flows canvas">Edit flow</button>` : ''}`
            : null;
        const act = flowAct !== null ? flowAct : b === 'awaiting_collection' ? `<button class="pg-sbtn" onclick="event.stopPropagation();pgQueueCollect('${esc(it.job_id)}')">Collect</button>`
            : (b === 'failed' && it.key ? `<button class="pg-sbtn" onclick="event.stopPropagation();pgQueueRerun('${esc(it.key)}')">Re-run</button>`
            // Cancel only where the provider really stops; otherwise say what "stop waiting" does (PGN-012).
            : (b === 'running' && it.cancel === 'provider' ? `<button class="pg-sbtn" onclick="event.stopPropagation();pgQueueCancel('${esc(it.job_id)}')">Cancel</button>`
            : (b === 'running' && it.cancel === 'stop_waiting' ? `<button class="pg-sbtn" onclick="event.stopPropagation();pgQueueCancel('${esc(it.job_id)}')" title="${esc((it.provider || 'This provider') + ' cannot be told to stop. It may still finish and bill; the job stays collectable.')}">Stop waiting</button>`
            : (b === 'waiting' && it.run_id ? `<button class="pg-sbtn" onclick="event.stopPropagation();pgQueueCancelRun('${esc(it.run_id)}')" title="Stops before its next step">Cancel run</button>` : ''))));
        return `<div class="pg-qitem"${go}>${it.thumb ? `<img src="${esc(pgThumb(it.thumb, 96))}" alt="" loading="lazy">` : '<span class="pg-qnothumb"></span>'}
            <span class="pg-qname">${esc(name(it))}</span><span class="pg-qdetail">${esc(detail)}</span>${act}</div>`;
    };
    const sections = Object.keys(PG_QUEUE_LABELS).filter(b => (q[b] || []).length)
        .map(b => `<div class="pg-qsec" data-bucket="${b}"><div class="pg-qtitle">${esc(PG_QUEUE_LABELS[b])}</div>${q[b].map(it => row(b, it)).join('')}</div>`).join('');
    return head + `<div class="pg-qbody">${sections}</div>`;
}

function pgQueueLabel(key) {
    const n = pgNode(key);
    return n ? (n.shot_code || n.name || n.title || n.parent_label || '') : '';
}

async function pgLoadQueue() {
    if (!state.currentProject) return;
    const pid = state.currentProject.id;
    try {
        const q = await api('/projects/' + pid + '/production-graph/queue');
        if (!state.currentProject || state.currentProject.id !== pid) return;
        PG.queue = q;
    } catch (_) { /* the strip keeps its last read */ }
    const el = document.getElementById('pgQueue');
    if (el) el.innerHTML = pgQueueHtml(PG.queue, PG.queueOpen, pgQueueLabel);
}

function pgToggleQueue() {
    PG.queueOpen = !PG.queueOpen;
    const el = document.getElementById('pgQueue');
    if (el) el.innerHTML = pgQueueHtml(PG.queue, PG.queueOpen, pgQueueLabel);
}

function pgQueueGo(key) { if (!pgNode(key)) return; pgSelect(key); pgPanTo(key); }

/** Collect a job a provider still holds — free; it fetches what was already paid for. */
async function pgQueueCollect(jobId) {
    try {
        const r = await api('/generation-jobs/' + encodeURIComponent(jobId) + '/collect', { method: 'POST', body: '{}' });
        setStatus(r && r.pending ? 'Not finished yet — it stays in the queue.' : 'Collected.');
    } catch (err) { setStatus('Collect failed: ' + err.message, true); }
    await loadProductionGraph();
}

/** Cancel a running job: a real cancel, or "stop waiting" with the provider's billing warning. */
async function pgQueueCancel(jobId) {
    try {
        const r = await api('/generation-jobs/' + encodeURIComponent(jobId) + '/cancel', { method: 'POST', body: '{}' });
        setStatus((r && (r.warning || r.message)) || 'Cancelled.');
    } catch (err) { setStatus('Cancel failed: ' + err.message, true); }
    pgLoadQueue();
}

/** Cancel a batch run: it stops before its next step. */
async function pgQueueCancelRun(runId) {
    if (!state.currentProject) return;
    try {
        const r = await api(`/projects/${state.currentProject.id}/production-graph/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' });
        setStatus((r && r.message) || 'Cancelled.');
    } catch (err) { setStatus('Cancel failed: ' + err.message, true); }
    pgLoadQueue();
}

/** Re-run a failed node through its own run, so it goes through the one confirmation. */
function pgQueueRerun(key) { if (pgNode(key)) return pgRunNode(key); }

function pgToggleBehind() { PG.behindOnly = !PG.behindOnly; pgRender(); pgFit(); }

/** The drawer's explanation for a node that is not current. */
function pgImpactDrawerHtml(n) {
    const im = n && n.impact;
    if (!im || im.state === 'current' || !PG_IMPACT_LOOK[im.state]) return '';
    return `<div class="pg-dsec pg-impbox imp-${esc(im.state)}"><div class="pg-kicker"><span>${esc(PG_IMPACT_LOOK[im.state].label)}</span></div>
        <div>${esc(im.why || '')}</div>${im.action ? `<div class="pg-dsub">${esc(im.action)}</div>` : ''}
        ${(im.badges || []).map(b => `<div class="pg-dsub">${esc(b.stage)}: ${esc(b.state)}</div>`).join('')}</div>`;
}

async function pgTidy() {
    try {
        const g = await api(`/projects/${state.currentProject.id}/production-graph/tidy`, { method: 'POST', body: '{}' });
        PG.graph = g; PG.byKey = new Map(g.nodes.map(n => [n.key, n]));
        pgRender();
        setStatus(`Tidied. Nodes you moved stayed where you put them.`);
    } catch (err) { setStatus('Could not tidy: ' + err.message); }
}

async function pgToggleLock() {
    await toggleBoardLock();
    loadProductionGraph();
}

function pgOpenMenu(x, y, key, group) {
    const m = document.getElementById('pgMenu');
    const n = key ? pgNode(key) : null;
    const items = [];
    if (n) {
        PG.menuFor = key;
        const runLabel = { shot: n.frames && n.frames.length ? 'Regenerate frame' : 'Generate frame', sequence: 'Generate sequence',
            sound: 'Generate sound', video: 'Play this version', audio: 'Play this version', link: 'Open the source sequence',
            inbetween: n.made ? 'Make the frames again' : 'Make the frames' }[n.type];
        if (runLabel) items.push(`<button onclick="pgMenuDo('run')">${runLabel}</button>`);
        // Only where the server can plan it (PGN-009); the set is held equal to run-to-here TARGETS.
        if (PG_RUN_TO_HERE_TYPES.includes(n.type)) items.push(`<button onclick="pgMenuDo('to-here')" title="Make everything this still needs, in order, after one confirmation">Run to here</button>`);
        if (n.type === 'shot' || n.type === 'sequence' || n.type === 'sound') items.push(`<button onclick="pgMenuDo('dup')">Duplicate</button>`);
        if (n.type === 'shot') items.push(`<button onclick="pgMenuDo('ib-next')" title="Frames between this shot and the next, each directed on its own">In-betweens to the next shot…</button>`);
        if (n.type === 'inbetween') items.push(`<button onclick="pgMenuDo('ib-direct')">Direct the stretch…</button>`, `<button onclick="pgMenuDo('ib-spacing')">Spacing…</button>`);
        const upWhy = pgUpscaleWhyNot(n);
        if (upWhy !== undefined) items.push(upWhy ? `<button disabled title="${esc(upWhy)}">Upscale…</button>`
            : `<button onclick="pgMenuDo('upscale')" title="Enlarge this clip to the delivery size on MuAPI, after one confirmation">Upscale…</button>`);
        items.push(pgApplyMenuItem(n, PG.picked.size));
        if (PG_HOLD_ROUTES[n.type]) items.push(`<button onclick="pgMenuDo('hold')" title="Batch runs skip a held node; the film keeps it (Ctrl+B)">${n.held ? 'Release hold' : 'Hold'}</button>`);
        const removable = n.type === 'sequence' || n.type === 'sound' || n.type === 'link' || n.type === 'inbetween' || (n.type === 'shot' && n.sequence_id);
        items.push(`<button onclick="pgMenuDo('remove')" ${removable ? '' : 'disabled title="A shot leaves the film on the Scenes page, not here"'}>${
            n.type === 'shot' ? 'Remove from its sequence' : 'Remove from graph'}</button>`);
    } else if (group) {
        PG.menuFor = null;
        items.push(`<button onclick="pgRunPending()">Run pending</button>`);
        items.push(`<button onclick="pgTidy()">Tidy layout</button>`);
    }
    m.innerHTML = items.join('');
    m.style.left = x + 'px'; m.style.top = y + 'px';
    m.hidden = false;
}
function pgCloseMenu() { const m = document.getElementById('pgMenu'); if (m) m.hidden = true; }

async function pgMenuDo(what) {
    const n = pgNode(PG.menuFor);
    pgCloseMenu();
    if (!n) return;
    if (what === 'run') {
        if (n.type === 'link') { const src = pgNode('seq:' + n.source_sequence_id); if (src) { pgSelect(src.key); pgPanTo(src.key); } return; }
        if (n.type === 'video' || n.type === 'audio') { pgSelect(n.key); pgSelectVersion(n.key); return; }
        if (n.type === 'inbetween') return ibGenerate(n.id, 0, false);
        return pgRunNode(n.key);
    }
    if (what === 'to-here') return pgRunToHere(n.key);
    if (what === 'ib-next') return ibStartFromShot(n);
    if (what === 'ib-direct') return ibOpenDirect(n.id);
    if (what === 'ib-spacing') return ibOpenSetupFor(n.id);
    if (what === 'apply') return pgOpenApplyFlow(n.key);
    if (what === 'hold') return pgToggleHold(n.key);
    if (what === 'dup') return pgDuplicate(n);
    if (what === 'upscale') return pgUpscale(n);
    if (what === 'remove') return pgRemove(n);
}

// ── Upscale a clip on the canvas ───────────────────────────────────────

/*
 * Which nodes can be upscaled: a shot (its selected clip) and a clip version of
 * a shot. undefined means the item is not offered; a string is why it is
 * disabled. A sequence clip is refused by name: its file belongs to the
 * sequence's first shot, so upscale it from that shot's version.
 */
function pgUpscaleWhyNot(n) {
    if (n.type === 'shot') return (n.videos && n.videos.length) || n.selected_video_asset_id ? '' : 'This shot has no clip yet.';
    if (n.type === 'video') {
        const parent = pgNode(n.parent);
        return parent && parent.type === 'shot' ? '' : 'A sequence clip is upscaled from its first shot\'s clip version.';
    }
    return undefined;
}
function pgUpscale(n) {
    const shot = n.type === 'shot' ? n : pgNode(n.parent);
    if (!shot) return;
    const assetId = n.type === 'video' ? n.asset_id : null;
    return confirmUpscale(shot.id, assetId, async body => {
        setStatus('Upscaling ' + (shot.shot_code || '') + '…', true);
        try {
            await api(`/shots/${shot.id}/post/upscale`, { method: 'POST', body: JSON.stringify(body) });
            setStatus('Upscaled ' + (shot.shot_code || ''));
        } catch (err) { setStatus('Upscale failed: ' + err.message); }
        if (typeof pgLoad === 'function') pgLoad();
    });
}

// ── Apply a flow to a selection (FOG-003) ──────────────────────────────

/** The node types a flow can be applied to — the server's APPLY_TARGETS, held equal by test. */
const PG_APPLY_TYPES = Object.freeze(['shot', 'sequence']);

/**
 * What an apply is sent for: the picks plus the node clicked, keeping only
 * nodes that can take a flow (a picked clip version would only be refused).
 */
function pgApplyTargets(picked, key, byKey) {
    const out = [];
    for (const k of [...(picked || []), key]) {
        const n = k && byKey.get(k);
        if (n && PG_APPLY_TYPES.includes(n.type) && !out.includes(k)) out.push(k);
    }
    return out;
}

/** The node menu's "Apply flow…": on every node, disabled with the reason where a flow cannot go. */
function pgApplyMenuItem(n, pickedCount) {
    if (PG_APPLY_TYPES.includes(n.type)) {
        const also = pickedCount ? ` (with ${pickedCount} picked)` : '';
        return `<button onclick="pgMenuDo('apply')" title="Run a flow on this, and on anything picked with Shift+click, after one confirmation">Apply flow…${esc(also)}</button>`;
    }
    const why = {
        video: 'A clip version is an output of its shot or sequence; apply the flow to that shot or sequence instead.',
        audio: 'A sound version is an output of its sound cue; a flow run binds one shot, so apply it to the shots of that scene instead.',
        sound: 'A sound cue belongs to a scene, and a flow run binds one shot\'s context; apply the flow to the scene\'s shots instead.',
        link: 'A borrowed frame is a reference between sequences, not a shot; apply the flow to the sequence that uses it instead.',
        inbetween: 'In-betweens are frames between two shots, made by their own node; apply the flow to either of the two shots instead.',
    }[n.type] || `A ${n.type} node cannot take a flow; apply it to a shot or a sequence.`;
    return `<button disabled title="${esc(why)}">Apply flow…</button>`;
}

/** The picker: the project's and the library's flows, then every ready-made template. */
/**
 * "Edit flow" from the graph (FOG-011). The Flows page is out of the menu while
 * the graph is on, so every surface that names a flow opens the canvas on that
 * flow. A history entry is pushed for the graph first — the router only ever
 * replaces — so the browser's Back returns to it, and the Flows page offers its
 * own Back to the graph.
 */
function pgEditFlow(flowId) {
    if (!flowId) return;
    if (typeof closeModal === 'function') closeModal('pgApplyModal');
    FLOW.editId = flowId;
    FLOW.returnTo = state.currentPage || 'productiongraph';
    FLOW.pushed = false;
    if (history.pushState) { history.pushState(null, '', location.hash); FLOW.pushed = true; }
    navigateTo('flows');
}
function flowBackToGraph() {
    const to = FLOW.returnTo || 'productiongraph';
    const pushed = FLOW.pushed;
    FLOW.returnTo = null; FLOW.pushed = false;
    const b = document.getElementById('flowBackToGraph');
    if (b) b.hidden = true;
    if (pushed && history.back) history.back();
    else navigateTo(to);
}
function pgApplyPickerHtml(flows, templates, targets) {
    const n = (targets || []).length;
    const flowRows = (flows || []).map(f => `<div style="display:flex;gap:4px;align-items:center;margin:3px 0;"><button class="pg-sbtn" style="flex:1;text-align:left;"
        onclick="pgApplyChoose('flow','${esc(f.id)}')"><b>${esc(f.name)}</b> <span class="text-muted text-sm">${esc(f.scope || '')}${f.node_count ? ' · ' + Number(f.node_count) + ' nodes' : ''}</span></button>
        <button class="pg-sbtn" onclick="pgEditFlow('${esc(f.id)}')" title="Open this flow on the Flows canvas">Edit flow</button></div>`).join('');
    const tplRows = (templates || []).map(t => `<button class="pg-sbtn" style="display:block;width:100%;text-align:left;margin:3px 0;"
        onclick="pgApplyChoose('template','${esc(t.id)}')"><b>${esc(t.name)}</b> <span class="text-muted text-sm">${esc(t.description || '')}</span></button>`).join('');
    return `<h3 style="margin-top:0;">Apply a flow</h3>
        <p class="text-sm text-muted">${n} selected. Pick a flow; the next screen shows what each shot binds and what it costs, and nothing runs until you confirm.</p>
        <div class="text-sm" style="margin:8px 0 4px;"><b>Flows</b></div>
        ${flowRows || '<p class="text-sm text-muted">No flows yet in this project or the library.</p>'}
        <div class="text-sm" style="margin:12px 0 4px;"><b>Templates</b> <span class="text-muted">(picking one saves it as a flow in this project)</span></div>
        ${tplRows || '<p class="text-sm text-muted">No templates.</p>'}
        <div style="text-align:right;margin-top:12px;"><button class="pg-sbtn" onclick="closeModal('pgApplyModal')">Cancel</button></div>`;
}

/** A plan can be confirmed only when it has loaded, something can run, and it is within budget. */
function pgApplyArmable(plan) {
    return !!(plan && Number(plan.runs) > 0 && !(plan.budget && plan.budget.wouldExceed));
}

/** The confirmation body for an apply: every target, every shot's bindings and cost, held shots, the budget. */
function pgApplyPlanDescribe(plan) {
    const p = plan || {};
    const money = v => '$' + (Number(v) || 0).toFixed(2);
    const refused = (p.targets || []).filter(t => t.status === 'refused')
        .map(t => `<li><b>${esc(t.key)}</b>${t.type ? ' (' + esc(t.type) + ')' : ''} — ${esc(t.reason)}</li>`).join('');
    const shots = (p.shots || []).map(s => {
        const binds = (s.bindings || []).map(b => `${esc(b.label || b.type)} ← ${esc(b.binds)}${b.value ? ': ' + esc(String(b.value).slice(0, 80)) : ''}`).join('<br>');
        const notes = [...(s.reasons || []).map(r => `<div style="color:#f06a4a;">${esc(r)}</div>`),
            ...(s.warnings || []).map(w => `<div style="color:var(--warning,#b8860b);">${esc(w)}</div>`)].join('');
        return `<li><b>${esc(s.shot_code)}</b> · ${s.status === 'ok' ? money(s.cost) : 'will not run'}
            ${binds ? `<div class="text-muted" style="font-size:12px;">${binds}</div>` : ''}${notes}</li>`;
    }).join('');
    const held = (p.held || []).map(h => `<li><b>${esc(h.shot_code)}</b> — ${esc(h.reason || 'held')}</li>`).join('');
    const b = p.budget || {};
    const over = b.wouldExceed
        ? `<p style="color:#f06a4a;">Over budget: ${money(p.total_cost)} on top of ${money(b.spent)} already spent passes the ${money(b.limit)} budget.</p>
           <label class="text-sm"><input type="checkbox" id="pgApplyIgnoreBudget" onchange="pgApplyBudgetToggle(this.checked)"> Go over the budget deliberately</label>`
        : '';
    const none = !Number(p.runs) ? '<p style="color:#f06a4a;">Nothing in the selection can run, so there is nothing to confirm.</p>' : '';
    return `<p>Apply <b>${esc(p.flow_name || 'this flow')}</b>: ${Number(p.runs) || 0} run${Number(p.runs) === 1 ? '' : 's'}, one per shot, one at a time, about <b>${money(p.total_cost)}</b>.</p>
        ${over}${none}
        ${shots ? `<ol style="padding-left:18px;margin:6px 0;">${shots}</ol>` : ''}
        ${refused ? `<details open><summary>Cannot take this flow (${(p.targets || []).filter(t => t.status === 'refused').length})</summary><ul style="padding-left:18px;">${refused}</ul></details>` : ''}
        ${held ? `<details open><summary>Held, left out (${(p.held || []).length})</summary><ul style="padding-left:18px;">${held}</ul></details>` : ''}`;
}

/** Over budget, the deliberate override is the only thing that arms Confirm. */
function pgApplyBudgetToggle(on) {
    const btn = document.getElementById('confirmGenGo');
    if (btn) btn.disabled = !on;
}

/** "Apply flow…": the picker for the picks plus this node. */
async function pgOpenApplyFlow(key) {
    if (!state.currentProject || !PG.graph) return;
    const targets = pgApplyTargets([...PG.picked], key, PG.byKey);
    if (!targets.length) { setStatus('Nothing selected can take a flow: pick shots or sequences.', true); return; }
    PG.applyTargets = targets;
    const pid = state.currentProject.id;
    let flows = [], templates = [];
    try {
        const [f, t] = await Promise.all([api(`/projects/${pid}/flows`), api('/flow-templates')]);
        flows = (f && f.flows) || []; templates = (t && t.templates) || [];
    } catch (err) { setStatus('Could not read the flows: ' + err.message, true); return; }
    showModalHtml('pgApplyModal', pgApplyPickerHtml(flows, templates, targets));
}

/** A flow or template picked: a template is saved as a flow first, then the plan and the one confirmation. */
async function pgApplyChoose(kind, id) {
    const targets = PG.applyTargets || [];
    closeModal('pgApplyModal');
    let flowId = id;
    if (kind === 'template') {
        try {
            const f = await api(`/projects/${state.currentProject.id}/flows/from-template`, { method: 'POST', body: JSON.stringify({ template_id: id }) });
            flowId = f && f.id;
        } catch (err) { setStatus('Could not make a flow from that template: ' + err.message, true); return; }
    }
    if (!flowId) return;
    // A flow with exposed inputs asks for them first (FOG-009); the values go through the plan.
    let form = null;
    try { form = await api(`/flows/${flowId}/form?project_id=${encodeURIComponent(state.currentProject.id)}`); } catch (_) { form = null; }
    if (form && ((form.fields || []).length || (form.not_fillable || []).length)) {
        PG.applyForm = { flowId, targets };
        return showModalHtml('pgApplyModal', pgFlowFormHtml(form));
    }
    return pgApplyFlow(flowId, targets);
}

/** A flow's form (FOG-009): each exposed input as its control, the node's own value as the default. */
function pgFlowFormHtml(form) {
    const f = form || {};
    const field = x => {
        const id = `pgForm_${x.node_id}`;
        if (x.control === 'text') {
            return `<label for="${esc(id)}">${esc(x.label)}</label>
                <textarea id="${esc(id)}" rows="3" data-form-node="${esc(x.node_id)}" style="width:100%;">${esc(x.default || '')}</textarea>`;
        }
        const opts = (x.options || []).map(o => {
            const v = x.control === 'asset' ? o.id : o.name;
            return `<option value="${esc(v)}" ${v === x.default ? 'selected' : ''}>${esc(o.name)}${o.kind ? ' · ' + esc(o.kind) : ''}${o.asset_type ? ' · ' + esc(o.asset_type) : ''}</option>`;
        }).join('');
        const own = x.control === 'asset' ? 'the asset set on the node' : 'the node\'s own (or each shot\'s first character)';
        return `<label for="${esc(id)}">${esc(x.label)}</label>
            <select id="${esc(id)}" data-form-node="${esc(x.node_id)}" style="width:100%;"><option value="">${esc(own)}</option>${opts}</select>`;
    };
    const fields = (f.fields || []).map(field).join('');
    const notes = (f.not_fillable || []).map(n => `<p class="text-sm text-muted">${esc(n.label)}: ${esc(n.why)}</p>`).join('');
    const edit = f.flow_id ? ` <button class="pg-sbtn" onclick="pgEditFlow('${esc(f.flow_id)}')" title="Change the flow itself on the Flows canvas instead of filling it in">Edit flow</button>` : '';
    return `<h3 style="margin-top:0;">${esc(f.flow_name || 'Flow')}${edit}</h3>
        <p class="text-sm text-muted">Fill in the flow's inputs. The next screen shows what each shot binds and what it costs; nothing runs until you confirm.</p>
        ${fields}${notes}
        <div style="text-align:right;margin-top:12px;">
          <button class="pg-sbtn" onclick="closeModal('pgApplyModal')">Cancel</button>
          <button class="pg-sbtn primary" onclick="pgFlowFormSubmit()">Plan and confirm</button></div>`;
}

/** The form's values, into the plan and the one confirmation. */
function pgFlowFormSubmit() {
    const f = PG.applyForm;
    if (!f) return;
    const values = {};
    document.querySelectorAll('#pgApplyModal [data-form-node]').forEach(el => { if (el.value !== '') values[el.dataset.formNode] = el.value; });
    closeModal('pgApplyModal');
    PG.applyForm = null;
    return pgApplyFlow(f.flowId, f.targets, values);
}

/** The free plan in the one confirmation, then the apply with that plan's fingerprint. */
async function pgApplyFlow(flowId, targets, inputs) {
    const pid = state.currentProject.id;
    let plan = null;
    const form = inputs && Object.keys(inputs).length ? inputs : null;
    return confirmPaidImage({
        capability: 'image',
        title: 'Apply flow',
        previewUrl: `/flows/${flowId}/apply-plan?project_id=${encodeURIComponent(pid)}&targets=${encodeURIComponent(targets.join(','))}`
            + (form ? `&inputs=${encodeURIComponent(JSON.stringify(form))}` : ''),
        describe: d => { plan = d; return pgApplyPlanDescribe(d); },
        armable: pgApplyArmable,
        send: async () => {
            if (!plan) return;
            const box = document.getElementById('pgApplyIgnoreBudget');
            try {
                const r = await api(`/flows/${flowId}/apply`, { method: 'POST', body: JSON.stringify({
                    project_id: pid, targets, fingerprint: plan.fingerprint, ignore_budget: !!(box && box.checked),
                    ...(form ? { inputs: form } : {}) }) });
                PG.picked = new Set();
                setStatus(r && r.apply_id ? `Applying: ${(r.runs || []).length} run(s) — ${r.summary || ''}` : (r && r.error) || 'Nothing was started.');
                pgPollRunning();
            } catch (err) { setStatus('Apply failed: ' + err.message, true); }
        },
    });
}

/** The node types "Run to here" can start from — the server's run-to-here TARGETS. */
const PG_RUN_TO_HERE_TYPES = Object.freeze(['shot', 'video', 'sequence', 'sound']);

/** The confirmation body for "Run to here": each step with its price, the total, or what blocks it. */
function pgRunToHereDescribe(plan) {
    const p = plan || {};
    const money = v => '$' + (Number(v) || 0).toFixed(2);
    if ((p.blockers || []).length) {
        return `<p style="color:#f06a4a;">This cannot run yet:</p><ul style="padding-left:18px;">${p.blockers.map(b => `<li>${esc(b.reason)}</li>`).join('')}</ul>`;
    }
    // A held node is left out of the run and said so here: approving a
    // sequence built around a frame the hold kept stale must not be a surprise.
    const heldList = (p.held || []).map(h => `<li><b>${esc(h.label || h.shot_code || h.key || '')}</b> — ${esc(h.reason || 'held')}</li>`).join('');
    const heldHtml = heldList ? `<details open><summary>Held, left out (${(p.held || []).length})</summary><ul style="padding-left:18px;">${heldList}</ul></details>` : '';
    if (!(p.items || []).length) return `<p>${esc(p.summary || 'Nothing to do: everything this needs is already made and current.')}</p>${heldHtml}`;
    const who = it => esc(it.shot_code || it.name || it.key || '');
    const rows = p.items.map(it => `<li><b>${who(it)}</b> · ${esc(it.stage)}${it.legs ? ` · ${it.legs} leg${it.legs === 1 ? '' : 's'}` : ''} · ${money(it.cost)}${it.why ? `<div class="text-muted" style="font-size:12px;">${esc(it.why)}</div>` : ''}</li>`).join('');
    const over = p.refused ? `<p style="color:#f06a4a;">Over budget: this would take the project past its budget. Nothing will run unless you raise it.</p>` : '';
    return `${over}<p>${p.items.length} step${p.items.length === 1 ? '' : 's'}, in this order, about <b>${money(p.total_cost)}</b>. It stops at the first refusal.</p><ol style="padding-left:18px;margin:6px 0;">${rows}</ol>${heldHtml}`;
}

/** "Run to here": the node's free plan in the one confirmation, then the steps in order. */
async function pgRunToHere(key) {
    if (!state.currentProject) return;
    const pid = state.currentProject.id;
    const k = encodeURIComponent(key);
    return confirmPaidImage({
        capability: 'image',
        title: 'Run to here',
        previewUrl: `/projects/${pid}/production-graph/nodes/${k}/run-to-here/plan`,
        describe: pgRunToHereDescribe,
        send: async () => {
            try {
                const r = await api(`/projects/${pid}/production-graph/nodes/${k}/run-to-here`, { method: 'POST', body: '{}' });
                setStatus(r && r.run_id ? `Running ${r.plan.items.length} step(s)…` : (r && r.message) || 'Nothing to do.');
                pgPollRunning();
            } catch (err) { setStatus('Run to here failed: ' + err.message, true); }
        },
    });
}

async function pgDuplicate(n) {
    const pid = state.currentProject.id;
    try {
        if (n.type === 'shot') {
            const r = await api(`/shots/${n.id}/insert-after`, { method: 'POST', body: JSON.stringify({ card: { description: n.description || n.shot_code } }) });
            setStatus((r && r.note) || 'Shot duplicated after ' + n.shot_code + '.');
        } else if (n.type === 'sequence') {
            await pgCreateSequence({ name: n.name + ' copy', description: n.description });
            setStatus(`A copy of ${n.name} was made without its shots — a shot belongs to one sequence.`);
        } else if (n.type === 'sound') {
            await api(`/projects/${pid}/music-cues`, { method: 'POST', body: JSON.stringify({
                cue_type: n.cue_type, title: (n.title || 'Sound') + ' copy', description: n.description, scene_id: n.scene_id,
                ...(n.sequence_id ? { sequence_id: n.sequence_id } : n.shot_id ? { shot_id: n.shot_id } : {}),
                mood: n.mood, genre: n.genre, negative_prompt: n.negative_prompt, duration_ms: n.duration_ms }) });
            setStatus('Sound duplicated. Its versions stay with the original.');
        }
        loadProductionGraph();
    } catch (err) { setStatus('Could not duplicate: ' + err.message); }
}

async function pgRemove(n) {
    try {
        if (n.type === 'shot' && n.sequence_id) {
            const seq = pgNode('seq:' + n.sequence_id);
            await api('/sequences/' + seq.id, { method: 'PUT', body: JSON.stringify({ shot_ids: seq.shot_ids.filter(id => id !== n.id) }) });
            setStatus(`${n.shot_code} left ${seq.name}. The shot and its frames are kept.`);
        } else if (n.type === 'sequence') {
            if (!confirm(`Remove the sequence "${n.name}"?\n\nIts shots stay, and every clip it generated stays on its shots.`)) return;
            await api('/sequences/' + n.id, { method: 'DELETE' });
        } else if (n.type === 'sound') {
            if (!confirm(`Remove "${n.title || 'this sound'}"?\n\nAny audio it generated stays in the project.`)) return;
            await api('/music-cues/' + n.id, { method: 'DELETE' });
        } else if (n.type === 'link') {
            await api('/sequences/' + n.sequence_id, { method: 'PUT', body: JSON.stringify({ [n.side + '_frame_ref']: null }) });
        } else if (n.type === 'inbetween') {
            if (!confirm(`Remove the in-betweens ${n.from_code} → ${n.to_code}?\n\nThe pictures it made stay in the asset list, and a clip made from it stays on ${n.from_code}.`)) return;
            await api('/inbetweens/' + n.id, { method: 'DELETE' });
        }
        if (PG.sel === n.key) PG.sel = null;
        loadProductionGraph();
    } catch (err) { setStatus('Could not remove: ' + err.message); }
}

/** Drop from the palette or the outline: a new node where it was dropped. */
async function pgAddAt(what, at) {
    const pid = state.currentProject.id;
    const shots = pgShots();
    const scene = PG.scene !== 'all' ? PG.scene : (shots[0] && shots[0].scene_id);
    let key = null;
    try {
        if (what.startsWith('shot:')) {
            key = what;
        } else if (what === 'new:shot') {
            const last = shots.filter(s => !scene || s.scene_id === scene).slice(-1)[0];
            if (!last) return setStatus('A new shot is added after an existing one; break the screenplay into shots first.');
            const description = prompt(`New shot after ${last.shot_code}. What happens in it?`);
            if (!description || !description.trim()) return;
            const r = await api(`/shots/${last.id}/insert-after`, { method: 'POST', body: JSON.stringify({ card: { description: description.trim() } }) });
            key = r && (r.shot_id || (r.shot && r.shot.id)) ? 'shot:' + (r.shot_id || r.shot.id) : null;
        } else if (what === 'new:sequence') {
            const name = prompt('Name the sequence', 'New sequence');
            if (name === null) return;
            const r = await pgCreateSequence({ name: name || 'New sequence' });
            key = 'seq:' + r.sequence.id;
        } else if (what.startsWith('new:sound:')) {
            const kind = PG_KIND[what.split(':')[2]];
            if (!scene) return setStatus('A sound scores a scene; there are no scenes yet.');
            const r = await api(`/projects/${pid}/music-cues`, { method: 'POST', body: JSON.stringify({ cue_type: kind.cue, title: kind.label, scene_id: scene }) });
            key = 'sound:' + r.id;
        } else if (what === 'new:link') {
            return pgLinkChooser();
        }
        if (key) {
            await api(`/projects/${pid}/production-graph/layout`, { method: 'PUT',
                body: JSON.stringify({ nodes: [{ key, x: Math.round(at.x), y: Math.round(at.y) }] }) });
            PG.sel = key;
        }
        await loadProductionGraph();
    } catch (err) { setStatus('Could not add it: ' + err.message); }
}

/**
 * A new, empty sequence. FREE: it writes a plan row and generates nothing —
 * shots are wired into it afterwards.
 */
function pgCreateSequence(fields) {
    // Empty unless shots are given (the add palette's "sequence from the picked shots").
    return api(`/projects/${state.currentProject.id}/sequences`, {
        method: 'POST', body: JSON.stringify({ shot_ids: [], ...fields, empty: true }) });
}

/** A linked frame joins two sequences, so it needs both named. */
function pgLinkChooser() {
    const seqs = (PG.graph.nodes || []).filter(n => n.type === 'sequence');
    if (seqs.length < 2) return setStatus('A linked frame borrows from one sequence into another — make two sequences first.');
    const opts = seqs.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    showModalHtml('pgLinkModal', `<div class="modal-header"><h3>Link a frame</h3></div>
        <div class="modal-body">
          <label class="pg-l">Borrow from</label><select id="pgLinkFrom">${opts}</select>
          <label class="pg-l">Into</label><select id="pgLinkTo">${opts}</select>
          <label class="pg-l">As its</label><select id="pgLinkSide"><option value="start">start frame (takes the source's last frame)</option>
            <option value="end">end frame (takes the source's first frame)</option></select>
          <label class="pg-l">Which picture</label><select id="pgLinkMode"><option value="shot_image">the shot's selected image</option>
            <option value="video_last_frame">a frame of the source's selected video</option></select>
          <p class="text-sm text-muted" style="margin-top:10px;">Never membership: the borrowed frame is a keyframe, and is not played twice.</p>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal('pgLinkModal')">Cancel</button>
          <button class="btn btn-primary" onclick="pgLinkSave()">Link</button></div>`);
}

async function pgLinkSave() {
    const from = document.getElementById('pgLinkFrom').value, to = document.getElementById('pgLinkTo').value;
    const side = document.getElementById('pgLinkSide').value, mode = document.getElementById('pgLinkMode').value;
    try {
        await api('/sequences/' + to, { method: 'PUT', body: JSON.stringify({ [side + '_frame_ref']: { sequence_id: from, mode } }) });
        closeModal('pgLinkModal');
        await loadProductionGraph();
        pgSelect(`link:${to}:${side}`);
    } catch (err) { setStatus('Could not link: ' + err.message); }
}

// ── Running ───────────────────────────────────────────────────────────────

async function pgBusy(key, label, work) {
    PG.busy.set(key, label);
    pgRender();
    pgPollRunning();
    try { return await work(); }
    finally { PG.busy.delete(key); await loadProductionGraph(); }
}

/** The node's own generate, through the same confirmation the old pages use. */
async function pgRunNode(key) {
    const n = pgNode(key);
    if (!n) return;
    if (n.type === 'shot') return pgBusy(key, n.frames.length ? 'regenerating frame' : 'generating frame', () => regenerateStoryboard(n.id));
    if (n.type === 'sequence') return pgGenerateSequence(n);
    if (n.type === 'sound') return pgGenerateSound(n);
}

/**
 * Every node whose selected output is missing. The free estimate comes first —
 * a frame's price from its own free preview, times the count — and nothing runs
 * until it has been seen, the rule the run plan already follows.
 */
async function pgRunPending() {
    pgCloseMenu();
    // A held node is left alone and named (PGN-017): the server leaves it out
    // of `pending` and lists it in `pending_held`; a node held since the graph
    // was read is caught here too.
    const all = (PG.graph.pending || []).filter(p => { const n = pgNode(p.key); return n && pgVisible(n); });
    const held = (PG.graph.pending_held || []).concat(all.filter(p => (pgNode(p.key) || {}).held));
    const pending = all.filter(p => !(pgNode(p.key) || {}).held);
    const heldNote = held.length ? ` ${held.length} held and left alone: ${held.map(h => h.label).join(', ')}.` : '';
    if (!pending.length) return setStatus('Nothing is pending that is not held.' + heldNote);
    const frames = pending.filter(p => p.action === 'frame'), sounds = pending.filter(p => p.action === 'sound');
    const first = pgNode((frames[0] || sounds[0]).key);
    /*
     * The one shared confirmation, read from the first item's own free preview,
     * with the whole list and the estimate stated — the rule the run plan and
     * every generate button follow: nothing spends before it has been seen.
     */
    return confirmPaidImage({
        capability: frames.length ? 'image' : 'music',
        title: `Run pending — ${pending.length} item${pending.length === 1 ? '' : 's'}`,
        previewUrl: frames.length ? `/shots/${first.id}/prompt` : `/music-cues/${first.id}/generate`,
        note: 'Costs credits. Each item is generated on its own, in running order.' + heldNote,
        describe: d => {
            const each = frames.length && d && d.estimated_cost && d.estimated_cost.usd != null ? Number(d.estimated_cost.usd) : null;
            return `<div class="text-sm" style="line-height:1.6;">
                ${frames.length ? `<div><strong>${frames.length} frame${frames.length === 1 ? '' : 's'}</strong>: ${esc(frames.map(f => f.label).join(', '))}
                  ${each != null ? `<span class="text-muted"> · about $${(each * frames.length).toFixed(2)}</span>` : ''}</div>` : ''}
                ${sounds.length ? `<div><strong>${sounds.length} sound${sounds.length === 1 ? '' : 's'}</strong>: ${esc(sounds.map(x => x.label).join(', '))}
                  <span class="text-muted"> · priced by the provider at generation</span></div>` : ''}
                <div class="text-muted" style="margin-top:6px;">First item's request: ${esc(String((d && d.prompt) || '').slice(0, 280))}${(d && d.prompt || '').length > 280 ? '…' : ''}</div></div>`;
        },
        send: async () => {
            setStatus(`Running ${pending.length} pending item${pending.length === 1 ? '' : 's'}…`, true);
            for (const f of frames) {
                const n = pgNode(f.key);
                PG.busy.set(f.key, 'generating frame'); pgRender();
                try { await api('/shots/' + n.id + '/storyboard/regenerate', { method: 'POST', body: '{}' }); }
                catch (err) { setStatus(`${n.shot_code}: ${err.message}`); }
                PG.busy.delete(f.key);
            }
            for (const x of sounds) {
                const n = pgNode(x.key);
                PG.busy.set(x.key, 'generating'); pgRender();
                try { await api('/music-cues/' + n.id + '/generate', { method: 'POST', body: '{}' }); }
                catch (err) { setStatus(`${n.title || 'sound'}: ${err.message}`); }
                PG.busy.delete(x.key);
            }
            await loadProductionGraph();
            setStatus('Pending work finished.');
        },
    });
}

// ── Versions ──────────────────────────────────────────────────────────────

/** Select a version: the pointer of its parent, so playback plays it. */
async function pgSelectVersion(key, off) {
    const v = pgNode(key);
    if (!v) return;
    const parent = pgNode(v.parent);
    try {
        if (v.type === 'audio') {
            await api('/music-cues/' + parent.id + '/select', { method: off ? 'DELETE' : 'POST', body: JSON.stringify({ asset_id: v.asset_id }) });
        } else if (parent.type === 'sequence') {
            await api('/sequences/' + parent.id + '/video/select', { method: off ? 'DELETE' : 'POST', body: JSON.stringify({ asset_id: v.asset_id }) });
        } else {
            await api('/shots/' + parent.id + '/video/select', { method: off ? 'DELETE' : 'POST', body: JSON.stringify({ asset_id: v.asset_id }) });
        }
        setStatus(off ? 'Unselected — playback falls back to the ordinary rule.' : `v${v.version} of ${v.parent_label} plays now.`);
        await loadProductionGraph();
    } catch (err) { setStatus('Could not select that version: ' + err.message); }
}

async function pgSelectFrame(shotId, version) {
    try {
        await api(`/shots/${shotId}/frames/${version}/restore`, { method: 'POST', body: '{}' });
        await loadProductionGraph();
    } catch (err) { setStatus('Could not select that frame: ' + err.message); }
}

// ── Drawer ────────────────────────────────────────────────────────────────

function pgDrawerOpen(on) {
    const d = document.getElementById('pgDrawer');
    const body = document.getElementById('pgBody');
    // Shown by a class, never by default: on a phone the drawer is a
    // full-screen sheet, and one visible with nothing selected covers the page.
    if (d) d.classList.toggle('open', !!on);
    if (body) body.classList.toggle('open', !!on);
}

function pgRenderDrawer() {
    const n = PG.sel ? pgNode(PG.sel) : null;
    if (!n) { pgDrawerOpen(false); pgRenderPlayback(); return; }
    pgDrawerOpen(true);
    const body = document.getElementById('pgDrawerBody'), foot = document.getElementById('pgDrawerFoot');
    const close = `<button class="pg-dclose" onclick="pgSelect(null)" title="Close (Esc)">×</button>`;
    if (n.type === 'shot') pgDrawerShot(n, body, foot, close);
    else if (n.type === 'sequence') pgDrawerSequence(n, body, foot, close);
    else if (n.type === 'sound') pgDrawerSound(n, body, foot, close);
    else if (n.type === 'video' || n.type === 'audio') pgDrawerVersion(n, body, foot, close);
    else if (n.type === 'link') pgDrawerLink(n, body, foot, close);
    else if (n.type === 'inbetween') pgDrawerInbetween(n, body, foot, close);
    const why = pgImpactDrawerHtml(n);
    if (why) {
        const head = body.querySelector('.pg-dhead');
        if (head) head.insertAdjacentHTML('afterend', why); else body.insertAdjacentHTML('afterbegin', why);
    }
    pgRenderPlayback();
}

/** The node's previs mark: how many directing decisions are locked. */
function pgPrevisTag(n) {
    const p = n.previs;
    if (!p || (!p.locked && !p.approved)) return '';
    return ` · <span class="pg-pvtag" title="${p.approved ? 'Shot locked in Previs' : p.locked + ' decision' + (p.locked === 1 ? '' : 's') + ' locked in Previs'}">`
        + `${p.approved ? 'LOCKED' : p.locked + ' LOCKED'}</span>`;
}

const PG_PREVIS_STATE = Object.freeze({
    locked: 'Locked', applied: 'On card', trying: 'Being tried', card_ahead: 'Card changed',
    conflict: 'Conflict', stale: 'Stale lock', none: '—',
});

/*
 * FROM PREVIS — the directing decisions this shot carries, read-only. What is
 * shown is the scene card's value (what generation sends); the state says
 * whether Previs locked it. Changing one happens in Previs, never here.
 */
async function pgLoadPrevis(n) {
    const key = n.key;
    const el = document.getElementById('pgPrevis');
    let d;
    try { d = await api(`/shots/${n.id}/previs`); }
    catch (err) { if (el) el.innerHTML = `<div class="pg-warn">${esc(err.message)}</div>`; return; }
    if (PG.sel !== key) return;
    const box = document.getElementById('pgPrevis');
    const count = document.getElementById('pgPrevisCount');
    if (!box) return;
    const list = d.decisions || [];
    const locked = list.filter(x => x.state === 'locked').length;
    const stale = list.filter(x => x.state === 'stale').length;
    const approved = !!(d.approval && (d.approval.approved || d.approval.state === 'approved'));
    if (count) count.textContent = !d.blocking ? 'not blocked' : approved ? 'shot locked' : `${locked} of ${list.length} locked`;
    if (!d.blocking) {
        box.innerHTML = '<div class="pg-note">Not blocked in Previs yet — generation uses the scene card alone.</div>';
        return;
    }
    if (!list.length) {
        box.innerHTML = '<div class="pg-note">Blocked in Previs, but this server does not report decisions yet — restart the backend.</div>';
        if (count) count.textContent = '';
        return;
    }
    box.innerHTML = list.map(x => `<div class="pg-pvrow ${esc(x.state)}">
          <span class="pg-pvk">${esc(x.label)}</span>
          <span class="pg-pvv">${x.value ? esc(x.value) : '<em>not set</em>'}</span>
          <span class="pg-pvs">${esc(PG_PREVIS_STATE[x.state] || x.state)}</span></div>`).join('')
        + (stale ? `<div class="pg-warn" style="margin-top:6px;">${stale} locked decision${stale === 1 ? ' has' : 's have'} changed since it was locked — re-lock or unlock it in Previs so the card and the lock agree.</div>` : '');
}

// ── What flows made for a shot (FOG-004) ───────────────────────────────

/** A version node's title: its place in its parent's versions, or that a flow made it. */
function pgVersionTitle(n, all) {
    if (n.source === 'flow') return 'from a flow';
    return `v${n.version} of ${(all || []).length}`;
}

/** On the shot node: how many frames flows made for it, which are not on the board until picked. */
function pgFlowBadge(n) {
    const k = (n.flow_frames || []).length;
    return k ? ` <span class="pg-pill" title="Frames a flow made for this shot. They are candidates: none is on the board until it is picked.">+${k} from flows</span>` : '';
}

/** In the shot drawer: the frames flows made, each saying which run made it. Candidates, never the board's frame. */
function pgFlowFramesHtml(n) {
    const list = n.flow_frames || [];
    if (!list.length) return '';
    const tiles = list.map(x => `<figure style="margin:0;width:96px;">
        <img src="${esc(pgSrc(x.url) + (String(x.url).includes('?') ? '&w=200' : '?w=200'))}" alt="" loading="lazy" style="width:96px;height:54px;object-fit:cover;border-radius:4px;">
        <figcaption class="text-muted" style="font-size:11px;line-height:1.3;">${esc(x.branch && x.branch !== 'root' ? x.branch : 'flow')}${x.run_id ? ' · run ' + esc(String(x.run_id).slice(0, 6)) : ''}</figcaption>
        ${pgFlowPickControls({ source: 'flow', awaiting_pick: x.awaiting_pick, run_id: x.run_id, branch: x.branch, flow_id: x.flow_id }, true)}</figure>`).join('');
    // One Cancel per paused run, not per variation: cancelling ends the run for all of them.
    const pausedRuns = [...new Set(list.filter(x => x.awaiting_pick && x.run_id).map(x => x.run_id))];
    const cancels = pausedRuns.map(r => `<button class="btn btn-secondary btn-sm" onclick="pgFlowCancelRun('${esc(r)}')"
        title="Stop this run without picking. Its variations stay on the shot as candidates.">Cancel run ${esc(String(r).slice(0, 6))}</button>`).join(' ');
    return `<div class="pg-dsec"><div class="pg-kicker"><span>Made by flows (${list.length})</span><em>not on the board</em></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${tiles}</div>
        ${pausedRuns.length ? `<div class="pg-note">A flow is paused, waiting for you to pick one. Picking puts it on the board and finishes the run; nothing is generated again.</div><div class="pg-btnrow">${cancels}</div>` : ''}
        <div class="pg-note">A flow's output is a candidate: the board keeps the frame it has until one of these is picked.</div></div>`;
}

/** Pick controls for a variation a paused flow is waiting on (FOG-005); nothing for anything else. */
function pgFlowPickControls(n, compact) {
    if (!n || n.source !== 'flow') return '';
    const pickable = n.awaiting_pick && n.run_id && n.branch;
    const edit = n.flow_id ? `<button class="${compact ? 'pg-sbtn' : 'btn btn-secondary btn-sm'}" onclick="pgEditFlow('${esc(n.flow_id)}')"
        title="Open the flow that made this on the Flows canvas">${compact ? 'Edit' : 'Edit flow'}</button>` : '';
    if (!pickable && !edit) return '';
    const btn = pickable ? `<button class="${compact ? 'pg-sbtn primary' : 'btn btn-primary btn-sm'}" onclick="pgFlowPick('${esc(n.run_id)}','${esc(n.branch)}')"
        title="Make this the shot's version and finish the paused run from here — nothing is generated again">Pick${compact ? '' : ' this one'}</button>` : '';
    if (compact) return btn + edit;
    return `<div class="pg-btnrow" style="margin-top:6px;">${btn}
        ${pickable ? `<button class="btn btn-secondary btn-sm" onclick="pgFlowCancelRun('${esc(n.run_id)}')">Cancel run</button>` : ''}${edit}</div>`;
}

/** Pick a paused run's variation through the existing select route; it resumes the run. */
async function pgFlowPick(runId, branch) {
    try {
        const r = await api(`/flow-runs/${runId}/select`, { method: 'POST', body: JSON.stringify({ branch_key: branch }) });
        setStatus(r && r.status === 'complete' ? `Picked ${branch}: it is the shot's version now, and the run finished.`
            : `Picked ${branch}; the run ended ${r && r.status}${r && r.failed && r.failed.length ? ' — ' + r.failed.map(f => f.error).join('; ') : ''}.`, r && r.status !== 'complete');
        if (typeof loadProductionGraph === 'function') loadProductionGraph();
    } catch (err) { setStatus('Pick failed: ' + err.message, true); }
}

/** Cancel a paused run without picking; its variations stay on the shot as candidates. */
async function pgFlowCancelRun(runId) {
    try {
        await api(`/flow-runs/${runId}/cancel`, { method: 'POST', body: '{}' });
        setStatus('Run cancelled. Its variations stay on the shot as candidates.');
        if (typeof loadProductionGraph === 'function') loadProductionGraph();
    } catch (err) { setStatus('Cancel failed: ' + err.message, true); }
}

function pgDrawerShot(n, body, foot, close) {
    const f = n.selected_frame;
    const seq = n.sequence_id ? pgNode('seq:' + n.sequence_id) : null;
    const locked = PG.graph.board_locked;
    const lockAttr = locked ? ' disabled title="The board is locked — unlock it to replace a frame"' : '';
    body.innerHTML = `
      <div class="pg-dhead">${close}<h3 class="pg-dtitle">${esc(n.shot_code)}</h3>
        <div class="pg-dsub">Shot · ${esc(n.scene_label)}</div>
        ${seq ? `<div class="pg-dsub">In ${esc(seq.name)} · ${seq.shot_ids.indexOf(n.id) + 1} of ${seq.shot_ids.length}</div>` : '<div class="pg-dsub">Not in a sequence</div>'}</div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Frame${f ? ` v${f.version} selected` : ''}</span><em>${esc((f && f.model) || '')}</em></div>
        ${f ? `<img class="pg-dimg" src="${esc(pgSrc(f.url))}" alt="">` : '<div class="pg-frame none" style="height:140px;border-radius:8px;"><span>No frame yet</span></div>'}
        <div class="pg-vchips">${n.frames.map(x => `<button class="${x.selected ? 'on' : ''}" ${locked ? 'disabled' : ''}
            onclick="pgSelectFrame('${n.id}', ${x.version})">v${x.version}${x.selected ? ' ✓' : ''}</button>`).join('')}</div>
        <div class="pg-btnrow">
          <button class="btn btn-primary btn-sm"${lockAttr} onclick="pgRunNode('${n.key}')">${f ? `Regenerate · makes v${(n.frames[n.frames.length - 1] || { version: 0 }).version + 1}` : 'Generate'}</button>
          ${f ? `<button class="btn btn-secondary btn-sm"${lockAttr} onclick="refineFrame('${n.id}', ${f.version})">Refine</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="exploreAngles('${n.id}')" title="Four separate images, one camera each, at the project resolution. Pick one and it becomes the frame.">4 angles</button>
          ${uploadControl('storyboard-image', `/shots/${n.id}/storyboard/import`, { after: 'loadProductionGraph', label: '+ Upload' })}
          ${f ? `<button class="btn btn-secondary btn-sm" onclick="setAnchor('${n.id}')">Anchor</button>
                 <button class="btn btn-secondary btn-sm" onclick="openFrameViewer('${n.id}')">Mark up</button>` : ''}
          ${mediaUploadControl('voice', 'audio', 'shot', n.id, { after: 'loadProductionGraph', label: 'Upload dialogue' })}
        </div></div>
      ${pgFlowFramesHtml(n)}
      ${f ? `<div class="pg-dsec"><div class="pg-kicker"><span>How was v${f.version} made</span></div>
        <div id="pgHowMade"><div class="pg-note">Reading how this was made…</div></div>
        ${n.frames.length > 1 ? `<label class="pg-l">Compare with the selected frame</label>
          <select onchange="pgCompareSelected('${n.key}', this.value)"><option value="">Pick a version…</option>
            ${n.frames.filter(x => !x.selected).map(x => `<option value="${esc(x.asset_id)}">v${x.version}</option>`).join('')}</select>
          <div id="pgCompare" style="margin-top:8px;"></div>` : ''}</div>` : ''}
      <div class="pg-dsec"><div class="pg-kicker"><span>From Previs</span><em id="pgPrevisCount"></em></div>
        <div class="pg-pvlist" id="pgPrevis"><div class="pg-note">Reading the directing decisions…</div></div>
        <div class="pg-btnrow"><button class="btn btn-secondary btn-sm" onclick="markCurrentShot('${n.id}');navigateTo('previs')">Open in Previs</button></div></div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Plates &amp; details</span><em id="pgPlateCount"></em></div>
        <div class="pg-list" id="pgPlates"><div class="pg-note">Reading what this shot sends…</div></div>
        <div class="pg-btnrow">
          <button class="btn btn-secondary btn-sm" onclick="setAnchor('${n.id}')">+ Anchor frame</button>
          <button class="btn btn-secondary btn-sm" onclick="openFrameViewer('${n.id}')">+ Markup notes</button>
          <button class="btn btn-secondary btn-sm" onclick="markCurrentShot('${n.id}');navigateTo('previs')">+ Previs</button>
          <button class="btn btn-secondary btn-sm" onclick="navigateTo('stylebook')">+ Style book</button>
          <button class="btn btn-secondary btn-sm" onclick="directShot('${n.id}')">Edit card</button>
        </div></div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Video prompt — what is sent</span>
          <div class="pg-seg" id="pgPromptMode"><button class="on" onclick="pgPromptMode('parts')">By part</button><button onclick="pgPromptMode('one')">One text</button></div></div>
        <div id="pgVideoPrompt"><div class="pg-note">Reading the video request…</div></div></div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Video generation</span></div>
        <label class="pg-l">Generator</label><div class="pg-note" id="pgVidProvider">—</div>
        <label class="pg-l">Quality</label><div class="pg-seg" id="pgVidTier">${[['draft', 'Draft'], ['production', 'Production'], ['hero', 'Hero']]
            .map(([id, l]) => `<button data-tier="${id}" class="${(PG.drawerCache.tier || 'production') === id ? 'on' : ''}" onclick="pgPickTier('${id}')">${l}</button>`).join('')}</div>
        <label class="pg-l">Duration</label><div class="pg-seg" id="pgVidDur">${[0, 3, 5, 8, 10].map(s => `<button data-dur="${s}" class="${(PG.drawerCache.dur || 0) === s ? 'on' : ''}"
            onclick="pgPickDur(${s})">${s ? s + ' s' : 'from card'}</button>`).join('')}</div>
        <label class="pg-l">Seed</label><input type="number" id="pgVidSeed" placeholder="the locked seed, or random" value="${esc(PG.drawerCache.seed || '')}"
            oninput="PG.drawerCache.seed=this.value">
        <p class="pg-note" style="margin-top:10px;">To end on the next shot's frame, wire both into a sequence with a continuous join — a sequence travels between two approved frames.</p>
        <div class="pg-btnrow"><button class="btn btn-secondary btn-sm" onclick="directShot('${n.id}')">Direct the action</button>
          <button class="btn btn-secondary btn-sm" onclick="markCurrentShot('${n.id}');navigateTo('previs')">Direct the camera</button></div>
        <label class="pg-l">Dialogue</label>
        ${n.dialogue_lines ? `<div class="pg-btnrow" style="margin-top:0;"><button class="btn btn-secondary btn-sm"
            onclick="generateVoiceForShot('${n.id}', ${jsAttr(n.shot_code)})">Generate dialogue (${n.dialogue_lines} line${n.dialogue_lines === 1 ? '' : 's'})</button></div>`
          : '<div class="pg-note">No line on this shot.</div>'}</div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Video versions</span></div>
        ${n.videos.length ? `<div class="pg-list">${n.videos.map(v => pgVersionRow(v, 'ver:' + v.asset_id)).join('')}</div>`
          : `<p class="pg-note">None of its own${seq && seq.videos.length ? ` — ${esc(n.shot_code)} plays inside ${esc(seq.name)}` : ''}. Generating here adds a video version node wired to ${esc(n.shot_code)}.</p>`}
        <div class="pg-btnrow">${mediaUploadControl('video', 'video', 'shot', n.id, { after: 'loadProductionGraph', label: 'Upload clip' })}</div></div>`;
    foot.innerHTML = `<button class="pg-hbtn" onclick="pgPreviewVideo('${n.id}')">Preview request · free</button><div class="grow"></div>
        <button class="pg-hbtn primary" id="pgGenVideoBtn" onclick="pgGenerateVideo('${n.id}')" ${f ? '' : 'disabled title="A clip starts from the frame — generate or upload one first"'}>Generate video</button>`;
    pgLoadPrevis(n);
    pgLoadShotDetails(n);
    if (f) pgLoadHowMade(f.asset_id, 'frame', n.key);
}

async function pgLoadShotDetails(n) {
    const key = n.key;
    try {
        const d = await api('/shots/' + n.id + '/prompt');
        if (PG.sel !== key) return;
        const refs = d.references || [];
        const el = document.getElementById('pgPlates');
        const count = document.getElementById('pgPlateCount');
        if (count && d.reference_limit) count.textContent = `${refs.length} of ${d.reference_limit} image slots`;
        else if (count) count.textContent = `${refs.length} image${refs.length === 1 ? '' : 's'}`;
        if (el) el.innerHTML = refs.length
            ? refs.map(r => `<div class="pg-li"><span class="grow">${esc(r.name || r.tag || r.kind || 'reference')}</span><span class="m">${esc(r.kind || '')}${r.view ? ' · ' + esc(r.view) : ''}</span></div>`).join('')
            : '<div class="pg-note">No plates travel with this shot — every subject is drawn from its words alone.</div>';
    } catch (err) { const el = document.getElementById('pgPlates'); if (el) el.innerHTML = `<div class="pg-warn">${esc(err.message)}</div>`; }
    await pgRefreshVideoPreview(n);
}

async function pgRefreshVideoPreview(n) {
    const key = n.key;
    const q = pgVideoQuery();
    try {
        const d = await api(`/shots/${n.id}/video/preview${q}`);
        if (PG.sel !== key) return;
        PG.drawerCache.videoPreview = { shot: n.id, prompt: d.prompt || '', negative: d.negative_prompt || '' };
        if (PG.drawerCache.editedFor !== n.id) { PG.drawerCache.edited = null; PG.drawerCache.editedFor = n.id; }
        const prov = document.getElementById('pgVidProvider');
        if (prov) prov.textContent = `${d.provider || 'unresolved'}${d.model ? ' · ' + d.model : ''}${d.duration_s ? ' · ' + d.duration_s + ' s' : ''}${d.init_image ? ' · the frame travels as the first keyframe' : ' · NO frame attached'}`;
        const btn = document.getElementById('pgGenVideoBtn');
        const usd = d.estimate && d.estimate.usd != null ? d.estimate.usd : d.estimated_usd;
        if (btn && !btn.disabled) btn.textContent = usd != null ? `Generate video · $${Number(usd).toFixed(2)}` : 'Generate video';
        pgRenderPrompt();
    } catch (err) {
        const el = document.getElementById('pgVideoPrompt');
        if (el) el.innerHTML = `<div class="pg-warn">Could not read the video request: ${esc(err.message)}</div>`;
    }
}

function pgVideoQuery() {
    const p = [];
    if (PG.drawerCache.tier) p.push('tier=' + encodeURIComponent(PG.drawerCache.tier));
    if (PG.drawerCache.dur) p.push('duration_s=' + PG.drawerCache.dur);
    return p.length ? '?' + p.join('&') : '';
}

/**
 * The prompt that will be sent, editable by clause or as one text. "By part" is
 * the prompt's own sentences, not invented sections: what is shown joined back
 * together is exactly what travels.
 */
function pgRenderPrompt() {
    const el = document.getElementById('pgVideoPrompt');
    const vp = PG.drawerCache.videoPreview;
    if (!el || !vp) return;
    const text = PG.drawerCache.edited != null ? PG.drawerCache.edited : vp.prompt;
    const mode = PG.drawerCache.promptMode || 'parts';
    document.querySelectorAll('#pgPromptMode button').forEach((b, i) => b.classList.toggle('on', (i === 0) === (mode === 'parts')));
    const edited = PG.drawerCache.edited != null && PG.drawerCache.edited !== vp.prompt;
    const foot = `<div class="pg-note" style="margin-top:6px;display:flex;justify-content:space-between;">
        <span>${text.length.toLocaleString()} chars${edited ? ' · <span style="color:#e0a33e;">edited — this replaces the composed prompt</span>' : ''}</span>
        ${edited ? `<a href="#" onclick="event.preventDefault();PG.drawerCache.edited=null;pgRenderPrompt()">reset</a>` : ''}</div>
      ${vp.negative ? `<details style="margin-top:6px;"><summary class="pg-note" style="cursor:pointer;">negative prompt ▸</summary><pre class="pg-pre">${esc(vp.negative)}</pre></details>` : ''}`;
    if (mode === 'one') {
        el.innerHTML = `<textarea rows="8" oninput="PG.drawerCache.edited=this.value" onblur="pgRenderPrompt()">${esc(text)}</textarea>${foot}`;
        return;
    }
    const parts = text.split(/(?<=[.!?])\s+(?=[A-Z"(])/).filter(s => s.trim());
    el.innerHTML = parts.map((p, i) => `<div class="pg-part"><div class="pg-part-h"><span>PART ${i + 1}</span><span>${p.length}</span></div>
        <textarea rows="2" data-part="${i}" oninput="pgEditPart()">${esc(p)}</textarea></div>`).join('') + foot;
}
function pgEditPart() {
    PG.drawerCache.edited = [...document.querySelectorAll('#pgVideoPrompt textarea[data-part]')].map(t => t.value.trim()).filter(Boolean).join(' ');
}
function pgPromptMode(m) { PG.drawerCache.promptMode = m; pgRenderPrompt(); }
function pgPickTier(id) {
    PG.drawerCache.tier = id;
    document.querySelectorAll('#pgVidTier button').forEach(b => b.classList.toggle('on', b.dataset.tier === id));
    const n = pgNode(PG.sel); if (n) pgRefreshVideoPreview(n);
}
function pgPickDur(s) {
    PG.drawerCache.dur = s;
    document.querySelectorAll('#pgVidDur button').forEach(b => b.classList.toggle('on', Number(b.dataset.dur) === s));
    const n = pgNode(PG.sel); if (n) pgRefreshVideoPreview(n);
}

async function pgPreviewVideo(shotId) {
    const n = pgNode('shot:' + shotId);
    if (n) await pgRefreshVideoPreview(n);
    PG.drawerCache.promptMode = 'one';
    pgRenderPrompt();
    const el = document.getElementById('pgVideoPrompt');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setStatus('Previewed. Nothing was generated and nothing was spent.');
}

/** Paid: the shared confirmation, then the clip with every choice made here. */
function pgGenerateVideo(shotId) {
    const n = pgNode('shot:' + shotId);
    const vp = PG.drawerCache.videoPreview;
    const override = PG.drawerCache.edited != null && vp && PG.drawerCache.edited !== vp.prompt ? PG.drawerCache.edited : null;
    return confirmPaidImage({
        capability: 'video',
        title: 'Generate this clip',
        note: 'Costs credits. The selected frame travels as the first keyframe, and the new clip becomes a version that plays.',
        previewUrl: `/shots/${shotId}/video/preview${pgVideoQuery()}`,
        editable: false,
        notEditableWhy: override ? 'Your edited prompt from the drawer is sent in place of this one.' : 'Edit the prompt in the drawer, then generate.',
        send: async choices => pgBusy('shot:' + shotId, 'generating video', async () => {
            setStatus(`Generating a clip for ${n ? n.shot_code : 'the shot'}…`, true);
            try {
                await api('/shots/' + shotId + '/video/generate', { method: 'POST', body: JSON.stringify({
                    ...choices,
                    tier: PG.drawerCache.tier || 'production',
                    ...(PG.drawerCache.dur ? { duration_s: PG.drawerCache.dur } : {}),
                    ...(PG.drawerCache.seed ? { seed: Number(PG.drawerCache.seed) } : {}),
                    ...(override ? { prompt_override: override } : {}),
                }) });
                setStatus(`${n ? n.shot_code : 'Clip'}: a new video version is playing.`);
            } catch (err) { setStatus('Could not generate: ' + err.message); }
        }),
    });
}

function pgVersionRow(v, key) {
    const media = v.kind === 'audio' && v.url ? `<audio src="${esc(pgSrc(v.url))}" controls preload="none"></audio>` : '';
    return `<div class="pg-li${v.selected ? ' on' : ''}"><span class="grow">v${v.version}${v.selected ? ' ▶ playing' : ''}
        <span class="m"> · ${pgSecs(v.duration_ms)}${v.provider ? ' · ' + esc(v.provider) : ''}</span></span>${media}
        <button class="btn btn-secondary btn-sm" onclick="pgSelect('${key}')">Open</button>
        ${v.selected ? `<button class="btn btn-secondary btn-sm" onclick="pgSelectVersion('${key}', true)">Unselect</button>`
                     : `<button class="btn btn-primary btn-sm" onclick="pgSelectVersion('${key}')">Select</button>`}</div>`;
}

function pgDrawerSequence(n, body, foot, close) {
    const members = n.shot_ids.map(id => pgNode('shot:' + id)).filter(Boolean);
    const missing = members.filter(m => !m.frames.length);
    const seqs = PG.graph.nodes.filter(x => x.type === 'sequence' && x.id !== n.id);
    const free = pgShots().filter(s => !s.sequence_id);
    const mode = PG.drawerCache.seqMode || 'legs';
    const generates = (n.joins || []).slice(0, Math.max(0, members.length - 1)).filter(j => j && j.type !== 'cut').length
        + Math.max(0, members.length - 1 - (n.joins || []).length) + (n.links.start && n.links.start.ok ? 1 : 0) + (n.links.end && n.links.end.ok ? 1 : 0);
    const joinsHtml = members.map((m, i) => {
        const row = `<div class="pg-li"><span class="grow"><strong>${esc(m.shot_code)}</strong>
            <span class="m"> ${esc(m.framing || '')} · ${pgSecs(m.duration_ms)} · ${m.selected_frame ? 'v' + m.selected_frame.version : 'no frame'}</span></span>
            <button class="btn btn-secondary btn-sm" title="Take it out of the sequence" onclick="pgSeqRemove('${n.id}','${m.id}')">×</button></div>`;
        if (i === members.length - 1) return row;
        const j = (n.joins || [])[i] || { type: 'continuous', prompt: '' };
        const next = members[i + 1];
        return row + `<div style="margin:6px 0 10px 14px;padding-left:10px;border-left:2px solid ${j.type === 'cut' ? '#3a3a44' : '#e2c15a'};">
            <div class="pg-seg">${PG_JOINS.map(([id, l]) => `<button class="${j.type === id ? 'on' : ''}" onclick="pgSetJoin('${n.id}', ${i}, '${id}')">${l}</button>`).join('')}</div>
            <label class="pg-l">How ${esc(m.shot_code)} becomes ${esc(next.shot_code)}</label>
            <textarea rows="2" onblur="pgSetJoinPrompt('${n.id}', ${i}, this.value)">${esc(j.prompt || '')}</textarea>
            <div class="pg-note">${j.type === 'cut' ? 'a cut generates nothing' : `1 clip · ${esc(m.shot_code)} ${m.selected_frame ? 'v' + m.selected_frame.version : ''} → ${esc(next.shot_code)} ${next.selected_frame ? 'v' + next.selected_frame.version : ''}`}</div></div>`;
    }).join('');
    const refBlock = side => {
        const l = n.links[side];
        const first = side === 'start' ? members[0] : members[members.length - 1];
        return `<label class="pg-l">${side === 'start' ? 'Starts on' : 'Ends on'}</label>
          <select onchange="pgSetRef('${n.id}', '${side}', this.value)">
            <option value="">Its ${side === 'start' ? 'first' : 'last'} shot${first ? ' · ' + esc(first.shot_code) : ''}</option>
            ${seqs.map(s => ['shot_image', 'video_last_frame'].map(mode => `<option value="${s.id}|${mode}" ${l && l.ref.sequence_id === s.id && l.ref.mode === mode ? 'selected' : ''}>
              ${esc(s.name)} — ${mode === 'shot_image' ? "a shot's selected image" : 'a frame of its selected video'}</option>`).join('')).join('')}
          </select>
          ${l ? (l.ok ? `<div class="pg-note" style="margin-top:4px;">${esc(l.label)} — follows the source's selected version</div>`
                      : `<div class="pg-warn" style="margin-top:4px;">${esc(l.reason)}</div>`) : ''}`;
    };
    body.innerHTML = `
      <div class="pg-dhead">${close}<h3 class="pg-dtitle"><input type="text" value="${esc(n.name)}" onblur="pgSeqPut('${n.id}', { name: this.value })"></h3>
        <div class="pg-dsub">Sequence · ${members.length} shot${members.length === 1 ? '' : 's'} · ${pgSecs(n.duration_ms)}</div>
        ${n.links.stale ? `<div class="pg-warn" style="margin-top:6px;">A linked frame changed since this last generated — its clip starts or ends on a picture that is no longer selected.</div>` : ''}
        <div class="${missing.length ? 'pg-warn' : 'pg-okline'}" style="margin-top:6px;">${missing.length
            ? `${missing.map(m => esc(m.shot_code)).join(', ')} ${missing.length === 1 ? 'has' : 'have'} no frame yet`
            : members.length ? 'Every shot has a frame — ready' : 'No shots yet — wire a shot into it, or add one below'}</div></div>
      <div class="pg-dsec"><div class="pg-kicker"><span>The whole sequence</span></div>
        <div class="pg-note" style="margin-bottom:6px;">Reaches every clip — light, lens, what happens across the move.</div>
        <textarea rows="3" onblur="pgSeqPut('${n.id}', { description: this.value })">${esc(n.description)}</textarea></div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Shots and joins</span></div>${joinsHtml || '<div class="pg-note">No shots yet.</div>'}
        ${free.length ? `<select style="margin-top:8px;" onchange="pgSeqAdd('${n.id}', this.value)"><option value="">+ Add a shot…</option>
          ${free.map(s => `<option value="${s.id}">${esc(s.shot_code)} · ${esc(s.scene_label)}</option>`).join('')}</select>`
          : '<div class="pg-note" style="margin-top:8px;">Every shot is in a sequence. Wire one from another sequence to move it here.</div>'}</div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Start and end frames</span></div>${refBlock('start')}${refBlock('end')}</div>
      <div class="pg-dsec"><div class="pg-kicker"><span>How to make it</span></div>
        <div class="pg-list">
          ${[['legs', 'Leg by leg', "one clip per join that isn't a cut, stitched after"], ['native', 'One native clip', 'the whole move, frames as keyframes'],
             ['upload', 'Upload', 'a clip made elsewhere — lands as a new version']].map(([id, l, d]) =>
            `<label class="pg-li${mode === id ? ' on' : ''}" style="cursor:pointer;"><input type="radio" name="pgSeqMode" style="width:auto;margin:0;" ${mode === id ? 'checked' : ''}
               onchange="PG.drawerCache.seqMode='${id}';pgRenderDrawer()"><span class="grow"><strong>${l}</strong> <span class="m">${d}</span></span></label>`).join('')}
        </div>
        ${mode === 'upload' ? `<div class="pg-btnrow">${mediaUploadControl('video', 'video', 'sequence', n.id, { after: 'loadProductionGraph', label: 'Choose a clip' })}</div>` : ''}
        ${n.legs.length ? `<div class="pg-note" style="margin-top:8px;">${n.legs.length} leg${n.legs.length === 1 ? '' : 's'} made so far.
          <button class="btn btn-secondary btn-sm" onclick="stitchSequence('${n.id}', this)">Join legs into one clip · free</button></div>` : ''}
        <div id="pgSeqPlan">${PG.drawerCache.plan && PG.drawerCache.plan.id === n.id ? PG.drawerCache.plan.html : ''}</div></div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Video versions — select one to play it</span></div>
        ${n.videos.length ? `<div class="pg-list">${n.videos.map(v => pgVersionRow(v, 'ver:' + v.asset_id)).join('')}</div>`
          : '<p class="pg-note">None yet. A stitched, native or uploaded clip lands here as a version that plays across every shot in the sequence.</p>'}</div>`;
    const clips = mode === 'native' ? 1 : generates;
    foot.innerHTML = `<button class="pg-hbtn" onclick="pgSeqPlan('${n.id}')">Plan · free</button><div class="grow"></div>
        <button class="pg-hbtn primary" onclick="pgGenerateSequence(pgNode('${n.key}'))" ${mode === 'upload' || !members.length ? 'disabled' : ''}>${
            mode === 'native' ? 'Generate 1 native clip' : clips ? `Generate ${clips} clip${clips === 1 ? '' : 's'}` : 'Nothing to generate'}</button>`;
}

async function pgSeqPut(id, patch) {
    PG.drawerCache.plan = null;
    try { await api('/sequences/' + id, { method: 'PUT', body: JSON.stringify(patch) }); await loadProductionGraph(); }
    catch (err) { setStatus('Could not save the sequence: ' + err.message); }
}
function pgSeqRemove(id, shotId) { const n = pgNode('seq:' + id); pgSeqPut(id, { shot_ids: n.shot_ids.filter(x => x !== shotId) }); }
function pgSeqAdd(id, shotId) { if (!shotId) return; const n = pgNode('seq:' + id); pgSeqPut(id, { shot_ids: n.shot_ids.concat(shotId) }); }
function pgJoinsOf(n) {
    const out = (n.joins || []).slice();
    while (out.length < Math.max(0, n.shot_ids.length - 1)) out.push({ type: 'continuous', prompt: '' });
    return out.slice(0, Math.max(0, n.shot_ids.length - 1));
}
function pgSetJoin(id, i, type) { const n = pgNode('seq:' + id); const j = pgJoinsOf(n); j[i] = { ...j[i], type }; pgSeqPut(id, { joins: j }); }
function pgSetJoinPrompt(id, i, text) {
    const n = pgNode('seq:' + id); const j = pgJoinsOf(n);
    if ((j[i].prompt || '') === text) return;
    j[i] = { ...j[i], prompt: text }; pgSeqPut(id, { joins: j });
}
function pgSetRef(id, side, value) {
    const [seq, mode] = String(value || '').split('|');
    pgSeqPut(id, { [side + '_frame_ref']: seq ? { sequence_id: seq, mode } : null });
}

async function pgSeqPlan(id) {
    const el = document.getElementById('pgSeqPlan');
    if (el) el.innerHTML = '<div class="pg-note" style="margin-top:8px;">Reading the plan…</div>';
    try {
        const p = await api('/sequences/' + id + '/plan');
        if (!el) return;
        if (p.refused) { el.innerHTML = `<div class="pg-warn" style="margin-top:8px;">${esc(p.reason)}</div>`; return; }
        const segs = p.segments || [];
        el.innerHTML = `<div style="margin-top:10px;">${segs.map((s, i) => `<div class="pg-li" style="display:block;">
            <div><strong>${i + 1}. ${esc(s.from)} → ${esc(s.to)}</strong> <span class="m">· ${s.duration_s}s${s.estimated_credits ? ' · ' + s.estimated_credits + ' credits' : ''}${s.join ? ' · ' + esc(s.join) : ''}</span></div>
            <div class="pg-note" style="margin-top:4px;">${esc(s.prompt)}</div></div>`).join('')}
          ${(p.cuts || []).length ? `<div class="pg-note" style="margin-top:6px;">Cuts, nothing generated: ${(p.cuts || []).map(c => esc(c.from + ' → ' + c.to)).join(', ')}</div>` : ''}
          ${p.degraded ? `<div class="pg-warn" style="margin-top:6px;">${esc(p.degraded_reason || '')}</div>` : ''}
          <div class="pg-note" style="margin-top:6px;">Nothing was generated and nothing was spent.</div></div>`;
        // Kept across the background refresh a write triggers; dropped when the
        // sequence itself changes, because then it describes another request.
        PG.drawerCache.plan = { id, html: el.innerHTML };
    } catch (err) { if (el) el.innerHTML = `<div class="pg-warn" style="margin-top:8px;">${esc(err.message)}</div>`; }
}

function pgGenerateSequence(n) {
    if (!n) return;
    const native = (PG.drawerCache.seqMode || 'legs') === 'native';
    return pgBusy(n.key, 'generating', () => native ? generateNativeMultiShot(n.id) : generateSequence(n.id));
}

async function pgDrawerSound(n, body, foot, close) {
    const k = PG_KIND[n.kind] || PG_KIND.music;
    const parent = n.parent ? pgNode(n.parent) : null;
    const custom = !!n.duration_ms;
    body.innerHTML = `
      <div class="pg-dhead">${close}<h3 class="pg-dtitle"><input type="text" value="${esc(n.title || k.label)}" onblur="pgCuePut('${n.id}', { title: this.value })"></h3>
        <div class="pg-dsub">${k.label} · ${parent ? 'wired to ' + esc(parent.type === 'sequence' ? parent.name : parent.shot_code) : 'scores its whole scene'}</div>
        <div class="pg-dsub" style="opacity:.75;">${parent && parent.type === 'sequence' ? 'Wire it to a shot instead and it scores only that shot' : 'Wire a shot or sequence into it to score just that span'}</div></div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Kind</span></div>
        <div class="pg-seg">${Object.entries(PG_KIND).map(([id, x]) => `<button class="${n.kind === id ? 'on' : ''}" onclick="pgCuePut('${n.id}', { cue_type: '${x.cue}' })">${x.label}</button>`).join('')}</div></div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Written from</span></div>
        <div class="pg-note" style="margin-bottom:4px;">Scene details from the wired ${parent ? parent.type : 'scene'}</div>
        <pre class="pg-pre" id="pgSceneDetails" style="max-height:120px;">…</pre>
        <label class="pg-l">Your direction — added on top</label>
        <textarea rows="3" onblur="pgCuePut('${n.id}', { description: this.value })">${esc(n.description)}</textarea>
        ${n.kind === 'music' ? `<div style="display:flex;gap:8px;"><div style="flex:1;"><label class="pg-l">Mood</label>
          <input type="text" value="${esc(n.mood)}" onblur="pgCuePut('${n.id}', { mood: this.value })"></div>
          <div style="flex:1;"><label class="pg-l">Genre</label><input type="text" value="${esc(n.genre)}" onblur="pgCuePut('${n.id}', { genre: this.value })"></div></div>` : ''}
        <label class="pg-l">Length</label>
        <div class="pg-seg"><button class="${custom ? '' : 'on'}" onclick="pgCuePut('${n.id}', { duration_ms: 0 })">Match${parent ? ' ' + pgSecs(parent.duration_ms) : ''}</button>
          <button class="${custom ? 'on' : ''}" onclick="document.getElementById('pgCueLen').focus()">Custom</button></div>
        <input type="number" id="pgCueLen" min="1" step="0.5" placeholder="seconds" style="margin-top:6px;" value="${custom ? Math.round(n.duration_ms / 100) / 10 : ''}"
          onchange="pgCuePut('${n.id}', { duration_ms: Math.round(Number(this.value || 0) * 1000) })">
        <label class="pg-l">Avoid</label><input type="text" value="${esc(n.negative_prompt)}" onblur="pgCuePut('${n.id}', { negative_prompt: this.value })"></div>
      <div class="pg-dsec"><div class="pg-kicker"><span>What will be sent</span><em id="pgCueProv"></em></div>
        <pre class="pg-pre" id="pgCueSend">Reading the request…</pre></div>
      <div class="pg-dsec"><div class="pg-kicker"><span>Versions</span></div>
        ${n.versions.length ? `<div class="pg-list">${n.versions.map(v => pgVersionRow(v, 'ver:' + v.asset_id)).join('')}</div>`
          : '<p class="pg-note">None yet. Each generation adds an audio version node; the selected one plays.</p>'}
        <div class="pg-btnrow"><button class="btn btn-secondary btn-sm" onclick="navigateTo('musicws')">Open in Score workspace →</button></div></div>`;
    foot.innerHTML = `<button class="pg-hbtn" onclick="pgCuePreview('${n.id}')">Preview · free</button>
        ${mediaUploadControl(k.cap === 'sfx' ? 'sfx' : k.cap, 'audio', 'cue', n.id, { after: 'loadProductionGraph', label: 'Upload' })}
        <div class="grow"></div><button class="pg-hbtn primary" onclick="pgGenerateSound(pgNode('${n.key}'))">Generate</button>`;
    pgCuePreview(n.id);
}

async function pgCuePut(id, patch) {
    try { await api('/music-cues/' + id, { method: 'PUT', body: JSON.stringify(patch) }); await loadProductionGraph(); }
    catch (err) { setStatus('Could not save the sound: ' + err.message); }
}

/** Free: exactly the text the generator would receive. */
async function pgCuePreview(id) {
    const send = document.getElementById('pgCueSend'), details = document.getElementById('pgSceneDetails'), prov = document.getElementById('pgCueProv');
    try {
        const d = await api('/music-cues/' + id + '/generate');
        if (send) send.textContent = (d.prompt || '(empty)') + (d.negative_prompt ? '\n\nAvoid: ' + d.negative_prompt : '')
            + (d.duration_s ? `\n\n${d.duration_s} seconds.` : '');
        if (details) details.textContent = d.scene_details || 'This scene has no description yet.';
        if (prov) prov.textContent = `${d.provider || 'unresolved'} · ${d.gen_type || ''}`;
    } catch (err) {
        if (send) send.textContent = 'Cannot be sent yet: ' + err.message;
        if (details) details.textContent = '—';
    }
}

function pgGenerateSound(n) {
    if (!n) return;
    const k = PG_KIND[n.kind] || PG_KIND.music;
    return confirmPaidImage({
        capability: k.cap,
        title: 'Generate ' + (n.title || k.label),
        previewUrl: '/music-cues/' + n.id + '/generate',
        note: 'Costs credits. The new sound becomes a version of this node and the one that plays.',
        // Read-only here, with the same pickers as every other generate
        // button: which connected provider, its model and its own options.
        editable: false,
        notEditableWhy: 'The cue\'s direction is written in this node\'s drawer.',
        send: async choices => pgBusy(n.key, 'generating', async () => {
            setStatus(`Generating ${n.title || k.label}…`, true);
            try {
                await api('/music-cues/' + n.id + '/generate', { method: 'POST', body: JSON.stringify(choices || {}) });
                setStatus(`${n.title || k.label}: a new version is playing.`);
            } catch (err) { setStatus('Could not generate: ' + err.message); }
        }),
    });
}

function pgDrawerVersion(n, body, foot, close) {
    const parent = pgNode(n.parent);
    // A flow's sound hangs off a SHOT, which has no cue versions (FOG-004).
    const siblings = (parent ? (n.type === 'audio' ? parent.versions : parent.videos) : null) || [];
    const auditionUrl = pgSrc(n.url || '') + (String(n.url || '').includes('?') ? '&' : '?') + 'content=' + encodeURIComponent(n.audio_fingerprint || '');
    const media = n.url ? (n.type === 'audio'
        ? `<audio src="${esc(pgSrc(n.url))}" controls style="width:100%;"></audio>`
        : `<video src="${esc(auditionUrl)}" controls playsinline style="width:100%;border-radius:8px;background:#08080a;"></video>`) : '<div class="pg-warn">The file is missing.</div>';
    body.innerHTML = `
      <div class="pg-dhead">${close}<h3 class="pg-dtitle">${n.source === 'flow' ? 'Made by a flow' : `Version ${n.version}`}</h3>
        <div class="pg-dsub">${n.type} · ${esc(n.parent_label || '')} · ${pgSecs(n.duration_ms)}</div>
        ${pgFlowPickControls(n)}
        <div class="${n.selected ? 'pg-okline' : 'pg-note'}" style="margin-top:6px;">${n.selected ? 'Selected — playback uses this version' : 'Not selected — playback uses another'}</div></div>
      <div class="pg-dsec">${media}</div>
      ${n.type === 'video' && parent && parent.type === 'shot' ? `<div class="pg-dsec" id="pgClipEditorial"></div>` : ''}
      <div class="pg-dsec"><div class="pg-list">
        <div class="pg-li"><span class="grow">Parent</span><span class="m">${esc(parent ? (parent.type === 'sequence' ? 'Sequence · ' + parent.name : parent.type === 'sound' ? (parent.title || 'Sound') : 'Shot · ' + parent.shot_code) : '—')}</span></div>
        <div class="pg-li"><span class="grow">Generator</span><span class="m">${esc(n.provider || 'uploaded')}${n.model ? ' · ' + esc(n.model) : ''}</span></div>
        ${n.mode ? `<div class="pg-li"><span class="grow">Made as</span><span class="m">${esc(n.mode)}</span></div>` : ''}
        ${n.seed != null ? `<div class="pg-li"><span class="grow">Seed</span><span class="m">${esc(n.seed)}</span></div>` : ''}
        <div class="pg-li"><span class="grow">Made</span><span class="m">${esc(n.created_at || '')}</span></div></div></div>
      ${n.prompt ? `<div class="pg-dsec"><div class="pg-kicker"><span>Prompt it was made with</span>
          <em><a href="#" onclick="event.preventDefault();navigator.clipboard&&navigator.clipboard.writeText(${esc(JSON.stringify(n.prompt))});setStatus('Copied.')">Copy</a></em></div>
        <pre class="pg-pre">${esc(n.prompt)}</pre></div>` : ''}
      <div class="pg-dsec"><div class="pg-kicker"><span>How was this made</span></div>
        <div id="pgHowMade"><div class="pg-note">Reading how this was made…</div></div></div>
      ${n.type === 'video' && !n.selected && siblings.some(v => v.selected) ? `<div class="pg-dsec"><div class="pg-kicker"><span>Compare</span></div>
        <button class="btn btn-secondary btn-sm" onclick="pgCompareSelected('${n.parent}', '${n.asset_id}')">Compare with selected</button>
        <div id="pgCompare" style="margin-top:8px;"></div></div>` : ''}
      <div class="pg-dsec"><div class="pg-kicker"><span>All versions of ${esc(n.parent_label || '')}</span></div>
        <div class="pg-list">${siblings.map(v => pgVersionRow(v, 'ver:' + v.asset_id)).join('')}</div></div>`;
    pgLoadHowMade(n.asset_id, n.type, n.parent);
    if (n.type === 'video' && parent && parent.type === 'shot') pgLoadClipEditorial(n, parent);
    foot.innerHTML = `${n.url ? `<a class="pg-hbtn" style="display:inline-flex;align-items:center;text-decoration:none;" href="${esc(pgSrc(n.url))}" download>Download</a>` : ''}
        <div class="grow"></div>
        ${n.selected ? `<button class="pg-hbtn" onclick="pgSelectVersion('${n.key}', true)">Unselect</button><button class="pg-hbtn primary" disabled>Playing ✓</button>`
                     : `<button class="pg-hbtn primary" onclick="pgSelectVersion('${n.key}')">Select — play this version</button>`}`;
}

async function pgLoadClipEditorial(n, parent) {
    const box = document.getElementById('pgClipEditorial');
    if (!box) return;
    let policy;
    try { policy = await api('/projects/' + state.currentProject.id + '/video/audio-policy'); }
    catch (err) { if (box.isConnected) box.textContent = err.message; return; }
    if (!box.isConnected) return;
    const edit = n.edit || {}, start = Number(edit.source_in_ms) || 0, length = Number(edit.duration_ms) || Number(n.duration_ms) || 0;
    box.innerHTML = `<div class="pg-kicker"><span>Clip audio and edit</span></div>
      <label>Generated clip audio <select onchange="pgSetClipAudioPolicy(this.value)">
        <option value="no_music" ${policy.video_audio_policy === 'no_music' ? 'selected' : ''}>Dialogue, effects and ambience · no music</option>
        <option value="silent" ${policy.video_audio_policy === 'silent' ? 'selected' : ''}>Silent</option></select></label>
      <p class="pg-note">Listen to this version before approving mixed audio. Music is supplied separately in Post.</p>
      <label><input id="pgNoMusicAudition" type="checkbox"> I listened to this version and heard no music</label>
      <button class="pg-hbtn" onclick="pgReviewClipAudio('${parent.id}','${n.asset_id}',${esc(JSON.stringify(n.audio_fingerprint || ''))})">Approve audio audition</button>
      <p class="pg-note">Recorded audition: ${esc(n.audio_review && n.audio_review.status || 'pending')}. Export verifies the current file.</p>
      <label>Source in (seconds) <input id="pgClipSourceIn" type="number" min="0" step="0.001" value="${start/1000}"></label>
      <label>Used duration (seconds) <input id="pgClipUsedDuration" type="number" min="0.001" step="0.001" value="${length/1000}"></label>
      <button class="pg-hbtn" onclick="pgSaveClipEdit('${parent.id}','${n.asset_id}')">Save source range</button>
      <p class="pg-note">Original source: ${pgSecs(n.duration_ms)}. The whole original is retained for handles.</p>`;
    const player = box.previousElementSibling && box.previousElementSibling.querySelector('video');
    if (player && length > 0) {
        const seek = () => { player.currentTime = start/1000; };
        if (player.readyState >= 1) seek(); else player.addEventListener('loadedmetadata', seek, { once: true });
        player.addEventListener('timeupdate', () => { if (player.currentTime >= (start+length)/1000) player.pause(); });
    }
}
async function pgSetClipAudioPolicy(value) {
    try { await api('/projects/' + state.currentProject.id + '/video/audio-policy', {method:'PUT',body:JSON.stringify({video_audio_policy:value})});setStatus('Clip audio policy saved.'); }
    catch(err) { setStatus(err.message,true); }
}
async function pgReviewClipAudio(shotId, assetId, expectedFingerprint) {
    const checked = document.getElementById('pgNoMusicAudition');
    if (!checked || !checked.checked) return setStatus('Listen to this clip and confirm the audition before approving.',true);
    try { await api('/shots/' + shotId + '/video/audio-review',{method:'PUT',body:JSON.stringify({asset_id:assetId,status:'approved',no_music:true,expected_fingerprint:expectedFingerprint,reviewer:'Human audition via Production'})});setStatus('Audio audition recorded for this version.');await pgLoad(); }
    catch(err) { setStatus(err.message,true); }
}
async function pgSaveClipEdit(shotId, assetId) {
    const source_in_ms = Number(document.getElementById('pgClipSourceIn').value)*1000, duration_ms = Number(document.getElementById('pgClipUsedDuration').value)*1000;
    try { const range=await api('/shots/' + shotId + '/video/edit',{method:'PUT',body:JSON.stringify({asset_id:assetId,source_in_ms,duration_ms})});setStatus('Source range saved · head handle '+pgSecs(range.head_handle_ms)+' · tail handle '+pgSecs(range.tail_handle_ms));await pgLoad(); }
    catch(err) { setStatus(err.message,true); }
}

// ── How was this made (PGN-014) ────────────────────────────────────────────

/**
 * The recipe a version was made from, every field in its place. A fact the
 * engine never recorded is NAMED as not recorded rather than left out — an
 * absent row reads as "there was nothing", which is a different claim — and a
 * fact matched by time rather than by identity says so.
 */
function pgRecipeHtml(r) {
    if (!r) return '<div class="pg-note">Nothing is recorded about how this was made.</div>';
    const unknown = new Set(r.unknown || []);
    const row = (label, val) => `<div class="pg-li"><span class="grow">${esc(label)}</span><span class="m">${val}</span></div>`;
    const rows = [];
    if (!unknown.has('provider')) rows.push(row('Generator', esc(r.provider) + (r.model ? ' · ' + esc(r.model) : '')));
    else if (!unknown.has('model')) rows.push(row('Model', esc(r.model)));
    if (!unknown.has('seed')) rows.push(row('Seed', esc(r.seed) + (r.seed_honoured === false
        ? ` <em title="${esc(r.provider || 'this provider')} ignores a seed">· ignored by ${esc(r.provider || 'the provider')} — not honoured</em>` : '')));
    if (!unknown.has('size')) rows.push(row('Size', esc(r.size)));
    if (!unknown.has('tier')) rows.push(row('Tier', esc(r.tier)));
    if (!unknown.has('fingerprint') && r.fingerprint) rows.push(row('Inputs', esc(r.fingerprint.state === 'behind'
        ? 'behind — made from inputs that have since changed' : r.fingerprint.state)));
    if (!unknown.has('ledger') && r.ledger) rows.push(row('Render ledger', `${esc(r.ledger.step || '')} v${esc(r.ledger.version)}`
        + (r.ledger_match === 'nearest' ? ' <em>· matched by time</em>' : '')));
    if (!unknown.has('cost') && r.cost) rows.push(row('Cost', `$${Number(r.cost.amount).toFixed(2)}`
        + (r.cost_match === 'nearest' ? ' <em>· matched by time</em>' : '')));
    if (!unknown.has('made_at')) rows.push(row('Made', esc(r.made_at)));
    const refs = (r.references || []).length ? `<div class="pg-kicker" style="margin-top:8px;"><span>References</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${r.references.map(x => x.thumb
            ? `<img src="${esc(pgThumb(x.thumb, 96))}" alt="${esc(x.file_name || '')}" title="${esc(x.file_name || '')}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;">`
            : `<span class="pg-note">${esc(x.file_name || x.asset_id)}${x.missing ? ' (gone)' : ''}</span>`).join('')}</div>` : '';
    const prompt = !unknown.has('prompt') ? `<div class="pg-kicker" style="margin-top:8px;"><span>Prompt</span></div><pre class="pg-pre">${esc(r.prompt)}</pre>` : '';
    const neg = !unknown.has('negative_prompt') ? `<div class="pg-kicker"><span>Negative</span></div><pre class="pg-pre">${esc(r.negative_prompt)}</pre>` : '';
    const missing = [...unknown].map(f => f.replace(/_/g, ' '));
    return `${pgRecipeFlowHtml(r.flow)}<div class="pg-list">${rows.join('')}</div>${prompt}${neg}${refs}
        ${missing.length ? `<div class="pg-note" style="margin-top:8px;">Not recorded: ${esc(missing.join(', '))}</div>` : ''}`;
}

/** Which flow made this, from its run (FOG-008): every fact named, or named as not found. */
function pgRecipeFlowHtml(f) {
    if (!f) return '';
    const row = (label, val) => `<div class="pg-li"><span class="grow">${esc(label)}</span><span class="m">${val}</span></div>`;
    const rows = [];
    if (f.flow) rows.push(row('Flow', esc(f.flow.name) + (f.flow_version != null ? ` · v${esc(f.flow_version)}` : '')));
    if (f.node) rows.push(row('Saved by node', esc(f.node)));
    if (f.generated_by) rows.push(row('Made by node', `${esc(f.generated_by.id)} · ${esc(f.generated_by.type)}`));
    if (f.provider || f.model) rows.push(row('Node generator', esc(f.provider || 'not recorded') + (f.model ? ' · ' + esc(f.model) : '')));
    if (f.run) rows.push(row('Run', `${esc(String(f.run.id).slice(0, 8))} · ${esc(f.run.status)}${f.branch && f.branch !== 'root' ? ' · ' + esc(f.branch) : ''}`));
    if (f.apply) rows.push(row('Apply', `${esc(String(f.apply.id).slice(0, 8))} · ${esc(f.apply.status || '')}`));
    const missing = (f.unknown || []).map(x => x.replace(/_/g, ' '));
    const edit = f.flow && f.flow.id ? `<div class="pg-btnrow"><button class="btn btn-secondary btn-sm" onclick="pgEditFlow('${esc(f.flow.id)}')"
        title="Open this flow on the Flows canvas">Edit flow</button></div>` : '';
    return `<div class="pg-kicker"><span>Made by a flow</span></div><div class="pg-list">${rows.join('')}</div>${edit}
        ${missing.length ? `<div class="pg-note">Not found for this flow output: ${esc(missing.join(', '))}</div>` : ''}`;
}

/**
 * What "make another like this" would send, decided without spending. The
 * version's prompt is offered pre-filled; its seed travels only where the
 * provider honours one; references are gathered by the route from the shot as
 * it stands, and that is said rather than implied. What cannot be reproduced
 * is refused with the reason.
 */
function pgMakeAnotherPlan(r, kind, parent) {
    if (!r) return { refused: 'Nothing is recorded about how this was made.' };
    // A flow output is made again by applying the same flow to its shot (FOG-008 → FOG-003).
    if (r.flow) {
        if (!r.flow.flow) return { refused: 'The flow that made this has been deleted, so it cannot be applied again.' };
        const shotId = (parent && parent.type === 'shot' && parent.id) || r.shot_id;
        if (!shotId) return { refused: 'This flow output belongs to no shot, so there is nothing to apply the flow to.' };
        return { flowId: r.flow.flow.id, targets: [`shot:${shotId}`] };
    }
    if (kind === 'audio' || (parent && parent.type === 'sound'))
        return { refused: 'A sound is regenerated from its cue’s direction, not from a stored prompt — use Regenerate on the sound.' };
    if (!parent || parent.type !== 'shot')
        return { refused: 'A sequence clip is made from its legs and joins — regenerate the sequence instead.' };
    if (!r.prompt) return { refused: 'No prompt was recorded for this version, so there is nothing to make another like.' };
    const video = kind === 'video';
    const body = {};
    const notes = [];
    if (r.seed != null && r.seed_honoured === true) body.seed = r.seed;
    else if (r.seed != null && r.seed_honoured === false) notes.push(`The seed (${r.seed}) is not sent: ${r.provider || 'this provider'} ignores a seed, so the result will differ.`);
    else if (r.seed != null) notes.push('The seed is not sent: whether this provider honours one is not known.');
    notes.push(`References are the shot’s current plates, gathered at generation${(r.references || []).length
        ? ` — this version was made from ${r.references.length}` : ''}.`);
    return {
        url: `/shots/${parent.id}/${video ? 'video/generate' : 'storyboard/regenerate'}`,
        previewUrl: `/shots/${parent.id}/${video ? 'video/preview' : 'prompt'}`,
        capability: video ? 'video' : 'image',
        prefill: r.prompt, body, notes,
    };
}

async function pgLoadHowMade(assetId, kind, parentKey) {
    const box = document.getElementById('pgHowMade');
    if (!box || !assetId) return;
    PG.drawerCache.recipes = PG.drawerCache.recipes || {};
    PG.drawerCache.howMade = { assetId, kind, parentKey };
    box.innerHTML = '<div class="pg-note">Reading how this was made…</div>';
    try {
        const d = await api('/assets/' + assetId + '/provenance');
        PG.drawerCache.recipes[assetId] = d.recipe || null;
        // The latest request wins: a file dropped on a shot asks for ITS recipe
        // while the drawer is still reading the selected frame's.
        if (!document.getElementById('pgHowMade') || (PG.drawerCache.howMade || {}).assetId !== assetId) return;
        const plan = pgMakeAnotherPlan(d.recipe, kind, pgNode(parentKey));
        box.innerHTML = pgRecipeHtml(d.recipe) + `<div class="pg-btnrow">
            <button class="btn btn-secondary btn-sm" ${plan.refused ? `disabled title="${esc(plan.refused)}"` : ''}
              onclick="pgMakeAnother('${assetId}')">Make another like this</button></div>`;
    } catch (err) { box.innerHTML = `<div class="pg-warn">Could not read how this was made: ${esc(err.message)}</div>`; }
}

async function pgMakeAnother(assetId) {
    const ctx = PG.drawerCache.howMade || {};
    const r = (PG.drawerCache.recipes || {})[assetId];
    const plan = pgMakeAnotherPlan(r, ctx.kind, pgNode(ctx.parentKey));
    if (plan.refused) return setStatus(plan.refused);
    // The flow's own plan and confirmation, the same as "Apply flow…".
    if (plan.flowId) return pgApplyFlow(plan.flowId, plan.targets);
    return confirmPaidImage({
        capability: plan.capability,
        title: 'Make another like this',
        previewUrl: plan.previewUrl,
        prefill: plan.prefill,
        note: 'Costs credits. The prompt is the one this version was made with; ' + plan.notes.join(' '),
        send: async extras => {
            PG.busy.set(ctx.parentKey, 'making another'); pgRender();
            try {
                await api(plan.url, { method: 'POST', body: JSON.stringify(Object.assign({}, plan.body, extras || {})) });
                setStatus('Made another — it is a new version beside this one.');
            } catch (err) { setStatus('Could not make another: ' + err.message); }
            PG.busy.delete(ctx.parentKey);
            await loadProductionGraph();
        },
    });
}

// ── Drop a file to find its recipe (PGN-015) ───────────────────────────────

/**
 * Where an unknown file dropped on this node would go: the node's own upload
 * route, and only for a kind of file that node takes. Anything else is refused
 * with the reason, so a clip dropped on a sound is never sent anywhere.
 */
function pgDropTarget(node, mime) {
    const m = String(mime || '');
    const media = m.startsWith('image/') ? 'image' : m.startsWith('video/') ? 'video' : m.startsWith('audio/') ? 'audio' : '';
    if (!node) return { refused: 'Not on this board. Drop it on the shot, sequence or sound it belongs to, to upload it there.' };
    if (!media) return { refused: 'That is not a picture, a clip or a sound, so no node here can take it.' };
    if (node.type === 'shot' && media === 'image')
        return { helper: 'image', target: 'storyboard-image', url: `/shots/${node.id}/storyboard/import`, what: 'a new frame version' };
    if (node.type === 'shot' && media === 'video')
        return { helper: 'media', capability: 'video', url: `/shots/${node.id}/media/video/import`, shotId: node.id, what: 'a new clip version' };
    if (node.type === 'sequence' && media === 'video')
        return { helper: 'media', capability: 'video', url: `/sequences/${node.id}/import`, what: 'a clip of the whole sequence' };
    if (node.type === 'sound' && media === 'audio')
        return { helper: 'media', capability: 'music', url: `/music-cues/${node.id}/audio`, what: 'a new version of this sound' };
    const takes = { shot: 'a picture or a clip', sequence: 'a clip', sound: 'a sound' }[node.type];
    return { refused: takes ? `This ${node.type} takes ${takes}, not ${media === 'image' ? 'a picture' : 'a ' + (media === 'video' ? 'clip' : 'sound')}.`
                            : `A ${node.type} node takes no uploads; drop it on the shot, sequence or sound it belongs to.` };
}

/** The first file dragged in from the desktop, or null for a drag from inside the page. */
function pgDroppedFile(dataTransfer) {
    const list = dataTransfer && dataTransfer.files;
    return list && list.length ? list.item(0) : null;
}

/**
 * Hash the file here and ask the server which of this project's files it is —
 * only the hash and the size travel, never the bytes. A match opens its node
 * and its recipe; an unknown file is offered to the node it was dropped on.
 */
async function pgDropFile(file, dropKey) {
    if (!file || !state.currentProject) return;
    setStatus(`Looking for ${file.name} in this project…`, true);
    let sha256;
    try {
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        sha256 = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (err) { return setStatus(`${file.name} could not be read: ${err.message}`); }
    let r;
    try {
        r = await api(`/projects/${state.currentProject.id}/production-graph/match?sha256=${sha256}&size=${file.size}`);
    } catch (err) { return setStatus(`Could not look ${file.name} up: ${err.message}`); }
    if (r.matched) {
        const key = [r.node_key, r.parent_key].find(k => k && pgNode(k));
        if (!key) {
            setStatus(`${file.name} is ${r.asset.file_name} (${r.asset.asset_type}) — it is in this project but not drawn on this board.`);
            return showModalHtml('pgDropRecipeModal', `<h3>How ${esc(r.asset.file_name)} was made</h3>${pgRecipeHtml(r.recipe)}
                <div style="text-align:right;margin-top:12px;"><button class="btn btn-secondary btn-sm" onclick="closeModal('pgDropRecipeModal')">Close</button></div>`);
        }
        pgSelect(key); pgPanTo(key);
        setStatus(`${file.name} is ${r.asset.file_name} — opened where it lives.`);
        return pgLoadHowMade(r.asset.asset_id, r.kind, r.parent_key || key);
    }
    const node = dropKey ? pgNode(dropKey) : null;
    const t = pgDropTarget(node, file.type);
    if (t.refused) return setStatus(`${file.name} is not in this project. ${t.refused}`);
    PG.dropFile = { file, target: t, key: dropKey };
    pgSelect(dropKey);
    const body = document.getElementById('pgBody');
    if (body) body.insertAdjacentHTML('afterbegin', `<div class="pg-dsec" id="pgDropOffer"><div class="pg-warn">
        ${esc(file.name)} is not in this project. Upload it to ${esc(node.shot_code || node.name || node.title || node.type)} as ${esc(t.what)}?</div>
        <div class="pg-btnrow"><button class="btn btn-primary btn-sm" onclick="pgDropUpload()">Upload</button>
          <button class="btn btn-secondary btn-sm" onclick="PG.dropFile=null;document.getElementById('pgDropOffer').remove()">Not now</button></div></div>`);
}

/** Send the offered file through the node's own upload helper — the same one its Upload button uses. */
async function pgDropUpload() {
    const d = PG.dropFile;
    if (!d) return;
    PG.dropFile = null;
    const offer = document.getElementById('pgDropOffer');
    if (offer) offer.remove();
    const event = { target: { files: [d.file], value: '', closest: () => null } };
    if (d.target.helper === 'image') return uploadReferenceImage(event, d.target.target, d.target.url, {}, 'loadProductionGraph');
    return uploadCapabilityMedia(event, d.target.capability, d.target.url, 'loadProductionGraph', d.target.shotId || '');
}

/** An A/B wipe: B underneath, A on top clipped to the slider. Frames and clips only. */
function pgCompareHtml(a, b) {
    if (!a || !b || !['image', 'video'].includes(a.kind) || a.kind !== b.kind) return '';
    const el = (x, top) => a.kind === 'image'
        ? `<img src="${esc(pgSrc(x.url))}" alt="" ${top ? 'class="pg-wipe-top"' : ''} style="position:${top ? 'absolute' : 'relative'};inset:0;width:100%;display:block;${top ? 'clip-path:inset(0 50% 0 0);' : ''}">`
        : `<video src="${esc(pgSrc(x.url))}" muted loop autoplay playsinline ${top ? 'class="pg-wipe-top"' : ''} style="position:${top ? 'absolute' : 'relative'};inset:0;width:100%;display:block;${top ? 'clip-path:inset(0 50% 0 0);' : ''}"></video>`;
    return `<div class="pg-wipe" style="position:relative;border-radius:8px;overflow:hidden;background:#08080a;">
        ${el(b, false)}${el(a, true)}
        <span class="pg-note" style="position:absolute;left:6px;top:4px;background:rgba(0,0,0,.6);padding:1px 5px;border-radius:3px;">A · ${esc(a.label || '')}</span>
        <span class="pg-note" style="position:absolute;right:6px;top:4px;background:rgba(0,0,0,.6);padding:1px 5px;border-radius:3px;">B · ${esc(b.label || '')}</span></div>
      <input type="range" min="0" max="100" value="50" style="width:100%;" oninput="pgWipe(this.value)" aria-label="Wipe between A and B">`;
}

function pgWipe(v) {
    document.querySelectorAll('.pg-wipe-top').forEach(e => { e.style.clipPath = `inset(0 ${100 - Number(v)}% 0 0)`; });
}

/** Compare a version with whichever sibling is selected, in the drawer's own compare slot. */
function pgCompareSelected(parentKey, assetId) {
    const box = document.getElementById('pgCompare');
    const parent = pgNode(parentKey);
    if (!box || !parent) return;
    const frames = parent.frames || [];
    const isFrame = frames.some(f => f.asset_id === assetId);
    const list = isFrame ? frames : (parent.videos || []);
    const a = list.find(x => x.asset_id === assetId), b = list.find(x => x.selected);
    if (!a || !b) { box.innerHTML = '<div class="pg-note">Nothing is selected to compare with.</div>'; return; }
    if (a === b) { box.innerHTML = '<div class="pg-note">This is the selected version.</div>'; return; }
    const kind = isFrame ? 'image' : 'video';
    box.innerHTML = pgCompareHtml({ kind, url: a.url, label: 'v' + a.version }, { kind, url: b.url, label: 'v' + b.version + ' selected' });
}

function pgDrawerLink(n, body, foot, close) {
    const into = pgNode('seq:' + n.sequence_id);
    body.innerHTML = `
      <div class="pg-dhead">${close}<h3 class="pg-dtitle">↳ ${esc(n.ok ? n.label : 'Linked frame')}</h3>
        <div class="pg-dsub">Linked frame · from ${esc(n.source_name || '?')} · ${n.side === 'start' ? 'starts' : 'ends'} ${esc(into ? into.name : '')}</div></div>
      <div class="pg-dsec">${n.ok ? `<img class="pg-dimg" src="${esc(pgSrc(n.url))}" alt="">` : `<div class="pg-warn">${esc(n.reason || '')}</div>`}
        <p class="pg-note" style="margin-top:8px;">Read-only: a picture of another node, resolved at generate time to that node's selected version. It is a keyframe, never a member, so it is not played twice.</p>
        ${into && into.links.stale ? '<div class="pg-warn">The source changed since the receiving sequence last generated.</div>' : ''}</div>`;
    foot.innerHTML = `<button class="pg-hbtn" onclick="pgRemove(pgNode('${n.key}'))">Unlink</button><div class="grow"></div>
        <button class="pg-hbtn primary" onclick="pgSelect('seq:${n.source_sequence_id}');pgPanTo('seq:${n.source_sequence_id}')">Open the source</button>`;
}

// (IB: kept in core, public/legacy/production-graph.js)

const ibSecs = ms => (Math.round(Number(ms) / 100) / 10).toFixed(1);

function pgInbetweenNodeHtml(n, sel, pos, run) {
    const frames = n.frames || [];
    const cells = frames.map(f => `<span class="t${f.key ? ' key' : ''}${f.url ? ' has' : ''}${f.directed ? ' dir' : ''}"
        ${f.url ? `style="background-image:url('${esc(pgThumb(f.url, 120))}')"` : ''} title="${ibSecs(f.at_ms)} s"></span>`).join('');
    const status = n.made ? `${n.made} of ${n.count} made${n.approval && n.approval.approved ? (n.approval.stale ? ' · changed since approval' : ' · approved') : ''}`
        : `${n.count} frames, none made yet`;
    return `<div class="pg-node pg-ib${sel}" data-key="${n.key}" style="${pos}width:360px;height:150px;">
        <div class="pg-nh"><div class="pg-nt"><span class="pg-title">${esc(n.from_code)} → ${esc(n.to_code)}</span>
          <span class="pg-vtag">${ibSecs(n.gap_ms)} s</span></div>
          <div class="pg-sub">in-betweens · ${esc(status)}${n.ranges ? ` · ${n.ranges} direction${n.ranges === 1 ? '' : 's'}` : ''}</div></div>
        <div class="pg-ib-strip">${cells}</div>
        <div class="pg-ib-ticks"><span>0 s</span><span>${ibSecs(n.gap_ms)} s</span></div>
        <div class="pg-row">${pgPort('in', 'image', 'in')}<span>from ${esc(n.from_code)}</span><span>to ${esc(n.to_code)}</span>${pgPort('out', 'image', 'out')}</div>
        ${run}</div>`;
}

function pgDrawerInbetween(n, body, foot, close) {
    body.innerHTML = `
      <div class="pg-dhead">${close}<h3 class="pg-dtitle">In-betweens ${esc(n.from_code)} → ${esc(n.to_code)}</h3>
        <div class="pg-dsub">${ibSecs(n.gap_ms)} s between the two shots · ${n.count} frame${n.count === 1 ? '' : 's'} · ${n.made} made</div></div>
      <div class="pg-dsec"><div class="pg-ib-strip" style="padding:0;">${(n.frames || []).map(f => `<span class="t${f.key ? ' key' : ''}${f.url ? ' has' : ''}"
          ${f.url ? `style="background-image:url('${esc(pgThumb(f.url, 160))}')"` : ''}></span>`).join('')}</div>
        <p class="pg-note" style="margin-top:8px;">Each frame is made from the one before it, starting at ${esc(n.from_code)} and heading for ${esc(n.to_code)}.
          Direct each frame, or a stretch of time, then make the clip from all of them.</p></div>`;
    foot.innerHTML = `<button class="pg-hbtn" onclick="pgRemove(pgNode('${n.key}'))">Remove</button>
        <button class="pg-hbtn" onclick="ibOpenSetupFor('${n.id}')">Spacing</button><div class="grow"></div>
        <button class="pg-hbtn primary" onclick="ibOpenDirect('${n.id}')">Direct the stretch</button>`;
}

/** The next shot in running order, for "In-betweens to the next shot". */
function ibNextShot(n) {
    const order = (PG.graph && PG.graph.running_order) || [];
    const i = order.indexOf(n.id);
    return i >= 0 && order[i + 1] ? pgNode('shot:' + order[i + 1]) : null;
}

async function ibStartFromShot(n) {
    const next = ibNextShot(n);
    if (!next) return setStatus(`${n.shot_code} is the last shot; drag its image port onto the shot it should run to.`);
    return ibOpenSetup(n, next);
}

/** Open the spacing dialog for a new pair, or for a span that exists. */
async function ibOpenSetup(from, to) {
    const existing = ((PG.graph && PG.graph.nodes) || []).find(x => x.type === 'inbetween' && x.from_shot_id === from.id && x.to_shot_id === to.id);
    if (existing) return ibOpenSetupFor(existing.id);
    IB.setup = { id: null, from_code: from.shot_code, to_code: to.shot_code, from_id: from.id, to_id: to.id,
        gap_ms: Number(from.duration_ms) || 5000, count: 4 };
    await ibLoadPrice();
    ibRenderSetup();
    showModal('ibSetupModal');
}

async function ibOpenSetupFor(id) {
    try {
        const s = await api('/inbetweens/' + id);
        IB.setup = { id, from_code: s.from.shot_code, to_code: s.to.shot_code, from_id: s.from.shot_id, to_id: s.to.shot_id,
            gap_ms: s.gap_ms, count: s.frames.length || 1 };
        await ibLoadPrice();
        ibRenderSetup();
        showModal('ibSetupModal');
    } catch (err) { setStatus('Could not open the in-betweens: ' + err.message); }
}

async function ibLoadPrice() {
    try { const r = await api('/projects/' + state.currentProject.id + '/inbetweens'); IB.price = r.image_price || null; } catch (_) { IB.price = null; }
}

function ibCloseSetup() { closeModal('ibSetupModal'); }

function ibRenderSetup() {
    const s = IB.setup;
    if (!s) return;
    const count = Math.max(1, Math.min(29, s.count));
    const every = s.gap_ms / (count + 1);
    const times = Array.from({ length: count }, (_, i) => every * (i + 1));
    const cost = IB.price ? `${count} frame${count === 1 ? '' : 's'} · about $${(IB.price.usd * count).toFixed(2)}`
        : `${count} frame${count === 1 ? '' : 's'}`;
    document.getElementById('ibSetupTitle').textContent = `In-betweens ${s.from_code} → ${s.to_code}`;
    document.getElementById('ibSetupBody').innerHTML = `
      <p style="margin:0 0 14px;font-size:15px;">There ${s.id ? 'are' : 'are'} <strong>
        <input id="ibGap" type="number" min="0.5" max="120" step="0.5" value="${ibSecs(s.gap_ms)}" style="width:72px;"
          onchange="IB.setup.gap_ms=Math.max(500,Math.round(Number(this.value)*1000)||IB.setup.gap_ms);ibRenderSetup()"
          aria-label="Seconds between the shots"> seconds</strong> between ${esc(s.from_code)} and ${esc(s.to_code)}.</p>
      <div class="ib-row" style="grid-template-columns:repeat(2,minmax(0,1fr));">
        <div><label class="text-sm text-muted" for="ibCount">How many frames</label>
          <div class="ib-step"><button onclick="ibStep(-1)" aria-label="Fewer frames">−</button>
            <input id="ibCount" value="${count}" onchange="IB.setup.count=Math.round(Number(this.value))||1;ibRenderSetup()">
            <button onclick="ibStep(1)" aria-label="More frames">+</button></div></div>
        <div><label class="text-sm text-muted" for="ibEvery">One every</label>
          <div class="ib-step"><button onclick="ibEvery(1.5)" aria-label="Shorter spacing">−</button>
            <input id="ibEvery" value="${ibSecs(every)} s" onchange="ibEveryTo(parseFloat(this.value))">
            <button onclick="ibEvery(1/1.5)" aria-label="Longer spacing">+</button></div></div>
      </div>
      <div class="text-sm text-muted" style="margin:14px 0 6px;">Where they land</div>
      <div class="ib-where"><span class="k" style="left:4px;">${esc(s.from_code)}</span><span class="k" style="right:4px;">${esc(s.to_code)}</span>
        ${times.map(t => `<span class="m" style="left:calc(16px + (100% - 32px) * ${t / s.gap_ms});"></span>`).join('')}</div>
      <div style="font:500 12px 'IBM Plex Mono',monospace;color:#f0b44c;margin-top:6px;">${times.map(t => ibSecs(t) + ' s').join(' · ')}</div>
      <p class="text-sm text-muted" style="margin:14px 0 0;line-height:1.5;">Each frame is made from the one before it, starting at ${esc(s.from_code)}, so the move stays continuous.
        ${s.id ? 'Changing the spacing keeps the direction of a frame that stays at its second; a frame that moves is made again.' : ''}</p>
      <div style="display:flex;align-items:center;gap:10px;margin-top:18px;">
        <div><div style="font:600 14px 'IBM Plex Mono',monospace;">${esc(cost)}</div>
          <div class="text-sm text-muted">${IB.price ? esc((IB.price.model || IB.price.provider || '') + ' at the project’s resolution') : 'The price shows in the confirmation'}</div></div>
        <div style="flex-grow:1;"></div>
        <button class="btn" onclick="ibSaveSetup(false)">${s.id ? 'Save spacing' : 'Create'}</button>
        <button class="btn btn-primary" onclick="ibSaveSetup(true)">${s.id ? 'Save and make frames' : `Generate ${count} frame${count === 1 ? '' : 's'}`}</button>
      </div>`;
}

function ibStep(d) { IB.setup.count = Math.max(1, Math.min(29, IB.setup.count + d)); ibRenderSetup(); }
function ibEveryTo(sec) {
    if (!(sec > 0)) return ibRenderSetup();
    IB.setup.count = Math.max(1, Math.min(29, Math.round(IB.setup.gap_ms / (sec * 1000)) - 1));
    ibRenderSetup();
}
function ibEvery(f) { ibEveryTo((IB.setup.gap_ms / (IB.setup.count + 1)) / 1000 * f); }

async function ibSaveSetup(thenGenerate) {
    const s = IB.setup;
    try {
        const body = { gap_s: s.gap_ms / 1000, count: s.count };
        const r = s.id
            ? await api('/inbetweens/' + s.id, { method: 'PUT', body: JSON.stringify(body) })
            : await api('/projects/' + state.currentProject.id + '/inbetweens', { method: 'POST',
                body: JSON.stringify({ from_shot_id: s.from_id, to_shot_id: s.to_id, ...body }) });
        closeModal('ibSetupModal');
        await loadProductionGraph();
        setStatus(`${s.from_code} → ${s.to_code}: ${r.frames.length} in-between${r.frames.length === 1 ? '' : 's'} placed.`);
        if (thenGenerate) return ibGenerate(r.id, 0, false);
        return ibOpenDirect(r.id);
    } catch (err) { setStatus('Could not save the in-betweens: ' + err.message); }
}

/** Make frames: from one frame on, or only that frame. Free plan first, one confirmation. */
function ibGenerate(id, fromIndex, only) {
    const q = `?from_index=${fromIndex || 0}${only ? '&only=true' : ''}`;
    return confirmPaidImage({
        title: only ? 'Make this in-between again' : 'Make the in-betweens', capability: 'image',
        previewUrl: '/inbetweens/' + id + '/generate' + q,
        armable: d => !!d.ready,
        describe: d => `<div class="text-sm" style="line-height:1.55;">
            ${(d.blockers || []).map(b => `<div style="color:var(--gl-danger,#ef4444);">${esc(b)}</div>`).join('')}
            <div><strong>${d.count} frame${d.count === 1 ? '' : 's'}</strong>${d.estimated_usd != null ? ` · about $${Number(d.estimated_usd).toFixed(2)}` : ''}
              ${d.provider ? ` · ${esc(d.model || d.provider)}` : ''}</div>
            <div class="text-muted" style="margin:4px 0 8px;">${esc(d.note || '')}</div>
            ${(d.frames || []).map(f => `<details style="margin-bottom:6px;"><summary>${ibSecs(f.at_ms)} s · from ${esc(f.references[0])}, toward ${esc(f.references[1])}${f.replaces_take ? ' · a new take, the old one is kept' : ''}</summary>
              <div style="white-space:pre-wrap;font-size:12px;opacity:.85;margin-top:4px;">${esc(f.instruction)}</div></details>`).join('')}</div>`,
        send: async (choice) => {
            setStatus('Making the in-betweens…', true);
            try {
                const r = await api('/inbetweens/' + id + '/generate', { method: 'POST',
                    body: JSON.stringify({ from_index: fromIndex || 0, only: !!only, ...(choice || {}) }) });
                setStatus(`${(r.generated || []).length} in-between${(r.generated || []).length === 1 ? '' : 's'} made.`);
            } catch (err) { setStatus('In-betweens stopped: ' + err.message); }
            await loadProductionGraph();
            if (IB.span && IB.span.id === id) await ibOpenDirect(id, true);
        },
    });
}

// ── Direct the stretch ─────────────────────────────────────────────────────

async function ibOpenDirect(id, keepSel) {
    try {
        IB.span = await api('/inbetweens/' + id);
        if (!keepSel) { IB.sel = 0; IB.rangeEdit = null; }
        IB.sel = Math.min(IB.sel, Math.max(0, IB.span.frames.length - 1));
        ibRenderDirect();
        showModal('ibDirectModal');
    } catch (err) { setStatus('Could not open the in-betweens: ' + err.message); }
}
function ibCloseDirect() { closeModal('ibDirectModal'); }

function ibPct(ms) { return (100 * ms / IB.span.gap_ms).toFixed(3); }

function ibRenderDirect() {
    const s = IB.span;
    if (!s) return;
    const sel = s.frames[IB.sel] || null;
    const cell = (label, at, url, cls, onclick) => `<button class="ib-cell ${cls}" ${onclick ? `onclick="${onclick}"` : 'disabled'}>
        <span class="pic" ${url ? `style="background-image:url('${esc(pgThumb(url, 320))}')"` : ''}>${url ? '' : esc(label)}</span>
        <span class="tm">${ibSecs(at)} s${cls.includes('key') ? ' · ' + esc(label) : ''}</span></button>`;
    const strip = [cell(s.from.shot_code, 0, s.from.url, 'key', null),
        ...s.frames.map((f, i) => cell(f.asset_id ? '' : 'not made', f.at_ms, f.url,
            `${f.asset_id ? 'has' : ''}${i === IB.sel ? ' sel' : ''}`, `IB.sel=${i};IB.rangeEdit=null;ibRenderDirect()`)),
        cell(s.to.shot_code, s.gap_ms, s.to.url, 'key', null)].join('');
    const lane = name => `<div class="text-sm">${{ movement: 'Movement', emotion: 'Emotion', camera: 'Camera', other: 'Also' }[name]}</div>
        <div class="ib-lane" title="Click to add a direction here" onclick="ibLaneClick(event,'${name}')">
          ${s.frames.map(f => `<span class="ib-tick" style="left:${ibPct(f.at_ms)}%;"></span>`).join('')}
          ${s.ranges.filter(r => r.lane === name).map(r => `<span class="ib-bar ${name}" style="left:${ibPct(r.start_ms)}%;width:${ibPct(r.end_ms - r.start_ms)}%;"
            title="${esc(ibSecs(r.start_ms) + '–' + ibSecs(r.end_ms) + ' s: ' + r.text)}" onclick="event.stopPropagation();ibEditRange('${esc(r.id)}')">${ibSecs(r.start_ms)}–${ibSecs(r.end_ms)} s · ${esc(r.text)}</span>`).join('')}
        </div>`;
    const re = IB.rangeEdit;
    const rangeForm = re ? `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:10px;padding:10px;border-radius:8px;background:#1d2029;">
        <label class="text-sm">Lane<br><select id="ibRLane">${s.lanes.map(l => `<option value="${l}" ${l === re.lane ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="text-sm">From (s)<br><input id="ibRFrom" type="number" step="0.1" min="0" max="${ibSecs(s.gap_ms)}" value="${ibSecs(re.start_ms)}" style="width:80px;"></label>
        <label class="text-sm">To (s)<br><input id="ibRTo" type="number" step="0.1" min="0" max="${ibSecs(s.gap_ms)}" value="${ibSecs(re.end_ms)}" style="width:80px;"></label>
        <label class="text-sm" style="flex:1 1 260px;">What happens<br><input id="ibRText" type="text" maxlength="500" value="${esc(re.text || '')}" style="width:100%;" placeholder="e.g. her head turns fast toward the door"></label>
        <button class="btn btn-primary btn-sm" onclick="ibSaveRange()">${re.id ? 'Save' : 'Add'}</button>
        ${re.id ? `<button class="btn btn-sm" onclick="ibDeleteRange('${esc(re.id)}')">Delete</button>` : ''}
        <button class="btn btn-sm" onclick="IB.rangeEdit=null;ibRenderDirect()">Cancel</button></div>` : '';
    const acting = sel ? s.ranges.filter(r => sel.at_ms >= r.start_ms && sel.at_ms <= r.end_ms) : [];
    const side = sel ? `<div class="ib-side">
        <div style="display:flex;align-items:baseline;gap:8px;"><h3 style="margin:0;">Frame at ${ibSecs(sel.at_ms)} s</h3>
          <span class="text-sm text-muted">${IB.sel + 1} of ${s.frames.length}</span></div>
        <div class="ib-cell"><span class="pic" style="aspect-ratio:16/9;${sel.url ? `background-image:url('${esc(pgSrc(sel.url))}')` : ''}">${sel.url ? '' : 'Not made yet'}</span></div>
        <div class="text-sm"><div class="text-muted" style="font:600 11px 'IBM Plex Mono',monospace;">FROM THE DIRECTIONS</div>
          ${acting.length ? acting.map(r => `<div>${esc(r.lane)} ${ibSecs(r.start_ms)}–${ibSecs(r.end_ms)} s: ${esc(r.text)}</div>`).join('') : '<div class="text-muted">No direction covers this second.</div>'}</div>
        <label class="text-sm text-muted" for="ibFrameDir" style="font:600 11px 'IBM Plex Mono',monospace;">ONLY THIS FRAME</label>
        <textarea id="ibFrameDir" rows="3" maxlength="500" placeholder="e.g. her eyes well up, first tear not yet falling">${esc(sel.direction || '')}</textarea>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${['more smile', 'tears', 'looks at camera', 'hands to face', 'eyes closed'].map(c =>
            `<button class="ib-chip" onclick="ibChip('${c}')">${c}</button>`).join('')}</div>
        <label class="text-sm"><input type="number" id="ibAt" step="0.1" min="0.1" max="${ibSecs(s.gap_ms - 100)}" value="${ibSecs(sel.at_ms)}" style="width:80px;"> s on the move</label>
        <fieldset style="border:1px solid #2c2f39;border-radius:8px;padding:8px 10px;margin:0;"><legend class="text-sm text-muted">After this frame</legend>
          <label class="text-sm" style="display:block;"><input type="radio" name="ibAfter" value="chain" checked> Make the later frames again from it</label>
          <label class="text-sm" style="display:block;"><input type="radio" name="ibAfter" value="only"> Only this frame</label></fieldset>
        ${sel.takes.length > 1 ? `<div class="text-sm"><div class="text-muted" style="font:600 11px 'IBM Plex Mono',monospace;">TAKES</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${sel.takes.map((t, i) => `<button class="ib-cell${t.selected ? ' sel' : ''}" style="width:72px;" onclick="ibPickTake('${esc(t.asset_id)}')" title="Take ${sel.takes.length - i}">
            <span class="pic" style="background-image:url('${esc(pgThumb(t.url, 160))}')"></span></button>`).join('')}</div></div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm" onclick="ibSaveFrame()">Save</button>
          <button class="btn btn-sm" onclick="ibRemoveFrame()">Remove frame</button>
          <div style="flex-grow:1;"></div>
          <button class="btn btn-primary btn-sm" onclick="ibRegenerate()">${sel.asset_id ? 'Make again' : 'Make'}</button></div>
      </div>` : '<div class="ib-side text-sm text-muted">Add a frame to direct it.</div>';
    const made = s.frames.filter(f => f.asset_id).length;
    document.getElementById('ibDirectTitle').textContent = `Direct the stretch · ${s.from.shot_code} → ${s.to.shot_code} · ${ibSecs(s.gap_ms)} s`;
    document.getElementById('ibDirectBody').innerHTML = `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;">
        <div style="display:flex;flex-direction:column;gap:14px;min-width:0;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="text-sm">${s.frames.length} in-betweens · ${made} made${s.approval.approved ? (s.approval.stale ? ' · changed since approval' : ' · approved') : ''}</span>
            <div style="flex-grow:1;"></div>
            <button class="btn btn-sm" onclick="ibOpenSetupFor('${s.id}')">Spacing</button>
            <button class="btn btn-sm" onclick="ibAddFrame()">Add a frame</button>
            <button class="btn btn-sm" onclick="ibGenerate('${s.id}', 0, false)">${made ? 'Make all again' : 'Make all frames'}</button>
            <button class="btn btn-sm" onclick="ibApprove()" ${made < s.frames.length || !s.frames.length ? 'disabled title="Every frame needs a picture first"' : ''}>${s.approval.approved && !s.approval.stale ? 'Approved' : 'Approve the strip'}</button>
            <button class="btn btn-primary btn-sm" onclick="ibMakeClip()" ${made < s.frames.length ? 'disabled title="Every frame needs a picture first"' : ''}>Make the clip</button>
          </div>
          <div class="ib-strip">${strip}</div>
          <div style="border:1px solid #2c2f39;border-radius:10px;padding:12px;">
            <div class="text-sm text-muted" style="margin-bottom:8px;">What happens when: click a lane to add a direction for a stretch of time; click a bar to change it.</div>
            <div class="ib-lanes">${s.lanes.map(lane).join('')}<div></div>
              <div class="ib-ruler">${Array.from({ length: 6 }, (_, i) => `<span>${ibSecs(s.gap_ms * i / 5)} s</span>`).join('')}</div></div>
            ${rangeForm}
          </div>
          <div class="text-sm text-muted">Every frame inside a direction's stretch is made with it. A frame's own direction is added on top.</div>
        </div>
        ${side}
      </div>`;
}

function ibChip(c) {
    const t = document.getElementById('ibFrameDir');
    if (!t) return;
    t.value = t.value.trim() ? `${t.value.trim()}, ${c}` : c;
}

function ibLaneClick(ev, laneName) {
    const rect = ev.currentTarget.getBoundingClientRect();
    const at = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * IB.span.gap_ms;
    const len = Math.min(2000, IB.span.gap_ms);
    const start = Math.max(0, Math.min(IB.span.gap_ms - len, Math.round(at / 100) * 100));
    IB.rangeEdit = { id: null, lane: laneName, start_ms: start, end_ms: start + len, text: '' };
    ibRenderDirect();
    const t = document.getElementById('ibRText'); if (t) t.focus();
}
function ibEditRange(id) { const r = IB.span.ranges.find(x => x.id === id); if (r) { IB.rangeEdit = { ...r }; ibRenderDirect(); } }

async function ibPutSpan(body, msg) {
    try {
        IB.span = await api('/inbetweens/' + IB.span.id, { method: 'PUT', body: JSON.stringify(body) });
        IB.sel = Math.min(IB.sel, Math.max(0, IB.span.frames.length - 1));
        ibRenderDirect();
        if (msg) setStatus(msg);
        loadProductionGraph();
        return true;
    } catch (err) { setStatus('Not saved: ' + err.message); return false; }
}

function ibSaveRange() {
    const re = IB.rangeEdit;
    const next = { id: re.id || undefined, lane: document.getElementById('ibRLane').value,
        start_ms: Math.round(Number(document.getElementById('ibRFrom').value) * 1000),
        end_ms: Math.round(Number(document.getElementById('ibRTo').value) * 1000),
        text: document.getElementById('ibRText').value.trim() };
    const ranges = IB.span.ranges.filter(r => r.id !== re.id).concat(next);
    IB.rangeEdit = null;
    return ibPutSpan({ ranges }, 'Direction saved. Frames inside it are made with it next time.');
}
function ibDeleteRange(id) { IB.rangeEdit = null; return ibPutSpan({ ranges: IB.span.ranges.filter(r => r.id !== id) }, 'Direction removed.'); }

function ibFramesBody(edit) {
    return IB.span.frames.map((f, i) => (i === IB.sel && edit ? { ...f, ...edit } : f))
        .map(f => ({ at_ms: f.at_ms, direction: f.direction || '' }));
}

function ibSaveFrame() {
    const dir = document.getElementById('ibFrameDir').value.trim();
    const at = Math.round(Number(document.getElementById('ibAt').value) * 1000);
    return ibPutSpan({ frames: ibFramesBody({ direction: dir, at_ms: at }) }, 'Frame saved.');
}

async function ibRegenerate() {
    const dir = document.getElementById('ibFrameDir').value.trim();
    const at = Math.round(Number(document.getElementById('ibAt').value) * 1000);
    const only = (document.querySelector('input[name="ibAfter"]:checked') || {}).value === 'only';
    const index = IB.sel;
    if (!(await ibPutSpan({ frames: ibFramesBody({ direction: dir, at_ms: at }) }))) return;
    const newIndex = IB.span.frames.findIndex(f => f.at_ms === at);
    return ibGenerate(IB.span.id, newIndex >= 0 ? newIndex : index, only);
}

function ibAddFrame() {
    const fr = IB.span.frames;
    const cuts = [0, ...fr.map(f => f.at_ms), IB.span.gap_ms];
    let best = 0;
    for (let i = 1; i < cuts.length; i++) if (cuts[i] - cuts[i - 1] > cuts[best + 1] - cuts[best]) best = i - 1;
    const at = Math.round((cuts[best] + cuts[best + 1]) / 2);
    const frames = fr.map(f => ({ at_ms: f.at_ms, direction: f.direction || '' })).concat({ at_ms: at, direction: '' });
    return ibPutSpan({ frames }, `A frame added at ${ibSecs(at)} s.`).then(() => {
        IB.sel = IB.span.frames.findIndex(f => f.at_ms === at); ibRenderDirect();
    });
}

function ibRemoveFrame() {
    const frames = IB.span.frames.filter((_, i) => i !== IB.sel).map(f => ({ at_ms: f.at_ms, direction: f.direction || '' }));
    return ibPutSpan({ frames }, 'Frame removed. Its pictures stay in the asset list.');
}

async function ibPickTake(assetId) {
    try {
        IB.span = await api(`/inbetweens/${IB.span.id}/frames/${IB.sel}/select`, { method: 'POST', body: JSON.stringify({ asset_id: assetId }) });
        ibRenderDirect(); loadProductionGraph();
    } catch (err) { setStatus('Could not pick that take: ' + err.message); }
}

async function ibApprove() {
    try {
        IB.span = await api(`/inbetweens/${IB.span.id}/approve`, { method: 'POST', body: '{}' });
        ibRenderDirect(); loadProductionGraph();
        setStatus('Strip approved. The clip will refuse if it changes.');
    } catch (err) { setStatus('Not approved: ' + err.message); }
}

function ibMakeClip() {
    const id = IB.span.id;
    return confirmPaidImage({
        title: 'Make the clip from the strip', capability: 'video',
        previewUrl: '/inbetweens/' + id + '/video',
        armable: d => !!d.ready,
        describe: d => `<div class="text-sm" style="line-height:1.55;">
            ${(d.blockers || []).map(b => `<div style="color:var(--gl-danger,#ef4444);">${esc(b)}</div>`).join('')}
            <div><strong>${d.count} clip${d.count === 1 ? '' : 's'}</strong> on ${esc(d.provider || 'the video generator')}
              ${d.estimated_usd != null ? ` · about $${Number(d.estimated_usd).toFixed(2)}` : ''}</div>
            <div class="text-muted" style="margin:4px 0 8px;">${esc(d.note || '')}</div>
            <div style="margin-bottom:6px;">Pictures, in order: ${(d.points || []).map(p => `${esc(p.label)}`).join(' → ')}</div>
            ${(d.calls || []).map(c => `<details style="margin-bottom:6px;"><summary>${esc(c.from)} → ${esc(c.to)} · ${c.duration_s} s</summary>
              <div style="white-space:pre-wrap;font-size:12px;opacity:.85;margin-top:4px;">${esc(c.prompt)}</div></details>`).join('')}</div>`,
        send: async (choice) => {
            setStatus('Making the clip…', true);
            try {
                const r = await api('/inbetweens/' + id + '/video', { method: 'POST', body: JSON.stringify({ ...(choice || {}) }) });
                setStatus(r.note || 'Clip made.');
            } catch (err) { setStatus('The clip stopped: ' + err.message); }
            await loadProductionGraph();
        },
    });
}

// ── Playback ──────────────────────────────────────────────────────────────

/**
 * Shots in running order. Per shot: the selected video, else the selected still
 * held for its length, else a slate. A sequence with a selected clip plays once
 * across its members' span — the covered shots fold into it, exactly as the
 * timeline route does, because this reads that route.
 */
function pgTiles() {
    const t = PG.timeline;
    if (!t || !t.entries) return [];
    return t.entries.map(e => {
        const shot = pgNode('shot:' + e.shot_id);
        const seq = shot && shot.sequence_id ? pgNode('seq:' + shot.sequence_id) : null;
        const covers = e.covers && e.covers.length > 1;
        const kind = e.kind === 'video' ? 'video' : e.kind === 'still' ? 'still' : 'none';
        const vVer = kind === 'video' && e.video
            ? ((seq && covers ? seq.videos : shot ? shot.videos : []).find(v => v.path === e.video.path) || {}).version : null;
        return {
            key: covers && seq ? seq.key : 'shot:' + e.shot_id, shotKey: 'shot:' + e.shot_id,
            name: covers && seq ? seq.name : e.shot_code,
            kindLabel: kind === 'video' ? `VIDEO${vVer ? ' v' + vVer : ''}${covers ? ' · ' + e.covers[0] + '→' + e.covers[e.covers.length - 1] : ''}`
                : kind === 'still' ? `IMAGE ${shot && shot.selected_frame ? 'v' + shot.selected_frame.version : ''} · ${pgSecs(e.duration_ms)}` : 'NO FRAME · slate',
            kind, start: e.start_ms, dur: e.duration_ms || 1, entry: e,
        };
    });
}

async function pgRenderPlayback() {
    const el = document.getElementById('pgPlayback');
    if (!el || !state.currentProject) return;
    if (!PG.timeline || PG.timelineFor !== PG.graph) {
        PG.timelineFor = PG.graph;
        try { PG.timeline = await api('/projects/' + state.currentProject.id + '/timeline'); } catch (_) { PG.timeline = null; }
    }
    const tiles = pgTiles();
    const total = tiles.reduce((m, t) => Math.max(m, t.start + t.dur), 0) || 1;
    if (PG.play.index >= tiles.length) PG.play.index = 0;
    const cur = tiles[PG.play.index];
    const tc = ms => { const s = Math.floor(ms / 1000); const f = Math.floor((ms % 1000) / 1000 * 24);
        return `01:${String(Math.floor(s / 3600)).padStart(2, '0') === '00' ? String(Math.floor(s / 60)).padStart(2, '0') : '00'}:${String(s % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`; };
    const wide = el.clientWidth > 1000 || el.clientWidth === 0;
    const beds = (PG.graph ? PG.graph.nodes : []).filter(n => n.type === 'sound');
    const bedFor = kind => beds.filter(b => (kind === 'sfx' ? b.kind === 'sfx' : kind === 'music' ? b.kind === 'music' : b.kind === 'ambient'));
    // One lane per sound, so two beds under the same span never print over
    // each other; three is what the bar has room for, the rest are counted.
    let lanesLeft = 3, lanesHidden = 0;
    const lane = (kind, label) => bedFor(kind).map(b => {
        if (lanesLeft <= 0) { lanesHidden += 1; return ''; }
        const html = laneOf(b, label);
        if (html) lanesLeft -= 1;
        return html;
    }).join('');
    const laneOf = (b, label) => {
        if (!pgSpanOf(b, tiles)) return '';
        return `<div class="pg-alane">${[b].map(b => {
            const span = pgSpanOf(b, tiles);
            if (!span) return '';
            const v = b.versions.find(x => x.selected);
            const w = ((v && v.duration_ms) || span.dur);
            return `<div class="pg-aclip${v ? '' : ' none'}" style="left:${span.start / total * 100}%;width:${Math.min(w, total - span.start) / total * 100}%;"
                title="${esc(b.title || label)}">${esc(label)} ${esc(b.title || '')} ${v ? 'v' + v.version : '— no version'}</div>`;
        }).join('')}</div>`;
    };
    el.innerHTML = `
      <div class="pg-monitor" id="pgMonitor">${pgMonitorHtml(cur)}</div>
      <div class="pg-pbmain">
        <div class="pg-transport">
          <button class="pg-tbtn" title="Previous shot" onclick="pgStep(-1)"><svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 1 V11 M10 1 L4 6 L10 11 Z" stroke="currentColor" stroke-width="1.4" fill="currentColor"/></svg></button>
          <button class="pg-tbtn play" title="${PG.play.playing ? 'Pause' : 'Play'}" onclick="pgTogglePlay()">${PG.play.playing
            ? '<svg width="11" height="11" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="#fff"/><rect x="7" y="1" width="3" height="10" fill="#fff"/></svg>'
            : '<svg width="11" height="11" viewBox="0 0 12 12"><path d="M3 1 L11 6 L3 11 Z" fill="#fff"/></svg>'}</button>
          <button class="pg-tbtn" title="Next shot" onclick="pgStep(1)"><svg width="11" height="11" viewBox="0 0 12 12"><path d="M10 1 V11 M2 1 L8 6 L2 11 Z" stroke="currentColor" stroke-width="1.4" fill="currentColor"/></svg></button>
          <span class="pg-tc" id="pgTc">${cur ? tc(cur.start) : '—'}</span><span class="pg-tc dim">/ ${tc(total)}</span>
          <div style="flex-grow:1;"></div>
          ${wide ? `<label><input type="checkbox" ${PG.play.stills ? 'checked' : ''} onchange="PG.play.stills=this.checked"> Stills hold for the shot's length</label>
            <label style="margin-left:12px;"><input type="checkbox" ${PG.play.audio ? 'checked' : ''} onchange="PG.play.audio=this.checked;pgSyncAudio()"> Audio</label>
            <button class="pg-hbtn" style="height:28px;margin-left:12px;" onclick="navigateTo('exportpage')">Send to Premiere</button>` : ''}
        </div>
        <div class="pg-lanes">
          <div class="pg-ruler">${[0, 1, 2, 3, 4].map(i => `<span>${tc(total * i / 4).slice(3, 8)}</span>`).join('')}</div>
          <div class="pg-tiles">${tiles.map((t, i) => `<div class="pg-tile ${t.kind}${i === PG.play.index ? ' cur' : ''}" style="flex:${t.dur} 1 0;"
              onclick="pgTileClick(${i})" title="${esc(t.name)}"><span class="n">${esc(t.name)}</span><span class="k">${esc(t.kindLabel)}</span></div>`).join('')
              || '<div class="pg-note">No shots to play yet.</div>'}</div>
          ${lane('music', 'MUSIC')}${lane('sfx', 'SFX')}${lane('ambient', 'AMB')}
          ${lanesHidden ? `<div class="pg-note" style="font-size:9px;margin-top:2px;">+${lanesHidden} more sound${lanesHidden === 1 ? '' : 's'} — open them on the graph</div>` : ''}
          <div class="pg-playhead" id="pgPlayhead" style="left:${cur ? cur.start / total * 100 : 0}%;"></div>
        </div>
      </div>`;
    if (cur) pgPrepareVideo(cur);
}

/** Where a sound plays: under its parent's span, or its whole scene's. */
function pgSpanOf(sound, tiles) {
    const parent = sound.parent ? pgNode(sound.parent) : null;
    let ids;
    if (parent && parent.type === 'sequence') ids = parent.shot_ids;
    else if (parent && parent.type === 'shot') ids = [parent.id];
    else ids = pgShots().filter(s => s.scene_id === sound.scene_id).map(s => s.id);
    const codes = ids.map(id => (pgNode('shot:' + id) || {}).shot_code).filter(Boolean);
    const hit = tiles.filter(t => ids.includes(t.entry.shot_id) || (t.entry.covers || []).some(c => codes.includes(c)));
    if (!hit.length) return null;
    const start = Math.min(...hit.map(h => h.start));
    return { start, dur: Math.max(...hit.map(h => h.start + h.dur)) - start };
}

function pgMonitorHtml(t) {
    if (!t) return '<div class="pg-slate">Nothing to play</div>';
    const e = t.entry;
    const m = e;
    const src = p => p ? mediaUrl(p) : '';
    if (t.kind === 'video' && m.video) {
        return `<video id="pgMonVideo" src="${esc(src(m.video.path))}" playsinline ${PG.play.audio ? '' : 'muted'} preload="auto"></video>
            <div class="pg-mtag">${esc(t.name)} · ${esc(t.kindLabel.toLowerCase())}</div><div class="pg-mcode">${esc(e.shot_code)}</div>`;
    }
    if (t.kind === 'still' && m.still) {
        return `<img src="${esc(src(m.still.path))}" alt=""><div class="pg-mtag" style="color:#d4a8e8;">still · held ${pgSecs(t.dur)}</div><div class="pg-mcode">${esc(e.shot_code)}</div>`;
    }
    return `<div class="pg-slate"><strong>${esc(e.shot_code)}</strong><span>no frame · ${pgSecs(t.dur)}</span></div>`;
}

function pgPrepareVideo(tile, onEnd) {
    const video = document.getElementById('pgMonVideo');
    if (!video || !tile || !tile.entry || !tile.entry.video) return;
    const start = Number(tile.entry.video.source_in_ms) || 0, end = start + tile.dur;
    const seek = () => { video.currentTime = start / 1000; };
    if (video.readyState > 0) seek(); else video.onloadedmetadata = seek;
    let ended = false;
    const finish = () => { if (ended) return; ended = true; video.pause(); if (onEnd) onEnd(); };
    video.onended = finish;
    video.ontimeupdate = () => { if (video.currentTime * 1000 >= end) finish(); };
}

function pgShowTile(i) {
    const tiles = pgTiles();
    if (!tiles.length) return;
    PG.play.index = Math.max(0, Math.min(tiles.length - 1, i));
    const mon = document.getElementById('pgMonitor');
    const t = tiles[PG.play.index];
    if (mon) mon.innerHTML = pgMonitorHtml(t);
    pgPrepareVideo(t);
    document.querySelectorAll('#pgPlayback .pg-tile').forEach((el, k) => el.classList.toggle('cur', k === PG.play.index));
    const total = tiles.reduce((m, x) => Math.max(m, x.start + x.dur), 0) || 1;
    const ph = document.getElementById('pgPlayhead');
    if (ph) ph.style.left = (t.start / total * 100) + '%';
}

function pgTileClick(i) {
    pgStopPlay();
    pgShowTile(i);
    const t = pgTiles()[i];
    if (t) { PG.sel = t.key; pgPanTo(t.key); pgSelect(t.key); }
}

/** The playhead follows selection: a selected shot or sequence moves it to its tile. */
function pgPlayheadTo(key) {
    const n = pgNode(key);
    if (!n) return;
    const tiles = pgTiles();
    const ids = n.type === 'sequence' ? n.shot_ids : n.type === 'shot' ? [n.id] : [];
    const i = tiles.findIndex(t => t.key === key || ids.includes(t.entry.shot_id));
    if (i >= 0 && !PG.play.playing) pgShowTile(i);
}

function pgStep(d) { pgStopPlay(); pgShowTile(PG.play.index + d); }

function pgTogglePlay() { if (PG.play.playing) pgStopPlay(); else pgStartPlay(); }

function pgStopPlay() {
    PG.play.playing = false;
    clearTimeout(PG.play.timer);
    const v = document.getElementById('pgMonVideo'); if (v) v.pause();
    pgSyncAudio();
    const b = document.querySelector('#pgPlayback .pg-tbtn.play');
    if (b) b.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12"><path d="M3 1 L11 6 L3 11 Z" fill="#fff"/></svg>';
}

function pgStartPlay() {
    PG.play.playing = true;
    const b = document.querySelector('#pgPlayback .pg-tbtn.play');
    if (b) b.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="#fff"/><rect x="7" y="1" width="3" height="10" fill="#fff"/></svg>';
    pgPlayCurrent();
    pgSyncAudio();
}

function pgPlayCurrent() {
    if (!PG.play.playing) return;
    const tiles = pgTiles();
    const t = tiles[PG.play.index];
    if (!t) return pgStopPlay();
    pgShowTile(PG.play.index);
    const next = () => {
        if (!PG.play.playing) return;
        if (PG.play.index >= tiles.length - 1) return pgStopPlay();
        PG.play.index += 1;
        pgPlayCurrent();
    };
    const v = document.getElementById('pgMonVideo');
    if (v) { pgPrepareVideo(t, next); v.play().catch(() => { PG.play.timer = setTimeout(next, t.dur); }); }
    else PG.play.timer = setTimeout(next, PG.play.stills ? t.dur : 800);
}

/** The selected sound versions under their spans, while playing and allowed to. */
function pgSyncAudio() {
    PG.audioEls = PG.audioEls || [];
    PG.audioEls.forEach(a => a.pause());
    PG.audioEls = [];
    if (!PG.play.playing || !PG.play.audio || !PG.graph) return;
    const tiles = pgTiles();
    const cur = tiles[PG.play.index];
    if (!cur) return;
    for (const s of PG.graph.nodes.filter(n => n.type === 'sound')) {
        const v = s.versions.find(x => x.selected);
        const span = v && pgSpanOf(s, tiles);
        if (!v || !span || !v.url || cur.start < span.start || cur.start >= span.start + span.dur) continue;
        const a = new Audio(pgSrc(v.url));
        a.currentTime = (cur.start - span.start) / 1000;
        a.play().catch(() => {});
        PG.audioEls.push(a);
    }
}

// (pgRenderSide: kept in core, public/legacy/production-graph.js)


/** The panel's graph half, built once into the chrome's phase list. */
function pgEnsureSide() {
    const list = document.getElementById('fePhaseList');
    if (!list || document.getElementById('pgSidePanel')) return;
    const host = document.createElement('div');
    host.id = 'pgSidePanel';
    host.className = 'pg-side';
    host.dataset.fePhase = 'production';
    const pal = [['new:shot', 'Shot', '#c07ce0'], ['new:sequence', 'Sequence', '#e2c15a'], ['new:sound:sfx', 'SFX', '#57c98a'],
        ['new:sound:ambient', 'Ambient', '#57c98a'], ['new:sound:music', 'Music', '#57c98a'], ['new:link', 'Linked frame', '#c07ce0']];
    host.innerHTML = `<input class="pg-side-find" placeholder="Find a shot" oninput="PG.find=this.value;pgRenderSide()">
        <div id="pgOutline"></div>
        <div><div class="fe-panel-kicker" style="margin-bottom:6px;">Add node · drag onto graph</div>
          <div class="pg-pal">${pal.map(([k, l, c]) => `<div draggable="true" title="Drag onto the graph"
              ondragstart="event.dataTransfer.setData('text/pg-add','${k}')"><i style="background:${c}"></i>${l}</div>`).join('')}</div></div>`;
    list.appendChild(host);
}

function pgSideClick(key) {
    if (state.currentPage !== 'productiongraph') navigateTo('productiongraph');
    // A shot inside a collapsed card has no position on screen: pan to the card that holds it.
    const card = pgCollapsedOf(key);
    if (card) {
        const c = document.getElementById('pgCanvas');
        if (c) {
            PG.pan.x = c.clientWidth / 2 - (card.x + card.w / 2) * PG.zoom;
            PG.pan.y = c.clientHeight / 2 - (card.y + card.h / 2) * PG.zoom;
            pgApplyView(); pgDrawEdges();
        }
        return;
    }
    const n = pgNode(key);
    if (n && !pgVisible(n)) { PG.scene = 'all'; pgRender(); }
    pgSelect(key);
    pgPanTo(key);
}

// (the DOMContentLoaded listener: kept in core, public/legacy/production-graph.js)



export {
    PG_PORT_COLOR,
    PG_JOINS,
    PG_KIND,
    pgElapsed,
    pgProgressHtml,
    pgPollRunning,
    pgSetRunning,
    loadProductionGraph,
    pgLoad,
    pgNode,
    pgSrc,
    pgThumb,
    pgShots,
    pgSecs,
    pgGroupHtml,
    pgInCollapsed,
    pgToggleCollapse,
    pgVisible,
    pgPort,
    pgNodeHtml,
    pgBorrowedBy,
    pgRender,
    pgPortCenter,
    pgPath,
    pgDrawEdges,
    pgPaintWaves,
    pgApplyView,
    pgCollapsedOf,
    pgBoxes,
    pgBounds,
    pgFit,
    pgZoomBy,
    pgMinimap,
    pgPanTo,
    pgWorldPoint,
    pgInitCanvas,
    pgCanWire,
    pgHintTargets,
    pgClearHints,
    pgWire,
    pgSelect,
    pgHeader,
    pgScene,
    PG_IMPACT_LOOK,
    pgBehind,
    pgBehindKeep,
    pgImpactPill,
    pgImpactDecorate,
    PG_ADD_CUE_TYPES,
    pgNextInsertCode,
    pgNearestShot,
    pgAddEntries,
    pgFilterEntries,
    pgTogglePick,
    pgOpenAddPalette,
    pgRenderAddPalette,
    pgCloseAddPalette,
    pgAddKey,
    pgPatternPreview,
    pgAddPick,
    pgHoldDecorate,
    PG_HOLD_ROUTES,
    pgToggleHold,
    pgEdgeColor,
    pgLegendHtml,
    pgRunChangedDescribe,
    pgRunChanged,
    PG_QUEUE_LABELS,
    pgQueueHtml,
    pgQueueLabel,
    pgLoadQueue,
    pgToggleQueue,
    pgQueueGo,
    pgQueueCollect,
    pgQueueCancel,
    pgQueueCancelRun,
    pgQueueRerun,
    pgToggleBehind,
    pgImpactDrawerHtml,
    pgTidy,
    pgToggleLock,
    pgOpenMenu,
    pgCloseMenu,
    pgMenuDo,
    pgUpscaleWhyNot,
    pgUpscale,
    PG_APPLY_TYPES,
    pgApplyTargets,
    pgApplyMenuItem,
    pgEditFlow,
    flowBackToGraph,
    pgApplyPickerHtml,
    pgApplyArmable,
    pgApplyPlanDescribe,
    pgApplyBudgetToggle,
    pgOpenApplyFlow,
    pgApplyChoose,
    pgFlowFormHtml,
    pgFlowFormSubmit,
    pgApplyFlow,
    PG_RUN_TO_HERE_TYPES,
    pgRunToHereDescribe,
    pgRunToHere,
    pgDuplicate,
    pgRemove,
    pgAddAt,
    pgCreateSequence,
    pgLinkChooser,
    pgLinkSave,
    pgBusy,
    pgRunNode,
    pgRunPending,
    pgSelectVersion,
    pgSelectFrame,
    pgDrawerOpen,
    pgRenderDrawer,
    pgPrevisTag,
    PG_PREVIS_STATE,
    pgLoadPrevis,
    pgVersionTitle,
    pgFlowBadge,
    pgFlowFramesHtml,
    pgFlowPickControls,
    pgFlowPick,
    pgFlowCancelRun,
    pgDrawerShot,
    pgLoadShotDetails,
    pgRefreshVideoPreview,
    pgVideoQuery,
    pgRenderPrompt,
    pgEditPart,
    pgPromptMode,
    pgPickTier,
    pgPickDur,
    pgPreviewVideo,
    pgGenerateVideo,
    pgVersionRow,
    pgDrawerSequence,
    pgSeqPut,
    pgSeqRemove,
    pgSeqAdd,
    pgJoinsOf,
    pgSetJoin,
    pgSetJoinPrompt,
    pgSetRef,
    pgSeqPlan,
    pgGenerateSequence,
    pgDrawerSound,
    pgCuePut,
    pgCuePreview,
    pgGenerateSound,
    pgDrawerVersion,
    pgLoadClipEditorial,
    pgSetClipAudioPolicy,
    pgReviewClipAudio,
    pgSaveClipEdit,
    pgRecipeHtml,
    pgRecipeFlowHtml,
    pgMakeAnotherPlan,
    pgLoadHowMade,
    pgMakeAnother,
    pgDropTarget,
    pgDroppedFile,
    pgDropFile,
    pgDropUpload,
    pgCompareHtml,
    pgWipe,
    pgCompareSelected,
    pgDrawerLink,
    ibSecs,
    pgInbetweenNodeHtml,
    pgDrawerInbetween,
    ibNextShot,
    ibStartFromShot,
    ibOpenSetup,
    ibOpenSetupFor,
    ibLoadPrice,
    ibCloseSetup,
    ibRenderSetup,
    ibStep,
    ibEveryTo,
    ibEvery,
    ibSaveSetup,
    ibGenerate,
    ibOpenDirect,
    ibCloseDirect,
    ibPct,
    ibRenderDirect,
    ibChip,
    ibLaneClick,
    ibEditRange,
    ibPutSpan,
    ibSaveRange,
    ibDeleteRange,
    ibFramesBody,
    ibSaveFrame,
    ibRegenerate,
    ibAddFrame,
    ibRemoveFrame,
    ibPickTake,
    ibApprove,
    ibMakeClip,
    pgTiles,
    pgRenderPlayback,
    pgSpanOf,
    pgMonitorHtml,
    pgPrepareVideo,
    pgShowTile,
    pgTileClick,
    pgPlayheadTo,
    pgStep,
    pgTogglePlay,
    pgStopPlay,
    pgStartPlay,
    pgPlayCurrent,
    pgSyncAudio,
    pgEnsureSide,
    pgSideClick,
};
