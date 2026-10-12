// Every generation route the planner cannot prepare is reached by the bridge's
// fallback POST, which runs the route for real. Set-based over the router-checked
// inventory (route-review-paths.json `routes`): with keys present and the project
// pinned to manual vendors, each route either reaches a manual review carrying its
// full prompt and assets, with no vendor call and no row left behind, or is named
// in fixtures/manual-route-fixtures.js as not a manual generation, with a reason.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),Module=require('module'),{Readable}=require('stream');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-manual-routes-'));
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const manual=require('../lib/manual-generation');
// Keys present for every manual vendor: the realistic case for an existing install.
require('../lib/providers/credentials').getCredential=id=>({apiKey:manual.MANUAL_PROVIDERS.has(id)?'mock-only':null,meta:{}});
const serverPath=path.join(__dirname,'../server.js'),compiled=new Module(serverPath,module);compiled.filename=serverPath;compiled.paths=Module._nodeModulePaths(path.dirname(serverPath));
compiled._compile(fs.readFileSync(serverPath,'utf8').replace(/\nstart\(\);\s*$/,'\nmodule.exports={server};'),serverPath);
const handler=compiled.exports.server.listeners('request')[0];
let callCount=0;
function call(method,url,body){return new Promise((resolve,reject)=>{
 const req=Readable.from([Buffer.from(JSON.stringify(body??{}))]);req.socket={remoteAddress:'127.0.0.'+(++callCount%250+1)};req.method=method;req.url='/film'+url;req.headers={'content-type':'application/json'};
 let chunks='';const timer=setTimeout(()=>resolve({status:'timeout',text:chunks}),15000);
 // A real EventEmitter, so a file can be piped into it as into a response.
 const res=Object.assign(new (require('events'))(),{statusCode:200,headersSent:false,writableEnded:false,setHeader(){},getHeader(){},flushHeaders(){},writeHead(code){this.statusCode=code;this.headersSent=true;return this;},write(d){chunks+=Buffer.isBuffer(d)?d.toString('latin1'):String(d);return true;},end(d){if(d)chunks+=Buffer.isBuffer(d)?d.toString('latin1'):String(d);this.writableEnded=true;clearTimeout(timer);resolve({status:this.statusCode,text:chunks});}});
 Promise.resolve(handler(req,res)).catch(e=>{clearTimeout(timer);resolve({status:'threw',text:e.message});});
});}
const SIDE_EFFECT_TABLES=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%job%' OR name LIKE '%asset%' OR name LIKE '%usage%' OR name LIKE '%transport_receipt%')").all().map(r=>r.name);
const counts=()=>Object.fromEntries(SIDE_EFFECT_TABLES.map(t=>[t,db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n]));
const inventory=JSON.parse(fs.readFileSync(path.join(__dirname,'../../src/components/FinalRequestReview/route-review-paths.json'),'utf8'));

