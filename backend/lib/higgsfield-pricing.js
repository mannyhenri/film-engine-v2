'use strict';
const snapshot = require('./providers/higgsfield-prices.json');
const modes = new Map(snapshot.results.flatMap(m=>m.modes).map(m=>[m.slug,m]));
const norm = v => typeof v === 'string' ? v.toLowerCase() : v;
const listRate = o => Number(o.original_amount ?? o.amount);

// The public catalog exposes sample configurations, not a complete tariff. Never interpolate an exact price.
function quoteConfiguration(endpoint, configuration = {}) {
    const mode = modes.get(endpoint);
    const base = {source:snapshot.source,checked:snapshot.checked,currency:'USD',endpoint};
    if (!mode) return {...base,available:false,exact:false,reason:'No published API price for this endpoint'};
    const options = mode.pricing.options;
    const match = options.find(o=>Object.entries(o.configuration).every(([k,v])=>v == null || norm(configuration[k])===norm(v)));
    const list = options.map(listRate).filter(Number.isFinite);
    if (!list.length) return {...base,available:false,exact:false,reason:'No numeric published price'};
    return {...base,available:true,exact:!!match,unit:(match||options[0]).unit,
        list_rate:match?listRate(match):Math.max(...list),
        discounted_rate:match?Number(match.amount):null,
        min_rate:Math.min(...list),max_rate:Math.max(...list),
        reason:match?'Published configuration; account discounts and actual billing may differ'
            :'Configuration not published; conservative maximum of the catalog samples, not a verified quote'};
}

function registryRates(registry) {
    return Object.fromEntries(Object.entries(registry).map(([cap,models])=>[cap, Object.fromEntries(Object.entries(models).map(([id,m])=>{
        const options = [...new Set(Object.values(m.endpoints))].flatMap(e=>modes.get(e)?.pricing.options||[]);
        const rates = options.map(listRate).filter(Number.isFinite);
        return [id,{usd_per_native:rates.length?Math.max(...rates):null,inferred:true,
            source:snapshot.source,checked:snapshot.checked,
            note:rates.length?'Conservative maximum of published configurations; resolve the exact request before budgeting'
                :'No current published API price; account estimate required',
            min_rate:rates.length?Math.min(...rates):null,max_rate:rates.length?Math.max(...rates):null}];
    }))]));
}
module.exports = {quoteConfiguration,registryRates};
