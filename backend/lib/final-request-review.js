/** Durable user approval of resolved provider semantics. Credentials never belong here. */
const fs = require('fs');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const execution = new AsyncLocalStorage();
function canonical(value) {
 if(Buffer.isBuffer(value))return canonical(value.toJSON());
 if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
 if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
 return JSON.stringify(value);
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(message,status=409,details={}){const e=new Error(message);e.status=status;Object.assign(e,details);throw e;}
function rejectSecrets(value) {
 if (!value || typeof value !== 'object') return;
 for (const [key,item] of Object.entries(value)) {
  if (/^(authorization|api[_-]?key|access[_-]?token|secret|credentials)$/i.test(key)) fail('Credentials cannot be included in a request review',400);
  rejectSecrets(item);
 }
}
function semanticRow(row) {
 if(!row)return row;
 const ignored=new Set(['status','updated_at','created_at','last_generated_at','last_generation_at','generation_status','job_status','processing_status']);
 return Object.fromEntries(Object.entries(row).filter(([key])=>!ignored.has(key)));
}
function payloadDigest(payload,spec={}){const value={...payload};if(spec.default_seed)delete value.seed;return hash(canonical(value));}
function quoteFor(snapshot,payload) {
 let rate=null;
 const fields=snapshot.body?.encoding==='multipart'?Object.fromEntries(snapshot.body.fields.filter(f=>f.value!==undefined).map(f=>[f.name,f.value])):snapshot.body||{};
 const metadata=snapshot.metadata||{};
 let pricingModel=snapshot.model;
 if(snapshot.provider==='openai'&&['low','high'].includes(fields.quality))pricingModel+='-'+fields.quality;
 if(snapshot.provider==='google'&&['2K','4K'].includes(fields.response_format?.image_size))pricingModel+='-'+fields.response_format.image_size.toLowerCase();
 if(snapshot.provider==='meshy'&&pricingModel==='gpt-image-2'&&fields.reference_image_urls?.length)pricingModel+='-i2i';
 if(snapshot.provider==='seedance'&&snapshot.capability==='video')pricingModel='seedance-2.5'+(metadata.resolution==='720p'?'':'-'+metadata.resolution);
 if(snapshot.provider==='seedance'&&snapshot.capability==='post'&&metadata.workflow==='video-edit')pricingModel='seedance-2.5-video-edit'+(metadata.resolution==='720p'?'':'-'+metadata.resolution);
 if(snapshot.provider==='magnific')pricingModel+='@'+fields.resolution;
 try {rate=require('./provider-pricing').rateFor(snapshot.provider,snapshot.capability,pricingModel);}catch(_){}
 const count=Number(fields.n??fields.batch_size??fields.num_images??fields.num_outputs??1);
 let duration=Number(fields.duration_seconds??fields.duration??fields.duration_s??metadata.durationSeconds??metadata.duration_s);
 const sections=fields.composition_plan?.sections||fields.composition_plan?.chunks;
 if(Array.isArray(sections)&&sections.length)duration=sections.reduce((total,section)=>total+Number(section.duration_ms)/1000,0);
 if(snapshot.provider==='seedance'&&['upscale','video-edit'].includes(metadata.workflow))duration=Number(metadata.source_seconds);
 if(snapshot.provider==='magnific')duration=Number(metadata.source_seconds)*Number(metadata.source_fps)/30;
 const quantity=rate?.unit==='second'?duration:rate?.unit==='image'?count:rate?.unit==='character'?fields.text?.length:1;
 const perUSD=rate?.usd_per_unit!==undefined?rate.usd_per_unit:rate?(rate.native_per_unit||1)*(rate.usd_per_native||0):null;
 const known=perUSD!==null&&Number.isFinite(perUSD)&&Number.isFinite(quantity)&&quantity>0;
 let nativeQuote=null;
 // Higgsfield (signed in) prices each request in its own credits, from Higgsfield's quotes.
 if(snapshot.provider==='higgsfield-mcp'){const credits=require('./providers/higgsfield-mcp').creditsFor(snapshot.capability,snapshot.body||{},metadata);const usdPerCredit=require('./higgsfield-app-catalog').SNAPSHOT.credit_usd.usd_per_credit;nativeQuote=Number.isFinite(credits)?{credits,usd_per_credit:usdPerCredit,source:rate?.source}:{source:rate?.source};}
 const apiQuote=snapshot.provider==='higgsfield'?require('./higgsfield-pricing').quoteConfiguration(metadata.endpoint||String(snapshot.endpoint||'').replace(/^https:\/\/api.higgsfield.ai\//,''),{...fields,duration_seconds:duration}):null;
 const amount=apiQuote?(apiQuote.available&&Number.isFinite(quantity)&&quantity>0?Number((apiQuote.list_rate*quantity).toFixed(6)):null):nativeQuote?(Number.isFinite(nativeQuote.credits)?Number((nativeQuote.credits*(nativeQuote.usd_per_credit||.01)).toFixed(6)):null):known?Number((perUSD*quantity).toFixed(6)):null;
 const credits=nativeQuote?(Number.isFinite(nativeQuote.credits)?nativeQuote.credits:null):known&&rate?.native_unit==='credit'?quantity*(rate.native_per_unit||1):null;
 // Shared by initial metering and free recovery. A native credit estimate is
 // still an estimate; only an actual provider receipt may confirm its charge.
 const billing={model:pricingModel,unit:rate?.unit||null,quantity:Number.isFinite(quantity)&&quantity>0?quantity:null,...(Number.isFinite(nativeQuote?.credits)?{native_charged:nativeQuote.credits}:{})};
 return {kind:'estimate',amount,currency:amount!==null?'USD':null,credits,unit:rate?.unit||null,billing,source:apiQuote?.source||nativeQuote?.source||rate?.source||null,pricing_digest:hash(canonical({rate,pricingModel,quantity:Number.isFinite(quantity)?quantity:null,nativeQuote,apiQuote})),note:apiQuote?.reason||(amount!==null?'Local rate estimate; the provider reports the actual charge separately.':'Price is unknown; explicit cost consent is required.')};
}
function sourcePaths(payload) {
 const paths=new Set();
 function visit(value,key='') {
  if(typeof value==='string' && /^(file_path|path|source_path|source_image|init_image|image)$/.test(key) && !/^(data:|https?:)/.test(value) && fs.existsSync(value))paths.add(value);
  if(Array.isArray(value))value.forEach(item=>visit(item,key));
  else if(value&&typeof value==='object')for(const [k,item]of Object.entries(value))visit(item,k);
 }
 visit(payload);return [...paths].sort();
}
function assetEvidence(asset){return asset?{...semanticRow(asset),content_sha256:asset.file_path&&fs.existsSync(asset.file_path)?hash(fs.readFileSync(asset.file_path)):null}:null;}
function createFinalRequestStore(db,deps={}) {
 // Also initialize for supported lightweight stores that only install migration141.
 db.exec(fs.readFileSync(require('path').join(__dirname,'../db/migrations/145_final_request_lineage.sql'),'utf8'));
 db.exec(fs.readFileSync(require('path').join(__dirname,'../db/migrations/149_generation_transport_receipts.sql'),'utf8'));
 const now = deps.now || (()=>Date.now());
 const resolve = deps.resolve || ((provider,capability,payload)=>require('./final-provider-request').resolveFinalRequest(provider,capability,payload));
 function provenance(spec={}) {
  if(deps.provenance) return deps.provenance(spec);
  const result={};
  if(spec.production_draft)result.production_draft=require('./production-draft-request').draftEvidence(db,spec.production_draft);
  // Hash rows, including annotations, rather than timestamps or file sizes.
  if(spec.shot_id){result.shot=semanticRow(db.prepare('SELECT * FROM film_shots WHERE id=?').get(spec.shot_id)||null);result.annotations=db.prepare('SELECT * FROM film_storyboard_annotations WHERE shot_id=? ORDER BY id').all(spec.shot_id);result.selected_frame=assetEvidence(require('./selected-frame').selectedFrame(db,spec.shot_id));}
  if(spec.sequence_id){result.sequence=semanticRow(db.prepare('SELECT * FROM film_sequences WHERE id=?').get(spec.sequence_id)||null);}
  if(spec.project_id && spec.capability==='image') result.moodboard=db.prepare('SELECT * FROM film_mood_board WHERE project_id=? AND active=1 AND (image_path<>\'\' OR asset_id IS NOT NULL) ORDER BY sort_order,created_at,id').all(spec.project_id).map(semanticRow);
  if(spec.project_id) result.project=semanticRow(db.prepare('SELECT * FROM film_projects WHERE id=?').get(spec.project_id)||null);
  if(spec.world_version_id)result.world_version=semanticRow(db.prepare('SELECT * FROM film_world_versions WHERE id=?').get(spec.world_version_id)||null);
  if(spec.input_asset_id)result.input_asset=assetEvidence(db.prepare('SELECT * FROM film_assets WHERE id=?').get(spec.input_asset_id)||null);
  if(spec.inbetween_id)result.inbetween=semanticRow(db.prepare('SELECT * FROM film_inbetweens WHERE id=?').get(spec.inbetween_id)||null);
  if(spec.source_selection?.kind==='post_video')result.selected_video=assetEvidence(require('../routes/post-production').upscaleSource(spec.source_selection.shot_id,spec.source_selection.explicit_asset_id||null));
  if(spec.subject_kind&&spec.subject_id){const table={character:'film_characters',location:'film_locations',prop:'film_props'}[spec.subject_kind];if(!table)fail('Unsupported subject provenance kind',400);result.subject=semanticRow(db.prepare('SELECT * FROM '+table+' WHERE id=?').get(spec.subject_id)||null);}
  if(spec.expression_selections?.length)result.expression_selections=require('./character-expressions').selectedExpressionEvidence(db,spec.expression_selections);
  if(spec.source_shot_ids){result.source_shots=[...new Set(spec.source_shot_ids)].sort().map(id=>({shot:semanticRow(db.prepare('SELECT * FROM film_shots WHERE id=?').get(id)||null),annotations:db.prepare('SELECT * FROM film_storyboard_annotations WHERE shot_id=? ORDER BY id').all(id),selected_frame:assetEvidence(require('./selected-frame').selectedFrame(db,id))}));}
  if(spec.run_id){
   const run=db.prepare('SELECT id,flow_id,project_id,scene_id,shot_id,graph_snapshot,graph_fingerprint,params FROM film_flow_runs WHERE id=?').get(spec.run_id)||null;
   if(run){try{const params=JSON.parse(run.params);delete params.final_request_approvals;delete params.finalRequest;run.params=canonical(params);}catch(_) {}}
   result.flow_run=run;
   result.upstream_outputs=(spec.upstream_evidence_ids||[]).map(id=>db.prepare('SELECT id,node_id,node_type,branch_id,status,outputs,provider_id FROM film_flow_node_runs WHERE id=? AND run_id=?').get(id,spec.run_id)||null);
   result.branches=db.prepare('SELECT id,parent_branch_id,origin_node_id,branch_key,variant_config,selected FROM film_flow_branches WHERE run_id=? ORDER BY id').all(spec.run_id);
  }
  if(spec.flow_id){result.flow=semanticRow(db.prepare('SELECT * FROM film_flows WHERE id=?').get(spec.flow_id)||null);result.nodes=db.prepare('SELECT id,node_type,label,config FROM film_flow_nodes WHERE flow_id=? ORDER BY id').all(spec.flow_id);result.edges=db.prepare('SELECT id,from_node,from_port,to_node,to_port FROM film_flow_edges WHERE flow_id=? ORDER BY id').all(spec.flow_id);}
  result.source_paths=(spec.source_paths||[]).map(file=>({path:file,sha256:fs.existsSync(file)?hash(fs.readFileSync(file)):null}));
  return {spec, digest:hash(canonical(result))};
 }
 function row(id){const r=db.prepare('SELECT * FROM film_final_request_reviews WHERE id=?').get(id);if(!r)fail('Request review not found',404);return r;}
 // `test_mode` is read live and is not part of the fingerprinted snapshot: it says what Send will do now.
 function publicRow(r){const snapshot=JSON.parse(r.snapshot_json);return {id:r.id,fingerprint:r.fingerprint,state:r.state,snapshot,editable:JSON.parse(r.editable_json),request_id:r.request_id,result:r.result_json?JSON.parse(r.result_json):null,error:r.error,test_mode:require('./generation-test-mode').appliesTo(snapshot.provider)};}
 function valid(r){const s=JSON.parse(r.snapshot_json),p=JSON.parse(r.provenance_json);
  if(!deps.resolve && s.adapterVersion!==require('./final-provider-request').adapterVersion(s.provider))fail('Provider adapter changed. Review the request again');
  if(!['provider_quote','free_preflight'].includes(s.quote?.kind)){
   const currentQuote=deps.quote?deps.quote(s,JSON.parse(r.editable_json).payload):quoteFor(s,JSON.parse(r.editable_json).payload);
   if(s.quote?.pricing_digest!==currentQuote.pricing_digest)fail('Cost estimate changed. Review the request again');
  }
  if(s.quote?.kind==='provider_quote'&&s.quote.source_review_id){
   const source=row(s.quote.source_review_id),result=source.result_json?JSON.parse(source.result_json):null,quoted=result?.topaz_quote;
   if(source.state!=='completed'||!quoted)fail('The provider quote is not backed by a completed free preflight');
   for(const key of ['request_id','currency','amount','credits','range','raw_estimate'])if(canonical(s.quote[key])!==canonical(quoted[key]))fail('The stored provider quote changed. Review the request again');
   if(quoted.expires_at&&new Date(quoted.expires_at).getTime()<=now())fail('Provider quote expired. Review the request again');
  }
  if(s.quote?.provider_expires_at&&new Date(s.quote.provider_expires_at).getTime()<=now())fail('Provider quote expired. Review the request again');
  if(s.quote?.expires_at && new Date(s.quote.expires_at).getTime()<=now())fail('Cost quote expired. Review the request again');
  if(canonical(provenance(p.spec))!==canonical(p))fail('Project or annotation inputs changed. Review the request again');
  for(const ref of s.references||[]){if(ref.path && (!fs.existsSync(ref.path)||hash(fs.readFileSync(ref.path))!==ref.sha256))fail('Reference image changed. Review the request again');}
  return s;
 }
 async function preview(input){
  if(!input.provider||!input.capability||!input.payload)fail('Provider, capability and editable payload are required',400);
  let baseline=null;
  if(input.replaces_review_id){
   baseline=publicRow(row(input.replaces_review_id));
   if(!['preview','approved'].includes(baseline.state))fail('Only an unsent active review can be replaced');
   const originalProvenance=baseline.editable.provenance||{};
   if(input.provenance&&canonical(input.provenance)!==canonical(originalProvenance))fail('Review provenance is read-only; prepare a fresh route review for changed source inputs',400);
   input={...input,provenance:originalProvenance};
  }
  rejectSecrets(input.payload);
  const snapshot=await resolve(input.provider,input.capability,input.payload);
  if(baseline&&!['preview','approved'].includes(row(baseline.id).state))fail('The replaced review is no longer active; it was cancelled or sent');
  rejectSecrets(snapshot);
  if(baseline){
   const readOnlyFields=[...new Set([...(baseline.snapshot.metadata?.readOnlyInputFields||[]),...(snapshot.metadata?.readOnlyInputFields||[])])];
   for(const key of readOnlyFields)if(canonical(baseline.editable.payload[key])!==canonical(input.payload[key]))fail('Unsupported edit to read-only request metadata: '+key,400);
  }
  if(snapshot.provider!==input.provider||snapshot.capability!==input.capability||!snapshot.endpoint||!snapshot.adapterVersion)fail('Adapter did not resolve an explicit final request',400);
  for(const ref of snapshot.references||[]){let bytes;if(ref.path)bytes=fs.readFileSync(ref.path);else if(ref.data?.startsWith('data:'))bytes=Buffer.from(ref.data.split(',')[1],'base64');else if(ref.data)bytes=Buffer.from(ref.data,'base64');if(!bytes)fail('Reference bytes must be resolved before approval',400);const digest=hash(bytes);if(ref.sha256&&ref.sha256!==digest)fail('Reference hash mismatch',400);ref.sha256=digest;ref.byte_length=bytes.length;ref.order=ref.order||snapshot.references.indexOf(ref)+1;ref.wire_role=ref.wire_role||ref.role;}
  if(['provider_quote','free_preflight'].includes(snapshot.quote?.kind)){
   const quote={...snapshot.quote};
   if(quote.kind==='provider_quote'&&(!quote.request_id||!quote.currency||(quote.amount==null&&quote.credits==null&&quote.range==null)))fail('The provider quote is missing its native price or range, currency or request handle',400);
   if(quote.kind==='free_preflight'&&quote.amount!==0)fail('A free preflight must explicitly cost zero',400);
   const localExpiry=now()+15*60*1000;
   const requestedExpiry=quote.expires_at?new Date(quote.expires_at).getTime():localExpiry;
   if(!Number.isFinite(requestedExpiry))fail('Provider quote has an invalid expiry',400);
   quote.expires_at=new Date(Math.min(localExpiry,requestedExpiry)).toISOString();
   const quoted={...quote};delete quoted.quote_digest;quote.quote_digest=hash(canonical(quoted));snapshot.quote=quote;
  }else snapshot.quote={...(deps.quote?deps.quote(snapshot,input.payload):quoteFor(snapshot,input.payload)),expires_at:new Date(now()+15*60*1000).toISOString()};
  const reviewProvenance={...(input.provenance||{}),capability:input.capability,base_provider:input.provenance?.base_provider||input.provider,base_payload_digest:input.provenance?.base_payload_digest||payloadDigest(input.payload,input.provenance)};
  if(reviewProvenance.run_id && !Array.isArray(reviewProvenance.upstream_evidence_ids))reviewProvenance.upstream_evidence_ids=db.prepare("SELECT id FROM film_flow_node_runs WHERE run_id=? AND status='complete' ORDER BY id").all(reviewProvenance.run_id).map(row=>row.id);
  reviewProvenance.source_paths=[...new Set([...(input.provenance?.source_paths||[]),...sourcePaths(input.payload),...(snapshot.references||[]).filter(ref=>ref.path).map(ref=>ref.path)])].sort();
  reviewProvenance.item_identity=reviewProvenance.item_identity||hash(canonical(reviewProvenance));
  const p=provenance(reviewProvenance),id=crypto.randomUUID(),fingerprint=hash(canonical({snapshot,provenance:p}));
  db.transaction(()=>{
   db.prepare('INSERT INTO film_final_request_reviews (id,fingerprint,snapshot_json,editable_json,provenance_json) VALUES (?,?,?,?,?)').run(id,fingerprint,canonical(snapshot),canonical({provider:input.provider,capability:input.capability,payload:input.payload,provenance:reviewProvenance}),canonical(p));
   const lineage=input.replaces_review_id&&db.prepare('SELECT root_id FROM film_final_request_review_lineage WHERE review_id=?').get(input.replaces_review_id);
   db.prepare('INSERT INTO film_final_request_review_lineage (review_id,parent_id,root_id) VALUES (?,?,?)').run(id,input.replaces_review_id||null,lineage?.root_id||input.replaces_review_id||id);
  }).immediate();
  return publicRow(row(id));
 }
 const approveTransaction=db.transaction((id,input)=>{const r=row(id);if(r.state!=='preview')fail('Only a fresh review can be approved');
  // Manual vendors: the review is the deliverable. Copy it; nothing is sent.
  {const snap=JSON.parse(r.snapshot_json);require('./manual-generation').assertSendable(snap.provider,snap.capability);}if(input.human_confirmed!==true||input.fingerprint!==r.fingerprint)fail('Approve the last visible request fingerprint');const approvedSnapshot=valid(r);if(approvedSnapshot.quote.amount===null&&approvedSnapshot.quote.credits==null&&approvedSnapshot.quote.range==null&&input.cost_unknown_ack!==true)fail('Explicit approval of the unknown provider cost is required');const root=db.prepare('SELECT root_id FROM film_final_request_review_lineage WHERE review_id=?').get(id)?.root_id||id;db.prepare("UPDATE film_final_request_reviews SET state='cancelled',updated_at=CURRENT_TIMESTAMP WHERE state IN ('preview','approved') AND id<>? AND (id=? OR id IN (SELECT review_id FROM film_final_request_review_lineage WHERE root_id=?))").run(id,root,root);db.prepare("UPDATE film_final_request_reviews SET state='approved',approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='preview'").run(id);return {id,fingerprint:r.fingerprint};});
 function approve(id,input){return approveTransaction.immediate(id,input);}
 const claimTransaction=db.transaction((token,provider,capability)=>{const r=row(token?.id);if(token.fingerprint!==r.fingerprint)fail('Request approval fingerprint does not match');const s=valid(r);if(s.provider!==provider||s.capability!==capability)fail('Provider or capability changed after approval');if(['submitted','completed'].includes(r.state))return {snapshot:s,replay:true,request_id:r.request_id,state:r.state,result:r.result_json?JSON.parse(r.result_json):null};if(r.state!=='approved')fail('Final request approval is required; an uncertain submission cannot be retried');db.prepare("UPDATE film_final_request_reviews SET state='submitting',updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='approved'").run(r.id);return {snapshot:s,replay:false,state:'submitting',id:r.id};});
 function claim(token,provider,capability){if(!token?.id)fail('Final editable request review and approval are required',428);return claimTransaction.immediate(token,provider,capability);}
 function submitted(id,handle,details={}){if(!handle)fail('Provider request handle is required');const r=row(id),result=r.result_json?JSON.parse(r.result_json):{};if(details.jobMeta)result._final_request_receipt={job_meta:details.jobMeta};db.prepare("UPDATE film_final_request_reviews SET state='submitted',request_id=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state IN ('submitting','submitted')").run(String(handle),canonical(result),id);}
 function complete(id,result,details={}){const r=row(id),receipt=(r.result_json?JSON.parse(r.result_json)._final_request_receipt:null)||(details.jobMeta?{job_meta:details.jobMeta}:null);db.prepare("UPDATE film_final_request_reviews SET state='completed',result_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state IN ('submitting','submitted')").run(canonical(receipt?{...result,_final_request_receipt:receipt}:result),id);}
 function uncertain(id,error){db.prepare("UPDATE film_final_request_reviews SET state='uncertain',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='submitting'").run(String(error||'Provider acceptance is unknown'),id);}
 const cancelTransaction=db.transaction(id=>{const r=row(id);if(!['preview','approved','cancelled'].includes(r.state))fail('Already sent; cancellation cannot undo provider submission');const root=db.prepare('SELECT root_id FROM film_final_request_review_lineage WHERE review_id=?').get(id)?.root_id||id;db.prepare("UPDATE film_final_request_reviews SET state='cancelled',updated_at=CURRENT_TIMESTAMP WHERE state IN ('preview','approved') AND (id=? OR id IN (SELECT review_id FROM film_final_request_review_lineage WHERE root_id=?))").run(root,root);return publicRow(row(id));});
 function cancel(id){return cancelTransaction.immediate(id);}
 function recordTransport(id,receipt){
  const r=row(id);if(r.state!=='submitting')fail('Only a claimed unsent review may record creative transport');
  const snapshot=JSON.parse(r.snapshot_json);if(receipt.endpoint!==snapshot.endpoint)fail('Transport endpoint changed after approval');
  rejectSecrets(receipt.body);
  const receiptId=crypto.randomUUID();
  db.prepare('INSERT INTO film_generation_transport_receipts(id,review_id,endpoint,method,body_json,serialized_body,serialized_base64,body_sha256,references_json,redactions_json,serialization_exact,sent_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(receiptId,id,receipt.endpoint,receipt.method,canonical(receipt.body),receipt.serialized_body,receipt.serialized_base64,receipt.body_sha256,canonical(receipt.references),canonical(receipt.redactions||[]),receipt.serialization_exact===false?0:1,receipt.sent_at);
  return receiptId;
 }
 function settleTransport(id,state,status){db.prepare('UPDATE film_generation_transport_receipts SET state=?,http_status=?,finished_at=CURRENT_TIMESTAMP WHERE id=? AND state=\'http_attempt\'').run(state,status??null,id);}
 return {preview,approve,claim,submitted,complete,uncertain,cancel,recordTransport,settleTransport,get:id=>publicRow(row(id)),validate:id=>valid(row(id))};
}
let singleton;
function store(){return singleton||(singleton=createFinalRequestStore(require('../db/database').db));}
function runWithApprovals(approvals,fn){return execution.run({approvals:Array.isArray(approvals)?approvals:[]},fn);}
function enterExecutionContext(approvals,originalBody={}){execution.enterWith({approvals:Array.isArray(approvals)?approvals:[],originalBody});}
function getExecutionContext(){return execution.getStore()||{approvals:[]};}
async function authorizeGeneration(input){return authorizeWithStore(store(),input);}
async function authorizeWithStore(s,{provider,capability,payload,provenance={},opts={},approvals}){
 // A REGISTERED kept provider this review cannot describe (the local Gridlight
 // gateway, local tools) is not a manual vendor and has no paid request to freeze:
 // it runs directly. Anything else still needs its review.
 if(require('./providers').get(provider)&&!require('./manual-generation').isManual(provider,capability)&&!Object.prototype.hasOwnProperty.call(require('./final-provider-request').REVIEW_PROVIDER_MODULES,provider))return {ok:true,bypass:true,provider,capability};
 const tokens=opts.finalRequest?[opts.finalRequest]:(approvals||getExecutionContext().approvals);
 let alreadySent=null;
 for(const token of tokens){
  const reviewed=s.get(token.id);
  if(reviewed.fingerprint!==token.fingerprint)continue;
  const context=reviewed.editable.provenance||{};
  if((context.base_provider||reviewed.snapshot.provider)!==provider||reviewed.snapshot.capability!==capability)continue;
  if(context.default_seed && getExecutionContext().originalBody?.seed!=null)continue;
  if(context.base_payload_digest!==payloadDigest(payload,context))continue;
  if(provenance.shot_id && context.shot_id!==provenance.shot_id)continue;
  if(provenance.project_id && context.project_id!==provenance.project_id)continue;
  if(provenance.production_draft && canonical(context.production_draft)!==canonical(provenance.production_draft))continue;
  if(['node_id','leg_index','item_index','station_index','sequence_id','run_id','branch_id','subject_kind','subject_id','view','world_version_id','inbetween_id','frame_index','slot_id','expression_slot_id','expression','item_identity'].some(key=>provenance[key]!==undefined&&context[key]!==provenance[key]))continue;
  if(['submitted','completed'].includes(reviewed.state)){alreadySent={ok:false,status:409,error:'This request was already sent. Resume its existing job instead of Send.',existing_review:reviewed.id,request_id:reviewed.request_id};continue;}
  if(reviewed.state!=='approved')continue;
  // An approval stored before manual generation must not send either.
  if(require('./manual-generation').isManual(reviewed.snapshot.provider,reviewed.snapshot.capability)){const e=require('./manual-generation').manualError(reviewed.snapshot.provider);return {ok:false,status:e.status,code:e.code,error:e.message};}
  const frozen=s.validate(token.id);
  return {ok:true,snapshot:frozen,approvalId:token.id,finalRequest:token};
 }
 if(alreadySent)return alreadySent;
 const review=await s.preview({provider,capability,payload,provenance});
 return {ok:false,status:428,error:'FINAL_REQUEST_REVIEW_REQUIRED:'+review.id,review};
}
async function preflightApprovals({path,body={},prepare,reviewStore}) {
 const tokens=body.final_request_approvals;
 if(!Array.isArray(tokens)||!tokens.length)fail('Approve every final provider request before Send');
 const s=reviewStore||store();
 const seen=new Set();
 // Check every approval before any planner or route side effects.
 for(const token of tokens){
  if(seen.has(token.id))fail('Duplicate approvals cannot cover separate generation items');
  seen.add(token.id);
  const row=s.get(token.id);
  if(tokens.length>1&&row.snapshot.provider==='topaz'&&row.snapshot.quote?.kind==='free_preflight')fail('A native Topaz quote preflight must be reviewed separately. Mixed or multiple quote-stage batches are not available; nothing was submitted.',422);
  if(row.fingerprint!==token.fingerprint)fail('A final request approval fingerprint changed');
  if(['submitted','completed'].includes(row.state))fail('This request was already sent. Resume its existing job instead of Send.',409,{existing_review:row.id,request_id:row.request_id});
  if(row.state!=='approved')fail('A final request approval was cancelled, changed or not approved');
  s.validate(token.id);
 }
 const plan=await (prepare||require('./final-request-plans').prepare)({path,body});
 const items=Array.isArray(plan)?plan:plan.items;
 if(!Array.isArray(items)||items.length!==tokens.length)fail('Every generation item requires its own final approval');
 const available=[...tokens];
 for(const item of items){
  const result=await authorizeWithStore(s,{...item,provider:item.provider||item.provider_id,approvals:available});
  if(!result.ok)fail('A generation item changed or has no matching final approval');
  available.splice(available.findIndex(token=>token.id===result.approvalId),1);
 }
 return {ok:true,count:items.length};
}
/*
 * The original file behind one reviewed reference, for the manual hand-over:
 * the vendor's web app takes the full-resolution source, not the bytes this app
 * would have encoded for the API. Only a path the review itself recorded is served.
 */
const MEDIA_EXT=/\.(png|jpe?g|webp|gif|tiff?|exr|mp4|mov|m4v|webm|wav|mp3|m4a|aac|flac|ogg|glb|gltf|fbx|obj|usdz)$/i;
// Where originals may come from: the app's data folder and each project's own folder.
function mediaRoots(){
 const roots=[require('./data-paths').DATA_DIR];
 try{for(const r of require('../db/database').db.prepare("SELECT assets_dir FROM film_projects WHERE assets_dir IS NOT NULL AND assets_dir <> ''").all())roots.push(r.assets_dir);}catch(_){}
 return roots.filter(Boolean);
}
function originalReference(s,id,order,opts={}){
 const ref=(s.get(id).snapshot.references||[]).find(r=>Number(r.order)===Number(order));
 const recorded=ref&&(ref.source_path||ref.path);
 // A recorded path can come from a client-built review, so it is served only when
 // its real location (symlinks and '..' resolved) is a media file inside a root.
 let file=null;
 try{if(recorded&&fs.existsSync(recorded))file=fs.realpathSync(recorded);}catch(_){file=null;}
 const path=require('path');
 const inside=file&&(opts.roots||mediaRoots()).some(root=>{try{const r=fs.realpathSync(root);return file===r||file.startsWith(r+path.sep);}catch(_){return false;}});
 if(!file||!inside||!MEDIA_EXT.test(file)||!fs.statSync(file).isFile())fail('No original file is recorded for this reference',404);
 const ext=path.extname(file)||({'image/png':'.png','image/jpeg':'.jpg','video/mp4':'.mp4','audio/wav':'.wav','audio/mpeg':'.mp3'})[ref.mime]||'';
 const label=String(ref.tag||ref.name||ref.role||'reference').replace(/[^a-z0-9_-]+/gi,'-');
 return {file,mime:ref.mime||'application/octet-stream',name:`${String(ref.order).padStart(2,'0')}-${label}${ext}`};
}
module.exports={originalReference,createFinalRequestStore,store,canonical,hash,runWithApprovals,enterExecutionContext,getExecutionContext,authorizeGeneration,authorizeWithStore,semanticRow,payloadDigest,quoteFor,preflightApprovals,sourcePaths};
