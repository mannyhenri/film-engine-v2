// GRD-4663: drafting with approved style context. Set-based over the tool contracts, the provenance
// fields and every reason a sample is unavailable. The provider is a stub that records exactly what it
// was sent, so "the outbound payload is the approved preview" is checked byte for byte.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {Writable}=require('node:stream');
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'fe-style-drafting-'));
process.env.FILM_DATA_DIR=DATA;
const {db,generateId}=require('../db/database');require('../db/schema').ensureSchema();
const ws=require('../lib/writing-style');
const sd=require('../lib/style-drafting');
const {handleScripts}=require('../routes/scripts');
const {handleStyleDrafting}=require('../routes/style-drafting');
const {FIELD}=require('../lib/approval-guard');
const samples=ws.createWritingStyleStore(db);

function call(handler,method,urlPath,body,extra={}){
 return new Promise(resolve=>{
  const parts=urlPath.split('/').filter(Boolean),chunks=[];
  const res=new Writable({write(c,_e,n){chunks.push(c);n();}});res.statusCode=200;
  res.writeHead=function(code){this.statusCode=code;return this;};res.setHeader=()=>{};
  res.on('finish',()=>{let b=Buffer.concat(chunks).toString();try{b=JSON.parse(b);}catch(_){ }resolve({status:res.statusCode,body:b});});
  Promise.resolve(handler({method,body:body||{},headers:{},...extra},res,parts,{})).catch(e=>resolve({status:500,body:{error:e.message}}));
 });
}
const SCRIPT='INT. KITCHEN - NIGHT\n\nMara rinses one cup.\n\nMARA\nYou stayed.\n\nEXT. PIER - DAWN\n\nGulls. Nobody else.\n';
async function fixture(){
 const pid=generateId();db.prepare('INSERT INTO film_projects (id,title) VALUES (?,?)').run(pid,'Drafting');
 const up=await call(handleScripts,'POST',`/film/projects/${pid}/script`,{fountain_content:SCRIPT});assert.equal(up.status,201);
 const scene=db.prepare(`SELECT * FROM film_scenes WHERE project_id=? AND status!='removed' ORDER BY scene_number`).all(pid)[0];
 const add=(text,extra={})=>{samples.addSample(pid,{text,source:'notebook',authorship:'original_human',confirmed_original:true,owner:'Manny',language:'en',...extra});return samples.snapshot(pid).samples.at(-1);};
 const good=add('A cup in the sink. Nobody says sorry. The tap drips.',{exercise:'description'});
 const good2=add('"You stayed." "I did." Silence holds the kitchen.',{exercise:'dialogue'});
 const french=add('Une tasse dans l\'évier. Personne ne dit pardon.',{language:'fr'});
 const theirs=add('Someone else wrote this cup in the sink line.',{owner:'Ines'});
 // Unavailable, and written to be the MOST similar to the brief.
 const held=add('A cup in the sink kitchen night nobody sorry tap drips stayed.',{held_out:true});
 const deleted=add('Cup sink kitchen night sorry tap stayed, deleted copy.');samples.deleteSample(pid,{sample_id:deleted.id});
 const other=generateId();db.prepare('INSERT INTO film_projects (id,title) VALUES (?,?)').run(other,'Other');
 samples.addSample(other,{text:'Cup sink kitchen night sorry tap stayed, unauthorized.',source:'theirs',authorship:'original_human',confirmed_original:true,owner:'Manny'});
 const revoked=samples.snapshot(other).samples.at(-1);
 samples.setSampleAccess(other,{sample_id:revoked.id,grant:pid});samples.setSampleAccess(other,{sample_id:revoked.id,revoke:pid});
 samples.addSample(other,{text:'Cup sink kitchen night sorry tap stayed, never shared.',source:'theirs',authorship:'original_human',confirmed_original:true,owner:'Manny'});
 const unshared=samples.snapshot(other).samples.at(-1);
 const v=0;samples.propose(pid,{expected_version:v,guidance:'Plain, quiet, specific.',sample_ids:[good.id,good2.id]});
 const p=samples.snapshot(pid).profiles[0];samples.approve(pid,1,{expected_version:1,human_confirmed:true,[FIELD]:p.evidence_hash});
 const scriptVersion=()=>db.prepare('SELECT MAX(version) v FROM film_scripts WHERE project_id=?').get(pid).v;
 return {pid,scene,good,good2,french,theirs,held,deleted,revoked,unshared,scriptVersion,unavailable:[held,deleted,revoked,unshared]};
}
const BRIEF='Rewrite the kitchen scene: cup in the sink, nobody says sorry, she stayed.';
function stubProvider(){const sent=[];const gen=async(payload,opts)=>{sent.push({payload:JSON.parse(JSON.stringify(payload)),opts});return {texts:['INT. KITCHEN - NIGHT\n\nMara rinses one cup. Then the other.\n\nMARA\nYou stayed.','INT. KITCHEN - NIGHT\n\nThe tap drips.\n\nMARA\nYou came back.'],model:'stub-model-1'};};return {sent,gen};}

