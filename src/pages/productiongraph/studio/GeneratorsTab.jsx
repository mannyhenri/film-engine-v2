import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { legacy } from '../../../lib/legacy.js';
import './generators.css';

/*
 * Generators: Production's local AI tools (slow motion, upscale, depth, rotoscope, stems, subtitles).
 *
 * Drop any video, pick a tool, set its options, Generate. A section tool (slow motion) renders only the
 * part between In and Out, marked on the player with the buttons or the I / O keys as in Resolve; a whole
 * tool (upscale) takes the entire file. Jobs run one at a time on this Mac's GPUs; the running job's progress
 * shows under the player, the History below keeps every result, and a result opens in Finder to drag into Resolve.
 *
 * Why here and not in Resolve: free Resolve 21.1 refuses script windows and sandboxes file and process
 * access, so a tool can't run from inside it (see backend/lib/generators.js).
 *
 * A dropped file is read where it lies on disk (the desktop app passes its path; nothing is copied). In a
 * plain browser the file is sent as an upload instead, up to the import size limit.
 */
const api = (p, o) => legacy.api(p, o);
const POLL_MS = 1500;

function timecode(frame, fps) {
    if (frame == null || !fps) return '—';
    const f = Math.round(fps), s = Math.floor(frame / f);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(frame % f)}`;
}
const fname = p => String(p || '').split('/').pop();
const IMG_OUT = /\.(png|jpe?g|webp|tiff?)$/i;
const CODECS = { prores: 'ProRes', dnxhd: 'DNxHD', cfhd: 'CineForm', mjpeg: 'Motion JPEG', qtrle: 'Animation' };
const active = j => j.status === 'running' || j.status === 'queued';

export default function GeneratorsTab() {
    const [tools, setTools] = useState([]);
    const [dirs, setDirs] = useState({});
    const [jobs, setJobs] = useState([]);
    const [input, setInput] = useState(null);
    const [toolId, setToolId] = useState(null);
    const [values, setValues] = useState({});
    const [inF, setIn] = useState(null);
    const [outF, setOut] = useState(null);
    const [frame, setFrame] = useState(0);
    const [points, setPoints] = useState([]);   // [{x,y,label}] for click-to-select tools
    const [pointsFrame, setPointsFrame] = useState(null);
    const [over, setOver] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [playing, setPlaying] = useState(null);   // "jobId:n" of an output shown inline
    const [loading, setLoading] = useState('');     // the player's state: '' ready, 'wait' preparing, or why it can't play
    const [settings, setSettings] = useState({ out_dir: null, default_out_dir: '' });   // where results are saved
    const player = useRef(null);
    const fileInput = useRef(null);

    const tool = tools.find(t => t.id === toolId) || null;
    // A setting can say when it applies ("when": {"effect": ["fog"]}): only those for the current choices show.
    const applies = o => !o.when || Object.entries(o.when).every(([k, vs]) => (vs || []).map(String).includes(String(values[k])));
    const shown = (tool?.options || []).filter(applies);
    const pointsOpt = shown.find(o => o.type === 'points') || null;
    const usable = useMemo(() => tools.filter(t => !input || t.accepts === input.kind || (input.kind === 'audio' && t.audio_ok)), [tools, input]);

    const loadJobs = useCallback(async () => {
        try { const r = await api('/generators/jobs'); setJobs(Array.isArray(r?.jobs) ? r.jobs : []); }
        catch (err) { setError('Jobs: ' + err.message); }
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const r = await api('/generators/tools');
                setTools(Array.isArray(r?.tools) ? r.tools : []);
                setDirs({ engine: r?.engine_dir, out: r?.out_dir });
            } catch (err) { setError('Tools: ' + err.message); }
            try { const st = await api('/generators/settings'); if (st) setSettings(st); } catch (_) { /* the default folder still works */ }
            loadJobs();
        })();
    }, [loadJobs]);

    // Poll while anything is queued or running; stop when the list is idle.
    const anyActive = jobs.some(active);
    const current = jobs.find(j => j.status === 'running') || jobs.find(j => j.status === 'queued') || null;
    const pctOf = j => j.total ? Math.min(100, Math.round(100 * j.done / j.total)) : (j.status === 'done' ? 100 : 0);
    useEffect(() => {
        if (!anyActive) return undefined;
        const t = setTimeout(loadJobs, POLL_MS);
        return () => clearTimeout(t);
    }, [anyActive, jobs, loadJobs]);

    // A tool's defaults, whenever the tool changes.
    useEffect(() => {
        if (!tool) return;
        const v = {};
        for (const o of tool.options || []) if (o.type !== 'points') v[o.name] = o.default;
        setValues(v);
        setPoints([]); setPointsFrame(null);
    }, [toolId]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Pick the first tool that is ready and fits the file; never a "not ready" one.
    useEffect(() => {
        const ready = usable.filter(t => !t.unavailable);
        if (!ready.some(t => t.id === toolId)) setToolId(ready[0]?.id || null);
    }, [usable, toolId]);

    const register = async (file) => {
        setError(''); setBusy(true);
        try {
            const p = window.__feFiles?.pathFor?.(file) || '';
            let r;
            if (p) r = await api('/generators/inputs', { method: 'POST', body: JSON.stringify({ path: p }), refresh: false });
            else {
                const res = await fetch(`${legacy.API_BASE}/film/generators/inputs/import`, {
                    method: 'POST', body: file,
                    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': file.name },
                });
                r = await res.json();
                if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
            }
            setInput(r.input); setIn(null); setOut(null); setFrame(0); setPoints([]); setPointsFrame(null); setLoading('wait');
        } catch (err) { setError(err.message); }
        finally { setBusy(false); }
    };

    const onDrop = e => { e.preventDefault(); setOver(false); const f = e.dataTransfer?.files?.[0]; if (f) register(f); };
    // The frame on screen, never past the clip's real last frame: at the very end the player's time rounds one
    // frame beyond it (361 on a 0-360 clip), and an Out mark there promised a frame the file doesn't have.
    const lastFrame = input?.frames ? input.frames - 1 : Infinity;
    const curFrame = () => {
        const f = (player.current && input?.fps) ? Math.round(player.current.currentTime * input.fps) : frame;
        return Math.max(0, Math.min(lastFrame, f));
    };
    const markIn = () => { const f = curFrame(); setIn(f); if (outF != null && outF <= f) setOut(null); };
    const markOut = () => { const f = curFrame() + 1; setOut(f); if (inF != null && inF >= f) setIn(null); };   // Out is exclusive: the frame on screen is included

    // I / O like Resolve, when the user isn't typing in a field.
    useEffect(() => {
        if (tool?.range !== 'section' || !input) return undefined;
        const onKey = e => {
            if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName)) return;
            if (e.key === 'i' || e.key === 'I') { e.preventDefault(); markIn(); }
            if (e.key === 'o' || e.key === 'O') { e.preventDefault(); markOut(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    const pick = e => {   // click-to-select: left = the subject, right / alt = leave out
        if (!pointsOpt || !player.current) return;
        e.preventDefault();
        const r = player.current.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        player.current.pause();
        const f = curFrame();
        const fresh = pointsFrame != null && f !== pointsFrame;   // points belong to one frame: a new frame starts over
        setPointsFrame(f);
        setPoints(ps => [...(fresh ? [] : ps), { x, y, label: (e.button === 2 || e.altKey) ? 0 : 1 }]);
    };

    const section = tool?.range === 'section' && inF != null && outF != null && outF > inF;
    const generate = async () => {
        if (!tool || !input) return;
        setError(''); setBusy(true);
        try {
            // Only the settings shown for the current choices (a hidden one does not apply; the server drops it too).
            const options = Object.fromEntries(shown.filter(o => o.type !== 'points' && values[o.name] !== undefined).map(o => [o.name, values[o.name]]));
            // Clicks only when the tool's click setting applies (Rotoscope in click mode, not "Auto: people").
            if (pointsOpt) {
                if (!points.length) throw new Error('Click the subject on the picture first (right-click or Alt-click to exclude).');
                options[pointsOpt.name] = points.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.label}`).join(';');
                options.frame = pointsFrame - (section ? inF : 0);
            }
            await api('/generators/jobs', { method: 'POST', refresh: false,
                body: JSON.stringify({ tool: tool.id, input_id: input.id, options, ...(section ? { start: inF, end: outF } : {}) }) });
            await loadJobs();
        } catch (err) { setError(err.message); }
        finally { setBusy(false); }
    };

    const cancel = async id => { try { await api(`/generators/jobs/${id}/cancel`, { method: 'POST', refresh: false }); loadJobs(); } catch (err) { setError(err.message); } };
    const reveal = p => window.__feFiles?.reveal?.(p);
    // Where this tool's results land: the chosen folder, else ~/Movies/Film Engine Generators/<tool>.
    const saveDir = settings.out_dir || (settings.default_out_dir && tool ? `${settings.default_out_dir}/${tool.name}` : settings.default_out_dir);
    const chooseFolder = async () => {
        const dir = await window.__feFiles?.pickFolder?.(saveDir);
        if (!dir) return;
        try { setSettings(await api('/generators/settings', { method: 'PUT', body: JSON.stringify({ out_dir: dir }), refresh: false })); }
        catch (err) { setError(err.message); }
    };
    const useDefault = async () => {
        try { setSettings(await api('/generators/settings', { method: 'PUT', body: JSON.stringify({ out_dir: null }), refresh: false })); }
        catch (err) { setError(err.message); }
    };
    // ProRes and other codecs the player can't decode play from an H.264 copy the backend makes (the tool still
    // reads the original). Results are ProRes, so outputs always ask for the preview; a playable file comes back as is.
    const media = input ? `${legacy.API_BASE}/film/generators/inputs/${input.id}${input.preview ? '/preview' : ''}` : '';
    const outMedia = (j, n) => `${legacy.API_BASE}/film/generators/jobs/${j.id}/output/${n}/preview`;
    const playerError = e => setLoading(e.currentTarget.error?.code === 4
        ? 'This file can\'t be shown here, but the tools can still read it.' : 'The preview could not load. Try the file again.');
    const progress = current && (
        <div className="gen-now" role="status" aria-live="polite">
            <div className="ps-row">
                <strong>{current.tool_name}</strong>
                <span className="ps-muted">{current.input_name}{current.start != null ? ` · frames ${current.start}–${current.end - 1}` : ''}</span>
                <div style={{ flex: 1 }} />
                <button type="button" className="ps-btn" onClick={() => cancel(current.id)}>Cancel</button>
            </div>
            <div className="gen-bar big" role="progressbar" aria-label="Current job" aria-valuenow={pctOf(current)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pctOf(current)}%` }} /></div>
            <span className="ps-mono">{current.status === 'queued' ? 'Waiting to start' : current.stage}{current.total ? ` · ${current.done} / ${current.total}` : ''} · {pctOf(current)}%</span>
        </div>
    );

    return (
        <div className="gen">
            <div className="gen-main">
                <div className="gen-left">
                <section
                    className={`gen-drop${over ? ' over' : ''}${input ? ' has' : ''}`}
                    onDragOver={e => { e.preventDefault(); setOver(true); }}
                    onDragLeave={() => setOver(false)}
                    onDrop={onDrop}
                    aria-label="Drop a video or audio file"
                >
                    {!input && (
                        <div className="gen-empty">
                            <h3>Drop a video or image here</h3>
                            <p className="ps-muted">Any video, audio or image file. It is read where it is: nothing is copied.</p>
                            <button type="button" className="ps-btn" onClick={() => fileInput.current?.click()} disabled={busy}>Choose a file…</button>
                        </div>
                    )}
                    {input && (
                        <>
                            <div className="gen-player">
                                {input.kind === 'image'
                                    ? <img className="gen-still" src={media} alt={input.name} onLoad={() => setLoading('')} onError={() => setLoading('This image can\'t be shown here, but the tools can still read it.')} />
                                    : input.kind === 'video'
                                    ? <video ref={player} src={media} controls preload="metadata"
                                        onLoadedMetadata={() => setLoading('')} onError={playerError}
                                        onTimeUpdate={e => setFrame(Math.round(e.currentTarget.currentTime * (input.fps || 24)))}
                                        onClick={pointsOpt ? pick : undefined} onContextMenu={pointsOpt ? pick : undefined} />
                                    : <audio ref={player} src={media} controls preload="metadata"
                                        onLoadedMetadata={() => setLoading('')} onError={playerError}
                                        onTimeUpdate={e => setFrame(Math.round(e.currentTarget.currentTime * (input.fps || 24)))} />}
                                {loading && (
                                    <div className="gen-loading" data-testid="gen-loading">
                                        {loading === 'wait' ? (input.preview ? `Preparing a ${input.kind === 'image' ? 'viewable' : 'playable'} copy of this ${input.codec ? (CODECS[input.codec] || input.codec.toUpperCase()) + ' ' : ''}file…` : 'Loading…') : loading}
                                    </div>
                                )}
                                {pointsOpt && points.length > 0 && frame === pointsFrame && (
                                    <div className="gen-points" aria-hidden="true">
                                        {points.map((p, i) => <span key={i} className={p.label ? 'in' : 'out'} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />)}
                                    </div>
                                )}
                            </div>
                            <div className="ps-row gen-info">
                                <strong>{input.name}</strong>
                                <span className="ps-mono">{input.width ? `${input.width}×${input.height} · ` : ''}{input.fps ? `${Number(input.fps.toFixed(3))} fps · ` : ''}{input.frames ? `${input.frames} frames · ` : ''}{input.duration ? `${input.duration.toFixed(2)} s` : ''}</span>
                                {input.kind !== 'image' && <span className="ps-mono">frame {frame} · {timecode(frame, input.fps)}</span>}
                                <div style={{ flex: 1 }} />
                                <button type="button" className="ps-btn" onClick={() => fileInput.current?.click()} disabled={busy}>Another file…</button>
                            </div>
                        </>
                    )}
                    <input ref={fileInput} type="file" accept="video/*,audio/*,image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) register(f); e.target.value = ''; }} />
                </section>
                {progress}
                </div>

                <section className="gen-panel">
                    <h3>Tool</h3>
                    {!tools.length && <p className="ps-muted">No tools found in {dirs.engine || 'the engines folder'}.</p>}
                    <div className="gen-tools" role="radiogroup" aria-label="Generator">
                        {tools.map(t => {
                            const fits = usable.includes(t);
                            return (
                                <button key={t.id} type="button" role="radio" aria-checked={toolId === t.id}
                                    className={`gen-tool${toolId === t.id ? ' on' : ''}`} disabled={!!t.unavailable || !fits}
                                    title={t.unavailable || (!fits ? `Needs ${t.accepts}` : t.description)} onClick={() => setToolId(t.id)}>
                                    <span className="gen-tool-name">{t.name}</span>
                                    <span className="gen-tool-desc">{t.unavailable ? `Not ready: ${t.unavailable}` : (t.range === 'section' ? 'Section' : 'Whole file')}</span>
                                </button>
                            );
                        })}
                    </div>

                    {tool && !tool.unavailable && (
                        <>
                            <p className="ps-muted">{tool.description}</p>
                            {tool.range === 'section' && input && (
                                <div className="gen-range">
                                    <button type="button" className="ps-btn" onClick={markIn} title="Mark In (I)">Mark In <kbd>I</kbd></button>
                                    <button type="button" className="ps-btn" onClick={markOut} title="Mark Out (O)">Mark Out <kbd>O</kbd></button>
                                    <button type="button" className="ps-btn" onClick={() => { setIn(null); setOut(null); }} disabled={inF == null && outF == null}>Clear</button>
                                    <span className="ps-mono" data-testid="gen-section">
                                        {section ? `Section ${timecode(inF, input.fps)} → ${timecode(outF, input.fps)} · ${outF - inF} frames` : inF != null ? `In ${timecode(inF, input.fps)}, now mark Out` : 'Whole clip (mark In and Out to render only a section)'}
                                    </span>
                                </div>
                            )}
                            {pointsOpt && input && (
                                <p className="ps-muted">{points.length
                                    ? `${points.filter(p => p.label).length} on the subject, ${points.filter(p => !p.label).length} excluded, on frame ${pointsFrame}. `
                                    : 'Click the subject on the picture. Right-click or Alt-click marks what to leave out. '}
                                    {points.length > 0 && <button type="button" className="ps-link" onClick={() => setPoints([])}>Clear points</button>}
                                </p>
                            )}
                            <div className="gen-options">
                                {shown.filter(o => o.type !== 'points').map(o => (
                                    <Option key={o.name} opt={o} value={values[o.name]} onChange={v => setValues(s => ({ ...s, [o.name]: v }))} />
                                ))}
                            </div>
                            <div className="gen-saveto">
                                <span className="ps-muted">Save to</span>
                                <span className="ps-mono gen-path" title={saveDir || ''} data-testid="gen-saveto">{saveDir || '…'}</span>
                                {window.__feFiles?.pickFolder && <button type="button" className="ps-link" onClick={chooseFolder} disabled={!!current}>Change…</button>}
                                {settings.out_dir && <button type="button" className="ps-link" onClick={useDefault} disabled={!!current}>Use default</button>}
                                {window.__feFiles?.reveal && saveDir && <button type="button" className="ps-link" onClick={() => reveal(saveDir)}>Show in Finder</button>}
                            </div>
                            <div className="ps-row">
                                {/* One job at a time: locked while one is running, so a second click can't start another. */}
                                <button type="button" className="ps-btn primary" disabled={!input || busy || !!current} onClick={generate}>
                                    {current ? `Generating… ${pctOf(current)}%` : busy ? 'Starting…' : section ? 'Generate section' : 'Generate'}
                                </button>
                                {!input && <span className="ps-muted">Drop a file first.</span>}
                            </div>
                        </>
                    )}
                    {error && <p className="ps-warn" role="alert">{error}</p>}
                </section>
            </div>

            <section className="gen-jobs">
                <div className="ps-row"><h3>History</h3><span className="ps-muted">One job runs at a time. Each result says where it was saved.</span></div>
                {!jobs.length && <p className="ps-muted">Nothing generated yet.</p>}
                <ul>
                    {jobs.map(j => {
                        const pct = pctOf(j);
                        return (
                            <li key={j.id} className={`gen-job ${j.status}`}>
                                <div className="ps-row">
                                    <strong>{j.tool_name}</strong>
                                    <span className="ps-muted">{j.input_name}{j.start != null ? ` · frames ${j.start}–${j.end - 1}` : ''}</span>
                                    <div style={{ flex: 1 }} />
                                    <span className={`gen-status ${j.status}`}>{j.status === 'running' ? j.stage : j.status}</span>
                                    {active(j) && <button type="button" className="ps-btn" onClick={() => cancel(j.id)}>Cancel</button>}
                                </div>
                                {active(j) && <div className="gen-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>}
                                {j.status === 'running' && j.total > 0 && <span className="ps-mono">{j.done} / {j.total}</span>}
                                {j.error && <p className="ps-warn">{j.error}</p>}
                                {j.note && <p className="ps-muted">{j.note}</p>}
                                {j.stats && Object.keys(j.stats).length > 0 && (
                                    <p className="ps-mono gen-stats">{Object.entries(j.stats).map(([k, v]) => `${k.replace(/_/g, ' ')} ${typeof v === 'number' ? Number(v.toFixed(2)) : v}`).join(' · ')}</p>
                                )}
                                {j.outputs?.length > 0 && (
                                    <ul className="gen-outs">
                                        {j.outputs.map((p, n) => (
                                            <li key={p}>
                                                <span className="ps-mono" title={p}>{fname(p)}</span>
                                                <span className="ps-muted gen-path">{p.slice(0, p.length - fname(p).length - 1)}</span>
                                                {window.__feFiles?.reveal && <button type="button" className="ps-link" onClick={() => reveal(p)}>Show in Finder</button>}
                                                {/\.(mov|mp4|m4v|wav|mp3|m4a|png|jpe?g|webp|tiff?)$/i.test(p) && <button type="button" className="ps-link" onClick={() => setPlaying(playing === `${j.id}:${n}` ? null : `${j.id}:${n}`)}>{playing === `${j.id}:${n}` ? 'Hide' : IMG_OUT.test(p) ? 'View' : 'Play'}</button>}
                                                {playing === `${j.id}:${n}` && (/\.(wav|mp3|m4a)$/i.test(p)
                                                    ? <audio src={outMedia(j, n)} controls autoPlay />
                                                    : IMG_OUT.test(p) ? <a href={outMedia(j, n)} target="_blank" rel="noreferrer" title="Open at full size"><img className="gen-out-player" src={outMedia(j, n)} alt={fname(p)} /></a>
                                                    : <video className="gen-out-player" src={outMedia(j, n)} controls autoPlay />)}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </section>
        </div>
    );
}

function Option({ opt, value, onChange }) {
    const id = `gen-opt-${opt.name}`;
    if (opt.type === 'checkbox') {
        return <label className="gen-opt check" htmlFor={id}><input id={id} type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> {opt.label}</label>;
    }
    if (opt.type === 'select') {
        return (
            <label className="gen-opt" htmlFor={id}><span>{opt.label}</span>
                <select id={id} value={String(value ?? '')} onChange={e => {
                    const hit = (opt.choices || []).find(c => String(c.value) === e.target.value); onChange(hit ? hit.value : e.target.value);
                }}>
                    {(opt.choices || []).map(c => <option key={String(c.value)} value={String(c.value)}>{c.label}</option>)}
                </select>
            </label>
        );
    }
    if (opt.type === 'slider') {
        const pct = opt.max <= 1 && opt.min >= 0 ? `${Math.round(Number(value) * 100)}%` : String(value);
        return (
            <label className="gen-opt" htmlFor={id}><span>{opt.label} <em className="ps-mono">{pct}</em></span>
                <input id={id} type="range" min={opt.min} max={opt.max} step={opt.step || 'any'} value={value ?? opt.default} onChange={e => onChange(Number(e.target.value))} />
            </label>
        );
    }
    return (
        <label className="gen-opt" htmlFor={id}><span>{opt.label}</span>
            <input id={id} type={opt.type === 'number' ? 'number' : 'text'} value={value ?? ''} min={opt.min} max={opt.max} step={opt.step}
                onChange={e => onChange(opt.type === 'number' ? Number(e.target.value) : e.target.value)} />
        </label>
    );
}
