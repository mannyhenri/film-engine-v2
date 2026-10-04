// GRD-4664: the blinded style pilot and the author's release verdict. Set-based over the rubric
// dimensions and every held-out target and near-duplicate. The provider is a recorder; author
// decisions are refused for an agent, and an AI judge never counts.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-style-pilot-'));
const {db,generateId}=require('../db/database');require('../db/schema').ensureSchema();
const ws=require('../lib/writing-style');
const pilot=require('../lib/style-pilot');
const {FIELD}=require('../lib/approval-guard');
const samples=ws.createWritingStyleStore(db);

const REUSED='the lamp burned low while the rain kept counting every second of the long night outside';
function recorder(copyFor=null){
 const sent=[];
 const gen=async(payload)=>{sent.push(JSON.parse(JSON.stringify(payload)));const brief=payload.messages.at(-1).content;
  const conditioned=payload.messages[0].content.includes('APPROVED PERSONAL WRITING GUIDANCE');
  return {texts:[copyFor&&brief.includes(copyFor)&&conditioned?`INT. ROOM - NIGHT\n\n${REUSED}.`:`INT. ROOM - NIGHT\n\n${conditioned?'Quiet.':'Loud.'} ${brief.slice(0,20)}`],model:'recorder-1'};};
 return {sent,gen};
}
function fixture({briefs=10}={}){
 const pid=generateId();db.prepare('INSERT INTO film_projects (id,title) VALUES (?,?)').run(pid,'Pilot');
 const add=(text,extra={})=>{samples.addSample(pid,{text,source:'mine',authorship:'original_human',confirmed_original:true,owner:'Manny',...extra});return samples.snapshot(pid).samples.at(-1);};
 const dev=[add('Short lines. A cup. A door that will not stay shut.',{exercise:'action'}),add('"Stay." "Why." Nobody answers.',{exercise:'dialogue'}),add(`At night ${REUSED} and she did not sleep.`,{exercise:'description'})];
 const targets=[];for(let i=0;i<briefs;i++)targets.push(add(`Held out scene ${i}: the ferry horn sounds twice and Ada counts the passengers number ${i}.`,{held_out:true,exercise:i%2?'dialogue':'action'}));
 // Nearly the same words as target 0: a development sample that would leak the answer.
 const nearDup=add('Held out scene 0: the ferry horn sounds twice and Ada counts the passengers number 0!',{exercise:'action'});
 samples.propose(pid,{expected_version:0,guidance:'Plain and quiet.',sample_ids:dev.map(s=>s.id)});
 const p=samples.snapshot(pid).profiles[0];samples.approve(pid,1,{expected_version:1,human_confirmed:true,[FIELD]:p.evidence_hash});
 return {pid,dev,targets,nearDup,briefs:targets.map((t,i)=>({brief:`Pilot brief ${i}: a crossing at night.`,sample_type:t.exercise,target_sample_id:t.id}))};
}
const rubric=v=>Object.fromEntries(pilot.RUBRIC.map(d=>[d,v]));

test('the rubric and sample roles are declared',()=>{
 assert.deepEqual([...pilot.RUBRIC],['correctness','character_consistency','subtext','pacing','action_clarity','description','sounds_like_me']);
 assert.deepEqual([...pilot.SAMPLE_ROLES],['profile_development','evaluation_target','near_duplicate']);
});

test('a pilot is versioned, needs at least 10 held-out targets, and separates development, targets and near-duplicates',()=>{
 const f=fixture(),store=pilot.createPilotStore(db);
 const bad={
  nine:f.briefs.slice(0,9),
  notHeldOut:[...f.briefs.slice(0,9),{brief:'x',sample_type:'action',target_sample_id:f.dev[0].id}],
  duplicateTarget:[...f.briefs.slice(0,9),f.briefs[0]],
 };
 for(const [name,briefs] of Object.entries(bad))assert.throws(()=>store.createPilot(f.pid,{briefs,provider:'claude',model:'m'}),e=>e.status===400,name);
 const p=store.createPilot(f.pid,{briefs:f.briefs,provider:'claude',model:'m'});
 assert.equal(p.version,1);
 const roles=Object.fromEntries(p.samples.map(s=>[s.sample_id,s.role]));
 for(const t of f.targets)assert.equal(roles[t.id],'evaluation_target');
 assert.equal(roles[f.nearDup.id],'near_duplicate');
 for(const d of f.dev)assert.equal(roles[d.id],'profile_development');
 assert.equal(store.createPilot(f.pid,{briefs:f.briefs,provider:'claude',model:'m'}).version,2);
 // A profile built on a near-duplicate of a target is contaminated: no pilot.
 samples.propose(f.pid,{expected_version:1,guidance:'Leaky.',sample_ids:[f.nearDup.id]});
 const q=samples.snapshot(f.pid).profiles[0];samples.approve(f.pid,2,{expected_version:2,human_confirmed:true,[FIELD]:q.evidence_hash});
 assert.throws(()=>store.createPilot(f.pid,{briefs:f.briefs,provider:'claude',model:'m'}),e=>e.code==='contaminated_profile');
});

