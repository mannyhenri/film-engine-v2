import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { setLegacy } from '../../lib/legacy.js';
import StoryboardPage, { ratioOf, RATIO_CHOICES } from './StoryboardPage.jsx';

/*
 * The board's own card parts and actions moved from core into engine.js; here they are the same fakes the legacy
 * core had (src/test/setup.js BOARD_ENGINE_FAKES), reset before each test, and merged into the `fake` a test reads.
 */
vi.mock('./engine.js', async () => {
    const { BOARD_ENGINE_FAKES } = await import('../../test/setup.js');
    return Object.fromEntries(Object.entries(BOARD_ENGINE_FAKES()).map(([k, v]) => [k, typeof v === 'function' && !vi.isMockFunction(v) ? vi.fn(v) : v]));
});
const E = await import('./engine.js');
const { BOARD_ENGINE_FAKES } = await import('../../test/setup.js');
beforeEach(() => {
    const fresh = BOARD_ENGINE_FAKES();
    for (const [k, v] of Object.entries(E)) {
        if (!vi.isMockFunction(v)) continue;
        v.mockReset();
        if (!vi.isMockFunction(fresh[k])) v.mockImplementation(fresh[k]);
    }
    E.ANCHOR.frames = [];
});
const withEngine = (legacy) => { Object.assign(legacy.fake, E); return legacy; };

const FRAMES = [
    { shot_id: 'a', shot_code: '1A', scene_number: 1, image_url: '/x.png', description: 'Ray <enters>', dialogue: [{}, {}], aspect_ratio: '' },
    { shot_id: 'b', shot_code: '1B', scene_number: 1, image_url: null, aspect_ratio: '9:16' },
];
const BOARD = { frames: FRAMES, annotation_feedback: 1, anchor_shot_id: 'a' };
async function openPage(routes = {}, project = { id: 'p1', aspect_ratio: '16:9' }) {
    const legacy = withEngine(installLegacy({ routes: { 'GET /projects/p1/storyboard': BOARD, ...routes }, project }));
    render(<StoryboardPage />);
    await act(async () => { await window.loadStoryboard(); });
    return legacy;
}
const cardOf = (id) => document.getElementById('img-' + id).closest('.card');