// The full prompt the review hands over, wherever the provider keeps it.
function promptOf(body={}){
 for(const key of ['prompt','promptText','text'])if(typeof body[key]==='string'&&body[key].trim())return body[key];
 const field=(body.fields||[]).find(f=>f.name==='prompt'&&typeof f.value==='string');if(field)return field.value;
 if(typeof body.instances?.[0]?.prompt==='string')return body.instances[0].prompt;
 if(typeof body.world_prompt?.text_prompt==='string')return body.world_prompt.text_prompt;
 const part=Array.isArray(body.input)?body.input.find(p=>p.type==='text'):null;if(part?.text)return part.text;
 // Runway multi-shot: a prompt per shot.
 return Array.isArray(body.shots)?body.shots.map(s=>s?.prompt||'').filter(Boolean).join('\n'):'';
}
test('every real generation route reaches a manual review with its full prompt and assets; no vendor call, no row left behind',async()=>{
 const fixtures=require('./fixtures/manual-route-fixtures');
 const demo=await call('POST','/projects/demo',{});const project=JSON.parse(demo.text).project_id;assert.ok(project,'demo project');
 db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({image:'muapi',video:'runway',voice:'elevenlabs',sfx:'elevenlabs',ambient:'elevenlabs',music:'elevenlabs',model3d:'meshy',post:'magnific',world:'worldlabs'}),project);
 const first=sql=>{try{return db.prepare(sql).get(project)?.id;}catch(_){return null;}};
 const ids={projects:project,shots:first('SELECT s.id FROM film_shots s JOIN film_scenes sc ON s.scene_id=sc.id WHERE sc.project_id=? LIMIT 1'),scenes:first('SELECT id FROM film_scenes WHERE project_id=? LIMIT 1'),
  characters:first('SELECT id FROM film_characters WHERE project_id=? LIMIT 1'),locations:first('SELECT id FROM film_locations WHERE project_id=? LIMIT 1'),props:first('SELECT id FROM film_props WHERE project_id=? LIMIT 1')};
 const outbound=[];const original=global.fetch;
 global.fetch=async(url)=>{outbound.push(String(url));return new Response(JSON.stringify({error:'offline in test'}),{status:503,headers:{'content-type':'application/json'}});};
 const problems=[],reached=[],batchCounts={};
 try{
  const cases=await fixtures.generationCases({db,call,project,ids});
  // Set-complete: every real route the router serves is either a generation case or named, with a reason, as not a manual generation.
  const key=r=>r.method+' '+r.path;
  const covered=new Set([...cases.map(key),...fixtures.NOT_MANUAL_GENERATION.map(key)]);
  for(const route of inventory.routes)if(!covered.has(key(route)))problems.push({route:key(route),problem:'neither a generation case nor named as not manual'});
  for(const c of cases){
   const before=counts(),sent=outbound.length;
   // A case the app's bridge reviews through the planner is reviewed that way here too.
   const saved={};for(const [k,v] of Object.entries(c.env||{})){saved[k]=process.env[k];process.env[k]=v;}
   let out=c.planner?await call(c.planner.method,c.planner.url,c.planner.body):await call(c.method,c.url,c.body||{});
   for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
   if(c.planner){const first=JSON.parse(out.text).reviews?.[0];out={...out,text:first?'FINAL_REQUEST_REVIEW_REQUIRED:'+first.id:out.text};}
   if(c.followUp){const more=await c.followUp(out,call);if(process.env.ROUTE_DEBUG)console.log('FOLLOWUP',key(c),String(typeof more==='string'?more:more?.text).slice(0,400));out={...out,text:out.text+'\n'+(typeof more==='string'?more:more?.text??'')};}
   const vendor=outbound.slice(sent).filter(u=>!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u));
   const id=(out.text.match(/FINAL_REQUEST_REVIEW_REQUIRED:([A-Za-z0-9_-]+)/)||[])[1];
   // A batch hands over every item, not the first: each item's review comes back.
   const allIds=[...new Set([...out.text.matchAll(/FINAL_REQUEST_REVIEW_REQUIRED:([A-Za-z0-9_-]+)/g)].map(m=>m[1]))];
   if(/batch/.test(c.path)){
    batchCounts[key(c)]=allIds.length;
    // Every item, counted from the project itself: each dialogue line for voice, every scene for music.
    const {extractDialogue}=require('../lib/dialogue-builder');
    const shots=db.prepare('SELECT s.scene_card_yaml FROM film_shots s JOIN film_scenes sc ON s.scene_id=sc.id WHERE sc.project_id=?').all(project);
    const lines=shots.reduce((n,s)=>{try{return n+extractDialogue(JSON.parse(s.scene_card_yaml||'{}')).length;}catch(_){return n;}},0);
    const scenes=db.prepare('SELECT COUNT(*) n FROM film_scenes WHERE project_id=?').get(project).n;
    const expected=/voice/.test(c.path)?lines:scenes;
    if(allIds.length<3||(/voice/.test(c.path)?allIds.length!==expected:allIds.length<expected))problems.push({route:key(c),problem:`batch handed over ${allIds.length} review(s), expected ${/voice/.test(c.path)?'':'at least '}${expected}`});
   }
   for(const other of allIds.slice(1)){const r=JSON.parse((await call('GET','/final-request-review/'+other)).text);if(!manual.isManual(r.snapshot?.provider,r.snapshot?.capability)||!promptOf(r.snapshot?.body))problems.push({route:key(c),problem:'batch item review incomplete',id:other});}
   if(vendor.length)problems.push({route:key(c),problem:'vendor call',vendor});
   if(!id){problems.push({route:key(c),problem:'no review',status:out.status,text:out.text.slice(0,200)});continue;}
   const review=JSON.parse((await call('GET','/final-request-review/'+id)).text),snap=review.snapshot||{};
   if(!manual.isManual(snap.provider,snap.capability))problems.push({route:key(c),problem:'review is not for a manual vendor',provider:snap.provider});
   const prompt=promptOf(snap.body);
   // A text prompt, or, for an operation on a model or clip (rig, upscale), the asset it operates on.
   if(!prompt&&!(['post','image-upscale','model3d'].includes(snap.capability)&&(snap.references||[]).length))problems.push({route:key(c),problem:'review has no prompt',capability:snap.capability});
   if(!Array.isArray(snap.references))problems.push({route:key(c),problem:'review has no asset list'});
   for(const ref of snap.references||[]){
    if(!ref.mime||!ref.order||!(ref.data||(ref.path&&ref.byte_length)))problems.push({route:key(c),problem:'asset missing bytes/mime/order'});
    // A clip or model kept on disk is handed over by the original download.
    if(!ref.data){const got=await call('GET',`/final-request-review/${id}/references/${ref.order}/original`);if(got.status!==200||got.text.length!==ref.byte_length)problems.push({route:key(c),problem:'original asset not downloadable',status:got.status});}
   }
   const after=counts(),grew=Object.keys(after).filter(t=>after[t]!==before[t]&&!/review/.test(t));
   if(grew.length)problems.push({route:key(c),problem:'rows left behind the review',grew});
   reached.push(`${key(c)} → ${snap.provider}/${snap.capability} · ${(snap.references||[]).length} assets · "${prompt.slice(0,50)}"`);
  }
  for(const n of fixtures.NOT_MANUAL_GENERATION){
   const route=inventory.routes.find(r=>key(r)===key(n));if(!route)continue;
   const sent=outbound.length;await call(n.method,'/'+n.path.split('/').slice(1).map((seg,i,all)=>seg==='ID'?(ids[all[i-1]]||'x1'):seg.replace(/ID/g,'x1')).join('/'),{});
   const vendor=outbound.slice(sent).filter(u=>!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u));
   if(vendor.length)problems.push({route:key(n),problem:'vendor call from a non-generation route',vendor});
  }
 }finally{global.fetch=original;}
 console.log('reached review:\n  '+reached.join('\n  '));
 console.log('batch reviews handed over',JSON.stringify(batchCounts));
 console.log(`routes ${inventory.routes.length}: generation ${reached.length} reached review; not manual ${fixtures.NOT_MANUAL_GENERATION.length}`);
 assert.deepEqual(problems,[]);
});
test('every planner-prepared generation path reaches a manual review with its full prompt and assets; no vendor call',async()=>{
 const fixtures=require('./fixtures/manual-route-fixtures');
 assert.equal(typeof fixtures.plannerCases,'function','fixtures.plannerCases exists');
 const demo=await call('POST','/projects/demo',{});const project=JSON.parse(demo.text).project_id;
 db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({image:'muapi',video:'runway',voice:'elevenlabs',sfx:'elevenlabs',ambient:'elevenlabs',music:'elevenlabs',model3d:'meshy',post:'magnific',world:'worldlabs'}),project);
 const first=sql=>{try{return db.prepare(sql).get(project)?.id;}catch(_){return null;}};
 const ids={projects:project,shots:first('SELECT s.id FROM film_shots s JOIN film_scenes sc ON s.scene_id=sc.id WHERE sc.project_id=? LIMIT 1'),scenes:first('SELECT id FROM film_scenes WHERE project_id=? LIMIT 1'),
  characters:first('SELECT id FROM film_characters WHERE project_id=? LIMIT 1'),locations:first('SELECT id FROM film_locations WHERE project_id=? LIMIT 1'),props:first('SELECT id FROM film_props WHERE project_id=? LIMIT 1')};
 const routeReviewed=new Set(inventory.route_reviewed),planner=inventory.gated.filter(p=>!routeReviewed.has(p));
 assert.ok(planner.length>=26,'planner set present: '+planner.length);
 const outbound=[];const original=global.fetch;
 global.fetch=async(url)=>{outbound.push(String(url));return new Response(JSON.stringify({error:'offline in test'}),{status:503,headers:{'content-type':'application/json'}});};
 const problems=[],reached=[];
 try{
  const cases=await fixtures.plannerCases({db,call,project,ids});
  const named=new Set((fixtures.NOT_MANUAL_PLANNER||[]).map(n=>n.path));
  const covered=new Set([...cases.map(c=>c.path),...named]);
  // Set-complete: every planner-prepared gated path is a case or named, with a reason.
  for(const p of planner)if(!covered.has(p))problems.push({path:p,problem:'neither a planner case nor named as not manual'});
  for(const c of cases){
   const sent=outbound.length;
   const out=await call('POST','/final-request-review/prepare',{path:c.url,body:c.body||{}});
   const vendor=outbound.slice(sent).filter(u=>!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u));
   if(vendor.length)problems.push({path:c.path,problem:'vendor call',vendor});
   let reviews=[];try{reviews=JSON.parse(out.text).reviews||[];}catch(_){}
   if(out.status!==200||!reviews.length){problems.push({path:c.path,problem:'no review',status:out.status,text:out.text.slice(0,200)});continue;}
   for(const r of reviews){
    const snap=r.snapshot||{};
    if(!manual.isManual(snap.provider,snap.capability))problems.push({path:c.path,problem:'review is not for a manual vendor',provider:snap.provider});
    const prompt=promptOf(snap.body);
    if(!prompt&&!(['post','image-upscale','model3d'].includes(snap.capability)&&(snap.references||[]).length))problems.push({path:c.path,problem:'review has no prompt',capability:snap.capability});
    for(const ref of snap.references||[])if(!ref.mime||!ref.order||!(ref.data||(ref.path&&ref.byte_length)))problems.push({path:c.path,problem:'asset missing bytes/mime/order'});
   }
   reached.push(`${c.path} → ${reviews.length} review(s): ${reviews.map(r=>r.snapshot?.provider+'/'+r.snapshot?.capability).join(', ')}`);
  }
 }finally{global.fetch=original;}
 console.log('planner reached review:\n  '+reached.join('\n  '));
 console.log(`planner paths ${planner.length}: reached ${reached.length}; named ${(fixtures.NOT_MANUAL_PLANNER||[]).length}`);
 assert.deepEqual(problems,[]);
});

