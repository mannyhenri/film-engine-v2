import { legacy } from '../../lib/legacy.js';
import { capColor, qty, plural, Bar } from './format.jsx';

/*
 * AI Spend: what this pipeline actually costs, measured at every provider call (lib/usage-meter.js), with
 * nothing to enter by hand. Dollars AND native units side by side: dollars are what the film cost;
 * credits are what runs out mid-render.
 *
 * `spend` is GET /projects/:id/spend; `sub` is GET /spend/subscription (null when it could not be read).
 */
export default function SpendTab({ spend, sub, onBackfill, onSetLimit, onRefresh }) {
    const money = (n) => legacy.money(n); // read when there is money to print, never during the static render
    return (
        <>
            <div className="flex-between mb-16">
                <div id="spendNote" className="text-sm text-muted">{spend ? spend.note || '' : ''}</div>
                <div>
                    <button className="btn btn-secondary" onClick={onSetLimit} style={{ marginRight: 8 }}>Set Limit</button>
                    <button className="btn btn-secondary" onClick={onRefresh}>Refresh</button>
                </div>
            </div>
            {spend && <>
                {/* A project generated before metering reports zero, which looks like one that generated nothing. */}
                <div id="spendBackfillBanner" className="mb-16">
                    {spend.backfill_available && (
                        <div className="card" style={{ borderLeft: '3px solid var(--gl-warning)' }}>
                            <strong>{spend.untracked_assets} asset(s) were generated before spend tracking existed.</strong>
                            <p className="text-sm text-muted" style={{ margin: '4px 0 8px' }}>Their cost can be reconstructed by pricing what is on record — every keyframe,
                                plate and clip is one generation someone paid for. It is a <em>floor</em>: generations that failed cost money and left nothing behind.
                                Reconstructed spend is flagged as an estimate and counted separately.</p>
                            <button className="btn btn-secondary btn-sm" onClick={() => onBackfill(true)}>Preview</button>
                            <button className="btn btn-primary btn-sm" onClick={() => onBackfill(false)} style={{ marginLeft: 6 }}>Reconstruct</button>
                        </div>
                    )}
                </div>
                <Headline s={spend} money={money} />
                <Units s={spend} money={money} />
                <Subscription g={sub} />
                <ByCapability s={spend} money={money} />
                <OverTime s={spend} money={money} />
                <ByModel s={spend} money={money} />
                <ByShot s={spend} money={money} />
            </>}
        </>
    );
}

function Tile({ label, value, sub }) {
    return (
        <div>
            <div className="text-sm text-muted">{label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>{value}</div>
            <div className="text-sm text-muted">{sub || ''}</div>
        </div>
    );
}

function Headline({ s, money }) {
    const limit = s.budget_limit || 0;
    const perMin = s.usd_per_minute || 0;
    return (
        <div id="spendHeadline" className="mb-16">
            <div className="card">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 16 }}>
                    <Tile label="Total spent" value={money(s.total_usd)} sub={`${s.call_count} provider call(s)`} />
                    <Tile label="Per minute of footage" value={perMin > 0 ? money(perMin) : '—'}
                        sub={s.footage_seconds > 0 ? `over ${(s.footage_seconds / 60).toFixed(1)} min of shots` : 'no shot durations yet'} />
                    <Tile label="Per shot" value={s.shot_count > 0 ? money(s.usd_per_shot) : '—'} sub={`${s.shot_count} shot(s)`} />
                    <Tile label="Budget" value={limit > 0 ? money(limit) : 'Not set'} sub={limit > 0 ? money(s.remaining) + ' remaining' : 'no ceiling — runs are never refused'} />
                </div>
                {limit > 0 && <>
                    <div style={{ marginTop: 14 }}><Bar pct={s.budget_used_pct} /></div>
                    <p className="text-sm text-muted" style={{ marginTop: 4 }}>{s.budget_used_pct}% of budget used</p>
                </>}
                {s.estimated_usd > 0 && (
                    <p className="text-sm text-muted" style={{ marginTop: 10, borderTop: '1px solid var(--gl-border-subtle)', paddingTop: 8 }}>
                        {money(s.measured_usd)} measured from live calls · {money(s.estimated_usd)} reconstructed from {s.estimated_calls} earlier generation(s).
                        Reconstructed spend is a floor.
                    </p>
                )}
            </div>
        </div>
    );
}

