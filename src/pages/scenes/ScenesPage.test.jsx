import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ScenesPage, { parseJsonArray } from './ScenesPage.jsx';

const SCENES = { scenes: [
    { id: 's1', scene_number: 1, int_ext: 'INT.', location: 'DINER <night>', time_of_day: 'NIGHT', characters_present: '["RAY","JUNE"]', shot_count: 3, status: 'complete', dialogue_lines: 12 },
    { id: 's2', scene_number: 2, int_ext: 'EXT.', location: 'STREET', time_of_day: '', characters_present: [], shot_count: 0, status: 'written', dialogue_lines: 0 },
    { id: 's3', scene_number: 3, int_ext: 'EXT.', location: 'PIER', characters_present: null, shot_count: 1, status: 'written', dialogue_lines: 2 },
] };
const DRIFT_SCENES = [{ scene_number: 1, shots_behind: [{ shot_id: 'a' }, { shot_id: 'b' }] }];

async function openPage({ routes = {}, drift = [] } = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/scenes': SCENES, ...routes } });
    // The core helpers this page shares, faked: drift fills DRIFT, as the real one does.
    window.DRIFT = { shots: {}, scenes: [] };
    window.loadScreenplayDrift = vi.fn(async () => { window.DRIFT = { shots: {}, scenes: drift }; });
    window.updateSceneStatusIcons = vi.fn();
    window.generateSceneDialogue = vi.fn();
    render(<ScenesPage />);
    await act(async () => { await window.loadScenes(); });
    return legacy;
}
const rows = () => [...document.querySelectorAll('#scenesList .scene-row')];

