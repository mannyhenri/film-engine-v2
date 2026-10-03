import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import LocationsPage, { LOCATION_FIELDS } from './LocationsPage.jsx';

const PLACES = () => ({ locations: [
    { id: 'l1', name: 'Dock <7>', scene_count: 3, description: 'Wet', lighting_default: 'sodium', time_of_day_default: 'night', reference_image_url: '/film/plates/l1.png', sound_notes: 'gulls' },
    { id: 'l2', name: 'Kitchen' },
] });
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/locations': PLACES(), ...routes } });
    render(<LocationsPage />);
    await act(async () => { await window.loadLocations(); });
    return legacy;
}
const card = (name) => screen.getByText(name).closest('.entity-card');
const input = (f) => document.querySelector(`#locationModal [data-field="${f}"]`);

describe('Locations', () => {
    it('empty: says so, full width, and no card', async () => {
        installLegacy({ routes: { 'GET /projects/p1/locations': { locations: [] } } });
        render(<LocationsPage />);
        await act(async () => { await window.loadLocations(); });
        expect(screen.getByText('No locations')).toBeTruthy();
        expect(document.querySelectorAll('#locationGrid .entity-card').length).toBe(0);
    });

    it('a card per location: banner plate, scene count, tags; the card opens the sheet, the plate the viewer', async () => {
        await openPage();
        expect(window.state.locations.length).toBe(2);
        const dock = card('Dock <7>');
        expect(dock.querySelector('img').getAttribute('src')).toBe('plate:/film/plates/l1.png@480');
        expect(dock.textContent).toContain('3 scene(s)');
        expect([...dock.querySelectorAll('.tag')].map(t => t.textContent)).toEqual(['sodium', 'night']);
        expect(card('Kitchen').textContent).toContain('0 scene(s)');
        expect(card('Kitchen').textContent).toContain('No description');
        fireEvent.click(dock.querySelector('img'));
        expect(window.openPlateViewer).toHaveBeenCalledWith('http://api.test/film/plates/l1.png', 'Dock <7>');
        expect(window.openSubjectSheet).not.toHaveBeenCalled();
        fireEvent.click(card('Kitchen'));
        expect(window.openSubjectSheet).toHaveBeenCalledWith('location', 'l2');
        expect([...dock.querySelectorAll('.card-actions button')].map(b => b.textContent)).toEqual(['Edit', 'Delete']);
    });

    it('a failed plate is hidden', async () => {
        await openPage();
        const img = card('Dock <7>').querySelector('img');
        fireEvent.error(img);
        expect(img.style.display).toBe('none');
    });

    it('Edit fills every field and does not open the sheet', async () => {
        await openPage();
        fireEvent.click(within(card('Dock <7>')).getByText('Edit'));
        expect(window.openSubjectSheet).not.toHaveBeenCalled();
        expect(screen.getByText('Edit Location')).toBeTruthy();
        for (const f of LOCATION_FIELDS) expect(input(f), f).toBeTruthy();
        expect(input('sound_notes').value).toBe('gulls');
    });

    it('a rename asks, PUTs the answer, says what the screenplay did and reloads the editor', async () => {
        let put;
        const { status } = await openPage({ 'PUT /locations/l2': (b) => { put = b; return { screenplay_update: { updated: true, occurrences: 2, new_version: 5 } }; } });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        fireEvent.click(within(card('Kitchen')).getByText('Edit'));
        fireEvent.change(input('name'), { target: { value: 'Galley' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(confirm.mock.calls[0][0]).toMatch(/^Rename "Kitchen" to "Galley" in the screenplay too\?\n\nThis will update all scene headings/);
        expect(put).toEqual({ name: 'Galley', propagate_to_screenplay: true });
        expect(status).toContain('Location saved. Screenplay updated: 2 occurrence(s) renamed (v5)');
        expect(window.loadScreenplayPage).toHaveBeenCalled();
        expect(input('name').value).toBe('');
        confirm.mockRestore();
    });

    it('a screenplay that needed nothing says why; a plain save says saved', async () => {
        const { status } = await openPage({
            'PUT /locations/l1': { screenplay_update: { updated: false, reason: 'not in any heading' } },
            'POST /projects/p1/locations': { id: 'l3' },
        });
        fireEvent.click(within(card('Dock <7>')).getByText('Edit'));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(status).toContain('Location saved. Screenplay: not in any heading');
        fireEvent.click(screen.getByRole('button', { name: '+ Location' }));
        fireEvent.change(input('name'), { target: { value: 'Roof' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(status.at(-1)).toBe('Location saved');
        expect(window.loadScreenplayPage).not.toHaveBeenCalled();
    });

    it('CHANGE: + Location after a cancelled Edit is an empty form', async () => {
        await openPage();
        fireEvent.click(within(card('Dock <7>')).getByText('Edit'));
        fireEvent.click(screen.getByRole('button', { name: '+ Location' }));
        expect(screen.getByText('New Location')).toBeTruthy();
        expect(input('name').value).toBe('');
    });

    it('Delete confirms, deletes and reloads', async () => {
        const { calls, status } = await openPage({ 'DELETE /locations/l1': {} });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => { fireEvent.click(within(card('Dock <7>')).getByText('Delete')); });
        expect(calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/locations/l1']);
        expect(status).toContain('Location deleted');
        confirm.mockRestore();
    });
});
