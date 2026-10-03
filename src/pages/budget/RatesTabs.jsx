import { legacy } from '../../lib/legacy.js';
import { capColor, qty } from './format.jsx';

/*
 * WHICH GENERATOR SHOULD I USE. Every row priced for the same unit of real work (a frame, a clip) and for a
 * scene of them, since a few cents an image is invisible until multiplied by a board. Cost sits beside the
 * tier's stated PURPOSE: cheapest is not best when a draft model exists to be rolled repeatedly.
 * `r` is GET /spend/compare.
 */
export function CompareTab({ capability, clipSeconds, r, error, onCapability, onClipSeconds }) {
    const usd = (n) => legacy.usd(n); // read when there is a row to price, never during the static render
    const cheapest = r ? r.rows.find(x => x.available && !x.self_hosted) : null;
    return (
        <>
            <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="tab-bar" id="compareCapTabs">
                    {[['image', 'Images'], ['video', 'Video']].map(([cap, label]) => (
                        <button key={cap} className={'tab-btn' + (capability === cap ? ' active' : '')} data-cap={cap} onClick={() => onCapability(cap)}>{label}</button>
                    ))}
                </div>
                <div id="compareClipWrap" style={{ display: capability === 'video' ? 'flex' : 'none', alignItems: 'center', gap: 6 }}>
                    <label className="text-sm text-muted" htmlFor="compareClipSeconds">Clip length</label>
                    <input id="compareClipSeconds" type="number" min="1" max="60" step="1" defaultValue={clipSeconds} style={{ width: 64 }}
                        onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n !== clipSeconds) onClipSeconds(n); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                    <span className="text-sm text-muted">s</span>
                </div>
            </div>
            <div id="generatorCompare">
                {!r && !error && <p className="text-sm text-muted">Reading the rate book…</p>}
                {error && <p className="text-sm">Could not read the rate book: {error}</p>}
                {r && !error && <>
                    <div className="card"><table className="render-table" style={{ width: '100%' }}>
                        <thead><tr>
                            <th className="text-sm" style={{ textAlign: 'left' }}>Generator</th><th className="text-sm" style={{ textAlign: 'left' }}>For</th>
                            <th className="text-sm" style={{ textAlign: 'right' }}>Rate</th><th className="text-sm" style={{ textAlign: 'right' }}>{r.work.work_label}</th>
                            <th className="text-sm" style={{ textAlign: 'right' }}>{r.work.scene_label}</th><th className="text-sm" style={{ textAlign: 'right' }}>Checked</th>
                        </tr></thead>
                        <tbody>{r.rows.map((x, i) => (
                            <tr key={x.provider + '|' + x.model + i} style={x.available ? undefined : { opacity: 0.55 }}>
                                <td className="text-sm"><strong>{x.provider_label}</strong><div className="text-sm text-muted">{x.model}</div></td>
                                <td className="text-sm">
                                    {x.tier && <span className="badge" title={x.tier.why || ''}>{x.tier.label}</span>}
                                    {x.honours_resolution === false && <span className="badge" style={{ background: 'var(--gl-warning)' }} title={x.size_note || ''}>ignores your resolution</span>}
                                    {x.max_size && <span className="badge" title="The largest output this MODEL offers — not the provider's best">max {x.max_size}</span>}
                                    {x.inferred && <span className="badge" title="Not published by the provider — inferred, and may be wrong">inferred</span>}
                                    {x.self_hosted && <span className="badge" title="No per-call charge. Zero because nobody bills for it, not because it is cheap.">self-hosted</span>}
                                    {!x.available && <span className="badge" style={{ background: 'var(--gl-warning)' }} title={x.needs || ''}>{x.connected === false ? 'not connected' : 'no key'}</span>}
                                </td>
                                <td className="text-sm text-muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    {usd(x.usd_per_unit)}<span className="text-muted">/{x.unit}</span>
                                    {x.units_per_work !== 1 && <div className="text-sm text-muted">× {x.units_per_work.toFixed(2)}</div>}
                                </td>
                                <td className="text-sm" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><strong>{usd(x.usd_per_work)}</strong>{x === cheapest && <> <span className="badge">cheapest</span></>}</td>
                                <td className="text-sm text-muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{usd(x.usd_per_scene)}</td>
                                <td className="text-sm text-muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    {x.source && <a href={x.source} target="_blank" rel="noopener noreferrer">source</a>}
                                    <div className="text-sm text-muted">{x.checked || ''}{x.checked_age_days !== null && x.checked_age_days > 90 &&
                                        <> <span className="badge" style={{ background: 'var(--gl-warning)' }} title="Nobody has re-verified this rate in over 90 days">stale</span></>}</div>
                                </td>
                            </tr>
                        ))}</tbody>
                    </table></div>
                    {r.unpriced && r.unpriced.length > 0 && (
                        <div className="card mb-8" style={{ borderColor: 'var(--gl-warning)' }}>
                            <strong className="text-sm">Not priced</strong>
                            {r.unpriced.map((u, i) => <p key={i} className="text-sm">{u.provider} — {u.why}</p>)}
                        </div>
                    )}
                    <p className="text-sm text-muted" style={{ marginTop: 8 }}>{r.note}</p>
                    <p className="text-sm text-muted">A tier badge says what a model is FOR. Cheapest is not best: a draft model is meant to be rolled repeatedly, a precision one to be right once.</p>
                    <p className="text-sm text-muted">&ldquo;Ignores your resolution&rdquo; means the provider has no width or height field &mdash; a requested size can only become an aspect ratio and the
                        provider picks the pixels. Your project&rsquo;s delivery size reaches it in name only, and that applies to storyboard frames as much as to plates.</p>
                </>}
            </div>
        </>
    );
}

