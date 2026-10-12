'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'expression-tests-'));
process.env.FILM_DATA_DIR=temp;
process.env.MUAPI_API_KEY='mock-only';
const {db}=require('../db/database');require('../db/schema').ensureSchema();
require('../lib/providers/credentials').getCredential=()=>({apiKey:'mock-only',meta:{}});
const expr=require('../lib/character-expressions'),s=expr.store(),G=require('../lib/subject-gallery');
const png=require('../lib/png-raster').encode({width:2,height:2,pixels:Buffer.alloc(16,255)});
const data='data:image/png;base64,'+png.toString('base64');
function fixture(identity=true) {
 const project=crypto.randomUUID(),id=crypto.randomUUID();
 db.prepare('INSERT INTO film_projects (id,title,provider_config,target_resolution) VALUES (?,?,?,?)').run(project,'Disposable',JSON.stringify({image:'muapi',image_model:'nano-banana-2'}),'2K');
 db.prepare('INSERT INTO film_characters (id,project_id,name,appearance_prompt,description,personality_notes) VALUES (?,?,?,?,?,?)').run(id,project,'Creature','Blue scaled face','Unique biography','Reserved');
 let anchor;
 if(identity){const file=path.join(temp,crypto.randomUUID()+'.png');fs.writeFileSync(file,png);anchor=crypto.randomUUID();db.prepare("INSERT INTO film_assets (id,project_id,character_id,asset_type,file_path,file_name,mime_type,metadata) VALUES (?,?,?,'character_sheet',?,?, 'image/png',?)").run(anchor,project,id,file,path.basename(file),JSON.stringify({view:'front',plate_role:'reference'}));}
 return {project,id,anchor};
}
test.after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true});});
test('reading creates six empty stable defaults, never assets, rows or provider calls',()=>{
 const f=fixture();const count=db.prepare('SELECT COUNT(*) AS n FROM film_assets').get().n;
 assert.deepEqual(s.list(f.id).map(x=>[x.slot_id,x.label,x.active_asset_id]),expr.DEFAULTS.map((label,i)=>[`slot-${i+1}`,label,null]));
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM film_character_expression_slots WHERE character_id=?').get(f.id).n,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM film_assets').get().n,count);
});
test('uploads/select/clear retain immutable history, identity and exact expression metadata',()=>{
 const f=fixture(),one=s.importImage(f.id,'slot-1',{revision:0,data}),two=s.importImage(f.id,'slot-1',{revision:1,data});
 const a=s.asset(f.id,one.asset_id),b=s.asset(f.id,two.asset_id);
 assert.notEqual(a.file_path,b.file_path);assert.deepEqual(fs.readFileSync(a.file_path),png);assert.equal(two.version,2);
 assert.equal(s.identity(f.id).id,f.anchor);assert.equal(G.isSendable(a),false);
 assert.throws(()=>G.planPromotion([a],a.id),/separately/);
 assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM film_assets WHERE character_id=? AND ${G.sendableSql()}`).get(f.id).n,1);
 assert.equal(expr.meta(a).reference_role,'expression');assert.equal(expr.meta(a).framing,'face_closeup');
 s.update(f.id,'slot-1',{revision:2,asset_id:one.asset_id});assert.equal(s.slot(f.id,'slot-1').active_asset_id,one.asset_id);
 s.update(f.id,'slot-1',{revision:3,asset_id:null});assert.equal(s.list(f.id)[0].versions.length,2);
 assert.throws(()=>s.update(f.id,'slot-2',{revision:0,asset_id:one.asset_id}),/this expression slot/);
});
test('labels are customizable without changing slot identity or character descriptions; stale writes and completion races are refused',()=>{
 const f=fixture();const slot=s.update(f.id,'slot-2',{revision:0,label:'Threat display',direction:'Flatten antennae; eyes narrowed.'});
 const before=db.prepare('SELECT * FROM film_characters WHERE id=?').get(f.id);
 assert.equal(slot.slot_id,'slot-2');assert.throws(()=>s.importImage(f.id,'slot-2',{revision:0,data}),/changed/);
 const reserved=s.reserve(f.id,'slot-2',1);s.update(f.id,'slot-2',{revision:2,label:'Defiance'});
 const delayed=s.fileVersion(f.id,slot,png,'image/png',{generated:true},reserved.revision);
 assert.equal(delayed.activated,false);assert.equal(s.slot(f.id,'slot-2').active_asset_id,null);assert.equal(s.history(f.id,'slot-2').length,1);
 assert.deepEqual(db.prepare('SELECT * FROM film_characters WHERE id=?').get(f.id),before);
});
test('existing reference selection copies bytes; deleted files and cross-character selections fail without replacing a slot',()=>{
 const f=fixture(),other=fixture();const prior=s.asset(f.id,f.anchor);
 const out=s.importImage(f.id,'slot-3',{revision:0,source_asset_id:f.anchor});
 assert.equal(s.identity(f.id).id,f.anchor);assert.deepEqual(fs.readFileSync(prior.file_path),png);
 assert.throws(()=>s.importImage(other.id,'slot-1',{revision:0,source_asset_id:out.asset_id}),/missing or deleted/);
 fs.unlinkSync(s.asset(f.id,out.asset_id).file_path);
 assert.equal(s.list(f.id)[2].missing_reference,true);
 assert.throws(()=>s.update(f.id,'slot-3',{revision:1,asset_id:out.asset_id}),/missing or deleted/);
 db.prepare('DELETE FROM film_assets WHERE id=?').run(out.asset_id);assert.equal(s.slot(f.id,'slot-3').active_asset_id,null);
});
test('generation requires usable identity and reference support; exact direction/style precede a single approved image',()=>{
 const f=fixture(),missing=fixture(false),provider={id:'muapi',supportsReferenceImages:true,supportsReferenceTags:false,maxReferenceImages:1};
 assert.throws(()=>s.plan(missing.id,'slot-1',{revision:0},provider),/identity plate/);
 assert.throws(()=>s.plan(f.id,'slot-1',{revision:0},{...provider,supportsReferenceImages:false}),/supports identity/);
 s.update(f.id,'slot-1',{revision:0,label:'Stoic joy',direction:'Only a subtle eye crease.'});
 const plan=s.plan(f.id,'slot-1',{revision:1},provider);
 assert.match(plan.payload.prompt,/Stoic joy/);assert.match(plan.payload.prompt,/Only a subtle eye crease/);assert.match(plan.payload.prompt,/first reference image/);assert(!plan.payload.prompt.includes('@identity'));
 assert.equal(plan.payload.n,1);assert.equal(plan.payload.reference_images.length,1);assert.equal(plan.expression.identity_asset_id,f.anchor);
 assert.throws(()=>s.plan(f.id,'slot-1',{revision:1},{...provider,promptLimit:5}),/prompt budget/);
});
test('malformed legacy metadata cannot break expression history or version filing',()=>{
 const f=fixture();db.prepare("INSERT INTO film_assets (id,project_id,character_id,asset_type,metadata) VALUES (?,?,?,'reference_image','malformed legacy metadata')").run(crypto.randomUUID(),f.project,f.id);
 assert.equal(s.list(f.id).length,6);const result=s.importImage(f.id,'slot-1',{revision:0,data});assert.equal(result.version,1);assert.equal(s.history(f.id,'slot-1').length,1);
});
test('selected expressions append intentionally; mandatory references, provider ceilings, missing identity and stale selections are enforced',()=>{
 const f=fixture(),a=s.importImage(f.id,'slot-1',{revision:0,data});
 const selected=[{character_id:f.id,slot_id:'slot-1',asset_id:a.asset_id,revision:1}];
 const ctx={project:{id:f.project},characters:[{id:f.id}]};
 const base={prompt:'Creature in a room',reference_images:[{kind:'anchor',uri:data},{kind:'character',uri:data},{kind:'location',uri:data}]};
 const provider={supportsReferenceImages:true,supportsReferenceTags:false,maxReferenceImages:3,promptLimit:5000};
 assert.throws(()=>expr.appendSelectedExpressions(base,selected,ctx,provider),/remaining reference budget/);
 const out=expr.appendSelectedExpressions(base,selected,ctx,{...provider,maxReferenceImages:4});
 assert.deepEqual(out.reference_images.slice(0,3),base.reference_images);assert.equal(out.reference_images[3].reference_role,'expression');assert.match(out.prompt,/reference image 4/);
 assert.strictEqual(expr.appendSelectedExpressions(base,[],ctx,provider),base);
 assert.throws(()=>expr.appendSelectedExpressions(base,selected,{...ctx,sceneCard:{characters:[]}}, {...provider,maxReferenceImages:4}),/not a character in this shot/);
 assert.throws(()=>expr.appendSelectedExpressions(base,selected,ctx,{...provider,maxReferenceImages:0}),/remaining reference budget/);
 assert.throws(()=>expr.appendSelectedExpressions(base,selected,ctx,{...provider,maxReferenceImages:4,promptLimit:10}),/prompt budget/);
 s.update(f.id,'slot-1',{revision:1,asset_id:null});assert.throws(()=>expr.appendSelectedExpressions(base,selected,ctx,{...provider,maxReferenceImages:4}),/changed/);
});
test('approved expression transport matches the reviewed bytes once; concurrent sends and replay cannot generate again',async()=>{
 const f=fixture(),contract=require('../lib/final-request-review'),body={revision:0};
 const planned=await require('../lib/final-subject-request-plans').prepareSubjectRequests({path:`/characters/${f.id}/expressions/slot-4/generate`,body});
 const review=await contract.store().preview(planned.items[0]),token=contract.store().approve(review.id,{fingerprint:review.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 const original=global.fetch,posts=[],uploads=[];
 global.fetch=async(url,init={})=>{
  if(String(url).endsWith('/upload_file')){uploads.push(Buffer.from(await init.body.get('file').arrayBuffer()));return {ok:true,status:200,json:async()=>({url:'https://mock.invalid/identity.png'})};}
  if(init.method==='POST'){posts.push({url:String(url),body:JSON.parse(init.body)});return {ok:true,status:200,json:async()=>({request_id:'mock-expression-success'})};}
  if(String(url).includes('predictions/'))return {ok:true,status:200,json:async()=>({status:'completed',outputs:['https://mock.invalid/expression.png']})};
  return {ok:true,status:200,arrayBuffer:async()=>png};
 };
 function response(){return {writeHead(status){this.status=status;},end(text){this.body=JSON.parse(text);}};}
 try {
  const a=response(),b=response(),route=require('../routes/characters');
  await contract.runWithApprovals([token],()=>Promise.all([a,b].map(res=>route.handleCharacters({method:'POST',body},res,['film','characters',f.id,'expressions','slot-4','generate']))));
  assert.deepEqual([a.status,b.status].sort(),[201,409],JSON.stringify([a.body,b.body]));assert.equal(posts.length,1);assert.equal(uploads.length,1);assert.deepEqual(uploads[0],png);
  const expected=JSON.parse(JSON.stringify(review.snapshot.body));expected.images_list=expected.images_list.map(()=> 'https://mock.invalid/identity.png');assert.deepEqual(posts[0].body,expected);assert.equal(posts[0].url,review.snapshot.endpoint);
  assert.equal(s.history(f.id,'slot-4').length,1);assert.equal(s.identity(f.id).id,f.anchor);assert.equal(s.slot(f.id,'slot-4').revision,2);
  const jobCount=db.prepare('SELECT COUNT(*) n FROM film_generation_jobs').get().n,r=response();
  await contract.runWithApprovals([token],()=>route.handleCharacters({method:'POST',body},r,['film','characters',f.id,'expressions','slot-4','generate']));assert.equal(r.status,409);assert.equal(posts.length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM film_generation_jobs').get().n,jobCount);
 }finally{global.fetch=original;}
});
test('two concurrent collectors file a pending expression exactly once; a newer selected version stays active',async()=>{
 const f=fixture(),slot=s.slot(f.id,'slot-5'),reserved=s.reserve(f.id,'slot-5',0);
 const jobs=require('../lib/generation-jobs'),provider=require('../lib/providers').get('muapi'),oldCollect=provider.collect;
 const id=jobs.record({provider:'muapi',capability:'image',requestId:crypto.randomUUID(),projectId:f.project,meta:{expression_delivery:{character_id:f.id,slot,activate_revision:reserved.revision}}});
 const newer=s.importImage(f.id,'slot-5',{revision:1,data});provider.collect=async()=>({ok:true,data:png});
 try{const results=await Promise.all([jobs.collect(id),jobs.collect(id)]);results.forEach(r=>assert.equal(r.ok,true,r.error));
  assert.equal(s.history(f.id,'slot-5').length,2);assert.equal(s.slot(f.id,'slot-5').active_asset_id,newer.asset_id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM film_assets WHERE json_valid(metadata) AND json_extract(metadata,'$.collected_from_job')=?").get(id).n,1);
  assert.equal((await jobs.collect(id)).already,'completed');
 }finally{provider.collect=oldCollect;}
});
test('a completed provider job interrupted before expression filing is recoverable from its existing handle without new generation',async()=>{
 const f=fixture(),slot=s.slot(f.id,'slot-6'),reserved=s.reserve(f.id,'slot-6',0),jobs=require('../lib/generation-jobs'),provider=require('../lib/providers').get('muapi'),oldCollect=provider.collect;
 const id=jobs.record({provider:'muapi',capability:'image',requestId:crypto.randomUUID(),projectId:f.project,meta:{expression_delivery:{character_id:f.id,slot,activate_revision:reserved.revision,identity_asset_id:f.anchor,approved_review_id:'saved-review',approved_fingerprint:'saved-fingerprint'}}});
 jobs.complete(id,{});let reads=0;provider.collect=async()=>{reads++;return {ok:true,data:png};};
 try{const result=await jobs.collect(id);assert.equal(result.ok,true,result.error);assert.equal(reads,1);const assets=s.history(f.id,'slot-6');assert.equal(assets.length,1);assert.equal(s.slot(f.id,'slot-6').active_asset_id,assets[0].id);assert.equal(assets[0].metadata.approved_fingerprint,'saved-fingerprint');assert.equal(assets[0].metadata.identity_asset_id,f.anchor);
  const replay=await jobs.collect(id,{belongs_to:{kind:'character',subject_id:f.id,view:'front'}});assert.equal(replay.already,'completed');assert.equal(reads,1);assert.equal(s.identity(f.id).id,f.anchor);assert.equal(G.isSendable(s.asset(f.id,assets[0].id)),false);assert.equal(s.history(f.id,'slot-6').length,1);
 }finally{provider.collect=oldCollect;}
});
test('character or canonical-identity changes during delivery preserve the old approved face in history without activating it',async()=>{
 for(const change of ['character','identity']){
  const f=fixture(),ch=s.character(f.id),slot=s.slot(f.id,'slot-1'),reserved=s.reserve(f.id,'slot-1',0);
  if(change==='character')db.prepare('UPDATE film_characters SET appearance_prompt=? WHERE id=?').run('Updated appearance while generation is pending',f.id);
  else{db.prepare('UPDATE film_assets SET metadata=? WHERE id=?').run(JSON.stringify({view:'front',plate_role:'superseded'}),f.anchor);const old=s.asset(f.id,f.anchor);db.prepare("INSERT INTO film_assets (id,project_id,character_id,asset_type,file_path,file_name,mime_type,metadata) VALUES (?,?,?,'character_sheet',?,?, 'image/png',?)").run(crypto.randomUUID(),f.project,f.id,old.file_path,old.file_name,JSON.stringify({view:'front',plate_role:'reference'}));}
  const out=await expr.deliverGenerated({character_id:f.id,slot,activate_revision:reserved.revision,identity_asset_id:f.anchor,character_fingerprint:expr.characterFingerprint(ch)},png,{collected_from_job:crypto.randomUUID()});
  assert.equal(out.activated,false);assert.equal(s.slot(f.id,'slot-1').active_asset_id,null);assert.equal(s.history(f.id,'slot-1').length,1);assert.equal(expr.meta(s.asset(f.id,out.asset_id)).identity_asset_id,f.anchor);
 }
});
test('actual storyboard planning records intentional expression metadata and invalidates it when its slot changes',async()=>{
 const f=fixture(),a=s.importImage(f.id,'slot-2',{revision:0,data}),scene=crypto.randomUUID(),shot=crypto.randomUUID();
 db.prepare('INSERT INTO film_scenes (id,project_id,scene_number) VALUES (?,?,1)').run(scene,f.project);
 db.prepare('INSERT INTO film_shots (id,scene_id,shot_code,scene_card_yaml) VALUES (?,?,?,?)').run(shot,scene,'1A',JSON.stringify({characters:[{name:'Creature'}],description:'Creature in an empty room'}));
 const body={expression_references:[{character_id:f.id,slot_id:'slot-2',asset_id:a.asset_id,revision:1}],seed:44};
 const item=await require('../lib/final-request-plans').boardItem(shot,body),contract=require('../lib/final-request-review'),review=await contract.store().preview(item);
 assert.equal(item.provenance.expression_selections[0].asset_id,a.asset_id);assert.equal(item.provenance.expression_selections[0].label,'Fear');
 assert(item.payload.reference_images.some(r=>r.reference_role==='expression'));assert.match(review.snapshot.body.prompt,/facial expression Fear/);
 contract.store().validate(review.id);s.update(f.id,'slot-2',{revision:1,label:'Apprehension'});
 assert.throws(()=>contract.store().validate(review.id),/inputs changed/);
});
test('unapproved or stale generation creates no paid transport, reservation or replacement',async()=>{
 const f=fixture(),route=require('../routes/characters');let status,body;
 const res={writeHead(s){status=s;},end(value){body=JSON.parse(value);}};
 await route.handleCharacters({method:'POST',body:{revision:0}},res,['film','characters',f.id,'expressions','slot-1','generate']);
 assert.equal(status,428);assert.match(body.error,/approved request/);assert.equal(s.slot(f.id,'slot-1').revision,0);
 const contract=require('../lib/final-request-review'),plan=await require('../lib/final-subject-request-plans').prepareSubjectRequests({path:`/characters/${f.id}/expressions/slot-1/generate`,body:{revision:0}});
 const review=await contract.store().preview(plan.items[0]);
 await contract.runWithApprovals([{id:review.id,fingerprint:review.fingerprint}],()=>route.handleCharacters({method:'POST',body:{revision:0}},res,['film','characters',f.id,'expressions','slot-1','generate']));
 assert.equal(status,409);assert.equal(s.slot(f.id,'slot-1').revision,0);
 const token=contract.store().approve(review.id,{fingerprint:review.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 s.update(f.id,'slot-1',{revision:0,label:'Fearful'});
 await contract.runWithApprovals([token],()=>route.handleCharacters({method:'POST',body:{revision:0}},res,['film','characters',f.id,'expressions','slot-1','generate']));
 assert.equal(status,409);assert.match(body.error,/changed/);assert.equal(s.slot(f.id,'slot-1').revision,1);
});
test('real manual prepare/create/import routes never submit generation and ignore a later UI target',async()=>{
 const f=fixture(),other=fixture(),route=require('../routes/final-request-review'),contract=require('../lib/final-request-review');
 async function request(method,parts,body){const res={writeHead(status){this.status=status;},end(text){this.body=JSON.parse(text);}};await route.handleFinalRequestReview({method,body},res,['film','final-request-review',...parts]);assert.equal(res.status,200,res.body.error);return res.body;}
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('No external transport permitted');};
 try {
  const initial=await request('POST',['prepare'],{path:`/characters/${f.id}/expressions/slot-6/generate`,body:{revision:0}}),review=initial.reviews[0];
  const h=await request('POST',[review.id,'handoff'],{fingerprint:review.fingerprint,human_confirmed:true});
  assert.equal(contract.store().get(review.id).state,'cancelled');assert.equal(s.slot(f.id,'slot-6').revision,0);
  const out=await request('POST',['handoffs',h.id,'import'],{data,character_id:other.id,slot_id:'slot-1'});
  assert.equal(s.slot(f.id,'slot-6').active_asset_id,out.asset_id);assert.equal(s.slot(other.id,'slot-1').active_asset_id,null);assert.equal(calls,0);
  assert.deepEqual(await request('POST',['handoffs',h.id,'import'],{data}),out);
 }finally{global.fetch=original;}
});
test('manual expression handoffs reject identity promotion before capture and before import, even with old reference bytes intact',async()=>{
 const contract=require('../lib/final-request-review'),handoffs=require('../lib/image-handoff').store();
 async function review(f){const planned=await require('../lib/final-subject-request-plans').prepareSubjectRequests({path:`/characters/${f.id}/expressions/slot-1/generate`,body:{revision:0}});return contract.store().preview(planned.items[0]);}
 function promoteOther(f){const file=path.join(temp,crypto.randomUUID()+'.png'),id=crypto.randomUUID();fs.writeFileSync(file,png);db.prepare('UPDATE film_assets SET metadata=? WHERE id=?').run(JSON.stringify({view:'front',plate_role:'superseded'}),f.anchor);db.prepare("INSERT INTO film_assets (id,project_id,character_id,asset_type,file_path,file_name,mime_type,metadata) VALUES (?,?,?,'character_sheet',?,?, 'image/png',?)").run(id,f.project,f.id,file,path.basename(file),JSON.stringify({view:'front',plate_role:'reference'}));assert(fs.existsSync(s.asset(f.id,f.anchor).file_path));}
 const a=fixture(),ra=await review(a);promoteOther(a);
 assert.throws(()=>handoffs.create(ra.id,{fingerprint:ra.fingerprint,human_confirmed:true}),/Canonical identity changed/);assert.equal(contract.store().get(ra.id).state,'preview');assert.equal(s.history(a.id,'slot-1').length,0);
 const b=fixture(),rb=await review(b),h=handoffs.create(rb.id,{fingerprint:rb.fingerprint,human_confirmed:true});promoteOther(b);
 assert.throws(()=>handoffs.importResult(h.id,{data}),/Canonical identity changed/);assert.equal(handoffs.get(h.id).state,'prepared');assert.equal(s.history(b.id,'slot-1').length,0);
});
test('existing partial character update preserves long unique biography, appearance and personality byte-for-byte',async()=>{
 const f=fixture(),text={description:'  Biography\n'.repeat(800),appearance_prompt:'  Appearance\n'.repeat(400),personality_notes:'  Personality\n'.repeat(400)};
 db.prepare('UPDATE film_characters SET description=?,appearance_prompt=?,personality_notes=? WHERE id=?').run(text.description,text.appearance_prompt,text.personality_notes,f.id);
 const res={writeHead(status){this.status=status;},end(data){this.body=JSON.parse(data);}};
 await require('../routes/characters').handleCharacters({method:'PUT',body:{height_m:2.5}},res,['film','characters',f.id]);assert.equal(res.status,200,res.body.error);
 for(const key of Object.keys(text))assert.equal(db.prepare(`SELECT ${key} FROM film_characters WHERE id=?`).get(f.id)[key],text[key]);
});
