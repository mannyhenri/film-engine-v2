import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * The pipeline monitor (FILM-069), as React. Replaces the legacy functions listed
 * in react.json: the same routes, bodies, markup and status lines. The live run is
 * the same server-sent event stream (core's streamSSEPost), drawn from state.
 */
const STEP_ICON = { pending: '○', running: '●', complete: '✓', failed: '✗' };
const C = { ok: 'var(--gl-success,#22c55e)', warn: 'var(--gl-warning,#f59e0b)', bad: 'var(--gl-danger,#ef4444)', run: 'var(--gl-accent,#818cf8)' };

function Readiness({ audit }) {
    const shots = (audit && audit.shots) || [];
    if (!shots.length) return null;
    const ready = shots.filter(s => s.ready).length;
    const blocked = shots.filter(s => !s.ready);
    const allReady = blocked.length === 0;
    return (
        <div className="card" style={{ borderLeft: `4px solid ${allReady ? C.ok : C.warn}`, padding: '8px 12px' }}>
            <strong>{allReady ? '✓ Consistency ready' : '⚠ ' + blocked.length + ' shot(s) not locked'}</strong>
            <span className="text-sm text-muted"> — {ready}/{shots.length} shots ready.{allReady ? '' : ' Strict mode will block these.'}</span>
            {blocked.length > 0 && (
                <div className="text-sm text-muted" style={{ marginTop: 6 }}>
                    {blocked.slice(0, 6).map((s, i) => <div key={i}>{(s.shot_code || (s.shot_id || '').slice(0, 8)) + ': ' + ((s.missing || []).join('; ') || 'not ready')}</div>)}
                    {blocked.length > 6 && <div>…and {blocked.length - 6} more</div>}
                </div>
            )}
        </div>
    );
}

function Steps({ steps, states }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {steps.map(st => {
                const s = states[st.id] || 'pending';
                const color = s === 'complete' ? C.ok : s === 'failed' ? C.bad : s === 'running' ? C.run : 'var(--gl-text-muted)';
                return (
                    <div key={st.id} data-step={st.id} data-state={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <span style={{ color, width: 16, textAlign: 'center' }}>{STEP_ICON[s] || '○'}</span>
                        <span style={{ color: s === 'pending' ? 'var(--gl-text-muted)' : 'var(--gl-text-primary)' }}>{st.name || st.id}</span>
                        {s === 'running' && <span className="text-sm text-muted">…</span>}
                    </div>
                );
            })}
        </div>
    );
}

/** The live run panel: a sequence of what the stream said, drawn as the legacy innerHTML was. */
function Live({ run }) {
    if (!run) return null;
    if (run.blocked) return (
        <div className="card" style={{ borderLeft: `4px solid ${C.bad}`, padding: '8px 12px' }}><strong>⛔ Strict consistency: shot not locked</strong>
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>Lock its in-frame subjects in the Consistency Studio, or uncheck Strict consistency to run anyway.</div></div>
    );
    const failed = run.steps.filter(st => run.states[st.id] === 'failed').length;
    return (
        <>
            {run.steps.length === 0 && run.warning && (
                <>
                    <div className="card" style={{ borderLeft: `4px solid ${run.warning.ready ? C.warn : C.bad}`, padding: '8px 12px', marginBottom: 8 }}>
                        <strong>{run.warning.ready ? '⚠ Consistency warnings' : '⛔ Consistency not ready'}</strong>
                        <div className="text-sm text-muted" style={{ marginTop: 4 }}>{run.warning.lines.map((l, i) => <div key={i}>{l}</div>)}</div>
                    </div>
                    <div className="text-sm text-muted">Running {run.label}…</div>
                </>
            )}
            {run.steps.length === 0 && !run.warning && <div className="text-sm text-muted">Starting {run.label}…</div>}
            {run.steps.length > 0 && <><strong style={{ fontSize: 13 }}>{run.label}</strong><Steps steps={run.steps} states={run.states} /></>}
            {run.cancelled && <div className="text-sm text-muted" style={{ marginTop: 6 }}>Cancelled.</div>}
            {run.done && <div style={{ marginTop: 8, color: failed ? C.bad : C.ok, fontSize: 13 }}>{failed ? failed + ' step(s) failed' : 'Pipeline complete →  ready to assemble / Export'}</div>}
            {run.error && <div className="text-sm" style={{ color: C.bad, marginTop: 6 }}>Error: {run.error}</div>}
        </>
    );
}

export default function PipelinePage() {
    const [shots, setShots] = useState(null);       // null: not loaded
    const [ready, setReady] = useState({});         // shot_id -> readiness
    const [audit, setAudit] = useState(null);
    const [providers, setProviders] = useState(null);
    const [shotId, setShotId] = useState('');
    const [strict, setStrict] = useState(false);
    const [run, setRun] = useState(null);

    async function loadPipeline() {
        if (!legacy.state.currentProject) return;
        const pid = legacy.state.currentProject.id;
        legacy.setStatus('Loading pipeline...');
        try {
            // Load recent renders across all shots + consistency readiness.
            const [sbData, auditD] = await Promise.all([
                legacy.api('/projects/' + pid + '/status-board'),
                legacy.api('/projects/' + pid + '/consistency/audit').catch(() => ({ ready: true, shots: [] })),
            ]);
            const all = [];
            (sbData.scenes || []).forEach(s => (s.shots || []).forEach(sh => all.push({ ...sh, scene_number: s.scene_number, scene_id: s.id })));
            const byShot = {};
            (auditD.shots || []).forEach(s => { byShot[s.shot_id] = s; });
            setShots(all); setReady(byShot); setAudit(auditD);
            setShotId(id => (all.some(s => s.id === id) ? id : (all[0]?.id || '')));
            // The providers each step will use (per-project config).
            try { setProviders((await legacy.api('/projects/' + pid + '/providers')).effective || {}); } catch { /* the line stays empty */ }
            legacy.setStatus(all.length + ' shot(s) in pipeline');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadPipeline', loadPipeline);

    const selected = (shots || []).find(s => s.id === shotId);
    const labelOf = (s) => {
        const r = ready[s.id];
        return (r && r.ready === false ? '⚠ ' : '') + `Sc${s.scene_number} / ${s.shot_code}`;
    };

    function runPipelineLive() {
        if (!shotId || !selected) { legacy.setStatus('Pick a shot first'); return; }
        const label = labelOf(selected);
        // Pre-flight: instant feedback if strict mode will block this shot (the backend re-checks).
        if (strict && ready[shotId] && ready[shotId].ready === false) {
            setRun({ blocked: true });
            legacy.setStatus('Blocked by strict consistency');
            return;
        }
        let steps = [];
        const states = {};
        const draw = (patch = {}) => setRun(r => ({ ...(r && !r.blocked ? r : {}), label, steps, states: { ...states }, ...patch }));
        setRun({ label, steps: [], states: {} });
        legacy.streamSSEPost('/shots/' + shotId + '/pipeline/run/stream', { strict },
            (ev) => {
                if (ev.type === 'readiness') {
                    const bad = [...(ev.missing || []), ...(ev.warnings || [])];
                    if (!ev.ready || bad.length) draw({ warning: { ready: !!ev.ready, lines: bad } });
                } else if (ev.type === 'status' && Array.isArray(ev.steps)) {
                    steps = ev.steps;
                    steps.forEach(st => { states[st.id] = 'pending'; });
                    draw();
                } else if (ev.type === 'step_start') { states[ev.step_id] = 'running'; draw(); }
                else if (ev.type === 'step_complete') { states[ev.step_id] = 'complete'; draw(); }
                else if (ev.type === 'step_failed') { states[ev.step_id] = 'failed'; draw(); }
                else if (ev.type === 'cancelled') draw({ cancelled: true });
            },
            () => { draw({ done: true }); legacy.setStatus('Pipeline finished'); loadPipeline(); },
            (err) => draw({ error: err ? err.message : 'stream failed' }),
        );
    }

    async function runPipelineScope(scope) {
        const body = JSON.stringify({ strict });
        try {
            if (scope === 'scene') {
                const sceneId = selected && selected.scene_id;
                if (!sceneId) { legacy.setStatus('Pick a shot to identify its scene'); return; }
                legacy.setStatus('Running scene pipeline…');
                await legacy.api('/scenes/' + sceneId + '/pipeline/run', { method: 'POST', body });
            } else {
                legacy.setStatus('Running project pipeline…');
                await legacy.api('/projects/' + legacy.state.currentProject.id + '/pipeline/run', { method: 'POST', body });
            }
            legacy.setStatus(scope + ' pipeline complete');
            loadPipeline();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    const active = (shots || []).filter(s => s.status === 'generating');
    const others = (shots || []).filter(s => s.status !== 'generating');
    const p = providers;

    return (
        <div className="page" id="page-pipeline">
            <div className="flex-between mb-16">
                <h2>Pipeline</h2>
                <button className="btn btn-secondary" onClick={() => loadPipeline()}>Refresh</button>
            </div>
            <div className="card mb-16">
                <h3 className="mb-8">Run scene → final</h3>
                <p className="text-sm text-muted mb-8" id="pipelineProviders">{p && <>
                    Providers → LLM: <strong>{p.llm || 'gridlight'}</strong>, image: <strong>{p.image || 'gridlight'}</strong>, video: <strong>{p.video || 'gridlight'}</strong>,
                    {' '}voice: <strong>{p.voice || 'gridlight'}</strong>, music: <strong>{p.music || 'gridlight'}</strong>
                    {' · '}<a style={{ cursor: 'pointer', color: 'var(--gl-accent,#818cf8)' }} onClick={() => legacy.navigateTo('settings')}>change</a>
                </>}</p>
                <div id="pipelineReadiness" className="mb-8"><Readiness audit={audit} /></div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select id="pipelineShotSelect" style={{ minWidth: 240 }} value={shotId} onChange={e => setShotId(e.target.value)}>
                        {shots && shots.length === 0 && <option value="">No shots — create shots first</option>}
                        {(shots || []).map(s => (
                            <option key={s.id} value={s.id} data-scene={s.scene_id || ''} data-ready={ready[s.id] ? (ready[s.id].ready ? '1' : '0') : ''}>{labelOf(s)}</option>
                        ))}
                    </select>
                    <button className="btn btn-primary" onClick={runPipelineLive}>Run shot (live)</button>
                    <button className="btn btn-secondary" onClick={() => runPipelineScope('scene')}>Run scene</button>
                    <button className="btn btn-secondary" onClick={() => runPipelineScope('project')}>Run project</button>
                    <label className="text-sm" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Refuse to run any shot whose in-frame subjects are not locked for consistency">
                        <input type="checkbox" id="pipelineStrict" checked={strict} onChange={e => setStrict(e.target.checked)} /> Strict consistency
                    </label>
                </div>
                <div id="pipelineLive" style={{ marginTop: 14 }}><Live run={run} /></div>
            </div>
            <div id="pipelineActive" className="mb-16">
                {shots && active.length === 0 && <div className="card"><p className="text-sm text-muted">No active pipeline runs.</p></div>}
                {active.length > 0 && <>
                    <h3 className="mb-8">Active Runs</h3>
                    {active.map(s => (
                        <div className="card mb-8" key={s.id}>
                            <div className="flex-between"><strong>Sc{s.scene_number} / {s.shot_code}</strong><span className="badge">generating</span></div>
                            <div style={{ background: 'var(--gl-border-subtle)', borderRadius: 4, height: 4, marginTop: 8 }}>
                                <div style={{ background: 'var(--gl-brand-pink)', height: '100%', width: '50%', borderRadius: 4 }} />
                            </div>
                        </div>
                    ))}
                </>}
            </div>
            <h3 className="mb-8">Recent Runs</h3>
            <div id="pipelineHistory">
                {shots && others.length === 0 && <p className="text-sm text-muted">No pipeline history yet.</p>}
                {others.length > 0 && (
                    <table className="render-table"><tbody>
                        <tr><th>Shot</th><th>Scene</th><th>Status</th><th>Duration</th></tr>
                        {others.map(s => (
                            <tr key={s.id}>
                                <td>{s.shot_code}</td>
                                <td>Sc{s.scene_number}</td>
                                <td><span className={'badge ' + (s.status === 'approved' ? 'approved' : '')}>{s.status}</span></td>
                                <td>{s.duration_ms ? (s.duration_ms / 1000).toFixed(1) + 's' : '-'}</td>
                            </tr>
                        ))}
                    </tbody></table>
                )}
            </div>
        </div>
    );
}
