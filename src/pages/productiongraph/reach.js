// What src/pages/registry-reach.test.jsx needs to render this page and click its registry controls.
// The graph is the real server answer (fixtures/graph.json, tools/record-graph-fixture.js), with one line of
// dialogue on shot 1A, because Generate dialogue is offered only for a shot that has a line. The control lives in the
// Generate tab (the Direct studio): shot 1A ticked, its Dialogue tab open.
import GRAPH from './fixtures/graph.json';

const P = GRAPH.project_id;
const SHOT = GRAPH.nodes.find(n => n.type === 'shot' && n.shot_code === '1A');
const graph = { ...GRAPH, nodes: GRAPH.nodes.map(n => (n === SHOT ? { ...n, dialogue_lines: 1 } : n)) };

export default {
    fixture: {
        project: { id: P },
        routes: {
            [`GET /projects/${P}/production-graph`]: graph,
            [`GET /projects/${P}/production-studio/direction`]: { shots: {}, cast: [], scenes: {}, ref_owners: {}, studio: null, studio_revision: 0 },
            'GET /production-studio/higgsfield-models': { models: [], connected: false },
        },
    },
    controls: {
        // DIALOGUE_SCOPES "shot": the shot ticked in the storyboard, then its Dialogue tab, as a person gets there.
        generateVoiceForShot: { button: 'Generate dialogue (1 line)', prepare: [
            (w) => [...w.document.querySelectorAll('.ds-shot')].find(b => b.querySelector('b')?.textContent === SHOT.shot_code).click(),
            (w) => [...w.document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Dialogue').click(),
        ] },
    },
};
