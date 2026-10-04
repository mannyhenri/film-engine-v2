import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * Marketing, as React: artwork that ships beside the film. Same routes, bodies and status lines as the
 * legacy page. Two things stay shared with every other picture in the app and are reached through
 * `legacy`, never copied:
 *   - the upload control (uploadControl): the file picker, the iPhone camera button, the size check and
 *     the error left on the control. It is core's own markup, rendered as given; its `after` names this
 *     page's loader, which the page registers on window.
 *   - the paid confirmation (confirmPaidImage): generating a poster costs what a frame costs, so it shows
 *     what would be sent before anything spends.
 */
export const MARKETING_TYPES = [
    ['poster', 'Poster'], ['key_art', 'Key art'], ['banner', 'Banner'], ['social_card', 'Social card'],
    ['still', 'Still'], ['thumbnail', 'Thumbnail'], ['logo', 'Logo'],
];
const TYPE_ICON = { poster: '🎭', key_art: '🎨', banner: '🖼', social_card: '📱', still: '📷', thumbnail: '🖻', logo: '✨' };
const ASPECTS = [['2:3', 'one-sheet poster'], ['16:9', 'banner, thumbnail'], ['1:1', 'social card'], ['9:16', 'story, vertical'], ['4:5', 'feed']];
const EMPTY = { type: 'poster', title: '', prompt: '', aspect_ratio: '2:3', resolution: '1080x1620' };

/** Where a marketing picture is served from: the same place plates live, at card width. */
export function marketingImgSrc(a, projectId) {
    const name = String(a.image_path || '').split('/').pop();
    return `${legacy.API_BASE}/film/refsheets/${projectId}/${encodeURIComponent(name)}?w=480`;
}

