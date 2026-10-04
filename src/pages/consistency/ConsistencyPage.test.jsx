import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ConsistencyPage from './ConsistencyPage.jsx';

// The Consistency Studio, end to end against the fake core: the routes, bodies and lines the legacy page produced.
const CHARS = [
    { id: 'c1', name: 'Maya <lead>', reference_image_url: '/film/refs/maya.png', appearance_prompt: 'red coat', voice_profile_id: 'vp1' },
    { id: 'c2', name: 'Ray' },
];
const PROFILES = [
    { id: 'pv', profile_type: 'voice', subject_id: 'c1', status: 'draft' },
    { id: 'pl', profile_type: 'location', subject_id: 'l1', status: 'locked', reference_weight: 0.6, required_roles: '["front"]',
        refs: [{ id: 'r1', ref_role: 'front', is_required: 1, asset_id: 'a9', asset_file_name: 'diner_front.png', weight: 0.8 }, { id: 'r2', ref_role: 'wide', asset_id: null }] },
];
const ASSETS = [
    { id: 'a1', asset_type: 'character_sheet', character_id: 'c1', file_name: 'maya_sheet.png' },
    { id: 'a2', asset_type: 'keyframe', metadata: '{"location_id":"l1"}', file_name: 'diner_kf.png' },
    { id: 'a3', asset_type: 'audio', character_id: 'c1' },
];
const AUDIT = { ready: false, warnings: ['Ray has no reference'], shots: [{ shot_code: '1A', ready: true }, { shot_id: 'sh2', ready: false, missing: ['lock Ray'], warnings: ['dark'] }] };
const ROUTES = {
    'GET /projects/p1/characters': { characters: CHARS }, 'GET /projects/p1/locations': { locations: [{ id: 'l1', name: 'Diner' }] },
    'GET /projects/p1/props': { props: [] }, 'GET /projects/p1/consistency/profiles': { profiles: PROFILES, ref_roles: ['front', 'side', 'wide'] },
    'GET /projects/p1/assets': { assets: ASSETS }, 'GET /projects/p1/consistency/audit': AUDIT,
};
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { ...ROUTES, ...routes } });
    render(<ConsistencyPage />);
    await act(async () => { await window.loadConsistency(); });
    return legacy;
}
const card = (id) => document.querySelector(`[data-subject-id="${id}"]`);
const tab = (name) => fireEvent.click(document.querySelector(`#consistencyTabs [data-ctab="${name}"]`));
const shown = (id) => document.getElementById(id).style.display;

