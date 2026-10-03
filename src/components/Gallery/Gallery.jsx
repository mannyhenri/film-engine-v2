import { useRef, useState } from 'react';
import Modal, { openModal } from '../Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * The subject gallery, as React: one workspace for characters, locations and props (they differ only in
 * which foreign key holds them, and three near-identical panels is how one ends up with the promote rule
 * and the others do not). Same routes, bodies and status lines as the legacy modal.
 *
 * openGallery(kind, id, name) is PROVIDED (react.json): the sheets in core open it by name. This component
 * is mounted once at boot, and its modal is always rendered, hidden, so showModal can find it.
 */

/**
 * A served path is relative to the API, not to this page: the page is served from one port and the API
 * from another, so a bare `/film/refsheets/…` in an <img src> resolves against the PAGE and 404s. An
 * absolute inspiration link names its own host and is left alone.
 */
export function gallerySrc(imageUrl) {
    return imageUrl && !/^https?:/i.test(imageUrl) ? legacy.API_BASE + imageUrl : imageUrl;
}

function GalCard({ item, name, onRole, onRemove }) {
    const isRef = item.role === 'reference';
    const src = gallerySrc(item.image_url);
    // A link-only inspiration has no file to show; saying so beats a broken image.
    const picture = !item.image_url ? <div className="gal-link">no image</div>
        : /^https?:/.test(item.source_url || '')
            ? <a className="gal-link" href={src} target="_blank" rel="noopener">{src}</a>
            : <img src={src} alt="" onClick={() => legacy.openPlateViewer(src, name + (item.view ? ' — ' + item.view : ''))} />;
    return (
        <div className={'gal-card' + (isRef ? ' is-reference' : '')}>
            {picture}
            <div className="gal-meta">
                <span className={'gal-badge ' + item.role}>{item.role}</span>
                {item.view ? <> <span className="text-muted">{item.view}</span></> : null}
                {item.note ? <div className="text-muted" style={{ marginTop: 4 }}>{item.note}</div> : null}
            </div>
            <div className="gal-actions">
                {isRef
                    ? <button className="btn btn-sm" onClick={() => onRole(item.id, 'concept')}>Unset</button>
                    : <button className="btn btn-sm btn-primary" onClick={() => onRole(item.id, 'reference')}>Make reference</button>}
                <button className="btn btn-sm btn-danger" onClick={() => onRemove(item.id)}>Delete</button>
            </div>
        </div>
    );
}

