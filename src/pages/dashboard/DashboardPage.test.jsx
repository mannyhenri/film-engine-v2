import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import DashboardPage from './DashboardPage.jsx';

// The home page, end to end against the fake core: the routes and lines the legacy home produced,
// and every block's way in.
const HOME = {
    greeting: { salutation: 'Good morning', name: 'Manny', project_title: 'From <the> Mist', shot_count: 1, scene_count: 3, last_opened: 'yesterday' },
    resume: { shot_id: 's7', shot_code: '2B', has_keyframe: true, headline: 'Shot 2B', summary: 'She turns', state: 'frame ready', when: '2h ago' },
    needs: [{ label: 'Lock MAYA', page: 'consistency', phase: 'plan' }, { label: 'No voice', page: 'characters' }],
    phases: [{ page: 'screenplay', label: 'Write', done: 3, of: 4, note: 'one scene left' }, { page: 'previs', label: 'Previs', done: 0, of: 0, note: '' }],
    activity: [{ when: '09:12', what: 'Frame <2B>' }],
    running: [{ kind: 'video', shot_code: '1A', status: 'running' }, { kind: 'voice', status: 'queued' }],
};
const PANELS = {
    'run-plan': { total_items: 4, strips: [1, 2], model_switches: 1, projected_cost: 1.5 },
    staleness: { summary: { stale: 2, fresh: 5, unknown: 0 } },
    dood: { characters: [1], needs_plate: [] },
    sides: { speaking: 3, non_speaking: [1] },
    'elements-list': { elements: { characters: [1], locations: [1, 2], props: [] }, undescribed: [1] },
    'breakdown-summary': { totals: { scenes: 3, shots: 9, dialogue_lines: 12 } },
    setups: { setups: [1], reused_shots: 2 },
    'board-groups': { groups: [1, 2], axis: 'scene' },
    'run-report': () => { throw new Error('no runs table <yet>'); },
};
async function openPage(routes = {}) {
    const all = { 'GET /projects/p1/home': HOME, ...Object.fromEntries(Object.entries(PANELS).map(([k, v]) => [`GET /projects/p1/${k}`, v])), ...routes };
    const legacy = installLegacy({ routes: all });
    render(<DashboardPage />);
    await act(async () => { await window.loadDashboard(); });
    await waitFor(() => expect(document.querySelectorAll('#homePanels .home-panel').length).toBe(9));
    return legacy;
}
const el = (id) => document.getElementById(id);

describe('Home', () => {
    it('answers to the loader: one /home read, then the nine panels concurrently; the status line', async () => {
        const { calls, status } = await openPage();
        expect(calls[0].path).toBe('/projects/p1/home');
        expect(calls.slice(1).map(c => c.path).sort()).toEqual(Object.keys(PANELS).map(k => `/projects/p1/${k}`).sort());
        expect(status).toEqual(['From <the> Mist · 1 shots']);
    });

    it('the greeting, resume (with its frame), needs, phases, activity and running, as text', async () => {
        await openPage();
        expect(el('homeGreeting').textContent).toBe('Good morning, MannyFrom <the> Mist · 1 shot across 3 scenes · last opened yesterday');
        expect(el('homeResume').querySelector('img').getAttribute('src')).toBe('http://api.test/film/storyboards/p1/2B.png');
        expect(el('homeResume').textContent).toMatch(/Shot 2BShe turnsframe ready · 2h ago/);
        expect([...el('homeNeeds').querySelectorAll('.home-need')].map(n => n.textContent)).toEqual(['Lock MAYAPlan', 'No voiceOpen']);
        expect([...el('homePhases').querySelectorAll('.home-phase')].map(p => [p.querySelector('.frac').textContent, p.querySelector('.fill').style.width])).toEqual([['3/4', '75%'], ['0/0', '0%']]);
        expect(el('homeActivity').textContent).toBe('Recent activity09:12Frame <2B>');
        expect([...el('homeRunning').querySelectorAll('.home-run')].map(r => [r.querySelector('.row').textContent, r.querySelector('.fill').style.width]))
            .toEqual([['video — 1Arunning', '60%'], ['voicequeued', '15%']]);
    });

    it('every block carries its way in', async () => {
        const { fake } = await openPage();
        fireEvent.click(within(el('homeNeeds')).getByText('Plan'));
        fireEvent.click(within(el('homePhases')).getByText('Write'));
        fireEvent.click(within(el('homeRunning')).getByText('Open job queue →'));
        fireEvent.click(within(el('homeResume')).getByText('Open board'));
        expect(fake.navigateTo.mock.calls.map(c => c[0])).toEqual(['consistency', 'screenplay', 'jobsqueue', 'storyboard']);
    });

    it('Resume goes to the board AND opens the frame', async () => {
        const { fake } = await openPage();
        await act(async () => { fireEvent.click(screen.getByText('Resume')); });
        expect(fake.navigateTo).toHaveBeenCalledWith('storyboard');
        expect(fake.openFrameViewer).toHaveBeenCalledWith('s7');
    });

    it('each panel says what it found and opens its page; one that cannot load says why, not "nothing"', async () => {
        const { fake } = await openPage();
        const panel = (title) => [...document.querySelectorAll('.home-panel')].find(p => p.querySelector('strong').textContent === title);
        expect(panel('Run plan').querySelector('p').textContent).toBe('4 item(s) in 2 strip(s) · 1 model switch(es) · $1.50');
        expect(panel('Elements').querySelector('p').textContent).toBe('1 characters · 2 locations · 0 props · 1 undescribed');
        expect(panel('Runs').querySelector('p').textContent).toBe('no runs table <yet>');
        expect(panel('Runs').querySelector('p').className).toBe('text-sm text-muted');
        fireEvent.click(within(panel('Setups')).getByText('Open'));
        fireEvent.click(panel('Staleness'));
        expect(fake.navigateTo.mock.calls.map(c => c[0])).toEqual(['shotboard', 'storyboard']);
    });

    it('every empty block says so; Running still offers the queue', async () => {
        await openPage({ 'GET /projects/p1/home': { greeting: { salutation: 'Hello', project_title: 'X', shot_count: 0, scene_count: 1 }, resume: null, needs: [], phases: [], activity: [], running: [] } });
        expect(el('homeGreeting').textContent).toBe('HelloX · 0 shots across 1 scene');
        expect(screen.getByText('Nothing worked on yet.')).toBeTruthy();
        expect(screen.getByText('Nothing is blocking the film.')).toBeTruthy();
        expect(screen.getByText('Nothing generated yet.')).toBeTruthy();
        expect(screen.getByText('Nothing is generating.')).toBeTruthy();
        expect(screen.getByText('Open job queue →')).toBeTruthy();
    });

    it('nothing without a project; a failed /home says so and stops', async () => {
        const none = installLegacy({ project: null });
        render(<DashboardPage />);
        await act(async () => { await window.loadDashboard(); });
        expect(none.calls).toEqual([]);
        const legacy = installLegacy({ routes: { 'GET /projects/p1/home': () => { throw new Error('offline'); } } });
        render(<DashboardPage />);
        await act(async () => { await window.loadDashboard(); });
        expect(legacy.status).toEqual(['Could not load home: offline']);
        expect(legacy.calls.length).toBe(1);
    });
});
