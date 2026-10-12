'use strict';
async function modelItem(kind,id,body,fromImage){
 const plan=await require('../routes/threed').buildModelGenerationPlan(kind,id,body,fromImage);
 return {provider:plan.provider.id,capability:'model3d',payload:plan.payload,provenance:plan.provenance};
}
async function prepareThreeDRequests({path,body={}}){
 const clean=String(path||'').split('?')[0];
 let match=clean.match(/^\/(?:film\/)?(characters|props|locations)\/([^/]+)\/model\/(generate|from-image)(?:\/stream)?$/);
 if(match)return {supported:true,items:[await modelItem({characters:'character',props:'prop',locations:'location'}[match[1]],match[2],body,match[3]==='from-image')]};
 match=clean.match(/^\/(?:film\/)?world-versions\/([^/]+)\/generate$/);
 if(match){const plan=await require('../routes/worlds').buildWorldGenerationPlan(match[1],body);return {supported:true,items:[{provider:plan.provider.id,capability:'world',payload:plan.payload,provenance:plan.provenance}]};}
 // Multi-subject 3D streaming still uses the legacy gateway. It is blocked
 // rather than reviewing a different initial provider request.
 match=clean.match(/^\/(?:film\/)?projects\/([^/]+)\/models\/batch(?:\/stream)?$/);
 if(match)throw Object.assign(new Error('3D batch requires per-subject approved native execution; use individual subject generation'),{status:428});
 return null;
}
module.exports={prepareThreeDRequests};
