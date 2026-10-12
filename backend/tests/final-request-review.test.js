const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const Database=require('better-sqlite3');
const {createFinalRequestStore,canonical}=require('../lib/final-request-review');
function fixture(){const db=new Database(':memory:');db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/141_final_request_reviews.sql'),'utf8'));let revision=1,time=Date.now();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'final-review-'));const file=path.join(dir,'source.png');fs.writeFileSync(file,'AAAA');const resolve=async(provider,capability,payload)=>({provider,capability,endpoint:'/exact/model',adapterVersion:'fixture1',body:{prompt:payload.prompt,model:payload.model,options:payload.options},references:[{path:file,data:'data:image/png;base64,'+fs.readFileSync(file).toString('base64'),role:'first',mime:'image/png'}]});const s=createFinalRequestStore(db,{resolve,now:()=>time,provenance:spec=>({spec,digest:String(revision)})});return {s,db,file,dir,change:()=>revision++,expire:()=>time+=10000000};}
const input={provider:'fixture',capability:'image',payload:{prompt:'Full approved prompt',model:'specific',options:{audio:false}}};
function approve(f,r){return f.s.approve(r.id,{fingerprint:r.fingerprint,human_confirmed:true,cost_unknown_ack:true});}
test('full immutable request is canonical, explicit consent and exact token required',async()=>{const f=fixture(),r=await f.s.preview(input);assert.equal(r.snapshot.body.prompt,input.payload.prompt);assert.ok(r.snapshot.references[0].sha256);assert.throws(()=>f.s.approve(r.id,{fingerprint:r.fingerprint}),/Approve/);assert.throws(()=>f.s.claim(null,'fixture','image'),/required/);const token=approve(f,r),claim=f.s.claim(token,'fixture','image');assert.equal(canonical(claim.snapshot),canonical(r.snapshot));assert.throws(()=>f.s.claim(token,'fixture','image'),/uncertain/);f.db.close();fs.rmSync(f.dir,{recursive:true});});
test('same size reference changes, concurrent provenance edits and expiry invalidate approval',async()=>{for(const mutation of ['file','provenance','expiry']){const f=fixture(),r=await f.s.preview(input),token=approve(f,r);if(mutation==='file')fs.writeFileSync(f.file,'BBBB');if(mutation==='provenance')f.change();if(mutation==='expiry')f.expire();assert.throws(()=>f.s.claim(token,'fixture','image'),/changed|expired/);f.db.close();fs.rmSync(f.dir,{recursive:true});}});
test('cancel submits nothing; uncertain acceptance blocks retry; handle replay never claims again',async()=>{const f=fixture(),r=await f.s.preview(input);f.s.cancel(r.id);assert.throws(()=>f.s.claim({id:r.id,fingerprint:r.fingerprint},'fixture','image'),/required/);const r2=await f.s.preview(input),t=approve(f,r2);f.s.claim(t,'fixture','image');f.s.uncertain(r2.id,'mock interrupted');assert.throws(()=>f.s.claim(t,'fixture','image'),/uncertain/);const r3=await f.s.preview(input),t3=approve(f,r3);f.s.claim(t3,'fixture','image');f.s.submitted(r3.id,'upstream1');assert.equal(f.s.claim(t3,'fixture','image').replay,true);f.s.complete(r3.id,{ok:true});assert.deepEqual(f.s.claim(t3,'fixture','image').result,{ok:true});f.db.close();fs.rmSync(f.dir,{recursive:true});});
test('provider switch, fingerprint edit and credentials fail closed',async()=>{const f=fixture(),r=await f.s.preview(input),t=approve(f,r);assert.throws(()=>f.s.claim(t,'fallback','image'),/changed/);assert.throws(()=>f.s.claim({...t,fingerprint:'edited'},'fixture','image'),/fingerprint/);await assert.rejects(f.s.preview({...input,payload:{api_key:'fixture-secret'}}),/Credentials/);f.db.close();fs.rmSync(f.dir,{recursive:true});});
test('batch tokens select exact original item while approved edits remain immutable',async()=>{
 const f=fixture(),{authorizeWithStore}=require('../lib/final-request-review');
 const second={...input,payload:{...input.payload,prompt:'Distinct second batch item'}};
 const a=await f.s.preview(input),b=await f.s.preview(second);
 const edited=await f.s.preview({...b.editable,payload:{...b.editable.payload,prompt:'User edited visible final prompt'}});
 assert.equal(edited.editable.provenance.base_payload_digest,b.editable.provenance.base_payload_digest);
 const tokens=[approve(f,a),approve(f,edited)];
 const chosen=await authorizeWithStore(f.s,{provider:'fixture',capability:'image',payload:second.payload,approvals:tokens});
 assert.equal(chosen.approvalId,edited.id);assert.equal(chosen.snapshot.body.prompt,'User edited visible final prompt');
 const changed=await authorizeWithStore(f.s,{provider:'fixture',capability:'image',payload:{...second.payload,options:{audio:true}},approvals:tokens});
 assert.equal(changed.ok,false);assert.match(changed.error,/FINAL_REQUEST_REVIEW_REQUIRED/);
 f.db.close();fs.rmSync(f.dir,{recursive:true});
});
test('only generated default seed varies; explicit options and semantic edits remain bound',async()=>{
 const f=fixture(),{authorizeWithStore,semanticRow}=require('../lib/final-request-review');
 const seeded={...input,payload:{...input.payload,seed:123},provenance:{default_seed:true}};
 const r=await f.s.preview(seeded),token=approve(f,r);
 const result=await authorizeWithStore(f.s,{provider:'fixture',capability:'image',payload:{...seeded.payload,seed:999},approvals:[token]});
 assert.equal(result.ok,true);assert.equal(result.snapshot.body.prompt,input.payload.prompt);
 assert.deepEqual(semanticRow({status:'generating',updated_at:'new',description:'semantic',provider_config:'keep'}),{description:'semantic',provider_config:'keep'});
 assert.notDeepEqual(semanticRow({status:'idle',description:'first'}),semanticRow({status:'generating',description:'changed'}));
 f.db.close();fs.rmSync(f.dir,{recursive:true});
});
test('unknown costs need explicit consent and changed pricing requires another review',async()=>{
 const f=fixture();let amount=null,version=1;
 const s=createFinalRequestStore(f.db,{resolve:async(provider,capability,payload)=>({provider,capability,endpoint:'/exact',adapterVersion:'v1',body:payload,references:[]}),provenance:spec=>({spec}),quote:()=>({kind:'estimate',amount,currency:amount===null?null:'USD',pricing_digest:String(version)})});
 const unknown=await s.preview(input);
 assert.throws(()=>s.approve(unknown.id,{fingerprint:unknown.fingerprint,human_confirmed:true}),/unknown provider cost/);
 s.approve(unknown.id,{fingerprint:unknown.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 amount=.12;version++;
 assert.throws(()=>s.claim({id:unknown.id,fingerprint:unknown.fingerprint},'fixture','image'),/estimate changed/);
 const known=await s.preview(input);assert.equal(known.snapshot.quote.amount,.12);
 assert.doesNotThrow(()=>s.approve(known.id,{fingerprint:known.fingerprint,human_confirmed:true}));
 f.db.close();fs.rmSync(f.dir,{recursive:true});
});
test('batch preflight rejects cancelled last item, partial approval and duplicate token before execution',async()=>{
 const f=fixture(),{preflightApprovals}=require('../lib/final-request-review');
 const inputs=[input,{...input,payload:{...input.payload,prompt:'two'}},{...input,payload:{...input.payload,prompt:'three'}}];
 const reviews=await Promise.all(inputs.map(i=>f.s.preview(i))),tokens=reviews.map(r=>approve(f,r));
 let planned=0;const prepare=async()=>{planned++;return{items:inputs};};
 await preflightApprovals({path:'/batch',body:{final_request_approvals:tokens},prepare,reviewStore:f.s});
 assert.equal(planned,1);f.s.cancel(reviews[2].id);
 await assert.rejects(preflightApprovals({path:'/batch',body:{final_request_approvals:tokens},prepare,reviewStore:f.s}),/cancelled/);assert.equal(planned,1);
 await assert.rejects(preflightApprovals({path:'/batch',body:{final_request_approvals:tokens.slice(0,2)},prepare,reviewStore:f.s}),/Every generation item/);
 await assert.rejects(preflightApprovals({path:'/batch',body:{final_request_approvals:[tokens[0],tokens[0],tokens[1]]},prepare,reviewStore:f.s}),/Duplicate/);
 f.db.close();fs.rmSync(f.dir,{recursive:true});
});
test('per-item approved provider edits preserve original binding and distinct node identities',async()=>{
 const f=fixture(),{authorizeWithStore,preflightApprovals}=require('../lib/final-request-review');
 const first={...input,provenance:{node_id:'first'}},second={...input,payload:{...input.payload,prompt:'second'},provenance:{node_id:'second'}};
 const a=await f.s.preview(first),b=await f.s.preview(second);
 const edited=await f.s.preview({...b.editable,provider:'chosen-provider'});
 assert.equal(edited.editable.provenance.base_provider,'fixture');assert.equal(edited.snapshot.provider,'chosen-provider');
 const tokens=[approve(f,a),approve(f,edited)];
 const chosen=await authorizeWithStore(f.s,{...second,approvals:tokens});assert.equal(chosen.ok,true);assert.equal(chosen.snapshot.provider,'chosen-provider');
 const unsigned=await authorizeWithStore(f.s,{...second,provider:'unsigned-change',approvals:tokens});assert.equal(unsigned.ok,false);
 const wrongNode=await authorizeWithStore(f.s,{...second,provenance:{node_id:'wrong'},approvals:tokens});assert.equal(wrongNode.ok,false);
 const result=await preflightApprovals({path:'/flow',body:{final_request_approvals:tokens},prepare:async()=>({items:[first,second]}),reviewStore:f.s});assert.equal(result.count,2);
 f.db.close();fs.rmSync(f.dir,{recursive:true});
});
test('completed Send is refused before planner and guard returns existing handle for resume',async()=>{
 const f=fixture(),{authorizeWithStore,preflightApprovals}=require('../lib/final-request-review');
 const r=await f.s.preview(input),token=approve(f,r);f.s.claim(token,'fixture','image');f.s.submitted(r.id,'existing-upstream');
 let plans=0;
 await assert.rejects(preflightApprovals({path:'/generate',body:{final_request_approvals:[token]},reviewStore:f.s,prepare:async()=>{plans++;return{items:[input]};}}),error=>error.status===409&&error.existing_review===r.id&&error.request_id==='existing-upstream');
 assert.equal(plans,0);
 const gate=await authorizeWithStore(f.s,{...input,approvals:[token]});assert.equal(gate.ok,false);assert.equal(gate.request_id,'existing-upstream');assert.equal(gate.status,409);
 assert.equal(f.s.claim(token,'fixture','image').replay,true);
 f.db.close();fs.rmSync(f.dir,{recursive:true});
});
test('adapter provider quote survives preview and fingerprint binds price, handle and expiry',async()=>{
 const f=fixture();let time=Date.now(),amount=7;
 const resolve=async(provider,capability,payload)=>({provider,capability,endpoint:'/paid-accept',adapterVersion:'v1',body:{request_id:'quoted-job',accept:true},references:[],quote:{kind:'provider_quote',amount,currency:'USD',credits:null,request_id:'quoted-job',provider_expires_at:new Date(time+60000).toISOString(),raw_estimate:{cost:amount},expires_at:new Date(time+60000).toISOString()}});
 const s=createFinalRequestStore(f.db,{resolve,now:()=>time,provenance:spec=>({spec})});
 const a=await s.preview({...input,quote:{amount:0,currency:'fake'}});
 assert.equal(a.snapshot.quote.amount,7);assert.equal(a.snapshot.quote.currency,'USD');assert.equal(a.snapshot.quote.request_id,'quoted-job');assert.equal(a.snapshot.quote.kind,'provider_quote');assert.ok(a.snapshot.quote.quote_digest);
 s.approve(a.id,{fingerprint:a.fingerprint,human_confirmed:true});
 amount=8;const b=await s.preview(input);assert.notEqual(b.fingerprint,a.fingerprint);
 time+=60001;assert.throws(()=>s.claim({id:a.id,fingerprint:a.fingerprint},'fixture','image'),/quote expired/);
 const free=createFinalRequestStore(f.db,{resolve:async(provider,capability,payload)=>({provider,capability,endpoint:'/free-create',adapterVersion:'v1',body:payload,references:[],quote:{kind:'free_preflight',amount:0,currency:'USD',credits:0}}),provenance:spec=>({spec})});
 const c=await free.preview(input);assert.equal(c.snapshot.quote.amount,0);assert.doesNotThrow(()=>free.approve(c.id,{fingerprint:c.fingerprint,human_confirmed:true}));
 f.db.close();fs.rmSync(f.dir,{recursive:true});
});
test('paid Topaz credit range is backed by immutable completed free quote and expires',async()=>{
 const f=fixture();let time=Date.now(),quotedReviewId;
 const quote={kind:'provider_quote',estimate:true,amount:null,currency:'credits',credits:[2,4],range:[2,4],unit:'credits',request_id:'topaz-quoted',raw_estimate:{cost:[2,4]},expires_at:new Date(time+60000).toISOString()};
 const s=createFinalRequestStore(f.db,{resolve:async(provider,capability,payload)=>({provider,capability,endpoint:payload.accept?'/accept':'/free-create',adapterVersion:'v1',body:payload,references:[],quote:payload.accept?{...quote,source_review_id:quotedReviewId}:{kind:'free_preflight',amount:0,currency:'USD',credits:0}}),now:()=>time,provenance:spec=>({spec})});
 const initial=await s.preview(input);quotedReviewId=initial.id;const initialToken=s.approve(initial.id,{fingerprint:initial.fingerprint,human_confirmed:true});s.claim(initialToken,'fixture','image');s.complete(initial.id,{topaz_quote:quote});
 const paid=await s.preview({...input,payload:{...input.payload,accept:true}});assert.deepEqual(paid.snapshot.quote.credits,[2,4]);assert.equal(paid.snapshot.quote.amount,null);
 const token=s.approve(paid.id,{fingerprint:paid.fingerprint,human_confirmed:true});
 const changed={...quote,credits:[2,5]};f.db.prepare('UPDATE film_final_request_reviews SET result_json=? WHERE id=?').run(JSON.stringify({topaz_quote:changed}),initial.id);
 assert.throws(()=>s.claim(token,'fixture','image'),/stored provider quote changed/);
 f.db.close();fs.rmSync(f.dir,{recursive:true});
});
test('identical original payloads select a fresh scoped item instead of a consumed sibling',async()=>{
 const f=fixture(),{authorizeWithStore}=require('../lib/final-request-review');
 const first=await f.s.preview({...input,provenance:{subject_kind:'character',subject_id:'actor',view:'front',item_index:0}}),second=await f.s.preview({...input,provenance:{subject_kind:'character',subject_id:'actor',view:'back',item_index:1}});
 const tokens=[approve(f,first),approve(f,second)];f.s.claim(tokens[0],'fixture','image');f.s.submitted(first.id,'first-handle');
 const selected=await authorizeWithStore(f.s,{...input,provenance:{subject_kind:'character',subject_id:'actor',view:'back',item_index:1},approvals:tokens});assert.equal(selected.ok,true);assert.equal(selected.approvalId,second.id);
 const unknown=await authorizeWithStore(f.s,{...input,provenance:{subject_kind:'character',subject_id:'actor',view:'unknown',item_index:1},approvals:tokens});assert.equal(unknown.ok,false);assert.match(unknown.error,/REVIEW_REQUIRED/);
 f.db.close();fs.rmSync(f.dir,{recursive:true});
});
test('replacement reviews reject read-only metadata and provenance edits while preserving native prompt edits',async()=>{
 const f=fixture();
 const s=createFinalRequestStore(f.db,{resolve:async(provider,capability,payload)=>({provider,capability,endpoint:'/exact',adapterVersion:'v1',body:{prompt:payload.prompt},references:[],metadata:{readOnlyInputFields:['num_frames']}}),provenance:spec=>({spec})});
 const original=await s.preview({...input,payload:{...input.payload,num_frames:120}});
 const edited=await s.preview({...original.editable,replaces_review_id:original.id,payload:{...original.editable.payload,prompt:'Native editable full prompt'}});assert.equal(edited.snapshot.body.prompt,'Native editable full prompt');
 await assert.rejects(s.preview({...original.editable,replaces_review_id:original.id,payload:{...original.editable.payload,num_frames:240}}),/read-only request metadata/);
 await assert.rejects(s.preview({...original.editable,replaces_review_id:original.id,payload:{prompt:'Dropped readonly'},provenance:{...original.editable.provenance,base_payload_digest:'forged'}}),/provenance is read-only/);
 f.db.close();fs.rmSync(f.dir,{recursive:true});
});
