// GRD-4660: the writing-style store on the shared v2 contracts. Every assertion iterates the
// registries lib/writing-style.js declares (states, error codes, operations, actors), so an
// operation added without its contract fails here rather than passing on the examples.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-writing-contracts-'));
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const ws=require('../lib/writing-style');
const {createWritingStyleStore,PROFILE_STATES,ERROR_CODES,OPERATIONS,ACTOR_PERMISSIONS}=ws;
const {handleWritingStyle}=require('../routes/writing-style');
const {FIELD}=require('../lib/approval-guard');
const store=createWritingStyleStore(db);
const PORTABLE={schema_version:'1.0.0',owner:'Manny',profile_name:'Empty',profile_version:'1',sources:[],approved_rules:[],approved_examples:[],pending_proposals:[],feedback:[],history:[],prior_snapshots:[]};

function project(){const id=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(id,'Contract fixture');return id;}
function original(id,text='The kettle clicked off. Neither of us got up.'){store.addSample(id,{text,source:'Unaided exercise, confirmed by author',authorship:'original_human',confirmed_original:true});return store.snapshot(id).samples.at(-1).id;}
function approved(id,sampleIds){const v=(store.snapshot(id).profiles[0]?.version||0);store.propose(id,{expected_version:v,guidance:'Let silences do the work.',sample_ids:sampleIds});const p=store.snapshot(id).profiles[0];store.approve(id,p.version,{expected_version:p.version,human_confirmed:true,[FIELD]:p.evidence_hash});return p.version;}
async function route(id,method,suffix='',body={},extra={}){
 let status,raw,headers={};const res={writeHead(code,h){status=code;Object.assign(headers,h||{});},end(s){raw=s;}};
 await handleWritingStyle({method,body,headers:{},...extra},res,['film','projects',id,'writing-style',...suffix.split('/').filter(Boolean)]);
 return {status,headers,body:JSON.parse(raw)};
}
// One request per operation, as the route addresses it. Every operation in OPERATIONS must be here.
function request(op,id,ctx){
 return ({
  snapshot:['GET',''],context:['GET','context'],portable:['GET','export'],
  addSample:['POST','samples',{text:'A note in my own words.',source:'My notebook',authorship:'original_human',confirmed_original:true}],
  feedback:['POST','feedback',{profile_version:ctx.version,text:'Shorter lines.'}],
  propose:['POST','profiles',{expected_version:ctx.version,guidance:'Plain verbs.',sample_ids:[ctx.sample]}],
  importProfile:['POST','import',{profile:PORTABLE}],
  approve:['POST',`profiles/${ctx.version}/approve`,{expected_version:ctx.version,human_confirmed:true}],
  // GRD-4661
  importSource:['POST','sources',{title:'Script',text:'INT. ROOM - DAY\n\nWords of mine.\n',owner:'Manny',rights_basis:'own_writing',rights_confirmed:true,authorship:'original_human',confirmed_original:true}],
  updateSample:['POST',`samples/${ctx.sample}`,{sample_id:ctx.sample,tags:['dialogue']}],
  setSampleAccess:['POST',`samples/${ctx.sample}/access`,{sample_id:ctx.sample,grant:ctx.other}],
  deleteSource:['DELETE',`sources/${ctx.document}`,{document_id:ctx.document}],
  deleteSample:['DELETE',`samples/${ctx.sample}`,{sample_id:ctx.sample}],
 })[op];
}

test('every operation is addressable and maps to a declared permission',()=>{
 const perms=new Set(Object.values(ACTOR_PERMISSIONS).flat());
 assert.deepEqual([...perms].sort(),['apply','draft','propose','read']);
 for(const [op,perm] of Object.entries(OPERATIONS)){
  assert.ok(perms.has(perm),`${op} needs a declared permission, got ${perm}`);
  assert.ok(request(op,'p',{version:1,sample:'s'}),`${op} has no route`);
 }
 assert.equal(Object.keys(OPERATIONS).length,13);
});