test('the seven contracts exist on every transport, strict about fields',()=>{
 assert.deepEqual(Object.keys(sd.CONTRACTS),['style.get_profile','style.search_examples','style.propose_update','style.record_feedback','style.apply_update','script.create_draft','script.compare_drafts']);
 const tools=require('../lib/mcp-tools');
 for(const [name,c] of Object.entries(sd.CONTRACTS)){
  assert.equal(c.tool,name.replace('.','_'),name);
  assert.match(c.tool,/^[a-zA-Z0-9_-]{1,64}$/,'a tool name the Claude and OpenAI APIs accept');
  assert.ok(['read','draft','propose','apply','author'].includes(c.permission),name);
  assert.ok(tools.hasTool(c.tool),`${c.tool} on MCP`);
  const def=tools.listTools().find(t=>t.name===c.tool);
  assert.equal(def.inputSchema.additionalProperties,false,`${c.tool} schema is strict`);
 }
});

test('every contract rejects unknown fields and stale versions',async()=>{
 const f=await fixture();
 for(const name of Object.keys(sd.CONTRACTS)){
  const r=await call(handleStyleDrafting,'POST',`/film/projects/${f.pid}/style-drafting/${name}`,{surprise:true});
  assert.equal(r.status,400,name);assert.equal(r.body.code,'unknown_field',name);assert.deepEqual(r.body.fields,['surprise'],name);
 }
 const stale={
  'style.propose_update':{target:'project',expected_version:5,trait:{kind:'rule',statement:'Plain.',source:'author_style',category:'general',explicit_user_rule:true,preference_source:'note'}},
  'style.apply_update':{proposal_id:'x',approval_fingerprint:'x',human_confirmed:true,expected_version:5,target:'project'},
  'script.create_draft':{scene_id:f.scene.id,brief:BRIEF,provider:'claude',expected_script_version:f.scriptVersion()+3},
 };
 for(const [name,body] of Object.entries(stale)){
  const r=await call(handleStyleDrafting,'POST',`/film/projects/${f.pid}/style-drafting/${name}`,body);
  assert.equal(r.status,409,name);assert.equal(r.body.code,'version_conflict',name);
 }
});

test('retrieval filters by owner, project, language and type, excludes every unavailable sample before ranking, and keeps budget and diversity',()=>{
 return fixture().then(f=>{
  const store=sd.createDraftingStore(db);
  const r=store.searchExamples(f.pid,{brief:BRIEF,owner:'Manny',language:'en',token_budget:400});
  const ids=r.excerpts.map(e=>e.sample_id);
  for(const s of f.unavailable)assert.ok(!ids.includes(s.id),'an unavailable sample never comes back, however similar');
  assert.ok(ids.includes(f.good.id)&&ids.includes(f.good2.id));
  assert.ok(!ids.includes(f.french.id),'language filter');assert.ok(!ids.includes(f.theirs.id),'owner filter');
  assert.ok(r.budget.used<=r.budget.limit);
  for(const reason of ['held_out','deleted'])assert.ok(r.excluded[reason]>=1,reason);
  assert.equal(JSON.stringify(r).includes('unauthorized'),false,'another project\'s text is not even counted by content');
  assert.equal(store.searchExamples(f.pid,{brief:BRIEF,sample_types:['screenplay_import']}).excerpts.length,0,'type filter');
  const tight=store.searchExamples(f.pid,{brief:BRIEF,token_budget:15});
  assert.ok(tight.budget.used<=15);
  // Diversity: five scenes from one imported script contribute at most two excerpts.
  samples.importSource(f.pid,{title:'Old pilot',owner:'Manny',rights_basis:'own_writing',rights_confirmed:true,authorship:'original_human',confirmed_original:true,
   text:['A','B','C','D','E'].map(x=>`INT. ROOM ${x} - DAY\n\nCup sink sorry stayed ${x}.\n`).join('\n')});
  const wide=store.searchExamples(f.pid,{brief:BRIEF,token_budget:4000});
  const fromDoc=wide.excerpts.filter(e=>e.source_document_id);
  assert.ok(fromDoc.length<=2,`one source contributes ${fromDoc.length}`);
 });
});

