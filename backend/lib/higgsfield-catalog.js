'use strict';
const hf = require('./providers/higgsfield');
const web = require('./providers/higgsfield-web-models.json');
const api = require('./providers/higgsfield-prices.json');
const contract = require('./providers/higgsfield-models.json');

// Website IDs and public REST IDs are different products/versions. Only map verified equivalents.
const WEB_TO_API = {
    seedance_2_5:'seedance-2-5', seedance_2_0:'seedance-2', minimax_h3:'minimax-h3',
    wan3_0:'wan-3', wan3_0_prime:'wan-3-prime', wan2_7:'wan-2-7', wan2_6:'wan-2-6',
    kling3_0:'kling-3-pro', kling3_0_turbo:'kling-3-turbo', kling2_6:'kling-2-6-pro',
    kling_o3_image_reference:'kling-o3', kling_o3_flf:'kling-o3',
    cinematic_studio_video_4_0:'cinema-studio-4', grok_video_v15:'grok-video-1-5',
    soul_2:'soul-2', soul_v2:'soul-2', soul_cinematic:'soul-cinema',
    marketing_studio_image:'marketing-studio-image', recraft_v4_1:'recraft-v4-1', grok_image_2_0:'grok-image-2',
};

function websiteModels() {
    return web.items.map(m => ({...m, label:m.name, output:m.output_type, aspects:m.aspect_ratios,
        api_model:WEB_TO_API[m.id] || null,
        url:`https://higgsfield.ai/${m.output_type === 'video' ? 'ai/video' : m.output_type === 'image' ? 'ai/image' : 'apps'}?model=${encodeURIComponent(m.id)}`,
        checked:web.checked }));
}

function apiModes() {
    const runnable = new Set(Object.values(hf.MODELS).flatMap(ms=>Object.values(ms).flatMap(m=>Object.values(m.endpoints))));
    return api.results.flatMap(m=>m.modes.map(e=>({id:e.slug,label:e.display_title,output:e.output_type,
        pricing:e.pricing,availability:e.availability_state,runnable:runnable.has(e.slug),
        reason:runnable.has(e.slug) ? null : contract.models[e.slug]
            ? 'Requires a source clip or specialized workflow; open the API Playground'
            : 'Public API schema not documented in the model reference; open the API Playground',
        url:`https://open.higgsfield.ai/models/${e.slug}/playground`,checked:api.checked})));
}

function videoChoices() {
    return [
        ...Object.entries(hf.MODELS.video).map(([id,m])=>({id,...m,external:false,
            website_id:Object.keys(WEB_TO_API).find(k=>WEB_TO_API[k]===id)||null})),
        ...websiteModels().filter(m=>m.output==='video'&&!m.api_model).map(m=>({...m,
            id:`website:${m.id}`,website_id:m.id,family:`website:${m.id}`,external:true})),
    ];
}
module.exports = {websiteModels,apiModes,videoChoices,WEB_TO_API};
