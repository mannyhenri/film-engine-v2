import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { formBody } from '../../lib/forms.js';
import { describeFromScreenplay, DESCRIBE_TITLE, formFrom, BANNER_STYLE } from '../../lib/subjects.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * Props, as React. Same routes, bodies and status lines as the legacy page; two changes, named:
 *   - "+ Prop" opens an EMPTY form (the legacy button reopened a cancelled Edit, id and all).
 *   - a category pill filters what was read; the legacy pill refetched the list to filter it.
 *
 * The prop SHEET (openSubjectSheet) and its plate tools stay in core and still call loadProps().
 */
export const PROP_FIELDS = ['name', 'description', 'visual_prompt', 'height_m', 'width_m', 'length_m', 'category', 'notes'];
const NUMBER_FIELDS = ['height_m', 'width_m', 'length_m'];
// Until the vocabulary is read: the one option the database always accepts. A picker with nothing in
// it looks broken; a short one merely looks short.
const FALLBACK = [{ id: 'generic', label: 'Generic' }];

/*
 * The prop categories the database will actually accept, from GET /film/card-vocabulary (its
 * prop_categories), never typed here: a hand-written list offered `clothing` and `personal`, which the
 * CHECK constraint on film_props.category refuses. Read once; a failure keeps the fallback.
 */

let _propCategories = null;
async function propCategories() {
    if (!_propCategories) {
        try {
            const v = await legacy.api('/card-vocabulary');
            _propCategories = (v.prop_categories || []).map(id => ({ id, label: (v.prop_category_labels || {})[id] || id }));
        } catch (_) { return null; }
    }
    return _propCategories.length ? _propCategories : null;
}
export function forgetPropCategories() { _propCategories = null; } // tests

function PropCard({ p, onEdit, onDelete }) {
    const [plateFailed, setPlateFailed] = useState(false);
    return (
        <div className="entity-card" style={{ cursor: 'pointer' }} onClick={() => legacy.openSubjectSheet('prop', p.id)} title="Open the prop sheet">
            {p.reference_image_url
                ? <img src={legacy.plateSrc(p.reference_image_url, 480)} style={{ ...BANNER_STYLE, display: plateFailed ? 'none' : undefined }}
                       title="Click to see the plate full size"
                       // stopPropagation: the card opens the sheet; the plate opens the viewer, not both.
                       onClick={(e) => { e.stopPropagation(); legacy.openPlateViewer(legacy.API_BASE + p.reference_image_url, p.name); }}
                       onError={() => setPlateFailed(true)} />
                : null}
            <div className="entity-card-header">
                <div className="entity-avatar" style={{ borderRadius: 8, fontSize: 14 }}>&#127917;</div>
                <div>
                    <h3>{p.name}</h3>
                    <span className="badge">{p.category || 'generic'}</span>
                </div>
            </div>
            <p>{p.description || 'No description'}</p>
            {/* Two buttons; the rest is on the sheet. */}
            <div className="card-actions">
                <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(p.id); }}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}>Delete</button>
            </div>
        </div>
    );
}

