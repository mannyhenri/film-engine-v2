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
test('native Topaz remains outside supported footage preparation and performs no network call',async()=>{await assert.rejects(prepareFootageRequests({path:`/film/shots/${shot}/post/upscale`,body:{...body,model:'slp-2.6'}}),/Topaz|immutable/);});
test('unsupported native face restoration and grade are refused before preparing or creating jobs',async()=>{
const before=db.prepare('SELECT COUNT(*) n FROM film_post_jobs').get().n;
for(const action of ['face-restore','color-grade']) {await assert.rejects(prepareFootageRequests({path:`/film/shots/${shot}/post/${action}`,body}),/do not support/);const res={writeHead(s){this.status=s;},end(){}};await require('../routes/post-production').handlePostProduction({method:'POST',body},res,['film','shots',shot,'post',action],{});assert.equal(res.status,409);}
assert.equal(db.prepare('SELECT COUNT(*) n FROM film_post_jobs').get().n,before);
});
