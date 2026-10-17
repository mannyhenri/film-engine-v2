/**
 * Build the Higgsfield APP catalog snapshot: every video model the director can
 * pick in Higgsfield's own app, with its limits and its exact credit price.
 *
 *   node backend/tests/refresh-higgsfield-app-catalog.js
 *
 * Why the app and not the API: Higgsfield is a manual provider here
 * (lib/manual-generation.js). Film Engine prepares the prompt and pictures and
 * the director generates in Higgsfield's app, paying in credits. So the list to
 * rank is the app's list, and the price is the app's credit price.
 *
 * Inputs (docs/research/video-model-selection/higgsfield-app/), both read from
 * Higgsfield's own MCP server, which nothing in Node can call:
 *   models-explore-video.json  models_explore {action: "list", type: "video"}
 *   cost-quotes.jsonl          generate_video {..., get_cost: true}, one line per
 *                              quote: the settings asked and the credits quoted.
 *                              A cost quote submits nothing and spends nothing.
 *
 * Output: lib/providers/higgsfield-app-models.json. Every model in the listing is
 * either INCLUDED (a shot generator) or EXCLUDED with the reason; credit rates
 * are DERIVED from the quotes (credits ÷ seconds, checked to be the same at every
 * length quoted; a model whose price is not linear keeps a price per length).
 * tests/higgsfield-app-catalog.test.js re-prices every quote from the snapshot.
 */
const fs = require('fs');
const path = require('path');

const EVIDENCE = path.join(__dirname, '..', '..', 'docs', 'research', 'video-model-selection', 'higgsfield-app');
const OUT = path.join(__dirname, '..', 'lib', 'providers', 'higgsfield-app-models.json');
const CHECKED = '2026-10-14';

/*
 * What is not a shot generator, and why. Everything else in the listing must be
 * in INCLUDED below, or the build stops.
 */
const EXCLUDED = {
    marketing_studio_video: 'Ad workflow: builds a 12–15s ad from saved products, avatars and hooks, not a shot from a prompt',
    marketing_studio_v2_video: 'Ad workflow: product, brand-URL and avatar ads, not a shot from a prompt',
    marketing_studio_v2_reference2video: 'Ad workflow: recreates a reference ad around a product',
    higgsfield_preset: 'Runs a saved Higgsfield preset (effects), not a prompt',
    ad_multiplier: 'Ad variant multiplier: remixes an existing ad',
    ad_multiplier_v2: 'Ad recreation from a reference video',
    draw_to_video: 'Animates a drawing on a source video',
    clipify: 'Cuts a YouTube video into clips',
    flux_3_video_edit: 'Edits an existing video',
    kling_video_edit: 'Edits an existing video',
    hf_mult_motion_control: 'Genjutsu: moves reference subjects with a driving video',
    hf_mult_replace_object: 'Genjutsu: replaces an object in an existing video',
    kling3_0_motion_control: 'Motion transfer from a driving video',
    reframe: 'Reframes an existing video to a new shape',
    video_background_remover: 'Tool: removes a video background',
    sam_3_video: 'Tool: removes a video background',
    voice_change: 'Tool: changes the voice in a video',
    dubbing: 'Tool: dubs a video into another language',
    sync_so: 'Tool: lip-syncs a video to new audio',
    topaz_hyperion_2_5: 'Tool: upscales a video',
    topaz_video: 'Tool: upscales a video',
    bytedance_video_upscale: 'Tool: upscales a video',
    video_upscale: 'Tool: upscales a video',
    video_deflicker: 'Tool: removes flicker from a video',
    depth_anything_video: 'Tool: makes a depth map from a video',
    fps_boost: 'Tool: raises a video\'s frame rate',
};

/*
 * The shot generators, as the app lists them. `family` keys the recommender's
 * profile and the prompt tips; `api` is the model id of lib/providers/higgsfield.js
 * when the same model is on Higgsfield's API (so the request can be composed and
 * reviewed there), else null; `max_images` is how many pictures it takes, with
 * where that number comes from (the app lists roles, not counts).
 * `label` is the app's name; the two older Cinema Studio entries share one name
 * in the app and are told apart by version.
 */
