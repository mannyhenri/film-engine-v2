// /film/projects/:id/style-profile — style traits, overrides, learning proposals (GRD-4662).
// Same contract as routes/writing-style.js: request id, declared codes, agent actor from the MCP shim.
const crypto = require('crypto');
const sp = require('../lib/style-profile');
const OPS = {
 'GET ': 'snapshot', 'GET resolve': 'resolve', 'POST traits': 'proposeTrait', 'POST corrections': 'recordCorrection',
 'POST pairwise': 'createPairwise', 'POST pairwise/choose': 'choosePairwise', 'POST proposals/accept': 'acceptProposal',
 'POST proposals/modify': 'modifyProposal', 'POST proposals/reject': 'rejectProposal', 'POST traits/remove': 'removeTrait', 'POST restore': 'restore',
};
function handleStyleProfile(req, res, parts) {
 const header = (req.headers || {})['x-request-id'];
 const requestId = typeof header === 'string' && /^[\w-]{8,64}$/.test(header) ? header : crypto.randomUUID();
 const send = (status, payload) => { res.writeHead(status, { 'Content-Type':'application/json', 'X-Request-Id':requestId }); res.end(JSON.stringify(payload)); };
 const id = parts[2], op = OPS[`${req.method} ${parts.slice(4).join('/')}`];
 if (!op) return send(405, { error:'Method not allowed', code:'invalid_request', request_id:requestId });
 try {
  const s = sp.store({ actor:req.actor === 'agent' ? 'agent' : 'human' });
  const out = s[op](id, req.body || {});
  // A new pairwise question comes back with the page state, so the caller can show it.
  send(200, op === 'createPairwise' ? { question:out, ...s.snapshot(id) } : out);
 } catch (e) {
  if (e.status) return send(e.status, { ...e.extra, error:e.message, code:e.code, request_id:requestId });
  console.error(`[style-profile] storage_unavailable op=${op} request_id=${requestId}`);
  send(500, { error:'Style profile storage unavailable', code:'storage_unavailable', request_id:requestId });
 }
}
module.exports = { handleStyleProfile };
