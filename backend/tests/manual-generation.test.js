// Manual generation: Film Engine prepares the exact prompt and assets, the user
// generates on the vendor's own site. No creative request may leave the app for
// a manual vendor, whichever road it takes. Set-based: every registered adapter
// and every reviewable provider is classified, so a new one cannot slip through.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const Database=require('better-sqlite3');
const manual=require('../lib/manual-generation');
const {REVIEW_PROVIDER_MODULES}=require('../lib/final-provider-request');
const {createFinalRequestStore,authorizeWithStore}=require('../lib/final-request-review');

// Kept on purpose (the user's ruling): their own Gridlight gateway, LLM text. (FluidSynth went with music generation.)
const KEPT=new Set(['gridlight','anthropic']);
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

test('with no stored keys, a project pinned to any manual capability resolves to it and its prompt still builds',async()=>{
 const credentials=require('../lib/providers/credentials'),original=credentials.getCredential;
 credentials.getCredential=()=>({apiKey:null,meta:{}});
 try{
  const providers=require('../lib/providers'),{resolveFinalRequest}=require('../lib/final-provider-request');
  // Automatic choice is unchanged (kept providers, e.g. Gridlight, are not displaced); a pin needs no key.
  const builds={openai:'image',google:'image',muapi:'image',seedance:'video',runway:'video',higgsfield:'video',meshy:'model3d',worldlabs:'world'};
  for(const adapter of providers.list())for(const capability of adapter.capabilities||[]){
   if(!manual.isManual(adapter.id,capability))continue;
   assert.equal(providers.resolveIdWithReason(capability,{[capability]:adapter.id}).id,adapter.id,adapter.id+'/'+capability+' pinned without a key');
  }
  for(const [provider,capability] of Object.entries(builds)){
   const request=await resolveFinalRequest(provider,capability,{prompt:'A lighthouse at dusk'});
   assert.match(request.endpoint,/^https:\/\//,provider+' builds its prompt without a key');
  }
 }finally{credentials.getCredential=original;}
});

test('every priced estimate entry for a manual capability is labelled as the vendor web app; kept ones are not',()=>{
 process.env.FILM_DATA_DIR=process.env.FILM_DATA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'manual-budget-'));
 const {markManual}=require('../routes/budget');
 const entries=[];
 for(const adapter of require('../lib/providers').list())for(const capability of adapter.capabilities||[])entries.push({provider:adapter.id,capability,usd:1});
 markManual({alternatives:{image:[{provider:'runway',usd:1}],video:[{provider:'gridlight',usd:0}]},lines:entries});
 for(const e of entries)assert.equal(!!e.manual,manual.isManual(e.provider,e.capability),e.provider+'/'+e.capability);
});

