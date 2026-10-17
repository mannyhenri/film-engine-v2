const test = require('node:test');
const assert = require('node:assert/strict');
const web = require('./fixtures/higgsfield-web-catalog.json');
const api = require('./fixtures/higgsfield-api-prices.json');
const comparisons = require('./fixtures/jev-comparisons.json');
const hf = require('../lib/providers/higgsfield');
const rec = require('../lib/model-recommender');
const sorted = xs => [...xs].sort();

test('the observed top-family mismatch is reproduced through the existing recommender', () => {
    const expected = {seedance:'seedance-2-5', h3:'minimax-h3'};
    const mismatches = comparisons.runs.flatMap(run => {
        const got = rec.recommend({prompt:run.request.prompt,duration_s:run.request.duration,aspect:run.request.aspect,resolution:run.request.resolution}).cards[0]?.family;
        return got === expected[run.response.choice] ? [] : [`${run.id}: ${got} instead of ${expected[run.response.choice]}`];
    });
    assert.deepEqual(mismatches, []);
});

test('every website model is listed with its exact ID, label, type and constraints', () => {
    const { websiteModels } = require('../lib/higgsfield-catalog');
    const rows = websiteModels();
    assert.equal(web.items.length, 128);
    assert.deepEqual(sorted(rows.map(x => x.id)), sorted(web.items.map(x => x.id)));
    for (const expected of web.items) {
        const row = rows.find(x => x.id === expected.id);
        assert.equal(row.label, expected.name, expected.id);
        assert.equal(row.output, expected.output_type, expected.id);
        assert.deepEqual(row.parameters, expected.parameters, expected.id);
        assert.deepEqual(row.aspects, expected.aspect_ratios, expected.id);
        assert.match(row.url, /^https:\/\/higgsfield.ai\//);
    }
});

test('every live API mode has a price audit and availability entry; no silent missing models', () => {
    const { apiModes } = require('../lib/higgsfield-catalog');
    const rows = apiModes();
    const modes = api.results.flatMap(x => x.modes);
    assert.equal(modes.length, 83);
    assert.deepEqual(sorted(rows.map(x => x.id)), sorted(modes.map(x => x.slug)));
    for (const expected of modes) {
        const row = rows.find(x => x.id === expected.slug);
        assert.equal(row.label, expected.display_title, expected.slug);
        assert.deepEqual(row.pricing, expected.pricing, expected.slug);
        assert.ok(row.runnable || row.reason, expected.slug);
    }
});

test('all published configuration prices preserve USD list prices and discounts separately', () => {
    const { quoteConfiguration } = require('../lib/higgsfield-pricing');
    let count = 0;
    for (const mode of api.results.flatMap(x => x.modes)) {
        for (const option of mode.pricing.options) {
            const q = quoteConfiguration(mode.slug, option.configuration);
            assert.equal(q.currency, 'USD', mode.slug);
            assert.equal(q.unit, option.unit, mode.slug);
            assert.equal(q.list_rate, Number(option.original_amount ?? option.amount), mode.slug);
            assert.equal(q.discounted_rate, Number(option.amount), mode.slug);
            assert.equal(q.source, api.source, mode.slug);
            count++;
        }
    }
    assert.ok(count > 100, `only ${count} configurations`);
    assert.equal(quoteConfiguration('invented/model', {}).available, false);
    const unlisted = quoteConfiguration('bytedance/seedance-2.5/text-to-video', {resolution:'720p',duration_seconds:5});
    assert.equal(unlisted.exact, false, 'a missing configuration must never masquerade as exact');
});

test('all 12 fresh Jev runs choose the same family, with every registered video accounted for', () => {
    const { videoChoices } = require('../lib/higgsfield-catalog');
    const aliases = { seedance:'seedance-2-5', 'seedance-2':'seedance-2', h3:'minimax-h3', wan:'wan-3' };
    assert.equal(comparisons.runs.length, 12);
    for (const run of comparisons.runs) {
        const b = {prompt:run.request.prompt,duration_s:run.request.duration,aspect:run.request.aspect,resolution:run.request.resolution};
        const out = rec.recommend(b);
        assert.equal(out.cards[0].family, aliases[run.response.choice], run.id);
        assert.deepEqual(sorted([...out.cards,...out.blocked].map(c=>c.id)), sorted(videoChoices().map(c=>c.id)), run.id);
        assert.equal(out.cards.reduce((n,c)=>n+c.share,0),100, run.id);
        for (const c of out.cards) {
            assert.ok(c.reasons.length, `${run.id}: ${c.id}`);
            assert.ok(c.cost && c.cost.source, `${run.id}: ${c.id}: cost provenance`);
        }
        for (const c of out.blocked) assert.ok(c.why, `${run.id}: ${c.id}`);
    }
});

test('the entire adapter registry has an explicit sourced rate or named unknown, never an unrelated fallback', () => {
    const { rateFor } = require('../lib/provider-pricing');
    for (const [cap, models] of Object.entries(hf.MODELS)) for (const id of Object.keys(models)) {
        const rate = rateFor('higgsfield',cap,id);
        assert.ok(rate && rate.source, `${cap}:${id}`);
        assert.ok(rate.models[id], `${cap}:${id}: inherited fallback`);
        assert.ok(rate.inferred || rate.checked === api.checked, `${cap}:${id}: stale price`);
    }
});

test('the final request review prices every published configuration from its actual fields', () => {
    const {quoteFor} = require('../lib/final-request-review');
    for (const mode of api.results.flatMap(x=>x.modes)) for (const option of mode.pricing.options) {
        const fields={...option.configuration,duration:option.configuration.duration_seconds??1};
        const quote=quoteFor({provider:'higgsfield',capability:mode.output_type,model:'audit-model',body:fields,metadata:{endpoint:mode.slug}});
        const quantity=option.unit==='second'?fields.duration:fields.batch_size??1;
        assert.ok(Math.abs(quote.amount-Number(option.original_amount??option.amount)*quantity)<1e-6,`${mode.slug}: ${JSON.stringify(fields)} quoted ${quote.amount}`);
    }
});

test('every website cost is a checked sample or a named quote limitation; unknowns never become free', () => {
    const {websiteCost}=require('../lib/higgsfield-cost');
    for(const m of web.items){
        const q=websiteCost(m.id);
        assert.ok(q.source && q.checked,m.id);
        if(q.available) assert.ok(Number.isFinite(q.credits)&&q.parameters.model===m.id,m.id);
        else assert.ok(q.credits===null&&q.reason,m.id);
    }
    assert.equal(websiteCost('seedance_2_5',{duration_s:5,resolution:'1080p',aspect:'16:9'}).credits,80);
    assert.equal(websiteCost('seedance_2_0',{duration_s:5,resolution:'1080p',aspect:'16:9'}).credits,60);
    assert.equal(websiteCost('seedance_2_5',{duration_s:8,resolution:'1080p',aspect:'16:9'}).credits,128);
});

test('every website video with a documented duration parameter is eligible at that duration without required media', () => {
    const {factsFor}=require('../lib/video-model-facts');
    for(const m of web.items.filter(m=>m.output_type==='video')){
        const duration=m.parameters.find(p=>p.name==='duration');
        if(!duration || (!duration.min&&!duration.options?.length)) continue;
        const f=factsFor(`website:${m.id}`);
        if(!f) continue; // verified REST equivalent is accounted under its API model ID
        assert.ok(f.duration, `${m.id}: documented duration disappeared`);
        assert.equal(f.duration.min,duration.min??Math.min(...duration.options),m.id);
        assert.equal(f.duration.max,duration.max??(duration.options?.length?Math.max(...duration.options):duration.min),m.id);
    }
    const out=rec.recommend({prompt:'A wide establishing shot',duration_s:8,aspect:'16:9'});
    for(const id of ['website:flux_3_video','website:gemini_omni_flash_1_1','website:minimax_h3_max','website:veo3_1'])
        assert.ok(out.cards.some(c=>c.id===id),`${id}: a valid text request was refused`);
});
