const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),Module=require('module'),{Readable}=require('stream');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-final-3d-world-'));
const {db}=require('../db/database');require('../db/schema').ensureSchema();
require('../lib/providers/credentials').getCredential=()=>({apiKey:'mock-only',meta:{}});
const serverPath=path.join(__dirname,'../server.js'),compiled=new Module(serverPath,module);compiled.filename=serverPath;compiled.paths=Module._nodeModulePaths(path.dirname(serverPath));
compiled._compile(fs.readFileSync(serverPath,'utf8').replace(/\nstart\(\);\s*$/,'\nmodule.exports={server};'),serverPath);
const handler=compiled.exports.server.listeners('request')[0];
async function request(url,body){return new Promise((resolve,reject)=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.socket={remoteAddress:'127.0.0.1'};req.method='POST';req.url='/film'+url;req.headers={'content-type':'application/json'};const res={statusCode:200,headersSent:false,setHeader(){},writeHead(code){this.statusCode=code;this.headersSent=true;},end(data){resolve({status:this.statusCode,body:JSON.parse(String(data))});}};Promise.resolve(handler(req,res)).catch(reject);});}
const project=crypto.randomUUID(),character=crypto.randomUUID();
db.prepare('INSERT INTO film_projects(id,title,provider_config) VALUES(?,?,?)').run(project,'Exact 3D fixture',JSON.stringify({model3d:'meshy',world:'worldlabs'}));
db.prepare('INSERT INTO film_characters(id,project_id,name,appearance_prompt) VALUES(?,?,?,?)').run(character,project,'Fixture','A blue robot');
const worlds=require('../lib/worlds'),world=worlds.createWorld(db,{projectId:project,name:'Fixture world'}),version=worlds.newVersion(db,world.id,{model:'marble-1.0-draft'});
const pixels=Buffer.alloc(64*64*4,255),png=require('../lib/png-raster').encode({width:64,height:64,pixels}),uri='data:image/png;base64,'+png.toString('base64');
for(const example of [
 {name:'Meshy text3D',route:`/characters/${character}/model/generate`,body:{provider:'meshy',model:'meshy-6-lite'}},
 {name:'Meshy image3D',route:`/characters/${character}/model/from-image`,body:{provider:'meshy',model:'meshy-7.1',init_image:uri}},
 {name:'WorldLabs world',route:`/world-versions/${version.id}/generate`,body:{prompt:'Exact world prompt',images:[{data:png.toString('base64'),extension:'png'}]}}
])test(`${example.name} actual HTTP route sends only approved frozen native request`,async()=>{
 const original=global.fetch,posts=[];global.fetch=async(url,opts={})=>{if(opts.method==='POST'){posts.push({endpoint:String(url),body:JSON.parse(opts.body)});return{ok:false,status:400,json:async()=>({error:'mock stops at exact native POST'}),text:async()=>'{"error":"mock stops at exact native POST"}'};}return{ok:true,status:200,json:async()=>({credits:100})};};
 try{
  const prepared=await request('/final-request-review/prepare',{path:example.route,body:example.body});assert.equal(prepared.status,200,prepared.body.error);assert.equal(posts.length,0);
  const review=prepared.body.reviews[0],store=require('../lib/final-request-review').store();
  for(const ref of review.snapshot.references)assert.equal(ref.sha256,crypto.createHash('sha256').update(Buffer.from(ref.data.split(',')[1],'base64')).digest('hex'));
  const before=db.prepare('SELECT COUNT(*) n FROM film_3d_jobs').get().n;
  const rejected=await request(example.route,example.body);assert.equal(rejected.status,428,rejected.body.error);assert.equal(posts.length,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM film_3d_jobs').get().n,before);
  const token=store.approve(review.id,{fingerprint:review.fingerprint,human_confirmed:true,cost_unknown_ack:true});
  const sent=await request(example.route,{...example.body,final_request_approvals:[token]});assert.equal(posts.length,1,sent.body.error);assert.equal(posts[0].endpoint,review.snapshot.endpoint);assert.deepEqual(posts[0].body,review.snapshot.body);
  const rows=db.prepare('SELECT COUNT(*) n FROM film_3d_jobs').get().n;
  await request(example.route,{...example.body,final_request_approvals:[token]});assert.equal(posts.length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM film_3d_jobs').get().n,rows);
 }finally{global.fetch=original;}
});
test.after(()=>{compiled.exports.server.close();db.close();fs.rmSync(process.env.FILM_DATA_DIR,{recursive:true,force:true});});
