import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { formBody } from '../../lib/forms.js';

/*
 * Assets, as React. Same routes, body and status lines as the legacy page, with two changes, both named:
 *   - a filter pill no longer refetches. The legacy page sent `?type=<group>`, which the route ignores
 *     (a group is not an asset type), so every request returned every asset and the page filtered here
 *     anyway; now it reads once and filters.
 *   - Register with no file path says why. The legacy form returned silently, which reads as a dead button.
 */
export const ASSET_GROUPS = {
    images: ['keyframe', 'storyboard', 'thumbnail', 'reference_image', 'character_sheet'],
    video: ['video_raw', 'video_synced', 'video_final'],
    audio: ['audio_dialogue', 'audio_music', 'audio_sfx', 'audio_ambient', 'audio_mix', 'voice_sample'],
    other: ['lora_weights', 'subtitle', 'lut', 'other', 'export_package', 'fcpxml', 'edl', 'premiere_xml'],
};
// What a person may register by hand: the legacy form's list, in its order.
const REGISTERABLE = [
    ['keyframe', 'Keyframe'], ['storyboard', 'Storyboard'], ['video_raw', 'Video Raw'], ['video_synced', 'Video Synced'],
    ['video_final', 'Video Final'], ['audio_dialogue', 'Audio Dialogue'], ['audio_music', 'Audio Music'], ['audio_sfx', 'Audio SFX'],
    ['audio_ambient', 'Audio Ambient'], ['thumbnail', 'Thumbnail'], ['reference_image', 'Reference Image'],
    ['character_sheet', 'Character Sheet'], ['lora_weights', 'LoRA Weights'], ['voice_sample', 'Voice Sample'],
    ['subtitle', 'Subtitle'], ['lut', 'LUT'], ['other', 'Other'],
];
const EMPTY = { asset_type: 'keyframe', file_path: '', file_name: '', format: '' };

export function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function AssetsPage() {
    const [assets, setAssets] = useState(null);
    const [filter, setFilter] = useState('');
    const [form, setForm] = useState(EMPTY);

    async function loadAssets() {
        if (!legacy.state.currentProject) return;
        try {
            const data = await legacy.api('/projects/' + legacy.state.currentProject.id + '/assets');
            setAssets(data.assets || []);
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadAssets', loadAssets);

    async function registerAsset() {
        if (!legacy.state.currentProject) return;
        const body = formBody(form);
        if (!body.file_path || !body.asset_type) return legacy.setStatus('An asset needs its type and file path');
        try {
            await legacy.api('/projects/' + legacy.state.currentProject.id + '/assets', { method: 'POST', body: JSON.stringify(body) });
            closeModal('assetModal');
            setForm(EMPTY);
            loadAssets();
            legacy.setStatus('Asset registered');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function deleteAsset(id) {
        if (!window.confirm('Delete this asset?')) return;
        try {
            await legacy.api('/assets/' + id, { method: 'DELETE' });
            loadAssets();
            legacy.setStatus('Asset deleted');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    const all = assets || [];
    const inGroup = (g) => all.filter(a => (ASSET_GROUPS[g] || []).includes(a.asset_type));
    const shown = filter ? inGroup(filter) : all;
    const pills = [{ label: 'All', value: '' }, ...Object.keys(ASSET_GROUPS).map(g => ({ label: g[0].toUpperCase() + g.slice(1), value: g }))];
    const field = (k) => ({ 'data-field': k, value: form[k], onChange: (e) => { const v = e.target.value; setForm(f => ({ ...f, [k]: v })); } });

    return (
        <div className="page" id="page-assets">
            <div className="flex-between mb-16">
                <h2>Assets</h2>
                <button className="btn btn-primary" onClick={() => openModal('assetModal')}>+ Register Asset</button>
            </div>
            <div className="filter-pills" id="assetFilters">
                {assets && pills.map(p => (
                    <button key={p.value} className={'filter-pill' + (p.value === filter ? ' active' : '')} onClick={() => setFilter(p.value)}>
                        {p.label} ({p.value ? inGroup(p.value).length : all.length})
                    </button>
                ))}
            </div>
            <div id="assetTableWrap">
                {assets && !shown.length && (
                    <div className="empty-state"><div className="icon">&#128230;</div><h3>No assets</h3><p>Register assets as they are generated.</p></div>
                )}
                {shown.length > 0 && (
                    <table className="asset-table"><tbody>
                        <tr><th>Type</th><th>Name</th><th>Format</th><th>Size</th><th>Date</th><th></th></tr>
                        {shown.map(a => (
                            <tr key={a.id}>
                                <td><span className="badge">{a.asset_type}</span></td>
                                <td>{a.file_name || a.file_path}</td>
                                <td>{a.format || '-'}</td>
                                <td>{a.size_bytes ? formatBytes(a.size_bytes) : '-'}</td>
                                <td className="text-muted">{new Date(a.created_at).toLocaleDateString()}</td>
                                <td><button className="btn btn-danger btn-sm" onClick={() => deleteAsset(a.id)}>Del</button></td>
                            </tr>
                        ))}
                    </tbody></table>
                )}
            </div>

            <Modal id="assetModal" title="Register Asset">
                <div className="form-group"><label>Asset Type</label>
                    <select {...field('asset_type')}>{REGISTERABLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </div>
                <div className="form-group"><label>File Path</label><input type="text" {...field('file_path')} placeholder="/data/film/..." /></div>
                <div className="form-group"><label>File Name</label><input type="text" {...field('file_name')} placeholder="filename.ext" /></div>
                <div className="form-group"><label>Format</label><input type="text" {...field('format')} placeholder="png, wav, mp4..." /></div>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={registerAsset}>Register</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('assetModal')}>Cancel</button>
                </div>
            </Modal>
        </div>
    );
}
