import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, screen, cleanup, within } from '@testing-library/react';
import path from 'path';
import { createRequire } from 'module';
import { installLegacy } from '../../../test/setup.js';
import GeneratorsTab from './GeneratorsTab.jsx';

/*
 * The Generators tab against the backend's OWN manifest reader, pointed at the fixture engines: every tool
 * the server lists appears, a broken one shows why; a section tool gets In / Out and sends only that range;
 * a whole-file tool sends no range; options come from the manifest and reach the request; jobs show progress
 * and can be cancelled.
 */
const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../../../..');
process.env.FILM_GENERATORS_DIR = path.join(ROOT, 'backend', 'tests', 'fixtures', 'generators');
const TOOLS = require_(path.join(ROOT, 'backend', 'lib', 'generators.js')).listTools().map(({ dir, ...t }) => t);

const INPUT = { id: 'in1', path: '/Movies/jet.mov', name: 'jet.mov', kind: 'video', fps: 24, width: 1920, height: 1080, frames: 97, duration: 4.04 };
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

let L, jobs, settings;
function open() {
    jobs = []; settings = { out_dir: null, default_out_dir: '/Movies/Film Engine Generators' };
    L = installLegacy({ routes: {
        'GET /generators/settings': () => settings,
        'PUT /generators/settings': (b) => { settings = { ...settings, out_dir: b.out_dir }; return settings; },
        'GET /generators/tools': { tools: TOOLS, engine_dir: '/engines', out_dir: '/Movies/Film Engine Generators' },
        'GET /generators/jobs': () => ({ jobs }),
        'POST /generators/inputs': () => ({ input: INPUT }),
        'POST /generators/jobs': (b) => { const j = { id: 'j' + (jobs.length + 1), tool: b.tool, tool_name: b.tool, input_name: 'jet.mov', start: b.start ?? null, end: b.end ?? null, status: 'running', stage: 'Inventing frames', done: 3, total: 12, outputs: [], created_at: 'x' }; jobs = [j, ...jobs]; return { job: j }; },
        'POST /generators/jobs/j1/cancel': () => { jobs[jobs.length - 1].status = 'cancelled'; return { job: jobs[0] }; },
    } });
    window.__feFiles = { pathFor: vi.fn(() => '/Movies/jet.mov'), reveal: vi.fn(), pickFolder: vi.fn(async () => '/Volumes/Edit/Slowmo') };
    return render(<GeneratorsTab />);
}
const drop = async () => {
    const input = document.querySelector('input[type=file]');
    await act(async () => { fireEvent.change(input, { target: { files: [new File(['x'], 'jet.mov', { type: 'video/quicktime' })] } }); });
    await flush();
};
const lastPost = () => L.calls.filter(c => c.method === 'POST' && c.path === '/generators/jobs').pop()?.body;

beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete window.__feFiles; });

