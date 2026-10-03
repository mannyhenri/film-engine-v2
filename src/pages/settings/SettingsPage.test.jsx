import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import SettingsPage, { SETTINGS_SECTIONS, STATUSES, CODECS, DELIVERY_PRESET_OPTIONS, previewSize } from './SettingsPage.jsx';
import { keyTiles, modelOptions, providerConfigBody, CAP_GROUPS } from './ProviderCards.jsx';
import { createRequire } from 'module';
import path from 'path';

const PROJECT = { id: 'p1', title: 'Wingfall', logline: 'A dragon', genre: 'Fantasy', status: 'storyboard', style_preset: 'teal', client: '', campaign: '', target_duration_ms: 30000,
    brand_id: 'b2', video_draft: 1, draft_video: 0, aspect_ratio: '2.39:1', target_resolution: '3840x2160', target_fps: 25, color_space: 'DCI-P3', delivery_format: '',
    delivery_codec: 'prores_422_hq', delivery_audio_channels: 6, timecode_start: '01:00:00:00' };
const CATALOG = { capabilities: ['image', 'video', 'llm'], providers: [
    { id: 'seedance', label: 'Seedance (MuAPI)', account: 'MuAPI', requiresKey: true, enabled: true, capabilities: ['video'], credentials: { set: true, last4: 'ab12' } },
    { id: 'muapi', label: 'MuAPI images', requiresKey: true, sharesKeyWith: 'seedance', capabilities: ['image'], enabled: true, credentials: { set: false } },
    { id: 'runway', label: 'Runway', requiresKey: true, capabilities: ['image', 'video'], credentials: { set: true, suspect: true, last4: 'k' } },
    { id: 'higgsfield', label: 'Higgsfield', requiresKey: true, checkable: true, capabilities: ['video'], connection: { fields: [{ key: 'key_id', label: 'Key ID' }, { key: 'secret', label: 'Secret', type: 'password' }] }, credentials: { fields: {} } },
    { id: 'anthropic', label: 'Anthropic', requiresKey: true, capabilities: ['llm'], credentials: { set: false } },
    { id: 'gridlight', label: 'Gridlight', capabilities: ['image', 'video'] },
] };
const PROJ_PROVIDERS = { project_id: 'p1', capabilities: ['image', 'video', 'llm'], image_quality: 'standard',
    image_tiers: [{ id: 'draft', label: 'Draft', available: true, usd_per_image: 0.04 }, { id: 'standard', label: 'Standard', available: true, usd_per_image: 0.12 }],
    config: { video: 'seedance', video_model: 'seedance-2.5-1080p' }, effective: { image: 'muapi', video: 'seedance', llm: 'anthropic' },
    resolution: { image: { provider: 'muapi', explicit: false, note: 'house standard' } },
    generation: { image: { providers: [{ id: 'muapi', models: [{ id: 'nano-banana-pro', label: 'Nano Banana Pro' }] }, { id: 'runway', models: [{ id: 'gen4_image' }] }] },
        video: { providers: [{ id: 'seedance', models: [{ id: 'seedance-2.5-1080p' }, { id: 'seedance-2.5-480p' }] }, { id: 'runway', models: [{ id: 'gen4.5' }] }] } } };
