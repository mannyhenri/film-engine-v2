'use strict';
const snapshot = require('./providers/higgsfield-credit-quotes.json');
const { quoteConfiguration } = require('./higgsfield-pricing');
const same = (a,b) => String(a||'').toLowerCase()===String(b||'').toLowerCase();

function websiteCost(id, settings = {}) {
    const rows = snapshot.quotes.filter(q=>q.id===id);
    const source={source:snapshot.source,checked:snapshot.checked,currency:'Higgsfield website credits'};
    const availableRes=[...new Set(rows.filter(q=>q.result.cost).map(q=>q.params.resolution).filter(Boolean))];
    const edge=r=>/^\d+k$/i.test(r)?parseFloat(r)*540:parseInt(r,10)||0;
    const outputRes=availableRes.find(r=>same(r,settings.resolution)) || (settings.resolution && availableRes.slice().sort((a,b)=>Math.abs(edge(a)-edge(settings.resolution))-Math.abs(edge(b)-edge(settings.resolution)))[0]);
    const candidates=rows.filter(q=>q.result.cost && (!outputRes || same(q.params.resolution,outputRes)));
    const row=candidates.find(q=>(!settings.duration_s||q.params.duration===settings.duration_s)&&(!settings.aspect||q.params.aspect_ratio===settings.aspect))||candidates[0];
    if(!row) return {...source,available:false,credits:null,exact:false,
        reason:rows[0]?.result.error||'No cost-only quote route for this model; quote on Higgsfield with the required inputs'};
    const other=candidates.find(q=>q.params.duration!==row.params.duration&&q.params.aspect_ratio===row.params.aspect_ratio);
    const linear=other && Math.abs(other.result.cost.credits_exact/other.params.duration-row.result.cost.credits_exact/row.params.duration)<1e-9;
    const exact=(!settings.duration_s||row.params.duration===settings.duration_s)&&(!settings.aspect||row.params.aspect_ratio===settings.aspect)&&(!settings.resolution||same(settings.resolution,row.params.resolution));
    const estimated=settings.duration_s&&linear;
    return {...source,available:true,credits:estimated?Number((settings.duration_s*row.result.cost.credits_exact/row.params.duration).toFixed(6)):row.result.cost.credits_exact,
        exact,estimated:!!estimated,linear_verified:!!linear,parameters:row.params,output_resolution:outputRes||null,
        reason:exact?'Authenticated sample quote for these settings; recheck before generation'
            :estimated?'Estimate from rates confirmed at two durations; settings or references may change the final quote'
            :'Sample quote only: duration, shape or settings differ; final quote required'};
}

function quoteVideo(model, brief, seconds) {
    const credit=websiteCost(model.website_id,brief);
    let q=null;
    if(!model.external){
        const endpoint=brief.reference_count>0&&model.endpoints.reference?model.endpoints.reference:model.endpoints[brief.has_start_frame?'image':'text']||model.endpoints.reference||Object.values(model.endpoints)[0];
        q=quoteConfiguration(endpoint,{resolution:brief.resolution,duration_seconds:seconds,aspect_ratio:brief.aspect});
    }
    return {source:q?.source||credit.source,checked:q?.checked||credit.checked,
        usd:q?.available?Math.round(q.list_rate*seconds*1e6)/1e6:null,
        exact:!!q?.exact,credits:credit.exact||credit.estimated?credit.credits:null,
        website:credit,api:q,reason:q?.reason||credit.reason};
}
module.exports={websiteCost,quoteVideo};
