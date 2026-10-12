'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-final-recovery-'));
process.env.MUAPI_API_KEY = 'mock-only';
process.env.ELEVENLABS_API_KEY = 'mock-only';
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
const jobs = require('../lib/generation-jobs');
const providers = require('../lib/providers');
const reviews = require('../lib/final-request-review');
require('../lib/providers/credentials').getCredential = id => ({ apiKey: id === 'muapi' ? 'mock-only' : null, meta: {} });
const png = require('../lib/png-raster').encode({ width: 32, height: 18, pixels: Buffer.alloc(32 * 18 * 4, 175) });
function fixture() {
    const project = crypto.randomUUID(), scene = crypto.randomUUID(), shot = crypto.randomUUID();
    db.prepare('INSERT INTO film_projects(id,title,provider_config) VALUES(?,?,?)').run(project, 'Recovery fixture', JSON.stringify({ image: 'muapi', image_model: 'nano-banana-2' }));
    db.prepare('INSERT INTO film_scenes(id,project_id,scene_number) VALUES(?,?,1)').run(scene, project);
    db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,?)').run(shot, scene, '1A', JSON.stringify({ action: 'A distinct recovery fixture', camera: { movement: 'static' } }));
    return { project, scene, shot };
}
async function approved(input) {
    const review = await reviews.store().preview(input);
    return reviews.store().approve(review.id, { fingerprint: review.fingerprint, human_confirmed: true, cost_unknown_ack: true });
}
async function pipelineRequest(route, body = {}) {
    return reviews.runWithApprovals(body.final_request_approvals || [], () => new Promise((resolve, reject) => {
        const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(value) { resolve({ status: this.status, body: JSON.parse(value) }); } };
        const planner = require('../lib/final-pipeline-request-plans');
        Promise.resolve(route.endsWith('/recover') ? require('../routes/pipeline').handlePipeline({method:'POST',body},res,['film',...route.split('/').slice(1)],{}) : planner.runReviewedPipeline({ body }, res, route)).catch(reject);
    }));
}
test('concurrent collects poll, persist and meter the accepted job once', async () => {
    const f = fixture(), adapter = providers.get('muapi'), original = adapter.collect;
    const id = jobs.record({ provider: 'muapi', capability: 'image', requestId: 'concurrent-' + f.project, projectId: f.project, meta: { meter: { model: 'nano-banana-2', unit: 'image', quantity: 1 } } });
    let polls = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    adapter.collect = async () => { polls++; await gate; return { ok: true, data: png }; };
    try {
        const first = jobs.collect(id), second = jobs.collect(id);
        await Promise.resolve();
        release();
        const results = await Promise.all([first, second]);
        assert.equal(polls, 1, 'two collectors reached the same provider handle');
        assert.equal(results.filter(r => r.ok).length, 2);
        assert.equal(results[0].stored,results[1].stored);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n, 1);
        assert.equal((await jobs.collect(id)).already, 'completed');
    } finally { adapter.collect = original; }
});
test('collect accepts the review receipt when handle recording failed and preserves the native result', async () => {
    const f = fixture(), progress = require('../lib/generation-progress'), oldStart = progress.start, oldRecord = jobs.record, oldFetch = global.fetch;
    const payload = { prompt: 'Handle receipt recovery', model: 'nano-banana-2' };
    const token = await approved({ provider: 'muapi', capability: 'image', payload, provenance: { project_id: f.project,shot_id:f.shot } });
    let posts = 0;
    progress.start = () => null;
    jobs.record = () => null;
    global.fetch = async (url, opts = {}) => {
        if (opts.method === 'POST') { posts++; return { ok: true, json: async () => ({ request_id: 'receipt-' + f.project }) }; }
        if (String(url).includes('/predictions/')) return { ok: true, json: async () => ({ status: 'completed', outputs: ['https://mock.invalid/receipt.png'] }) };
        assert.equal(String(url), 'https://mock.invalid/receipt.png');
        return { ok: true, arrayBuffer: async () => png };
    };
    try {
        const generator = providers.resolve('image', { image: 'muapi', __project_id: f.project,__shot_id:f.shot });
        const generated = await reviews.runWithApprovals([token], () => generator.generate('image', payload, {jobMeta:{storyboard_frame:{shot_id:f.shot,width:32,height:18}}}));
        assert.equal(generated.ok, true, generated.error);
        assert.ok(reviews.store().get(token.id).result.data, 'registry overwrote the retained native bytes with a summary');
        assert.equal(reviews.store().get(token.id).result._final_request_receipt.job_meta.storyboard_frame.shot_id,f.shot);
        jobs.record = oldRecord;
        const recovered = await jobs.collect(token.id);
        assert.equal(recovered.ok, true, recovered.error);
        assert.deepEqual(fs.readFileSync(recovered.stored), png);
        assert.equal(recovered.frame.shot_id,f.shot);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,1);
        assert.equal(posts, 1, 'receipt recovery bought another generation');
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n, 1);
    } finally { progress.start = oldStart; jobs.record = oldRecord; global.fetch = oldFetch; }
});
test('failed pipeline filing can recover the accepted bytes without a second generation POST', async () => {
    const f = fixture(), route = `/shots/${f.shot}/pipeline/run`, body = { only_steps: ['keyframe'] };
    const plan = await require('../lib/final-pipeline-request-plans').preparePipelineRequests({ path: route, body });
    const tokens = await Promise.all(plan.items.map(approved));
    const oldFetch = global.fetch, oldWrite = fs.writeFileSync,oldAccepted=jobs.accepted;
    let posts = 0, rejectSave = true;
    global.fetch = async (url, opts = {}) => {
        if (opts.method === 'POST') { posts++; return { ok: true, json: async () => ({ request_id: 'pipeline-' + f.project }) }; }
        if (String(url).includes('/predictions/')) return { ok: true, json: async () => ({ status: 'completed', outputs: ['https://mock.invalid/pipeline.png'] }) };
        assert.equal(String(url), 'https://mock.invalid/pipeline.png');
        return { ok: true, arrayBuffer: async () => png };
    };
    fs.writeFileSync = function (file, ...args) {
        if (rejectSave && String(file).includes('_keyframe_')) throw new Error('Injected pipeline storage failure');
        return oldWrite.call(this, file, ...args);
    };
    jobs.accepted=()=>false;
    try {
        const failed = await pipelineRequest(route, { ...body, final_request_approvals: tokens });
        assert.equal(failed.body.status, 'failed', JSON.stringify(failed));
        assert.equal(posts, 1);
        assert.ok(failed.body.next_recovery, 'failed accepted work has no supported recovery action');
        rejectSave = false;
        const run=db.prepare('SELECT params FROM film_pipeline_runs WHERE id=?').get(failed.body.run_id),params=JSON.parse(run.params);
        params.final_pipeline.recovery_attempt={id:'interrupted-recovery',started_at:Date.now()};
        db.prepare("UPDATE film_pipeline_runs SET status='running',params=? WHERE id=?").run(JSON.stringify(params),failed.body.run_id);
        const waiting=await pipelineRequest(failed.body.next_recovery.path);
        assert.equal(waiting.body.status,'recovering');assert.equal(posts,1);
        params.final_pipeline.recovery_attempt.started_at=Date.now()-21*60*1000;
        db.prepare('UPDATE film_pipeline_runs SET params=? WHERE id=?').run(JSON.stringify(params),failed.body.run_id);
        const recovered = await pipelineRequest(failed.body.next_recovery.path, failed.body.next_recovery.body);
        assert.equal(recovered.body.status, 'complete', JSON.stringify(recovered));
        assert.equal(posts, 1, 'pipeline recovery bought another generation');
        const assets = db.prepare('SELECT * FROM film_assets WHERE shot_id=?').all(f.shot);
        assert.equal(assets.length, 1);
        assert.deepEqual(fs.readFileSync(assets[0].file_path), png);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n, 1);
        const repeated = await pipelineRequest(failed.body.next_recovery.path, failed.body.next_recovery.body);
        assert.equal(repeated.body.status, 'complete', JSON.stringify(repeated));
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n, 1);
        assert.equal(posts, 1);
    } finally { fs.writeFileSync = oldWrite; global.fetch = oldFetch;jobs.accepted=oldAccepted; }
});
test('pending accepted handle survives failed job recording and collects through the ordinary route', async () => {
    const f=fixture(),progress=require('../lib/generation-progress'),oldStart=progress.start,oldRecord=jobs.record,oldFetch=global.fetch;
    const payload={prompt:'Accepted pending handle fixture',model:'nano-banana-2'};
    const token=await approved({provider:'muapi',capability:'image',payload,provenance:{project_id:f.project}});
    let posts=0,finished=false;
    progress.start=()=>null;jobs.record=()=>null;
    global.fetch=async(url,opts={})=>{
        if(opts.method==='POST'){posts++;return {ok:true,json:async()=>({request_id:'pending-'+f.project})};}
        if(String(url).includes('/predictions/'))return {ok:true,json:async()=>finished?{status:'completed',outputs:['https://mock.invalid/pending.png']}:{status:'processing'}};
        assert.equal(String(url),'https://mock.invalid/pending.png');return {ok:true,arrayBuffer:async()=>png};
    };
    try{
        const generated=await reviews.runWithApprovals([token],()=>providers.resolve('image',{image:'muapi',__project_id:f.project}).generate('image',payload,{timeout:1}));
        assert.equal(generated.pending,true,generated.error);
        assert.equal(generated.review_id,token.id);
        assert.equal(reviews.store().get(token.id).state,'submitted');
        assert.equal(jobs.retainedReceipts(f.project)[0].review_id,token.id);
        jobs.record=oldRecord;finished=true;
        const response=await new Promise((resolve,reject)=>{
            const res={writeHead(status){this.status=status;},end(body){resolve({status:this.status,body:JSON.parse(body)});}};
            Promise.resolve(require('../routes/generation-jobs').handleGenerationJobs({method:'POST',body:{}},res,['film','generation-jobs',token.id,'collect'])).catch(reject);
        });
        assert.equal(response.status,200,response.body.error);
        assert.deepEqual(fs.readFileSync(response.body.stored),png);
        assert.equal(posts,1);
        assert.equal(jobs.retainedReceipts(f.project).length,0);
    }finally{progress.start=oldStart;jobs.record=oldRecord;global.fetch=oldFetch;}
});
test('storage retry reuses cached output and rejects retargeting before provider collection', async()=>{
    const f=fixture(),adapter=providers.get('muapi'),oldCollect=adapter.collect,capabilities=require('../lib/capability-payloads'),oldPersist=capabilities.persistCapabilityResult;
    const id=jobs.record({provider:'muapi',capability:'image',requestId:'save-retry-'+f.project,projectId:f.project,shotId:f.shot,meta:{storyboard_frame:{shot_id:f.shot,width:32,height:18},meter:{model:'nano-banana-2',unit:'image',quantity:1}}});
    let polls=0;
    adapter.collect=async()=>{polls++;return {ok:true,data:png};};
    capabilities.persistCapabilityResult=async()=>{throw new Error('Injected collected storage failure');};
    try{
        const failed=await jobs.collect(id);
        assert.equal(failed.ok,false);assert.match(failed.error,/Injected collected storage failure/);
        assert.equal(jobs.get(id).collection_token,null);
        assert.ok(jobs.get(id).result_json);
        const retargeted=await jobs.collect(id,{belongs_to:{kind:'storyboard_frame',shot_id:crypto.randomUUID()}});
        assert.equal(retargeted.status,409);assert.equal(polls,1);
        capabilities.persistCapabilityResult=oldPersist;
        const delivered=await jobs.collect(id);
        assert.equal(delivered.ok,true,delivered.error);assert.equal(polls,1);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,1);
        assert.equal((await jobs.collect(id)).already,'completed');
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,1);
    }finally{adapter.collect=oldCollect;capabilities.persistCapabilityResult=oldPersist;}
});
test('a captured storyboard frame cannot be retargeted to a sequence leg by belongs_to or metadata patch',async()=>{
    const f=fixture(),adapter=providers.get('muapi'),oldCollect=adapter.collect;
    const id=jobs.record({provider:'muapi',capability:'image',requestId:'kind-binding-'+f.project,projectId:f.project,shotId:f.shot,meta:{storyboard_frame:{shot_id:f.shot,width:32,height:18}}});
    let polls=0;adapter.collect=async()=>{polls++;return {ok:true,data:png};};
    const sequence={sequence_id:crypto.randomUUID(),from:'1A',to:'1B',from_shot_id:f.shot};
    try{
        const retargeted=await jobs.collect(id,{belongs_to:sequence,metaPatch:sequence});
        assert.equal(retargeted.status,409,'captured PNG frame was filed as a sequence video');
        assert.equal(polls,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE project_id=?').get(f.project).n,0);
        const combined=await jobs.collect(id,{belongs_to:{kind:'storyboard_frame',shot_id:f.shot,...sequence},metaPatch:sequence});
        assert.equal(combined.status,409);assert.equal(polls,0);
        const patchOnly=await jobs.collect(id,{metaPatch:sequence});
        assert.equal(patchOnly.status,409);assert.equal(polls,0);
        const filed=await jobs.collect(id);
        assert.equal(filed.ok,true,filed.error);assert.equal(filed.frame.shot_id,f.shot);assert.equal(polls,1);
    }finally{adapter.collect=oldCollect;}
});
test('an accepted prefix followed by a refused item recovers its receipt and freshly reviews only the remaining item',async()=>{
    const f=fixture(),oldFetch=global.fetch,character=crypto.randomUUID(),voice=crypto.randomUUID();
    db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({voice:'elevenlabs'}),f.project);
    db.prepare('INSERT INTO film_characters(id,project_id,name) VALUES(?,?,?)').run(character,f.project,'MANNY');
    db.prepare('INSERT INTO film_voice_profiles(id,project_id,character_id,name,tts_model) VALUES(?,?,?,?,?)').run(voice,f.project,character,'Mock cast voice','eleven_multilingual_v2');
    db.prepare('UPDATE film_shots SET scene_card_yaml=? WHERE id=?').run(JSON.stringify({action:'Review accepted prefix',dialogue:[{character:'MANNY',line:'Accepted prefix fixture A'},{character:'MANNY',line:'Remaining refused fixture B'}]}),f.shot);
    const route=`/shots/${f.shot}/pipeline/run`,body={only_steps:['voice']};
    const lines=['Accepted prefix fixture A','Remaining refused fixture B'];
    const posts=[];let refuseSecond=true;
    global.fetch=async(url,opts={})=>{
        assert.equal(opts.method,'POST');assert.match(String(url),/api\.elevenlabs\.io/);
        const sent=JSON.parse(opts.body);posts.push(sent.text);
        if(sent.text===lines[1]&&refuseSecond)return {ok:false,status:400,json:async()=>({detail:'Injected refusal for remaining item'}),text:async()=>'{"detail":"Injected refusal for remaining item"}'};
        return {ok:true,status:200,headers:{get:name=>name==='content-type'?'audio/pcm':null},arrayBuffer:async()=>Buffer.alloc(960)};
    };
    try{
        const plan=await require('../lib/final-pipeline-request-plans').preparePipelineRequests({path:route,body});
        const failed=await pipelineRequest(route,{...body,final_request_approvals:await Promise.all(plan.items.map(approved))});
        assert.equal(failed.body.status,'failed');assert.equal(posts.length,2);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,1);
        assert.ok(failed.body.next_recovery,'accepted prefix receipt was discarded because the last item failed');
        const recovered=await pipelineRequest(failed.body.next_recovery.path);
        assert.equal(recovered.body.status,'awaiting_review',JSON.stringify(recovered));assert.equal(posts.length,2);
        const state=JSON.parse(db.prepare('SELECT params FROM film_pipeline_runs WHERE id=?').get(failed.body.run_id).params).final_pipeline;
        assert.deepEqual(state.completed_items[f.shot+':voice'],[0]);assert.equal(state.completed.includes(f.shot+':voice'),false);
        const remaining=await require('../lib/final-pipeline-request-plans').preparePipelineRequests(recovered.body.next_review);
        assert.equal(remaining.items.length,1);assert.equal(remaining.items[0].provenance.item_index,1);
        refuseSecond=false;
        const completed=await pipelineRequest(recovered.body.next_review.path,{final_request_approvals:await Promise.all(remaining.items.map(approved))});
        assert.equal(completed.body.status,'complete',JSON.stringify(completed));assert.equal(posts.length,3);
        assert.equal(posts.filter(p=>p===lines[0]).length,1,'fresh resume regenerated the delivered prefix');
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,2);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n,2);
    }finally{global.fetch=oldFetch;}
});
test('synchronous accepted usage survives ledger failure and completed-job retry',async()=>{
    const f=fixture(),oldFetch=global.fetch,oldPrepare=db.prepare,character=crypto.randomUUID();
    db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({voice:'elevenlabs'}),f.project);
    db.prepare('INSERT INTO film_characters(id,project_id,name) VALUES(?,?,?)').run(character,f.project,'MANNY');
    db.prepare('INSERT INTO film_voice_profiles(id,project_id,character_id,name,tts_model) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),f.project,character,'Sync mock voice','eleven_multilingual_v2');
    db.prepare('UPDATE film_shots SET scene_card_yaml=? WHERE id=?').run(JSON.stringify({action:'Sync usage recovery',dialogue:[{character:'MANNY',line:'One accepted synchronous line'}]}),f.shot);
    let posts=0;global.fetch=async(url,opts={})=>{assert.equal(opts.method,'POST');posts++;return {ok:true,status:200,headers:{get:name=>name==='content-type'?'audio/pcm':null},arrayBuffer:async()=>Buffer.alloc(960)};};
    try{
        const route=`/shots/${f.shot}/pipeline/run`,body={only_steps:['voice']};
        const plan=await require('../lib/final-pipeline-request-plans').preparePipelineRequests({path:route,body});
        const tokens=await Promise.all(plan.items.map(approved));
        db.prepare=function(sql){if(sql.includes('INSERT INTO film_usage_events'))return {run(){throw new Error('Injected synchronous usage write failure');}};return oldPrepare.call(this,sql);};
        const delivered=await pipelineRequest(route,{...body,final_request_approvals:tokens});
        assert.equal(delivered.body.status,'complete',JSON.stringify(delivered));assert.equal(posts,1);
        const job=db.prepare('SELECT * FROM film_generation_jobs WHERE project_id=?').get(f.project);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n,0);
        db.prepare=oldPrepare;
        const retry=await jobs.collect(job.id);assert.equal(retry.ok,true,retry.error);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n,1,'completed sync receipt lost its meter plan');
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE project_id=?').get(f.project).n,1);assert.equal(posts,1);
        // Historical rows without a meter plan reconcile it from the actual retained receipt.
        const metadata=JSON.parse(jobs.get(job.id).meta);delete metadata.meter;
        db.prepare('UPDATE film_generation_jobs SET meta=? WHERE id=?').run(JSON.stringify(metadata),job.id);
        await jobs.collect(tokens[0].id);assert.ok(JSON.parse(jobs.get(job.id).meta).meter);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n,1);
    }finally{global.fetch=oldFetch;db.prepare=oldPrepare;}
});
test('ordinary completed frames recover by job and review receipts after interrupted filing without duplicating filed bytes',async()=>{
    const oldFetch=global.fetch;let posts=0;
    global.fetch=async(url,opts={})=>{if(opts.method==='POST'){posts++;return {ok:true,json:async()=>({request_id:'ordinary-'+posts})};}if(String(url).includes('/predictions/'))return {ok:true,json:async()=>({status:'completed',outputs:['https://mock.invalid/ordinary.png']})};return {ok:true,arrayBuffer:async()=>png};};
    try{
        for(const byReview of [false,true]){
            const f=fixture(),payload={prompt:'Interrupted ordinary frame '+f.project,model:'nano-banana-2'};
            const token=await approved({provider:'muapi',capability:'image',payload,provenance:{project_id:f.project,shot_id:f.shot}});
            const generated=await reviews.runWithApprovals([token],()=>providers.resolve('image',{image:'muapi',__project_id:f.project,__shot_id:f.shot}).generate('image',payload,{jobMeta:{storyboard_frame:{shot_id:f.shot,width:32,height:18}}}));
            assert.equal(generated.ok,true,generated.error);assert.equal(jobs.get(generated.job_id).status,'completed');
            const delivered=await jobs.collect(byReview?token.id:generated.job_id);
            assert.equal(delivered.ok,true,delivered.error);assert.equal(delivered.frame.shot_id,f.shot);
            assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,1);
            assert.equal((await jobs.collect(token.id)).already,'completed');
            assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,1);
        }
        const f=fixture(),payload={prompt:'Already filed original frame '+f.project,model:'nano-banana-2'};
        const token=await approved({provider:'muapi',capability:'image',payload,provenance:{project_id:f.project,shot_id:f.shot}});
        const generated=await reviews.runWithApprovals([token],()=>providers.resolve('image',{image:'muapi',__project_id:f.project,__shot_id:f.shot}).generate('image',payload,{jobMeta:{storyboard_frame:{shot_id:f.shot,width:32,height:18}}}));
        const file=path.join(process.env.FILM_DATA_DIR,'live-original-'+f.project+'.png');fs.writeFileSync(file,png);
        const assetId=crypto.randomUUID();db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_name,file_path,version,width,height,metadata) VALUES(?,?,?,'storyboard',?,?,1,32,18,?)").run(assetId,f.project,f.shot,path.basename(file),file,JSON.stringify({provider:'muapi',provider_model:'nano-banana-2'}));
        db.prepare('UPDATE film_shots SET current_frame_version=1 WHERE id=?').run(f.shot);
        const adopted=await jobs.collect(generated.job_id);assert.equal(adopted.ok,true,adopted.error);assert.equal(adopted.asset_id,assetId);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,1);
        assert.equal(db.prepare('SELECT current_frame_version FROM film_shots WHERE id=?').get(f.shot).current_frame_version,1);
        assert.equal(posts,3);
    }finally{global.fetch=oldFetch;}
});
test('retained metering shares native billing tiers and charges with the approved estimate',()=>{
    const price=require('../lib/provider-pricing').priceUsage;
    const cases=[
        {provider:'google',capability:'image',model:'gemini-3.1-flash-image',body:{response_format:{image_size:'4K'}}},
        {provider:'openai',capability:'image',model:'gpt-image-1',body:{quality:'high',n:2}},
        {provider:'higgsfield',capability:'image',model:'soul-standard',body:{batch_size:4}},
        {provider:'seedance',capability:'post',model:'seedance-2.5-video-edit-4k',body:{duration:5},metadata:{workflow:'video-edit',resolution:'4k',source_seconds:30}},
        {provider:'runway',capability:'video',model:'seedance2_5',body:{model:'seedance2_5',duration:4,ratio:'1280:720'}},
        {provider:'runway',capability:'video',model:'multi_shot_video',body:{duration:6,ratio:'1920:1080'},metadata:{mode:'multi_shot_video'}},
    ];
    for(const snapshot of cases){
        const quote=reviews.quoteFor(snapshot),meter=jobs.meterPlan(snapshot.provider,snapshot.capability,{duration_s:999,model:'wrong-outer-model'},snapshot,null);
        assert.ok(meter,snapshot.provider);assert.equal(meter.model,quote.billing.model);assert.equal(meter.quantity,quote.billing.quantity);
        assert.equal(price({...snapshot,...meter}).amount_usd,quote.amount,snapshot.provider);assert.equal(meter.provider_confirmed,false);assert.equal(meter.estimated,true);
    }
    const unknown={provider:'seedance',capability:'post',model:'seedance-2.5-video-edit-4k',body:{duration:5},metadata:{workflow:'video-edit',resolution:'4k',source_seconds:null}};
    assert.equal(jobs.meterPlan(unknown.provider,unknown.capability,{duration_s:999},unknown,null),null);
    const actual={provider:'meshy',capability:'image',model:'gpt-image-2',body:{prompt:'Accepted image'}};
    const confirmed=jobs.meterPlan('meshy','image',{},actual,{ok:true,provider_model:'gpt-image-2',native_charged:17});
    assert.equal(confirmed.native_charged,17);assert.equal(confirmed.provider_confirmed,true);
});
test('approved native text edits meter the sent characters in the initial and retained receipt',async()=>{
    const f=fixture(),oldFetch=global.fetch,payload={text:'Original short line',model:'eleven_multilingual_v2'};
    const snapshot=await require('../lib/final-provider-request').resolveFinalRequest('elevenlabs','voice',payload);
    const edited={...payload,final_request_body:{...snapshot.body,text:'The distinctly longer line approved in the final native request'}};
    const token=await approved({provider:'elevenlabs',capability:'voice',payload:edited,provenance:{project_id:f.project}});
    global.fetch=async(url,opts)=>{assert.equal(JSON.parse(opts.body).text,edited.final_request_body.text);return {ok:true,status:200,headers:{get:()=>null},arrayBuffer:async()=>Buffer.alloc(960)};};
    try{
        const result=await reviews.runWithApprovals([token],()=>providers.resolve('voice',{voice:'elevenlabs',__project_id:f.project}).generate('voice',edited));
        assert.equal(result.ok,true,result.error);
        assert.equal(db.prepare('SELECT quantity FROM film_usage_events WHERE project_id=?').get(f.project).quantity,edited.final_request_body.text.length);
        assert.equal(JSON.parse(jobs.get(result.job_id).meta).meter.quantity,edited.final_request_body.text.length);
    }finally{global.fetch=oldFetch;}
});
async function completedFrameFixture(){
    const f=fixture(),payload={prompt:'Frame continuity '+f.project,model:'nano-banana-2'},token=await approved({provider:'muapi',capability:'image',payload,provenance:{project_id:f.project,shot_id:f.shot}});
    const result=await reviews.runWithApprovals([token],()=>providers.resolve('image',{image:'muapi',__project_id:f.project,__shot_id:f.shot}).generate('image',payload,{jobMeta:{storyboard_frame:{shot_id:f.shot,width:32,height:18}}}));
    assert.equal(result.ok,true,result.error);return {...f,result,token};
}
function insertedFrame(f,bytes,metadata={}){
    const id=crypto.randomUUID(),file=path.join(process.env.FILM_DATA_DIR,id+'.png');fs.writeFileSync(file,bytes);
    db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_name,file_path,version,width,height,provider,provider_model,metadata) VALUES(?,?,?,'storyboard',?,?,1,32,18,'muapi','nano-banana-2',?)").run(id,f.project,f.shot,path.basename(file),file,JSON.stringify(metadata));
    db.prepare('UPDATE film_shots SET current_frame_version=1 WHERE id=?').run(f.shot);return {id,file};
}
test('an ambiguous conformed live frame blocks receipt replay without creating another version',async()=>{
    const oldFetch=global.fetch;global.fetch=async(url,opts={})=>opts.method==='POST'?{ok:true,json:async()=>({request_id:'ambiguous-'+crypto.randomUUID()})}:String(url).includes('/predictions/')?{ok:true,json:async()=>({status:'completed',outputs:['https://mock.invalid/frame.png']})}:{ok:true,arrayBuffer:async()=>png};
    try{
        const f=await completedFrameFixture(),saved=insertedFrame(f,Buffer.from('Conformed bytes differ from retained native raster'));
        const blocked=await jobs.collect(f.result.job_id);assert.equal(blocked.ok,false);assert.match(blocked.error,/identity|reconciliation/);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,1);
        assert.equal(db.prepare('SELECT current_frame_version FROM film_shots WHERE id=?').get(f.shot).current_frame_version,1);
        assert.deepEqual(fs.readFileSync(saved.file),Buffer.from('Conformed bytes differ from retained native raster'));
    }finally{global.fetch=oldFetch;}
});
test('a late captured frame is filed as history while a newer known job remains selected',async()=>{
    const oldFetch=global.fetch;global.fetch=async(url,opts={})=>opts.method==='POST'?{ok:true,json:async()=>({request_id:'history-'+crypto.randomUUID()})}:String(url).includes('/predictions/')?{ok:true,json:async()=>({status:'completed',outputs:['https://mock.invalid/frame.png']})}:{ok:true,arrayBuffer:async()=>png};
    try{
        const f=await completedFrameFixture(),newBytes=require('../lib/png-raster').encode({width:32,height:18,pixels:Buffer.alloc(32*18*4,81)}),saved=insertedFrame(f,newBytes,{generation_job_id:crypto.randomUUID()});
        const recovered=await jobs.collect(f.result.job_id);assert.equal(recovered.ok,true,recovered.error);assert.equal(recovered.frame.historical,true);assert.match(recovered.frame.filed,/newer selected frame is preserved/);
        assert.equal(db.prepare('SELECT current_frame_version FROM film_shots WHERE id=?').get(f.shot).current_frame_version,1);
        assert.deepEqual(fs.readFileSync(saved.file),newBytes);assert.deepEqual(fs.readFileSync(recovered.stored),png);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,2);
        assert.equal((await jobs.collect(f.token.id)).already,'completed');assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,2);
    }finally{global.fetch=oldFetch;}
});
function recoveryRun(f,{local=false,receipts=['one'],items=[0],expected=1}={}){
    const id=crypto.randomUUID(),key=f.shot+':keyframe',state={version:1,body:{},tasks:[{shot_id:f.shot,step_id:'keyframe',key},...(local?[{shot_id:f.shot,step_id:'assembly',key:'film:assembly',local:true}]:[])],completed:[],failed:[{step_id:key}],skipped:[],recovery:[{step_id:key,receipts,items,expected_items:expected}],awaiting:false};
    db.prepare("INSERT INTO film_pipeline_runs(id,project_id,shot_id,run_type,status,params) VALUES(?,?,?,'shot','failed',?)").run(id,f.project,f.shot,JSON.stringify({final_pipeline:state}));return {id,key,state};
}
test('pipeline recovery stops after cancellation during an awaited receipt',async()=>{
    const f=fixture(),run=recoveryRun(f,{receipts:['one','two'],items:[0,1],expected:2}),oldCollect=jobs.collect;
    const calls=[];let release,entered;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    jobs.collect=async id=>{calls.push(id);if(id==='one'){entered();await gate;}return {ok:true};};
    try{
        const request=pipelineRequest(`/pipeline/${run.id}/recover`);await ready;
        db.prepare("UPDATE film_pipeline_runs SET status='cancelled' WHERE id=?").run(run.id);release();
        const cancelled=await request;assert.equal(cancelled.body.status,'cancelled');assert.deepEqual(calls,['one']);
        const saved=JSON.parse(db.prepare('SELECT params FROM film_pipeline_runs WHERE id=?').get(run.id).params).final_pipeline;
        assert.deepEqual(saved.completed,[]);assert.equal(saved.recovery.length,1);
    }finally{release();jobs.collect=oldCollect;}
});
test('a paused accepted-result recovery can be explicitly reclaimed without a paid resume',async()=>{
    const f=fixture(),run=recoveryRun(f),oldCollect=jobs.collect;let release,entered,calls=0;
    const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    jobs.collect=async()=>{if(++calls===1){entered();await gate;}return {ok:true};};
    try{
        const first=pipelineRequest(`/pipeline/${run.id}/recover`);await ready;
        db.prepare("UPDATE film_pipeline_runs SET status='paused' WHERE id=?").run(run.id);release();
        const paused=await first;assert.equal(paused.body.status,'paused');assert.equal(calls,1);
        const retried=await pipelineRequest(`/pipeline/${run.id}/recover`);assert.equal(retried.body.status,'complete',JSON.stringify(retried));assert.equal(calls,2);
    }finally{release();jobs.collect=oldCollect;}
});
test('an expired pipeline recovery owner cannot overwrite a newer completed attempt',async()=>{
    const f=fixture(),run=recoveryRun(f),oldCollect=jobs.collect;let release,entered,calls=0;
    const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    jobs.collect=async()=>{if(++calls===1){entered();await gate;return {ok:false,pending:true,error:'Old collection owner expired'};}return {ok:true};};
    try{
        const first=pipelineRequest(`/pipeline/${run.id}/recover`);await ready;
        const params=JSON.parse(db.prepare('SELECT params FROM film_pipeline_runs WHERE id=?').get(run.id).params);params.final_pipeline.recovery_attempt.started_at=Date.now()-21*60*1000;
        db.prepare('UPDATE film_pipeline_runs SET params=? WHERE id=?').run(JSON.stringify(params),run.id);
        const latest=await pipelineRequest(`/pipeline/${run.id}/recover`);assert.equal(latest.body.status,'complete');release();
        const stale=await first;assert.equal(stale.body.status,'complete');
        const saved=db.prepare('SELECT status,params FROM film_pipeline_runs WHERE id=?').get(run.id);assert.equal(saved.status,'complete');
        assert.deepEqual(JSON.parse(saved.params).final_pipeline.completed,[run.key]);
    }finally{release();jobs.collect=oldCollect;}
});
test('accepted-result recovery completes a remaining local pipeline tail',async()=>{
    const f=fixture(),run=recoveryRun(f,{local:true}),oldCollect=jobs.collect,pipeline=require('../routes/pipeline'),oldExecute=pipeline.executeStep,calls=[];
    jobs.collect=async()=>({ok:true});pipeline.executeStep=async(step,shot,scene,project,opts)=>{calls.push(step);assert.equal(step,'assembly');assert.equal(opts?.preview,undefined);return {ok:true};};
    try{
        const completed=await pipelineRequest(`/pipeline/${run.id}/recover`);assert.equal(completed.body.status,'complete',JSON.stringify(completed));assert.deepEqual(calls,['assembly']);
        const saved=JSON.parse(db.prepare('SELECT params FROM film_pipeline_runs WHERE id=?').get(run.id).params).final_pipeline;assert.deepEqual(saved.completed,[run.key,'film:assembly']);
    }finally{jobs.collect=oldCollect;pipeline.executeStep=oldExecute;}
});
test('an expired collection lease is recoverable while a fresh lease blocks another owner',async()=>{
    const f=fixture(),adapter=providers.get('muapi'),oldCollect=adapter.collect;
    const id=jobs.record({provider:'muapi',capability:'image',requestId:'lease-'+f.project,projectId:f.project});
    let polls=0;adapter.collect=async()=>{polls++;return {ok:true,data:png};};
    try{
        db.prepare('UPDATE film_generation_jobs SET collection_token=?,collection_claimed_at=? WHERE id=?').run('active-owner',Date.now(),id);
        assert.equal((await jobs.collect(id)).status,202);assert.equal(polls,0);
        db.prepare('UPDATE film_generation_jobs SET collection_claimed_at=? WHERE id=?').run(Date.now()-21*60*1000,id);
        assert.equal((await jobs.collect(id)).ok,true);assert.equal(polls,1);
        assert.equal(jobs.get(id).collection_token,null);
    }finally{adapter.collect=oldCollect;}
});
test('a legacy handle captures its first named target before concurrent callers can rebind it',async()=>{
    const f=fixture(),adapter=providers.get('muapi'),oldCollect=adapter.collect;
    const id=jobs.record({provider:'muapi',capability:'image',requestId:'legacy-target-'+f.project,projectId:f.project,shotId:f.shot});
    let release,polls=0;const gate=new Promise(resolve=>{release=resolve;});
    adapter.collect=async()=>{polls++;await gate;return {ok:true,data:png};};
    try{
        const first=jobs.collect(id,{belongs_to:{kind:'storyboard_frame',shot_id:f.shot}});
        const other=await jobs.collect(id,{belongs_to:{kind:'storyboard_frame',shot_id:crypto.randomUUID()}});
        assert.equal(other.status,409);assert.equal(polls,1);
        release();assert.equal((await first).ok,true);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,1);
    }finally{release();adapter.collect=oldCollect;}
});
test('delivery is retained after a meter failure and ledger retry does not repeat storage',async()=>{
    const f=fixture(),adapter=providers.get('muapi'),oldCollect=adapter.collect,meter=require('../lib/usage-meter'),oldMeter=meter.recordUsage;
    const id=jobs.record({provider:'muapi',capability:'image',requestId:'meter-'+f.project,projectId:f.project,meta:{meter:{model:'nano-banana-2',unit:'image',quantity:1}}});
    let polls=0;adapter.collect=async()=>{polls++;return {ok:true,data:png};};
    meter.recordUsage=()=>{throw new Error('Injected meter failure');};
    try{
        const delivered=await jobs.collect(id);assert.equal(delivered.ok,true);assert.equal(delivered.metering_pending,true);
        const stat=fs.statSync(delivered.stored);
        meter.recordUsage=oldMeter;
        const retried=await jobs.collect(id);assert.equal(retried.already,'completed');assert.equal(polls,1);
        assert.equal(fs.statSync(delivered.stored).mtimeMs,stat.mtimeMs);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n,1);
        await jobs.collect(id);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n,1);
    }finally{adapter.collect=oldCollect;meter.recordUsage=oldMeter;}
});
test('interrupted settlement adopts the one filed frame and reuses its usage receipt',async()=>{
    const f=fixture(),adapter=providers.get('muapi'),oldCollect=adapter.collect,oldPrepare=db.prepare;
    const id=jobs.record({provider:'muapi',capability:'image',requestId:'settlement-'+f.project,projectId:f.project,shotId:f.shot,meta:{storyboard_frame:{shot_id:f.shot,width:32,height:18},meter:{model:'nano-banana-2',unit:'image',quantity:1}}});
    let polls=0;adapter.collect=async()=>{polls++;return {ok:true,data:png};};
    db.prepare=function(sql){
        if(sql.includes("settled_at=datetime('now'),delivered_json=?"))return {run(){throw new Error('Injected delivery settlement failure');}};
        return oldPrepare.call(this,sql);
    };
    try{
        await assert.rejects(jobs.collect(id),/Injected delivery settlement failure/);
        const asset=db.prepare('SELECT id FROM film_assets WHERE shot_id=?').get(f.shot);
        assert.ok(asset);assert.equal(jobs.get(id).collection_token,null);
        db.prepare=oldPrepare;
        const recovered=await jobs.collect(id);
        assert.equal(recovered.ok,true,recovered.error);assert.equal(recovered.asset_id,asset.id);assert.equal(polls,1);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n,1);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n,1);
    }finally{adapter.collect=oldCollect;db.prepare=oldPrepare;}
});
test('preview and cancelled reviews cannot be reconciled as accepted work',async()=>{
    const f=fixture(),preview=await reviews.store().preview({provider:'muapi',capability:'image',payload:{prompt:'Never accepted',model:'nano-banana-2'},provenance:{project_id:f.project}});
    assert.equal((await jobs.collect(preview.id)).status,404);
    reviews.store().cancel(preview.id);
    assert.equal((await jobs.collect(preview.id)).status,404);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM film_generation_jobs WHERE project_id=?').get(f.project).n,0);
});
test('receipt dedup preserves unrelated ledger sources and schema migration is repeatable',()=>{
    const f=fixture(),meter=require('../lib/usage-meter'),entry={provider:'muapi',capability:'image',model:'nano-banana-2',unit:'image',quantity:1,projectId:f.project};
    const receipt=meter.recordUsage({...entry,sourceRef:'generation-job:ledger-'+f.project});
    assert.equal(meter.recordUsage({...entry,sourceRef:'generation-job:ledger-'+f.project}).id,receipt.id);
    meter.recordUsage({...entry,sourceRef:'historical-source'});
    assert.throws(()=>meter.recordUsage({...entry,sourceRef:'historical-source'}),/UNIQUE/);
    meter.recordUsage(entry);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM film_usage_events WHERE project_id=?').get(f.project).n,3);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM film_cost_entries WHERE project_id=?').get(f.project).n,3);
    require('../db/schema').ensureSchema();
    const columns=db.prepare('PRAGMA table_info(film_generation_jobs)').all();
    assert.equal(columns.filter(c=>c.name==='collection_token').length,1);
});
test.after(() => { db.close(); fs.rmSync(process.env.FILM_DATA_DIR, { recursive: true, force: true }); });
