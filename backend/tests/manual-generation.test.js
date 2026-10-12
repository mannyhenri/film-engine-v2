// Manual generation: Film Engine prepares the exact prompt and assets, the user
// generates on the vendor's own site. No creative request may leave the app for
// a manual vendor, whichever road it takes. Set-based: every registered adapter
// and every reviewable provider is classified, so a new one cannot slip through.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const Database=require('better-sqlite3');
const manual=require('../lib/manual-generation');
const {REVIEW_PROVIDER_MODULES}=require('../lib/final-provider-request');
const {createFinalRequestStore,authorizeWithStore}=require('../lib/final-request-review');

// Kept on purpose (the user's ruling): their own Gridlight gateway, local tools, LLM text.
const KEPT=new Set(['gridlight','fluidsynth','anthropic']);
const reviewProviders=Object.keys(REVIEW_PROVIDER_MODULES||{});

function fixture(provider){
 const db=new Database(':memory:');
 db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/141_final_request_reviews.sql'),'utf8'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-gen-'));
 const resolve=async(p,capability,payload)=>({provider:p,capability,endpoint:'https://vendor.invalid/'+p,adapterVersion:'fixture',body:{prompt:payload.prompt},references:[]});
 const s=createFinalRequestStore(db,{resolve,provenance:spec=>({spec}),quote:()=>({kind:'estimate',amount:0.1,currency:'USD'})});
 return {db,dir,s,close(){db.close();fs.rmSync(dir,{recursive:true});}};
}
const payload={prompt:'A lighthouse at dusk, 35mm, slow push in'};
function capabilityOf(provider){return provider==='elevenlabs'?'voice':provider==='worldlabs'?'world':provider==='meshy'?'model3d':['magnific','muapi-upscale','topaz'].includes(provider)?'post':'image';}

test('the review registry is exported and every reviewable provider is manual',()=>{
 assert.ok(reviewProviders.length>=11,'REVIEW_PROVIDER_MODULES must be exported from final-provider-request');
 for(const provider of [...reviewProviders,'topaz'])assert.equal(manual.isManual(provider,capabilityOf(provider)),true,provider+' must be manual');
});

test('every registered adapter capability is classified: manual or explicitly kept',()=>{
 for(const adapter of require('../lib/providers').list()){
  for(const capability of adapter.capabilities||[]){
   if(capability==='llm'){assert.equal(manual.isManual(adapter.id,capability),false,adapter.id+' llm text is kept');continue;}
   if(KEPT.has(adapter.id)){assert.equal(manual.isManual(adapter.id,capability),false,adapter.id+'/'+capability+' is kept');continue;}
   assert.equal(manual.isManual(adapter.id,capability),true,adapter.id+'/'+capability+' must be manual');
  }
 }
});

test('the final review still previews every manual provider, but approval is refused',async()=>{
 for(const provider of reviewProviders){
  const f=fixture(provider),capability=capabilityOf(provider);
  const r=await f.s.preview({provider,capability,payload});
  assert.equal(r.snapshot.body.prompt,payload.prompt,provider+' preview shows the full prompt');
  assert.throws(()=>f.s.approve(r.id,{fingerprint:r.fingerprint,human_confirmed:true,cost_unknown_ack:true}),e=>e.code==='MANUAL_GENERATION_ONLY',provider+' approve must refuse');
  f.close();
 }
});

test('a review approved before this change cannot authorize a send',async()=>{
 for(const provider of reviewProviders){
  const f=fixture(provider),capability=capabilityOf(provider);
  const r=await f.s.preview({provider,capability,payload});
  f.db.prepare("UPDATE film_final_request_reviews SET state='approved' WHERE id=?").run(r.id);
  const result=await authorizeWithStore(f.s,{provider,capability,payload,approvals:[{id:r.id,fingerprint:r.fingerprint}]});
  assert.equal(result.ok,false,provider+' legacy approval must not authorize');
  assert.equal(result.code,'MANUAL_GENERATION_ONLY',provider);
  f.close();
 }
});

test('creative transport and media upload never call fetch for a manual provider',async()=>{
 const transport=require('../lib/generation-transport');
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;return new Response('{}');};
 try{
  for(const provider of [...reviewProviders,'topaz']){
   const request=transport.attach({},{snapshot:{provider,capability:capabilityOf(provider),endpoint:'https://vendor.invalid/x',body:{prompt:payload.prompt},references:[]},store:{recordTransport:()=>1,settleTransport(){}},reviewId:'r'});
   await assert.rejects(()=>transport.dispatch(request,'https://vendor.invalid/x',{method:'POST',body:JSON.stringify({prompt:payload.prompt})}),e=>e.code==='MANUAL_GENERATION_ONLY',provider);
  }
  const upload=require('../lib/providers/muapi-upload');
  assert.equal((await upload.hostOne('data:image/png;base64,iVBORw0KGgo=','key')).code,'MANUAL_GENERATION_ONLY');
  assert.equal((await upload.hostFile(__filename,'key')).code,'MANUAL_GENERATION_ONLY');
  assert.equal(calls,0,'no network call reached a manual vendor');
 }finally{global.fetch=original;}
});

test('kept providers are not blocked by the manual gate',async()=>{
 const f=fixture('fixture-kept');
 const r=await f.s.preview({provider:'gridlight',capability:'image',payload});
 assert.ok(f.s.approve(r.id,{fingerprint:r.fingerprint,human_confirmed:true,cost_unknown_ack:true}).id);
 f.close();
});
