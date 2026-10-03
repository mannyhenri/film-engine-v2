import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import StyleBookPage, { styleBookTags, entryBody } from './StyleBookPage.jsx';

const NOTE = 'A style still is the lowest-ranked reference: it is dropped before any cast or location plate.';
const BOOK = { note: NOTE, entries: [
    { id: 'b1', name: 'Ozu <tatami>', description: 'low, still', tags: 'interior', scope: 'library', camera: { shot_type: 'wide', lens: '40mm', movement: 'static', height_m: 0.4, aperture: 2.8 }, media: [{ id: 'm9' }] },
    { id: 'b2', name: 'Whip', description: '', tags: 'action', scope: 'project', camera: { movement: 'whip-pan' }, media: [] },
] };
const ENTRY_MEDIA = { entry: { id: 'b1', media: [
    { id: 'm1', embed_url: 'https://www.youtube.com/embed/x', note: 'the push-in at 1:24' },
    { id: 'm2', link_kind: 'video', url: '/film/style-book/media/m2/file' },
    { id: 'm3', link_kind: 'link', url: 'https://example.com/some/long/reference/page' },
    { id: 'm4', link_kind: 'image', url: '/film/style-book/media/m4/file', note: 'frame grab' },
] } };
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/style-book': BOOK, 'GET /style-book/b1': ENTRY_MEDIA, ...routes } });
    render(<StyleBookPage />);
    await act(async () => { await window.loadStyleBook(); });
    return legacy;
}
const byId = (id) => document.getElementById(id);
const fieldIn = (f) => document.querySelector(`#styleBookModal [data-field="${f}"]`);

