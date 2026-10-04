import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { formBody } from '../../lib/forms.js';
import { describeFromScreenplay, DESCRIBE_TITLE, formFrom } from '../../lib/subjects.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * Characters, as React. Same routes, bodies and status lines as the legacy page; one change, named:
 *   - "+ Character" opens an EMPTY form. The legacy button only showed the modal, so after an Edit that
 *     was cancelled it reopened holding that character, with its id, and Save overwrote it.
 *
 * The character SHEET (openCharacterSheet) stays in core: the board, the graph and the frame viewer open
 * it too. Clicking a card opens it. editCharacter is PROVIDED (react.json): the sheet's "Add the physical
 * spec" and casting's "Add gender and age" call it by name.
 */

// The values the caster reads; lib/character-sheet.js GENDERS is held to them (character-sheet-authoring).
export const GENDERS = [['', '— not recorded —'], ['female', 'Female'], ['male', 'Male'], ['non-binary', 'Non-binary'], ['neutral', 'Neutral / not applicable']];
export const CHARACTER_FIELDS = ['name', 'description', 'appearance_prompt', 'height_m', 'age_range', 'gender',
    'ethnicity', 'build', 'hair', 'distinguishing', 'personality_notes', 'lora_id', 'ti_token'];
const NUMBER_FIELDS = ['height_m'];
const SELECTS = { gender: GENDERS.map(([v]) => v) };
const blank = () => formFrom(null, CHARACTER_FIELDS, SELECTS);

function CharacterCard({ c, onEdit, onDelete }) {
    const [plateFailed, setPlateFailed] = useState(false);
    const initial = <div className="entity-avatar">{c.name.charAt(0)}</div>;
    const facts = [c.age_range || null, c.gender || null, c.height_m ? c.height_m + 'm' : null].filter(Boolean).join(' · ');
    const missing = [!c.gender ? 'gender' : null, !c.age_range ? 'age' : null].filter(Boolean);
    return (
        <div className="entity-card" data-character-id={c.id} style={{ cursor: 'pointer' }} onClick={() => legacy.openCharacterSheet(c.id)} title="Open the character sheet">
            <div className="entity-card-header">
                {c.reference_image_url && !plateFailed
                    ? <img src={legacy.plateSrc(c.reference_image_url, 160)}
                           style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, cursor: 'zoom-in' }}
                           title="Click to see the plate full size"
                           // stopPropagation: the card is itself clickable and opens the sheet, so without
                           // this you get both and the one you asked for is underneath.
                           onClick={(e) => { e.stopPropagation(); legacy.openPlateViewer(legacy.API_BASE + c.reference_image_url, c.name); }}
                           onError={() => setPlateFailed(true)} />
                    : initial}
                <div>
                    <h3>{c.name}</h3>
                    <p className="text-sm text-muted">{facts}{
                        /*
                         * What is MISSING, said where it is noticed. An absent field produced an empty line,
                         * which reads as the field not existing. They are not decoration: voice casting ranks
                         * the catalogue by them, so an unrecorded gender means voices in arbitrary order.
                         */
                        missing.length > 0 && (
                            <a className="text-sm" style={{ cursor: 'pointer', color: 'var(--gl-accent,#818cf8)' }}
                               onClick={(e) => { e.stopPropagation(); onEdit(c.id); }}
                               title="Voice casting ranks the catalogue by these">{facts ? ' · ' : ''}+ {missing.join(' & ')}</a>
                        )}</p>
                </div>
            </div>
            <p>{c.description || 'No description'}</p>
            <div className="tag-row">
                {c.has_voice_profile ? <span className="tag" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>Voice</span> : null}
                {c.costume_count > 0 ? <span className="tag">{c.costume_count} costume(s)</span> : null}
                {c.lora_id ? <span className="tag">LoRA</span> : null}
            </div>
            {/* Two buttons. Everything else you do while LOOKING at the character lives on the sheet. */}
            <div className="card-actions">
                <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(c.id); }}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}>Delete</button>
            </div>
        </div>
    );
}

