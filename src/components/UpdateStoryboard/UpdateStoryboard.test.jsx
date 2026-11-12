import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import UpdateStoryboard, { MODAL_ID } from './UpdateStoryboard.jsx';

// The Screenplay page's Update storyboard: save, plan for free (shown card by card), then confirm to write that plan.
const PLAN = {
    plan_id: 'plan-1', applied: false, cards_to_update: 2, dialogue_changes: 3, cards_marked_current: 3, spends: 0, notes: [],
    scenes: [{
        scene_id: 's1', scene_number: '1', heading: 'INT. DINER - DAY', screenplay_changed: true, unplaced_lines: [],
        unchanged: ['1C'],
        shots: [
            { shot_id: 'a', shot_code: '1A', changes: [
                { kind: 'line_changed', character: 'RAY', from_character: 'RAY', from: 'You look like her.', to: 'You look just like her.', similar: true }] },
            { shot_id: 'b', shot_code: '1B', changes: [
                { kind: 'line_added', character: 'JUNE', line: 'Every other Sunday.', after: "Coffee's still bad here." },
                { kind: 'line_removed', character: 'RAY', line: 'They only have four.' }] },
        ],
    }],
};
const DONE = { ...PLAN, applied: true };

function editor(text = 'INT. DINER - DAY\n\nRAY\nYou look just like her.\n') {
    const el = document.createElement('div'); el.id = 'screenplayEditor'; document.body.appendChild(el);
    const screenplay = {
        currentScriptVersion: 3, editorDirty: true,
        performAutoSave: vi.fn(async () => { screenplay.editorDirty = false; }),
        serializeEditorToFountain: vi.fn(() => text),
    };
    return screenplay;
}

async function setup({ routes = {}, project = { id: 'p1' }, page = 'screenplay', screenplay = editor() } = {}) {
    const legacy = installLegacy({ project, routes: {
        'GET /projects/p1/screenplay-drift': { shots_behind: 3, scenes: [{}] },
        'GET /projects/p1/scripts': { scripts: [{ version: 3 }, { version: 2 }] },
        'PUT /projects/p1/script/3': { script: { version: 3 } },
        'GET /projects/p1/storyboard-update': PLAN,
        'POST /projects/p1/storyboard-update': DONE,
        ...routes } });
    legacy.fake.state.currentPage = page;
    await act(async () => { render(<UpdateStoryboard screenplay={screenplay} />); });
    return { ...legacy, screenplay };
}
const button = () => document.getElementById('updateStoryboardBtn');
const modal = () => document.getElementById(MODAL_ID);
// Each card as its parts read: the heading, the count, then each change's mark and words.
const shotTexts = () => [...modal().querySelectorAll('.usb-shot')].map(s => [...s.querySelectorAll('.usb-shot-head > *, .usb-change > *')]
    .map(el => el.textContent.replace(/\s+/g, ' ').trim()).join('|'));
async function openPlan() { await act(async () => { fireEvent.click(button()); }); }
afterEach(() => { document.getElementById('screenplayEditor')?.remove(); vi.restoreAllMocks(); });