test('a review stop removes only output-less job rows whose review is for a manual vendor; kept providers are never touched',()=>{
 const db=new Database(':memory:');
 db.exec("CREATE TABLE film_demo_jobs (id TEXT PRIMARY KEY, status TEXT, error_message TEXT, output_path TEXT)");
 manual.installReviewStopCleanup(db);
 const review=(id,provider,capability)=>db.prepare("INSERT INTO film_final_request_reviews (id,fingerprint,snapshot_json,editable_json,provenance_json) VALUES (?,?,?,'{}','{}')").run(id,'fp',JSON.stringify({provider,capability}));
 const rows=[];
 // Set-based: every registered adapter capability, manual or kept.
 for(const adapter of require('../lib/providers').list())for(const capability of adapter.capabilities||[]){
  const id=`${adapter.id}-${capability}`;review('r-'+id,adapter.id,capability);rows.push([id,manual.isManual(adapter.id,capability)]);
  db.prepare("INSERT INTO film_demo_jobs VALUES (?,'generating',NULL,NULL)").run(id);
  db.prepare("UPDATE film_demo_jobs SET status='failed',error_message=? WHERE id=?").run('FINAL_REQUEST_REVIEW_REQUIRED:r-'+id,id);
 }
 review('r-made','runway','video');
 db.prepare("INSERT INTO film_demo_jobs VALUES ('made','generating',NULL,'/out/a.mp4'),('real','generating',NULL,NULL),('unknown','generating',NULL,NULL)").run();
 db.prepare("UPDATE film_demo_jobs SET status='failed',error_message='FINAL_REQUEST_REVIEW_REQUIRED:r-made' WHERE id='made'").run();
 db.prepare("UPDATE film_demo_jobs SET status='failed',error_message='upstream 500' WHERE id='real'").run();
 db.prepare("UPDATE film_demo_jobs SET status='failed',error_message='FINAL_REQUEST_REVIEW_REQUIRED:no-such-review' WHERE id='unknown'").run();
 const left=new Set(db.prepare('SELECT id FROM film_demo_jobs').all().map(r=>r.id));
 for(const [id,isManual] of rows)assert.equal(left.has(id),!isManual,id+(isManual?' (manual) is removed':' (kept) stays'));
 for(const id of ['made','real','unknown'])assert.ok(left.has(id),id+' stays');
 assert.ok(left.has('gridlight-video')&&left.has('anthropic-llm')&&left.has('openai-llm'));
 db.close();
});

test('reference-sheet review cleanup preserves output_paths on insert, update, and trigger reinstall',()=>{
 const db=new Database(':memory:');
 db.exec('CREATE TABLE film_refsheet_jobs (id TEXT PRIMARY KEY, output_paths TEXT, error_message TEXT)');
 const outputs=JSON.stringify(['/saved/front.png','/saved/side.png']);
 db.prepare('INSERT INTO film_refsheet_jobs VALUES (?,?,?)').run('historical',outputs,'FINAL_REQUEST_REVIEW_REQUIRED:r-refsheet');
 manual.installReviewStopCleanup(db);
 db.prepare("INSERT INTO film_final_request_reviews (id,fingerprint,snapshot_json,editable_json,provenance_json) VALUES ('r-refsheet','fp',?,'{}','{}')")
  .run(JSON.stringify({provider:'runway',capability:'image'}));
 const marker='FINAL_REQUEST_REVIEW_REQUIRED:r-refsheet';
 assert.equal(db.prepare('SELECT output_paths FROM film_refsheet_jobs WHERE id=?').get('historical').output_paths,outputs);
 for(const when of ['insert','update']){
  for(const [suffix,paths] of [['made',outputs],['empty-json','[]'],['null',null],['blank','']]){
   const id=when+'-'+suffix;
   db.prepare('INSERT INTO film_refsheet_jobs VALUES (?,?,?)').run(id,paths,when==='insert'?marker:null);
   if(when==='update')db.prepare('UPDATE film_refsheet_jobs SET error_message=? WHERE id=?').run(marker,id);
   const row=db.prepare('SELECT output_paths FROM film_refsheet_jobs WHERE id=?').get(id);
   if(paths)assert.equal(row?.output_paths,paths,id+' retains recorded output history');
   else assert.equal(row,undefined,id+' remains eligible for manual handover cleanup');
  }
 }
 manual.installReviewStopCleanup(db);
 db.prepare('UPDATE film_refsheet_jobs SET error_message=? WHERE id=?').run(marker,'historical');
 assert.equal(db.prepare('SELECT output_paths FROM film_refsheet_jobs WHERE id=?').get('historical')?.output_paths,outputs);
 db.close();
});

