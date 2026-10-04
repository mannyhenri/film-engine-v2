// GRD-4661: guided samples and permitted screenplay imports. Set-based over the registries
// lib/writing-style.js declares: the five prompt categories, rights bases, retention states and
// every reason a sample is not draft evidence. An example test passes when one reason is
// forgotten, and a forgotten reason is a held-out or deleted sample quietly shaping drafts.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-writing-samples-'));
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const ws=require('../lib/writing-style');
const {createWritingStyleStore,EXERCISES,STYLE_CATEGORIES,RIGHTS_BASES,RETENTION_STATES,INELIGIBLE_REASONS}=ws;
const {handleWritingStyle}=require('../routes/writing-style');
const {FIELD}=require('../lib/approval-guard');
const store=createWritingStyleStore(db);

function project(){const id=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(id,'Samples fixture');return id;}
const MINE={source:'Written by me, unaided',authorship:'original_human',confirmed_original:true,owner:'Manny',rights_basis:'own_writing',rights_confirmed:true,language:'en'};
function sample(id,text,extra={}){store.addSample(id,{text,...MINE,...extra});return store.snapshot(id).samples.at(-1);}
function approve(id,ids){const v=store.snapshot(id).profiles[0]?.version||0;store.propose(id,{expected_version:v,guidance:'Plain, quick.',sample_ids:ids});const p=store.snapshot(id).profiles[0];store.approve(id,p.version,{expected_version:p.version,human_confirmed:true,[FIELD]:p.evidence_hash});}
async function route(id,method,suffix='',body={}){
 let status,raw;const res={writeHead(c){status=c;},end(s){raw=s;}};
 await handleWritingStyle({method,body,headers:{}},res,['film','projects',id,'writing-style',...suffix.split('/').filter(Boolean)]);
 return {status,body:JSON.parse(raw)};
}

test('Learn my style offers short dialogue, action, description, comedy and suspense prompts',()=>{
 assert.deepEqual(EXERCISES.map(e=>e.id),['dialogue','action','description','comedy','suspense']);
 assert.deepEqual([...STYLE_CATEGORIES],EXERCISES.map(e=>e.id));
 for(const e of EXERCISES){assert.ok(e.label&&e.prompt.length>20,e.id);assert.match(e.prompt,/own words|without AI/i,e.id);}
});

test('a sample records source hash, owner, rights basis, type, language, tags, permitted projects and retention',()=>{
 const id=project(),other=project();
 const s=sample(id,'Two cups. One stays full.',{exercise:'dialogue',tags:['dialogue','quiet'],permitted_projects:[other]});
 assert.equal(s.fingerprint,crypto.createHash('sha256').update(JSON.stringify('Two cups. One stays full.')).digest('hex'));
 assert.equal(s.owner,'Manny');assert.equal(s.rights_basis,'own_writing');assert.equal(s.rights_confirmed,1);
 assert.equal(s.sample_type,'guided_exercise');assert.equal(s.language,'en');
 assert.deepEqual(s.tags,['dialogue','quiet']);assert.deepEqual(s.permitted_projects,[other]);
 assert.equal(s.retention,'active');assert.equal(s.included,1);assert.equal(s.eligibility,null);
 for(const bad of [{rights_basis:'found_online'},{language:'english!!'},{tags:'notalist'},{permitted_projects:['no-such-project']}])
  assert.throws(()=>store.addSample(id,{text:'x y z',...MINE,...bad}),e=>e.status===400,JSON.stringify(bad));
});