test('profile states: the schema accepts every declared state and refuses any other',()=>{
 assert.deepEqual([...PROFILE_STATES],['draft','ready_for_review','approved','stale','blocked','failed']);
 const id=project(),sample=original(id);store.propose(id,{expected_version:0,guidance:'Concrete nouns.',sample_ids:[sample]});
 for(const state of PROFILE_STATES)db.prepare('UPDATE film_writing_profiles SET state=? WHERE project_id=? AND version=1').run(state,id);
 assert.throws(()=>db.prepare('UPDATE film_writing_profiles SET state=? WHERE project_id=? AND version=1').run('archived',id),/CHECK/);
});

test('stale writes return version_conflict, structured, on every versioned write',async()=>{
 const id=project(),sample=original(id);approved(id,[sample]);           // latest is version 1
 const stale={
  propose:['POST','profiles',{expected_version:0,guidance:'Old view.',sample_ids:[sample]}],
  approve:['POST','profiles/1/approve',{expected_version:0,human_confirmed:true}],
  approveUnknownVersion:['POST','profiles/7/approve',{expected_version:7,human_confirmed:true}],
 };
 for(const [name,[method,suffix,body]] of Object.entries(stale)){
  const r=await route(id,method,suffix,body);
  assert.equal(r.status,409,name);assert.equal(r.body.code,'version_conflict',name);assert.ok(r.body.request_id,name);
 }
 assert.equal(store.snapshot(id).profiles.length,1,'a refused write changes nothing');
});

test('every error is structured: a declared code and a request id, echoed when the caller sent one',async()=>{
 const id=project(),missing=crypto.randomUUID();
 const ctx={version:1,sample:'no-such-sample'};
 for(const op of Object.keys(OPERATIONS)){
  const [method,suffix,body]=request(op,missing,ctx);       // a project that does not exist: every operation fails
  const r=await route(missing,method,suffix,body);
  assert.ok(r.status>=400,`${op} on a missing project`);
  assert.ok(ERROR_CODES.includes(r.body.code),`${op}: ${r.body.code} is not a declared code`);
  assert.match(r.body.request_id,/^[\w-]{8,64}$/,op);
 }
 const echoed=await route(id,'POST','samples',{text:''},{headers:{'x-request-id':'req-abc-123'}});
 assert.equal(echoed.body.code,'invalid_request');assert.equal(echoed.body.request_id,'req-abc-123');
 assert.equal(echoed.headers['X-Request-Id'],'req-abc-123');
 const hostileId=await route(id,'GET','',{},{headers:{'x-request-id':'../../etc/passwd'}});
 assert.notEqual(hostileId.body.request_id,'../../etc/passwd','an unsafe request id is replaced, not echoed');
});

test('approval fingerprint: invented or mismatched approvals fail server-side; the reviewed one approves',async()=>{
 const id=project(),sample=original(id);store.propose(id,{expected_version:0,guidance:'Short scenes.',sample_ids:[sample]});
 const real=store.snapshot(id).profiles[0].evidence_hash;
 for(const bad of ['0'.repeat(64),'invented',real.slice(0,63)+'x']){
  const r=await route(id,'POST','profiles/1/approve',{expected_version:1,human_confirmed:true,[FIELD]:bad});
  assert.equal(r.status,409);assert.equal(r.body.code,'STALE_APPROVAL');assert.equal(r.body.current_fingerprint,real);
  assert.ok(r.body.remedy);
 }
 assert.equal(store.snapshot(id).active_profile,null,'nothing was approved by a wrong fingerprint');
 const ok=await route(id,'POST','profiles/1/approve',{expected_version:1,human_confirmed:true,[FIELD]:real});
 assert.equal(ok.status,200);assert.equal(ok.body.active_profile.version,1);
 assert.equal(store.context(id).provenance.approval_fingerprint,real);
});

