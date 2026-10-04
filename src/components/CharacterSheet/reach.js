// What src/pages/registry-reach.test.jsx needs to open the character sheet and click its registry controls.
export default {
    // Core's inspector and the Characters cards open it with openCharacterSheet(id).
    open: { call: 'openCharacterSheet', args: ['c1'] },
    // Voice hands over to the casting component, which App mounts beside the sheet.
    alsoMount: ['Casting'],
    fixture: {
        routes: {
            'GET /characters/c1': { character: { id: 'c1', name: 'Mara' } },
            'GET /characters/c1/gallery': { items: [] },
            'GET /characters/c1/palette': { palette: [] },
            'GET /characters/c1/voice': { suggestions: { suggested: [], missing: [], matched_on: {} } },
        },
    },
    controls: {
        castCharacterVoice: { button: 'Voice' },   // DIALOGUE_SCOPES "character"
    },
};