export default function Gallery() {
    const gal = useRef({ kind: null, id: null, name: '' });
    const [subject, setSubject] = useState(gal.current);
    // null: loading; { error }: the read failed; else the gallery.
    const [data, setData] = useState(null);
    const [status, setStatusText] = useState('');
    const [instruction, setInstruction] = useState('');
    const [count, setCount] = useState('3');

    async function loadGallery() {
        const at = gal.current;
        setData(null);
        try {
            const d = await legacy.api(`/${at.kind}s/${at.id}/gallery`);
            if (gal.current === at) setData(d);
        } catch (err) {
            // A renderer that paints a placeholder must have a path that replaces it, or a failure reads
            // as the pictures not existing.
            if (gal.current === at) setData({ error: err.message });
        }
    }

    async function openGallery(kind, subjectId, name) {
        gal.current = { kind, id: subjectId, name: name || '' };
        setSubject(gal.current);
        setInstruction('');
        setStatusText('');
        openModal('galleryModal');
        await loadGallery();
    }
    usePageLoader('openGallery', openGallery);

    async function setGalleryRole(assetId, role) {
        setStatusText('Saving…');
        try {
            const res = await legacy.api(`/gallery/${assetId}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
            setStatusText(res.warning || (res.changed ? (res.note || 'Saved') : (res.note || 'No change')));
            await loadGallery();
        } catch (err) {
            /*
             * Promoting an inspiration is REFUSED rather than done quietly, and the refusal is the place to
             * offer the override — meeting a 409 with no way past is how a rule stops being read.
             */
            if (/inspiration/i.test(err.message)) {
                if (window.confirm(err.message + '\n\nMake it the reference anyway?')) {
                    await legacy.api(`/gallery/${assetId}/role`, { method: 'PUT', body: JSON.stringify({ role: 'reference', allow_inspiration: true }) });
                    await loadGallery();
                    setStatusText('Promoted.');
                    return;
                }
                setStatusText('Left as inspiration.');
                return;
            }
            setStatusText(err.message);
        }
    }

    async function removeGalleryImage(assetId) {
        if (!window.confirm('Delete this picture?\n\nThe file is moved to a deleted/ folder rather than '
            + 'destroyed — a generated plate cost money.')) return;
        try {
            const res = await legacy.api(`/gallery/${assetId}`, { method: 'DELETE' });
            setStatusText(res.warning || 'Deleted.');
            await loadGallery();
        } catch (err) { setStatusText(err.message); }
    }

    /** Explore a subject: N concepts, through the one gate. */
    async function exploreSubject() {
        const n = Number(count) || 3;
        const what = instruction.trim();
        const at = gal.current;
        const q = `count=${n}&instruction=${encodeURIComponent(what)}`;
        return legacy.confirmPaidImage({
            title: `Explore ${n} concept${n === 1 ? '' : 's'}`,
            capability: 'image',
            previewUrl: `/${at.kind}s/${at.id}/explore/preview?${q}`,
            note: 'Concepts are kept beside the subject and condition nothing until one is '
                + 'promoted to a reference.',
            send: async choices => {
                setStatusText('Generating…');
                legacy.setStatus('Generating concepts…', true);
                try {
                    await legacy.api(`/${at.kind}s/${at.id}/explore`, {
                        method: 'POST', body: JSON.stringify({ ...choices, count: n, instruction: what }),
                    });
                    setStatusText('');
                    legacy.setStatus('Concepts generated.');
                    await loadGallery();
                } catch (err) { setStatusText('Error: ' + err.message); }
            },
        });
    }

    async function addInspirationPrompt() {
        const url = window.prompt('Paste an image link (http/https) — a still, a photograph, a reference:');
        if (!url) return;
        const note = window.prompt('What are you taking from it? (optional)') || '';
        const at = gal.current;
        try {
            await legacy.api(`/${at.kind}s/${at.id}/inspiration`, { method: 'POST', body: JSON.stringify({ source_url: url, note }) });
            setStatusText('Gathered as inspiration.');
            await loadGallery();
        } catch (err) { setStatusText(err.message); }
    }

    return (
        <Modal id="galleryModal" title={subject.kind ? `${subject.name || subject.kind} — gallery` : 'Gallery'} wide>
            <div className="gal-bar">
                <input type="text" id="galInstruction" className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)}
                       placeholder="A look to try — “older, scarred”, “at night, wet”" />
                <select id="galCount" value={count} onChange={(e) => setCount(e.target.value)}>
                    {['1', '2', '3', '4', '5', '6'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" onClick={exploreSubject}>Explore</button>
                <button className="btn btn-sm" onClick={addInspirationPrompt}>+ Inspiration</button>
                <span id="galStatus" className="text-muted text-sm">{status}</span>
            </div>
            <p className="text-muted text-sm" style={{ margin: '0 0 12px' }}>
                Exploring is generated as <strong>concepts</strong> &mdash; kept side by side, and
                reaching no prompt until you make one the reference. The approved plate is untouched.
            </p>
            <div id="galleryBody">
                {subject.kind && data === null && <div className="text-muted">Loading…</div>}
                {data && data.error !== undefined && (
                    <div className="empty-state"><h3>Could not load the gallery</h3><p>{data.error}</p></div>
                )}
                {data && data.roles && data.roles.map(role => {
                    const items = (data.by_role || {})[role.id] || [];
                    return (
                        <div className="gal-group" key={role.id}>
                            <h4>{role.title} <span className="text-muted text-sm">({items.length})</span></h4>
                            <p className="gal-why">{role.what} {role.why}</p>
                            {items.length
                                ? <div className="gal-grid">{items.map(item => <GalCard key={item.id} item={item} name={subject.name} onRole={setGalleryRole} onRemove={removeGalleryImage} />)}</div>
                                : <p className="text-muted text-sm">{role.id === 'reference'
                                    ? 'No approved reference. Every frame this subject appears in will invent it.'
                                    : 'Nothing here yet.'}</p>}
                        </div>
                    );
                })}
            </div>
        </Modal>
    );
}
