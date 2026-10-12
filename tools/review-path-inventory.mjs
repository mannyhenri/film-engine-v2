// Inventory of generation paths the final review gates, and which of them the
// backend planner cannot prepare (they reach the review through the route
// itself instead). Writes src/components/FinalRequestReview/route-review-paths.json.
//   FILM_DATA_DIR=$(mktemp -d) node tools/review-path-inventory.mjs
import fs from 'fs';
import path from 'path';
import {createRequire} from 'module';
import {needsFinalReview} from '../src/components/FinalRequestReview/request-bridge.js';
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=[...walk(path.join(root,'public/legacy')),...walk(path.join(root,'src'))].filter(f=>/\.(js|jsx)$/.test(f)&&!/\.test\./.test(f));
const found=new Set();
for(const file of files)for(const line of fs.readFileSync(file,'utf8').split('\n')){
 for(const m of line.matchAll(/`(\/[^`]*)`/g))found.add(m[1].replace(/\$\{[^}]*\}/g,'ID'));
 for(const m of line.matchAll(/(['"])(\/[a-z0-9_-]+\/?)\1(\s*\+\s*[^'"+]+?\s*\+\s*(['"])[^'"]*\4)+/g))found.add([...m[0].matchAll(/(['"])([^'"]*)\1/g)].map(p=>p[2]).join('ID'));
 for(const m of line.matchAll(/(['"])(\/[a-z][^'"\s]*)\1/g))found.add(m[2]);
}
const concrete=p=>p.split('?')[0].replace(/^\/film(?=\/)/,'').replace(/ID/g,'x1');
const gated=[...found].map(p=>p.split('?')[0]).filter(p=>['POST','PUT'].some(method=>needsFinalReview(concrete(p),{method}))).sort();
const plans=require(path.join(root,'backend/lib/final-request-plans'));
const routeReviewed=[];
for(const p of new Set(gated)){
 try{await plans.prepare({path:concrete(p),body:{}});}
 catch(e){if(e.code==='FINAL_REQUEST_REVIEW_UNSUPPORTED')routeReviewed.push(p);}
}
/*
 * Which of those the router actually serves for that method. String extraction
 * also yields suffix fragments ('/video/generate') and read-only endpoints; the
 * real router answers them with its own 404 "Not found" / 405, so ask it. Runs
 * on a throwaway database with every outbound request refused.
 */
globalThis.fetch=async()=>new Response(JSON.stringify({error:'offline'}),{status:503,headers:{'content-type':'application/json'}});
const {Readable}=await import('stream');const Module=require('module');
const {db}=require(path.join(root,'backend/db/database'));require(path.join(root,'backend/db/schema')).ensureSchema();
const serverPath=path.join(root,'backend/server.js'),compiled=new Module(serverPath);compiled.filename=serverPath;compiled.paths=Module._nodeModulePaths(path.dirname(serverPath));
compiled._compile(fs.readFileSync(serverPath,'utf8').replace(/\nstart\(\);\s*$/,'\nmodule.exports={server};'),serverPath);
const handler=compiled.exports.server.listeners('request')[0];
const call=(method,url)=>new Promise(resolve=>{const req=Readable.from([Buffer.from('{}')]);req.socket={remoteAddress:'127.0.0.9'};req.method=method;req.url='/film'+url;req.headers={'content-type':'application/json'};
 let text='';const timer=setTimeout(()=>resolve({status:'timeout',text}),15000);
 const res={statusCode:200,headersSent:false,setHeader(){},getHeader(){},on(){},once(){},flushHeaders(){},writeHead(c){this.statusCode=c;this.headersSent=true;return this;},write(d){text+=String(d);return true;},end(d){if(d)text+=String(d);clearTimeout(timer);resolve({status:this.statusCode,text});}};
 Promise.resolve(handler(req,res)).catch(e=>{clearTimeout(timer);resolve({status:'threw',text:e.message});});});
// Real ids, so the router reaches its method check rather than a missing record.
const project=JSON.parse((await call('POST','/projects/demo')).text).project_id;
const first=(sql)=>{try{return db.prepare(sql).get(project)?.id;}catch(_){return null;}};
const ids={projects:project,shots:first('SELECT s.id FROM film_shots s JOIN film_scenes sc ON s.scene_id=sc.id WHERE sc.project_id=? LIMIT 1'),scenes:first('SELECT id FROM film_scenes WHERE project_id=? LIMIT 1'),
 characters:first('SELECT id FROM film_characters WHERE project_id=? LIMIT 1'),locations:first('SELECT id FROM film_locations WHERE project_id=? LIMIT 1'),props:first('SELECT id FROM film_props WHERE project_id=? LIMIT 1')};
const real=p=>p.split('/').map((seg,i,all)=>seg==='ID'?(ids[all[i-1]]||'x1'):seg.replace(/ID/g,'x1')).join('/');
const routes=[],excluded=[];
for(const p of routeReviewed){
 const method=needsFinalReview(concrete(p),{method:'POST'})?'POST':'PUT';
 const out=await call(method,real(p));
 if((out.status===404&&/^\{"error":"(Not found|File not found)"\}$/.test(out.text))||out.status===405)excluded.push({path:p,method,reason:out.status===405?'not served for '+method:'not a route'});
 else routes.push({path:p,method});
}
fs.writeFileSync(path.join(root,'src/components/FinalRequestReview/route-review-paths.json'),JSON.stringify({gated:[...new Set(gated)],route_reviewed:routeReviewed,routes,excluded},null,1)+'\n');
console.log(`${new Set(gated).size} gated paths, ${routeReviewed.length} reviewed through their route; ${routes.length} real ${'routes'}, ${excluded.length} fragments or read-only`);
process.exit(0);
