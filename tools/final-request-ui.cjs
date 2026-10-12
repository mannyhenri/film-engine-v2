// A deliberate v2 safety change, applied equally to source parity and generated
// core. Preview preparation never reaches a paid provider transport.
function finalRequestCode(code) {
 return code
  .replace('async function api(path, opts = {}) {\n', 'async function api(path, opts = {}) {\n        window.__feFinalReviewBase = () => API();\n        if (window.__fePrepareFinalRequest) opts = await window.__fePrepareFinalRequest(path, opts);\n        if (opts.__manual_handoff) return opts.__manual_handoff;\n')
  .replace('const data = await res.json();\n            if (!res.ok)', 'const data = await res.json();\n            window.__feObserveFinalRequestState?.(data);\n            if (!res.ok)')
  .replace('async function streamSSEPost(path, body, onEvent, onDone, onError) {\n        try {', 'async function streamSSEPost(path, body, onEvent, onDone, onError) {\n        try {\n            window.__feFinalReviewBase = () => API();\n            if (window.__fePrepareFinalRequest) { const approved = await window.__fePrepareFinalRequest(path, {method:"POST",body:JSON.stringify(body || {})}); if (approved.__manual_handoff) { onDone?.({type:"done",...approved.__manual_handoff}); return; } body = JSON.parse(approved.body); }')
  .replace("if (data.type === 'done' || data.done) onDone?.(data);", "window.__feObserveFinalRequestState?.(data);\n                    if (data.type === 'done' || data.done) onDone?.(data);");
}
module.exports={finalRequestCode};