const INCLUDED = {
    seedance_2_5:               { family: 'seedance-2-5', api: 'seedance-2-5', max_images: [30, 'API reference endpoint'] },
    seedance_2_0:               { family: 'seedance-2', api: 'seedance-2', max_images: [9, 'API reference endpoint'] },
    seedance_2_0_mini:          { family: 'seedance-2-mini', api: null, max_images: [null, 'unpublished: takes image references, count not listed'] },
    seedance1_5:                { family: 'seedance-1-5', api: null, max_images: [1, 'start frame only'] },
    wan3_0:                     { family: 'wan-3', api: 'wan-3', max_images: [10, 'API reference endpoint'] },
    wan3_0_prime:               { family: 'wan-3-prime', api: 'wan-3-prime', max_images: [10, 'API reference endpoint'] },
    wan2_7:                     { family: 'wan-2-7', api: 'wan-2-7', max_images: [1, 'start frame only in the app'] },
    wan2_6:                     { family: 'wan-2-6', api: 'wan-2-6', max_images: [null, 'unpublished: takes image references, count not listed'] },
    kling3_0:                   { family: 'kling-3', api: { std: 'kling-3-standard', pro: 'kling-3-pro', '4k': 'kling-3-4k' }, max_images: [1, 'start frame (and end frame)'] },
    kling3_0_turbo:             { family: 'kling-3-turbo', api: 'kling-3-turbo', max_images: [1, 'start frame only'] },
    kling_o3_image_reference:   { family: 'kling-o3', api: 'kling-o3', max_images: [7, 'API image-reference endpoint'] },
    kling_o3_flf:               { family: 'kling-o3', api: 'kling-o3', max_images: [1, 'first and last frame'], needs_start_frame: true },
    kling2_6:                   { family: 'kling-2-6', api: 'kling-2-6-pro', max_images: [1, 'start frame only'] },
    minimax_h3:                 { family: 'minimax-h3', api: 'minimax-h3', max_images: [9, 'API reference endpoint'] },
    minimax_h3_max:             { family: 'minimax-h3-max', api: null, max_images: [null, 'unpublished: takes image references, count not listed'] },
    minimax_hailuo:             { family: 'hailuo-2-3', api: 'hailuo-2-3-standard', max_images: [1, 'start frame (and end frame)'] },
    flux_3_video:               { family: 'flux-3', api: null, max_images: [20, 'Higgsfield app (as listed by the AI Video Model Selector)'] },
    gemini_omni_flash_1_1:      { family: 'gemini-omni', api: null, max_images: [1, 'Higgsfield app (as listed by the AI Video Model Selector)'] },
    gemini_omni:                { family: 'gemini-omni-1-0', api: null, max_images: [null, 'unpublished: takes image references, count not listed'] },
    veo3_1:                     { family: 'veo-3-1', api: null, max_images: [1, 'start frame only'] },
    veo3_1_lite:                { family: 'veo-3-1-lite', api: null, max_images: [1, 'start frame (and end frame)'] },
    veo3:                       { family: 'veo-3', api: null, max_images: [1, 'start frame only'], duration: [8, 8, 'Veo 3 makes 8s clips; the app has no length setting'] },
    grok_video_v15:             { family: 'grok-video-1-5', api: 'grok-video-1-5', max_images: [7, 'API reference endpoint'] },
    grok_video_v15_lite:        { family: 'grok-video-1-5-lite', api: null, max_images: [1, 'start frame only'] },
    grok_video:                 { family: 'grok-video', api: null, max_images: [1, 'start frame only'] },
    happy_horse_video:          { family: 'happy-horse', api: null, max_images: [1, 'start frame only'] },
    cinematic_studio_video_4_0: { family: 'cinema-studio-4', api: 'cinema-studio-4', max_images: [30, 'API reference endpoint'] },
    cinematic_studio_video_3_5: { family: 'cinema-studio-3-5', api: null, max_images: [null, 'unpublished: takes image references, count not listed'], duration: [4, 15, 'The app lists 4s up with a 15s default; 15s is taken as the longest'] },
    cinematic_studio_3_0:       { family: 'cinema-studio-3', api: null, max_images: [1, 'one picture (start or end frame)'] },
    cinematic_studio_video_v2:  { family: 'cinema-studio-2', api: null, max_images: [1, 'one picture (start or end frame)'], label: 'Cinema Studio Video (v2)' },
    cinematic_studio_video:     { family: 'cinema-studio-1', api: null, max_images: [1, 'one picture (start or end frame)'], label: 'Cinema Studio Video (v1)' },
};

