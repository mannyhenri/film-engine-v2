import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { legacy } from '../../../lib/legacy.js';
import { scenesOf, secondsOf, matchingSequence, collectReferences, briefOf, higgsfieldRecipe } from './studio-model.js';
import {
    EMOS, FAMS, INTS, MOVES, MV, MV_GROUPS, FRAMINGS, ANGLES, FACINGS, LENSES, TECHS, TRANS, TRANS_SHORT, SFX_QUICK, CAST_COLORS,
    nid, canonOf, lineLen, clamp, half, fmt, shortName, seedShot, applyEmotion, blankMove, beatStarts, compile, compileText, checks, ageConflicts,
    previsBehind, takePrevis, meetPrevis,
} from './direct-model.js';
import HiggsfieldCatalog from './HiggsfieldCatalog.jsx';
import ComfyPanel from './ComfyPanel.jsx';
import { mergePrompt } from './prompt-merge.js';

/*
 * Generate, as the Direct studio (design pass 2, approved 2026-10-15).
 *
 *   Storyboard (left) → tick shots; two or more can be grouped as a sequence.
 *   Preview + live Prompt (top) → the animatic plays the storyboard frames with
 *     the camera moves simulated, the lines as captions and the acting cues;
 *     the prompt beside it rebuilds on every change, one paragraph per beat.
 *   Timeline (bottom) → shots and transitions, beats, camera moves, one lane per
 *     character (lines and acting marks), effects, ambience, music. Anything on
 *     it opens just that thing in Direct.
 *   Direct (right) → sequence, transition, shot (Acting, Camera, Dialogue, Sound,
 *     Light), character, move, line, effect, ambience, music; a breadcrumb back up.
 *   Generate (right, bottom) → live checks against the chosen model, its cost,
 *     then the same send the old tab used (draft saved, paid-request review).
 *
 * What the director sets is saved per shot (routes/production-studio.js,
 * direction); the scene card changes only on "Also update the screenplay".
 */
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '21:9'];
const RESOLUTIONS = ['', '720p', '1080p', '2K', '4K'];
const SHOT_TABS = [['acting', 'Acting'], ['camera', 'Camera'], ['dialogue', 'Dialogue'], ['sound', 'Sound'], ['light', 'Light']];
const famName = Object.fromEntries(FAMS);
const clone = (o) => JSON.parse(JSON.stringify(o));
const cut = (t, n) => (t.length > n ? t.slice(0, n) + '…' : t);
/** A shot's board picture at a width the server resizes to: a thumbnail never downloads the full frame. */
const shotImg = (node, w) => { const f = node && (node.selected_frame || (node.frames || []).slice(-1)[0]); return f?.url ? `${legacy.API_BASE}${f.url}${f.url.includes('?') ? '&' : '?'}w=${w}` : ''; };

const DEFAULT_STUDIO = { picked: [], grouped: false, order: [], mode: 'sep', model: '', bracket: true, amb: null, music: { on: false, text: '' },
    ages: {}, settings: {}, hand: null, hands: {}, optimized: {}, aspect: '16:9', resolution: '', audio: true, provider: 'higgsfield' };

