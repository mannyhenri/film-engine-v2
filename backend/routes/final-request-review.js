async function handleFinalRequestReview(req,res,parts){
 if(parts[2]==='handoffs' || parts[3]==='handoff' || parts[3]==='expressions')return require('./image-handoff').handleImageHandoff(req,res,parts);
 if(req.method==='GET'&&parts[3]==='references'&&parts[5]==='original'){
  try{const lib=require('../lib/final-request-review'),out=lib.originalReference(lib.store(),parts[2],parts[4]);
   res.writeHead(200,{'Content-Type':out.mime,'Content-Disposition':`attachment; filename="${out.name}"`});return require('../lib/file-storage').pipeFile(out.file,res);}
  catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:e.message}));}
 }
 try {const s=require('../lib/final-request-review').store(),id=parts[2],action=parts[3];let result;
 if(req.method==='POST'&&id==='prepare'){const plan=await require('../lib/final-request-plans').prepare(req.body||{});const items=Array.isArray(plan)?plan:plan.items;if(!Array.isArray(items)||!items.length)throw Object.assign(new Error('No final requests were prepared'),{status:400});result={reviews:await Promise.all(items.map(item=>s.preview({...item,provider:item.provider||item.provider_id})))};}
 else if(req.method==='POST'&&!id)result=await s.preview(req.body||{});
 else if(req.method==='GET'&&id&&!action)result=s.get(id);
 else if(req.method==='POST'&&action==='approve')result=s.approve(id,req.body||{});
 else if(req.method==='POST'&&action==='cancel')result=s.cancel(id);
 else {res.writeHead(405,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Method not allowed'}));}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
 }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message,...(e.code?{code:e.code}:{})}));}
}
module.exports={handleFinalRequestReview};
