import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import RightsPage from './RightsPage.jsx';

const VOCAB = { status: ['unknown', 'cleared', 'expired', 'blocked'], rights_type: ['commercial_use', 'likeness', 'music_license'],
    entity_type: ['asset', 'character', 'music_cue'], origin: ['original', 'generated', 'licensed', 'public_domain', 'unknown'] };
const REGISTER = { vocabulary: VOCAB, by_status: { cleared: 1, expired: 1 }, rights: [
    { id: 'r1', subject: 'Maya <likeness>', rights_type: 'likeness', status: 'cleared', owner: 'J. Doe', territory: 'worldwide', expires_on: '2027-01-01T00:00:00Z', entity_type: 'character', origin: 'original', restrictions: null },
    { id: 'r2', subject: 'Drive-in score', rights_type: 'music_license', status: 'expired', owner: null, territory: null, expires_on: null, entity_type: 'music_cue', origin: 'derived', restrictions: 'No trailers' },
] };

async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/rights': REGISTER, ...routes } });
    render(<RightsPage />);
    await act(async () => { await window.loadRights(); });
    return legacy;
}
const byId = (id) => document.getElementById(id);

describe('Rights', () => {
    it('lists the register with its summary, and the filter offers the served statuses', async () => {
        await openPage();
        expect([...document.querySelectorAll('#rightsSummary .tag')].map(t => t.textContent)).toEqual(['cleared: 1', 'expired: 1']);
        expect([...document.querySelectorAll('#rightsFilter option')].map(o => o.value)).toEqual(['', 'unknown', 'cleared', 'expired', 'blocked']);
        const cards = document.querySelectorAll('#rightsList .card');
        expect(cards.length).toBe(2);
        expect(cards[0].textContent).toContain('Maya <likeness>');
        expect(cards[0].textContent).toContain('likeness · J. Doe · worldwide · until 2027-01-01');
        expect(cards[1].textContent).toContain('restricted');
        expect(cards[1].textContent).toContain('music license');
    });

    it('the filter narrows the list, and an empty result says so', async () => {
        await openPage();
        fireEvent.change(byId('rightsFilter'), { target: { value: 'blocked' } });
        expect(screen.getByText('Nothing recorded with that status.')).toBeTruthy();
        fireEvent.change(byId('rightsFilter'), { target: { value: 'expired' } });
        expect(document.querySelectorAll('#rightsList .card').length).toBe(1);
    });

    it('an empty register says nothing is recorded yet', async () => {
        await openPage({ 'GET /projects/p1/rights': { vocabulary: VOCAB, by_status: {}, rights: [] } });
        expect(screen.getByText('Nothing recorded yet.')).toBeTruthy();
    });

    it('a register that cannot be read says so in the list', async () => {
        await openPage({ 'GET /projects/p1/rights': () => { throw new Error('no table'); } });
        expect(screen.getByText('Could not read the register: no table')).toBeTruthy();
    });

    it('a new record posts every field as typed, with the served defaults', async () => {
        let posted;
        const { status, fake } = await openPage({ 'POST /projects/p1/rights': (b) => { posted = b; return { ok: true }; } });
        fireEvent.click(screen.getByRole('button', { name: '+ Record' }));
        expect(fake.showModal).toHaveBeenCalledWith('rightModal');
        fireEvent.change(byId('rightSubject'), { target: { value: 'Street location' } });
        fireEvent.change(byId('rightTerritory'), { target: { value: 'UK & Ireland' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(posted).toEqual({ subject: 'Street location', rights_type: 'commercial_use', status: 'unknown', origin: 'unknown',
            entity_type: 'asset', entity_id: '', owner: '', source: '', license_url: '', consent_reference: '',
            territory: 'UK & Ireland', expires_on: '', restrictions: '', notes: '' });
        expect(status).toContain('Record added');
    });

    it('a record with no subject is refused before anything is sent', async () => {
        const { calls, status } = await openPage();
        fireEvent.click(screen.getByRole('button', { name: '+ Record' }));
        fireEvent.change(byId('rightSubject'), { target: { value: '   ' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(calls.some(c => c.method === 'POST')).toBe(false);
        expect(status).toContain('A rights record needs a subject');
    });

    it('editing a derived record never sends an origin, and says why', async () => {
        let put;
        await openPage({ 'PUT /rights/r2': (b) => { put = b; return { ok: true }; } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
        expect(byId('rightOrigin')).toBeNull();
        expect(screen.getByText(/Derived — this file's rights are computed/)).toBeTruthy();
        expect(byId('rightRestrictions').value).toBe('No trailers');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect('origin' in put).toBe(false);
        expect(put.subject).toBe('Drive-in score');
    });

    it('delete asks first, and does nothing when declined', async () => {
        const { calls, status } = await openPage({ 'DELETE /rights/r1': { ok: true } });
        const confirm = vi.spyOn(window, 'confirm');
        confirm.mockReturnValueOnce(false);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]); });
        expect(calls.some(c => c.method === 'DELETE')).toBe(false);
        confirm.mockReturnValueOnce(true);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]); });
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/rights/r1');
        expect(status).toContain('Record removed');
        confirm.mockRestore();
    });

    it('with no vocabulary served, the form will not open', async () => {
        const { status, fake } = await openPage({ 'GET /projects/p1/rights': { rights: [] } });
        fireEvent.click(screen.getByRole('button', { name: '+ Record' }));
        expect(fake.showModal).not.toHaveBeenCalled();
        expect(status[0]).toMatch(/serves no rights vocabulary/);
    });
});

describe('Rights: search, sort and filter (src/lib/list-controls.jsx)', () => {
    it('the search narrows the register (by subject, owner, restrictions), within the status chosen', async () => {
        try { localStorage.clear(); } catch (_) { /* none */ }
        await openPage();
        const subjects = () => [...byId('rightsList').querySelectorAll('.card strong')].map(n => n.textContent);
        const search = document.querySelector('[data-list-search]');
        expect(subjects().length).toBe(2);
        fireEvent.change(search, { target: { value: 'J. DOE' } });
        expect(subjects()).toEqual(['Maya <likeness>']);
        fireEvent.change(search, { target: { value: 'trailers' } });
        expect(subjects()).toEqual(['Drive-in score']);
        fireEvent.change(byId('rightsFilter'), { target: { value: 'cleared' } });
        expect(subjects()).toEqual([]);
        expect(byId('rightsList').querySelector('[data-list-nomatch]')).toBeTruthy();
    });
});
