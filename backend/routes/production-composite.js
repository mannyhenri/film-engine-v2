const {db}=require('../db/database');
const {createCompositeService}=require('../lib/production-composite');
const {serveResolvedFile}=require('../lib/file-storage');
let service;
const store=()=>service||(service=createCompositeService(db));
function sendFile(req,res,file){return serveResolvedFile(req,res,file,{cacheControl:'private, max-age=0'});}
async function handleProductionComposite(req,res,parts){try{
 const w=store(),pid=parts[2],resource=parts[4],id=parts[5],action=parts[6],b=req.body||{};let result,status=200;
 if(req.method==='GET'&&resource==='handoffs'&&id&&action==='manifest')return sendFile(req,res,w.handoffFile(pid,id));
 if(req.method==='POST'&&resource==='versions'&&id&&action==='handoff'){
  result=parts[7]==='plan'?await w.handoffPlan(pid,id):await w.exportHandoff(pid,id,b);
  res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(result));
 }
 if(req.method==='GET'&&resource==='versions'&&id&&action)return sendFile(req,res,w.versionFile(pid,id,action));
 if(req.method==='GET'&&resource==='sources'&&id&&!action)return sendFile(req,res,await w.sourceFile(pid,id,new URL(req.url,'http://localhost').searchParams.get('sha256')));
 if(req.method==='GET'&&!resource)result=await w.catalog(pid);
 else if(req.method==='POST'&&resource==='inspect'&&!id)result=await w.inspectSource(pid,b.source_asset_id);
 else if(req.method==='POST'&&resource==='nodes'&&!id){result=await w.saveNode(pid,null,b);status=201;}
 else if(req.method==='PUT'&&resource==='nodes'&&id&&!action)result=await w.saveNode(pid,id,b);
 else if(req.method==='GET'&&resource==='nodes'&&id&&!action)result=w.readNode(pid,id);
 else if(req.method==='POST'&&resource==='nodes'&&id&&action==='plan')result=await w.plan(pid,id,b);
 else if(req.method==='POST'&&resource==='nodes'&&id&&action==='execute'){result=await w.execute(pid,id,b);status=202;}
 else if(req.method==='GET'&&resource==='jobs'&&id&&!action)result=w.job(pid,id);
 else if(req.method==='POST'&&resource==='jobs'&&id&&action==='cancel')result=w.cancel(pid,id);
 else throw Object.assign(Error('Production composite route not found'),{status:404});
 res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
}catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}}
module.exports={handleProductionComposite,sendFile};
