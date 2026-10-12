import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildLineageGraph, layoutLineageGraph, nodeFootprint, WORKSPACE_SPACING, lineageFacts, recipeFromLineage, editReference, replaceDraftRecipe, audioAt, timelineTiles, createAudioScheduler } from './lineage-model.js';
import { render, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ProductionGraphPage from './ProductionGraphPage.jsx';
import * as Engine from './engine.js';
import { noteOpenProject, resetProjectEpoch } from '../../lib/project-epoch.js';

const origin = { status: 'recorded', review_id: 'r1', provider: 'seedance', model: 'seedance-2.5', approved: { payload:{prompt:'Approved motion',seed:0,reference_images:[{uri:'data:image/png;base64,AQ==',reference_role:'character'}]},endpoint: 'approved', body: { prompt: 'Approved motion', seed: 0 }, references: [{ role: 'character', wire_role: 'images_list[0]', order: 1, asset_id: 'plate', mime:'image/png',sha256: 'abc', byte_length: 12, data: 'data:image/png;base64,AQ==' }] }, transport: null, unknown: ['transport'] };
function graph() { return { project_id: 'p', running_order: ['a', 'b'], edges: [], groups: [{ key: 'scene:s', scene_id: 's', x: 20, y: 8, layout_x: 20, layout_y: 8, w: 740, h: 500, rows: ['shot:a','shot:b'], members: ['shot:a','shot:b','ver:v'], collapsed: false }], nodes: [{ key:'shot:a', id:'a', type:'shot', scene_id:'s', shot_code:'1A', x:260,y:44,w:200,h:180,frames:[{asset_id:'f',version:1,url:'/f',selected:true}],videos:[{asset_id:'v',version:1,url:'/v',selected:true}] }, { key:'shot:b',id:'b',type:'shot',scene_id:'s',shot_code:'1B',x:260,y:264,w:200,h:180,frames:[{asset_id:'g',version:1,url:'/g'}],videos:[] }, {key:'ver:v',type:'video',asset_id:'v',parent:'shot:a',x:540,y:44,w:200,h:178,url:'/v',version:1} ] }; }
describe('immutable Production lineage and separate editing state', () => {
 it('keeps all ordered inputs on the left and independent histories within spacious owner rows',()=>{
  const source=graph();source.nodes[0].draft={payload:{image:{reference_images:[{asset_id:'one'},{asset_id:'two'}]},video:{init_image:{asset_id:'f'}}}};
  source.nodes[0].frames.push({asset_id:'f2',version:2});source.nodes.push({key:'ver:flow',type:'video',source:'flow',asset_id:'flow',parent:'shot:a',w:260,h:220});source.groups[0].members.push('ver:flow');
  const projected=buildLineageGraph(source,{f:{lineage:origin},flow:{lineage:origin}},{'request:flow':{width:600,height:400}}),by=new Map(projected.nodes.map(n=>[n.key,n])),row=projected.groups[0].shot_rows[0],next=projected.groups[0].shot_rows[1];
  expect(row.members).toContain('request:flow');expect(projected.edges.some(e=>e.from==='request:flow'&&e.to==='ver:flow')).toBe(true);expect(by.get('shot:a').videos).toEqual(source.nodes[0].videos);
  for(const ref of projected.nodes.filter(n=>['origin-reference','draft-reference','link'].includes(n.type)))expect(ref.x+ref.w+WORKSPACE_SPACING.column).toBeLessThanOrEqual(by.get(ref.parent).x);
  expect(next.y-row.y-row.h).toBeGreaterThanOrEqual(70);expect(row.branches.filter(b=>b.label==='Storyboard origin')).toHaveLength(2);expect(row.branches.filter(b=>b.label==='Footage origin')).toHaveLength(2);
  const nodes=projected.nodes;for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],af=nodeFootprint(a),bf=nodeFootprint(b);expect(a.x+af.w<=b.x||b.x+bf.w<=a.x||a.y+af.h<=b.y||b.y+bf.h<=a.y,`${a.key}/${b.key}`).toBe(true);}
 });
 it('distinguishes recorded zero references from missing historical inputs',()=>{
  const projected=buildLineageGraph(graph(),{f:{lineage:{...origin,approved:{...origin.approved,references:[]}}}});
  expect(projected.nodes.some(n=>n.key==='reference:f:0')).toBe(false);expect(projected.nodes.find(n=>n.key==='reference:g:0').reference).toBe(null);
  for(const references of [undefined,null,{}]){const missing=buildLineageGraph(graph(),{f:{lineage:{...origin,approved:{body:{prompt:'Recorded prompt'},references}}}});expect(missing.nodes.find(n=>n.key==='request:f').prompt).toBe('Recorded prompt');expect(missing.nodes.find(n=>n.key==='reference:f:0').reference).toBe(null);}
 });
 it('duplicate source occurrences retain their own pins through explicit reorder, detach and swap',()=>{
  const source=graph(),owner=source.nodes[0];owner.draft={payload:{image:{reference_images:[{asset_id:'same',reference_role:'character'},{asset_id:'same',reference_role:'style'}]}}};
  const first=buildLineageGraph(source),refs=first.nodes.filter(n=>n.type==='draft-reference');source.workspace_geometry={nodes:{[refs[0].key]:{x:-500,y:1500,pinned:true},[refs[1].key]:{x:-900,y:1800,pinned:true}}};
  owner.draft.payload=editReference(owner.draft.payload,'image','down',0);let projected=buildLineageGraph(source);expect(projected.nodes.find(n=>n.reference?.reference_role==='character')).toMatchObject({key:refs[0].key,x:-500,y:1500});expect(projected.nodes.find(n=>n.reference?.reference_role==='style')).toMatchObject({key:refs[1].key,x:-900,y:1800});
  owner.draft.payload=editReference(owner.draft.payload,'image','detach',0);owner.draft.payload=editReference(owner.draft.payload,'image','swap',0,{asset_id:'replacement',reference_role:'location'});projected=buildLineageGraph(source);expect(projected.nodes.find(n=>n.reference?.asset_id==='replacement')).toMatchObject({key:refs[0].key,x:-500,y:1500});
  owner.draft.payload=editReference(owner.draft.payload,'image','attach',undefined,{asset_id:'replacement'});expect(new Set(buildLineageGraph(source).nodes.filter(n=>n.type==='draft-reference').map(n=>n.key)).size).toBe(2);expect(owner.draft.payload.image.reference_images.some(ref=>Object.hasOwn(ref,'geometry_id'))).toBe(false);
 });
 it('whole recipe JSON edits reconcile duplicate identities by full reference and explicit source',()=>{
  const source=graph(),owner=source.nodes[0];owner.draft={payload:{image:{reference_images:[{asset_id:'same',reference_role:'character'},{asset_id:'same',reference_role:'style'}]}}};
  owner.draft.payload=editReference(owner.draft.payload,'image','down',0);const first=buildLineageGraph(source),refs=first.nodes.filter(n=>n.type==='draft-reference'),character=refs.find(n=>n.reference.reference_role==='character');source.workspace_geometry={nodes:{[character.key]:{x:-400,y:1900,pinned:true}}};
  owner.draft.payload=replaceDraftRecipe(owner.draft.payload,'image',{reference_images:[{reference_role:'character',asset_id:'same'},{reference_role:'style',asset_id:'same'}]});expect(buildLineageGraph(source).nodes.find(n=>n.reference?.reference_role==='character')).toMatchObject({key:character.key,x:-400,y:1900});
  owner.draft.payload=replaceDraftRecipe(owner.draft.payload,'image',{reference_images:[{asset_id:'same',reference_role:'new role'},{asset_id:'same',reference_role:'character'}]});expect(buildLineageGraph(source).nodes.find(n=>n.reference?.reference_role==='character')).toMatchObject({key:character.key,x:-400,y:1900});
  owner.draft.payload.workspace_reference_ids.image=null;expect(()=>buildLineageGraph(source)).not.toThrow();
 });
 it('reference geometry follows its source through reorder, role changes and detach',()=>{
  const source=graph(),owner=source.nodes[0];owner.draft={payload:{image:{reference_images:[{asset_id:'one',reference_role:'character'},{asset_id:'two',reference_role:'style'},{asset_id:'two',reference_role:'mood'}]}}};
  const first=buildLineageGraph(source),refs=first.nodes.filter(n=>n.type==='draft-reference');expect(new Set(refs.map(n=>n.key)).size).toBe(3);
  const one=refs.find(n=>n.reference.asset_id==='one');source.workspace_geometry={nodes:{[one.key]:{x:-900,y:1400,pinned:true}}};owner.draft.payload.image.reference_images.reverse();owner.draft.payload.image.reference_images[2].reference_role='location';
  const reloaded=buildLineageGraph(source),moved=reloaded.nodes.find(n=>n.reference?.asset_id==='one');expect(moved).toMatchObject({key:one.key,x:-900,y:1400,pinned:true});
  owner.draft.payload.image.reference_images.splice(0,1);expect(buildLineageGraph(source).nodes.find(n=>n.reference?.asset_id==='one').key).toBe(one.key);
 });
 it('distinct captured reference orders retain their own geometry after reorder',()=>{
  const source=graph();source.nodes[0].draft={payload:{image:{reference_images:[{captured_reference:{review_id:'R',order:1}},{captured_reference:{review_id:'R',order:2}}]}}};
  const first=buildLineageGraph(source),refs=first.nodes.filter(n=>n.type==='draft-reference');expect(refs[0].key).not.toBe(refs[1].key);
  source.workspace_geometry={nodes:{[refs[0].key]:{x:-400,y:1200,pinned:true},[refs[1].key]:{x:-900,y:1700,pinned:true}}};source.nodes[0].draft.payload.image.reference_images.reverse();
  const again=buildLineageGraph(source);expect(again.nodes.find(n=>n.reference?.captured_reference?.order===1)).toMatchObject({key:refs[0].key,x:-400,y:1200});expect(again.nodes.find(n=>n.reference?.captured_reference?.order===2)).toMatchObject({key:refs[1].key,x:-900,y:1700});
 });
 it('shows native keyframes, audio and video conditioning on the left without confusing them with edit tracks',()=>{
  const source=graph();source.nodes[0].draft={payload:{video:{keyframes:[{uri:'first.png',position:0}],audio_references:[{asset_id:'sound'}],reference_videos:[{asset_id:'movie'}],source_video:'clip.mp4'}}};
  const projected=buildLineageGraph(source),refs=projected.nodes.filter(n=>n.type==='draft-reference');expect(refs).toHaveLength(4);expect(refs.filter(n=>n.kind==='video')).toHaveLength(2);expect(refs.find(n=>n.reference.list==='source_video').reference.uri).toBe('clip.mp4');
  for(const ref of refs)expect(ref.x).toBeLessThan(projected.nodes.find(n=>n.key==='shot:a').x);expect(projected.edges.filter(e=>e.relationship==='draft_reference')).toHaveLength(4);expect(projected.edges.filter(e=>e.relationship==='timeline_audio')).toHaveLength(0);
 });
 it('free synthetic positions expand scene bounds without changing narrative or row ownership',()=>{
  const source=graph();source.workspace_geometry={nodes:{'board:f':{x:-1400,y:-2000,pinned:true},'request:v':{x:3800,y:5000,pinned:true}}};
  const projected=buildLineageGraph(source),group=projected.groups[0];expect(group.x).toBeLessThanOrEqual(-1436);expect(group.y).toBeLessThanOrEqual(-2148);expect(group.x+group.w).toBeGreaterThanOrEqual(3800+250+36);expect(group.y+group.h).toBeGreaterThanOrEqual(5000+216+36);
  expect(group.shot_rows[0].outliers).toContain('board:f');expect(group.shot_rows[0].members).toContain('request:v');expect(projected.running_order).toEqual(source.running_order);expect(group.shot_rows[1].members).not.toContain('board:f');
  const saved=structuredClone(projected.nodes.find(n=>n.key==='board:f'));layoutLineageGraph(projected,{'request:v':{width:900,height:900}});expect(projected.nodes.find(n=>n.key==='board:f')).toEqual(saved);expect(group.x+group.w).toBeGreaterThanOrEqual(3800+900+36);
 });
 it('classifies real sequence links and in-between records in their owner work area',()=>{
  const source=graph();source.nodes.push({key:'seq:s',id:'s',type:'sequence',frames:[],videos:[],shot_ids:['a','b'],sequence_ids:[],w:300,h:720},{key:'link:s:start',type:'link',sequence_id:'s',w:216,h:168},{key:'ib:x',type:'inbetween',from_shot_id:'a',to_shot_id:'b',w:400,h:180});source.groups[0].members.push('seq:s','link:s:start','ib:x');source.groups[0].rows.push('seq:s');
  const g=buildLineageGraph(source),by=new Map(g.nodes.map(n=>[n.key,n]));expect(g.groups[0].shot_rows[0].members).toContain('ib:x');expect(g.groups[0].shot_rows[2].members).toContain('link:s:start');expect(by.get('link:s:start').x).toBeLessThan(by.get('seq:s').x);expect(by.get('ib:x').x).toBeGreaterThan(by.get('shot:a').x);
 });
 it('keeps explicit scene/node placements and reserves pinned empty sound output boxes',()=>{
  const source=graph();source.nodes[0].frames=[];
  source.nodes.push({key:'sound:x',type:'sound',pinned:true,x:600,y:76,w:200,h:130,versions:[]});source.groups[0].members.push('sound:x');
  const projected=buildLineageGraph(source,{}, {'sound:x:empty':{width:180,height:300}}),ref=projected.nodes.find(n=>n.key==='reference:v:0');
  expect(ref.y).toBeGreaterThanOrEqual(76+300+24);expect(projected.nodes.find(n=>n.key==='sound:x')).toMatchObject({x:600,y:76,pinned:true});
  source.groups[0].manual_position=true;source.groups[0].layout_x=1400;source.groups[0].layout_y=900;source.groups[0].minimum_h=4000;
  const moved=buildLineageGraph(source);expect(moved.groups[0]).toMatchObject({layout_x:1400,layout_y:900});expect(moved.groups[0].h).toBeGreaterThanOrEqual(4000);
 });
 it('stacks auxiliary empty sound slots by their complete measured footprint',()=>{
  const source=graph();for(const id of ['x','y']){source.nodes.push({key:'sound:'+id,type:'sound',parent:'shot:a',x:600,y:76,w:200,h:130,versions:[]});source.groups[0].members.push('sound:'+id);}
  const projected=buildLineageGraph(source,{}, {'sound:x:empty':{width:180,height:300},'sound:y:empty':{width:180,height:300}});
  expect(projected.nodes.find(n=>n.key==='sound:y').y).toBeGreaterThanOrEqual(projected.nodes.find(n=>n.key==='sound:x').y+300+12);
 });
 it('stacks whole legacy scenes after dense histories, variable measured boxes and ancillary outputs',()=>{
  const source=graph();source.nodes[0].frames.push({asset_id:'f2',version:2});
  source.nodes.push({key:'audio:x',type:'audio',parent:'shot:a',w:180,h:110,x:540,y:44},{key:'audio:y',type:'audio',parent:'shot:a',w:180,h:110,x:540,y:44});
  source.groups[0].members.push('audio:x','audio:y');
  source.nodes.push({key:'shot:c',id:'c',type:'shot',scene_id:'t',frames:[],videos:[],x:1300,y:44,w:200,h:180});
  source.groups.push({key:'scene:t',scene_id:'t',x:1100,y:8,layout_x:1100,layout_y:8,w:740,h:500,rows:['shot:c'],members:['shot:c']});
  const dense={...origin,approved:{...origin.approved,references:Array.from({length:12},(_,i)=>({...origin.approved.references[0],order:i+1}))}};
  const sizes={'request:f':{width:230,height:370},'reference:f:0':{width:180,height:90},'shot:b':{width:200,height:410}};
  const projected=buildLineageGraph(source,{f:{lineage:dense}},sizes);
  expect(projected.groups[0].x).toBe(projected.groups[1].x);
  expect(projected.groups[1].y).toBeGreaterThanOrEqual(projected.groups[0].y+projected.groups[0].h+48);
  for(const group of projected.groups){const nodes=projected.nodes.filter(n=>group.members.includes(n.key));for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];expect(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,`${a.key} overlaps ${b.key}`).toBe(true);}}
  expect(projected.running_order).toEqual(source.running_order);expect(buildLineageGraph(source,{f:{lineage:dense}},sizes)).toEqual(projected);
  const expanded=structuredClone(source);expanded.nodes[0].frames.push({asset_id:'f3',version:3});expect(buildLineageGraph(expanded,{f:{lineage:dense}},sizes).groups[1].y).toBeGreaterThan(projected.groups[1].y);
 });
 it('bounds provenance reads for long histories and preserves asset order and unknown failures', async () => {
  resetProjectEpoch();
  const ids=Array.from({length:18},(_,i)=>`history-${i}`), pending=[];let active=0,max=0;
  const routes=Object.fromEntries(ids.map(id=>[`GET /assets/${id}/provenance`,()=>new Promise((resolve,reject)=>{active++;max=Math.max(max,active);pending.push(()=>{active--;id==='history-5'?reject(new Error('missing evidence')):resolve({recipe:{id}});});})]));
  installLegacy({routes,project:{id:'p'}});
  const reading=Engine.pgReadOrigins({nodes:[{frames:ids.map(asset_id=>({asset_id}))}]},Engine.pgContext());
  while(pending.length || active){const batch=pending.splice(0);batch.reverse().forEach(release=>release());await Promise.resolve();await Promise.resolve();await Promise.resolve();}
  const results=await reading;
  expect(max).toBe(4);expect(Object.keys(results)).toEqual(ids);expect(results['history-5'].lineage.unknown).toEqual(['provenance_read_failed']);
 });
 it('projects every version in vertical scene rows with stable identities and keeps narrative order', () => {
  const source=graph(), projected=buildLineageGraph(source,{f:{lineage:origin},v:{lineage:{...origin,review_id:'r2',transport:{state:'attempted',endpoint:'sent',body:{prompt:'Actual motion'},references:[]}}}});
  expect(source.nodes).toHaveLength(3); expect(projected.running_order).toEqual(['a','b']);
  expect(projected.nodes.find(n=>n.key==='board:f').asset_id).toBe('f');
  expect(projected.nodes.find(n=>n.key==='request:v').prompt).toBe('Actual motion');
  expect(projected.nodes.find(n=>n.key==='shot:b').y).toBeGreaterThan(projected.nodes.find(n=>n.key==='board:f').y+180);
  expect(projected.groups[0].members).toContain('reference:f:0');
  expect(projected.edges.some(e=>e.from==='reference:f:0'&&e.to==='request:f')).toBe(true);
  expect(projected.edges.some(e=>e.from==='request:v'&&e.to==='ver:v')).toBe(true);
  expect(buildLineageGraph(source,{}).nodes.find(n=>n.key==='request:g').status).toBe('legacy_unknown');
 });
 it('never calls the approved representation sent when transport is missing', () => {
  expect(lineageFacts(origin)).toMatchObject({prompt:'Approved motion',representation:'Approved snapshot · transport not recorded',sent:false});
  expect(lineageFacts({status:'legacy_unknown'}).prompt).toBe(null);
 });
 it('preserves provider input settings and special keyframes for Google, OpenAI and Seedance reruns',()=>{
  const variants=[{provider:'google',payload:{prompt:'Google',parameters:{sampleCount:2,aspectRatio:'16:9'},width:1920}},{provider:'openai',payload:{prompt:'OpenAI',size:'1536x1024',quality:'high'}},{provider:'seedance',payload:{prompt:'Seedance',workflow:'omni-reference',seed:0,keyframes:[{uri:'data:image/png;base64,AQ==',position:0,reference_role:'first_frame'}]}}];
  for(const variant of variants){const recipe=recipeFromLineage({...origin,provider:variant.provider,approved:{...origin.approved,payload:variant.payload}});if(variant.payload.keyframes)expect(recipe.keyframes[0]).toMatchObject({position:0,reference_role:'first_frame',captured_reference:{review_id:'r1',order:1}});for(const [key,value] of Object.entries(variant.payload))if(!['prompt','keyframes'].includes(key))expect(recipe.settings[key]).toEqual(value);}
  expect(()=>recipeFromLineage({...origin,approved:{...origin.approved,payload:{prompt:'X',reference_images:[{uri:'unrecorded'}]}}})).toThrow(/cannot be mapped/);
 });
 it('copies recorded bytes into a new recipe, preserving seed zero and independent image/video payloads', () => {
  const recipe=recipeFromLineage(origin);expect(recipe.settings.seed).toBe(0);expect(recipe.reference_images[0].captured_reference).toEqual({review_id:'r1',order:1});
  const source={image:{prompt:'Picture',reference_images:[{asset_id:'x'},{asset_id:'y'}]},video:{prompt:'Motion'}};
  const swapped=editReference(source,'image','swap',0,{asset_id:'z'});expect(swapped.image.reference_images[0].asset_id).toBe('z');expect(source.image.reference_images[0].asset_id).toBe('x');expect(swapped.video).toEqual(source.video);
  expect(editReference(swapped,'image','detach',1).image.reference_images).toHaveLength(1);
 });
 it('keeps the native per-shot prompt list instead of inventing one sequence prompt',()=>{
  const shots=[{prompt:'First shot',duration:4},{prompt:'Second shot',duration:6}];
  const recipe=recipeFromLineage({...origin,provider:'runway',approved:{...origin.approved,body:{shots},payload:{runway_recipe:'multi_shot_video',shots,aspectRatio:'16:9'}}});
  expect(recipe.prompt_format).toBe('native_shots_json');expect(JSON.parse(recipe.prompt)).toEqual(shots);expect(recipe.settings.runway_recipe).toBe('multi_shot_video');
 });
 it('shows recorded native per-shot prompts as JSON on the immutable request card',()=>{
  installLegacy();
  const shots=[{prompt:'First shot',duration:4},{prompt:'Second shot',duration:6}],lineage={...origin,approved:{...origin.approved,body:{shots}}};
  expect(lineageFacts(lineage)).toMatchObject({prompt_format:'native_shots_json',prompt:JSON.stringify(shots,null,2)});
  const html=Engine.pgOriginNodeHtml({key:'request:x',type:'origin-request',kind:'video',lineage},'','');expect(html).toContain('Per-shot native prompts and durations (JSON)');expect(html).toContain('First shot');expect(html).not.toContain('Exact request was not recorded');
 });
 it('reads recorded Google instances and input prompt aliases without claiming unrecorded text',()=>{
  for(const body of [{instances:[{prompt:'Google instances'}]},{input:{prompt:'Google input'}},{input:{promptText:'Google input text'}}])expect(lineageFacts({...origin,approved:{...origin.approved,body}}).prompt).toMatch(/^Google /);
 });
 it('shows the exact Google text-part request including its folded negative prompt',()=>{
  installLegacy();
  const prompt='A wet station at night.\n\nAvoid: daytime and crowds';
  const lineage={...origin,provider:'google',approved:{...origin.approved,body:{input:[{type:'text',text:prompt}]},payload:{prompt:'A wet station at night.',negative_prompt:'daytime and crowds'},references:[]}};
  expect(lineageFacts(lineage).prompt).toBe(prompt);expect(recipeFromLineage(lineage).prompt).toBe(prompt);
  expect(Engine.pgOriginNodeHtml({type:'origin-request',kind:'image',lineage},'','')).toContain('Avoid: daytime and crowds');
 });
});
describe('Production interactions retain their project and editing owner',()=>{
 let fake,view;
 beforeEach(()=>{resetProjectEpoch();vi.spyOn(window,'requestAnimationFrame').mockImplementation(()=>1);vi.spyOn(window.HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(window.HTMLMediaElement.prototype,'play').mockImplementation(()=>Promise.resolve());});
 afterEach(()=>{view?.unmount();view=null;vi.restoreAllMocks();resetProjectEpoch();});
 function mount(routes={}){
  const source=graph();source.nodes.forEach(n=>{n.frames ||= [];n.videos ||= [];n.previs={};});
  ({fake}=installLegacy({routes:{'GET /projects/p/production-graph':source,'GET /assets/f/provenance':{recipe:{lineage:origin}},'GET /assets/g/provenance':{},'GET /assets/v/provenance':{},'GET /projects/p/timeline':{entries:[],audio_tracks:[]},...routes},project:{id:'p'}}));
  fake.state.currentPage='productiongraph';fake.PG.graph=null;fake.PG.fitted=true;fake.PG.busy=new Map();fake.PG.running=new Map();fake.PG.picked=new Set();fake.PG.sel=null;fake.PG.drawerCache={};fake.PG.inflight=null;fake.PG.layoutUndo=null;fake.PG.layoutAction=null;fake.PG.graphGeneration=0;
  view=render(<ProductionGraphPage/>);return source;
 }
 it('uses actual border-box measurements and reflows late media without layout writes',async()=>{
  const source=graph();source.groups.push({key:'scene:t',x:1100,y:8,layout_x:1100,layout_y:8,w:740,h:500,rows:['shot:c'],members:['shot:c']});source.nodes.push({key:'shot:c',type:'shot',id:'c',scene_id:'t',shot_code:'2A',frames:[],videos:[],x:1300,y:44,w:200,h:180,previs:{}});
  const heights={};vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockImplementation(function(){return parseFloat(this.style.width) || 0;});vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockImplementation(function(){return heights[this.dataset.key] || parseFloat(this.style.minHeight || this.style.height) || 0;});
  mount({'GET /projects/p/production-graph':source});await act(()=>Engine.loadProductionGraph());const before=fake.PG.graph.groups[1].y;
  heights['request:f']=420;heights['shot:b']=390;fireEvent.load(document.querySelector('[data-key="board:f"] img'));
  expect(fake.PG.byKey.get('request:f').h).toBe(420);expect(fake.PG.graph.groups[1].y).toBeGreaterThan(before);
  expect(parseFloat(document.querySelector('[data-group="scene:t"]').style.top)).toBe(fake.PG.graph.groups[1].y);
  expect(fake.api.mock.calls.some(([url,options])=>url.endsWith('/layout')&&options?.method==='PUT')).toBe(false);
  const after=fake.PG.graph.groups[1].y;heights['request:f']=700;fake.state.currentProject={id:'B'};noteOpenProject();fake.state.currentProject={id:'p'};noteOpenProject();fireEvent.load(document.querySelector('[data-key="board:f"] img'));expect(fake.PG.graph.groups[1].y).toBe(after);
 });
 it('arrangement supersedes an inflight old geometry/provenance load instead of reusing it',async()=>{
  let release,reads=0,origins=0;const old=graph(),fresh=graph();old.groups[0].manual_position=true;old.groups[0].layout_x=3100;fresh.groups[0].manual_position=false;
  mount({'GET /projects/p/production-graph':()=>++reads===1?old:fresh,'GET /assets/f/provenance':()=>++origins===1?new Promise(r=>{release=()=>r({recipe:{lineage:origin}});}):{recipe:{lineage:origin}},'POST /projects/p/production-graph/arrange':{undo:{project_id:'p',nodes:[],groups:[]},layout_fingerprint:'arranged'}});
  const waiting=Engine.loadProductionGraph();for(let i=0;i<10&&!release;i++)await Promise.resolve();
  await act(()=>Engine.pgArrange());expect(reads).toBe(2);expect(fake.PG.graph.groups[0].layout_x).toBe(20);
  await act(async()=>{release();await waiting;});expect(fake.PG.graph.groups[0].layout_x).toBe(20);expect(fake.PG.layoutUndo.fingerprint).toBe('arranged');
 });
 it('double Arrange sends once and A→B→A rejects its late Undo receipt',async()=>{
  let release;const arrange=vi.fn(()=>new Promise(r=>{release=()=>r({undo:{project_id:'p',nodes:[],groups:[]},layout_fingerprint:'old'});}));mount({'POST /projects/p/production-graph/arrange':arrange});await act(()=>Engine.loadProductionGraph());
  const first=Engine.pgArrange();await Engine.pgArrange();expect(arrange).toHaveBeenCalledTimes(1);fake.state.currentProject={id:'B'};noteOpenProject();fake.state.currentProject={id:'p'};noteOpenProject();await act(async()=>{release();await first;});expect(fake.PG.layoutUndo).toBe(null);
 });
 it('Undo sends only the saved workspace receipt and its compare-and-swap fingerprint',async()=>{
  const snapshot={project_id:'p',nodes:[{node_key:'shot:a',x:80,y:100,pinned:1}],groups:[]},writes=[];
  mount({'POST /projects/p/production-graph/arrange':body=>{writes.push(body);return writes.length===1?{undo:snapshot,layout_fingerprint:'after'}:{undo:null};}});await act(()=>Engine.loadProductionGraph());await act(()=>Engine.pgArrange());expect(document.getElementById('pgUndoArrange').hidden).toBe(false);
  await act(()=>Engine.pgArrange(true));expect(writes).toEqual([{}, {undo:snapshot,expected_fingerprint:'after'}]);expect(document.getElementById('pgUndoArrange').hidden).toBe(true);
 });
 it('drags/resizes a whole scene and saves geometry without changing narrative order',async()=>{
  const writes=[];mount({'PUT /projects/p/production-graph/groups/scene%3As':body=>{writes.push(body);return body;}});await act(()=>Engine.loadProductionGraph());
  expect(document.querySelector('.pg-empty').textContent).toBe('');
  const header=document.querySelector('.pg-group-label');
  fireEvent.mouseDown(header,{button:0,clientX:100,clientY:100});fireEvent.mouseMove(window,{clientX:145,clientY:118});await act(async()=>fireEvent.mouseUp(window,{clientX:145,clientY:118}));
  expect(writes[0]).toEqual({x:70,y:40,delta_x:50,delta_y:20});expect(fake.PG.graph.running_order).toEqual(['a','b']);
  const resize=document.querySelector('.pg-group-resize');fireEvent.mouseDown(resize,{button:0,clientX:100,clientY:100});fireEvent.mouseMove(window,{clientX:190,clientY:190});await act(async()=>fireEvent.mouseUp(window,{clientX:190,clientY:190}));
  expect(writes[1].w).toBeGreaterThan(740);expect(writes[1].h).toBeGreaterThan(500);
 });
 it('unmount discards an active drag and removes its window listeners',async()=>{
  const write=vi.fn();mount({'PUT /projects/p/production-graph/groups/scene%3As':write});await act(()=>Engine.loadProductionGraph());fireEvent.mouseDown(document.querySelector('.pg-group-label'),{button:0,clientX:0,clientY:0});view.unmount();view=null;fireEvent.mouseMove(window,{clientX:200,clientY:200});fireEvent.mouseUp(window,{clientX:200,clientY:200});expect(write).not.toHaveBeenCalled();
 });
 it('Focus chooses a visible work area when a scene filter hides the selected owner',async()=>{
  const source=graph();source.nodes.push({key:'shot:c',type:'shot',id:'c',scene_id:'t',shot_code:'2A',frames:[],videos:[],previs:{}});source.groups.push({key:'scene:t',scene_id:'t',rows:['shot:c'],members:['shot:c']});
  mount({'GET /projects/p/production-graph':source});await act(()=>Engine.loadProductionGraph());fake.PG.scene='t';fake.PG.sel='board:f';Engine.pgFocusWorkspace();
  const row=fake.PG.graph.groups[1].shot_rows[0];expect(fake.PG.pan.y).toBe(40-row.y*fake.PG.zoom);expect(Engine.pgWorkspacesHtml()).toContain('2A');expect(Engine.pgWorkspacesHtml()).not.toContain('data-workspace="shot:a"');
 });
 it('inspector JSON reorder preserves reference identities and historical branch resets its old sidecar',async()=>{
  const source=graph(),payload={image:{reference_images:[{asset_id:'A'},{asset_id:'B'}]},workspace_reference_ids:{image:{reference_images:['i11111111-1111-1111-1111-111111111111','i22222222-2222-2222-2222-222222222222']}}};source.nodes[0].draft={revision:1,payload};
  mount({'GET /projects/p/production-graph':source,'GET /projects/p/production-graph/nodes/shot%3Aa/draft':{draft:{revision:1,payload}}});await act(()=>Engine.loadProductionGraph());await act(()=>Engine.pgOpenDraft('shot:a','image'));Engine.pgDraftSettings(JSON.stringify({reference_images:[{asset_id:'B'},{asset_id:'A'}]}));expect(fake.PG.draftEdit.payload.workspace_reference_ids.image.reference_images).toEqual(['i22222222-2222-2222-2222-222222222222','i11111111-1111-1111-1111-111111111111']);
  await act(()=>Engine.pgOpenDraft('shot:a','image','f'));expect(fake.PG.draftEdit.payload.workspace_reference_ids.image).toBeUndefined();expect(fake.PG.draftEdit.payload.image.reference_images[0].captured_reference).toEqual({review_id:'r1',order:1});
 });
 it('persists every projected card geometry and keeps its diagnostic ports usable',async()=>{
  const writes=[],positions={};const source=graph();source.nodes[0].draft={revision:1,payload:{image:{prompt:'Draft',reference_images:[{asset_id:'plate'}]}}};
  mount({'GET /projects/p/production-graph':()=>({...source,workspace_geometry:{nodes:positions}}),'PUT /projects/p/production-graph/layout':body=>{writes.push(body);for(const n of body.nodes)positions[n.key]={...n,pinned:true};return {};}});await act(()=>Engine.loadProductionGraph());
  const draftRef=fake.PG.graph.nodes.find(n=>n.type==='draft-reference').key;
  for(const key of ['board:f','request:f','reference:f:0','draft:shot:a:video',draftRef,'shot:a']){
   const before={...fake.PG.byKey.get(key)},card=document.querySelector(`[data-key="${key}"]`);expect(card.dataset.readonly).toBeUndefined();
   fireEvent.mouseDown(card,{button:0,clientX:20,clientY:20});fireEvent.mouseMove(window,{clientX:92,clientY:83});await act(async()=>fireEvent.mouseUp(window,{clientX:92,clientY:83}));
   expect(writes.at(-1).nodes).toEqual([{key,x:before.x+80,y:before.y+70}]);expect(fake.PG.byKey.get(key)).toMatchObject({x:before.x+80,y:before.y+70,pinned:true});
  }
  expect(writes).toHaveLength(6);expect(document.querySelector('[data-key="board:f"] [data-port="out"]').dataset.dir).toBe('out');
  const count=writes.length;fireEvent.mouseDown(document.querySelector('[data-key="request:f"]'),{button:0,clientX:20,clientY:20});await act(async()=>fireEvent.mouseUp(window,{clientX:21,clientY:21}));expect(writes).toHaveLength(count);expect(fake.PG.sel).toBe('request:f');
 });
 it('saves one CAS snapshot, rejects changed edits during save, and double Send cannot dispatch twice',async()=>{
  let release;const sent=vi.fn(()=>({status:'submitted',job_id:'j'}));mount({'GET /projects/p/production-graph/nodes/shot%3Aa/draft':{draft:{revision:1,payload:{image:{prompt:'Image'},video:{prompt:'Motion'}}}},'PUT /projects/p/production-graph/nodes/shot%3Aa/draft':body=>new Promise(r=>{release=()=>r({draft:{revision:2,payload:body.payload}});}), 'POST /shots/a/video/generate':sent});await act(()=>Engine.loadProductionGraph());
  await act(()=>Engine.pgOpenDraft('shot:a','video'));Engine.pgDraftField('prompt','First edit');const save=Engine.pgSaveDraft();Engine.pgDraftField('prompt','Changed during save');await act(async()=>{release();await save;});expect(fake.PG.draftEdit.dirty).toBe(true);expect(fake.PG.draftEdit.payload.video.prompt).toBe('Changed during save');expect(fake.PG.draftEdit.payload.image.prompt).toBe('Image');
  fake.PG.draftEdit.dirty=false;await act(async()=>Promise.all([Engine.pgGenerateDraft(),Engine.pgGenerateDraft()]));expect(sent).toHaveBeenCalledTimes(1);expect(sent.mock.calls[0][0].production_draft).toEqual({node_key:'shot:a',revision:2});expect(fake.confirmPaidImage).not.toHaveBeenCalled();
 });
 it('A to B to A invalidates a late draft response even though the project id matches again',async()=>{
  let release;mount({'GET /projects/p/production-graph/nodes/shot%3Aa/draft':()=>new Promise(r=>{release=()=>r({draft:{revision:99,payload:{video:{prompt:'Stale A'}}}});})});await act(()=>Engine.loadProductionGraph());noteOpenProject();const read=Engine.pgOpenDraft('shot:a','video');fake.state.currentProject={id:'B'};noteOpenProject();fake.state.currentProject={id:'p'};noteOpenProject();await act(async()=>{release();await read;});expect(fake.PG.draftEdit?.revision).not.toBe(99);
 });
 it('changing the selected node while a save awaits prevents the old generation from dispatching',async()=>{
  let release;const sent=vi.fn();mount({'GET /projects/p/production-graph/nodes/shot%3Aa/draft':{draft:{revision:1,payload:{video:{prompt:'Motion'}}}},'PUT /projects/p/production-graph/nodes/shot%3Aa/draft':body=>new Promise(r=>{release=()=>r({draft:{revision:2,payload:body.payload}});}), 'POST /shots/a/video/generate':sent});await act(()=>Engine.loadProductionGraph());await act(()=>Engine.pgOpenDraft('shot:a','video'));Engine.pgDraftField('prompt','Edited');const generate=Engine.pgGenerateDraft();fake.PG.sel='shot:b';await act(async()=>{release();await generate;});expect(sent).not.toHaveBeenCalled();
 });
 it('labels native per-shot JSON and shows parse errors before saving or reviewing',async()=>{
  const saved=vi.fn(),sent=vi.fn(),recipe={provider:'runway',model:'gen4.5',prompt_format:'native_shots_json',prompt:'[{"prompt":"First","duration":4}]',settings:{runway_recipe:'multi_shot_video'}};
  mount({'GET /projects/p/production-graph/nodes/shot%3Aa/draft':{draft:{revision:1,payload:{video:recipe}}},'PUT /projects/p/production-graph/nodes/shot%3Aa/draft':saved,'POST /shots/a/video/generate':sent});await act(()=>Engine.loadProductionGraph());await act(()=>Engine.pgOpenDraft('shot:a','video'));expect(document.getElementById('pgDrawerBody').textContent).toContain('Per-shot prompts and durations (JSON)');Engine.pgDraftField('prompt','bad JSON');await act(()=>Engine.pgGenerateDraft());expect(fake.setStatus).toHaveBeenCalledWith(expect.stringMatching(/valid JSON list/),true);expect(saved).not.toHaveBeenCalled();expect(sent).not.toHaveBeenCalled();
 });
 it('keeps Leg by leg as one reviewed batch and ignores a concurrent second click',async()=>{
  const releases=[];const sent=vi.fn(()=>new Promise(r=>{releases.push(()=>r({status:'submitted'}));}));mount({'POST /sequences/s/generate':sent});await act(()=>Engine.loadProductionGraph());const sequence={key:'seq:s',id:'s',type:'sequence',name:'Sequence',draft:null,shot_codes:['1A'],videos:[],links:{},x:0,y:0,w:240,h:280};fake.PG.graph.nodes.push(sequence);fake.PG.drawerCache.seqMode='legs';const first=Engine.pgGenerateSequence(sequence),second=Engine.pgGenerateSequence(sequence);await act(async()=>{releases.forEach(release=>release());await Promise.all([first,second]);});expect(sent).toHaveBeenCalledTimes(1);expect(sent.mock.calls[0][0]).toEqual({});expect(fake.confirmPaidImage).not.toHaveBeenCalled();
 });
 it('a clicked video dot uses the complete current-source starter and one final-review path',async()=>{
  const sent=vi.fn(()=>({status:'submitted'})),saved=[];
  const recipe={provider:'seedance',model:'seedance-2.5',prompt:'Complete motion',init_image:{asset_id:'f',reference_role:'first_frame'},reference_images:[{asset_id:'plate',reference_role:'character'}],settings:{duration_s:5,seed:0}};
  mount({'GET /projects/p/production-graph/nodes/shot%3Aa/draft':{draft:null},'GET /projects/p/production-graph/nodes/shot%3Aa/draft/starter?kind=video':{recipe,ready:true,unresolved:[],warnings:[]},'PUT /projects/p/production-graph/nodes/shot%3Aa/draft':body=>{saved.push(body);return {draft:{revision:1,payload:body.payload}};},'POST /shots/a/video/generate':sent});await act(()=>Engine.loadProductionGraph());
  const port=document.querySelector('[data-key="shot:a"] [data-port="video"]');fireEvent.mouseDown(port,{button:0,clientX:0,clientY:0});await act(async()=>fireEvent.mouseUp(port,{clientX:0,clientY:0}));
  expect(saved[0].payload.video).toEqual(recipe);expect(sent).toHaveBeenCalledTimes(1);expect(fake.confirmPaidImage).not.toHaveBeenCalled();
 });
 it('canvas image attachment changes a new draft, never the recorded origin',async()=>{
  mount({'GET /projects/p/production-graph/nodes/shot%3Aa/draft':{draft:{revision:1,payload:{video:{provider:'seedance',prompt:'Motion'}}}}});await act(()=>Engine.loadProductionGraph());
  await act(()=>Engine.pgWire({from:'board:f',port:'out',type:'image'},'draft:shot:a:video','in','image'));
  expect(fake.PG.draftEdit.payload.video.init_image).toEqual({asset_id:'f',reference_role:'first_frame'});expect(fake.PG.lineageRecipes.f.lineage.approved.payload.reference_images[0].reference_role).toBe('character');
 });
 it('attaches independent timeline sound without requiring a video provider starter',async()=>{
  const saved=[];
  mount({'GET /projects/p/production-graph/nodes/shot%3Aa/draft':{draft:null,audio_tracks:[]},'GET /projects/p/production-graph/nodes/shot%3Aa/draft/starter?kind=video':()=>{throw new Error('No configured provider');},'PUT /projects/p/production-graph/nodes/shot%3Aa/audio':body=>{saved.push(body);return {tracks:body.tracks};}});
  await act(()=>Engine.loadProductionGraph());fake.PG.graph.nodes.push({key:'sound:x',type:'sound',asset_id:'sound-asset',duration_ms:9000});fake.PG.byKey.set('sound:x',fake.PG.graph.nodes.at(-1));
  await act(()=>Engine.pgSoundChoice('shot:a','sound:x'));
  expect(document.getElementById('pgDrawerBody').textContent).toContain('Independent timeline track');
  await act(()=>Engine.pgAttachChosenSound('sound-asset','timeline'));
  expect(saved[0].tracks[0]).toMatchObject({asset_id:'sound-asset',duration_ms:9000});
  expect(fake.api.mock.calls.some(([path])=>path.includes('/draft/starter'))).toBe(false);
 });
});
describe('selected media and explicit timeline audio',()=>{
 it('holds every image exactly five seconds and leaves video timing unchanged',()=>{expect(timelineTiles({entries:[{kind:'still',duration_ms:800},{kind:'video',duration_ms:7100}]}).map(t=>t.duration_ms)).toEqual([5000,7100]);});
 it('seeks trimmed signed-offset tracks independently from conditioning',()=>{
  const track={absolute_start_ms:1000,timeline_used_duration_ms:2500,effective_source_in_ms:300,gain_db:6,muted:false,source:{path:'/full.wav'}};
  expect(audioAt(track,1500)).toMatchObject({active:true,source_ms:800,gain:Math.pow(10,6/20)});expect(audioAt(track,3500).active).toBe(false);expect(audioAt({...track,muted:true},1500).active).toBe(false);expect(audioAt({...track,source:{offline:true}},1500).reason).toBe('offline');
  for(const status of ['source_changed','outside_cut','unplaced'])expect(audioAt({...track,status},1500).active).toBe(false);
 });
 it('schedules later tracks, seek, gain and end without silently clamping positive gain',()=>{
  vi.useFakeTimers();const media={pause:vi.fn(),play:vi.fn(()=>Promise.resolve()),currentTime:0,volume:1};let now=0;const gain={set:vi.fn(),close:vi.fn()};
  const scheduler=createAudioScheduler({createMedia:()=>media,urlOf:x=>x,now:()=>now,gainFor:()=>gain});
  scheduler.start([{id:'x',absolute_start_ms:1000,timeline_used_duration_ms:2000,effective_source_in_ms:500,gain_db:6,source:{path:'/full.wav'}}],0);
  expect(media.play).not.toHaveBeenCalled();now=1000;vi.advanceTimersByTime(1000);expect(media.currentTime).toBe(.5);expect(gain.set).toHaveBeenCalledWith(Math.pow(10,6/20));expect(media.play).toHaveBeenCalledTimes(1);
  now=3100;vi.advanceTimersByTime(2100);expect(media.pause).toHaveBeenCalled();scheduler.stop();vi.useRealTimers();
 });
});