test('preview, approval, generation: the outbound payload is the approved preview, with only allowed excerpts and only this scene',async()=>{
 const f=await fixture(),stub=stubProvider(),store=sd.createDraftingStore(db,{generate:stub.gen});
 const draft=store.createDraft(f.pid,{scene_id:f.scene.id,brief:BRIEF,constraints:['keep MARA\'s line'],provider:'claude',model:'claude-sonnet-5-5',expected_script_version:f.scriptVersion()});
 const pv=draft.preview;
 assert.equal(pv.provider,'claude');assert.match(pv.purpose,/draft/i);assert.ok(pv.sample_categories.length);
 assert.ok(pv.script_excerpt.includes('Mara rinses one cup.'));assert.ok(!pv.script_excerpt.includes('Gulls.'),'never the whole script');
 await assert.rejects(store.generate(f.pid,{request_id:draft.request_id}),e=>e.code==='preview_not_approved');
 assert.throws(()=>store.approvePreview(f.pid,{request_id:draft.request_id,approval_fingerprint:'0'.repeat(64),human_confirmed:true}),e=>e.code==='STALE_APPROVAL');
 store.approvePreview(f.pid,{request_id:draft.request_id,approval_fingerprint:pv.payload_fingerprint,human_confirmed:true});
 const out=await store.generate(f.pid,{request_id:draft.request_id});
 assert.equal(stub.sent.length,1);
 assert.deepEqual(stub.sent[0].payload,pv.payload,'sent exactly what was approved');
 const wire=JSON.stringify(stub.sent[0].payload);
 for(const s of f.unavailable)assert.ok(!wire.includes(s.text||'@@'),'no unavailable text on the wire');
 assert.ok(!wire.includes('Gulls. Nobody else.'),'no other scene on the wire');
 assert.ok(!wire.includes(f.french.text)&&!wire.includes(f.theirs.text));
 assert.equal(out.alternatives.length,2);
 // A sample deleted after the preview makes the preview stale: nothing is sent.
 const d2=store.createDraft(f.pid,{scene_id:f.scene.id,brief:BRIEF,provider:'claude',expected_script_version:f.scriptVersion()});
 samples.deleteSample(f.pid,{sample_id:f.good2.id});
 assert.throws(()=>store.approvePreview(f.pid,{request_id:d2.request_id,approval_fingerprint:d2.preview.payload_fingerprint,human_confirmed:true}),e=>e.code==='STALE_APPROVAL');
 assert.equal(stub.sent.length,1);
});

