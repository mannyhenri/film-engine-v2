import { useCallback, useEffect, useRef, useState } from 'react';
import { legacy } from '../../../lib/legacy.js';

/*
 * Direct › Generate › "My PC": make the shot on the ComfyUI PC (backend lib/comfyui.js, lib/comfyui-shot.js).
 * Plain choices only: the workflow's own options as big buttons, what goes in as a short list, then takes.
 * Node ids and slots stay on the server; the workflow's manifest says which options exist.
 */

// "16:9 (864x480)" -> ["16:9", "864x480"]: the part people pick by, and the detail under it.
export const splitLabel = s => { const m = /^(.*?)\s*\((.+)\)\s*$/.exec(String(s)); return m ? [m[1], m[2]] : [String(s), '']; };
const labelOf = c => (typeof c === 'object' ? c.label : c);
// "about 55 min left": the time a take still needs, from the PC's own step timing.
export const timeLeft = s => (!Number.isFinite(s) ? '' : s < 90 ? 'under 2 min left' : s < 5400 ? `about ${Math.round(s / 60)} min left` : `about ${(s / 3600).toFixed(1)} h left`);
/** What a running take says under its picture. */
export function stageText(j) {
    if (j.status === 'failed') return 'Failed';
    if (j.status === 'running' && j.progress) return `Step ${j.progress.value} of ${j.progress.max}${j.progress.eta_s != null ? ' · ' + timeLeft(j.progress.eta_s) : ''}`;
    if (j.status === 'queued' && j.position > 1) return `${j.stage_label} · ${j.position - 1} ahead`;
    return j.stage_label;
}
const secondsIn = s => { const m = /^(\d+(?:\.\d+)?)\s*s$/.exec(String(s).trim()); return m ? Number(m[1]) : null; };

/**
 * The starting choice for each option: the workflow's own draft preset (its manifest's "draft"), else the option's
 * default. A draft is short on purpose (the PC's 5 s turbo draft already takes about half an hour); when that is
 * shorter than the shot, the Length hint says so, and a longer length is one click away.
 */
export function defaultChoices(options, draft) {
    const out = {};
    for (const o of options || []) {
        if (o.type !== 'enum') continue;
        const labels = (o.choices || []).map(labelOf);
        const want = draft && draft[o.id] !== undefined ? draft[o.id] : o.default;
        out[o.id] = labels[typeof want === 'number' ? want : Math.max(0, labels.indexOf(want))] ?? labels[0];
    }
    return out;
}

function lengthHint(choice, dur) {
    const n = secondsIn(choice);
    if (n === null || !dur || Math.abs(n - dur) < 0.05) return '';
    return n < dur ? `The shot is ${dur} s, so the last ${+(dur - n).toFixed(1)} s will be missing.` : `The shot is ${dur} s. Trim the extra in Cut.`;
}