const ROUTES = {
    'GET /settings': { settings: { author: 'Manny', projects_root: '~/Film Engine', backup_dir: '~/Backups', backup_every_hours: 6, backup_keep: 28, backup_projects: true, gridlight_enabled: '' } },
    'GET /backups/folder': { configured: true, last: { at: '2026-10-01T10:00:00Z' }, count: 4, folder: '~/Backups/me@mac' },
    'GET /providers': CATALOG, 'GET /projects/p1/providers': PROJ_PROVIDERS, 'GET /brands': { brands: [{ id: 'b1', name: 'Acme' }, { id: 'b2', name: 'Globex' }] },
    'GET /projects/p1/storage': { layout: 'project', assets_dir: '/Users/m/Film Engine/Wingfall', exists: true, totals: { files: 12, bytes: 2048 },
        folders: [{ folder: '02 Storyboard', files: 12, bytes: 2048 }, { folder: '04 Video', files: 0, bytes: 0 }] },
};
async function openPage(routes = {}, project = { ...PROJECT }) {
    const legacy = installLegacy({ routes: { ...ROUTES, ...routes }, project });
    localStorage.removeItem('fe_settings_section');
    render(<SettingsPage />);
    await act(async () => { window.loadSettings(); });
    await waitFor(() => expect(document.querySelector('.set-key')).toBeTruthy()); // the catalog is in, with or without a project
    await act(async () => {});
    return legacy;
}
const byId = (id) => document.getElementById(id);
const visibleCards = () => [...document.querySelectorAll('.set-card')].filter(c => !c.classList.contains('set-off') && !c.classList.contains('hidden')).map(c => c.id);

describe('Settings: helpers', () => {
    it('one key tile per account: a rider folds in with its capabilities; set first', () => {
        const tiles = keyTiles(CATALOG);
        expect(tiles.map(t => t.id)).not.toContain('muapi');
        expect(tiles.find(t => t.id === 'seedance').capabilities).toEqual(['video', 'image']);
        expect(tiles[0].id).toBe('seedance'); // the only one genuinely set (runway's is a placeholder)
    });
    it('a model menu: default, the provider\'s models, and a pin it no longer offers, flagged', () => {
        const o = modelOptions('video', { models: [{ id: 'a' }], default_model: 'a' }, 'gone', 'runway');
        expect(o.options.map(x => x.label)).toEqual(['Default (a)', 'a', 'gone (not offered by runway)']);
        expect(modelOptions('image', { models: [] }, '', 'x').disabled).toBe(true);
    });
    it('the providers body: Automatic unpins (null), a model blank stops pinning, the tier carried', () => {
        const body = providerConfigBody(PROJ_PROVIDERS, CATALOG, { video: '', image: 'runway' }, 'draft');
        expect(body).toEqual({ image: 'runway', video: null, llm: null, image_quality: 'draft', image_model: '', video_model: 'seedance-2.5-1080p' });
    });
    it('the preview box is 200 on its long side', () => {
        expect(previewSize('2.39:1')).toEqual({ width: 200, height: 84 });
        expect(previewSize('9:16')).toEqual({ width: 113, height: 200 });
    });
});

