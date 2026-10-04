import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import BudgetPage, { TABS } from './BudgetPage.jsx';
import { qty } from './format.jsx';
import { cumulativePoints } from './SpendTab.jsx';
import { estimateQuery, applyChoice } from './FilmEstimateTab.jsx';
import { costBody, estimateCsv } from './LedgerTabs.jsx';
import { fine } from './RatesTabs.jsx';

const SPEND = {
    note: 'Measured at every call.', total_usd: 12.5, call_count: 40, usd_per_minute: 3, footage_seconds: 250, shot_count: 10, usd_per_shot: 1.25,
    budget_limit: 50, budget_used_pct: 25, remaining: 37.5, estimated_usd: 2, measured_usd: 10.5, estimated_calls: 4,
    backfill_available: true, untracked_assets: 7,
    by_provider: [{ provider: 'meshy', native_quantity: 700, native_unit: 'credit', calls: 30, usd: 9 }, { provider: 'gridlight', native_quantity: 0, calls: 5, usd: 0 }],
    by_capability: { image: { usd: 9, calls: 30, native_quantity: 700, native_unit: 'credit' }, video: { usd: 3.5, calls: 10, native_quantity: 0 } },
    by_day: [{ day: '2026-10-01', usd: 2 }, { day: '2026-10-02', usd: 10.5 }],
    by_model: [{ model: 'nano-banana-pro', capability: 'image', calls: 30, quantity: 30, unit: 'image', usd: 9 }],
    by_shot: [{ shot_id: 's1', shot_code: '1A <x>', scene_number: 1, calls: 6, usd: 3, duration_ms: 4000 }],
};
const SUB = { windows: { session: { label: '5-hour session', tokens: 12000, calls: 30, pct: null }, week: { label: 'Week', tokens: 80000, calls: 200, pct: null } },
    by_tool: [{ tool: 'script_get', calls: 4, tokens: 9000 }], allowance_tokens: null, note: 'No ceiling is published.' };
const LEDGER = [{ total_spent: 12, budget_total: 100, breakdown: [{ cost_type: 'render_gpu', amount: 12, count: 2 }] },
    { entries: [{ id: 'e1', cost_type: 'render_gpu', amount: 12, description: 'farm <night>', model_used: 'SDXL', created_at: '2026-10-01' }] },
    { avg_daily_spend: 4, days_until_exhausted: 22 }];
const ROUTES = {
    'GET /projects/p1/spend': SPEND, 'GET /spend/subscription?project_id=p1': SUB,
    'GET /projects/p1/budget': LEDGER[0], 'GET /projects/p1/budget/ledger?limit=200&page=1': LEDGER[1], 'GET /projects/p1/budget/forecast': LEDGER[2],
};
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { ...ROUTES, ...routes } });
    render(<BudgetPage />);
    await act(async () => { await window.loadSpend(); await window.loadBudget(); });
    return legacy;
}
const byId = (id) => document.getElementById(id);
const tabBtn = (label) => screen.getByRole('button', { name: label });

describe('Budget: the helpers', () => {
    it('quantities read at a glance; prices keep their meaningful decimals', () => {
        expect([qty(5), qty(2.5), qty(1234), qty(2500000)]).toEqual(['5', '2.50', '1.2k', '2.50M']);
        expect([fine(0.05), fine(0.000003), fine(2)]).toEqual(['$0.05', '$0.000003', '$2']);
    });
    it('spend over time is cumulative', () => {
        expect(cumulativePoints([{ usd: 1 }, { usd: 3 }]).total).toBe(4);
    });
    it('a film-estimate choice becomes its query; a generator sets provider and model; empty choices are left out', () => {
        const p = applyChoice(applyChoice({}, 'video', 'muapi|seedance-2.5-1080p'), 'resolution', '4k');
        expect(p).toEqual({ video_provider: 'muapi', video_model: 'seedance-2.5-1080p', resolution: '4k' });
        expect(estimateQuery({ ...p, upscale_provider: '' })).toBe('video_provider=muapi&video_model=seedance-2.5-1080p&resolution=4k');
    });
    it('a cost form sends money as decimals, days as whole numbers, and leaves empty fields out', () => {
        expect(costBody({ talent_tier: 'lead', day_rate: '5000.5', shooting_days: '10', actor_name: '', travel_allowance: '1200' }))
            .toEqual({ talent_tier: 'lead', day_rate: 5000.5, shooting_days: 10, travel_allowance: 1200 });
    });
    it('the estimate CSV quotes every cell and ends with the total, template and time', () => {
        const csv = estimateCsv({ line_items: [{ category: 'other', subcategory: 'cat"ering', amount: 5 }], total_estimated: 5, template: 'indie' }, new Date('2026-10-01T00:00:00Z'));
        expect(csv.split('\n')[1]).toBe('"other","cat""ering","","5","",""');
        expect(csv).toContain('"TOTAL","","","5"');
        expect(csv).toContain('"Generated","2026-10-01T00:00:00.000Z"');
    });
});

