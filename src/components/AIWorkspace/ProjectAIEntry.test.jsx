import {legacy} from '../../lib/legacy.js';
import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,act} from '@testing-library/react';
import {installLegacy} from '../../test/setup.js';
import {toggleAIChat,onEditorKeydown} from '../../pages/screenplay/engine.js';
import AIWorkspace from './AIWorkspace.jsx';
it('legacy AI Chat and Ctrl+Shift+A enter the persisted project workspace without sending a prompt',async()=>{
 const base='/projects/p1/ai-workspace',f=installLegacy({project:{id:'p1',title:'Project'},routes:{['GET '+base]:{project:{id:'p1',title:'Project'},source:{version:1,hash:'h'},scenes:[],characters:[],nodes:[],providers:[{id:'codex',available:false}]},['GET '+base+'/conversations?feature=screenplay']:{conversations:[]}}});f.fake.state.currentPage='screenplay';f.fake.TYPEWRITER.on=()=>false;render(<AIWorkspace/>);await act(async()=>{await toggleAIChat();});await screen.findByRole('dialog',{name:'Film Engine AI workspace'});fireEvent.click(screen.getByRole('button',{name:'Close'}));await act(async()=>{onEditorKeydown({key:'A',ctrlKey:true,metaKey:false,shiftKey:true,preventDefault:vi.fn()});});await screen.findByRole('dialog',{name:'Film Engine AI workspace'});expect(f.calls.some(x=>x.method==='POST')).toBe(false);
});

// Component tests isolate transport; ai-api.test.jsx exercises authenticated requests.
vi.mock('../../lib/ai-api.js',()=>({aiAPI:(...args)=>legacy.api(...args)}));
