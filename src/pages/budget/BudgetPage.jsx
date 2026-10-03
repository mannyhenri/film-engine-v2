import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { formBody } from '../../lib/forms.js';
import SpendTab from './SpendTab.jsx';
import FilmEstimateTab, { estimateQuery, applyChoice } from './FilmEstimateTab.jsx';
import { CompareTab, RatesTab } from './RatesTabs.jsx';
import { LedgerTab, LiveActionTab, CostInputModal, COST_TYPES, estimateCsv } from './LedgerTabs.jsx';

/*
 * Budget, as React: what this film costs, six ways.
 *   AI Spend       — measured at every provider call (GET /spend), with the subscription beside it
 *   Film Estimate  — the film's plates, frames and footage priced before anything is made (free)
 *   Ledger         — costs entered by hand, against the limit
 *   Compare        — which generator to use, per unit of real work
 *   Rates          — where every number comes from
 *   Live-action    — a crew shoot priced from the project, for comparison
 *
 * Same routes, bodies and status lines as the legacy page. navigateTo calls loadSpend() then loadBudget(),
 * so the page registers both. A tab loads its data when opened, as the legacy page did.
 */
export const TABS = [['spend', 'AI Spend'], ['film', 'Film Estimate'], ['tracking', 'Ledger'], ['compare', 'Compare Generators'], ['rates', 'Rates'], ['estimation', 'Live-action Estimate']];

