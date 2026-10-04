import DrawnListControls from '../../lib/drawn-list.jsx';
import SURFACE from './list-surface.js';

/*
 * The flow picker the flows engine draws (loadFlowsPage, <option>s into #flowSelect). The engine keeps the flows in a
 * local, so a row is read back from its option, which says exactly what the engine drew: the id (value), the name,
 * whether it is built in, and how many nodes it has.
 */
const flows = () => [...((document.getElementById('flowSelect') || {}).options || [])].map((o, order) => {
    const m = o.textContent.match(/^(.*?)( \(built-in\))? — (\d+) nodes$/) || [null, o.textContent, '', '0'];
    return { order, id: o.value, name: m[1], origin: m[2] ? 'built-in' : 'this project or library', nodes: Number(m[3]) };
});

export default function Lists() {
    return <DrawnListControls surface={SURFACE} container="flowSelect" item=":scope > option" rows={flows}
        keys={{ row: r => r.id, el: o => o.value }} />;
}
