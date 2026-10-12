// Every review id a response or stream event names, in order, once each: the
// "FINAL_REQUEST_REVIEW_REQUIRED:<id>" marker anywhere in it, or a structured
// review.id / review_id. Shared by the bridge (route 428s) and the review host
// (stream events) so the two never read the contract differently.
const MARKER = /FINAL_REQUEST_REVIEW_REQUIRED:([A-Za-z0-9_-]+)/g;
export function reviewIdsIn(data) {
 const ids = [];
 const add = id => { if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id); };
 const text = typeof data === 'string' ? data : JSON.stringify(data ?? '');
 for (const m of text.matchAll(MARKER)) add(m[1]);
 (function walk(v) {
  if (Array.isArray(v)) return v.forEach(walk);
  if (!v || typeof v !== 'object') return;
  if (v.review && typeof v.review === 'object') add(v.review.id);
  add(v.review_id);
  Object.values(v).forEach(walk);
 })(typeof data === 'string' ? null : data);
 return ids;
}