test('a permitted screenplay import keeps the source local, hashed, and every sample traceable to its span',async()=>{
 const id=project();
 const script='INT. KITCHEN - DAY\n\nMaya pours coffee.\n\nMAYA\nYou are late.\n\nEXT. STREET - DUSK\n\nRain. Nobody runs.\n';
 const refused=await route(id,'POST','sources',{title:'Pilot',text:script,owner:'Manny',rights_basis:'licensed',language:'en',authorship:'original_human',confirmed_original:true});
 assert.equal(refused.status,400,'an import without a rights confirmation is refused');
 const r=await route(id,'POST','sources',{title:'Pilot',text:script,owner:'Manny',rights_basis:'own_writing',rights_confirmed:true,language:'en',authorship:'original_human',confirmed_original:true});
 assert.equal(r.status,200,JSON.stringify(r.body));
 const doc=r.body.sources[0];
 assert.equal(doc.source_hash,crypto.createHash('sha256').update(script).digest('hex'));
 assert.equal(doc.local_only,1);assert.equal(doc.text,undefined,'the script text is not sent back with every snapshot');
 const imported=r.body.samples.filter(s=>s.source_document_id===doc.id);
 assert.equal(imported.length,2,'one sample per scene by default');
 for(const s of imported){
  assert.equal(script.slice(s.span_start,s.span_end).trim(),s.text);
  assert.equal(s.sample_type,'screenplay_import');assert.equal(s.rights_basis,'own_writing');assert.equal(s.owner,'Manny');
 }
 const spans=await route(id,'POST','sources',{title:'Pick',text:script,owner:'Manny',rights_basis:'own_writing',rights_confirmed:true,language:'en',authorship:'original_human',confirmed_original:true,spans:[{start:20,end:38,exercise:'action'}]});
 assert.equal(spans.body.samples.at(-1).text,'Maya pours coffee.');assert.equal(spans.body.samples.at(-1).exercise,'action');
 for(const bad of [[{start:-1,end:5}],[{start:5,end:5}],[{start:0,end:script.length+1}]]){
  const x=await route(id,'POST','sources',{title:'Bad',text:script,owner:'Manny',rights_basis:'own_writing',rights_confirmed:true,spans:bad});
  assert.equal(x.status,400,JSON.stringify(bad));
 }
});

// Each reason a sample must never reach a draft, and how a sample comes to have it.
const MAKE={
 excluded:(id)=>{const s=sample(id,'Excluded words, mine.');store.updateSample(id,{sample_id:s.id,included:false});return s;},
 deleted:(id)=>{const s=sample(id,'Deleted words, mine.');store.deleteSample(id,{sample_id:s.id});return s;},
 held_out:(id)=>sample(id,'Held out for the pilot.',{held_out:true}),
 unpermitted:(id)=>sample(id,'Rights never confirmed.',{rights_basis:'licensed',rights_confirmed:false}),
 not_permitted_project:(id)=>{const owner=project();const s=sample(owner,'Shared, then revoked.',{permitted_projects:[id]});store.setSampleAccess(owner,{sample_id:s.id,revoke:id});return s;},
 not_original:(id)=>{store.addSample(id,{text:'AI helped here.',source:'chat',authorship:'ai_assisted'});return store.snapshot(id).samples.at(-1);},
 unconfirmed_original:(id)=>{store.addSample(id,{text:'Mine but unconfirmed.',source:'notes',authorship:'original_human'});return store.snapshot(id).samples.at(-1);},
};
test('every ineligible sample is refused as evidence and never enters draft retrieval',()=>{
 assert.deepEqual(Object.keys(MAKE).sort(),[...INELIGIBLE_REASONS].sort());
 for(const reason of INELIGIBLE_REASONS){
  const id=project(),good=sample(id,'Short lines. Heavy pauses.');
  const bad=MAKE[reason](id);
  const listed=store.snapshot(id).samples.find(s=>s.id===bad.id);
  if(listed)assert.equal(listed.eligibility,reason,reason);
  assert.throws(()=>store.propose(id,{expected_version:store.snapshot(id).profiles[0]?.version||0,guidance:'x',sample_ids:[good.id,bad.id]}),e=>e.status>=400,reason);
  approve(id,[good.id]);
  const ctx=store.context(id);
  assert.ok(!ctx.text.includes(bad.text||'@@none'),`${reason} text reached the draft context`);
  assert.ok(!ctx.provenance.sample_ids.includes(bad.id),reason);
 }
});

test('changing a used sample to any ineligible state ends its approval at once',()=>{
 const turn={
  excluded:(id,s)=>store.updateSample(id,{sample_id:s.id,included:false}),
  deleted:(id,s)=>store.deleteSample(id,{sample_id:s.id}),
  held_out:(id,s)=>store.updateSample(id,{sample_id:s.id,held_out:true}),
  not_permitted_project:(id,s,owner)=>store.setSampleAccess(owner,{sample_id:s.id,revoke:id}),
 };
 for(const [reason,apply] of Object.entries(turn)){
  const owner=project(),id=reason==='not_permitted_project'?project():owner;
  const s=sample(owner,`Used, then ${reason}.`,reason==='not_permitted_project'?{permitted_projects:[id]}:{});
  approve(id,[s.id]);
  assert.ok(store.context(id).text.includes(s.text),`${reason}: used before`);
  apply(id,s,owner);
  // Retrieval stops with the change itself: the approval that used the sample is stale, and drafting gets nothing from it.
  let ctx;try{ctx=store.context(id);}catch(e){assert.equal(e.code,'STALE_APPROVAL',reason);ctx=store.context(id);}
  assert.deepEqual(ctx,{text:'',provenance:null},`${reason}: no retrieval after`);
  assert.equal(store.snapshot(id).profiles[0].state,'stale',reason);
 }
});