export default function BudgetPage() {
    const [tab, setTab] = useState('spend');
    const [spend, setSpend] = useState({ s: null, sub: null });
    const [ledger, setLedger] = useState(null);
    const [film, setFilm] = useState({ params: {}, data: null, error: '' });
    const [compare, setCompare] = useState({ capability: 'image', clipSeconds: 5, r: null, error: '' });
    const [rates, setRates] = useState(null);
    const [live, setLive] = useState({ template: 'indie', estimate: null, error: false });
    const [limitForm, setLimitForm] = useState({ budget_limit: '', budget_currency: '' });
    const [entryForm, setEntryForm] = useState({ cost_type: 'render_gpu', amount: '', gpu_seconds: '', description: '', model_used: '' });
    const [costTarget, setCostTarget] = useState(null);
    const pid = () => legacy.state.currentProject && legacy.state.currentProject.id;
    const fail = (err) => legacy.setStatus('Error: ' + err.message);

    async function loadSpend() {
        if (!pid()) return;
        legacy.setStatus('Loading spend...');
        try {
            const s = await legacy.api('/projects/' + pid() + '/spend');
            let sub = null;
            try { sub = await legacy.api('/spend/subscription?project_id=' + pid()); } catch { sub = null; }
            setSpend({ s, sub });
            legacy.setStatus('Spend loaded');
        } catch (err) { fail(err); }
    }
    usePageLoader('loadSpend', loadSpend);

    async function loadBudget() {
        if (!pid()) return;
        legacy.setStatus('Loading budget...');
        try {
            const [summary, l, forecast] = await Promise.all([
                legacy.api('/projects/' + pid() + '/budget'),
                legacy.api('/projects/' + pid() + '/budget/ledger?limit=50'),
                legacy.api('/projects/' + pid() + '/budget/forecast'),
            ]);
            setLedger({ summary, entries: l.entries || [], forecast });
            legacy.setStatus('Budget loaded');
        } catch (err) { fail(err); }
    }
    usePageLoader('loadBudget', loadBudget);

    async function backfill(dryRun) {
        try {
            const r = await legacy.api('/projects/' + pid() + '/spend/backfill', { method: 'POST', body: JSON.stringify(dryRun ? { dry_run: true } : {}) });
            if (dryRun) {
                window.alert(`${r.recorded} generation(s) would be reconstructed at ${legacy.money(r.total_usd)}.\n\n`
                    + `${r.skipped} asset(s) skipped (not produced by a paid provider).\n\n${r.caveat}`);
            } else {
                legacy.setStatus(`Reconstructed ${r.recorded} generation(s) — ${legacy.money(r.total_usd)}`);
                loadSpend();
            }
        } catch (err) { fail(err); }
    }

    async function loadProductionEstimate(params = film.params) {
        if (!pid()) return;
        setFilm(f => ({ ...f, params, error: '' }));
        const q = estimateQuery(params);
        try {
            const data = await legacy.api('/projects/' + pid() + '/budget/production' + (q ? '?' + q : ''));
            setFilm({ params, data, error: '' });
        } catch (err) { setFilm({ params, data: null, error: err.message }); }
    }

    async function loadGeneratorCompare(capability = compare.capability, clipSeconds = compare.clipSeconds) {
        setCompare(c => ({ ...c, capability, clipSeconds, r: null, error: '' }));
        // The project only supplies the delivery frame the per-megapixel providers are priced at.
        const params = ['capability=' + encodeURIComponent(capability)];
        if (pid()) params.push('project_id=' + pid());
        if (capability === 'video' && clipSeconds > 0) params.push('clip_seconds=' + clipSeconds);
        try {
            const r = await legacy.api('/spend/compare?' + params.join('&'));
            setCompare(c => ({ ...c, r }));
        } catch (err) { setCompare(c => ({ ...c, error: err.message })); }
    }

    async function loadSpendRates() {
        try { setRates((await legacy.api('/spend/rates')).rates || []); } catch (err) { fail(err); }
    }

    async function generateBudgetEstimate(template = live.template) {
        if (!pid()) return;
        setLive(l => ({ ...l, template }));
        legacy.setStatus('Generating budget estimate...');
        try {
            const estimate = await legacy.api('/projects/' + pid() + '/budget/estimate?template=' + template + '&refresh=true');
            setLive({ template, estimate, error: false });
            legacy.setStatus('Budget estimate generated');
        } catch (err) {
            legacy.setStatus('Error: ' + err.message);
            setLive(l => ({ ...l, error: true }));
        }
    }

    function exportBudgetEstimate() {
        if (!live.estimate) { legacy.setStatus('No estimate to export'); return; }
        const url = URL.createObjectURL(new Blob([estimateCsv(live.estimate)], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = (legacy.state.currentProject?.title || 'budget') + '_estimate.csv';
        a.click();
        URL.revokeObjectURL(url);
        legacy.setStatus('Budget estimate exported');
    }

    async function saveCostInput(target, body) {
        if (!Object.keys(body).length) { legacy.setStatus('Please enter at least one value'); return; }
        try {
            await legacy.api('/' + target.entity_type + 's/' + target.entity_id + '/cost', { method: 'PUT', body: JSON.stringify(body) });
            closeModal('costInputModal');
            legacy.setStatus('Cost data saved');
            generateBudgetEstimate();
        } catch (err) { fail(err); }
    }

    async function saveCostEntry() {
        if (!pid()) return;
        const body = formBody(entryForm);
        body.amount = parseFloat(entryForm.amount) || 0;
        body.gpu_seconds = parseInt(entryForm.gpu_seconds, 10) || 0;
        try {
            await legacy.api('/projects/' + pid() + '/budget', { method: 'POST', body: JSON.stringify(body) });
            closeModal('costEntryModal');
            loadBudget();
            legacy.setStatus('Cost entry added');
        } catch (err) { fail(err); }
    }

    async function deleteCostEntry(id) {
        if (!window.confirm('Delete this cost entry?')) return;
        try { await legacy.api('/budget/' + id, { method: 'DELETE' }); loadBudget(); } catch (err) { fail(err); }
    }

    async function saveBudgetLimit() {
        if (!pid()) return;
        // An unset currency is omitted rather than sent empty: "" would be stored as a currency of nothing.
        const body = { budget_total: parseFloat(limitForm.budget_limit) || 0 };
        if (limitForm.budget_currency) body.budget_currency = limitForm.budget_currency;
        try {
            await legacy.api('/projects/' + pid() + '/budget/limit', { method: 'PUT', body: JSON.stringify(body) });
            closeModal('budgetLimitModal');
            loadBudget();
            legacy.setStatus('Budget limit updated');
        } catch (err) { fail(err); }
    }

    function switchBudgetTab(next) {
        setTab(next);
        if (next === 'spend') loadSpend();
        if (next === 'rates') loadSpendRates();
        if (next === 'compare') loadGeneratorCompare();
        if (next === 'film') loadProductionEstimate();
        if (next === 'estimation' && !live.estimate) generateBudgetEstimate();
    }

    const panel = (name, id, children) => <div id={id} className="budget-tab-content" style={{ display: tab === name ? 'block' : 'none' }}>{children}</div>;
    const field = (form, setForm) => (k) => ({ 'data-field': k, value: form[k], onChange: (e) => { const v = e.target.value; setForm(f => ({ ...f, [k]: v })); } });
    const lim = field(limitForm, setLimitForm);
    const ent = field(entryForm, setEntryForm);
    return (
        <div className="page" id="page-budget">
            <div className="flex-between mb-16">
                <h2>Budget</h2>
                <div className="tab-bar" id="budgetTabs">
                    {TABS.map(([t, label]) => <button key={t} className={'tab-btn' + (tab === t ? ' active' : '')} data-tab={t} onClick={() => switchBudgetTab(t)}>{label}</button>)}
                </div>
            </div>
            {panel('spend', 'budgetTabSpend', <SpendTab spend={spend.s} sub={spend.sub} onBackfill={backfill} onSetLimit={() => openModal('budgetLimitModal')} onRefresh={loadSpend} />)}
            {panel('film', 'budgetTabFilm', <FilmEstimateTab data={film.data} error={film.error} params={film.params}
                onChoose={(k, v) => loadProductionEstimate(applyChoice(film.params, k, v))} onReset={() => loadProductionEstimate({})} />)}
            {panel('compare', 'budgetTabCompare', <CompareTab capability={compare.capability} clipSeconds={compare.clipSeconds} r={compare.r} error={compare.error}
                onCapability={(c) => loadGeneratorCompare(c)} onClipSeconds={(n) => loadGeneratorCompare('video', n)} />)}
            {panel('rates', 'budgetTabRates', <RatesTab rates={rates} />)}
            {panel('tracking', 'budgetTabTracking', <LedgerTab ledger={ledger} onSetLimit={() => openModal('budgetLimitModal')} onAddEntry={() => openModal('costEntryModal')} onDelete={deleteCostEntry} />)}
            {panel('estimation', 'budgetTabEstimation', <LiveActionTab template={live.template} estimate={live.estimate} error={live.error}
                onTemplate={(t) => generateBudgetEstimate(t)} onRefresh={() => generateBudgetEstimate()} onExport={exportBudgetEstimate}
                onSetCost={(item) => { setCostTarget(item); openModal('costInputModal'); }} />)}

            <Modal id="budgetLimitModal" title="Set Budget Limit">
                <div className="form-group"><label>Budget Limit</label><input type="number" {...lim('budget_limit')} min="0" step="0.01" placeholder="0.00" /></div>
                <div className="form-group"><label>Currency</label>
                    <select {...lim('budget_currency')}>
                        <option value="">Leave as it is</option><option value="USD">USD — US dollar</option><option value="EUR">EUR — euro</option>
                        <option value="GBP">GBP — pound sterling</option><option value="CAD">CAD — Canadian dollar</option><option value="AUD">AUD — Australian dollar</option>
                        <option value="JPY">JPY — yen</option>
                    </select>
                    <span className="text-sm text-muted">The provider rate book is priced in USD, so a limit set in another currency is compared against converted spend —
                        it does not re-price what generation costs.</span></div>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={saveBudgetLimit}>Save</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('budgetLimitModal')}>Cancel</button>
                </div>
            </Modal>
            <Modal id="costEntryModal" title="Add Cost Entry">
                <div className="form-group"><label>Cost Type</label><select {...ent('cost_type')}>{COST_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="form-group"><label>Amount ($)</label><input type="number" {...ent('amount')} min="0" step="0.01" placeholder="0.00" /></div>
                    <div className="form-group"><label>GPU Seconds</label><input type="number" {...ent('gpu_seconds')} min="0" placeholder="0" /></div>
                </div>
                <div className="form-group"><label>Description</label><input type="text" {...ent('description')} placeholder="What was this for?" /></div>
                <div className="form-group"><label>Model Used</label><input type="text" {...ent('model_used')} placeholder="e.g. SDXL, GPT-4" /></div>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={saveCostEntry}>Save</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('costEntryModal')}>Cancel</button>
                </div>
            </Modal>
            <CostInputModal target={costTarget} onSave={saveCostInput} />
        </div>
    );
}
