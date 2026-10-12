import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
vi.mock('../../lib/legacy.js',()=>({legacy:{api:vi.fn()}}));
import { legacy } from '../../lib/legacy.js';
import { reviewApi } from '../../components/FinalRequestReview/request-bridge.js';
import { resetProjectEpoch, noteOpenProject } from '../../lib/project-epoch.js';
import FinalRequestReview from '../../components/FinalRequestReview/FinalRequestReview.jsx';
import UpscaleFrameDialog from './UpscaleFrameDialog.jsx';
const source='data:image/png;base64,Y2xlYW4=',hash='clean-frame-sha';
const plan={source:{width:1024,height:576},source_hash:hash,output:{width:2048,height:1152},provider:'muapi',resolution:'2K',plan_token:'fixture',configured:true,cost_note:'Provider credits; no verified estimate',model:'Topaz'};
const saved={id:'job',state:'completed',result:{asset:{id:'saved-frame-v2'}}};
let transport,reviewId,generations,approvals,prepares,nextJob,previewPlan,approveError,generationError,approveWait,jobGet,collect;
const pathOf=url=>new URL(url,'http://localhost').pathname.replace(/^\/film/,'');
const calls=path=>transport.mock.calls.filter(([url])=>pathOf(url)===path);
const reviewFor=body=>({id:`review-${++reviewId}`,state:'preview',fingerprint:`hash-${reviewId}`,editable:{provider:'muapi-upscale',capability:'image-upscale',payload:{image:source,resolution:body.resolution}},snapshot:{provider:'muapi-upscale',capability:'image-upscale',model:'topaz-image',endpoint:'https://mock.invalid/upscale',body:{image_url:'$reference:0',target_resolution:body.resolution,model:'topaz-image',enhancement_mode:'precision'},references:[{data:source,mime:'image/png',sha256:previewPlan.source_hash,role:'image'}],quote:{amount:null,currency:'credits',expires_at:'2099-01-01T00:00:00Z'}}});
beforeEach(()=>{
 vi.clearAllMocks();resetProjectEpoch();window.state={currentProject:{id:'project'}};noteOpenProject();window.__feFinalReviewBase=()=>'/film';reviewId=generations=approvals=prepares=0;nextJob=saved;previewPlan={...plan};approveError=generationError=approveWait=null;jobGet=()=>nextJob;collect=()=>saved;
 transport=vi.fn(async(url,opts={})=>{
  const path=pathOf(url),body=opts.body?JSON.parse(opts.body):{};let data,status=200;
  if(path.endsWith('/preview'))data=previewPlan;
  else if(path==='/final-request-review/prepare'){prepares++;data={reviews:[reviewFor(body.body)]};}
  else if(path.endsWith('/approve')){approvals++;if(approveWait)await approveWait;if(approveError){status=409;data={error:approveError};}else data={id:path.split('/')[2],fingerprint:body.fingerprint};}
  else if(path.endsWith('/cancel'))data={state:'cancelled'};
  else if(path.endsWith('/collect'))data=collect();
  else if(path.endsWith('/retry'))data=nextJob;
  else if(path==='/shots/shot/storyboard-upscale'){
   if(generationError){status=409;data={error:generationError};}else{generations++;data=nextJob;}
  }else data=jobGet();
  return {ok:status===200,status,json:async()=>data};
 });
 vi.stubGlobal('fetch',transport);
 // Preview/poll/resume use the existing application API. A paid initial call
 // through that wrapper would open the unwanted generic second review.
 legacy.api.mockImplementation((path,opts={})=>{if(path==='/shots/shot/storyboard-upscale'&&opts.method==='POST')throw new Error('Unexpected second-review API path');return reviewApi(path,opts.body?JSON.parse(opts.body):undefined,opts.method||'GET');});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();delete window.__feFinalReviewBase;});
async function mount(props={}){const close=vi.fn(),complete=vi.fn();render(<><FinalRequestReview/><UpscaleFrameDialog shotId="shot" projectId="project" onClose={close} onComplete={complete} {...props}/></>);await screen.findByAltText('Exact clean frame to upscale');return {close,complete};}
const confirm=()=>{fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Confirm paid upscale'}));};
describe('manual image upscale: the dialog hands over the frame and settings',()=>{
 it('shows the exact clean frame to download and the settings to match, with no consent, cost or Send',async()=>{
  const writeText=vi.fn().mockResolvedValue();vi.stubGlobal('navigator',{...navigator,clipboard:{writeText}});
  const {close,complete}=await mount();
  const link=screen.getByRole('link',{name:'Download clean frame'});expect(link.getAttribute('href')).toBe(source);expect(link.getAttribute('download')).toBe('shot-clean-frame.png');
  expect(screen.getByLabelText('Upscale settings to match').textContent).toMatch(/1024×576 → 2048×1152/);
  expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.queryByRole('button',{name:/Confirm|Send|paid/i})).toBeNull();expect(screen.queryByText(/estimated|credits/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Copy settings'}));await waitFor(()=>expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/2048×1152/)));
  expect(approvals).toBe(0);expect(generations).toBe(0);expect(close).not.toHaveBeenCalled();expect(complete).not.toHaveBeenCalled();
 });
 it('changing the target cancels the old snapshot and prepares the 4K hand-over',async()=>{
  await mount();fireEvent.change(screen.getByLabelText('Upscale target'),{target:{value:'4K'}});
  await waitFor(()=>expect(prepares).toBe(2));expect(calls('/final-request-review/review-1/cancel').length).toBe(1);expect(approvals).toBe(0);expect(generations).toBe(0);
 });
 it('a provider with no stored key still prepares the hand-over',async()=>{
  previewPlan={...plan,configured:false};await mount();expect(prepares).toBe(1);expect(screen.queryByText(/Configure MuAPI/)).toBeNull();expect(approvals).toBe(0);
 });
 it('Cancel cancels the prepared snapshot without approving or generating',async()=>{const {close}=await mount();fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(calls('/final-request-review/review-1/cancel')).toHaveLength(1));expect(close).toHaveBeenCalledTimes(1);expect(approvals).toBe(0);expect(generations).toBe(0);});
 it('reopening an interrupted job resumes its handle without cost approval or another submit',async()=>{previewPlan={...plan,existing_job:{id:'job',state:'waiting',request_id:'upstream',error:'Interrupted'}};const close=vi.fn();render(<UpscaleFrameDialog shotId="shot" onClose={close} onComplete={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume existing job'}));await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));expect(calls('/shots/shot/storyboard-upscale/job/retry')).toHaveLength(1);expect(prepares).toBe(0);expect(approvals).toBe(0);expect(generations).toBe(0);});
});
