import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
vi.mock('../../lib/legacy.js', () => ({ legacy: { api: vi.fn().mockResolvedValue({}), setStatus: vi.fn() } }));
import { legacy } from '../../lib/legacy.js';
import { createRequire } from 'module';
import { keyTiles, CapabilityMap, KeysCard, STUDIO_KEY_PROVIDERS } from './ProviderCards.jsx';

// Registry-based: the manual set comes from the backend's own classification.
const require = createRequire(import.meta.url);
const { MANUAL_PROVIDERS, isManual } = require('../../../backend/lib/manual-generation.js');
const CAPS = { muapi: ['image'], 'muapi-upscale': ['image-upscale'], seedance: ['video', 'post'], higgsfield: ['video', 'image'], runway: ['image', 'video'], meshy: ['model3d', 'image'],
    elevenlabs: ['voice', 'sfx', 'ambient', 'music'], worldlabs: ['world'], google: ['image'], openai: ['llm', 'image'], magnific: ['post'], topaz: ['post'] };
const manualEntry = id => {
    const capabilities = CAPS[id] || ['image'], manual_capabilities = capabilities.filter(c => isManual(id, c));
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
        // Production › Generate reads Higgsfield and Runway (models, prices, checks): their keys keep a tile.
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
    it('Higgsfield and Runway keys are set on their own tiles, with where to get them and what reads them', () => {
        const catalog = { ...CATALOG, providers: CATALOG.providers.map(p => (STUDIO_KEY_PROVIDERS.includes(p.id) ? { ...p, credentials: { set: p.id === 'runway', last4: 'ce27' } } : p)) };
        const { container } = render(<KeysCard catalog={catalog} onChanged={() => {}} />);
        for (const id of STUDIO_KEY_PROVIDERS) {
            const tile = container.querySelector(`[data-provider="${id}"]`);
            expect(tile, id).toBeTruthy();
            expect(tile.textContent).toMatch(/Production › Generate/);
            expect(tile.querySelector('input[type="password"]')).toBeTruthy();
        }
        expect(container.querySelector('[data-provider="runway"]').textContent).toMatch(/set ••••ce27/);
        expect(container.querySelector('[data-provider="runway"]').textContent).toMatch(/dev\.runwayml\.com/);
        expect(screen.queryByRole('list', { name: 'Stored keys you no longer need' })?.querySelector('[data-clear="runway"]') || null).toBeNull();
    });
});
