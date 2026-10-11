import {legacy} from '../../lib/legacy.js';
import {render,screen,fireEvent,waitFor,act,within} from '@testing-library/react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {installLegacy} from '../../test/setup.js';
import AIWorkspace from './AIWorkspace.jsx';
import AIConnections from './AIConnections.jsx';
const base='/projects/p1/ai-workspace';
const catalog={project:{id:'p1',title:'Fixture'},source:{version:1,hash:'h'},scenes:[{index:0,number:'1',heading:'INT. KITCHEN - NIGHT'}],characters:[],providers:[{id:'codex',label:'Codex',available:true,note:'Connected'},{id:'claude',label:'Claude',available:true,note:'Connected'}]};
const c={id:'c1',feature:'screenplay',title:'Restaurant'};
function fake(extra={}){const out=installLegacy({routes:{['GET '+base]:catalog,['GET '+base+'/conversations?feature=screenplay']:{conversations:[c]},['GET '+base+'/conversations/c1']:{conversation:c,tasks:[{id:'t0',status:'completed',provider:'codex',request:{prompt:'Previous message',operation:{kind:'chat'}},result:'Previous response',events:[],apply_state:'none'}]},...extra},project:{id:'p1',title:'Fixture'}});out.fake.state.currentPage='screenplay';return out;}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const task=(result,status='completed',operation='chat',apply_state='none')=>({id:'task-a',status,provider:'codex',request:{prompt:'Earlier request',operation:{kind:operation}},result,events:[],apply_state});
function openOptions(){const button=screen.getByRole('button',{name:'AI options'});if(button.getAttribute('aria-expanded')==='false')fireEvent.click(button);}
afterEach(()=>{vi.useRealTimers();delete window.__feDesktop;});
describe('AI workspace',()=>{
 it('shows only active projects and sends scene requests as drafts before reviewing the exact change',async()=>{
  let sent=false,applied=false;
  const proposal={...task('INT. KITCHEN - NIGHT\n\nA different cup.','completed','replace'),fingerprint:'request-fp'};
  const f=fake({['GET '+base]:{...catalog,projects:[{id:'p1',title:'Fixture'},{id:'old',title:'Archived film',archived_at:'2026-10-01'}]},['GET '+base+'/conversations/c1']:()=>({tasks:sent?[proposal]:[]}),['POST '+base+'/conversations/c1/preview']:body=>({id:proposal.id,status:'preview',fingerprint:'request-fp',payload:JSON.stringify(body),request:body}),['POST '+base+'/tasks/task-a/execute']:()=>{sent=true;return proposal;},['GET '+base+'/tasks/task-a/change-review']:{before:'INT. KITCHEN - NIGHT\n\nAn untouched cup.',after:proposal.result,fingerprint:'change-fp',source:{version:1}},['POST '+base+'/tasks/task-a/apply']:body=>{expect(body).toEqual({human_confirmed:true,fingerprint:'request-fp',review_fingerprint:'change-fp'});applied=true;return proposal;}});
  render(<AIWorkspace/>);await act(async()=>{await window.__filmOpenAIWorkspace();});
  const picker=screen.getByRole('combobox',{name:'Project'});expect(picker.textContent).toContain('Fixture');expect(picker.textContent).not.toContain('Archived film');
  fireEvent.click(screen.getByRole('button',{name:'AI options'}));openOptions();fireEvent.change(screen.getByLabelText('Action'),{target:{value:'replace'}});fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Draft a revision'}});
  fireEvent.click(screen.getByRole('button',{name:'Send',exact:true}));await screen.findByText(/A different cup\./);
  expect(f.calls.find(x=>x.path.endsWith('/preview')).body.write_when_ready).toBe(false);expect(applied).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Review & apply'}));await screen.findByText('An untouched cup.',{exact:false});
  expect(screen.getByRole('button',{name:'Apply change',exact:true}).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('I reviewed this exact change'));fireEvent.click(screen.getByRole('button',{name:'Apply change',exact:true}));await waitFor(()=>expect(applied).toBe(true));
 });
 it('defaults to the saved selected scene and switches project context without navigating the writer',async()=>{
  const p2='/projects/p2/ai-workspace';const f=fake({['GET '+base]:{...catalog,projects:[{id:'p1',title:'Fixture'},{id:'p2',title:'Second film'}]},['GET '+p2]:{...catalog,project:{id:'p2',title:'Second film'},projects:[{id:'p1',title:'Fixture'},{id:'p2',title:'Second film'}]},['GET '+p2+'/conversations?feature=screenplay']:{conversations:[]},['POST '+base+'/conversations/c1/preview']:body=>({id:'draft',fingerprint:'fp',payload:JSON.stringify(body),source:{version:1},request:body})});
  render(<><div className="scene-nav-item current"/><AIWorkspace/></>);await act(async()=>{await window.__filmOpenAIWorkspace();});fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Discuss the selected scene'}});openOptions();fireEvent.click(screen.getByRole('button',{name:'Preview request'}));await screen.findByRole('button',{name:'Send to Codex'});expect(f.calls.find(x=>x.path.endsWith('/preview')).body.attachments.scenes).toEqual([0]);
  await act(async()=>{fireEvent.change(screen.getByRole('combobox',{name:'Project'}),{target:{value:'p2'}});});expect(f.fake.state.currentProject.id).toBe('p1');expect(f.fake.openProject).not.toHaveBeenCalled();expect(screen.getByRole('combobox',{name:'Project'}).value).toBe('p2');expect(screen.queryByRole('button',{name:'Send to Codex'})).toBeNull();
 });
 it('refuses direct Send of a scene draft while the current writer has newly unsaved edits',async()=>{
  const f=fake();render(<><div id="saveStatusIndicator" className="saved"/><AIWorkspace/></>);await act(async()=>{await window.__filmOpenAIWorkspace();});openOptions();fireEvent.change(screen.getByLabelText('Action'),{target:{value:'insert'}});fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Draft another scene'}});document.getElementById('saveStatusIndicator').className='unsaved';fireEvent.click(screen.getByRole('button',{name:'Send',exact:true}));await screen.findByRole('alert');expect(f.calls.some(x=>x.path.endsWith('/execute'))).toBe(false);expect(f.calls.some(x=>x.path.endsWith('/preview'))).toBe(false);expect(screen.getByLabelText('Message').value).toBe('Draft another scene');
 });
 it('provides the default screenplay AI Chat entry without dispatching a task',async()=>{const {calls}=fake();const view=render(<AIWorkspace/>);window.__filmOpenAIWorkspace();await screen.findByText('Previous response');expect(calls.some(x=>x.path.endsWith('/execute'))).toBe(false);view.unmount();expect(window.__filmOpenAIWorkspace).toBeUndefined();});
 it('restores app history and retains it when provider changes; explicit insert is previewed',async()=>{const {calls}=fake({['POST '+base+'/conversations/c1/preview']:body=>({id:'t1',status:'preview',fingerprint:'approved',payload:JSON.stringify(body),request:body,events:[]})});render(<AIWorkspace/>);fireEvent.click(screen.getByRole('button',{name:'AI workspace'}));await screen.findByText('Previous response');fireEvent.change(screen.getByLabelText('Provider'),{target:{value:'claude'}});expect(screen.getByText('Previous response')).toBeTruthy();openOptions();fireEvent.change(screen.getByLabelText('Action'),{target:{value:'insert'}});fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Write a restaurant scene.'}});fireEvent.click(screen.getByRole('button',{name:'Preview request'}));await screen.findByRole('button',{name:'Send to Claude'});expect(calls.at(-1).body.operation).toEqual({kind:'insert',after_scene:1});expect(calls.at(-1).body.write_when_ready).toBe(false);expect(calls.some(x=>x.path.endsWith('/execute'))).toBe(false);});
 it('shows unavailable backend and closes on project epoch change',async()=>{const {fake:f}=fake({['GET '+base]:()=>{throw Error('AI workspace backend is not active yet');}});render(<AIWorkspace/>);fireEvent.click(screen.getByRole('button',{name:'AI workspace'}));await screen.findByRole('alert');expect(screen.getByText(/backend is not active/)).toBeTruthy();});
 it('shows busy state and honest cancellation action',async()=>{fake({['GET '+base+'/conversations/c1']:{conversation:c,tasks:[{id:'t1',status:'cancelling',provider:'codex',request:{prompt:'Write scene',operation:{kind:'insert',after_scene:1}},result:'',events:[{message:'Waiting for process to exit'}],apply_state:'none'}]}});render(<AIWorkspace/>);fireEvent.click(screen.getByRole('button',{name:'AI workspace'}));await screen.findAllByText(/Waiting for process to exit/);expect(screen.getByText(/cancelling/)).toBeTruthy();openOptions();expect(screen.getByRole('button',{name:'Preview request'}).disabled).toBe(true);});
 it('keeps Escape and Tab in connections while preserving the unsent workspace message',async()=>{
  window.__feDesktop={platform:'darwin'};
  fake({'GET /ai-connections':{application:'film-engine-v2',providers:[]}});
  render(<><AIWorkspace/><AIConnections/></>);await act(async()=>{await window.__filmOpenAIWorkspace();});
  fireEvent.change(screen.getByLabelText('Message'),{target:{value:'My unsent scene request'}});
  openOptions();fireEvent.click(screen.getByText('Advanced settings'));const manage=screen.getByRole('button',{name:'Manage AI connections'});manage.focus();fireEvent.click(manage);
  const connections=screen.getByRole('dialog',{name:'Film AI connections'}),close=within(connections).getByRole('button',{name:'Close'});
  const tab= new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});act(()=>{document.dispatchEvent(tab);});
  expect(tab.defaultPrevented).toBe(true);expect(document.activeElement).toBe(close);
  const escape=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});act(()=>{document.dispatchEvent(escape);});
  expect(escape.defaultPrevented).toBe(true);expect(screen.queryByRole('dialog',{name:'Film AI connections'})).toBeNull();
  expect(screen.getByRole('dialog',{name:'Film Engine AI workspace'})).toBeTruthy();expect(screen.getByLabelText('Message').value).toBe('My unsent scene request');expect(document.activeElement).toBe(manage);
 });
 it('dismisses only connections on Escape and retains the project request',async()=>{
  window.__feDesktop={platform:'darwin'};fake({'GET /ai-connections':{application:'film-engine-v2',providers:[]}});
  render(<><AIWorkspace/><AIConnections/></>);await act(async()=>{await window.__filmOpenAIWorkspace();});fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Keep this draft'}});openOptions();fireEvent.click(screen.getByText('Advanced settings'));fireEvent.click(screen.getByRole('button',{name:'Manage AI connections'}));
  fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog',{name:'Film AI connections'})).toBeNull();expect(screen.getByRole('dialog',{name:'Film Engine AI workspace'})).toBeTruthy();expect(screen.getByLabelText('Message').value).toBe('Keep this draft');
 });
 it.each(['B','New'])('ignores a deferred conversation A poll after selecting %s',async destination=>{
  vi.useFakeTimers();const pending=deferred();let reads=0;const b={id:'c2',feature:'screenplay',title:'Conversation B'};
  fake({['GET '+base+'/conversations?feature=screenplay']:{conversations:[c,b]},['GET '+base+'/conversations/c1']:()=>++reads===1?{tasks:[task('Conversation A','running')]}:pending.promise,['GET '+base+'/conversations/c2']:{tasks:[task('Conversation B result')]}});
  render(<AIWorkspace/>);await act(async()=>{await window.__filmOpenAIWorkspace();});
  await act(async()=>{vi.advanceTimersByTime(1500);});
  openOptions();if(destination==='B')await act(async()=>{fireEvent.change(screen.getByLabelText('Conversation'),{target:{value:'c2'}});});else fireEvent.click(screen.getByRole('button',{name:'New conversation'}));
  await act(async()=>{pending.resolve({tasks:[task('Late A reply')]});});
  expect(screen.getByLabelText('Conversation').value).toBe(destination==='B'?'c2':'');expect(screen.queryByText('Late A reply')).toBeNull();
  if(destination==='B')expect(screen.getByText('Conversation B result')).toBeTruthy();else expect(screen.getByLabelText('Conversation history').textContent).toBe('');
 });
 it('ignores a deferred screenplay poll after switching feature',async()=>{
  vi.useFakeTimers();const pending=deferred();let reads=0;
  fake({['GET '+base+'/conversations/c1']:()=>++reads===1?{tasks:[task('Conversation A','running')]}:pending.promise,['GET '+base+'/conversations?feature=general']:{conversations:[]}});
  render(<AIWorkspace/>);await act(async()=>{await window.__filmOpenAIWorkspace();});await act(async()=>{vi.advanceTimersByTime(1500);});
  await act(async()=>{fireEvent.change(screen.getByLabelText('Feature'),{target:{value:'general'}});});await act(async()=>{pending.resolve({tasks:[task('Late screenplay reply')]});});
  expect(screen.getByLabelText('Feature').value).toBe('general');expect(screen.getByLabelText('Conversation').value).toBe('');expect(screen.queryByText('Late screenplay reply')).toBeNull();
 });
 it.each([['insert','applied'],['replace','applied'],['replace','undone']])('refreshes the matching clean editor after an observed %s %s write',async(operation,writeState)=>{
  vi.useFakeTimers();const pending=deferred();let reads=0;const f=fake({['GET '+base+'/conversations/c1']:()=>++reads===1?{tasks:[task('Waiting','running',operation)]}:pending.promise});
  render(<><div id="saveStatusIndicator" className="saved"/><div id="screenplayEditor">Old screenplay</div><AIWorkspace/></>);
  f.fake.loadScreenplayPage.mockImplementation(()=>{document.getElementById('screenplayEditor').textContent='Latest '+writeState+' screenplay';});
  await act(async()=>{await window.__filmOpenAIWorkspace();});await act(async()=>{vi.advanceTimersByTime(1500);});
  await act(async()=>{pending.resolve({tasks:[task('Finished','completed',operation,writeState)]});});
  expect(document.getElementById('screenplayEditor').textContent).toBe('Latest '+writeState+' screenplay');expect(screen.getByText(writeState==='applied'?'Written to screenplay ·':'Write undone; revision history is retained.')).toBeTruthy();
 });
 it.each(['unsaved','saving'])('preserves %s editor content and offers pending refresh after a background write',async editorState=>{
  vi.useFakeTimers();const pending=deferred();let reads=0;const f=fake({['GET '+base+'/conversations/c1']:()=>++reads===1?{tasks:[task('Waiting','running','insert')]}:pending.promise});
  render(<><div id="saveStatusIndicator" className="saved"/><div id="screenplayEditor">Old screenplay</div><AIWorkspace/></>);
  f.fake.loadScreenplayPage.mockImplementation(()=>{document.getElementById('screenplayEditor').textContent='Latest screenplay';});
  await act(async()=>{await window.__filmOpenAIWorkspace();});document.getElementById('saveStatusIndicator').className=editorState;document.getElementById('screenplayEditor').textContent='My ongoing edits';
  await act(async()=>{vi.advanceTimersByTime(1500);});await act(async()=>{pending.resolve({tasks:[task('Finished','completed','insert','applied')]});});
  expect(document.getElementById('screenplayEditor').textContent).toBe('My ongoing edits');expect(screen.getByText(/screenplay refresh is pending/i)).toBeTruthy();
  document.getElementById('saveStatusIndicator').className='saved';await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Refresh screenplay'}));});
  expect(document.getElementById('screenplayEditor').textContent).toBe('Latest screenplay');expect(screen.queryByText(/screenplay refresh is pending/i)).toBeNull();
 });
 it('keeps screenplay content when a production node prompt is written',async()=>{
  const f=fake({['GET '+base+'/conversations/c1']:{tasks:[task('Saved node prompt','completed','node_prompt','applied')]}});
  render(<><div id="screenplayEditor">Current screenplay</div><AIWorkspace/></>);f.fake.loadScreenplayPage.mockImplementation(()=>{document.getElementById('screenplayEditor').textContent='Unexpected reload';});
  await act(async()=>{await window.__filmOpenAIWorkspace();});expect(screen.getByText('Saved Production draft ·')).toBeTruthy();expect(document.getElementById('screenplayEditor').textContent).toBe('Current screenplay');
 });
 it.each([['apply','unsaved'],['apply','saving'],['undo','unsaved'],['undo','saving']])('blocks screenplay task %s when current action is chat and editor is %s',async(action,editorState)=>{
  const f=fake({['GET '+base+'/conversations/c1']:{tasks:[task('Replacement proposal','completed','replace',action==='undo'?'applied':'none')]},['GET '+base+'/tasks/task-a/change-review']:{before:'Original scene',after:'Replacement proposal',source:{version:1},fingerprint:'review'},['POST '+base+'/tasks/task-a/'+action]:()=>{throw Error('Task should be blocked before '+action);}});
  render(<><div id="saveStatusIndicator" className="saved"/><div id="screenplayEditor">My edited scene</div><AIWorkspace/></>);await act(async()=>{await window.__filmOpenAIWorkspace();});document.getElementById('saveStatusIndicator').className=editorState;document.getElementById('screenplayEditor').textContent='My edited scene';
  if(action==='apply'){fireEvent.click(screen.getByRole('button',{name:'Review & apply'}));await screen.findByRole('button',{name:'Apply change'});fireEvent.click(screen.getByLabelText('I reviewed this exact change'));}fireEvent.click(screen.getByRole('button',{name:action==='apply'?'Apply change':'Undo this write'}));await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toBe('Save your screenplay edits before this action.');expect(f.calls.some(x=>x.path.endsWith('/'+action))).toBe(false);expect(document.getElementById('screenplayEditor').textContent).toBe('My edited scene');
 });
 it('allows node prompt apply while screenplay edits are dirty even when the current selector is insert',async()=>{
  let applied=false;const f=fake({['GET '+base+'/conversations/c1']:()=>({tasks:[task('Production proposal','completed','node_prompt',applied?'applied':'none')]}),['POST '+base+'/tasks/task-a/apply']:()=>{applied=true;return {};}});
  render(<><div id="saveStatusIndicator" className="saved"/><div id="screenplayEditor">My unsaved screenplay</div><AIWorkspace/></>);await act(async()=>{await window.__filmOpenAIWorkspace();});openOptions();fireEvent.change(screen.getByLabelText('Action'),{target:{value:'insert'}});document.getElementById('saveStatusIndicator').className='unsaved';
  fireEvent.click(screen.getByRole('button',{name:'Review complete · Apply at selected location'}));await screen.findByText('Saved Production draft ·');expect(screen.queryByRole('alert')).toBeNull();expect(document.getElementById('screenplayEditor').textContent).toBe('My unsaved screenplay');expect(f.calls.some(x=>x.path.endsWith('/apply'))).toBe(true);
 });
});

// Component tests isolate transport; ai-api.test.jsx exercises authenticated requests.
vi.mock('../../lib/ai-api.js',()=>({aiAPI:(...args)=>legacy.api(...args)}));
