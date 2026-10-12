// Every generation route the planner cannot prepare is reached by the bridge's
// fallback POST, which runs the route for real. Set-based over the inventory
// (src/components/FinalRequestReview/route-review-paths.json): with keys present
// and the project pinned to manual vendors, no route may reach a vendor, and a
// route that answers with a review (428) may leave no job, asset or usage row.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),Module=require('module'),{Readable}=require('stream');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-manual-routes-'));
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const manual=require('../lib/manual-generation');
// Keys present for every manual vendor: the realistic case for an existing install.
require('../lib/providers/credentials').getCredential=id=>({apiKey:manual.MANUAL_PROVIDERS.has(id)?'mock-only':null,meta:{}});
const serverPath=path.join(__dirname,'../server.js'),compiled=new Module(serverPath,module);compiled.filename=serverPath;compiled.paths=Module._nodeModulePaths(path.dirname(serverPath));
compiled._compile(fs.readFileSync(serverPath,'utf8').replace(/\nstart\(\);\s*$/,'\nmodule.exports={server};'),serverPath);
const handler=compiled.exports.server.listeners('request')[0];
let callCount=0;
function call(method,url,body){return new Promise((resolve,reject)=>{
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.socket={remoteAddress:'127.0.0.'+(++callCount%250+1)};req.method=method;req.url='/film'+url;req.headers={'content-type':'application/json'};
 let chunks='';const timer=setTimeout(()=>resolve({status:'timeout',text:chunks}),15000);
 const res={statusCode:200,headersSent:false,writableEnded:false,setHeader(){},getHeader(){},on(){},once(){},flushHeaders(){},writeHead(code){this.statusCode=code;this.headersSent=true;return this;},write(d){chunks+=String(d);return true;},end(d){if(d)chunks+=String(d);this.writableEnded=true;clearTimeout(timer);resolve({status:this.statusCode,text:chunks});}};
 Promise.resolve(handler(req,res)).catch(e=>{clearTimeout(timer);resolve({status:'threw',text:e.message});});
});}
const SIDE_EFFECT_TABLES=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%job%' OR name LIKE '%asset%' OR name LIKE '%usage%' OR name LIKE '%transport_receipt%')").all().map(r=>r.name);
const counts=()=>Object.fromEntries(SIDE_EFFECT_TABLES.map(t=>[t,db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n]));
const inventory=JSON.parse(fs.readFileSync(path.join(__dirname,'../../src/components/FinalRequestReview/route-review-paths.json'),'utf8'));

test('no route-reviewed generation path reaches a vendor or leaves a row behind its review',async()=>{
 assert.ok(inventory.route_reviewed.length>=60,'inventory present');
 const demo=await call('POST','/projects/demo',{});const project=JSON.parse(demo.text).project_id;assert.ok(project,'demo project');
 db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({image:'muapi',video:'runway',voice:'elevenlabs',sfx:'elevenlabs',ambient:'elevenlabs',music:'elevenlabs',model3d:'meshy',post:'magnific',world:'worldlabs'}),project);
 const first=(table,where='project_id=?')=>{try{return db.prepare(`SELECT ${table.includes(' s ')?'s.id':'id'} AS id FROM ${table} WHERE ${where} LIMIT 1`).get(project)?.id;}catch(_){return null;}};
 const ids={projects:project,shots:first('film_shots s JOIN film_scenes sc ON s.scene_id=sc.id','sc.project_id=?'),scenes:first('film_scenes'),characters:first('film_characters'),locations:first('film_locations'),props:first('film_props'),sequences:first('film_sequences')};
 const concrete=p=>p.split('/').map((seg,i,all)=>seg==='ID'?(ids[all[i-1]]||'missing'):seg.replace(/ID/g,'x1')).join('/');
 const outbound=[];const original=global.fetch;
 global.fetch=async(url)=>{outbound.push(String(url));return new Response(JSON.stringify({error:'offline in test'}),{status:503,headers:{'content-type':'application/json'}});};
 const statuses={};const offenders=[];
 try{
  for(const p of inventory.route_reviewed){
   const url=concrete(p),method=/\/stations\//.test(p)?'PUT':'POST';
   const before=counts(),sent=outbound.length;
   const body={project_id:project,prompt:'A lighthouse at dusk',text:'Hello there',...(/ambient/.test(p)?{model:'eleven_text_to_sound_v2'}:/music/.test(p)?{model:'music_v2'}:{})};
   const out=await call(method,url,body);
   statuses[out.status]=(statuses[out.status]||0)+1;if(process.env.ROUTE_DEBUG)console.log('ROUTE',out.status,method,p,out.text.slice(0,process.env.ROUTE_DEBUG==='full'?900:90));
   const after=counts(),grew=Object.keys(after).filter(t=>after[t]!==before[t]);
   const vendor=outbound.slice(sent).filter(u=>!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u));
   // Local work (an ffmpeg stitch, an import) may write its own rows; a route that
   // stops at a manual vendor's review may not leave any behind.
   if(vendor.length||(out.status===428&&grew.length)||out.status==='timeout')offenders.push({path:p,url,status:out.status,vendor,grew,text:out.text.slice(0,160)});
  }
 }finally{global.fetch=original;}
 console.log('route statuses',JSON.stringify(statuses),'paths',inventory.route_reviewed.length);
 assert.deepEqual(offenders,[]);
});
test.after(()=>{compiled.exports.server.close();db.close();fs.rmSync(process.env.FILM_DATA_DIR,{recursive:true,force:true});});