test('the success criterion is the author\'s, agreed before anything runs',async()=>{
 const f=fixture(),rec=recorder(),store=pilot.createPilotStore(db,{generate:rec.gen});
 const p=store.createPilot(f.pid,{briefs:f.briefs,provider:'claude',model:'m'});
 await assert.rejects(store.runPilot(f.pid,{pilot_id:p.id}),e=>e.code==='criterion_not_agreed');
 assert.throws(()=>pilot.createPilotStore(db,{actor:'agent'}).agreeCriterion(f.pid,{pilot_id:p.id,criterion:'x',human_confirmed:true}),e=>e.code==='forbidden');
 assert.throws(()=>store.agreeCriterion(f.pid,{pilot_id:p.id,criterion:'Conditioned wins at least 6 of 10',min_win_rate:0.6}),e=>e.status===400,'needs confirmation');
 store.agreeCriterion(f.pid,{pilot_id:p.id,criterion:'Conditioned wins at least 6 of 10 with no rubric regression',min_win_rate:0.6,max_rubric_regressions:0,human_confirmed:true,reviewer:'Manny'});
 assert.equal(rec.sent.length,0);
});

test('conditioned and unconditioned come from the same model and brief, blinded, and no target or near-duplicate enters the context',async()=>{
 const f=fixture(),rec=recorder('brief 3'),order=[0,1,1,0,0,1,0,1,1,0];let k=0;
 const store=pilot.createPilotStore(db,{generate:rec.gen,random:()=>order[k++%order.length]});
 const p=store.createPilot(f.pid,{briefs:f.briefs,provider:'claude',model:'claude-sonnet-5-5'});
 store.agreeCriterion(f.pid,{pilot_id:p.id,criterion:'win rate ≥ 0.6',min_win_rate:0.6,max_rubric_regressions:0,human_confirmed:true,reviewer:'Manny'});
 const run=await store.runPilot(f.pid,{pilot_id:p.id});
 assert.equal(run.pairs.length,10);assert.equal(rec.sent.length,20);
 for(let i=0;i<rec.sent.length;i+=2){
  const [a,b]=[rec.sent[i],rec.sent[i+1]];
  assert.equal(a.model,b.model);assert.equal(a.messages.at(-1).content,b.messages.at(-1).content,'same brief');
  assert.notEqual(a.messages[0].content.includes('APPROVED PERSONAL WRITING GUIDANCE'),b.messages[0].content.includes('APPROVED PERSONAL WRITING GUIDANCE'),'one conditioned, one not');
 }
 const wire=JSON.stringify(rec.sent);
 for(const t of [...f.targets,f.nearDup])assert.ok(!wire.includes(t.text),`${t.id} never in a generation context`);
 assert.deepEqual([...new Set(run.pairs.map(x=>x.left_is))].sort(),['conditioned','unconditioned'],'placement varies');
 for(const x of run.pairs){assert.equal(x.conditioned_text,undefined,'the review view is blind');assert.ok(x.left&&x.right);}
 const flagged=run.pairs.filter(x=>x.reuse_flags.length);
 assert.equal(flagged.length,1,'long-form source reuse is caught');assert.match(flagged[0].reuse_flags[0].reason,/consecutive words/);
});

