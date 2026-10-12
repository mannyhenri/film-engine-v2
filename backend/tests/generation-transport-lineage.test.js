const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fe-origin-'));
process.env.FILM_DATA_DIR=dir;
const Database=require('better-sqlite3');
const migration=name=>fs.readFileSync(path.join(__dirname,'../db/migrations',name),'utf8');
const {createFinalRequestStore}=require('../lib/final-request-review');
const transport=require('../lib/generation-transport');
const lineage=require('../lib/production-lineage');
function fixture(){
 const db=new Database(':memory:');db.exec(migration('141_final_request_reviews.sql'));
 db.exec('CREATE TABLE film_assets(id TEXT PRIMARY KEY,project_id TEXT,shot_id TEXT,file_path TEXT,metadata TEXT); CREATE TABLE film_generation_jobs(id TEXT PRIMARY KEY,project_id TEXT,shot_id TEXT,provider TEXT,request_id TEXT,asset_id TEXT,meta TEXT);');
 const bytes=Buffer.from('approved audio bytes'),uri='data:audio/wav;base64,'+bytes.toString('base64');
 const snapshot={provider:'seedance',capability:'video',model:'seedance-2.5',endpoint:'https://provider.invalid/generate',body:{prompt:'exact',audios_list:[uri]},references:[{role:'dialogue',wire_role:'audios_list[0]',order:1,mime:'audio/wav',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),byte_length:bytes.length,data:uri}],adapterVersion:'test'};
 const store=createFinalRequestStore(db,{resolve:async()=>structuredClone(snapshot),provenance:spec=>({spec,digest:'stable'}),quote:()=>({amount:0,credits:0,pricing_digest:'stable'})});
 return{db,store,snapshot,bytes,uri};
}
test('durable transport exists before fetch; hosted representation retains exact approved role and bytes',async()=>{
 const f=fixture(),review=await f.store.preview({provider:'seedance',capability:'video',payload:{prompt:'exact'},provenance:{project_id:'P',shot_id:'original'}}),token=f.store.approve(review.id,{human_confirmed:true,fingerprint:review.fingerprint});f.store.claim(token,'seedance','video');
 const request={url:f.snapshot.endpoint,body:{prompt:'exact',audios_list:['https://cdn.invalid/audio']}};transport.attach(request,{store:f.store,reviewId:review.id,snapshot:f.snapshot});transport.hosted(request,f.uri,'https://cdn.invalid/audio');
 const old=global.fetch;let calls=0;global.fetch=async(url,init)=>{calls++;const row=f.db.prepare('SELECT * FROM film_generation_transport_receipts').get();assert(row);assert.equal(row.serialized_body,init.body);return{ok:false,status:400};};
 try{await transport.dispatch(request,request.url,{method:'POST',headers:{Authorization:'secret-token'},body:JSON.stringify(request.body)});assert.equal(calls,1);const row=f.db.prepare('SELECT * FROM film_generation_transport_receipts').get();assert.equal(row.state,'http_response');assert.equal(row.http_status,400);assert(!JSON.stringify(row).includes('secret-token'));const refs=JSON.parse(row.references_json);assert.equal(refs[0].role,'dialogue');assert.equal(refs[0].wire_role,'audios_list[0]');assert.equal(refs[0].sha256,f.snapshot.references[0].sha256);assert.equal(refs[0].transport_value,'https://cdn.invalid/audio');assert.equal(refs[0].representation,'adapter_upload');}finally{global.fetch=old;f.db.close();}
});
test('unrecordable attempt and unproven hosted substitution dispatch nothing',async()=>{
 const f=fixture(),request={url:f.snapshot.endpoint,body:{prompt:'exact',audios_list:['https://cdn.invalid/unproven']}};transport.attach(request,{store:f.store,reviewId:'absent',snapshot:f.snapshot});let calls=0;const old=global.fetch;global.fetch=async()=>{calls++;};
 try{await assert.rejects(()=>transport.dispatch(request,request.url,{method:'POST',body:JSON.stringify(request.body)}),/hosted|record|review|prove/i);assert.equal(calls,0);}finally{global.fetch=old;f.db.close();}
});
test('origin is identity linked to the original shot, independent of current selections; missing legacy history stays unknown',async()=>{
 const f=fixture(),review=await f.store.preview({provider:'seedance',capability:'video',payload:{prompt:'exact'},provenance:{project_id:'P',shot_id:'original'}}),token=f.store.approve(review.id,{human_confirmed:true,fingerprint:review.fingerprint});f.store.claim(token,'seedance','video');f.store.submitted(review.id,'provider-job');f.store.complete(review.id,{ok:true,data:{video_url:'https://provider.invalid/output'}});
 f.db.prepare('INSERT INTO film_generation_jobs VALUES(?,?,?,?,?,?,?)').run('job','P','original','seedance','provider-job','asset',JSON.stringify({approval_id:review.id}));f.db.prepare('INSERT INTO film_assets VALUES(?,?,?,?,?)').run('asset','P','currently-selected-shot','output.mp4','{}');
 const result=lineage.assetLineage(f.db,'asset');assert.equal(result.status,'recorded');assert.equal(result.review_id,review.id);assert.equal(result.origin.shot_id,'original');assert.equal(result.transport,null);assert(result.unknown.includes('transport'));
 f.db.prepare('INSERT INTO film_assets VALUES(?,?,?,?,?)').run('legacy','P','original','legacy.mp4','{}');assert.equal(lineage.assetLineage(f.db,'legacy').status,'legacy_unknown');f.db.close();
});
test('exact rerun retains the immutable editable recipe without guessing from the provider wire body',async()=>{
 const f=fixture(),payload={prompt:'exact',workflow:'omni-reference',width:1920,height:1080,seed:0,negative_prompt:'no smoke',settings:{native_option:'preserve'},keyframes:[{uri:'data:image/png;base64,Ynl0ZXM=',position:0}],audio_references:[{uri:f.uri,reference_role:'dialogue'}]};
 const review=await f.store.preview({provider:'seedance',capability:'video',payload,provenance:{project_id:'P',shot_id:'original'}}),token=f.store.approve(review.id,{human_confirmed:true,fingerprint:review.fingerprint});f.store.claim(token,'seedance','video');f.store.submitted(review.id,'provider-job');f.store.complete(review.id,{ok:true});
 f.db.prepare('INSERT INTO film_assets VALUES(?,?,?,?,?)').run('asset','P','original','output.mp4',JSON.stringify({final_request_review_id:review.id}));
 const first=lineage.assetLineage(f.db,'asset');assert.deepEqual(first.approved.payload,payload);first.approved.payload.width=12;
 assert.deepEqual(lineage.assetLineage(f.db,'asset').approved.payload,payload);assert.equal(first.approved.body.prompt,'exact');f.db.close();
});
test('changed creative settings and receipt persistence failure stop before paid HTTP',async()=>{
 const f=fixture(),request={url:f.snapshot.endpoint};transport.attach(request,{store:{recordTransport(){throw new Error('receipt storage unavailable');}},reviewId:'review',snapshot:f.snapshot});const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;};
 try{await assert.rejects(()=>transport.dispatch(request,request.url,{method:'POST',body:JSON.stringify({...f.snapshot.body,prompt:'unapproved'})}),/changed after approval/);await assert.rejects(()=>transport.dispatch(request,request.url,{method:'POST',body:JSON.stringify(f.snapshot.body)}),/storage unavailable/);await assert.rejects(()=>transport.dispatch(request,request.url,{method:'POST',body:JSON.stringify({...f.snapshot.body,audios_list:[f.uri.replace('audio/wav','audio/mpeg')]})}),/prove approved reference/);assert.equal(calls,0);}finally{global.fetch=old;f.db.close();}
});
test('a network failure stays uncertain and cannot create a second paid receipt',async()=>{
 const f=fixture(),review=await f.store.preview({provider:'seedance',capability:'video',payload:{prompt:'exact'}}),token=f.store.approve(review.id,{human_confirmed:true,fingerprint:review.fingerprint});f.store.claim(token,'seedance','video');const request={url:f.snapshot.endpoint};transport.attach(request,{store:f.store,reviewId:review.id,snapshot:f.snapshot});const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('lost connection');};
 try{await assert.rejects(()=>transport.dispatch(request,request.url,{method:'POST',body:JSON.stringify(f.snapshot.body)}),/lost connection/);assert.equal(f.db.prepare('SELECT state FROM film_generation_transport_receipts').get().state,'acceptance_unknown');await assert.rejects(()=>transport.dispatch(request,request.url,{method:'POST',body:JSON.stringify(f.snapshot.body)}));assert.equal(calls,1);}finally{global.fetch=old;f.db.close();}
});
test('signed media credentials are redacted honestly without changing the sent bytes',async()=>{
 const f=fixture(),review=await f.store.preview({provider:'seedance',capability:'video',payload:{prompt:'exact'}}),token=f.store.approve(review.id,{human_confirmed:true,fingerprint:review.fingerprint});f.store.claim(token,'seedance','video');const url='https://cdn.invalid/audio?X-Amz-Signature=signed-secret',request={url:f.snapshot.endpoint};transport.attach(request,{store:f.store,reviewId:review.id,snapshot:f.snapshot});transport.hosted(request,f.uri,url);const old=global.fetch;let sent;global.fetch=async(_,init)=>{sent=init.body;return{ok:true,status:200};};
 try{await transport.dispatch(request,request.url,{method:'POST',body:JSON.stringify({prompt:'exact',audios_list:[url]})});assert(sent.includes('signed-secret'));const row=f.db.prepare('SELECT * FROM film_generation_transport_receipts').get();assert(!JSON.stringify(row).includes('signed-secret'));assert.equal(row.serialization_exact,0);assert.equal(row.serialized_body,null);assert.equal(row.body_sha256,crypto.createHash('sha256').update(sent).digest('hex'));assert(JSON.parse(row.redactions_json).length>0);}finally{global.fetch=old;f.db.close();}
});
test('cancelled approval does not become a transport receipt',async()=>{
 const f=fixture(),review=await f.store.preview({provider:'seedance',capability:'video',payload:{prompt:'exact'}}),token=f.store.approve(review.id,{human_confirmed:true,fingerprint:review.fingerprint});f.store.cancel(review.id);assert.throws(()=>f.store.claim(token,'seedance','video'),/approval is required/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM film_generation_transport_receipts').get().n,0);f.db.close();
});
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