describe('Update storyboard', () => {
    it('is one button, marked while the screenplay is ahead of the board', async () => {
        await setup();
        expect(button().textContent).toContain('Update storyboard');
        await waitFor(() => expect(button().querySelector('.usb-dot')).not.toBeNull());
        expect(button().title).toMatch(/changed after 3 storyboard cards/);
    });

    it('reads nothing while another page is in view (every page is mounted at boot)', async () => {
        const { calls } = await setup({ page: 'storyboard' });
        expect(calls).toEqual([]);
        expect(button().querySelector('.usb-dot')).toBeNull();
    });

    it('without a project it says to open one and asks nothing', async () => {
        const { calls, status } = await setup({ project: null });
        await openPlan();
        expect(status).toContain('Open a project first');
        expect(calls).toEqual([]);
    });

    it('saves the editor, then shows for free which cards change and how, card by card, writing nothing to the board', async () => {
        const { calls, fake, screenplay } = await setup();
        await openPlan();
        expect(fake.showModal).toHaveBeenCalledWith(MODAL_ID);
        expect(screenplay.performAutoSave).toHaveBeenCalledTimes(1);
        // The save brings the scenes up to date with what is on the page, into the version being edited, quietly.
        const put = calls.find(c => c.method === 'PUT');
        expect(put).toEqual({ method: 'PUT', path: '/projects/p1/script/3', body: { fountain_content: screenplay.serializeEditorToFountain(), sync_scenes: true } });
        expect(fake.api.mock.calls.find(([p, o]) => o && o.method === 'PUT')[1].refresh).toBe(false);
        // The plan is a GET, after the save; nothing is posted to the board.
        const order = calls.map(c => `${c.method} ${c.path}`);
        expect(order.indexOf('GET /projects/p1/storyboard-update')).toBeGreaterThan(order.indexOf('PUT /projects/p1/script/3'));
        expect(calls.some(c => c.method === 'POST')).toBe(false);

        expect(modal().querySelector('[data-usb="summary"]').textContent).toMatch(/2 cards will be updated \(3 dialogue changes\)\. Free: nothing is generated and nothing is spent\. Nothing is written until you confirm\./);
        expect(shotTexts()).toEqual([
            'Shot 1A|will be updated: 1 change|~|RAY: “You look like her.” → “You look just like her.”',
            'Shot 1B|will be updated: 2 changes|+|JUNE: “Every other Sunday.” after “Coffee\'s still bad here.”|−|RAY: “They only have four.” cut from the screenplay',
        ]);
        expect(modal().querySelector('.usb-unchanged').textContent).toBe('Unchanged: Shot 1C (will be recorded as matching the new draft).');
        expect(document.getElementById('confirmStoryboardUpdate').textContent).toBe('Update 2 cards');
    });

    it('confirming writes exactly the reviewed plan, then offers the Storyboard', async () => {
        const { calls, fake, status } = await setup();
        await openPlan();
        await act(async () => { fireEvent.click(document.getElementById('confirmStoryboardUpdate')); });
        expect(calls.filter(c => c.method === 'POST')).toEqual([{ method: 'POST', path: '/projects/p1/storyboard-update', body: { plan_id: 'plan-1' } }]);
        expect(modal().querySelector('[data-usb="done"]').textContent).toMatch(/^Updated 2 cards\./);
        expect(status).toContain('Storyboard updated: 2 cards.');
        expect(document.getElementById('confirmStoryboardUpdate')).toBeNull();
        expect(button().querySelector('.usb-dot')).toBeNull();
        fireEvent.click([...modal().querySelectorAll('button')].find(b => b.textContent === 'Open Storyboard'));
        expect(fake.navigateTo).toHaveBeenCalledWith('storyboard');
        expect(fake.closeModal).toHaveBeenCalledWith(MODAL_ID);
    });

    it('if the screenplay moved after the plan was shown, nothing is written and the new plan is shown to confirm again', async () => {
        const moved = { ...PLAN, plan_id: 'plan-2', cards_to_update: 1, scenes: [{ ...PLAN.scenes[0], shots: [PLAN.scenes[0].shots[0]] }] };
        const { status } = await setup({ routes: { 'POST /projects/p1/storyboard-update': () => {
            const e = new Error('The screenplay or the cards changed since this plan was made.'); e.status = 409; e.data = { plan: moved }; throw e;
        } } });
        await openPlan();
        await act(async () => { fireEvent.click(document.getElementById('confirmStoryboardUpdate')); });
        expect(modal().querySelector('[data-usb="changed"]')).not.toBeNull();
        expect(shotTexts().map(t => t.slice(0, 7))).toEqual(['Shot 1A']);
        expect(document.getElementById('confirmStoryboardUpdate').textContent).toBe('Update 1 card');
        expect(status.some(s => /updated/i.test(s))).toBe(false);
    });

    it('never writes into an older version open in the editor: the plan follows the latest', async () => {
        const screenplay = editor(); screenplay.currentScriptVersion = 2;
        const { calls } = await setup({ screenplay });
        await openPlan();
        expect(calls.some(c => c.method === 'PUT')).toBe(false);
        expect(screenplay.performAutoSave).not.toHaveBeenCalled();
        expect(modal().textContent).toMatch(/You are viewing v2\. The storyboard follows the latest version, v3/);
        expect(shotTexts()).toHaveLength(2);
    });

    it('a screenplay never saved is saved first (its first version), and nothing is written into a version by hand', async () => {
        const screenplay = editor(); screenplay.currentScriptVersion = null;
        const { calls } = await setup({ screenplay });
        await openPlan();
        expect(screenplay.performAutoSave).toHaveBeenCalledTimes(1);
        expect(calls.some(c => c.method === 'PUT')).toBe(false);
        expect(shotTexts()).toHaveLength(2);
    });

    it('says so when the board already matches, and offers nothing to confirm', async () => {
        await setup({ routes: { 'GET /projects/p1/storyboard-update': { ...PLAN, cards_to_update: 0, dialogue_changes: 0, cards_marked_current: 0, scenes: [] } } });
        await openPlan();
        expect(modal().querySelector('[data-usb="in-step"]').textContent).toMatch(/already matches the screenplay/);
        expect(document.getElementById('confirmStoryboardUpdate')).toBeNull();
    });

    it('a failed save stops before the plan', async () => {
        const screenplay = editor(); screenplay.performAutoSave = vi.fn(async () => {}); // stays dirty: the save failed
        const { calls } = await setup({ screenplay });
        await openPlan();
        expect(modal().querySelector('[data-usb="error"]').textContent).toMatch(/Could not save the screenplay/);
        expect(calls.some(c => c.path.endsWith('/storyboard-update'))).toBe(false);
    });
});
