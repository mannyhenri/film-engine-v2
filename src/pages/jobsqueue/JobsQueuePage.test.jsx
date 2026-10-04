import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import JobsQueuePage from './JobsQueuePage.jsx';

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
});
