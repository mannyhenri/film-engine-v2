import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import MarketingPage, { MARKETING_TYPES } from './MarketingPage.jsx';

const LIST = { marketing_assets: [
    { id: 'k1', type: 'key_art', title: 'Teaser <one>', aspect_ratio: '2:3', image_path: '/x/refsheets/p1/teaser one.png' },
    { id: 'k2', type: 'social_card', title: '', aspect_ratio: '1:1', prompt: 'the shadow at blue hour' },
] };
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/marketing': LIST, ...routes } });
    render(<MarketingPage />);
    await act(async () => { await window.loadMarketing(); });
    return legacy;
}
const byId = (id) => document.getElementById(id);
const cards = () => [...document.querySelectorAll('#marketingGrid .entity-card')];

describe('Marketing', () => {
    it('lists each asset as a card: artwork served like a plate, or its prompt; title as text', async () => {
        const { status } = await openPage();
        expect(cards().length).toBe(2);
        expect(screen.getByText('Teaser <one>')).toBeTruthy();
        expect(cards()[0].querySelector('img').getAttribute('src')).toBe('http://api.test/film/refsheets/p1/teaser%20one.png?w=480');
        expect(cards()[1].textContent).toContain('Untitled');
        expect(cards()[1].textContent).toContain('the shadow at blue hour');
        expect(cards()[1].textContent).toContain('social card · 1:1');
        expect(status).toContain('2 marketing asset(s)');
    });

    it('each card carries the shared upload control, aimed at its own import and refreshing this page', async () => {
        const { fake } = await openPage();
        expect(fake.uploadControl).toHaveBeenCalledWith('marketing-asset', '/marketing/k1/import', expect.objectContaining({ after: 'loadMarketing', label: 'Replace' }));
        expect(fake.uploadControl).toHaveBeenCalledWith('marketing-asset', '/marketing/k2/import', expect.objectContaining({ label: 'Upload' }));
        expect(cards()[0].querySelector('[data-import-target="marketing-asset"]')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Generate' })).toBeTruthy();
    });

    it('the filter refetches by type; an empty list says so across the row', async () => {
        const { calls, status } = await openPage({ 'GET /projects/p1/marketing?type=logo': { marketing_assets: [] } });
        expect([...byId('marketingFilter').options].slice(1).map(o => o.value)).toEqual(MARKETING_TYPES.map(t => t[0]));
        await act(async () => { fireEvent.change(byId('marketingFilter'), { target: { value: 'logo' } }); });
        expect(calls.at(-1).path).toBe('/projects/p1/marketing?type=logo');
        expect(screen.getByText('No marketing assets')).toBeTruthy();
        expect(status).toContain('No marketing assets');
    });

    it('creating posts the form (title required), then clears title and prompt', async () => {
        let posted;
        const { status, calls } = await openPage({ 'POST /projects/p1/marketing': (b) => { posted = b; return { ok: true }; } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })); });
        expect(calls.some(c => c.method === 'POST')).toBe(false);
        expect(status).toContain('Give it a title first');
        fireEvent.change(byId('mkType'), { target: { value: 'banner' } });
        fireEvent.change(byId('mkTitle'), { target: { value: '  Banner A ' } });
        fireEvent.change(byId('mkPrompt'), { target: { value: 'street' } });
        fireEvent.change(byId('mkAspect'), { target: { value: '16:9' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })); });
        expect(posted).toEqual({ type: 'banner', title: 'Banner A', prompt: 'street', aspect_ratio: '16:9', resolution: '1080x1620' });
        expect(byId('mkTitle').value).toBe('');
        expect(status).toContain('Marketing asset created');
    });

    it('generating goes through the one paid confirmation, and spends only when it sends', async () => {
        let body;
        const { fake, status } = await openPage({ 'POST /marketing/k2/generate': (b) => { body = b; return { provider: 'muapi' }; } });
        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
        const opts = fake.confirmPaidImage.mock.calls[0][0];
        expect(opts.previewUrl).toBe('/marketing/k2/preview');
        expect(body).toBeUndefined();
        await act(async () => { await opts.send({ model: 'nano-banana-pro' }); });
        expect(body).toEqual({ model: 'nano-banana-pro' });
        expect(status).toContain('Artwork generated via muapi.');
    });

    it('delete asks first, saying the file stays', async () => {
        const { calls } = await openPage({ 'DELETE /marketing/k1': { ok: true } });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]); });
        expect(confirm.mock.calls[0][0]).toContain('The artwork file stays on disk.');
        expect(calls.some(c => c.method === 'DELETE')).toBe(false);
        confirm.mockReturnValue(true);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]); });
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/marketing/k1');
        confirm.mockRestore();
    });
});
