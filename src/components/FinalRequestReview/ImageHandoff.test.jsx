import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import FinalRequestReview,{FinalRequestReviewDialog} from './FinalRequestReview.jsx';
import {prepareFinalRequest} from './request-bridge.js';
const review=()=>({id:'review1',state:'preview',fingerprint:'fingerprint',editable:{provider:'openai',capability:'image',payload:{prompt:'Exact prompt',n:1},provenance:{project_id:'p1',subject_kind:'character',subject_id:'c1',view:'front'}},snapshot:{provider:'openai',capability:'image',body:{prompt:'Exact prompt',n:1},references:[],quote:{amount:1,currency:'USD'}}});
const saved=()=>({id:'saved-id',state:'prepared',prompt:'Exact prompt',target:{kind:'character',project_id:'p1',subject_id:'c1',view:'front'},snapshot:{capability:'image'}});
afterEach(()=>{delete window.__feImageHandoff;localStorage.removeItem('fe-pending-image-handoff');vi.unstubAllGlobals();});
describe('manual image destination uses no paid API transport',()=>{
 it('does no copy/launch before explicit consent and click, freezes the exact snapshot, then imports into the captured target',async()=>{
  const copyAndOpen=vi.fn().mockResolvedValue({copied:true,opened:true,note:'Prompt copied'});
  window.__feImageHandoff={availability:vi.fn().mockResolvedValue({available:true,browser_available:true}),copyAndOpen};
  const request=vi.fn(async path=>path.endsWith('/handoff')?saved():{asset_id:'new-version',version:2});const onSend=vi.fn();
  render(<FinalRequestReviewDialog initialReview={review()} request={request} onSend={onSend} onCancel={()=>{}}/>);
  await waitFor(()=>expect(screen.getByRole('option',{name:'ChatGPT Desktop — copy prompt and open app'}).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Image generation destination'),{target:{value:'chatgpt'}});
  expect(copyAndOpen).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Copy prompt & open ChatGPT'}).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Copy prompt & open ChatGPT'}));
  await waitFor(()=>expect(copyAndOpen).toHaveBeenCalledWith('saved-id','desktop'));expect(request.mock.calls.map(c=>c[0])).toEqual(['/final-request-review/review1/handoff']);expect(request.mock.calls[0][1]).toEqual({fingerprint:'fingerprint',human_confirmed:true});expect(onSend).not.toHaveBeenCalled();
  let reader;class FakeReader{constructor(){reader=this;}readAsDataURL(){reader.result='data:image/png;base64,aW1hZ2U=';reader.onload();}}vi.stubGlobal('FileReader',FakeReader);
  await act(async()=>fireEvent.change(screen.getByLabelText('Import ChatGPT result'),{target:{files:[{name:'saved.png',size:10}]}}));
  expect(request.mock.calls[1][0]).toBe('/final-request-review/handoffs/saved-id/import');expect(onSend).toHaveBeenCalledWith({__manual_handoff:{handoff_id:'saved-id',target:saved().target,result:{asset_id:'new-version',version:2}}});
  expect(request.mock.calls.some(c=>c[0].endsWith('/approve'))).toBe(false);
 });
 it('clipboard failure is visible and never reports app launch or dispatches an API request',async()=>{
  window.__feImageHandoff={availability:vi.fn().mockResolvedValue({available:true}),copyAndOpen:vi.fn().mockResolvedValue({copied:false,opened:false,error:'Clipboard unavailable'})};
  const onSend=vi.fn(),request=vi.fn().mockResolvedValue(saved());render(<FinalRequestReviewDialog initialReview={review()} request={request} onSend={onSend} onCancel={()=>{}}/>);
  await waitFor(()=>expect(screen.getByRole('option',{name:'ChatGPT Desktop — copy prompt and open app'}).disabled).toBe(false));fireEvent.change(screen.getByLabelText('Image generation destination'),{target:{value:'chatgpt'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Copy prompt & open ChatGPT'}));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','Clipboard unavailable');expect(onSend).not.toHaveBeenCalled();expect(request).toHaveBeenCalledTimes(1);
 });
 it('web-only desktop state is disabled',()=>{
  const r=review();render(<FinalRequestReviewDialog initialReview={r} onSend={()=>{}} onCancel={()=>{}}/>);expect(screen.getByRole('option',{name:/ChatGPT Desktop/}).disabled).toBe(true);
 });
 it('video and dependent image workflow reviews never offer a manual image destination',()=>{
  const video=review();video.snapshot.capability='video';
  const r=render(<FinalRequestReviewDialog initialReview={video} onSend={()=>{}} onCancel={()=>{}}/>);
  expect(screen.queryByLabelText('Image generation destination')).toBeNull();r.unmount();
  const flow=review();flow.editable.provenance.run_id='flow-run';
  render(<FinalRequestReviewDialog initialReview={flow} onSend={()=>{}} onCancel={()=>{}}/>);
  expect(screen.queryByLabelText('Image generation destination')).toBeNull();
 });
 it('manual batch item stops the entire original POST and cancels unsubmitted reviews',async()=>{
  const request=vi.fn().mockResolvedValue({reviews:[review(),{...review(),id:'review2'}]}),open=vi.fn().mockResolvedValue({__manual_handoff:{handoff_id:'saved-id',pending:true}});
  const out=await prepareFinalRequest('/projects/p1/storyboard/generate',{method:'POST',body:'{}'},open,request);
  expect(out.__manual_handoff.manual_handoff).toBe(true);expect(out.body).toBe('{}');expect(open).toHaveBeenCalledTimes(1);expect(request.mock.calls.map(c=>c[0])).toEqual(['/final-request-review/prepare','/final-request-review/review2/cancel']);
 });
 it('an older pending handoff read cannot replace the target of the newest explicit handoff',async()=>{
  let resolveOld;const old=new Promise(r=>resolveOld=r);
  vi.stubGlobal('fetch',vi.fn(async url=>({ok:true,json:async()=>String(url).endsWith('/first')?await old:{...saved(),id:'second',target:{kind:'character',subject_id:'c2'}}})));
  render(<FinalRequestReview/>);
  await act(async()=>{window.dispatchEvent(new CustomEvent('fe-image-handoff-ready',{detail:{handoff_id:'first',pending:true}}));window.dispatchEvent(new CustomEvent('fe-image-handoff-ready',{detail:{handoff_id:'second',pending:true}}));});
  expect(await screen.findByText(/Saved target: character c2/)).toBeTruthy();
  await act(async()=>resolveOld({...saved(),id:'first'}));expect(screen.queryByText(/Saved target: character c1/)).toBeNull();expect(localStorage.getItem('fe-pending-image-handoff')).toBe('second');
 });
 it('an import still reading an older handoff cannot clear or redirect a newer handoff',async()=>{
  const sent=[];vi.stubGlobal('fetch',vi.fn(async(url,opts)=>{sent.push(String(url));return {ok:true,json:async()=>String(url).endsWith('/import')?{asset_id:'imported-first'}:{...saved(),id:String(url).endsWith('/first')?'first':'second',target:{kind:'character',subject_id:String(url).endsWith('/first')?'c1':'c2'}}};}));
  let reader;class FakeReader{constructor(){reader=this;}readAsDataURL(){}}vi.stubGlobal('FileReader',FakeReader);
  render(<FinalRequestReview/>);await act(async()=>window.dispatchEvent(new CustomEvent('fe-image-handoff-ready',{detail:{handoff_id:'first',pending:true}})));
  expect(await screen.findByText(/Saved target: character c1/)).toBeTruthy();fireEvent.change(screen.getByLabelText('Import ChatGPT result'),{target:{files:[{name:'result.png',size:10}]}});
  await act(async()=>window.dispatchEvent(new CustomEvent('fe-image-handoff-ready',{detail:{handoff_id:'second',pending:true}})));
  expect(await screen.findByText(/Saved target: character c2/)).toBeTruthy();
  await act(async()=>{reader.result='data:image/png;base64,aW1hZ2U=';reader.onload();});
  await waitFor(()=>expect(sent.some(url=>url.endsWith('/handoffs/first/import'))).toBe(true));
  expect(screen.getByText(/Saved target: character c2/)).toBeTruthy();expect(localStorage.getItem('fe-pending-image-handoff')).toBe('second');
 });
 it('double clicking copies one reviewed handoff; close and reopen retain its captured pending target without an API generation',async()=>{
  const calls=[],copyAndOpen=vi.fn().mockResolvedValue({copied:true,opened:true,note:'Prompt copied'});
  window.__feImageHandoff={availability:vi.fn().mockResolvedValue({available:true}),copyAndOpen};
  vi.stubGlobal('fetch',vi.fn(async(url,opts)=>{calls.push(String(url));return {ok:true,json:async()=>String(url).endsWith('/prepare')?{reviews:[review()]}:saved()};}));
  const mounted=render(<FinalRequestReview/>);let pending;
  await act(async()=>{pending=window.__fePrepareFinalRequest('/characters/c1/refsheet/generate',{method:'POST',body:JSON.stringify({views:['front']})});});
  await waitFor(()=>expect(screen.getByRole('option',{name:/ChatGPT Desktop/}).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Image generation destination'),{target:{value:'chatgpt'}});fireEvent.click(screen.getByRole('checkbox'));
  const button=screen.getByRole('button',{name:'Copy prompt & open ChatGPT'});fireEvent.click(button);fireEvent.click(button);
  await waitFor(()=>expect(copyAndOpen).toHaveBeenCalledTimes(1));expect(calls.filter(url=>url.endsWith('/handoff'))).toHaveLength(1);
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Close handoff'})));
  expect((await pending).__manual_handoff.handoff_id).toBe('saved-id');
  await waitFor(()=>expect(localStorage.getItem('fe-pending-image-handoff')).toBe('saved-id'));
  mounted.unmount();render(<FinalRequestReview/>);expect(await screen.findByText(/Saved target: character c1 front/)).toBeTruthy();
  expect(calls.some(url=>url.endsWith('/approve')||url.endsWith('/refsheet/generate'))).toBe(false);expect(copyAndOpen).toHaveBeenCalledTimes(1);
 });
});
