import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { legacy } from '../../lib/legacy.js';
import { projectEpoch } from '../../lib/project-epoch.js';
import './storyboard-print.css';

export default function StoryboardPrint({ projectId, className = 'pg-hbtn' }) {
    const [open, setOpen] = useState(false), [paper, setPaper] = useState('letter'), [perPage, setPerPage] = useState(4);
    const [plan, setPlan] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
    const frame = useRef(null), mounted = useRef(true), serial = useRef(0), captured = useRef(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; }; }, []);
    const live = token => mounted.current && token === serial.current && captured.current?.epoch === projectEpoch()
        && captured.current?.id === (projectId || legacy.state?.currentProject?.id);
    function close() { serial.current++; captured.current = null; setOpen(false); setPlan(null); setReady(false); setBusy(false); }
    async function load(nextPaper, nextPerPage, start = false) {
        if (start) {
            const id = projectId || legacy.state?.currentProject?.id;
            captured.current = { id, epoch: projectEpoch() }; setOpen(true);
        }
        const token = ++serial.current, id = captured.current?.id;
        setPaper(nextPaper); setPerPage(nextPerPage); setPlan(null); setReady(false); setError(''); setBusy(true);
        if (!id) { setError('Open a project to print its storyboard.'); setBusy(false); return; }
        try {
            const next = await legacy.api(`/projects/${id}/storyboard/print?paper=${nextPaper}&per_page=${nextPerPage}`);
            if (!live(token)) return;
            if (!next || next.project_id !== id || next.paper !== nextPaper || next.per_page !== nextPerPage || typeof next.html !== 'string' || !Array.isArray(next.pages)) throw Error('Storyboard print preview is unavailable.');
            setPlan(next);
        } catch (e) { if (live(token)) setError(e.message); }
        finally { if (live(token)) setBusy(false); }
    }
    function loaded(token) {
        if (!plan || !live(token)) return;
        const doc = frame.current?.contentDocument;
        if (doc?.querySelector('meta[name="fe-storyboard-print"]')?.content !== `${plan.project_id}:${plan.paper}:${plan.per_page}`) return;
        const images = Array.from(doc.images || []);
        if (images.some(image => !image.complete)) return;
        const broken = images.some(image => image.complete && image.naturalWidth === 0);
        setReady(!broken);
        if (broken) setError('An original image could not be displayed. Review the preview before printing.');
    }
    function print() {
        if (!ready || !live(serial.current)) return;
        try { frame.current.contentWindow.focus(); frame.current.contentWindow.print(); }
        catch (e) { setError(e.message || 'The print dialog could not be opened.'); }
    }
    useEffect(() => {
        if (!open) return;
        const key = event => { if (event.key === 'Escape') close(); };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [open]);
    const previewToken = serial.current;
    return <>
        <button className={className} onClick={() => load(paper, perPage, true)} title="Two or four selected original frames per landscape page, with complete shot notes">Print storyboard</button>
        {open && createPortal(<div className="storyboard-print-overlay">
            <section className="storyboard-print-dialog" role="dialog" aria-modal="true" aria-label="Print storyboard">
                <header><div><h3>Print storyboard</h3><p>Selected original images · {perPage === 2 ? 'Two' : 'Four'} shots per landscape page</p></div>
                    <button className="btn btn-secondary btn-sm" onClick={close} aria-label="Close print preview">Close</button></header>
                <div className="storyboard-print-toolbar"><label>Paper size <select value={paper} onChange={e => load(e.target.value, perPage)}>
                    <option value="letter">Letter landscape</option><option value="a4">A4 landscape</option></select></label>
                    <label>Boards per page <select value={perPage} onChange={e => load(paper, Number(e.target.value))}>
                    <option value={4}>4 — 2 × 2 grid</option><option value={2}>2 — larger pictures</option></select></label>
                    {plan && <span>{plan.shot_count} shots · {plan.continuation_count} continuation panels · {Math.max(1, plan.pages.length)} pages</span>}
                    {plan && <button className="btn btn-primary btn-sm" disabled={!ready || busy} onClick={print}>Print / Save PDF</button>}</div>
                {error && <p className="storyboard-print-error" role="alert">{error}</p>}
                {busy && <p className="storyboard-print-loading">Preparing original images and complete shot notes…</p>}
                {plan && <iframe ref={frame} key={previewToken} title="Storyboard print preview" srcDoc={plan.html}
                    sandbox="allow-same-origin allow-modals" onLoad={() => loaded(previewToken)} />}
                <footer>Camera and notes come from current shot cards. Continuation panels retain long notes and dialogue. Choose Save as PDF in the print dialog to create a PDF.</footer>
            </section>
        </div>, document.body)}
    </>;
}
