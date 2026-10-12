require('../lib/manual-generation').allowSendForTests(); // exercises the dormant API send path
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('fs'), os=require('os'),path=require('path'),crypto=require('crypto');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'final-footage-'));
process.env.MAGNIFIC_API_KEY='mock-only';process.env.SEEDANCE_API_KEY='mock-only';process.env.MUAPI_API_KEY='mock-only';
const {db}=require('../db/database');require('../db/schema').ensureSchema();
require('../lib/providers/credentials').getCredential=()=>({apiKey:'mock-only',meta:{}});
const contract=require('../lib/final-request-review'), {prepareFootageRequests}=require('../lib/final-footage-request-plans');
const project=crypto.randomUUID(),scene=crypto.randomUUID(),shot=crypto.randomUUID(),asset=crypto.randomUUID(), file=path.join(process.env.FILM_DATA_DIR,'fixture.mp4'),bytes=Buffer.from('00000018667479706d703432000000006d70343269736f6d','hex');fs.writeFileSync(file,bytes);
db.prepare('INSERT INTO film_projects(id,title,provider_config) VALUES(?,?,?)').run(project,'Fixture',JSON.stringify({post:'magnific'}));
db.prepare('INSERT INTO film_scenes(id,project_id,scene_number) VALUES(?,?,1)').run(scene,project);
db.prepare('INSERT INTO film_shots(id,scene_id,shot_code) VALUES(?,?,?)').run(shot,scene,'1A');
db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES(?,?,?,'video_raw',?,'fixture.mp4',1)").run(asset,project,shot,file);
require('../lib/ffmpeg').inspectMedia=()=>({ok:true,width:1920,height:1080,durationSeconds:1,fps:24});
const body={asset_id:asset,model:'magnific-video-upscaler-precision',strength:61,target_resolution:'3840x2160'};
test('actual post route uploads frozen reviewed bytes and submits exact Magnific endpoint/body once',async()=>{
const original=global.fetch,sent=[],uploaded=[];global.fetch=async(url,opts)=>{
if(String(url).endsWith('/uploads/request-url'))return {ok:true,json:async()=>({files:[{upload_url:'https://mock.invalid/upload',asset_url:'https://mock.invalid/clip'}]})};
if(opts.method==='PUT'){uploaded.push(Buffer.from(opts.body));return {ok:true};}
sent.push({url:String(url),body:JSON.parse(opts.body)});return {ok:false,status:400,json:async()=>({error:'Mock stops transport'})};};
try{
const plan=await prepareFootageRequests({path:`/film/shots/${shot}/post/upscale`,body});assert.equal(sent.length,0);assert.equal(uploaded.length,0);
const review=await contract.store().preview(plan.items[0]);const approval=contract.store().approve(review.id,{fingerprint:review.fingerprint,human_confirmed:true,cost_unknown_ack:true});
const response=()=>({writeHead(s){this.status=s;},end(b){this.body=JSON.parse(b);}});
const run=()=>contract.runWithApprovals([approval],()=>require('../routes/post-production').handlePostProduction({method:'POST',body},response(),['film','shots',shot,'post','upscale'],{}));
await run();assert.equal(sent.length,1);assert.equal(sent[0].url,review.snapshot.endpoint);assert.deepEqual(sent[0].body,{...review.snapshot.body,video:'https://mock.invalid/clip'});assert.equal(uploaded.length,1);assert.equal(crypto.createHash('sha256').update(uploaded[0]).digest('hex'),review.snapshot.references[0].sha256);
await run();assert.equal(sent.length,1);assert.equal(uploaded.length,1);
}finally{global.fetch=original;}});
test('native Topaz remains outside supported footage preparation and performs no network call',async()=>{await assert.rejects(prepareFootageRequests({path:`/film/shots/${shot}/post/upscale`,body:{...body,model:'slp-2.6'}}),/Topaz|immutable/);});
test('Seedance dedicated upscale actual upload and paid request match approved final body and bytes',async()=>{
const body2={...body,model:'ai-video-upscaler',target_resolution:'2560x1440'},original=global.fetch,sent=[],uploaded=[];
global.fetch=async(url,opts)=>{if(String(url).endsWith('/upload_file')){uploaded.push(Buffer.from(await opts.body.get('file').arrayBuffer()));return {ok:true,json:async()=>({url:'https://mock.invalid/video'})};}sent.push({url:String(url),body:JSON.parse(opts.body)});return {ok:false,status:400,json:async()=>({error:'mock stops'}),text:async()=> 'mock stops'};};
try{const plan=await prepareFootageRequests({path:`/film/shots/${shot}/post/upscale`,body:body2});const review=await contract.store().preview(plan.items[0]);const token=contract.store().approve(review.id,{fingerprint:review.fingerprint,human_confirmed:true,cost_unknown_ack:true});await contract.runWithApprovals([token],()=>require('../routes/post-production').handlePostProduction({method:'POST',body:body2},{writeHead(){},end(value){this.output=value;}},['film','shots',shot,'post','upscale'],{}));assert.equal(sent.length,1);assert.equal(sent[0].url,review.snapshot.endpoint);assert.deepEqual(sent[0].body,{...review.snapshot.body,video_url:'https://mock.invalid/video'});assert.equal(uploaded.length,1);assert.equal(crypto.createHash('sha256').update(uploaded[0]).digest('hex'),review.snapshot.references[0].sha256);
}finally{global.fetch=original;}});
test('unsupported native face restoration and grade are refused before preparing or creating jobs',async()=>{
const before=db.prepare('SELECT COUNT(*) n FROM film_post_jobs').get().n;
for(const action of ['face-restore','color-grade']) {await assert.rejects(prepareFootageRequests({path:`/film/shots/${shot}/post/${action}`,body}),/do not support/);const res={writeHead(s){this.status=s;},end(){}};await require('../routes/post-production').handlePostProduction({method:'POST',body},res,['film','shots',shot,'post',action],{});assert.equal(res.status,409);}
assert.equal(db.prepare('SELECT COUNT(*) n FROM film_post_jobs').get().n,before);
});
test('default selected clip changing after assembly invalidates approval before actual native upload or POST',async()=>{
const reviewBody={...body};delete reviewBody.asset_id;
const assembled=await prepareFootageRequests({path:`/film/shots/${shot}/post/upscale`,body:reviewBody});
const review=await contract.store().preview(assembled.items[0]);const token=contract.store().approve(review.id,{fingerprint:review.fingerprint,human_confirmed:true,cost_unknown_ack:true});
const newer=crypto.randomUUID(),newPath=path.join(process.env.FILM_DATA_DIR,'new-clip.mp4');fs.writeFileSync(newPath,bytes);db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES(?,?,?,'video_raw',?,'new-clip.mp4',2)").run(newer,project,shot,newPath);
assert.equal(require('../routes/post-production').upscaleSource(shot,null).id,newer);
const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('Must reject before network');};
try{const request=require('../routes/post-production').buildPostStepRequest(shot,'upscale',body);let result;try{result=await contract.runWithApprovals([token],()=>request.provider.generate('post',assembled.items[0].payload,{timeout:1000}));}catch(err){assert.match(err.message,/changed|review|stale/i);}
if(result)assert.equal(result.ok,false);assert.equal(calls,0);
}finally{global.fetch=original;db.prepare('DELETE FROM film_assets WHERE id=?').run(newer);}
});
test('cancelled post approval rejects before any native upload or POST',async()=>{
const assembled=await prepareFootageRequests({path:`/film/shots/${shot}/post/upscale`,body});const review=await contract.store().preview(assembled.items[0]);const token=contract.store().approve(review.id,{fingerprint:review.fingerprint,human_confirmed:true,cost_unknown_ack:true});contract.store().cancel(review.id);
const provider=require('../routes/post-production').buildPostStepRequest(shot,'upscale',body).provider,original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('Must reject before network');};
try{let result;try{result=await contract.runWithApprovals([token],()=>provider.generate('post',assembled.items[0].payload,{}));}catch(err){assert.match(err.message,/cancelled|review|approval/i);}if(result)assert.equal(result.ok,false);assert.equal(calls,0);}finally{global.fetch=original;}
});