/* The app's setting that carries resolution, and what each value is in pixels. */
const RES_NAME = v => { const s = String(v); if (/^\d+$/.test(s)) return s + 'p'; return s.replace(/k$/i, 'K'); };
const MODE_RES = { std: '720p', pro: '1080p', '4k': '4K' };

function resolutionSetting(m) {
    const p = (m.parameters || []);
    const res = p.find(x => x.name === 'resolution' || x.name === 'quality' && (x.options || []).some(o => /\d/.test(o)));
    if (res) return { param: res.name, values: Object.fromEntries(res.options.map(o => [RES_NAME(o), o])), default: RES_NAME(res.default) };
    // Kling's mode is its resolution ("'4k' (4K resolution)"); a std/pro mode elsewhere is a quality tier.
    const mode = p.find(x => x.name === 'mode' && (x.options || []).includes('4k') && x.options.every(o => MODE_RES[o]));
    if (mode) return { param: 'mode', values: Object.fromEntries(mode.options.map(o => [MODE_RES[o], o])), default: MODE_RES[mode.default] };
    return null;
}

function durationOf(m, inc) {
    if (inc.duration) return { min: inc.duration[0], max: inc.duration[1], values: null, note: inc.duration[2] };
    if (m.duration_range) return { min: m.duration_range.min, max: m.duration_range.max, values: null };
    if (Array.isArray(m.durations)) return { min: Math.min(...m.durations), max: Math.max(...m.durations), values: [...m.durations].sort((a, b) => a - b) };
    const d = (m.parameters || []).find(x => x.name === 'duration');
    if (d && Array.isArray(d.options)) return { min: Math.min(...d.options), max: Math.max(...d.options), values: [...d.options].sort((a, b) => a - b) };
    // Wan 3.0 lists -1 ("auto") as its floor; 2s is the shortest it takes (its API schema).
    if (d && Number.isFinite(d.min)) return { min: d.min < 1 ? 2 : d.min, max: d.max, values: null };
    throw new Error(`${m.id}: no duration in the listing; give one in INCLUDED`);
}

/** The audio switch a model has, if any, and its "off" value. */
function audioSetting(m) {
    const p = (m.parameters || []).find(x => x.name === 'generate_audio' || x.name === 'sound');
    if (!p) return null;
    return { param: p.name, on: p.type === 'bool' ? true : 'on', off: p.type === 'bool' ? false : 'off', default: p.default === true || p.default === 'on' };
}

const AUDIO_KEYS = ['generate_audio', 'sound'];
const IGNORED_KEYS = ['model', 'duration', 'credits', 'error', 'aspect_ratio'];
/** The non-audio settings of a quote, as a stable key ("mode=pro"), with defaults filled from the listing. */
function settingKey(m, q) {
    const keys = {}, workflow = [];
    for (const p of m.parameters || []) {
        if (AUDIO_KEYS.includes(p.name) || !Array.isArray(p.options) || ['duration'].includes(p.name)) continue;
        if (!['resolution', 'quality', 'mode', 'variant'].includes(p.name)) continue;
        // Seedance 2.5 / Cinema Studio 4.0 "mode" picks a workflow (t2v, edit...), not a price tier: a shot is t2v.
        if (p.name === 'mode' && !p.options.some(o => ['std', 'pro', '4k', 'fast'].includes(o))) { workflow.push(p.name); continue; }
        keys[p.name] = q[p.name] !== undefined ? String(q[p.name]) : p.default !== undefined ? String(p.default) : undefined;
    }
    for (const k of Object.keys(q)) if (![...AUDIO_KEYS, ...IGNORED_KEYS, ...workflow].includes(k) && !(k in keys)) throw new Error(`${q.model}: quote sets ${k}, which the listing does not price`);
    return Object.entries(keys).filter(([, v]) => v !== undefined).sort().map(([k, v]) => `${k}=${v}`).join(',');
}
function audioOf(m, q) {
    const a = audioSetting(m);
    if (!a) return 'on';
    const v = q[a.param];
    if (v === undefined) return a.default ? 'on' : 'off';
    return v === a.on ? 'on' : 'off';
}

