'use strict';
/**
 * THE VIDEO MODELS IN HIGGSFIELD'S OWN APP, WHAT EACH CAN DO, AND WHAT A CLIP COSTS.
 *
 * Higgsfield is a manual provider here: Film Engine prepares the prompt and the
 * pictures, and the director generates in Higgsfield's app, paying in credits.
 * So the models to choose from are the app's (31 shot generators, including
 * ones the API does not carry: Veo, Gemini Omni Flash, Flux 3, Seedance 2.0 Mini,
 * MiniMax H3 Max, older Cinema Studio versions), and the price is the app's
 * credit price, read off Higgsfield's own cost quote for each setting
 * (providers/higgsfield-app-models.json, built by tests/refresh-higgsfield-app-catalog.js).
 *
 * Each model that is also on the API names its API model (`api`), so a request
 * can still be composed and reviewed exactly as it would be sent.
 *
 * Pure: no database, no network.
 */
const SNAPSHOT = require('./providers/higgsfield-app-models.json');

const MODELS = SNAPSHOT.models;
const RES_ORDER = ['360p', '480p', '512p', '540p', '580p', '720p', '768p', '1080p', '1440p', '2K', '4K'];
const resRank = r => { const i = RES_ORDER.indexOf(r); return i < 0 ? parseInt(r, 10) || 0 : i; };

function usdPerCredit() {
    const env = Number(process.env.FILM_HIGGSFIELD_USD_PER_CREDIT);
    return Number.isFinite(env) && env > 0 ? env : SNAPSHOT.credit_usd.usd_per_credit;
}

/** The resolutions a model offers, smallest first ([] when the app publishes none, as for Veo's quality tiers). */
function resolutionsOf(m) {
    return m.resolution ? Object.keys(m.resolution.values).sort((a, b) => resRank(a) - resRank(b)) : [];
}

/** The offered resolution a request lands on: the one asked for, else the nearest the model makes. */
function resolutionFor(m, asked) {
    const offered = resolutionsOf(m);
    if (!offered.length) return null;
    if (!asked) return m.resolution.default;
    if (offered.includes(asked)) return asked;
    return [...offered].sort((a, b) => Math.abs(resRank(a) - resRank(asked)) - Math.abs(resRank(b) - resRank(asked)) || resRank(b) - resRank(a))[0];
}

/** The length a model renders for a request: the next it offers at or above it, clamped to its range. */
function billedSeconds(m, d) {
    const dur = m.duration;
    if (dur.values) return dur.values.find(v => v >= d) || dur.max;
    return Math.max(dur.min, Math.min(d, dur.max));
}

/** The API model of lib/providers/higgsfield.js this app model is, at this resolution (Kling's tier is its resolution). */
function apiModelFor(id, resolution) {
    const m = MODELS[id];
    if (!m || !m.api) return null;
    if (typeof m.api === 'string') return m.api;
    const res = resolutionFor(m, resolution);
    return m.api[m.resolution.values[res]] || null;
}

/** Facts for one app model: the shape the recommender, the cards and the prompt rewrite read. */
function factsFor(id) {
    const m = MODELS[id];
    if (!m) return null;
    return {
        id, label: m.label, provider: m.provider, family: m.family, description: m.description,
        api: m.api, url: m.url,
        duration: m.duration, resolutions: resolutionsOf(m), aspects: m.aspects,
        max_images: m.max_images, max_images_source: m.max_images_source,
        start_frame: m.start_frame, end_frame: m.end_frame, image_references: m.image_references,
        needs_start_frame: m.needs_start_frame, native_audio: m.native_audio, multi_shot: m.multi_shot,
        audio_switch: !!m.audio,
    };
}

function allFacts() { return Object.keys(MODELS).map(factsFor); }

/**
 * What one clip costs in Higgsfield credits (and in dollars at the plan rate),
 * from the quote for that exact setting. `exact` is false when this setting or
 * this length was not itself quoted (a per-second rate carried to another
 * length is exact: every model's per-second price was checked at two lengths).
 */
function priceFor(id, { duration_s, resolution, audio } = {}) {
    const m = MODELS[id];
    if (!m) return null;
    const d = Math.max(1, Math.round(Number(duration_s) || 5));
    const billed = billedSeconds(m, d);
    const res = resolutionFor(m, resolution);
    let key = m.default_setting;
    if (res) {
        const param = m.resolution.param, raw = m.resolution.values[res];
        key = key.split(',').filter(Boolean).map(kv => kv.startsWith(param + '=') ? `${param}=${raw}` : kv).join(',');
    }
    const wantAudio = audio === undefined ? (m.audio ? m.audio.default : true) : !!audio;
    const row = m.credits[key];
    const notes = [];
    if (!row) return { credits: null, usd: null, exact: false, billed_seconds: billed, resolution: res, setting: key, note: `No Higgsfield quote for ${key || 'the default setting'}` };
    let rate = row[wantAudio ? 'on' : 'off'];
    if (!rate) {
        rate = row[wantAudio ? 'off' : 'on'];
        notes.push(`priced with sound ${wantAudio ? 'off' : 'on'}: the other was not quoted`);
    }
    let credits = null, exact = true;
    if (rate.per_second !== undefined) credits = rate.per_second * billed;
    else if (rate.per_clip[String(billed)] !== undefined) credits = rate.per_clip[String(billed)];
    else if (rate.per_clip.fixed !== undefined) credits = rate.per_clip.fixed;
    else { exact = false; notes.push(`no quote for ${billed}s at ${key}`); }
    if (notes.length) exact = false;
    credits = credits === null ? null : Math.round(credits * 100) / 100;
    return { credits, usd: credits === null ? null : Math.round(credits * usdPerCredit() * 100) / 100, exact,
        billed_seconds: billed, resolution: res, setting: key, audio: wantAudio, per_second: rate.per_second ?? null, note: notes.join('; ') || null };
}

/**
 * The app model behind an API request, for pricing it: the first app model that
 * names this API model (Kling 3.0's three tiers all name kling3_0).
 */
function appModelOfApi(apiId) {
    for (const [id, m] of Object.entries(MODELS)) {
        if (m.api === apiId) return { id, resolution: null };
        if (m.api && typeof m.api === 'object') {
            const mode = Object.entries(m.api).find(([, v]) => v === apiId);
            if (mode) return { id, resolution: Object.entries(m.resolution.values).find(([, raw]) => raw === mode[0])[0] };
        }
    }
    return null;
}

/** Price an API request body (lib/providers/higgsfield.js) by the app's credits: same model, length, resolution, sound. */
function priceApiRequest(apiId, body = {}, seconds) {
    const app = appModelOfApi(apiId);
    if (!app) return null;
    const audio = body.generate_audio !== undefined ? !!body.generate_audio : body.sound !== undefined ? (body.sound === true || body.sound === 'on') : undefined;
    return { app_model: app.id, ...priceFor(app.id, { duration_s: seconds, resolution: app.resolution || body.resolution, audio }) };
}

module.exports = { SNAPSHOT, MODELS, factsFor, allFacts, priceFor, priceApiRequest, appModelOfApi, apiModelFor,
    resolutionFor, resolutionsOf, billedSeconds, resRank, usdPerCredit };
