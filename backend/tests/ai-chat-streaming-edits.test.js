// Set-based: every provider streams, every workspace exposes the stream, every chat edit target applies.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'film-ai-chat-stream-'));
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const {createCLIRunner,argumentsFor}=require('../lib/ai-cli-runner');
const {createAIWorkspace}=require('../lib/ai-workspace');
const {createApplicationWorkspace}=require('../lib/ask-ai');
const {handleScripts}=require('../routes/scripts');
const recipes=require('../lib/production-recipes');
const BASE='Title: Fixture\n\nINT. KITCHEN - NIGHT\n\nMARA\nYou stayed.\n\nEXT. PIER - DAWN\n\nGulls.\n';
function save(pid,fountain){let status,body;handleScripts({method:'POST',body:{fountain_content:fountain,sync_scenes:true}},{writeHead(n){status=n;},end(s){body=JSON.parse(s);}},['film','projects',pid,'script'],{});if(status>=300)throw Error(body.error);return body;}
const tick=()=>new Promise(r=>setImmediate(r));

// Every provider the runner supports, with the stream events its CLI really emits.
const STREAMS={
 claude:{events:[{type:'system',subtype:'init',session_id:'s'},...['**Do I', ' need', ' a reason?**'].map(text=>({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text}}})),{type:'assistant',message:{content:[{type:'text',text:'**Do I need a reason?**'}]}},{type:'result',result:'**Do I need a reason?**',session_id:'s'}],partials:['**Do I','**Do I need','**Do I need a reason?**']},
 codex:{events:[{type:'thread.started',thread_id:'s'},{type:'item.updated',item:{type:'agent_message',text:'**Do I'}},{type:'item.completed',item:{type:'agent_message',text:'**Do I need a reason?**'}},{type:'turn.completed'}],partials:['**Do I','**Do I need a reason?**']},
};
test('claude runner requests partial messages so text can stream',()=>{assert.ok(argumentsFor('claude','id').includes('--include-partial-messages'));});
for(const [provider,stream] of Object.entries(STREAMS))test(`${provider} runner streams partial text as it arrives`,()=>{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
 const runner=createCLIRunner({resolveBinary:()=>'/fake/cli',spawnProcess:()=>child});const partials=[];let result;
 runner.start({provider,payload:'x'},{event(){},partial:t=>partials.push(t),complete:t=>result=t,error:e=>assert.fail(e),cancelled(){},closed(){}});
 for(const e of stream.events)child.stdout.write(JSON.stringify(e)+'\n');child.emit('close',0);
 assert.deepEqual([...new Set(partials)],stream.partials);assert.equal(result,'**Do I need a reason?**');
});

function project(){const pid=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title,logline) VALUES(?,?,?)').run(pid,'Fixture','A quiet reunion.');save(pid,BASE);return pid;}
function fakeRunner(){const r={hooks:null,providers:()=>[{id:'codex',available:true},{id:'claude',available:true}],start(input,h){r.hooks=h;return {cancel(){h.cancelled();}};}};return r;}
// Every workspace that runs a provider task.
const WORKSPACES={
 project(){const r=fakeRunner(),w=createAIWorkspace(db,{runner:r,saveScript:save}),pid=project(),c=w.createConversation(pid,{feature:'screenplay',title:'Stream'});const t=w.preview(pid,c.id,{provider:'codex',prompt:'Hello',attachments:{project:true,scenes:[],characters:[]},operation:{kind:'chat'}});w.execute(pid,t.id,{fingerprint:t.fingerprint});return {r,get:()=>w.task(pid,t.id),list:()=>w.tasks(pid,c.id)};},
 application(){const r=fakeRunner(),w=createApplicationWorkspace(db,{runner:r,saveScript:save}),c=w.createConversation({title:'Stream'});const t=w.preview(c.id,{provider:'codex',prompt:'Hello',scope:{kind:'selected',project_ids:[],choices:[]},operation:{kind:'chat'}});w.execute(t.id,{fingerprint:t.fingerprint});return {r,get:()=>w.task(t.id),list:()=>w.tasks(c.id)};},
};
for(const [name,make] of Object.entries(WORKSPACES))test(`${name} workspace exposes the streamed answer while the task runs`,async()=>{
 const f=make();f.r.hooks.partial('**Do I');assert.equal(f.get().partial,'**Do I');assert.equal(f.list().at(-1).partial,'**Do I');
 f.r.hooks.partial('**Do I need a reason?**');assert.equal(f.get().partial,'**Do I need a reason?**');
 f.r.hooks.complete('**Do I need a reason?**',{session_id:'s'});f.r.hooks.closed?.();await tick();
 assert.equal(f.get().status,'completed');assert.equal(f.get().partial,'');assert.equal(f.get().result,'**Do I need a reason?**');
});

