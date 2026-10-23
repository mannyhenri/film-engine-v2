import { describe, it, expect, afterEach } from 'vitest';
import { render, act, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ThreeDPage from './ThreeDPage.jsx';

/*
 * 3D Models: every character, location and prop with its model. Characters go to Meshy from their approved reference
 * (through the final review); locations and props are built in Blender by Astra, with a second pass that takes
 * "Add details"; a model opens in the 3D viewer. Locations are listed (they were missing).
 */
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const REF = { references: [{ image_url: '/film/refsheets/p1/front.png' }] };
let L, builds, models, usesA1;
function open({ status = { codex: { found: true }, model: 'gpt-6-astra', blender: { found: true } }, refs = REF } = {}) {
    L = installLegacy({ routes: {
        'GET /projects/p1/characters': { characters: [{ id: 'c1', name: 'JUNE' }] },
        'GET /projects/p1/locations': { locations: [{ id: 'l1', name: 'THE GLASS HARBOUR DINER' }] },
        'GET /projects/p1/props': { props: [{ id: 'p1', name: 'SALT SHAKER' }] },
        'GET /projects/p1/models': () => ({ models, jobs: [] }),
        'GET /projects/p1/astra-builds': () => ({ builds }),
        'GET /astra-builds/status': status,
        'GET /characters/c1/gallery': refs, 'GET /locations/l1/gallery': refs, 'GET /props/p1/gallery': refs,
        'POST /characters/c1/model/from-image': () => ({ ok: true }),
        'POST /projects/p1/astra-builds': b => { const j = { id: 'b' + (builds.length + 1), subject_kind: b.subject_kind, subject_id: b.subject_id, status: 'running', stage: 'Astra is writing the build', round: 1, rounds: 3, renders: [] }; builds = [j, ...builds]; return { build: j }; },
        'GET /models/a1/uses': () => usesA1,
        'DELETE /models/a1?confirm=1': () => { models = models.filter(m => m.asset_id !== 'a1'); return { deleted: true }; },
        'GET /models/m9/uses': { asset_id: 'm9', file_name: 'cup.glb', in_use: false, previz_sets: [], staged_in: [], depth_layers: 0 },
        'DELETE /models/m9': () => { models = models.filter(m => m.asset_id !== 'm9'); return { deleted: true }; },
        'POST /astra-builds/b1/cancel': () => { builds[builds.length - 1].status = 'cancelled'; return { build: builds[0] }; },
    } });
    return render(<ThreeDPage />);
}
const card = name => screen.getByRole('heading', { name }).closest('.md-card');
afterEach(() => { cleanup(); builds = []; models = []; });

describe('3D Models', () => {
    it('lists characters, locations and props, each under its own heading with how it is made', async () => {
        builds = []; models = []; open(); await flush();
        for (const [section, name] of [['Characters', 'JUNE'], ['Locations', 'THE GLASS HARBOUR DINER'], ['Props', 'SALT SHAKER']]) {
            expect(within(screen.getByRole('region', { name: section })).getByRole('heading', { name })).toBeTruthy();
        }
        expect(within(card('JUNE')).getByRole('button', { name: 'Generate on Meshy' })).toBeTruthy();
        expect(within(card('SALT SHAKER')).getByRole('button', { name: 'Build in Blender' })).toBeTruthy();
        expect(card('JUNE').querySelector('img').getAttribute('src')).toBe('http://api.test/film/refsheets/p1/front.png');
    });

    it('a character goes to Meshy from its reference, through the final review', async () => {
        builds = []; models = []; open(); await flush();
        await act(async () => { fireEvent.click(within(card('JUNE')).getByRole('button', { name: 'Generate on Meshy' })); });
        await flush();
        expect(L.calls.some(c => c.method === 'POST' && c.path === '/characters/c1/model/from-image')).toBe(true);
    });

    it('nothing is sent for a subject with no reference picture', async () => {
        builds = []; models = []; open({ refs: { references: [] } }); await flush();
        expect(within(card('JUNE')).getByRole('button', { name: 'Generate on Meshy' }).disabled).toBe(true);
        expect(within(card('SALT SHAKER')).getByRole('button', { name: 'Build in Blender' }).disabled).toBe(true);
        expect(card('SALT SHAKER').textContent).toMatch(/Add a reference picture first/);
    });

    it('a prop is built in Blender; its progress shows, and it can be cancelled', async () => {
        builds = []; models = []; open(); await flush();
        await act(async () => { fireEvent.click(within(card('SALT SHAKER')).getByRole('button', { name: 'Build in Blender' })); });
        await flush();
        expect(L.calls.find(c => c.method === 'POST' && c.path === '/projects/p1/astra-builds').body).toEqual({ subject_kind: 'prop', subject_id: 'p1' });
        const c = card('SALT SHAKER');
        expect(c.textContent).toMatch(/Astra is writing the build · round 1 of 3/);
        expect(within(c).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
        await act(async () => { fireEvent.click(within(c).getByRole('button', { name: 'Cancel build' })); });
        expect(L.calls.some(c2 => c2.path === '/astra-builds/b1/cancel')).toBe(true);
    });

    it('a finished location says it is a Previz set, opens in the viewer, and takes a second pass with details', async () => {
        builds = [{ id: 'b7', subject_kind: 'location', subject_id: 'l1', status: 'done', round: 3, rounds: 3, renders: [], asset_id: 'a1', world_version_id: 'w1' }];
        models = [{ asset_id: 'a1', file_name: 'diner set.glb', format: 'glb', metadata: { kind: 'model_3d', subject_kind: 'location', subject_id: 'l1', source: 'astra-blender' } }];
        open(); await flush();
        const c = card('THE GLASS HARBOUR DINER');
        expect(c.textContent).toMatch(/Model ready · Blender · Astra · a Previz set/);
        await act(async () => { fireEvent.click(within(c).getByRole('button', { name: 'View 3D' })); });
        expect(screen.getByRole('dialog', { name: '3D model: THE GLASS HARBOUR DINER' })).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close the viewer' })); });
        const go = within(c).getByRole('button', { name: 'Run second pass' });
        expect(go.disabled).toBe(true);
        fireEvent.change(within(c).getByLabelText('Add details (second pass)'), { target: { value: 'menus on every table' } });
        await act(async () => { fireEvent.click(go); });
        await flush();
        expect(L.calls.filter(x => x.method === 'POST' && x.path === '/projects/p1/astra-builds').pop().body)
            .toEqual({ subject_kind: 'location', subject_id: 'l1', from_build_id: 'b7', details: 'menus on every table' });
    });

    it('says what is missing when the builder cannot run, and does not offer the build', async () => {
        builds = []; models = []; open({ status: { codex: { found: true }, model: null, blender: { found: true } } }); await flush();
        expect(screen.getByRole('note').textContent).toMatch(/an Astra 6 or newer model in Codex/);
        expect(within(card('SALT SHAKER')).getByRole('button', { name: 'Build in Blender' }).disabled).toBe(true);
        expect(within(card('JUNE')).getByRole('button', { name: 'Generate on Meshy' }).disabled).toBe(false);
    });

    // Set-based over where a Delete button is: a subject's card (its model) and every card of All models.
    it.each([['the subject card', 'SALT SHAKER'], ['All models', null]])('a model not in use deletes from %s at the second click', async (_, subject) => {
        builds = []; models = [{ asset_id: 'm9', file_name: 'cup.glb', format: 'glb', metadata: { kind: 'model_3d', subject_kind: 'prop', subject_id: 'p1', subject_name: 'SALT SHAKER' } }];
        open(); await flush();
        const where = subject ? card(subject) : document.querySelector('#threedModels .md-model');
        await act(async () => { fireEvent.click(within(where).getByRole('button', { name: 'Delete' })); }); await flush();
        const ask = screen.getByRole('alertdialog');
        expect(ask.textContent).toMatch(/Not used anywhere/);
        await act(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Delete' })); }); await flush();
        expect(L.calls.some(c => c.method === 'DELETE' && c.path === '/models/m9')).toBe(true);
        expect(screen.queryByText('cup.glb')).toBeNull();
    });

    it('a model in use says where before it goes: the Previz set and the shots it is placed in; Keep it changes nothing', async () => {
        builds = []; models = [{ asset_id: 'a1', file_name: 'diner set.glb', format: 'glb', metadata: { kind: 'model_3d', subject_kind: 'location', subject_id: 'l1', subject_name: 'THE GLASS HARBOUR DINER', source: 'astra-blender' } }];
        usesA1 = { asset_id: 'a1', file_name: 'diner set.glb', subject_name: 'THE GLASS HARBOUR DINER', in_use: true, depth_layers: 0,
            previz_sets: [{ id: 'v2', version: 2, location_name: 'THE GLASS HARBOUR DINER', pinned_shots: ['1A', '1B'] }], staged_in: [{ shot_code: '1C', count: 2 }] };
        open(); await flush();
        const c = card('THE GLASS HARBOUR DINER');
        await act(async () => { fireEvent.click(within(c).getByRole('button', { name: 'Delete' })); }); await flush();
        const ask = screen.getByRole('alertdialog');
        expect(ask.textContent).toMatch(/Previz set THE GLASS HARBOUR DINER v2: that set version goes, and 1A, 1B are unpinned \(their blocking is kept\)/);
        expect(ask.textContent).toMatch(/placed in 1C \(2×\): taken out of those shots/);
        await act(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' })); });
        expect(L.calls.some(x => x.method === 'DELETE')).toBe(false);
        await act(async () => { fireEvent.click(within(c).getByRole('button', { name: 'Delete' })); }); await flush();
        await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })); }); await flush();
        expect(L.calls.some(x => x.method === 'DELETE' && x.path === '/models/a1?confirm=1')).toBe(true);
    });
});
