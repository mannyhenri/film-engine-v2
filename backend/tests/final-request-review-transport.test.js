const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'final-review-real-store-'));
process.env.FILM_DATA_DIR=temp;
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const contract=require('../lib/final-request-review');
require('../lib/providers/credentials').getCredential=()=>({apiKey:'mock-only',meta:{}});
const openai=require('../lib/providers/openai-image').adapter;
test('real durable approval feeds exact serialized OpenAI request and duplicate Send makes no second POST',async()=>{
 const s=contract.store(),payload={model:'gpt-image-1',prompt:'The final complete visible prompt',size:'1024x1024',quality:'low'};
 const review=await s.preview({provider:'openai',capability:'image',payload});
 const token=s.approve(review.id,{fingerprint:review.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 const original=global.fetch;let calls=0;
 global.fetch=async(url,init)=>{calls++;assert.equal(String(url),review.snapshot.endpoint);assert.deepEqual(JSON.parse(init.body),review.snapshot.body);return{ok:true,status:200,json:async()=>({data:[{b64_json:Buffer.from('mock raster').toString('base64')}]})};};
 try {const result=await openai.generate('image',{...payload,prompt:'Changed after Send, must never travel'},{finalRequest:token});assert.equal(result.ok,true);assert.equal(calls,1);await assert.rejects(openai.generate('image',payload,{finalRequest:token}),/uncertain|already sent/);assert.equal(calls,1);}finally{global.fetch=original;}
});
test('real rows ignore operational state but invalidate semantic edits and unknown cost needs consent',async()=>{
 db.prepare('INSERT INTO film_projects (id,title) VALUES (?,?)').run('project-fixture','Fixture');
 const s=contract.store(),payload={model:'gpt-image-1',prompt:'Bound title',quality:'low'};
 const r=await s.preview({provider:'openai',capability:'image',payload,provenance:{project_id:'project-fixture'}});
 db.prepare("UPDATE film_projects SET status='production',updated_at=CURRENT_TIMESTAMP WHERE id='project-fixture'").run();
 assert.doesNotThrow(()=>s.approve(r.id,{fingerprint:r.fingerprint,human_confirmed:true,cost_unknown_ack:true}));
 db.prepare("UPDATE film_projects SET title='Changed story' WHERE id='project-fixture'").run();
 assert.throws(()=>s.claim({id:r.id,fingerprint:r.fingerprint},'openai','image'),/changed/);
});
test.after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true});});
test('selected source same-size changes and semantic flow graph edits stop Send before planning',async()=>{
 const file=path.join(temp,'selected-reference.png');fs.writeFileSync(file,'AAAA');
 db.prepare('INSERT INTO film_projects (id,title) VALUES (?,?)').run('source-project','Source');
 db.prepare('INSERT INTO film_scenes (id,project_id,scene_number) VALUES (?,?,?)').run('source-scene','source-project',1);
 db.prepare('INSERT INTO film_shots (id,scene_id,shot_code) VALUES (?,?,?)').run('source-shot','source-scene','1A');
 db.prepare("INSERT INTO film_assets (id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES (?,?,?,'storyboard',?,?,1)").run('source-asset','source-project','source-shot',file,'selected-reference.png');
 const s=contract.store(),payload={model:'gpt-image-1',prompt:'Selected source test',quality:'low'};
 const r=await s.preview({provider:'openai',capability:'image',payload,provenance:{shot_id:'source-shot',project_id:'source-project'}});
 const token=s.approve(r.id,{fingerprint:r.fingerprint,human_confirmed:true,cost_unknown_ack:true});fs.writeFileSync(file,'BBBB');let planned=0;
 await assert.rejects(contract.preflightApprovals({path:'/generate',body:{final_request_approvals:[token]},reviewStore:s,prepare:async()=>{planned++;return{items:[]};}}),/inputs changed/);assert.equal(planned,0);
 db.prepare('INSERT INTO film_flows (id,project_id,name) VALUES (?,?,?)').run('flow-fixture','source-project','Flow');
 db.prepare('INSERT INTO film_flow_nodes (id,flow_id,node_type,config) VALUES (?,?,?,?)').run('node-fixture','flow-fixture','fixture','{}');
 const flow=await s.preview({provider:'openai',capability:'image',payload,provenance:{flow_id:'flow-fixture',node_id:'node-fixture'}});
 const flowToken=s.approve(flow.id,{fingerprint:flow.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 db.prepare('UPDATE film_flow_nodes SET position_x=50 WHERE id=?').run('node-fixture');assert.doesNotThrow(()=>s.validate(flow.id));
 db.prepare('UPDATE film_flow_nodes SET config=? WHERE id=?').run('{"prompt":"changed"}','node-fixture');
 await assert.rejects(contract.preflightApprovals({path:'/flow/run',body:{final_request_approvals:[flowToken]},reviewStore:s,prepare:async()=>{planned++;return{items:[]};}}),/inputs changed/);assert.equal(planned,0);
});
test('staged endpoint marks and persisted upstream outputs are semantic; run status churn is not',async()=>{
 db.prepare('INSERT INTO film_shots (id,scene_id,shot_code) VALUES (?,?,?)').run('endpoint-shot','source-scene','1B');
 db.prepare('INSERT INTO film_storyboard_annotations (id,shot_id,kind,points_json,text,color) VALUES (?,?,?,?,?,?)').run('endpoint-mark','endpoint-shot','text','[[0.2,0.3]]','Approved endpoint','#ff0000');
 db.prepare('INSERT INTO film_flow_runs (id,flow_id,project_id,status) VALUES (?,?,?,?)').run('run-fixture','flow-fixture','source-project','paused');
 db.prepare('INSERT INTO film_flow_node_runs (id,run_id,node_id,node_type,status,outputs) VALUES (?,?,?,?,?,?)').run('upstream-fixture','run-fixture','upstream','fixture','complete','{"image":"approved"}');
 const s=contract.store(),payload={model:'gpt-image-1',prompt:'Staged phase',quality:'low'},provenance={run_id:'run-fixture',source_shot_ids:['source-shot','endpoint-shot']};
 const r=await s.preview({provider:'openai',capability:'image',payload,provenance});const token=s.approve(r.id,{fingerprint:r.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 db.prepare('UPDATE film_flow_runs SET status=?,progress_pct=? WHERE id=?').run('running',40,'run-fixture');assert.doesNotThrow(()=>s.validate(r.id));
 db.prepare('INSERT INTO film_flow_node_runs (id,run_id,node_id,node_type,status) VALUES (?,?,?,?,?)').run('pending-child','run-fixture','child','fixture','pending');assert.doesNotThrow(()=>s.validate(r.id));
 db.prepare('UPDATE film_flow_node_runs SET status=?,outputs=? WHERE id=?').run('complete','{\"image\":\"unrelated sibling\"}','pending-child');assert.doesNotThrow(()=>s.validate(r.id));
 db.prepare('UPDATE film_storyboard_annotations SET text=? WHERE id=?').run('Changed endpoint','endpoint-mark');assert.throws(()=>s.validate(r.id),/inputs changed/);
 const next=await s.preview({provider:'openai',capability:'image',payload,provenance});s.approve(next.id,{fingerprint:next.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 db.prepare('UPDATE film_flow_node_runs SET outputs=? WHERE id=?').run('{"image":"changed upstream"}','upstream-fixture');assert.throws(()=>s.validate(next.id),/inputs changed/);
});
test('subject semantic description edits invalidate approval while timestamp-only updates remain valid',async()=>{
 db.prepare('INSERT INTO film_characters (id,project_id,name,description) VALUES (?,?,?,?)').run('provenance-character','source-project','Fixture actor','Original description');
 const s=contract.store(),payload={model:'gpt-image-1',prompt:'Explicit override remains identical',quality:'low'};
 const r=await s.preview({provider:'openai',capability:'image',payload,provenance:{subject_kind:'character',subject_id:'provenance-character'}});
 const token=s.approve(r.id,{fingerprint:r.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 db.prepare('UPDATE film_characters SET updated_at=? WHERE id=?').run('2099-01-01','provenance-character');assert.doesNotThrow(()=>s.validate(r.id));
 db.prepare('UPDATE film_characters SET description=? WHERE id=?').run('Changed identity description','provenance-character');assert.throws(()=>s.claim(token,'openai','image'),/inputs changed/);
});
test('actual resolver permits baseline full prompt/body controls and excludes them from read-only metadata',async()=>{
 const s=contract.store(),payload={model:'gpt-image-1',prompt:'Composed original',quality:'low',final_prompt:'The entire visible prompt'};
 const first=await s.preview({provider:'openai',capability:'image',payload});assert.equal(first.snapshot.body.prompt,payload.final_prompt);assert.ok(!first.snapshot.metadata.readOnlyInputFields.includes('final_prompt'));
 const next=await s.preview({...first.editable,replaces_review_id:first.id,payload:{...first.editable.payload,final_prompt:'The user edited the entire final prompt'}});assert.equal(next.snapshot.body.prompt,'The user edited the entire final prompt');
 const fullBody={...next.snapshot.body,prompt:'Whole provider body prompt',quality:'high'};
 const bodyReview=await s.preview({...next.editable,replaces_review_id:next.id,payload:{...next.editable.payload,final_request_body:fullBody,final_prompt:fullBody.prompt}});assert.deepEqual(bodyReview.snapshot.body,fullBody);assert.ok(!bodyReview.snapshot.metadata.readOnlyInputFields.includes('final_request_body'));
 const token=s.approve(bodyReview.id,{fingerprint:bodyReview.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 const original=global.fetch;let calls=0;global.fetch=async(url,init)=>{calls++;assert.deepEqual(JSON.parse(init.body),fullBody);return{ok:true,status:200,json:async()=>({data:[{b64_json:Buffer.from('mock').toString('base64')}]})};};
 try{assert.equal((await openai.generate('image',payload,{finalRequest:token})).ok,true);assert.equal(calls,1);}finally{global.fetch=original;}
});
test('world version and explicit input asset mutations invalidate approval; operational state remains valid',async()=>{
 db.prepare('INSERT INTO film_worlds (id,project_id,name) VALUES (?,?,?)').run('provenance-world','source-project','Fixture world');
 db.prepare('INSERT INTO film_world_versions (id,world_id,version,caption) VALUES (?,?,?,?)').run('provenance-world-v1','provenance-world',1,'Approved layout');
 const file=path.join(temp,'post-input.mp4');fs.writeFileSync(file,'AAAA');db.prepare("INSERT INTO film_assets (id,project_id,asset_type,file_path,file_name,version) VALUES (?,?,'video_raw',?,?,1)").run('post-input-fixture','source-project',file,'post-input.mp4');
 const s=contract.store(),payload={model:'gpt-image-1',prompt:'Provenance fixture',quality:'low'},provenance={world_version_id:'provenance-world-v1',input_asset_id:'post-input-fixture'};
 const r=await s.preview({provider:'openai',capability:'image',payload,provenance});s.approve(r.id,{fingerprint:r.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 db.prepare("UPDATE film_world_versions SET status='approved' WHERE id=?").run('provenance-world-v1');assert.doesNotThrow(()=>s.validate(r.id));
 db.prepare('UPDATE film_world_versions SET caption=? WHERE id=?').run('Changed spatial layout','provenance-world-v1');assert.throws(()=>s.validate(r.id),/inputs changed/);
 const fresh=await s.preview({provider:'openai',capability:'image',payload,provenance});s.approve(fresh.id,{fingerprint:fresh.fingerprint,human_confirmed:true,cost_unknown_ack:true});
 const replacement=path.join(temp,'post-replaced.mp4');fs.writeFileSync(replacement,'BBBB');db.prepare('UPDATE film_assets SET file_path=? WHERE id=?').run(replacement,'post-input-fixture');assert.throws(()=>s.validate(fresh.id),/inputs changed/);
});