// Every target a chat answer can edit directly: the screenplay scene and each Production prompt kind.
const TARGETS={
 scene:{attach:()=>({scenes:[0]}),block:'fountain',body:'INT. KITCHEN - NIGHT\n\nMARA\nDo I need a reason?\n',proposal:{kind:'replace',scene_index:0},check:(w,f)=>{assert.match(w.source(f.pid).fountain,/Do I need a reason\?/);assert.match(w.source(f.pid).fountain,/EXT\. PIER/);}},
 image:{attach:f=>({scenes:[],node_key:f.node}),block:'image-prompt',body:'Two people facing each other, low key light.',proposal:f=>({kind:'node_prompt',node_key:f.node,recipe_kind:'image'}),check:(w,f)=>{const d=recipes.readDraft(db,f.pid,f.node).payload;assert.equal(d.image.prompt,'Two people facing each other, low key light.');assert.equal(d.video.prompt,'Original video');}},
 video:{attach:f=>({scenes:[],node_key:f.node}),block:'video-prompt',body:'Slow push in as Mara turns away.',proposal:f=>({kind:'node_prompt',node_key:f.node,recipe_kind:'video'}),check:(w,f)=>{const d=recipes.readDraft(db,f.pid,f.node).payload;assert.equal(d.video.prompt,'Slow push in as Mara turns away.');assert.equal(d.video.provider,'seedance');}},
};
for(const [name,target] of Object.entries(TARGETS))test(`chat can propose and apply a direct ${name} edit after review`,async()=>{
 const r=fakeRunner(),w=createAIWorkspace(db,{runner:r,saveScript:save}),pid=project(),c=w.createConversation(pid,{feature:'screenplay',title:'Edit'});
 const scene=db.prepare('SELECT id FROM film_scenes WHERE project_id=? ORDER BY scene_number LIMIT 1').get(pid),sid=crypto.randomUUID(),node='shot:'+sid;
 db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,?)').run(sid,scene.id,'S1-A','Two people.');
 recipes.saveDraft(db,pid,node,{expected_revision:0,payload:{image:{prompt:'Original image'},video:{provider:'seedance',prompt:'Original video'}}});
 const f={pid,node},t=w.preview(pid,c.id,{provider:'codex',prompt:'Improve this.',attachments:{project:true,characters:[],...target.attach(f)},operation:{kind:'chat'}});
 const payload=JSON.parse(t.payload);assert.match(payload.system,new RegExp('```'+target.block));if(name!=='scene')assert.equal(payload.context.production.draft_prompts[name],'Original '+name);
 w.execute(pid,t.id,{fingerprint:t.fingerprint});r.hooks.complete('Here is a tighter version.\n\n```'+target.block+'\n'+target.body+'\n```\n\nIt keeps the beat.',{});await tick();
 const done=w.task(pid,t.id),expected=typeof target.proposal==='function'?target.proposal(f):target.proposal;
 assert.deepEqual({...done.proposal,text:undefined},{...expected,text:undefined});assert.equal(done.proposal.text.trim(),target.body.trim());
 assert.throws(()=>w.apply(pid,t.id),/Review and confirm/);
 const approval={human_confirmed:true,fingerprint:t.fingerprint};if(name==='scene')approval.review_fingerprint=w.reviewChange(pid,t.id).fingerprint;
 w.apply(pid,t.id,approval);assert.equal(w.task(pid,t.id).apply_state,'applied');target.check(w,f);
 w.undo(pid,t.id);assert.equal(w.task(pid,t.id).apply_state,'undone');
});
test('chat without an edit block, or with an unattached target, offers no direct edit',async()=>{
 const r=fakeRunner(),w=createAIWorkspace(db,{runner:r,saveScript:save}),pid=project(),c=w.createConversation(pid,{feature:'screenplay',title:'Talk'});
 for(const result of ['Just advice, no block.','```fountain\nINT. KITCHEN - NIGHT\n\nNo scene attached.\n```']){const t=w.preview(pid,c.id,{provider:'codex',prompt:'Thoughts?',attachments:{project:true,scenes:[],characters:[]},operation:{kind:'chat'}});w.execute(pid,t.id,{fingerprint:t.fingerprint});r.hooks.complete(result,{});await tick();assert.equal(w.task(pid,t.id).proposal,null);assert.throws(()=>w.apply(pid,t.id,{human_confirmed:true,fingerprint:t.fingerprint}),/No completed/);}
});
