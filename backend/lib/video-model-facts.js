'use strict';
/**
 * WHAT EACH HIGGSFIELD VIDEO MODEL CAN DO, READ OFF ITS OWN SCHEMAS.
 *
 * The recommender needs hard facts (how long, which shapes, how many pictures,
 * whether it makes sound) before it can rank anything. Typing them in by hand
 * is how a table drifts from the API: the selector we studied lists Seedance
 * 2.5 at 20 references while its reference endpoint takes 30. So the facts are
 * DERIVED from the vendored contract (providers/higgsfield-models.json), across
 * every endpoint a model owns, and a model added to the snapshot gets facts the
 * moment it appears.
 *
 * Pure: no database, no network.
 */
const hf = require('./providers/higgsfield');
const CONTRACT = require('./providers/higgsfield-models.json');
const { rateFor } = require('./provider-pricing');

const RES_ORDER = ['360p', '480p', '540p', '580p', '720p', '768p', '1080p', '1440p', '2K', '4K'];
const resRank = r => { const normalized=String(r).replace(/k$/i,'K'); const i = RES_ORDER.indexOf(normalized); return i < 0 ? parseInt(r, 10) || 0 : i; };

function durationOf(prop) {
    if (!prop) return null;
    if (Array.isArray(prop.enum)) {
        const vals = prop.enum.map(Number).filter(Number.isFinite);
        return vals.length ? { min: Math.min(...vals), max: Math.max(...vals), values: vals.sort((a, b) => a - b) } : null;
    }
    const min = Number.isFinite(prop.minimum) ? prop.minimum : null;
    const max = Number.isFinite(prop.maximum) ? prop.maximum : null;
    if (min === null && max === null) return Number.isFinite(prop.default) ? { min: prop.default, max: prop.default, values: [prop.default] } : null;
    return { min: min ?? 1, max: max ?? min, values: null };
}

/** Facts for one model id of `hf.MODELS.video`, merged over all of its endpoints. */
function factsFor(id) {
    const model = hf.MODELS.video[id];
    if (!model) return websiteFacts(id);
    const endpoints = Object.entries(model.endpoints);
    const f = { id, label: model.label, family: model.family, tier: model.tier, workflows: endpoints.map(([k]) => k),
        endpoints: Object.fromEntries(endpoints), duration: null, resolutions: [], aspects: [],
        max_images: 0, max_videos: 0, max_audio: 0, start_frame: false, end_frame: false,
        native_audio: false, multi_shot: false, camera_controls: false, negative_prompt: false, seed: false, prompt_max: null };
    for (const [, ep] of endpoints) {
        const schema = CONTRACT.models[ep].schema || {};
        const p = schema.properties || {};
        const d = durationOf(p.duration);
        if (d) f.duration = f.duration ? { min: Math.min(f.duration.min, d.min), max: Math.max(f.duration.max, d.max),
            values: f.duration.values && d.values ? [...new Set([...f.duration.values, ...d.values])].sort((a, b) => a - b) : null } : d;
        for (const key of ['resolution', 'mode']) if (p[key] && Array.isArray(p[key].enum)) for (const r of p[key].enum) { const n = String(r).replace(/k$/, 'K'); if (/\d/.test(n) && !f.resolutions.includes(n)) f.resolutions.push(n); }
        if (p.mode && Array.isArray(p.mode.enum)) for (const [m, r] of [['std', '720p'], ['pro', '1080p']]) if (p.mode.enum.includes(m) && !f.resolutions.includes(r)) f.resolutions.push(r);
        if (p.aspect_ratio && Array.isArray(p.aspect_ratio.enum)) for (const a of p.aspect_ratio.enum) if (/^\d+:\d+$/.test(a) && !f.aspects.includes(a)) f.aspects.push(a);
        if (p.image_urls) f.max_images = Math.max(f.max_images, p.image_urls.maxItems || 7);
        else if (p.image_url || p.first_frame_url) f.max_images = Math.max(f.max_images, 1);
        if (p.elements && !p.image_urls) f.max_images = Math.max(f.max_images, 1);
        if (p.video_urls) f.max_videos = Math.max(f.max_videos, p.video_urls.maxItems || 1);
        if (p.audio_urls) f.max_audio = Math.max(f.max_audio, p.audio_urls.maxItems || 1);
        else if (p.audio_url) f.max_audio = Math.max(f.max_audio, 1);
        if (p.image_url || p.first_frame_url) f.start_frame = true;
        if (p.end_image_url || p.last_image_url || p.last_frame_url) f.end_frame = true;
        if (p.generate_audio || p.sound) f.native_audio = true;
        if (p.multi_shots || p.multi_prompt) f.multi_shot = true;
        if (p.camera_movement || p.camera_lens || p.camera_model) f.camera_controls = true;
        if (p.negative_prompt) f.negative_prompt = true;
        if (p.seed) f.seed = true;
        if (p.prompt && Number.isFinite(p.prompt.maxLength)) f.prompt_max = f.prompt_max ? Math.min(f.prompt_max, p.prompt.maxLength) : p.prompt.maxLength;
    }
    // Kling's tier names its resolution where the schema has no resolution field.
    if (!f.resolutions.length && /4k/.test(id)) f.resolutions.push('4K');
    if (!f.resolutions.length && /kling/.test(id)) f.resolutions.push('1080p');
    f.resolutions.sort((a, b) => resRank(a) - resRank(b));
    // No aspect field: the start frame (or the provider default) decides; 16:9 is what it returns.
    if (!f.aspects.length) f.aspects = ['16:9'];
    const rate = rateFor('higgsfield', 'video', id);
    f.usd_per_second = rate ? rate.usd_per_native : null;
    f.price_exact = !!(rate && !rate.inferred);
    return f;
}

function websiteFacts(id) {
    const m = require('./higgsfield-catalog').videoChoices().find(m=>m.id===id && m.external);
    if (!m) return null;
    const prop = name => m.parameters.find(p=>p.name===name);
    const dp=prop('duration');
    const duration = m.duration_range ? {...m.duration_range,values:null} : m.durations?.length
        ? {min:Math.min(...m.durations),max:Math.max(...m.durations),values:m.durations}
        : dp ? durationOf({enum:dp.options,minimum:dp.min,maximum:dp.max,default:dp.default}) : null;
    return {id,label:m.label,family:m.family,external:true,url:m.url,website_id:m.website_id,
        duration,resolutions:prop('resolution')?.options || [],aspects:m.aspects,
        max_images:m.medias.find(p=>p.type==='image')?.max ?? null,
        native_audio:!!(prop('generate_audio')||prop('sound')||m.tags?.includes('audio')),multi_shot:!!prop('multi_shots'),
        start_frame:m.medias.some(p=>p.roles?.includes('start_image')),end_frame:m.medias.some(p=>p.roles?.includes('end_image')),
        usd_per_second:null,price_exact:false,description:m.description,
        requires_media:m.medias.some(p=>p.required),
        required_parameters:m.parameters.filter(p=>p.required==='required'&&p.name!=='mode').map(p=>p.name)};
}
function allFacts() { return require('./higgsfield-catalog').videoChoices().map(m=>factsFor(m.id)); }

module.exports = { factsFor, allFacts, durationOf, resRank };
