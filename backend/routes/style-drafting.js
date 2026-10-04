// /film/projects/:id/style-drafting/<contract or workbench step> — GRD-4663. Every host tool and the
// workbench call the same services here; same contract as routes/writing-style.js (request id,
// declared codes, agent actor set in-process by the MCP shim).
const crypto = require('crypto');
const sd = require('../lib/style-drafting');
async function handleStyleDrafting(req, res, parts) {
 const header = (req.headers || {})['x-request-id'];
 const requestId = typeof header === 'string' && /^[\w-]{8,64}$/.test(header) ? header : crypto.randomUUID();
 const send = (status, payload) => { res.writeHead(status, { 'Content-Type':'application/json', 'X-Request-Id':requestId }); res.end(JSON.stringify(payload)); };
 const id = parts[2], name = parts[4];
 if (req.method !== 'POST' || !name || parts.length !== 5) return send(405, { error:'Method not allowed', code:'invalid_request', request_id:requestId });
 try {
  send(200, await sd.store({ actor:req.actor === 'agent' ? 'agent' : 'human' }).invoke(name, id, req.body || {}));
 } catch (e) {
  if (e.status) return send(e.status, { ...e.extra, error:e.message, code:e.code, request_id:requestId });
  console.error(`[style-drafting] storage_unavailable op=${name} request_id=${requestId}`);
  send(500, { error:'Drafting storage unavailable', code:'storage_unavailable', request_id:requestId });
 }
}
module.exports = { handleStyleDrafting };
