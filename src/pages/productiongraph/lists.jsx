import DrawnListControls from '../../lib/drawn-list.jsx';
import { legacy } from '../../lib/legacy.js';
import SURFACE from './list-surface.js';

// The nodes the graph engine draws (pgRender, into #pgWorld), from core's PG.graph.nodes, each carrying its key
// (data-key). What does not match is faded in place (dim), never hidden or moved. The bar sits above the canvas,
// since the world inside it is panned and zoomed.
export default function Lists() {
    return <DrawnListControls surface={SURFACE} container="pgWorld" before="pgCanvas" item=":scope > .pg-node" dim
        rows={() => (legacy.PG.graph && legacy.PG.graph.nodes) || []} keys={{ row: r => r.key, el: n => n.getAttribute('data-key') }} />;
}
