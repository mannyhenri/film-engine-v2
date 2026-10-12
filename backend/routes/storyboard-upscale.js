async function handleStoryboardUpscale(req,res,parts,query={}) {
 try {const s=require('../lib/storyboard-upscale').store(),id=parts[2],action=parts[4];let result;
  if(req.method==='GET'&&action==='preview')result=s.plan(id,query.resolution||'2K',query.provider||'muapi');
  else if(req.method==='POST'&&!action)result=await s.start(id,req.body||{});
  else if(req.method==='GET'&&action)result=s.get(id,action);
  else if(req.method==='POST'&&parts[5]==='retry')result=s.retry(id,action);
  else if(req.method==='POST'&&parts[5]==='collect')result=s.collect(id,action);
  else {res.writeHead(405,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Method not allowed'}));}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
 }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
}
module.exports={handleStoryboardUpscale};
