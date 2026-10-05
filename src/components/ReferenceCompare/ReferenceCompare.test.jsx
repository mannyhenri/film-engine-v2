// GRD-4666: the reference/board comparison a person decides from: synchronized pictures with an opacity
// overlay, landmarks and subject bounds, every drift check, marking, disposition and pinning for video.
import { beforeEach, afterAll, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const bridge=vi.hoisted(()=>({state:{currentProject:null},api:vi.fn(),API_BASE:'http://api.test'}));
vi.mock('../../lib/legacy.js',()=>({legacy:bridge}));
import ReferenceCompare from './ReferenceCompare.jsx';
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-refcmp-ui-'));
const require=createRequire(import.meta.url);
const {db}=require('../../../backend/db/database.js');
require('../../../backend/db/schema.js').ensureSchema();
const {handlePrevis}=require('../../../backend/routes/previs.js');
const {handleScenes}=require('../../../backend/routes/scenes.js');
const rp=require('../../../backend/lib/reference-package.js');
let shot,pkg,board;
function route(handler,method,url,body){return new Promise(resolve=>{let status;const res={writeHead(c){status=c;return this;},setHeader(){},write(){},end(s){let d;try{d=JSON.parse(s);}catch{d=s;}resolve({status,body:d});}};
 Promise.resolve(handler({method,body:body||{},headers:{}},res,['film',...url.split('/').filter(Boolean)])).catch(e=>resolve({status:500,body:{error:e.message}}));});}
beforeEach(async()=>{
 document.body.innerHTML='';
 const pid=crypto.randomUUID(),scene=crypto.randomUUID();shot=crypto.randomUUID();
 db.prepare('INSERT INTO film_projects(id,title,aspect_ratio) VALUES (?,?,?)').run(pid,'Compare UI','16:9');
 db.prepare('INSERT INTO film_scenes(id,project_id,scene_number,location) VALUES (?,?,1,?)').run(scene,pid,'DINER');
 db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES (?,?,?,?)').run(shot,scene,'1A',JSON.stringify({shot_code:'1A'}));
 // A package and a board, written straight to the tables the comparison reads.
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fe-refcmp-files-'));const beauty=path.join(dir,'beauty.png');const head=Buffer.alloc(33);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(head,0);head.writeUInt32BE(13,8);head.write('IHDR',12);head.writeUInt32BE(960,16);head.writeUInt32BE(540,20);fs.writeFileSync(beauty,head);   // a 960x540 PNG header: the board's real size
 const pkgId=crypto.randomUUID();
 const camera={position:[0,1.6,6],focalMm:35,width:960,height:540,sensor_width_mm:24.89,aspectRatio:'16:9'};
 const intent={text:'Mara left of the door',landmarks:[{id:'door',category:'door_window',name:'Front door',position:[1,1,0],screen:[600,260]}],subjects:[{name:'Mara',screen:[420,300],bounds:[380,200,460,420],eyeline_y:230}],horizon_y:270};
 db.prepare(`INSERT INTO film_reference_packages (id,project_id,shot_id,version,blocking_fingerprint,camera_json,intent_json,passes_json,package_fingerprint) VALUES (?,?,?,1,'bf',?,?,?,?)`)
  .run(pkgId,pid,shot,JSON.stringify(camera),JSON.stringify(intent),JSON.stringify([{kind:'beauty',path:beauty,format:'png',sha256:'x'}]),'f'.repeat(64));
 db.prepare(`INSERT INTO film_reference_approvals (id,package_id,kind,fingerprint,approved_by) VALUES (?,?,'package',?,'Manny')`).run(crypto.randomUUID(),pkgId,'f'.repeat(64));
 db.prepare('INSERT INTO film_previs_blocking (id,shot_id,camera_json,pinned_package_id) VALUES (?,?,?,?)').run(crypto.randomUUID(),shot,JSON.stringify(camera),pkgId);
 pkg=rp.getPackage(db,pkgId);
 const bid=crypto.randomUUID();
 db.prepare(`INSERT INTO film_assets (id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES (?,?,?,'storyboard',?,'1A.png',1)`).run(bid,pid,shot,beauty);
 board=bid;
 bridge.state.currentProject={id:pid,title:'Compare UI'};
 bridge.api.mockImplementation(async(url,options={})=>{
  const handler=url.startsWith('/shots/')?handlePrevis:handleScenes;
  const r=await route(handler,options.method||'GET',url,options.body?JSON.parse(options.body):{});
  if(r.status>=400)throw Error(r.body.error);return r.body;
 });
 vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterAll(()=>db.close());
async function open(){
 render(<ReferenceCompare />);
 fireEvent.click(screen.getByText('Reference compare'));
 await waitFor(()=>expect(screen.getByLabelText('Shot').options.length).toBeGreaterThan(1));
 await act(async()=>{fireEvent.change(screen.getByLabelText('Shot'),{target:{value:shot}});});
 await waitFor(()=>document.querySelector('.refcmp-stage'));
 fireEvent.change(screen.getByLabelText('Board version'),{target:{value:board}});
}

it('shows the package and the board in one frame, with an opacity overlay, landmarks and subject bounds',async()=>{
 await open();
 const [ref,brd]=[document.querySelector('img.refcmp-reference'),document.querySelector('img.refcmp-board')];
 expect(ref.getAttribute('src')).toBe(`http://api.test/film/shots/${shot}/previs/packages/${pkg.id}/passes/beauty`);
 expect(brd.getAttribute('src')).toBe(`http://api.test/film/shots/${shot}/previs/board-reviews/asset/${board}`);
 fireEvent.change(screen.getByLabelText('Board opacity'),{target:{value:'30'}});
 expect(brd.style.opacity).toBe('0.3');
 const svg=document.querySelector('svg.refcmp-overlay');
 expect(svg.getAttribute('viewBox')).toBe('0 0 960 540');
 expect(svg.querySelector('[data-landmark="door"]')).toBeTruthy();
 expect(svg.querySelector('rect[data-subject="Mara"]')).toBeTruthy();
 expect(svg.querySelector('line[data-line="horizon"]')).toBeTruthy();
});

it('an unmarked comparison goes to a person; a marked shift is flagged; a person disposes and pins for video',async()=>{
 await open();
 await act(async()=>{fireEvent.click(screen.getByText('Compare'));});
 await waitFor(()=>expect(document.querySelector('.refcmp-result').textContent).toMatch(/needs a person/i));
 // Mark the door 200px to the right of where the package has it: drift.
 fireEvent.click(document.querySelector('button[data-mark="door"]'));
 const stage=document.querySelector('.refcmp-stage');
 stage.getBoundingClientRect=()=>({left:0,top:0,width:960,height:540});
 fireEvent.click(stage,{clientX:800,clientY:260});
 for(const id of ['subject:Mara']){fireEvent.click(document.querySelector(`button[data-mark="${id}"]`));fireEvent.click(stage,{clientX:420,clientY:300});}
 fireEvent.click(document.querySelector('button[data-mark="horizon"]'));fireEvent.click(stage,{clientX:10,clientY:270});
 fireEvent.click(document.querySelector('button[data-mark="eyeline:Mara"]'));fireEvent.click(stage,{clientX:420,clientY:230});
 await act(async()=>{fireEvent.click(screen.getByText('Compare'));});
 await waitFor(()=>expect(document.querySelector('[data-check="door"]').textContent).toMatch(/drift/));
 expect(document.querySelector('[data-check="subject:Mara"]').textContent).toMatch(/ok/);
 fireEvent.change(screen.getByLabelText('Disposition'),{target:{value:'accept_with_deviations'}});
 fireEvent.change(document.querySelector('textarea[data-deviation="door"]'),{target:{value:'door moved for the dolly'}});
 fireEvent.change(screen.getByLabelText('Your name'),{target:{value:'Manny'}});
 await act(async()=>{fireEvent.click(screen.getByText('Record decision'));});
 await act(async()=>{fireEvent.click(await screen.findByText('Pin for video'));});
 await waitFor(()=>expect(document.querySelector('.refcmp-pinned').textContent).toMatch(/Pinned for video/));
 expect(db.prepare('SELECT COUNT(*) n FROM film_video_pins WHERE shot_id=?').get(shot).n).toBe(1);
});