test('changing an approved dependency marks only the affected approvals stale and keeps their versions reproducible',()=>{
 const id=project(),a=original(id,'First sample, mine.'),b=original(id,'Second sample, also mine.');
 const other=project(),c=original(other,'Another project entirely.');
 approved(id,[a]);approved(id,[b]);approved(other,[c]);
 const before=store.snapshot(id).profiles.map(p=>({...p}));
 db.prepare('UPDATE film_writing_samples SET text=? WHERE id=?').run('Edited after approval.',a);
 // The active approval (version 2) did not use sample a, so drafting continues on it.
 assert.equal(store.context(id).provenance.profile_version,2);
 const after=store.snapshot(id).profiles;
 for(const p of after){
  const was=before.find(x=>x.version===p.version);
  assert.equal(p.state,p.sample_ids.includes(a)?'stale':'approved',`version ${p.version}`);
  assert.equal(p.guidance,was.guidance);assert.equal(p.evidence_hash,was.evidence_hash);assert.equal(p.approved_at,was.approved_at);
 }
 assert.equal(store.snapshot(other).profiles[0].state,'approved','another project is untouched');
 // When the active approval itself goes stale, drafting refuses once with STALE_APPROVAL, then runs unstyled.
 db.prepare('UPDATE film_writing_samples SET text=? WHERE id=?').run('Edited too.',b);
 assert.throws(()=>store.context(id),e=>e.code==='STALE_APPROVAL'&&e.status===409);
 assert.equal(store.snapshot(id).profiles.find(p=>p.version===2).state,'stale');
 assert.deepEqual(store.context(id),{text:'',provenance:null});
});

