import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal, { openModal, closeModal } from '../Modal.jsx';
import { legacy } from '../../lib/legacy.js';

/*
 * SYNC SCREENPLAY: one button, in the top bar, for "I changed the screenplay; bring the board and
 * production up to date".
 *
 * It uses what the backend already has: GET /projects/:id/screenplay-drift (which scenes moved on
 * without their shots) and POST /projects/:id/shots-resync (dry run first; apply:true writes). The
 * resync refreshes what follows mechanically from the screenplay (who and what is in a shot, its
 * dialogue) and keeps the director's work (camera, direction, duration, the shot itself).
 *
 * It never rewrites a description: that is a judgement, and this app runs no AI on its server. The
 * shots whose descriptions no longer match are listed, with a Copy button, so they can be handed to
 * Claude Desktop, which edits them through the app's MCP tools.
 */
const LABEL = {
    description_may_be_stale: 'Description may no longer match the scene',
    dialogue_changed_or_gone: 'Dialogue on the card changed or was cut',
    unresolved_subject: 'Names someone or something the project does not have',
    no_shot_covers_this: 'A line no shot covers yet',
};

/** The plain summary the Copy button puts on the clipboard. */
export function staleSummary(project, plan) {
    const shots = plan.flatMap(sc => sc.needs_a_person.filter(n => n.kind === 'description_may_be_stale')
        .map(n => `Scene ${sc.scene_number} (${sc.heading}): shot ${n.shot_code}`));
    return [`Film Engine project "${project.title}" (${project.id}).`,
        'The screenplay changed; these shot descriptions may no longer match their scene:',
        ...shots.map(s => '- ' + s)].join('\n');
}

/** Wait for an element the legacy shell builds at run time. */
function useShellElement(selector) {
    const [el, setEl] = useState(() => document.querySelector(selector));
    useEffect(() => {
        if (el) return undefined;
        const obs = new MutationObserver(() => { const found = document.querySelector(selector); if (found) { setEl(found); obs.disconnect(); } });
        obs.observe(document.body, { childList: true, subtree: true });
        return () => obs.disconnect();
    }, [el, selector]);
    return el;
}

