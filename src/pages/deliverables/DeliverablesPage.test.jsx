import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import DeliverablesPage from './DeliverablesPage.jsx';

// Deliverables, end to end against the fake core: the routes, bodies and lines the legacy page produced.
const SERVED = {
    profiles: [{ id: 'meta_9x16', label: 'Meta Reels 9:16', platform: 'meta' }, { id: 'yt_16x9', label: 'YouTube 16:9', platform: 'youtube' }],
    packages: ['social', 'broadcast'],
};
const ROW = { id: 'd1', key: '15_9x16', label: 'Reel <15>', aspect_ratio: '9:16', width: 1080, height: 1920, fps: 30, duration_ms: 15000,
    platform: 'meta', loudness_target: '-14 LUFS', caption_mode: 'burned', native: 1, status: 'planned', sort_order: 2, notes: 'hi', profile_id: 'meta_9x16' };
const VERDICT = { cut_duration_ms: 14800, target_duration_ms: 15000, on_target: true, native_ratios: ['9:16'], needs_native_shots: true };

async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: {
        'GET /projects/p1/deliverables': { ...SERVED, deliverables: [ROW] },
        'GET /projects/p1/deliverables/check': VERDICT, ...routes } });
    render(<DeliverablesPage />);
    await act(async () => { await window.loadDeliverables(); });
    return legacy;
}
afterEach(() => vi.restoreAllMocks());

