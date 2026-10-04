// GRD-4671: writing readiness on the Scenes page, apart from production status. Set-based over the
// three statuses the backend declares (lib/scene-writing.js WRITING_STATUSES).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ScenesPage from './ScenesPage.jsx';
import SURFACE from './list-surface.js';
vi.mock('./engine.js', () => ({ generateSceneDialogue: vi.fn() }));

const STATUSES = [['draft', 'Draft'], ['reviewing', 'Reviewing'], ['production_ready', 'Production ready']];
const scene = (n, writing, status = 'written') => ({ id: 's' + n, scene_number: n, int_ext: 'INT.', location: 'ROOM ' + n, time_of_day: 'DAY',
    characters_present: '[]', shot_count: 0, status, dialogue_lines: 0, writing_status: writing, writing_fingerprint: 'fp' + n, writing_ambiguous: false });
const LIST = { scenes: [scene(1, 'production_ready', 'approved'), scene(2, 'draft', 'approved'), scene(3, 'reviewing')] };

async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/scenes': LIST, ...routes } });
    window.DRIFT = { shots: {}, scenes: [] };
    window.loadScreenplayDrift = vi.fn(async () => {});
    window.updateSceneStatusIcons = vi.fn();
    render(<ScenesPage />);
    await act(async () => { await window.loadScenes(); });
    return legacy;
}
const row = id => document.getElementById('scene-' + id);

describe('Scene writing readiness', () => {
    it('each row has a labelled writing dropdown offering exactly the three statuses, set to its own', async () => {
        await openPage();
        for (const s of LIST.scenes) {
            const select = row(s.id).querySelector('select.scene-writing-select');
            expect(select.getAttribute('aria-label')).toMatch(/writing status/i);
            expect([...select.options].map(o => [o.value, o.textContent])).toEqual(STATUSES);
            expect(select.value).toBe(s.writing_status);
        }
    });

    it('writing and production status are both visible and labelled apart: approved production can be writing Draft', async () => {
        await openPage();
        const r2 = row('s2');
        expect(r2.querySelector('.badge.approved').getAttribute('title')).toMatch(/production status/i);
        expect(r2.querySelector('.scene-writing-badge').textContent).toBe('Writing: Draft');
    });

    it('counts every writing status, and the list filters by it', async () => {
        await openPage();
        const counts = document.getElementById('sceneWritingCounts').textContent;
        for (const [, label] of STATUSES) expect(counts).toContain(`${label} 1`);
        expect(SURFACE.filters.some(f => f.field === 'writing_status')).toBe(true);
        expect(SURFACE.filters.find(f => f.field === 'status').label).toMatch(/production/i);
    });

    it('a change posts the status with the fingerprint the row was read with, then reloads', async () => {
        const { calls } = await openPage({ 'POST /scenes/s3/writing-status': b => ({ scene_id: 's3', writing_status: b.status, fingerprint: 'fp3' }) });
        await act(async () => { fireEvent.change(row('s3').querySelector('select.scene-writing-select'), { target: { value: 'production_ready' } }); });
        const post = calls.find(c => c.method === 'POST');
        expect(post.body).toEqual({ project_id: 'p1', status: 'production_ready', expected_fingerprint: 'fp3' });
        expect(calls.filter(c => c.path === '/projects/p1/scenes').length).toBe(2);
    });

    it('a refused change (text moved on) says so and changes nothing on screen', async () => {
        const legacy = await openPage({ 'POST /scenes/s3/writing-status': () => { throw new Error('The scene text changed since it was read; review the current text'); } });
        await act(async () => { fireEvent.change(row('s3').querySelector('select.scene-writing-select'), { target: { value: 'production_ready' } }); });
        expect(String(legacy.status)).toContain('The scene text changed since it was read');
        expect(row('s3').querySelector('select.scene-writing-select').value).toBe('reviewing');
    });

    it('the history shows each transition and automatic reset with its fingerprint', async () => {
        await openPage({
            'GET /scenes/s2': { shots: [] },
            'GET /scenes/s2/writing-status': { writing_status: 'draft', fingerprint: 'fp2', history: [
                { kind: 'transition', prior_status: 'draft', new_status: 'production_ready', fingerprint: 'aaaaaaaaaaaa1111', actor: 'human', created_at: '2026-10-04 12:00:00' },
                { kind: 'auto_reset', prior_status: 'production_ready', new_status: 'draft', fingerprint: 'bbbbbbbbbbbb2222', prior_fingerprint: 'aaaaaaaaaaaa1111', actor: 'system', reason: 'accepted scene text changed', created_at: '2026-10-04 12:05:00' },
            ] },
        });
        await act(async () => { fireEvent.click(row('s2').querySelector('.scene-row-header')); });
        const items = [...row('s2').querySelectorAll('.scene-writing-history li')].map(li => li.textContent);
        expect(items.length).toBe(2);
        expect(items[0]).toContain('Draft → Production ready');
        expect(items[0]).toContain('aaaaaaaa');
        expect(items[1]).toContain('Production ready → Draft');
        expect(items[1]).toContain('accepted scene text changed');
        expect(screen.getAllByText(/automatic/i).length).toBeGreaterThan(0);
    });
});
