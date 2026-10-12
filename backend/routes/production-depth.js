const {db}=require('../db/database');
const {createDepthService}=require('../lib/production-depth');
const {pipeFile}=require('../lib/file-storage');
let service;
function store(){return service || (service=createDepthService(db));}
async function handleProductionDepth(req,res,parts){
 try{const w=store(),pid=parts[2],resource=parts[4],nid=parts[5],action=parts[6],b=req.body || {};let result,status=200;
  if(req.method==='GET'&&resource==='versions'&&nid&&action){
   const file=w.versionFile(pid,nid,action),headers={'Content-Type':file.mime,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=31536000, immutable'};
   if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416,{'Content-Range':`bytes */${file.size}`});return res.end();}const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),file.size-1):file.size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=file.size){res.writeHead(416,{'Content-Range':`bytes */${file.size}`});return res.end();}res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${file.size}`});return pipeFile(file.path,res,{start,end});}
   res.writeHead(200,{...headers,'Content-Length':file.size});return pipeFile(file.path,res);
  }
  if(req.method==='GET'&&!resource)result=await w.catalog(pid);
  else if(req.method==='POST'&&resource==='inspect'&&!nid)result=await w.inspectSource(pid,b.source_asset_id);
  else if(resource==='nodes'&&!nid&&req.method==='POST'){result=await w.saveNode(pid,null,b);status=201;}
  else if(resource==='nodes'&&nid&&!action&&req.method==='GET')result=w.readNode(pid,nid);
  else if(resource==='nodes'&&nid&&!action&&req.method==='PUT')result=await w.saveNode(pid,nid,b);
  else if(resource==='nodes'&&nid&&action==='plan'&&req.method==='POST')result=await w.plan(pid,nid,b);
  else if(resource==='nodes'&&nid&&action==='execute'&&req.method==='POST'){result=await w.execute(pid,nid,b);status=202;}
  else if(resource==='jobs'&&nid&&!action&&req.method==='GET')result=w.job(pid,nid);
  else if(resource==='jobs'&&nid&&action==='cancel'&&req.method==='POST')result=w.cancel(pid,nid);
  else throw Object.assign(Error('Depth route not found'),{status:404});
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
 }catch(e){res.writeHead(e.status || 500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
}
module.exports={handleProductionDepth};
