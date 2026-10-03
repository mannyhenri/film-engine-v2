import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import MilestonesPage from './MilestonesPage.jsx';

const LIST = { milestones: [
    { id: 'm1', title: 'Lock <script>', phase: 'script', status: 'completed', completion_pct: 100, target_date: '2026-09-01', actual_date: '2026-08-30', description: 'Final draft' },
    { id: 'm2', title: 'Boards', phase: 'storyboard', status: 'pending', completion_pct: null, target_date: null, actual_date: null, description: null },
] };

async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/milestones': LIST, ...routes } });
    render(<MilestonesPage />);
    await act(async () => { await window.loadMilestones(); });
    return legacy;
}
const field = (modal, name) => document.querySelector(`#${modal} [data-field="${name}"]`);

describe('Milestones', () => {
    it('draws the timeline: title as text, badges, progress, target and actual dates', async () => {
        await openPage();
        const nodes = document.querySelectorAll('.milestone-node');
        expect([...nodes].map(n => n.className)).toEqual(['milestone-node completed', 'milestone-node pending']);
        expect(screen.getByText('Lock <script>')).toBeTruthy();
        expect(nodes[0].querySelector('.milestone-progress-fill').style.width).toBe('100%');
        expect(nodes[1].querySelector('.milestone-progress-fill').style.width).toBe('0%');
        expect(nodes[0].textContent).toContain('Target: 2026-09-01');
        expect(nodes[0].textContent).toContain('Actual: 2026-08-30');
        expect(nodes[1].textContent).not.toContain('Target:');
        expect(window.state.milestones.length).toBe(2); // shared state, as the legacy page left it
    });

    it('an empty project says so', async () => {
        await openPage({ 'GET /projects/p1/milestones': { milestones: [] } });
        expect(screen.getByText('No milestones.')).toBeTruthy();
    });

    it('creates a milestone with the legacy form rules (trimmed, empty fields left out)', async () => {
        let posted;
        const { status, fake } = await openPage({ 'POST /projects/p1/milestones': (b) => { posted = b; return { ok: true }; } });
        fireEvent.click(screen.getByRole('button', { name: '+ Milestone' }));
        expect(fake.showModal).toHaveBeenCalledWith('milestoneModal');
        fireEvent.change(field('milestoneModal', 'title'), { target: { value: '  Picture lock ' } });
        fireEvent.change(field('milestoneModal', 'phase'), { target: { value: 'post-production' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })); });
        expect(posted).toEqual({ title: 'Picture lock', phase: 'post-production' });
        expect(fake.closeModal).toHaveBeenCalledWith('milestoneModal');
        expect(status).toContain('Milestone created');
        expect(field('milestoneModal', 'title').value).toBe(''); // cleared, as clearModal did
    });

    it('a milestone with no title is not sent', async () => {
        const { calls } = await openPage();
        fireEvent.click(screen.getByRole('button', { name: '+ Milestone' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })); });
        expect(calls.some(c => c.method === 'POST')).toBe(false);
    });

    it('edit opens with the milestone\'s values and saves the changes as numbers where numeric', async () => {
        let put;
        const { status } = await openPage({ 'PUT /projects/p1/milestones/m1': (b) => { put = b; return { ok: true }; } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
        expect(field('editMilestoneModal', 'status').value).toBe('completed');
        expect(field('editMilestoneModal', 'completion_pct').value).toBe('100');
        expect(field('editMilestoneModal', 'description').value).toBe('Final draft');
        fireEvent.change(field('editMilestoneModal', 'completion_pct'), { target: { value: '80' } });
        fireEvent.change(field('editMilestoneModal', 'status'), { target: { value: 'in_progress' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(put).toEqual({ status: 'in_progress', completion_pct: 80, target_date: '2026-09-01', description: 'Final draft' });
        expect(status).toContain('Milestone updated');
    });

    it('an unset value opens empty, never "null"', async () => {
        await openPage();
        fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
        expect(field('editMilestoneModal', 'completion_pct').value).toBe('');
        expect(field('editMilestoneModal', 'description').value).toBe('');
    });

    it('a failure is said on the status bar', async () => {
        const legacy = installLegacy({ routes: {} });
        render(<MilestonesPage />);
        await act(async () => { await window.loadMilestones(); });
        expect(legacy.status[0]).toMatch(/^Error: /);
    });
});