describe('Consistency Studio', () => {
    it('answers to the loader: six reads, a readiness banner, a status line', async () => {
        const { calls, status } = await openPage();
        expect(calls.map(c => c.path)).toEqual(['/projects/p1/characters', '/projects/p1/locations', '/projects/p1/props',
            '/projects/p1/consistency/profiles', '/projects/p1/assets', '/projects/p1/consistency/audit']);
        expect(document.getElementById('consistencyReadiness').textContent).toBe('⚠ Consistency incomplete — 1 profile(s) locked, 1/2 shots ready.Ray has no reference');
        expect(status).toEqual(['Loading consistency...', 'Consistency: 1 locked']);
    });

    it('tabs show one panel at a time; Verify loads its checks', async () => {
        const { calls } = await openPage({ 'GET /projects/p1/consistency/checks?limit=100': { checks: [] } });
        expect([shown('consistencyCharacters'), shown('consistencyLocations'), shown('consistencyAudit')]).toEqual(['grid', 'none', 'none']);
        tab('locations');
        expect([shown('consistencyCharacters'), shown('consistencyLocations')]).toEqual(['none', 'grid']);
        expect(document.querySelector('#consistencyTabs .active').dataset.ctab).toBe('locations');
        await act(async () => { tab('verify'); });
        expect(shown('consistencyVerify')).toBe('block');
        expect(calls.at(-1).path).toBe('/projects/p1/consistency/checks?limit=100');
        expect(screen.getByText('No verification runs yet')).toBeTruthy();
    });

    it('each subject: name as text, its state, and the lock it can take', async () => {
        await openPage();
        expect(within(card('c1')).getByText('Maya <lead>')).toBeTruthy();
        expect(within(card('c1')).getByText('not locked')).toBeTruthy();
        expect(card('c1').querySelector('img').getAttribute('src')).toBe('plate:/film/refs/maya.png@480'); // a card asks for the thumbnail
        expect(within(card('c1')).getByText('Lock for production')).toBeTruthy();          // a sheet by character_id
        expect(within(card('c2')).getByText('Lock (needs reference)').disabled).toBe(true);
        expect(within(card('c2')).getByText(/No reference image yet — generate a reference image on the Characters page/)).toBeTruthy();
        expect(within(card('l1')).getByText('🔒 locked')).toBeTruthy();
        expect(within(card('l1')).getByText('Unlock')).toBeTruthy();
    });

    it('an empty kind and an empty audit say so', async () => {
        await openPage({ 'GET /projects/p1/consistency/audit': { ready: true, shots: [] } });
        expect(within(document.getElementById('consistencyProps')).getByText('No props')).toBeTruthy();
        expect(screen.getByText('No shots to audit yet.')).toBeTruthy();
        expect(document.getElementById('consistencyReadiness').textContent).toBe('✓ Consistency ready — 1 profile(s) locked.');
    });

    it('nothing without a project', async () => {
        const none = installLegacy({ project: null });
        render(<ConsistencyPage />);
        await act(async () => { await window.loadConsistency(); });
        expect(none.calls).toEqual([]);
    });

    it('Lock for production: a profile with the image AND the text contract, then the lock, then a reload', async () => {
        const { calls, status } = await openPage({
            'POST /projects/p1/consistency/profiles': { id: 'pc', prompt_contract: '' },
            'PUT /consistency/profiles/pc': {}, 'POST /consistency/profiles/pc/lock': {},
        });
        await act(async () => { fireEvent.click(within(card('c1')).getByText('Lock for production')); });
        expect(calls.slice(6, 9)).toEqual([
            { method: 'POST', path: '/projects/p1/consistency/profiles', body: { profile_type: 'character', subject_id: 'c1', subject_name: 'Maya <lead>', canonical_asset_id: 'a1', prompt_contract: 'red coat' } },
            { method: 'PUT', path: '/consistency/profiles/pc', body: { prompt_contract: 'red coat', canonical_asset_id: 'a1' } },
            { method: 'POST', path: '/consistency/profiles/pc/lock', body: {} },
        ]);
        expect(status).toContain('Maya <lead> locked for production');
        await waitFor(() => expect(calls.filter(c => c.path === '/projects/p1/characters').length).toBe(2));
    });

    it('Unlock, and a failed lock says why', async () => {
        const { calls, status } = await openPage({ 'POST /consistency/profiles/pl/unlock': {}, 'POST /projects/p1/consistency/profiles': () => { throw new Error('busy'); } });
        await act(async () => { fireEvent.click(within(card('l1')).getByText('Unlock')); });
        expect(calls[6]).toEqual({ method: 'POST', path: '/consistency/profiles/pl/unlock', body: {} });
        expect(status).toContain('Unlocked');
        await act(async () => { fireEvent.click(within(card('c1')).getByText('Lock for production')); });
        expect(status).toContain('Lock error: busy');
    });

    it('the voice row: lock a voice that exists; none to lock is disabled', async () => {
        const { calls, status } = await openPage({ 'POST /projects/p1/consistency/profiles': { id: 'pv2' }, 'POST /consistency/profiles/pv2/lock': {} });
        expect(within(card('c1')).getByText('voice not locked')).toBeTruthy();
        expect(within(card('c2')).getByText('no voice profile')).toBeTruthy();
        expect(within(card('c2')).getByText('Lock voice').disabled).toBe(true);
        await act(async () => { fireEvent.click(within(card('c1')).getByText('Lock voice')); });
        expect(calls[6].body).toEqual({ profile_type: 'voice', subject_id: 'c1', subject_name: 'Maya <lead>', settings: { voice_profile_id: 'vp1' } });
        expect(calls[7].path).toBe('/consistency/profiles/pv2/lock');
        expect(status).toContain('Maya <lead> voice locked');
    });

    it('no profile yet: + Add reference roles makes a draft', async () => {
        const { calls, status } = await openPage({ 'POST /projects/p1/consistency/profiles': {} });
        await act(async () => { fireEvent.click(within(card('c2')).getByText('+ Add reference roles')); });
        expect(calls[6].body).toEqual({ profile_type: 'character', subject_id: 'c2', subject_name: 'Ray' });
        expect(status).toContain('Draft profile ready — attach references');
    });

    it('the reference manager: roles, refs, required star, weight, and adding a candidate', async () => {
        const { calls, status } = await openPage({
            'PUT /consistency/profiles/pl': {}, 'DELETE /consistency/refs/r1': {}, 'POST /consistency/profiles/pl/refs': {},
        });
        const m = card('l1').querySelector('details.ref-manager');
        expect(m.querySelector('summary').textContent).toBe('References (2) · weight 0.6 · required roles');
        expect([...m.querySelectorAll('button.tag')].map(b => b.textContent)).toEqual(['front', 'side', 'wide']);
        expect(within(m).getByText('★')).toBeTruthy();
        expect(within(m).getByText('(asset removed)')).toBeTruthy();
        await act(async () => { fireEvent.click([...m.querySelectorAll('button.tag')].find(b => b.textContent === 'side')); });
        expect(calls[6]).toEqual({ method: 'PUT', path: '/consistency/profiles/pl', body: { required_roles: ['front', 'side'] } });
        fireEvent.change(document.getElementById('profWeight_pl'), { target: { value: '1.5' } });
        fireEvent.click(within(m).getByText('Save'));
        expect(status).toContain('Weight must be 0–1');
        fireEvent.change(document.getElementById('profWeight_pl'), { target: { value: '0.9' } });
        await act(async () => { fireEvent.click(within(m).getByText('Save')); });
        expect(calls.find(c => c.body && c.body.reference_weight).body).toEqual({ reference_weight: 0.9 });
        expect([...document.querySelectorAll('#refAsset_pl option')].map(o => o.value)).toEqual(['a2']);   // by metadata, not yet used
        fireEvent.change(document.getElementById('refRole_pl'), { target: { value: 'side' } });
        await act(async () => { fireEvent.click(within(m).getByText('Add')); });
        expect(calls.find(c => c.path === '/consistency/profiles/pl/refs').body).toEqual({ asset_id: 'a2', ref_role: 'side', weight: 0.7 });
        expect(status).toContain('Reference added');
        await act(async () => { fireEvent.click(within(m).getAllByText('Remove')[0]); });
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/consistency/refs/r1');
        expect(status).toContain('Reference removed');
    });

    it('the shot audit lists what each shot misses', async () => {
        await openPage();
        expect([...document.querySelectorAll('#consistencyAudit tr')].map(r => r.textContent)).toEqual(['ShotReadyMissing / Warnings', '1Aready—', 'sh2not readylock Ray, dark']);
    });

    it('Verify: counts, each check with its subjects scored, the shot named from the board; a failure says so', async () => {
        const checks = { counts: { ready: 1, blocked: 2 }, checks: [{ shot_id: 's1', status: 'warning', created_at: '2026-10-03T09:41:22Z', missing: ['face'],
            details: { scorer: 'clip', subjects: [{ subject_name: 'Maya', role: 'face', score: 0.77 }, { subject: 'Diner' }] } }] };
        const legacy = await openPage({ 'GET /projects/p1/consistency/checks?limit=100': checks });
        legacy.fake.state.shots = [{ id: 's1', shot_code: '1A' }];
        await act(async () => { tab('verify'); });
        const v = document.getElementById('consistencyVerify');
        expect(v.querySelector('.card').textContent).toBe('Verification1 ready0 warning2 blocked1 recent check(s)');
        expect(v.querySelectorAll('tr')[1].textContent).toBe('1Awarning · clipMaya (face) 77%Dinerno scoreface2026-10-03 09:41');
        await openPage({ 'GET /projects/p1/consistency/checks?limit=100': () => { throw new Error('offline'); } });
        await act(async () => { fireEvent.click(document.querySelectorAll('#consistencyTabs')[1].querySelector('[data-ctab="verify"]')); });
        expect(screen.getByText('Could not load verification checks: offline')).toBeTruthy();
    });

    it('the subject tab shown can be searched and filtered by lock state; no match says so; another tab has its own list', async () => {
        await openPage();
        const ids = (grid) => [...document.querySelectorAll(`#${grid} [data-subject-id]`)].map(c => c.dataset.subjectId);
        expect(ids('consistencyCharacters')).toEqual(['c1', 'c2']);
        fireEvent.change(document.querySelector('[data-list-search]'), { target: { value: 'ray' } });
        expect(ids('consistencyCharacters')).toEqual(['c2']);
        fireEvent.change(document.querySelector('[data-list-search]'), { target: { value: 'nobody' } });
        expect(document.querySelector('#consistencyCharacters [data-list-nomatch]')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        fireEvent.change(document.querySelector('[data-list-filter="lock"]'), { target: { value: 'not locked' } });
        expect(ids('consistencyCharacters')).toEqual(['c1', 'c2']);
        tab('locations');
        fireEvent.change(document.querySelector('[data-list-filter="lock"]'), { target: { value: 'locked' } });
        expect(ids('consistencyLocations')).toEqual(['l1']);
        expect(document.querySelector('[data-list-count]').textContent).toBe('1 of 1 subjects');
    });
});
