import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import VideoShotsPage from './VideoShotsPage.jsx';
// The card's own actions moved from core into this page's engine (tools/core-ownership.js): spied on there.
vi.mock('./engine.js', async (importOriginal) => {
    const real = await importOriginal();
    return Object.fromEntries(Object.entries(real).map(([k, v]) => [k, typeof v === 'function' ? vi.fn() : v]));
});
import * as E from './engine.js';

// Video Shots, end to end against the fake core: the routes, bodies, questions and lines the legacy page produced.
const SHOTS = [
    { id: 'a', shot_code: '1A', scene_number: 1, location: 'DINER <night>', duration_ms: 4000, has_keyframe: true },
    { id: 'b', shot_code: '1B', scene_number: 1, duration_ms: 6000, keyframe_url: '/x.png' },
    { id: 'c', shot_code: '2A', scene_number: 2 },
    { id: 'd', shot_code: '2B', scene_number: 2 },
];
const VIDEO = {
    jobs: [{ shot_id: 'c', status: 'generating' }, { shot_id: 'd', status: 'failed' }],
    assets: [
        { shot_id: 'b', asset_type: 'video_raw', url: '/film/video/p1/1B_v2.mp4', id: 'v1' },
        { shot_id: 'b', asset_type: 'audio_dialogue' }, { shot_id: 'b', asset_type: 'video_final', url: '/film/video/p1/1B_final.mp4' },
    ],
};
const ROUTES = { 'GET /projects/p1/shotlist': { shots: SHOTS }, 'GET /projects/p1/video': VIDEO, 'GET /projects/p1/providers': { effective: { video: 'veo' } } };
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { ...ROUTES, ...routes } });
    render(<VideoShotsPage />);
    await act(async () => { await window.loadVideoShots(); });
    return legacy;
}
const card = (id) => document.querySelector(`[data-shot-id="${id}"]`);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Video Shots', () => {
    it('answers to the loader (and to core calling it by name): shots, jobs, providers; the shared state core reads; the sequence list', async () => {
        const { calls, fake, status } = await openPage();
        expect(calls.map(c => c.path)).toEqual(['/projects/p1/shotlist', '/projects/p1/video', '/projects/p1/providers']);
        expect(fake.state.videoShots).toEqual(SHOTS);
        expect(fake.state.videoAssetsByShot.b.video_raw.id).toBe('v1');
        expect(fake.loadSequences).toHaveBeenCalled();
        expect(status).toEqual(['Loading video shots...', '4 shot(s), 1 with video']);
        expect(document.querySelector('#videoshotsGrid').textContent).toMatch(/^Video provider: veoChange in Settings →/);
        fireEvent.click(screen.getByText('Change in Settings →'));
        expect(fake.navigateTo).toHaveBeenCalledWith('settings');
    });

    it('no shots: the empty state across the grid, and the picker says so', async () => {
        const { status } = await openPage({ 'GET /projects/p1/shotlist': { shots: [] } });
        expect(screen.getByText('No shots')).toBeTruthy();
        expect(screen.getByText('No shots yet.')).toBeTruthy();
        expect(status).toContain('No shots');
    });

    it('nothing without a project; failed reads fall back, a broken one says so', async () => {
        const none = installLegacy({ project: null });
        render(<VideoShotsPage />);
        await act(async () => { await window.loadVideoShots(); });
        expect(none.calls).toEqual([]);
        await openPage({ 'GET /projects/p1/video': () => { throw new Error('x'); }, 'GET /projects/p1/providers': () => { throw new Error('y'); } });
        expect(screen.getAllByText('no video').length).toBe(4);
        expect(document.querySelectorAll('#videoshotsGrid')[1].textContent).toMatch(/Video provider: gridlight/);
    });

    it('each card says where the shot is: storyboard frame, generating, failed, or the clip that plays', async () => {
        await openPage();
        expect(card('a').querySelector('img').getAttribute('src')).toBe('http://api.test/film/storyboards/p1/1A.png?w=480');
        expect(within(card('a')).getByText('DINER <night> · 4.0s')).toBeTruthy();
        expect(within(card('c')).getByText('generating')).toBeTruthy();
        expect(within(card('d')).getByText('failed')).toBeTruthy();
        expect(card('b').querySelector('video').getAttribute('src')).toBe('http://api.test/film/video/p1/1B_final.mp4');
        expect(within(card('b')).getByText('video ready')).toBeTruthy();
        expect(within(card('b')).getByText('Available: dialogue, final video')).toBeTruthy();
        expect(within(card('b')).getByText('Regenerate')).toBeTruthy();
        expect(within(card('b')).getByText('Stitch')).toBeTruthy();          // a shot over 5s
        expect(within(card('b')).getByText('Download').getAttribute('href')).toBe('http://api.test/film/video/p1/1B_final.mp4');
        expect(within(card('a')).queryByText('Covers…')).toBeNull();          // nothing to describe yet
        expect(within(card('a')).queryByText('Lip-sync')).toBeNull();
    });

    it('the card actions reach core with the shot and the button pressed', async () => {
        const { fake } = await openPage();
        const b = card('b');
        for (const [label, fn] of [['Regenerate', 'generateVideoFor'], ['Covers…', 'setClipCoverage'], ['Lip-sync', 'lipsyncShot'], ['Upscale', 'postShot'], ['Background…', 'replaceBackground'], ['Stitch', 'stitchShot']]) {
            const button = within(b).getByText(label);
            fireEvent.click(button);
            expect(E[fn]).toHaveBeenCalledWith('b', button);
        }
        fireEvent.click(within(b).getByText('Dialogue'));
        expect(fake.generateVoiceForShot).toHaveBeenCalledWith('b', '1B');
        fireEvent.click(screen.getByText('Send to Premiere'));
        expect(fake.downloadExport).toHaveBeenCalledWith('premiere');
    });

    it('each card carries core’s upload controls: capability, media, the shot, and the loader core calls after', async () => {
        const { fake } = await openPage();
        const forA = fake.mediaUploadControl.mock.calls.filter(c => c[3] === 'a');
        expect(forA.map(c => [c[0], c[1], c[2], c[4].after, c[4].label])).toEqual([
            ['video', 'video', 'shot', 'loadVideoShots', 'Upload clip'],
            ['voice', 'audio', 'shot', 'loadVideoShots', 'Upload dialogue'],
            ['sfx', 'audio', 'shot', 'loadVideoShots', 'Upload SFX'],
            ['lipsync', 'video', 'shot', 'loadVideoShots', 'Upload synced'],
            ['post', 'video', 'shot', 'loadVideoShots', 'Upload final'],
        ]);
        expect([...card('a').querySelectorAll('input[type="file"]')].map(i => i.dataset.importTarget)).toEqual(['video-media', 'voice-media', 'sfx-media', 'lipsync-media', 'post-media']);
    });

    it('the sequence picker: only framed shots, press order is play order; a sequence needs shots, then POSTs and resets', async () => {
        const { calls, status, fake } = await openPage({ 'POST /projects/p1/sequences': {} });
        const picker = document.getElementById('sequenceShotPicker');
        const btn = (code) => within(picker).getByText(code, { exact: false }).closest('button');
        expect(btn('2A').disabled).toBe(true);
        fireEvent.click(screen.getByText('Create sequence'));
        expect(status).toContain('Pick the shots the move travels through first.');
        fireEvent.click(btn('1B')); fireEvent.click(btn('1A'));
        expect(picker.textContent).toBe('2. 1A1. 1B2A2B'); // 1B pressed first; unframed shots shown, disabled
        fireEvent.change(document.getElementById('sequenceName'), { target: { value: 'The crossing' } });
        fireEvent.change(document.getElementById('sequenceDescription'), { target: { value: 'dusk' } });
        await act(async () => { fireEvent.click(screen.getByText('Create sequence')); });
        expect(calls.at(-1)).toEqual({ method: 'POST', path: '/projects/p1/sequences', body: { name: 'The crossing', description: 'dusk', shot_ids: ['b', 'a'] } });
        expect(status).toContain('Sequence created. Preview it before generating — the preview is free.');
        expect(document.getElementById('sequenceName').value).toBe('');
        expect(picker.querySelectorAll('.btn-primary').length).toBe(0);
        expect(fake.loadSequences).toHaveBeenCalledTimes(2);
    });

    it('Generate All Dialogue asks first, then POSTs the batch and says how many lines', async () => {
        vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        const { calls, status } = await openPage({ 'POST /projects/p1/voice/batch': { generated: 7 } });
        await act(async () => { fireEvent.click(screen.getByText('Generate All Dialogue')); });
        expect(calls.length).toBe(3);
        await act(async () => { fireEvent.click(screen.getByText('Generate All Dialogue')); });
        expect(calls.at(-1)).toEqual({ method: 'POST', path: '/projects/p1/voice/batch', body: {} });
        expect(status).toContain('Dialogue: 7 line(s).');
    });

    it('Generate All Videos shows one shot’s prompt as a labelled sample; declined, nothing streams', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const { fake } = await openPage({ 'GET /shots/s2/video/preview': { prompt: 'slow push in on MAYA' } });
        fake.state.shots = [{ id: 's1', shot_code: '1A' }, { id: 's2', shot_code: '1B', has_keyframe: true }];
        await act(async () => { fireEvent.click(screen.getByText('Generate All Videos')); });
        expect(confirm.mock.calls[0][0]).toMatch(/largest single spend in the app/);
        expect(confirm.mock.calls[0][0]).toMatch(/Each shot sends its own prompt\. 1B would send:\n\nslow push in on MAYA$/);
        expect(fake.streamSSEPost).not.toHaveBeenCalled();
    });

    it('a video batch streams progress, says done, hides, and reloads; an error hides it and says why', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { fake, status, calls } = await openPage();
        await act(async () => { fireEvent.click(screen.getByText('Generate All Videos')); });
        const [path, body, onEvent, onDone] = fake.streamSSEPost.mock.calls[0];
        expect([path, body]).toEqual(['/projects/p1/video/batch/stream', {}]);
        expect(document.getElementById('videoshotsProgress').style.display).toBe('block');
        act(() => onEvent({ type: 'status', total_shots: 4 }));
        act(() => onEvent({ type: 'shot_start', shot_code: '1A' }));
        expect(document.getElementById('videoshotsProgressLabel').textContent).toBe('Generating 1A');
        act(() => onEvent({ type: 'shot_complete' }));
        expect(document.getElementById('videoshotsProgressBar').style.width).toBe('25%');
        expect(document.getElementById('videoshotsProgressLabel').textContent).toBe('1/4 processed');
        vi.useFakeTimers();
        await act(async () => { onDone(); });
        expect(document.getElementById('videoshotsProgressLabel').textContent).toBe('Done');
        expect(status).toContain('Video batch complete');
        act(() => vi.advanceTimersByTime(1500));
        expect(document.getElementById('videoshotsProgress').style.display).toBe('none');
        vi.useRealTimers();
        await waitFor(() => expect(calls.filter(c => c.path === '/projects/p1/shotlist').length).toBe(2));
        await act(async () => { fireEvent.click(screen.getByText('Generate All Videos')); });
        act(() => fake.streamSSEPost.mock.calls[1][4](new Error('gateway down')));
        expect(status).toContain('Error: gateway down');
        expect(document.getElementById('videoshotsProgress').style.display).toBe('none');
    });
});
