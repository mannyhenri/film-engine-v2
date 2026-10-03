// What src/pages/registry-reach.test.jsx needs to render this page and click its registry controls.
// The graph is the real server answer (fixtures/graph.json, tools/record-graph-fixture.js), with one line of
// dialogue on shot 1A, because the drawer offers "Generate dialogue" only for a shot that has a line.
import GRAPH from './fixtures/graph.json';

const P = GRAPH.project_id;
const SHOT = GRAPH.nodes.find(n => n.type === 'shot' && n.shot_code === '1A');
const graph = { ...GRAPH, nodes: GRAPH.nodes.map(n => (n === SHOT ? { ...n, dialogue_lines: 1 } : n)) };

export default {
    fixture: {
        project: { id: P },
        routes: { [`GET /projects/${P}/production-graph`]: graph },
    },
    controls: {
        // DIALOGUE_SCOPES "shot": the shot's drawer, opened the way a click on the node opens it.
        generateVoiceForShot: { button: 'Generate dialogue (1 line)', prepare: (w) => w.pgSelect(SHOT.key) },
    },
};
