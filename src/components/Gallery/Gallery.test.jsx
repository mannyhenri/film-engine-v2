/*
 * The gallery, as React. Also holds two backend sub-tests of subject-gallery.test.js that read the legacy
 * card renderer's source (function galCardHtml), which the React card does not have; both are skipped
 * (SKIPPED-SUBTESTS.json) and held here by render:
 *   "a served path is made absolute against the API, not the page"
 *   "every subject kind opens the same workspace" (openGallery('<kind>' for each kind, one renderer)
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import Gallery, { gallerySrc } from './Gallery.jsx';

const ROOT = path.resolve(__dirname, '../../..');
const GALLERY = {
    roles: [
        { id: 'reference', title: 'Reference', what: 'The approved plate.', why: 'It conditions every frame.' },
        { id: 'concept', title: 'Concepts', what: 'Explorations.', why: 'Nothing reads them.' },
        { id: 'inspiration', title: 'Inspiration', what: 'Gathered.', why: 'For you.' },
    ],
    by_role: {
        concept: [{ id: 'a1', role: 'concept', image_url: '/film/refsheets/c1/a1.png', view: 'front', note: 'older' }],
        inspiration: [
            { id: 'a2', role: 'inspiration', image_url: 'https://example.com/still.jpg', source_url: 'https://example.com/still.jpg' },
            { id: 'a3', role: 'inspiration', image_url: null },
        ],
    },
};
async function open(routes = {}, kind = 'character') {
    const legacy = installLegacy({ routes: { [`GET /${kind}s/c1/gallery`]: GALLERY, ...routes } });
    render(<Gallery />);
    await act(async () => { await window.openGallery(kind, 'c1', 'Mara'); });
    return legacy;
}
const body = () => document.getElementById('galleryBody');
const statusText = () => document.getElementById('galStatus').textContent;

describe('Gallery', () => {
    it('is rendered at boot, hidden, before anything opens it', () => {
        installLegacy();
        render(<Gallery />);
        const modal = document.getElementById('galleryModal');
        expect(modal).toBeTruthy();
        expect(modal.classList.contains('open')).toBe(false);
        expect(within(modal).getByText('Gallery')).toBeTruthy();
        expect(body().textContent).toBe('');
    });

    it('opens on the subject, titled, and lists every role with its count; an empty reference says what that costs', async () => {
        await open();
        expect(window.showModal).toHaveBeenCalledWith('galleryModal');
        expect(screen.getByText('Mara — gallery')).toBeTruthy();
        const groups = [...body().querySelectorAll('.gal-group h4')].map(h => h.textContent);
        expect(groups).toEqual(['Reference (0)', 'Concepts (1)', 'Inspiration (2)']);
        expect(body().textContent).toContain('No approved reference. Every frame this subject appears in will invent it.');
    });

    it('a failed read replaces the placeholder with why', async () => {
        await open({ 'GET /characters/c1/gallery': () => { throw new Error('gone'); } });
        expect(within(body()).getByText('Could not load the gallery')).toBeTruthy();
        expect(body().textContent).toContain('gone');
        expect(body().textContent).not.toContain('Loading');
    });

    it('a served picture opens the plate viewer, named with its view; a link-only inspiration is a link; none says so', async () => {
        await open();
        fireEvent.click(body().querySelector('img'));
        expect(window.openPlateViewer).toHaveBeenCalledWith('http://api.test/film/refsheets/c1/a1.png', 'Mara — front');
        expect(body().querySelector('a.gal-link').getAttribute('href')).toBe('https://example.com/still.jpg');
        expect(within(body()).getByText('no image')).toBeTruthy();
    });

    it('Make reference / Unset PUT the role, report the note, and reload', async () => {
        let put;
        const { calls } = await open({ 'PUT /gallery/a1/role': (b) => { put = b; return { changed: true, note: 'Now the reference.' }; } });
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Make reference' })[0]); });
        expect(put).toEqual({ role: 'reference' });
        expect(statusText()).toBe('Now the reference.');
        expect(calls.filter(c => c.path === '/characters/c1/gallery').length).toBe(2);
    });

    it('promoting an inspiration is refused, and the refusal offers the override', async () => {
        const bodies = [];
        await open({ 'PUT /gallery/a2/role': (b) => { bodies.push(b); if (!b.allow_inspiration) throw new Error('An inspiration is not yours'); return {}; } });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false);
        const buttons = () => screen.getAllByRole('button', { name: 'Make reference' });
        await act(async () => { fireEvent.click(buttons()[1]); });
        expect(confirm.mock.calls[0][0]).toBe('An inspiration is not yours\n\nMake it the reference anyway?');
        expect(bodies).toEqual([{ role: 'reference' }, { role: 'reference', allow_inspiration: true }]);
        expect(statusText()).toBe('Promoted.');
        await act(async () => { fireEvent.click(buttons()[1]); });
        expect(statusText()).toBe('Left as inspiration.');
        confirm.mockRestore();
    });

    it('a warning is shown over the note', async () => {
        await open({ 'PUT /gallery/a1/role': { changed: true, note: 'ok', warning: 'That leaves no reference.' } });
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Make reference' })[0]); });
        expect(statusText()).toBe('That leaves no reference.');
    });

    it('Delete confirms, deletes, and says so; a refusal sends nothing', async () => {
        const { calls } = await open({ 'DELETE /gallery/a1': {} });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        const del = () => within(body().querySelector('.gal-card')).getByRole('button', { name: 'Delete' });
        fireEvent.click(del());
        expect(calls.some(c => c.method === 'DELETE')).toBe(false);
        await act(async () => { fireEvent.click(del()); });
        expect(calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/gallery/a1']);
        expect(statusText()).toBe('Deleted.');
        confirm.mockRestore();
    });

    it('Explore goes through the paid gate with its free preview, and spends only in send', async () => {
        let posted;
        const { fake, calls } = await open({ 'POST /characters/c1/explore': (b) => { posted = b; return {}; } });
        fireEvent.change(document.getElementById('galInstruction'), { target: { value: ' at night ' } });
        fireEvent.change(document.getElementById('galCount'), { target: { value: '2' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Explore' })); });
        const gate = fake.confirmPaidImage.mock.calls[0][0];
        expect(gate.title).toBe('Explore 2 concepts');
        expect(gate.previewUrl).toBe('/characters/c1/explore/preview?count=2&instruction=at%20night');
        expect(calls.some(c => c.method === 'POST')).toBe(false); // nothing spent before the decision
        await act(async () => { await gate.send({ model: 'm' }); });
        expect(posted).toEqual({ model: 'm', count: 2, instruction: 'at night' });
        expect(window.setStatus).toHaveBeenCalledWith('Concepts generated.');
    });

    it('+ Inspiration posts the link and the note', async () => {
        let posted;
        await open({ 'POST /characters/c1/inspiration': (b) => { posted = b; return {}; } });
        const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce('https://x.test/a.jpg').mockReturnValueOnce('the light');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+ Inspiration' })); });
        expect(posted).toEqual({ source_url: 'https://x.test/a.jpg', note: 'the light' });
        expect(statusText()).toBe('Gathered as inspiration.');
        prompt.mockRestore();
    });

    it('a slow read for the subject you left does not paint over the one you opened', async () => {
        let release;
        installLegacy({ routes: {
            'GET /characters/old/gallery': () => new Promise(r => { release = () => r({ roles: [{ id: 'x', title: 'OLD', what: '', why: '' }], by_role: {} }); }),
            'GET /props/new/gallery': GALLERY,
        } });
        render(<Gallery />);
        let first;
        act(() => { first = window.openGallery('character', 'old', 'Old'); });
        await act(async () => { await window.openGallery('prop', 'new', 'Lamp'); });
        await act(async () => { release(); await first; });
        expect(screen.getByText('Lamp — gallery')).toBeTruthy();
        expect(body().textContent).not.toContain('OLD');
    });
});

describe('subject-gallery.test.js page checks (moved)', () => {
    it('a served path is made absolute against the API, not the page; an absolute link is left alone', () => {
        installLegacy();
        expect(gallerySrc('/film/refsheets/a.png')).toBe('http://api.test/film/refsheets/a.png');
        expect(gallerySrc('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
        expect(gallerySrc('HTTP://EXAMPLE.COM/a.jpg')).toBe('HTTP://EXAMPLE.COM/a.jpg');
    });

    it('every subject kind opens the same workspace: core opens it per kind, and there is one renderer', async () => {
        const { SUBJECT_KINDS } = createRequire(import.meta.url)(path.join(ROOT, 'backend/lib/subject-gallery.js'));
        // Where the sheets open it: the character sheet's engine and the location and prop sheet's.
        const core = ['src/components/CharacterSheet/engine.js', 'src/components/SubjectSheet/engine.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
        for (const kind of SUBJECT_KINDS) expect(core, `no Gallery control for a ${kind}`).toMatch(new RegExp(`openGallery\\(\\s*'${kind}'`));
        // One renderer: the card component, in this file only; and each kind's gallery draws through it.
        const sources = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }).filter(f => /\.jsx$/.test(f) && !f.includes('.test.'));
        expect(sources.filter(f => /function GalCard\(/.test(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')))).toEqual([path.join('components', 'Gallery', 'Gallery.jsx')]);
        for (const kind of SUBJECT_KINDS) {
            await open({}, kind);
            expect(body().querySelectorAll('.gal-card').length, kind).toBe(3);
            cleanup();
        }
    });
});
