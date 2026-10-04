import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { formBody } from '../../lib/forms.js';
import { describeFromScreenplay, DESCRIBE_TITLE, formFrom, BANNER_STYLE } from '../../lib/subjects.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * Locations, as React. Same routes, bodies and status lines as the legacy page; one change, named:
 *   - "+ Location" opens an EMPTY form (the legacy button reopened a cancelled Edit, id and all).
 *
 * The location SHEET (openSubjectSheet), its plate tools and views stay in core and still call
 * loadLocations() after their work, which this page answers.
 */
export const LOCATION_FIELDS = ['name', 'description', 'reference_prompt', 'lighting_default', 'time_of_day_default', 'atmosphere_notes', 'sound_notes'];
const blank = () => formFrom(null, LOCATION_FIELDS);

function LocationCard({ l, onEdit, onDelete }) {
    const [plateFailed, setPlateFailed] = useState(false);
    return (
        <div className="entity-card" style={{ cursor: 'pointer' }} onClick={() => legacy.openSubjectSheet('location', l.id)} title="Open the location sheet">
            {l.reference_image_url
                ? <img src={legacy.plateSrc(l.reference_image_url, 480)} style={{ ...BANNER_STYLE, display: plateFailed ? 'none' : undefined }}
                       title="Click to see the plate full size"
                       // stopPropagation: the card opens the sheet; the plate opens the viewer, not both.
                       onClick={(e) => { e.stopPropagation(); legacy.openPlateViewer(legacy.API_BASE + l.reference_image_url, l.name); }}
                       onError={() => setPlateFailed(true)} />
                : null}
            <div className="entity-card-header">
                <div className="entity-avatar" style={{ borderRadius: 8 }}>&#128205;</div>
                <div>
                    <h3>{l.name}</h3>
                    <p className="text-sm text-muted">{l.scene_count || 0} scene(s)</p>
                </div>
            </div>
            <p>{l.description || 'No description'}</p>
            <div className="tag-row">
                {l.lighting_default ? <span className="tag">{l.lighting_default}</span> : null}
                {l.time_of_day_default ? <span className="tag">{l.time_of_day_default}</span> : null}
            </div>
            {/* Two buttons. Everything else moved onto the sheet (RELOCATED in lib/subject-sheets.js). */}
            <div className="card-actions">
                <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(l.id); }}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete(l.id); }}>Delete</button>
            </div>
        </div>
    );
}

export default function LocationsPage() {
    const [locations, setLocations] = useState(null);
    const [form, setForm] = useState(blank);
    const [editing, setEditing] = useState({ id: '', originalName: '' });

    async function loadLocations() {
        if (!legacy.state.currentProject) return;
        try {
            const data = await legacy.api('/projects/' + legacy.state.currentProject.id + '/locations');
            // Core reads it too: the screenplay editor's heading matching and the sheet.
            legacy.state.locations = data.locations || [];
            setLocations(legacy.state.locations);
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadLocations', loadLocations);

    function editLocation(id) {
        const l = (legacy.state.locations || []).find(x => x.id === id);
        if (!l) return;
        setEditing({ id, originalName: l.name || '' });
        setForm(formFrom(l, LOCATION_FIELDS));
        openModal('locationModal');
    }

    function newLocation() {
        setEditing({ id: '', originalName: '' });
        setForm(blank());
        openModal('locationModal');
    }

    async function saveLocation() {
        if (!legacy.state.currentProject) return;
        const data = formBody(form);
        if (!data.name) return;

        // FILM-122: a rename asks whether the screenplay's scene headings follow.
        if (editing.id && editing.originalName && data.name !== editing.originalName) {
            data.propagate_to_screenplay = window.confirm(`Rename "${editing.originalName}" to "${data.name}" in the screenplay too?\n\n`
                + 'This will update all scene headings in the screenplay.');
        }
        try {
            const result = editing.id
                ? await legacy.api('/locations/' + editing.id, { method: 'PUT', body: JSON.stringify(data) })
                : await legacy.api('/projects/' + legacy.state.currentProject.id + '/locations', { method: 'POST', body: JSON.stringify(data) });
            closeModal('locationModal');
            setForm(blank());
            setEditing({ id: '', originalName: '' });
            loadLocations();

            // FILM-122: say what the rename did to the screenplay.
            const su = result && result.screenplay_update;
            if (su) {
                if (su.updated) {
                    legacy.setStatus(`Location saved. Screenplay updated: ${su.occurrences} occurrence(s) renamed (v${su.new_version})`);
                    // So the rename is visible in the editor (core's screenplay loader).
                    legacy.loadScreenplayPage();
                } else {
                    legacy.setStatus(`Location saved. Screenplay: ${su.reason || 'no changes needed'}`);
                }
            } else {
                legacy.setStatus('Location saved');
            }
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function deleteLocation(id) {
        if (!window.confirm('Delete this location?')) return;
        try {
            await legacy.api('/locations/' + id, { method: 'DELETE' });
            loadLocations();
            legacy.setStatus('Location deleted');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    // Search and sort what was read (no second request); the sort is remembered for this page.
    const list = useListControls(SURFACE, locations);
    const field = (k) => ({ 'data-field': k, value: form[k], onChange: (e) => { const v = e.target.value; setForm(f => ({ ...f, [k]: v })); } });

    return (
        <div className="page" id="page-locations">
            <div className="flex-between mb-16">
                <h2>Locations</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => describeFromScreenplay(loadLocations)} title={DESCRIBE_TITLE}>Describe from screenplay</button>
                    <button className="btn btn-primary" onClick={newLocation}>+ Location</button>
                </div>
            </div>
            <ListControlsBar list={list} />
            <div className="entity-grid" id="locationGrid">
                {locations && locations.length > 0 && list.shown.length === 0 && <ListNoMatch list={list} />}
                {locations && locations.length === 0 && (
                    <div className="empty-state" style={{ gridColumn: '1/-1' }}><div className="icon">&#128205;</div><h3>No locations</h3><p>Add filming locations.</p></div>
                )}
                {(list.shown || []).map(l => <LocationCard key={l.id} l={l} onEdit={editLocation} onDelete={deleteLocation} />)}
            </div>

            <Modal id="locationModal" title={editing.id ? 'Edit Location' : 'New Location'}>
                <div className="form-group"><label>Name</label><input type="text" {...field('name')} placeholder="Location name" /></div>
                <div className="form-group"><label>Description</label><textarea {...field('description')} rows={2} placeholder="Describe this location..." /></div>
                <div className="form-group"><label>Reference Prompt</label><textarea {...field('reference_prompt')} rows={2} placeholder="Visual description for AI..." /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="form-group"><label>Lighting Default</label><input type="text" {...field('lighting_default')} placeholder="natural, dramatic..." /></div>
                    <div className="form-group"><label>Time of Day</label><input type="text" {...field('time_of_day_default')} placeholder="day, night, dusk..." /></div>
                </div>
                <div className="form-group"><label>Atmosphere Notes</label><textarea {...field('atmosphere_notes')} rows={2} placeholder="Mood, atmosphere..." /></div>
                <div className="form-group">
                    <label>Sound Notes</label>
                    <textarea {...field('sound_notes')} rows={2} placeholder="Traffic two streets over, a screen door, gulls..." />
                    <p className="text-sm text-muted" style={{ marginTop: 6, lineHeight: 1.5 }}>
                        Notes for you and for whoever writes the ambient cue. Not sent to a generator &mdash;
                        an ambient bed is generated from the scene, not from this field.
                    </p>
                </div>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={saveLocation}>Save</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('locationModal')}>Cancel</button>
                </div>
            </Modal>
        </div>
    );
}
