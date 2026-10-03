import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import CharactersPage, { CHARACTER_FIELDS } from './CharactersPage.jsx';

const CAST = () => ({ characters: [
    { id: 'c1', name: 'Mara <lead>', age_range: '30s', gender: 'female', height_m: 1.68, description: 'A pilot', has_voice_profile: 1, costume_count: 2, lora_id: 'l1', reference_image_url: '/film/plates/c1.png' },
    { id: 'c2', name: 'Theo', description: '', gender: '', age_range: '' },
    { id: 'c3', name: 'Ines', gender: 'F', age_range: '40s' },
] });
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/characters': CAST(), ...routes } });
    render(<CharactersPage />);
    await act(async () => { await window.loadCharacters(); });
    return legacy;
}
const card = (name) => screen.getByText(name).closest('.entity-card');
const input = (f) => document.querySelector(`#characterModal [data-field="${f}"]`);

describe('Characters', () => {
    it('empty: says so, full width, and no card', async () => {
        installLegacy({ routes: { 'GET /projects/p1/characters': { characters: [] } } });
        render(<CharactersPage />);
        expect(document.querySelector('#characterGrid').children.length).toBe(0); // nothing before the read
        await act(async () => { await window.loadCharacters(); });
        expect(screen.getByText('No characters')).toBeTruthy();
        expect(document.querySelectorAll('#characterGrid .entity-card').length).toBe(0);
    });

    it('a card per character: name as text, facts, plate, tags; core state is filled for the sheet', async () => {
        await openPage();
        expect(window.state.characters.map(c => c.id)).toEqual(['c1', 'c2', 'c3']);
        const mara = card('Mara <lead>');
        expect(mara.textContent).toContain('30s · female · 1.68m');
        expect(mara.querySelector('img').getAttribute('src')).toBe('plate:/film/plates/c1.png@160');
        expect([...mara.querySelectorAll('.tag')].map(t => t.textContent)).toEqual(['Voice', '2 costume(s)', 'LoRA']);
        expect(card('Theo').querySelector('.entity-avatar').textContent).toBe('T');
        expect(card('Theo').textContent).toContain('No description');
    });

    it('a failed plate falls back to the initial', async () => {
        await openPage();
        fireEvent.error(card('Mara <lead>').querySelector('img'));
        expect(card('Mara <lead>').querySelector('img')).toBeNull();
        expect(card('Mara <lead>').querySelector('.entity-avatar').textContent).toBe('M');
    });

    it('what casting needs and is missing is offered, and opens the form', async () => {
        await openPage();
        expect(within(card('Theo')).getByText('+ gender & age')).toBeTruthy();
        expect(card('Ines').querySelector('a')).toBeNull(); // both recorded
        expect(card('Mara <lead>').querySelector('a')).toBeNull();
        fireEvent.click(within(card('Theo')).getByText('+ gender & age'));
        expect(window.showModal).toHaveBeenCalledWith('characterModal');
        expect(window.openCharacterSheet).not.toHaveBeenCalled();
    });

    it('the card opens the sheet; the plate opens the viewer and not the sheet; exactly Edit and Delete', async () => {
        await openPage();
        fireEvent.click(card('Theo'));
        expect(window.openCharacterSheet).toHaveBeenCalledWith('c2');
        window.openCharacterSheet.mockClear();
        fireEvent.click(card('Mara <lead>').querySelector('img'));
        expect(window.openPlateViewer).toHaveBeenCalledWith('http://api.test/film/plates/c1.png', 'Mara <lead>');
        expect(window.openCharacterSheet).not.toHaveBeenCalled();
        expect([...card('Theo').querySelectorAll('.card-actions button')].map(b => b.textContent)).toEqual(['Edit', 'Delete']);
    });

    it('Edit fills every field; a gender the picker does not offer reads empty, as the legacy select did', async () => {
        await openPage();
        fireEvent.click(within(card('Mara <lead>')).getByText('Edit'));
        expect(screen.getByText('Edit Character')).toBeTruthy();
        expect(input('name').value).toBe('Mara <lead>');
        expect(input('height_m').value).toBe('1.68');
        expect(input('gender').value).toBe('female');
        fireEvent.click(within(card('Ines')).getByText('Edit'));
        expect(input('gender').value).toBe('');
        for (const f of CHARACTER_FIELDS) expect(input(f), f).toBeTruthy();
    });

    it('a rename asks about the screenplay and sends the answer; PUT, status with the count, form emptied', async () => {
        let put;
        const { status } = await openPage({ 'PUT /characters/c2': (b) => { put = b; return { screenplay_update: { updated: true, occurrences: 4 } }; } });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        fireEvent.click(within(card('Theo')).getByText('Edit'));
        fireEvent.change(input('name'), { target: { value: ' Teo ' } });
        fireEvent.change(input('height_m'), { target: { value: '1.8' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(confirm.mock.calls[0][0]).toMatch(/^Rename "Theo" to "Teo" in the screenplay too\?/);
        expect(put).toEqual({ name: 'Teo', height_m: 1.8, propagate_to_screenplay: false });
        expect(status).toContain('Character saved. Updated 4 occurrence(s) in screenplay.');
        expect(window.closeModal).toHaveBeenCalledWith('characterModal');
        expect(input('name').value).toBe('');
        confirm.mockRestore();
    });

    it('no rename, no question; a new character POSTs to the project', async () => {
        let posted;
        const { status } = await openPage({ 'POST /projects/p1/characters': (b) => { posted = b; return {}; } });
        const confirm = vi.spyOn(window, 'confirm');
        fireEvent.click(screen.getByRole('button', { name: '+ Character' }));
        fireEvent.change(input('name'), { target: { value: 'June' } });
        fireEvent.change(input('gender'), { target: { value: 'non-binary' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(posted).toEqual({ name: 'June', gender: 'non-binary' });
        expect(confirm).not.toHaveBeenCalled();
        expect(status).toContain('Character saved');
        confirm.mockRestore();
    });

    it('CHANGE: + Character after a cancelled Edit is an empty form, not that character', async () => {
        let posted;
        await openPage({ 'POST /projects/p1/characters': (b) => { posted = b; return {}; } });
        fireEvent.click(within(card('Mara <lead>')).getByText('Edit'));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: '+ Character' }));
        expect(screen.getByText('New Character')).toBeTruthy();
        expect(input('name').value).toBe('');
        fireEvent.change(input('name'), { target: { value: 'Nadia' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(posted).toEqual({ name: 'Nadia' });
    });

    it('no name, no request', async () => {
        const { calls } = await openPage();
        fireEvent.click(screen.getByRole('button', { name: '+ Character' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
    });

    it('Delete confirms, deletes and reloads; a refusal sends nothing', async () => {
        const { calls, status } = await openPage({ 'DELETE /characters/c2': {} });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        fireEvent.click(within(card('Theo')).getByText('Delete'));
        expect(calls.some(c => c.method === 'DELETE')).toBe(false);
        await act(async () => { fireEvent.click(within(card('Theo')).getByText('Delete')); });
        expect(calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/characters/c2']);
        expect(status).toContain('Character deleted');
        expect(calls.filter(c => c.path === '/projects/p1/characters').length).toBe(2);
        confirm.mockRestore();
    });

    it('editCharacter is on window for the sheet and casting, and opens this form', async () => {
        await openPage();
        act(() => { window.editCharacter('c1'); });
        expect(input('name').value).toBe('Mara <lead>');
        expect(window.showModal).toHaveBeenCalledWith('characterModal');
    });

    it('Describe from screenplay: names what stayed blank, then reloads', async () => {
        const { status, calls } = await openPage({ 'POST /projects/p1/entities/describe': { described_count: 2, still_blank: [{ name: 'Theo' }], provider: 'claude' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Describe from screenplay' })); });
        expect(status).toContain('Described 2 entities — still blank: Theo (via claude)');
        expect(calls.filter(c => c.path === '/projects/p1/characters').length).toBe(2);
    });

    it('an error reading the list is reported', async () => {
        const { status } = await openPage({ 'GET /projects/p1/characters': () => { throw new Error('down'); } });
        expect(status).toContain('Error: down');
    });
});