export default function DirectStudio({ pid, graph, catalog, reload }) {
    const scenes = useMemo(() => scenesOf(graph), [graph]);
    const board = useMemo(() => scenes.flatMap(s => s.shots), [scenes]);
    const byId = useMemo(() => new Map(board.map(s => [s.id, s])), [board]);

    const [info, setInfo] = useState(null);            // GET direction: cards, cast, scenes
    const [S, setS] = useState({});                    // shot id → direction
    const [studio, setStudio] = useState(DEFAULT_STUDIO);
    const [ui, setUi] = useState({ promptTab: 'work', sel: { k: 'none' }, tab: 'acting', zoom: 'seq', fam: 'all', emoQ: '', lib: null, mvGroup: 'all', mvQ: '', promptShot: null, askApply: false, lnConfirm: null });
    const [t, setT] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [flash, setFlash] = useState(null);
    const [pending, setPending] = useState(0);
    const [starters, setStarters] = useState({});
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState('');
    const [changes, setChanges] = useState(null);
    const [copied, setCopied] = useState(false);
    const patchUi = (p) => setUi(u => ({ ...u, ...p }));

    // ---------- load and save ----------
    const revs = useRef({ shots: {}, studio: 0 });
    const dirty = useRef({ shots: new Set(), studio: false });
    const saveTimer = useRef(null);
    const latest = useRef({ S, studio });
    latest.current = { S, studio };

    const load = useCallback(async () => {
        if (!pid) return;
        try {
            const r = await legacy.api(`/projects/${pid}/production-studio/direction`);
            setInfo(r);
            revs.current = { shots: Object.fromEntries(Object.entries(r.shots || {}).map(([id, x]) => [id, x.revision || 0])), studio: r.studio_revision || 0 };
            const canon = canonOf((r.cast || []).map(c => c.name));
            // An applied Previz meets each shot by time (meetPrevis): an Apply newer than the last change here takes the
            // camera outright; changes here that are newer stay, and the Camera tab says which won. A shot that took
            // Previz is saved, so the next read finds it settled.
            const took = [];
            const next = Object.fromEntries(Object.entries(r.shots || {}).map(([id, x]) => {
                const d = x.direction && x.direction.v ? x.direction : seedShot(x.card, x.card.duration_s, canon);
                const m = meetPrevis(d, x);
                if (m.took === 'previz' || m.took === 'merged') took.push(id);
                return [id, m.d];
            }));
            // Edits made here since the read began (still unsaved) are kept over what was read.
            const unsaved = [...dirty.current.shots];
            setS(prev => ({ ...next, ...Object.fromEntries(unsaved.filter(id => prev[id]).map(id => [id, prev[id]])) }));
            if (took.length) { for (const id of took) dirty.current.shots.add(id); queueSaveRef.current(); }
            if (r.studio) setStudio(s => ({ ...DEFAULT_STUDIO, ...r.studio, hand: r.studio.hand ?? null }));
        } catch (err) { legacy.setStatus('Direction: ' + err.message); }
    }, [pid]);
    useEffect(() => { load(); }, [load]);
    /*
     * Read again when the page is shown again: the app keeps Production mounted while the director is in Previz, so
     * an Apply made there reached Generate only after a restart. Every visit reloads the graph (a new `graph`), and a
     * window brought back to the front counts too. Unsaved edits here are saved first, then the read keeps them.
     */
    const seenGraph = useRef(graph);
    useEffect(() => {
        if (seenGraph.current === graph) return;
        seenGraph.current = graph;
        flushRef.current().finally(() => load());
    }, [graph, load]);
    useEffect(() => {
        const back = () => { if (document.visibilityState === 'visible') flushRef.current().finally(() => load()); };
        window.addEventListener('focus', back);
        document.addEventListener('visibilitychange', back);
        return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
    }, [load]);
    // A shot the direction read did not carry (added since, or no card yet) starts from what the graph knows of it.
    useEffect(() => {
        if (!info) return;
        const missing = board.filter(s => !S[s.id]);
        if (missing.length) setS(prev => ({ ...prev, ...Object.fromEntries(missing.map(s => [s.id, seedShot({ description: s.description, camera: { shot_type: s.framing } }, secondsOf(s.duration_ms))])) }));
    }, [info, board]); // eslint-disable-line react-hooks/exhaustive-deps

    /*
     * Saves, the model ranking and the rewrite pass `refresh: false`: none of them changes the production graph,
     * and the app's after-write refresh reloads the whole graph (and every asset's provenance) on each one.
     * Left on, a few minutes of directing went past the server's 200 requests a minute.
     */
    const flush = useCallback(async () => {
        clearTimeout(saveTimer.current);
        const { S: cur, studio: st } = latest.current;
        const ids = [...dirty.current.shots]; dirty.current.shots.clear();
        const doStudio = dirty.current.studio; dirty.current.studio = false;
        const left = new Set(ids);
        try {
            for (const id of ids) {
                if (!cur[id]) { left.delete(id); continue; }
                const r = await legacy.api(`/projects/${pid}/production-studio/direction/shots/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ data: cur[id] }), refresh: false });
                revs.current.shots[id] = r.revision; left.delete(id);
            }
            if (doStudio) {
                const r = await legacy.api(`/projects/${pid}/production-studio/direction/studio`, { method: 'PUT', body: JSON.stringify({ data: st }), refresh: false });
                revs.current.studio = r.revision;
            }
        } catch (err) {
            // Nothing is dropped: what did not save stays queued and is tried again shortly.
            for (const id of left) dirty.current.shots.add(id);
            if (doStudio) dirty.current.studio = true;
            legacy.setStatus('Direction not saved yet (' + err.message + '). Trying again in a few seconds.');
            clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => flushRef.current(), 5000);
        }
    }, [pid]);
    const flushRef = useRef(flush); flushRef.current = flush;
    const queueSave = useCallback(() => { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(flush, 600); }, [flush]);
    const queueSaveRef = useRef(queueSave); queueSaveRef.current = queueSave;
    useEffect(() => () => { if (dirty.current.shots.size || dirty.current.studio) flush(); }, [flush]);

    const flashT = useRef(null);
    const touch = (shot, at) => { setFlash({ shot, t: at }); clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(null), 1600); };
    /** Change one shot's direction: saved, flashed in the prompt, counted while the prompt is hand-edited. */
    const edit = (id, fn, at = null) => {
        setS(prev => { const s = clone(prev[id]); const out = fn(s) || s; return { ...prev, [id]: out }; });
        dirty.current.shots.add(id); queueSave(); touch(id, at);
    };
    const setSt = (p, { quiet = false } = {}) => {
        setStudio(s => ({ ...s, ...p })); dirty.current.studio = true; queueSave();
        if (!quiet) touch(null, null);
    };

    // ---------- the film as the studio reads it ----------
    const cards = info?.shots || {};
    const castList = info?.cast || [];
    const castKey = useMemo(() => canonOf(castList.map(c => c.name)), [info]); // eslint-disable-line react-hooks/exhaustive-deps
    const colorOf = (ch) => { const i = castList.findIndex(c => castKey(c.name) === ch); return CAST_COLORS[(i < 0 ? castList.length + ch.length : i) % CAST_COLORS.length]; };
    const nameOf = (ch) => shortName(ch);
    const ready = !!info && board.length > 0;
    const label = (id) => byId.get(id)?.shot_code || '?';
    const picked = studio.picked.filter(id => byId.has(id) && S[id]);
    const grouped = studio.grouped && picked.length > 1;
    const scope = grouped ? studio.order.filter(id => picked.includes(id)).concat(picked.filter(id => !studio.order.includes(id))) : board.map(s => s.id).filter(id => picked.includes(id));
    const offsets = {}; let total = 0;
    for (const id of scope) { offsets[id] = total; total += S[id].dur; }
    const shotAt = (time) => { for (const id of scope) if (time < offsets[id] + S[id].dur) return id; return scope[scope.length - 1]; };
    const sel = ui.sel;
    const focus = sel.shot && scope.includes(sel.shot) ? sel.shot : scope.length ? shotAt(t) : null;
    const one = grouped && studio.mode === 'one';
    const promptCodes = !scope.length ? [] : one ? scope : [ui.promptShot && scope.includes(ui.promptShot) ? ui.promptShot : focus];
    const unitShots = promptCodes.map(id => byId.get(id)).filter(Boolean);
    const unitDur = promptCodes.reduce((a, id) => a + S[id].dur, 0);
    const sceneOf = (id) => byId.get(id)?.scene_id;
    const sceneInfo = (id) => info?.scenes?.[sceneOf(id)] || {};
    const defaultSetting = (sid) => { const sc = info?.scenes?.[sid] || {}; return [sc.setting || sc.heading, sc.time_of_day && !String(sc.heading || '').includes(sc.time_of_day) ? sc.time_of_day.toLowerCase() : '', sc.light ? sc.light + ' light' : '', sc.atmosphere].filter(Boolean).join('. '); };
    const settingOf = (sid) => studio.settings?.[sid] ?? defaultSetting(sid);
    const amb = studio.amb || { on: true, text: (scope[0] && sceneInfo(scope[0]).sound) || '' };

    /*
     * A new storyboard frame or reference plate made elsewhere (Storyboard, Characters…) reaches here: each read of the
     * graph (a visit, a reload) drops the plates read before, so the picked shots' starters are read again. They were
     * read once per session, so Generate kept sending the old frame.
     */
    const graphSeen = useRef(graph);
    const [plateRead, setPlateRead] = useState(0);
    useEffect(() => { if (graphSeen.current !== graph) { graphSeen.current = graph; setStarters({}); setPlateRead(n => n + 1); } }, [graph]);
    // References: the starters' plates for the shots being generated, and which tag each character gets.
    useEffect(() => {
        const missing = picked.filter(id => !starters[id]);
        if (!missing.length || !pid) return;
        let gone = false;
        Promise.all(missing.map(id => { const s = byId.get(id); return legacy.api(`/projects/${pid}/production-graph/nodes/${encodeURIComponent(s.key)}/draft/starter?kind=video&provider=higgsfield`)
            .then(r => [id, { ...(r.recipe || {}), unmatched: (r.unresolved || []).length }], err => [id, { prompt: s.description || '', error: err.message }]); }))
            .then(pairs => { if (!gone) setStarters(m => ({ ...m, ...Object.fromEntries(pairs) })); });
        return () => { gone = true; };
    }, [picked.join(','), pid, plateRead]); // eslint-disable-line react-hooks/exhaustive-deps
    const recipes = promptCodes.map(id => starters[id]).filter(Boolean);
    const { start, references } = useMemo(() => collectReferences(recipes), [starters, promptCodes.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
    const facts = catalog.models.find(m => m.id === studio.model) || null;
    // Higgsfield only (Runway was removed 2026-10-24): the ranking, the models and the price are Higgsfield's.
    const maxRefs = facts && Number.isFinite(facts.max_images) ? facts.max_images : null;
    const refOf = (ch) => {
        const c = castList.find(x => castKey(x.name) === ch);
        const owner = (r) => info?.ref_owners?.[r.asset_id];
        const i = references.findIndex(r => (c && r.character_id === c.id) || (owner(r) && castKey(owner(r)) === ch) || (r.name && castKey(r.name) === ch));
        if (i < 0) return '';
        return maxRefs === null || i + (start ? 1 : 0) < maxRefs ? `@image${i + 1}` : '';
    };
    const ageOf = (ch) => { const a = studio.ages?.[ch]; if (a !== undefined) return a; return conflicts.some(c => c.ch === ch) ? '' : (castList.find(x => castKey(x.name) === ch)?.age || ''); };
    const unitChars = [...new Set(promptCodes.flatMap(id => [...S[id].lines.map(l => l.ch), ...Object.keys(S[id].perf || {})]))];
    const conflicts = ready ? ageConflicts(unitChars, promptCodes.map(id => [label(id), cards[id]?.card || {}]), ch => castList.find(x => castKey(x.name) === ch)?.age || '', nameOf, castList.map(c => castKey(c.name))) : [];

    const prevTrans = !one && grouped && promptCodes[0] && scope.indexOf(promptCodes[0]) > 0 ? (S[scope[scope.indexOf(promptCodes[0]) - 1]].transOut || 'continuous') : null;
    const compiled = ready && promptCodes.length ? compile({ codes: promptCodes, shots: S, one, bracket: studio.bracket, nameOf, refOf, ageOf, flash, labelOf: label,
        setting: [...new Set(promptCodes.map(sceneOf))].map(settingOf).filter(Boolean).join(' '), amb, music: studio.music, prevTrans }) : null;
    const compiledText = compileText(compiled);
    /*
     * The director's own text, kept per shot or sequence (it was one text for whatever was picked, so another shot showed
     * it). What the controls add later is merged into it (prompt-merge.js): a sound at the playhead, music, a line. Only
     * a change to words the director rewrote stays out, and is counted below the text.
     */
    const unitKey = (one ? 'seq:' : 'shot:') + promptCodes.join('+');
    /*
     * What Optimize writes for: every picked shot once two or more are picked (grouped or not, one clip or separate),
     * so the Seedance prompt carries the whole sequence's direction and pictures; one shot alone is that shot.
     */
    const optCodes = scope.length > 1 ? scope : promptCodes;
    const optKey = scope.length > 1 ? 'seq:' + scope.join('+') : unitKey;
    const handEntry = (studio.hands || {})[unitKey] || null;
    const hand = handEntry ? handEntry.text : null;
    const finalText = hand !== null ? hand : compiledText;
    const setHand = (text, base = compiledText) => {
        setStudio(st => {
            const hands = { ...(st.hands || {}) };
            if (text === null) delete hands[unitKey]; else hands[unitKey] = { text, base };
            return { ...st, hands, hand: null };
        });
        dirty.current.studio = true; queueSave();
    };
    useEffect(() => {   // one text from before it was kept per shot: it belongs to what is picked now
        if (ready && studio.hand && promptCodes.length && !(studio.hands || {})[unitKey]) setHand(studio.hand, null);
    }, [ready, unitKey]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!handEntry || !compiledText) return;
        if (handEntry.base == null) { setHand(handEntry.text, compiledText); return; }
        if (handEntry.base === compiledText) return;
        const m = mergePrompt(handEntry.base, handEntry.text, compiledText);
        setHand(m.text, compiledText);
        if (m.conflicts) setPending(n => n + m.conflicts);
    }, [compiledText, unitKey]); // eslint-disable-line react-hooks/exhaustive-deps
    // A running optimize is a job on the server, kept per shot or sequence, so leaving the tab does not lose it.
    const optJobId = (studio.optimizing || {})[optKey] || null;
    const [optJob, setOptJob] = useState(null);
    useEffect(() => {   // follow the job: its stage and time, then its prompt onto the tab
        if (!optJobId?.id || !pid) { setOptJob(null); return undefined; }
        let gone = false, t = null;
        const done = () => setStudio(st => { const o = { ...(st.optimizing || {}) }; delete o[optKey]; return { ...st, optimizing: o }; });
        const poll = async () => {
            try {
                const r = await legacy.api(`/projects/${pid}/production-studio/seedance-prompt/jobs/${optJobId.id}`, { refresh: false });
                if (gone) return;
                setOptJob(r.job);
                if (r.job.status === 'done') {
                    setStudio(st => ({ ...st, optimized: { ...(st.optimized || {}), [optKey]: { ...r.job.result, from: optJobId.from } } })); done();
                    dirty.current.studio = true; queueSave(); return;
                }
                if (r.job.status === 'failed') { legacy.setStatus('Optimize failed: ' + r.job.error); done(); dirty.current.studio = true; queueSave(); return; }
            } catch (err) { if (!gone) { legacy.setStatus('Optimize: ' + err.message); done(); return; } }
            if (!gone) t = setTimeout(poll, 1000);
        };
        poll();
        return () => { gone = true; clearTimeout(t); };
    }, [optJobId?.id, optKey, pid]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---------- models: the server's ranking for exactly what would be sent ----------
    const ask = useRef(0);
    const recommend = useCallback(async (ai = false) => {
        if (!unitShots.length || !pid) return;
        const ticket = ++ask.current;
        if (ai) setBusy('judge');
        try {
            const brief = briefOf({ shots: unitShots, prompt: finalText, references, start, aspect: studio.aspect, resolution: studio.resolution || undefined });
            brief.duration_s = unitDur; brief.dialogue = promptCodes.some(id => S[id].lines.length > 0);
            const out = await legacy.api(`/projects/${pid}/production-studio/recommend`, { method: 'POST', body: JSON.stringify({ ...brief, ai }), refresh: false });
            if (ticket !== ask.current) return;
            setResult(out);
            const top = out.cards?.[0];
            if (top && (!studio.model || ai || !catalog.models.some(m => m.id === studio.model))) setSt({ model: top.id }, { quiet: true });
            if (out.judge_error) legacy.setStatus('AI judgement unavailable: ' + out.judge_error + '. Showing the rules ranking.');
        } catch (err) { if (ticket === ask.current) legacy.setStatus('Recommendation failed: ' + err.message); }
        finally { if (ai) setBusy(''); }
    }, [pid, unitShots.map(s => s.id).join(','), unitDur, finalText, references.length, !!start, studio.aspect, studio.resolution, studio.model, catalog.models]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { const h = setTimeout(() => recommend(false), 500); return () => clearTimeout(h); }, [promptCodes.join(','), unitDur, studio.aspect, studio.resolution, references.length, compiledText.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
    const sendAudio = !!facts?.native_audio;
    useEffect(() => { if (facts) setStudio(s => ({ ...s, audio: sendAudio })); }, [studio.model]); // eslint-disable-line react-hooks/exhaustive-deps

    const cards4 = result?.cards || [];
    const cardOf = cards4.find(c => c.id === studio.model) || null;
    const blockedWhy = (result?.blocked || []).find(b => b.id === studio.model)?.why || '';
    const factsOf = (id) => { const f = catalog.models.find(m => m.id === id); return f ? { label: f.label, min: f.duration?.min, max: f.duration?.max, refs: f.max_images } : null; };
    const unitFacts = studio.model ? factsOf(studio.model) : null;
    const alternatives = catalog.models.filter(m => m.id !== studio.model && !m.external && m.duration && Number.isFinite(m.duration.max))
            .map(m => ({ id: m.id, label: m.label, max: m.duration.max, refs: m.max_images, rank: cards4.findIndex(c => c.id === m.id) }))
            .filter(a => a.rank >= 0).sort((a, b) => a.rank - b.rank);
    const lengthBlocked = blockedWhy && /Up to \d+s/.test(blockedWhy);
    const ck = compiled ? checks({ units: one ? [{ ids: scope, dur: total, label: scope.map(label).join('+') }] : promptCodes.map(id => ({ ids: [id], dur: S[id].dur, label: label(id) })),
        one, shots: S, facts: unitFacts, alternatives, refsNeeded: () => (start ? 1 : 0) + references.length, hand: hand !== null, blocked: lengthBlocked ? '' : blockedWhy,
        conflicts: conflicts.filter(c => studio.ages?.[c.ch] === undefined).map(c => ({ text: `${nameOf(c.ch)}'s age disagrees: profile ${c.profile}, ${c.shot}'s note “${c.card}”. The prompt leaves the age out until you choose; canon is not changed.`,
            fixes: [{ lab: `Use ${c.profile} here`, act: { type: 'age', ch: c.ch, v: c.profile } }, { lab: `Use “${c.card}” here`, act: { type: 'age', ch: c.ch, v: c.card } }] })) }) : [];
    const hasErr = ck.some(x => x.k === 'err');
    const doFix = (a) => {
        if (a.type === 'mode') setSt({ mode: a.mode });
        if (a.type === 'model') setSt({ model: a.id });
        if (a.type === 'age') setSt({ ages: { ...studio.ages, [a.ch]: a.v } });
        if (a.type === 'trim') edit(a.id, s => { s.dur = a.to; s.lines.forEach(l => { l.t = Math.min(l.t, a.to - 0.8); }); s.moves.forEach(m => { m.end = Math.min(m.end, a.to); m.start = Math.min(m.start, a.to - 0.5); }); });
    };

    // ---------- playback ----------
    const timer = useRef(null);
    const totalRef = useRef(total); totalRef.current = total;
    const stop = () => { clearInterval(timer.current); timer.current = null; setPlaying(false); };
    const togglePlay = () => {
        if (playing) { stop(); return; }
        if (!total) return;
        if (t >= total - 0.1) setT(0);
        setPlaying(true);
        timer.current = setInterval(() => setT(prev => { const n = Math.round((prev + 0.1) * 10) / 10; if (n >= totalRef.current) { stop(); return totalRef.current; } return n; }), 100);
    };
    useEffect(() => () => clearInterval(timer.current), []);
    useEffect(() => { if (t > total) setT(total); }, [total]); // eslint-disable-line react-hooks/exhaustive-deps
    const beatTimes = () => scope.flatMap(id => beatStarts(S[id]).map(b => offsets[id] + b)).sort((a, b) => a - b);

    if (!graph) return <div className="ds"><p className="ps-muted" style={{ padding: 20 }}>Loading shots…</p></div>;
    if (!board.length) return <div className="ds"><p className="ps-muted" style={{ padding: 20 }}>No shots yet. Break the screenplay into shots first.</p></div>;
    if (!info) return <div className="ds"><p className="ps-muted" style={{ padding: 20 }}>Loading direction…</p></div>;

    /** Select something; if it is a shot outside the playhead, the playhead jumps to it. */
    const go = (s2) => () => {
        const p = { sel: s2, lib: null, askApply: false, lnConfirm: null };
        if (s2.shot && scope.includes(s2.shot) && !playing) { const lt = t - offsets[s2.shot]; if (lt < 0 || lt >= S[s2.shot].dur) setT(offsets[s2.shot]); }
        if (s2.shot) p.promptShot = s2.shot;
        patchUi(p);
    };
    const toggleShot = (id) => {
        const pk = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id];
        const ord = grouped ? studio.order.filter(x => pk.includes(x)).concat(pk.filter(x => !studio.order.includes(x))) : [];
        const still = grouped && ord.length > 1;
        let s2 = sel.shot && !pk.includes(sel.shot) ? { k: 'none' } : sel;
        if (!still && (s2.k === 'seq' || s2.k === 'trans')) s2 = { k: 'none' };
        // One shot ticked and nothing open: it is the shot being directed.
        if (pk.length === 1 && s2.k === 'none') s2 = { k: 'shot', shot: pk[0] };
        setSt({ picked: pk, order: still ? ord : [], grouped: still }, { quiet: true });
        patchUi({ sel: s2 }); setT(0);
    };
    const group = () => { setSt({ grouped: true, order: board.map(s => s.id).filter(id => picked.includes(id)) }, { quiet: true }); patchUi({ sel: { k: 'seq' } }); };
    const ungroup = () => { setSt({ grouped: false, order: [], mode: 'sep' }, { quiet: true }); patchUi({ sel: { k: 'none' } }); };
    const lt0 = focus ? clamp(t - offsets[focus], 0, Math.max(0, S[focus].dur - 0.5)) : 0;
    const addAt = () => ({ id: focus, lt: focus && Number.isFinite(lt0) ? half(lt0) : 0 });   // a playhead not yet placed is the start

    // ---------- preview ----------
    const pv = { has: scope.length > 0 };
    if (pv.has) {
        const pc = shotAt(t); const s = S[pc]; const lt = t - offsets[pc]; const node = byId.get(pc);
        let sx = 1.18, tx = 0, ty = 0, rr = 0; const mv = [];
        for (const m of [...s.moves].sort((a, b) => a.start - b.start)) {
            const d = MV[m.type]; if (!d) continue;
            let p = clamp((lt - m.start) / Math.max(0.1, m.end - m.start), 0, 1);
            if (m.curve === 'ease') p = p * p * (3 - 2 * p);
            sx += d.fx.s * p; tx += d.fx.x * p; ty += d.fx.y * p; rr += d.fx.r * p;
            if (lt >= m.start && lt <= m.end) mv.push(m.type === 'rack' ? 'Focus → ' + (m.to || 'subject') : d.name);
            if (m.type === 'handheld' && lt >= m.start && lt <= m.end) { tx += Math.sin(lt * 7) * 0.6; ty += Math.cos(lt * 5) * 0.5; }
        }
        pv.img = shotImg(node, 1280);
        // The selected take, else the newest (as Cut plays it): picking a take lives only in the hidden classic graph.
        const clip = (node?.videos || []).find(v => v.asset_id === node.selected_video_asset_id) || (node?.videos || [])[(node?.videos || []).length - 1];
        pv.clip = clip?.url ? legacy.API_BASE + clip.url : '';
        pv.lt = lt;
        pv.tf = `scale(${Math.max(1.02, sx).toFixed(3)}) translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%) rotate(${rr.toFixed(2)}deg)`;
        const bts = beatStarts(s); let bi = 0; bts.forEach((b, i) => { if (lt >= b) bi = i; });
        pv.tag = `${label(pc)} · ${(FRAMINGS.find(f => f[0] === s.cam.framing) || [, s.cam.framing])[1]} · beat ${bi + 1}`;
        pv.move = mv.length ? mv.join(' + ') : 'Camera at rest';
        for (const l of s.lines) if (lt >= l.t && lt <= l.t + lineLen(l)) pv.sub = nameOf(l.ch) + ': ' + l.text;
        for (const p of Object.values(s.perf || {})) for (const b of p.beats || []) if (b.on && b.part !== 'voice' && lt >= b.t && lt <= b.t + 1.6) pv.cue = b.text;
    }

    // ---------- timeline ----------
    let r0 = 0, r1 = total;
    if (ui.zoom === 'shot' && focus) { r0 = offsets[focus]; r1 = offsets[focus] + S[focus].dur; }
    const span = Math.max(1, r1 - r0);
    const X = (x) => ((x - r0) / span * 100).toFixed(3) + '%';
    const W = (a, b) => Math.max(0.4, (Math.min(b, r1) - Math.max(a, r0)) / span * 100).toFixed(3) + '%';
    const vis = (a, b) => b > r0 && a < r1;
    const stepT = span > 40 ? 10 : span > 16 ? 5 : 2;
    const ticks = []; for (let x = Math.ceil(r0 / stepT) * stepT; x <= r1; x += stepT) ticks.push(x);
    const laneCast = [...new Set(scope.flatMap(id => [...S[id].lines.map(l => l.ch), ...Object.keys(S[id].perf || {})]))];
    const seek = (e) => { const r = e.currentTarget.getBoundingClientRect(); const f = clamp((e.clientX - r.left) / r.width, 0, 1); setT(Math.round((r0 + f * span) * 10) / 10); };

    // ---------- direct panel ----------
    const crumbSeq = grouped ? [{ lab: 'Sequence', go: go({ k: 'seq' }) }] : [];
    let k = sel.k;
    const shotCode = sel.shot && scope.includes(sel.shot) ? sel.shot : null;
    if (k === 'none' || !scope.length || (sel.shot && !shotCode) || ((k === 'seq' || k === 'trans') && !grouped)) k = scope.length > 1 && !grouped ? 'picked' : 'none';
    let title = '', crumb = null, here = '';
    if (k === 'none') title = scope.length ? 'Nothing selected' : 'Start';
    if (k === 'picked') title = 'Picked shots';
    if (k === 'seq') title = `Sequence · ${total}s`;
    if (k === 'trans') { title = 'Transition'; crumb = crumbSeq; here = `${label(sel.after)} → ${label(scope[scope.indexOf(sel.after) + 1])}`; }
    if (k === 'shot' && shotCode) { title = 'Shot ' + label(shotCode); crumb = grouped ? crumbSeq : null; here = label(shotCode); }
    if (k === 'char' && shotCode) { title = `${nameOf(sel.ch)} in ${label(shotCode)}`; crumb = [...crumbSeq, { lab: label(shotCode), go: go({ k: 'shot', shot: shotCode }) }]; here = nameOf(sel.ch); }
    const toTab = (tab) => () => patchUi({ sel: { k: 'shot', shot: shotCode }, tab, lib: null });
    if (k === 'move' && shotCode) { title = 'Camera move'; crumb = [...crumbSeq, { lab: label(shotCode) + ' camera', go: toTab('camera') }]; here = MV[S[shotCode].moves.find(m => m.id === sel.id)?.type]?.name || ''; }
    if (k === 'line' && shotCode) { title = 'Line'; crumb = [...crumbSeq, { lab: label(shotCode) + ' dialogue', go: toTab('dialogue') }]; here = nameOf(S[shotCode].lines.find(l => l.id === sel.id)?.ch || ''); }
    if (k === 'sfx' && shotCode) { title = 'Sound effect'; crumb = [...crumbSeq, { lab: label(shotCode) + ' sound', go: toTab('sound') }]; here = cut(S[shotCode].sfx.find(f => f.id === sel.id)?.text || 'new sound', 28); }
    if (k === 'amb') { title = 'Ambience'; crumb = grouped ? crumbSeq : null; here = 'Ambience'; }
    if (k === 'music') { title = 'Music'; crumb = grouped ? crumbSeq : null; here = 'Music'; }

    const modelChips = (cards4.length ? cards4.slice(0, 4) : []).map(c => (
        <button key={c.id} type="button" className={'ds-chip' + (studio.model === c.id ? ' on' : '')} aria-pressed={studio.model === c.id} onClick={() => setSt({ model: c.id })}>
            {c.label}<small>{c.facts?.duration ? `max ${c.facts.duration.max}s` : ''}{c.share ?? c.fit ? ` · ${c.share ?? c.fit}%` : ''}</small>
        </button>));
    const modelAudio = facts ? (facts.native_audio ? `${facts.label} makes sound in the clip (switchable). Speech timing is requested, not guaranteed; no separate stems.` : `${facts.label} makes no sound: lines are left for ElevenLabs and Cut.`) : '';

    const send = async () => {
        if (!unitShots.length || hasErr || !studio.model) return;
        // No key gate: Higgsfield is still a manual hand-over (backend/lib/manual-generation.js). The final review
        // gives the prompt and assets to generate in the vendor's own app; a key sends nothing, so none is needed.
        await flush();
        setBusy('send');
        try {
            const ids = unitShots.map(s => s.id);
            let key, path;
            if (ids.length === 1) { key = unitShots[0].key; path = `/shots/${ids[0]}/video/generate`; }
            else {
                let seq = matchingSequence(graph, ids);
                if (!seq) { const made = await legacy.api(`/projects/${pid}/sequences`, { method: 'POST', body: JSON.stringify({ name: unitShots.map(s => s.shot_code).join('–'), shot_ids: ids }) }); seq = made.sequence; }
                key = `seq:${seq.id}`; path = `/sequences/${seq.id}/generate-native`;
            }
            const node = `/projects/${pid}/production-graph/nodes/${encodeURIComponent(key)}/draft`;
            const current = await legacy.api(node);
            const recipe = higgsfieldRecipe({ model: studio.model, prompt: finalText, references, start, durationS: unitDur, aspect: studio.aspect, resolution: studio.resolution || undefined,
                    audio: studio.audio, maxImages: facts?.max_images, startFrame: facts ? facts.start_frame : true });
            const saved = await legacy.api(node, { method: 'PUT', body: JSON.stringify({ expected_revision: current?.draft?.revision || 0, payload: { ...(current?.draft?.payload || {}), video: recipe }, source_asset_id: null }) });
            const revision = (saved.draft || saved).revision;
            const out = await legacy.api(path, { method: 'POST', body: JSON.stringify({ production_draft: { node_key: key, revision } }) });
            const sentTo = facts?.label || studio.model;
            legacy.setStatus(out?.job_id || out?.status === 'submitted' ? `Sent to ${sentTo}. The take lands in 04 Video/Clips and on the timeline when it is ready.` : `New take from ${sentTo} saved.`);
            await reload();
        } catch (err) {
            // Closing the final review is the end of a hand-over, not a failure: say where the take goes back in.
            if (err.code === 'FINAL_REQUEST_CANCELLED') legacy.setStatus(`Generate it on Higgsfield with the prompt and assets from the review, then import the clip on Video Shots: it becomes this shot's take.`);
            else legacy.setStatus('Not sent: ' + err.message);
        }
        finally { setBusy(''); }
    };
    /*
     * Optimize with AI: the final Seedance 2.5 prompt, by ChatGPT, the director's way (backend/lib/seedance-prompt.js):
     * the character and location sheets, the props, each shot's storyboard frame and the recorded dialogue on a black
     * MP4, with the working prompt as it stands and the stored Seedance guide. It lands on its own tab, so the working
     * prompt stays as it is, and in a hand-off folder named by the labels the prompt binds.
     */
    const onPc = studio.genOn === 'pc';   // Generate on the ComfyUI PC (ComfyPanel) instead of the Higgsfield hand-over
    const optimized = (studio.optimized || {})[optKey] || null;
    // The dialogue recording for this clip, when the director has one (the scene's whole take, say): where this clip starts in it.
    const dialogueFile = (studio.dialogue || {})[optKey] || null;
    const setDialogue = v => setSt({ dialogue: { ...(studio.dialogue || {}), [optKey]: v || undefined } }, { quiet: true });
    // The working text Optimize starts from: the prompt as shown when it is the whole unit (one shot, or one clip); for
    // several shots, each shot's own working text (the director's edit of it, else as the controls write it) in order,
    // under its code and time in the sequence.
    const shotText = id => (studio.hands || {})['shot:' + id]?.text ?? compileText(compile({ codes: [id], shots: S, one: false, bracket: studio.bracket, nameOf, refOf, ageOf,
        flash: null, labelOf: label, setting: settingOf(sceneOf(id)) || '', amb, music: studio.music, prevTrans: null }));
    const optText = optCodes.length > 1 && !(one && optCodes.join() === promptCodes.join())
        ? optCodes.map(id => `SHOT ${label(id)} (${fmt(offsets[id])}–${fmt(offsets[id] + S[id].dur)}, ${S[id].dur}s${scope.indexOf(id) < scope.length - 1 && grouped ? `; then: ${S[id].transOut || 'continuous'}` : ''})\n${shotText(id)}`).join('\n\n')
        : finalText;
    const optDur = optCodes.reduce((a, id) => a + S[id].dur, 0);
    const optRefs = optCodes.length === promptCodes.length ? references : collectReferences(optCodes.map(id => starters[id]).filter(Boolean)).references;
    let promptSha = 0; for (let i = 0; i < optText.length; i++) promptSha = (promptSha * 31 + optText.charCodeAt(i)) | 0;   // no hook: below the early returns
    /*
     * The unit a generation is made from, as the server gathers it (lib/seedance-prompt.js gather): the shots and
     * their lines, the cast, locations and props, each shot's storyboard frame, the chosen dialogue recording.
     * Optimize sends it to ChatGPT; "My PC" sends it to ComfyUI (lib/comfyui-shot.js).
     */
    const castId = ch => castList.find(x => castKey(x.name) === ch)?.id;
    const frameOf = r => [r?.init_image, r?.image_url, Array.isArray(r?.keyframes) ? r.keyframes[0] : null].find(f => f && f.asset_id)?.asset_id;
    const unitBody = (codes, text, refs, dur) => {
        const chars = [...new Set(codes.flatMap(id => [...S[id].lines.map(l => l.ch), ...Object.keys(S[id].perf || {})]))];
        return {
            label: codes.map(label).join('+'), prompt: text, duration_s: dur, aspect: studio.aspect,
            shots: codes.map(id => ({ shot_id: id, code: label(id), offset_s: codes.length > 1 ? offsets[id] - offsets[codes[0]] : 0,
                lines: S[id].lines.map((l, index) => ({ index, t: l.t, ch: l.ch, name: nameOf(l.ch), text: l.text })) })),
            character_ids: chars.map(castId).filter(Boolean),
            location_ids: [...new Set(refs.map(r => r.location_id).filter(Boolean))],
            prop_ids: [...new Set(refs.map(r => r.prop_id).filter(Boolean))],
            storyboard_asset_ids: codes.map(id => frameOf(starters[id])).filter(Boolean),
            ...(dialogueFile ? { dialogue_file: { path: dialogueFile.path, from_s: dialogueFile.from_s || 0 } } : {}),
        };
    };
    const optimize = async () => {
        if (!optText.trim() || optJobId) return;
        setBusy('optimize'); patchUi({ promptTab: 'optimized' });
        try {
            const out = await legacy.api(`/projects/${pid}/production-studio/seedance-prompt`, { method: 'POST', refresh: false, body: JSON.stringify({
                ...unitBody(optCodes, optText, optRefs, optDur), model_label: facts?.label, async: true,
            }) });
            setOptJob(out.job);
            setSt({ optimizing: { ...(studio.optimizing || {}), [optKey]: { id: out.job.id, from: promptSha } } }, { quiet: true });
        } catch (err) { legacy.setStatus('Optimize failed: ' + err.message); }
        finally { setBusy(''); }
    };
    const copyOptimized = async () => { try { await navigator.clipboard.writeText(optimized.prompt); setCopied('opt'); setTimeout(() => setCopied(false), 1500); } catch (err) { legacy.setStatus('Copy failed: ' + err.message); } };
    const copy = async () => { try { await navigator.clipboard.writeText(finalText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (err) { legacy.setStatus('Copy failed: ' + err.message); } };

    const credits = cardOf?.cost?.credits;
    const usdApi = cardOf?.cost?.usd ?? cardOf?.est_usd;
    const costText = Number.isFinite(credits) ? `${credits} credits` + (Number.isFinite(usdApi) ? ` (≈$${usdApi.toFixed(2)} API)` : '') : Number.isFinite(usdApi) ? `≈$${usdApi.toFixed(2)} API` : 'quote on review';

    return (
        <div className="ds">
            <aside className="ds-col ds-colL" aria-label="Storyboard">
                <div className="ds-head"><h3>Storyboard</h3><span>{picked.length ? `${picked.length} picked` : `${board.length} shots`}</span></div>
                {scenes.map(sc => (
                    <Fragment key={sc.id}>
                        {scenes.length > 1 && <div className="ds-scene">{sc.label}</div>}
                        {sc.shots.map(s => {
                            const on = picked.includes(s.id); const d = S[s.id];
                            const img = shotImg(s, 120);
                            return (
                                <button key={s.id} type="button" className={'ds-shot' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggleShot(s.id)}>
                                    <span className="ds-chk" aria-hidden="true">{on ? '✓' : ''}</span>
                                    {img ? <img className="ds-thumb" src={shotImg(s, 120)} alt="" /> : <span className="ds-thumb ph" aria-hidden="true" />}
                                    <span className="ds-sl"><b>{s.shot_code}</b><small className="ds-mono">{d ? `${(FRAMINGS.find(f => f[0] === d.cam.framing) || [, s.framing])[1]} · ${d.dur}s · ${d.lines.length} line${d.lines.length === 1 ? '' : 's'}` : `${secondsOf(s.duration_ms)}s`}</small></span>
                                </button>
                            );
                        })}
                    </Fragment>
                ))}
                {!grouped && picked.length > 1 && <>
                    <button type="button" className="ds-btn pri" onClick={group}>Group {picked.length} shots as a sequence</button>
                    <p className="ds-muted">Or click one picked shot in the timeline to direct it alone.</p>
                </>}
                {grouped && <>
                    <button type="button" className={'ds-seqcard' + (k === 'seq' ? ' on' : '')} onClick={go({ k: 'seq' })}>
                        <b>Sequence · {scope.map(label).join('–')}</b>
                        <span className="ds-mono">{scope.length} shots · {total}s · {studio.mode === 'one' ? 'one clip' : 'separate shots'}</span>
                        <span className="ds-muted">Order, lengths, transitions, how to generate</span>
                    </button>
                    <button type="button" className="ds-btn sm ghost" onClick={ungroup}>Ungroup</button>
                </>}
                {!picked.length && <p className="ds-muted">Tick shots to start. Two or more can become a sequence.</p>}
                <div style={{ flex: 1 }} />
                <p className="ds-muted">Shot IDs and scene-card sources stay as they are. Everything you direct here is stored on the shot, then compiled.</p>
            </aside>

            <main className="ds-work">
                <div className="ds-top">
                    <div>
                        <div className="ds-pv">
                            {pv.has ? <>
                                {pv.clip ? <PreviewClip video={pv.clip} at={pv.lt} playing={playing} /> : pv.img ? <img className="ds-pvimg" src={shotImg(byId.get(shotAt(t)), 1280)} style={{ transform: pv.tf }} alt="Storyboard frame for the shot at the playhead" /> : <div className="ds-pvempty"><span>No storyboard frame for this shot yet.</span></div>}
                                <div className="ds-pvtop"><span className="ds-tc">{fmt(t)}</span><span className="ds-pvtag">{pv.tag}</span><div style={{ flex: 1 }} /><span className="ds-pvtag">{pv.move}</span></div>
                                {pv.cue && <div className="ds-cue">{pv.cue}</div>}
                                {pv.sub && <div className="ds-sub">{pv.sub}</div>}
                            </> : <div className="ds-pvempty"><b>Nothing to play yet</b><span>Tick shots in the storyboard. They appear on the timeline below and play here.</span></div>}
                        </div>
                        <div className="ds-transport">
                            <button className="ds-ibtn" type="button" aria-label="Back to start" onClick={() => setT(0)}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 2v10M12 2 5 7l7 5z" /></svg></button>
                            <button className="ds-ibtn" type="button" aria-label="Previous beat" onClick={() => { const b = beatTimes().filter(x => x < t - 0.05); setT(b.length ? b[b.length - 1] : 0); }}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 2 4 7l5 5" /></svg></button>
                            <button className="ds-ibtn play" type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
                                {playing ? <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="3" height="10" /><rect x="8" y="2" width="3" height="10" /></svg>
                                    : <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M4 2l8 5-8 5z" /></svg>}
                            </button>
                            <button className="ds-ibtn" type="button" aria-label="Next beat" onClick={() => { const b = beatTimes().filter(x => x > t + 0.05); if (b.length) setT(b[0]); }}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 2 5 5-5 5" /></svg></button>
                            <span className="ds-mono" style={{ color: '#f4f4f5' }}>{fmt(t)} / {fmt(total)}</span>
                            <div style={{ flex: 1 }} />
                            <span className="ds-mono">Animatic: storyboard frames, simulated moves, line captions. Plays takes once they exist.</span>
                        </div>
                    </div>

                    <section className="ds-prompt" aria-label="Prompt">
                        <div className="ds-head"><h3>Prompt</h3><span className="ds-pill live">Live</span><span>{compiled ? (one ? `Sequence as one clip · ${total}s` : `Shot ${label(promptCodes[0])} · ${S[promptCodes[0]].dur}s`) : ''}</span><div style={{ flex: 1 }} /><span className="ds-mono">{finalText.length.toLocaleString()} chars</span></div>
                        {compiled && !one && scope.length > 1 && <div className="ds-chips">{scope.map(id => <button key={id} type="button" className={'ds-chip' + (id === promptCodes[0] ? ' on' : '')} onClick={() => patchUi({ promptShot: id })}>{label(id)}</button>)}</div>}
                        <div className="ds-seg" role="tablist" aria-label="Prompt version">
                            <button type="button" role="tab" aria-selected={ui.promptTab !== 'optimized'} className={ui.promptTab !== 'optimized' ? 'on' : ''} onClick={() => patchUi({ promptTab: 'work' })}>Working prompt</button>
                            <button type="button" role="tab" aria-selected={ui.promptTab === 'optimized'} className={ui.promptTab === 'optimized' ? 'on' : ''} onClick={() => patchUi({ promptTab: 'optimized' })}>Optimized for Seedance{optCodes.length > 1 ? ` · ${optCodes.map(label).join('+')}` : ''}{optimized ? '' : ' (none yet)'}</button>
                        </div>
                        {ui.promptTab === 'optimized' && compiled && <DialoguePick d={dialogueFile} onSet={setDialogue} />}
                        {ui.promptTab === 'optimized' && compiled && <OptimizedPrompt o={optimized} busy={busy === 'optimize' || !!optJobId} job={optJob} stale={!!optimized && optimized.from !== promptSha}
                            copied={copied === 'opt'} onCopy={copyOptimized} onRun={optimize} onEdit={text => setSt({ optimized: { ...(studio.optimized || {}), [optKey]: { ...optimized, prompt: text } } }, { quiet: true })} />}
                        {ui.promptTab !== 'optimized' && compiled && hand === null && (
                            <div className="ds-sheet" aria-live="polite">
                                {compiled.pre && <p className="ds-para s-lit">{compiled.pre}</p>}
                                {compiled.paras.map((p, i) => (
                                    <p key={i} className={'ds-para' + (p.cut ? ' cut' : '') + (p.hot ? ' hot' : '')}><span className="ds-tlab">{p.lab}</span>{p.segs.map((g, j) => <span key={j} className={g.cls ? 's-' + g.cls : ''}>{g.t} </span>)}</p>
                                ))}
                                <p className="ds-para">{compiled.post}</p>
                            </div>
                        )}
                        {ui.promptTab !== 'optimized' && compiled && hand !== null && <>
                            <label className="ds-lab" htmlFor="dsHand">Your text is what gets sent. What you add with the controls still goes into it.</label>
                            <textarea id="dsHand" className="ds-handta" value={hand} onChange={e => setHand(e.target.value, handEntry.base)} />
                            {pending > 0 && <div className="ds-check warn"><span className="ds-ck">!</span><span>{pending} control change{pending === 1 ? '' : 's'} touched words you rewrote, so {pending === 1 ? 'it was' : 'they were'} left out of your text. Rebuild from controls to see {pending === 1 ? 'it' : 'them'}.</span></div>}
                            {changes && changes.length > 0 && <ul className="ds-changes">{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
                        </>}
                        {!compiled && <div className="ds-sheet"><p className="ds-muted">The prompt appears here as soon as a shot is picked, one paragraph per beat, in time order.</p></div>}
                        {ui.promptTab !== 'optimized' && <div className="ds-row">
                            <div className="ds-seg" role="group" aria-label="Prompt notation" style={{ flex: 1 }}>
                                <button type="button" className={studio.bracket ? '' : 'on'} aria-pressed={!studio.bracket} onClick={() => setSt({ bracket: false })}>Plain prose</button>
                                <button type="button" className={studio.bracket ? 'on' : ''} aria-pressed={studio.bracket} onClick={() => setSt({ bracket: true })}>{'{speech} <sound> (score)'}</button>
                            </div>
                            {compiled && hand === null && <button type="button" className="ds-btn sm" onClick={() => { setHand(compiledText); setPending(0); setChanges(null); }}>Edit text</button>}
                            {compiled && hand !== null && <button type="button" className="ds-btn sm" onClick={() => { setHand(null); setPending(0); setChanges(null); }}>Rebuild from controls</button>}
                            <button type="button" className="ds-btn sm" disabled={!compiled || busy === 'optimize'} onClick={optimize} title="ChatGPT writes the final Seedance 2.5 prompt from this one, the sheets, storyboard frames and dialogue">{busy === 'optimize' ? 'Optimizing…' : 'Optimize with AI'}</button>
                            <button type="button" className="ds-btn sm" disabled={!compiled} onClick={copy}>{copied === true ? 'Copied' : 'Copy'}</button>
                        </div>}
                        <p className="ds-muted"><span className="s-cam">camera</span> · <span className="s-act">acting</span> · <span className="s-dlg">dialogue</span> · <span className="s-sfx">sound</span> · <span className="s-lit">continuity and light</span>. Brackets are a creator convention, not a model standard.</p>
                    </section>
                </div>

                <section className="ds-tl" aria-label="Timeline">
                    <div className="ds-head">
                        <h3>Timeline</h3><span>{ui.zoom === 'shot' && focus ? 'Shot ' + label(focus) : grouped ? 'Sequence' : 'Picked shots'}</span>
                        <div style={{ flex: 1 }} />
                        <div className="ds-seg" role="group" aria-label="Timeline zoom">
                            <button type="button" className={ui.zoom === 'seq' ? 'on' : ''} onClick={() => patchUi({ zoom: 'seq' })}>Whole sequence</button>
                            <button type="button" className={ui.zoom === 'shot' ? 'on' : ''} onClick={() => { if (focus) patchUi({ zoom: 'shot', sel: sel.shot ? sel : { k: 'shot', shot: focus } }); }}>Selected shot</button>
                        </div>
                        <button type="button" className="ds-btn sm" disabled={!focus} onClick={() => { const a = addAt(); if (a.id) patchUi({ sel: { k: 'shot', shot: a.id }, tab: 'camera', lib: 'add' }); }}>+ Camera move</button>
                        <button type="button" className="ds-btn sm" disabled={!focus} onClick={() => { const a = addAt(); if (!a.id) return; const id = nid('f'); edit(a.id, x => { x.sfx.push({ id, t: a.lt, text: '' }); }, a.lt); patchUi({ sel: { k: 'sfx', shot: a.id, id }, lib: null }); }}>+ Sound at playhead</button>
                        <button type="button" className="ds-btn sm" disabled={!focus} onClick={() => { const a = addAt(); if (a.id) edit(a.id, x => { x.cuts = [...(x.cuts || []).filter(c => c !== a.lt), a.lt]; }, a.lt); }}>+ Beat break</button>
                    </div>
                    {scope.length > 0 ? (
                        <div className="ds-lanes">
                            <div className="ds-lane"><span className="ds-ll ds-mono">{fmt(r0)}–{fmt(r1)}</span><div className="ds-track ruler" onClick={seek} title="Click to move the playhead" data-testid="ds-ruler">
                                {ticks.map(x => <Fragment key={x}><span className="ds-tick" style={{ left: X(x) }}>{fmt(x)}</span><span className="ds-tickl" style={{ left: X(x) }} /></Fragment>)}
                            </div></div>
                            <div className="ds-lane"><span className="ds-ll">Shots</span><div className="ds-track tall">
                                {scope.map((id, i) => { const a = offsets[id], b = a + S[id].dur; const img = shotImg(byId.get(id), 320);
                                    return <Fragment key={id}>
                                        {vis(a, b) && <button type="button" className={'ds-clip' + (focus === id && sel.shot === id ? ' on' : '')} style={{ left: X(Math.max(a, r0)), width: W(a, b), backgroundImage: img ? `url(${img})` : undefined }} onClick={go({ k: 'shot', shot: id })}>{label(id)} · {S[id].dur}s</button>}
                                        {grouped && i > 0 && a >= r0 && a <= r1 && <button type="button" className={'ds-trn' + (k === 'trans' && sel.after === scope[i - 1] ? ' on' : '')} style={{ left: X(a) }} aria-label={`Transition ${label(scope[i - 1])} to ${label(id)}`} onClick={go({ k: 'trans', after: scope[i - 1] })}>{TRANS_SHORT[S[scope[i - 1]].transOut || 'continuous']}</button>}
                                    </Fragment>; })}
                            </div></div>
                            <div className="ds-lane"><span className="ds-ll">Beats</span><div className="ds-track" style={{ height: 18 }}>
                                {scope.flatMap(id => beatStarts(S[id]).map((b, j) => offsets[id] + b >= r0 && offsets[id] + b < r1 ? <span key={id + j} className="ds-bt" style={{ left: X(offsets[id] + b) }}>{j === 0 ? label(id) : ''}</span> : null))}
                            </div></div>
                            <div className="ds-lane"><button type="button" className="ds-ll" onClick={() => focus && patchUi({ sel: { k: 'shot', shot: focus }, tab: 'camera', lib: null })}><span className="ds-sw" style={{ background: '#6690ff' }} />Camera</button><div className="ds-track">
                                {scope.flatMap(id => S[id].moves.filter(m => vis(offsets[id] + m.start, offsets[id] + m.end)).map(m => { const nm = m.type === 'rack' ? `Rack: ${m.from} → ${m.to}` : MV[m.type]?.name || m.type;
                                    return <button key={m.id} type="button" className={'ds-blk cam' + (k === 'move' && sel.id === m.id ? ' on' : '')} style={{ left: X(Math.max(offsets[id] + m.start, r0)), width: W(offsets[id] + m.start, offsets[id] + m.end) }} title={nm} onClick={go({ k: 'move', shot: id, id: m.id })}>{nm}</button>; }))}
                            </div></div>
                            {laneCast.map(ch => (
                                <div className="ds-lane" key={ch}><button type="button" className="ds-ll" onClick={() => { const shot = focus || scope[0]; go({ k: 'char', shot, ch })(); }}><span className="ds-sw" style={{ background: colorOf(ch) }} />{nameOf(ch)}</button><div className="ds-track tall">
                                    {scope.flatMap(id => (S[id].perf?.[ch]?.beats || []).filter(b => offsets[id] + b.t >= r0 && offsets[id] + b.t < r1).map(b => (
                                        <button key={b.id} type="button" className={'ds-dia' + (b.on ? '' : ' off') + (k === 'char' && sel.shot === id && sel.ch === ch ? ' on' : '')} style={{ left: X(offsets[id] + b.t), background: colorOf(ch) }} aria-label={b.text} title={b.text} onClick={go({ k: 'char', shot: id, ch })} />)))}
                                    {scope.flatMap(id => S[id].lines.filter(l => l.ch === ch && vis(offsets[id] + l.t, offsets[id] + l.t + lineLen(l))).map(l => (
                                        <button key={l.id} type="button" className={'ds-blk dlg' + (k === 'line' && sel.id === l.id ? ' on' : '')} style={{ left: X(Math.max(offsets[id] + l.t, r0)), width: W(offsets[id] + l.t, offsets[id] + l.t + lineLen(l)), background: colorOf(ch) }} title={l.text} onClick={go({ k: 'line', shot: id, id: l.id })}>{l.text}</button>)))}
                                </div></div>
                            ))}
                            <div className="ds-lane"><button type="button" className="ds-ll" onClick={() => focus && patchUi({ sel: { k: 'shot', shot: focus }, tab: 'sound', lib: null })}><span className="ds-sw" style={{ background: '#57c98a' }} />Effects</button><div className="ds-track">
                                {/* Each label stops short of the next marker (full text on hover): sounds a moment apart drew their names over each other. */}
                                {(() => {
                                    const mk = scope.flatMap(id => S[id].sfx.filter(f => offsets[id] + f.t >= r0 && offsets[id] + f.t < r1).map(f => ({ id, f, at: offsets[id] + f.t })))
                                        .sort((a, b) => a.at - b.at);
                                    return mk.map(({ id, f, at }, i) => {
                                        const next = mk.slice(i + 1).find(m => m.at > at);
                                        const room = next ? { maxWidth: `min(150px, calc(${X(next.at)} - ${X(at)} - 3px))` } : null;
                                        return <button key={f.id} type="button" className={'ds-mk' + (k === 'sfx' && sel.id === f.id ? ' on' : '')} style={{ left: X(at), ...room }} title={f.text} onClick={go({ k: 'sfx', shot: id, id: f.id })}>{f.text || 'describe the sound'}</button>;
                                    });
                                })()}
                            </div></div>
                            <div className="ds-lane"><button type="button" className="ds-ll" onClick={() => patchUi({ sel: { k: 'amb' }, lib: null })}><span className="ds-sw" style={{ background: '#4fb6c9' }} />Ambience</button><div className="ds-track">
                                <button type="button" className={'ds-blk amb' + (k === 'amb' ? ' on' : '') + (amb.on ? '' : ' offbed')} style={{ left: 0, width: '100%' }} onClick={() => patchUi({ sel: { k: 'amb' }, lib: null })}>{amb.on ? 'Ambience: ' + (amb.text || 'describe the room') : 'Ambience off'}</button>
                            </div></div>
                            <div className="ds-lane"><button type="button" className="ds-ll" onClick={() => patchUi({ sel: { k: 'music' }, lib: null })}><span className="ds-sw" style={{ background: '#5a5a64' }} />Music</button><div className="ds-track">
                                <button type="button" className={'ds-blk mus' + (k === 'music' ? ' on' : '')} style={{ left: 0, width: '100%' }} onClick={() => patchUi({ sel: { k: 'music' }, lib: null })}>{studio.music.on ? 'Music: ' + studio.music.text : 'Music off (default). Click to add.'}</button>
                            </div></div>
                            <div className="ds-ph" style={{ left: `calc(96px + (100% - 96px) * ${clamp((t - r0) / span, 0, 1).toFixed(4)})` }} />
                        </div>
                    ) : <p className="ds-muted">Empty. Picked shots line up here with their dialogue, acting beats, camera moves and sound.</p>}
                </section>
            </main>

            <aside className="ds-col ds-colR" aria-label="Direct">
                <div className="ds-head"><h3>Direct</h3><span>{title}</span></div>
                {crumb && <nav className="ds-crumb" aria-label="Where you are">{crumb.map((c, i) => <Fragment key={i}><button type="button" onClick={c.go}>{c.lab}</button><span aria-hidden="true">›</span></Fragment>)}<span style={{ color: '#f4f4f5' }}>{here}</span></nav>}

                {k === 'none' && <div className="ds-panel"><b>How directing works here</b><p className="ds-muted">1 · Tick shots. Group two or more into a sequence.<br />2 · Click the sequence: order, lengths, transitions, one clip or separate.<br />3 · Click a shot: Acting, Camera, Dialogue, Sound, Light.<br />4 · Click anything on the timeline to edit that one thing.<br />5 · Press Play. The prompt rebuilds on every change.</p></div>}
                {k === 'picked' && <div className="ds-panel"><b>{picked.length} shots picked</b><p className="ds-muted">They already play in order. Group them to set transitions and generate them as one clip or as separate shots. Or click one on the timeline to direct it.</p><button type="button" className="ds-btn pri" onClick={group}>Group as a sequence</button></div>}

                {k === 'seq' && <>
                    <div className="ds-panel">
                        <h4>Order and length</h4>
                        {scope.map((id, i) => {
                            const mvTo = (d) => () => { const ord = [...scope]; const j = i + d; if (j < 0 || j >= ord.length) return; [ord[i], ord[j]] = [ord[j], ord[i]]; setSt({ order: ord }); };
                            return <div key={id} className="ds-row ds-seqrow">
                                <button type="button" className="ds-btn xs ghost" onClick={go({ k: 'shot', shot: id })}><b>{label(id)}</b> <span className="ds-mono">{(FRAMINGS.find(f => f[0] === S[id].cam.framing) || [, ''])[1]}</span></button>
                                <span className="ds-row" style={{ gap: 2 }}><button type="button" className="ds-btn xs" onClick={mvTo(-1)} aria-label={`Move ${label(id)} earlier`}>↑</button><button type="button" className="ds-btn xs" onClick={mvTo(1)} aria-label={`Move ${label(id)} later`}>↓</button></span>
                                <Step lab={`${S[id].dur}s`} minus={() => edit(id, s => fitLength(s, Math.max(2, s.dur - 1)))} plus={() => edit(id, s => fitLength(s, s.dur + 1))} less="Shorter" more="Longer" />
                            </div>;
                        })}
                        <p className="ds-muted">Scene-card length stays on the card; this is the length you generate.</p>
                    </div>
                    <div className="ds-panel">
                        <h4>Between shots</h4>
                        {scope.slice(1).map((id, i) => { const prev = scope[i]; const kd = S[prev].transOut || 'continuous';
                            return <div key={id} className="ds-row" style={{ justifyContent: 'space-between' }}><span className="ds-mono">{label(prev)} → {label(id)}</span><button type="button" className="ds-btn xs" onClick={go({ k: 'trans', after: prev })}>{TRANS.find(x => x[0] === kd)[1]}</button></div>; })}
                    </div>
                    <div className="ds-panel">
                        <h4>Generate as</h4>
                        <div className="ds-grid2">
                            <button type="button" className={'ds-opt' + (studio.mode === 'one' ? ' on' : '')} aria-pressed={studio.mode === 'one'} onClick={() => setSt({ mode: 'one' })}>One clip<small>Real continuity and one sound bed. All or nothing: one bad beat means a retake of everything. Must fit the model's length.</small></button>
                            <button type="button" className={'ds-opt' + (studio.mode === 'sep' ? ' on' : '')} aria-pressed={studio.mode === 'sep'} onClick={() => setSt({ mode: 'sep' })}>Separate shots<small>Each shot fixable alone; last frame feeds the next. Seams can show; sound is made per shot.</small></button>
                        </div>
                        <h4>Model</h4>
                        {modelChips.length ? <div className="ds-chips">{modelChips}</div> : <p className="ds-muted">No Higgsfield model makes {one ? total : unitDur}s in one request. Generate as separate shots, or shorten the shots.</p>}
                        <p className="ds-muted">{modelAudio}</p>
                    </div>
                </>}

                {k === 'trans' && (() => { const nx = scope[scope.indexOf(sel.after) + 1]; return (
                    <div className="ds-panel">
                        <b>From {label(sel.after)} into {label(nx)}</b>
                        <div className="ds-grid2">{TRANS.map(x => <button key={x[0]} type="button" className={'ds-opt' + ((S[sel.after].transOut || 'continuous') === x[0] ? ' on' : '')} onClick={() => edit(sel.after, s => { s.transOut = x[0]; }, S[sel.after].dur - 0.1)}>{x[1]}<small>{x[2]}</small></button>)}</div>
                        <p className="ds-muted">In one clip this becomes a sentence in the prompt. As separate shots, Continuous also passes the last frame of the first shot in as the first frame of the next.</p>
                    </div>); })()}

                {k === 'shot' && shotCode && <ShotPanel {...{ s: S[shotCode], node: byId.get(shotCode), card: cards[shotCode]?.card || {}, id: shotCode, label, ui, patchUi, edit, go, offsets, lt0, nameOf, colorOf, castList, castKey,
                    grouped, scope, S, setS, dirty, queueSave, touch, amb, music: studio.music, setting: settingOf(sceneOf(shotCode)), pv: cards[shotCode]?.previs || null, setSetting: (v) => setSt({ settings: { ...studio.settings, [sceneOf(shotCode)]: v } }) }} />}

                {k === 'char' && shotCode && <CharPanel {...{ s: S[shotCode], id: shotCode, ch: sel.ch, ui, patchUi, edit, offsets, lt0, nameOf }} />}

                {(k === 'move' || ((k === 'shot') && ui.lib)) && shotCode && <MovePanel {...{ s: S[shotCode], id: shotCode, sel, k, ui, patchUi, edit, offsets, lt0, label }} />}

                {k === 'line' && shotCode && <LinePanel {...{ s: S[shotCode], id: shotCode, sel, ui, patchUi, edit, offsets, nameOf, colorOf, card: cards[shotCode]?.card || {}, pid, reloadCards: load, castList, castKey }} />}

                {k === 'sfx' && shotCode && (() => { const s = S[shotCode]; const f = s.sfx.find(x => x.id === sel.id); if (!f) return null;
                    const setF = (fn) => edit(shotCode, x => { x.sfx.forEach(y => { if (y.id === f.id) fn(y); }); }, f.t);
                    const ft = [{ lab: 'At the playhead', t: half(lt0) }, ...s.lines.map(l => ({ lab: `On “${cut(l.text, 16)}”`, t: l.t }))];
                    for (const p of Object.values(s.perf || {})) for (const b of p.beats || []) if (b.part === 'body' || b.part === 'action') ft.push({ lab: 'When ' + cut(b.text, 26), t: b.t });
                    return <div className="ds-panel">
                        <div className="ds-row"><b>Effect</b><span className="ds-mono">{fmt(offsets[shotCode] + f.t)}</span><div style={{ flex: 1 }} /><button type="button" className="ds-btn xs" onClick={() => { edit(shotCode, x => { x.sfx = x.sfx.filter(y => y.id !== f.id); }, f.t); patchUi({ sel: { k: 'shot', shot: shotCode }, tab: 'sound' }); }}>Remove</button></div>
                        <label className="ds-lab" htmlFor="dsFx">What we hear</label>
                        <input id="dsFx" className="ds-in" placeholder="describe the sound" value={f.text} onChange={e => { const v = e.target.value; setF(y => { y.text = v; }); }} />
                        <span className="ds-lab">Happens</span>
                        <div className="ds-chips">{ft.map((x, i) => <button key={i} type="button" className={'ds-chip' + (Math.abs(f.t - x.t) < 0.05 ? ' on' : '')} onClick={() => setF(y => { y.t = x.t; })}>{x.lab}</button>)}</div>
                        <div className="ds-row"><span className="ds-lab" style={{ margin: 0 }}>Time</span><Step lab={fmt(offsets[shotCode] + f.t)} minus={() => setF(y => { y.t = Math.max(0, y.t - 0.5); })} plus={() => setF(y => { y.t = Math.min(s.dur - 0.2, y.t + 0.5); })} /></div>
                    </div>; })()}

                {k === 'amb' && <div className="ds-panel">
                    <div className="ds-row"><b>Ambience</b><span className="ds-pill inh">{grouped ? 'Whole sequence' : 'Every picked shot'}</span><div style={{ flex: 1 }} /><button type="button" className="ds-btn xs" onClick={() => setSt({ amb: { ...amb, on: !amb.on } })}>{amb.on ? 'Turn off' : 'Turn on'}</button></div>
                    <label className="ds-lab" htmlFor="dsAmb">Room and world sound</label>
                    <input id="dsAmb" className="ds-in" placeholder="room tone, distant traffic…" value={amb.text} onChange={e => setSt({ amb: { on: amb.on, text: e.target.value } })} />
                    <p className="ds-muted">Written once in the prompt as a continuous bed, not per beat.</p>
                </div>}
                {k === 'music' && <div className="ds-panel">
                    <div className="ds-row"><b>Music</b><span className={'ds-pill ' + (studio.music.on ? 'ovr' : 'inh')}>{studio.music.on ? 'On for this generation' : 'Off (default)'}</span><div style={{ flex: 1 }} /><button type="button" className="ds-btn xs" onClick={() => setSt({ music: { on: !studio.music.on, text: studio.music.text || 'a single low cello note, very quiet' } })}>{studio.music.on ? 'Turn off' : 'Add music'}</button></div>
                    {studio.music.on && <><label className="ds-lab" htmlFor="dsMus">Score, in words</label><input id="dsMus" className="ds-in" value={studio.music.text} onChange={e => setSt({ music: { on: true, text: e.target.value } })} /></>}
                    <p className="ds-muted">Off by default: scored music in a generated clip can't be removed later. Imported music is laid in Cut.</p>
                </div>}

                <div className="ds-gen">
                    {compiled && <div className="ds-seg cf-where" role="group" aria-label="Where to make it">
                        <button type="button" className={onPc ? '' : 'on'} aria-pressed={!onPc} onClick={() => setSt({ genOn: 'hf' }, { quiet: true })}>Higgsfield</button>
                        <button type="button" className={onPc ? 'on' : ''} aria-pressed={onPc} onClick={() => setSt({ genOn: 'pc' }, { quiet: true })}>My PC</button>
                    </div>}
                    {compiled && onPc && <ComfyPanel pid={pid} codeLabel={promptCodes.map(label).join('+')} dur={unitDur}
                        unit={() => unitBody(promptCodes, finalText, references, unitDur)}
                        names={[...new Set([...promptCodes.flatMap(id => S[id].lines.map(l => nameOf(l.ch))), ...references.filter(r => r.location_id).map(r => r.name)].filter(Boolean))]}
                        hasFrame={promptCodes.some(id => frameOf(starters[id]))} lineCount={promptCodes.reduce((a, id) => a + S[id].lines.length, 0)}
                        dialogueName={dialogueFile ? dialogueFile.path.split('/').pop() : ''} onFiled={reload} onUseHiggsfield={() => setSt({ genOn: 'hf' }, { quiet: true })}
                        shotId={promptCodes.length === 1 ? promptCodes[0] : null} />}
                    {compiled && !onPc && <>
                        <div className="ds-row"><h3>Generate</h3><span className="ds-mono">{facts ? facts.label : 'Pick a model'}{studio.resolution ? ' · ' + studio.resolution : ''} · {studio.aspect}</span></div>
                        {k !== 'seq' && cards4.length > 0 && <div className="ds-chips">{modelChips}</div>}
                        {ck.map((c, i) => (
                            <div key={i} className={'ds-check ' + c.k}><span className="ds-ck">{{ err: '✕', warn: '!', ok: '✓', info: 'i' }[c.k]}</span><span style={{ flex: 1 }}>{c.text}
                                {c.fixes.length > 0 && <span className="ds-row" style={{ marginTop: 5 }}>{c.fixes.map((f, j) => <button key={j} type="button" className="ds-btn xs" onClick={() => doFix(f.act)}>{f.lab}</button>)}</span>}</span></div>
                        ))}
                        {facts?.external
                            ? <a className="ds-btn pri big" href={`${facts.url}&prompt=${encodeURIComponent(finalText)}&duration=${unitDur}&aspect_ratio=${encodeURIComponent(studio.aspect)}`} target="_blank" rel="noreferrer">Open {facts.label} on Higgsfield</a>
                            : <button type="button" className={'ds-btn pri big' + (hasErr || !studio.model ? ' off' : '')} disabled={hasErr || !studio.model || busy === 'send'} onClick={send}>
                                {busy === 'send' ? 'Preparing…' : hasErr ? 'Fix the red item to generate' : `${one ? 'Generate the sequence' : 'Generate ' + label(promptCodes[0])} · ${costText}`}
                            </button>}
                        <p className="ds-muted">{one ? 'One request.' : grouped ? `One of ${scope.length} separate requests.` : ''} Credits shown before anything is sent. Nothing is sent yet: the final review hands you the exact prompt and assets to generate in Higgsfield's own app.</p>
                        <details className="ds-more">
                            <summary>Shape, references and every model</summary>
                            <div className="ds-row">
                                <label className="ps-inline">Shape <select value={studio.aspect} onChange={e => setSt({ aspect: e.target.value }, { quiet: true })}>{ASPECTS.map(a => <option key={a}>{a}</option>)}</select></label>
                                <label className="ps-inline">Resolution <select value={studio.resolution} onChange={e => setSt({ resolution: e.target.value }, { quiet: true })}>{RESOLUTIONS.map(r => <option key={r} value={r}>{r || 'Any'}</option>)}</select></label>
                                <label className="ps-inline"><input type="checkbox" checked={!!studio.audio} disabled={facts && !sendAudio} onChange={e => setSt({ audio: e.target.checked }, { quiet: true })} /> Generate sound</label>
                            </div>
                            <label className="ds-lab" htmlFor="psModel">Send to Higgsfield model</label>
                            <select id="psModel" className="ds-in" value={studio.model} onChange={e => setSt({ model: e.target.value })}>
                                {!studio.model && <option value="">Pick shots first</option>}
                                {[...catalog.models].sort((a, b) => (cards4.findIndex(c => c.id === a.id) + 1 || 1e9) - (cards4.findIndex(c => c.id === b.id) + 1 || 1e9) || a.label.localeCompare(b.label)).map(m => {
                                    const c = cards4.find(x => x.id === m.id); const bl = (result?.blocked || []).find(b => b.id === m.id);
                                    return <option key={m.id} value={m.id}>{m.label}{c ? ` · ${c.share ?? c.fit}% share` : bl ? ' · unavailable' : ''}</option>; })}
                            </select>
                            {cards4.length > 0 && <button type="button" className="ds-btn sm" disabled={busy === 'judge'} onClick={() => recommend(true)}>{busy === 'judge' ? 'Asking…' : result?.judged ? 'Ask AI again' : 'Ask AI to judge'}</button>}
                            {cardOf && <p className="ds-muted">{cardOf.reasons.slice(0, 3).join(' · ')}</p>}
                            <h4>References · {(start ? 1 : 0) + references.length}{maxRefs !== null ? ` · ${facts.label} takes ${maxRefs === 1 ? 'one' : `up to ${maxRefs}`}` : ''}</h4>
                            <div className="ds-refs">
                                {start && <Ref r={start} role="Start frame" sent />}
                                {references.map((r, i) => <Ref key={r.asset_id || r.sha256 || i} r={r} role={r.reference_role || r.role || 'reference'} sent={maxRefs === null || i + (start ? 1 : 0) < maxRefs} tag={`@image${i + 1}`} />)}
                            </div>
                            {(() => { const n = recipes.reduce((a, r) => a + (r.unmatched || 0), 0); return n > 0 && <p className="ps-warn">{n} picture{n === 1 ? '' : 's'} the pipeline would attach could not be matched to a project file, so {n === 1 ? 'it is' : 'they are'} left out.</p>; })()}
                            {recipes.some(r => r.error) && <p className="ps-warn">Some shots could not compose a request: {recipes.filter(r => r.error).map(r => r.error).join('; ')}</p>}
                            {(result?.blocked || []).length > 0 && <details className="ps-blocked"><summary>Unavailable for this request ({result.blocked.length})</summary>{result.blocked.map(b => <div key={b.id}><b>{b.label}</b> · {b.why}</div>)}</details>}
                            <HiggsfieldCatalog models={catalog.website_models} modes={catalog.api_modes} />
                        </details>
                    </>}
                </div>
            </aside>
        </div>
    );
}

/**
 * The dialogue for Optimize: the recorded lines of the shots are found by themselves; a recording on disk (the scene's
 * whole take) can be chosen instead, with the second this clip starts at in it. It becomes @Video 1 on a black screen.
 */
function DialoguePick({ d, onSet }) {
    const input = useRef(null);
    const pick = e => {
        const f = e.target.files?.[0]; e.target.value = '';
        const p = f && window.__feFiles?.pathFor?.(f);
        if (p) onSet({ path: p, name: f.name, from_s: 0 });
    };
    return <div className="ds-row ds-dialogue">
        <span className="ds-lab" style={{ margin: 0 }}>Dialogue audio</span>
        {d ? <>
            <b title={d.path}>{d.name}</b>
            <label className="ds-muted">this clip starts at <input type="number" min="0" step="0.1" aria-label="Where this clip starts in the recording (seconds)" className="ds-in ds-num" value={d.from_s || 0}
                onChange={e => onSet({ ...d, from_s: Math.max(0, Number(e.target.value) || 0) })} /> s</label>
            <button type="button" className="ds-btn xs" onClick={() => onSet(null)}>Use the recorded lines instead</button>
        </> : <span className="ds-muted">The shots' recorded lines, where found.</span>}
        {window.__feFiles?.pathFor && <button type="button" className="ds-btn xs" onClick={() => input.current?.click()}>{d ? 'Change…' : 'Choose a recording…'}</button>}
        <input ref={input} type="file" accept="audio/*,video/*" hidden onChange={pick} />
    </div>;
}

/** The final Seedance prompt and the files it names, in the order to upload them. */
function OptimizedPrompt({ o, busy, job, stale, copied, onCopy, onRun, onEdit }) {
    if (busy) {
        /*
         * ChatGPT reports nothing while it writes, so the bar is the real stage plus an estimate of the writing (it took
         * about 70 s on a two-person shot), held below the end until the answer is in: never a finish that isn't one.
         */
        const st = job?.stage, el = job?.elapsed_s || 0, se = job?.stage_elapsed_s || 0;
        const pct = st === 'saving' ? 97 : st === 'writing' ? Math.min(95, 12 + Math.round(83 * (1 - Math.exp(-se / 60)))) : Math.min(10, 2 + se * 2);
        const mmss = n => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
        return <div className="ds-sheet ds-optbusy" role="status" aria-live="polite">
            <b>{job?.stage_label || 'Starting'}…</b>
            <div className="ds-optbar" role="progressbar" aria-label="Optimize progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
            <span className="ds-muted">{mmss(el)} elapsed · usually one to two minutes · you can leave this tab; the prompt lands here when ChatGPT is done</span>
        </div>;
    }
    if (!o) return <div className="ds-sheet"><p className="ds-muted">Direct the shot and edit the working prompt first. Then Optimize with AI: ChatGPT writes the final Seedance 2.5 prompt from it, the sheets, storyboard frames and dialogue, using the Seedance guide stored in the app. Your working prompt stays as it is.</p>
        <button type="button" className="ds-btn sm" onClick={onRun}>Optimize with AI</button></div>;
    return <div className="ds-opt-prompt">
        {stale && <div className="ds-check warn"><span className="ds-ck">!</span><span>The working prompt changed since this was written. Optimize again to bring the changes in.</span></div>}
        <label className="ds-lab" htmlFor="dsOpt">Paste this into Seedance 2.5 on Higgsfield (draft first), with the files below.</label>
        <textarea id="dsOpt" className="ds-handta" value={o.prompt} onChange={e => onEdit(e.target.value)} />
        <h4>Upload these, in this order</h4>
        <ol className="ds-optrefs" aria-label="Reference files">{(o.refs || []).map(r => <li key={r.order}>
            <b>{r.label}</b> {r.name} · {r.role}{r.source ? ` (${r.source})` : ''}{r.in_prompt ? '' : ' · not named in the prompt'}<small>{r.use}</small><code title={r.file}>{r.file_name}</code></li>)}</ol>
        {!(o.refs || []).length && <p className="ds-muted">No reference files: add character, location or prop pictures for a closer match.</p>}
        {(o.notes || []).length > 0 && <ul className="ds-changes">{o.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <div className="ds-row">
            <button type="button" className="ds-btn sm" onClick={onCopy}>{copied ? 'Copied' : 'Copy prompt'}</button>
            {window.__feFiles?.reveal && <button type="button" className="ds-btn sm" onClick={() => window.__feFiles.reveal((o.refs || [])[0]?.file || o.folder)}>Show files in Finder</button>}
            <button type="button" className="ds-btn sm" onClick={onRun}>Optimize again</button>
            <span className="ds-muted">{o.model ? `ChatGPT (${o.model})` : 'ChatGPT'} · {new Date(o.created_at).toLocaleString()}</span>
        </div>
    </div>;
}

/** A shot's new length, with everything timed in it kept inside: lines, moves, sounds and acting beats. */
function fitLength(x, to) {
    x.dur = to;
    x.lines.forEach(l => { l.t = Math.min(l.t, Math.max(0, to - 0.8)); });
    x.moves.forEach(m => { m.end = Math.min(m.end, to); m.start = Math.min(m.start, Math.max(0, to - 0.5)); });
    (x.sfx || []).forEach(f => { f.t = Math.min(f.t, Math.max(0, to - 0.2)); });
    for (const p of Object.values(x.perf || {})) (p.beats || []).forEach(b => { b.t = Math.min(b.t, Math.max(0, to - 0.2)); });
}

function Step({ lab, minus, plus, less = 'Earlier', more = 'Later' }) {
    return <span className="ds-step"><button type="button" className="ds-btn xs" onClick={minus} aria-label={less}>−</button><b>{lab}</b><button type="button" className="ds-btn xs" onClick={plus} aria-label={more}>+</button></span>;
}

function Ref({ r, role, sent, tag }) {
    return (
        <div className={'ps-ref' + (sent ? '' : ' unsent')}>
            {r.uri && /^data:image|^https?:/.test(r.uri) ? <img src={r.uri} alt="" /> : <div className="ps-ref-ph" aria-hidden="true" />}
            <div className="ps-ref-line"><b>{r.name || role}</b><span>{sent ? 'Sent' : 'Not sent'}</span></div>
            <small>{role}{tag && sent ? ` · ${tag}` : ''}</small>
        </div>
    );
}

/** A take, once one exists: held at the playhead, played with the transport. */
function PreviewClip({ video, at, playing }) {
    const ref = useRef(null);
    useEffect(() => { const v = ref.current; if (!v) return; if (playing) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else { v.pause(); } }, [playing, video]);
    useEffect(() => { const v = ref.current; if (v && (!playing || Math.abs(v.currentTime - at) > 0.6)) { try { v.currentTime = at; } catch (_) {} } }, [at, playing, video]);
    // Not muted: a take that was made with sound plays it (the sound you add here is direction for the prompt, not audio).
    return <video ref={ref} className="ds-pvimg" src={video} preload="metadata" />;
}

function ShotPanel({ s, node, card, id, label, ui, patchUi, edit, go, offsets, lt0, nameOf, colorOf, castList, castKey, grouped, scope, S, setS, dirty, queueSave, touch, amb, music, setting, setSetting, pv }) {
    const img = shotImg(node, 160);
    const castHere = [...new Set([...(card.characters || []).map(castKey), ...s.lines.map(l => l.ch), ...Object.keys(s.perf || {})])].filter(Boolean);
    const cam = s.cam;
    const ovr = ['framing', 'angle', 'facing', 'lens'].filter(x => cam[x] !== s.inh?.[x]);
    const fr = FRAMINGS.find(f => f[0] === cam.framing);
    const camSet = (key, v) => () => edit(id, x => { x.cam[key] = v; }, 0);
    const others = scope.filter(x => x !== id && S[x].tech !== s.tech);
    return <>
        <div className="ds-panel" style={{ gap: 8 }}>
            <div className="ds-row">{img ? <img className="ds-thumb" src={shotImg(node, 160)} alt="" style={{ width: 76, height: 43 }} /> : <span className="ds-thumb ph" style={{ width: 76, height: 43 }} />}<span className="ds-sl"><b>{label(id)} · {fr ? fr[1] : cam.framing}</b><span className="ds-mono">{s.dur}s · {s.lines.length} line{s.lines.length === 1 ? '' : 's'}</span></span></div>
            <p className="ds-muted">{card.description}</p>
            {/* The shot's length, here as well as in a sequence: shortening keeps its lines and moves inside it. */}
            <div className="ds-row"><span className="ds-muted">Length</span>
                <Step lab={`${s.dur}s`} less="Shorter" more="Longer" minus={() => edit(id, x => fitLength(x, Math.max(2, x.dur - 1)))} plus={() => edit(id, x => fitLength(x, x.dur + 1))} /></div>
        </div>
        <div className="ds-seg" role="tablist" aria-label="Shot direction">{SHOT_TABS.map(([tid, lab]) => <button key={tid} type="button" role="tab" aria-selected={ui.tab === tid} className={ui.tab === tid ? 'on' : ''} onClick={() => patchUi({ tab: tid, lib: null })}>{lab}</button>)}</div>

        {ui.tab === 'acting' && <div className="ds-panel">
            <h4>Who is in the shot</h4>
            {castHere.map(ch => { const p = s.perf?.[ch]; return (
                <button key={ch} type="button" className="ds-opt" onClick={go({ k: 'char', shot: id, ch })}>
                    <span className="ds-row"><span className="ds-sw" style={{ background: colorOf(ch) }} /><b>{nameOf(ch)}</b><span className="ds-mono">{p?.emo ? `${p.emo} · ${INTS[p.inten - 1]}` : 'not directed yet'}</span></span>
                    <small>{p ? `${(p.beats || []).filter(b => b.on).length} acting beats · ${s.lines.filter(l => l.ch === ch).length} lines` : 'The model will improvise. Add an emotion to direct.'}</small>
                </button>); })}
            {!castHere.length && <p className="ds-muted">No one is named on this shot's card.</p>}
            <p className="ds-muted">Pick a character to choose an emotion, its intensity, what sets it off, and the acting beats.</p>
        </div>}

        {ui.tab === 'camera' && <>
            <PrevizPanel s={s} pv={pv} onUpdate={() => edit(id, x => { const n = takePrevis(x, pv); x.cam = n.cam; x.inh = n.inh; x.pvz = { ...n.pvz, won: { by: 'previz', at: pv.applied_at || null } }; }, 0)}
                onToggle={(on) => edit(id, x => { if (x.pvz) x.pvz.on = on; }, 0)} />
            <div className="ds-panel">
                <div className="ds-row"><h4>Framing</h4><span className={'ds-pill ' + (ovr.length ? 'ovr' : 'inh')}>{ovr.length ? 'Changed here: ' + ovr.join(', ') : s.pvz ? 'From Previz' : 'From the scene card'}</span><div style={{ flex: 1 }} /><button type="button" className="ds-link" onClick={() => legacy.navigateTo && legacy.navigateTo('previs')}>Frame it in Previz 3D ↗</button></div>
                <span className="ds-mono" style={{ color: '#e4e4e7' }}>{(fr ? fr[1] : cam.framing).toUpperCase()} · {cam.facing.toUpperCase()} · {cam.angle.toUpperCase()} HEIGHT · {cam.lens}MM</span>
                <span className="ds-lab">Size</span>
                <div className="ds-chips">{FRAMINGS.map(f => <button key={f[0]} type="button" title={f[1]} className={'ds-chip' + (cam.framing === f[0] ? ' on' : '')} onClick={camSet('framing', f[0])}>{f[0]}</button>)}</div>
                <span className="ds-lab">Camera height</span>
                <div className="ds-chips">{ANGLES.map(a => <button key={a} type="button" className={'ds-chip' + (cam.angle === a ? ' on' : '')} onClick={camSet('angle', a)}>{a}</button>)}</div>
                <span className="ds-lab">Subject facing</span>
                <div className="ds-chips">{FACINGS.map(a => <button key={a} type="button" className={'ds-chip' + (cam.facing === a ? ' on' : '')} onClick={camSet('facing', a)}>{a}</button>)}</div>
                <div className="ds-row"><span className="ds-lab" style={{ margin: 0 }}>Lens</span><Step lab={`${cam.lens}mm`} less="Wider lens" more="Longer lens" minus={() => edit(id, x => { x.cam.lens = [...LENSES].reverse().find(l => l < x.cam.lens) ?? LENSES[0]; }, 0)} plus={() => edit(id, x => { x.cam.lens = LENSES.find(l => l > x.cam.lens) ?? LENSES[LENSES.length - 1]; }, 0)} />
                    <input className="ds-in" style={{ width: 130 }} aria-label="Lens note" placeholder="anamorphic" value={cam.lensNote || ''} onChange={e => { const v = e.target.value; edit(id, x => { x.cam.lensNote = v; }, 0); }} /></div>
            </div>
            <div className="ds-panel">
                <h4>Start and end composition</h4>
                <label className="ds-lab" htmlFor="dsStart">First frame</label><input id="dsStart" className="ds-in" value={s.start} onChange={e => { const v = e.target.value; edit(id, x => { x.start = v; }, 0); }} />
                <label className="ds-lab" htmlFor="dsEnd">Last frame</label><input id="dsEnd" className="ds-in" value={s.end} onChange={e => { const v = e.target.value; edit(id, x => { x.end = v; }, s.dur - 0.1); }} />
            </div>
            <div className="ds-panel">
                <div className="ds-row"><h4>Moves in this shot · {s.moves.length}</h4><div style={{ flex: 1 }} /><button type="button" className="ds-btn sm" onClick={() => patchUi({ lib: 'add' })}>+ Add move</button></div>
                {s.moves.map(m => <div key={m.id} className="ds-row" style={{ justifyContent: 'space-between' }}>
                    <button type="button" className="ds-btn xs ghost" onClick={go({ k: 'move', shot: id, id: m.id })}><b>{MV[m.type]?.name || m.type}</b></button><span className="ds-mono">{fmt(m.start)}–{fmt(m.end)}</span>
                    <span className="ds-row" style={{ gap: 3 }}><button type="button" className="ds-btn xs" onClick={go({ k: 'move', shot: id, id: m.id })}>Edit</button><button type="button" className="ds-btn xs" aria-label={`Remove ${MV[m.type]?.name || m.type}`} onClick={() => edit(id, x => { x.moves = x.moves.filter(y => y.id !== m.id); }, m.start)}>✕</button></span>
                </div>)}
                <p className="ds-muted">Moves can overlap (a dolly with a rack focus) or follow each other. Each lands in the prompt at the beat where it starts.</p>
            </div>
        </>}

        {ui.tab === 'dialogue' && <>
            {s.lines.map(l => <div key={l.id} className="ds-panel" style={{ gap: 6 }}>
                <div className="ds-row"><span className="ds-sw" style={{ background: colorOf(l.ch) }} /><b>{nameOf(l.ch)}</b><span className="ds-mono">{fmt(offsets[id] + l.t)}</span><div style={{ flex: 1 }} />{l.orig !== '' && l.text !== l.orig && <span className="ds-pill ovr">Changed from screenplay</span>}<button type="button" className="ds-btn xs" onClick={go({ k: 'line', shot: id, id: l.id })}>More</button></div>
                <input className="ds-in" aria-label="Line text" value={l.text} onChange={e => { const v = e.target.value; edit(id, x => { x.lines.forEach(y => { if (y.id === l.id) y.text = v; }); }, l.t); }} />
            </div>)}
            {node.dialogue_lines > 0 && <div className="ds-panel" style={{ gap: 6 }}>
                <button type="button" className="ds-btn sm" onClick={() => legacy.generateVoiceForShot(id, node.shot_code)}>Generate dialogue ({node.dialogue_lines} line{node.dialogue_lines === 1 ? '' : 's'})</button>
                <p className="ds-muted">ElevenLabs voices for the screenplay's lines, filed for Cut. Shows the cost and asks before anything is spent.</p>
            </div>}
            <button type="button" className="ds-btn sm" onClick={() => { const ch = castHere[0] || 'SOMEONE'; const nl = { id: nid('l'), ch, text: '', orig: '', t: Math.round(lt0 * 10) / 10, del: '', pause: 0, src: 'native' }; edit(id, x => { x.lines.push(nl); x.lines.sort((a, b) => a.t - b.t); }, lt0); patchUi({ sel: { k: 'line', shot: id, id: nl.id } }); }}>+ Add a line at the playhead</button>
        </>}

        {ui.tab === 'sound' && <>
            <div className="ds-panel">
                <div className="ds-row"><h4>Effects in this shot</h4><div style={{ flex: 1 }} /><button type="button" className="ds-btn sm" onClick={() => { const fid = nid('f'); edit(id, x => { x.sfx.push({ id: fid, t: half(lt0), text: '' }); }, lt0); patchUi({ sel: { k: 'sfx', shot: id, id: fid } }); }}>+ At playhead</button></div>
                {s.sfx.map(f => <div key={f.id} className="ds-row" style={{ justifyContent: 'space-between' }}><button type="button" className="ds-btn xs ghost" onClick={go({ k: 'sfx', shot: id, id: f.id })}>{f.text || 'describe the sound'}</button><span className="ds-mono">{fmt(offsets[id] + f.t)}</span></div>)}
                {!s.sfx.length && <p className="ds-muted">None yet.</p>}
                <span className="ds-lab">Quick add, placed at the playhead</span>
                <div className="ds-chips">{SFX_QUICK.map(q => <button key={q} type="button" className="ds-chip" onClick={() => { const fid = nid('f'); edit(id, x => { x.sfx.push({ id: fid, t: half(lt0), text: q.toLowerCase() }); }, lt0); }}>{q}</button>)}</div>
            </div>
            <div className="ds-panel"><h4>Bed for the whole {grouped ? 'sequence' : 'request'}</h4>
                <button type="button" className="ds-opt" onClick={() => patchUi({ sel: { k: 'amb' } })}>Ambience<small>{amb.on ? amb.text || 'describe the room' : 'Off'}</small></button>
                <button type="button" className="ds-opt" onClick={() => patchUi({ sel: { k: 'music' } })}>Music<small>{music.on ? music.text : 'Off (default)'}</small></button>
            </div>
        </>}

        {ui.tab === 'light' && <div className="ds-panel">
            <div className="ds-row"><h4>Scene light and setting</h4><span className="ds-pill inh">From the location · every shot in this scene</span></div>
            <textarea className="ds-in" rows={3} aria-label="Scene setting and light" value={setting} onChange={e => setSetting(e.target.value)} />
            <div className="ds-row"><h4>This shot</h4><span className={'ds-pill ' + (s.tech ? 'ovr' : 'inh')}>{s.tech ? 'Technique changed here: ' + s.tech : 'Scene light + this shot’s note'}</span></div>
            <label className="ds-lab" htmlFor="dsLit">Light note for this shot (from the scene card, editable)</label>
            <input id="dsLit" className="ds-in" value={s.lit} onChange={e => { const v = e.target.value; edit(id, x => { x.lit = v; }, 0); }} />
            <span className="ds-lab">Technique (none = keep the scene's)</span>
            <div className="ds-chips">{TECHS.map(tq => <button key={tq} type="button" className={'ds-chip' + (s.tech === tq ? ' on' : '')} onClick={() => { edit(id, x => { x.tech = x.tech === tq ? '' : tq; }, 0); patchUi({ askApply: false }); }}>{tq}</button>)}</div>
            {!!s.tech && grouped && others.length > 0 && (ui.askApply ? <>
                <div className="ds-check warn"><span className="ds-ck">?</span><span>Set {s.tech} on {others.map(label).join(', ')}? Their own light notes stay.</span></div>
                <div className="ds-row"><button type="button" className="ds-btn sm pri" onClick={() => { setS(prev => { const n = { ...prev }; for (const x of others) n[x] = { ...n[x], tech: s.tech }; return n; }); others.forEach(x => dirty.current.shots.add(x)); queueSave(); touch(null, null); patchUi({ askApply: false }); }}>Apply to {others.length} shots</button><button type="button" className="ds-btn sm" onClick={() => patchUi({ askApply: false })}>Cancel</button></div>
            </> : <button type="button" className="ds-btn sm" onClick={() => patchUi({ askApply: true })}>Use on the whole sequence…</button>)}
        </div>}
    </>;
}

function CharPanel({ s, id, ch, ui, patchUi, edit, offsets, lt0, nameOf }) {
    const p = s.perf?.[ch];
    const name = nameOf(ch);
    const q = (ui.emoQ || '').toLowerCase();
    const curE = p?.emo || null, curI = p?.inten || 0, curT = p?.trig || 'start', curTT = p?.trigT || 0, curL = !!p?.listen;
    const apply = (emo, inten, trig, trigT, listen) => edit(id, x => applyEmotion(x, ch, name, emo, inten, trig, trigT, listen), trigT);
    const emos = EMOS.filter(e => (ui.fam === 'all' || e.fam === ui.fam) && (!q || `${e.name} ${e.face} ${e.gaze}`.toLowerCase().includes(q)));
    const trigs = [{ id: 'start', lab: 'From the start', t: 0 }, ...s.lines.map(l => ({ id: 'line', lab: `On ${nameOf(l.ch)}: “${cut(l.text, 22)}”`, t: l.t })), { id: 'ph', lab: `At the playhead ${fmt(offsets[id] + lt0)}`, t: lt0 }];
    const beats = p?.beats || [];
    const setB = (bid, fn, at) => edit(id, x => { x.perf[ch].beats.forEach(b => { if (b.id === bid) fn(b); }); x.perf[ch].beats.sort((a, b) => a.t - b.t); }, at);
    return <>
        <div className="ds-panel">
            <div className="ds-row"><h4>Emotion</h4><span className="ds-mono">{EMOS.length} emotions · {FAMS.length} families</span></div>
            <input className="ds-in" aria-label="Search emotions" placeholder="Search: hurt, contempt, relief…" value={ui.emoQ} onChange={e => patchUi({ emoQ: e.target.value })} />
            <div className="ds-chips">{[['all', 'All'], ...FAMS].map(f => <button key={f[0]} type="button" className={'ds-chip' + (ui.fam === f[0] ? ' on' : '')} onClick={() => patchUi({ fam: f[0] })}>{f[1]} {f[0] === 'all' ? EMOS.length : EMOS.filter(e => e.fam === f[0]).length}</button>)}</div>
            <div className="ds-grid3 ds-scroll">{emos.map(e => <button key={e.name} type="button" aria-pressed={curE === e.name} className={'ds-opt' + (curE === e.name ? ' on' : '')} onClick={() => apply(e.name, curE ? curI : e.lvl, curT, curTT, curL)}>{e.name}<small>{famName[e.fam]} · {INTS[e.lvl - 1]}</small></button>)}</div>
            <span className="ds-lab">Intensity · {curI ? INTS[curI - 1] : 'choose an emotion first'}</span>
            <div className="ds-seg" role="group" aria-label="Intensity">{INTS.map((n, i) => <button key={n} type="button" className={curI === i + 1 ? 'on' : ''} disabled={!curE} onClick={() => curE && apply(curE, i + 1, curT, curTT, curL)}>{n}</button>)}</div>
            <span className="ds-lab">Set off by</span>
            <div className="ds-chips">{trigs.map((tg, i) => { const on = p && Math.abs(p.trigT - tg.t) < 0.05 && (tg.id === 'start' ? p.trig === 'start' : tg.id === 'ph' ? p.trig === 'ph' : p.trig === 'line');
                return <button key={i} type="button" className={'ds-chip' + (on ? ' on' : '')} disabled={!curE} onClick={() => curE && apply(curE, curI, tg.id, tg.t, curL)}>{tg.lab}</button>; })}</div>
        </div>
        <div className="ds-panel">
            <div className="ds-row"><h4>Acting beats · {beats.filter(b => b.on).length}</h4><div style={{ flex: 1 }} /><button type="button" className="ds-btn sm" onClick={() => edit(id, x => { if (!x.perf[ch]) x.perf[ch] = { ch, emo: '', inten: 0, trig: 'start', trigT: 0, listen: false, beats: [] }; x.perf[ch].beats.push({ id: nid('b'), part: 'action', t: half(lt0), text: name + ' ', on: true, src: 'yours' }); x.perf[ch].beats.sort((a, b) => a.t - b.t); }, lt0)}>+ At playhead</button></div>
            <p className="ds-muted">Built from the emotion. Edit any of them: your edits are kept when you change the emotion.</p>
            {beats.map(b => <div key={b.id} className={'ds-beat' + (b.on ? '' : ' off')}>
                <span className="ds-part">{b.part}<br /><span className="ds-src">{b.src === 'emotion' ? 'from emotion' : b.src}</span></span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <input className="ds-in" aria-label="Acting beat" value={b.text} onChange={e => { const v = e.target.value; setB(b.id, x => { x.text = v; x.src = 'yours'; }, b.t); }} />
                    <Step lab={fmt(offsets[id] + b.t)} minus={() => setB(b.id, x => { x.t = Math.max(0, x.t - 0.5); }, b.t)} plus={() => setB(b.id, x => { x.t = Math.min(s.dur - 0.5, x.t + 0.5); }, b.t)} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button type="button" className="ds-btn xs" onClick={() => setB(b.id, x => { x.on = !x.on; }, b.t)}>{b.on ? 'On' : 'Off'}</button>
                    <button type="button" className="ds-btn xs" aria-label="Delete beat" onClick={() => edit(id, x => { x.perf[ch].beats = x.perf[ch].beats.filter(y => y.id !== b.id); }, b.t)}>✕</button>
                </span>
            </div>)}
            <button type="button" className={'ds-opt' + (curL ? ' on' : '')} disabled={!curE} onClick={() => curE && apply(curE, curI, curT, curTT, !curL)}>Listening reactions while others speak<small>{curL ? 'On: reactions placed during the other character’s lines' : 'Off. Turn on to add small reactions while others speak.'}</small></button>
            <p className="ds-muted">Never changes the character's identity, age, lines or canon.</p>
        </div>
    </>;
}

function MovePanel({ s, id, sel, k, ui, patchUi, edit, offsets, lt0, label }) {
    const m = k === 'move' ? s.moves.find(x => x.id === sel.id) : null;
    const setM = (fn) => edit(id, x => { x.moves.forEach(y => { if (y.id === m.id) fn(y); }); }, m.start);
    const mq = (ui.mvQ || '').toLowerCase();
    const lib = MOVES.filter(x => (ui.mvGroup === 'all' || x.grp === ui.mvGroup) && (!mq || `${x.name} ${x.desc}`.toLowerCase().includes(mq)));
    const d = m ? MV[m.type] : null;
    return <>
        {m && d && <div className="ds-panel">
            <div className="ds-row"><b>{d.name}</b><span className="ds-mono">{d.grp}</span><div style={{ flex: 1 }} /><button type="button" className="ds-btn xs" onClick={() => patchUi({ lib: 'swap' })}>Change move</button><button type="button" className="ds-btn xs" onClick={() => { edit(id, x => { x.moves = x.moves.filter(y => y.id !== m.id); }, m.start); patchUi({ sel: { k: 'shot', shot: id }, tab: 'camera' }); }}>Remove</button></div>
            <p className="ds-muted">{d.desc}</p>
            <span className="ds-lab">Speed</span>
            <div className="ds-seg" role="group" aria-label="Speed">{[['slow', 'Slow'], ['steady', 'Steady'], ['fast', 'Fast']].map(x => <button key={x[0]} type="button" className={m.speed === x[0] ? 'on' : ''} onClick={() => setM(y => { y.speed = x[0]; })}>{x[1]}</button>)}</div>
            <div className="ds-row" style={{ justifyContent: 'space-between' }}>
                <span className="ds-lab" style={{ margin: 0 }}>Starts</span><Step lab={fmt(offsets[id] + m.start)} minus={() => setM(y => { y.start = Math.max(0, y.start - 0.5); })} plus={() => setM(y => { y.start = Math.min(y.end - 0.5, y.start + 0.5); })} />
                <span className="ds-lab" style={{ margin: 0 }}>Ends</span><Step lab={fmt(offsets[id] + m.end)} minus={() => setM(y => { y.end = Math.max(y.start + 0.5, y.end - 0.5); })} plus={() => setM(y => { y.end = Math.min(s.dur, y.end + 0.5); })} />
            </div>
            <span className="ds-lab">Start on</span>
            <div className="ds-chips">{[{ lab: 'Shot start', t: 0 }, ...s.lines.map(l => ({ lab: `On “${cut(l.text, 18)}”`, t: l.t }))].map((x, i) => <button key={i} type="button" className={'ds-chip' + (Math.abs(m.start - x.t) < 0.05 ? ' on' : '')} onClick={() => setM(y => { const dd = y.end - y.start; y.start = x.t; y.end = Math.min(s.dur, x.t + dd); })}>{x.lab}</button>)}</div>
            {m.type === 'rack' ? <>
                <label className="ds-lab" htmlFor="dsFrom">Focus from</label><input id="dsFrom" className="ds-in" value={m.from} onChange={e => { const v = e.target.value; setM(y => { y.from = v; }); }} />
                <label className="ds-lab" htmlFor="dsTo">Focus to</label><input id="dsTo" className="ds-in" value={m.to} onChange={e => { const v = e.target.value; setM(y => { y.to = v; }); }} />
            </> : <>
                <label className="ds-lab" htmlFor="dsSubj">Led by / follows</label><input id="dsSubj" className="ds-in" value={m.subj} onChange={e => { const v = e.target.value; setM(y => { y.subj = v; }); }} />
                <label className="ds-lab" htmlFor="dsEnds">Ends on</label><input id="dsEnds" className="ds-in" value={m.ends} onChange={e => { const v = e.target.value; setM(y => { y.ends = v; }); }} />
            </>}
            <span className="ds-lab">Movement curve</span>
            <div className="ds-seg" role="group" aria-label="Curve">{[['ease', 'Ease in and out'], ['linear', 'Even'], ['snap', 'Sudden start']].map(x => <button key={x[0]} type="button" className={m.curve === x[0] ? 'on' : ''} onClick={() => setM(y => { y.curve = x[0]; })}>{x[1]}</button>)}</div>
        </div>}
        {ui.lib && <div className="ds-lib">
            <div className="ds-row"><b>{ui.lib === 'swap' && m ? `Change ${d.name} to…` : `Add a move to ${label(id)} at ${fmt(offsets[id] + lt0)}`}</b><div style={{ flex: 1 }} /><button type="button" className="ds-btn xs" onClick={() => patchUi({ lib: null })}>Close</button></div>
            <input className="ds-in" aria-label="Search moves" placeholder={`Search ${MOVES.length} moves: orbit, crane, rack…`} value={ui.mvQ} onChange={e => patchUi({ mvQ: e.target.value })} />
            <div className="ds-chips">{['all', ...MV_GROUPS].map(g => <button key={g} type="button" className={'ds-chip' + (ui.mvGroup === g ? ' on' : '')} onClick={() => patchUi({ mvGroup: g })}>{g === 'all' ? 'All' : g} {g === 'all' ? MOVES.length : MOVES.filter(x => x.grp === g).length}</button>)}</div>
            <div className="ds-grid2 ds-scroll" style={{ maxHeight: 260 }}>{lib.map(x => <button key={x.id} type="button" className="ds-opt" onClick={() => {
                if (ui.lib === 'swap' && m) { edit(id, y => { y.moves.forEach(z => { if (z.id === m.id) z.type = x.id; }); }, m.start); patchUi({ lib: null }); }
                else { const st = half(lt0); const nm = blankMove(x.id, st, Math.min(s.dur, st + 3), x.id === 'rack' ? { from: 'the foreground', to: 'the subject' } : {}); edit(id, y => { y.moves.push(nm); }, nm.start); patchUi({ lib: null, sel: { k: 'move', shot: id, id: nm.id } }); }
            }}>{x.name}<small>{x.desc}</small></button>)}</div>
        </div>}
    </>;
}

function LinePanel({ s, id, sel, ui, patchUi, edit, offsets, nameOf, colorOf, card, pid, reloadCards, castList, castKey }) {
    const l = s.lines.find(x => x.id === sel.id);
    const [saving, setSaving] = useState(false);
    if (!l) return null;
    const setL = (fn) => edit(id, x => { x.lines.forEach(y => { if (y.id === l.id) fn(y); }); x.lines.sort((a, b) => a.t - b.t); }, l.t);
    const changed = l.text !== l.orig;
    const speakers = [...new Set([...(card.characters || []).map(castKey), ...s.lines.map(x => x.ch), ...castList.map(c => castKey(c.name))])].filter(Boolean);
    /** Write this take's lines into the shot's scene card, in time order; the screenplay page then shows the change to sync. */
    const toScreenplay = async () => {
        setSaving(true);
        try {
            const dialogue = s.lines.filter(x => x.text.trim()).map(x => {
                const prior = (card.dialogue || []).find(d => d.line === x.orig && castKey(d.character) === x.ch);
                return { ...(prior || {}), character: prior ? prior.character : (castList.find(c => castKey(c.name) === x.ch)?.name || x.ch), line: x.text };
            });
            await legacy.api(`/shots/${id}`, { method: 'PUT', body: JSON.stringify({ dialogue }) });
            edit(id, x => { x.lines.forEach(y => { y.orig = y.text; }); });
            legacy.setStatus(`Scene card for this shot updated. The Screenplay page shows the change to sync.`);
            patchUi({ lnConfirm: null });
            await reloadCards();
        } catch (err) { legacy.setStatus('Screenplay not updated: ' + err.message); }
        finally { setSaving(false); }
    };
    return <div className="ds-panel">
        <div className="ds-row"><span className="ds-sw" style={{ background: colorOf(l.ch) }} /><b>{nameOf(l.ch)}</b><span className="ds-mono">{fmt(offsets[id] + l.t)}</span><div style={{ flex: 1 }} /><button type="button" className="ds-btn xs" onClick={() => { edit(id, x => { x.lines = x.lines.filter(y => y.id !== l.id); }, l.t); patchUi({ sel: { k: 'shot', shot: id }, tab: 'dialogue' }); }}>Remove</button></div>
        <label className="ds-lab" htmlFor="dsLn">Line, exactly as spoken</label>
        <input id="dsLn" className="ds-in" value={l.text} onChange={e => { const v = e.target.value; setL(y => { y.text = v; }); }} />
        {changed && <>
            <div className="ds-check warn"><span className="ds-ck">!</span><span>{l.orig ? <>Screenplay says “{l.orig}” </> : <>This line is not in the screenplay. </>}This take uses your text. The screenplay changes only if you say so.</span></div>
            {ui.lnConfirm === l.id
                ? <><div className="ds-check info"><span className="ds-ck">?</span><span>Write this shot's lines, as they are here, into its scene card? The Screenplay page will show the change so you can sync the script.</span></div>
                    <div className="ds-row"><button type="button" className="ds-btn xs pri" disabled={saving} onClick={toScreenplay}>{saving ? 'Updating…' : 'Update the screenplay'}</button><button type="button" className="ds-btn xs" onClick={() => patchUi({ lnConfirm: null })}>Cancel</button></div></>
                : <div className="ds-row"><button type="button" className="ds-btn xs" onClick={() => patchUi({ lnConfirm: l.id })}>Also update the screenplay…</button>{l.orig && <button type="button" className="ds-btn xs" onClick={() => setL(y => { y.text = y.orig; })}>Back to the screenplay</button>}</div>}
        </>}
        <span className="ds-lab">Speaker</span>
        <div className="ds-chips">{speakers.map(c2 => <button key={c2} type="button" className={'ds-chip' + (l.ch === c2 ? ' on' : '')} onClick={() => setL(y => { y.ch = c2; })}>{nameOf(c2)}</button>)}</div>
        <label className="ds-lab" htmlFor="dsDel">Delivery (kept apart from the words)</label>
        <input id="dsDel" className="ds-in" placeholder="flat, unhurried" value={l.del} onChange={e => { const v = e.target.value; setL(y => { y.del = v; }); }} />
        <div className="ds-row" style={{ justifyContent: 'space-between' }}>
            <span className="ds-lab" style={{ margin: 0 }}>Pause before</span><Step lab={(l.pause || 0) + 's'} less="Shorter pause" more="Longer pause" minus={() => setL(y => { y.pause = Math.max(0, (y.pause || 0) - 0.5); })} plus={() => setL(y => { y.pause = Math.min(3, (y.pause || 0) + 0.5); })} />
            <span className="ds-lab" style={{ margin: 0 }}>Starts</span><Step lab={fmt(offsets[id] + l.t)} minus={() => setL(y => { y.t = Math.max(0, y.t - 0.5); })} plus={() => setL(y => { y.t = Math.min(s.dur - 0.8, y.t + 0.5); })} />
        </div>
        <span className="ds-lab">Voice</span>
        <div className="ds-grid2">{[['native', 'Made by the model', 'Spoken in the clip. Voice can drift between shots.'], ['eleven', 'ElevenLabs recording', 'Your recorded line; lip-synced in Cut.']].map(x => <button key={x[0]} type="button" className={'ds-opt' + (l.src === x[0] ? ' on' : '')} onClick={() => setL(y => { y.src = x[0]; })}>{x[1]}<small>{x[2]}</small></button>)}</div>
        <p className="ds-muted">Timing is a request. No model promises the exact second, or separate voice and effect tracks.</p>
    </div>;
}

/**
 * What Previz decided for this shot (lib/previs-direction.js). Applied: its move and staging are in the prompt
 * (switchable), and camera fields not changed here follow it. Staged but not applied: say where to apply it.
 */
function PrevizPanel({ s, pv, onUpdate, onToggle }) {
    const openPreviz = () => legacy.navigateTo && legacy.navigateTo('previs');
    if (!pv) return null;
    if (!pv.applied && !s.pvz) return (
        <div className="ds-panel">
            <div className="ds-row"><h4>Previz</h4><span className="ds-pill">Not applied</span></div>
            <p className="ds-muted">This shot has a camera and staging in Previz that haven't been applied yet. Use Apply to shot in Previz and they come into this prompt; anything you've changed here stays.</p>
            <div className="ds-row"><button type="button" className="ds-btn sm" onClick={openPreviz}>Open Previz ↗</button></div>
        </div>);
    const behind = previsBehind(s, pv);
    const on = s.pvz ? s.pvz.on !== false : true;
    return (
        <div className="ds-panel">
            <div className="ds-row"><h4>From Previz</h4>{behind && pv.applied && <span className="ds-pill ovr">Previz changed since</span>}<div style={{ flex: 1 }} />
                <label className="ps-inline"><input type="checkbox" checked={on} disabled={!s.pvz} onChange={e => onToggle(e.target.checked)} /> In the prompt</label></div>
            {s.pvz?.move && <p className="ds-muted" style={{ margin: 0 }}><b>Move:</b> {s.pvz.move}</p>}
            {s.pvz?.staging?.length > 0 && <p className="ds-muted" style={{ margin: 0 }}><b>Staging:</b> {s.pvz.staging.join(' ')}</p>}
            {!s.pvz?.move && !s.pvz?.staging?.length && <p className="ds-muted" style={{ margin: 0 }}>Previz set the framing and lens; no move or named people were blocked.</p>}
            {!behind && s.pvz?.won?.by === 'previz' && <p className="ds-muted" style={{ margin: 0 }} data-testid="pvz-won">Previz's camera was applied{s.pvz.won.at ? ` at ${s.pvz.won.at.slice(11, 16)} UTC` : ''}, after the last change here, so it replaced the framing, height, facing and lens here.</p>}
            {!behind && s.pvz?.won?.by === 'here' && <p className="ds-muted" style={{ margin: 0 }} data-testid="pvz-won">Your changes here are newer than Previz's Apply, so the fields you changed stay; the others follow Previz.</p>}
            {behind && pv.applied && <div className="ds-row"><span className="ds-muted" style={{ flex: 1 }}>Previz was applied again, but your changes here are newer, so they stay. Update takes Previz's camera instead.</span>
                <button type="button" className="ds-btn sm pri" onClick={onUpdate}>Update from Previz</button></div>}
            {!pv.applied && <p className="ds-muted" style={{ margin: 0 }}>Previz has unapplied changes for this shot. <button type="button" className="ds-link" onClick={openPreviz}>Apply them in Previz ↗</button></p>}
        </div>);
}

