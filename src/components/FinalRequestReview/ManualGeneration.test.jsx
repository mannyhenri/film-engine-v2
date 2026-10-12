import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {FinalRequestReviewDialog} from './FinalRequestReview.jsx';

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
   references:[{order:1,role:'first_frame',mime:'image/png',data:PNG,path:'/media/a.png',sha256:'h1',byte_length:8},{order:2,role:'style',mime:'image/png',data:PNG,path:'/media/b.png',sha256:'h2',byte_length:8}],quote:{amount:1.2,currency:'USD'}}};
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
  expect(assets.textContent).toContain('/media/a.png');expect(assets.textContent).toContain('first_frame');
  expect(screen.getAllByRole('link',{name:/Download asset/})).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'Copy prompt'}));
  await waitFor(()=>expect(writeText).toHaveBeenCalledWith(r.snapshot.body.prompt));
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  await waitFor(()=>expect(cancel).toHaveBeenCalled());
  expect(request.mock.calls.some(([path])=>/\/approve$/.test(path))).toBe(false);
  expect(send).not.toHaveBeenCalled();
 });
});