export default function PropsPage() {
    const [props, setProps] = useState(null);
    const [filter, setFilter] = useState('all');
    const [categories, setCategories] = useState(FALLBACK);
    const [form, setForm] = useState(() => formFrom(null, PROP_FIELDS));
    const [editId, setEditId] = useState('');

    async function loadProps() {
        if (!legacy.state.currentProject) return;
        try {
            const data = await legacy.api('/projects/' + legacy.state.currentProject.id + '/props');
            // Core reads it too (the sheet, regeneratePlate).
            legacy.state.props = data.props || [];
            setProps(legacy.state.props);
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadProps', loadProps);

    /*
     * The options have to exist BEFORE the value is set: assigning `vehicle` to a select that still holds
     * only `generic` fails silently, so every prop opened reading "Generic" and saving recategorised it.
     */
    async function openForm(record, id) {
        const cats = (await propCategories()) || categories;
        setCategories(cats);
        setEditId(id);
        setForm(formFrom(record, PROP_FIELDS, { category: cats.map(c => c.id) }));
        openModal('propModal');
    }
    const editProp = (id) => { const p = (legacy.state.props || []).find(x => x.id === id); if (p) return openForm(p, id); };

    async function saveProp() {
        if (!legacy.state.currentProject) return;
        const data = formBody(form, NUMBER_FIELDS);
        if (!data.name) return;
        try {
            if (editId) await legacy.api('/props/' + editId, { method: 'PUT', body: JSON.stringify(data) });
            else await legacy.api('/projects/' + legacy.state.currentProject.id + '/props', { method: 'POST', body: JSON.stringify(data) });
            closeModal('propModal');
            setForm(formFrom(null, PROP_FIELDS));
            setEditId('');
            loadProps();
            legacy.setStatus('Prop saved');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function deleteProp(id) {
        if (!window.confirm('Delete this prop?')) return;
        try {
            await legacy.api('/props/' + id, { method: 'DELETE' });
            loadProps();
            legacy.setStatus('Prop deleted');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    const all = props || [];
    const pills = ['all', ...new Set(all.map(p => p.category || 'generic'))];
    const inCategory = filter !== 'all' ? all.filter(p => (p.category || 'generic') === filter) : all;
    // Search and sort within the category pill; the sort is remembered for this page.
    const list = useListControls(SURFACE, props ? inCategory : null);
    const shown = list.shown || [];
    const field = (k) => ({ 'data-field': k, value: form[k], onChange: (e) => { const v = e.target.value; setForm(f => ({ ...f, [k]: v })); } });

    return (
        <div className="page" id="page-props">
            <div className="flex-between mb-16">
                <h2>Props</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => describeFromScreenplay(loadProps)} title={DESCRIBE_TITLE}>Describe from screenplay</button>
                    <button className="btn btn-primary" onClick={() => openForm(null, '')}>+ Prop</button>
                </div>
            </div>
            <div className="filter-pills" id="propFilters">
                {props && pills.map(c => <button key={c} className={'filter-pill' + (c === filter ? ' active' : '')} onClick={() => setFilter(c)}>{c}</button>)}
            </div>
            <ListControlsBar list={list} />
            <div className="entity-grid" id="propGrid">
                {props && inCategory.length > 0 && shown.length === 0 && <ListNoMatch list={list} />}
                {props && inCategory.length === 0 && (
                    <div className="empty-state" style={{ gridColumn: '1/-1' }}><div className="icon">&#127917;</div><h3>No props</h3><p>Add props used in your production.</p></div>
                )}
                {shown.map(p => <PropCard key={p.id} p={p} onEdit={editProp} onDelete={deleteProp} />)}
            </div>

            <Modal id="propModal" title={editId ? 'Edit Prop' : 'New Prop'}>
                <div className="form-group"><label>Name</label><input type="text" {...field('name')} placeholder="Prop name" /></div>
                <div className="form-group"><label>Description</label><textarea {...field('description')} rows={2} placeholder="Describe this prop..." /></div>
                <div className="form-group"><label>Visual Prompt</label><textarea {...field('visual_prompt')} rows={2} placeholder="Visual description for AI..." /></div>
                <div className="form-group">
                    <label>Real size &mdash; metres</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                        <input type="number" step="0.01" min="0" {...field('height_m')} placeholder="height" />
                        <input type="number" step="0.01" min="0" {...field('width_m')} placeholder="width" />
                        <input type="number" step="0.01" min="0" {...field('length_m')} placeholder="length" />
                    </div>
                </div>
                <p className="text-sm text-muted" style={{ margin: '-4px 0 10px', lineHeight: 1.5 }}>An image model has no sense of scale, and a reference plate makes it worse &mdash; a plate is a close-up filling its own frame, so conditioning on one without a size reproduces what it was shown. This is how a 30cm sprinkler comes out the size of a car.</p>
                <div className="form-group"><label>Category</label>
                    <select {...field('category')} id="propCategorySelect">
                        {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Notes</label>
                    <textarea {...field('notes')} rows={2} placeholder="Where it came from, which scenes it must match, anything continuity needs to know..." />
                </div>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={saveProp}>Save</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('propModal')}>Cancel</button>
                </div>
            </Modal>
        </div>
    );
}
