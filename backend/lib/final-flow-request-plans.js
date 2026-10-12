'use strict';
const fail=message=>{throw Object.assign(new Error(message),{status:409,code:'FINAL_REQUEST_REVIEW_UNSUPPORTED'});};
async function planGraph(graph, ctx, state) {
 const {validateGraph,nextNodes}=require('./flow-graph');
 const validity=validateGraph(graph);if(!validity.ok)fail('Flow graph is invalid; nothing was submitted');
 const {nodeType}=require('./flow-node-types');
 const {resolveNodeInputs,executeNode,branchesFor,projectOutputs}=require('./flow-executor');
 const outputs=state?.outputs||{},done=[...(state?.completed||[]),...(state?.skipped||[])],reviewed=new Set(),items=[];
 for(let pass=0;pass<=graph.nodes.length;pass++) {
  const frontier=nextNodes(graph,done,[]).filter(n=>!reviewed.has(n.id));if(!frontier.length)break;
  for(const node of frontier) {
   if(node.type.startsWith('out.'))continue;
   const def=nodeType(node.type);
   const branches=branchesFor?branchesFor(graph,node,outputs,{},null,new Map()):[{key:''}];
   let paused=false;
   for(const branch of branches) {
    if(state?.completeKeys.has(`${node.id}:${branch.key}`))continue;
    const inputs=resolveNodeInputs(graph,node.id,projectOutputs?projectOutputs(outputs,branch.key):Object.fromEntries(Object.entries(outputs).map(([key,value])=>[key,value['']])));
    const result=await executeNode(node,inputs,{...ctx,branch:branch.key,variant:branch.variant,finalRequestPreview:true});
    if(!result.ok)fail(result.error||`Node ${node.id} could not prepare`);
    if(result.awaitSelection){paused=true;break;}
    if(def?.kind==='generator') {
     items.push(...(result.previewRequests||[]).map(item=>({...item,provenance:{...item.provenance,branch_key:branch.key}})));
     if(!result.skipped)paused=true;
    } else {
     (outputs[node.id]||={})[branch.key]=result.outputs||{};
     if(result.branchKeys)outputs[node.id].__branches=result.branchKeys;
    }
   }
   if(paused)reviewed.add(node.id);else done.push(node.id);
  }
 }
 if(!items.length)fail('No generation is ready for final review. Complete the current selection gate first.');
 return {supported:true,items,staged:true};
}
async function prepareFlowRequests({path,body={}}) {
 const resume=String(path).match(/^\/(?:film\/)?flow-runs\/([^/]+)\/resume$/);
 if(resume) {
  const {db}=require('../db/database'),state=require('./flow-review-state').loadFlowReviewState(db,resume[1]);
  if(state.run.status!=='paused'||state.run.error_message!=='AWAITING_FINAL_REQUEST_REVIEW')fail('This run is not waiting for final review');
  const routes=require('../routes/flows'),stored=routes.loadGraph(state.run.flow_id),params=JSON.parse(state.run.params||'{}');
  if(!stored||stored.fingerprint!==(params.flow_fingerprint||state.run.graph_fingerprint))fail('Flow changed after the run began; nothing was resubmitted');
  const resolved=routes.runContext({shot_id:state.run.shot_id,project_id:state.run.project_id,vars:params.vars||{}});
  if(resolved.error)fail(resolved.error);
  const result=await planGraph(state.graph,resolved.ctx,state);
  for(const item of result.items)item.provenance={...item.provenance,flow_id:state.run.flow_id,run_id:state.run.id,flow_fingerprint:state.run.graph_fingerprint};
  return result;
 }
 const match=String(path).match(/^\/(?:film\/)?flows\/([^/]+)\/(run(?:\/stream)?|apply)$/);
 if(!match)return null;
 const routes=require('../routes/flows'),graph=routes.loadGraph(match[1]);
 if(!graph)throw Object.assign(new Error('Flow not found'),{status:404});
 if(match[2]==='apply') {
  const {db}=require('../db/database');
  const targets=Array.isArray(body.targets)?body.targets:String(body.targets||'').split(',');
  const plan=require('./flow-apply').planApply(db,{flowId:graph.id,projectId:body.project_id||null,targets,vars:body.vars||{},inputs:body.inputs||{}});
  if(plan.error)fail(plan.error);
  if(!body.fingerprint||plan.fingerprint!==body.fingerprint)fail('Flow apply plan changed. Review a fresh apply plan before final request review.');
  const bound=require('./flow-form').withInputs(graph,body.inputs||{}),items=[];
  for(const shot of plan.shots.filter(s=>s.status==='ok')) {
   const resolved=routes.runContext({shot_id:shot.shot_id,vars:body.vars||{}});
   if(resolved.error)fail(resolved.error);
   const prepared=await planGraph(bound,resolved.ctx);
   for(const item of prepared.items)items.push({...item,provenance:{...item.provenance,flow_id:graph.id,flow_fingerprint:graph.fingerprint,apply_fingerprint:plan.fingerprint}});
  }
  if(!items.length)fail('No eligible flow apply items to review');
  return {supported:true,items};
 }
 const resolved=routes.runContext(body);if(resolved.error)throw Object.assign(new Error(resolved.error),{status:404});
 const result=await planGraph(graph,resolved.ctx);
 for(const item of result.items)item.provenance={...item.provenance,flow_id:graph.id,flow_fingerprint:graph.fingerprint};
 return result;
}
module.exports={prepareFlowRequests,planGraph};