describe('Settings: the page', () => {
    it('one section at a time; the choice is remembered; a project section with no project says why', async () => {
        await openPage();
        expect([...document.querySelectorAll('.set-nav-btn')].map(b => b.dataset.setGo)).toEqual(SETTINGS_SECTIONS);
        expect(visibleCards()).toEqual(['settingsProvidersCard']);
        fireEvent.click(screen.getByRole('button', { name: 'Picture and delivery' }));
        expect(visibleCards()).toEqual(['settingsTechnicalCard']);
        expect(localStorage.getItem('fe_settings_section')).toBe('delivery');
    });

    it('a project section with no project open says why it is empty', async () => {
        await openPage({}, null);
        fireEvent.click(screen.getByRole('button', { name: 'Project' }));
        expect(visibleCards()).toEqual([]);
        expect(byId('setSectionEmpty').classList.contains('hidden')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'API keys' }));
        expect(byId('setSectionEmpty').classList.contains('hidden')).toBe(true);
    });

    it('the project card loads the project and saves the legacy body; the shell is updated', async () => {
        let put;
        const { fake, status } = await openPage({ 'PUT /projects/p1': (b) => { put = b; return { ...b }; } });
        expect(byId('settingsTitle').value).toBe('Wingfall');
        expect(byId('settingsTargetDuration').value).toBe('30');
        expect(byId('settingsBrand').value).toBe('b2');
        expect([...byId('settingsStatus').options].map(o => o.value)).toEqual(STATUSES.map(s => s[0]));
        fireEvent.change(byId('settingsGenre'), { target: { value: ' Fable ' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Project' })); });
        expect(put).toEqual({ title: 'Wingfall', logline: 'A dragon', genre: 'Fable', status: 'storyboard', style_preset: 'teal', video_draft: 0, client: '', campaign: '', target_duration_ms: 30000, brand_id: 'b2' });
        expect(fake.paintProjectType).toHaveBeenCalled();
        expect(fake.setStatusDot).toHaveBeenCalledWith('storyboard');
        expect(status).toContain('Project updated');
    });

    it('FIX: both drafting switches read draft_video (the project card read video_draft, ON when absent)', async () => {
        await openPage();
        expect(byId('settingsVideoDraft').checked).toBe(false); // video_draft is 1 here, draft_video 0: the engine does not draft
        expect(byId('settingsDraftVideo').checked).toBe(false);
        await openPage({}, { ...PROJECT, video_draft: undefined, draft_video: undefined });
        expect(byId('settingsVideoDraft').checked).toBe(false);
    });

    it('a style that names a subject is warned about beside the field, as text', async () => {
        await openPage({ 'PUT /projects/p1': (b) => ({ ...b, style_warning: { subjects: ['dragon'], detail: 'This style names a subject: dragon' } }) });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Project' })); });
        expect(byId('settingsStyleWarning').textContent).toBe('This style names a subject: dragon');
    });

    it('delete asks through core, then goes back to the list', async () => {
        const { fake, calls } = await openPage({ 'DELETE /projects/p1': {} });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete Project' })); });
        expect(fake.confirmProjectDelete).toHaveBeenCalledWith('p1', 'Wingfall');
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/projects/p1');
        expect(fake.backToProjectList).toHaveBeenCalled();
    });

    it('technical: loads the stored delivery codec, audio and draft; saves the legacy body; the preview follows the ratio', async () => {
        let put;
        await openPage({ 'PUT /projects/p1': (b) => { put = b; return { ...b }; } });
        expect([...byId('settingsDeliveryCodec').options].map(o => o.value)).toEqual(CODECS.map(c => c[0]));
        expect([...byId('settingsDeliveryPreset').options].map(o => o.value)).toEqual(DELIVERY_PRESET_OPTIONS.map(c => c[0]));
        expect(byId('settingsDeliveryCodec').value).toBe('prores_422_hq');
        expect(byId('settingsDeliveryAudio').value).toBe('6');
        expect(byId('aspectPreviewLabel').textContent).toBe('2.39:1');
        fireEvent.change(byId('settingsAspectRatio'), { target: { value: 'custom' } });
        expect(byId('customAspectGroup').style.display).toBe('');
        fireEvent.change(byId('settingsAspectCustom'), { target: { value: '2.20:1' } });
        fireEvent.click(byId('settingsDraftVideo'));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Technical Settings' })); });
        expect(put).toEqual({ aspect_ratio: 'custom', aspect_ratio_custom: '2.20:1', target_resolution: '3840x2160', target_fps: 25, color_space: 'DCI-P3', delivery_format: '',
            timecode_start: '01:00:00:00', delivery_codec: 'prores_422_hq', delivery_audio_channels: 6, video_draft: true });
    });

    it('a delivery preset is applied by the server, and the card shows what it wrote', async () => {
        const { calls } = await openPage({ 'POST /projects/p1/settings/preset': (b) => ({ project: { aspect_ratio: '16:9', delivery_codec: 'h265', delivery_audio_channels: 2, delivery_format: b.preset } }) });
        await act(async () => { fireEvent.change(byId('settingsDeliveryPreset'), { target: { value: 'streaming_4k' } }); });
        expect(calls.find(c => c.method === 'POST').body).toEqual({ preset: 'streaming_4k' });
        expect(byId('settingsAspectRatio').value).toBe('16:9');
        expect(byId('settingsDeliveryCodec').value).toBe('h265');
    });

    it('API keys: a placeholder is not a working key; a key is saved and never shown; fields and the free check', async () => {
        const bodies = [];
        const { status } = await openPage({ 'PUT /providers/anthropic/credentials': (b) => { bodies.push(b); return {}; }, 'GET /providers/higgsfield/check': { note: 'Key accepted.' },
            'PUT /providers/higgsfield/credentials': (b) => { bodies.push(b); return {}; } });
        fireEvent.click(screen.getByRole('button', { name: 'API keys' }));
        const tile = (id) => document.querySelector(`.set-key[data-provider="${id}"]`);
        expect(tile('runway').textContent).toContain('too short to be a key');
        expect(tile('seedance').textContent).toContain('set ••••ab12');
        expect(tile('seedance').textContent).toContain('Video · Image');
        expect(byId('providerKeyCount').textContent).toBe('1 of 4 set');
        fireEvent.change(byId('provkey-anthropic'), { target: { value: ' sk-ant-123456789 ' } });
        await act(async () => { fireEvent.click(tile('anthropic').querySelector('.btn-secondary')); });
        expect(bodies[0]).toEqual({ api_key: 'sk-ant-123456789' });
        expect(byId('provkey-anthropic').value).toBe(''); // the typed key is not kept on the page
        fireEvent.change(byId('provfield-higgsfield-key_id'), { target: { value: 'id1' } });
        await act(async () => { fireEvent.click([...tile('higgsfield').querySelectorAll('button')].find(b => b.textContent === 'Save')); });
        expect(bodies[1]).toEqual({ fields: { key_id: 'id1' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check key' })); });
        expect(byId('provcheck-higgsfield').textContent).toBe('✓ Key accepted.');
        expect(status).toContain('anthropic key saved');
    });

    it('providers: grouped, who chose each, a fall-through warned; the model menu follows the provider; saved as the route expects', async () => {
        let put;
        await openPage({ 'PUT /projects/p1/providers': (b) => { put = b.config; return {}; } });
        const map = byId('providerCapabilityMap');
        expect([...map.querySelectorAll('.set-group-h')].map(h => h.textContent)).toEqual(['Pictures', 'Motion', 'Writing']);
        expect(map.querySelector('[data-cap="video"] .set-cap-state').textContent).toBe('Pinned for this project');
        expect(map.querySelector('[data-cap="image"] .set-cap-state').textContent).toContain('Nobody picked this: it falls to MuAPI images');
        expect([...byId('provmodel-image').options].map(o => o.value)).toEqual(['', 'nano-banana-pro']);
        fireEvent.change(byId('provcap-image'), { target: { value: 'runway' } });
        expect([...byId('provmodel-image').options].map(o => o.value)).toEqual(['', 'gen4_image']);
        fireEvent.change(byId('provmodel-image'), { target: { value: 'gen4_image' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save providers and models' })); });
        expect(put).toEqual({ image: 'runway', video: 'seedance', llm: null, image_quality: 'standard', image_model: 'gen4_image', video_model: 'seedance-2.5-1080p' });
    });

    it('a quality tier saves on the click; a panel built for another project is not saved onto this one', async () => {
        const puts = [];
        const { status } = await openPage({ 'PUT /projects/p1/providers': (b) => { puts.push(b.config); return {}; } });
        await act(async () => { fireEvent.click(byId('tierbtn-draft')); });
        expect(puts[0].image_quality).toBe('draft');
        window.state.currentProject = { ...PROJECT, id: 'p2' };
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save providers and models' })); });
        expect(puts.length).toBe(1);
        expect(status).toContain('Provider settings were showing another project — reloading them');
    });

    it('where it is saved: the folder and its contents; a move asks, names the destination, and reports', async () => {
        let moved;
        const { status } = await openPage({ 'GET /storage/suggest?title=Wingfall&parent=%2FVolumes%2FFilms&project_id=p1': { valid: true, assets_dir: '/Volumes/Films/Wingfall' },
            'POST /projects/p1/storage/move': (b) => { moved = b; return { to: b.assets_dir, files_moved: 12 }; } });
        fireEvent.click(screen.getByRole('button', { name: 'Where it is saved' }));
        expect(byId('settingsFolderTitle').textContent).toBe('Where "Wingfall" is saved');
        expect(byId('settingsFolderInfo').textContent).toContain('/Users/m/Film Engine/Wingfall');
        expect(byId('settingsFolderInfo').textContent).toContain('04 Video'); // a project layout lists every folder
        expect(byId('settingsFolderMoveTo').value).toBe('/Users/m/Film Engine');
        expect(byId('settingsProjectsRoot').value).toBe('~/Film Engine');
        byId('settingsFolderMoveTo').value = '/Volumes/Films';
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => { fireEvent.click(byId('settingsFolderMoveBtn')); });
        expect(confirm.mock.calls[0][0]).toContain('/Volumes/Films/Wingfall');
        expect(moved).toEqual({ assets_dir: '/Volumes/Films/Wingfall' });
        expect(status).toContain('Moved 12 files to /Volumes/Films/Wingfall');
        confirm.mockRestore();
    });

    it('the folder fields use core\'s picker, and save only when changed', async () => {
        const puts = [];
        const { fake } = await openPage({ 'PUT /settings': (b) => { puts.push(b); return {}; } });
        fireEvent.click(screen.getByRole('button', { name: 'Where it is saved' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Browse…' })[1]);
        expect(fake.openFolderPicker.mock.calls[0][0]).toBe('settingsProjectsRoot');
        fireEvent.blur(byId('settingsProjectsRoot'));
        expect(puts.length).toBe(0); // unchanged
        byId('settingsProjectsRoot').value = '~/Films';
        await act(async () => { fireEvent.blur(byId('settingsProjectsRoot')); });
        expect(puts[0]).toEqual({ projects_root: '~/Films' });
    });

    it('backups: loaded with their status; a change saves the whole set; Back up now runs one', async () => {
        const puts = [];
        const { calls } = await openPage({ 'PUT /settings': (b) => { puts.push(b); return {}; }, 'POST /backups/folder/run': { folder: '~/Backups/me@mac', file: 'a.db' } });
        expect(byId('settingsBackupDir').value).toBe('~/Backups');
        expect(byId('settingsBackupEvery').value).toBe('6');
        expect(byId('settingsBackupProjects').checked).toBe(true);
        expect(byId('settingsBackupStatus').textContent).toContain('4 kept');
        await act(async () => { fireEvent.click(byId('settingsBackupProjects')); });
        expect(puts[0]).toEqual({ backup_dir: '~/Backups', backup_every_hours: '6', backup_keep: '28', backup_projects: false });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back up now' })); });
        expect(calls.some(c => c.path === '/backups/folder/run')).toBe(true);
    });

    it('you: the author saved and core\'s cached copy updated; the API URL set and reset through core', async () => {
        let put;
        const { fake } = await openPage({ 'PUT /settings': (b) => { put = b; return {}; } });
        expect(byId('settingsAuthor').value).toBe('Manny');
        fireEvent.change(byId('settingsAuthor'), { target: { value: ' Ana ' } });
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).find(b => b.closest('#settingsYouCard'))); });
        expect(put).toEqual({ author: 'Ana' });
        expect(window.APP_AUTHOR).toBe('Ana');
        fireEvent.change(byId('settingsApiUrl'), { target: { value: 'http://mac.local:3100/' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).find(b => b.closest('#settingsConnectionCard')));
        expect(window.API_BASE).toBe('http://mac.local:3100');
        expect(fake.feStore.set).toHaveBeenCalledWith('film_api_url', 'http://mac.local:3100');
        fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));
        expect(window.API_BASE).toBe('http://default.test');
        expect(fake.checkHealth).toHaveBeenCalledTimes(2);
    });

    it('the local endpoints switch saves on the click and says what Gridlight would serve; a failed save puts it back', async () => {
        const { status } = await openPage({ 'PUT /settings': () => { throw new Error('locked'); } });
        expect(byId('gridlightServes').textContent).toBe('Serves image, video when enabled.');
        await act(async () => { fireEvent.click(byId('settingsGridlight')); });
        expect(byId('settingsGridlight').checked).toBe(false);
        expect(status).toContain('Could not save: locked');
    });

    it('the production graph switch is core\'s (uncontrolled, saved by saveProductionGraphFlag)', async () => {
        const { fake } = await openPage();
        fireEvent.click(byId('settingsProductionGraph'));
        expect(fake.saveProductionGraphFlag).toHaveBeenCalled();
    });

    it('the static page carries the ids and options other code reads', () => {
        installLegacy();
        render(<SettingsPage />);
        expect([...byId('settingsStatus').options].map(o => o.value)).toEqual(STATUSES.map(s => s[0])); // the project list's stages
        for (const id of ['settingsDeliveryCodec', 'settingsDeliveryPreset', 'settingsProductionGraph', 'settingsFolderMoveTo', 'settingsProjectsRoot', 'settingsBackupDir', 'settingsStylePreset']) {
            expect(byId(id), id).toBeTruthy();
        }
    });

    it('MOVED (setup-models): every card is in exactly one listed section, every section shows something, the keys card holds the keys', () => {
        installLegacy();
        render(<SettingsPage />);
        const cards = [...document.querySelectorAll('#page-settings .card')];
        expect(cards.length).toBeGreaterThanOrEqual(10);
        for (const c of cards) {
            expect(c.classList.contains('set-card'), c.id).toBe(true);
            expect(SETTINGS_SECTIONS).toContain(c.dataset.setSection);
        }
        for (const sec of SETTINGS_SECTIONS) expect(cards.some(c => c.dataset.setSection === sec), sec).toBe(true);
        expect(byId('settingsKeysCard').querySelector('#providerCredentials')).toBeTruthy();
    });

    it('MOVED (setup-models): an unknown section falls back to the providers', async () => {
        await openPage();
        await act(async () => { window.showSettingsSection('nonsense'); });
        expect(visibleCards()).toEqual(['settingsProvidersCard']);
    });

    it('MOVED (setup-models): every capability the engine has is in a group, and anything new lands under Other', () => {
        const { CAPABILITIES } = createRequire(import.meta.url)(path.resolve(__dirname, '../../../backend/lib/providers/base'));
        const grouped = CAP_GROUPS.flatMap(g => g.caps);
        for (const cap of CAPABILITIES) expect(grouped, cap).toContain(cap);
    });

    it('MOVED (setup-models): the model menu follows the provider, and a model the new provider does not offer is not kept', async () => {
        await openPage();
        expect(byId('provmodel-video').value).toBe('seedance-2.5-1080p');
        fireEvent.change(byId('provcap-video'), { target: { value: 'runway' } });
        expect([...byId('provmodel-video').options].map(o => o.value)).toEqual(['', 'gen4.5']);
        expect(byId('provmodel-video').value).toBe('');
    });

    it('MOVED (project-folders): THIS project and NEW projects are two cards, each holding only its own controls, the first naming the project', async () => {
        await openPage();
        const project = byId('settingsFolderCard'), defaults = byId('settingsNewProjectsFolderCard');
        for (const id of ['settingsFolderTitle', 'settingsFolderInfo', 'settingsFolderMoveRow', 'settingsFolderMoveTo', 'settingsFolderMoveBtn']) {
            expect(project.querySelector('#' + id), id).toBeTruthy();
            expect(defaults.querySelector('#' + id), id).toBeNull();
        }
        expect(defaults.querySelector('#settingsProjectsRoot')).toBeTruthy();
        expect(project.querySelector('#settingsProjectsRoot')).toBeNull();
        expect(byId('settingsFolderTitle').tagName).toBe('H3');
        expect(byId('settingsFolderTitle').textContent).toBe('Where "Wingfall" is saved');
        expect(defaults.querySelector('h3').textContent).toBe('Where new projects are saved');
        expect(defaults.textContent).toMatch(/does not move/i);
    });
});
