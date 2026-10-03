// What src/pages/registry-reach.test.jsx needs to open casting and click its registry controls.
export default {
    // Core's character sheet opens it with castCharacterVoice(id, name).
    open: { call: 'castCharacterVoice', args: ['c1', 'Mara'] },
    fixture: {
        routes: {
            'GET /characters/c1/voice': { voice_id: 'v1', suggestions: { suggested: [{ voice_id: 'v1', name: 'Ada' }], missing: [], matched_on: {} } },
            'GET /audition/preview?text=Hello&voice_id=v1&character_id=c1': { provider: 'elevenlabs', voice_id: 'v1' },
            'POST /audition': { audio_url: '/film/audition/a.mp3' },
        },
    },
    controls: {
        // Typed first: an empty line is refused before any request, so the click would reach nothing.
        auditionVoice: { button: 'Audition', type: { id: 'auditionLine', value: 'Hello' } },   // DIALOGUE_SCOPES "voice" and "line"
    },
};
