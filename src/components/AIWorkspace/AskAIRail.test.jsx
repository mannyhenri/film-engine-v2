import {legacy} from '../../lib/legacy.js';
import {readFileSync} from 'node:fs';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {installLegacy} from '../../test/setup.js';
import AskAI from './AskAI.jsx';
it('actual shell replaces Terms on Home and project pages; Guide retains the terminology glossary',async()=>{
 const f=installLegacy({routes:{'GET /ai-workspace':{application_id:'film-engine-v2',projects:[],providers:[{id:'codex',available:false}],uploads:{},coding:{}},'GET /ai-workspace/conversations':{conversations:[]}}});f.fake.state.currentProject=null;
 const shell=document.createElement('div');shell.innerHTML='<div class="sidebar" id="sidebarProjectNav"></div><div id="productionGuideModal"><div class="guide-toolbar"></div></div>';document.body.appendChild(shell);render(<AskAI/>);
 vi.useFakeTimers();new Function(readFileSync(process.cwd()+'/public/legacy/shell.js','utf8'))();if(document.readyState==='loading')document.dispatchEvent(new Event('DOMContentLoaded'));vi.clearAllTimers();vi.useRealTimers();
 const rail=document.querySelector('.fe-rail');expect(rail).toBeTruthy();const ask=rail.querySelector('[data-rail="askai"]');expect(ask.textContent).toContain('Ask AI');expect(rail.querySelector('[data-rail="glossary"]')).toBeNull();fireEvent.click(ask);await screen.findByRole('dialog',{name:'Ask AI'});expect(f.calls.some(x=>x.method==='POST')).toBe(false);fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(document.activeElement).toBe(ask);
 f.fake.state.currentProject={id:'p1'};fireEvent.click(ask);await screen.findByRole('dialog',{name:'Ask AI'});fireEvent.keyDown(document,{key:'Escape'});fireEvent.click(rail.querySelector('[data-rail="guide"]'));fireEvent.click(screen.getByRole('button',{name:'Terminology glossary'}));expect(f.fake.showModal).toHaveBeenCalledWith('glossaryModal');
 document.querySelectorAll('.fe-top,.fe-panel').forEach(el=>el.remove());shell.remove();document.body.classList.remove('fe');
});

// Component tests isolate transport; ai-api.test.jsx exercises authenticated requests.
vi.mock('../../lib/ai-api.js',()=>({aiAPI:(...args)=>legacy.api(...args)}));
