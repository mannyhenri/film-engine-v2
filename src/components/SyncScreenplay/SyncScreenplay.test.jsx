import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import SyncScreenplay, { staleSummary } from './SyncScreenplay.jsx';

// The top bar's Sync screenplay: drift count, dry run, apply, and the list handed to Claude.
const DRIFT = { scenes: [{ scene_number: '2', shots_behind: [] }, { scene_number: '5', shots_behind: [] }] };
const PLAN = {
    cards_changed: 2, needs_a_person: 3,
    plan: [
        { scene_number: '2', heading: 'INT. DINER - NIGHT', shots: [
            { shot_code: '2A', updates: [{ field: 'characters', from: [], to: ['MAYA'] }] },
            { shot_code: '2B', updates: [{ field: 'props', from: [], to: ['mug'] }, { field: 'location', from: 'A', to: 'B' }] },
            { shot_code: '2C', updates: [] }],
          needs_a_person: [
            { kind: 'description_may_be_stale', shot_code: '2A', why: '…' },
            { kind: 'dialogue_changed_or_gone', shot_code: '2B', line: 'RAY: Not tonight.', why: '…' }] },
        { scene_number: '5', heading: 'EXT. ROAD', shots: [], needs_a_person: [{ kind: 'no_shot_covers_this', line: 'MAYA: Run.', why: '…' }] },
    ],
};
function mountRail() {
    const top = document.createElement('div'); top.className = 'fe-top';
    const rail = document.createElement('div'); rail.className = 'fe-rail';
    const home = document.createElement('button'); home.className = 'fe-rail-btn'; home.dataset.rail = 'dashboard';
    rail.appendChild(home); top.appendChild(rail); document.body.appendChild(top);
    return rail;
}
async function setup(routes = {}, project = { id: 'p1', title: 'From the Mist' }) {
    const rail = mountRail();
    const legacy = installLegacy({ project, routes: {
        'GET /projects/p1/screenplay-drift': DRIFT,
        'POST /projects/p1/shots-resync': (b) => (b.apply ? { ...PLAN, applied: true } : PLAN), ...routes } });
    await act(async () => { render(<SyncScreenplay />); });
    return { rail, ...legacy };
}
afterEach(() => { document.querySelector('.fe-top')?.remove(); vi.restoreAllMocks(); });

describe('Sync screenplay', () => {
    it('sits first in the top bar rail (the shell’s buttons untouched) and shows how many scenes moved on', async () => {
        const { rail } = await setup();
        await waitFor(() => expect(document.getElementById('syncScreenplayBtn').textContent).toBe('Sync (2)'));
        expect(rail.querySelectorAll('.fe-rail-btn').length).toBe(2);
        expect(rail.querySelector('.fe-rail-btn').id).toBe('syncScreenplayBtn');
    });

    it('without a project it says to open one and asks nothing', async () => {
        const { calls, status } = await setup({}, null);
        fireEvent.click(document.getElementById('syncScreenplayBtn'));
        expect(status).toContain('Open a project first');
        expect(calls).toEqual([]);
    });

    it('opening it runs the free comparison (a DRY run) and lists what will change and what needs you', async () => {
        const { calls, fake } = await setup();
        await act(async () => { fireEvent.click(document.getElementById('syncScreenplayBtn')); });
        expect(fake.showModal).toHaveBeenCalledWith('syncScreenplayModal');
        expect(calls.find(c => c.method === 'POST')).toEqual({ method: 'POST', path: '/projects/p1/shots-resync', body: { apply: false } });
        expect([...document.querySelectorAll('#syncChanges .text-sm')].map(d => d.textContent)).toEqual(['Sc 2 / 2A: characters', 'Sc 2 / 2B: props, location']);
        expect([...document.querySelectorAll('#syncNeeds [data-kind]')].map(d => d.textContent)).toEqual([
            'Sc 2 / 2A: Description may no longer match the scene',
            'Sc 2 / 2B: Dialogue on the card changed or was cut — “RAY: Not tonight.”',
            'Sc 5: A line no shot covers yet — “MAYA: Run.”',
        ]);
        expect(screen.getByText('Sync 2 cards')).toBeTruthy();
    });

    it('Sync applies, says what changed and what still needs you, and recounts', async () => {
        const { calls, status } = await setup();
        await act(async () => { fireEvent.click(document.getElementById('syncScreenplayBtn')); });
        await act(async () => { fireEvent.click(screen.getByText('Sync 2 cards')); });
        expect(calls.filter(c => c.method === 'POST').map(c => c.body)).toEqual([{ apply: false }, { apply: true }]);
        expect(status).toContain('2 card(s) reconciled. 3 item(s) still need you.');
        expect(screen.getByText('2 card(s) updated.')).toBeTruthy();
        expect(screen.queryByText('Sync 2 cards')).toBeNull();
    });

    it('nothing to change says so, offers no Sync; a failed comparison says why', async () => {
        await setup({ 'POST /projects/p1/shots-resync': { cards_changed: 0, needs_a_person: 0, plan: [] } });
        await act(async () => { fireEvent.click(document.getElementById('syncScreenplayBtn')); });
        expect(screen.getByText('The shot cards already match the screenplay.')).toBeTruthy();
        expect(screen.queryByText(/^Sync \d+ card/)).toBeNull();
        document.querySelector('.fe-top').remove();
        await setup({ 'POST /projects/p1/shots-resync': () => { throw new Error('offline'); } });
        await act(async () => { fireEvent.click(document.querySelectorAll('#syncScreenplayBtn')[0]); });
        expect(screen.getByText('Could not compare: offline')).toBeTruthy();
    });

    it('the stale descriptions are copied as a plain list for Claude', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const { status } = await setup();
        await act(async () => { fireEvent.click(document.getElementById('syncScreenplayBtn')); });
        await act(async () => { fireEvent.click(screen.getByText('Copy the list for Claude')); });
        expect(writeText).toHaveBeenCalledWith('Film Engine project "From the Mist" (p1).\nThe screenplay changed; these shot descriptions may no longer match their scene:\n- Scene 2 (INT. DINER - NIGHT): shot 2A');
        expect(status).toContain('Copied — paste it to Claude to update those descriptions');
    });

    it('the summary lists only description items', () => {
        expect(staleSummary({ id: 'x', title: 'T' }, PLAN.plan).split('\n').filter(l => l.startsWith('- '))).toEqual(['- Scene 2 (INT. DINER - NIGHT): shot 2A']);
    });
});
