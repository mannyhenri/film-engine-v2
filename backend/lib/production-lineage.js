'use strict';
const parse=(value,fallback={})=>{try{return value?JSON.parse(value):fallback;}catch(_){return fallback;}};
function assetLineage(db,assetOrId){
 const asset=typeof assetOrId==='object'?assetOrId:db.prepare('SELECT * FROM film_assets WHERE id=?').get(assetOrId);
 if(!asset)return null;
 const unknown=reason=>({status:'legacy_unknown',review_id:null,provider:null,model:null,approved:null,transport:null,origin:null,unknown:[reason]});
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('film_final_request_reviews','film_generation_jobs','film_generation_transport_receipts')").all().map(row=>row.name));
 if(!tables.has('film_final_request_reviews'))return unknown('approved_request');
 const meta=parse(asset.metadata),ids=new Set([meta.approval_id,meta.final_request_review_id].filter(Boolean));
 if(tables.has('film_generation_jobs')){
  const jobs=db.prepare('SELECT * FROM film_generation_jobs WHERE asset_id=? OR id=? OR id=?').all(asset.id,meta.generation_job_id||'',meta.collected_from_job||'');
  for(const job of jobs){if(job.project_id && asset.project_id && job.project_id!==asset.project_id)continue;const id=parse(job.meta).approval_id;if(id)ids.add(id);}
 }
 if(ids.size!==1)return unknown(ids.size?'ambiguous_review_identity':'approved_request');
 const id=[...ids][0],review=db.prepare('SELECT * FROM film_final_request_reviews WHERE id=?').get(id);if(!review)return unknown('approved_request');
 const snapshot=parse(review.snapshot_json),editable=parse(review.editable_json),provenance=parse(review.provenance_json),origin=provenance.spec||editable.provenance||{};
 if(origin.project_id && asset.project_id && origin.project_id!==asset.project_id)return unknown('review_project_identity');
 if(!review.approved_at || !['submitting','submitted','completed','uncertain'].includes(review.state))return unknown('approved_result_identity');
 const receipt=tables.has('film_generation_transport_receipts')?db.prepare('SELECT * FROM film_generation_transport_receipts WHERE review_id=?').get(id):null;
 const transport=receipt?{id:receipt.id,endpoint:receipt.endpoint,method:receipt.method,body:parse(receipt.body_json),serialized_body:receipt.serialized_body,serialized_base64:receipt.serialized_base64,body_sha256:receipt.body_sha256,serialization_exact:!!receipt.serialization_exact,redactions:parse(receipt.redactions_json,[]),references:parse(receipt.references_json,[]),sent_at:receipt.sent_at,state:receipt.state,http_status:receipt.http_status}:null;
 const gaps=transport?[]:['transport'];
 const referencesKnown=Array.isArray(snapshot.references);
 if(!referencesKnown)gaps.push('reference_manifest');
 if(referencesKnown&&snapshot.references.some(ref=>!ref?.wire_role||!ref?.order||!Number.isFinite(ref?.byte_length)))gaps.push('reference_role_order_bytes');
 return{status:'recorded',review_id:id,provider:snapshot.provider||null,model:snapshot.model||null,approved:{endpoint:snapshot.endpoint,body:snapshot.body,payload:editable.payload||null,references:referencesKnown?snapshot.references:null,references_known:referencesKnown,adapterVersion:snapshot.adapterVersion},transport,origin,unknown:gaps};
}
module.exports={assetLineage};
