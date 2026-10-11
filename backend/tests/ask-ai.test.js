const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'film-ask-ai-'));
const {db} = require('../db/database'); require('../db/schema').ensureSchema();
const {createApplicationWorkspace} = require('../lib/ask-ai');
const {handleScripts} = require('../routes/scripts');
function save(pid, text) { let status, data; handleScripts({method:'POST',body:{fountain_content:text,sync_scenes:true}}, {writeHead(n){status=n;},end(s){data=JSON.parse(s);}}, ['film','projects',pid,'script'],{}); if(status>=300) throw Error(data.error); return data; }
const sourceText = 'Title: Fixture\n\nINT. ROOM - DAY\n\nAn untouched cup.\n';
function fixture() {const sent=[]; let hooks; const runner={providers:()=>[{id:'codex',available:true,inference_verified:false}],start(input,h){sent.push(input);hooks=h;return {cancel(){h.cancelled();}};}}; const w=createApplicationWorkspace(db,{runner,saveScript:save});return {w,sent,finish(text='Evidence answer'){hooks.complete(text,{session_id:'provider-native-session'});}};}
function project(title='Fixture'){const id=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title) VALUES(?,?)').run(id,title);save(id,sourceText);return id;}
function message(extra={}) {return {provider:'codex',prompt:'Tell me about the selected evidence.',scope:{kind:'selected',project_ids:[],choices:[]},operation:{kind:'chat'},...extra};}
test('settled runner releases application ownership after progress persistence fails',()=>{
 let hooks;const w=createApplicationWorkspace(db,{runner:{providers:()=>[{id:'codex',available:true}],start(input,h){hooks=h;return {cancel(){throw Error('Closed worker cannot be cancelled');}};}},saveScript:save});
 const c=w.createConversation({title:'Storage cleanup'}),t=w.preview(c.id,message());w.execute(t.id,{fingerprint:t.fingerprint});
 const original=db.prepare;db.prepare=function(sql){if(sql.startsWith('UPDATE film_application_ai_tasks SET events='))throw Error('Fixture storage failure');return original.call(this,sql);};
 try{assert.throws(()=>hooks.event({kind:'progress',message:'Fail once'}),/storage failure/);}finally{db.prepare=original;}
 hooks.closed();assert.throws(()=>w.cancel(t.id),/not supervised/);assert.equal(w.task(t.id).status,'running');
 const reopened=fixture();assert.equal(reopened.w.task(t.id).status,'interrupted');assert.equal(reopened.sent.length,0);
});
test('Home application history persists and dispatch carries UUID global ownership without a project',()=>{
 const f=fixture(), count=db.prepare('SELECT COUNT(*) AS n FROM film_projects').get().n;
 const c=f.w.createConversation({title:'Home conversation'}), t=f.w.preview(c.id,message());
 assert.equal(f.sent.length,0); f.w.execute(t.id,{fingerprint:t.fingerprint}); f.finish();
 assert.equal(f.sent[0].project_id,undefined); assert.equal(f.sent[0].scope,'application');assert.equal(f.sent[0].owner.application_id,'film-engine-v2');
 assert.match(f.sent[0].conversation_id,/^[a-f0-9-]{36}$/);assert.match(f.sent[0].task_id,/^[a-f0-9-]{36}$/);
 const reopened=fixture().w;assert.equal(reopened.tasks(c.id)[0].result,'Evidence answer');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM film_projects').get().n,count);
 assert.equal(reopened.conversation(c.id).scope,'application');
 const {createAIWorkspace}=require('../lib/ai-workspace');const p=project();const pw=createAIWorkspace(db,{runner:{providers:()=>[]},saveScript:save});assert.throws(()=>pw.conversation(p,c.id),/not found/);
});
test('opening the application catalog is read-only for every project, including missing summary snapshots',()=>{
 const f=fixture();project('No summaries yet');const counts=()=>['film_screenplay_cards','film_screenplay_card_snapshots','film_scripts','film_projects'].map(table=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n);const before=counts();f.w.catalog();assert.deepEqual(counts(),before);
});
test('cross-project context is explicit, bounded, grounded, and blocks stale reviewed dispatch',()=>{
 const f=fixture(),p=project('Included'), other=project('Excluded'), catalog=f.w.catalog(), c=f.w.createConversation({title:'Context'});
 const chosen=catalog.projects.find(x=>x.id===p);const scope={kind:'selected',project_ids:[p],choices:[{project_id:p,expected_source:chosen.source,metadata:true,scenes:[],summaries:[],runtime:true}]};
 const t=f.w.preview(c.id,message({scope})),payload=JSON.parse(t.payload);assert.equal(payload.context.projects.length,1);assert.equal(payload.context.projects[0].metadata.title,'Included');assert.equal(t.payload.includes('untouched cup'),false);assert.equal(t.payload.includes(other),false);assert.ok(payload.context.projects[0].runtime.assumptions.length);assert.ok(payload.review.omissions.length);
 save(p,sourceText+'\nNew edit.');assert.throws(()=>f.w.execute(t.id,{fingerprint:t.fingerprint}),/changed|stale/i);assert.equal(f.sent.length,0);
 assert.throws(()=>f.w.preview(c.id,message({scope:{kind:'current',choices:[]}})),/current project/i);
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function ready(w,cid,id){for(let n=0;n<100;n++){const u=w.uploads.get(cid,id);if(!['queued','extracting'].includes(u.status))return u;await pause(10);}throw Error('Extraction did not finish');}
function approval(t){return {human_confirmed:true,fingerprint:t.fingerprint,result_fingerprint:t.result_fingerprint,source_fingerprint:t.source_fingerprint};}
test('approved canonical summaries and explicit excerpts retain ranges; stale summaries and budget overflow are visible omissions',()=>{
 const f=fixture(),p=project(),c=f.w.createConversation({title:'Summary'}),cards=require('../lib/screenplay-cards');let s=cards.readCards(db,p);cards.writeCard(db,p,{id:s.cards[0].id,script_hash:s.script_hash,revision:0,summary:'The cup is untouched.'});
 let cat=f.w.catalog().projects.find(x=>x.id===p);let scope={kind:'current',current_project_id:p,choices:[{project_id:p,expected_source:cat.source,metadata:false,runtime:false,scenes:[],summaries:[0]}]};
 let t=f.w.preview(c.id,message({scope})),v=JSON.parse(t.payload);assert.equal(v.context.projects[0].summaries[0].summary,'The cup is untouched.');assert.equal(v.context.projects[0].scenes.length,0);assert.equal(v.review.source_ranges[0].start_line,3);
 const omitted=f.w.preview(c.id,message({scope,budget:{characters:100,words:20}}));assert.ok(JSON.parse(omitted.payload).review.omissions.some(x=>x.reason==='context budget'));
 save(p,sourceText.replace('An untouched cup.','The cup is broken.'));cat=f.w.catalog().projects.find(x=>x.id===p);scope.choices[0].expected_source=cat.source;t=f.w.preview(c.id,message({scope}));assert.equal(JSON.parse(t.payload).context.projects[0].summaries.length,0);assert.ok(JSON.parse(t.payload).review.omissions.some(x=>x.reason==='Saved summary is stale'));
 const allIds=f.w.catalog().projects.map(x=>x.id);assert.throws(()=>f.w.preview(c.id,message({scope:{kind:'all',expected_project_ids:allIds.slice(1),choices:[]}})),/list changed/);
});
test('local extraction is durable, hashed, bounded and approved before inclusion; cancel revokes dispatch; unsupported and caller paths refused',async()=>{
 const f=fixture(),c=f.w.createConversation({title:'Uploads'}),original='A source chapter. Éte 静',u=f.w.uploads.upload(c.id,{filename:'chapter.txt',base64:Buffer.from(original).toString('base64')});assert.equal(u.status,'queued');assert.equal(f.sent.length,0);
 let r=await ready(f.w,c.id,u.id);assert.equal(r.status,'ready');assert.equal(r.text,original);assert.equal(r.progress,100);assert.equal(r.original_sha,crypto.createHash('sha256').update(original).digest('hex'));assert.equal(r.approved,false);
 const a={id:r.id,original_sha:r.original_sha,text_sha:r.text_sha,start:0,end:10};assert.throws(()=>f.w.preview(c.id,message({uploads:[a]})),/approved/);
 assert.throws(()=>f.w.uploads.approve(c.id,r.id,{human_confirmed:true,text_sha:'wrong',original_sha:r.original_sha}),/hashes/);
 r=f.w.uploads.approve(c.id,r.id,{human_confirmed:true,text_sha:r.text_sha,original_sha:r.original_sha});assert.equal(r.approved,true);const t=f.w.preview(c.id,message({uploads:[a]}));assert.equal(JSON.parse(t.payload).context.uploads[0].text,original.slice(0,10));assert.equal(fixture().w.uploads.get(c.id,r.id).approved,true);
 f.w.uploads.cancel(c.id,r.id);assert.throws(()=>f.w.execute(t.id,{fingerprint:t.fingerprint}),/approved/);assert.equal(f.sent.length,0);
 const queued=f.w.uploads.upload(c.id,{filename:'cancel.txt',base64:Buffer.from('Cancel').toString('base64')});f.w.uploads.cancel(c.id,queued.id);await pause(20);assert.equal(f.w.uploads.get(c.id,queued.id).status,'cancelled');
 for(const filename of ['../chapter.txt','chapter.pdf','chapter.rtf'])assert.throws(()=>f.w.uploads.upload(c.id,{filename,base64:'YQ=='}),/paths|unavailable/);
 assert.throws(()=>f.w.uploads.upload(c.id,{filename:'chapter.txt',base64:'YQ==',url:'https://example.com'}),/paths/);
 assert.throws(()=>f.w.uploads.upload(c.id,{filename:'large.txt',base64:Buffer.alloc(5242881).toString('base64')}),/5 MB/);
 const big=f.w.uploads.upload(c.id,{filename:'bounded.txt',base64:Buffer.from('x'.repeat(100005)).toString('base64')}),br=await ready(f.w,c.id,big.id);assert.equal(br.text.length,100000);assert.equal(br.provenance.omitted_characters,5);
 const bad=f.w.uploads.upload(c.id,{filename:'bad.docx',base64:Buffer.from('Not a ZIP').toString('base64')});assert.equal((await ready(f.w,c.id,bad.id)).status,'failed');
});
test('document jobs use the existing DOCX/FDX parsers and retain parser provenance without sending files',async()=>{
 const f=fixture(),c=f.w.createConversation({title:'Documents'}),name=Buffer.from('word/document.xml'),xml=Buffer.from('<w:document><w:body><w:p><w:r><w:t>Novel source paragraph.</w:t></w:r></w:p></w:body></w:document>'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50,0);local.writeUInt32LE(xml.length,18);local.writeUInt32LE(xml.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50,0);central.writeUInt32LE(xml.length,20);central.writeUInt32LE(xml.length,24);central.writeUInt16LE(name.length,28);const locals=Buffer.concat([local,name,xml]),centers=Buffer.concat([central,name]);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(centers.length,12);end.writeUInt32LE(locals.length,16);
 const u=f.w.uploads.upload(c.id,{filename:'source.docx',base64:Buffer.concat([locals,centers,end]).toString('base64')}),doc=await ready(f.w,c.id,u.id);assert.equal(doc.status,'ready');assert.equal(doc.text,'Novel source paragraph.');assert.equal(doc.provenance.parser,'Film docx-text');
 const fdx='<FinalDraft DocumentType="Script"><Content><Paragraph Type="Scene Heading"><Text>INT. ROOM - DAY</Text></Paragraph><Paragraph Type="Action"><Text>A novel cup.</Text></Paragraph></Content></FinalDraft>',x=f.w.uploads.upload(c.id,{filename:'source.fdx',base64:Buffer.from(fdx).toString('base64')}),parsed=await ready(f.w,c.id,x.id);assert.equal(parsed.status,'ready');assert.match(parsed.text,/INT. ROOM/);assert.equal(parsed.provenance.parser,'Film fdx-parser');assert.equal(f.sent.length,0);
});
test('adaptation requires matching reviewed result/source, creates versioned new project only, never trains voice, undo preserves history and refuses later work',()=>{
 const f=fixture(),untouched=project('Untouched'),before=db.prepare('SELECT * FROM film_scripts WHERE project_id=?').all(untouched),c=f.w.createConversation({title:'Adapt'}),voiceCount=db.prepare('SELECT count(*) n FROM film_writing_samples').get().n;
 const request=message({source_excerpt:'A novel about a cup and a meeting.',operation:{kind:'adaptation',title:'Adapted',logline:'A meeting',genre:'Drama'}}),t=f.w.preview(c.id,request);f.w.execute(t.id,{fingerprint:t.fingerprint});f.finish(sourceText);let done=f.w.task(t.id);
 assert.throws(()=>f.w.apply(t.id,{}),/fingerprints/);assert.throws(()=>f.w.apply(t.id,{...approval(done),result_fingerprint:'wrong'}),/fingerprints/);done=f.w.apply(t.id,approval(done));const pid=done.application.project_id;assert.notEqual(pid,untouched);assert.equal(db.prepare('SELECT version FROM film_scripts WHERE project_id=?').get(pid).version,1);assert.equal(db.prepare('SELECT count(*) n FROM film_writing_samples').get().n,voiceCount);assert.deepEqual(db.prepare('SELECT * FROM film_scripts WHERE project_id=?').all(untouched),before);assert.equal(f.w.undo(t.id).apply_state,'undone');assert.ok(db.prepare('SELECT archived_at FROM film_projects WHERE id=?').get(pid).archived_at);assert.equal(db.prepare('SELECT COUNT(*) n FROM film_scripts WHERE project_id=?').get(pid).n,1);
 const t2=f.w.preview(c.id,request);f.w.execute(t2.id,{fingerprint:t2.fingerprint});f.finish(sourceText);done=f.w.apply(t2.id,approval(f.w.task(t2.id)));save(done.application.project_id,sourceText+'\nA later author edit.');assert.throws(()=>f.w.undo(t2.id),/later work/);assert.match(db.prepare('SELECT fountain_content FROM film_scripts WHERE project_id=? ORDER BY version DESC').get(done.application.project_id).fountain_content,/later author edit/);
});
test('application restart interrupts owned task without resubmission; cancellation remains auditable',()=>{
 const f=fixture(),c=f.w.createConversation({title:'Restart'}),t=f.w.preview(c.id,message());f.w.execute(t.id,{fingerprint:t.fingerprint});const reopened=fixture();assert.equal(reopened.w.task(t.id).status,'interrupted');assert.equal(reopened.sent.length,0);assert.throws(()=>reopened.w.execute(t.id,{fingerprint:t.fingerprint}),/already/);
 const next=f.w.preview(c.id,message());f.w.execute(next.id,{fingerprint:next.fingerprint});assert.equal(f.w.cancel(next.id).status,'cancelled');assert.ok(f.w.task(next.id).events.some(e=>e.kind==='cancelled'));
});
test('coding proposal only creates its approved task checkout; target remains unchanged; diff/test/commit gates are honest',()=>{
 const {execFileSync}=require('node:child_process'),root=fs.mkdtempSync(path.join(os.tmpdir(),'film-coding-test-')),target=path.join(root,'v2'),worktrees=path.join(root,'tasks');fs.mkdirSync(target);const git=args=>execFileSync('git',['-C',target,...args],{encoding:'utf8'});git(['init','-q']);fs.writeFileSync(path.join(target,'app.txt'),'Original\n');git(['add','app.txt']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','Fixture']);
 const f=fixture(),w=createApplicationWorkspace(db,{runner:{providers:()=>[{id:'codex',available:true}],start(input,h){h.complete('Change app.txt after reviewing; run focused tests.');return {cancel(){}};}},saveScript:save,codingTarget:target,codingRoot:worktrees}),c=w.createConversation({title:'Code'}),t=w.preview(c.id,message({operation:{kind:'coding'}}));w.execute(t.id,{fingerprint:t.fingerprint});let done=w.task(t.id);assert.throws(()=>w.dispatchCoding(t.id,{}),/fingerprints/);assert.equal(fs.existsSync(worktrees),false);done=w.dispatchCoding(t.id,approval(done));assert.equal(done.application.execution,'requires_authorized_host');assert.equal(done.application.tests,'not_run');assert.equal(done.application.commit,'review_required');assert.equal(fs.readFileSync(path.join(target,'app.txt'),'utf8'),'Original\n');fs.writeFileSync(path.join(done.application.checkout,'app.txt'),'Changed in task checkout\n');assert.match(w.codingReview(t.id).diff,/Changed in task checkout/);assert.equal(git(['status','--short']).trim(),'');assert.throws(()=>w.dispatchCoding(t.id,approval(done)),/undispatched/);git(['worktree','remove','--force',done.application.checkout]);fs.rmSync(root,{recursive:true,force:true});
});