describe('Production › Generators', () => {
    it('lists every tool the server finds; a broken one says why and cannot be chosen', async () => {
        open(); await flush();
        const radios = screen.getAllByRole('radio');
        expect(radios.map(r => r.querySelector('.gen-tool-name').textContent)).toEqual(TOOLS.map(t => t.name));
        const broken = screen.getByRole('radio', { name: /Broken Tool/ });
        expect(broken.disabled).toBe(true);
        expect(broken.textContent).toMatch(/Not ready: engine script missing\.py is missing/);
        expect(screen.getByRole('button', { name: 'Generate' }).disabled).toBe(true);
    });

    it('a dropped file is read where it lies, by path: nothing is uploaded', async () => {
        open(); await flush(); await drop();
        expect(window.__feFiles.pathFor).toHaveBeenCalled();
        expect(L.calls.find(c => c.path === '/generators/inputs').body).toEqual({ path: '/Movies/jet.mov' });
        expect(screen.getByText('jet.mov')).toBeTruthy();
        expect(document.querySelector('video').getAttribute('src')).toBe('http://api.test/film/generators/inputs/in1');
    });

    it('a section tool renders only the marked range, with the options the manifest declares', async () => {
        open(); await flush(); await drop();
        await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Fake SlowMo/ })); });
        const video = document.querySelector('video');
        Object.defineProperty(video, 'currentTime', { value: 0.5, writable: true });   // frame 12
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Mark In/ })); });
        video.currentTime = 1.5;                                                         // frame 36, kept: Out is exclusive
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Mark Out/ })); });
        expect(screen.getByTestId('gen-section').textContent).toMatch(/25 frames/);
        await act(async () => { fireEvent.change(screen.getByLabelText('Slow down'), { target: { value: '2' } }); });
        await act(async () => { fireEvent.click(screen.getByLabelText('Side-by-side')); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate section' })); });
        await flush();
        expect(lastPost()).toEqual({ tool: 'fake-slowmo', input_id: 'in1', start: 12, end: 37, options: { factor: 2, scene: 0.3, compare: true } });
    });

    it('an Out marked at the very end stops at the last real frame', async () => {
        open(); await flush(); await drop();   // INPUT has 97 frames: 0-96
        await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Fake SlowMo/ })); });
        const video = document.querySelector('video');
        Object.defineProperty(video, 'currentTime', { value: 92 / 24, writable: true });
        await act(async () => { fireEvent.keyDown(window, { key: 'i' }); });
        video.currentTime = 4.05;   // the clip's duration: rounds to frame 97, one past the end
        await act(async () => { fireEvent.keyDown(window, { key: 'o' }); });
        expect(screen.getByTestId('gen-section').textContent).toMatch(/· 5 frames$/);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate section' })); });
        await flush();
        expect(lastPost()).toMatchObject({ start: 92, end: 97 });
    });

    it('the I and O keys mark the range, as in Resolve', async () => {
        open(); await flush(); await drop();
        await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Fake SlowMo/ })); });
        const video = document.querySelector('video');
        Object.defineProperty(video, 'currentTime', { value: 1, writable: true });
        await act(async () => { fireEvent.keyDown(window, { key: 'i' }); });
        video.currentTime = 2;
        await act(async () => { fireEvent.keyDown(window, { key: 'o' }); });
        expect(screen.getByTestId('gen-section').textContent).toMatch(/Section 00:00:01:00 → 00:00:02:01 · 25 frames/);
    });

    it('a whole-file tool sends no range and offers no In / Out', async () => {
        open(); await flush(); await drop();
        await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Fake Upscale/ })); });
        expect(screen.queryByRole('button', { name: /Mark In/ })).toBeNull();
        await act(async () => { fireEvent.change(screen.getByLabelText('Quality'), { target: { value: 'best' } }); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate' })); });
        await flush();
        expect(lastPost()).toEqual({ tool: 'fake-upscale', input_id: 'in1', options: { quality: 'best' } });
        expect(screen.getByRole('status').textContent).toMatch(/fake-upscale · .*jet\.mov|fake-upscalejet\.mov/);
    });

    it('a running job shows its progress by the button, which stays locked until it ends', async () => {
        open(); await flush(); await drop();
        await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Fake Upscale/ })); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate' })); });
        await flush();
        const now = screen.getByRole('status');
        expect(within(now).getByRole('progressbar', { name: 'Current job' }).getAttribute('aria-valuenow')).toBe('25');
        expect(now.textContent).toMatch(/Inventing frames · 3 \/ 12 · 25%/);
        const button = screen.getByRole('button', { name: 'Generating… 25%' });
        expect(button.disabled).toBe(true);
        await act(async () => { fireEvent.click(button); });
        expect(L.calls.filter(c => c.method === 'POST' && c.path === '/generators/jobs').length).toBe(1);
        await act(async () => { fireEvent.click(within(now).getByRole('button', { name: 'Cancel' })); });
        await flush();
        expect(L.calls.some(c => c.method === 'POST' && c.path === '/generators/jobs/j1/cancel')).toBe(true);
    });

    it('results go to the tool\'s default folder until another is chosen, and back again', async () => {
        open(); await flush(); await drop();
        await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Fake SlowMo/ })); });
        expect(screen.getByTestId('gen-saveto').textContent).toBe('/Movies/Film Engine Generators/Fake SlowMo');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change…' })); });
        await flush();
        expect(window.__feFiles.pickFolder).toHaveBeenCalledWith('/Movies/Film Engine Generators/Fake SlowMo');
        expect(L.calls.find(c => c.method === 'PUT').body).toEqual({ out_dir: '/Volumes/Edit/Slowmo' });
        expect(screen.getByTestId('gen-saveto').textContent).toBe('/Volumes/Edit/Slowmo');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use default' })); });
        await flush();
        expect(screen.getByTestId('gen-saveto').textContent).toBe('/Movies/Film Engine Generators/Fake SlowMo');
    });

    it('only the settings that apply to the current choice are shown', async () => {
        open(); await flush(); await drop();
        await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Fake Depth/ })); });
        expect(screen.queryByLabelText(/Blur amount/)).toBeTruthy();
        expect(screen.queryByLabelText(/Fog density/)).toBeNull();
        await act(async () => { fireEvent.change(screen.getByLabelText('Effect'), { target: { value: 'fog' } }); });
        expect(screen.queryByLabelText(/Blur amount/)).toBeNull();
        expect(screen.queryByLabelText(/Fog density/)).toBeTruthy();
    });

    it("a finished job shows the engine's measured results", async () => {
        open(); jobs = [{ id: 'm1', tool: 'master', tool_name: 'One-Click Master', input_name: 'song.wav', status: 'done', stage: 'done', done: 4, total: 4,
            outputs: ['/out/song master.wav'], stats: { integrated_lufs: -14.02, true_peak_dbtp: -2.1 }, created_at: 'x' }];
        await flush();
        expect(document.querySelector('.gen-stats').textContent).toBe('integrated lufs -14.02 · true peak dbtp -2.1');
    });

    it('a ProRes file plays from its preview copy, with a note until it is ready', async () => {
        open(); INPUT.preview = true; INPUT.codec = 'prores';
        try {
            await flush(); await drop();
            const video = document.querySelector('video');
            expect(video.getAttribute('src')).toBe('http://api.test/film/generators/inputs/in1/preview');
            expect(screen.getByTestId('gen-loading').textContent).toBe('Preparing a playable copy of this ProRes file…');
            await act(async () => { fireEvent.loadedMetadata(video); });
            expect(screen.queryByTestId('gen-loading')).toBeNull();
        } finally { delete INPUT.preview; delete INPUT.codec; }
    });

    it('results play through the preview route (they are ProRes), and the progress sits under the player', async () => {
        open(); jobs = [{ id: 'u1', tool: 'fake-upscale', tool_name: 'AI Upscale', input_name: 'jet.mov', status: 'done', stage: 'done', done: 1, total: 1,
            outputs: ['/out/jet - AI Upscale.mov'], created_at: 'x' }];
        await flush(); await drop();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play' })); });
        expect(document.querySelector('.gen-out-player').getAttribute('src')).toBe('http://api.test/film/generators/jobs/u1/output/0/preview');

        await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Fake Upscale/ })); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate' })); });
        await flush();
        const left = document.querySelector('.gen-left');
        expect(left.querySelector('.gen-drop')).toBeTruthy();
        expect(left.lastElementChild).toBe(screen.getByRole('status'));
        expect(document.querySelector('.gen-panel').contains(screen.getByRole('status'))).toBe(false);
        const history = screen.getByRole('heading', { name: 'History' }).closest('.gen-jobs');
        expect(document.querySelector('.gen-main').compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('an image shows as a picture, only image tools can be chosen, and an image result is viewed in place', async () => {
        const IMG = { id: 'im1', path: '/Movies/frame.png', name: 'frame.png', kind: 'image', width: 1376, height: 768, frames: null, fps: null, duration: 0 };
        open();
        L.fake.api.mockImplementation(async (p, o = {}) => {
            const m = o.method || 'GET';
            L.calls.push({ method: m, path: p, body: o.body ? JSON.parse(o.body) : undefined });
            if (m === 'POST' && p === '/generators/inputs') return { input: IMG };
            if (p === '/generators/tools') return { tools: TOOLS, engine_dir: '/engines', out_dir: '/Movies' };
            if (p === '/generators/settings') return { out_dir: null, default_out_dir: '/Movies' };
            if (m === 'POST' && p === '/generators/jobs') { jobs = [{ id: 'i1', tool: 'fake-image-upscale', tool_name: 'Fake Image Upscale', input_name: 'frame.png', status: 'done', stage: 'done', done: 1, total: 1, outputs: ['/out/frame - AI Image Upscale.png'], created_at: 'x' }]; return { job: jobs[0] }; }
            if (p === '/generators/jobs') return { jobs };
            throw new Error('no route ' + p);
        });
        await flush(); await drop();
        const img = document.querySelector('.gen-player img.gen-still');
        expect(img.getAttribute('src')).toBe('http://api.test/film/generators/inputs/im1');
        expect(document.querySelector('.gen-player video')).toBeNull();
        expect(screen.getByText(/1376×768/)).toBeTruthy();
        expect(screen.queryByText(/frame 0 ·/)).toBeNull();
        const radios = screen.getAllByRole('radio');
        const enabled = radios.filter(r => !r.disabled).map(r => r.querySelector('.gen-tool-name').textContent);
        expect(enabled).toEqual(['Fake Image Upscale']);
        expect(screen.getByRole('radio', { name: /Fake Image Upscale/ }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByLabelText('Size')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Engine'), { target: { value: 'gigapixel' } });
        expect(screen.queryByLabelText('Size')).toBeNull();   // Gigapixel's size is chosen in Gigapixel
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate' })); }); await flush();
        expect(lastPost().options).toEqual({ engine: 'gigapixel' });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'View' })); });
        expect(document.querySelector('img.gen-out-player').getAttribute('src')).toBe('http://api.test/film/generators/jobs/i1/output/0/preview');
    });
});