test('coverage shows each category and its gaps; a partial profile names what it lacks instead of inventing it',()=>{
 const id=project();
 assert.deepEqual(store.snapshot(id).coverage.gaps,[...STYLE_CATEGORIES]);
 const d=sample(id,'"Stay." "Why?" "Because."',{exercise:'dialogue'}),a=sample(id,'He runs. The door slams.',{tags:['action']});
 const cov=store.snapshot(id).coverage;
 for(const c of STYLE_CATEGORIES)assert.equal(cov.categories.find(x=>x.id===c).count,['dialogue','action'].includes(c)?1:0,c);
 assert.deepEqual(cov.gaps,['description','comedy','suspense']);
 approve(id,[d.id,a.id]);
 const ctx=store.context(id);
 assert.deepEqual(ctx.provenance.coverage.missing,['description','comedy','suspense']);
 for(const gap of ['description','comedy','suspense'])assert.match(ctx.text,new RegExp(gap));
 assert.match(ctx.text,/do not infer/i);
});

test('deletion keeps only a non-prose tombstone and scrubs the prose from imported profiles',()=>{
 const id=project();
 const portable={schema_version:'1.0.0',owner:'Manny',profile_name:'P',profile_version:'1',
  sources:[{id:'src1',kind:'original_sample',author:'Manny',provenance:'mine',locator:'x',approved_excerpt:'A secret line only I wrote.'}],
  approved_rules:[],approved_examples:[],pending_proposals:[],feedback:[],history:[],prior_snapshots:[]};
 store.importProfile(id,{profile:portable,human_confirmed:true});
 const s=store.snapshot(id).samples.find(x=>x.text==='A secret line only I wrote.');
 store.deleteSample(id,{sample_id:s.id});
 const row=db.prepare('SELECT * FROM film_writing_samples WHERE id=?').get(s.id);
 assert.equal(row.text,'');assert.equal(row.retention,'deleted');assert.ok(row.deleted_at);assert.equal(row.fingerprint,s.fingerprint,'the hash stays as provenance');
 assert.notEqual(row.source,s.source);assert.equal(row.source_meta,'{}');
 const everything=JSON.stringify(db.prepare('SELECT * FROM film_writing_imports WHERE project_id=?').all(id))+JSON.stringify(store.snapshot(id))+JSON.stringify(store.portable(id));
 assert.ok(!everything.includes('A secret line only I wrote.'),'no copy of the prose survives');
 const srcProject=project();
 const r=store.importSource(srcProject,{title:'T',text:'INT. A - DAY\n\nWords of mine.\n',owner:'Manny',rights_basis:'own_writing',rights_confirmed:true,authorship:'original_human',confirmed_original:true});
 store.deleteSource(srcProject,{document_id:r.sources[0].id});
 const doc=db.prepare('SELECT * FROM film_writing_source_documents WHERE id=?').get(r.sources[0].id);
 assert.equal(doc.text,'');assert.ok(doc.deleted_at);assert.ok(doc.source_hash);
 assert.ok(store.snapshot(srcProject).samples.every(x=>x.retention==='deleted'&&x.text===''));
});

test('declared retention states and rights bases are the ones the schema holds',()=>{
 assert.deepEqual([...RETENTION_STATES],['active','held_out','deleted']);
 assert.deepEqual([...RIGHTS_BASES],['own_writing','licensed','permission_granted']);
 const id=project(),s=sample(id,'Schema check words.');
 for(const r of RETENTION_STATES)db.prepare('UPDATE film_writing_samples SET retention=? WHERE id=?').run(r,s.id);
 assert.throws(()=>db.prepare('UPDATE film_writing_samples SET retention=? WHERE id=?').run('archived',s.id),/CHECK/);
});