function build() {
    const listing = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'models-explore-video.json'), 'utf8')).items;
    const quotes = fs.readFileSync(path.join(EVIDENCE, 'cost-quotes.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const ids = listing.map(m => m.id);
    const unaccounted = ids.filter(id => !INCLUDED[id] && !EXCLUDED[id]);
    if (unaccounted.length) throw new Error(`Higgsfield lists models this build does not place: ${unaccounted.join(', ')}`);
    const gone = [...Object.keys(INCLUDED), ...Object.keys(EXCLUDED)].filter(id => !ids.includes(id));
    if (gone.length) throw new Error(`No longer in Higgsfield's listing: ${gone.join(', ')}`);

    const models = {};
    for (const [id, inc] of Object.entries(INCLUDED)) {
        const m = listing.find(x => x.id === id);
        const roles = [...new Set((m.medias || []).flatMap(x => x.roles || []))];
        const res = resolutionSetting(m);
        const audio = audioSetting(m);
        const tags = m.tags || [];
        // ── price: credits per second per setting (and per audio), or per length where it is not linear
        const mine = quotes.filter(q => q.model === id && Number.isFinite(q.credits));
        const groups = {};
        for (const q of mine) {
            const key = settingKey(m, q) + '|' + audioOf(m, q);
            (groups[key] = groups[key] || []).push(q);
        }
        // A model whose price is not proportional to length anywhere (Hailuo, Cinema Studio v1) is priced
        // per length everywhere: a per-second rate read off one length would be a guess at the others.
        const isLinear = qs => { const per = qs.filter(q => q.duration).map(q => q.credits / q.duration); return per.length > 0 && per.every(r => Math.abs(r - per[0]) < 1e-9); };
        const perClip = Object.values(groups).some(qs => !isLinear(qs));
        const rates = {};
        for (const [key, qs] of Object.entries(groups)) {
            const [setting, au] = key.split('|');
            const row = rates[setting] = rates[setting] || {};
            const lengths = [...new Set(qs.map(q => q.duration || null))];
            if (!perClip) row[au] = { per_second: Math.round(qs[0].credits / qs[0].duration * 10000) / 10000, lengths_quoted: lengths };
            else row[au] = { per_clip: Object.fromEntries(qs.map(q => [String(q.duration || 'fixed'), q.credits])), lengths_quoted: lengths };
        }
        if (!Object.keys(rates).length) throw new Error(`${id}: no cost quote`);
        models[id] = {
            label: inc.label || m.name,
            provider: m.provider_name || null,
            description: m.description || '',
            family: inc.family,
            api: inc.api,
            duration: durationOf(m, inc),
            aspects: (m.aspect_ratios || []).filter(a => /^\d+:\d+$/.test(a)),
            resolution: res,
            audio,
            native_audio: !!audio || tags.includes('audio'),
            multi_shot: (m.parameters || []).some(p => p.name === 'multi_shots' || p.name === 'multi_prompt') || tags.includes('multi-shot'),
            roles,
            start_frame: roles.includes('start_image') || roles.includes('image'),
            end_frame: roles.includes('end_image'),
            image_references: roles.includes('image_references'),
            needs_start_frame: !!inc.needs_start_frame,
            max_images: inc.max_images[0],
            max_images_source: inc.max_images[1],
            tags,
            url: `https://higgsfield.ai/ai/video?model=${id}`,
            default_setting: settingKey(m, { model: id }),
            linear_price_checked: Object.values(groups).some(qs => new Set(qs.map(q => q.duration)).size > 1),
            credits: rates,
        };
        if (!models[id].aspects.length) models[id].aspects = ['16:9'];
    }
    const failed = quotes.filter(q => q.error).map(q => ({ ...q }));
    return {
        checked: CHECKED,
        source: 'Higgsfield MCP server: models_explore (list, type video) for the catalog; generate_video with get_cost:true for each price (a quote submits nothing).',
        credit_usd: {
            usd_per_credit: 0.033,
            basis: 'Ultra plan: $99 a month for 3,000 credits (≈ $0.033 a credit). Top-up packs run about $0.053–0.059 a credit. Set your own rate with a provider-rate override (usd_per_credit) if you buy credits another way.',
        },
        excluded: EXCLUDED,
        failed_quotes: failed,
        quotes: quotes.filter(q => Number.isFinite(q.credits)),
        models,
    };
}

if (require.main === module) {
    const out = build();
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${Object.keys(out.models).length} models, ${Object.keys(out.excluded).length} excluded, ${out.quotes.length} quotes`);
}

module.exports = { build, EXCLUDED, INCLUDED };
