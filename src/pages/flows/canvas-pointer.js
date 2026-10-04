/*
 * The Flows canvas's pointer handling: pan on background drag, move on node drag, and a wire let go on empty
 * canvas. The legacy code bound these two document listeners when its chunk loaded; the page binds them on mount
 * (tools/make-react-page.js "mount") and unbinds them on unmount. The handler bodies are the source's, unchanged:
 * they read FLOW (core's canvas state, through the bridge) and call the engine.
 */
import { legacy } from '../../lib/legacy.js';
import { svgPoint, flowCanvasRender, flowOpenNextNode } from './engine.js';

const live = (name) => new Proxy({}, {
    get: (_, k) => legacy[name][k],
    set: (_, k, v) => { legacy[name][k] = v; return true; },
});
// Core's canvas state, as a live proxy, declared the way every engine declares its bridge (engine-bridge.test.js).
const { FLOW } = Object.fromEntries(['FLOW'].map(n => [n, live(n)]));

export default function bindOnMount() {
    // Canvas-level pointer handling: pan on background drag, move on node drag.
    const move = (evt) => {
        if (!FLOW.flow) return;
        if (FLOW.drag) {
            const p = svgPoint(evt);
            const n = FLOW.flow.nodes.find(x => x.id === FLOW.drag.id);
            if (n) { n.x = p.x - FLOW.drag.dx; n.y = p.y - FLOW.drag.dy; FLOW.dirty = true; flowCanvasRender(); }
        } else if (FLOW.link) {
            FLOW.link.cursor = svgPoint(evt);
            flowCanvasRender();
        } else if (FLOW.pan) {
            FLOW.view.x = evt.clientX - FLOW.pan.x;
            FLOW.view.y = evt.clientY - FLOW.pan.y;
            flowCanvasRender();
        }
    };
    const up = (evt) => {
        // A wire let go on empty canvas offers the nodes that could take it (FOG-010).
        if (FLOW.link) { const link = FLOW.link; FLOW.link = null; flowCanvasRender(); flowOpenNextNode(link, evt.clientX, evt.clientY); }
        FLOW.drag = null;
        FLOW.pan = null;
        const svg = document.getElementById('flowCanvas');
        if (svg) svg.classList.remove('panning');
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
}
