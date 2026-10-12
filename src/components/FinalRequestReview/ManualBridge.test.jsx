import {afterEach,describe,it,expect,vi} from 'vitest';
import {prepareFinalRequest,cancelledReview,needsFinalReview} from './request-bridge.js';
import inventory from './route-review-paths.json';

// Item 4: every gated path the planner cannot prepare (tools/review-path-inventory.mjs)
// still reaches the hand-over screen, through the route's own 428 review.
// Item 5: a batch is walked with Next/Previous; Close anywhere cancels all of it.
const review=id=>({id,state:'preview',fingerprint:'fp-'+id,snapshot:{provider:'runway',capability:'video',body:{prompt:'p '+id}}});
const unsupported=()=>Object.assign(new Error('This generation path does not yet support an exact final request review. Nothing was submitted.'),{code:'FINAL_REQUEST_REVIEW_UNSUPPORTED'});
const concrete=p=>p.replace(/ID/g,'x1');
const methodOf=p=>needsFinalReview(concrete(p),{method:'POST'})?'POST':'PUT';
afterEach(()=>{vi.unstubAllGlobals();delete window.__feFinalReviewBase;});

describe('unplannable generation paths reach the hand-over through their route',()=>{
 it('the inventory is generated and non-empty',()=>{expect(inventory.route_reviewed.length).toBeGreaterThan(0);});
 it.each(inventory.route_reviewed.filter(p=>!/\/stream$/.test(p)))('%s opens the route review and never re-sends the route',async(path)=>{
  window.__feFinalReviewBase=()=>'/film';
  const route=vi.fn(async()=>({ok:false,status:428,text:async()=>JSON.stringify({error:'FINAL_REQUEST_REVIEW_REQUIRED:route-review'})}));vi.stubGlobal('fetch',route);
  const request=vi.fn(async p=>{if(p.endsWith('/prepare'))throw unsupported();if(p==='/final-request-review/route-review')return review('route-review');return {};});
  const open=vi.fn().mockRejectedValue(cancelledReview());
  await expect(prepareFinalRequest(concrete(path),{method:methodOf(path),body:'{"a":1}'},open,request)).rejects.toMatchObject({code:'FINAL_REQUEST_CANCELLED'});
  expect(open).toHaveBeenCalledTimes(1);expect(open.mock.calls[0][0].id).toBe('route-review');
  expect(route).toHaveBeenCalledTimes(1);expect(JSON.parse(route.mock.calls[0][1].body)).toEqual({a:1});expect(route.mock.calls[0][1].method).toBe(methodOf(path));
  expect(request.mock.calls.map(([p])=>p)).toContain('/final-request-review/route-review/cancel');
 });
 it.each([[{review:{id:'structured'}}],[{review_id:'structured'}]])('a structured 428 review %j opens that review',async(payload)=>{
  window.__feFinalReviewBase=()=>'/film';
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:428,text:async()=>JSON.stringify(payload)})));
  const request=vi.fn(async p=>{if(p.endsWith('/prepare'))throw unsupported();if(p==='/final-request-review/structured')return review('structured');return {};});
  const open=vi.fn().mockRejectedValue(cancelledReview());
  await expect(prepareFinalRequest(concrete(inventory.route_reviewed[0]),{method:'POST',body:'{}'},open,request)).rejects.toMatchObject({code:'FINAL_REQUEST_CANCELLED'});
  expect(open.mock.calls[0][0].id).toBe('structured');
 });
 it.each(inventory.route_reviewed.filter(p=>/\/stream$/.test(p)))('%s is streamed by its caller (live progress); the bridge sends nothing',async(path)=>{
  const route=vi.fn();vi.stubGlobal('fetch',route);
  const request=vi.fn(async p=>{if(p.endsWith('/prepare'))throw unsupported();return {};}),open=vi.fn();
  const opts={method:'POST',body:'{"a":1}'};
  expect(await prepareFinalRequest(concrete(path),opts,open,request)).toBe(opts);
  expect(route).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
 });
 it('a route that needs no manual vendor completes once and returns its own result',async()=>{
  window.__feFinalReviewBase=()=>'/film';
  const route=vi.fn(async()=>({ok:true,status:200,text:async()=>JSON.stringify({imported:true})}));vi.stubGlobal('fetch',route);
  const request=vi.fn(async p=>{if(p.endsWith('/prepare'))throw unsupported();return {};}),open=vi.fn();
  const out=await prepareFinalRequest(concrete(inventory.route_reviewed[0]),{method:'POST',body:'{}'},open,request);
  expect(out.__manual_handoff).toEqual({imported:true});expect(open).not.toHaveBeenCalled();expect(route).toHaveBeenCalledTimes(1);
 });
});

describe('batch traversal',()=>{
 it.each([1,2,3,4])('a batch of %i is walked forward and back; Close cancels every review and sends nothing',async(total)=>{
  const reviews=Array.from({length:total},(_,i)=>review('r'+i));
  const request=vi.fn(async p=>p.endsWith('/prepare')?{reviews}:{});
  const seen=[];let step=0;
  // Next through every item, Previous once (when there is one), then Close.
  const script=[...Array(total-1).fill('next'),...(total>1?['previous']:[]),'close'];
  const open=vi.fn(async(r,position)=>{seen.push([r.id,position.index,position.total]);const action=script[step++];if(action==='close')throw cancelledReview();return {__manual_nav:action};});
  await expect(prepareFinalRequest('/projects/p/storyboard/generate',{method:'POST',body:'{}'},open,request)).rejects.toMatchObject({code:'FINAL_REQUEST_CANCELLED'});
  const expected=reviews.map((r,i)=>[r.id,i,total]);if(total>1)expected.push([reviews[total-2].id,total-2,total]);
  expect(seen).toEqual(expected);
  const cancelled=request.mock.calls.filter(([p])=>p.endsWith('/cancel')).map(([p])=>p);
  for(const r of reviews)expect(cancelled).toContain(`/final-request-review/${r.id}/cancel`);
  expect(request.mock.calls.some(([p])=>/approve|generate$/.test(p))).toBe(false);
 });
 it('an edited item is shown in its edited form when revisited',async()=>{
  const reviews=[review('a'),review('b')],edited=review('a-edited');
  const request=vi.fn(async p=>p.endsWith('/prepare')?{reviews}:{});
  const shown=[];let step=0;
  const open=vi.fn(async(r,position)=>{shown.push(r.id);step++;if(step===1){position.onReview(edited);return {__manual_nav:'next'};}if(step===2)return {__manual_nav:'previous'};throw cancelledReview();});
  await expect(prepareFinalRequest('/projects/p/storyboard/generate',{method:'POST',body:'{}'},open,request)).rejects.toMatchObject({code:'FINAL_REQUEST_CANCELLED'});
  expect(shown).toEqual(['a','b','a-edited']);
 });
});