test('only the author reviews; an AI judge is recorded apart and never counts; the report is complete and exact',async()=>{
 const f=fixture(),rec=recorder(),order=[0,1];let k=0;
 const store=pilot.createPilotStore(db,{generate:rec.gen,random:()=>order[k++%2]});
 const p=store.createPilot(f.pid,{briefs:f.briefs,provider:'claude',model:'m1'});
 store.agreeCriterion(f.pid,{pilot_id:p.id,criterion:'win rate ≥ 0.6, no regression',min_win_rate:0.6,max_rubric_regressions:0,human_confirmed:true,reviewer:'Manny'});
 const {pairs}=await store.runPilot(f.pid,{pilot_id:p.id});
 const agent=pilot.createPilotStore(db,{actor:'agent'});
 assert.throws(()=>agent.reviewPair(f.pid,{pair_id:pairs[0].id,choice:'left',rubric:{left:rubric(4),right:rubric(3)},reviewer:'Manny'}),e=>e.code==='forbidden');
 agent.recordAiJudgement(f.pid,{pair_id:pairs[0].id,choice:'right',judge:'some-llm',scores:{left:rubric(1),right:rubric(5)}});
 assert.throws(()=>store.reviewPair(f.pid,{pair_id:pairs[0].id,choice:'left',rubric:{left:{correctness:4},right:rubric(3)},reviewer:'Manny'}),e=>e.status===400,'every dimension, both sides');
 // Conditioned is left on even pairs (order 0,1,...): the author picks conditioned 6 times, ties 1, unconditioned 3.
 const picks=['cond','cond','cond','cond','cond','cond','tie','uncond','uncond','uncond'];
 pairs.forEach((x,i)=>{
  const condSide=x.left_is==='conditioned'?'left':'right',other=condSide==='left'?'right':'left';
  const choice=picks[i]==='tie'?'tie':picks[i]==='cond'?condSide:other;
  // Conditioned scores lower on pacing everywhere: a regression the report must name.
  store.reviewPair(f.pid,{pair_id:x.id,choice,reviewer:'Manny',rubric:{[condSide]:{...rubric(4),pacing:2},[other]:rubric(3)}});
 });
 const r=store.report(f.pid,{pilot_id:p.id});
 assert.deepEqual([r.counts.wins,r.counts.ties,r.counts.losses],[6,1,3]);
 assert.equal(r.sample_size.briefs,10);assert.equal(r.sample_size.reviewed,10);
 for(const key of ['pilot_version','profile_version','style_global_version','style_override_version','provider','model','provider_model','prompt_template_version'])assert.ok(r.versions[key]!==undefined,key);
 for(const d of pilot.RUBRIC)assert.ok(r.rubric[d].conditioned!==undefined&&r.rubric[d].unconditioned!==undefined,d);
 assert.deepEqual(r.regressions,['pacing']);
 assert.equal(r.criterion.met,false,'a rubric regression fails the agreed criterion');
 assert.ok(r.exclusions.evaluation_targets===10&&r.exclusions.near_duplicates===1);
 assert.equal(r.ai_judgements.used_for_decision,false);assert.equal(r.ai_judgements.count,1);
 assert.equal(r.counts.wins+r.counts.ties+r.counts.losses,10,'the AI judgement is not in the counts');
 assert.match(r.report_fingerprint,/^[0-9a-f]{64}$/);
 assert.ok(Array.isArray(r.notes)&&r.notes.some(n=>/mixed|regression/i.test(n)));
});

