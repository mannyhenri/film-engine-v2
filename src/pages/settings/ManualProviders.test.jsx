import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
vi.mock('../../lib/legacy.js', () => ({ legacy: { api: vi.fn().mockResolvedValue({}), setStatus: vi.fn() } }));
import { legacy } from '../../lib/legacy.js';
import { createRequire } from 'module';
import { keyTiles, CapabilityMap, KeysCard, STUDIO_KEY_PROVIDERS } from './ProviderCards.jsx';

// Registry-based: the manual set comes from the backend's own classification.
const require = createRequire(import.meta.url);
const { MANUAL_PROVIDERS, isManual } = require('../../../backend/lib/manual-generation.js');
const CAPS = { muapi: ['image'], 'muapi-upscale': ['image-upscale'], seedance: ['video', 'post'], higgsfield: ['video', 'image'], 'higgsfield-mcp': ['image', 'video', 'voice', 'post', 'model3d'], meshy: ['model3d', 'image'],
    elevenlabs: ['voice', 'sfx', 'ambient', 'music'], worldlabs: ['world'], google: ['image'], openai: ['llm', 'image'], magnific: ['post'], topaz: ['post'] };
const manualEntry = id => {
    const capabilities = CAPS[id] || ['image'], manual_capabilities = capabilities.filter(c => isManual(id, c));
    // The signed-in Higgsfield has nothing to paste: it is an OAuth sign-in.
    if (id === 'higgsfield-mcp') return { id, label: 'Higgsfield (signed in, plan credits)', account: 'Higgsfield account', requiresKey: false, enabled: false, capabilities, manual_capabilities,
        manual: manual_capabilities.length === capabilities.length, connection: { instructions: 'Sign Film Engine in to your Higgsfield account.', oauth: { external: true, secureTokens: true } }, credentials: { set: false, connected: false } };
    return { id, label: id, requiresKey: true, enabled: false, capabilities, manual_capabilities, manual: manual_capabilities.length === capabilities.length, credentials: { set: false } };
};
const CATALOG = { capabilities: ['image', 'video', 'llm'], providers: [...[...MANUAL_PROVIDERS].map(manualEntry),
    { id: 'anthropic', label: 'Anthropic', requiresKey: true, capabilities: ['llm'], manual_capabilities: [], manual: false, credentials: { set: false } },
    { id: 'gridlight', label: 'Gridlight', capabilities: ['image', 'video'], manual_capabilities: [], manual: false }] };

describe('manual vendors need no API key setup', () => {
    it('the key tiles omit every fully manual provider and keep providers whose text is still sent', () => {
        const ids = keyTiles(CATALOG).map(p => p.id);
        for (const id of MANUAL_PROVIDERS) {
            if (manualEntry(id).manual && !STUDIO_KEY_PROVIDERS.includes(id)) expect(ids, id).not.toContain(id);
        }
        // Production › Generate reads Higgsfield (models, prices, checks), and the signed-in Higgsfield is a sign-in tile.
        for (const id of STUDIO_KEY_PROVIDERS) expect(ids, id).toContain(id);
        expect(ids).toContain('openai');
        expect(ids).toContain('anthropic');
    });
    it.each([...MANUAL_PROVIDERS].flatMap(id => manualEntry(id).manual_capabilities.map(cap => [id, cap])))('%s/%s shows a hand-over note, never a missing-key warning', (id, cap) => {
        const proj = { capabilities: [cap], config: { [cap]: id }, effective: { [cap]: id }, resolution: {}, generation: {} };
        const { container } = render(<CapabilityMap catalog={CATALOG} proj={proj} choice={{}} setChoice={() => {}} onTier={() => {}} />);
        const row = container.querySelector(`[data-cap="${cap}"]`);
        expect(row.textContent).not.toMatch(/no key/);
        expect(row.textContent).toMatch(/prompt and assets/i);
    });
    it('a key still stored for any manual vendor can be cleared; one never stored is not listed', async () => {
        const stored = [...MANUAL_PROVIDERS].filter((id, i) => i % 2 === 0 && !STUDIO_KEY_PROVIDERS.includes(id));
        const catalog = { ...CATALOG, providers: CATALOG.providers.map(p => ({ ...p, credentials: { set: stored.includes(p.id) } })) };
        render(<KeysCard catalog={catalog} onChanged={() => {}} />);
        const list = screen.getByRole('list', { name: 'Stored keys you no longer need' });
        for (const id of MANUAL_PROVIDERS) {
            const entry = manualEntry(id);
            if (!entry.manual || STUDIO_KEY_PROVIDERS.includes(id)) continue;
            const button = list.querySelector(`[data-clear="${id}"]`);
            expect(Boolean(button), id).toBe(stored.includes(id));
        }
        fireEvent.click(list.querySelector(`[data-clear="${stored.find(id => manualEntry(id).manual)}"]`));
        await waitFor(() => expect(legacy.api).toHaveBeenCalledWith(`/providers/${stored.find(id => manualEntry(id).manual)}/credentials`, { method: 'DELETE' }));
    });
    it('the Higgsfield key and the Higgsfield sign-in each have their own tile', () => {
        const catalog = { ...CATALOG, providers: CATALOG.providers.map(p => (p.id === 'higgsfield' ? { ...p, credentials: { set: true, last4: 'ce27' } } : p)) };
        const { container } = render(<KeysCard catalog={catalog} onChanged={() => {}} />);
        const key = container.querySelector('[data-provider="higgsfield"]');
        expect(key.textContent).toMatch(/Production › Generate/);
        expect(key.querySelector('input[type="password"]')).toBeTruthy();
        expect(key.textContent).toMatch(/set ••••ce27/);
        const signIn = container.querySelector('[data-provider="higgsfield-mcp"]');
        expect(signIn, 'the sign-in tile is missing').toBeTruthy();
        expect(signIn.textContent).toMatch(/not connected/);
        expect(signIn.querySelector('input[type="password"]'), 'a sign-in asks for no key').toBeNull();
        expect(within(signIn).getByRole('button', { name: /^Connect/ })).toBeTruthy();
        expect(container.querySelector('[data-provider="runway"]'), 'Runway was removed').toBeNull();
    });
});