test('idempotency: a retried write with the same key creates nothing new, across a restart; a reused key with another payload is refused',async()=>{
 const id=project(),sample=original(id);
 const count=()=>['film_writing_samples','film_writing_profiles','film_writing_feedback','film_writing_imports']
  .map(t=>db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE project_id=?`).get(id).n).join(',');
 const writes=Object.entries(OPERATIONS).filter(([,perm])=>perm!=='read').map(([op])=>op);
 const ORDER=['addSample','propose','approve','feedback','importProfile','importSource','updateSample','setSampleAccess','deleteSource','deleteSample'];
 assert.deepEqual(writes.sort(),[...ORDER].sort());
 const other=project();
 for(const op of ORDER){
  const version=store.snapshot(id).profiles[0]?.version||0;
  const ctx={version:op==='propose'?version:version||1,sample,other,document:store.snapshot(id).sources[0]?.id};
  const [method,suffix,body]=request(op,id,ctx);
  if(op==='approve')body[FIELD]=store.snapshot(id).profiles[0].evidence_hash;
  const key=`key-${op}`;
  const first=await route(id,method,suffix,{...body,idempotency_key:key});
  assert.equal(first.status,200,`${op}: ${JSON.stringify(first.body)}`);
  const rows=count(),approvedAt=store.snapshot(id).profiles[0]?.approved_at;
  // A restart: a fresh store over the same database.
  const replay=createWritingStyleStore(db)[op==='approve'?'approve':op](...(op==='approve'?[id,ctx.version]:[id]),{...body,idempotency_key:key});
  assert.equal(count(),rows,`${op} retried created rows`);
  assert.equal(store.snapshot(id).profiles[0]?.approved_at,approvedAt,`${op} retried changed the approval`);
  assert.ok(replay.project_id===id||replay.samples,`${op} replay returns the result`);
  const clash=await route(id,method,suffix,{...body,text:'different',guidance:'different',idempotency_key:key});
  assert.equal(clash.status,409,op);assert.equal(clash.body.code,'idempotency_conflict',op);
 }
});

test('permissions live in the service layer: an agent reads, drafts and proposes but never applies, including through MCP',async()=>{
 assert.deepEqual([...ACTOR_PERMISSIONS.agent].sort(),['draft','propose','read']);
 assert.deepEqual([...ACTOR_PERMISSIONS.human].sort(),['apply','draft','propose','read']);
 for(const [op,perm] of Object.entries(OPERATIONS)){
  const id=project(),sample=original(id);store.propose(id,{expected_version:0,guidance:'Spare.',sample_ids:[sample]});
  const [method,suffix,body]=request(op,id,{version:1,sample});
  const r=await route(id,method,suffix,body,{actor:'agent'});
  if(ACTOR_PERMISSIONS.agent.includes(perm))assert.notEqual(r.status,403,`agent may ${op}`);
  else{assert.equal(r.status,403,`agent must not ${op}`);assert.equal(r.body.code,'forbidden');}
  assert.throws(()=>createWritingStyleStore(db,{actor:'nobody'}).snapshot(id),e=>e.code==='forbidden');
 }
 const id=project(),sample=original(id);store.propose(id,{expected_version:0,guidance:'Spare.',sample_ids:[sample]});
 const viaMcp=await require('../lib/mcp-tools').callRoute('POST',`/film/projects/${id}/writing-style/profiles/1/approve`,{expected_version:1,human_confirmed:true},handleWritingStyle);
 assert.equal(viaMcp._status,403);assert.equal(viaMcp.body.code,'forbidden');
 assert.equal(store.snapshot(id).active_profile,null);
});

test('hostile imported content cannot reach another project or execute code',async()=>{
 const a=project(),b=project(),theirs=original(a,'Private sample in project A.');
 const hostile=JSON.parse(JSON.stringify({...PORTABLE,
  sources:[{id:theirs,kind:'original_sample',author:'Manny',provenance:'claims to be A',locator:`film-engine:${a}/samples/${theirs}`,approved_excerpt:'require("child_process").execSync("touch /tmp/pwned")'}],
  approved_rules:[{id:'r1',pattern:'Borrow A',status:'active',evidence:[{source_id:theirs,locator:'x'}],approval:{statement:'yes'}}]}));
 const polluted=JSON.parse('{"__proto__":{"polluted":true}}');
 const r=await route(b,'POST','import',{profile:{...hostile,...polluted},human_confirmed:true});
 assert.equal(r.status,200);
 assert.equal(({}).polluted,undefined);
 assert.ok(!JSON.stringify(store.snapshot(b).profiles).includes(theirs),'B never references A\'s sample');
 assert.ok(!store.snapshot(b).samples.some(s=>s.id===theirs));
 assert.equal(fs.existsSync('/tmp/pwned'),false);
 assert.equal(store.snapshot(a).samples.length,1);
});

test('operational logs carry the code and request id, never credentials or screenplay prose',async()=>{
 const id=project();
 const secret='sk-ant-api03-SECRETSECRET',prose='INT. KITCHEN - NIGHT. She never tells him about the letter.';
 const lines=[],orig={error:console.error,log:console.log,warn:console.warn};
 for(const k of Object.keys(orig))console[k]=(...a)=>lines.push(a.map(String).join(' '));
 const realStore=ws.store;
 ws.store=()=>new Proxy({},{get:()=>()=>{throw new Error(`db exploded on ${prose} with key ${secret}`);}});
 try{
  for(const op of Object.keys(OPERATIONS)){
   const [method,suffix,body]=request(op,id,{version:1,sample:'s'});
   const r=await route(id,method,suffix,{...body,text:prose,api_key:secret});
   assert.equal(r.status,500,op);assert.equal(r.body.code,'storage_unavailable',op);
   assert.ok(!JSON.stringify(r.body).includes(secret)&&!JSON.stringify(r.body).includes('KITCHEN'),op);
  }
 }finally{ws.store=realStore;Object.assign(console,orig);}
 assert.equal(lines.length,Object.keys(OPERATIONS).length,'one log line per failure');
 for(const line of lines){
  assert.ok(!line.includes(secret),line);assert.ok(!line.includes('KITCHEN'),line);
  assert.match(line,/storage_unavailable/);assert.match(line,/request_id=/);
 }
});