export default function SyncScreenplay() {
    const rail = useShellElement('.fe-top .fe-rail');
    const [slot, setSlot] = useState(null);
    const [behind, setBehind] = useState(0);        // scenes the screenplay moved on without
    const [view, setView] = useState(null);         // { loading } | { error } | { plan, drift, applied? }
    const [busy, setBusy] = useState(false);

    // Our own slot, first in the rail, so the shell's buttons are untouched.
    useEffect(() => {
        if (!rail) return undefined;
        const span = document.createElement('span');
        span.style.display = 'contents';
        rail.insertBefore(span, rail.firstChild);
        setSlot(span);
        return () => span.remove();
    }, [rail]);

    // The count on the button: a free, local read, refreshed while a film is open. Started once the
    // shell's rail exists: the shell is built after the core script, so state and api are defined by then.
    useEffect(() => {
        if (!rail) return undefined;
        let alive = true;
        const check = async () => {
            try {
                const p = legacy.state.currentProject;
                if (!p) { if (alive) setBehind(0); return; }
                const d = await legacy.api(`/projects/${p.id}/screenplay-drift`, { refresh: false });
                if (alive) setBehind((d.scenes || []).length);
            } catch { /* the button still works; the count just waits */ }
        };
        check();
        const t = setInterval(check, 20000);
        return () => { alive = false; clearInterval(t); };
    }, [rail]);

    async function open() {
        const p = legacy.state.currentProject;
        if (!p) { legacy.setStatus('Open a project first'); return; }
        openModal('syncScreenplayModal');
        setView({ loading: true });
        try {
            const [drift, plan] = await Promise.all([
                legacy.api(`/projects/${p.id}/screenplay-drift`, { refresh: false }),
                legacy.api(`/projects/${p.id}/shots-resync`, { method: 'POST', body: JSON.stringify({ apply: false }), refresh: false }),
            ]);
            setBehind((drift.scenes || []).length);
            setView({ drift, plan });
        } catch (err) { setView({ error: err.message }); }
    }

    async function apply() {
        const p = legacy.state.currentProject;
        setBusy(true);
        try {
            const r = await legacy.api(`/projects/${p.id}/shots-resync`, { method: 'POST', body: JSON.stringify({ apply: true }) });
            legacy.setStatus(`${r.cards_changed} card(s) reconciled. ${r.needs_a_person} item(s) still need you.`);
            const drift = await legacy.api(`/projects/${p.id}/screenplay-drift`, { refresh: false });
            setBehind((drift.scenes || []).length);
            setView({ drift, plan: r, applied: true });
        } catch (err) { legacy.setStatus('Sync failed: ' + err.message); }
        finally { setBusy(false); }
    }

    function copyStale() {
        const text = staleSummary(legacy.state.currentProject, view.plan.plan || []);
        Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(text))
            .then(() => legacy.setStatus('Copied — paste it to Claude to update those descriptions'))
            .catch(() => legacy.setStatus('Could not copy'));
    }

    const plan = view?.plan;
    const items = (plan?.plan || []).flatMap(sc => sc.needs_a_person.map(n => ({ ...n, scene: sc.scene_number })));
    const stale = items.filter(n => n.kind === 'description_may_be_stale');
    const changes = (plan?.plan || []).flatMap(sc => sc.shots.filter(s => s.updates && s.updates.length).map(s => ({ ...s, scene: sc.scene_number })));

    const button = (
        <button className="fe-rail-btn" data-rail="sync" id="syncScreenplayBtn" onClick={open}
            title={behind ? `The screenplay moved on in ${behind} scene(s): bring the shots up to date` : 'Bring the shots up to date with the screenplay'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></svg>
            <span className="l">Sync{behind ? ` (${behind})` : ''}</span>
        </button>
    );

    return (
        <>
            {slot && createPortal(button, slot)}
            <Modal id="syncScreenplayModal" title="Sync screenplay" footer={<>
                <button className="btn btn-secondary" onClick={() => closeModal('syncScreenplayModal')}>Close</button>
                {plan && !view.applied && plan.cards_changed > 0 && (
                    <button className="btn btn-primary" disabled={busy} onClick={apply}>{busy ? 'Syncing…' : `Sync ${plan.cards_changed} card${plan.cards_changed === 1 ? '' : 's'}`}</button>
                )}
            </>}>
                {view?.loading && <p className="text-sm text-muted">Comparing the shots with the screenplay…</p>}
                {view?.error && <p className="text-sm" style={{ color: 'var(--gl-danger,#ef4444)' }}>Could not compare: {view.error}</p>}
                {plan && <>
                    <p className="text-sm text-muted" style={{ marginTop: 0 }}>
                        {view.applied ? 'Synced. ' : ''}Updates who and what is in each shot and its dialogue from the screenplay. Camera, direction,
                        durations and the shots themselves are kept. Descriptions are never rewritten here.</p>
                    <div id="syncChanges">
                        {!view.applied && changes.length === 0 && <p className="text-sm">The shot cards already match the screenplay.</p>}
                        {!view.applied && changes.map((c, i) => (
                            <div className="text-sm" key={i}>Sc {c.scene} / <strong>{c.shot_code}</strong>: {c.updates.map(u => (typeof u === 'string' ? u : u.field || u.what || JSON.stringify(u))).join(', ')}</div>
                        ))}
                        {view.applied && <p className="text-sm">{plan.cards_changed} card(s) updated.</p>}
                    </div>
                    {items.length > 0 && <>
                        <h4 style={{ margin: '14px 0 6px' }}>Needs you ({items.length})</h4>
                        <div id="syncNeeds">{items.map((n, i) => (
                            <div className="text-sm" key={i} data-kind={n.kind}>Sc {n.scene}{n.shot_code ? <> / <strong>{n.shot_code}</strong></> : ''}: {LABEL[n.kind] || n.kind}{n.line ? ` — “${n.line}”` : ''}</div>
                        ))}</div>
                    </>}
                    {stale.length > 0 && (
                        <div className="card" style={{ marginTop: 12 }}>
                            <strong>Update the descriptions with Claude</strong>
                            <p className="text-sm text-muted" style={{ margin: '4px 0 8px' }}>{stale.length} shot description{stale.length === 1 ? '' : 's'} may no longer match the new scene text.
                                Copy the list and give it to Claude Desktop; it can rewrite them through Film Engine&apos;s tools.</p>
                            <button className="btn btn-secondary btn-sm" onClick={copyStale}>Copy the list for Claude</button>
                        </div>
                    )}
                </>}
            </Modal>
        </>
    );
}
