import { legacy } from '../../lib/legacy.js';

/*
 * The film estimate: counted from the project (subjects × their views, one frame per shot, the footage's
 * own length) and priced through the same meters that bill a real generation, so changing the resolution
 * or a generator shows exactly the difference it would make. The choices are `params`, sent as the query;
 * the server owns every number. Free: nothing is generated.
 */

/** The query a set of choices becomes: empty choices are left out, so the server uses the project's own. */
export function estimateQuery(params) {
    return Object.entries(params).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}

/** One choice → the params it sets. A generator choice is "provider|model" and sets both. */
export function applyChoice(params, key, value) {
    if (key === 'image' || key === 'video' || key === 'upscale') {
        const [provider, model] = String(value || '').split('|');
        return { ...params, [key + '_provider']: provider || '', [key + '_model']: model || '' };
    }
    return { ...params, [key]: value };
}

export default function FilmEstimateTab({ data, error, params, onChoose, onReset }) {
    return (
        <>
            <p className="text-sm text-muted mb-16">What the plates, the storyboard and the footage of this film will cost, counted from the project and priced on the generator
                each would use, at the project's resolution. Change the resolution or a generator to see the difference. Free: nothing is generated.</p>
            <div id="prodEstControls" className="mb-16">{data && <Controls key={JSON.stringify(params)} d={data} params={params} onChoose={onChoose} onReset={onReset} />}</div>
            <div id="prodEstResult">
                {!data && !error && <p className="text-sm text-muted">Counting and pricing…</p>}
                {error && <p className="text-sm">Could not estimate: {error}</p>}
                {data && !error && <Result d={data} onChoose={onChoose} />}
            </div>
        </>
    );
}

function Controls({ d, params, onChoose, onReset }) {
    const usd = legacy.usd;
    const g = d.generators || {};
    const c = d.counts || {};
    const options = (cap) => {
        const cur = g[cap] || {};
        const curKey = (cur.provider || '') + '|' + (cur.model || '');
        const seen = new Set();
        const out = [];
        const add = (key, label) => { if (!seen.has(key)) { seen.add(key); out.push({ key, label }); } };
        add(curKey, `${cur.provider_label || cur.provider || 'none'} · ${cur.model || 'its default model'}`);
        for (const a of ((d.alternatives || {})[cap] || [])) add(a.provider + '|' + (a.model || ''), `${a.provider_label} · ${a.model || 'default'} — ${usd(a.usd)}`);
        return { current: curKey, out };
    };
    const select = (cap, label) => {
        const o = options(cap);
        return (
            <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 240 }}><span className="text-muted">{label}</span>
                <select data-choice={cap} value={o.current} onChange={(e) => onChoose(cap, e.target.value)}>{o.out.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
            </label>
        );
    };
    const num = (key, label, val, help, step = 1) => (
        <label key={key} className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="text-muted">{label}</span>
            <input type="number" data-choice={key} min="0" step={step} defaultValue={String(val)} style={{ width: 90 }} title={help || ''}
                // Committed on blur or Enter, as the legacy input's change event was: one request per edit, not per keystroke.
                onBlur={(e) => { if (e.target.value !== String(val)) onChoose(key, e.target.value); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
    );
    const post = (d.alternatives || {}).post || [];
    const upscaleCurrent = (post.find(a => a.current) || {});
    return (
        <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
            <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="text-muted">Resolution</span>
                <select data-choice="resolution" value={d.resolution.id} onChange={(e) => onChoose('resolution', e.target.value)}>
                    {(d.resolutions || []).map(r => <option key={r.id} value={r.id}>{r.label}{d.project_resolution && r.id === d.resolution.id && !params.resolution ? ' (project)' : ''}</option>)}
                </select></label>
            {select('image', 'Plates and storyboard')}
            {select('video', 'Footage')}
            <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 240 }}><span className="text-muted">Upscale footage to {d.resolution.label}</span>
                <select data-choice="upscale" value={upscaleCurrent.provider ? upscaleCurrent.provider + '|' + (upscaleCurrent.model || '') : '|'} onChange={(e) => onChoose('upscale', e.target.value)}>
                    <option value="|">No upscale{d.upscale_needed ? ' (footage is made smaller)' : ''}</option>
                    {post.map(a => <option key={a.provider + '|' + (a.model || '')} value={a.provider + '|' + (a.model || '')}>{a.provider_label} · {a.model || 'default'} — {usd(a.usd)}{a.needs_key ? ' (no key)' : ''}</option>)}
                </select></label>
            {num('character_views', 'Views per character', c.views ? c.views.character : 4, 'front, two profiles, back')}
            {num('location_views', 'Views per location', c.views ? c.views.location : 4)}
            {num('prop_views', 'Views per prop', c.views ? c.views.prop : 1)}
            {num('takes_plates', 'Attempts per plate', d.takes.plates, 'usually 3-4, sometimes 6', 0.5)}
            {num('takes_storyboard', 'Attempts per frame', d.takes.storyboard, 'usually 3-4, sometimes 6', 0.5)}
            {num('takes_footage', 'Attempts per clip', d.takes.footage, 'usually 2-3', 0.5)}
            {!c.shots && num('shot_seconds', 'Average shot (s)', c.shot_seconds)}
            {num('runtime_seconds', 'Running time (s)', d.runtime ? Math.round(d.runtime.seconds) : 0, 'leave as measured, or type the length you expect')}
            <button className="btn btn-secondary" onClick={onReset}>Back to the project's choices</button>
        </div>
    );
}

