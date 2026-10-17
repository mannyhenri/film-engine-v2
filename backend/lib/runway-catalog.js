/**
 * RUNWAY, as a second place to send the Generate tab's request.
 *
 * The recommendation stays Higgsfield's ranking (lib/model-recommender.js): the
 * same model family behaves the same wherever it is hosted. What changes with
 * the provider is where the request goes and what it costs. So every Runway
 * video model is listed with the Higgsfield model(s) it IS (Seedance 2.5 on
 * Runway is Seedance 2.5), and Runway's own models (Gen-4.5, Aleph…) are listed
 * with none. Rates are Runway's published credits (lib/providers/runway.js),
 * at its developer-portal $0.01 a credit. Free: nothing here calls Runway.
 */
const runway = require('./providers/runway');
const { factsFor } = require('./video-model-facts');

/** Runway id → [label, the Higgsfield models it is (same family and version), audio]. */
const RUNWAY_MODELS = {
    'gen4.5': ['Runway Gen-4.5', [], false],
    gen4_turbo: ['Runway Gen-4 Turbo', [], false],
    aleph2: ['Runway Aleph 2', [], false],
    'veo3.1': ['Google Veo 3.1', ['website:veo3_1'], true],
    'veo3.1_fast': ['Google Veo 3.1 Fast', [], true],
    seedance2_5: ['Seedance 2.5', ['seedance-2-5'], true],
    seedance2: ['Seedance 2.0', ['seedance-2'], true],
    seedance2_fast: ['Seedance 2.0 Fast', [], true],
    seedance2_mini: ['Seedance 2.0 Mini', ['website:seedance_2_0_mini'], true],
    happyhorse_1_0: ['Happy Horse 1.0', ['happy-horse-1'], true],
    hailuo3: ['Hailuo 3', [], false],
    h3_max: ['MiniMax H3 Max', ['minimax-h3', 'website:minimax_h3_max'], false],
    grok_imagine_1_5: ['Grok Imagine Video 1.5', ['grok-video-1-5'], true],
    wan3: ['Wan 3.0', ['wan-3'], true],
    wan3_prime: ['Wan 3.0 Prime', ['wan-3-prime'], true],
    gemini_omni_flash: ['Gemini Omni Flash', ['website:gemini_omni'], true],
    'gemini_omni_flash_1.1': ['Gemini Omni Flash 1.1', ['website:gemini_omni_flash_1_1'], true],
};

function connected() {
    let stored = '';
    try { stored = require('./providers/credentials').getCredential('runway').apiKey || ''; } catch (_) {}
    return !!String(process.env.RUNWAY_API_KEY || stored).trim();
}

/** Every Runway video model the adapter can send, with what it is and what it costs. */
function runwayModels() {
    return Object.entries(runway.RUNWAY_VIDEO_MODELS).map(([id, p]) => {
        const [label, same, audio] = RUNWAY_MODELS[id] || [id, [], false];
        const twin = same.map(factsFor).find(Boolean) || null;
        return {
            id, label, same_as: same, own: same.length === 0,
            duration: { min: p.duration.min, max: p.duration.max, ...(p.duration.allowed ? { allowed: p.duration.allowed } : {}) },
            credits_per_second: p.creditsPerSecond, minimum_credits: p.minimumCredits || 0,
            resolutions: p.resolutions ? Object.fromEntries(Object.entries(p.resolutions).map(([k, v]) => [k, v.creditsPerSecond])) : null,
            native_audio: audio, max_images: twin && Number.isFinite(twin.max_images) ? twin.max_images : null,
            source: p.source || null,
        };
    });
}

module.exports = { runwayModels, connected, RUNWAY_MODELS, USD_PER_CREDIT: runway.USD_PER_CREDIT };
