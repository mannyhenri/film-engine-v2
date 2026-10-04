import DrawnListControls from '../../lib/drawn-list.jsx';
import SURFACES from './list-surface.js';

/*
 * The two lists the previs engine draws on this page (loadThreeD, into #threedSubjects and #threedModels). The engine
 * keeps those rows in locals, not state, so a row is read back from its card: exactly what the engine drew from the
 * data it read (nothing is fetched again). Read at each draw, so a row and its card are always the same draw.
 */
const cards = (id) => [...(document.getElementById(id) || { children: [] }).children].filter(n => n.classList && n.classList.contains('entity-card'));
const text = (n, sel) => ((n.querySelector(sel) || {}).textContent || '').trim();
const subjects = () => cards('threedSubjects').map((n, order) => ({ order, name: text(n, 'h3'), kind: text(n, 'p') }));
const models = () => cards('threedModels').map((n, order) => ({ order, file_name: text(n, 'h3'), kind: text(n, 'p'), format: text(n, '.tag') }));

export default function Lists() {
    const [subjectsSurface, modelsSurface] = SURFACES;
    return (
        <>
            <DrawnListControls surface={subjectsSurface} container="threedSubjects" item=":scope > .entity-card" rows={subjects} />
            <DrawnListControls surface={modelsSurface} container="threedModels" item=":scope > .entity-card" rows={models} />
        </>
    );
}