export default function MarketingPage() {
    const [assets, setAssets] = useState(null);
    const [filter, setFilter] = useState('');
    const [form, setForm] = useState(EMPTY);

    async function loadMarketing(type = filter) {
        if (!legacy.state.currentProject) return;
        legacy.setStatus('Loading marketing...');
        try {
            let url = '/projects/' + legacy.state.currentProject.id + '/marketing';
            if (type) url += '?type=' + encodeURIComponent(type);
            const data = await legacy.api(url);
            // The route returns `marketing_assets`: guessing the key renders an empty state over real data.
            const list = data.marketing_assets || [];
            setAssets(list);
            legacy.setStatus(list.length ? list.length + ' marketing asset(s)' : 'No marketing assets');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    // Registered for navigateTo and for the upload control's `after`, which calls it with no argument.
    usePageLoader('loadMarketing', () => loadMarketing());

    async function createMarketingAsset() {
        if (!legacy.state.currentProject) return;
        const body = { type: form.type, title: form.title.trim(), prompt: form.prompt.trim(), aspect_ratio: form.aspect_ratio, resolution: form.resolution.trim() };
        if (!body.title) { legacy.setStatus('Give it a title first'); return; }
        try {
            await legacy.api('/projects/' + legacy.state.currentProject.id + '/marketing', { method: 'POST', body: JSON.stringify(body) });
            closeModal('marketingModal');
            setForm(f => ({ ...f, title: '', prompt: '' }));
            legacy.setStatus('Marketing asset created');
            loadMarketing();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    function generateMarketingArt(id) {
        return legacy.confirmPaidImage({
            title: 'Generate this artwork',
            note: 'This replaces any existing artwork on this asset and costs credits.',
            previewUrl: `/marketing/${id}/preview`,
            send: async (choices) => {
                legacy.setStatus('Generating artwork...', true);
                try {
                    const res = await legacy.api(`/marketing/${id}/generate`, { method: 'POST', body: JSON.stringify(choices) });
                    legacy.setStatus(res.provider ? `Artwork generated via ${res.provider}.` : 'Artwork generated.');
                    loadMarketing();
                } catch (err) { legacy.setStatus('Could not generate: ' + err.message); }
            },
        });
    }

    async function deleteMarketingAsset(id) {
        if (!window.confirm('Delete this marketing asset? The artwork file stays on disk.')) return;
        try {
            await legacy.api('/marketing/' + id, { method: 'DELETE' });
            legacy.setStatus('Deleted');
            loadMarketing();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    const set = (k) => (e) => { const v = e.target.value; setForm(f => ({ ...f, [k]: v })); };
    // Search, sort and filter the assets as read (never re-read), within the type the picker chose.
    const controls = useListControls(SURFACE, assets && assets.map(a => ({ ...a, art: a.image_path ? 'has artwork' : 'no artwork yet' })));
    const shown = controls.shown || [];
    return (
        <div className="page" id="page-marketing">
            <div className="flex-between mb-16">
                <h2>Marketing</h2>
                <div>
                    <select id="marketingFilter" value={filter} style={{ width: 'auto', display: 'inline-block', minWidth: 150, marginRight: 8 }}
                        onChange={(e) => { setFilter(e.target.value); loadMarketing(e.target.value); }}>
                        <option value="">All types</option>
                        {MARKETING_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <button className="btn btn-primary" onClick={() => openModal('marketingModal')}>+ Asset</button>
                </div>
            </div>
            <p className="text-sm text-muted mb-8">
                Artwork that ships beside the film. Upload something you made in a design tool, or
                generate it &mdash; generation uses the film&rsquo;s own style preset, so the art looks
                like the film rather than like a different one.
            </p>
            {assets && assets.length > 0 && <ListControlsBar list={controls} />}
            <div className="entity-grid" id="marketingGrid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
                {assets && assets.length > 0 && !shown.length && <ListNoMatch list={controls} />}
                {assets && !assets.length && (
                    <div className="empty-state" style={{ gridColumn: '1/-1' }}><div className="icon">🎭</div>
                        <h3>No marketing assets</h3><p>Add a poster, key art or a social card. You can upload one you already made, or generate it from the film&rsquo;s own look.</p></div>
                )}
                {shown.map(a => (
                    <div key={a.id} className="entity-card" data-asset-id={a.id}>
                        <div className="entity-card-header">
                            <div className="entity-avatar" style={{ background: 'var(--gl-bg-elevated)' }}>{TYPE_ICON[a.type] || '🎭'}</div>
                            <div>
                                <h3 style={{ fontSize: 13 }}>{a.title || 'Untitled'}</h3>
                                <p className="text-sm text-muted">{String(a.type || '').replace(/_/g, ' ')} &middot; {a.aspect_ratio || ''}</p>
                            </div>
                        </div>
                        {a.image_path
                            ? <img src={marketingImgSrc(a, (legacy.state.currentProject || {}).id)} alt="" style={{ width: '100%', borderRadius: 6, marginTop: 8, display: 'block' }} />
                            : <p className="text-sm text-muted" style={{ marginTop: 8 }}>{a.prompt || 'No artwork yet.'}</p>}
                        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: legacy.uploadControl('marketing-asset', `/marketing/${a.id}/import`,
                                { extra: {}, after: 'loadMarketing', label: a.image_path ? 'Replace' : 'Upload', title: 'Use artwork you made in a design tool' }) }} />
                            <button className="btn btn-secondary btn-sm" onClick={() => generateMarketingArt(a.id)}>{a.image_path ? 'Regenerate' : 'Generate'}</button>
                            <button className="btn btn-danger btn-sm" onClick={() => deleteMarketingAsset(a.id)}>Delete</button>
                        </div>
                    </div>
                ))}
            </div>

            <Modal id="marketingModal" title="New Marketing Asset" footer={<>
                <button className="btn btn-secondary" onClick={() => closeModal('marketingModal')}>Cancel</button>
                <button className="btn btn-primary" onClick={createMarketingAsset}>Create</button>
            </>}>
                <div className="form-group"><label>Type</label>
                    <select id="mkType" value={form.type} onChange={set('type')}>{MARKETING_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div className="form-group"><label>Title</label>
                    <input id="mkTitle" type="text" placeholder="Teaser one-sheet" value={form.title} onChange={set('title')} /></div>
                <div className="form-group"><label>What it should show</label>
                    <textarea id="mkPrompt" rows={3} placeholder="The dragon's shadow crossing an empty suburban street at blue hour, seen from below" value={form.prompt} onChange={set('prompt')} />
                    <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                        Leads the prompt. The film's style preset is added after it, so this describes the <em>subject</em> rather than the look.
                    </div></div>
                <div className="form-group"><label>Aspect ratio</label>
                    <select id="mkAspect" value={form.aspect_ratio} onChange={set('aspect_ratio')}>{ASPECTS.map(([v, l]) => <option key={v} value={v}>{v} &mdash; {l}</option>)}</select></div>
                <div className="form-group"><label>Resolution</label>
                    <input id="mkResolution" type="text" placeholder="1080x1620" value={form.resolution} onChange={set('resolution')} /></div>
            </Modal>
        </div>
    );
}
