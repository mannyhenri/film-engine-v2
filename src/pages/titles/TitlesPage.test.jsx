import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import TitlesPage from './TitlesPage.jsx';

const CREDITS = { sections: ['cast', 'crew', 'special_thanks'], credits: [
    { id: 'c1', name: 'Crew <Person>', section: 'crew', role: 'DP', character_name: null, style: 'bold', sort_order: 2 },
    { id: 'c2', name: 'Ana', section: 'cast', role: null, character_name: 'MAYA', style: null, sort_order: 0 },
] };
const CARDS = { card_types: ['main_title', 'end_title', 'card'], title_cards: [
    { id: 't1', text: 'THE GLASS HARBOUR', subtext: 'a film', card_type: 'main_title', duration_ms: 4500, position_in_timeline: 'before scene 1', style: '', sort_order: 1 },
] };
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/credits': CREDITS, 'GET /projects/p1/title-cards': CARDS, ...routes } });
    render(<TitlesPage />);
    await act(async () => { await window.loadTitles(); });
    return legacy;
}
const byId = (id) => document.getElementById(id);

describe('Titles & Credits', () => {
    it('lists title cards, and credits grouped by section in the served order', async () => {
        await openPage();
        expect(document.querySelector('#titleCardList').textContent).toContain('THE GLASS HARBOUR');
        expect(document.querySelector('#titleCardList').textContent).toContain('main title');
        expect(document.querySelector('#titleCardList').textContent).toContain('4.5s');
        expect([...document.querySelectorAll('#creditList h4')].map(h => h.textContent)).toEqual(['cast', 'crew']);
        expect(screen.getByText('Crew <Person>')).toBeTruthy();
        expect(screen.getByText('as MAYA')).toBeTruthy();
    });

    it('empty lists say so', async () => {
        await openPage({ 'GET /projects/p1/credits': { sections: [], credits: [] }, 'GET /projects/p1/title-cards': { card_types: [], title_cards: [] } });
        expect(screen.getByText(/No title cards\./)).toBeTruthy();
        expect(screen.getByText('No credits yet.')).toBeTruthy();
    });

    it('a read failure says so', async () => {
        await openPage({ 'GET /projects/p1/credits': () => { throw new Error('down'); } });
        expect(screen.getByText('Could not read the titles: down')).toBeTruthy();
    });

    it('a new credit posts its fields with a numeric order', async () => {
        let posted;
        const { status } = await openPage({ 'POST /projects/p1/credits': (b) => { posted = b; return { ok: true }; } });
        fireEvent.click(screen.getByRole('button', { name: '+ Credit' }));
        fireEvent.change(byId('creditName'), { target: { value: 'Lee' } });
        fireEvent.change(byId('creditOrder'), { target: { value: '3' } });
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]); });
        expect(posted).toEqual({ name: 'Lee', section: 'crew', role: '', character_name: '', style: '', sort_order: 3 });
        expect(status).toContain('Credit added');
    });

    it('FIX: Edit opens the row you clicked, so saving keeps its values (the legacy form opened empty)', async () => {
        let put;
        await openPage({ 'PUT /credits/c1': (b) => { put = b; return { ok: true }; } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[2]); // cards first, then credits: cast Ana, crew Crew <Person>
        expect(byId('creditName').value).toBe('Crew <Person>');
        expect(byId('creditRole').value).toBe('DP');
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]); });
        expect(put).toEqual({ name: 'Crew <Person>', section: 'crew', role: 'DP', character_name: '', style: 'bold', sort_order: 2 });
    });

    it('a title card holds in seconds and stores milliseconds; it needs its text', async () => {
        let posted;
        const { status, calls } = await openPage({ 'POST /projects/p1/title-cards': (b) => { posted = b; return { ok: true }; } });
        fireEvent.click(screen.getByRole('button', { name: '+ Title card' }));
        expect(byId('cardDuration').value).toBe('3.0');
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]); });
        expect(calls.some(c => c.method === 'POST')).toBe(false);
        expect(status).toContain('A title card needs its text');
        fireEvent.change(byId('cardText'), { target: { value: 'THE END' } });
        fireEvent.change(byId('cardType'), { target: { value: 'end_title' } });
        fireEvent.change(byId('cardDuration'), { target: { value: '2.25' } });
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]); });
        expect(posted).toEqual({ text: 'THE END', subtext: '', card_type: 'end_title', duration_ms: 2250, position_in_timeline: '', style: '', sort_order: 0 });
        expect(status).toContain('Title card added');
    });

    it('a credit needs a name', async () => {
        const { status, calls } = await openPage();
        fireEvent.click(screen.getByRole('button', { name: '+ Credit' }));
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]); });
        expect(calls.some(c => c.method === 'POST')).toBe(false);
        expect(status).toContain('A credit needs a name');
    });

    it('deletes ask first', async () => {
        const { calls } = await openPage({ 'DELETE /title-cards/t1': { ok: true } });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]); });
        expect(calls.some(c => c.method === 'DELETE')).toBe(false);
        confirm.mockReturnValue(true);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]); });
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/title-cards/t1');
        confirm.mockRestore();
    });
});