function Result({ d, onChoose }) {
    const usd = legacy.usd;
    const t = d.totals || {}, g = d.generators || {}, c = d.counts || {};
    const plates = (d.lines || []).filter(l => l.category === 'plates');
    const board = (d.lines || []).find(l => l.category === 'storyboard') || {};
    const foot = (d.lines || []).find(l => l.category === 'footage') || {};
    const plateCount = plates.reduce((n, l) => n + l.count, 0);
    const names = { character: 'Character plates', location: 'Location plates', prop: 'Prop plates' };
    const card = (label, v, sub) => (
        <div className="card" style={{ flex: 1, minWidth: 160 }}>
            <div className="text-sm text-muted">{label}</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{usd(v)}</div>
            <div className="text-sm text-muted">{sub}</div>
        </div>
    );
    const row = (key, what, n, size, model, unit, total) => (
        <tr key={key}><td>{what}</td><td>{n}</td><td>{size || ''}</td><td>{model || ''}</td><td>{unit}</td><td style={{ textAlign: 'right' }}>{usd(total)}</td></tr>
    );
    const alt = (cap) => {
        const rows = ((d.alternatives || {})[cap] || []).slice(0, 14);
        if (!rows.length) return <p className="text-sm text-muted">No other connected generator can price this.</p>;
        return (
            <table className="render-table" style={{ width: '100%' }}><tbody>
                {rows.map(a => (
                    <tr key={a.provider + '|' + (a.model || '')} style={a.current ? { fontWeight: 600 } : undefined}>
                        <td>{a.provider_label} · {a.model || 'default'}{a.current ? ' (selected)' : ''}
                            {a.needs_key && <> <span className="badge" title="No API key for this account yet: priced so you can compare, but it cannot run until one is added in Setup">no key</span></>}
                            {a.connected === false && <> <span className="badge" title={a.not_connected_why || ''}>not connected</span></>}
                            {a.inferred && <> <span className="badge" title="Worked out from the vendor plan prices, not a published per-item rate">estimated</span></>}
                            {a.delivers_less && <> <span className="badge" style={{ background: 'var(--gl-warning)', color: '#111' }} title={`Cannot deliver ${d.resolution.label}`}>{cap === 'video' ? 'makes ' + a.delivers_less : 'smaller than asked'}</span></>}
                        </td>
                        <td style={{ textAlign: 'right' }}>{usd(a.usd)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} className="text-muted">film {usd(a.total)}</td>
                        <td>{!a.current && a.connected !== false && <button className="btn btn-secondary btn-sm" onClick={() => onChoose(cap, a.provider + '|' + (a.model || ''))}>Use</button>}</td>
                    </tr>
                ))}
            </tbody></table>
        );
    };
    const rt = d.runtime;
    return (
        <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }} className="mb-16">
                {card('The film', t.total, <>{d.resolution.label} · {c.frames} shots · {Math.round(c.footage_seconds)}s of footage
                    {d.range && <><br />{usd(d.range.low.total)} – {usd(d.range.high.total)} at {d.attempts.image.low}–{d.attempts.image.high} attempts per picture, {d.attempts.footage.low}–{d.attempts.footage.high} per clip
                        <br />first attempts only: {usd(d.range.first_attempt.total)}</>}</>)}
                {card('Plates', t.plates, `${plateCount} pictures on ${(g.image && g.image.provider_label) || '?'}`)}
                {card('Storyboard', t.storyboard, `${board.count || 0} frames`)}
                {d.upscale && card('Upscale', t.upscale || 0, d.upscale.usd == null ? (d.upscale.why || 'not priced')
                    : `${Math.round(d.upscale.seconds)}s from ${d.upscale.from} to ${d.upscale.to} on ${d.upscale.provider_label}`)}
                {card('Footage', t.footage, `${Math.round(foot.seconds || 0)}s on ${(g.video && g.video.provider_label) || '?'}${foot.per_second_usd ? ' · ' + usd(foot.per_second_usd) + '/s' : ''}`)}
            </div>
            <div className="card mb-16"><table className="render-table" style={{ width: '100%' }}>
                <thead><tr><th>What</th><th>Count</th><th>Size</th><th>Model</th><th>Each</th><th style={{ textAlign: 'right' }}>Cost</th></tr></thead>
                <tbody>
                    {plates.map(l => row(l.kind, <>{names[l.kind]} <span className="text-muted">({l.subjects} × {l.views} view{l.views === 1 ? '' : 's'}{l.takes !== 1 ? ' × ' + l.takes + ' attempts' : ''})</span></>,
                        l.count, l.size, l.model, l.unit_usd == null ? (l.why || 'not priced') : usd(l.unit_usd), l.usd))}
                    {row('board', <>Storyboard frames{board.takes !== 1 && <span className="text-muted"> (× {board.takes} attempts)</span>}</>, board.count || 0, board.size, board.model,
                        board.unit_usd == null ? (board.why || 'not priced') : usd(board.unit_usd), board.usd)}
                    {row('footage', <>Footage <span className="text-muted">({Math.round(foot.seconds || 0)}s{foot.takes !== 1 ? ' × ' + foot.takes + ' attempts' : ''})</span></>, foot.count || 0,
                        foot.downgraded ? foot.delivered + ' (asked ' + foot.size + ')' : (foot.resolution_tier || foot.size), foot.model, foot.per_second_usd ? usd(foot.per_second_usd) + '/s' : '', foot.usd)}
                    {d.upscale && d.upscale.usd != null && row('upscale', <>Upscale <span className="text-muted">(once)</span></>, foot.count || 0, d.upscale.from + ' → ' + d.upscale.to, d.upscale.model, '', d.upscale.usd)}
                </tbody>
            </table></div>
            <p className="text-sm text-muted mb-16">Running time: {rt ? `${Math.round(rt.seconds)}s, from ${rt.source}${rt.range ? ` (likely; ${rt.range[0]}–${rt.range[1]}s)` : ''}` : 'unknown'}. Shots: {c.shot_source || ''}.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }} className="mb-16">
                <div className="card" style={{ flex: 1, minWidth: 300 }}><h3 className="mb-8">Plates and storyboard on other generators</h3>{alt('image')}</div>
                <div className="card" style={{ flex: 1, minWidth: 300 }}><h3 className="mb-8">Footage on other generators</h3>{alt('video')}</div>
            </div>
            {(d.notes || []).map((n, i) => <p key={i} className="text-sm text-muted">{n}</p>)}
        </>
    );
}
