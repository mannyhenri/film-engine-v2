import { useEffect, useRef, useState } from 'react';
import Modal, { openModal, closeModal } from '../Modal.jsx';
import { legacy } from '../../lib/legacy.js';
import './update-storyboard.css';

/*
 * UPDATE STORYBOARD: the Screenplay page's one button for "I changed the screenplay; put it on the board".
 *
 * 1. Plan (free). The editor is saved first, so the plan reads what is on the page, then
 *    GET /projects/:id/storyboard-update answers which cards would change and how: every rewritten, added and
 *    cut line, who and what is in each frame, the location. Nothing is written by the plan.
 * 2. Confirm. POST /projects/:id/storyboard-update with the plan's id writes exactly that plan. If the screenplay or
 *    a card moved in between, the server refuses (409) and answers the new plan, which is shown for review instead.
 *
 * Nothing is generated and nothing is spent: descriptions, camera, direction, duration, the shots and their frames
 * are left as they are (backend/lib/storyboard-update.js). It replaces the Storyboard's Resync and the top bar's
 * Sync, which never carried a rewritten line onto its card.
 */
export const MODAL_ID = 'updateStoryboardModal';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/**
 * Save what the editor holds into the version it is editing, and bring the scene list up to date with it (what
 * Save Script does, without making a new version), so the plan reads the screenplay as it is on the page.
 * `screenplay` is the page's engine: its live editorDirty / currentScriptVersion, performAutoSave and the serializer.
 */
export async function saveForUpdate(screenplay) {
    const p = legacy.state.currentProject;
    const editor = document.getElementById('screenplayEditor');
    const version = screenplay && screenplay.currentScriptVersion;
    if (!p || !editor || !screenplay) return { saved: false };
    if (!version) {
        // Never saved: the autosave makes the first version (Save Script's POST, which brings the scenes with it).
        if (!screenplay.editorDirty) return { saved: false };
        await screenplay.performAutoSave();
        if (screenplay.editorDirty) throw new Error('the screenplay could not be saved, so the board was not compared with it');
        return { saved: true };
    }
    const list = await legacy.api(`/projects/${p.id}/scripts`);
    const latest = Math.max(0, ...((list && list.scripts) || []).map(s => Number(s.version) || 0));
    // An older version open in the editor is not what the board follows: never write into it from here.
    if (latest && Number(version) !== latest) return { saved: false, viewing: Number(version), latest };
    if (screenplay.editorDirty) await screenplay.performAutoSave();
    if (screenplay.editorDirty) throw new Error('the screenplay could not be saved, so the board was not compared with it');
    const fountain = screenplay.serializeEditorToFountain(editor);
    if (!String(fountain || '').trim()) return { saved: false };
    // refresh: false, as the autosave does: reloading the page would rebuild the editor under the caret.
    await legacy.api(`/projects/${p.id}/script/${version}`, {
        method: 'PUT', body: JSON.stringify({ fountain_content: fountain, sync_scenes: true }), refresh: false,
    });
    return { saved: true, version: Number(version) };
}

function Quote({ children }) {
    return <span className="usb-quote">“{children}”</span>;
}

/** One change on one card, in words. */
export function Change({ c }) {
    switch (c.kind) {
        case 'line_changed':
            return (
                <li className="usb-change usb-changed">
                    <span className="usb-mark">~</span>
                    <span><strong>{c.character}</strong>{c.from_character && c.from_character !== c.character ? <> (was {c.from_character})</> : null}: {' '}
                        <del><Quote>{c.from}</Quote></del> {c.similar === false ? 'replaced by' : '→'} <ins><Quote>{c.to}</Quote></ins></span>
                </li>
            );
        case 'line_added':
            return (
                <li className="usb-change usb-added">
                    <span className="usb-mark">+</span>
                    <span><strong>{c.character}</strong>: <ins><Quote>{c.line}</Quote></ins>
                        <span className="text-muted"> {c.after ? <>after “{c.after}”</> : 'at the start of the card'}</span></span>
                </li>
            );
        case 'line_removed':
            return (
                <li className="usb-change usb-removed">
                    <span className="usb-mark">−</span>
                    <span><strong>{c.character}</strong>: <del><Quote>{c.line}</Quote></del> <span className="text-muted">cut from the screenplay</span></span>
                </li>
            );
        case 'voice_changed':
            return (
                <li className="usb-change usb-changed">
                    <span className="usb-mark">~</span>
                    <span><strong>{c.character}</strong> <Quote>{c.line}</Quote>: {c.from} → {c.to}</span>
                </li>
            );
        case 'characters':
        case 'props':
            return (
                <li className="usb-change usb-changed">
                    <span className="usb-mark">~</span>
                    <span>{c.kind === 'characters' ? 'Characters in frame' : 'Props in frame'}: {(c.from || []).join(', ') || 'none'} → {(c.to || []).join(', ') || 'none'}</span>
                </li>
            );
        case 'location':
            return (
                <li className="usb-change usb-changed">
                    <span className="usb-mark">~</span>
                    <span>Location: {c.from || 'none'} → {c.to}</span>
                </li>
            );
        default:
            return <li className="usb-change"><span className="usb-mark">~</span><span>{String(c.kind).replace(/_/g, ' ')}</span></li>;
    }
}

