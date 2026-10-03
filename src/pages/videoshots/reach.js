// What src/pages/registry-reach.test.jsx needs to render this page and click its registry controls.
export default {
    fixture: {
        routes: {
            'GET /projects/p1/shotlist': { shots: [] }, 'GET /projects/p1/video': { jobs: [] }, 'GET /projects/p1/providers': { effective: {} },
            'POST /projects/p1/voice/batch': { generated: 0 },
        },
    },
    controls: {
        generateAllVoices: { button: 'Generate All Dialogue' },   // DIALOGUE_SCOPES "project"
    },
};