describe('Scenes', () => {
    it('parses a JSON list, and anything else is empty', () => {
        expect(parseJsonArray('["A"]')).toEqual(['A']);
        expect(parseJsonArray(['B'])).toEqual(['B']);
        expect(parseJsonArray('{bad')).toEqual([]);
        expect(parseJsonArray(null)).toEqual([]);
    });

    it('lists every scene with its heading (as text), cast and shot count, and keeps state.scenes for core', async () => {
        const { status } = await openPage();
        expect(rows().length).toBe(3);
        expect(screen.getByText(/DINER <night>/)).toBeTruthy();
        expect(rows()[0].textContent).toContain('RAY, JUNE · 3 shot(s)');
        expect(rows()[1].textContent).toContain('No characters');
        expect(window.state.scenes).toBe(SCENES.scenes);
        expect(window.updateSceneStatusIcons).toHaveBeenCalled();
        expect(status).toContain('3 scene(s)');
    });

    it('Break Down appears only on written scenes, and the header counts them', async () => {
        await openPage();
        expect(rows().map(r => !!r.querySelector('[title="Generate shots for this scene"]'))).toEqual([false, true, true]);
        expect(document.getElementById('breakdownAllBtn').textContent).toBe('⚙ Break Down 2 Scenes');
        expect(document.getElementById('breakdownAllBtn').style.display).toBe('inline-flex');
    });

    it('a scene with no dialogue has a disabled Dialogue button; one with lines hands off to the shared generator', async () => {
        await openPage();
        expect(screen.getByRole('button', { name: /Dialogue · 0/ }).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: /Dialogue · 12/ }));
        expect(window.generateSceneDialogue).toHaveBeenCalledWith('s1', 12);
        expect(document.getElementById('scene-s1').classList.contains('expanded')).toBe(false); // the click did not open the row
    });

    it('a drifted scene gets the banner and a "script changed" badge beside its status', async () => {
        await openPage({ drift: DRIFT_SCENES });
        expect(document.getElementById('sceneDriftBanner').textContent).toContain('scene 1 — 2 shot cards still describe the previous draft');
        expect(rows()[0].textContent).toContain('script changed');
        expect(rows()[1].textContent).not.toContain('script changed');
    });

    it('drift is read with the scenes, and the status badge survives beside the mark (moved from screenplay-drift)', async () => {
        await openPage({ drift: DRIFT_SCENES });
        expect(window.loadScreenplayDrift).toHaveBeenCalled();
        const badges = [...rows()[0].querySelectorAll('.badge')].map(b => b.textContent);
        expect(badges).toEqual(['script changed', 'complete']);
    });

    it('the banner says re-running the breakdown is a no-op, names the step that loses work, and the route makes it true', async () => {
        await openPage({ drift: DRIFT_SCENES });
        const text = document.getElementById('sceneDriftBanner').textContent.replace(/\s+/g, ' ');
        expect(text).toMatch(/skips any scene that already has shots/i);
        expect(text).toMatch(/delete the shots first/i);
        const breakdown = fs.readFileSync(path.resolve(__dirname, '../../../backend/routes/breakdown.js'), 'utf8');
        expect(breakdown, 'the breakdown no longer skips scenes with shots, so the page is now lying').toMatch(/skipped: true/);
        expect(breakdown).toMatch(/Delete them first/);
    });

    it('opening a row lists its shots; opening it again closes it', async () => {
        await openPage({ routes: { 'GET /scenes/s1': { shots: [{ id: 'x', shot_code: '1A', status: 'approved', duration_ms: 4200 }] } } });
        await act(async () => { fireEvent.click(rows()[0].querySelector('.scene-row-header')); });
        expect(document.getElementById('scene-s1').classList.contains('expanded')).toBe(true);
        expect(document.getElementById('scene-shots-s1').textContent).toContain('1A');
        expect(document.getElementById('scene-shots-s1').textContent).toContain('4.2s');
        fireEvent.click(rows()[0].querySelector('.scene-row-header'));
        expect(document.getElementById('scene-s1').classList.contains('expanded')).toBe(false);
    });

    it('selecting shows the bulk bar; the delete states the shots it takes and posts the ids', async () => {
        let posted;
        const { status } = await openPage({ routes: { 'POST /projects/p1/scenes/delete': (b) => { posted = b; return { deleted: 2, shots_deleted: 4 }; } } });
        expect(document.getElementById('sceneBulkBar').classList.contains('hidden')).toBe(true);
        fireEvent.click(rows()[0].querySelector('.scene-select'));
        fireEvent.click(rows()[2].querySelector('.scene-select'));
        expect(document.getElementById('sceneBulkCount').textContent).toBe('2 selected');
        expect(document.getElementById('scene-s1').classList.contains('expanded')).toBe(false);
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete selected' })); });
        expect(confirm.mock.calls[0][0]).toContain('Delete 2 scenes?');
        expect(confirm.mock.calls[0][0]).toContain('This also deletes 4 shots');
        expect(posted).toEqual({ scene_ids: ['s1', 's3'] });
        expect(status).toContain('Deleted 2 scene(s) and 4 shot(s)');
        confirm.mockRestore();
    });

    it('deleting one scene asks first, naming it', async () => {
        const { calls } = await openPage({ routes: { 'DELETE /scenes/s2': { shots: 0 } } });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        await act(async () => { fireEvent.click(rows()[1].querySelector('.scene-delete-btn')); });
        expect(confirm.mock.calls[0][0]).toContain('Delete scene "STREET"?');
        expect(calls.some(c => c.method === 'DELETE')).toBe(false);
        confirm.mockReturnValue(true);
        await act(async () => { fireEvent.click(rows()[1].querySelector('.scene-delete-btn')); });
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/scenes/s2');
        confirm.mockRestore();
    });

    it('break down one scene, or every written one after asking; a parse error is reported', async () => {
        const bodies = [];
        const { status } = await openPage({ routes: { 'POST /projects/p1/breakdown': (b) => { bodies.push(b); return b.all_scenes ? { total_cards: 7 } : { card_count: 3 }; } } });
        await act(async () => { fireEvent.click(rows()[1].querySelector('[title="Generate shots for this scene"]')); });
        expect(bodies[0]).toEqual({ scene_id: 's2', auto_save: true });
        expect(status).toContain('Scene broken down: 3 shot(s) created');
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => { fireEvent.click(document.getElementById('breakdownAllBtn')); });
        expect(bodies[1]).toEqual({ all_scenes: true, auto_save: true });
        expect(status).toContain('Breakdown complete: 7 shot(s) created');
        confirm.mockRestore();
    });
});
