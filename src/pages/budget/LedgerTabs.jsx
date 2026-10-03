import { useState } from 'react';
import Modal, { closeModal } from '../../components/Modal.jsx';

/* The cost ledger: what was spent outside the meter, entered by hand, against the limit. */
const TYPE_COLORS = { render_gpu: '#e91e63', image_generation: '#2196f3', video_generation: '#9c27b0', voice_synthesis: '#ff9800', music_generation: '#4caf50',
    api_call: '#00bcd4', storage: '#607d8b', license: '#795548', other: '#9e9e9e' };
export const COST_TYPES = [['render_gpu', 'Render GPU'], ['image_generation', 'Image Generation'], ['video_generation', 'Video Generation'], ['voice_synthesis', 'Voice Synthesis'],
    ['music_generation', 'Music Generation'], ['api_call', 'API Call'], ['storage', 'Storage'], ['license', 'License'], ['other', 'Other']];

export function LedgerTab({ ledger, onSetLimit, onAddEntry, onDelete }) {
    const { summary = {}, entries = [], forecast = {} } = ledger || {};
    const total = summary.total_spent || 0;
    const limit = summary.budget_total || 0;
    const pct = limit > 0 ? Math.min(100, total / limit * 100).toFixed(1) : 0;
    const breakdown = summary.breakdown || [];
    const maxAmt = Math.max(0, ...breakdown.map(b => b.amount));
    const bar = pct > 90 ? 'var(--gl-error)' : pct > 70 ? 'var(--gl-warning)' : 'var(--gl-success)';
    return (
        <>
            <div className="flex-between mb-16"><div></div><div>
                <button className="btn btn-secondary" onClick={onSetLimit} style={{ marginRight: 8 }}>Set Limit</button>
                <button className="btn btn-primary" onClick={onAddEntry}>+ Cost Entry</button>
            </div></div>
            <div id="budgetSummary" className="mb-16">{ledger && (
                <div className="card">
                    <div className="flex-between mb-8">
                        <div><span className="text-sm text-muted">Total Spent</span><h2 style={{ fontSize: 24 }}>${total.toFixed(2)}</h2></div>
                        <div style={{ textAlign: 'right' }}><span className="text-sm text-muted">Budget Limit</span><h2 style={{ fontSize: 24 }}>{limit > 0 ? '$' + limit.toFixed(2) : 'Not set'}</h2></div>
                    </div>
                    {limit > 0 && <>
                        <div style={{ background: 'var(--gl-border-subtle)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                            <div style={{ background: bar, height: '100%', width: `${pct}%`, transition: 'width 0.3s', borderRadius: 4 }}></div>
                        </div>
                        <p className="text-sm text-muted" style={{ marginTop: 4 }}>{pct}% used</p>
                    </>}
                    {forecast.avg_daily_spend > 0 && <p className="text-sm" style={{ marginTop: 8 }}>Avg daily: ${forecast.avg_daily_spend.toFixed(2)}
                        {forecast.days_until_exhausted ? ` · ~${forecast.days_until_exhausted} days remaining` : ''}</p>}
                </div>
            )}</div>
            <div id="budgetBreakdown" className="mb-16">{breakdown.length > 0 && <>
                <h3 className="mb-8">Cost Breakdown</h3>
                <div className="card">{breakdown.map(b => (
                    <div key={b.cost_type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span className="text-sm" style={{ width: 120, flexShrink: 0 }}>{b.cost_type.replace(/_/g, ' ')}</span>
                        <div style={{ flex: 1, background: 'var(--gl-border-subtle)', borderRadius: 3, height: 16, overflow: 'hidden' }}>
                            <div style={{ background: TYPE_COLORS[b.cost_type] || '#9e9e9e', height: '100%', width: `${maxAmt > 0 ? b.amount / maxAmt * 100 : 0}%`, borderRadius: 3 }}></div>
                        </div>
                        <span className="text-sm" style={{ width: 80, textAlign: 'right' }}>${b.amount.toFixed(2)}</span>
                        <span className="text-sm text-muted" style={{ width: 40, textAlign: 'right' }}>{b.count}x</span>
                    </div>
                ))}</div>
            </>}</div>
            <h3 className="mb-8">Cost Ledger</h3>
            <div id="budgetLedger">
                {ledger && !entries.length && <p className="text-sm text-muted">No cost entries yet.</p>}
                {entries.length > 0 && (
                    <table className="render-table"><tbody>
                        <tr><th>Type</th><th>Amount</th><th>Description</th><th>Model</th><th>Date</th><th></th></tr>
                        {entries.map(e => (
                            <tr key={e.id}>
                                <td><span className="badge">{e.cost_type}</span></td>
                                <td>${(e.amount || 0).toFixed(2)}</td>
                                <td className="text-sm">{e.description || '-'}</td>
                                <td className="text-sm text-muted">{e.model_used || '-'}</td>
                                <td className="text-sm text-muted">{new Date(e.created_at).toLocaleDateString()}</td>
                                <td><button className="btn btn-danger btn-sm" onClick={() => onDelete(e.id)} style={{ padding: '2px 6px', fontSize: 10 }} title="Delete this cost entry">x</button></td>
                            </tr>
                        ))}
                    </tbody></table>
                )}
            </div>
        </>
    );
}

/* ── The live-action estimate: a crew shoot priced from the project's scenes, shots, cast and places. ── */
export const TEMPLATES = [['micro', 'Micro Budget (<$100K)'], ['indie', 'Indie ($100K-$1M)'], ['low', 'Low Budget ($1M-$5M)'], ['mid', 'Mid Budget ($5M-$20M)'], ['studio', 'Studio ($20M+)'], ['custom', 'Custom']];
const CATEGORIES = [['above_the_line', 'Above the Line'], ['below_the_line_production', 'Below the Line (Production)'], ['post_production', 'Post-Production'], ['other', 'Other']];
const CONFIDENCE = { high: 'var(--gl-success)', medium: 'var(--gl-warning)', low: 'var(--gl-error)' };
const SOURCE_ICON = { manual: '✏️', estimated: '📊', calculated: '🔢', web_search: '🔍', ai_estimate: '🤖' };
const STATS = [['scene_count', 'Scenes', 'var(--gl-brand-pink)'], ['shot_count', 'Shots', 'var(--gl-brand-blue)'], ['character_count', 'Characters', 'var(--gl-accent-purple)'],
    ['location_count', 'Locations', 'var(--gl-success)'], ['shooting_days_estimate', 'Est. Shoot Days', 'var(--gl-warning)'], ['complexity_score', 'Complexity', 'var(--gl-info)']];

/** The estimate as a CSV, every line item then the total, template and time. */
export function estimateCsv(estimate, now = new Date()) {
    const lines = [['Category', 'Subcategory', 'Description', 'Amount', 'Source', 'Confidence'],
        ...(estimate.line_items || []).map(i => [i.category, i.subcategory, i.description || '', i.amount || 0, i.source || '', i.confidence || '']),
        [], ['TOTAL', '', '', estimate.total_estimated], [], ['Template', estimate.template], ['Generated', now.toISOString()]];
    return lines.map(row => row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\n');
}

export function LiveActionTab({ template, estimate, error, onTemplate, onRefresh, onExport, onSetCost }) {
    const stats = (estimate && estimate.stats) || {};
    const missing = (estimate && estimate.missing_data) || [];
    const cats = CATEGORIES.map(([key, label]) => {
        const items = ((estimate && estimate.line_items) || []).filter(i => (CATEGORIES.some(c => c[0] === i.category) ? i.category : 'other') === key);
        return { key, label, items, total: items.reduce((n, i) => n + (i.amount || 0), 0) };
    }).filter(c => c.items.length);
    const $ = (n) => '$' + (n || 0).toLocaleString();
    return (
        <>
            <div className="flex-between mb-16">
                <div>
                    <label className="text-sm text-muted" style={{ marginRight: 8 }}>Template:</label>
                    <select id="budgetTemplateSelect" value={template} onChange={(e) => onTemplate(e.target.value)}
                        style={{ padding: '6px 12px', background: 'var(--gl-bg-surface)', border: '1px solid var(--gl-border-subtle)', borderRadius: 'var(--gl-radius-md)', color: 'var(--gl-text-primary)' }}>
                        {TEMPLATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                </div>
                <div>
                    <button className="btn btn-secondary" onClick={onRefresh} style={{ marginRight: 8 }}>Refresh Estimate</button>
                    <button className="btn btn-primary" onClick={onExport}>Export CSV</button>
                </div>
            </div>
            <div id="budgetAnalysisSummary" className="mb-16">
                {error && <p className="text-muted">Failed to generate estimate. Make sure you have scenes and shots created.</p>}
                {estimate && !error && (
                    <div className="card"><h3 className="mb-8">Project Analysis</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 16 }}>
                            {STATS.map(([k, label, color]) => (
                                <div key={k} className="text-center"><div className="text-2xl" style={{ color }}>{stats[k] || (k === 'shooting_days_estimate' ? '?' : 0)}</div><div className="text-sm text-muted">{label}</div></div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            <div id="budgetMissingData" className="mb-16">{!error && missing.length > 0 && (
                <div className="card" style={{ borderColor: 'var(--gl-warning)', background: 'rgba(245,158,11,0.05)' }}>
                    <div className="flex-between mb-8"><h3 style={{ color: 'var(--gl-warning)' }}>Missing Cost Data ({missing.length})</h3><span className="badge badge-warning">Estimates may be inaccurate</span></div>
                    <p className="text-sm text-muted mb-8">The following items need cost information for accurate budgeting. Click to enter values.</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {missing.slice(0, 10).map(item => (
                            <button key={item.entity_type + item.entity_id} className="btn btn-secondary btn-sm" onClick={() => onSetCost(item)}>
                                {item.entity_type === 'character' ? '👤' : '📍'} {item.entity_name}
                                <span className="text-muted" style={{ marginLeft: 4 }}>${item.suggested_range ? item.suggested_range.min + '-' + item.suggested_range.max : '?'}</span>
                            </button>
                        ))}
                        {missing.length > 10 && <span className="text-muted text-sm">+{missing.length - 10} more</span>}
                    </div>
                </div>
            )}</div>
            <div id="budgetEstimateBreakdown">{estimate && !error && <>
                <div className="card mb-16">
                    <div className="flex-between mb-16"><h2>Total Estimated Budget</h2>
                        <div className="text-right"><div className="text-3xl" style={{ color: 'var(--gl-brand-pink)' }}>{$(estimate.total_estimated)}</div>
                            <div className="text-sm text-muted">{estimate.template_label || estimate.template}</div></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, paddingTop: 16, borderTop: '1px solid var(--gl-border-subtle)' }}>
                        {[['Above the Line', 'above_the_line'], ['Below the Line', 'below_the_line'], ['Post-Production', 'post_production'], ['Other + Contingency', 'other_costs']].map(([l, k]) => (
                            <div key={k}><div className="text-sm text-muted">{l}</div><div className="text-lg">{$(estimate[k])}</div></div>
                        ))}
                    </div>
                </div>
                {cats.map(cat => (
                    <div key={cat.key} className="card mb-8"><details open>
                        <summary style={{ cursor: 'pointer', userSelect: 'none' }} className="flex-between"><h3>{cat.label}</h3><span className="text-lg">{$(cat.total)}</span></summary>
                        <table className="entity-table" style={{ marginTop: 12 }}>
                            <thead><tr><th>Item</th><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th><th>Source</th></tr></thead>
                            <tbody>{cat.items.map((item, i) => (
                                <tr key={item.subcategory + i}>
                                    <td>{String(item.subcategory || '').replace(/_/g, ' ')}</td>
                                    <td className="text-muted text-sm">{item.description || ''}</td>
                                    <td style={{ textAlign: 'right' }}>{$(item.amount)}</td>
                                    <td><span title={item.source} style={{ color: CONFIDENCE[item.confidence] || CONFIDENCE.low }}>{SOURCE_ICON[item.source] || ''}</span></td>
                                </tr>
                            ))}</tbody>
                        </table>
                    </details></div>
                ))}
                {(estimate.assumptions || []).length > 0 && (
                    <div className="card"><h3 className="mb-8">Assumptions</h3>
                        <ul className="text-sm text-muted" style={{ margin: 0, paddingLeft: 20 }}>{estimate.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
                )}
            </>}</div>
        </>
    );
}

/* The cost of one cast member or one place. Numbers parsed, empty fields left out, at least one required. */
const MONEY_FIELDS = ['day_rate', 'daily_rate', 'permits_cost', 'travel_allowance'];
const DAY_FIELDS = ['shooting_days', 'shoot_days', 'prep_days'];
export function costBody(values) {
    const body = {};
    for (const [k, v] of Object.entries(values)) {
        if (!v) continue;
        body[k] = MONEY_FIELDS.includes(k) ? parseFloat(v) : DAY_FIELDS.includes(k) ? parseInt(v, 10) : v;
    }
    return body;
}

export function CostInputModal({ target, onSave }) {
    const [values, setValues] = useState({});
    const [forKey, setForKey] = useState('');
    const key = target ? target.entity_type + ':' + target.entity_id : '';
    if (key !== forKey) { setForKey(key); setValues({}); }
    const set = (k) => (e) => { const v = e.target.value; setValues(s => ({ ...s, [k]: v })); };
    const isCharacter = !target || target.entity_type === 'character';
    return (
        <Modal id="costInputModal" title={`Set Cost: ${target ? target.entity_name : ''}`} footer={<>
            <button className="btn btn-secondary" onClick={() => closeModal('costInputModal')}>Cancel</button>
            <button className="btn btn-primary" onClick={() => onSave(target, costBody({ [isCharacter ? 'talent_tier' : 'location_type']: 'unknown', ...values }))}>Save</button>
        </>}>
            {isCharacter ? <>
                <div className="form-group"><label>Talent Tier</label>
                    <select id="costInputTier" data-field="talent_tier" value={values.talent_tier || 'unknown'} onChange={set('talent_tier')}>
                        <option value="unknown">Unknown</option><option value="background">Background / Extra ($150-300/day)</option>
                        <option value="day_player">Day Player ($1K-3K/day)</option><option value="supporting">Supporting ($5K-25K/week)</option>
                        <option value="lead">Lead ($25K-100K/project)</option><option value="star">Star ($100K-500K/project)</option>
                        <option value="a_list">A-List ($500K-20M/project)</option>
                    </select></div>
                <div className="form-group"><label>Day Rate ($)</label><input type="number" id="costInputDayRate" data-field="day_rate" min="0" step="100" placeholder="e.g., 5000" value={values.day_rate || ''} onChange={set('day_rate')} /></div>
                <div className="form-group"><label>Shooting Days</label><input type="number" id="costInputShootingDays" data-field="shooting_days" min="1" placeholder="e.g., 10" value={values.shooting_days || ''} onChange={set('shooting_days')} /></div>
                <div className="form-group"><label>Actor Name (optional)</label><input type="text" id="costInputActorName" data-field="actor_name" placeholder="e.g., Tom Hanks" value={values.actor_name || ''} onChange={set('actor_name')} /></div>
                <div className="form-group"><label>Travel Allowance ($)</label><input type="number" id="costInputTravel" data-field="travel_allowance" min="0" step="50" placeholder="e.g., 1200" value={values.travel_allowance || ''} onChange={set('travel_allowance')} />
                    <span className="text-sm text-muted">Flights, hotel and per diem for the whole engagement — not per day.</span></div>
            </> : <>
                <div className="form-group"><label>Location Type</label>
                    <select id="costInputLocType" data-field="location_type" value={values.location_type || 'unknown'} onChange={set('location_type')}>
                        <option value="unknown">Unknown</option><option value="practical">Practical Location ($500-5K/day)</option>
                        <option value="studio">Studio / Stage ($2K-25K/day)</option><option value="backlot">Backlot ($1K-10K/day)</option>
                        <option value="remote">Remote Location ($3K-15K/day)</option><option value="international">International ($5K-50K/day)</option>
                    </select></div>
                <div className="form-group"><label>Daily Rate ($)</label><input type="number" id="costInputDailyRate" data-field="daily_rate" min="0" step="100" placeholder="e.g., 2500" value={values.daily_rate || ''} onChange={set('daily_rate')} /></div>
                <div className="form-group"><label>Shoot Days</label><input type="number" id="costInputShootDays" data-field="shoot_days" min="1" placeholder="e.g., 3" value={values.shoot_days || ''} onChange={set('shoot_days')} /></div>
                <div className="form-group"><label>Prep Days</label><input type="number" id="costInputPrepDays" data-field="prep_days" min="0" placeholder="e.g., 1" value={values.prep_days || ''} onChange={set('prep_days')} />
                    <span className="text-sm text-muted">Days held before the shoot — dressing, rigging, a tech scout. Billed at the same daily rate.</span></div>
                <div className="form-group"><label>Permits Cost ($)</label><input type="number" id="costInputPermits" data-field="permits_cost" min="0" step="50" placeholder="e.g., 500" value={values.permits_cost || ''} onChange={set('permits_cost')} /></div>
            </>}
        </Modal>
    );
}
