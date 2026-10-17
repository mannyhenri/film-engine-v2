import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { legacy } from '../../../lib/legacy.js';
import { scenesOf, CUT_KINDS, insertInStoryOrder, cutLanes } from './studio-model.js';

/*
 * Cut: the rough edit, footage or not (lib/production-cuts.js, routes/production-cuts.js).
 *   - every shot is listed: CLIP when it has a clip, BOARD when only its storyboard frame (held as a still);
 *   - ticked shots go on the picture strip in story order; reorder them, and set how long a shot plays;
 *   - drag + Music / + Sound effect / + Ambience / + Dialogue onto a shot to wire a sound there; it plays its file's
 *     length or runs to the end of a later shot; give it a file (filed into 06 Sound) or generate one;
 *   - the timeline below is what Resolve receives; Send writes only this cut, as a timeline of its name.
 * Saved on every change: there is no Save button, only "Save as new version".
 */
const secs = (ms) => `${((Number(ms) || 0) / 1000).toFixed(1)}s`;
const KIND = Object.fromEntries(CUT_KINDS.map(k => [k.id, k]));
const AUDIO = 'audio/*,.wav,.mp3,.m4a,.aif,.aiff,.flac,.ogg';
/** The clip a shot plays: its selected take, else its newest. */
const clipOf = (s) => (s?.videos || []).find(v => v.asset_id === s.selected_video_asset_id) || (s?.videos || [])[(s?.videos || []).length - 1] || null;

