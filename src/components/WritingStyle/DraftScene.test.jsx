// GRD-4663: brief → preview → approve and send → alternatives → compare → accept selected hunks, in the
// workbench, against the real routes. The provider is a recorder; the screenplay is real.
import { beforeEach, afterAll, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const bridge=vi.hoisted(()=>({state:{currentProject:null},api:vi.fn()}));
vi.mock('../../lib/legacy.js',()=>({legacy:bridge}));
import DraftScene from './DraftScene.jsx';
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-draft-scene-ui-'));
const require=createRequire(import.meta.url);
const {db}=require('../../../backend/db/database.js');
require('../../../backend/db/schema.js').ensureSchema();
const {handleScripts}=require('../../../backend/routes/scripts.js');
const {handleScenes}=require('../../../backend/routes/scenes.js');
const {handleStyleDrafting}=require('../../../backend/routes/style-drafting.js');
const sd=require('../../../backend/lib/style-drafting.js');
const sent=[];
sd.setDefaultGenerator(async payload=>{sent.push(payload);return {texts:['INT. KITCHEN - NIGHT\n\nMara rinses one cup. Then the other.\n\nMARA\nYou stayed.'],model:'recorder'};});
const SCRIPT='INT. KITCHEN - NIGHT\n\nMara rinses one cup.\n\nMARA\nYou stayed.\n\nEXT. PIER - DAWN\n\nGulls.\n';
let pid;
function route(handler,method,url,body){return new Promise(resolve=>{const res={statusCode:200,writeHead(c){this.statusCode=c;return this;},setHeader(){},write(){},end(s){let b=s;try{b=JSON.parse(s);}catch(_){}resolve({status:this.statusCode,body:b});}};
 Promise.resolve(handler({method,body:body||{},headers:{}},res,['film',...url.split('/').filter(Boolean)],{})).catch(e=>resolve({status:500,body:{error:e.message}}));});}
beforeEach(async()=>{
 document.body.innerHTML='';sent.length=0;
 pid=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(pid,'Draft UI');
 await route(handleScripts,'POST',`/projects/${pid}/script`,{fountain_content:SCRIPT});
 bridge.api.mockImplementation(async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):{};const method=options.method||'GET';
  const handler=url.includes('/style-drafting/')?handleStyleDrafting:url.includes('/scenes')?handleScenes:null;
  const r=await route(handler,method,url,body);
  if(r.status>=400)throw Error(r.body.error);return r.body;
 });
 vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterAll(()=>db.close());
const fountain=()=>db.prepare('SELECT fountain_content FROM film_scripts WHERE project_id=? ORDER BY version DESC LIMIT 1').get(pid).fountain_content;

it('previews exactly what would be sent, sends it only after approval, and accepts only the chosen hunk',async()=>{
 render(<DraftScene projectId={pid} />);
 await screen.findByText(/Draft a scene/);
 await waitFor(()=>expect(screen.getByLabelText('Scene').options.length).toBeGreaterThan(1));
 fireEvent.change(screen.getByLabelText('Scene'),{target:{value:screen.getByLabelText('Scene').options[1].value}});
 fireEvent.change(screen.getByLabelText('Brief'),{target:{value:'She washes both cups.'}});
 fireEvent.change(screen.getByLabelText('Provider'),{target:{value:'claude'}});
 await act(async()=>{fireEvent.click(screen.getByText('Preview what will be sent'));});
 const preview=await waitFor(()=>{const el=document.querySelector('.draft-preview');if(!el)throw Error('none');return el;});
 expect(preview.textContent).toContain('Claude (Anthropic API)');
 expect(preview.textContent).toContain('Mara rinses one cup.');
 expect(preview.textContent).not.toContain('Gulls.');
 expect(sent.length).toBe(0);
 await act(async()=>{fireEvent.click(screen.getByText('Approve and send'));});
 expect(window.confirm.mock.calls.at(-1)[0]).toMatch(/Claude/);
 await waitFor(()=>expect(document.querySelectorAll('.draft-hunk').length).toBeGreaterThan(0));
 expect(sent.length).toBe(1);
 expect(fountain()).toBe(SCRIPT);
 const hunk=[...document.querySelectorAll('.draft-hunk')].find(h=>h.textContent.includes('Then the other.'));
 fireEvent.click(hunk.querySelector('input[type=checkbox]'));
 await act(async()=>{fireEvent.click(screen.getByText('Accept selected as a new revision'));});
 await waitFor(()=>expect(fountain()).toContain('Mara rinses one cup. Then the other.'));
 expect(fountain()).toContain('Gulls.');
});

it('a provider failure is shown, and nothing changes',async()=>{
 const prev=sd.setDefaultGenerator(async()=>{throw new Error('upstream 529 overloaded');});
 try{
  render(<DraftScene projectId={pid} />);
  await waitFor(()=>expect(screen.getByLabelText('Scene').options.length).toBeGreaterThan(1));
  fireEvent.change(screen.getByLabelText('Scene'),{target:{value:screen.getByLabelText('Scene').options[1].value}});
  fireEvent.change(screen.getByLabelText('Brief'),{target:{value:'Anything.'}});
  fireEvent.change(screen.getByLabelText('Provider'),{target:{value:'chatgpt'}});
  await act(async()=>{fireEvent.click(screen.getByText('Preview what will be sent'));});
  await waitFor(()=>document.querySelector('.draft-preview'));
  await act(async()=>{fireEvent.click(screen.getByText('Approve and send'));});
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toMatch(/529/));
  expect(fountain()).toBe(SCRIPT);
 }finally{sd.setDefaultGenerator(prev);}
});

it('a host draft shows the request for the assistant instead of sending anything',async()=>{
 render(<DraftScene projectId={pid} />);
 await waitFor(()=>expect(screen.getByLabelText('Scene').options.length).toBeGreaterThan(1));
 fireEvent.change(screen.getByLabelText('Scene'),{target:{value:screen.getByLabelText('Scene').options[1].value}});
 fireEvent.change(screen.getByLabelText('Brief'),{target:{value:'Quieter.'}});
 fireEvent.change(screen.getByLabelText('Provider'),{target:{value:'host'}});
 await act(async()=>{fireEvent.click(screen.getByText('Preview what will be sent'));});
 const preview=await waitFor(()=>{const el=document.querySelector('.draft-preview');if(!el)throw Error('none');return el;});
 expect(preview.textContent).toMatch(/script_create_draft/);
 expect(screen.queryByText('Approve and send')).toBeNull();
 expect(sent.length).toBe(0);
});