/** Lines of the screenplay no card carries, where no card beside them has dialogue to place them by. */
function Unplaced({ lines, where }) {
    return (
        <details className="usb-unplaced">
            <summary className="text-sm">{plural(lines.length, 'line')}{where} {lines.length === 1 ? 'is' : 'are'} on no card, and no card there carries dialogue to place {lines.length === 1 ? 'it' : 'them'} beside. Left as {lines.length === 1 ? 'it is' : 'they are'}.</summary>
            <ul>{lines.map((l, i) => <li key={i} className="text-sm"><strong>{l.character}</strong>: <Quote>{l.line}</Quote>{l.scene ? <span className="text-muted"> (scene {l.scene})</span> : null}</li>)}</ul>
        </details>
    );
}

export function PlanView({ plan, applied }) {
    // A scene is shown when the update touches it or its screenplay changed; the rest only add unplaced lines.
    const scenes = (plan.scenes || []).filter(sc => sc.shots.length || sc.screenplay_changed);
    const quiet = (plan.scenes || []).filter(sc => !sc.shots.length && !sc.screenplay_changed)
        .flatMap(sc => sc.unplaced_lines.map(l => ({ ...l, scene: sc.scene_number })));
    const nothing = !plan.cards_to_update && !plan.cards_marked_current;
    return (
        <div className="usb-plan">
            {nothing && <p className="text-sm" data-usb="in-step">The storyboard already matches the screenplay. There is nothing to update.</p>}
            {!nothing && !applied && (
                <p className="usb-summary" data-usb="summary">
                    {plan.cards_to_update
                        ? <><strong>{plural(plan.cards_to_update, 'card')}</strong> will be updated{plan.dialogue_changes ? <> ({plural(plan.dialogue_changes, 'dialogue change')})</> : null}.</>
                        : <>No card needs new content.</>}
                    {' '}Free: nothing is generated and nothing is spent. Nothing is written until you confirm.
                </p>
            )}
            {applied && (
                <p className="usb-summary usb-done" data-usb="done">
                    {plan.cards_to_update ? <>Updated <strong>{plural(plan.cards_to_update, 'card')}</strong>.</> : <>The cards are recorded as matching the screenplay.</>}
                    {' '}Frames were not regenerated: regenerate the ones that matter from the Storyboard.
                </p>
            )}
            {scenes.map(sc => (
                <section className="usb-scene" key={sc.scene_id}>
                    <h4>Scene {sc.scene_number}{sc.heading ? <span className="text-muted"> · {sc.heading}</span> : null}</h4>
                    {sc.shots.map(sh => (
                        <div className="usb-shot" key={sh.shot_id} data-shot={sh.shot_code}>
                            <div className="usb-shot-head">
                                <strong>Shot {sh.shot_code}</strong>
                                <span className="text-muted">{applied ? 'updated' : 'will be updated'}: {plural(sh.changes.length, 'change')}</span>
                            </div>
                            <ul>{sh.changes.map((c, i) => <Change key={i} c={c} />)}</ul>
                        </div>
                    ))}
                    {sc.unchanged.length > 0 && (
                        <p className="text-sm text-muted usb-unchanged">
                            Unchanged: {sc.unchanged.map(code => `Shot ${code}`).join(', ')}
                            {sc.screenplay_changed ? (applied ? ' (recorded as matching the new draft)' : ' (will be recorded as matching the new draft)') : ''}.
                        </p>
                    )}
                    {sc.unplaced_lines.length > 0 && <Unplaced lines={sc.unplaced_lines} where=" of this scene" />}
                </section>
            ))}
            {quiet.length > 0 && <Unplaced lines={quiet} where={` in scene${new Set(quiet.map(l => l.scene)).size === 1 ? '' : 's'} ${[...new Set(quiet.map(l => l.scene))].join(', ')}`} />}
            {(plan.notes || []).map((n, i) => <p key={i} className="text-sm usb-note">{n.why}</p>)}
            {!nothing && (
                <p className="text-sm text-muted usb-kept">
                    Never changed here: descriptions, camera, direction, duration, notes, the shots themselves and their frames.
                    If you changed the action, re-read the descriptions of these cards.
                </p>
            )}
        </div>
    );
}

/**
 * The button and its dialog. `screenplay` is the Screenplay page's engine, for saving the editor before the plan.
 */
