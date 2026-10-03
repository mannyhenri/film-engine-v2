import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import RenderHistoryPage from './RenderHistoryPage.jsx';

const BOARD = { scenes: [
    { id: 's1', scene_number: 1, shots: [{ id: 'sh1', shot_code: '1A' }, { id: 'sh2', shot_code: '1B' }] },
    { id: 's2', scene_number: 2, shots: [{ id: 'sh3', shot_code: '2A' }] },
] };
const RENDERS = { renders: [
    { id: 'r1', version: 3, step: 'keyframe', model_id: 'nano <pro>', seed: 0, steps: 30, guidance: 7.5, mode: 'locked', inference_ms: 4250, created_at: '2026-10-03T08:00:00Z' },
    { id: 'r2', version: 2, step: 'video', model_id: null, seed: null, steps: null, guidance: null, mode: 'creative', inference_ms: null, created_at: '2026-10-02T08:00:00Z' },
] };

async function openPage(routes = {}, statusBoard) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/status-board': BOARD, 'GET /shots/sh1/renders': RENDERS, ...routes } });
    if (statusBoard) window.state.statusBoard = statusBoard;
    render(<RenderHistoryPage />);
    await act(async () => { await window.loadRenderPage(); });
    return legacy;
}
const pick = (id) => act(async () => { fireEvent.change(document.getElementById('renderShotSelect'), { target: { value: id } }); });

describe('Render History', () => {
    it('lists every shot of every scene, read from the status board', async () => {
        const { calls } = await openPage();
        expect(calls.map(c => c.path)).toEqual(['/projects/p1/status-board']);
        expect([...document.querySelectorAll('#renderShotSelect option')].map(o => o.textContent)).toEqual(['Select shot...', 'Sc1/1A', 'Sc1/1B', 'Sc2/2A']);
        expect(screen.getByText('Select a shot to view render history.')).toBeTruthy();
    });

    it('reuses a status board another page already read, as the legacy page did', async () => {
        const { calls } = await openPage({}, BOARD);
        expect(calls).toEqual([]);
        expect(document.querySelectorAll('#renderShotSelect option').length).toBe(4);
    });

    it('a shot shows its ledger: seed 0 kept, missing values as -, locked mode marked, duration in seconds', async () => {
        await openPage();
        await pick('sh1');
        const rows = [...document.querySelectorAll('.render-table tr')].slice(1).map(tr => [...tr.children].map(td => td.textContent));
        expect(rows[0].slice(0, 8)).toEqual(['3', 'keyframe', 'nano <pro>', '0', '30', '7.5', 'locked', '4.3s']);
        expect(rows[1].slice(0, 8)).toEqual(['2', 'video', '-', '-', '-', '-', 'creative', '-']);
        expect(document.querySelectorAll('.render-table .badge.approved').length).toBe(1);
    });

    it('a shot with no renders says so', async () => {
        await openPage({ 'GET /shots/sh2/renders': { renders: [] } });
        await pick('sh2');
        expect(screen.getByText('No renders for this shot.')).toBeTruthy();
    });

    it('with no project open, nothing is fetched', async () => {
        const a = installLegacy({ project: null });
        render(<RenderHistoryPage />);
        await act(async () => { await window.loadRenderPage(); });
        expect(a.calls).toEqual([]);
    });

    it('an API failure is said on the status bar', async () => {
        const { status } = await openPage({ 'GET /shots/sh1/renders': () => { throw new Error('boom'); } });
        await pick('sh1');
        expect(status).toContain('Error: boom');
    });
});
