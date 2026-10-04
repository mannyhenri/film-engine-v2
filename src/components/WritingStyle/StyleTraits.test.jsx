// GRD-4662: the style traits panel against the real style-profile route. Each proposed trait shows its
// plain-language rule, where it comes from, its evidence excerpts with locations and counterexamples;
// learning only proposes; the author accepts, modifies, rejects, removes and restores.
import { beforeEach, afterAll, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const bridge=vi.hoisted(()=>({state:{currentProject:null},api:vi.fn()}));
vi.mock('../../lib/legacy.js',()=>({legacy:bridge}));
import StyleTraits from './StyleTraits.jsx';
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-style-traits-ui-'));
const require=createRequire(import.meta.url);
const {db}=require('../../../backend/db/database.js');
require('../../../backend/db/schema.js').ensureSchema();
const {handleStyleProfile}=require('../../../backend/routes/style-profile.js');
const ws=require('../../../backend/lib/writing-style.js'), sp=require('../../../backend/lib/style-profile.js');
let pid, sample;
beforeEach(()=>{
 document.body.innerHTML='';
 pid=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(pid,'Traits UI');
 const store=ws.createWritingStyleStore(db);
 store.addSample(pid,{text:'She waits. He leaves. Nobody speaks. A wandering, ornate sentence follows.',source:'Journal',authorship:'original_human',confirmed_original:true});
 sample=store.snapshot(pid).samples.at(-1);
 bridge.api.mockImplementation(async(url,options={})=>{
  let status,raw;
  handleStyleProfile({method:options.method||'GET',body:options.body?JSON.parse(options.body):{},headers:{}},{writeHead(s){status=s;},end(s){raw=s;}},['film',...url.split('/').filter(Boolean)]);
  const result=JSON.parse(raw);if(status>=400)throw Error(result.error);return result;
 });
 vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterAll(()=>db.close());
const span=(find)=>({sample_id:sample.id,start:sample.text.indexOf(find),end:sample.text.indexOf(find)+find.length});
function propose(target='project',extra={}){
 sp.createStyleStore(db).proposeTrait(pid,{target,trait:{kind:'rule',statement:'Short beats; silence carries it.',source:'author_style',category:'action',
  evidence:[span('She waits.'),span('Nobody speaks.')],counterexamples:[span('A wandering, ornate sentence')],...extra}});
}
const panel=async()=>{render(<StyleTraits projectId={pid} />);await screen.findByText(/Style traits/);};

it('a proposed trait shows its rule, origin, confidence, excerpts with locations and counterexamples',async()=>{
 propose();await panel();
 const card=document.querySelector('.style-proposal');
 expect(card.textContent).toContain('Short beats; silence carries it.');
 expect(card.textContent).toContain('Author style');
 expect(card.textContent).toMatch(/confidence 0\.\d+/);
 const excerpts=[...card.querySelectorAll('.style-evidence li')].map(li=>li.textContent);
 expect(excerpts).toEqual([expect.stringContaining('“She waits.” · Journal · characters 0–10'),expect.stringContaining('“Nobody speaks.”')]);
 expect(card.querySelector('.style-counterexamples').textContent).toContain('A wandering, ornate sentence');
});

it('accept puts the trait in force after confirmation; reject and modify keep it out',async()=>{
 propose();await panel();
 await act(async()=>{fireEvent.click(screen.getByText('Accept'));});
 expect(window.confirm.mock.calls.at(-1)[0]).toContain('Short beats; silence carries it.');
 await waitFor(()=>expect(document.querySelector('.style-in-force').textContent).toContain('Short beats; silence carries it.'));
 sp.createStyleStore(db).proposeTrait(pid,{target:'project',trait:{kind:'rule',statement:'Rhyme every line.',source:'author_style',category:'general',explicit_user_rule:true,preference_source:'a joke'}});
 sp.createStyleStore(db).proposeTrait(pid,{target:'project',trait:{kind:'anti_pattern',statement:'No weather openings.',source:'author_style',category:'description',explicit_user_rule:true,preference_source:'note'}});
 await act(async()=>{fireEvent.click(screen.getByText('Refresh'));});
 const cards=()=>[...document.querySelectorAll('.style-proposal')];
 await waitFor(()=>expect(cards().length).toBe(2));
 expect(cards()[0].textContent).toContain('Explicit user rule');
 await act(async()=>{fireEvent.click(cards()[0].querySelector('button.style-reject'));});
 await waitFor(()=>expect(cards().length).toBe(1));
 fireEvent.change(cards()[0].querySelector('textarea.style-modify'),{target:{value:'No weather or time-of-day openings.'}});
 await act(async()=>{fireEvent.click(cards()[0].querySelector('button.style-save-modified'));});
 await waitFor(()=>expect(cards()[0].textContent).toContain('No weather or time-of-day openings.'));
 expect(document.querySelector('.style-in-force').textContent).not.toContain('Rhyme every line.');
});

it('a correction and an A/B choice only propose; Neither proposes nothing',async()=>{
 await panel();
 fireEvent.change(screen.getByLabelText('Before'),{target:{value:'He said angrily'}});
 fireEvent.change(screen.getByLabelText('After'),{target:{value:'He said'}});
 fireEvent.change(screen.getByLabelText('Why (optional)'),{target:{value:'let the line work'}});
 expect(screen.getByLabelText('Applies to').value).toBe('scene');
 await act(async()=>{fireEvent.click(screen.getByText('Record correction'));});
 await waitFor(()=>expect(document.querySelectorAll('.style-proposal').length).toBe(1));
 expect(document.querySelector('.style-proposal').textContent).toContain('Scene requirement');
 fireEvent.change(screen.getByLabelText('Dimension'),{target:{value:'tension'}});
 fireEvent.change(screen.getByLabelText('Option A'),{target:{value:'The door creaks.'}});
 fireEvent.change(screen.getByLabelText('Option B'),{target:{value:'Silence. Then the door.'}});
 await act(async()=>{fireEvent.click(screen.getByText('Ask me'));});
 const q=await waitFor(()=>{const el=document.querySelector('.style-pairwise');if(!el)throw Error('none');return el;});
 expect(q.textContent).toContain('The door creaks.');expect(q.textContent).toContain('Silence. Then the door.');
 await act(async()=>{fireEvent.click(screen.getByText('Neither'));});
 await waitFor(()=>expect(document.querySelector('.style-pairwise')).toBeNull());
 expect(document.querySelectorAll('.style-proposal').length).toBe(1);
 expect(document.querySelector('.style-in-force').textContent).toMatch(/nothing in force|No traits/i);
});

it('history shows each revision as plain-language changes; restore and remove-for-this-project work',async()=>{
 propose('global');
 const s=sp.createStyleStore(db);const p=s.snapshot(pid).proposals.at(-1);
 s.acceptProposal(pid,{proposal_id:p.id,approval_fingerprint:p.fingerprint,human_confirmed:true,expected_version:s.snapshot(pid).global.version});
 // A second global version, so an earlier one exists to restore.
 s.proposeTrait(pid,{target:'global',trait:{kind:'anti_pattern',statement:'No adverbs on tags.',source:'author_style',category:'dialogue',explicit_user_rule:true,preference_source:'note'}});
 const q=s.snapshot(pid).proposals.at(-1);
 s.acceptProposal(pid,{proposal_id:q.id,approval_fingerprint:q.fingerprint,human_confirmed:true,expected_version:s.snapshot(pid).global.version});
 await panel();
 await act(async()=>{fireEvent.click(document.querySelector('.style-in-force button.style-remove-here'));});
 await waitFor(()=>expect(document.querySelector('.style-in-force').textContent).not.toContain('Short beats'));
 const history=document.querySelector('.style-history').textContent;
 expect(history).toContain('Added rule: Short beats; silence carries it.');
 expect(history).toContain('Disabled for this project: rule: Short beats; silence carries it.');
 const restoreFirst=[...document.querySelectorAll('.style-history button.style-restore')].find(b=>b.dataset.target==='project'&&b.dataset.version==='0');
 expect(restoreFirst).toBeUndefined();
 await act(async()=>{fireEvent.click([...document.querySelectorAll('.style-history button.style-restore')].find(b=>b.dataset.target==='global'));});
 await waitFor(()=>expect(document.querySelector('.style-history').textContent).toMatch(/Restored version \d+/));
});
