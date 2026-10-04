// /film/projects/:id/style-pilot/<operation> — GRD-4664. Same contract as routes/writing-style.js.
// Every answer a reviewer can see is blinded: running a pilot answers with the blind review queue.
const crypto = require('crypto');
const pilot = require('../lib/style-pilot');
async function handleStylePilot(req, res, parts) {
 const header = (req.headers || {})['x-request-id'];
 const requestId = typeof header === 'string' && /^[\w-]{8,64}$/.test(header) ? header : crypto.randomUUID();
 const send = (status, payload) => { res.writeHead(status, { 'Content-Type':'application/json', 'X-Request-Id':requestId }); res.end(JSON.stringify(payload)); };
 const id = parts[2], op = parts[4];
 if (req.method !== 'POST' || !pilot.OPERATIONS[op] || parts.length !== 5) return send(405, { error:'Method not allowed', code:'invalid_request', request_id:requestId });
 try {
  const s = pilot.store({ actor:req.actor === 'agent' ? 'agent' : 'human' });
  const out = await s[op](id, req.body || {});
  send(200, op === 'runPilot' ? s.reviewQueue(id, { pilot_id:out.pilot_id }) : out);
 } catch (e) {
  if (e.status) return send(e.status, { ...e.extra, error:e.message, code:e.code, request_id:requestId });
  console.error(`[style-pilot] storage_unavailable op=${op} request_id=${requestId}`);
  send(500, { error:'Pilot storage unavailable', code:'storage_unavailable', request_id:requestId });
 }
}
module.exports = { handleStylePilot };
