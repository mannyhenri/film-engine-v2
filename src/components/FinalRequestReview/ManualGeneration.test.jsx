import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import FinalRequestReview,{FinalRequestReviewDialog} from './FinalRequestReview.jsx';

// Every provider the final review resolves (backend REVIEW_PROVIDER_MODULES) and
// every capability those adapters serve. The last screen is the deliverable:
// full prompt, every asset, Copy and Close; there is no Send.
const PROVIDERS={openai:'image',google:'image',muapi:'image',seedance:'video',runway:'video',higgsfield:'video','muapi-upscale':'image-upscale',meshy:'model3d',worldlabs:'world',magnific:'post',elevenlabs:'voice',topaz:'post'};
const CASES=[...Object.entries(PROVIDERS),['runway','image'],['higgsfield','image'],['seedance','post'],['meshy','image'],['elevenlabs','sfx'],['elevenlabs','music'],['elevenlabs','ambient']];
const PNG='data:image/png;base64,iVBORw0KGgo=';
function review(provider,capability){
 const prompt=`Exact ${provider} ${capability} prompt, 35mm, dusk`;
 return {id:`r-${provider}-${capability}`,state:'preview',fingerprint:'fp',editable:{provider,capability,payload:{model:'m1',prompt,duration:5,references:[{image:'a.png',role:'first_frame'},{image:'b.png',role:'style'}]},provenance:{shot_id:'shot'}},
  snapshot:{provider,capability,model:'m1',endpoint:'https://vendor.invalid/x',body:{prompt,model:'m1',duration:5,ratio:'16:9',seed:7},
   references:[{order:1,role:'first_frame',tag:'hero',mime:'image/png',data:PNG,path:'/media/a.png',source_path:'/media/a-original.png',source_transform:'encoded_reference_bytes_differ',sha256:'h1',byte_length:8},{order:2,role:'style',mime:'image/png',data:PNG,path:'/media/b.png',sha256:'h2',byte_length:8}],quote:{amount:1.2,currency:'USD'}}};
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('manual generation: the final screen hands over prompt and assets',()=>{
 it.each(CASES)('%s/%s shows the full prompt, every asset, Copy and Close, and no Send',async(provider,capability)=>{
  const writeText=vi.fn().mockResolvedValue();vi.stubGlobal('navigator',{...navigator,clipboard:{writeText}});
  const r=review(provider,capability),request=vi.fn().mockResolvedValue({}),send=vi.fn(),cancel=vi.fn();
  render(<FinalRequestReviewDialog initialReview={r} onSend={send} onCancel={cancel} request={request}/>);
  expect(screen.queryByRole('button',{name:/send|approve/i})).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByLabelText('Prompt to copy').textContent).toBe(r.snapshot.body.prompt);
  const assets=screen.getByRole('list',{name:'Assets to upload'});
  expect(assets.querySelectorAll('li')).toHaveLength(2);
  expect(assets.textContent).toContain('/media/a-original.png');expect(assets.textContent).toContain('/media/b.png');expect(assets.textContent).toContain('first_frame');
  expect(screen.getAllByRole('link',{name:/Download asset/})).toHaveLength(2);
  expect(assets.textContent).toContain('@hero');
  expect(screen.getByRole('link',{name:'Download asset 1'}).getAttribute('download')).toBe('01-hero.png');
  window.__feFinalReviewBase=()=>'/film';
  const blob=vi.fn().mockResolvedValue(new Blob(['ORIGINAL'])),fetchSpy=vi.fn().mockResolvedValue({ok:true,blob});vi.stubGlobal('fetch',fetchSpy);
  URL.createObjectURL=vi.fn(()=>'blob:original');URL.revokeObjectURL=vi.fn();
  expect(screen.getAllByRole('button',{name:/Download original/})).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'Download original of asset 1'}));
  await waitFor(()=>expect(fetchSpy).toHaveBeenCalledWith(`/film/final-request-review/${r.id}/references/1/original`));
  delete window.__feFinalReviewBase;
  fireEvent.click(screen.getByRole('button',{name:'Copy prompt, settings & asset list'}));
  await waitFor(()=>expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/ASSETS \(in order\)\n1\. @hero first_frame[^\n]*\n2\. style/)));
  fireEvent.click(screen.getByRole('button',{name:'Copy prompt'}));
  await waitFor(()=>expect(writeText).toHaveBeenCalledWith(r.snapshot.body.prompt));
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  await waitFor(()=>expect(cancel).toHaveBeenCalled());
  expect(request.mock.calls.some(([path])=>/\/approve$/.test(path))).toBe(false);
  expect(send).not.toHaveBeenCalled();
 });
 it.each([[0,3],[1,3],[2,3]])('batch item %i of %i offers Previous/Next where there is one and Close everywhere',async(index,total)=>{
  const r={...review('runway','video'),review_position:{index,total}},send=vi.fn(),cancel=vi.fn();
  render(<FinalRequestReviewDialog initialReview={r} onSend={send} onCancel={cancel} request={vi.fn().mockResolvedValue({})}/>);
  expect(screen.getByRole('heading',{level:2}).textContent).toContain(`(${index+1} of ${total})`);
  const previous=screen.queryByRole('button',{name:'Previous item'}),next=screen.queryByRole('button',{name:'Next item'});
  expect(Boolean(previous)).toBe(index>0);expect(Boolean(next)).toBe(index<total-1);
  if(next){fireEvent.click(next);expect(send).toHaveBeenLastCalledWith({__manual_nav:'next'});}
  if(previous){fireEvent.click(previous);expect(send).toHaveBeenLastCalledWith({__manual_nav:'previous'});}
  expect(screen.getByRole('button',{name:'Close'})).toBeTruthy();
 });
 it('a review announced inside a streamed event opens once, with its prompt, and Close settles it',async()=>{
  window.__feFinalReviewBase=()=>'/film';
  const r=review('elevenlabs','music');
  const transport=vi.fn(async url=>({ok:true,json:async()=>String(url).endsWith('/cancel')?{}:{...r,id:'streamed'}}));vi.stubGlobal('fetch',transport);
  render(<FinalRequestReview/>);
  window.__feObserveFinalRequestState({type:'music_failed',scene_id:'s1',error:'FINAL_REQUEST_REVIEW_REQUIRED:streamed'});
  window.__feObserveFinalRequestState({type:'music_failed',scene_id:'s1',error:'FINAL_REQUEST_REVIEW_REQUIRED:streamed'});
  // A listing that carries an old job's marker (no event type) opens nothing.
  window.__feObserveFinalRequestState({jobs:[{status:'failed',error_message:'FINAL_REQUEST_REVIEW_REQUIRED:old-job'}]});
  expect((await screen.findByLabelText('Prompt to copy')).textContent).toBe(r.snapshot.body.prompt);
  expect(transport.mock.calls.filter(([u])=>String(u).endsWith('/final-request-review/streamed')).length).toBe(1);
  expect(transport.mock.calls.some(([u])=>String(u).includes('old-job'))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  delete window.__feFinalReviewBase;
 });
 it('every review a stream announces opens once and is cancelled once, in order, through the queued dialog',async()=>{
  window.__feFinalReviewBase=()=>'/film';
  const ids=Array.from({length:14},(_,i)=>'stream-'+i);
  const transport=vi.fn(async url=>{const u=String(url),id=u.split('/final-request-review/')[1].split('/')[0];
   if(u.endsWith('/original'))return {ok:true,blob:async()=>new Blob(['orig'])};
   return {ok:true,json:async()=>u.endsWith('/cancel')?{state:'cancelled'}:{...review('elevenlabs','music'),id,snapshot:{...review('elevenlabs','music').snapshot,body:{prompt:'prompt '+id}}}};});
  vi.stubGlobal('fetch',transport);
  render(<FinalRequestReview/>);
  // A music batch stream: each scene's event names its review; some events repeat.
  for(const id of ids){window.__feObserveFinalRequestState({type:'music_failed',error:'FINAL_REQUEST_REVIEW_REQUIRED:'+id});window.__feObserveFinalRequestState({type:'progress',note:'FINAL_REQUEST_REVIEW_REQUIRED:'+id});}
  const seen=[];
  for(let i=0;i<ids.length;i++){
   await waitFor(()=>expect(screen.getByRole('dialog').dataset.review).toBe(ids[i]));
   seen.push(screen.getByLabelText('Prompt to copy').textContent);
   // Its assets are downloadable from the configured backend base, for this review.
   expect(screen.getAllByRole('button',{name:/Download original/})).toHaveLength(2);
   URL.createObjectURL=vi.fn(()=>'blob:x');URL.revokeObjectURL=vi.fn();
   fireEvent.click(screen.getByRole('button',{name:'Download original of asset 1'}));
   await waitFor(()=>expect(transport.mock.calls.some(([u])=>String(u)===`/film/final-request-review/${ids[i]}/references/1/original`)).toBe(true));
   fireEvent.click(screen.getByRole('button',{name:'Close'}));
   await waitFor(()=>expect(transport.mock.calls.some(([u])=>String(u).endsWith(`/final-request-review/${ids[i]}/cancel`))).toBe(true));
  }
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect(seen).toEqual(ids.map(id=>'prompt '+id));
  for(const id of ids){
   expect(transport.mock.calls.filter(([u])=>String(u).endsWith(`/final-request-review/${id}`)).length,id+' opened once').toBe(1);
   expect(transport.mock.calls.filter(([u])=>String(u).endsWith(`/final-request-review/${id}/cancel`)).length,id+' cancelled once').toBe(1);
  }
  delete window.__feFinalReviewBase;
 });
 it('a multi-shot request hands over every shot prompt, in order, with its duration',()=>{
  const r=review('runway','video');r.snapshot.body={model:'gen4_turbo',mode:'custom',shots:[{prompt:'Wide: rain on the neon street',duration:4},{prompt:'Close: her eyes catch the light',duration:3}]};
  render(<FinalRequestReviewDialog initialReview={r} onSend={()=>{}} onCancel={()=>{}} request={vi.fn()}/>);
  expect(screen.getByLabelText('Prompt to copy').textContent).toBe('Shot 1 (4s): Wide: rain on the neon street\nShot 2 (3s): Close: her eyes catch the light');
 });
});
