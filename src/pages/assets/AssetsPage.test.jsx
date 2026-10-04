import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import AssetsPage, { ASSET_GROUPS, formatBytes } from './AssetsPage.jsx';

const ASSETS = { assets: [
    { id: 'a1', asset_type: 'keyframe', file_name: '1A <v2>.png', format: 'png', size_bytes: 1536, created_at: '2026-10-01T10:00:00Z' },
    { id: 'a2', asset_type: 'video_raw', file_path: '/d/1A.mp4', format: null, size_bytes: 0, created_at: '2026-10-01T10:00:00Z' },
    { id: 'a3', asset_type: 'audio_music', file_name: 'score.mp3', format: 'mp3', size_bytes: 3 * 1024 * 1024, created_at: '2026-10-01T10:00:00Z' },
] };
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/assets': ASSETS, ...routes } });
    render(<AssetsPage />);
    await act(async () => { await window.loadAssets(); });
    return legacy;
}
const rows = () => [...document.querySelectorAll('#assetTableWrap tr')].slice(1);

describe('Assets', () => {
    it('sizes read in binary units', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(3 * 1024 * 1024)).toBe('3 MB');
    });

    it('lists every asset with its name (as text), format and size', async () => {
        await openPage();
        expect(rows().length).toBe(3);
        expect(screen.getByText('1A <v2>.png')).toBeTruthy();
        expect(screen.getByText('/d/1A.mp4')).toBeTruthy(); // no file name: the path
        expect(rows()[1].textContent).toContain('-');
        expect(rows()[2].textContent).toContain('3 MB');
    });

    it('a pill per group, each counting its own assets; a pill filters without another request', async () => {
        const { calls } = await openPage();
        const pills = [...document.querySelectorAll('#assetFilters .filter-pill')].map(p => p.textContent);
        expect(pills).toEqual(['All (3)', ...Object.keys(ASSET_GROUPS).map(g => `${g[0].toUpperCase() + g.slice(1)} (${ASSETS.assets.filter(a => ASSET_GROUPS[g].includes(a.asset_type)).length})`)]);
        fireEvent.click(screen.getByRole('button', { name: 'Video (1)' }));
        expect(rows().map(r => r.textContent)).toEqual([expect.stringContaining('/d/1A.mp4')]);
        expect(document.querySelector('.filter-pill.active').textContent).toBe('Video (1)');
        fireEvent.click(screen.getByRole('button', { name: 'Other (0)' }));
        expect(screen.getByText('No assets')).toBeTruthy();
        expect(calls.filter(c => c.method === 'GET').length).toBe(1);
    });

    it('registers with the legacy form rules (trimmed, empty fields left out), then empties the form', async () => {
        let posted;
        const { status } = await openPage({ 'POST /projects/p1/assets': (b) => { posted = b; return { ok: true }; } });
        fireEvent.change(document.querySelector('#assetModal [data-field="asset_type"]'), { target: { value: 'lut' } });
        fireEvent.change(document.querySelector('#assetModal [data-field="file_path"]'), { target: { value: '  /luts/warm.cube ' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Register' })); });
        expect(posted).toEqual({ asset_type: 'lut', file_path: '/luts/warm.cube' });
        expect(status).toContain('Asset registered');
        expect(document.querySelector('#assetModal [data-field="file_path"]').value).toBe('');
    });

    it('CHANGE: Register with no file path says why instead of doing nothing', async () => {
        const { calls, status } = await openPage();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Register' })); });
        expect(calls.some(c => c.method === 'POST')).toBe(false);
        expect(status).toContain('An asset needs its type and file path');
    });

    it('delete asks first', async () => {
        const { calls } = await openPage({ 'DELETE /assets/a2': { ok: true } });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Del' })[1]); });
        expect(calls.some(c => c.method === 'DELETE')).toBe(false);
        confirm.mockReturnValue(true);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Del' })[1]); });
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/assets/a2');
        confirm.mockRestore();
    });

    it('a read failure goes to the status line', async () => {
        const { status } = await openPage({ 'GET /projects/p1/assets': () => { throw new Error('down'); } });
        expect(status).toContain('Error: down');
    });

    it('search, sort and type filter work within the pill; no match says so', async () => {
        await openPage();
        fireEvent.change(document.querySelector('[data-list-search]'), { target: { value: 'SCORE' } });
        expect(rows().map(r => r.textContent)).toEqual([expect.stringContaining('score.mp3')]);
        expect(document.querySelector('[data-list-count]').textContent).toBe('1 of 3 assets');
        fireEvent.click(screen.getByRole('button', { name: 'Video (1)' }));
        expect(rows()).toEqual([]);
        expect(document.querySelector('[data-list-nomatch]')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(rows().map(r => r.textContent)).toEqual([expect.stringContaining('/d/1A.mp4')]);
        fireEvent.click(screen.getByRole('button', { name: 'All (3)' }));
        fireEvent.change(document.querySelector('[data-list-sort]'), { target: { value: 'largest' } });
        expect(rows()[0].textContent).toContain('score.mp3');
        fireEvent.change(document.querySelector('[data-list-filter="type"]'), { target: { value: 'keyframe' } });
        expect(rows().length).toBe(1);
    });
});
