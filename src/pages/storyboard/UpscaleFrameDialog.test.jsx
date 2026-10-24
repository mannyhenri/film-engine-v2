import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
vi.mock('../../lib/legacy.js', () => ({ legacy: { api: vi.fn() } }));
import { legacy } from '../../lib/legacy.js';
import { resetProjectEpoch, noteOpenProject } from '../../lib/project-epoch.js';
import UpscaleFrameDialog from './UpscaleFrameDialog.jsx';

// The local upscale: the Generators' AI Image Upscale on this Mac (backend/lib/storyboard-upscale.js, provider "local").
const ENGINES = [{ value: 'ultrasharp', label: '4x-UltraSharp' }, { value: 'realesrgan', label: 'Real-ESRGAN' }, { value: 'gigapixel', label: 'Topaz Gigapixel' }];
const plan = { source: { width: 1024, height: 576 }, output: { width: 2048, height: 1152 }, provider: 'local', resolution: '2K', plan_token: 'fixture',
    configured: true, estimated_cost: 0, engines: ENGINES, board_locked: false, already_at_target: false };
let calls, jobs;

beforeEach(() => {
    vi.clearAllMocks(); resetProjectEpoch(); window.state = { currentProject: { id: 'project' } }; noteOpenProject();
    calls = []; jobs = [];
    legacy.api.mockImplementation(async (path, opts = {}) => {
        calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
        if (path.includes('/preview')) return { ...plan, resolution: /4K/.test(path) ? '4K' : '2K' };
        if (path.endsWith('/collect')) return { id: 'job', state: 'completed', result: { asset: 'frame-v2' } };
        if (path === '/shots/shot/storyboard-upscale' && opts.method === 'POST') return jobs.shift() || { id: 'job', state: 'queued' };
        return jobs.shift() || { id: 'job', state: 'ready' };
    });
});
afterEach(() => { cleanup(); });

async function mount() {
    const close = vi.fn(), complete = vi.fn();
    render(<UpscaleFrameDialog shotId="shot" projectId="project" onClose={close} onComplete={complete} />);
    await screen.findByText(/1024×576 → 2048×1152/);
    return { close, complete };
}

describe('frame upscale on this Mac, with the AI Image Upscale generator', () => {
    it('offers the generator\'s own engines, says it is free, and asks for no provider or review', async () => {
        await mount();
        expect(screen.getByText(/AI Image Upscale/)).toBeTruthy();
        expect(screen.getByText(/nothing is sent anywhere/)).toBeTruthy();
        const engines = [...screen.getByLabelText('Upscaler').querySelectorAll('option')].map(o => o.value);
        expect(engines).toEqual(['ultrasharp', 'realesrgan', 'gigapixel']);
        expect(calls[0].path).toMatch(/preview\?resolution=2K&provider=local/);
        expect(calls.some(c => /final-request-review/.test(c.path))).toBe(false);
    });

    it('runs the chosen engine locally, then saves the result as a new frame version', async () => {
        jobs = [{ id: 'job', state: 'waiting' }, { id: 'job', state: 'ready' }];
        const { complete, close } = await mount();
        fireEvent.change(screen.getByLabelText('Upscaler'), { target: { value: 'realesrgan' } });
        fireEvent.click(screen.getByRole('button', { name: 'Upscale on this Mac' }));
        await waitFor(() => expect(complete).toHaveBeenCalled(), { timeout: 4000 });
        const started = calls.find(c => c.method === 'POST' && c.path === '/shots/shot/storyboard-upscale');
        expect(started.body).toMatchObject({ provider: 'local', resolution: '2K', engine: 'realesrgan', plan_token: 'fixture' });
        expect(calls.some(c => c.path.endsWith('/collect'))).toBe(true);
        expect(close).toHaveBeenCalled();
    });

    it('Topaz Gigapixel says it opens Topaz, and the job says how to bring the frame back', async () => {
        jobs = [{ id: 'job', state: 'handed_over', error: 'Opened in Topaz Gigapixel. Export it there, then import it on this shot as a new frame version.' }];
        await mount();
        fireEvent.change(screen.getByLabelText('Upscaler'), { target: { value: 'gigapixel' } });
        expect(screen.getByText(/Topaz Gigapixel opens with the frame/)).toBeTruthy();
        expect(screen.queryByLabelText('Film grain')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Open in Topaz Gigapixel' }));
        expect(await screen.findByText(/handed to Topaz Gigapixel/)).toBeTruthy();
    });

    it('a locked board or an uninstalled generator cannot start', async () => {
        legacy.api.mockImplementation(async (path) => (path.includes('/preview') ? { ...plan, board_locked: true } : {}));
        await mount();
        expect(screen.getByText(/Unlock the storyboard/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Upscale on this Mac' }).disabled).toBe(true);
    });
});
