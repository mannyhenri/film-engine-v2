const {db}=require('../db/database');
const {connections}=require('../lib/ai-connections');
const {createAIWorkspace}=require('../lib/ai-workspace');
const {createApplicationWorkspace}=require('../lib/ask-ai');
let workspace,applicationWorkspace;
function saveScript(pid,fountain){let status=200,result;require('./scripts').handleScripts({method:'POST',body:{fountain_content:fountain,sync_scenes:true},headers:{}},{writeHead(n){status=n;},end(s){result=JSON.parse(s);}},['film','projects',pid,'script'],{});if(status>=300)throw Object.assign(Error(result.error),{status});return result;}
function store(){return workspace||(workspace=createAIWorkspace(db,{runner:connections(),saveScript}));}
function applicationStore(){return applicationWorkspace||(applicationWorkspace=createApplicationWorkspace(db,{runner:connections(),saveScript}));}
async function handleAIWorkspace(req,res,parts,query){
 try{const w=store(),pid=parts[2],resource=parts[4],id=parts[5],action=parts[6],b=req.body||{};let result,status=200;
  if(req.method==='GET'&&!resource)result=w.catalog(pid);
  else if(resource==='conversations'&&!id&&req.method==='GET')result={conversations:w.listConversations(pid,query.feature||'screenplay')};
  else if(resource==='conversations'&&!id&&req.method==='POST'){result=w.createConversation(pid,b);status=201;}
  else if(resource==='conversations'&&id&&!action&&req.method==='GET')result={conversation:w.conversation(pid,id),tasks:w.tasks(pid,id)};
  else if(resource==='conversations'&&id&&action==='preview'&&req.method==='POST'){result=w.preview(pid,id,b);status=201;}
  else if(resource==='tasks'&&id&&!action&&req.method==='GET')result=w.task(pid,id);
  else if(resource==='tasks'&&id&&action==='change-review'&&req.method==='GET')result=w.reviewChange(pid,id);
  else if(resource==='tasks'&&id&&req.method==='POST'&&['execute','apply','undo','cancel'].includes(action))result=w[action](pid,id,b);
  else throw Object.assign(Error('AI workspace route not found'),{status:404});
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
 }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
}
async function handleApplicationAIWorkspace(req,res,parts){
 try {const w=applicationStore(),resource=parts[2],id=parts[3],action=parts[4],b=req.body||{};let result,status=200;
  if(!resource&&req.method==='GET')result=w.catalog();
  else if(resource==='conversations'&&!id&&req.method==='GET')result={conversations:w.listConversations()};
  else if(resource==='conversations'&&!id&&req.method==='POST'){result=w.createConversation(b);status=201;}
  else if(resource==='conversations'&&id&&!action&&req.method==='GET')result={conversation:w.conversation(id),tasks:w.tasks(id),uploads:w.uploads.list(id)};
  else if(resource==='conversations'&&id&&action==='preview'&&req.method==='POST'){result=w.preview(id,b);status=201;}
  else if(resource==='conversations'&&id&&action==='uploads'){
   const uid=parts[5],uploadAction=parts[6];
   if(!uid&&req.method==='GET')result={uploads:w.uploads.list(id)};
   else if(!uid&&req.method==='POST'){result=w.uploads.upload(id,b);status=202;}
   else if(uid&&!uploadAction&&req.method==='GET')result=w.uploads.get(id,uid);
   else if(uid&&uploadAction==='approve'&&req.method==='POST')result=w.uploads.approve(id,uid,b);
   else if(uid&&uploadAction==='cancel'&&req.method==='POST')result=w.uploads.cancel(id,uid);
   else throw Object.assign(Error('Upload route not found'),{status:404});
  }
  else if(resource==='tasks'&&id&&!action&&req.method==='GET')result=w.task(id);
  else if(resource==='tasks'&&id&&action==='coding-review'&&req.method==='GET')result=w.codingReview(id);
  else if(resource==='tasks'&&id&&action==='dispatch-coding'&&req.method==='POST')result=w.dispatchCoding(id,b);
  else if(resource==='tasks'&&id&&req.method==='POST'&&['execute','apply','undo','cancel'].includes(action))result=w[action](id,b);
  else throw Object.assign(Error('Application AI route not found'),{status:404});
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
 }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
}
module.exports={handleAIWorkspace,handleApplicationAIWorkspace};