test('a provider error fails visibly and stores nothing',async()=>{
 const f=await fixture();
 const store=sd.createDraftingStore(db,{generate:async()=>{throw new Error('upstream 529 overloaded');}});
 const d=store.createDraft(f.pid,{scene_id:f.scene.id,brief:BRIEF,provider:'chatgpt',expected_script_version:f.scriptVersion()});
 store.approvePreview(f.pid,{request_id:d.request_id,approval_fingerprint:d.preview.payload_fingerprint,human_confirmed:true});
 await assert.rejects(store.generate(f.pid,{request_id:d.request_id}),e=>e.status===502&&e.code==='provider_error'&&/529/.test(e.message));
 const req=db.prepare('SELECT status,error FROM film_style_draft_requests WHERE id=?').get(d.request_id);
 assert.equal(req.status,'failed');assert.match(req.error,/529/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM film_style_drafts WHERE request_id=?').get(d.request_id).n,0);
});

test('approved script text is unchanged until the author accepts selected hunks into a new revision',async()=>{
 const f=await fixture(),stub=stubProvider(),store=sd.createDraftingStore(db,{generate:stub.gen});
 const before=f.scriptVersion(),fountain=()=>db.prepare('SELECT fountain_content FROM film_scripts WHERE project_id=? ORDER BY version DESC LIMIT 1').get(f.pid).fountain_content;
 const d=store.createDraft(f.pid,{scene_id:f.scene.id,brief:BRIEF,provider:'claude',expected_script_version:before});
 store.approvePreview(f.pid,{request_id:d.request_id,approval_fingerprint:d.preview.payload_fingerprint,human_confirmed:true});
 const gen=await store.generate(f.pid,{request_id:d.request_id});
 const cmp=store.compareDrafts(f.pid,{request_id:d.request_id});
 assert.equal(f.scriptVersion(),before);assert.equal(fountain(),SCRIPT,'nothing written by drafting or comparing');
 const alt=cmp.alternatives.find(a=>a.draft_id===gen.alternatives[0].draft_id);
 assert.ok(alt.hunks.length>=1);
 const hunk=alt.hunks.find(h=>h.after.join('\n').includes('Then the other.'));
 const draftRow=gen.alternatives[0];
 for(const [name,body,code] of [['no confirmation',{approval_fingerprint:draftRow.fingerprint},'invalid_request'],['wrong fingerprint',{approval_fingerprint:'f'.repeat(64),human_confirmed:true},'STALE_APPROVAL'],['stale script',{approval_fingerprint:draftRow.fingerprint,human_confirmed:true,expected_script_version:before+9},'version_conflict']])
  await assert.rejects(store.acceptDraft(f.pid,{draft_id:draftRow.draft_id,hunk_ids:[hunk.id],expected_script_version:before,...body}),e=>e.code===code,name);
 assert.equal(f.scriptVersion(),before);
 const done=await store.acceptDraft(f.pid,{draft_id:draftRow.draft_id,hunk_ids:[hunk.id],approval_fingerprint:draftRow.fingerprint,human_confirmed:true,expected_script_version:before});
 assert.equal(f.scriptVersion(),before+1,'one new revision');
 assert.ok(fountain().includes('Mara rinses one cup. Then the other.'));
 assert.ok(fountain().includes('Gulls. Nobody else.'),'other scenes untouched');
 assert.equal(done.review_state,'accepted');
 assert.equal(db.prepare('SELECT fountain_content FROM film_scripts WHERE project_id=? AND version=?').get(f.pid,before).fountain_content,SCRIPT,'the approved revision itself is preserved');
});

test('every draft carries complete provenance and can be reproduced from it',async()=>{
 const f=await fixture(),stub=stubProvider(),store=sd.createDraftingStore(db,{generate:stub.gen});
 const d=store.createDraft(f.pid,{scene_id:f.scene.id,brief:BRIEF,constraints:['night'],provider:'claude',model:'m1',expected_script_version:f.scriptVersion()});
 store.approvePreview(f.pid,{request_id:d.request_id,approval_fingerprint:d.preview.payload_fingerprint,human_confirmed:true});
 const g=await store.generate(f.pid,{request_id:d.request_id});
 for(const alt of g.alternatives){
  for(const field of sd.PROVENANCE_FIELDS)assert.ok(alt.provenance[field]!==undefined,`provenance.${field}`);
  assert.equal(alt.provenance.prompt_template_version,sd.PROMPT_TEMPLATE_VERSION);
  assert.equal(alt.provenance.provider_model,'stub-model-1');
  assert.ok(alt.provenance.samples.every(s=>s.sample_id&&Number.isInteger(s.span_start)!==undefined&&s.fingerprint));
  const again=store.reproduce(f.pid,{draft_id:alt.draft_id});
  assert.equal(again.payload_fingerprint,alt.provenance.payload_fingerprint,'the exact context rebuilds from provenance');
  assert.deepEqual(again.payload,stub.sent[0].payload);
 }
});

test('read, draft, propose and apply boundary through REST and in-process MCP',async()=>{
 const f=await fixture(),tools=require('../lib/mcp-tools');
 const mcp=async(name,args)=>tools.callTool(name,{project_id:f.pid,...args});
 assert.ok(!tools.isFailure(await mcp('style_get_profile',{})));
 assert.ok(!tools.isFailure(await mcp('style_search_examples',{brief:BRIEF})));
 const created=await mcp('script_create_draft',{scene_id:f.scene.id,brief:BRIEF,provider:'host',expected_script_version:f.scriptVersion()});
 assert.ok(!tools.isFailure(created),JSON.stringify(created));
 const rid=tools.presentResult(created).request_id;
 const host=await mcp('script_create_draft',{request_id:rid,text:'INT. KITCHEN - NIGHT\n\nMara leaves the cup.\n\nMARA\nYou stayed.',host:'claude-desktop',model:'claude-opus-5-5'});
 assert.ok(!tools.isFailure(host),JSON.stringify(host));
 assert.ok(!tools.isFailure(await mcp('script_compare_drafts',{request_id:rid})));
 const ver=require('../lib/style-profile').createStyleStore(db).snapshot(f.pid).override.version;
 const prop=await mcp('style_propose_update',{target:'project',expected_version:ver,trait:{kind:'rule',statement:'Leave cups unwashed.',source:'author_style',category:'description',explicit_user_rule:true,preference_source:'the author said so'}});
 assert.ok(!tools.isFailure(prop),JSON.stringify(prop));
 const pending=tools.presentResult(prop).proposals.find(p=>p.status==='pending');
 for(const [name,args] of [['style_apply_update',{proposal_id:pending.id,approval_fingerprint:pending.fingerprint,human_confirmed:true,expected_version:ver,target:'project'}],['style_record_feedback',{profile_version:1,text:'sounds like me'}]]){
  const r=await mcp(name,args);
  assert.ok(tools.isFailure(r),name);assert.equal(r._status,403,name);assert.equal(r.body.code,'forbidden',name);
 }
 const rest=(name,body)=>call(handleStyleDrafting,'POST',`/film/projects/${f.pid}/style-drafting/${name}`,body);
 assert.equal((await rest('style.apply_update',{proposal_id:pending.id,approval_fingerprint:pending.fingerprint,human_confirmed:true,expected_version:ver,target:'project'})).status,200);
 assert.equal((await rest('style.record_feedback',{profile_version:1,text:'sounds like me'})).status,200);
});

test('end to end over the stdio MCP server a host uses: tools, drafting, and visible refusals',async()=>{
 const f=await fixture();
 const child=spawn(process.execPath,[path.join(__dirname,'..','mcp-server.js')],{env:{...process.env,FILM_DATA_DIR:DATA},stdio:['pipe','pipe','pipe']});
 const pending=new Map();let buf='',next=1;
 child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;const m=JSON.parse(line);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}}});
 const rpc=(method,params)=>new Promise(res=>{const id=next++;pending.set(id,res);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 const tool=async(name,args)=>{const m=await rpc('tools/call',{name,arguments:{project_id:f.pid,...args}});return m;};
 const body=m=>JSON.parse(m.result.content[0].text);
 try{
  const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'e2e-host',version:'1'}});
  assert.ok(init.result,'initialize');
  const list=await rpc('tools/list',{});
  for(const c of Object.values(sd.CONTRACTS))assert.ok(list.result.tools.some(t=>t.name===c.tool),c.tool);
  const found=body(await tool('style_search_examples',{brief:BRIEF}));
  for(const s of f.unavailable)assert.ok(!found.excerpts.some(e=>e.sample_id===s.id));
  const created=body(await tool('script_create_draft',{scene_id:f.scene.id,brief:BRIEF,provider:'host',expected_script_version:f.scriptVersion()}));
  assert.ok(created.request_id&&created.preview.payload);
  const added=await tool('script_create_draft',{request_id:created.request_id,text:'INT. KITCHEN - NIGHT\n\nMara keeps the cup.',host:'e2e-host',model:'none'});
  assert.ok(!added.result.isError,JSON.stringify(added));
  const refused=await tool('style_apply_update',{proposal_id:'x',approval_fingerprint:'x',human_confirmed:true,expected_version:0,target:'project'});
  assert.equal(refused.result.isError,true,'a refusal is visible to the host');assert.match(refused.result.content[0].text,/forbidden|may not/i);
  const unknown=await tool('style_get_profile',{nonsense:1});
  assert.equal(unknown.result.isError,true);assert.match(unknown.result.content[0].text,/unknown_field|nonsense/);
 }finally{child.kill();}
});

test('the host and transport document names every contract and the unsupported combinations',()=>{
 const doc=fs.readFileSync(path.join(__dirname,'..','..','docs','style-drafting-hosts.md'),'utf8');
 for(const [name,c] of Object.entries(sd.CONTRACTS)){assert.ok(doc.includes(name),name);assert.ok(doc.includes(c.tool),c.tool);}
 assert.match(doc,/Unsupported/);assert.match(doc,/ChatGPT/);assert.match(doc,/stdio/);assert.match(doc,/not model weight training|no model weights are trained/i);
});
