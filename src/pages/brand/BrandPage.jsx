import { useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * Brand kits, as React. Replaces the legacy functions listed in react.json:
 * the same routes, the same markup (ids and classes), the same status lines.
 *
 * The form is built FROM the served field registry (GET /brands returns the
 * fields), so a field added to the kit gets a control without a second edit,
 * and each field says what it reaches.
 */
const REACH_NOTE = {
    prompt: 'Reaches the generation prompt.',
    compliance: 'Checked before anything generates.',
    handoff: 'Travels into the Premiere package for the editor.',
    person: 'Production paperwork — read by a person, never sent anywhere.',
};
const JSON_FIELDS = ['palette', 'fonts', 'banned_phrases'];
const LONG_FIELDS = ['notes', 'legal_line', 'tone'];
const FALLBACK_FIELDS = [{ id: 'name', label: 'Name', reaches: 'handoff', why: '' }];

const parseList = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };

/** A stored kit -> the text each control shows. */
function toForm(brand, fields) {
    const form = {};
    for (const f of fields) {
        const val = brand[f.id] || '';
        if (!JSON_FIELDS.includes(f.id)) { form[f.id] = val; continue; }
        const list = parseList(val);
        form[f.id] = f.id === 'fonts'
            ? list.map(x => `${x.role || ''}|${x.family || ''}|${x.weight || ''}`).join('\n')
            : list.join('\n');
    }
    return form;
}

/** The controls' text -> the request body, as the legacy saveBrand built it. */
function toBody(form, fields) {
    const body = {};
    for (const f of fields) {
        if (!(f.id in form)) continue;
        const raw = form[f.id];
        if (!JSON_FIELDS.includes(f.id)) { body[f.id] = raw; continue; }
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        body[f.id] = JSON.stringify(f.id === 'fonts'
            ? lines.map(l => { const [role, family, weight] = l.split('|').map(x => (x || '').trim()); return { role, family, weight }; })
            : lines);
    }
    return body;
}

export default function BrandPage() {
    // null: not loaded; { error }: the read failed; otherwise the served fields and kits.
    const [data, setData] = useState(null);
    const [editing, setEditing] = useState(null); // { id: string|null, form }
    const fields = data?.fields?.length ? data.fields : FALLBACK_FIELDS;

    async function loadBrands() {
        let res;
        try { res = await legacy.api('/brands'); }
        catch (err) { setData({ error: err.message }); return; }
        legacy.state.brandRows = res.brands || [];
        setData({ fields: res.fields || [], brands: res.brands || [] });
    }
    usePageLoader('loadBrands', loadBrands);

    function openBrand(id) {
        const brand = id ? (data?.brands || []).find(x => x.id === id) || {} : {};
        setEditing({ id: id || null, form: toForm(brand, fields) });
        openModal('brandModal');
    }

    async function saveBrand() {
        const { id, form } = editing;
        // As the legacy code: only the SERVED fields go in the body.
        const body = toBody(form, data?.fields || []);
        if (!String(body.name || '').trim()) return legacy.setStatus('A brand kit needs a name');
        try {
            await legacy.api(id ? `/brands/${id}` : '/brands', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
            closeModal('brandModal');
            legacy.setStatus(id ? 'Brand updated' : 'Brand added');
            loadBrands();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function deleteBrand(id) {
        if (!window.confirm('Delete this brand kit?\n\nIt is shared across every project that uses it — '
            + 'projects pointing at it keep their pointer and simply lose the kit.')) return;
        try {
            const out = await legacy.api(`/brands/${id}`, { method: 'DELETE' });
            legacy.setStatus(out.projects_referencing
                ? `Brand deleted — ${out.projects_referencing} project(s) referenced it`
                : 'Brand deleted');
            loadBrands();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    const setField = (fid, value) => setEditing(e => ({ ...e, form: { ...e.form, [fid]: value } }));

    function field(f) {
        const value = editing?.form[f.id] ?? '';
        const note = <span className="text-sm text-muted">{REACH_NOTE[f.reaches] || ''} {f.why || ''}</span>;
        const common = { id: `brand_${f.id}`, 'data-field': f.id, value, onChange: e => setField(f.id, e.target.value) };
        let control;
        if (JSON_FIELDS.includes(f.id)) control = <textarea {...common} rows="3" placeholder={f.id === 'fonts' ? 'role|family|weight, one per line' : 'one per line'} />;
        else if (LONG_FIELDS.includes(f.id)) control = <textarea {...common} rows="2" maxLength={4000} />;
        else control = <input type="text" {...common} maxLength={1000} />;
        return <div className="form-group" key={f.id}><label>{f.label}</label>{control}{note}</div>;
    }

    return (
        <div className="page" id="page-brand">
            <div className="flex-between mb-16">
                <h2>Brand</h2>
                <button className="btn btn-primary" onClick={() => openBrand()}>+ Brand</button>
            </div>
            <p className="text-sm text-muted mb-8">
                A brand kit <strong>outlives a project</strong>, like the style book: one client buys
                many spots, and a kit that dies with the job is one you re-upload every time they come
                back. Each field says what it reaches &mdash; a prompt, a compliance check, the
                Premiere handoff, or a person &mdash; because a field that looks like it conditions
                the frame and does not is worse than one that is absent.
            </p>
            <div id="brandList">
                {data?.error && <p className="text-sm text-muted">Could not read the brands: {data.error}</p>}
                {data?.brands && !data.brands.length && (
                    <p className="text-sm text-muted">No brand kits yet. One kit per client, reused across every spot you make for them.</p>
                )}
                {data?.brands?.map(b => {
                    const palette = parseList(b.palette).filter(c => /^#[0-9a-f]{6}$/i.test(c));
                    return (
                        <div className="card" style={{ marginBottom: 8 }} key={b.id}>
                            <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                                <div style={{ minWidth: 0 }}>
                                    <strong>{b.name || 'Untitled brand'}</strong>
                                    {b.tone && <div className="text-sm text-muted">{b.tone}</div>}
                                    <div className="tag-row" style={{ marginTop: 6, alignItems: 'center' }}>
                                        {palette.map((c, i) => (
                                            <span key={i} title={c} style={{ display: 'inline-block', width: 18, height: 18, borderRadius: 3, background: c, border: '1px solid rgba(255,255,255,0.2)' }} />
                                        ))}
                                        {b.cta && <span className="tag">{b.cta}</span>}
                                        {b.legal_line && <span className="tag">legal line</span>}
                                    </div>
                                </div>
                                <div className="card-actions">
                                    <button className="btn btn-secondary btn-sm" onClick={() => openBrand(b.id)}>Edit</button>
                                    <button className="btn btn-secondary btn-sm" onClick={() => deleteBrand(b.id)}>Delete</button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <Modal id="brandModal" title={editing?.id ? 'Edit brand' : 'New brand'} footer={<>
                <button className="btn btn-secondary" onClick={() => closeModal('brandModal')}>Cancel</button>
                <button className="btn btn-primary" onClick={saveBrand}>Save</button>
            </>}>
                <p className="text-sm text-muted" style={{ marginTop: 0 }}>
                    Only the tone and the palette reach a generation. The CTA, the legal line and the
                    fonts are words and type that go on screen in Premiere &mdash; asking a diffusion
                    model to render legible text bakes a smudge into a frame you paid for.</p>
                {/* Always rendered (empty until Edit / + Brand), so the static render the backend UI tests read has every field. */}
                {fields.map(field)}
            </Modal>
        </div>
    );
}
