'use strict';
const {db,generateId}=require('../db/database');
const {buildStepPlan,autoSkipSteps}=require('./pipeline-engine');
function fail(message,status=409){throw Object.assign(new Error(message),{status});}
function clean(body){const b={...body};delete b.final_request_approvals;return b;}
function pendingReview(run){let state;try{state=JSON.parse(run.params||'{}').final_pipeline;}catch(_){}if(['failed','paused'].includes(run.status)&&state?.recovery?.length)return {next_recovery:{path:`/pipeline/${run.id}/recover`,body:{}}};return run.status==='paused'&&state?.awaiting?{status:'awaiting_review',next_review:{path:`/pipeline/${run.id}/resume`,body:{}}}:{};}
function load({path,body={}}){
 path=String(path).replace(/^\/film(?=\/)/,'');
 let m=/^\/pipeline\/([^/]+)\/resume$/.exec(path);
 if(m){const run=db.prepare('SELECT * FROM film_pipeline_runs WHERE id=?').get(m[1]);if(!run)fail('Pipeline run not found',404);const params=JSON.parse(run.params||'{}'),state=params.final_pipeline;if(run.status!=='paused'||!state?.awaiting)fail('Pipeline is not waiting for a fresh review');return {run,state,project:db.prepare('SELECT * FROM film_projects WHERE id=?').get(run.project_id)};}
 m=/^\/(shots|scenes|projects)\/([^/]+)\/pipeline\/run(?:\/stream)?$/.exec(path);if(!m)return null;
 const kind=m[1].slice(0,-1),id=m[2];if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))fail(`Invalid ${kind} ID`,400);let shots,project,scene;
 if(kind==='shot'){const shot=db.prepare('SELECT * FROM film_shots WHERE id=?').get(id);if(!shot)fail('Shot not found',404);scene=db.prepare('SELECT * FROM film_scenes WHERE id=?').get(shot.scene_id);shots=[shot];project=db.prepare('SELECT * FROM film_projects WHERE id=?').get(scene.project_id);}
 else if(kind==='scene'){scene=db.prepare('SELECT * FROM film_scenes WHERE id=?').get(id);if(!scene)fail('Scene not found',404);shots=db.prepare('SELECT * FROM film_shots WHERE scene_id=? ORDER BY sort_order,shot_code').all(id);project=db.prepare('SELECT * FROM film_projects WHERE id=?').get(scene.project_id);}
 else{project=db.prepare('SELECT * FROM film_projects WHERE id=?').get(id);if(!project)fail('Project not found',404);shots=db.prepare('SELECT sh.* FROM film_shots sh JOIN film_scenes sc ON sc.id=sh.scene_id WHERE sc.project_id=? ORDER BY sc.scene_number,sh.sort_order,sh.shot_code').all(id);}
 const checked=require('./graph-hold').splitShots(db,shots);shots=checked.run;
 if(body.strict){const audit=require('./consistency-context');for(const shot of shots){const sc=db.prepare('SELECT * FROM film_scenes WHERE id=?').get(shot.scene_id);if(!audit.auditShotReadiness(shot,sc,project).ready)fail('Consistency check blocked the pipeline (strict mode)');}}
 const tasks=[],scenesDone=new Set(),projectSteps=[];
 for(const shot of shots){let card={};try{card=JSON.parse(shot.scene_card_yaml||'{}');}catch(_){}for(const step of buildStepPlan({...body,skip_steps:autoSkipSteps(card,body)})){
  if(step.scope==='project'){if(!projectSteps.some(s=>s.id===step.id))projectSteps.push(step);continue;}
  if(step.scope==='scene'){if(kind==='shot'&&!body.include_scene_steps)continue;const key=shot.scene_id+':'+step.id;if(scenesDone.has(key))continue;scenesDone.add(key);}
  tasks.push({shot_id:shot.id,step_id:step.id,key:shot.id+':'+step.id});
 }}
 const willRunProject=kind==='project'||!!body.include_project_steps;
 const gate=require('../routes/pipeline').preflightProjectSteps(projectSteps,body,willRunProject);if(gate)fail(gate.error);
 if(willRunProject&&shots[0])for(const step of projectSteps)tasks.push({shot_id:shots[0].id,step_id:step.id,key:'film:'+step.id,local:true});
 return {project,state:{version:1,body:clean(body),kind,scope_id:id,tasks,completed:[],failed:[],skipped:[],awaiting:false},scene};
}
async function wave(context){const items=[],selected=[],settled=[];const first=new Set();
 for(const task of context.state.tasks){if(context.state.completed.includes(task.key)||context.state.failed.some(f=>f.step_id===task.key)||context.state.skipped.some(s=>s.step_id===task.key))continue;if(task.local)continue;if(first.has(task.shot_id))continue;
 const shot=db.prepare('SELECT * FROM film_shots WHERE id=?').get(task.shot_id),scene=db.prepare('SELECT * FROM film_scenes WHERE id=?').get(shot.scene_id);
 const result=await require('../routes/pipeline').executeStep(task.step_id,shot,scene,{...context.project,ignore_stale:context.state.body.ignore_stale},{preview:true,completedItems:context.state.completed_items?.[task.key]||[]});
 if(!result.ok)fail(result.error);if(result.skipped){settled.push({step_id:task.key,reason:result.message});continue;}
 if(result.items?.length){first.add(task.shot_id);selected.push(task);for(const item of result.items)items.push({...item,provenance:{...item.provenance,pipeline_task:task.key,...(context.run?{pipeline_run_id:context.run.id}:{})}});}
 }
 return {items,selected,settled};
}
async function preparePipelineRequests(input){const ctx=load(input);if(!ctx)return null;const ready=await wave(ctx);if(!ready.items.length)fail('No paid pipeline requests are ready; inspect the remaining local steps');return {supported:true,items:ready.items,staged:true};}
function save(runId,state,status){const live=db.prepare('SELECT status FROM film_pipeline_runs WHERE id=?').get(runId);if(live?.status==='cancelled')status='cancelled';else if(live?.status==='paused'&&status==='running')status='paused';db.prepare('UPDATE film_pipeline_runs SET params=?,status=?,steps_completed=?,steps_failed=?,steps_skipped=?,steps_remaining=?,progress_pct=? WHERE id=?').run(JSON.stringify({final_pipeline:state}),status,JSON.stringify(state.completed),JSON.stringify(state.failed),JSON.stringify(state.skipped),JSON.stringify(state.tasks.filter(t=>!state.completed.includes(t.key)&&!state.skipped.some(s=>s.step_id===t.key)).map(t=>t.key)),Math.round(100*state.completed.length/Math.max(1,state.tasks.length)),runId);}
async function runReviewedPipeline(req,res,path){let runId;try{
 const ctx=load({path,body:req.body||{}}),ready=await wave(ctx);
 // All approvals are validated before creating/claiming a run or executing any item.
 await require('./final-request-review').preflightApprovals({path,body:req.body||{},prepare:()=>({items:ready.items})});
 for(const token of req.body.final_request_approvals||[]){const p=require('./final-request-review').store().get(token.id).editable.provenance||{};if(p.pipeline_run_id!==ctx.run?.id)fail('This approval belongs to a different pipeline run; review this run before resuming');}
 if(ctx.run){const candidate=ctx.run.id;const claim=db.prepare("UPDATE film_pipeline_runs SET status='running' WHERE id=? AND status='paused'").run(candidate);if(!claim.changes)fail('Pipeline is already being resumed');runId=candidate;}
 else{runId=generateId();db.prepare('INSERT INTO film_pipeline_runs(id,project_id,shot_id,scene_id,run_type,status,total_steps,params) VALUES(?,?,?,?,?,?,?,?)').run(runId,ctx.project.id,ctx.state.kind==='shot'?ctx.state.scope_id:null,ctx.state.kind==='scene'?ctx.state.scope_id:null,ctx.state.kind,'running',ctx.state.tasks.length,JSON.stringify({final_pipeline:ctx.state}));}
 if(path.endsWith('/stream')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({type:'status',run_id:runId,status:'running'})+'\n\n');}
 ctx.state.awaiting=false;ctx.state.skipped.push(...ready.settled);save(runId,ctx.state,'running');
 for(const task of ready.selected){const live=db.prepare('SELECT status FROM film_pipeline_runs WHERE id=?').get(runId);if(live.status==='cancelled')return respond(res,path,runId,{status:'cancelled'});if(live.status==='paused'){ctx.state.awaiting=true;save(runId,ctx.state,'paused');return respond(res,path,runId,{status:'awaiting_review',next_review:{path:`/pipeline/${runId}/resume`,body:{}}});}const shot=db.prepare('SELECT * FROM film_shots WHERE id=?').get(task.shot_id),scene=db.prepare('SELECT * FROM film_scenes WHERE id=?').get(shot.scene_id);db.prepare('UPDATE film_pipeline_runs SET current_step=? WHERE id=?').run(task.key,runId);const result=await require('../routes/pipeline').executeStep(task.step_id,shot,scene,{...ctx.project,ignore_stale:ctx.state.body.ignore_stale},{reviewedPipeline:true,pipelineRunId:ctx.run?.id,deliveryRunId:runId,completedItems:ctx.state.completed_items?.[task.key]||[]});if(!result.ok){ctx.state.failed.push({step_id:task.key,error:result.error});const accepted=(result.results||[]).filter(r=>r?.ok||r?.pending);const receipts=accepted.map(r=>r.job_id||r.review_id).filter(Boolean);if(receipts.length){ctx.state.recovery=ctx.state.recovery||[];ctx.state.recovery.push({step_id:task.key,receipts,items:accepted.map(r=>r.item_index),expected_items:result.expected_items});}save(runId,ctx.state,'failed');return respond(res,path,runId,{status:'failed',error:result.error,...(receipts.length?{next_recovery:{path:`/pipeline/${runId}/recover`,body:{}}}:{})});}ctx.state.completed.push(task.key);save(runId,ctx.state,'running');}
 const live=db.prepare('SELECT status FROM film_pipeline_runs WHERE id=?').get(runId);if(live.status==='cancelled')return respond(res,path,runId,{status:'cancelled'});
 // Resolve empty/skipped steps without submitting anything, so a silent tail does not strand a run.
 try {const next=await wave(ctx);ctx.state.skipped.push(...next.settled);}catch(error){ctx.state.awaiting=true;save(runId,ctx.state,'paused');return respond(res,path,runId,{status:'awaiting_review',error:error.message,next_review:{path:`/pipeline/${runId}/resume`,body:{}}});}
 const remaining=ctx.state.tasks.filter(t=>!ctx.state.completed.includes(t.key)&&!ctx.state.skipped.some(s=>s.step_id===t.key));
 if(remaining.some(t=>!t.local)){ctx.state.awaiting=true;save(runId,ctx.state,'paused');return respond(res,path,runId,{status:'awaiting_review',next_review:{path:`/pipeline/${runId}/resume`,body:{}}});}
 for(const task of remaining){const shot=db.prepare('SELECT * FROM film_shots WHERE id=?').get(task.shot_id),scene=db.prepare('SELECT * FROM film_scenes WHERE id=?').get(shot.scene_id);const result=await require('../routes/pipeline').executeStep(task.step_id,shot,scene,ctx.project);if(!result.ok){ctx.state.failed.push({step_id:task.key,error:result.error});save(runId,ctx.state,'failed');return respond(res,path,runId,{status:'failed',error:result.error});}ctx.state.completed.push(task.key);}
 save(runId,ctx.state,'complete');return respond(res,path,runId,{status:'complete'});
 }catch(error){if(runId)db.prepare("UPDATE film_pipeline_runs SET status='failed',error_message=? WHERE id=?").run(error.message,runId);if(path.endsWith('/stream')&&res.headersSent)return respond(res,path,runId,{status:'failed',error:error.message});res.writeHead(error.status||409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}}
