import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {describe,it,expect,afterEach} from 'vitest';
import {installLegacy} from '../../test/setup.js';
import AIConnections from './AIConnections.jsx';
const ready={application:'film-engine-v2',opened:true,providers:[{id:'codex',label:'OpenAI Codex',state:'ready',installed:true,connected:true,available:true,note:'Film-owned local worker ready',inference_verified:false},{id:'claude',label:'Claude Code',state:'sign_in_required',installed:true,connected:false,available:false,note:'Sign in securely from AI connections',inference_verified:false}]};
afterEach(()=>{delete window.__feDesktop;});
describe('Film AI connections',()=>{
 it('web startup opens Film-owned connections without executing an AI task and releases its own lease',async()=>{
  const {calls}=installLegacy({routes:{'POST /ai-connections/attach':ready,'POST /ai-connections/detach':ready}});
  const view=render(<AIConnections/>);await screen.findByRole('button',{name:'AI connections · 1/2 ready'});
  expect(calls[0].path).toBe('/ai-connections/attach');expect(calls[0].body.owner).toMatch(/^[0-9a-f-]{36}$/);expect(calls.some(c=>c.path.includes('execute'))).toBe(false);
  view.unmount();await waitFor(()=>expect(calls.at(-1).path).toBe('/ai-connections/detach'));expect(calls.at(-1).body.owner).toBe(calls[0].body.owner);
 });
 it('desktop uses its main-process owner; sign-in requires a clear user confirmation and displays native browser flow',async()=>{
  window.__feDesktop={platform:'darwin'};
  const signing={...ready,providers:ready.providers.map(p=>p.id==='claude'?{...p,state:'signing_in',login:{url:'https://claude.ai/oauth/test',code:null}}:p)};
  const {calls}=installLegacy({routes:{'GET /ai-connections':ready,'POST /ai-connections/sign-in':signing}});
  render(<AIConnections/>);fireEvent.click(await screen.findByRole('button',{name:'AI connections · 1/2 ready'}));
  expect(screen.getAllByText(/Model response has not been verified/).length).toBe(2);expect(calls.some(c=>c.path.endsWith('/attach'))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Sign in to Claude Code'}));expect(calls.some(c=>c.path.endsWith('/sign-in'))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Start secure sign-in'}));await screen.findByRole('link',{name:'Open secure provider sign-in'});
  expect(calls.find(c=>c.path.endsWith('/sign-in')).body).toEqual({provider:'claude',human_confirmed:true});
 });
 it('shows backend activation gap clearly instead of claiming a connected provider',async()=>{
  window.__feDesktop={platform:'darwin'};installLegacy({routes:{'GET /ai-connections':{service:'old-film'}}});render(<AIConnections/>);
  fireEvent.click(screen.getByRole('button',{name:'AI connections · backend pending'}));await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toMatch(/backend is not active/);expect(screen.getByText(/Activate the updated Film/)).toBeTruthy();
 });
});