export default function UpdateStoryboard({ screenplay }) {
    const [view, setView] = useState(null);   // { stage } | { error } | { plan, changed? } | { plan, applied: true }
    const [busy, setBusy] = useState(false);
    const [behind, setBehind] = useState(0);  // shots the screenplay moved on without (free report)
    const alive = useRef(true);
    useEffect(() => () => { alive.current = false; }, []);

    // The dot on the button: a free, local read, made when the Screenplay comes into view and every 10 s while it
    // stays there. Every page's frame is mounted at boot, so nothing is read while another page is in view.
    useEffect(() => {
        let live = true, shownFor = null, lastRead = 0;
        const check = async () => {
            const p = legacy.state.currentProject;
            const here = !!p && legacy.state.currentPage === 'screenplay' && document.visibilityState !== 'hidden';
            const arrived = here && shownFor !== p.id;
            shownFor = here ? p.id : null;
            if (!p) { if (live) setBehind(0); return; }
            if (!here || (!arrived && Date.now() - lastRead < 10000)) return;
            lastRead = Date.now();
            try {
                const d = await legacy.api(`/projects/${p.id}/screenplay-drift`);
                const current = legacy.state.currentProject;
                if (live && current && current.id === p.id) setBehind(Number(d.shots_behind) || 0);
            } catch { /* the button still works; the dot just waits */ }
        };
        check();
        const t = setInterval(check, 1000);
        return () => { live = false; clearInterval(t); };
    }, []);

    const project = () => legacy.state.currentProject;

    async function open() {
        const p = project();
        if (!p) { legacy.setStatus('Open a project first'); return; }
        openModal(MODAL_ID);
        setView({ stage: 'Saving the screenplay…' });
        let saved;
        try { saved = await saveForUpdate(screenplay); }
        catch (err) { if (alive.current) setView({ error: 'Could not save the screenplay: ' + err.message }); return; }
        if (!alive.current) return;
        setView({ stage: 'Working out which cards change (free)…', saved });
        try {
            const plan = await legacy.api(`/projects/${p.id}/storyboard-update`);
            if (!alive.current || project()?.id !== p.id) return;
            setView({ plan, saved });
        } catch (err) { if (alive.current) setView({ error: 'Could not plan the update: ' + err.message }); }
    }

    async function confirm() {
        const p = project();
        if (!p || !view || !view.plan) return;
        setBusy(true);
        try {
            const r = await legacy.api(`/projects/${p.id}/storyboard-update`, {
                method: 'POST', body: JSON.stringify({ plan_id: view.plan.plan_id }), refresh: false,
            });
            if (!alive.current) return;
            setView({ plan: r, applied: true });
            setBehind(0);
            legacy.setStatus(r.cards_to_update ? `Storyboard updated: ${plural(r.cards_to_update, 'card')}.` : 'Storyboard cards recorded as matching the screenplay.');
        } catch (err) {
            if (!alive.current) return;
            // Moved since it was reviewed: show what would happen now, and ask again.
            if (err.status === 409 && err.data && err.data.plan) setView({ plan: err.data.plan, changed: true });
            else setView({ ...view, failed: 'The update failed: ' + err.message });
        } finally { if (alive.current) setBusy(false); }
    }

    function openBoard() {
        closeModal(MODAL_ID);
        legacy.navigateTo('storyboard');
    }

    const plan = view && view.plan;
    const canApply = plan && !view.applied && (plan.cards_to_update > 0 || plan.cards_marked_current > 0);
    const applyLabel = plan && (plan.cards_to_update > 0
        ? `Update ${plural(plan.cards_to_update, 'card')}`
        : `Mark ${plural(plan.cards_marked_current, 'card')} as current`);

    return (
        <>
            <button className="btn btn-secondary usb-button" id="updateStoryboardBtn" onClick={open}
                title={behind
                    ? `The screenplay changed after ${plural(behind, 'storyboard card')} ${behind === 1 ? 'was' : 'were'} written. See which cards an update would change (free), then confirm.`
                    : 'Put the latest screenplay changes on the storyboard cards. Shows which cards change first (free); nothing is written until you confirm.'}>
                Update storyboard{behind ? <span className="usb-dot" aria-label="the screenplay changed since the board was updated" /> : null}
            </button>
            <Modal id={MODAL_ID} title="Update storyboard from the screenplay" wide footer={<>
                {view && view.applied
                    ? <>
                        <button className="btn btn-secondary" onClick={() => closeModal(MODAL_ID)}>Close</button>
                        <button className="btn btn-primary" onClick={openBoard}>Open Storyboard</button>
                    </>
                    : <>
                        <button className="btn btn-secondary" onClick={() => closeModal(MODAL_ID)}>{canApply ? 'Cancel' : 'Close'}</button>
                        {canApply && <button className="btn btn-primary" id="confirmStoryboardUpdate" disabled={busy} onClick={confirm}>{busy ? 'Updating…' : applyLabel}</button>}
                    </>}
            </>}>
                {view && view.stage && <p className="text-sm text-muted" data-usb="working">{view.stage}</p>}
                {view && view.error && <p className="text-sm usb-error" data-usb="error">{view.error}</p>}
                {view && view.saved && view.saved.viewing && (
                    <p className="text-sm usb-note">You are viewing v{view.saved.viewing}. The storyboard follows the latest version, v{view.saved.latest}, so this plan is made from v{view.saved.latest}.</p>
                )}
                {view && view.changed && (
                    <p className="text-sm usb-note" data-usb="changed">The screenplay or the cards changed since the plan you saw. Nothing was written. This is the plan now.</p>
                )}
                {view && view.failed && <p className="text-sm usb-error">{view.failed}</p>}
                {plan && <PlanView plan={plan} applied={!!view.applied} />}
            </Modal>
        </>
    );
}