function respond(res,path,run_id,value){const data={run_id,...value};if(path.endsWith('/stream')){if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({type:'result',...data})+'\n\ndata: {"type":"done"}\n\n');}else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}}
async function recoverReviewedPipeline(req,res,runId){
 let owned=false,state,attemptId,heartbeat;
 const current=()=>db.prepare('SELECT * FROM film_pipeline_runs WHERE id=?').get(runId);
 const checkpoint=()=>{
  const run=current();let live;try{live=JSON.parse(run?.params||'{}').final_pipeline;}catch(_){}
  if(run?.status==='running'&&live?.recovery_attempt?.id===attemptId)return true;
  respond(res,'',runId,{status:run?.status||'failed',...pendingReview(run||{}),...(run?.status==='running'?{status:'recovering',next_recovery:{path:`/pipeline/${runId}/recover`,body:{}}}:{})});
  return false;
 };
 const saveOwned=status=>{state.recovery_attempt.started_at=Date.now();return !!db.prepare(`UPDATE film_pipeline_runs SET params=?,status=?,steps_completed=?,steps_failed=?,steps_skipped=?,steps_remaining=?,progress_pct=?
  WHERE id=? AND status='running' AND json_extract(params,'$.final_pipeline.recovery_attempt.id')=?`).run(
  JSON.stringify({final_pipeline:state}),status,JSON.stringify(state.completed),JSON.stringify(state.failed),JSON.stringify(state.skipped),
  JSON.stringify(state.tasks.filter(t=>!state.completed.includes(t.key)&&!state.skipped.some(s=>s.step_id===t.key)).map(t=>t.key)),
  Math.round(100*state.completed.length/Math.max(1,state.tasks.length)),runId,attemptId).changes;};
 const finish=(status,value)=>{if(!saveOwned(status))return checkpoint();return respond(res,'',runId,{status,...value});};
 try{
  const run=current();
  if(!run)fail('Pipeline run not found',404);
  state=JSON.parse(run.params||'{}').final_pipeline;
  if(!state)fail('This pipeline has no captured accepted-result recovery');
  if(run.status==='cancelled')return respond(res,'',runId,{status:'cancelled'});
  if(run.status==='complete')return respond(res,'',runId,{status:'complete',already:true});
  if(run.status==='paused'&&!state.recovery?.length)return respond(res,'',runId,pendingReview(run));
  const staleRecovery=run.status==='running'&&state.recovery_attempt?.started_at<Date.now()-20*60*1000;
  if(run.status==='running'&&!staleRecovery&&state.recovery?.length)return respond(res,'',runId,{status:'recovering',next_recovery:{path:`/pipeline/${runId}/recover`,body:{}}});
  if((!['failed','paused'].includes(run.status)&&!staleRecovery)||!state.recovery?.length)fail('Pipeline has no failed accepted result to recover');
  attemptId=generateId();state.recovery_attempt={id:attemptId,started_at:Date.now()};
  const claim=db.prepare("UPDATE film_pipeline_runs SET status='running',params=? WHERE id=? AND status=? AND params=?").run(JSON.stringify({final_pipeline:state}),runId,run.status,run.params);
  if(!claim.changes)fail('Pipeline recovery is already running');
  owned=true;
  heartbeat=setInterval(()=>{try{db.prepare("UPDATE film_pipeline_runs SET params=json_set(params,'$.final_pipeline.recovery_attempt.started_at',?) WHERE id=? AND status='running' AND json_extract(params,'$.final_pipeline.recovery_attempt.id')=?").run(Date.now(),runId,attemptId);}catch(_){}},30000);heartbeat.unref();
  for(const recovery of [...state.recovery]){
   for(const receipt of recovery.receipts){
    if(!checkpoint())return;
    const delivered=await require('./generation-jobs').collect(receipt);
    if(!checkpoint())return;
    if(!delivered.ok)return finish('failed',{error:delivered.error,next_recovery:{path:`/pipeline/${runId}/recover`,body:{}}});
   }
   state.completed_items=state.completed_items||{};state.completed_items[recovery.step_id]=[...new Set([...(state.completed_items[recovery.step_id]||[]),...(recovery.items||[0])])];
   if(state.completed_items[recovery.step_id].length>=(recovery.expected_items||1)&&!state.completed.includes(recovery.step_id))state.completed.push(recovery.step_id);
   state.failed=state.failed.filter(f=>f.step_id!==recovery.step_id);
   state.recovery=state.recovery.filter(r=>r.step_id!==recovery.step_id);
   if(!saveOwned('running'))return checkpoint();
  }
  // Resolve free/skipped work under the same ownership as accepted delivery.
  const project=db.prepare('SELECT * FROM film_projects WHERE id=?').get(run.project_id);
  let next;
  try{next=await wave({run,state,project});}
  catch(error){if(!checkpoint())return;state.awaiting=true;return finish('paused',{status:'awaiting_review',error:error.message,next_review:{path:`/pipeline/${runId}/resume`,body:{}}});}
  if(!checkpoint())return;
  state.skipped.push(...next.settled);
  const remaining=state.tasks.filter(t=>!state.completed.includes(t.key)&&!state.skipped.some(s=>s.step_id===t.key));
  if(remaining.some(t=>!t.local)){state.awaiting=true;return finish('paused',{status:'awaiting_review',next_review:{path:`/pipeline/${runId}/resume`,body:{}}});}
  for(const task of remaining){
   if(!checkpoint())return;
   const shot=db.prepare('SELECT * FROM film_shots WHERE id=?').get(task.shot_id),scene=db.prepare('SELECT * FROM film_scenes WHERE id=?').get(shot?.scene_id);
   const result=await require('../routes/pipeline').executeStep(task.step_id,shot,scene,project);
   if(!checkpoint())return;
   if(!result.ok){state.failed.push({step_id:task.key,error:result.error});return finish('failed',{error:result.error});}
   if(result.skipped)state.skipped.push({step_id:task.key,reason:result.message});else state.completed.push(task.key);
   if(!saveOwned('running'))return checkpoint();
  }
  return finish('complete',{recovered:true});
 }catch(error){
  if(owned){if(!checkpoint())return;saveOwned('failed');}
  res.writeHead(error.status||409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));
 }finally{if(heartbeat)clearInterval(heartbeat);}
}
module.exports={preparePipelineRequests,runReviewedPipeline,recoverReviewedPipeline,pendingReview};
