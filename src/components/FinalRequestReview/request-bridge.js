import { projectEpoch } from '../../lib/project-epoch.js';
// All review traffic bypasses generation helpers; this never submits a provider job.
export async function reviewApi(path, body, method = body === undefined ? 'GET' : 'POST') {
 const base = typeof window.__feFinalReviewBase === 'function' ? window.__feFinalReviewBase() : 'http://localhost:3100/film';
 const response = await fetch(base + path, { method, headers: {'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
 const data = await response.json();
 if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
 return data;
}
export function reviewRequired(data) {
 const text = typeof data === 'string' ? data : JSON.stringify(data || {});
 return text.match(/FINAL_REQUEST_REVIEW_REQUIRED:([A-Za-z0-9_-]+)/)?.[1] || null;
}
export function cancelledReview() { const error = new Error('Generation cancelled before Send'); error.code = 'FINAL_REQUEST_CANCELLED'; return error; }

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
 const prepared=await request('/final-request-review/prepare',{path,body});
 const reviews=prepared.reviews || (prepared.id?[prepared]:[]);
 if (!reviews.length) throw new Error(prepared.error || 'This generation path does not yet support a complete final request review. Nothing was sent to a provider.');
 const reviewIds=new Set(reviews.map(review=>review.id));
 const approvals=[];
 let finalBody=body;
 try {
  if(epoch!==projectEpoch())throw cancelledReview();
  for (const [index,review] of reviews.entries()) {
   if(epoch!==projectEpoch())throw cancelledReview();
   const itemReviewIds=new Set([review.id]);
   const onReview=next=>{if(next?.id){reviewIds.add(next.id);itemReviewIds.add(next.id);}};
   const approved=await openReview({...review,route_request:{path,body}},{index,total:reviews.length,onReview});
   onReview(approved);
   if(epoch!==projectEpoch())throw cancelledReview();
   if(approved.__manual_handoff) {
    await Promise.allSettled([...reviewIds].filter(id=>!itemReviewIds.has(id)).map(id=>request(`/final-request-review/${id}/cancel`,{})));
    const handoff=approved.__manual_handoff;
    window.dispatchEvent(new CustomEvent('fe-image-handoff-ready',{detail:handoff}));
    return {...opts,__manual_handoff:{manual_handoff:true,...handoff,pending:!!handoff.pending,...(handoff.result || {})}};
   }
   if(approved.__route_body) finalBody=approved.__route_body;
   if(epoch!==projectEpoch())throw cancelledReview();
   const {__route_body,...token}=approved;
   approvals.push(token);
  }
 } catch (error) {
  // Earlier item approvals are cancelled too; the original generation route has
  // not been called, even when the director cancels the last item in a batch.
  await Promise.allSettled([...reviewIds].map(id=>request(`/final-request-review/${id}/cancel`,{})));
  throw error;
 }
 return {...opts,body:JSON.stringify({...finalBody,final_request_approvals:approvals})};
}