test('release gate and activation are separate author decisions; a held candidate stays pending',async()=>{
 const f=fixture(),rec=recorder(),store=pilot.createPilotStore(db,{generate:rec.gen});
 const p=store.createPilot(f.pid,{briefs:f.briefs,provider:'claude',model:'m'});
 store.agreeCriterion(f.pid,{pilot_id:p.id,criterion:'win rate ≥ 0.5',min_win_rate:0.5,human_confirmed:true,reviewer:'Manny'});
 const {pairs}=await store.runPilot(f.pid,{pilot_id:p.id});
 assert.throws(()=>store.releaseGate(f.pid,{pilot_id:p.id,decision:'release',report_fingerprint:'x',human_confirmed:true,reviewer:'Manny'}),e=>e.code==='review_incomplete');
 for(const x of pairs)store.reviewPair(f.pid,{pair_id:x.id,choice:x.left_is==='conditioned'?'left':'right',reviewer:'Manny',rubric:{left:rubric(4),right:rubric(4)}});
 const r=store.report(f.pid,{pilot_id:p.id});
 assert.throws(()=>store.releaseGate(f.pid,{pilot_id:p.id,decision:'release',report_fingerprint:'0'.repeat(64),human_confirmed:true,reviewer:'Manny'}),e=>e.code==='STALE_APPROVAL');
 assert.throws(()=>pilot.createPilotStore(db,{actor:'agent'}).releaseGate(f.pid,{pilot_id:p.id,decision:'release',report_fingerprint:r.report_fingerprint,human_confirmed:true,reviewer:'Manny'}),e=>e.code==='forbidden');
 store.releaseGate(f.pid,{pilot_id:p.id,decision:'hold',report_fingerprint:r.report_fingerprint,human_confirmed:true,reviewer:'Manny',notes:'needs more dialogue samples'});
 assert.throws(()=>store.activate(f.pid,{pilot_id:p.id,human_confirmed:true,reviewer:'Manny'}),e=>e.code==='not_released');
 assert.equal(store.status(f.pid).released_profile,null,'a held candidate stays pending');
 // A second pilot on the same candidate can be released, then activated in its own step.
 const p2=store.createPilot(f.pid,{briefs:f.briefs,provider:'claude',model:'m'});
 store.agreeCriterion(f.pid,{pilot_id:p2.id,criterion:'win rate ≥ 0.5',min_win_rate:0.5,human_confirmed:true,reviewer:'Manny'});
 const run2=await store.runPilot(f.pid,{pilot_id:p2.id});
 for(const x of run2.pairs)store.reviewPair(f.pid,{pair_id:x.id,choice:x.left_is==='conditioned'?'left':'right',reviewer:'Manny',rubric:{left:rubric(4),right:rubric(4)}});
 const r2=store.report(f.pid,{pilot_id:p2.id});
 store.releaseGate(f.pid,{pilot_id:p2.id,decision:'release',report_fingerprint:r2.report_fingerprint,human_confirmed:true,reviewer:'Manny'});
 assert.equal(store.status(f.pid).released_profile,null,'release is not activation');
 store.activate(f.pid,{pilot_id:p2.id,human_confirmed:true,reviewer:'Manny'});
 const st=store.status(f.pid);
 assert.equal(st.released_profile.profile_version,1);
 const rows=db.prepare('SELECT kind FROM film_style_pilot_decisions WHERE project_id=? ORDER BY rowid').all(f.pid).map(x=>x.kind);
 assert.deepEqual(rows,['release_gate','release_gate','activation'],'gate and activation recorded separately');
});

test('user help explains inference-time conditioning and its limits',()=>{
 const doc=fs.readFileSync(path.join(__dirname,'..','..','docs','style-pilot.md'),'utf8');
 for(const re of [/inference-time conditioning/i,/no model (is )?trained|not trained|no training/i,/limit/i,/held-out/i,/AI judge/i,/release gate/i,/activation/i])assert.match(doc,re);
});

test('over HTTP the pilot stays blind, and author decisions are refused for an agent',async()=>{
 const {handleStylePilot}=require('../routes/style-pilot');
 const sd=require('../lib/style-drafting');const rec=recorder();const prev=sd.setDefaultGenerator(rec.gen);
 const call=(pid,op,body,extra={})=>new Promise(resolve=>{let status;const res={writeHead(c){status=c;},end(s){resolve({status,body:JSON.parse(s)});}};
  handleStylePilot({method:'POST',body,headers:{},...extra},res,['film','projects',pid,'style-pilot',op]);});
 try{
  const f=fixture();
  const p=(await call(f.pid,'createPilot',{briefs:f.briefs,provider:'claude',model:'m'})).body;
  assert.equal((await call(f.pid,'agreeCriterion',{pilot_id:p.id,criterion:'x',human_confirmed:true,reviewer:'Manny'},{actor:'agent'})).body.code,'forbidden');
  await call(f.pid,'agreeCriterion',{pilot_id:p.id,criterion:'win rate ≥ 0.5',min_win_rate:0.5,human_confirmed:true,reviewer:'Manny'});
  const run=await call(f.pid,'runPilot',{pilot_id:p.id});
  assert.equal(run.status,200);
  const wire=JSON.stringify(run.body);
  assert.ok(!wire.includes('left_is')&&!wire.includes('conditioned_text'),'nothing on the wire says which side is which');
  assert.equal(run.body.pairs.length,10);
 }finally{sd.setDefaultGenerator(prev);}
});
