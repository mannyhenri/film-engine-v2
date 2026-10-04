import { useRef, useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * The Style Book, as React: the director's own shots, kept across every film. Same routes, bodies and
 * status lines as the legacy page. Cross-project: with a project open you see its entries plus the
 * library; without one, the library alone.
 *
 * Kept from the legacy page, each held by a test:
 *   - the visuals section is ALWAYS offered, and Add visual on a new shot SAVES the shot first (an upload
 *     needs an owner; "save, re-open, attach" is three steps to do one thing);
 *   - a visual arrives as a file or a link, and is drawn as what it is (embed, clip, link, picture);
 *   - the note about what visuals are for is the SERVED one, painted where visuals are added — never a
 *     second literal in the page.
 */
const CAMERA_TEXT = ['shot_type', 'movement', 'lens', 'sensor', 'note'];
const CAMERA_NUM = ['aperture', 'height_m', 'focus_distance_m'];
const EMPTY = { name: '', description: '', tags: '', scope: 'library', shot_type: '', movement: '', lens: '', sensor: '', aperture: '', height_m: '', focus_distance_m: '', note: '' };
const formOf = (e) => {
    const c = (e && e.camera) || {};
    const f = { ...EMPTY, name: e?.name || '', description: e?.description || '', tags: e?.tags || '', scope: e ? e.scope : 'library' };
    for (const k of [...CAMERA_TEXT, ...CAMERA_NUM]) f[k] = c[k] === undefined || c[k] === null ? '' : String(c[k]);
    return f;
};

/** The facets an entry carries, as the tags a director searches by. */
export function styleBookTags(entry) {
    const c = entry.camera || {};
    const bits = [];
    if (c.shot_type) bits.push(c.shot_type);
    if (c.lens) bits.push(c.lens);
    if (c.movement && c.movement !== 'static') bits.push(c.movement);
    if (c.sensor) bits.push(c.sensor);
    if (c.aperture) bits.push('T' + c.aperture);
    if (c.height_m !== undefined) bits.push(c.height_m + 'm');
    return bits;
}

/** The request body for an entry, from the form: text trimmed, numbers kept only when they are numbers. */
export function entryBody(f) {
    const camera = {};
    for (const k of CAMERA_TEXT) { const v = String(f[k] || '').trim(); if (v) camera[k] = v; }
    for (const k of CAMERA_NUM) { const raw = String(f[k] ?? '').trim(); const n = raw === '' ? NaN : Number(raw); if (Number.isFinite(n)) camera[k] = n; }
    return { name: f.name.trim(), description: f.description.trim(), tags: f.tags.trim(), scope: f.scope || 'library', camera };
}

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('could not read that file'));
    r.readAsDataURL(file);
});

/*
 * Apply a style-book entry to a shot: the Direct panel and previs both call this (window.applyStyleBookEntry,
 * registered by this page at boot). It reads the style book itself, every time. The legacy version cached it
 * in the Style Book page's own state, so in the port it threw (ReferenceError) until that page had been
 * opened once, and even in the original it never saw an entry added after the first read.
 */
export async function applyStyleBookEntry(shotId) {
    let entries;
    try {
        const p = legacy.state.currentProject;
        entries = (await legacy.api(p ? '/projects/' + p.id + '/style-book' : '/style-book')).entries || [];
    } catch (err) { legacy.setStatus('Could not read the style book: ' + err.message); return; }
    if (!entries.length) { legacy.setStatus('The style book is empty — add a shot first'); return; }
    const pick = window.prompt('Apply which shot?\n\n'
        + entries.map((e, i) => `${i + 1}. ${e.name}${e.camera && e.camera.lens ? ' — ' + e.camera.lens : ''}`).join('\n'));
    const idx = parseInt(pick, 10) - 1;
    if (!(idx >= 0 && idx < entries.length)) return;
    try {
        const r = await legacy.api(`/shots/${shotId}/style-book/${entries[idx].id}`, { method: 'POST' });
        // Says what changed: "I applied my low-angle" and "it carried nothing this shot could use" look identical otherwise.
        legacy.setStatus(r.applied && r.applied.length
            ? `Applied ${r.applied.join(', ')} — regenerate the frame to see it`
            : 'That entry carried nothing this shot could use');
        if (typeof window.loadStoryboard === 'function') window.loadStoryboard();
    } catch (err) { legacy.setStatus('Error: ' + err.message); }
}

