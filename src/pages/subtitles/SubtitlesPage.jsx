import { useRef, useState } from 'react';
import Modal, { openModal, closeModal } from '../../components/Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * Subtitles, as React. One row per cue, in time order; a cue carries its language, speaker, position,
 * style, its shot, and whether it is a closed caption. Times are typed in seconds and stored in
 * milliseconds. Same routes, bodies and status lines as the legacy page.
 */
const POSITIONS = ['bottom', 'top', 'middle'];
export const subTime = (ms) => {
    const t = Math.max(0, Number(ms) || 0) / 1000;
    return `${Math.floor(t / 60)}:${String((t % 60).toFixed(1)).padStart(4, '0')}`;
};
const cueToForm = (r, lang) => ({
    text: r.text || '',
    start: ((r.start_ms || 0) / 1000).toFixed(2),
    end: ((r.end_ms || 0) / 1000).toFixed(2),
    language: r.language || lang,
    speaker: r.speaker || '',
    position: r.position || 'bottom',
    shot_id: r.shot_id || '',
    style: r.style || '',
    is_cc: !!r.is_cc,
});

export default function SubtitlesPage() {
    const [langs, setLangs] = useState([]);
    const [lang, setLang] = useState('');
    const [rows, setRows] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [shots, setShots] = useState([]);
    const shotsLoaded = useRef(false);
    // Always a form, so its fields are on the page (and in the static render the UI tests read).
    const [editing, setEditing] = useState({ id: null, form: cueToForm({}, 'en') });

    async function loadSubtitles(chosenLang) {
        if (!legacy.state.currentProject) return;
        const pid = legacy.state.currentProject.id;
        try {
            const l = await legacy.api(`/projects/${pid}/languages`).catch(() => null)
                || await legacy.api(`/projects/${pid}/subtitles/languages`);
            const list = l.languages || [];
            const chosen = chosenLang || lang || list[0] || 'en';
            // The languages the project has, plus the one being viewed.
            setLangs([...new Set([...list, chosen])]);
            setLang(chosen);
            const data = await legacy.api(`/projects/${pid}/subtitles?language=${encodeURIComponent(chosen)}`);
            legacy.state.subtitleRows = data.subtitles || [];
            // The shot list, once: a caption belongs to the shot it plays over.
            if (!shotsLoaded.current) {
                shotsLoaded.current = true;
                try { setShots((await legacy.api(`/projects/${pid}/shotlist`)).shots || []); } catch (_) { setShots([]); }
            }
            setRows(legacy.state.subtitleRows);
            setLoadError('');
        } catch (err) { setLoadError(err.message); }
    }
    usePageLoader('loadSubtitles', () => loadSubtitles());

    function openSubtitle(r) {
        setEditing({ id: r ? r.id : null, form: cueToForm(r || {}, lang || 'en') });
        openModal('subtitleModal');
    }
    const set = (k, attr = 'value') => (e) => { const val = e.target[attr]; setEditing(ed => ({ ...ed, form: { ...ed.form, [k]: val } })); };

    async function saveSubtitle() {
        const { id, form } = editing;
        const body = {
            text: form.text,
            start_ms: Math.round((Number(form.start) || 0) * 1000),
            end_ms: Math.round((Number(form.end) || 0) * 1000),
            language: form.language || 'en',
            speaker: form.speaker,
            position: form.position,
            style: form.style,
            shot_id: form.shot_id || null,
            is_cc: !!form.is_cc,
        };
        if (!body.text) return legacy.setStatus('A cue needs its text');
        // A zero-length cue is invisible in playback and looks like the save failed.
        if (body.end_ms <= body.start_ms) return legacy.setStatus('A cue has to end after it starts');
        try {
            await legacy.api(id ? `/subtitles/${id}` : `/projects/${legacy.state.currentProject.id}/subtitles`,
                { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
            closeModal('subtitleModal');
            legacy.setStatus(id ? 'Cue updated' : 'Cue added');
            loadSubtitles();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    async function deleteSubtitle(id) {
        if (!window.confirm('Remove this cue?')) return;
        try { await legacy.api(`/subtitles/${id}`, { method: 'DELETE' }); loadSubtitles(); legacy.setStatus('Cue removed'); }
        catch (err) { legacy.setStatus('Error: ' + err.message); }
    }

    function exportSubtitles(fmt) {
        // Opened, not fetched: the route answers with a file, and a download is what a person wants.
        window.open(`${legacy.API_BASE}/film/projects/${legacy.state.currentProject.id}/subtitles/export/${fmt}`
            + `?language=${encodeURIComponent(lang || 'en')}`, '_blank');
    }

    const f = editing.form;
    // Search, sort and filter the cues as read (never re-read); duration and kind are derived for the sorts and filters.
    const controls = useListControls(SURFACE, rows && rows.map(r => ({ ...r, duration_ms: (r.end_ms || 0) - (r.start_ms || 0), kind: r.is_cc ? 'closed caption' : 'subtitle' })));
    const shown = controls.shown || [];
    return (
        <div className="page" id="page-subtitles">
            <div className="flex-between mb-16">
                <h2>Subtitles</h2>
                <div>
                    <select id="subtitleLang" value={lang} onChange={e => loadSubtitles(e.target.value)} style={{ width: 'auto', display: 'inline-block', minWidth: 140, marginRight: 8 }}>
                        {langs.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <button className="btn btn-secondary" onClick={() => exportSubtitles('srt')}>Export SRT</button>
                    <button className="btn btn-secondary" onClick={() => exportSubtitles('vtt')}>Export VTT</button>
                    <button className="btn btn-primary" onClick={() => openSubtitle(null)}>+ Cue</button>
                </div>
            </div>
            <p className="text-sm text-muted mb-8">
                One row per cue, in time order. A cue carries its language, who is speaking, where on
                screen it sits and how it is styled &mdash; all of which the route has always accepted
                and none of which could be typed. Times are in seconds here and stored in
                milliseconds.
            </p>
            {!loadError && rows && rows.length > 0 && <ListControlsBar list={controls} />}
            <div id="subtitleList">
                {!loadError && rows && rows.length > 0 && !shown.length && <ListNoMatch list={controls} />}
                {loadError && <p className="text-sm text-muted">Could not read the subtitles: {loadError}</p>}
                {!loadError && rows && !rows.length && <p className="text-sm text-muted">No cues in this language yet.</p>}
                {!loadError && shown.map(r => (
                    <div key={r.id} className="card" style={{ marginBottom: 6 }} data-cue-id={r.id}>
                        <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                            <div style={{ minWidth: 0 }}>
                                <div className="text-sm text-muted">{subTime(r.start_ms)} &rarr; {subTime(r.end_ms)}</div>
                                <strong>{r.text || ''}</strong>
                                <div className="tag-row" style={{ marginTop: 4 }}>
                                    {r.speaker && <span className="tag">{r.speaker}</span>}
                                    <span className="tag">{r.position || 'bottom'}</span>
                                    {!!r.is_cc && <span className="badge">CC</span>}
                                </div>
                            </div>
                            <div className="card-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => openSubtitle(r)}>Edit</button>
                                <button className="btn btn-secondary btn-sm" onClick={() => deleteSubtitle(r.id)}>Delete</button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <Modal id="subtitleModal" title={editing.id ? 'Edit cue' : 'New cue'} footer={<>
                <button className="btn btn-secondary" onClick={() => closeModal('subtitleModal')}>Cancel</button>
                <button className="btn btn-primary" onClick={saveSubtitle}>Save</button>
            </>}>
                <div className="form-group"><label>Text</label>
                    <textarea id="subText" data-field="text" rows="2" maxLength={1000} value={f.text} onChange={set('text')} /></div>
                <div className="form-group"><label>Start (seconds)</label>
                    <input type="number" id="subStart" data-field="start_ms" min="0" step="0.01" value={f.start} onChange={set('start')} /></div>
                <div className="form-group"><label>End (seconds)</label>
                    <input type="number" id="subEnd" data-field="end_ms" min="0" step="0.01" value={f.end} onChange={set('end')} /></div>
                <div className="form-group"><label>Language</label>
                    <input type="text" id="subLang" data-field="language" maxLength={10} value={f.language} onChange={set('language')} placeholder="e.g. en, fr, pt-BR" /></div>
                <div className="form-group"><label>Speaker</label>
                    <input type="text" id="subSpeaker" data-field="speaker" maxLength={100} value={f.speaker} onChange={set('speaker')} placeholder="Who is talking — shown in closed captions" /></div>
                <div className="form-group"><label>Position</label>
                    <select id="subPosition" data-field="position" value={f.position} onChange={set('position')}>
                        {POSITIONS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <span className="text-sm text-muted">Where on screen it sits. Top is for a cue that would cover a face.</span></div>
                <div className="form-group"><label>Shot</label>
                    <select id="subShot" data-field="shot_id" value={f.shot_id} onChange={set('shot_id')}>
                        <option value="">Not tied to a shot</option>
                        {shots.map(sh => <option key={sh.id} value={sh.id}>{sh.shot_code || sh.id}</option>)}
                    </select>
                    <span className="text-sm text-muted">Optional. Tying a cue to its shot is what lets a
                        re-cut carry the caption with the picture instead of leaving it at a timecode.</span></div>
                <div className="form-group"><label>Style</label>
                    <input type="text" id="subStyle" data-field="style" maxLength={500} value={f.style} onChange={set('style')} /></div>
                <div className="form-group">
                    <label><input type="checkbox" id="subCC" data-field="is_cc" checked={f.is_cc} onChange={set('is_cc', 'checked')} /> Closed caption</label>
                    <span className="text-sm text-muted">A caption describes sound as well as speech; a subtitle carries the words only.</span></div>
            </Modal>
        </div>
    );
}