describe('Budget: the page', () => {
    it('six tabs, AI Spend open; navigating there runs both loaders', async () => {
        await openPage();
        expect([...document.querySelectorAll('#budgetTabs .tab-btn')].map(b => b.textContent)).toEqual(TABS.map(t => t[1]));
        expect(byId('budgetTabSpend').style.display).toBe('block');
        expect(byId('budgetTabTracking').style.display).toBe('none');
    });

    it('AI Spend: headline, units, subscription, where the money went, over time, by model, by shot', async () => {
        await openPage();
        expect(byId('spendNote').textContent).toBe('Measured at every call.');
        expect(byId('spendHeadline').textContent).toContain('$12.50');
        expect(byId('spendHeadline').textContent).toContain('25% of budget used');
        expect(byId('spendHeadline').textContent).toContain('reconstructed from 4 earlier generation(s)');
        expect(byId('spendUnits').textContent).toContain('700 credits');
        expect(byId('spendUnits').textContent).toContain('self-hosted');
        expect(byId('spendSubscription').textContent).toContain('No percentage shown because no ceiling is set');
        expect(byId('spendByCapability').textContent).toContain('image');
        expect(byId('spendOverTime').querySelector('polyline')).toBeTruthy();
        expect(byId('spendByModel').textContent).toContain('nano-banana-pro');
        expect(screen.getByText('1A <x>')).toBeTruthy();
        fireEvent.click(screen.getByText('1A <x>'));
        expect(window.navigateTo).toHaveBeenCalledWith('storyboard');
    });

    it('AI Spend with nothing recorded says spend appears automatically', async () => {
        await openPage({ 'GET /projects/p1/spend': { total_usd: 0, call_count: 0, shot_count: 0, by_capability: {} } });
        expect(byId('spendByCapability').textContent).toContain('No provider calls recorded yet');
        expect(byId('spendBackfillBanner').textContent).toBe('');
    });

    it('backfill: Preview reports without writing; Reconstruct writes, then reloads', async () => {
        const bodies = [];
        const { status } = await openPage({ 'POST /projects/p1/spend/backfill': (b) => { bodies.push(b); return { recorded: 7, skipped: 1, total_usd: 4, caveat: 'A floor.' }; } });
        const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview' })); });
        expect(bodies[0]).toEqual({ dry_run: true });
        expect(alert.mock.calls[0][0]).toContain('7 generation(s) would be reconstructed at $4.00');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reconstruct' })); });
        expect(bodies[1]).toEqual({});
        expect(status).toContain('Reconstructed 7 generation(s) — $4.00');
        alert.mockRestore();
    });

    it('Ledger: every page of it is read, so a search or sort covers the whole history, not the newest page', async () => {
        const e = (id) => ({ id, cost_type: 'other', amount: 1, description: id, created_at: '2026-10-01' });
        const { calls } = await openPage({
            'GET /projects/p1/budget/ledger?limit=200&page=1': { entries: [e('a'), e('b')], pages: 2 },
            'GET /projects/p1/budget/ledger?limit=200&page=2': { entries: [e('c')], pages: 2 },
        });
        expect(calls.filter(c => c.path.includes('/budget/ledger')).map(c => c.path)).toEqual([
            '/projects/p1/budget/ledger?limit=200&page=1', '/projects/p1/budget/ledger?limit=200&page=2']);
        fireEvent.click(tabBtn('Ledger'));
        expect([...document.querySelectorAll('#budgetLedger tr[data-cost-id]')].map(r => r.getAttribute('data-cost-id'))).toEqual(['a', 'b', 'c']);
    });

    it('Ledger: summary against the limit, the breakdown, entries as text; delete asks first', async () => {
        const { calls } = await openPage({ 'DELETE /budget/e1': {} });
        fireEvent.click(tabBtn('Ledger'));
        expect(byId('budgetSummary').textContent).toContain('$12.00');
        expect(byId('budgetSummary').textContent).toContain('12.0% used');
        expect(byId('budgetSummary').textContent).toContain('~22 days remaining');
        expect(byId('budgetBreakdown').textContent).toContain('render gpu');
        expect(screen.getByText('farm <night>')).toBeTruthy();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => { fireEvent.click(screen.getByTitle('Delete this cost entry')); });
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/budget/e1');
        confirm.mockRestore();
    });

    it('a cost entry sends amount and GPU seconds as numbers (0 when blank), the rest by the form rules', async () => {
        let posted;
        await openPage({ 'POST /projects/p1/budget': (b) => { posted = b; return {}; } });
        const m = byId('costEntryModal');
        fireEvent.change(m.querySelector('[data-field="cost_type"]'), { target: { value: 'license' } });
        fireEvent.change(m.querySelector('[data-field="amount"]'), { target: { value: '19.99' } });
        fireEvent.change(m.querySelector('[data-field="description"]'), { target: { value: ' music ' } });
        await act(async () => { fireEvent.click(m.querySelector('.btn-primary')); });
        expect(posted).toEqual({ cost_type: 'license', amount: 19.99, gpu_seconds: 0, description: 'music' });
    });

    it('the limit sends budget_total, and a currency only when one is chosen', async () => {
        const bodies = [];
        await openPage({ 'PUT /projects/p1/budget/limit': (b) => { bodies.push(b); return {}; } });
        const m = byId('budgetLimitModal');
        fireEvent.change(m.querySelector('[data-field="budget_limit"]'), { target: { value: '250' } });
        await act(async () => { fireEvent.click(m.querySelector('.btn-primary')); });
        fireEvent.change(m.querySelector('[data-field="budget_currency"]'), { target: { value: 'EUR' } });
        await act(async () => { fireEvent.click(m.querySelector('.btn-primary')); });
        expect(bodies).toEqual([{ budget_total: 250 }, { budget_total: 250, budget_currency: 'EUR' }]);
    });

    it('Film Estimate: priced on open; a generator choice and a reset re-price with the right query', async () => {
        const asked = [];
        const est = { resolution: { id: '2k', label: '2K' }, resolutions: [{ id: '2k', label: '2K' }, { id: '4k', label: '4K' }], takes: { plates: 3, storyboard: 3, footage: 2 },
            counts: { frames: 13, footage_seconds: 60, shots: 13, views: { character: 4, location: 4, prop: 1 } }, totals: { total: 300, plates: 50, storyboard: 40, footage: 210 },
            generators: { image: { provider: 'muapi', provider_label: 'MuAPI', model: 'nano' }, video: { provider: 'muapi', provider_label: 'MuAPI', model: 'sd' } },
            alternatives: { image: [], video: [{ provider: 'runway', provider_label: 'Runway', model: 'gen4.5', usd: 1, total: 400 }], post: [] },
            lines: [{ category: 'footage', count: 13, seconds: 60, takes: 2, model: 'sd', per_second_usd: 1.75, usd: 210 }], runtime: { seconds: 60, source: 'the screenplay' } };
        await openPage({ 'GET /projects/p1/budget/production': (b) => { asked.push(''); return est; } });
        const route = (p) => { asked.push(p); return est; };
        window.api.mockImplementation(async (path) => {
            if (path.startsWith('/projects/p1/budget/production')) return route(path);
            return ROUTES[`GET ${path}`];
        });
        await act(async () => { fireEvent.click(tabBtn('Film Estimate')); });
        expect(byId('prodEstResult').textContent).toContain('$300.000');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use' })); });
        expect(asked.at(-1)).toBe('/projects/p1/budget/production?video_provider=runway&video_model=gen4.5');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: "Back to the project's choices" })); });
        expect(asked.at(-1)).toBe('/projects/p1/budget/production');
        await act(async () => { fireEvent.change(document.querySelector('#prodEstControls [data-choice="resolution"]'), { target: { value: '4k' } }); });
        expect(asked.at(-1)).toBe('/projects/p1/budget/production?resolution=4k');
    });

    it('Compare: images by default, video asks for the clip length; badges say what a row cannot do', async () => {
        const asked = [];
        const r = { work: { work_label: 'Per frame', scene_label: 'Scene of 10' }, note: 'Priced per frame.',
            rows: [{ provider: 'a', provider_label: 'A', model: 'm1', max_size: '1K', available: true, usd_per_unit: 0.01, unit: 'image', units_per_work: 1, usd_per_work: 0.01, usd_per_scene: 0.1, checked: '2026-09-01', checked_age_days: 30 },
                { provider: 'b', provider_label: 'B', model: 'm2', available: false, connected: false, honours_resolution: false, usd_per_unit: 0.02, unit: 'image', units_per_work: 1, usd_per_work: 0.02, usd_per_scene: 0.2, checked: '2026-01-01', checked_age_days: 200 }],
            unpriced: [{ provider: 'c', why: 'no rate published' }] };
        const legacy = await openPage();
        legacy.fake.api.mockImplementation(async (path) => { asked.push(path); return r; });
        await act(async () => { fireEvent.click(tabBtn('Compare Generators')); });
        expect(asked.at(-1)).toBe('/spend/compare?capability=image&project_id=p1');
        const text = byId('generatorCompare').textContent;
        for (const s of ['cheapest', 'not connected', 'ignores your resolution', 'stale', 'no rate published', 'max 1K']) expect(text).toContain(s);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Video' })); });
        expect(asked.at(-1)).toBe('/spend/compare?capability=video&project_id=p1&clip_seconds=5');
        expect(byId('compareClipWrap').style.display).toBe('flex');
    });

    it('Rates: each rate with its unit, its price, its models and its source', async () => {
        const legacy = await openPage();
        legacy.fake.api.mockImplementation(async () => ({ rates: [{ provider: 'meshy', capability: 'image', unit: 'call', native_unit: 'credit', native_per_unit: 7.6, usd_per_unit: 0.15,
            checked: '2026-09-30', source: 'https://example.com/meshy', overridden: true, models: [{ model: 'nano', usd_per_native: 0.12 }] }] }));
        await act(async () => { fireEvent.click(tabBtn('Rates')); });
        const t = byId('spendRates').textContent;
        expect(t).toContain('billed as 7.60 credit(s) per call');
        expect(t).toContain('$0.15 per call');
        expect(t).toContain('overridden');
        expect(t).toContain('$0.12 per call');
        expect(byId('spendRates').querySelector('a').getAttribute('href')).toBe('https://example.com/meshy');
    });

    it('Live-action: generated once on open, re-generated per template; missing costs open the cost form, which saves by kind', async () => {
        const estimate = { stats: { scene_count: 3, shot_count: 13 }, total_estimated: 120000, template: 'indie', template_label: 'Indie', above_the_line: 50000,
            line_items: [{ category: 'above_the_line', subcategory: 'lead_cast', amount: 50000, source: 'estimated', confidence: 'high' }],
            missing_data: [{ entity_type: 'location', entity_id: 'L1', entity_name: 'DINER', suggested_range: { min: 500, max: 5000 } }], assumptions: ['12 shoot days'] };
        const asked = [];
        let put;
        const legacy = await openPage();
        legacy.fake.api.mockImplementation(async (path, opts = {}) => {
            asked.push(path);
            if (opts.method === 'PUT') { put = { path, body: JSON.parse(opts.body) }; return {}; }
            return estimate;
        });
        await act(async () => { fireEvent.click(tabBtn('Live-action Estimate')); });
        expect(asked.at(-1)).toBe('/projects/p1/budget/estimate?template=indie&refresh=true');
        expect(byId('budgetEstimateBreakdown').textContent).toContain('$120,000');
        expect(byId('budgetEstimateBreakdown').textContent).toContain('lead cast');
        await act(async () => { fireEvent.change(byId('budgetTemplateSelect'), { target: { value: 'studio' } }); });
        expect(asked.at(-1)).toBe('/projects/p1/budget/estimate?template=studio&refresh=true');
        fireEvent.click(screen.getByRole('button', { name: /DINER/ }));
        const m = byId('costInputModal');
        expect(m.querySelector('[data-field="prep_days"]')).toBeTruthy(); // a place has prep days, not a talent tier
        fireEvent.change(m.querySelector('[data-field="daily_rate"]'), { target: { value: '2500' } });
        fireEvent.change(m.querySelector('[data-field="prep_days"]'), { target: { value: '1' } });
        await act(async () => { fireEvent.click(m.querySelector('.btn-primary')); });
        expect(put).toEqual({ path: '/locations/L1/cost', body: { location_type: 'unknown', daily_rate: 2500, prep_days: 1 } });
    });

    it('the static page carries every hand-entered field (manual-edit reads these)', async () => {
        installLegacy();
        render(<BudgetPage />);
        for (const f of ['budget_limit', 'budget_currency', 'cost_type', 'amount', 'gpu_seconds', 'description', 'model_used', 'talent_tier', 'day_rate', 'shooting_days', 'actor_name', 'travel_allowance']) {
            expect(document.querySelector(`[data-field="${f}"]`), f).toBeTruthy();
        }
        expect(byId('budgetTemplateSelect')).toBeTruthy();
    });
});