describe('Deliverables', () => {
    it('answers to the loader navigateTo calls: rows, packages, the pickers refreshed, and the free verdict', async () => {
        const { calls, fake } = await openPage();
        expect(calls.map(c => c.path)).toEqual(['/projects/p1/deliverables', '/projects/p1/deliverables/check']);
        expect(fake.state.deliverableRows).toEqual([ROW]);
        expect(fake.refreshProtectOptions).toHaveBeenCalled();
        expect([...document.querySelectorAll('#deliverablePackage option')].map(o => o.textContent)).toEqual(['social package', 'broadcast package']);
        expect(screen.getByText('Reel <15>')).toBeTruthy();
        const tags = [...document.querySelectorAll('#deliverableList .tag')].map(t => t.textContent);
        expect(tags).toEqual(['9:16', '1080×1920', '30 fps', '15s', 'meta', '-14 LUFS', 'captions: burned', 'shoot native']);
        await waitFor(() => expect(screen.getByText('14.8s / 15.0s')).toBeTruthy());
        expect(screen.getByText('shoot native: 9:16')).toBeTruthy();
        expect(screen.getByText(/No shot is flagged to be shot at a vertical ratio/)).toBeTruthy();
    });

    it('nothing without a project; says so when empty, and when the read fails', async () => {
        const none = installLegacy({ project: null });
        render(<DeliverablesPage />);
        await act(async () => { await window.loadDeliverables(); });
        expect(none.calls).toEqual([]);
        await openPage({ 'GET /projects/p1/deliverables': { ...SERVED, deliverables: [] } });
        expect(screen.getByText(/No deliverables\. Apply a package/)).toBeTruthy();
        await openPage({ 'GET /projects/p1/deliverables': () => { throw new Error('offline'); } });
        expect(screen.getByText('Could not read the deliverables: offline')).toBeTruthy();
    });

    it('a cut with no target says so; a failed verdict shows nothing', async () => {
        await openPage({ 'GET /projects/p1/deliverables/check': { cut_duration_ms: 31000 } });
        await waitFor(() => expect(screen.getByText(/cut runs 31\.0s/)).toBeTruthy());
        await openPage({ 'GET /projects/p1/deliverables/check': () => { throw new Error('x'); } });
        expect(document.querySelectorAll('#deliverableVerdict').length).toBe(2);
    });

    it('Apply package asks before replacing rows, POSTs the package, and says how many were planned', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        const { calls, status } = await openPage({ 'POST /projects/p1/deliverables/plan': { created: 6 } });
        fireEvent.change(document.getElementById('deliverablePackage'), { target: { value: 'broadcast' } });
        await act(async () => { fireEvent.click(screen.getByText('Apply package')); });
        expect(calls.length).toBe(2);
        await act(async () => { fireEvent.click(screen.getByText('Apply package')); });
        expect(confirm.mock.calls[0][0]).toMatch(/^Apply the broadcast package\?\n\nThis REPLACES the 1 deliverable/);
        expect(calls[2]).toEqual({ method: 'POST', path: '/projects/p1/deliverables/plan', body: { package: 'broadcast' } });
        expect(status).toContain('6 deliverable(s) planned');
    });

    it('the form is always there (the static render has every field) and opens empty for a new row', async () => {
        const { fake } = await openPage();
        expect([...document.querySelectorAll('#deliverableModal [data-field]')].map(e => e.dataset.field)).toEqual(
            ['key', 'label', 'profile_id', 'aspect_ratio', 'width', 'height', 'fps', 'duration_ms', 'platform', 'loudness_target', 'caption_mode', 'status', 'native', 'sort_order', 'notes']);
        fireEvent.click(screen.getByText('+ Deliverable'));
        expect(fake.showModal).toHaveBeenCalledWith('deliverableModal');
        expect(screen.getByText('New deliverable')).toBeTruthy();
        expect(document.getElementById('delAspect').value).toBe('16:9');
        expect(document.getElementById('delFps').value).toBe('29.97');
        expect(document.getElementById('delDuration').value).toBe('30.0');
        expect(document.getElementById('delCaption').value).toBe('sidecar');
        expect([...document.querySelectorAll('#delPlatform option')].map(o => o.value)).toEqual(['', 'meta', 'youtube']);
    });

    it('a row needs a key; a new one POSTs the legacy body and reloads', async () => {
        const { calls, status } = await openPage({ 'POST /projects/p1/deliverables': {} });
        fireEvent.click(screen.getByText('+ Deliverable'));
        fireEvent.click(screen.getByText('Save'));
        expect(status).toContain('A deliverable needs a key — it is the sequence name');
        fireEvent.change(document.getElementById('delKey'), { target: { value: '30_16x9' } });
        fireEvent.change(document.getElementById('delDuration'), { target: { value: '30.5' } });
        fireEvent.click(document.getElementById('delNative'));
        await act(async () => { fireEvent.click(screen.getByText('Save')); });
        expect(calls[2]).toEqual({ method: 'POST', path: '/projects/p1/deliverables', body: {
            key: '30_16x9', label: '', profile_id: '', aspect_ratio: '16:9', width: 1920, height: 1080, fps: 29.97, duration_ms: 30500,
            platform: '', loudness_target: '', caption_mode: 'sidecar', status: 'planned', native: true, sort_order: 0, notes: '',
        } });
        expect(status).toContain('Deliverable added');
        await waitFor(() => expect(calls[3].path).toBe('/projects/p1/deliverables'));
    });

    it('Edit fills the form from the row and PUTs to it', async () => {
        const { calls, status } = await openPage({ 'PUT /deliverables/d1': {} });
        fireEvent.click(screen.getByText('Edit'));
        expect(screen.getByText('Edit deliverable')).toBeTruthy();
        expect(document.getElementById('delProfile').value).toBe('meta_9x16');
        expect(document.getElementById('delNative').checked).toBe(true);
        await act(async () => { fireEvent.click(screen.getByText('Save')); });
        expect(calls[2].method).toBe('PUT');
        expect(calls[2].path).toBe('/deliverables/d1');
        expect(calls[2].body).toMatchObject({ key: '15_9x16', duration_ms: 15000, native: true, sort_order: 2, notes: 'hi' });
        expect(status).toContain('Deliverable updated');
    });

    it('Delete asks, DELETEs, and says it was removed', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { calls, status } = await openPage({ 'DELETE /deliverables/d1': {} });
        await act(async () => { fireEvent.click(screen.getByText('Delete')); });
        expect(calls[2]).toEqual({ method: 'DELETE', path: '/deliverables/d1', body: undefined });
        expect(status).toContain('Deliverable removed');
    });
});
