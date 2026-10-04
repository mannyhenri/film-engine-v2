import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * Titles & Credits, as React. The vocabularies (credit sections, card types) are SERVED with the
 * lists, so the forms never offer a value the route refuses. Same routes, bodies and status lines as
 * the legacy page, with one fix: Edit opens the row you clicked. The legacy page looked the row up in
 * state.creditRows / state.titleCardRows, which nothing ever filled, so Edit opened an EMPTY form and
 * saving it blanked the record.
 */
const creditForm = (c) => ({ name: c.name || '', section: c.section || 'crew', role: c.role || '', character_name: c.character_name || '', style: c.style || '', sort_order: c.sort_order || 0 });
const cardForm = (c) => ({ text: c.text || '', subtext: c.subtext || '', card_type: c.card_type || 'card', duration: ((c.duration_ms || 3000) / 1000).toFixed(1), position_in_timeline: c.position_in_timeline || '', style: c.style || '', sort_order: c.sort_order || 0 });
const human = (s) => String(s || '').replace(/_/g, ' ');

export default function TitlesPage() {
    const [data, setData] = useState(null); // { credits, cards, sections, card_types }
    const [loadError, setLoadError] = useState('');
    // Always forms, so their fields are on the page (and in the static render the UI tests read).
    const [credit, setCredit] = useState({ id: null, form: creditForm({}) });
    const [card, setCard] = useState({ id: null, form: cardForm({}) });

    async function loadTitles() {
        if (!legacy.state.currentProject) return;
        const pid = legacy.state.currentProject.id;
        try {
            const [credits, cards] = await Promise.all([legacy.api(`/projects/${pid}/credits`), legacy.api(`/projects/${pid}/title-cards`)]);
            setData({ credits: credits.credits || [], cards: cards.title_cards || [], sections: credits.sections || [], card_types: cards.card_types || [] });
            setLoadError('');
        } catch (err) { setLoadError(err.message); }
    }
    usePageLoader('loadTitles', loadTitles);

    const sections = (data && data.sections) || [];
    const cardTypes = (data && data.card_types) || [];
    const credits = (data && data.credits) || [];
    const cards = (data && data.cards) || [];
    // Grouped by section in the served order, so the page reads the way the roll does.
    const order = sections.length ? sections : [...new Set(credits.map(c => c.section))];

    async function save(kind, id, body, required, label, collection) {
        if (!body[required]) return legacy.setStatus(`A ${label} needs ${required === 'name' ? 'a name' : 'its text'}`);
        try {
            await legacy.api(id ? `/${collection}/${id}` : `/projects/${legacy.state.currentProject.id}/${collection}`,
                { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
            closeModal(kind);
            legacy.setStatus(id ? `${label[0].toUpperCase() + label.slice(1)} updated` : `${label[0].toUpperCase() + label.slice(1)} added`);
            loadTitles();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    async function remove(collection, id, question, done) {
        if (!window.confirm(question)) return;
        try { await legacy.api(`/${collection}/${id}`, { method: 'DELETE' }); loadTitles(); legacy.setStatus(done); }
        catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    const saveCredit = () => {
        const f = credit.form;
        save('creditModal', credit.id, { name: f.name, section: f.section, role: f.role, character_name: f.character_name, style: f.style, sort_order: Number(f.sort_order) || 0 }, 'name', 'credit', 'credits');
    };
    const saveTitleCard = () => {
        const f = card.form;
        save('titleCardModal', card.id, { text: f.text, subtext: f.subtext, card_type: f.card_type, duration_ms: Math.round((Number(f.duration) || 0) * 1000),
            position_in_timeline: f.position_in_timeline, style: f.style, sort_order: Number(f.sort_order) || 0 }, 'text', 'title card', 'title-cards');
    };
    const openCredit = (c) => { setCredit({ id: c ? c.id : null, form: creditForm(c || {}) }); openModal('creditModal'); };
    const openTitleCard = (c) => { setCard({ id: c ? c.id : null, form: cardForm(c || {}) }); openModal('titleCardModal'); };
    const onCredit = (k) => (e) => { const v = e.target.value; setCredit(s => ({ ...s, form: { ...s.form, [k]: v } })); };
    const onCard = (k) => (e) => { const v = e.target.value; setCard(s => ({ ...s, form: { ...s.form, [k]: v } })); };
    // As core's vocabOptions drew them: the served value kept, its underscores shown as spaces.
    const options = (list) => list.map(v => <option key={v} value={v}>{String(v).replace(/_/g, ' ')}</option>);
    const actions = (onEdit, onDelete) => (
        <div className="card-actions">
            <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
            <button className="btn btn-secondary btn-sm" onClick={onDelete}>Delete</button>
        </div>
    );

    return (
        <div className="page" id="page-titles">
            <div className="flex-between mb-16">
                <h2>Titles &amp; Credits</h2>
                <div>
                    <button className="btn btn-secondary" onClick={() => openTitleCard(null)}>+ Title card</button>
                    <button className="btn btn-primary" onClick={() => openCredit(null)}>+ Credit</button>
                </div>
            </div>
            <p className="text-sm text-muted mb-8">
                What the film says over its own head and at its end. Both have had routes since the
                delivery work and neither had a page, so every field could only be written by curl or
                by an agent. Nothing here generates anything &mdash; it is written, ordered, and
                carried into the export.
            </p>
            <h3 className="mb-8">Title cards</h3>
            <div id="titleCardList" className="mb-16">
                {data && !cards.length && <p className="text-sm text-muted">No title cards. A main title and an end title are the two most films have.</p>}
                {cards.map(c => (
                    <div key={c.id} className="card" style={{ marginBottom: 8 }}>
                        <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                            <div style={{ minWidth: 0 }}>
                                <strong>{c.text || 'Untitled card'}</strong>
                                {c.subtext && <div className="text-sm text-muted">{c.subtext}</div>}
                                <div className="tag-row" style={{ marginTop: 4 }}>
                                    <span className="badge">{human(c.card_type || 'card')}</span>
                                    <span className="tag">{((c.duration_ms || 0) / 1000).toFixed(1)}s</span>
                                    {c.position_in_timeline && <span className="tag">{c.position_in_timeline}</span>}
                                </div>
                            </div>
                            {actions(() => openTitleCard(c), () => remove('title-cards', c.id, 'Remove this title card?', 'Title card removed'))}
                        </div>
                    </div>
                ))}
            </div>
            <h3 className="mb-8">Credits</h3>
            <div id="creditList">
                {loadError && <p className="text-sm text-muted">Could not read the titles: {loadError}</p>}
                {!loadError && data && !credits.length && <p className="text-sm text-muted">No credits yet.</p>}
                {!loadError && order.filter(sec => credits.some(c => c.section === sec)).map(sec => (
                    <div key={sec}>
                        <h4 style={{ margin: '12px 0 6px', textTransform: 'capitalize' }}>{human(sec)}</h4>
                        {credits.filter(c => c.section === sec).map(c => (
                            <div key={c.id} className="card" style={{ marginBottom: 6 }}>
                                <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                                    <div style={{ minWidth: 0 }}>
                                        <strong>{c.name || ''}</strong>
                                        {c.role && <span className="text-sm text-muted"> &mdash; {c.role}</span>}
                                        {c.character_name && <div className="text-sm text-muted">as {c.character_name}</div>}
                                    </div>
                                    {actions(() => openCredit(c), () => remove('credits', c.id, 'Remove this credit?', 'Credit removed'))}
                                </div>
                            </div>
                        ))}
                    </div>
                ))}
            </div>

            <Modal id="creditModal" title={credit.id ? 'Edit credit' : 'New credit'} footer={<>
                <button className="btn btn-secondary" onClick={() => closeModal('creditModal')}>Cancel</button>
                <button className="btn btn-primary" onClick={saveCredit}>Save</button>
            </>}>
                <div className="form-group"><label>Name</label>
                    <input type="text" id="creditName" data-field="name" maxLength={200} value={credit.form.name} onChange={onCredit('name')} placeholder="The person or company" /></div>
                <div className="form-group"><label>Section</label>
                    <select id="creditSection" data-field="section" value={credit.form.section} onChange={onCredit('section')}>{options(sections)}</select></div>
                <div className="form-group"><label>Role</label>
                    <input type="text" id="creditRole" data-field="role" maxLength={200} value={credit.form.role} onChange={onCredit('role')} placeholder="e.g. Director of Photography" /></div>
                <div className="form-group"><label>Character</label>
                    <input type="text" id="creditCharacter" data-field="character_name" maxLength={200} value={credit.form.character_name} onChange={onCredit('character_name')} placeholder="For a cast credit — who they played" />
                    <span className="text-sm text-muted">Cast only. A crew credit leaves this blank.</span></div>
                <div className="form-group"><label>Style</label>
                    <input type="text" id="creditStyle" data-field="style" maxLength={500} value={credit.form.style} onChange={onCredit('style')} placeholder="How it is set — read by the export, not by a generator" /></div>
                <div className="form-group"><label>Order within the section</label>
                    <input type="number" id="creditOrder" data-field="sort_order" min="0" value={credit.form.sort_order} onChange={onCredit('sort_order')} /></div>
            </Modal>

            <Modal id="titleCardModal" title={card.id ? 'Edit title card' : 'New title card'} footer={<>
                <button className="btn btn-secondary" onClick={() => closeModal('titleCardModal')}>Cancel</button>
                <button className="btn btn-primary" onClick={saveTitleCard}>Save</button>
            </>}>
                <div className="form-group"><label>Text</label>
                    <input type="text" id="cardText" data-field="text" maxLength={500} value={card.form.text} onChange={onCard('text')} placeholder="What the card says" /></div>
                <div className="form-group"><label>Subtext</label>
                    <input type="text" id="cardSubtext" data-field="subtext" maxLength={500} value={card.form.subtext} onChange={onCard('subtext')} placeholder="A second line, smaller" /></div>
                <div className="form-group"><label>Type</label>
                    <select id="cardType" data-field="card_type" value={card.form.card_type} onChange={onCard('card_type')}>{options(cardTypes)}</select></div>
                <div className="form-group"><label>Hold (seconds)</label>
                    <input type="number" id="cardDuration" data-field="duration_ms" min="0" step="0.1" value={card.form.duration} onChange={onCard('duration')} />
                    <span className="text-sm text-muted">Stored in milliseconds; typed in seconds, which is how a card is read.</span></div>
                <div className="form-group"><label>Where it sits</label>
                    <input type="text" id="cardPosition" data-field="position_in_timeline" maxLength={100} value={card.form.position_in_timeline} onChange={onCard('position_in_timeline')} placeholder="e.g. before scene 1, or after the last shot" /></div>
                <div className="form-group"><label>Style</label>
                    <input type="text" id="cardStyle" data-field="style" maxLength={500} value={card.form.style} onChange={onCard('style')} /></div>
                <div className="form-group"><label>Order</label>
                    <input type="number" id="cardOrder" data-field="sort_order" min="0" value={card.form.sort_order} onChange={onCard('sort_order')} /></div>
            </Modal>
        </div>
    );
}