export default function CutTab({ pid, graph }) {
    const [cuts, setCuts] = useState([]);
    const [cut, setCut] = useState(null);
    const [sel, setSel] = useState(null);             // { shot: id } | { sound: id }
    const [busy, setBusy] = useState(false);
    const [sending, setSending] = useState(null);     // null | 'busy' | result
    const [genFor, setGenFor] = useState(null);       // sound id being generated for
    const [loaded, setLoaded] = useState(false);      // the cut list (and the latest cut) has been read
    const fileRef = useRef(null);
    const pendingFile = useRef(null);

    const shots = useMemo(() => (graph?.nodes || []).filter(n => n.type === 'shot'), [graph]);
    const byId = useMemo(() => new Map(shots.map(s => [s.id, s])), [shots]);
    const scenes = useMemo(() => (graph ? scenesOf(graph) : []), [graph]);
    const order = graph?.running_order || shots.map(s => s.id);

    const api = useCallback((path, opts) => legacy.api(path, opts), []);
    const loadList = useCallback(async () => {
        if (!pid) return [];
        const r = await api(`/projects/${pid}/cuts`);
        const list = Array.isArray(r?.cuts) ? r.cuts : [];
        setCuts(list);
        return list;
    }, [pid, api]);
    useEffect(() => {
        let gone = false;
        loadList().then(async list => {
            if (gone || !list.length) return;
            const r = await api(`/cuts/${list[0].id}`);
            if (!gone && r?.cut) setCut(r.cut);
        }).catch(err => legacy.setStatus('Cuts: ' + err.message, true))
            .finally(() => { if (!gone) setLoaded(true); });
        return () => { gone = true; };
    }, [loadList, api]);

    /** Every change goes to the server, which answers with the cut laid out again. */
    const change = async (path, method, body, note) => {
        setBusy(true);
        try {
            const r = await api(path, { method, body: JSON.stringify(body || {}) });
            if (r?.cut) setCut(r.cut);
            if (note) legacy.setStatus(note);
            return r;
        } catch (err) { legacy.setStatus(err.message, true); return null; }
        finally { setBusy(false); }
    };
    const startCut = async (shotIds) => {
        const r = await change(`/projects/${pid}/cuts`, 'POST', { name: 'Rough cut', shot_ids: shotIds });
        if (r?.cut) { await loadList(); setCut(r.cut); }
        return r?.cut;
    };
    // Before the list is read there is no `cut` yet, and a tick would start a second "Rough cut vN+1".
    const setShots = async (ids) => (!loaded ? null : cut ? change(`/cuts/${cut.id}`, 'PUT', { shot_ids: ids }) : startCut(ids));
    const inCut = new Set(cut?.shot_ids || []);
    const toggle = (id) => {
        const ids = cut?.shot_ids || [];
        return setShots(inCut.has(id) ? ids.filter(x => x !== id) : insertInStoryOrder(ids, id, order));
    };
    const selectScene = (scene) => {
        let ids = cut?.shot_ids || [];
        for (const s of scene.shots) ids = insertInStoryOrder(ids, s.id, order);
        return setShots(ids);
    };
    const move = (id, by) => {
        const ids = [...cut.shot_ids], i = ids.indexOf(id), j = i + by;
        if (i < 0 || j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        return setShots(ids);
    };
    const addSound = (kind, shotId) => {
        if (!cut || !inCut.has(shotId)) { legacy.setStatus('Drop a sound on a shot that is in the cut.', true); return; }
        return change(`/cuts/${cut.id}/sounds`, 'POST', { kind, start_shot_id: shotId, label: KIND[kind].label }).then(r => {
            const made = r?.cut?.sounds?.[r.cut.sounds.length - 1];
            if (made) setSel({ sound: made.id });
        });
    };
    const updateSound = (id, body) => change(`/cut-sounds/${id}`, 'PUT', body);

    /** A file for a sound node: imported through its kind's own route, which files it in 06 Sound, then wired. */
    const chooseFile = (sound) => { pendingFile.current = sound; fileRef.current.accept = AUDIO; fileRef.current.click(); };
    const fileToSound = async (sound, file) => {
        const kind = KIND[sound.kind];
        const shot = byId.get(sound.start_shot_id);
        if (!shot) { legacy.setStatus('Not added: the shot this sound starts on is no longer in the film. Move the sound onto a shot first.', true); return; }
        const scoped = kind.id === 'music' || kind.id === 'ambient';
        const url = scoped ? `/scenes/${shot.scene_id}/media/${kind.capability}/import` : `/shots/${shot.id}/media/${kind.capability}/import`;
        try {
            const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
            const imported = await api(url, { method: 'POST', body: JSON.stringify({ data, name: file.name }) });
            await updateSound(sound.id, { asset_id: imported.asset_id, label: sound.label && sound.label !== kind.label ? sound.label : file.name.replace(/\.[^.]+$/, '') });
            legacy.setStatus(`${file.name} filed in 06 Sound and wired in.`);
        } catch (err) { legacy.setStatus('Not added: ' + err.message, true); }
    };
    const onFile = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; const s = pendingFile.current; pendingFile.current = null; if (f && s) fileToSound(s, f); };

    /** Generate a sound effect or a room tone for a node, through the one shared paid confirmation. */
    const generate = (sound, prompt, seconds) => {
        const q = new URLSearchParams({ preview: '1', prompt, kind: sound.kind, duration_s: String(seconds) });
        return legacy.confirmPaidImage({
            title: 'Before we spend a credit',
            capability: sound.kind,
            previewUrl: `/projects/${pid}/sounds/generate?${q.toString()}`,
            note: 'Just the prompt. The sound is generated once, filed in 06 Sound and wired to this node.',
            editable: false,
            notEditableWhy: 'Edit the wording in the Generate box.',
            send: async (choices) => {
                legacy.setStatus('Generating the sound…', true);
                try {
                    const d = await api(`/projects/${pid}/sounds/generate`, { method: 'POST', body: JSON.stringify({ prompt, kind: sound.kind, duration_s: seconds, ...(choices || {}) }) });
                    await updateSound(sound.id, { asset_id: d.asset_id, label: prompt.slice(0, 60) });
                    setGenFor(null);
                    legacy.setStatus('Generated and wired: ' + d.file_name);
                } catch (err) { legacy.setStatus('Error: ' + err.message, true); }
            },
        });
    };

    const newVersion = async () => { const r = await change(`/cuts/${cut.id}/versions`, 'POST', {}, 'Saved as a new version; the old one is kept.'); if (r?.cut) await loadList(); };
    const openCut = async (id) => {
        try { const r = await api(`/cuts/${id}`); if (r?.cut) { setCut(r.cut); setSel(null); } }
        catch (err) { legacy.setStatus('Could not open that cut: ' + err.message, true); }
    };
    const sendToResolve = async () => {
        setSending('busy');
        try { setSending(await api(`/cuts/${cut.id}/send-to-resolve`, { method: 'POST', body: '{}' })); }
        // The server's sentence when it has one (NOTHING_TO_EDIT is a code, not something to show).
        catch (err) { setSending({ error: (err.data && err.data.message) || err.message }); }
    };

    const placed = (cut?.shots || []).filter(s => s.start_ms !== null);
    const total = Math.max(cut?.total_ms || 0, 1);
    const pct = (ms) => `${(ms / total) * 100}%`;
    const counts = { clip: placed.filter(s => s.picture === 'clip').length, board: placed.filter(s => s.picture === 'board').length };
    const wired = (cut?.sounds || []).filter(s => s.placed && s.asset).length;
    const selShot = sel?.shot ? (cut?.shots || []).find(s => s.shot_id === sel.shot) : null;
    const selSound = sel?.sound ? (cut?.sounds || []).find(s => s.id === sel.sound) : null;
    const lanes = cutLanes(cut);

    const onDropOnShot = (e, shotId) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData('text/x-cut-sound');
        if (kind) addSound(kind, shotId);
        else {
            const from = e.dataTransfer.getData('text/x-cut-shot');
            if (from && from !== shotId) { const ids = cut.shot_ids.filter(x => x !== from), at = ids.indexOf(shotId); ids.splice(at, 0, from); setShots(ids); }
        }
    };

    return (
        <div className="ps-cut">
            <div className="ps-asm-bar">
                {cuts.length > 0 && (
                    <label className="ps-inline">Cut
                        <select value={cut?.id || ''} onChange={e => openCut(e.target.value)}>
                            {cuts.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                    </label>
                )}
                <span className="ps-muted">{cut ? <>{placed.length} shot{placed.length === 1 ? '' : 's'} · {secs(cut.total_ms)} · {counts.clip} clip{counts.clip === 1 ? '' : 's'} · {counts.board} board{counts.board === 1 ? '' : 's'} · {wired} sound{wired === 1 ? '' : 's'} wired</> : 'Tick shots to start a cut. Shots without footage play their storyboard frame.'}</span>
                <div style={{ flex: 1 }} />
                {cut && <button type="button" className="ps-btn" disabled={busy} onClick={newVersion}>Save as new version</button>}
                <button type="button" className="ps-btn primary" disabled={!placed.length || sending === 'busy'} onClick={sendToResolve}>
                    {placed.length ? `Send ${placed.length} shot${placed.length === 1 ? '' : 's'} to DaVinci Resolve` : 'Send to DaVinci Resolve'}
                </button>
            </div>
            {sending && sending !== 'busy' && (
                <div className="ps-toast" role="status">
                    {sending.error ? <>Resolve export failed: {sending.error}</>
                        : sending.imported_into_resolve ? <>Resolve opened with “{cut?.label}” as a timeline: {sending.copied} files in Video, Stills and Sound bins, with shot markers. Package: <code>{sending.dest}</code></>
                            : <>The package is written to <code>{sending.dest}</code>, but Resolve did not take it: {sending.launch?.reason}</>}
                    <button type="button" aria-label="Close" className="ps-x" onClick={() => setSending(null)}>×</button>
                </div>
            )}

            <div className="ps-asm-body">
                <aside className="ps-lib" aria-label="Shots">
                    {!graph && <p className="ps-muted">Loading…</p>}
                    {scenes.map(scene => (
                        <div key={scene.id} className="ps-lib-sec">
                            <div className="ps-cut-scene"><span className="ps-mono">{scene.label}</span>
                                <button type="button" className="ps-link" onClick={() => selectScene(scene)}>Select scene</button></div>
                            {scene.shots.map(s => {
                                const pic = s.videos?.length ? 'clip' : s.frames?.length ? 'board' : 'none';
                                const frame = (s.frames || []).find(f => f.selected) || (s.frames || [])[0];
                                const clip = clipOf(s);
                                return (
                                    <label key={s.id} className={'ps-cut-shot' + (inCut.has(s.id) ? ' on' : '')}>
                                        <input type="checkbox" checked={inCut.has(s.id)} onChange={() => toggle(s.id)} />
                                        <span className={'ps-cut-thumb ' + pic} style={frame?.url ? { backgroundImage: `url(${legacy.API_BASE + frame.url})` } : undefined}>
                                            {!frame?.url && clip?.url && <video src={legacy.API_BASE + clip.url} preload="metadata" muted aria-hidden="true" />}
                                            <em>{pic === 'clip' ? 'CLIP' : pic === 'board' ? 'BOARD' : '—'}</em></span>
                                        <span className="ps-cut-name"><b>{s.shot_code}{s.framing ? ` · ${s.framing.replace(/_/g, ' ')}` : ''}</b><small>{s.description || ' '}</small></span>
                                        <span className="ps-mono">{secs(clip?.duration_ms || s.duration_ms)}</span>
                                    </label>
                                );
                            })}
                        </div>
                    ))}
                </aside>

                <main className="ps-canvas ps-cut-board" aria-label="Cut">
                    <div className="ps-cut-palette">
                        <span className="ps-muted">Add sound, drag onto a shot:</span>
                        {CUT_KINDS.map(k => (
                            <button key={k.id} type="button" draggable className="ps-chip" style={{ borderColor: k.color }}
                                onDragStart={e => e.dataTransfer.setData('text/x-cut-sound', k.id)}
                                onClick={() => (sel?.shot ? addSound(k.id, sel.shot) : legacy.setStatus('Select a shot, or drag the sound onto one.', true))}>
                                <i style={{ background: k.color }} aria-hidden="true" />{k.label}</button>
                        ))}
                    </div>
                    {!placed.length ? <p className="ps-muted">The shots you tick appear here in story order.</p> : (
                        <>
                            <CutPlayer cut={cut} byId={byId} />
                            <div className="ps-mono ps-cut-label">PICTURE · {cut?.label}</div>
                            <div className="ps-strip">
                                {placed.map(s => {
                                    const node = byId.get(s.shot_id);
                                    const frame = (node?.frames || []).find(f => f.selected) || (node?.frames || [])[0];
                                    const clip = s.picture === 'clip' ? clipOf(node) : null;
                                    return (
                                        <button key={s.shot_id} type="button" draggable className={'ps-ctile ' + s.picture + (sel?.shot === s.shot_id ? ' on' : '')}
                                            style={{ width: pct(s.duration_ms) }} aria-label={`${s.shot_code}, ${s.picture}, ${secs(s.duration_ms)}`}
                                            onClick={() => setSel({ shot: s.shot_id })}
                                            onDragStart={e => e.dataTransfer.setData('text/x-cut-shot', s.shot_id)}
                                            onDragOver={e => e.preventDefault()} onDrop={e => onDropOnShot(e, s.shot_id)}>
                                            <span className="ps-ctile-pic" style={frame?.url && !clip?.url ? { backgroundImage: `url(${legacy.API_BASE + frame.url})` } : undefined}>
                                                {clip?.url && <video src={legacy.API_BASE + clip.url} preload="metadata" muted aria-hidden="true" />}
                                            </span>
                                            <span className="ps-ctile-line"><b>{s.shot_code}</b><em>{s.picture === 'clip' ? 'CLIP' : s.picture === 'board' ? 'BOARD' : 'NO PICTURE'}</em></span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="ps-mono ps-cut-label">SOUND · WIRED TO SHOTS</div>
                            <div className="ps-sound-rows">
                                {CUT_KINDS.map(k => {
                                    const nodes = (cut?.sounds || []).filter(n => n.kind === k.id);
                                    if (!nodes.length) return null;
                                    return (
                                        <div key={k.id} className="ps-sound-row" aria-label={k.label}>
                                            {nodes.map(n => n.placed ? (
                                                <button key={n.id} type="button" className={'ps-snode' + (sel?.sound === n.id ? ' on' : '') + (n.asset ? '' : ' empty')}
                                                    style={{ left: pct(n.start_ms), width: `max(110px, ${pct(n.end_ms - n.start_ms)})`, borderColor: k.color }}
                                                    onClick={() => setSel({ sound: n.id })}
                                                    onDragOver={e => e.preventDefault()}
                                                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) fileToSound(n, f); }}>
                                                    <span className="ps-snode-wire" style={{ background: k.color }} aria-hidden="true" />
                                                    <b><i style={{ background: k.color }} aria-hidden="true" />{n.label || k.label}</b>
                                                    <small>{n.asset ? `${byId.get(n.start_shot_id)?.shot_code || ''}${n.offset_ms ? ` + ${secs(n.offset_ms)}` : ''}${n.end_shot_id ? ` → ${byId.get(n.end_shot_id)?.shot_code || ''}` : ''}` : 'no file yet: drop one here'}</small>
                                                </button>
                                            ) : (
                                                <button key={n.id} type="button" className="ps-snode unplaced" onClick={() => setSel({ sound: n.id })}><b>{n.label || k.label}</b><small>{n.why}</small></button>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                    <input ref={fileRef} type="file" hidden onChange={onFile} aria-label="Sound file" />
                </main>

                <aside className="ps-insp" aria-label="Inspector">
                    <h3>Inspector</h3>
                    {!selShot && !selSound && <p className="ps-muted">Click a shot or a sound in the cut.</p>}
                    {selShot && <ShotInspector s={selShot} node={byId.get(selShot.shot_id)} cut={cut}
                        onHold={(ms) => change(`/cuts/${cut.id}`, 'PUT', { holds: { ...cut.holds, [selShot.shot_id]: ms } })}
                        onReset={() => { const h = { ...cut.holds }; delete h[selShot.shot_id]; change(`/cuts/${cut.id}`, 'PUT', { holds: h }); }}
                        onMove={(by) => move(selShot.shot_id, by)} onRemove={() => { setSel(null); toggle(selShot.shot_id); }} />}
                    {selSound && <SoundInspector n={selSound} cut={cut} byId={byId} generating={genFor === selSound.id}
                        onChange={(body) => updateSound(selSound.id, body)} onFile={() => chooseFile(selSound)}
                        onGenerate={() => setGenFor(selSound.id)} onCancelGenerate={() => setGenFor(null)} onSendGenerate={generate}
                        onRemove={() => { setSel(null); change(`/cut-sounds/${selSound.id}`, 'DELETE'); }} />}
                </aside>
            </div>

            <section className="ps-timeline" aria-label="Timeline">
                <div className="ps-head"><h3>Timeline · what Resolve receives</h3><span className="ps-mono">{cut ? secs(cut.total_ms) : ''}</span></div>
                {cut && placed.length ? (
                    <div className="ps-lanes">
                        {[['video', 'V1'], ['dialogue', 'A1 DLG'], ['sfx', 'A2 SFX'], ['ambient', 'A3 AMB'], ['music', 'A4 MUS']].map(([id, name]) => (
                            <div key={id} className="ps-lane"><span className="ps-mono">{name}</span>
                                <div className="ps-lane-track">
                                    {lanes.lanes[id].map(it => <span key={it.key} className={'ps-clip ' + id + (it.picture === 'board' ? ' board' : '') + (it.empty ? ' missing' : '')}
                                        style={{ left: pct(it.start), width: pct(it.length) }}>{it.label}</span>)}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : <p className="ps-muted">Tick shots to lay out the cut.</p>}
            </section>
        </div>
    );
}

function ShotInspector({ s, node, onHold, onReset, onMove, onRemove }) {
    const [len, setLen] = useState((s.duration_ms / 1000).toFixed(1));
    useEffect(() => setLen((s.duration_ms / 1000).toFixed(1)), [s.duration_ms]);
    const clip = node?.videos?.find(v => v.asset_id === node.selected_video_asset_id) || node?.videos?.[node.videos.length - 1];
    return (
        <div className="ps-cfacts">
            <b>Shot {s.shot_code}</b>
            <span className="ps-muted">{s.picture === 'clip' ? `Clip · ${clip?.model || clip?.provider || 'uploaded'}` : s.picture === 'board' ? 'Storyboard frame, held as a still (yellow marker in Resolve)' : 'No picture yet: a gap in the edit'}</span>
            {node?.description && <p className="ps-muted">{node.description}</p>}
            <label className="ps-field">Plays for (seconds)
                <input type="number" min="0.5" step="0.5" value={len} onChange={e => setLen(e.target.value)}
                    onBlur={() => { const ms = Math.round(Number(len) * 1000); if (ms >= 500 && ms !== s.duration_ms) onHold(ms); }} />
            </label>
            {s.held && <button type="button" className="ps-link" onClick={onReset}>Back to its own length ({(s.own_duration_ms / 1000).toFixed(1)}s)</button>}
            <div className="ps-row">
                <button type="button" className="ps-btn sm" onClick={() => onMove(-1)}>Move earlier</button>
                <button type="button" className="ps-btn sm" onClick={() => onMove(1)}>Move later</button>
                <button type="button" className="ps-btn sm" onClick={onRemove}>Remove from cut</button>
            </div>
        </div>
    );
}

function SoundInspector({ n, cut, byId, generating, onChange, onFile, onGenerate, onCancelGenerate, onSendGenerate, onRemove }) {
    const k = KIND[n.kind];
    const [prompt, setPrompt] = useState('');
    const [seconds, setSeconds] = useState(n.kind === 'ambient' ? 20 : 3);
    const inCut = (cut?.shots || []).filter(s => s.start_ms !== null);
    const after = inCut.slice(Math.max(0, inCut.findIndex(s => s.shot_id === n.start_shot_id)));
    return (
        <div className="ps-cfacts">
            <b><i style={{ background: k.color }} className="ps-swatch" aria-hidden="true" />{n.label || k.label}</b>
            <span className="ps-muted">{k.label}{n.asset ? ` · ${n.asset.file_name}` : ' · no file yet'}</span>
            {n.asset && <span className="ps-mono ps-path">{n.asset.file_path}</span>}
            {!n.placed && <p className="ps-warn">Not in the cut: {n.why}.</p>}
            <div className="ps-row">
                <button type="button" className="ps-btn sm" onClick={onFile}>{n.asset ? 'Replace file…' : 'Choose file…'}</button>
                {k.generates && <button type="button" className="ps-btn sm" onClick={onGenerate}>Generate…</button>}
            </div>
            {generating && (
                <div className="ps-genbox">
                    <label className="ps-field">What is heard
                        <textarea rows={3} value={prompt} placeholder={n.kind === 'ambient' ? 'Late afternoon diner: fridge hum, distant traffic, a coffee machine' : 'A screen door two streets over, closing slowly'} onChange={e => setPrompt(e.target.value)} />
                    </label>
                    <label className="ps-field">Length (seconds)<input type="number" min="0.5" max="30" step="0.5" value={seconds} onChange={e => setSeconds(Number(e.target.value))} /></label>
                    <div className="ps-row">
                        <button type="button" className="ps-btn sm" onClick={onCancelGenerate}>Cancel</button>
                        <button type="button" className="ps-btn sm primary" disabled={!prompt.trim()} onClick={() => onSendGenerate(n, prompt.trim(), seconds)}>Review and generate</button>
                    </div>
                </div>
            )}
            <label className="ps-field">Starts at
                <select value={n.start_shot_id} onChange={e => onChange({ start_shot_id: e.target.value })}>
                    {inCut.map(s => <option key={s.shot_id} value={s.shot_id}>{s.shot_code}</option>)}
                </select>
            </label>
            <label className="ps-field">Offset into it (seconds)
                <input type="number" min="0" step="0.1" defaultValue={(n.offset_ms / 1000).toFixed(1)} key={`o${n.id}${n.offset_ms}`}
                    onBlur={e => onChange({ offset_ms: Math.round(Number(e.target.value) * 1000) })} />
            </label>
            <label className="ps-field">Ends
                <select value={n.end_shot_id || ''} onChange={e => onChange({ end_shot_id: e.target.value || null })}>
                    <option value="">when its file ends</option>
                    {after.map(s => <option key={s.shot_id} value={s.shot_id}>at the end of {byId.get(s.shot_id)?.shot_code || s.shot_code}</option>)}
                </select>
            </label>
            <div className="ps-grid2">
                <label className="ps-field">Level (dB)<input type="number" min="-60" max="12" step="1" defaultValue={n.gain_db} key={`g${n.id}${n.gain_db}`} onBlur={e => onChange({ gain_db: Number(e.target.value) })} /></label>
                <label className="ps-field">Fade in (s)<input type="number" min="0" step="0.5" defaultValue={n.fade_in_ms / 1000} key={`i${n.id}${n.fade_in_ms}`} onBlur={e => onChange({ fade_in_ms: Math.round(Number(e.target.value) * 1000) })} /></label>
                <label className="ps-field">Fade out (s)<input type="number" min="0" step="0.5" defaultValue={n.fade_out_ms / 1000} key={`f${n.id}${n.fade_out_ms}`} onBlur={e => onChange({ fade_out_ms: Math.round(Number(e.target.value) * 1000) })} /></label>
            </div>
            {n.placed && <span className="ps-muted">Plays {secs(n.start_ms)} → {secs(n.end_ms)} in the cut{n.note ? ` · ${n.note}` : ''}</span>}
            <button type="button" className="ps-btn sm" onClick={onRemove}>Disconnect</button>
        </div>
    );
}

/*
 * Play the cut here, before Resolve: the picture strip in order (a clip plays with its own sound, a board is held for
 * its length) and every wired sound with a file at its place, at its gain, with its fades. One clock (the wall clock
 * from Play); each element is put where the clock says on every frame and only corrected when it drifts, so a slow
 * file catches up instead of stalling the rest.
 */
const dbToVolume = (db) => Math.max(0, Math.min(1, Math.pow(10, (Number(db) || 0) / 20)));
function soundVolume(n, ms) {
    let v = dbToVolume(n.gain_db);
    if (n.fade_in_ms > 0 && ms - n.start_ms < n.fade_in_ms) v *= Math.max(0, (ms - n.start_ms) / n.fade_in_ms);
    if (n.fade_out_ms > 0 && n.end_ms - ms < n.fade_out_ms) v *= Math.max(0, (n.end_ms - ms) / n.fade_out_ms);
    return v;
}
function follow(el, want, run) {
    if (!el) return;
    if (!run) { if (!el.paused) el.pause(); return; }
    if (el.paused) { try { el.currentTime = want; } catch (_) { /* not loaded yet */ } const p = el.play(); if (p && p.catch) p.catch(() => {}); }
    else if (Math.abs(el.currentTime - want) > 0.3) { try { el.currentTime = want; } catch (_) { /* seeking */ } }
}

function CutPlayer({ cut, byId }) {
    const total = cut?.total_ms || 0;
    const shots = useMemo(() => (cut?.shots || []).filter(s => s.start_ms !== null), [cut]);
    const sounds = useMemo(() => (cut?.sounds || []).filter(n => n.placed && n.asset?.url), [cut]);
    const [t, setT] = useState(0);
    const [playing, setPlaying] = useState(false);
    const clock = useRef({ at: 0, wall: 0 });
    const raf = useRef(0);
    const audios = useRef(new Map());   // sound id -> <audio>
    const video = useRef(null);
    const live = useRef({ shots, sounds, total }); live.current = { shots, sounds, total };

    const shotAt = (ms, list = shots) => list.find(s => ms >= s.start_ms && ms < s.start_ms + s.duration_ms) || null;
    const sync = (ms, run) => {
        const { shots: ss, sounds: ns } = live.current;
        for (const n of ns) {
            const a = audios.current.get(n.id);
            const inside = ms >= n.start_ms && ms < n.end_ms;
            if (a && inside) a.volume = soundVolume(n, ms);
            follow(a, (ms - n.start_ms) / 1000, run && inside);
        }
        const s = shotAt(ms, ss);
        follow(video.current, s ? (ms - s.start_ms) / 1000 : 0, run && !!s && s.picture === 'clip');
    };

    // One <audio> per wired sound, kept across edits and replaced only when its file changes.
    useEffect(() => {
        const m = audios.current, want = new Map(sounds.map(n => [n.id, legacy.API_BASE + n.asset.url]));
        for (const [id, a] of m) if (want.get(id) !== a.src && want.get(id) !== a.getAttribute('src')) { a.pause(); m.delete(id); }
        for (const [id, src] of want) if (!m.has(id)) { const a = new Audio(src); a.preload = 'auto'; m.set(id, a); }
    }, [sounds]);
    useEffect(() => () => { cancelAnimationFrame(raf.current); for (const a of audios.current.values()) a.pause(); audios.current.clear(); }, []);

    const tick = () => {
        const ms = clock.current.at + (performance.now() - clock.current.wall);
        if (ms >= live.current.total) { stop(live.current.total); return; }
        setT(ms); sync(ms, true);
        raf.current = requestAnimationFrame(tick);
    };
    const stop = (at) => { cancelAnimationFrame(raf.current); setPlaying(false); setT(at); sync(at, false); };
    const play = () => {
        if (!total) return;
        const from = t >= total - 50 ? 0 : t;
        clock.current = { at: from, wall: performance.now() };
        setPlaying(true); sync(from, true);
        raf.current = requestAnimationFrame(tick);
    };
    const seek = (ms) => {
        const at = Math.max(0, Math.min(total, ms));
        clock.current = { at, wall: performance.now() };
        setT(at); sync(at, playing);
    };
    // The clip under the playhead changes element; put the new one where the clock is.
    const cur = shotAt(t);
    const node = cur ? byId.get(cur.shot_id) : null;
    const clip = cur?.picture === 'clip' ? clipOf(node) : null;
    const frame = (node?.frames || []).find(f => f.selected) || (node?.frames || [])[0];
    const silent = !sounds.length && !shots.some(s => s.picture === 'clip');
    const unfiled = (cut?.sounds || []).filter(n => n.placed && !n.asset).length;

    return (
        <div className="ps-player" aria-label="Cut player">
            <div className="ps-monitor">
                {clip?.url ? <video key={clip.url} ref={video} src={legacy.API_BASE + clip.url} preload="auto" playsInline
                    onLoadedMetadata={() => sync(clock.current.at + (playing ? performance.now() - clock.current.wall : 0), playing)} />
                    : frame?.url ? <img src={legacy.API_BASE + frame.url + (String(frame.url).includes('?') ? '&w=1280' : '?w=1280')} alt={`Storyboard frame for ${cur?.shot_code || ''}`} />
                        : <span className="ps-muted">{cur ? `${cur.shot_code}: no picture yet` : ''}</span>}
                {cur && <span className="ps-monitor-tag ps-mono">{cur.shot_code} · {cur.picture === 'clip' ? 'CLIP' : cur.picture === 'board' ? 'BOARD' : 'GAP'}</span>}
            </div>
            <div className="ps-transport">
                <button type="button" className="ps-btn primary sm" onClick={() => (playing ? stop(t) : play())} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Pause' : 'Play'}</button>
                <input type="range" min="0" max={total} step="40" value={Math.round(t)} onChange={e => seek(Number(e.target.value))} aria-label="Playhead" />
                <span className="ps-mono">{secs(t)} / {secs(total)}</span>
            </div>
            <span className="ps-muted">{silent ? 'No sound yet: wire a sound below and give it a file, or add clips with sound.'
                : `${sounds.length} sound${sounds.length === 1 ? '' : 's'} play${sounds.length === 1 ? 's' : ''} with the picture${unfiled ? ` · ${unfiled} without a file stay silent` : ''}.`}</span>
        </div>
    );
}

