import {describe,it,expect} from 'vitest';
import {readFileSync} from 'fs';
import {reviewIdsIn} from './review-marker.js';

// One reader for every form a review id travels in, used by the bridge (route 428s)
// and the review host (stream events). Ids are the store's UUIDs.
const ID='3f1c2b7a-9d4e-4c1b-8a2f-0e6d5c4b3a21',ID2='a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
describe('review marker formats',()=>{
 it.each([
  ['plain string',`FINAL_REQUEST_REVIEW_REQUIRED:${ID}`,[ID]],
  ['wrapped in an error string',{error:`ImageGen error: FINAL_REQUEST_REVIEW_REQUIRED:${ID}`},[ID]],
  ['structured review.id',{review:{id:ID}},[ID]],
  ['structured review_id',{review_id:ID},[ID]],
  ['typed stream event with the string',{type:'music_failed',error:`FINAL_REQUEST_REVIEW_REQUIRED:${ID}`},[ID]],
  ['typed stream event with a structured id',{type:'music_failed',review:{id:ID}},[ID]],
  ['several ids, de-duplicated, in order',{reviews:[`FINAL_REQUEST_REVIEW_REQUIRED:${ID}`,`FINAL_REQUEST_REVIEW_REQUIRED:${ID2}`,`FINAL_REQUEST_REVIEW_REQUIRED:${ID}`]},[ID,ID2]],
  ['raw SSE text',`data: {"error":"FINAL_REQUEST_REVIEW_REQUIRED:${ID}"}\n\n`,[ID]],
  ['nothing',{ok:true},[]],
 ])('%s',(_,input,expected)=>{expect(reviewIdsIn(input)).toEqual(expected);});
 it('both readers use the shared helper, not their own pattern',()=>{
  for(const f of ['request-bridge.js','FinalRequestReview.jsx']){
   const src=readFileSync(new URL('./'+f,import.meta.url),'utf8');
   expect(src,f).toMatch(/reviewIdsIn/);
   expect(src.match(/FINAL_REQUEST_REVIEW_REQUIRED:\(/g)||[],f+' keeps no private marker pattern').toHaveLength(0);
  }
 });
});