export default function CharactersPage() {
    const [characters, setCharacters] = useState(null);
    const [form, setForm] = useState(blank);
    const [editing, setEditing] = useState({ id: '', originalName: '' });

    async function loadCharacters() {
        if (!legacy.state.currentProject) return;
        try {
            const data = await legacy.api('/projects/' + legacy.state.currentProject.id + '/characters');
            // Core reads it too: the screenplay editor's cue matching, the sheet, regeneratePlate.
            legacy.state.characters = data.characters || [];
            setCharacters(legacy.state.characters);
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadCharacters', loadCharacters);

    function editCharacter(id) {
        const c = (legacy.state.characters || []).find(x => x.id === id);
        if (!c) return;
        setEditing({ id, originalName: c.name || '' });
        setForm(formFrom(c, CHARACTER_FIELDS, SELECTS));
        openModal('characterModal');
    }
    usePageLoader('editCharacter', editCharacter);

    function newCharacter() {
        setEditing({ id: '', originalName: '' });
        setForm(blank());
        openModal('characterModal');
    }

    async function saveCharacter() {
        if (!legacy.state.currentProject) return;
        const data = formBody(form, NUMBER_FIELDS);
        if (!data.name) return;

        // FILM-122: a rename asks whether the screenplay's cues follow.
        if (editing.id && editing.originalName && data.name !== editing.originalName) {
            data.propagate_to_screenplay = window.confirm(`Rename "${editing.originalName}" to "${data.name}" in the screenplay too?\n\n`
                + 'This will update all character cues in the screenplay.');
        }
        try {
            const response = editing.id
                ? await legacy.api('/characters/' + editing.id, { method: 'PUT', body: JSON.stringify(data) })
                : await legacy.api('/projects/' + legacy.state.currentProject.id + '/characters', { method: 'POST', body: JSON.stringify(data) });
            if (response.screenplay_update && response.screenplay_update.updated) {
                legacy.setStatus(`Character saved. Updated ${response.screenplay_update.occurrences} occurrence(s) in screenplay.`);
            } else {
                legacy.setStatus('Character saved');
            }
            closeModal('characterModal');
            setForm(blank());
            setEditing({ id: '', originalName: '' });
            loadCharacters();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function deleteCharacter(id) {
        if (!window.confirm('Delete this character?')) return;
        try {
            await legacy.api('/characters/' + id, { method: 'DELETE' });
            loadCharacters();
            legacy.setStatus('Character deleted');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    // Search and sort what was read (no second request); the sort is remembered for this page.
    const list = useListControls(SURFACE, characters);
    const field = (k) => ({ 'data-field': k, value: form[k], onChange: (e) => { const v = e.target.value; setForm(f => ({ ...f, [k]: v })); } });
    const pair = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

    return (
        <div className="page" id="page-characters">
            <div className="flex-between mb-16">
                <h2>Characters</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => describeFromScreenplay(loadCharacters)} title={DESCRIBE_TITLE}>Describe from screenplay</button>
                    <button className="btn btn-primary" onClick={newCharacter}>+ Character</button>
                </div>
            </div>
            <ListControlsBar list={list} />
            <div className="entity-grid" id="characterGrid">
                {characters && characters.length > 0 && list.shown.length === 0 && <ListNoMatch list={list} />}
                {characters && characters.length === 0 && (
                    <div className="empty-state" style={{ gridColumn: '1/-1' }}><div className="icon">&#128100;</div><h3>No characters</h3><p>Add characters for your film production.</p></div>
                )}
                {(list.shown || []).map(c => <CharacterCard key={c.id} c={c} onEdit={editCharacter} onDelete={deleteCharacter} />)}
            </div>

            <Modal id="characterModal" title={editing.id ? 'Edit Character' : 'New Character'}>
                <div className="form-group"><label>Name</label><input type="text" {...field('name')} placeholder="Character name" /></div>
                <div className="form-group"><label>Description</label><textarea {...field('description')} rows={2} placeholder="Brief description..." /></div>
                <div className="form-group"><label>Appearance Prompt</label><textarea {...field('appearance_prompt')} rows={2} placeholder="Visual appearance for AI generation..." /></div>
                <div className="form-group">
                    <label>Height &mdash; metres</label>
                    <input type="number" step="0.01" min="0" {...field('height_m')} placeholder="1.7" />
                    <p className="text-sm text-muted" style={{ marginTop: 6, lineHeight: 1.5 }}>
                        Nothing else tells the model how big this character is, and it is what everything
                        else in frame is measured against.
                    </p>
                </div>
                <div style={pair}>
                    <div className="form-group"><label>Age Range</label><input type="text" {...field('age_range')} placeholder="20s, 30-40" /></div>
                    {/* A picker, not a text box: free text gave "F", "woman" and "female" for one thing. */}
                    <div className="form-group"><label>Gender</label>
                        <select {...field('gender')}>{GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                </div>
                {/* Stored and accepted by PUT /characters/:id: the character bible, not read by any prompt builder. */}
                <div style={pair}>
                    <div className="form-group"><label>Ethnicity</label><input type="text" {...field('ethnicity')} placeholder="As you would describe it in the bible" /></div>
                    <div className="form-group"><label>Build</label><input type="text" {...field('build')} placeholder="Slight, heavy-set, athletic" /></div>
                </div>
                <div style={pair}>
                    <div className="form-group"><label>Hair</label><input type="text" {...field('hair')} placeholder="Dark, cropped short" /></div>
                    <div className="form-group"><label>Distinguishing</label><input type="text" {...field('distinguishing')} placeholder="Scar through the left eyebrow" /></div>
                </div>
                <p className="text-sm text-muted" style={{ margin: '-4px 0 12px', lineHeight: 1.5 }}>
                    These four are notes for you and are <strong>not</strong> sent to an image model &mdash;
                    Appearance Prompt is the field that conditions every frame this character appears in.
                </p>
                <div className="form-group"><label>Personality Notes</label><textarea {...field('personality_notes')} rows={2} placeholder="Personality traits..." /></div>
                <div style={pair}>
                    <div className="form-group"><label>LoRA ID</label><input type="text" {...field('lora_id')} placeholder="Optional LoRA model" /></div>
                    <div className="form-group"><label>TI Token</label><input type="text" {...field('ti_token')} placeholder="Textual inversion token" /></div>
                </div>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={saveCharacter}>Save</button>
                    <button className="btn btn-secondary" onClick={() => closeModal('characterModal')}>Cancel</button>
                </div>
            </Modal>
        </div>
    );
}
