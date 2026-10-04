import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import SubtitlesPage, { subTime } from './SubtitlesPage.jsx';

const CUES_EN = { subtitles: [
    { id: 'c1', text: 'Get <inside>.', start_ms: 61500, end_ms: 63250, speaker: 'RAY', position: 'bottom', is_cc: 0, language: 'en', shot_id: 'sh1', style: '' },
    { id: 'c2', text: '[door slams]', start_ms: 64000, end_ms: 65000, speaker: null, position: 'top', is_cc: 1, language: 'en', shot_id: null, style: 'italic' },
] };
const BASE = {
    'GET /projects/p1/languages': { languages: ['en', 'fr'] },
    'GET /projects/p1/subtitles?language=en': CUES_EN,
    'GET /projects/p1/subtitles?language=fr': { subtitles: [] },
    'GET /projects/p1/shotlist': { shots: [{ id: 'sh1', shot_code: '1A' }, { id: 'sh2', shot_code: '1B' }] },
};
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { ...BASE, ...routes } });
    render(<SubtitlesPage />);
    await act(async () => { await window.loadSubtitles(); });
    return legacy;
}
const byId = (id) => document.getElementById(id);

describe('Subtitles', () => {
    it('times read as m:ss.s', () => {
        expect(subTime(61500)).toBe('1:01.5');
        expect(subTime(0)).toBe('0:00.0');
        expect(subTime(-5)).toBe('0:00.0');
    });

    it('opens on the first language, lists its cues as text, and reads the shot list once', async () => {
        const { calls } = await openPage();
        expect(byId('subtitleLang').value).toBe('en');
        expect([...byId('subtitleLang').options].map(o => o.value)).toEqual(['en', 'fr']);
        const cards = document.querySelectorAll('#subtitleList .card');
        expect(cards[0].textContent).toContain('1:01.5 → 1:03.3');
        expect(screen.getByText('Get <inside>.')).toBeTruthy();
        expect(cards[1].querySelector('.badge').textContent).toBe('CC');
        await act(async () => { await window.loadSubtitles(); });
        expect(calls.filter(c => c.path === '/projects/p1/shotlist').length).toBe(1);
    });

    it('falls back to the older languages route when the newer one is absent', async () => {
        const { calls } = await openPage({ 'GET /projects/p1/languages': () => { throw new Error('404'); }, 'GET /projects/p1/subtitles/languages': { languages: ['en'] } });
        expect(calls.map(c => c.path)).toContain('/projects/p1/subtitles/languages');
        expect(document.querySelectorAll('#subtitleList .card').length).toBe(2);
    });

    it('switching language reloads that language\'s cues; an empty one says so', async () => {
        await openPage();
        await act(async () => { fireEvent.change(byId('subtitleLang'), { target: { value: 'fr' } }); });
        expect(screen.getByText('No cues in this language yet.')).toBeTruthy();
    });

    it('a new cue posts seconds as milliseconds, the viewed language, and no shot as null', async () => {
        let posted;
        const { status } = await openPage({ 'POST /projects/p1/subtitles': (b) => { posted = b; return { ok: true }; } });
        fireEvent.click(screen.getByRole('button', { name: '+ Cue' }));
        fireEvent.change(byId('subText'), { target: { value: 'Hello' } });
        fireEvent.change(byId('subStart'), { target: { value: '1.255' } });
        fireEvent.change(byId('subEnd'), { target: { value: '2.5' } });
        fireEvent.click(byId('subCC'));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(posted).toEqual({ text: 'Hello', start_ms: 1255, end_ms: 2500, language: 'en', speaker: '', position: 'bottom', style: '', shot_id: null, is_cc: true });
        expect(status).toContain('Cue added');
    });

    it('refuses a cue with no text, or one that does not end after it starts', async () => {
        const { calls, status } = await openPage();
        fireEvent.click(screen.getByRole('button', { name: '+ Cue' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        fireEvent.change(byId('subText'), { target: { value: 'x' } });
        fireEvent.change(byId('subStart'), { target: { value: '3' } });
        fireEvent.change(byId('subEnd'), { target: { value: '3' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(calls.some(c => c.method === 'POST')).toBe(false);
        expect(status).toEqual(['A cue needs its text', 'A cue has to end after it starts']);
    });

    it('editing fills the cue, its shot and style, and PUTs to the cue', async () => {
        let put;
        await openPage({ 'PUT /subtitles/c1': (b) => { put = b; return { ok: true }; } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
        expect(byId('subStart').value).toBe('61.50');
        expect(byId('subShot').value).toBe('sh1');
        fireEvent.change(byId('subPosition'), { target: { value: 'top' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(put).toMatchObject({ start_ms: 61500, end_ms: 63250, position: 'top', shot_id: 'sh1', speaker: 'RAY' });
    });

    it('FIX: export opens the file route under /film (the legacy page left /film out of the URL, so the download 404d)', async () => {
        await openPage();
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        fireEvent.click(screen.getByRole('button', { name: 'Export VTT' }));
        expect(open).toHaveBeenCalledWith('http://api.test/film/projects/p1/subtitles/export/vtt?language=en', '_blank');
        open.mockRestore();
    });

    it('delete asks first', async () => {
        const { calls } = await openPage({ 'DELETE /subtitles/c2': { ok: true } });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]); });
        expect(calls.some(c => c.method === 'DELETE')).toBe(false);
        confirm.mockReturnValue(true);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]); });
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/subtitles/c2');
        confirm.mockRestore();
    });

    it('a failure to read says so in the list', async () => {
        await openPage({ 'GET /projects/p1/subtitles?language=en': () => { throw new Error('nope'); } });
        expect(screen.getByText('Could not read the subtitles: nope')).toBeTruthy();
    });

    it('the cues can be searched (text, speaker) and filtered; time order stays the default', async () => {
        await openPage();
        const texts = () => [...document.querySelectorAll('#subtitleList > .card strong')].map(n => n.textContent);
        expect(texts()).toEqual(['Get <inside>.', '[door slams]']);
        expect(document.querySelector('[data-list-sort]').value).toBe('time');
        fireEvent.change(document.querySelector('[data-list-search]'), { target: { value: 'ray' } });
        expect(texts()).toEqual(['Get <inside>.']);
        fireEvent.change(document.querySelector('[data-list-search]'), { target: { value: 'zz-none' } });
        expect(texts()).toEqual([]);
        expect(document.querySelector('#subtitleList [data-list-nomatch]')).toBeTruthy();
        fireEvent.change(document.querySelector('[data-list-search]'), { target: { value: '' } });
        fireEvent.change(document.querySelector('[data-list-filter="kind"]'), { target: { value: 'closed caption' } });
        expect(texts()).toEqual(['[door slams]']);
    });
});
