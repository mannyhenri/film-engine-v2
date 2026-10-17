import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import EditsPage from './EditsPage.jsx';
// The upload piece size moved from core into the page's engine; tiny here, so a test file travels in several pieces.
vi.mock('./engine.js', () => ({ EDIT_CHUNK: 4 }));

// The Edit page, end to end against the fake core: the routes, bodies and lines the legacy page produced.
const CUT = {
    sequence: 'Main <seq>',
    summary: { events: 3, matched: 2, by: { file: 1, code: 1 }, unmatched: 1, unmatched_names: ['stock.mov'], shots_not_in_cut: ['2B'] },
    events: [
        { start_ms: 0, duration_ms: 4000, shot_code: '1A', name: 'sh_1A.mp4', matched_by: 'file' },
        { start_ms: 4000, duration_ms: 2000, shot_code: null, file_name: 'stock.mov', matched_by: null },
    ],
};
const EDIT = { id: 'e1', version: 2, name: 'Rough <cut>', is_latest: 1, duration_ms: 65000, frame_rate: 23.976, width: 1920, height: 1080,
    has_audio: 1, size_bytes: 2048, available: 1, video_url: '/film/edits/e1/video', file_path: '/x/05 Edit/v2.mp4', cut: CUT };

async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/edits': { edits: [EDIT] }, ...routes } });
    render(<EditsPage />);
    await act(async () => { await window.loadEditsPage(); });
    return legacy;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Edit', () => {
    it('answers to the loader navigateTo calls and shows each version: facts, picture, cut, events', async () => {
        const { calls } = await openPage();
        expect(calls[0]).toEqual({ method: 'GET', path: '/projects/p1/edits', body: undefined });
        expect(document.querySelector('[data-edit-id="e1"] h3').textContent).toBe('v2 · Rough <cut> latest');
        expect(screen.getByText('1:05 · 23.976 fps · 1920×1080 · with sound · 2048 B')).toBeTruthy();
        expect(document.querySelector('video').getAttribute('src')).toBe('http://api.test/film/edits/e1/video');
        const cutLine = document.querySelector('[data-edit-id="e1"] video').nextElementSibling.textContent;
        expect(cutLine).toBe('3 events in “Main <seq>”, 2 of them Film Engine shots (1 by file, 1 by shot code) · not ours: stock.mov · shots not in this cut: 2B');
        // The score was retired with the Score workstation (tools/split-lib.js RETIRED): no button, no score list.
        expect(screen.queryByRole('button', { name: 'Score this edit' })).toBeNull();
        expect(document.querySelector('[data-edit-id="e1"]').textContent).not.toMatch(/Scored in/);
        expect(screen.getByText('Replace XML / EDL')).toBeTruthy();
        expect(screen.getByText('Re-match shots')).toBeTruthy();
        const rows = [...document.querySelectorAll('details tr')].map(r => r.textContent);
        expect(rows).toEqual(['0:000:041Ash_1A.mp4by file', '0:040:02—stock.movnot a Film Engine shot']);
    });

    it('says when there is no project, no edit, a read error, or no picture file', async () => {
        const legacy = installLegacy({ project: null });
        render(<EditsPage />);
        await act(async () => { await window.loadEditsPage(); });
        expect(screen.getByText('Open a project to see its edits.')).toBeTruthy();
        expect(legacy.calls).toEqual([]);
        await openPage({ 'GET /projects/p1/edits': { edits: [] } });
        expect(screen.getByText(/No edit yet\./)).toBeTruthy();
        await openPage({ 'GET /projects/p1/edits': () => { throw new Error('offline'); } });
        expect(screen.getByText('The edits could not be read: offline')).toBeTruthy();
        await openPage({ 'GET /projects/p1/edits': { edits: [{ ...EDIT, available: 0, cut: null }] } });
        expect(screen.getByText('The picture file is missing from the project folder.')).toBeTruthy();
        expect(screen.getByText(/No cut yet/)).toBeTruthy();
        expect(screen.getByText('Add XML / EDL')).toBeTruthy();
    });

    it('imports an edit in pieces: each PUT at its offset, the progress said, then the import, then a reload', async () => {
        const puts = [];
        vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
            puts.push({ url, offset: opts.headers['X-Upload-Offset'], size: opts.body.size });
            return { ok: true, json: async () => ({ received: Number(opts.headers['X-Upload-Offset']) + opts.body.size }) };
        }));
        const { calls, fake } = await openPage({ 'POST /uploads': { id: 'u1' }, 'POST /projects/p1/edits/import': { edit: { version: 3, duration_ms: 90000 } } });
        const file = new File(['abcdef'], 'Final cut.mp4', { type: 'video/mp4' });
        await act(async () => { fireEvent.change(document.getElementById('editImportFile'), { target: { files: [file] } }); });
        await waitFor(() => expect(document.getElementById('editImportProgress').textContent).toMatch(/^Imported as edit v3/));
        expect(calls[1]).toEqual({ method: 'POST', path: '/uploads', body: { total_bytes: 6, mime: 'video/mp4', name: 'Final cut.mp4' } });
        expect(puts).toEqual([{ url: 'http://api.test/film/uploads/u1', offset: '0', size: 4 }, { url: 'http://api.test/film/uploads/u1', offset: '4', size: 2 }]);
        expect(fake.checkUploadSize).toHaveBeenCalledTimes(2);
        expect(calls[2]).toEqual({ method: 'POST', path: '/projects/p1/edits/import', body: { upload_id: 'u1', name: 'Final cut' } });
        expect(document.getElementById('editImportProgress').textContent).toBe('Imported as edit v3 (1:30). Add the XML or EDL it was exported with to see which shot plays where.');
        await waitFor(() => expect(calls[3]).toEqual({ method: 'GET', path: '/projects/p1/edits', body: undefined }));
    });

    it('a refused upload says the file was not imported, and why', async () => {
        await openPage({ 'POST /uploads': () => { throw new Error('disk full'); } });
        const file = new File(['abc'], 'x.mp4', { type: 'video/mp4' });
        await act(async () => { fireEvent.change(document.getElementById('editImportFile'), { target: { files: [file] } }); });
        await waitFor(() => expect(document.getElementById('editImportProgress').textContent).toBe('x.mp4 was not imported: disk full'));
        expect(document.getElementById('editImportLabel').classList.contains('disabled')).toBe(false);
    });

    it('adds the XML or EDL as text and says what matched', async () => {
        const { calls, status } = await openPage({ 'POST /edits/e1/cut': { edit: { cut: { summary: { events: 5, matched: 4, unmatched: 1 } } } } });
        const xml = new File(['<xmeml/>'], 'cut.xml', { type: 'text/xml' });
        xml.text = async () => '<xmeml/>'; // jsdom's File has no text(); Chromium's does
        const input = document.querySelector('[data-edit-id="e1"] input[type="file"]');
        await act(async () => { fireEvent.change(input, { target: { files: [xml] } }); });
        await waitFor(() => expect(status.length).toBe(1));
        expect(status).toEqual(['cut.xml: 5 events, 4 matched to shots, 1 not ours']);
        expect(calls[1]).toEqual({ method: 'POST', path: '/edits/e1/cut', body: { text: '<xmeml/>', name: 'cut.xml' } });
    });

    it('re-matches the cut against the shots as they are now', async () => {
        const { calls, status } = await openPage({ 'POST /edits/e1/cut/rematch': {} });
        await act(async () => { fireEvent.click(screen.getByText('Re-match shots')); });
        expect(calls[1]).toEqual({ method: 'POST', path: '/edits/e1/cut/rematch', body: {} });
        expect(status).toContain('Matched against the shots as they are now');
    });

    it('renames in a dialog (Electron has no window.prompt) and PUTs the name', async () => {
        const { calls, fake } = await openPage({ 'PUT /edits/e1': {} });
        fireEvent.click(screen.getByText('Rename'));
        expect(fake.showModal).toHaveBeenCalledWith('editRenameModal');
        expect(document.getElementById('editRenameName').value).toBe('Rough <cut>');
        fireEvent.change(document.getElementById('editRenameName'), { target: { value: 'Fine cut' } });
        await act(async () => { fireEvent.click(screen.getByText('Save')); });
        expect(calls[1]).toEqual({ method: 'PUT', path: '/edits/e1', body: { name: 'Fine cut' } });
        expect(fake.closeModal).toHaveBeenCalledWith('editRenameModal');
    });

    it('deletes after asking, and nothing else (no score can hold an edit any more)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { calls, status } = await openPage({ 'DELETE /edits/e1': {} });
        await act(async () => { fireEvent.click(screen.getByText('Delete')); });
        expect(calls.map(c => `${c.method} ${c.path}`).slice(1)).toEqual(['DELETE /edits/e1', 'GET /projects/p1/edits']);
        expect(status).toContain('Edit v2 deleted');
    });

    it('a delete declined does nothing; refused for another reason says so', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        const { calls, status } = await openPage({ 'DELETE /edits/e1': () => { throw new Error('locked'); } });
        await act(async () => { fireEvent.click(screen.getByText('Delete')); });
        expect(calls.length).toBe(1);
        await act(async () => { fireEvent.click(screen.getByText('Delete')); });
        expect(status).toContain('Not deleted: locked');
        expect(confirm).toHaveBeenCalledTimes(2);
    });

});
