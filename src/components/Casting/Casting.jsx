import { useRef, useState } from 'react';
import Modal, { openModal, closeModal } from '../Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * Casting a voice, and hearing a line, as React. A PLANNING surface: dialogue generation shipped reachable
 * only per SHOT, which is after the point where hearing a line would change what you write. Same routes,
 * bodies and status lines as the legacy modal.
 *
 * castCharacterVoice(id, name) is PROVIDED (react.json): the character sheet (core) opens it by name.
 * After a cast, the Characters list reloads (window.loadCharacters, which that React page registers), and
 * "Add gender and age" opens the character form (window.editCharacter, the same page's).
 */
const ageLabel = (age) => age && String(age).replace('_', ' ');
const callPage = (name, ...args) => { if (typeof window[name] === 'function') window[name](...args); };

function VoiceRow({ v, selected, onPick }) {
    const cast = v.voice_id === selected;
    return (
        <div className={'voice-row' + (cast ? ' is-cast' : '')}>
            <span className="vname">{v.name || v.voice_id}</span>
            <span className="vlabels">
                {[v.gender, ageLabel(v.age), v.accent].filter(Boolean).join(' · ') || '—'}
                {v.why && v.why.length ? <span className="gal-badge reference" style={{ marginLeft: 6 }}>matches {v.why.join(' + ')}</span> : null}
                {v.taken_by
                    ? <span className="gal-badge inspiration" style={{ marginLeft: 6 }}
                            title="Two characters in a scene sounding identical is usually a mistake — but doubling is a real choice, so this is flagged, not hidden">already {v.taken_by}</span>
                    : null}
            </span>
            {v.preview_url ? <audio controls preload="none" src={v.preview_url} /> : <span className="text-muted text-sm">no preview</span>}
            <button className={'btn btn-sm' + (cast ? '' : ' btn-primary')} onClick={() => onPick(v.voice_id, v.name || '')}>{cast ? 'Cast' : 'Cast this'}</button>
        </div>
    );
}

export default function Casting() {
    const casting = useRef({ characterId: null, name: '', selected: null });
    const [who, setWho] = useState(casting.current);
    // null: loading; { error } / { empty }: said; else the voice read.
    const [current, setCurrent] = useState(null);
    const [selected, setSelected] = useState(null);
    const [delivery, setDelivery] = useState('');
    const [status, setStatusText] = useState('');
    const [line, setLine] = useState('');
    const [auditions, setAuditions] = useState([]);

    async function castCharacterVoice(characterId, name) {
        casting.current = { characterId, name: name || '', selected: null };
        setWho(casting.current);
        setLine('');
        setStatusText('');
        setAuditions([]);
        openModal('castingModal');
        await loadCastingBody();
    }
    usePageLoader('castCharacterVoice', castCharacterVoice);

    async function loadCastingBody() {
        const at = casting.current;
        setCurrent(null);
        let cur;
        try {
            cur = await legacy.api(`/characters/${at.characterId}/voice`);
        } catch (err) {
            if (casting.current === at) setCurrent({ error: err.message });
            return;
        }
        if (casting.current !== at) return;
        const sg = cur.suggestions;
        if (!sg || !sg.suggested.length) { setCurrent({ empty: true }); return; }
        /*
         * What the sheet does not record is NAMED, with the way in (sg.missing, below). The engine already
         * knows the character's gender and age; a flat list makes the director re-derive that by ear. When a
         * field is missing the list is not narrowed — filtering on a guess is worse — so the reason has to be
         * visible, and the fix is one click.
         */
        at.selected = at.selected || cur.voice_id || null;
        setSelected(at.selected);
        setDelivery(cur.delivery || '');
        setCurrent(cur);
    }

    /*
     * How this character always sounds. A cast voice is WHO they are; a delivery is HOW they speak. Set once
     * here, it is the baseline for every line, and a parenthetical on a specific line overrides it.
     */
    async function setStandingDelivery(value) {
        setDelivery(value);
        const id = casting.current.characterId;
        setStatusText('Saving…');
        try {
            const cur = await legacy.api(`/characters/${id}/voice`);
            if (!cur.voice_id) { setStatusText('Cast a voice first.'); return; }
            await legacy.api(`/characters/${id}/voice`, {
                method: 'PUT',
                body: JSON.stringify({ voice_id: cur.voice_id, voice_name: cur.voice_name, delivery: value || null }),
            });
            setStatusText(value ? `Always ${value}. Their lines will regenerate next time you press Dialogue.` : 'Delivery cleared.');
        } catch (err) { setStatusText(err.message); }
    }

    async function pickVoice(voiceId, voiceName) {
        setStatusText('Casting…');
        try {
            const res = await legacy.api(`/characters/${casting.current.characterId}/voice`, {
                method: 'PUT', body: JSON.stringify({ voice_id: voiceId, voice_name: voiceName }),
            });
            casting.current.selected = voiceId;
            setStatusText(res.changed ? (res.note || 'Cast.') : 'Already cast in this voice.');
            await loadCastingBody();
            callPage('loadCharacters');
        } catch (err) { setStatusText(err.message); }
    }

    /**
     * Hear a line. Attached to nothing. Previewed first and confirmed, like every other paid button — the
     * preview is free, so the gate costs nothing to pass and everything to skip.
     */
    async function auditionVoice() {
        const text = line.trim();
        const at = casting.current;
        if (!text) { setStatusText('Type a line to hear.'); return; }
        setStatusText('Checking…');
        let pv;
        try {
            pv = await legacy.api(`/audition/preview?text=${encodeURIComponent(text)}`
                + (at.selected ? `&voice_id=${encodeURIComponent(at.selected)}` : '')
                + (at.characterId ? `&character_id=${at.characterId}` : ''));
        } catch (err) { setStatusText('Preview failed: ' + err.message); return; }
        if (pv.error) { setStatusText(pv.error); return; }

        if (!window.confirm(`Speak this line?\n\n"${text}"\n\nProvider: ${pv.provider}\n`
            + `Voice: ${pv.voice_id || 'the provider default'}\n`
            + `${pv.warning ? '\n' + pv.warning + '\n' : ''}\n`
            + 'This is an audition: it attaches to no shot.')) { setStatusText(''); return; }

        setStatusText('Generating…');
        try {
            const res = await legacy.api('/audition', {
                method: 'POST',
                body: JSON.stringify({ text, voice_id: at.selected, character_id: at.characterId,
                    project_id: legacy.state.currentProject && legacy.state.currentProject.id }),
            });
            setStatusText('Playing.');
            setAuditions(a => [{ key: Date.now() + ':' + a.length, text, url: legacy.API_BASE + res.audio_url }, ...a]);
        } catch (err) { setStatusText('Audition failed: ' + err.message); }
    }

    const sg = current && current.suggestions;
    return (
        <Modal id="castingModal" title={who.characterId ? `${who.name || 'Character'} — voice` : 'Voice'} wide>
            <div className="gal-bar">
                <input type="text" id="auditionLine" className="input" value={line} onChange={(e) => setLine(e.target.value)}
                       placeholder="A line to hear — leave blank to use one from the screenplay" />
                <button className="btn btn-primary btn-sm" onClick={auditionVoice}>Audition</button>
                <span id="castingStatus" className="text-muted text-sm">{status}</span>
            </div>
            <p className="text-muted text-sm" style={{ margin: '0 0 12px' }}>
                Previews below are hosted by the provider and cost nothing.
                <strong> Audition</strong> speaks your line in the selected voice and does spend.
                Nothing here is attached to a shot.
            </p>
            <div id="castingBody">
                {auditions.map(a => (
                    <div className="voice-row is-cast" key={a.key}>
                        <span className="vname">Audition</span>
                        <span className="vlabels">{a.text}</span>
                        <audio controls autoPlay src={a.url} />
                    </div>
                ))}
                {who.characterId && current === null && <div className="text-muted">Loading voices…</div>}
                {current && current.error !== undefined && (
                    <div className="empty-state"><h3>Could not load the catalogue</h3><p>{current.error}</p></div>
                )}
                {current && current.empty && (
                    <div className="empty-state"><h3>No voices available</h3>
                        <p>The provider returned no catalogue. Check the ElevenLabs credential in Setup.</p></div>
                )}
                {sg && sg.suggested && sg.suggested.length > 0 && (<>
                    {sg.missing.length
                        ? <div className="warning-banner" style={{ marginBottom: 10 }}>
                            {sg.note}
                            <button className="btn btn-sm" style={{ marginLeft: 8 }}
                                    onClick={() => { closeModal('castingModal'); callPage('editCharacter', who.characterId); }}>
                                Add {sg.missing.join(' and ')}
                            </button>
                          </div>
                        : <p className="text-sm text-muted" style={{ margin: '0 0 10px' }}>Ordered for {sg.for || ''} —
                            {' '}{[sg.matched_on.gender, ageLabel(sg.matched_on.age)].filter(Boolean).join(', ')}.</p>}
                    <div className="gal-bar" style={{ marginBottom: 10 }}>
                        <label className="text-sm text-muted">Always sounds</label>
                        <select id="castDelivery" value={delivery} onChange={(e) => setStandingDelivery(e.target.value)}>
                            <option value="">— as written —</option>
                            {(current.deliveries || []).map(d => <option key={d.id} value={d.id}>{d.id} {d.tag}</option>)}
                        </select>
                        <span className="text-muted text-sm">A parenthetical on a line still wins over this.</span>
                    </div>
                    <p className="text-sm" style={{ margin: '0 0 10px' }}>
                        {current.cast
                            ? <>Currently cast: <strong>{current.voice_name || current.voice_id}</strong></>
                            : <span className="text-muted">{current.warning || 'Not cast.'}</span>}
                    </p>
                    {sg.suggested.map(v => <VoiceRow key={v.voice_id} v={v} selected={selected} onPick={pickVoice} />)}
                </>)}
            </div>
        </Modal>
    );
}
