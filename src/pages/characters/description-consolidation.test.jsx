import {describe,it,expect} from 'vitest';
import {render,act,fireEvent,screen} from '@testing-library/react';
import {installLegacy} from '../../test/setup.js';
import CharactersPage from './CharactersPage.jsx';
const input=key=>document.querySelector(`#characterModal [data-field="${key}"]`);
async function page(character) {
 let body;
 installLegacy({routes:{'GET /projects/p1/characters':{characters:[character]},'PUT /characters/c1':b=>{body=b;return {};}}});render(<CharactersPage/>);
 await act(async()=>window.loadCharacters());act(()=>window.editCharacter('c1'));
 return ()=>body;
}
describe('description consolidation preserves stored semantics',()=>{
 it('unique biography, visual appearance and personality round-trip byte-for-byte without editing',async()=>{
  const c={id:'c1',name:'Lead',description:'  Biography with\nunique detail.  ',appearance_prompt:'  Blue skin; silver eyes.  ',personality_notes:'  Gentle\nand watchful.  '};const body=await page(c);
  expect(screen.getByText('Character Description / Appearance')).toBeTruthy();expect(screen.queryByText('Appearance Prompt')).toBeNull();expect(screen.getByText('Biography / retained story notes')).toBeTruthy();
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Save'})));
  for(const key of ['description','appearance_prompt','personality_notes'])expect(body()[key]).toBeUndefined();
  expect({...c,...body()}).toEqual(c);
 });
 it('identical fields draw one visible editor but retain the old description and allow explicit appearance clearing',async()=>{
  const body=await page({id:'c1',name:'Lead',description:'Same text',appearance_prompt:'Same text',personality_notes:'Careful'});
  expect(input('description').type).toBe('hidden');expect(input('appearance_prompt').tagName).toBe('TEXTAREA');
  fireEvent.change(input('appearance_prompt'),{target:{value:''}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Save'})));
  expect(body().appearance_prompt).toBe('');expect(body().description).toBeUndefined();expect(body().personality_notes).toBeUndefined();
 });
 it('an unrelated edit never resends or truncates long retained legacy text',async()=>{
  const c={id:'c1',name:'Lead',description:'Biography '.repeat(800),appearance_prompt:'Appearance '.repeat(400),personality_notes:'Personality '.repeat(400)};const body=await page(c);
  fireEvent.change(input('gender'),{target:{value:'female'}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Save'})));
  for(const key of ['description','appearance_prompt','personality_notes'])expect(body()).not.toHaveProperty(key);
  expect({...c,...body()}).toEqual({...c,gender:'female'});
 });
 it('the character card uses the consolidated appearance, and over-limit edits stay in the form without a lossy write',async()=>{
  const c={id:'c1',name:'Lead',description:'Unique biography',appearance_prompt:'Blue skin',personality_notes:'Reserved'};const body=await page(c);
  expect(document.querySelector('.entity-card > p').textContent).toBe('Blue skin');
  const edit='Appearance '.repeat(300);fireEvent.change(input('appearance_prompt'),{target:{value:edit}});
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Save'})));
  expect(body()).toBeUndefined();expect(input('appearance_prompt').value).toBe(edit);expect(window.setStatus).toHaveBeenCalledWith(expect.stringContaining('nothing was saved'));
 });
});