test('every reference with a recorded original serves that exact file, and nothing else is served',async()=>{
 const {originalReference}=require('../lib/final-request-review');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-orig-')),original=path.join(dir,'hero-original.png');fs.writeFileSync(original,'ORIGINAL-FULL-RES');
 const db=new Database(':memory:');db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/141_final_request_reviews.sql'),'utf8'));
 const refs=[{order:1,role:'image_reference',tag:'hero',mime:'image/png',data:'data:image/png;base64,c2VudA==',source_path:original,source_transform:'encoded_reference_bytes_differ'},
  {order:2,role:'image_reference',mime:'image/png',data:'data:image/png;base64,c2VudA=='}];
 db.prepare("INSERT INTO film_final_request_reviews (id,fingerprint,snapshot_json,editable_json,provenance_json) VALUES ('r1','fp',?, '{}','{}')").run(JSON.stringify({provider:'runway',capability:'image',references:refs}));
 const store={get:id=>{const r=db.prepare('SELECT * FROM film_final_request_reviews WHERE id=?').get(id);if(!r)throw Object.assign(new Error('Request review not found'),{status:404});return {id:r.id,snapshot:JSON.parse(r.snapshot_json)};}};
 for(const ref of refs){
  if(ref.source_path){const out=originalReference(store,'r1',ref.order,{roots:[dir]});assert.equal(fs.readFileSync(out.file,'utf8'),'ORIGINAL-FULL-RES');assert.equal(out.name,'01-hero.png');assert.equal(out.mime,'image/png');}
  else assert.throws(()=>originalReference(store,'r1',ref.order),e=>e.status===404);
 }
 assert.throws(()=>originalReference(store,'r1',9),e=>e.status===404);
 assert.throws(()=>originalReference(store,'missing',1),e=>e.status===404);
 db.close();fs.rmSync(dir,{recursive:true});
});

test('the original download serves only media inside the app data or a project folder; a crafted review cannot read other files',()=>{
 const {originalReference}=require('../lib/final-request-review');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'manual-root-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'manual-outside-'));
 const write=(dir,name,body='X')=>{const f=path.join(dir,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,body);return f;};
 const inside=write(root,'shots/frame.png'),secretInside=write(root,'keys/id_rsa'),textInside=write(root,'notes.txt'),outsidePng=write(outside,'frame.png'),secret=write(outside,'id_rsa');
 const link=path.join(root,'shots/escape.png');fs.symlinkSync(outsidePng,link);
 const cases=[[inside,true],[secretInside,false],[textInside,false],[outsidePng,false],[secret,false],[link,false],[path.join(root,'..',path.basename(outside),'frame.png'),false]];
 const store={get:()=>({snapshot:{references:cases.map(([file],i)=>({order:i+1,mime:'image/png',source_path:file}))}})};
 cases.forEach(([file,allowed],i)=>{
  if(allowed)assert.equal(originalReference(store,'r',i+1,{roots:[root]}).file,fs.realpathSync(file),file);
  else assert.throws(()=>originalReference(store,'r',i+1,{roots:[root]}),e=>e.status===404,file+' must not be served');
 });
 fs.rmSync(root,{recursive:true});fs.rmSync(outside,{recursive:true});
});

test('a local clip or model in a review keeps its path, hash and size, not inline bytes; images stay inline',async()=>{
 const {resolveFinalRequest}=require('../lib/final-provider-request');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-media-')),clip=path.join(dir,'clip.mp4');
 require('child_process').execFileSync(require('ffmpeg-static'),['-y','-f','lavfi','-i','color=c=gray:s=320x240:d=3','-pix_fmt','yuv420p',clip],{stdio:'ignore'});
 const bytes=fs.readFileSync(clip);
 const r=await resolveFinalRequest('runway','video',{prompt:'Replace the background',videoUri:clip,model:'aleph2'});
 const ref=r.references.find(x=>x.mime==='video/mp4');
 assert.ok(ref,'the clip is listed as an asset');
 assert.equal(ref.data,undefined,'the clip is not inlined');
 assert.equal(ref.path,clip);assert.equal(ref.byte_length,bytes.length);
 assert.equal(ref.sha256,require('crypto').createHash('sha256').update(bytes).digest('hex'));
 assert.ok(!JSON.stringify(r).includes(bytes.toString('base64').slice(0,200)),'no base64 of the clip anywhere in the review');
 fs.rmSync(dir,{recursive:true});
});

