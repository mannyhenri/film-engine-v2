import { projectEpoch } from '../../lib/project-epoch.js';
// All review traffic bypasses generation helpers; this never submits a provider job.
export async function reviewApi(path, body, method = body === undefined ? 'GET' : 'POST') {
 const base = typeof window.__feFinalReviewBase === 'function' ? window.__feFinalReviewBase() : 'http://localhost:3100/film';
 const response = await fetch(base + path, { method, headers: {'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
 const data = await response.json();
 if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`),data.code?{code:data.code}:{});
 return data;
}
export function reviewRequired(data) {
 const text = typeof data === 'string' ? data : JSON.stringify(data || {});
 return text.match(/FINAL_REQUEST_REVIEW_REQUIRED:([A-Za-z0-9_-]+)/)?.[1] || null;
}
export function cancelledReview() { const error = new Error('Closed: the prompt was prepared and nothing was sent'); error.code = 'FINAL_REQUEST_CANCELLED'; return error; }

// Retry/collect operations resume an existing upstream handle. They must never buy
// another request. The server boundary remains mandatory for every paid adapter.
export function needsFinalReview(path, opts={}) {
 const method=String(opts.method || 'GET').toUpperCase();
 path=String(path).replace(/^\/film(?=\/)/,'').split('?')[0];
 if(method==='PUT' && /\/sequences\/[^/]+\/stations\/[^/]+\/[^/]+(?:\/|$)/.test(path))return true;
 if(method!=='POST')return false;
 // These writes store/import media or validate geometry, without a provider call.
 if (/^\/projects\/[^/]+\/models\/import$|^\/shots\/[^/]+\/direct\/explore$|^\/shots\/[^/]+\/storyboard\/angles\/[^/]+\/pick$|^\/projects\/[^/]+\/post\/(?:color-match|encode)$/.test(path))return false;
 // Existing provider post-processing actions are exact names; color-pipeline
 // settings and project eligibility reads remain ordinary writes.
 if (/^\/shots\/[^/]+\/post\/(?:upscale|face-restore|color-grade|composite|color-match|encode)$/.test(path))return true;
 if (/^\/projects\/[^/]+\/post\/batch(?:\/stream)?$/.test(path))return true;
 if (/^\/shots\/[^/]+\/storyboard\/angles$/.test(path))return true;
 if (/^\/projects\/[^/]+\/production-graph\/(?:run-changed|nodes\/[^/]+\/run-to-here)$/.test(path))return true;

 if (/\/inbetweens\/[^/]+\/(?:approve|select)(?:\/|$)/.test(path))return false;
 if (/\/final-request-review(?:\/|$)|\/(?:preview|plan|brief|collect|retry|cancel)(?:\/|$)|prompt/.test(path)) return false;
 return /\/shots\/[^/]+\/repair(?:\/|$)/.test(path) || /\/pipeline\/[^/]+\/resume(?:\/|$)/.test(path) || /\/flow-runs\/[^/]+\/resume(?:\/|$)/.test(path) || /\/flows\/[^/]+\/apply(?:\/|$)/.test(path) || /\/(?:generate[^/]*|regenerate[^/]*|refine|recompose|orbit|compass|plate|refsheet|explore|sequence|stitch|inbetweens|storyboard-upscale|upscale|run|batch|image)(?:\/|$)|\/models?\//.test(path);
}
export async function prepareFinalRequest(path, opts, openReview, request=reviewApi) {
 if (!needsFinalReview(path,opts)) return opts;
 let body; try { body=typeof opts.body==='string'?JSON.parse(opts.body):opts.body || {}; } catch { throw new Error('A provider request must have a JSON body for final review.'); }
 if (body.final_request_approvals?.length) throw new Error('An approval cannot be reused without a fresh visible final review.');
 const epoch=projectEpoch();
 let prepared;
 try { prepared=await request('/final-request-review/prepare',{path,body}); }
 catch (error) {
  if (error.code!=='FINAL_REQUEST_REVIEW_UNSUPPORTED') throw error;
  return routeReview(path,opts,body,openReview,request,epoch);
 }
 const reviews=prepared.reviews || (prepared.id?[prepared]:[]);
 if (!reviews.length) throw new Error(prepared.error || 'This generation path does not yet support a complete final request review. Nothing was sent to a provider.');
 return walkReviews(path,opts,body,reviews,openReview,request,epoch);
}
/*
 * A route the planner cannot prepare composes its own request. Sent with no
 * approval, the provider funnel stops at the door and answers 428 with the
 * review, which becomes the hand-over. A route that reaches no manual vendor
 * (imports, local tools, Gridlight) simply completes, once, and its result is
 * handed back so the caller does not post it again.
 */
async function routeReview(path,opts,body,openReview,request,epoch) {
 const base = typeof window.__feFinalReviewBase === 'function' ? window.__feFinalReviewBase() : 'http://localhost:3100/film';
 const response = await fetch(base + path, { method: opts.method || 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
 const text = await response.text();
 let data; try { data=JSON.parse(text); } catch { data={output:text}; }
 // The review id arrives in the error string, or as a structured field on a 428.
 const structured=response.status===428?[data?.review?.id,data?.review_id].filter(id=>typeof id==='string'):[];
 const ids=[...new Set([...[...text.matchAll(/FINAL_REQUEST_REVIEW_REQUIRED:([A-Za-z0-9_-]+)/g)].map(m=>m[1]),...structured])];
 if (!ids.length) {
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`),{data,status:response.status});
  return {...opts,__manual_handoff:data};
 }
 const reviews=await Promise.all(ids.map(id=>request(`/final-request-review/${id}`)));
 return walkReviews(path,opts,body,reviews,openReview,request,epoch);
}
// Each item is shown in turn; Next/Previous move through the batch and Close
// anywhere ends it. Every review shown or refreshed is cancelled on the way out.
async function walkReviews(path,opts,body,reviews,openReview,request,epoch) {
 const reviewIds=new Set(reviews.map(review=>review.id));
 const current=[...reviews];
 const approvals=[];
 let finalBody=body;
 try {
  if(epoch!==projectEpoch())throw cancelledReview();
  for (let index=0; index<current.length;) {
   if(epoch!==projectEpoch())throw cancelledReview();
   const itemReviewIds=new Set([current[index].id]);
   const onReview=next=>{if(next?.id){reviewIds.add(next.id);itemReviewIds.add(next.id);if(next.snapshot)current[index]=next;}};
   const approved=await openReview({...current[index],route_request:{path,body}},{index,total:current.length,onReview});
   if(epoch!==projectEpoch())throw cancelledReview();
   if(approved?.__manual_nav) { index=Math.max(0,Math.min(current.length-1,index+(approved.__manual_nav==='previous'?-1:1))); continue; }
   onReview(approved);
   if(approved.__manual_handoff) {
    await Promise.allSettled([...reviewIds].filter(id=>!itemReviewIds.has(id)).map(id=>request(`/final-request-review/${id}/cancel`,{})));
    const handoff=approved.__manual_handoff;
    window.dispatchEvent(new CustomEvent('fe-image-handoff-ready',{detail:handoff}));
    return {...opts,__manual_handoff:{manual_handoff:true,...handoff,pending:!!handoff.pending,...(handoff.result || {})}};
   }
   if(approved.__route_body) finalBody=approved.__route_body;
   const {__route_body,...token}=approved;
   approvals.push(token);
   index++;
  }
 } catch (error) {
  // Earlier item approvals are cancelled too; the original generation route has
  // not been called, even when the director cancels the last item in a batch.
  await Promise.allSettled([...reviewIds].map(id=>request(`/final-request-review/${id}/cancel`,{})));
  throw error;
 }
 return {...opts,body:JSON.stringify({...finalBody,final_request_approvals:approvals})};
}