test('a kept Gridlight generation runs end to end: saved result, no review, only the local gateway contacted',async()=>{
 const original=global.fetch,contacted=[];
 const wav=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(40)]);
 global.fetch=async(url)=>{contacted.push(String(url));return /localhost|127\.0\.0\.1/.test(String(url))?new Response(wav,{status:200,headers:{'content-type':'audio/wav'}}):new Response('{}',{status:503});};
 try{
  await call('PUT','/settings',{gridlight_enabled:'1'});
  try{require('../lib/providers').refreshLocalGateway?.();}catch(_){}
  const project=JSON.parse((await call('POST','/projects/demo',{})).text).project_id;
  db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({sfx:'gridlight',ambient:'gridlight',music:'gridlight'}),project);
  const before=db.prepare('SELECT COUNT(*) n FROM film_final_request_reviews').get().n;
  const out=await call('POST',`/projects/${project}/sounds/generate`,{prompt:'Rain on a tin roof',provider:'gridlight'});
  assert.equal(out.status,200,out.text.slice(0,200));
  const saved=JSON.parse(out.text);assert.ok(saved.asset_id,'a result was saved');
  assert.ok(db.prepare('SELECT 1 FROM film_assets WHERE id=?').get(saved.asset_id),'the asset row exists');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM film_final_request_reviews').get().n,before,'no review for a kept provider');
  assert.ok(contacted.length>0&&contacted.every(u=>/localhost|127\.0\.0\.1/.test(u)),'only the local gateway: '+contacted.join(', '));
 }finally{global.fetch=original;await call('PUT','/settings',{gridlight_enabled:''});}
});
test.after(()=>{compiled.exports.server.close();db.close();fs.rmSync(process.env.FILM_DATA_DIR,{recursive:true,force:true});});
