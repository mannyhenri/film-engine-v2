import {describe,it,expect,vi} from 'vitest';
import {render,act} from '@testing-library/react';
import {installLegacy} from '../../test/setup.js';
import CharacterSheet from './CharacterSheet.jsx';
const defaults=['Neutral','Fear','Anger','Sadness','Joy','Surprise'];
const slots=()=>defaults.map((label,i)=>({slot_id:`slot-${i+1}`,label,direction:'',revision:0,active_asset_id:null,versions:[]}));
function routes(id,name){return {[`GET /characters/${id}`]:{character:{id,name,appearance_prompt:'Canonical face',description:'Unique biography',personality_notes:'Reserved'}},[`GET /characters/${id}/gallery`]:{items:[]},[`GET /characters/${id}/palette`]:{palette:[]},[`GET /characters/${id}/expressions`]:{slots:slots()}};}
describe('expression sheet target and history',()=>{
 it('draws six empty labeled face slots above consolidated appearance, retaining all four body slots; opening spends nothing',async()=>{
  const {calls}=installLegacy({routes:routes('c1','Creature')});render(<CharacterSheet/>);
  await act(async()=>window.openCharacterSheet('c1'));
  expect(document.querySelectorAll('.cs-expression-slot')).toHaveLength(6);
  expect([...document.querySelectorAll('.cs-expression-slot strong')].map(e=>e.textContent)).toEqual(defaults);
  expect(document.querySelectorAll('.cs-views .cs-plate')).toHaveLength(4);
  const right=document.querySelector('.cs-col-r');expect(right.children[0].className).toBe('cs-expressions');
  expect(document.querySelector('.cs-details').textContent).toContain('Character Description / Appearance');expect(document.querySelector('.cs-details').textContent).toContain('Unique biography');
  expect(calls.every(c=>c.method==='GET')).toBe(true);
 });
 it('late character loads cannot replace the character/slot currently open',async()=>{
  let resolve;const deferred=new Promise(r=>resolve=r);
  installLegacy({routes:{...routes('c1','First'),...routes('c2','Second'),'GET /characters/c1':()=>deferred}});render(<CharacterSheet/>);
  const first=window.openCharacterSheet('c1');await act(async()=>window.openCharacterSheet('c2'));
  await act(async()=>{resolve({character:{id:'c1',name:'First'}});await first;});
  expect(document.getElementById('csName').textContent).toBe('Second');
  expect(document.querySelector('.cs-expression-slot button').getAttribute('onclick')).toContain('c2');
 });
 it('a delayed first A load cannot overwrite a newer A sheet after switching A to B to A',async()=>{
  let resolveOld,readA=0;const old=new Promise(r=>resolveOld=r);
  const newer=slots();newer[0]={...newer[0],label:'New neutral',revision:7};
  installLegacy({routes:{...routes('c1','Current A'),...routes('c2','B'),'GET /characters/c1':()=>++readA===1?old:{character:{id:'c1',name:'Current A'}},'GET /characters/c1/expressions':()=>({slots:readA===1?slots():newer})}});
  render(<CharacterSheet/>);const first=window.openCharacterSheet('c1');
  await act(async()=>window.openCharacterSheet('c2'));await act(async()=>window.openCharacterSheet('c1'));
  await act(async()=>{resolveOld({character:{id:'c1',name:'Outdated A'}});await first;});
  expect(document.getElementById('csName').textContent).toBe('Current A');expect(document.querySelector('.cs-expression-slot strong').textContent).toBe('New neutral');
  expect(document.querySelector('.cs-expression-slot button').getAttribute('onclick')).toMatch(/slot-1.*7/);
 });
 it('an upload still reading after A to B to A cannot write into the reopened sheet',async()=>{
  const {calls}=installLegacy({routes:{...routes('c1','First'),...routes('c2','Second')}});render(<CharacterSheet/>);await act(async()=>window.openCharacterSheet('c1'));
  let reader;class FakeReader{constructor(){reader=this;}readAsDataURL(){}}
  vi.stubGlobal('FileReader',FakeReader);
  const upload=window.uploadExpression('c1','slot-1',0,{name:'face.png',size:10});await act(async()=>window.openCharacterSheet('c2'));
  await act(async()=>window.openCharacterSheet('c1'));
  reader.result='data:image/png;base64,aW1hZ2U=';await act(async()=>{reader.onload();await upload;});
  expect(calls.filter(c=>c.method==='POST')).toHaveLength(0);vi.unstubAllGlobals();
 });
 it('generation carries the captured character and slot revision and never triggers other slots',async()=>{
  let release;const deferred=new Promise(r=>release=r);
  const {calls}=installLegacy({routes:{...routes('c1','First'),...routes('c2','Second'),'POST /characters/c1/expressions/slot-2/generate':()=>deferred}});render(<CharacterSheet/>);await act(async()=>window.openCharacterSheet('c1'));
  const generation=window.generateExpression('c1','slot-2',0);await act(async()=>window.openCharacterSheet('c2'));
  await act(async()=>{release({activated:true});await generation;});
  const posts=calls.filter(c=>c.method==='POST');expect(posts).toHaveLength(1);expect(posts[0]).toMatchObject({path:'/characters/c1/expressions/slot-2/generate',body:{revision:0}});expect(document.getElementById('csName').textContent).toBe('Second');
 });
 it('a manual body-view handoff stops the remaining view loop without claiming generated images',async()=>{
  const {calls}=installLegacy({routes:{...routes('c1','Creature'),'POST /characters/c1/refsheet/generate':{manual_handoff:true,pending:true,handoff_id:'saved-id'}}});
  let confirmation;window.confirmPaidImage=vi.fn(options=>{confirmation=options;});render(<CharacterSheet/>);await act(async()=>window.openCharacterSheet('c1'));
  await act(async()=>window.generateOfficialViews());await act(async()=>confirmation.send({}));
  expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);expect(calls.find(c=>c.method==='POST').body.views).toEqual(['front']);
  expect(window.setStatus.mock.calls.some(c=>/^Generated |view\(s\) generated/.test(c[0]))).toBe(false);
 });
});