/** Six decimals, trailing zeros gone: $0.000003 stays readable, $0.050000 reads $0.05. */
export const fine = (n, places = 6) => '$' + (Number(n) || 0).toFixed(places).replace(/0+$/, '').replace(/\.$/, '');

/** Where every number comes from: each rate with its source and the date it was checked. `rates` is GET /spend/rates. */
export function RatesTab({ rates }) {
    return (
        <>
            <p className="text-sm text-muted mb-16">Published provider rates, with the source and the date each was checked. A rate you override applies to calls made from now on — past events
                keep the rate they were priced at, so a correction never rewrites history.</p>
            <div id="spendRates">
                {(rates || []).map((rate, i) => (
                    <div key={rate.provider + rate.capability + i} className="card mb-8">
                        <div className="flex-between">
                            <div>
                                <strong>{rate.provider}</strong>
                                <span className="badge" style={{ background: capColor(rate.capability) + '22', marginLeft: 6 }}>{rate.capability}</span>
                                {rate.self_hosted && <span className="badge" style={{ marginLeft: 6 }}>self-hosted · no per-call charge</span>}
                                {rate.overridden && <span className="badge" style={{ marginLeft: 6, background: 'var(--gl-warning)' }}>overridden</span>}
                            </div>
                            <div className="text-sm text-muted">checked {rate.checked}</div>
                        </div>
                        <p className="text-sm" style={{ margin: '6px 0' }}>
                            Metered per <strong>{rate.unit}</strong>
                            {rate.native_unit !== rate.unit && <> · billed as <strong>{qty(rate.native_per_unit)} {rate.native_unit}(s)</strong> per {rate.unit}</>}
                            {rate.components
                                ? ` · $${(rate.components.input * 1e6).toFixed(2)}/M in, $${(rate.components.output * 1e6).toFixed(2)}/M out`
                                : ` · ${fine(rate.usd_per_unit)} per ${rate.unit}`}
                        </p>
                        {rate.note && <p className="text-sm text-muted">{rate.note}</p>}
                        {rate.models && rate.models.length > 0 && (
                            <details style={{ marginTop: 6 }}>
                                <summary className="text-sm text-muted" style={{ cursor: 'pointer' }}>{rate.models.length} model rate(s)</summary>
                                <table className="render-table" style={{ width: '100%', marginTop: 6 }}><tbody>
                                    {rate.models.map((m, j) => (
                                        <tr key={m.model + j}>
                                            <td className="text-sm">{m.model}{m.inferred && <> <span className="badge">inferred</span></>}</td>
                                            {/* THE PRICE, not the conversion factor ("1 image(s) per image" for every row was the old bug). */}
                                            <td className="text-sm text-muted" style={{ textAlign: 'right' }}>{m.components
                                                ? `$${(m.components.input * 1e6).toFixed(2)}/M in · $${(m.components.output * 1e6).toFixed(2)}/M out`
                                                : `${fine(m.usd_per_native ?? 0, 4)} per ${rate.unit}`}</td>
                                        </tr>
                                    ))}
                                </tbody></table>
                            </details>
                        )}
                        <p className="text-sm text-muted" style={{ marginTop: 6 }}><a href={rate.source} target="_blank" rel="noopener noreferrer">source</a></p>
                    </div>
                ))}
            </div>
        </>
    );
}
