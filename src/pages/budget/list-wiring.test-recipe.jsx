// How budget's list is mounted for src/pages/list-wiring.test.jsx: the page on rows, and the keys of what it draws.
import { render, act, fireEvent } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 'c1', cost_type: 'render_gpu', amount: 12, description: 'farm night', model_used: 'SDXL', created_at: '2026-10-01' },
            { id: 'c2', cost_type: 'voice_tts', amount: 3, description: 'table read', model_used: 'eleven', created_at: '2026-10-03' },
            { id: 'c3', cost_type: 'license', amount: 40, description: 'stock music', model_used: 'catalogue', created_at: '2026-10-02' },
        ];
        installLegacy({ routes: {
            'GET /projects/p1/spend': {}, 'GET /spend/subscription?project_id=p1': {},
            'GET /projects/p1/budget': { total_spent: 55, budget_total: 100, breakdown: [] },
            'GET /projects/p1/budget/ledger?limit=200&page=1': { entries: rows, pages: 1 },
            'GET /projects/p1/budget/forecast': {},
        } });
        const Page = (await import('./BudgetPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadBudget(); });
        fireEvent.click([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ledger'));
        return { rows, keys: () => [...document.querySelectorAll('#budgetLedger tr[data-cost-id]')].map(r => r.getAttribute('data-cost-id')) };
    },
};
