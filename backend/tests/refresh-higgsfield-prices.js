'use strict';
// Read-only catalog refresh: no API credentials, generation, or uploads.
const fs=require('fs');
const path=require('path');
async function main(){
    const source='https://dash.higgsfield.ai/api/v2/pricing/models/?page_size=50';
    let url=source, count=null;
    const results=[];
    while(url){
        if(!url.startsWith('https://dash.higgsfield.ai/api/v2/pricing/models/'))throw Error('Unexpected catalog pagination URL');
        const r=await fetch(url);if(!r.ok)throw Error(`Catalog HTTP ${r.status}`);
        const page=await r.json();if(!Array.isArray(page.results))throw Error('Catalog response has no results');
        count=page.count;results.push(...page.results);url=page.next;
    }
    if(count!==results.length)throw Error(`Expected ${count} model families, received ${results.length}`);
    for(const mode of results.flatMap(m=>m.modes))if(!mode.pricing?.options?.length)throw Error(`Missing price configurations: ${mode.slug}`);
    const snapshot={checked:new Date().toISOString().slice(0,10),source,count,next:null,previous:null,results};
    fs.writeFileSync(path.join(__dirname,'../lib/providers/higgsfield-prices.json'),JSON.stringify(snapshot,null,2)+'\n');
    console.log(`Refreshed ${count} families, ${results.flatMap(m=>m.modes).length} modes; review fixture changes separately.`);
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