test('the creative transport still sends for every kept provider capability (Gridlight included)',async()=>{
 const transport=require('../lib/generation-transport');
 const original=global.fetch,sent=[];global.fetch=async(url)=>{sent.push(String(url));return new Response('{}',{status:200});};
 try{
  for(const adapter of require('../lib/providers').list())for(const capability of adapter.capabilities||[]){
   if(manual.isManual(adapter.id,capability))continue;
   const url='http://127.0.0.1:8080/'+adapter.id+'/'+capability,body={prompt:'kept'};
   const request=transport.attach({},{snapshot:{provider:adapter.id,capability,endpoint:url,body,references:[]},store:{recordTransport:()=>1,settleTransport(){}},reviewId:'r'});
   const res=await transport.dispatch(request,url,{method:'POST',body:JSON.stringify(body)});
   assert.equal(res.status,200,adapter.id+'/'+capability+' is sent');
  }
  assert.ok(sent.some(u=>u.includes('/gridlight/')),'Gridlight was sent');
 }finally{global.fetch=original;}
});

test('every kept provider without a review builder (Gridlight, local tools) generates directly, with no review',async()=>{
 const providers=require('../lib/providers'),{REVIEW_PROVIDER_MODULES:reviewable}=require('../lib/final-provider-request');
 process.env.FILM_DATA_DIR=process.env.FILM_DATA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'manual-kept-'));
 require('../db/schema').ensureSchema();const {db}=require('../db/database');
 const reviews=()=>db.prepare('SELECT COUNT(*) n FROM film_final_request_reviews').get().n;
 let checked=0;
 for(const adapter of providers.list())for(const capability of adapter.capabilities||[]){
  if(manual.isManual(adapter.id,capability)||capability==='llm'||Object.prototype.hasOwnProperty.call(reviewable,adapter.id))continue;
  const calls=[];
  const fake={...adapter,id:adapter.id,capabilities:adapter.capabilities,supports:c=>(adapter.capabilities||[]).includes(c),asyncGeneration:false,
   generate:async(cap,payload)=>{calls.push({cap,payload});return {ok:true,data:{url:'file:///kept.bin'}};}};
  const before=reviews();
  const wrapped=providers.withJobRecording(fake,capability,{});
  const payload={prompt:'kept '+adapter.id+' '+capability};
  const result=await wrapped.generate(capability,payload,{});
  assert.equal(result.ok,true,`${adapter.id}/${capability} runs directly: ${result.error||''}`);
  assert.equal(calls.length,1,`${adapter.id}/${capability} reached its own adapter once`);
  assert.equal(calls[0].payload.prompt,payload.prompt);
  assert.equal(reviews(),before,`${adapter.id}/${capability} created no review`);
  checked++;
 }
 assert.ok(checked>=8,'gridlight and local capabilities were exercised: '+checked);
});

test('the direct path is closed to unregistered ids and to every manual vendor, whatever the capability',async()=>{
 const {authorizeWithStore}=require('../lib/final-request-review');
 const f=fixture('bypass-guard');
 const attempts=[['not-a-registered-provider','image'],['gridlight-evil','video'],...[...manual.MANUAL_PROVIDERS].flatMap(id=>[[id,'image'],[id,'video'],[id,'unknown-capability']])];
 for(const [provider,capability] of attempts){
  const result=await authorizeWithStore(f.s,{provider,capability,payload,approvals:[]}).catch(e=>({ok:false,error:e.message}));
  assert.notEqual(result.bypass,true,`${provider}/${capability} must not run directly`);
  assert.notEqual(result.ok,true,`${provider}/${capability} must not be authorized without a review`);
 }
 // The registered kept gateway is the one that does.
 assert.equal((await authorizeWithStore(f.s,{provider:'gridlight',capability:'video',payload,approvals:[]})).bypass,true);
 f.close();
});