/** Credits and tokens, per provider: the number a prepaid balance runs out of. */
function Units({ s, money }) {
    const rows = s.by_provider || [];
    return (
        <div id="spendUnits" className="mb-16">
            {rows.length > 0 && <>
                <h3 className="mb-8">Provider usage</h3>
                <div className="card"><table className="render-table" style={{ width: '100%' }}><tbody>
                    <tr><th>Provider</th><th style={{ textAlign: 'right' }}>Consumed</th><th style={{ textAlign: 'right' }}>Calls</th><th style={{ textAlign: 'right' }}>Cost</th></tr>
                    {rows.map(r => (
                        <tr key={r.provider}>
                            <td><span className="badge">{r.provider}</span></td>
                            <td style={{ textAlign: 'right' }}>{r.native_quantity > 0 ? `${qty(r.native_quantity)} ${plural(r.native_quantity, r.native_unit)}` : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{r.calls}</td>
                            <td style={{ textAlign: 'right' }}>{r.usd > 0 ? money(r.usd) : <span className="text-muted">self-hosted</span>}</td>
                        </tr>
                    ))}
                </tbody></table></div>
            </>}
        </div>
    );
}

/*
 * The subscription is the other currency: the agent host is the model, on the user's own plan. No bar until
 * it is CALIBRATED: no plan publishes a token count, and a percentage against an invented number would be
 * believed and planned around.
 */
function Subscription({ g }) {
    const win = (w) => (
        <div key={w.label}>
            <div className="text-sm text-muted">{w.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{qty(w.tokens)} tokens</div>
            <div className="text-sm text-muted">{w.calls} tool call(s){w.pct !== null ? ` · ${w.pct}% of your window` : ''}</div>
            {w.pct !== null && <div style={{ marginTop: 6 }}><Bar pct={w.pct} height={6} /></div>}
        </div>
    );
    return (
        <div id="spendSubscription" className="mb-16">
            {g && <>
                <h3 className="mb-8">Subscription (MCP host)</h3>
                <div className="card">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
                        {win(g.windows.session)}{win(g.windows.week)}
                    </div>
                    {g.by_tool && g.by_tool.length > 0 && (
                        <details style={{ marginTop: 12 }}>
                            <summary className="text-sm text-muted" style={{ cursor: 'pointer' }}>where the tokens go — top tools</summary>
                            <table className="render-table" style={{ width: '100%', marginTop: 6 }}><tbody>
                                {g.by_tool.slice(0, 10).map(t => (
                                    <tr key={t.tool}><td className="text-sm">{t.tool}</td><td className="text-sm text-muted" style={{ textAlign: 'right' }}>{t.calls}×</td>
                                        <td className="text-sm" style={{ textAlign: 'right' }}>{qty(t.tokens)} tokens</td></tr>
                                ))}
                            </tbody></table>
                        </details>
                    )}
                    <p className="text-sm text-muted" style={{ marginTop: 10, borderTop: '1px solid var(--gl-border-subtle)', paddingTop: 8 }}>
                        {g.allowance_tokens === null
                            ? <>No percentage shown because no ceiling is set. {g.note} Set <code>subscription_plan</code> and <code>subscription_pro_baseline_tokens</code> in
                                Settings to calibrate it — one measurement scales across plans via the published multipliers.</>
                            : <>Calibrated to {qty(g.allowance_tokens)} tokens per window{g.plan ? ' on ' + g.plan : ''}. Counts are a floor — they cover the MCP
                                payloads this server moved, not the host's own prompt and history.</>}
                    </p>
                </div>
            </>}
        </div>
    );
}

function ByCapability({ s, money }) {
    const entries = Object.entries(s.by_capability || {});
    const max = Math.max(...entries.map(([, v]) => v.usd), 0.0001);
    return (
        <div id="spendByCapability" className="mb-16">
            {!entries.length
                ? <div className="card"><p className="text-sm text-muted">No provider calls recorded yet. Spend appears here automatically the moment anything is generated.</p></div>
                : <>
                    <h3 className="mb-8">Where the money went</h3>
                    <div className="card">
                        {entries.map(([cap, v]) => (
                            <div key={cap} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <span className="text-sm" style={{ width: 90, flexShrink: 0 }}>{cap}</span>
                                <div style={{ flex: 1, background: 'var(--gl-border-subtle)', borderRadius: 3, height: 16, overflow: 'hidden' }}>
                                    <div style={{ background: capColor(cap), height: '100%', width: `${v.usd / max * 100}%`, borderRadius: 3 }}></div>
                                </div>
                                <span className="text-sm" style={{ width: 70, textAlign: 'right' }}>{money(v.usd)}</span>
                                <span className="text-sm text-muted" style={{ width: 110, textAlign: 'right' }}>{v.calls}× · {v.native_quantity > 0 ? `${qty(v.native_quantity)} ${v.native_unit}` : '—'}</span>
                            </div>
                        ))}
                    </div>
                </>}
        </div>
    );
}

/** Cumulative, not per day: the question is how fast this film is getting expensive, and gaps hide the slope. */
export function cumulativePoints(days, W = 640, H = 120, PAD = 4) {
    let running = 0;
    const pts = days.map((d, i) => { running += d.usd; return { x: (i / (days.length - 1)) * (W - PAD * 2) + PAD, y: running }; });
    const maxY = Math.max(...pts.map(p => p.y), 0.0001);
    const scaled = pts.map(p => `${p.x.toFixed(1)},${(H - PAD - (p.y / maxY) * (H - PAD * 2)).toFixed(1)}`);
    return { scaled, area: `${PAD},${H - PAD} ${scaled.join(' ')} ${W - PAD},${H - PAD}`, total: running };
}

function OverTime({ s, money }) {
    const days = s.by_day || [];
    if (days.length < 2) return <div id="spendOverTime" className="mb-16"></div>;
    const W = 640, H = 120;
    const { scaled, area, total } = cumulativePoints(days, W, H);
    return (
        <div id="spendOverTime" className="mb-16">
            <h3 className="mb-8">Spend over time</h3>
            <div className="card">
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }} preserveAspectRatio="none">
                    <polygon points={area} fill="var(--gl-accent, #2196f3)" opacity="0.15"></polygon>
                    <polyline points={scaled.join(' ')} fill="none" stroke="var(--gl-accent, #2196f3)" strokeWidth="2"></polyline>
                </svg>
                <div className="flex-between text-sm text-muted" style={{ marginTop: 4 }}>
                    <span>{days[0].day}</span><span>cumulative · {money(total)}</span><span>{days[days.length - 1].day}</span>
                </div>
            </div>
        </div>
    );
}

function ByModel({ s, money }) {
    const rows = s.by_model || [];
    return (
        <div id="spendByModel" className="mb-16">
            {rows.length > 0 && <>
                <h3 className="mb-8">By model</h3>
                <div className="card"><table className="render-table" style={{ width: '100%' }}><tbody>
                    <tr><th>Model</th><th>Capability</th><th style={{ textAlign: 'right' }}>Calls</th><th style={{ textAlign: 'right' }}>Metered</th><th style={{ textAlign: 'right' }}>Cost</th></tr>
                    {rows.map((r, i) => (
                        <tr key={r.model + i}>
                            <td className="text-sm">{r.model}</td>
                            <td><span className="badge" style={{ background: capColor(r.capability) + '22' }}>{r.capability}</span></td>
                            <td style={{ textAlign: 'right' }}>{r.calls}</td>
                            <td style={{ textAlign: 'right' }} className="text-sm text-muted">{qty(r.quantity)} {plural(r.quantity, r.unit)}</td>
                            <td style={{ textAlign: 'right' }}>{money(r.usd)}</td>
                        </tr>
                    ))}
                </tbody></table></div>
            </>}
        </div>
    );
}

/** Most expensive first: an average hides the shot regenerated eleven times, which is the one worth knowing. */
function ByShot({ s, money }) {
    const rows = (s.by_shot || []).slice(0, 25);
    return (
        <div id="spendByShot" className="mb-16">
            {rows.length > 0 && <>
                <h3 className="mb-8">Most expensive shots</h3>
                <div className="card"><table className="render-table" style={{ width: '100%' }}><tbody>
                    <tr><th>Shot</th><th>Scene</th><th style={{ textAlign: 'right' }}>Calls</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Per second</th></tr>
                    {rows.map((r, i) => {
                        const secs = (r.duration_ms || 0) / 1000;
                        return (
                            <tr key={(r.shot_id || '') + i}>
                                <td><a href="#" onClick={(e) => { e.preventDefault(); legacy.navigateTo('storyboard'); }}>{r.shot_code || '(deleted shot)'}</a></td>
                                <td className="text-sm text-muted">{r.scene_number != null ? String(r.scene_number) : '—'}</td>
                                <td style={{ textAlign: 'right' }}>{r.calls}</td>
                                <td style={{ textAlign: 'right' }}>{money(r.usd)}</td>
                                <td style={{ textAlign: 'right' }} className="text-sm text-muted">{secs > 0 ? money(r.usd / secs) : '—'}</td>
                            </tr>
                        );
                    })}
                </tbody></table></div>
            </>}
        </div>
    );
}
