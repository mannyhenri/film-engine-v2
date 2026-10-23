import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import JobsQueuePage, { whenOf } from './JobsQueuePage.jsx';

// The Job Queue, end to end against the fake core: the route and lines the legacy page produced.
const JOBS = { total: 3, summary: { active: 1, failed: 1, complete: 1 }, jobs: [
    { id: 'j1', job_type: 'video', status: 'complete', prompt: 'slow push <in>' },
    { id: 'j2', job_type: 'image', status: 'failed', model: 'flux', error_message: 'quota' },
    { id: 'j3', job_type: 'voice', status: 'queued' },
] };
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/jobs': JOBS, ...routes } });
    render(<JobsQueuePage />);
    await act(async () => { await window.loadJobsQueuePage(); });
    return legacy;
}

describe('Job Queue', () => {
    it('answers to the loader (and the nav button calling it by name): the counts and each job', async () => {
        const { calls } = await openPage();
        expect(calls).toEqual([{ method: 'GET', path: '/projects/p1/jobs', body: undefined }]);
        expect([...document.querySelectorAll('.stat-card')].map(c => c.textContent)).toEqual(['3Total jobs', '1Active', '1Failed', '1Complete']);
        const cards = [...document.querySelectorAll('#jobsQueueList .card')].map(c => c.textContent);
        expect(cards).toEqual(['video j1completeslow push <in>', 'image j2failedfluxquota', 'voice j3queuedNo prompt/model recorded']);
        expect(within(document.getElementById('jobsQueueList')).getByText('complete').style.color).toBe('rgb(22, 163, 74)');
        expect(within(document.getElementById('jobsQueueList')).getByText('failed').style.color).toBe('rgb(220, 38, 38)');
        expect(within(document.getElementById('jobsQueueList')).getByText('queued').style.color).toBe('rgb(245, 158, 11)');
    });

    it('no jobs says so; a failure shows the error and an empty list; Refresh asks again', async () => {
        const { calls } = await openPage({ 'GET /projects/p1/jobs': { total: 0, jobs: [] } });
        expect(screen.getByText('No generation jobs for this project yet.')).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByText('Refresh')); });
        expect(calls.length).toBe(2);
        await openPage({ 'GET /projects/p1/jobs': () => { throw new Error('offline'); } });
        expect(screen.getByText('offline')).toBeTruthy();
        expect(document.querySelectorAll('#jobsQueueList')[1].children.length).toBe(0);
    });

    it('without a project it says to open one, and asks nothing', async () => {
        const legacy = installLegacy({ project: null });
        render(<JobsQueuePage />);
        await act(async () => { await window.loadJobsQueuePage(); });
        expect(legacy.calls).toEqual([]);
        expect(legacy.status).toContain('Open a project first');
    });

    it('search, filter and sort the jobs shown; the summary still counts every job; no match says so', async () => {
        await openPage();
        const ids = () => [...document.querySelectorAll('#jobsQueueList .card .text-muted')].map(e => e.textContent).filter(t => /^j\d$/.test(t));
        fireEvent.change(document.querySelector('[data-list-search]'), { target: { value: 'QUOTA' } });
        expect(ids()).toEqual(['j2']);
        expect(document.querySelector('.stat-card').textContent).toBe('3Total jobs');
        fireEvent.change(document.querySelector('[data-list-search]'), { target: { value: 'nothing-here' } });
        expect(document.querySelector('[data-list-nomatch]')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        fireEvent.change(document.querySelector('[data-list-filter="status"]'), { target: { value: 'queued' } });
        expect(ids()).toEqual(['j3']);
        fireEvent.change(document.querySelector('[data-list-filter="status"]'), { target: { value: '' } });
        fireEvent.change(document.querySelector('[data-list-sort]'), { target: { value: 'type' } });
        expect(ids()).toEqual(['j2', 'j1', 'j3']);
    });

    it('each job says when it happened, in local time, with how long ago', () => {
        const now = Date.parse('2026-10-23T12:00:00Z');
        expect(whenOf('2026-10-23 11:46:00', now)).toMatch(/Oct 23.*14 min ago$/);   // SQLite's UTC, no zone written
        expect(whenOf('2026-10-21T12:00:00.000Z', now)).toMatch(/Oct 21.*48 h ago$|Oct 21.*2 days ago$/);
        expect(whenOf(null, now)).toBe('');
    });

    it('Clear finished jobs hides them (only the finished ones), Show cleared brings them into view, Restore puts them back', async () => {
        let cleared = 0;
        const all = { total: 3, cleared: 0, summary: {}, jobs: JOBS.jobs.map(j => ({ ...j, created_at: '2026-10-23 11:00:00', is_active: j.status === 'queued' })) };
        const { calls } = await openPage({
            'GET /projects/p1/jobs': () => (cleared ? { ...all, total: 1, cleared, jobs: all.jobs.filter(j => j.is_active) } : all),
            'GET /projects/p1/jobs?include_cleared=1': () => ({ ...all, cleared }),
            'POST /projects/p1/jobs/clear': () => { cleared = 2; return { cleared: 2 }; },
            'POST /projects/p1/jobs/restore': () => { const n = cleared; cleared = 0; return { restored: n }; },
        });
        expect(document.querySelector('[data-job-id="j1"]').textContent).toMatch(/Oct 23/);
        expect([...document.querySelectorAll('[data-job-active="true"]')].map(c => c.dataset.jobId)).toEqual(['j3']);
        await act(async () => { fireEvent.click(screen.getByText('Clear finished jobs')); });
        expect([...document.querySelectorAll('#jobsQueueList .card')].map(c => c.dataset.jobId)).toEqual(['j3']);
        expect(screen.getByText('Clear finished jobs').disabled).toBe(true);
        await act(async () => { fireEvent.click(screen.getByLabelText(/Show cleared \(2\)/)); });
        expect(document.querySelectorAll('#jobsQueueList .card').length).toBe(3);
        await act(async () => { fireEvent.click(screen.getByText('Restore cleared')); });
        expect(calls.some(c => c.path === '/projects/p1/jobs/restore')).toBe(true);
        expect(document.querySelectorAll('#jobsQueueList .card').length).toBe(3);
        expect(screen.queryByText('Restore cleared')).toBeNull();
    });
});
