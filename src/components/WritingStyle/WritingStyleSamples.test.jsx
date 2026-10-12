// GRD-4661: Learn my style in the Screenplay toolbar, the five prompts, permitted script import,
// coverage and gaps, and sample exclusion and deletion, against the real writing-style route.
import { beforeEach, afterAll, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const bridge=vi.hoisted(()=>({state:{currentProject:null},api:vi.fn()}));
vi.mock('../../lib/legacy.js',()=>({legacy:bridge}));
import WritingStyleWorkbench from './WritingStyleWorkbench.jsx';
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-style-samples-ui-'));
const require=createRequire(import.meta.url);
const {db}=require('../../../backend/db/database.js');
require('../../../backend/db/schema.js').ensureSchema();
const {handleWritingStyle}=require('../../../backend/routes/writing-style.js');
const {STYLE_CATEGORIES,EXERCISES}=require('../../../backend/lib/writing-style.js');
beforeEach(()=>{
 document.body.innerHTML='';
 const id=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(id,'Samples UI');
 bridge.state.currentProject={id,title:'Samples UI'};
 bridge.api.mockImplementation(async(url,options={})=>{
  let status,raw;
  handleWritingStyle({method:options.method||'GET',body:options.body?JSON.parse(options.body):{},headers:{}},{writeHead(s){status=s;},end(s){raw=s;}},['film',...url.split('/').filter(Boolean)]);
  const result=JSON.parse(raw);if(status>=400)throw Error(result.error);return result;
 });
 vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterAll(()=>db.close());
const openWorkbench=async()=>{fireEvent.click(screen.getByText('My Voice'));await screen.findByText(/Coverage/);};

it('Learn my style sits in the Screenplay toolbar and opens the workbench',async()=>{
 const bar=document.createElement('div');bar.innerHTML='<button id="aiChatToggle">AI Chat</button>';document.body.appendChild(bar);
 render(<WritingStyleWorkbench />);
 const learn=await waitFor(()=>{const b=bar.querySelector('button.learn-my-style');if(!b)throw Error('not yet');return b;});
 expect(learn.textContent).toBe('My Voice');
 fireEvent.click(learn);
 expect(await screen.findByRole('dialog',{name:'Film My Voice workbench'})).toBeTruthy();
});

it('offers the five prompts by name and shows coverage with every gap',async()=>{
 render(<WritingStyleWorkbench />);await openWorkbench();
 const options=[...screen.getByLabelText('Exercise').options].map(o=>o.textContent);
 for(const e of EXERCISES)expect(options).toContain(e.label);
 const coverage=document.querySelector('.writing-coverage').textContent;
 for(const c of STYLE_CATEGORIES)expect(coverage).toContain(c);
 expect(coverage).toMatch(/not invented|will not invent/i);
});

it('imports a script only with a confirmed rights basis, and lists each scene with its span',async()=>{
 render(<WritingStyleWorkbench />);await openWorkbench();
 fireEvent.change(screen.getByLabelText('Script title'),{target:{value:'My pilot'}});
 fireEvent.change(screen.getByLabelText('Script owner'),{target:{value:'Manny'}});
 fireEvent.change(screen.getByLabelText('Script text'),{target:{value:'INT. ROOM - DAY\n\nShe waits.\n\nEXT. ROAD - NIGHT\n\nHe drives.\n'}});
 fireEvent.change(screen.getByLabelText('Rights basis'),{target:{value:'own_writing'}});
 const button=screen.getByText('Import script');
 expect(button.disabled).toBe(true);
 fireEvent.click(screen.getByLabelText(/I own this script or have permission/));
 expect(button.disabled).toBe(false);
 await act(async()=>{fireEvent.click(button);});
 await waitFor(()=>expect(document.querySelectorAll('.writing-sample').length).toBe(2));
 expect(document.body.textContent).toContain('My pilot [characters 0–');
 expect(document.querySelector('.writing-source').textContent).toMatch(/kept on this machine/i);
});

it('excluding and deleting a sample show why it is not used, and deletion explains what is retained',async()=>{
 render(<WritingStyleWorkbench />);await openWorkbench();
 fireEvent.change(screen.getByLabelText('Writing sample'),{target:{value:'A quiet line, mine.'}});
 fireEvent.change(screen.getByLabelText('Source and provenance'),{target:{value:'Notebook'}});
 fireEvent.change(screen.getByLabelText('Authorship'),{target:{value:'original_human'}});
 fireEvent.click(screen.getByLabelText(/I confirm these are my original words/));
 await act(async()=>{fireEvent.click(screen.getByText('Save evidence'));});
 await waitFor(()=>expect(document.querySelectorAll('.writing-sample').length).toBe(1));
 await act(async()=>{fireEvent.click(screen.getByText('Exclude'));});
 await waitFor(()=>expect(document.querySelector('.writing-sample').textContent).toContain('not used: excluded'));
 await act(async()=>{fireEvent.click(screen.getByText('Delete'));});
 const message=window.confirm.mock.calls.at(-1)[0];
 expect(message).toMatch(/revisions/i);expect(message).toMatch(/provider/i);
 await waitFor(()=>expect(document.querySelector('.writing-sample').textContent).toContain('not used: deleted'));
 expect(document.body.textContent).not.toContain('A quiet line, mine.');
});
