import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { setLegacy } from '../../lib/legacy.js';
import StoryboardPage, { ratioOf, RATIO_CHOICES } from './StoryboardPage.jsx';

const FRAMES = [
    { shot_id: 'a', shot_code: '1A', scene_number: 1, image_url: '/x.png', description: 'Ray <enters>', dialogue: [{}, {}], aspect_ratio: '' },
    { shot_id: 'b', shot_code: '1B', scene_number: 1, image_url: null, aspect_ratio: '9:16' },
];
const BOARD = { frames: FRAMES, annotation_feedback: 1, anchor_shot_id: 'a' };
async function openPage(routes = {}, project = { id: 'p1', aspect_ratio: '16:9' }) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/storyboard': BOARD, ...routes }, project });
    render(<StoryboardPage />);
    await act(async () => { await window.loadStoryboard(); });
    return legacy;
}
const cardOf = (id) => document.getElementById('img-' + id).closest('.card');

describe('Storyboard', () => {
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
        const expected = { Direct: 'directShot', Regen: 'regenerateStoryboard', '4 angles': 'exploreAngles', Refine: 'refineFrame', v1: 'openFrameVersions', '▶': 'playFromShot', '+ Shot': 'insertShotAfter' };
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
        installLegacy();
        setLegacy('BOARD_ANCHOR', { shot_id: 'z' });
        expect(window.BOARD_ANCHOR).toEqual({ shot_id: 'z' });
        expect(() => setLegacy('nope', 1)).toThrow(/not in LEGACY_GLOBALS/);
        expect(() => setLegacy('api', 1)).toThrow(/a page may not replace core behaviour/);
    });
});
