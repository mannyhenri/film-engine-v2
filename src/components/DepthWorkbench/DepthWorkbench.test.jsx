import {it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import DepthWorkbench from './DepthWorkbench.jsx';
import {resetProjectEpoch,noteOpenProject} from '../../lib/project-epoch.js';
import {buildLineageGraph} from '../../pages/productiongraph/lineage-model.js';
import {depthWireAllowed} from '../../pages/productiongraph/depth-nodes.js';
const bridge=vi.hoisted(()=>({state:{currentProject:{id:'p'}},api:vi.fn(),mediaUrl:x=>x}));vi.mock('../../lib/legacy.js',()=>({legacy:bridge}));
const source={asset_id:'video',fingerprint:'source-fingerprint',file_name:'synthetic.mp4',timing:{width:32,height:48,frame_count:6,fps:{numerator:24000,denominator:1001},variable_frame_rate:false}};
let nodes,backend;
beforeEach(()=>{bridge.api.mockClear();resetProjectEpoch();bridge.state.currentProject={id:'p'};window.state=bridge.state;noteOpenProject();nodes=[];backend={available:true,fixture:true,provider:'fixture',model:'gradient',revision:'test',model_sha256:'0'.repeat(64)};
 bridge.api.mockImplementation(async(url,options={})=>{const b=options.body?JSON.parse(options.body):{};
  if(url==='/projects/p/production-depth')return {backend,sources:[{id:'video',file_name:'synthetic.mp4',version:1}],nodes};
  if(url.endsWith('/inspect'))return source;
  if(url.endsWith('/nodes')&&options.method==='POST'){nodes=[{id:'n',revision:1,source,settings:{start_frame:b.start_frame,end_frame_exclusive:b.end_frame_exclusive,model_input_size:b.model_input_size,device:b.device},versions:[],jobs:[]}];return nodes[0];}
  if(url.endsWith('/plan'))return {plan_fingerprint:'reviewed-plan',estimated_raw_bytes:24576,request:{mode:b.mode,width:32,height:48,timing:{frame_count:4},settings:nodes[0].settings}};
  if(url.endsWith('/execute')){expect(b.plan_fingerprint).toBe('reviewed-plan');nodes[0].jobs=[{id:'job',mode:b.mode,status:'running',progress:.2,phase:'Testing transport'}];return nodes[0].jobs[0];}
  throw Error('Unexpected route '+url);
 });
});
it('a missing production worker is visible and never dispatches a depth request',async()=>{
 backend={available:false,reason:'Depth backend unavailable. Configuration required.'};render(<DepthWorkbench/>);fireEvent.click(screen.getByText('Depth Map'));await screen.findByText(/Configuration required/);expect(screen.queryByText('Run reviewed depth plan')).toBeNull();expect(bridge.api.mock.calls.every(([url])=>!url.endsWith('/execute'))).toBe(true);
});
it('the author inspects a source, saves a node and explicitly reviews the bound execution plan',async()=>{
 render(<DepthWorkbench/>);fireEvent.click(screen.getByText('Depth Map'));await screen.findByText(/SYNTHETIC TEST ADAPTER/);fireEvent.change(screen.getByLabelText('Source video'),{target:{value:'video'}});fireEvent.click(screen.getByText('Inspect source frames'));await screen.findByText(/24000\/1001 fps/);fireEvent.change(screen.getByLabelText('First frame (0-based)'),{target:{value:'1'}});fireEvent.change(screen.getByLabelText('End frame (exclusive)'),{target:{value:'5'}});fireEvent.click(screen.getByText('Create Depth Map node'));await screen.findByText('Review depth plan');
 fireEvent.change(screen.getByLabelText('End frame (exclusive)'),{target:{value:'4'}});expect(screen.getByText('Review depth plan').disabled).toBe(true);fireEvent.change(screen.getByLabelText('End frame (exclusive)'),{target:{value:'5'}});
 fireEvent.change(screen.getByLabelText('Depth output'),{target:{value:'full'}});fireEvent.click(screen.getByText('Review depth plan'));await screen.findByText('Run reviewed depth plan');fireEvent.click(screen.getByText('Run reviewed depth plan'));await screen.findByText('full · running');expect(bridge.api.mock.calls.find(([u])=>u.endsWith('/execute'))[1].refresh).toBe(false);
});
it('project switch closes review and discards a late source result',async()=>{
 let done;const ordinary=bridge.api.getMockImplementation();bridge.api.mockImplementation((url,opts)=>url.endsWith('/inspect')?new Promise(resolve=>done=resolve):ordinary(url,opts));render(<DepthWorkbench/>);fireEvent.click(screen.getByText('Depth Map'));await screen.findByText(/SYNTHETIC TEST ADAPTER/);fireEvent.change(screen.getByLabelText('Source video'),{target:{value:'video'}});fireEvent.click(screen.getByText('Inspect source frames'));bridge.state.currentProject={id:'other'};noteOpenProject('other');done(source);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(bridge.api.mock.calls.every(([url])=>!url.endsWith('/nodes'))).toBe(true);
});
it('typed canvas nodes retain geometry without invented generative recipes; depth cannot be wired as an alpha/video reference',()=>{
 const source={key:'depth-source:a',type:'depth-source',asset_id:'v',w:260,h:220},map={key:'depth:b',type:'depth-map',id:'b',w:280,h:240},raw={key:'depth-output:c',type:'depth-output',parent:map.key,w:260,h:220};
 const graph=buildLineageGraph({nodes:[source,map,raw],edges:[],groups:[{id:'depth-group:a',rows:[source.key,map.key],members:[source.key,map.key,raw.key],x:20,y:20}],workspace_geometry:{nodes:{[map.key]:{x:1000,y:100,pinned:true}}}});
 expect(graph.nodes.some(n=>n.type==='draft-request')).toBe(false);expect(graph.nodes.find(n=>n.key===map.key)).toMatchObject({x:1000,y:100,pinned:true});expect(depthWireAllowed(source,map,'source','video')).toBe(true);expect(depthWireAllowed(raw,map,'source','video')).toBe(false);expect(depthWireAllowed(raw,{type:'draft-request'},'in','depth')).toBe(false);
});

it('model detail is explicit in the saved revision and changing it invalidates plan review',async()=>{
 render(<DepthWorkbench/>);fireEvent.click(screen.getByText('Depth Map'));await screen.findByText(/SYNTHETIC TEST ADAPTER/);
 fireEvent.change(screen.getByLabelText('Source video'),{target:{value:'video'}});fireEvent.click(screen.getByText('Inspect source frames'));await screen.findByLabelText('Model detail');
 fireEvent.change(screen.getByLabelText('Model detail'),{target:{value:'128'}});fireEvent.click(screen.getByText('Create Depth Map node'));await screen.findByText('Review depth plan');
 expect(JSON.parse(bridge.api.mock.calls.find(([url,opts])=>url.endsWith('/nodes')&&opts.method==='POST')[1].body).model_input_size).toBe(128);
 fireEvent.click(screen.getByText('Review depth plan'));await screen.findByText('Run reviewed depth plan');
 fireEvent.change(screen.getByLabelText('Model detail'),{target:{value:'256'}});expect(screen.queryByText('Run reviewed depth plan')).toBeNull();expect(screen.getByText('Review depth plan').disabled).toBe(true);
 expect(bridge.api.mock.calls.every(([url])=>!url.endsWith('/execute'))).toBe(true);
});
it('opening an existing node preserves its stored model detail and uses MP4 native orientation',async()=>{
 const rotated={...source,timing:{...source.timing,display_rotation_degrees:-90,display_width:48,display_height:32}};
 nodes=[{id:'n',revision:3,source:rotated,settings:{start_frame:0,end_frame_exclusive:6,model_input_size:518},jobs:[],versions:[{id:'v',version:1,role:'authoritative',preview_url:'/depth.mp4',files:{width:32,height:48,frame_count:6},request:{source_version:1},orientation:{display_rotation_degrees:-90,display_width:48,display_height:32}}]}];
 render(<DepthWorkbench/>);fireEvent.click(screen.getByText('Depth Map'));await screen.findByText(/SYNTHETIC TEST ADAPTER/);fireEvent.change(screen.getByLabelText('Saved depth node'),{target:{value:'n'}});
 expect(screen.getByLabelText('Model detail').value).toBe('518');expect(screen.getByText(/Display video is upright at 48 × 32/)).toBeTruthy();
 const video=document.querySelector('video');expect(video.getAttribute('src')).toBe('/depth.mp4');expect(video.style.transform).toBe('');
 expect(bridge.api.mock.calls.every(([url,opts])=>!opts?.method||opts.method==='GET')).toBe(true);
});

it('local Small depth is marked experimental with quality review pending',async()=>{
 backend={...backend,fixture:false,provider:'gridlight-local',model:'Video-Depth-Anything-Small'};
 render(<DepthWorkbench/>);fireEvent.click(screen.getByText('Depth Map'));await screen.findByText(/Experimental local Small depth preview/);
 expect(screen.getByRole('status').textContent).toContain('quality review pending');expect(bridge.api.mock.calls.every(([url])=>!url.endsWith('/execute'))).toBe(true);
});

it('new depth nodes require MPS and preserve the balanced model default in the reviewed revision',async()=>{
 render(<DepthWorkbench/>);fireEvent.click(screen.getByText('Depth Map'));await screen.findByText(/SYNTHETIC TEST ADAPTER/);
 fireEvent.change(screen.getByLabelText('Source video'),{target:{value:'video'}});fireEvent.click(screen.getByText('Inspect source frames'));await screen.findByLabelText('Model detail');
 expect(screen.getByLabelText('Model detail').value).toBe('384');expect(screen.getByText(/No CPU neural fallback/)).toBeTruthy();
 fireEvent.click(screen.getByText('Create Depth Map node'));await screen.findByText('Review depth plan');
 const b=JSON.parse(bridge.api.mock.calls.find(([url,opts])=>url.endsWith('/nodes')&&opts.method==='POST')[1].body);expect(b).toMatchObject({model_input_size:384,device:'mps'});
});
