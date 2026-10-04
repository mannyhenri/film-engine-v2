// GRD-4664: the author runs the blinded pilot in the workbench: held-out briefs, criterion first,
// blind review with the full rubric, the report, then release and activation as separate steps.
import { beforeEach, afterAll, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const bridge=vi.hoisted(()=>({state:{currentProject:null},api:vi.fn()}));
vi.mock('../../lib/legacy.js',()=>({legacy:bridge}));
import PilotPanel from './PilotPanel.jsx';
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-pilot-ui-'));
const require=createRequire(import.meta.url);
const {db}=require('../../../backend/db/database.js');
require('../../../backend/db/schema.js').ensureSchema();
const {handleStylePilot}=require('../../../backend/routes/style-pilot.js');
const {handleWritingStyle}=require('../../../backend/routes/writing-style.js');
const ws=require('../../../backend/lib/writing-style.js'),sd=require('../../../backend/lib/style-drafting.js'),pilot=require('../../../backend/lib/style-pilot.js');
sd.setDefaultGenerator(async payload=>({texts:[payload.messages[0].content.includes('APPROVED PERSONAL')?'INT. A - DAY\n\nQuiet version.':'INT. A - DAY\n\nPlain version.'],model:'recorder'}));
let pid;
function route(handler,method,url,body){return new Promise(resolve=>{let status;const res={writeHead(c){status=c;return this;},end(s){resolve({status,body:JSON.parse(s)});}};
 Promise.resolve(handler({method,body:body||{},headers:{}},res,['film',...url.split('/').filter(Boolean)])).catch(e=>resolve({status:500,body:{error:e.message}}));});}
beforeEach(()=>{
 document.body.innerHTML='';
 pid=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(pid,'Pilot UI');
 const s=ws.createWritingStyleStore(db);
 s.addSample(pid,{text:'Short lines. A door.',source:'mine',authorship:'original_human',confirmed_original:true,exercise:'action'});
 const dev=s.snapshot(pid).samples.at(-1);
 for(let i=0;i<10;i++)s.addSample(pid,{text:`Held out ${i}: lanterns on the water, count ${i}.`,source:'mine',authorship:'original_human',confirmed_original:true,held_out:true,exercise:'dialogue'});
 s.propose(pid,{expected_version:0,guidance:'Quiet.',sample_ids:[dev.id]});
 const p=s.snapshot(pid).profiles[0];s.approve(pid,1,{expected_version:1,human_confirmed:true,approval_fingerprint:p.evidence_hash});
 bridge.api.mockImplementation(async(url,options={})=>{
  const handler=url.includes('/style-pilot/')?handleStylePilot:handleWritingStyle;
  const r=await route(handler,options.method||'GET',url,options.body?JSON.parse(options.body):{});
  if(r.status>=400)throw Error(r.body.error);return r.body;
 });
 vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterAll(()=>db.close());

it('runs a blind pilot end to end, with release and activation as separate author steps',async()=>{
 render(<PilotPanel projectId={pid} />);
 await screen.findByText(/Style pilot/);
 const targets=await waitFor(()=>{const t=[...document.querySelectorAll('.pilot-target')];if(t.length<10)throw Error('loading');return t;});
 targets.forEach((t,i)=>{fireEvent.click(t.querySelector('input[type=checkbox]'));fireEvent.change(t.querySelector('textarea'),{target:{value:`Brief ${i}: night crossing.`}});});
 fireEvent.change(screen.getByLabelText('Provider'),{target:{value:'claude'}});
 fireEvent.change(screen.getByLabelText('Model'),{target:{value:'claude-sonnet-5-5'}});
 await act(async()=>{fireEvent.click(screen.getByText('Create pilot'));});
 await screen.findByLabelText('Success criterion');
 expect(screen.queryByText('Run pilot')).toBeNull();
 fireEvent.change(screen.getByLabelText('Success criterion'),{target:{value:'Conditioned wins at least half'}});
 fireEvent.change(screen.getByLabelText('Minimum win rate'),{target:{value:'0.5'}});
 fireEvent.change(screen.getByLabelText('Your name'),{target:{value:'Manny'}});
 await act(async()=>{fireEvent.click(screen.getByText('Agree criterion'));});
 await act(async()=>{fireEvent.click(await screen.findByText('Run pilot'));});
 const cards=await waitFor(()=>{const c=[...document.querySelectorAll('.pilot-pair')];if(c.length<10)throw Error('running');return c;});
 // Blind: no card says which is conditioned.
 for(const c of cards)expect(c.textContent).not.toMatch(/conditioned|unconditioned/i);
 for(const c of cards){
  const quiet=c.querySelector('.pilot-left').textContent.includes('Quiet')?'left':'right';
  fireEvent.click(c.querySelector(`input[value="${quiet}"]`));
  for(const sel of c.querySelectorAll('select.pilot-score'))fireEvent.change(sel,{target:{value:'4'}});
  await act(async()=>{fireEvent.click(c.querySelector('button.pilot-save'));});
 }
 await act(async()=>{fireEvent.click(screen.getByText('Show report'));});
 const rep=await waitFor(()=>{const r=document.querySelector('.pilot-report');if(!r)throw Error('none');return r;});
 expect(rep.textContent).toMatch(/Wins 10 · Ties 0 · Losses 0/);
 expect(rep.textContent).toMatch(/AI judge.*never counts/i);
 await act(async()=>{fireEvent.click(screen.getByText('Release'));});
 await waitFor(()=>expect(document.querySelector('.pilot-status').textContent).toMatch(/released.*not active|Not active yet/i));
 await act(async()=>{fireEvent.click(screen.getByText('Activate'));});
 await waitFor(()=>expect(document.querySelector('.pilot-status').textContent).toMatch(/Active: profile version 1/));
 expect(db.prepare('SELECT kind FROM film_style_pilot_decisions WHERE project_id=? ORDER BY rowid').all(pid).map(r=>r.kind)).toEqual(['release_gate','activation']);
},30000);   // ten full blind reviews: an end-to-end run, slower than the default 5s under load
