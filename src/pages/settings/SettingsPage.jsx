import { useState } from 'react';
import { legacy, setLegacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { KeysCard, CapabilityMap, keyTiles, providerConfigBody } from './ProviderCards.jsx';

/*
 * Settings, as React: one section at a time. The sections a project owns come first (providers, project,
 * delivery, folder); the ones this Mac owns after (keys, backups, you, graph). Same routes, bodies and
 * status lines as the legacy page.
 *
 * Kept for the rest of the app, by id: #settingsStatus and its options (the project list offers exactly these
 * stages), #settingsDeliveryCodec / #settingsDeliveryPreset and their options, #settingsProductionGraph (the
 * graph's applyProductionFlag sets it), and the folder fields core's folder picker writes into
 * (#settingsFolderMoveTo, #settingsProjectsRoot, #settingsBackupDir): those three are read from the field
 * when used, because the picker fills them.
 *
 * One change, named in its test: both drafting switches read draft_video, the column the engine reads.
 * The project card's switch read the older video_draft and treated it as ON when absent, while the delivery
 * card's read draft_video — two controls for one setting, reading two columns.
 */
export const SETTINGS_SECTIONS = ['providers', 'project', 'delivery', 'folder', 'keys', 'backups', 'you', 'graph'];
const NAV = [['This project', [['providers', 'AI providers and models'], ['project', 'Project'], ['delivery', 'Picture and delivery'], ['folder', 'Where it is saved']]],
    ['This Mac', [['keys', 'API keys'], ['backups', 'Backups'], ['you', 'You and connection'], ['graph', 'Production graph']]]];
export const STATUSES = [['concept', 'Concept'], ['script', 'Script'], ['pre-production', 'Pre-Production'], ['storyboard', 'Storyboard'], ['production', 'Production'],
    ['post-production', 'Post-Production'], ['review', 'Review'], ['export', 'Export'], ['complete', 'Complete']];
export const DELIVERY_PRESET_OPTIONS = [['', 'Custom'], ['theatrical_dcp', 'Theatrical DCP'], ['imax', 'IMAX'], ['streaming_hd', 'Streaming HD'], ['streaming_4k', 'Streaming 4K'],
    ['social_media', 'Social Media'], ['broadcast', 'Broadcast'], ['spot_broadcast_na', 'Spot — NA broadcast / CTV'], ['spot_broadcast_uk', 'Spot — UK/AU broadcast'], ['spot_social', 'Spot — social']];
const ASPECTS = [['16:9', '16:9 Standard HD/UHD'], ['2.39:1', '2.39:1 Anamorphic Scope'], ['2.35:1', '2.35:1 Panavision Scope'], ['1.85:1', '1.85:1 Flat Widescreen'],
    ['1.43:1', '1.43:1 IMAX Full Frame'], ['1.90:1', '1.90:1 IMAX Digital'], ['4:3', '4:3 Academy'], ['9:16', '9:16 Vertical/Mobile'], ['1:1', '1:1 Square'],
    ['2:1', '2:1 Univisium (Netflix)'], ['2.76:1', '2.76:1 Ultra Panavision 70'], ['custom', 'Custom']];
const RESOLUTIONS = [['1280x720', '720p (1280x720)'], ['1920x1080', '1080p (1920x1080)'], ['2048x1080', '2K DCI (2048x1080)'], ['3840x2160', '4K UHD (3840x2160)'],
    ['4096x2160', '4K DCI (4096x2160)'], ['5632x4096', 'IMAX 5.6K (5632x4096)'], ['7680x4320', '8K (7680x4320)'], ['12288x8640', 'IMAX 12K (12288x8640)']];
const FPS = [['23.976', '23.976 fps'], ['24', '24 fps (Film)'], ['25', '25 fps (PAL)'], ['29.97', '29.97 fps (NTSC DF)'], ['30', '30 fps'], ['48', '48 fps (HFR)'], ['60', '60 fps'], ['120', '120 fps']];
const COLOR_SPACES = ['sRGB', 'Rec.709', 'DCI-P3', 'Rec.2020', 'ACES'];
export const CODECS = [['', 'H.264 (the working master)'], ['h264', 'H.264'], ['h265', 'H.265 / HEVC'], ['prores_422_proxy', 'ProRes 422 Proxy'], ['prores_422_lt', 'ProRes 422 LT'],
    ['prores_422', 'ProRes 422'], ['prores_422_hq', 'ProRes 422 HQ'], ['prores_4444', 'ProRes 4444'], ['dnxhr_hq', 'DNxHR HQ'], ['jpeg2000', 'JPEG 2000 (for a DCP)']];
const AUDIO = [['2', 'Stereo'], ['6', '5.1'], ['8', '7.1'], ['12', '12.0 (IMAX)']];
// The fallback for a page with no project open; with one, the SERVER applies the preset.
export const DELIVERY_PRESETS = {
    theatrical_dcp: { aspect_ratio: '2.39:1', target_resolution: '4096x2160', target_fps: 24, color_space: 'DCI-P3' },
    imax: { aspect_ratio: '1.43:1', target_resolution: '5632x4096', target_fps: 24, color_space: 'DCI-P3' },
    streaming_hd: { aspect_ratio: '16:9', target_resolution: '1920x1080', target_fps: 24, color_space: 'Rec.709' },
    streaming_4k: { aspect_ratio: '16:9', target_resolution: '3840x2160', target_fps: 24, color_space: 'Rec.709' },
    social_media: { aspect_ratio: '9:16', target_resolution: '1080x1920', target_fps: 30, color_space: 'sRGB' },
    broadcast: { aspect_ratio: '16:9', target_resolution: '1920x1080', target_fps: 29.97, color_space: 'Rec.709' },
};

export function parseAspectRatio(str) {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(str || ''));
    return m ? parseFloat(m[1]) / parseFloat(m[2]) : 16 / 9;
}
/** The preview box's size for a ratio: 200 wide when landscape, 200 tall when portrait, never under 30. */
export function previewSize(ratio) {
    const r = parseAspectRatio(ratio);
    const [w, h] = r >= 1 ? [200, Math.round(200 / r)] : [Math.round(200 * r), 200];
    return { width: w, height: Math.max(h, 30) };
}
const projectForm = (p) => ({
    title: p.title || '', logline: p.logline || '', genre: p.genre || '', style_preset: p.style_preset || '', status: p.status || 'concept',
    client: p.client || '', campaign: p.campaign || '', target_duration: p.target_duration_ms ? String(p.target_duration_ms / 1000) : '', brand_id: p.brand_id || '',
    draft: Number(p.draft_video) === 1,
});
const techForm = (p) => ({
    aspect_ratio: p.aspect_ratio || '16:9', aspect_ratio_custom: p.aspect_ratio_custom || '', target_resolution: p.target_resolution || '2048x1080',
    target_fps: p.target_fps ? String(p.target_fps) : '24', color_space: p.color_space || 'Rec.709', delivery_format: p.delivery_format || '',
    timecode_start: p.timecode_start || '01:00:00:00', delivery_codec: p.delivery_codec || '', delivery_audio_channels: String(p.delivery_audio_channels || 2),
    draft_video: Number(p.draft_video) === 1,
});
const remembered = () => { try { return localStorage.getItem('fe_settings_section'); } catch { return null; } };
const byId = (id) => document.getElementById(id);
/*
 * The folder fields are filled by core's folder picker, so they are uncontrolled. Each remembers the value it
 * was loaded or saved with, and a blur saves only a changed one, as the legacy field's change event did.
 */
