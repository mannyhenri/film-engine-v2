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
fs.writeFileSync(path.join(root,'src/components/FinalRequestReview/route-review-paths.json'),JSON.stringify({gated:[...new Set(gated)],route_reviewed:routeReviewed},null,1)+'\n');
console.log(`${new Set(gated).size} gated paths, ${routeReviewed.length} reviewed through their route`);
process.exit(0);