describe('Storyboard', () => {
    it('labels original selected pixels on the right, independent of thumbnail and requested generation sizes', async () => {
        await openPage({ 'GET /projects/p1/storyboard': { frames: [{ ...FRAMES[0], asset_id: 'v2', asset_version: 2,
            image_pixels: { width: 2048, height: 858 }, image_upscaled: true, width: 4096, height: 2160 }] } });
        const card = cardOf('a'), badge = card.querySelector('.resolution-badge');
        expect(badge.textContent).toBe('2K'); expect(badge.title).toContain('2048 × 858'); expect(badge.title).toContain('Upscaled');
        expect(card.querySelector('.shot-resolution-header').lastElementChild).toBe(badge);
        const image = document.getElementById('img-a');
        Object.defineProperties(image, { naturalWidth: { value: 640 }, naturalHeight: { value: 268 } });
        fireEvent.load(image);
        expect(badge.textContent).toBe('2K'); expect(badge.title).toContain('2048 × 858');
    });

    it('version changes reset image/error state and ignore stale A → B → A load events', async () => {
        let frame = { ...FRAMES[0], asset_id: 'A', asset_version: 1, image_pixels: { width: 4096, height: 1716 } };
        await openPage({ 'GET /projects/p1/storyboard': () => ({ frames: [frame] }) });
        const oldA = document.getElementById('img-a'); fireEvent.error(oldA);
        frame = { ...frame, asset_id: 'B', asset_version: 2, image_pixels: { width: 1920, height: 1080 } };
        await act(async () => window.loadStoryboard());
        const b = document.getElementById('img-a');
        expect(b).not.toBe(oldA); expect(b.style.display).toBe('block');
        expect(cardOf('a').querySelector('.resolution-badge')).toBeNull();
        frame = { ...frame, asset_id: 'A', asset_version: 1, image_pixels: { width: 2048, height: 858 } };
        await act(async () => window.loadStoryboard());
        const newA = document.getElementById('img-a');
        Object.defineProperties(oldA, { naturalWidth: { value: 4096 }, naturalHeight: { value: 2160 } });
        fireEvent.load(oldA); fireEvent.error(b);
        expect(newA).not.toBe(oldA); expect(newA.style.display).toBe('block');
        expect(cardOf('a').querySelector('.resolution-badge').title).toContain('2048 × 858');
        expect(cardOf('a').querySelector('.board-protect').style.display).toBe('none');
    });

    it('missing metadata or absent pictures show no size badge even with generation settings', async () => {
        await openPage({ 'GET /projects/p1/storyboard': { frames: [
            { ...FRAMES[0], asset_version: 2, width: 4096, height: 2160, resolution: '4K' },
            { ...FRAMES[1], image_pixels: { width: 4096, height: 2160 } },
        ] } });
        expect(document.querySelectorAll('.resolution-badge')).toHaveLength(0);
        expect(cardOf('a').querySelector('.shot-resolution-header').title).toBe('Pixel dimensions unavailable');
    });

    it('the ratio guide is the shot\'s own ratio, else the project\'s; nothing for an unreadable one', () => {
        expect(ratioOf({ aspect_ratio: '9:16' }, { aspect_ratio: '16:9' })).toEqual({ chosen: '9:16', w: '9', h: '16', own: true });
        expect(ratioOf({}, { aspect_ratio: '2.39:1' })).toMatchObject({ chosen: '2.39:1', own: false });
        expect(ratioOf({}, {})).toBeNull();
    });

    it('loads the board and hands core what it shares: the anchor, the viewer\'s frames, the header, then the banners', async () => {
        const { status, fake } = await openPage();
        expect(document.querySelectorAll('#storyboardGrid > .card').length).toBe(2);
        expect(window.BOARD_ANCHOR).toEqual({ shot_id: 'a', shot_code: '1A' });
        expect(fake.ANCHOR.frames).toBe(FRAMES);
        expect(fake.FRAME_VIEWER.frames).toBe(FRAMES);
        expect(window.state.currentProject.annotation_feedback).toBe(1);
        expect(window.state.currentProject.anchor_shot_id).toBe('a');
        for (const fn of ['loadBoardLock', 'renderAnnotationFeedbackToggle', 'renderAnchorChip', 'loadBoardBanners']) expect(fake[fn], fn).toHaveBeenCalled();
        expect(status).toContain('2 storyboard frame(s)');
    });

    it('keeps every element core writes into, by id', async () => {
        await openPage();
        for (const id of ['img-a', 'annot-a', 'img-b', 'boardBanners', 'anchorChip', 'anchorChipText', 'annotFeedbackToggle', 'annotFeedbackText',
            'boardLockBtn', 'storyboardProgress', 'storyboardProgressBar', 'storyboardImageProgress', 'useReferencesToggle', 'boardProtectRatio']) {
            expect(document.getElementById(id), id).toBeTruthy();
        }
        expect(document.querySelector('[data-facets="a"]').innerHTML).toContain('facets 1A');
        expect(document.getElementById('boardBanners').children.length).toBe(0); // the banners are core's to write
    });

    it('a card: the frame at 640, the ratio guide, its title and description as text, and core\'s shared parts', async () => {
        await openPage();
        const a = cardOf('a');
        expect(document.getElementById('img-a').getAttribute('src')).toBe('frame:1A@640');
        expect(a.querySelector('.board-ratio-tag').textContent).toBe('16:9 (project)');
        expect(cardOf('b').querySelector('.board-ratio-tag').textContent).toBe('9:16');
        expect(screen.getByText('Ray <enters>')).toBeTruthy();
        expect(a.querySelector('.anchor-btn').textContent).toBe('anchor 1A');
        expect(a.querySelector('[data-import-target="storyboard-image"]')).toBeTruthy();
        expect(a.querySelector('.dlg').textContent).toBe('2 lines');
        expect(a.querySelector('.markup-tools').textContent).toBe('markup a');
        expect([...a.querySelectorAll('select[data-field="aspect_ratio"] option')].map(o => o.value)).toEqual(RATIO_CHOICES);
    });

    it('every card button reaches its core action with the shot', async () => {
        const { fake } = await openPage();
        const a = cardOf('a');
        const click = (name) => fireEvent.click([...a.querySelectorAll('button')].find(b => b.textContent.trim() === name));
        expect(screen.queryByRole('button', { name: '4 angles' })).toBeNull();
        const expected = { Direct: 'directShot', Regen: 'regenerateStoryboard', Refine: 'refineFrame', v1: 'openFrameVersions', '▶': 'playFromShot', '+ Shot': 'insertShotAfter' };
        for (const [name, fn] of Object.entries(expected)) { click(name); expect(fake[fn], fn).toHaveBeenCalledWith('a'); }
        expect([...cardOf('b').querySelectorAll('button')].some(b => b.textContent.trim() === 'Generate')).toBe(true); // no frame yet
        fireEvent.click(document.getElementById('img-a'));
        expect(fake.openFrameViewer).toHaveBeenCalledWith('a');
        fireEvent.change(a.querySelector('select[data-field="aspect_ratio"]'), { target: { value: '4:5' } });
        expect(fake.setShotAspect).toHaveBeenCalledWith('a', '4:5');
        fireEvent.load(document.getElementById('img-a'));
        expect(fake.storyboardDrawAnnotations).toHaveBeenCalledWith('a');
    });

    it('the header buttons reach core: Generate All, Lock, clear anchor', async () => {
        const { fake } = await openPage();
        fireEvent.click(screen.getByRole('button', { name: 'Generate All' }));
        fireEvent.click(screen.getByRole('button', { name: 'Lock board' }));
        fireEvent.click(document.querySelector('#anchorChip button')); // hidden until core shows the chip
        for (const fn of ['generateAllStoryboards', 'toggleBoardLock', 'clearAnchor']) expect(fake[fn], fn).toHaveBeenCalled();
    });

    it('the protect frame is drawn over a loaded picture, at the ratio chosen, and off by default', async () => {
        await openPage();
        const img = document.getElementById('img-a');
        Object.defineProperty(img, 'naturalWidth', { value: 1920 }); Object.defineProperty(img, 'naturalHeight', { value: 1080 });
        fireEvent.load(img);
        const box = document.querySelector('.board-protect[data-shot="a"]');
        expect(box.style.display).toBe('none');
        fireEvent.change(document.getElementById('boardProtectRatio'), { target: { value: '9:16' } });
        expect(box.style.display).toBe('block');
        expect(box.innerHTML).toContain('9:16@1.78');
    });

    it('the annotation switch writes the project, says what marks now do, and repaints every badge', async () => {
        let put;
        const { fake, status } = await openPage({ 'PUT /projects/p1': (b) => { put = b; return { annotation_feedback: 0 }; } });
        fake.MARKUP.cache = { a: [], b: [] };
        await act(async () => { fireEvent.click(document.getElementById('annotFeedbackToggle')); });
        expect(put).toEqual({ annotation_feedback: expect.any(Number) });
        expect(status.at(-1)).toMatch(/Marks (carrying a note now steer|are notation only again)/);
        expect(fake.markupPaintAll.mock.calls.map(c => c[0])).toEqual(['a', 'b']);
    });

    it('an empty board says so across the row; a read failure goes to the status line', async () => {
        await openPage({ 'GET /projects/p1/storyboard': { frames: [] } });
        expect(screen.getByText('No storyboard frames')).toBeTruthy();
        const { status } = await openPage({ 'GET /projects/p1/storyboard': () => { throw new Error('down'); } });
        expect(status).toContain('Error: down');
    });

    it('setLegacy writes a listed global, and refuses an unlisted name or a function', () => {
        withEngine(installLegacy());
        setLegacy('BOARD_ANCHOR', { shot_id: 'z' });
        expect(window.BOARD_ANCHOR).toEqual({ shot_id: 'z' });
        expect(() => setLegacy('nope', 1)).toThrow(/not in LEGACY_GLOBALS/);
        expect(() => setLegacy('api', 1)).toThrow(/a page may not replace core behaviour/);
    });

    it('fits wider and taller source pictures inside a stable generation frame and keeps overlays on the picture', async () => {
        await openPage();
        const card = cardOf('a');
        const img = card.querySelector('img');
        const fit = card.querySelector('.board-image-fit');
        const stage = card.querySelector('.board-preview');
        Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 2000 });
        Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 1000 });
        fireEvent.load(img);
        expect(stage.style.aspectRatio).toBe(String(16 / 9));
        expect(fit.style.width).toBe('100%');
        expect(parseFloat(fit.style.height)).toBeCloseTo(88.8889);
        expect(fit.contains(card.querySelector('canvas'))).toBe(true);
        expect(fit.contains(card.querySelector('.board-protect'))).toBe(true);
        expect(card.querySelector('.board-ratio').style.height).toBe('100%');
        Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 900 });
        Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 1600 });
        fireEvent.load(img);
        expect(stage.style.aspectRatio).toBe(String(16 / 9));
        expect(parseFloat(fit.style.width)).toBeCloseTo(31.640625);
        expect(fit.style.height).toBe('100%');
        expect(img.style.objectFit).toBe('contain');
    });

    it('MOVED: a shot with its own ratio is DRAWN at that ratio; one without draws the project\'s', async () => {
        await openPage();
        expect(cardOf('b').querySelector('.board-ratio.own').style.aspectRatio).toBe('9/16');
        expect(cardOf('a').querySelector('.board-ratio.project').style.aspectRatio).toBe('16/9');
    });

    it('MOVED: the frames are painted before any report is waited for (the banners are started after, never awaited)', async () => {
        let release;
        const legacy = withEngine(installLegacy({ routes: { 'GET /projects/p1/storyboard': BOARD } }));
        legacy.fake.loadBoardBanners.mockImplementation(() => new Promise(r => { release = r; })); // a report that never lands
        render(<StoryboardPage />);
        await act(async () => { await window.loadStoryboard(); });
        expect(document.querySelectorAll('#storyboardGrid > .card').length).toBe(2);
        expect(legacy.fake.loadBoardBanners).toHaveBeenCalledTimes(1);
        release();
    });
});

