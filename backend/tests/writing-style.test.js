const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-writing-style-'));
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const {createWritingStyleStore}=require('../lib/writing-style');
const {handleWritingStyle}=require('../routes/writing-style');
const store=createWritingStyleStore(db);
function project(){const id=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(id,'Personal writing fixture');return id;}
function original(id){store.addSample(id,{text:'The bus sighed at the curb. I stayed seated. It was easier than deciding where to go.',source:'Unaided writing exercise, confirmed by author',authorship:'original_human',confirmed_original:true,exercise:'memory'});return store.snapshot(id).samples.at(-1).id;}
async function route(id,method,suffix='',body={}){
 let status,raw; const res={writeHead(code){status=code;},end(s){raw=s;}};
 await handleWritingStyle({method,body},res,['film','projects',id,'writing-style',...suffix.split('/').filter(Boolean)]);
 return {status,body:JSON.parse(raw)};
}
test('new project has no active profile; AI-assisted/unknown/unconfirmed samples cannot establish voice',()=>{
 const id=project();assert.equal(store.context(id).provenance,null);
 for(const authorship of ['unknown','ai_assisted','human_edited','original_human']){
  store.addSample(id,{text:'This is an imported sample.',source:'Imported screenplay; provenance unresolved',authorship});
  assert.throws(()=>store.propose(id,{expected_version:0,guidance:'Short sentences',sample_ids:[store.snapshot(id).samples.at(-1).id]}),/confirmed original/);
 }
 assert.throws(()=>store.addSample(id,{text:'AI edits',source:'AI',authorship:'ai_assisted',confirmed_original:true}),/Only original/);
});
test('project/sample ownership isolates evidence, feedback and exports',()=>{
 const a=project(),b=project(),sample=original(a);
 assert.throws(()=>store.propose(b,{expected_version:0,guidance:'No cross-project samples',sample_ids:[sample]}),/belong to this project/);
 assert.equal(store.portable(b).sources.length,0);
 store.propose(a,{expected_version:0,guidance:'Short concrete action.',sample_ids:[sample]});
 assert.throws(()=>store.feedback(b,{profile_version:1,text:'Wrong project'}),/Unknown profile/);
 assert.equal(store.snapshot(b).profiles.length,0);
});
test('proposal stays inactive, human approval and current version are required, new drafts preserve prior approval',()=>{
 const id=project(),sample=original(id);
 store.propose(id,{expected_version:0,guidance:'Let pauses carry the scene.',sample_ids:[sample]});
 assert.equal(store.context(id).text,'');
 assert.throws(()=>store.approve(id,1,{expected_version:1}),/Human confirmation/);
 store.approve(id,1,{expected_version:1,human_confirmed:true});
 assert.equal(store.context(id).provenance.profile_version,1);
 store.propose(id,{expected_version:1,guidance:'Use concrete nouns.',sample_ids:[sample]});
 assert.equal(store.context(id).provenance.profile_version,1);
 assert.throws(()=>store.propose(id,{expected_version:1,guidance:'Stale',sample_ids:[sample]}),/version changed/);
 assert.throws(()=>store.approve(id,1,{expected_version:1,human_confirmed:true}),/version changed/);
 store.feedback(id,{profile_version:2,text:'Less polished, more natural.'});
 assert.equal(store.portable(id).feedback[0].text,'Less polished, more natural.');
});
test('changed evidence invalidates approval and approved context',()=>{
 const id=project(),sample=original(id);store.propose(id,{expected_version:0,guidance:'Quiet observation',sample_ids:[sample]});
 db.prepare('UPDATE film_writing_samples SET text=? WHERE id=?').run('Someone changed this sample.',sample);
 assert.throws(()=>store.approve(id,1,{expected_version:1,human_confirmed:true}),/Sample changed/);
 const approvedProject=project(),approvedSample=original(approvedProject);
 store.propose(approvedProject,{expected_version:0,guidance:'Quiet observation',sample_ids:[approvedSample]});
 store.approve(approvedProject,1,{expected_version:1,human_confirmed:true});
 db.prepare('UPDATE film_writing_samples SET text=? WHERE id=?').run('Changed after approval.',approvedSample);
 assert.throws(()=>store.context(approvedProject),/Sample changed/);
});
test('REST and MCP proposal/read paths use the same store; MCP cannot approve',async()=>{
 const id=project();assert.equal((await route(id,'GET')).body.active_profile,null);
 const added=await route(id,'POST','samples',{text:'A cup left a ring on the table. Nobody moved it.',source:'My original unaided note',authorship:'original_human',confirmed_original:true});
 assert.equal(added.status,200);
 const tools=require('../lib/mcp-tools');
 const proposed=tools.presentResult(await tools.callTool('writing_style_propose',{project_id:id,expected_version:0,guidance:'Observe concrete details without explaining them.',sample_ids:[added.body.samples[0].id]}));
 assert.equal(proposed.profiles[0].state,'draft');
 assert.equal(tools.hasTool('writing_style_approve'),false);
 assert.equal((await route(id,'POST','profiles/1/approve',{expected_version:1,human_confirmed:true})).status,200);
 const context=tools.presentResult(await tools.callTool('writing_style_context',{project_id:id}));
 assert.equal(context.provenance.profile_version,1);
 assert.equal((await route(id,'GET','export')).body.schema_version,'1.0.0');
});
test('real screenplay draft handler receives approved context and returns provenance without saving canon',async()=>{
 const id=project(),sample=original(id);
 const llm=require('../lib/llm-client');const calls=[];
 llm.callProjectLLM=async(p,request)=>{calls.push(request);return {ok:true,answer:'INT. ROOM - DAY\n\nA cup waits.',provider:'mock'};};
 llm.streamProjectLLM=async(p,request,res,callbacks)=>{calls.push(request);callbacks.onToken('INT. ROOM - DAY\n\nA cup waits.');return {ok:true};};
 delete require.cache[require.resolve('../routes/screenplay-ai')];const {handleScreenplayAI}=require('../routes/screenplay-ai');
 async function draft(stream=false){
  let raw='',status;const res={writeHead(s){status=s;},end(s){if(s)raw+=s;},write(s){raw+=s;},on(){},writableEnded:false};
  await handleScreenplayAI({method:'POST',body:{mode:'write-scene',message:'Write a quiet room.'}},res,['film','projects',id,'screenplay-ai',...(stream?['stream']:[])]);
  assert.equal(status,200);return stream?raw:JSON.parse(raw);
 }
 const before=db.prepare('SELECT count(*) n FROM film_scripts WHERE project_id=?').get(id).n;
 const empty=await draft();assert.equal(empty.writing_style,null);assert.ok(!calls[0].question.includes('APPROVED PERSONAL WRITING GUIDANCE'));
 store.propose(id,{expected_version:0,guidance:'Do not explain the silences.',sample_ids:[sample]});
 const inactive=await draft();assert.equal(inactive.writing_style,null);
 store.approve(id,1,{expected_version:1,human_confirmed:true});
 const approved=await draft();assert.equal(approved.writing_style.profile_version,1);assert.equal(approved.draft_only,true);
 assert.match(calls.at(-1).question,/Do not explain the silences/);
 const streamed=await draft(true);assert.match(streamed,/"profile_version":1/);
 assert.equal(db.prepare('SELECT count(*) n FROM film_scripts WHERE project_id=?').get(id).n,before);
});
test('portable contract round trip requires import confirmation and a separate local approval',()=>{
 const a=project(),sample=original(a);store.propose(a,{expected_version:0,guidance:'Concrete verbs; leave pauses alone.',sample_ids:[sample]});store.approve(a,1,{expected_version:1,human_confirmed:true});
 const portable=store.portable(a);assert.equal(portable.schema_version,'1.0.0');assert.equal(portable.owner,'Manny');
 assert.equal(portable.approved_rules[0].evidence[0].source_id,sample);
 assert.deepEqual(portable.approved_examples,[]);assert.equal(portable.sources[0].approved_excerpt,undefined);assert.equal(portable.sources[0].quarantined_excerpt,undefined);
 // A separately approved incoming excerpt can be analyzed locally, but export
 // never fabricates reuse consent from this Film Engine profile approval.
 portable.approved_examples=[{id:'external-approved-excerpt',source_id:sample,locator:portable.sources[0].locator,excerpt:store.snapshot(a).samples[0].text,status:'active',reuse_approval:{statement:'Explicit external approval to reuse this short fixture excerpt.'}}];
 const b=project();store.importProfile(b,{profile:portable});
 assert.equal(store.context(b).provenance,null);assert.equal(store.snapshot(b).samples[0].confirmed_original,0);
 assert.equal(store.portable(b).prior_snapshots[0].profile.profile_version,portable.profile_version);
 const c=project();store.importProfile(c,{profile:portable,human_confirmed:true});
 assert.equal(store.snapshot(c).profiles[0].state,'draft');assert.equal(store.context(c).provenance,null);
 store.approve(c,1,{expected_version:1,human_confirmed:true});assert.equal(store.context(c).provenance.profile_version,1);
 const reexported=store.portable(c);assert.deepEqual(reexported.approved_examples,[]);assert.deepEqual(reexported.prior_snapshots[0].profile.approved_examples,[]);
 assert.equal(reexported.sources[0].import_provenance.approved_excerpt,undefined);
 const generated=structuredClone(portable);generated.sources[0].kind='generated_ancestor';
 const d=project();store.importProfile(d,{profile:generated,human_confirmed:true});assert.equal(store.snapshot(d).samples[0].authorship,'ai_assisted');assert.equal(store.snapshot(d).profiles.length,0);
 const empty=store.portable(project());assert.equal(empty.profile_version,'0.0.0');assert.equal(empty.status,'empty');
 const invalid=structuredClone(portable);invalid.approved_rules[0].evidence[0].source_id='not-in-file';
 assert.throws(()=>store.importProfile(d,{profile:invalid}),/reference a source/);
});
test('MCP can propose explicit preferences without claiming learned voice or approving them',async()=>{
 const id=project(),tools=require('../lib/mcp-tools');
 const proposal=tools.presentResult(await tools.callTool('writing_style_propose',{project_id:id,expected_version:0,sample_ids:[],guidance:'Never use em dashes.',preference_source:'User explicitly requested no em dashes in conversation.'}));
 assert.equal(proposal.profiles[0].state,'draft');assert.equal(store.context(id).provenance,null);
});
test('explicit user preferences work with no samples but remain inactive until audited human approval',()=>{
 const id=project();
 assert.throws(()=>store.propose(id,{expected_version:0,sample_ids:[],guidance:'Avoid em dashes.'}),/explicitly confirm/);
 store.propose(id,{expected_version:0,sample_ids:[],guidance:'Never use em dashes. Use emotional, personal, natural writing with correct grammar and full sentences. Ask targeted questions.',preference_confirmation:true,preference_source:'Explicit user instruction in conversation, October 4, 2026'});
 assert.equal(store.context(id).provenance,null);
 store.approve(id,1,{expected_version:1,human_confirmed:true});
 assert.equal(store.context(id).provenance.basis,'explicit_preferences_only');
 assert.equal(store.context(id).provenance.learned_voice,false);
 assert.equal(store.snapshot(id).samples.length,0);
 const portable=store.portable(id);
 assert.equal(portable.sources[0].kind,'explicit_correction');
 assert.equal(portable.approved_examples.length,0);
 const target=project();store.importProfile(target,{profile:portable,human_confirmed:true});
 assert.equal(store.snapshot(target).profiles[0].state,'draft');
 store.approve(target,1,{expected_version:1,human_confirmed:true});
 assert.equal(store.context(target).provenance.learned_voice,false);
});
test('portable exports revalidate approved text, metadata and source confirmation',()=>{
 for(const [column,value] of [['text','Replaced unapproved prose'],['source','Unreviewed provenance'],['confirmed_original',0],['authorship','ai_assisted'],['source_meta','{"revoked":true}']]){
  const id=project(),sample=original(id);store.propose(id,{expected_version:0,guidance:'Quiet action.',sample_ids:[sample]});store.approve(id,1,{expected_version:1,human_confirmed:true});
  db.prepare(`UPDATE film_writing_samples SET ${column}=? WHERE id=?`).run(value,sample);
  assert.throws(()=>store.portable(id),/Sample changed|evidence changed|confirmed original|source was revoked/);
 }
});
test('shared direct preference sources deduplicate on export without losing either rule',()=>{
 const id=project();
 store.propose(id,{expected_version:0,sample_ids:[],guidance:'No em dashes.',preference_confirmation:true,preference_source:'One explicit user preference conversation.'});store.approve(id,1,{expected_version:1,human_confirmed:true});
 const portable=store.portable(id);portable.approved_rules.push({...portable.approved_rules[0],id:'second-rule',pattern:'Ask targeted questions.'});
 const target=project();store.importProfile(target,{profile:portable,human_confirmed:true});store.approve(target,1,{expected_version:1,human_confirmed:true});
 const exported=store.portable(target);
 assert.equal(exported.sources.length,1);assert.equal(exported.approved_rules.length,2);
 require('../lib/writing-style-portable').validatePortable(exported);
 const third=project();store.importProfile(third,{profile:exported,human_confirmed:true});assert.equal(store.snapshot(third).profiles[0].direct_rules.length,2);
});
test('real private plugin baseline imports and round-trips as direct guidance only', {skip:!process.env.WRITING_STYLE_PORTABLE_FIXTURE},()=>{
 const bytes=fs.readFileSync(process.env.WRITING_STYLE_PORTABLE_FIXTURE);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'6e70804850b2c1b6f988158d357a1334a05d0b7dfde58a4ee38e1ae98eecad6f');
 const baseline=JSON.parse(bytes);assert.equal(baseline.profile_version,'0.0.1');
 const id=project();store.importProfile(id,{profile:baseline,human_confirmed:true});
 assert.equal(store.snapshot(id).samples.length,0);assert.equal(store.context(id).provenance,null);
 assert.equal(store.snapshot(id).profiles[0].direct_rules.length,5);
 store.approve(id,1,{expected_version:1,human_confirmed:true});
 assert.equal(store.context(id).provenance.learned_voice,false);
 const exported=store.portable(id);assert.equal(exported.profile_version,'0.0.1');
 assert.equal(exported.approved_rules.length,5);assert.equal(exported.sources.length,1);assert.deepEqual(exported.approved_examples,[]);
 assert.deepEqual(exported.prior_snapshots[0].profile,baseline);
 require('../lib/writing-style-portable').validatePortable(exported);
 const target=project();store.importProfile(target,{profile:exported,human_confirmed:true});assert.equal(store.snapshot(target).profiles[0].direct_rules.length,5);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(process.env.WRITING_STYLE_PORTABLE_FIXTURE)).digest('hex'),'6e70804850b2c1b6f988158d357a1334a05d0b7dfde58a4ee38e1ae98eecad6f');
});
test.after(()=>db.close());