describe('Style Book', () => {
    it('tags read like a camera sheet', () => {
        expect(styleBookTags(BOOK.entries[0].camera ? BOOK.entries[0] : {})).toEqual(['wide', '40mm', 'T2.8', '0.4m']);
        expect(styleBookTags({ camera: { movement: 'static' } })).toEqual([]);
    });

    it('the body trims text and keeps a number only when it is one', () => {
        expect(entryBody({ name: ' A ', description: '', tags: '', scope: '', shot_type: ' cu ', movement: '', lens: '', sensor: '', note: '', aperture: '2.8', height_m: '', focus_distance_m: 'x' }))
            .toEqual({ name: 'A', description: '', tags: '', scope: 'library', camera: { shot_type: 'cu', aperture: 2.8 } });
    });

    it('lists the project and library entries as cards, with the served note', async () => {
        const { calls } = await openPage();
        expect(calls[0].path).toBe('/projects/p1/style-book');
        expect(document.querySelectorAll('#styleBookGrid .entity-card').length).toBe(2);
        expect(screen.getByText('Ozu <tatami>')).toBeTruthy();
        expect(document.querySelector('#styleBookGrid img').getAttribute('src')).toBe('http://api.test/film/style-book/media/m9/file');
        expect([...document.querySelectorAll('#styleBookGrid .tag')].map(t => t.textContent)).toContain('this film');
        expect(byId('styleBookGrid').textContent).toContain(NOTE);
    });

    it('with no project open, the library alone', async () => {
        installLegacy({ routes: { 'GET /style-book': { entries: [], note: '' } }, project: null });
        render(<StyleBookPage />);
        await act(async () => { await window.loadStyleBook(); });
        expect(screen.getByText(/No shots yet/)).toBeTruthy();
    });

    it('the filter searches name, tags and camera; nothing matching says so', async () => {
        await openPage();
        fireEvent.change(byId('styleBookFilter'), { target: { value: 'whip-pan' } });
        expect(document.querySelectorAll('#styleBookGrid .entity-card').length).toBe(1);
        fireEvent.change(byId('styleBookFilter'), { target: { value: 'zzz' } });
        expect(screen.getByText('Nothing matches that.')).toBeTruthy();
    });

    it('editing fills every camera field and PUTs the merged body', async () => {
        let put;
        const { status } = await openPage({ 'PUT /style-book/b1': (b) => { put = b; return { entry: { id: 'b1' } }; } });
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]); });
        expect(byId('styleBookModalTitle').textContent).toBe('Edit shot');
        expect(fieldIn('height_m').value).toBe('0.4');
        fireEvent.change(fieldIn('lens'), { target: { value: '50mm' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(put).toEqual({ name: 'Ozu <tatami>', description: 'low, still', tags: 'interior', scope: 'library',
            camera: { shot_type: 'wide', movement: 'static', lens: '50mm', aperture: 2.8, height_m: 0.4 } });
        expect(status).toContain('Style book saved');
    });

    it('a shot needs a name', async () => {
        const { status, calls } = await openPage();
        fireEvent.click(screen.getByRole('button', { name: '+ Shot' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(calls.some(c => c.method === 'POST')).toBe(false);
        expect(status).toContain('Give the shot a name first');
    });

    // ── moved from backend style-book-media / style-book-gaps / style-book (they read legacy functions) ──

    it('MOVED: each visual is drawn as what it is (embed, clip, link, picture), and can be removed', async () => {
        const { calls } = await openPage({ 'DELETE /style-book/media/m3': { ok: true } });
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]); });
        const list = byId('styleBookMediaList');
        expect(list.querySelector('iframe').getAttribute('src')).toBe('https://www.youtube.com/embed/x');
        expect(list.querySelector('video').getAttribute('src')).toBe('http://api.test/film/style-book/media/m2/file');
        expect(list.querySelector('a').getAttribute('href')).toBe('https://example.com/some/long/reference/page');
        const img = list.querySelector('img');
        fireEvent.click(img);
        expect(window.openPlateViewer).toHaveBeenCalledWith('http://api.test/film/style-book/media/m4/file', 'frame grab');
        fireEvent.error(img);
        expect(list.textContent).toContain('This picture could not be loaded.');
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => { fireEvent.click(list.querySelectorAll('button')[2]); });
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/style-book/media/m3');
        confirm.mockRestore();
    });

    it('MOVED: a brand-new shot offers the visual fields, and Add visual saves it first, then attaches the link', async () => {
        const posts = [];
        const { status } = await openPage({
            'POST /projects/p1/style-book': (b) => { posts.push(['entry', b]); return { entry: { id: 'new1' } }; },
            'POST /style-book/new1/media': (b) => { posts.push(['media', b]); return { ok: true }; },
            'GET /style-book/new1': { entry: { id: 'new1', media: [{ id: 'mx', link_kind: 'link', url: 'https://e.com/a' }] } },
        });
        fireEvent.click(screen.getByRole('button', { name: '+ Shot' }));
        expect(byId('styleBookMediaSection')).toBeTruthy();
        expect(byId('styleBookMediaFile')).toBeTruthy();
        expect(byId('styleBookMediaUrl')).toBeTruthy();
        expect(byId('styleBookMediaList').textContent).toContain('saved automatically');
        fireEvent.change(fieldIn('name'), { target: { value: 'Push' } });
        fireEvent.change(byId('styleBookMediaUrl'), { target: { value: 'https://e.com/a' } });
        fireEvent.change(byId('styleBookMediaNote'), { target: { value: 'the move' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add visual' })); });
        expect(posts.map(p => p[0])).toEqual(['entry', 'media']);
        expect(posts[1][1]).toEqual({ source_url: 'https://e.com/a', note: 'the move' });
        expect(byId('styleBookModal').classList.contains('open')).toBe(true); // still open, to add more
        expect(byId('styleBookEditId').value).toBe('new1');
        expect(byId('styleBookModalTitle').textContent).toBe('Edit shot');
        expect(status).toContain('Visual added');
    });

    it('MOVED: a file upload is size-checked and sent as data with its kind', async () => {
        let posted;
        const { fake } = await openPage({ 'POST /style-book/b1/media': (b) => { posted = b; return { ok: true }; } });
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]); });
        const file = new File(['abc'], 'grab.mp4', { type: 'video/mp4' });
        Object.defineProperty(byId('styleBookMediaFile'), 'files', { value: [file], configurable: true });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add visual' })); });
        await waitFor(() => expect(posted).toBeTruthy()); // the FileReader finishes on its own schedule
        expect(fake.checkUploadSize).toHaveBeenCalledWith(file, '/style-book/b1/media');
        expect(posted).toMatchObject({ name: 'grab.mp4', media_kind: 'video' });
        expect(posted.data).toMatch(/^data:video\/mp4;base64,/);
    });

    it('MOVED: the note is the served one, painted where visuals are added — never a literal in the page', async () => {
        await openPage();
        fireEvent.click(screen.getByRole('button', { name: '+ Shot' }));
        expect(byId('styleBookMediaNote_').textContent).toBe(NOTE);
        const src = fs.readFileSync(path.join(__dirname, 'StyleBookPage.jsx'), 'utf8');
        expect(src).not.toMatch(/lowest-ranked/i);
    });

    it('delete asks, naming the shot, and says it goes from every project', async () => {
        const { calls } = await openPage({ 'DELETE /style-book/b2': { ok: true } });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]); });
        expect(confirm.mock.calls[0][0]).toBe('Delete "Whip"?\n\nIt goes from every project.');
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/style-book/b2');
        confirm.mockRestore();
    });

    it('MOVED: the page is on the rail; each entry is an entity-card with a card-actions row (the wrap rule); Save names its handler', async () => {
        await openPage();
        const shell = ['core.js', 'shell.js'].map(f => fs.readFileSync(path.resolve(__dirname, '../../../public/legacy', f), 'utf8')).join('\n');
        expect(shell).toMatch(/id:\s*'stylebook'/);
        for (const card of document.querySelectorAll('#styleBookGrid > .entity-grid > *')) {
            expect(card.className).toBe('entity-card');
            expect(card.querySelector(':scope > .card-actions')).toBeTruthy();
        }
        expect(document.querySelector('#styleBookModal [data-action="saveStyleBookEntry"]').textContent).toBe('Save');
    });

    it('a read failure says so in the grid', async () => {
        await openPage({ 'GET /projects/p1/style-book': () => { throw new Error('down'); } });
        expect(screen.getByText('Could not load the style book: down')).toBeTruthy();
    });

    it('FIX: applying an entry to a shot works before the Style Book page has loaded, and reads the book fresh', async () => {
        let applied;
        const { status } = installLegacy({ routes: {
            'GET /projects/p1/style-book': BOOK,
            'POST /shots/sh1/style-book/b2': () => { applied = true; return { applied: ['movement'] }; },
        } });
        render(<StyleBookPage />); // mounted, as every page is at boot; its loader never ran
        window.loadStoryboard = vi.fn();
        const ask = vi.spyOn(window, 'prompt').mockReturnValue('2');
        await act(async () => { await window.applyStyleBookEntry('sh1'); });
        expect(ask.mock.calls[0][0]).toContain('1. Ozu <tatami> — 40mm');
        expect(applied).toBe(true);
        expect(status).toContain('Applied movement — regenerate the frame to see it');
        expect(window.loadStoryboard).toHaveBeenCalled();
        ask.mockRestore(); delete window.loadStoryboard;
    });

    it('applying: an empty book says so; a cancelled pick sends nothing; an entry that carries nothing says so', async () => {
        const book = { entries: [] };
        const { status, calls } = installLegacy({ routes: {
            'GET /projects/p1/style-book': () => book,
            'POST /shots/sh1/style-book/b1': { applied: [] },
        } });
        render(<StyleBookPage />);
        await act(async () => { await window.applyStyleBookEntry('sh1'); });
        expect(status).toContain('The style book is empty — add a shot first');
        book.entries = BOOK.entries; // added since: read fresh, not from a cache
        const ask = vi.spyOn(window, 'prompt').mockReturnValue(null);
        await act(async () => { await window.applyStyleBookEntry('sh1'); });
        expect(calls.some(c => c.method === 'POST')).toBe(false);
        ask.mockReturnValue('1');
        await act(async () => { await window.applyStyleBookEntry('sh1'); });
        expect(status).toContain('That entry carried nothing this shot could use');
        ask.mockRestore();
    });
});