export default function StyleBookPage() {
    usePageLoader('applyStyleBookEntry', applyStyleBookEntry);
    const [book, setBook] = useState({ entries: [], note: '' });
    const [loadState, setLoadState] = useState('idle'); // idle | loading | ready | error:<msg>
    const [editing, setEditing] = useState({ id: '', form: EMPTY });
    const [media, setMedia] = useState(null); // null: new shot (nothing to list yet) | [] | 'error:<msg>'
    const [visual, setVisual] = useState({ url: '', note: '' });
    const fileRef = useRef(null);

    async function loadStyleBook() {
        setLoadState('loading');
        try {
            const p = legacy.state.currentProject;
            const r = await legacy.api(p ? '/projects/' + p.id + '/style-book' : '/style-book');
            setBook({ entries: r.entries || [], note: r.note || '' });
            setLoadState('ready');
        } catch (err) { setLoadState('error:' + err.message); }
    }
    usePageLoader('loadStyleBook', loadStyleBook);

    async function refreshMedia(entryId) {
        try {
            const r = await legacy.api(`/style-book/${entryId}`);
            setMedia(r.entry.media || []);
        } catch (err) { setMedia('error:' + err.message); }
    }

    function openEditor(entry) {
        setEditing({ id: entry ? entry.id : '', form: formOf(entry) });
        setVisual({ url: '', note: '' });
        setMedia(entry ? [] : null);
        if (entry) refreshMedia(entry.id);
        openModal('styleBookModal');
    }

    async function saveStyleBookEntry({ keepOpen = false } = {}) {
        const body = entryBody(editing.form);
        if (!body.name) { legacy.setStatus('Give the shot a name first'); return null; }
        const id = editing.id;
        try {
            const p = legacy.state.currentProject;
            const r = id
                ? await legacy.api('/style-book/' + id, { method: 'PUT', body: JSON.stringify(body) })
                : await legacy.api((p ? '/projects/' + p.id : '') + '/style-book', { method: 'POST', body: JSON.stringify(body) });
            if (!keepOpen) closeModal('styleBookModal');
            legacy.setStatus('Style book saved');
            loadStyleBook();
            return (r && r.entry) || { id };
        } catch (err) { legacy.setStatus('Error: ' + err.message); return null; }
    }

    async function addStyleBookMedia() {
        let entryId = editing.id;
        const file = fileRef.current && fileRef.current.files && fileRef.current.files[0];
        const url = visual.url.trim();
        const note = visual.note.trim();
        if (!file && !url) { legacy.setStatus('Choose a file or paste a link first'); return; }
        if (!entryId) {
            // An unsaved shot is saved here rather than refused: the file needs an owner, so create it.
            const saved = await saveStyleBookEntry({ keepOpen: true });
            if (!saved) return;
            entryId = saved.id;
            setEditing(e => ({ ...e, id: saved.id }));
        }
        try {
            if (file) {
                const data = await readAsDataUrl(file);
                legacy.checkUploadSize(file, `/style-book/${entryId}/media`);
                await legacy.api(`/style-book/${entryId}/media`, { method: 'POST',
                    body: JSON.stringify({ data, name: file.name, note, media_kind: /^video\//.test(file.type) ? 'video' : 'image' }) });
                fileRef.current.value = '';
            } else {
                await legacy.api(`/style-book/${entryId}/media`, { method: 'POST', body: JSON.stringify({ source_url: url, note }) });
            }
            setVisual({ url: '', note: '' });
            legacy.setStatus('Visual added');
            await refreshMedia(entryId);
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function removeStyleBookMedia(entryId, mediaId) {
        if (!window.confirm('Remove this visual from the entry?')) return;
        try {
            await legacy.api(`/style-book/media/${mediaId}`, { method: 'DELETE' });
            await refreshMedia(entryId);
            loadStyleBook();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function deleteStyleBookEntry(e) {
        if (!window.confirm(`Delete "${e ? e.name : 'this shot'}"?\n\nIt goes from every project.`)) return;
        try {
            await legacy.api('/style-book/' + e.id, { method: 'DELETE' });
            legacy.setStatus('Deleted');
            loadStyleBook();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    // One search: the list bar's (name, description, tags and the camera, via camera_text). The page had its own filter
    // box before ListControls, which would have been a second search box doing the same thing.
    const filtered = book.entries;
    // Search, sort and filter what was read (never re-read); camera_text makes the camera searchable.
    const controls = useListControls(SURFACE, loadState === 'ready' || book.entries.length
        ? filtered.map(e => ({ ...e, camera_text: Object.values(e.camera || {}).join(' ') })) : null);
    const entries = controls.shown || [];
    const f = editing.form;
    const field = (k, extra = {}) => ({ 'data-field': k, value: f[k], onChange: (ev) => { const v = ev.target.value; setEditing(s => ({ ...s, form: { ...s.form, [k]: v } })); }, ...extra });

    return (
        <div className="page" id="page-stylebook">
            <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
                <h2>Style Book</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="btn btn-primary" onClick={() => openEditor(null)}>+ Shot</button>
                </div>
            </div>
            <p className="text-sm text-muted mb-16" style={{ maxWidth: '70ch', lineHeight: 1.5 }}>
                Shots you like, kept across every film. Give one a name, the camera details you know,
                and reference visuals. Applying an entry to a shot fills in its scene card &mdash; which is
                what the image and video prompts are built from, so a favourite angle reaches the next
                generation with nothing else to change.
            </p>
            {filtered.length > 0 && <ListControlsBar list={controls} />}
            <div id="styleBookGrid">
                {loadState === 'loading' && !book.entries.length && <p className="text-sm text-muted">Loading…</p>}
                {loadState.startsWith('error:') && <p className="text-sm">Could not load the style book: {loadState.slice(6)}</p>}
                {filtered.length > 0 && !entries.length && <ListNoMatch list={controls} />}
                {loadState === 'ready' && !book.entries.length && (
                    <p className="text-sm text-muted">No shots yet. Add one when you see an angle you want again &mdash; a name and a lens is enough to start.</p>)}
                {!loadState.startsWith('error:') && entries.length > 0 && <>
                    <div className="entity-grid">
                        {entries.map(e => (
                            <div key={e.id} className="entity-card" data-entry-id={e.id}>
                                {(e.media || []).length > 0 && <CardImage src={`${legacy.API_BASE}/film/style-book/media/${e.media[0].id}/file`} />}
                                <div className="flex-between">
                                    <strong style={{ fontSize: 13 }}>{e.name}</strong>
                                    <span className="tag">{e.scope === 'library' ? 'library' : 'this film'}</span>
                                </div>
                                {e.description && <p className="text-sm">{e.description}</p>}
                                <div className="tag-row">{styleBookTags(e).map((t, i) => <span key={i} className="tag">{t}</span>)}</div>
                                {e.tags && <p className="text-sm text-muted" style={{ marginTop: 6 }}>{e.tags}</p>}
                                <div className="card-actions">
                                    <button className="btn btn-secondary btn-sm" onClick={() => openEditor(e)}>Edit</button>
                                    <button className="btn btn-danger btn-sm" onClick={() => deleteStyleBookEntry(e)}>Delete</button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="text-sm text-muted" style={{ marginTop: 12, maxWidth: '70ch', lineHeight: 1.5 }}>{book.note}</p>
                </>}
            </div>

            <Modal id="styleBookModal" title={<span id="styleBookModalTitle">{editing.id ? 'Edit shot' : 'New shot'}</span>}>
                <input type="hidden" id="styleBookEditId" value={editing.id} readOnly />
                <div className="form-group"><label>Name</label><input type="text" {...field('name')} placeholder="Ozu tatami low-angle" /></div>
                <div className="form-group"><label>Description</label><textarea {...field('description')} rows={2} placeholder="What this shot is for, and when you reach for it..." /></div>
                <div className="form-group"><label>Tags</label><input type="text" {...field('tags')} placeholder="interior, conversation, static, formal" />
                    <p className="text-sm text-muted" style={{ marginTop: 6 }}>Free text &mdash; whatever you would actually search for.</p></div>
                <div className="form-group"><label>Kept in</label>
                    <select {...field('scope')}>
                        <option value="library">My library &mdash; every film</option>
                        <option value="project">This film only</option>
                    </select></div>
                <h4 className="mb-8" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--gl-text-muted)' }}>Camera &mdash; all optional</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="form-group"><label>Framing</label><input type="text" {...field('shot_type')} placeholder="close-up, wide, two-shot" /></div>
                    <div className="form-group"><label>Movement</label><input type="text" {...field('movement')} placeholder="static, push-in, orbit" /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="form-group"><label>Lens</label><input type="text" {...field('lens')} placeholder="40mm anamorphic" /></div>
                    <div className="form-group"><label>Sensor</label><input type="text" {...field('sensor')} placeholder="super35, fullframe" /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <div className="form-group"><label>Aperture</label><input type="number" step="0.1" min="0" {...field('aperture')} placeholder="2.8" /></div>
                    <div className="form-group"><label>Height &mdash; m</label><input type="number" step="0.05" min="0" {...field('height_m')} placeholder="0.4" /></div>
                    <div className="form-group"><label>Focus &mdash; m</label><input type="number" step="0.1" min="0" {...field('focus_distance_m')} placeholder="1.2" /></div>
                </div>
                <p className="text-sm text-muted" style={{ margin: '-4px 0 12px', lineHeight: 1.5 }}>
                    Height is what makes a shot read as low or high angle &mdash; <strong>0.4m</strong> is
                    tatami level, <strong>1.6m</strong> is eye level. Leave anything blank you do not know.
                </p>
                <div className="form-group"><label>Note to yourself</label><textarea {...field('note')} rows={2} placeholder="Why this works, what it needs..." /></div>

                {/* VISUALS: always offered. On a new shot, Add visual saves the shot first. */}
                <div id="styleBookMediaSection">
                    <h4 className="mb-8" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--gl-text-muted)' }}>Visuals</h4>
                    <div id="styleBookMediaList" className="mb-8">
                        {media === null && <p className="text-sm text-muted">Add one below &mdash; the shot is saved automatically when you do.</p>}
                        {Array.isArray(media) && !media.length && <p className="text-sm text-muted">No visuals yet.</p>}
                        {typeof media === 'string' && <p className="text-sm text-muted">Could not load visuals: {media.slice(6)}</p>}
                        {Array.isArray(media) && media.length > 0 && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
                                {media.map(m => <MediaTile key={m.id} m={m} onRemove={() => removeStyleBookMedia(editing.id, m.id)} />)}
                            </div>
                        )}
                    </div>
                    <div className="form-group"><label>Add a picture or clip</label>
                        <input type="file" id="styleBookMediaFile" accept="image/*,video/*" ref={fileRef} /></div>
                    <div className="form-group"><label>&hellip;or paste a link</label>
                        <input type="text" id="styleBookMediaUrl" placeholder="https://youtube.com/watch?v=… or a direct image/clip URL"
                            value={visual.url} onChange={(e) => { const v = e.target.value; setVisual(s => ({ ...s, url: v })); }} /></div>
                    <div className="form-group"><label>What it shows</label>
                        <input type="text" id="styleBookMediaNote" placeholder="The push-in at 1:24"
                            value={visual.note} onChange={(e) => { const v = e.target.value; setVisual(s => ({ ...s, note: v })); }} /></div>
                    <div className="btn-row" style={{ marginBottom: 12 }}>
                        <button className="btn btn-secondary btn-sm" id="styleBookAddMediaBtn" onClick={addStyleBookMedia}>Add visual</button>
                    </div>
                    {/* The served note, never a second literal: what a visual does and does not reach. */}
                    <p className="text-sm text-muted" id="styleBookMediaNote_" style={{ margin: '-4px 0 12px', lineHeight: 1.5 }}>{book.note}</p>
                </div>

                <div className="btn-row">
                    <button className="btn btn-primary" data-action="saveStyleBookEntry" onClick={() => saveStyleBookEntry()}>Save</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('styleBookModal')}>Cancel</button>
                </div>
            </Modal>
        </div>
    );
}

function CardImage({ src }) {
    const [broken, setBroken] = useState(false);
    if (broken) return null; // the card still names the shot; a missing thumbnail is not the entry missing
    return <img src={src} alt="" style={{ width: '100%', borderRadius: 6, marginBottom: 8, display: 'block' }} onError={() => setBroken(true)} />;
}

/** One visual, drawn as what it actually is. */
export function MediaTile({ m, onRemove }) {
    const [broken, setBroken] = useState(false);
    const src = m.url && m.url.startsWith('/film/') ? legacy.API_BASE + m.url : m.url;
    let body;
    if (m.embed_url) {
        // A move is what a clip is FOR: a player shows it where a thumbnail only proves a link exists.
        body = <iframe src={m.embed_url} allowFullScreen loading="lazy" title={m.note || 'Reference clip'}
            style={{ width: '100%', aspectRatio: '16/9', border: 0, borderRadius: 6, display: 'block' }} />;
    } else if (m.link_kind === 'video' || m.media_kind === 'video') {
        body = <video src={src} controls preload="metadata" style={{ width: '100%', borderRadius: 6, display: 'block' }} />;
    } else if (m.link_kind === 'link') {
        body = <a href={src} target="_blank" rel="noopener noreferrer" className="text-sm" style={{ display: 'block', padding: '18px 10px', textAlign: 'center' }}>{String(src).slice(0, 60)}&hellip;</a>;
    } else if (broken) {
        body = <p className="text-sm text-muted">This picture could not be loaded.</p>;
    } else {
        body = <img src={src} alt="" loading="lazy" style={{ width: '100%', borderRadius: 6, display: 'block', cursor: 'zoom-in' }}
            onClick={() => legacy.openPlateViewer(src, m.note || 'Reference')} onError={() => setBroken(true)} />;
    }
    return (
        <div className="style-book-visual" style={{ border: '1px solid var(--gl-border-subtle)', borderRadius: 8, padding: 8, minWidth: 0 }}>
            {body}
            {m.note && <p className="text-sm" style={{ marginTop: 6 }}>{m.note}</p>}
            <div className="card-actions"><button className="btn btn-danger btn-sm" onClick={onRemove}>Remove</button></div>
        </div>
    );
}
