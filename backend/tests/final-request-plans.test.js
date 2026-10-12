'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Module=require('module'),original=Module._load;
const calls=[];
const db={prepare(sql){return {get(id){return sql.includes('s.id AS shot_id')?{shot_id:id,project_id:'project'}:{id};}};}};
Module._load=function(id,parent,...args){
 if(parent?.filename.endsWith('/final-request-plans.js')) {
  if(id==='./final-subject-request-plans')return {prepareSubjectRequests:async()=>null};
  if(id==='./final-flow-request-plans')return {prepareFlowRequests:async()=>null};
  if(id==='../db/database')return {db};
  if(id==='./graph-hold')return {splitShots(_db,shots){return {run:shots.filter(s=>!s.held)};}};
  if(id==='../routes/storyboard')return {
   getStoryboardShots(){return [{shot_id:'one'},{shot_id:'held',held:true},{shot_id:'two'}];},
   async realBatchBoardRequests(project,body){const items=[];for(const id of ['one','two']){calls.push(id);if(body.fail===id)throw new Error('missing reference');items.push({provider:'runway',capability:'image',payload:{prompt:id,seed:17},provenance:{project_id:project,shot_id:id,default_seed:!body.seed}});}return {items};},
   async realBoardRequest(id,body){calls.push(id);if(body.fail===id)return {error:'missing reference',status:409};return {preview:{provider:'runway',payload:{prompt:id,seed:17}}};},
   async realRefineRequest(id){return {preview:{provider:'google',payload:{prompt:'keep composition',reference_images:[{uri:'fixed'}]}}};},
   async realRecomposeRequest(id){return {preview:{provider:'google',payload:{prompt:'preserve performance',reference_images:[{uri:'subject'},{uri:'place'}]}}};} };
  if(id==='../routes/inbetweens')return {realFrameRequest:async()=>({supported:true,staged:true,items:[{provider:'muapi',capability:'image',payload:{prompt:'first ready moment'},provenance:{frame_index:0}}]})};
  if(id==='../routes/video-gen')return {buildVideoGenerationPlan(id){return {videoProvider:{id:'seedance',generate:async(_cap,payload)=>({preview:true,payload})},payload:{prompt:id,model:'explicit'}};}};
 }
 return original.call(this,id,parent,...args);
};
const {prepare}=require('../lib/final-request-plans');
test.after(()=>{Module._load=original;});
test('all eligible batch items are resolved in order before a review exists',async()=>{
 calls.length=0;const result=await prepare({path:'/film/projects/project/storyboard/generate/stream',body:{}});
 assert.deepEqual(calls,['one','two']);assert.deepEqual(result.items.map(x=>x.payload.prompt),['one','two']);assert.equal(result.items[0].provenance.default_seed,true);
});
test('later batch refusal rejects the entire preparation instead of returning first item',async()=>{
 await assert.rejects(prepare({path:'/projects/project/storyboard/generate',body:{fail:'two'}}),/missing reference/);
});
test('explicit seed is not declared ephemeral',async()=>{
 const result=await prepare({path:'/shots/one/storyboard/regenerate',body:{seed:33}});assert.equal(result.items[0].provenance.default_seed,undefined);
});
test('refine and recompose preserve real path payload and ordered references',async()=>{
 const refine=await prepare({path:'/shots/one/storyboard/refine',body:{}});assert.equal(refine.items[0].payload.prompt,'keep composition');
 const rec=await prepare({path:'/shots/one/storyboard/recompose',body:{}});assert.deepEqual(rec.items[0].payload.reference_images.map(r=>r.uri),['subject','place']);
});
test('dependent chain prepares only the currently resolved frame',async()=>{
 const planned=await prepare({path:'/inbetweens/strip/generate',body:{}});assert.equal(planned.staged,true);assert.equal(planned.items.length,1);assert.equal(planned.items[0].provenance.frame_index,0);
});
