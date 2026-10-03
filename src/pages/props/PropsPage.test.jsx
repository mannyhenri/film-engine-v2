import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import PropsPage, { PROP_FIELDS, forgetPropCategories } from './PropsPage.jsx';

const PROPS = () => ({ props: [
    { id: 'p1', name: 'Sprinkler', category: 'vehicle', height_m: 0.3, reference_image_url: '/film/plates/p1.png' },
    { id: 'p2', name: 'Mug <hot>', description: 'Chipped' },
    { id: 'p3', name: 'Van', category: 'vehicle' },
] });
const VOCAB = { prop_categories: ['generic', 'vehicle', 'weapon'], prop_category_labels: { generic: 'Generic', vehicle: 'Vehicle' } };
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/props': PROPS(), 'GET /card-vocabulary': VOCAB, ...routes } });
    render(<PropsPage />);
    await act(async () => { await window.loadProps(); });
    return legacy;
}
const card = (name) => screen.getByText(name).closest('.entity-card');
const input = (f) => document.querySelector(`#propModal [data-field="${f}"]`);
const pills = () => [...document.querySelectorAll('#propFilters .filter-pill')];
beforeEach(() => forgetPropCategories());

describe('Props', () => {
    it('empty: says so, full width; no pills before the read', async () => {
        installLegacy({ routes: { 'GET /projects/p1/props': { props: [] } } });
        render(<PropsPage />);
        expect(pills().length).toBe(0);
        await act(async () => { await window.loadProps(); });
        expect(screen.getByText('No props')).toBeTruthy();
        expect(pills().map(p => p.textContent)).toEqual(['all']);
    });

    it('a card per prop with its category (generic when none); the card opens the sheet, the plate the viewer', async () => {
        await openPage();
        expect(window.state.props.length).toBe(3);
        expect(card('Mug <hot>').querySelector('.badge').textContent).toBe('generic');
        expect(card('Sprinkler').querySelector('img').getAttribute('src')).toBe('plate:/film/plates/p1.png@480');
        fireEvent.click(card('Sprinkler').querySelector('img'));
        expect(window.openPlateViewer).toHaveBeenCalledWith('http://api.test/film/plates/p1.png', 'Sprinkler');
        expect(window.openSubjectSheet).not.toHaveBeenCalled();
        fireEvent.click(card('Van'));
        expect(window.openSubjectSheet).toHaveBeenCalledWith('prop', 'p3');
        expect([...card('Van').querySelectorAll('.card-actions button')].map(b => b.textContent)).toEqual(['Edit', 'Delete']);
    });

    it('a pill per category filters what was read, without another request', async () => {
        const { calls } = await openPage();
        expect(pills().map(p => p.textContent)).toEqual(['all', 'vehicle', 'generic']);
        fireEvent.click(screen.getByRole('button', { name: 'vehicle' }));
        expect([...document.querySelectorAll('#propGrid h3')].map(h => h.textContent)).toEqual(['Sprinkler', 'Van']);
        expect(document.querySelector('#propFilters .active').textContent).toBe('vehicle');
        expect(calls.filter(c => c.path === '/projects/p1/props').length).toBe(1);
    });

    it('Edit offers the categories the database accepts BEFORE setting the value, so a vehicle stays a vehicle', async () => {
        await openPage();
        await act(async () => { fireEvent.click(within(card('Sprinkler')).getByText('Edit')); });
        const select = document.getElementById('propCategorySelect');
        expect([...select.options].map(o => [o.value, o.textContent])).toEqual([['generic', 'Generic'], ['vehicle', 'Vehicle'], ['weapon', 'weapon']]);
        expect(select.value).toBe('vehicle');
        expect(input('height_m').value).toBe('0.3');
        expect(input('width_m').value).toBe(''); // no size is empty, not 0
        for (const f of PROP_FIELDS) expect(input(f), f).toBeTruthy();
    });

    it('the vocabulary is read once; when it fails the fallback stays', async () => {
        const { calls } = await openPage({ 'GET /card-vocabulary': () => { throw new Error('x'); } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+ Prop' })); });
        expect([...document.getElementById('propCategorySelect').options].map(o => o.value)).toEqual(['generic']);
        expect(window.showModal).toHaveBeenCalledWith('propModal');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+ Prop' })); });
        expect(calls.filter(c => c.path === '/card-vocabulary').length).toBe(2); // a failure is not cached
    });

    it('Save PUTs the legacy body (numbers as numbers, empties left out) and empties the form', async () => {
        let put;
        const { status } = await openPage({ 'PUT /props/p3': (b) => { put = b; return {}; } });
        await act(async () => { fireEvent.click(within(card('Van')).getByText('Edit')); });
        fireEvent.change(input('length_m'), { target: { value: '4.5' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(put).toEqual({ name: 'Van', category: 'vehicle', length_m: 4.5 });
        expect(status).toContain('Prop saved');
        expect(input('name').value).toBe('');
    });

    it('CHANGE: + Prop after a cancelled Edit is an empty form that POSTs', async () => {
        let posted;
        await openPage({ 'POST /projects/p1/props': (b) => { posted = b; return {}; } });
        await act(async () => { fireEvent.click(within(card('Van')).getByText('Edit')); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+ Prop' })); });
        expect(screen.getByText('New Prop')).toBeTruthy();
        fireEvent.change(input('name'), { target: { value: 'Lamp' } });
        fireEvent.change(input('category'), { target: { value: 'weapon' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(posted).toEqual({ name: 'Lamp', category: 'weapon' });
    });

    it('Delete confirms, deletes and reloads', async () => {
        const { calls, status } = await openPage({ 'DELETE /props/p2': {} });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => { fireEvent.click(within(card('Mug <hot>')).getByText('Delete')); });
        expect(calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/props/p2']);
        expect(status).toContain('Prop deleted');
        confirm.mockRestore();
    });
});