export default function ComfyPanel({ pid, unit, codeLabel, dur, names, hasFrame, lineCount, dialogueName, onFiled, onUseHiggsfield }) {
    const [status, setStatus] = useState(null);
    const [workflows, setWorkflows] = useState(null);
    const [slug, setSlug] = useState('');
    const [choices, setChoices] = useState({});
    const [takes, setTakes] = useState(2);
    const [noDialogue, setNoDialogue] = useState(false);
    const [run, setRun] = useState(null);       // { jobs, note, error }
    const [busy, setBusy] = useState(false);
    const filedOnce = useRef(new Set());

    const check = useCallback(async () => {
        setStatus(null);
        try {
            const st = await legacy.api('/comfyui/status', { refresh: false });
            setStatus(st);
            if (!st.ok) return;
            const wf = await legacy.api('/comfyui/workflows', { refresh: false });
            const list = (wf.workflows || []).filter(w => w.kind === 'video');
            setWorkflows(list);
            setSlug(s => (list.some(w => w.slug === s) ? s : (list.find(w => w.ready) || list[0])?.slug || ''));
        } catch (err) { setStatus({ ok: false, error: err.message }); }
    }, []);
    useEffect(() => { check(); }, [check]);

    const wf = (workflows || []).find(w => w.slug === slug) || null;
    useEffect(() => { if (wf) setChoices(defaultChoices(wf.options, wf.draft)); }, [slug, workflows]); // eslint-disable-line react-hooks/exhaustive-deps

    // Follow the takes until each is back (or failed); a filed take reloads Direct so it plays in the preview.
    const live = run && (run.jobs || []).some(j => !['done', 'failed'].includes(j.status));
    useEffect(() => {
        if (!live) return undefined;
        const t = setInterval(async () => {
            const jobs = await Promise.all(run.jobs.map(j => (['done', 'failed'].includes(j.status) ? j
                : legacy.api(`/comfyui/jobs/${j.id}`, { refresh: false }).then(r => r.job).catch(() => j))));
            setRun(r => ({ ...r, jobs }));
            if (jobs.some(j => j.status === 'done' && !filedOnce.current.has(j.id))) {
                jobs.forEach(j => j.status === 'done' && filedOnce.current.add(j.id));
                onFiled && onFiled();
            }
        }, 2000);
        return () => clearInterval(t);
    }, [live, run]); // eslint-disable-line react-hooks/exhaustive-deps

    const make = async () => {
        setBusy(true);
        try {
            const out = await legacy.api(`/projects/${pid}/production-studio/comfyui`, { method: 'POST', refresh: false,
                body: JSON.stringify({ ...unit(), workflow: slug, options: choices, takes, no_dialogue: noDialogue }) });
            setRun({ jobs: out.jobs, note: out.note });
        } catch (err) { setRun({ jobs: [], error: err.message }); }
        finally { setBusy(false); }
    };
    const stop = () => Promise.all((run?.jobs || []).filter(j => !['done', 'failed'].includes(j.status))
        .map(j => legacy.api(`/comfyui/jobs/${j.id}/cancel`, { method: 'POST', refresh: false }).catch(() => {})));

    const quality = Object.entries(choices).find(([id]) => /quality/i.test(id))?.[1] || '';
    const draft = /draft|turbo/i.test(quality);
    const cta = `Make ${takes} ${draft ? 'draft' : 'take'}${takes > 1 ? 's' : ''}`;

    /* ---------- the PC isn't there ---------- */
    if (!status) return <div className="cf"><p className="ds-muted">Looking for your PC…</p></div>;
    if (!status.ok) return (
        <div className="cf">
            <div className="cf-card warn">
                <b>Your PC isn't answering</b>
                <p>Check that it's on and ComfyUI is open, listening on the network. {status.url ? <span className="ds-mono">{status.url}</span> : null}</p>
                <div className="cf-row"><button type="button" className="ds-btn sm" onClick={check}>Try again</button>
                    {onUseHiggsfield && <button type="button" className="ds-btn sm ghost" onClick={onUseHiggsfield}>Use Higgsfield instead</button>}</div>
            </div>
        </div>
    );
    if (workflows && !workflows.length) return (
        <div className="cf"><div className="cf-card">
            <b>No video workflows on your PC yet</b>
            <p>Save a workflow and its .fe.json in ComfyUI's <span className="ds-mono">workflows/film-engine</span> folder, then check again.</p>
            <button type="button" className="ds-btn sm" onClick={check}>Check again</button>
        </div></div>
    );

    /* ---------- takes running or back ---------- */
    if (run && !run.error) {
        const done = run.jobs.filter(j => j.status === 'done').length;
        return (
            <div className="cf">
                <div className="cf-head"><h3>{live ? `Making ${run.jobs.length} ${draft ? 'draft' : 'take'}${run.jobs.length > 1 ? 's' : ''}` : `${done} of ${run.jobs.length} back`}</h3><span className="ds-muted">on your PC</span></div>
                {run.note && <div className="cf-card warn"><p>{run.note}</p></div>}
                {run.jobs.map((j, i) => (
                    <div key={j.id} className="cf-take">
                        {j.status === 'done' && j.filed?.url
                            ? <video className="cf-video" src={j.filed.url} controls preload="metadata" />
                            : <div className="cf-video ph"><span>{stageText(j)}</span></div>}
                        <div className="cf-row between">
                            <b>{j.label || `Take ${i + 1}`}</b>
                            <span className={'cf-state ' + j.status}>{j.status === 'done' ? `Added to ${codeLabel} as version ${j.filed?.version ?? ''}` : j.status === 'failed' ? 'Failed' : `${Math.floor((j.elapsed_s || 0) / 60)}:${String((j.elapsed_s || 0) % 60).padStart(2, '0')} so far`}</span>
                        </div>
                        {j.status === 'failed' && <p className="cf-err">{j.error}</p>}
                    </div>
                ))}
                {live
                    ? <><p className="ds-muted">You can keep directing. Takes land on {codeLabel} and show up in Cut.</p>
                        <button type="button" className="ds-btn" onClick={stop}>Stop</button></>
                    : <button type="button" className="ds-btn pri big" onClick={() => setRun(null)}>Make more</button>}
            </div>
        );
    }

    /* ---------- ready ---------- */
    const hasDialogue = lineCount > 0 || !!dialogueName;
    return (
        <div className="cf">
            <section className="cf-sec">
                <h4>What goes in</h4>
                <ul className="cf-list">
                    <li className={hasFrame ? 'ok' : 'warn'}>{hasFrame ? `Starts from the storyboard frame of ${codeLabel}` : `No storyboard frame for ${codeLabel}: it starts from the references only`}</li>
                    {names.length > 0 && <li className="ok">{names.join(', ')}</li>}
                    {hasDialogue && !noDialogue && <li className="ok">Dialogue: {dialogueName || `${lineCount} line${lineCount === 1 ? '' : 's'}`}, spoken and lip-synced</li>}
                </ul>
                {!hasDialogue && <div className="cf-card"><b>No dialogue for {codeLabel}</b><p>The video is made without speech. Choose a recording under Optimize to add it.</p></div>}
                {hasDialogue && <label className="cf-check"><input type="checkbox" checked={noDialogue} onChange={e => setNoDialogue(e.target.checked)} /> Make it without dialogue</label>}
            </section>

            {(workflows || []).length > 1 && <label className="cf-sec"><h4>Workflow</h4>
                <select className="ds-in" value={slug} onChange={e => setSlug(e.target.value)}>{workflows.map(w => <option key={w.slug} value={w.slug} disabled={!w.ready}>{w.name}{w.ready ? '' : ' (not ready)'}</option>)}</select></label>}
            {wf && !wf.ready && <div className="cf-card warn"><b>This workflow doesn't match its settings file</b><p>{wf.problems.join('; ')}</p></div>}

            {(wf?.options || []).filter(o => o.type === 'enum').map(o => {
                const labels = (o.choices || []).map(labelOf);
                const hint = /duration|length/i.test(o.id + o.label) ? lengthHint(choices[o.id], dur) : '';
                return (
                    <section key={o.id} className="cf-sec">
                        <h4>{o.label}</h4>
                        <div className="cf-pills" role="group" aria-label={o.label} style={{ gridTemplateColumns: `repeat(${Math.min(labels.length, 4)}, minmax(0, 1fr))` }}>
                            {labels.map(l => { const [main, sub] = splitLabel(l); const on = choices[o.id] === l;
                                return <button key={l} type="button" className={'cf-pill' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setChoices(c => ({ ...c, [o.id]: l }))}>{main}{sub && <small>{sub}</small>}</button>; })}
                        </div>
                        {hint && <p className="ds-muted">{hint}</p>}
                    </section>
                );
            })}

            {run?.error && <div className="cf-card warn"><b>Not sent</b><p>{run.error}</p></div>}
            <div className="cf-go">
                <div className="cf-step" role="group" aria-label="How many takes">
                    <button type="button" aria-label="Fewer takes" onClick={() => setTakes(n => Math.max(1, n - 1))}>−</button>
                    <b>{takes}</b>
                    <button type="button" aria-label="More takes" onClick={() => setTakes(n => Math.min(4, n + 1))}>+</button>
                </div>
                <button type="button" className="ds-btn pri big" disabled={busy || !wf?.ready} onClick={make}>{busy ? 'Sending…' : cta}</button>
            </div>
            <p className="ds-muted cf-center">Free · made on your PC · comes back to {codeLabel}</p>
        </div>
    );
}
