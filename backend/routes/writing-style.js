const crypto = require('crypto');
const ws = require('../lib/writing-style');
// The operation a request addresses, so permission, idempotency and logging all name the same thing.
function operationOf(method, action, parts) {
 if (method==='POST' && action==='sources' && !parts[5]) return 'importSource';
 if (method==='DELETE' && action==='sources' && parts[5]) return 'deleteSource';
 if (method==='POST' && action==='samples' && parts[5] && parts[6]==='access') return 'setSampleAccess';
 if (method==='POST' && action==='samples' && parts[5] && !parts[6]) return 'updateSample';
 if (method==='DELETE' && action==='samples' && parts[5]) return 'deleteSample';
 if (method==='GET' && !action) return 'snapshot';
 if (method==='GET' && action==='samples') return 'snapshot';
 if (method==='GET' && action==='export') return 'portable';
 if (method==='GET' && action==='context') return 'context';
 if (method==='POST' && action==='samples' && !parts[5]) return 'addSample';
 if (method==='POST' && action==='import') return 'importProfile';
 if (method==='POST' && action==='profiles' && !parts[5]) return 'propose';
 if (method==='POST' && action==='profiles' && parts[6]==='approve') return 'approve';
 if (method==='POST' && action==='feedback') return 'feedback';
 return null;
}
function handleWritingStyle(req,res,parts) {
 const header = (req.headers || {})['x-request-id'];
 const requestId = typeof header==='string' && /^[\w-]{8,64}$/.test(header) ? header : crypto.randomUUID();
 const send = (status, payload) => { res.writeHead(status,{ 'Content-Type':'application/json', 'X-Request-Id':requestId }); res.end(JSON.stringify(payload)); };
 const id=parts[2], action=parts[4], body=req.body || {}, op=operationOf(req.method,action,parts);
 if (!op) return send(405,{ error:'Method not allowed', code:'invalid_request', request_id:requestId });
 try {
  // req.actor is set in-process by the MCP shim (lib/mcp-tools.js callRoute); HTTP cannot set it.
  const s=ws.store({ actor:req.actor==='agent' ? 'agent' : 'human' }); let result;
  if (op==='snapshot') result = action==='samples' ? { examples:s.snapshot(id).samples } : s.snapshot(id);
  else if (op==='portable') result=s.portable(id);
  else if (op==='context') result=s.context(id);
  else if (op==='addSample') result=s.addSample(id,{...body,source_meta:undefined,source_document_id:undefined,span_start:undefined,span_end:undefined});
  else if (op==='importSource') result=s.importSource(id,body);
  else if (op==='updateSample') result=s.updateSample(id,{...body,sample_id:parts[5]});
  else if (op==='setSampleAccess') result=s.setSampleAccess(id,{...body,sample_id:parts[5]});
  else if (op==='deleteSample') result=s.deleteSample(id,{...body,sample_id:parts[5]});
  else if (op==='deleteSource') result=s.deleteSource(id,{...body,document_id:parts[5]});
  else if (op==='importProfile') result=s.importProfile(id,body);
  else if (op==='propose') result=s.propose(id,{...body,direct_rules:undefined});
  else if (op==='approve') result=s.approve(id,Number(parts[5]),body);
  else result=s.feedback(id,body);
  send(200,result);
 } catch(e) {
  if (e.status) return send(e.status,{ ...e.extra, error:e.message, code:e.code, request_id:requestId });
  // Operational log: the code, operation and request id only. Never the message, which can carry
  // screenplay prose or a credential from the failing statement.
  console.error(`[writing-style] storage_unavailable op=${op} request_id=${requestId}`);
  send(500,{ error:'Writing-style storage unavailable', code:'storage_unavailable', request_id:requestId });
 }
}
module.exports={ handleWritingStyle };
