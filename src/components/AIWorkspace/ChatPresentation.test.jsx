// Set-based: every chat surface renders Markdown, streams, styles its buttons, and offers each direct edit target.
import fs from 'node:fs';
import {render,screen,act} from '@testing-library/react';
import {describe,it,expect,afterEach,vi} from 'vitest';
import {legacy} from '../../lib/legacy.js';
import {installLegacy} from '../../test/setup.js';
import AIWorkspace from './AIWorkspace.jsx';
import AskAI from './AskAI.jsx';
const MD='**Do I need a reason?** sounds natural.\n\n- keeps `Ray` defensive\n- *softer* option';
const providers=[{id:'codex',label:'Codex',available:true,note:'Connected'}];
const projectBase='/projects/p1/ai-workspace',appBase='/ai-workspace';
const projectCatalog={project:{id:'p1',title:'Fixture'},projects:[{id:'p1',title:'Fixture'}],source:{version:1,hash:'h'},scenes:[{index:0,heading:'INT. KITCHEN - NIGHT'}],characters:[],nodes:[{key:'shot:a',label:'S1-A'}],providers};
const appCatalog={application_id:'film-engine-v2',projects:[],providers,uploads:{max_bytes:5242880},coding:{available:false}};
const base={provider:'codex',events:[],apply_state:'none',application:{}};
// Every chat surface, with a way to open it showing the given tasks.
const SURFACES={
 project:{Component:AIWorkspace,async open(tasks){const out=installLegacy({routes:{['GET '+projectBase]:projectCatalog,['GET '+projectBase+'/conversations?feature=screenplay']:{conversations:[{id:'c1',title:'C'}]},['GET '+projectBase+'/conversations/c1']:{tasks}},project:{id:'p1',title:'Fixture'}});out.fake.state.currentPage='screenplay';render(<AIWorkspace/>);await act(async()=>{await window.__filmOpenAIWorkspace();});}},
 application:{Component:AskAI,async open(tasks){const out=installLegacy({routes:{['GET '+appBase]:appCatalog,['GET '+appBase+'/conversations']:{conversations:[{id:'g1',title:'G'}]},['GET '+appBase+'/conversations/g1']:{tasks,uploads:[]}}});out.fake.state.currentProject=null;render(<AskAI/>);await act(async()=>{await window.__filmOpenAskAI();});}},
};
const chat=(id,status,extra={})=>({...base,id,status,request:{prompt:'Ask '+id,operation:{kind:'chat'}},result:'',...extra});
const conversation=()=>document.querySelector('.ai-chat-conversation');
const answer=()=>conversation().querySelector('.ai-markdown');
// Every selector in the chat stylesheet that gives a button an explicit background.
const css=fs.readFileSync('src/components/AIWorkspace/AIChatLayout.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'');
const styledButtonSelectors=[...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, ,body])=>/background/.test(body)).flatMap(([,sel])=>sel.split(',').map(s=>s.trim())).filter(s=>/\.btn|button/.test(s)&&!s.startsWith('@'));
afterEach(()=>{delete window.__filmOpenAIWorkspace;delete window.__filmOpenAskAI;});
describe.each(Object.entries(SURFACES))('%s chat surface',(name,surface)=>{
 it('renders a completed answer as Markdown, not raw markers',async()=>{
  await surface.open([chat('done','completed',{result:MD})]);const view=answer();expect(conversation().textContent).not.toContain('**');
  expect(view.querySelector('strong')?.textContent).toBe('Do I need a reason?');expect(view.querySelectorAll('li').length).toBe(2);expect(view.querySelector('em')?.textContent).toBe('softer');expect(view.querySelector('code')?.textContent).toBe('Ray');expect(view.textContent).not.toContain('**');
 });
 it('streams the partial answer while the task runs',async()=>{
  await surface.open([chat('live','running',{partial:'**Streaming** so far'})]);const view=answer();
  expect(view.querySelector('strong')?.textContent).toBe('Streaming');expect(view.textContent).toContain('so far');expect(view.classList.contains('ai-streaming')).toBe(true);
 });
 it('gives every in-chat button an explicit chat style',async()=>{
  await surface.open([chat('live','running',{partial:'x'}),chat('done','completed',{result:'ok',apply_state:'applied'})]);
  const buttons=[...conversation().querySelectorAll('button')];expect(buttons.length).toBeGreaterThan(0);
  for(const b of buttons)expect(styledButtonSelectors.some(s=>{try{return b.matches(s);}catch{return false;}}),`${b.textContent} has no chat button style`).toBe(true);
 });
 it('draws the options (⋯) and Send (↑) icons as centred SVG, never a font glyph that sits on its baseline',async()=>{
  await surface.open([]);
  const css=fs.readFileSync(require('node:path').join(__dirname,'AIChatLayout.css'),'utf8');
  for(const [name,cls] of [['AI options','ai-options-button'],['Send','ai-chat-send']]){
   const b=screen.getByRole('button',{name,exact:true});
   expect(b.querySelector('svg'),name).toBeTruthy();
   expect(b.textContent.trim(),`${name} carries no text glyph`).toBe('');
   const rule=new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(css);
   expect(rule,`${cls} has a rule`).toBeTruthy();
   for(const d of ['display:inline-flex','align-items:center','justify-content:center'])expect(rule[1],`${cls}: ${d}`).toContain(d);
  }
 });
});
// Every direct edit target the project chat can propose.
const TARGETS={scene:{block:'fountain',proposal:{kind:'replace',scene_index:0,text:'INT. KITCHEN - NIGHT\n\nRevised.'},button:'Review & apply'},image:{block:'image-prompt',proposal:{kind:'node_prompt',node_key:'shot:a',recipe_kind:'image',text:'New image prompt'},button:/Apply/},video:{block:'video-prompt',proposal:{kind:'node_prompt',node_key:'shot:a',recipe_kind:'video',text:'New video prompt'},button:/Apply/}};
describe.each(Object.entries(TARGETS))('direct %s edit from chat',(name,target)=>{
 it('shows the proposal separately from the answer with an apply action',async()=>{
  await SURFACES.project.open([chat('edit','completed',{result:'Here you go.\n\n```'+target.block+'\n'+target.proposal.text+'\n```',proposal:target.proposal})]);
  const card=conversation().querySelector('.ai-draft-proposal');expect(card).toBeTruthy();expect(card.textContent).toContain(target.proposal.text.split('\n').at(-1));
  expect(conversation().textContent.split(target.proposal.text.split('\n').at(-1)).length).toBe(2);
  expect(screen.getByRole('button',{name:target.button})).toBeTruthy();
 });
});
vi.mock('../../lib/ai-api.js',()=>({aiAPI:(...args)=>legacy.api(...args)}));
