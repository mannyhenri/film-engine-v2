const { store } = require('../lib/writing-style');
function handleWritingStyle(req,res,parts) {
 try {
  const id=parts[2], action=parts[4], body=req.body || {}, s=store(); let result;
  if (req.method==='GET' && !action) result=s.snapshot(id);
  else if (req.method==='GET' && action==='samples') result={ examples:s.snapshot(id).samples };
  else if (req.method==='GET' && action==='export') result=s.portable(id);
  else if (req.method==='GET' && action==='context') result=s.context(id);
  else if (req.method==='POST' && action==='samples') result=s.addSample(id,{...body,source_meta:undefined});
  else if (req.method==='POST' && action==='import') result=s.importProfile(id,body);
  else if (req.method==='POST' && action==='profiles' && !parts[5]) result=s.propose(id,{...body,direct_rules:undefined});
  else if (req.method==='POST' && action==='profiles' && parts[6]==='approve') result=s.approve(id,Number(parts[5]),body);
  else if (req.method==='POST' && action==='feedback') result=s.feedback(id,body);
  else { res.writeHead(405,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ error:'Method not allowed' })); }
  res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(result));
 } catch(e) { res.writeHead(e.status || 500,{'Content-Type':'application/json'}); res.end(JSON.stringify({ error:e.status ? e.message : 'Writing-style storage unavailable' })); }
}
module.exports={ handleWritingStyle };
