const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
process.env.RUNWAY_API_KEY='mock-only';
process.env.MUAPI_POLL_MS='1';
const credential=require('../lib/providers/credentials');
credential.getCredential=()=>({apiKey:'mock-only',meta:{}});
const Database=require('better-sqlite3');
const db=new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/141_final_request_reviews.sql'),'utf8'));
const contract=require('../lib/final-request-review');
const store=contract.createFinalRequestStore(db,{provenance:spec=>({spec,digest:'unchanged-fixture'})});
contract.store=()=>store;
contract.authorizeGeneration=input=>contract.authorizeWithStore(store,input);
const providers=require('../lib/providers');
const fallback=require('../lib/image-fallback');
const baseAdapter=providers.get('muapi');
const started=[],attached=[],meterInputs=[],settled=[];
const progress=require('../lib/generation-progress');
progress.start=spec=>{const id='fixture-job-'+(started.length+1);started.push({id,...spec});return id;};
progress.attachHandle=(id,handle,meta)=>{attached.push({id,handle,meta});return id;};
progress.report=()=>{};progress.flush=()=>{};
const jobs=require('../lib/generation-jobs');
jobs.fail=(id,error)=>settled.push({id,error});jobs.complete=id=>settled.push({id,ok:true});
const originalMetered=providers.metered;
providers.metered=(adapter,cfg)=>{const wrapped=originalMetered(adapter,cfg),generate=wrapped.generate.bind(wrapped);wrapped.generate=(cap,payload,opts)=>{meterInputs.push({provider:adapter.id,payload:structuredClone(payload)});return generate(cap,payload,opts);};return wrapped;};

test('mixed batch preserves original item composition and sends each approved provider exactly once',async()=>{
 const config=id=>({__project_id:'fixture-project',__shot_id:id});
 const inputs=[{id:'shot-a',prompt:'Original first shot'},{id:'shot-b',prompt:'Original second shot'}];
 const originals=[];
 for(const input of inputs){
  const preview=await fallback.runImageFallbackChain([baseAdapter],{prompt:input.prompt,width:1280,height:720},{previewRequest:true,projectConfig:config(input.id)});
  originals.push(await store.preview({provider:'muapi',capability:'image',payload:preview.payload,provenance:{project_id:'fixture-project',shot_id:input.id}}));
 }
 const changed=await store.preview({provider:'runway',capability:'image',payload:{...originals[1].editable.payload,model:'gen4_image',final_prompt:'Edited second shot exact full prompt'},provenance:originals[1].editable.provenance});
 assert.equal(changed.editable.provenance.base_provider,'muapi');
 const chosen=[originals[0],changed];
 const approvals=chosen.map(review=>store.approve(review.id,{fingerprint:review.fingerprint,human_confirmed:true,cost_unknown_ack:true}));
 const posts=[];const originalFetch=global.fetch;
 global.fetch=async(url,init={})=>{
  if(init.method==='POST'){
   posts.push({url:String(url),body:JSON.parse(init.body)});
   return{ok:true,status:200,json:async()=>({request_id:'mock-muapi-handle',id:'mock-runway-handle'})};
  }
  return{ok:true,status:200,json:async()=>({status:'FAILED',failure:'mock stops after transport verification',error:'mock failed'})};
 };
 try{
  const composed=[];const results=[];
  await contract.runWithApprovals(approvals,async()=>{
   for(const input of inputs)results.push(await fallback.runImageFallbackChain([baseAdapter],adapter=>{composed.push(adapter.id);return{prompt:input.prompt,width:1280,height:720};},{projectConfig:config(input.id),timeout:200}));
  });
  assert.deepEqual(composed,['muapi','muapi']);
  assert.deepEqual(results.map(r=>r.provider),['muapi','runway']);
  assert.equal(posts.length,2);
  assert.deepEqual(started.map(j=>j.provider),['muapi','runway']);
  assert.equal(attached.length,2);assert.equal(settled.length,2);
  assert.deepEqual(meterInputs.map(item=>item.provider),['muapi','runway']);
  assert.deepEqual(meterInputs.map(item=>item.payload.model),chosen.map(review=>review.snapshot.model));
  assert.equal(meterInputs[1].payload.prompt,'Edited second shot exact full prompt');
  assert.equal(attached[1].meta.provider_model,'gen4_image');
  assert.equal(attached[1].meta.price_kind,'estimate');
  assert.equal(attached[1].meta.approved_cost_quote.kind,'estimate');
  for(let i=0;i<2;i++){assert.equal(posts[i].url,chosen[i].snapshot.endpoint);assert.deepEqual(posts[i].body,chosen[i].snapshot.body);}
  assert.match(posts[1].url,/runway/);
  assert.equal(posts[1].body.promptText,'Edited second shot exact full prompt');
  assert.equal(store.get(chosen[0].id).state,'submitted');
  assert.equal(store.get(chosen[1].id).state,'submitted');
  for(let i=0;i<2;i++){const replay=await fallback.runImageFallbackChain([baseAdapter],{prompt:inputs[i].prompt,width:1280,height:720},{projectConfig:config(inputs[i].id),finalRequest:approvals[i]});assert.equal(replay.status,409);assert.match(replay.error,/already sent/);}
  assert.equal(posts.length,2);assert.equal(started.length,2);
 }finally{global.fetch=originalFetch;}
});
test.after(()=>db.close());