describe('Storyboard: an answer for a project you have left', () => {
    it('a request from an unmounted A cannot write shared state after A → B → A remounts', async () => {
        let releaseOldA, count = 0;
        const latest = { ...FRAMES[0], asset_id: 'latest', asset_version: 3, image_pixels: { width: 2048, height: 858 } };
        const { fake } = withEngine(installLegacy({ routes: {
            'GET /projects/p1/storyboard': () => ++count === 1 ? new Promise(r => { releaseOldA = r; }) : { frames: [latest], annotation_feedback: 0 },
            'GET /projects/p2/storyboard': { frames: [] },
        } }));
        const first = render(<StoryboardPage />);
        let pending; act(() => { pending = window.loadStoryboard(); });
        first.unmount(); fake.state.currentProject = { id: 'p2' };
        const middle = render(<StoryboardPage />); await act(async () => window.loadStoryboard());
        middle.unmount(); fake.state.currentProject = { id: 'p1' };
        render(<StoryboardPage />); await act(async () => window.loadStoryboard());
        await act(async () => {
            releaseOldA({ frames: [{ shot_id: 'old', shot_code: 'Old', asset_version: 1 }], anchor_shot_id: 'old', annotation_feedback: 1 });
            await pending;
        });
        expect(cardOf('a').querySelector('.resolution-badge').textContent).toBe('2K');
        expect(fake.FRAME_VIEWER.frames).toEqual([latest]); expect(fake.ANCHOR.frames).toEqual([latest]);
        expect(fake.state.currentProject.annotation_feedback).toBe(0);
        expect(fake.state.currentProject.anchor_shot_id).toBeNull(); expect(window.BOARD_ANCHOR).toBeNull();
    });

    it('an old A response cannot replace a newer A after A → B → A', async () => {
        let releaseOldA, count = 0;
        const latest = { ...FRAMES[0], asset_id: 'latest', asset_version: 3, image_pixels: { width: 2048, height: 858 } };
        const { fake } = withEngine(installLegacy({ routes: {
            'GET /projects/p1/storyboard': () => ++count === 1 ? new Promise(r => { releaseOldA = r; }) : { frames: [latest] },
            'GET /projects/p2/storyboard': { frames: [] },
        } }));
        render(<StoryboardPage />);
        let pending;
        act(() => { pending = window.loadStoryboard(); });
        fake.state.currentProject = { id: 'p2' }; await act(async () => window.loadStoryboard());
        fake.state.currentProject = { id: 'p1' }; await act(async () => window.loadStoryboard());
        await act(async () => { releaseOldA({ frames: [{ ...latest, asset_version: 1, image_pixels: { width: 4096, height: 1716 } }] }); await pending; });
        expect(cardOf('a').querySelector('.resolution-badge').textContent).toBe('2K');
        expect(fake.FRAME_VIEWER.frames[0].asset_version).toBe(3);
    });

    it('draws nothing and writes nothing onto the project now open', async () => {
        let releaseA;
        const { fake } = withEngine(installLegacy({ routes: {
            'GET /projects/p1/storyboard': () => new Promise(r => { releaseA = () => r({ frames: [{ shot_id: 's1', shot_code: '1A' }], anchor_shot_id: 's1', annotation_feedback: 1 }); }),
        } }));
        render(<StoryboardPage />);
        let pending;
        act(() => { pending = window.loadStoryboard(); });
        const B = { id: 'p2' };
        fake.state.currentProject = B;                                        // switched while A's board was in flight
        await act(async () => { releaseA(); await pending; });
        expect(document.querySelectorAll('#storyboardGrid > .card').length).toBe(0);
        expect(B.anchor_shot_id, 'A\'s anchor written onto B').toBeUndefined();
        expect(B.annotation_feedback).toBeUndefined();
        expect(window.BOARD_ANCHOR).toBe(null);
    });

    it('a board drawn for a project is not drawn once no project is open (nothing renders against no project)', async () => {
        const { fake } = withEngine(installLegacy({ routes: { 'GET /projects/p1/storyboard': { frames: FRAMES } } }));
        const view = render(<StoryboardPage />);
        await act(async () => { await window.loadStoryboard(); });
        const cards = () => document.querySelectorAll('#storyboardGrid > .card').length;
        expect(cards()).toBe(2);
        fake.state.currentProject = null;
        const frameSrc = vi.fn(fake.frameSrc); window.frameSrc = frameSrc;
        view.rerender(<StoryboardPage />);
        expect(cards()).toBe(0);
        expect(frameSrc).not.toHaveBeenCalled();
    });
});