const setField = (id, v) => { const el = byId(id); if (el) { el.value = v; el.dataset.saved = v; } };
const changed = (el) => el && el.value !== (el.dataset.saved || '');

export default function SettingsPage() {
    const [section, setSection] = useState('providers');
    const [hasProject, setHasProject] = useState(false);
    const [proj, setProj] = useState(projectForm({}));
    const [styleWarning, setStyleWarning] = useState('');
    const [brands, setBrands] = useState([]);
    const [tech, setTech] = useState(techForm({}));
    const [catalog, setCatalog] = useState(null);
    const [projProviders, setProjProviders] = useState(null);
    const [providerError, setProviderError] = useState('');
    const [choice, setChoice] = useState({});
    const [folder, setFolder] = useState({ title: 'Where this project is saved', info: null, error: '', moveRow: false, moveLabel: 'Move', moving: false });
    const [backup, setBackup] = useState({ every: '', keep: '', projects: false, status: '' });
    const [author, setAuthor] = useState('');
    const [testMode, setTestMode] = useState(false);
    const [apiUrl, setApiUrl] = useState('');
    const [gridlight, setGridlight] = useState({ on: false, serves: '' });

    function showSettingsSection(id) {
        const want = SETTINGS_SECTIONS.includes(id) ? id : 'providers';
        setSection(want);
        try { localStorage.setItem('fe_settings_section', want); } catch { /* a remembered section is a convenience */ }
    }

    function loadSettings() {
        setApiUrl(legacy.API_BASE);
        showSettingsSection(remembered() || 'providers');
        const p = legacy.state.currentProject;
        setHasProject(!!p);
        if (p) {
            setProj(projectForm(p));
            setStyleWarning('');
            loadSettingsBrands();
            loadTechnicalSettings(p);
        }
        loadProviders();
        loadAppSettings();
        loadProjectFolder();
    }
    usePageLoader('loadSettings', loadSettings);
    usePageLoader('showSettingsSection', showSettingsSection); // window.showSettingsSection, as the legacy page set it

    async function loadSettingsBrands() {
        try { setBrands((await legacy.api('/brands')).brands || []); } catch { /* the select keeps "No brand" */ }
    }

    // ── providers and keys ────────────────────────────────────────────
    async function loadProviders() {
        try {
            const cat = await legacy.api('/providers');
            setCatalog(cat);
            setProviderError('');
            const p = legacy.state.currentProject;
            if (!p) { setProjProviders(null); return; }
            const pp = await legacy.api('/projects/' + p.id + '/providers');
            setProjProviders({ ...pp, project_id: pp.project_id || p.id });
            setChoice({});
        } catch (err) { setProviderError(err.message); }
    }
    async function saveProviderConfig(tier) {
        const p = legacy.state.currentProject;
        if (!p) { legacy.setStatus('Open a project first'); return; }
        // A panel built for another project is never saved onto this one.
        if (projProviders && projProviders.project_id && projProviders.project_id !== p.id) {
            legacy.setStatus('Provider settings were showing another project — reloading them');
            loadProviders();
            return;
        }
        const config = providerConfigBody(projProviders, catalog, choice, tier || (projProviders && projProviders.image_quality));
        try {
            await legacy.api('/projects/' + p.id + '/providers', { method: 'PUT', body: JSON.stringify({ config }) });
            legacy.setStatus('Provider settings saved');
            loadProviders();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    // ── project ───────────────────────────────────────────────────────
    async function saveProjectSettings() {
        const p = legacy.state.currentProject;
        if (!p) return;
        const data = {
            title: proj.title.trim(), logline: proj.logline.trim(), genre: proj.genre.trim(), status: proj.status, style_preset: proj.style_preset.trim(),
            video_draft: proj.draft ? 1 : 0, client: proj.client.trim(), campaign: proj.campaign.trim(),
            // Typed in seconds and stored in milliseconds.
            target_duration_ms: Math.round((Number(proj.target_duration) || 0) * 1000),
            brand_id: proj.brand_id,
        };
        try {
            const saved = await legacy.api('/projects/' + p.id, { method: 'PUT', body: JSON.stringify(data) });
            legacy.state.currentProject = { ...legacy.state.currentProject, ...saved };
            const name = byId('navProjectName');
            if (name) name.textContent = legacy.state.currentProject.title;
            legacy.paintProjectType(legacy.state.currentProject);
            legacy.setStatusDot(legacy.state.currentProject.status);
            // style_warning is {subjects, detail}: printing it directly would show [object Object].
            setStyleWarning(saved.style_warning ? (saved.style_warning.detail || ('This style names a subject: ' + (saved.style_warning.subjects || []).join(', '))) : '');
            setTech(t => ({ ...t, draft_video: data.video_draft === 1 }));
            legacy.setStatus('Project updated');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    async function deleteCurrentProject() {
        const p = legacy.state.currentProject;
        if (!p) return;
        if (!await legacy.confirmProjectDelete(p.id, p.title)) return;
        try {
            await legacy.api('/projects/' + p.id, { method: 'DELETE' });
            legacy.backToProjectList();
            legacy.setStatus('Project deleted');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    // ── picture and delivery ─────────────────────────────────────────
    function loadTechnicalSettings(p) {
        // delivery_codec, delivery_audio_channels and draft_video are read from the project as stored.
        setTech(techForm({ ...p, delivery_codec: p.delivery_codec, delivery_audio_channels: p.delivery_audio_channels, draft_video: p.draft_video }));
    }
    async function saveTechnicalSettings() {
        const p = legacy.state.currentProject;
        if (!p) return;
        const data = {
            aspect_ratio: tech.aspect_ratio,
            aspect_ratio_custom: tech.aspect_ratio === 'custom' ? tech.aspect_ratio_custom.trim() : '',
            target_resolution: tech.target_resolution,
            target_fps: parseFloat(tech.target_fps),
            color_space: tech.color_space,
            delivery_format: tech.delivery_format,
            timecode_start: tech.timecode_start.trim() || '01:00:00:00',
            delivery_codec: tech.delivery_codec,
            delivery_audio_channels: Number(tech.delivery_audio_channels) || 2,
            video_draft: tech.draft_video,
        };
        try {
            const saved = await legacy.api('/projects/' + p.id, { method: 'PUT', body: JSON.stringify(data) });
            legacy.state.currentProject = { ...legacy.state.currentProject, ...saved };
            setProj(f => ({ ...f, draft: !!data.video_draft }));
            legacy.setStatus('Technical settings saved');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    // A preset is applied by the SERVER (POST settings/preset), which writes every field it carries, codec and
    // audio included, so the page and the API cannot disagree about what a preset is.
    async function applyDeliveryPreset(name) {
        setTech(t => ({ ...t, delivery_format: name }));
        const p = legacy.state.currentProject;
        if (name && p) {
            try {
                const r = await legacy.api('/projects/' + p.id + '/settings/preset', { method: 'POST', body: JSON.stringify({ preset: name }) });
                if (r && r.project) { legacy.state.currentProject = { ...legacy.state.currentProject, ...r.project }; loadTechnicalSettings(legacy.state.currentProject); return; }
            } catch (err) { legacy.setStatus('Error: ' + err.message); }
        }
        const preset = DELIVERY_PRESETS[name];
        if (preset) setTech(t => ({ ...t, aspect_ratio: preset.aspect_ratio, target_resolution: preset.target_resolution, target_fps: String(preset.target_fps), color_space: preset.color_space }));
    }

    // ── where it is saved ────────────────────────────────────────────
    async function loadProjectFolder() {
        try {
            const l = await legacy.api('/settings');
            setField('settingsProjectsRoot', (l.settings && l.settings.projects_root) || '');
        } catch { /* blank: the default applies */ }
        loadBackupSettings();
        const p = legacy.state.currentProject;
        if (!p) { setFolder({ title: 'Where this project is saved', info: null, error: '', moveRow: false, moveLabel: 'Move', moving: false }); return; }
        const title = `Where "${p.title || 'this project'}" is saved`;
        try {
            const r = await legacy.api(`/projects/${p.id}/storage`);
            setFolder(f => ({ ...f, title, info: r, error: '', moveRow: true, moveLabel: r.layout === 'project' ? 'Move' : 'Move into a project folder' }));
            const to = byId('settingsFolderMoveTo');
            if (to && !to.value) {
                // Suggest the parent a move would use: the folder this project is already in, or the projects folder.
                to.value = r.layout === 'project' ? r.assets_dir.replace(/\/[^/]+$/, '') : String(r.suggestion || '').replace(/\/[^/]+$/, '');
            }
        } catch (err) { setFolder(f => ({ ...f, title, info: null, error: "Could not read this project's folder: " + err.message })); }
    }
    async function moveProjectFolder() {
        const p = legacy.state.currentProject;
        if (!p) return;
        const parent = ((byId('settingsFolderMoveTo') || {}).value || '').trim();
        if (!parent) return legacy.setStatus('Choose where to move the project first');
        let dest;
        try {
            const r = await legacy.api(`/storage/suggest?title=${encodeURIComponent(p.title || '')}&parent=${encodeURIComponent(parent)}&project_id=${encodeURIComponent(p.id)}`);
            if (!r.valid) return legacy.setStatus('Cannot move there: ' + r.error);
            dest = r.assets_dir;
        } catch (err) { return legacy.setStatus('Error: ' + err.message); }
        if (!window.confirm(`Move every file of "${p.title}" to\n\n${dest}\n\nThe records follow the files; nothing is regenerated or spent. Don't generate anything while it moves.`)) return;
        setFolder(f => ({ ...f, moving: true }));
        try {
            const out = await legacy.api(`/projects/${p.id}/storage/move`, { method: 'POST', body: JSON.stringify({ assets_dir: dest }) });
            legacy.state.currentProject.assets_dir = out.to;
            legacy.setStatus(`Moved ${out.files_moved} files to ${out.to}`);
            byId('settingsFolderMoveTo').value = '';
        } catch (err) {
            legacy.setStatus('Move failed, nothing was changed: ' + err.message);
        } finally {
            setFolder(f => ({ ...f, moving: false }));
            loadProjectFolder();
        }
    }
    async function saveProjectsRoot() {
        const el = byId('settingsProjectsRoot');
        if (!el) return;
        try {
            await legacy.api('/settings', { method: 'PUT', body: JSON.stringify({ projects_root: el.value.trim() }) });
            el.dataset.saved = el.value;
            legacy.setStatus('New projects will be saved in ' + (el.value.trim() || '~/Film Engine'));
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    // ── backups ──────────────────────────────────────────────────────
    async function loadBackupSettings() {
        try {
            const [s, b] = await Promise.all([legacy.api('/settings'), legacy.api('/backups/folder')]);
            const v = s.settings || {};
            setField('settingsBackupDir', v.backup_dir || '');
            setBackup({ every: v.backup_every_hours === '' || v.backup_every_hours == null ? '' : String(v.backup_every_hours), keep: v.backup_keep ? String(v.backup_keep) : '',
                projects: !!v.backup_projects,
                status: !b.configured ? 'Off: no folder set.' : b.last ? `Last: ${new Date(b.last.at).toLocaleString()} · ${b.count} kept · ${b.folder}` : `No backup yet · ${b.folder}` });
        } catch (err) { setBackup(x => ({ ...x, status: 'Could not read the backup settings: ' + err.message })); }
    }
    async function saveBackupSettings(next = backup) {
        const body = {
            backup_dir: ((byId('settingsBackupDir') || {}).value || '').trim(),
            backup_every_hours: String(next.every).trim(),
            backup_keep: String(next.keep).trim(),
            backup_projects: !!next.projects,
        };
        try {
            await legacy.api('/settings', { method: 'PUT', body: JSON.stringify(body) });
            legacy.setStatus(body.backup_dir ? 'Backups go to ' + body.backup_dir : 'Scheduled backups are off');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
        loadBackupSettings();
    }
    async function runBackupNow() {
        setBackup(x => ({ ...x, status: 'Backing up…' }));
        try {
            const r = await legacy.api('/backups/folder/run', { method: 'POST', body: '{}' });
            legacy.setStatus(`Backed up to ${r.folder}/${r.file}`);
        } catch (err) { legacy.setStatus('Backup failed: ' + err.message); }
        loadBackupSettings();
    }

    // ── you, connection, local endpoints ─────────────────────────────
    async function loadAppSettings() {
        try {
            const res = await legacy.api('/settings');
            setAuthor((res.settings && res.settings.author) || '');
            setTestMode(!!(res.settings && res.settings.generation_test_mode));
            const on = !!String((res.settings && res.settings.gridlight_enabled) || '').trim();
            let serves = '';
            try {
                const g = ((await legacy.api('/providers')).providers || []).find(x => x.id === 'gridlight');
                serves = g ? `Serves ${(g.capabilities || []).join(', ')} when enabled.` : '';
            } catch { serves = ''; }
            setGridlight({ on, serves });
        } catch { /* leave it blank; the field says what it is for */ }
    }
    async function saveAppSettings() {
        const a = author.trim();
        try {
            await legacy.api('/settings', { method: 'PUT', body: JSON.stringify({ author: a }) });
            setLegacy('APP_AUTHOR', a); // the cached copy, or the next title page uses the old name
            legacy.setStatus('Author saved.');
        } catch (err) { legacy.setStatus('Could not save: ' + err.message); }
    }
    // Saved on the click, and announced, so the badge and every open review agree with the switch at once.
    async function saveTestMode(on) {
        setTestMode(on);
        try {
            await legacy.api('/settings', { method: 'PUT', body: JSON.stringify({ generation_test_mode: on }) });
            window.dispatchEvent(new CustomEvent('film:test-mode', { detail: { on } }));
            legacy.setStatus(on ? 'Test mode on: Higgsfield requests are saved, not sent.' : 'Test mode off.');
        } catch (err) { setTestMode(!on); legacy.setStatus('Could not save: ' + err.message); }
    }
    // Saved on the click: a switch that looks flipped and has not been saved is how the local endpoints
    // seem on while every generation resolves elsewhere.
    async function saveGridlightEnabled(on) {
        setGridlight(g => ({ ...g, on }));
        try {
            await legacy.api('/settings', { method: 'PUT', body: JSON.stringify({ gridlight_enabled: on ? '1' : '' }) });
            legacy.setStatus(on ? 'Local Gridlight endpoints enabled.' : 'Local Gridlight endpoints disabled — nothing will resolve to them.');
            loadProviders();
        } catch (err) {
            setGridlight(g => ({ ...g, on: !on })); // or the box lies about what was stored
            legacy.setStatus('Could not save: ' + err.message);
        }
    }
    function saveSettings() {
        const url = apiUrl.trim().replace(/\/+$/, '');
        if (!url) return;
        setLegacy('API_BASE', url);
        legacy.feStore.set('film_api_url', url);
        legacy.setStatus('API URL saved: ' + url);
        legacy.checkHealth();
    }
    function resetSettings() {
        setLegacy('API_BASE', legacy.DEFAULT_API_BASE);
        legacy.feStore.remove('film_api_url');
        setApiUrl(legacy.DEFAULT_API_BASE);
        legacy.setStatus('Settings reset');
        legacy.checkHealth();
    }

    // ── layout ───────────────────────────────────────────────────────
    const projectOnly = new Set(['settingsProjectCard', 'settingsTechnicalCard']);
    const cardClass = (id, sec, extra = '') => 'card set-card' + extra + (sec !== section ? ' set-off' : '') + (projectOnly.has(id) && !hasProject ? ' hidden' : '');
    const visibleIn = (sec) => ({ providers: true, project: hasProject, delivery: hasProject, folder: true, keys: true, backups: true, you: true, graph: true })[sec];
    const setP = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setProj(f => ({ ...f, [k]: v })); };
    const setT = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setTech(t => ({ ...t, [k]: v })); };
    const why = (children) => <details className="set-why"><summary>Why</summary><p className="text-sm text-muted" style={{ marginTop: 6, lineHeight: 1.5 }}>{children}</p></details>;
    const tiles = catalog ? keyTiles(catalog) : [];
    const box = previewSize(tech.aspect_ratio === 'custom' ? tech.aspect_ratio_custom : tech.aspect_ratio);
    const fi = folder.info;
    return (
        <div className="page" id="page-settings">
            <div className="page-header"><h2>Settings</h2></div>
            <div className="set-shell">
                <nav className="set-nav" aria-label="Settings sections">
                    {NAV.map(([head, items]) => [
                        <div key={head} className="set-nav-h">{head}</div>,
                        ...items.map(([id, label]) => (
                            <button key={id} type="button" className={'set-nav-btn' + (section === id ? ' on' : '')} data-set-go={id}
                                aria-current={section === id ? 'page' : undefined} onClick={() => showSettingsSection(id)}>{label}</button>
                        )),
                    ])}
                </nav>
                <div className="set-grid">
                    <p className={'text-sm text-muted set-empty' + (visibleIn(section) ? ' hidden' : '')} id="setSectionEmpty">Open a project to change these; they belong to one film.</p>

                    <div className={cardClass('settingsProvidersCard', 'providers', ' set-wide')} id="settingsProvidersCard" data-set-section="providers">
                        <h3 className="mb-8">AI providers and models</h3>
                        <p className="set-lede">Which service makes each kind of thing for this project only, and the model it uses. Any single generation can still be sent
                            elsewhere from its own confirmation. The API keys these need are under <a href="#" onClick={(e) => { e.preventDefault(); showSettingsSection('keys'); }}>API keys</a>,
                            shared by every project on this Mac.</p>
                        {providerError && <p className="text-sm text-muted">Providers unavailable: {providerError}</p>}
                        {!providerError && catalog && !hasProject && <div className="set-empty-note"><strong>No project is open.</strong> Which provider and model make each kind of thing is chosen per
                            project: open one from the project list, then come back here. API keys, below in the list, work without a project.</div>}
                        {catalog && hasProject && <CapabilityMap catalog={catalog} proj={projProviders} choice={choice} setChoice={setChoice} onTier={(t) => saveProviderConfig(t)} />}
                        <div className="btn-row" style={{ marginTop: 16 }}><button className="btn btn-primary" onClick={() => saveProviderConfig()}>Save providers and models</button></div>
                    </div>

                    <div className={cardClass('settingsKeysCard', 'keys', ' set-wide')} id="settingsKeysCard" data-set-section="keys">
                        <h3 className="mb-8">API keys <span className="set-key-count" id="providerKeyCount">{tiles.length ? `${tiles.filter(p => (!!(p.credentials && (p.credentials.set || p.credentials.connected)) && !(p.credentials && p.credentials.suspect)) || !!p.enabled).length} of ${tiles.length} set` : ''}</span></h3>
                        <p className="set-lede">Entered once on this Mac and shared by every project. Kept on the server, never sent back.</p>
                        <KeysCard catalog={catalog} onChanged={loadProviders} />
                    </div>

                    <div className="set-cols">
                        <div className={cardClass('settingsProjectCard', 'project')} id="settingsProjectCard" data-set-section="project">
                            <h3 className="mb-8">Project Settings</h3>
                            <div className="form-group"><label>Title</label><input type="text" id="settingsTitle" data-field="title" value={proj.title} onChange={setP('title')} /></div>
                            <div className="form-group"><label>Logline</label><textarea id="settingsLogline" data-field="logline" rows={2} value={proj.logline} onChange={setP('logline')} /></div>
                            <div className="form-group"><label>Genre</label><input type="text" id="settingsGenre" data-field="genre" value={proj.genre} onChange={setP('genre')} /></div>
                            <div className="form-group"><label>Client</label><input type="text" id="settingsClient" data-field="client" maxLength={200} placeholder="Who the spot is for — blank for a film" value={proj.client} onChange={setP('client')} /></div>
                            <div className="form-group"><label>Campaign</label><input type="text" id="settingsCampaign" data-field="campaign" maxLength={200} placeholder="Which campaign this spot belongs to" value={proj.campaign} onChange={setP('campaign')} /></div>
                            <div className="form-group"><label>Spot runtime (seconds)</label>
                                <input type="number" id="settingsTargetDuration" data-field="target_duration_ms" min="0" step="0.1" placeholder="0 — no target" value={proj.target_duration} onChange={setP('target_duration')} />
                                {why(<>The length this spot is <strong>bought</strong> at. A conform that misses it by more than a frame <strong>refuses</strong> rather than trimming — a :30 that arrives at
                                    31.4s is rejected by the station, and one at 29.6s has paid for airtime it did not use. Leave it at 0 for a film, which runs as long as it runs.</>)}</div>
                            <div className="form-group"><label>Brand kit</label>
                                <select id="settingsBrand" data-field="brand_id" value={proj.brand_id} onChange={setP('brand_id')}>
                                    <option value="">No brand — this is a film</option>
                                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                                <p className="text-sm text-muted" style={{ marginTop: 6 }}>Kits live in <strong>Brand</strong> and outlive this project.</p></div>
                            <div className="form-group"><label>Style preset &mdash; the look every frame is generated in</label>
                                <textarea id="settingsStylePreset" data-field="style_preset" rows={3} placeholder="anamorphic, teal and amber, wet streets, heavy grain" value={proj.style_preset} onChange={setP('style_preset')} />
                                {why(<>Appended to <strong>every</strong> image prompt in this project, including the reference plates. Describe a <em>look</em> — lenses, grade, light, texture.
                                    Naming a <em>subject</em> here draws it in every frame, whatever the shot is about. The mood board composes this for you; editing it here overwrites what it wrote.</>)}
                                <div id="settingsStyleWarning">{styleWarning && <p className="text-sm" style={{ marginTop: 6, color: 'var(--gl-warning)', lineHeight: 1.5 }}>{styleWarning}</p>}</div></div>
                            <div className="form-group"><label>Draft video while working</label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
                                    <input type="checkbox" id="settingsVideoDraft" data-field="video_draft" checked={proj.draft} onChange={setP('draft')} />
                                    <span>Generate clips at the provider's smallest raster, and finish at delivery size later</span></label>
                                {why(<>Most generated clips are thrown away, so paying delivery rates for them is the largest avoidable cost here. Off by default: every clip is asked at the
                                    delivery size. The floor is the <em>model's</em>: on Seedance that is 480p and roughly a fifth of the price; on Veo it is 720p.</>)}</div>
                            <div className="form-group"><label>Status</label>
                                <select id="settingsStatus" data-field="status" value={proj.status} onChange={setP('status')}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                            <div className="btn-row">
                                <button className="btn btn-primary" onClick={saveProjectSettings}>Save Project</button>
                                <button className="btn btn-danger" onClick={deleteCurrentProject}>Delete Project</button>
                            </div>
                        </div>

                        <div className={cardClass('settingsTechnicalCard', 'delivery')} id="settingsTechnicalCard" data-set-section="delivery">
                            <h3 className="mb-8">Technical Settings</h3>
                            <p className="text-sm text-muted mb-16">Resolution, frame rate, color space, and delivery format for NLE exports.</p>
                            <div className="form-group"><label>Delivery Preset</label>
                                <select id="settingsDeliveryPreset" value={tech.delivery_format} onChange={(e) => applyDeliveryPreset(e.target.value)}>{DELIVERY_PRESET_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '0 16px' }}>
                                <div className="form-group"><label>Aspect Ratio</label>
                                    <select id="settingsAspectRatio" data-field="aspect_ratio" value={tech.aspect_ratio} onChange={setT('aspect_ratio')}>{ASPECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                                <div className="form-group" id="customAspectGroup" style={{ display: tech.aspect_ratio === 'custom' ? '' : 'none' }}><label>Custom Ratio</label>
                                    <input type="text" id="settingsAspectCustom" data-field="aspect_ratio_custom" placeholder="e.g. 2.20:1" value={tech.aspect_ratio_custom} onChange={setT('aspect_ratio_custom')} /></div>
                                <div className="form-group"><label>Resolution</label>
                                    <select id="settingsResolution" data-field="target_resolution" value={tech.target_resolution} onChange={setT('target_resolution')}>{RESOLUTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                                    <div className="hint" style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Every image is generated at this size — boards, plates, turnarounds and angle explorations — in its own shape.
                                        Nano Banana Pro tops out at 4K, so larger settings are generated at 4K.</div></div>
                                <div className="form-group"><label>Frame Rate</label>
                                    <select id="settingsFps" data-field="target_fps" value={tech.target_fps} onChange={setT('target_fps')}>{FPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                                <div className="form-group"><label>Color Space</label>
                                    <select id="settingsColorSpace" data-field="color_space" value={tech.color_space} onChange={setT('color_space')}>{COLOR_SPACES.map(v => <option key={v} value={v}>{v}</option>)}</select></div>
                                <div className="form-group"><label>Delivery codec</label>
                                    <select id="settingsDeliveryCodec" data-field="delivery_codec" value={tech.delivery_codec} onChange={setT('delivery_codec')}>{CODECS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                                <div className="form-group"><label>Delivery audio</label>
                                    <select id="settingsDeliveryAudio" data-field="delivery_audio_channels" value={tech.delivery_audio_channels} onChange={setT('delivery_audio_channels')}>{AUDIO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                            </div>
                            <div className="form-group"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input type="checkbox" id="settingsDraftVideo" checked={tech.draft_video} onChange={setT('draft_video')} />
                                Draft video — generate clips at the model's cheapest size and upscale at the end</label>
                                <div className="text-sm text-muted">Off (the default): every clip is asked at the delivery resolution above; a generator that cannot render it gives its best, and the
                                    Delivery check on the Export page names any clip that came back smaller.</div></div>
                            <div className="form-group"><label>Timecode Start</label>
                                <input type="text" id="settingsTimecodeStart" data-field="timecode_start" placeholder="01:00:00:00" style={{ maxWidth: 200, fontFamily: 'monospace' }} value={tech.timecode_start} onChange={setT('timecode_start')} /></div>
                            <div style={{ marginTop: 12 }}><label className="text-sm text-muted">Preview</label>
                                <div id="aspectPreview" style={{ marginTop: 6, width: box.width, height: box.height, border: '2px solid var(--gl-brand-pink)', borderRadius: 4, display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', transition: 'all 0.3s', background: 'rgba(233,30,99,0.05)' }}>
                                    <span className="text-sm text-muted" id="aspectPreviewLabel">{(tech.aspect_ratio === 'custom' ? tech.aspect_ratio_custom : tech.aspect_ratio) || '16:9'}</span></div></div>
                            <div className="btn-row" style={{ marginTop: 16 }}><button className="btn btn-primary" onClick={saveTechnicalSettings}>Save Technical Settings</button></div>
                        </div>

                        <div className={cardClass('settingsFolderCard', 'folder')} id="settingsFolderCard" data-set-section="folder">
                            <h3 className="mb-8" id="settingsFolderTitle">{folder.title}</h3>
                            <div id="settingsFolderInfo" className="text-sm text-muted">
                                {!fi && !folder.error && 'Open a project to see where its files are.'}
                                {folder.error}
                                {fi && <>
                                    {fi.layout === 'project'
                                        ? <div><strong style={{ userSelect: 'all' }}>{fi.assets_dir}</strong>{!fi.exists && <span style={{ color: 'var(--danger,#e66)' }}> — this folder is missing</span>}</div>
                                        : <div style={{ color: 'var(--warning,#e0a040)' }}>{fi.note}</div>}
                                    <div className="mt-8">{fi.totals.files} files, {legacy.fmtBytes(fi.totals.bytes)}</div>
                                    <table className="text-sm mt-8" style={{ borderCollapse: 'collapse' }}><tbody>
                                        {fi.folders.filter(f => f.files > 0 || fi.layout === 'project').map(f => (
                                            <tr key={f.folder}><td style={{ padding: '2px 8px 2px 0' }}>{f.folder}</td><td style={{ padding: '2px 8px', textAlign: 'right' }}>{f.files}</td>
                                                <td style={{ padding: '2px 0', textAlign: 'right' }}>{legacy.fmtBytes(f.bytes)}</td></tr>
                                        ))}
                                    </tbody></table>
                                </>}
                            </div>
                            <div className="form-group mt-8" id="settingsFolderMoveRow" style={{ display: folder.moveRow ? '' : 'none' }}>
                                <label>Move this project to</label>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {/* Filled by the folder picker (core), so it is read when used rather than held in state. */}
                                    <input type="text" id="settingsFolderMoveTo" placeholder="~/Film Engine" style={{ flex: 1 }} />
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => legacy.openFolderPicker('settingsFolderMoveTo')}>Browse&hellip;</button>
                                    <button type="button" className="btn btn-primary btn-sm" id="settingsFolderMoveBtn" disabled={folder.moving} onClick={moveProjectFolder}>{folder.moving ? 'Moving…' : folder.moveLabel}</button>
                                </div>
                                <span className="text-sm text-muted">A folder for this film is made inside the one you pick. Every file moves and every record follows it; nothing is regenerated.</span>
                            </div>
                        </div>
                        <div className={cardClass('settingsNewProjectsFolderCard', 'folder')} id="settingsNewProjectsFolderCard" data-set-section="folder">
                            <h3 className="mb-8">Where new projects are saved</h3>
                            <div className="form-group"><div style={{ display: 'flex', gap: 6 }}>
                                <input type="text" id="settingsProjectsRoot" placeholder="~/Film Engine" style={{ flex: 1 }} onBlur={(e) => { if (changed(e.target)) saveProjectsRoot(); }} />
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => legacy.openFolderPicker('settingsProjectsRoot', saveProjectsRoot)}>Browse&hellip;</button></div>
                                <span className="text-sm text-muted">The default offered when you start a new project — each one gets its own folder inside this one. Changing it does not move any project that already exists.</span></div>
                        </div>
                        <div className={cardClass('settingsBackupCard', 'backups')} id="settingsBackupCard" data-set-section="backups">
                            <h3 className="mb-8">Backups</h3>
                            <div className="form-group"><label>Back up to</label><div style={{ display: 'flex', gap: 6 }}>
                                <input type="text" id="settingsBackupDir" placeholder="e.g. ~/Dropbox/Film Engine Backups" style={{ flex: 1 }} onBlur={(e) => { if (changed(e.target)) saveBackupSettings(); }} />
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => legacy.openFolderPicker('settingsBackupDir', () => saveBackupSettings())}>Browse&hellip;</button></div>
                                <span className="text-sm text-muted">A Dropbox, Google Drive or NAS folder works. Each person's snapshots go in their own sub-folder, so several people can share one folder. Blank turns scheduled backups off.</span></div>
                            <div className="form-row">
                                <div className="form-group"><label>Every (hours)</label><input type="number" id="settingsBackupEvery" min="0" step="1" placeholder="6" value={backup.every}
                                    onChange={(e) => { const v = e.target.value; setBackup(b => ({ ...b, every: v })); }} onBlur={() => saveBackupSettings()} /></div>
                                <div className="form-group"><label>Keep</label><input type="number" id="settingsBackupKeep" min="1" step="1" placeholder="28" value={backup.keep}
                                    onChange={(e) => { const v = e.target.value; setBackup(b => ({ ...b, keep: v })); }} onBlur={() => saveBackupSettings()} /></div>
                            </div>
                            <div className="form-group"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input type="checkbox" id="settingsBackupProjects" checked={backup.projects} onChange={(e) => { const next = { ...backup, projects: e.target.checked }; setBackup(next); saveBackupSettings(next); }} />
                                Also save each project as JSON beside the snapshot</label></div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <button type="button" className="btn btn-primary btn-sm" onClick={runBackupNow}>Back up now</button>
                                <span className="text-sm text-muted" id="settingsBackupStatus">{backup.status}</span></div>
                        </div>
                        <div className={cardClass('settingsYouCard', 'you')} id="settingsYouCard" data-set-section="you">
                            <h3 className="mb-8">You</h3>
                            <div className="form-group"><label>Author</label><input type="text" id="settingsAuthor" placeholder="Your name" value={author} onChange={(e) => setAuthor(e.target.value)} />
                                {why(<>The written-by credit on every screenplay title page and every Final Draft export. Set once here rather than retyped per project — it fills a blank author
                                    and never overwrites one, so a screenplay written by someone else keeps their name.</>)}</div>
                            <div className="btn-row"><button className="btn btn-primary" onClick={saveAppSettings}>Save</button></div>
                        </div>
                        <div className={cardClass('settingsTestModeCard', 'you')} id="settingsTestModeCard" data-set-section="you">
                            <h3 className="mb-8">Test mode</h3>
                            <label className="ps-inline"><input type="checkbox" id="settingsTestMode" checked={testMode} onChange={(e) => saveTestMode(e.target.checked)} /> Save Higgsfield requests instead of sending them</label>
                            <p className="set-lede">Use the app as normal. Every generation that would go to Higgsfield is reviewed as usual, and Approve saves the exact
                                request (a <code>request.json</code> with the prompt, settings and credits) and the pictures it would upload into the project's
                                <em> exports/Higgsfield test requests</em> folder. Nothing is sent and no credits are spent.</p>
                        </div>
                        <div className={cardClass('settingsMyVoiceCard', 'you')} id="settingsMyVoiceCard" data-set-section="you">
                            <h3 className="mb-8">My Voice</h3>
                            <p className="set-lede">Your screenplay and story voice for the open project: samples, approved guidance and versions.</p>
                            <div className="btn-row"><button type="button" className="btn btn-primary" disabled={!hasProject} title={hasProject ? '' : 'Open a project first'}
                                onClick={() => window.dispatchEvent(new Event('film:open-my-voice'))}>Open My Voice</button></div>
                        </div>
                        <div className={cardClass('settingsConnectionCard', 'you')} id="settingsConnectionCard" data-set-section="you">
                            <h3 className="mb-8">Backend Connection</h3>
                            <div className="form-group"><label>API URL</label><input type="text" id="settingsApiUrl" placeholder="http://localhost:3100" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} /></div>
                            <div className="btn-row"><button className="btn btn-primary" onClick={saveSettings}>Save</button><button className="btn btn-secondary" onClick={resetSettings}>Reset to Default</button></div>
                        </div>
                        <div className={cardClass('settingsLocalCard', 'you')} id="settingsLocalCard" data-set-section="you">
                            <h3 className="mb-8">Local endpoints</h3>
                            <div className="form-group">
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                    <input type="checkbox" id="settingsGridlight" style={{ width: 'auto', margin: 0 }} checked={gridlight.on} onChange={(e) => saveGridlightEnabled(e.target.checked)} />
                                    <span>Use the local Gridlight endpoints</span></label>
                                {why(<>Off by default. Gridlight needs no API key, so while it was always on it read as &ldquo;ready&rdquo; whether or not anything was listening on the port — and it is
                                    the fallback every capability drops to. Until you switch it on, nothing resolves to it, and a capability it is the only provider for says <em>nothing serves this</em>
                                    rather than failing at generation time.</>)}
                                <p className="text-sm text-muted" style={{ marginTop: 6, lineHeight: 1.5 }} id="gridlightServes">{gridlight.serves}</p>
                            </div>
                        </div>
                        <div className={cardClass('settingsGraphCard', 'graph')} id="settingsGraphCard" data-set-section="graph">
                            <h3 className="mb-8">Production graph</h3>
                            <div className="form-group">
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                    {/* Uncontrolled: the graph's own applyProductionFlag keeps it in step, and saveProductionGraphFlag reads it. */}
                                    <input type="checkbox" id="settingsProductionGraph" style={{ width: 'auto', margin: 0 }} onChange={() => legacy.saveProductionGraphFlag()} />
                                    <span>Show Production as one graph</span></label>
                                {why(<>Shots, sequences, sound and every version on one canvas, with a drawer for each and the cut playing underneath. Off, Production is its separate pages.
                                    Every old page is still reachable by its address.</>)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
