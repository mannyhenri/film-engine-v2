import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import BrandPage from './BrandPage.jsx';

// Brand kits, end to end against the fake core: the routes, bodies and status lines the legacy page produced.
const FIELDS = [
    { id: 'name', label: 'Name', reaches: 'handoff', why: '' },
    { id: 'tone', label: 'Tone', reaches: 'prompt', why: 'Steers the look.' },
    { id: 'palette', label: 'Palette', reaches: 'prompt', why: '' },
    { id: 'fonts', label: 'Fonts', reaches: 'handoff', why: '' },
    { id: 'cta', label: 'CTA', reaches: 'handoff', why: '' },
];
const KIT = { id: 'b1', name: 'Acme <Co>', tone: 'warm', palette: '["#ff0000","not-a-colour","#00FF00"]', fonts: '[{"role":"title","family":"Inter","weight":"700"}]', cta: 'Buy now', legal_line: 'T&Cs apply' };

async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /brands': { fields: FIELDS, brands: [KIT] }, ...routes } });
    render(<BrandPage />);
    await act(async () => { await window.loadBrands(); });
    return legacy;
}
const typeIn = (id, value) => fireEvent.change(document.getElementById(id), { target: { value } });

describe('Brand', () => {
    it('answers to the loader navigateTo calls and lists each kit, text as text, valid colours only', async () => {
        const { calls, fake } = await openPage();
        expect(calls[0]).toEqual({ method: 'GET', path: '/brands', body: undefined });
        expect(screen.getByText('Acme <Co>')).toBeTruthy();
        expect(screen.getByText('warm')).toBeTruthy();
        expect(document.querySelectorAll('#brandList span[title]').length).toBe(2);
        expect(screen.getByText('Buy now')).toBeTruthy();
        expect(screen.getByText('legal line')).toBeTruthy();
        expect(fake.state.brandRows).toEqual([KIT]);
    });

    it('says so when there are no kits, and when the read fails', async () => {
        await openPage({ 'GET /brands': { fields: FIELDS, brands: [] } });
        expect(screen.getByText(/No brand kits yet/)).toBeTruthy();
        await openPage({ 'GET /brands': () => { throw new Error('offline'); } });
        expect(screen.getByText('Could not read the brands: offline')).toBeTruthy();
    });

    it('+ Brand opens the form built from the served fields, each saying what it reaches', async () => {
        const { fake } = await openPage();
        fireEvent.click(screen.getByText('+ Brand'));
        expect(fake.showModal).toHaveBeenCalledWith('brandModal');
        expect(screen.getByText('New brand')).toBeTruthy();
        expect(document.getElementById('brand_name').tagName).toBe('INPUT');
        expect(document.getElementById('brand_tone').tagName).toBe('TEXTAREA');
        expect(document.getElementById('brand_palette').getAttribute('placeholder')).toBe('one per line');
        expect(document.getElementById('brand_fonts').getAttribute('placeholder')).toBe('role|family|weight, one per line');
        expect(screen.getByText(/Reaches the generation prompt\. Steers the look\./)).toBeTruthy();
    });

    it('a kit needs a name', async () => {
        const { calls, status } = await openPage();
        fireEvent.click(screen.getByText('+ Brand'));
        fireEvent.click(screen.getByText('Save'));
        expect(status).toContain('A brand kit needs a name');
        expect(calls.length).toBe(1);
    });

    it('a new kit POSTs the served fields, lists as JSON, and reloads', async () => {
        const { calls, status, fake } = await openPage({ 'POST /brands': { id: 'b2' } });
        fireEvent.click(screen.getByText('+ Brand'));
        typeIn('brand_name', 'Globex');
        typeIn('brand_palette', '#111111\n\n #222222 ');
        typeIn('brand_fonts', 'body | Lato | 400');
        await act(async () => { fireEvent.click(screen.getByText('Save')); });
        expect(calls[1]).toEqual({ method: 'POST', path: '/brands', body: {
            name: 'Globex', tone: '', palette: '["#111111","#222222"]', fonts: '[{"role":"body","family":"Lato","weight":"400"}]', cta: '',
        } });
        expect(fake.closeModal).toHaveBeenCalledWith('brandModal');
        expect(status).toContain('Brand added');
        await waitFor(() => expect(calls[2]).toEqual({ method: 'GET', path: '/brands', body: undefined }));
    });

    it('Edit fills the form from the kit and PUTs to it', async () => {
        const { calls, status } = await openPage({ 'PUT /brands/b1': {} });
        fireEvent.click(screen.getByText('Edit'));
        expect(screen.getByText('Edit brand')).toBeTruthy();
        expect(document.getElementById('brand_fonts').value).toBe('title|Inter|700');
        expect(document.getElementById('brand_palette').value).toBe('#ff0000\nnot-a-colour\n#00FF00');
        await act(async () => { fireEvent.click(screen.getByText('Save')); });
        expect(calls[1].method).toBe('PUT');
        expect(calls[1].path).toBe('/brands/b1');
        expect(calls[1].body.name).toBe('Acme <Co>');
        expect(status).toContain('Brand updated');
    });

    it('a failed save says why and keeps the form open', async () => {
        const { status, fake } = await openPage({ 'POST /brands': () => { throw new Error('name taken'); } });
        fireEvent.click(screen.getByText('+ Brand'));
        typeIn('brand_name', 'Globex');
        await act(async () => { fireEvent.click(screen.getByText('Save')); });
        expect(status).toContain('Error: name taken');
        expect(fake.closeModal).not.toHaveBeenCalled();
    });

    it('Delete asks first; confirmed, it DELETEs and says how many projects pointed at it', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        const { calls, status } = await openPage({ 'DELETE /brands/b1': { projects_referencing: 2 } });
        await act(async () => { fireEvent.click(screen.getByText('Delete')); });
        expect(calls.length).toBe(1);
        await act(async () => { fireEvent.click(screen.getByText('Delete')); });
        expect(calls[1]).toEqual({ method: 'DELETE', path: '/brands/b1', body: undefined });
        expect(status).toContain('Brand deleted — 2 project(s) referenced it');
        expect(confirm).toHaveBeenCalledTimes(2);
        confirm.mockRestore();
    });
});
