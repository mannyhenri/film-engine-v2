import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ExportPage from './ExportPage.jsx';

// Export, end to end against the fake core: the routes, bodies, questions and lines the legacy page produced.
const CHECK = { asked: '3840×2160', shots: [
    { shot_code: '1A', status: 'ok' }, { shot_code: '1B', status: 'below', measured: '1920×1080', fix: 'upscale <it>' },
    { shot_code: '2A', status: 'no_clip' }, { shot_code: '2B', status: 'unreadable' },
] };
const ROUTES = { 'GET /projects/p1/shotlist': { shots: [{ duration_ms: 4000 }, { duration_ms: 2500 }] }, 'GET /projects/p1/delivery-check': CHECK };
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { ...ROUTES, ...routes } });
    render(<ExportPage />);
    await act(async () => { await window.loadExportPage(); });
    return legacy;
}
afterEach(() => vi.restoreAllMocks());

describe('Export', () => {
    it('before loading shows the markup zeros; the loader counts the shots and measures the clips', async () => {
        installLegacy({ routes: ROUTES });
        render(<ExportPage />);
        expect(document.getElementById('exportShotCount').textContent).toBe('0');
        expect(document.getElementById('exportDuration').textContent).toBe('0s');
        await act(async () => { await window.loadExportPage(); });
        expect(document.getElementById('exportShotCount').textContent).toBe('2');
        expect(document.getElementById('exportDuration').textContent).toBe('6.5s');
    });

    it('the delivery check: what is short, and why, as text', async () => {
        const { calls } = await openPage();
        expect(calls.map(c => c.path)).toEqual(['/projects/p1/shotlist', '/projects/p1/delivery-check']);
        const box = document.getElementById('exportDeliveryCheck');
        expect(box.textContent).toMatch(/Delivers 3840×2160 · 1 of 4 shots at full size/);
        expect([...box.querySelectorAll('tr')].map(r => r.textContent)).toEqual(['1Bbelow delivery1920×1080upscale <it>', '2Ano clip', '2Bunreadable']);
        await act(async () => { fireEvent.click(screen.getByText('Measure again')); });
        expect(calls.filter(c => c.path === '/projects/p1/delivery-check').length).toBe(2);
    });

    it('every clip at size says so; one shot is singular; a failed measure says why; an empty project reads 0.0s', async () => {
        await openPage({ 'GET /projects/p1/delivery-check': { asked: '', shots: [{ shot_code: '1A', status: 'ok' }] } });
        expect(screen.getByText('Every selected clip is at the delivery size.')).toBeTruthy();
        expect(document.getElementById('exportDeliveryCheck').textContent).toMatch(/Delivers no size set · 1 of 1 shot at full size/);
        await openPage({ 'GET /projects/p1/delivery-check': () => { throw new Error('ffprobe missing'); }, 'GET /projects/p1/shotlist': { shots: [] } });
        expect(screen.getByText('Could not measure: ffprobe missing')).toBeTruthy();
        expect(document.querySelectorAll('#exportDuration')[1].textContent).toBe('0.0s');
    });

    it('nothing without a project; a failed shot list says so and still measures', async () => {
        const none = installLegacy({ project: null });
        render(<ExportPage />);
        await act(async () => { await window.loadExportPage(); });
        expect(none.calls).toEqual([]);
        const { status, calls } = await openPage({ 'GET /projects/p1/shotlist': () => { throw new Error('offline'); } });
        expect(status).toContain('Error: offline');
        expect(calls.map(c => c.path)).toContain('/projects/p1/delivery-check');
    });

    it('each format downloads through the shared core function', async () => {
        const { fake } = await openPage();
        const buttons = screen.getAllByRole('button', { name: 'Download' });
        expect(buttons.length).toBe(5);
        buttons.forEach(b => fireEvent.click(b));
        expect(fake.downloadExport.mock.calls.map(c => c[0])).toEqual(['fcpxml', 'edl', 'premiere', 'srt', 'fdx']);
    });

    it('Premiere by scene: reads the plan, asks with what it will copy, then writes and says where', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const url = '/projects/p1/export/premiere-scenes';
        const { calls } = await openPage({
            [`GET ${url}`]: { file_count: 1, scenes: [{ shots: [{ asset_id: 'x' }, {}] }], missing: ['a', 'b'] },
            [`POST ${url}`]: { dest: '/x/Exports/Premiere <1>', copied: 1, xml: 'scenes.xml', missing: ['a'] },
        });
        await act(async () => { fireEvent.click(screen.getByText('Make the folders')); });
        expect(confirm.mock.calls[0][0]).toBe('Copy 1 file (1 clip) into 1 scene folder?\n2 items are missing and will be named in the READ ME.');
        expect(calls.at(-1)).toEqual({ method: 'POST', path: url, body: {} });
        await waitFor(() => expect(document.getElementById('premiereScenesResult').textContent).toBe('Written to /x/Exports/Premiere <1>1 files, scenes.xml1 missing, listed in READ ME.txt'));
    });

    it('Resolve: the question counts the edit; declined, nothing is written; an error says so', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        const url = '/projects/p1/export/resolve';
        let posted = 0;
        await openPage({
            [`GET ${url}`]: { file_count: 9, counts: { shots: 5, clips: 3, storyboard_frames: 2, gaps: 1, dialogue_lines: 1, beds: 2 }, missing: [] },
            [`POST ${url}`]: () => { posted++; throw new Error('disk full'); },
        });
        await act(async () => { fireEvent.click(screen.getByText('Create Resolve package')); });
        expect(confirm.mock.calls[0][0]).toBe('Create a Resolve export package: 5 shots (3 with footage, 2 on their storyboard frame, 1 gap), 1 dialogue line, 2 music/ambience beds; 9 files copied.\nImport this package in Resolve separately.');
        expect(posted).toBe(0);
        await act(async () => { fireEvent.click(screen.getByText('Create Resolve package')); });
        expect(document.getElementById('resolveExportResult').textContent).toBe('Could not create the Resolve package: disk full');
    });

    it('Resolve, written: says where, the script to run, and the steps', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const url = '/projects/p1/export/resolve';
        await openPage({
            [`GET ${url}`]: { file_count: 1, counts: { shots: 1, clips: 1, storyboard_frames: 0, dialogue_lines: 2, beds: 1 }, missing: [] },
            [`POST ${url}`]: { dest: '/x/Exports/Resolve', copied: 1, xml: 'edit.xml', metadata: 'meta.csv', script: 'Load Film Engine.py' },
        });
        await act(async () => { fireEvent.click(screen.getByText('Create Resolve package')); });
        expect(document.getElementById('resolveExportResult').textContent).toMatch(/^Package written to \/x\/Exports\/Resolve1 files, edit\.xml, meta\.csvNot imported into Resolve\./);
        expect(document.getElementById('resolveExportResult').textContent).toContain('Load Film Engine.py');
    });

    it('the bundle downloads from the API under /film; the import goes to the shared core function', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const { status, fake } = await openPage();
        fireEvent.click(screen.getByText('Download Bundle'));
        expect(open).toHaveBeenCalledWith('http://api.test/film/projects/p1/bundle', '_blank');
        expect(status).toContain('Downloading project bundle...');
        const file = new File(['x'], 'p.tar.gz');
        fireEvent.change(document.getElementById('bundleFileInput'), { target: { files: [file] } });
        expect(fake.importBundle).toHaveBeenCalledWith(document.getElementById('bundleFileInput'));
        expect(document.getElementById('importStatus').style.display).toBe('none');
    });
});
