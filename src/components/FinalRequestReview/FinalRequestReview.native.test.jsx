import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import FinalRequestReview from './FinalRequestReview.jsx';

const require=createRequire(import.meta.url);
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'fe-mounted-native-review-'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const envNames=['FILM_DATA_DIR','SEEDANCE_API_KEY','MUAPI_API_KEY'];
const previousEnv=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));
let db,contract,reviewHandler,videoHandler,originalCredential;

beforeAll(()=>{
 process.env.FILM_DATA_DIR=dataDir;
 process.env.SEEDANCE_API_KEY='mock-only';process.env.MUAPI_API_KEY='mock-only';
 ({db}=require('../../../backend/db/database'));
 require('../../../backend/db/schema').ensureSchema();
 const credentials=require('../../../backend/lib/providers/credentials');originalCredential=credentials.getCredential;
 credentials.getCredential=()=>({apiKey:'mock-only',meta:{}});
 contract=require('../../../backend/lib/final-request-review');
 ({handleFinalRequestReview:reviewHandler}=require('../../../backend/routes/final-request-review'));
 ({handleVideoGen:videoHandler}=require('../../../backend/routes/video-gen'));
});
afterEach(()=>{vi.unstubAllGlobals();delete window.__feFinalReviewBase;});
afterAll(()=>{
 if(originalCredential)require('../../../backend/lib/providers/credentials').getCredential=originalCredential;
 db?.close();fs.rmSync(dataDir,{recursive:true,force:true});
 for(const name of envNames){if(previousEnv[name]===undefined)delete process.env[name];else process.env[name]=previousEnv[name];}
});

// Run the actual route handlers and the same approval preflight/execution context
// as the HTTP dispatcher, without opening a socket or starting a server.
async function dispatch(route,options={}) {
 const body=options.body?JSON.parse(options.body):{};
 const req={method:options.method || 'GET',body};
 const parts=['film',...route.slice(1).split('/')];
 return new Promise((resolve,reject)=>{
  const res={statusCode:200,writeHead(code){this.statusCode=code;},end(serialized){const data=JSON.parse(String(serialized));resolve({ok:this.statusCode>=200&&this.statusCode<300,status:this.statusCode,json:async()=>data});}};
  const run=async()=>{
   if(parts[1]==='final-request-review')return reviewHandler(req,res,parts);
   return contract.runWithApprovals(body.final_request_approvals,async()=>{
    contract.enterExecutionContext(body.final_request_approvals,body);
    try{await contract.preflightApprovals({path:route,body});await videoHandler(req,res,parts,{});}
    catch(error){res.writeHead(error.status||500);res.end(JSON.stringify({error:error.message}));}
   });
  };
  run().catch(reject);
 });
}
async function blobBytes(blob) {
 if(blob.arrayBuffer)return Buffer.from(await blob.arrayBuffer());
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(Buffer.from(reader.result));reader.onerror=reject;reader.readAsArrayBuffer(blob);});
}
function fixture() {
 const project=crypto.randomUUID(),scene=crypto.randomUUID(),shots=[],bytes=[];
 db.prepare('INSERT INTO film_projects(id,title,provider_config) VALUES(?,?,?)').run(project,'Mounted native proof',JSON.stringify({video:'seedance',video_model:'seedance-2.5'}));
 db.prepare('INSERT INTO film_scenes(id,project_id,scene_number) VALUES(?,?,1)').run(scene,project);
 for(let i=0;i<2;i++){
  const shot=crypto.randomUUID(),asset=crypto.randomUUID(),file=path.join(dataDir,`${shot}.png`),pixels=Buffer.alloc(320*180*4,255);
  for(let p=0;p<pixels.length;p+=4){pixels[p]=i?201:37;pixels[p+1]=i?53:181;}
  const image=require('../../../backend/lib/png-raster').encode({width:320,height:180,pixels});fs.writeFileSync(file,image);bytes.push(image);
  db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,?)').run(shot,scene,`${i+1}A`,JSON.stringify({description:`Distinct frame ${i}`,action:`Motion from frame ${i}`,duration_s:5}));
  db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES(?,?,?,'storyboard',?,?,1)").run(asset,project,shot,file,path.basename(file));shots.push(shot);
 }
 return {project,shots,bytes};
}
function installTransport() {
 const browserRequests=[],posts=[],uploads=[];
 const transport=vi.fn(async(url,options={})=>{
  const href=String(url);
  if(href.startsWith('http://review.mock.invalid/film/')){
   const route=new URL(href).pathname.slice('/film'.length);browserRequests.push({route,body:options.body?JSON.parse(options.body):null});
   return dispatch(route,options);
  }
  if(href.endsWith('/upload_file')){
   const bytes=await blobBytes(options.body.get('file'));
   // Bind the mock URL to bytes, not call order: a role swap must fail equality.
   const sha256=hash(bytes),hosted=`https://uploaded.mock.invalid/${sha256}`;uploads.push({url:hosted,bytes,sha256});
   return {ok:true,status:200,json:async()=>({url:hosted})};
  }
  if(options.method!=='POST')throw new Error(`Unexpected native transport: ${options.method || 'GET'} ${href}`);
  posts.push({url:href,serialized:options.body,body:JSON.parse(options.body)});
  return {ok:false,status:400,json:async()=>({error:'Mock stops after recording the serialized native request'})};
 });
 vi.stubGlobal('fetch',transport);window.__feFinalReviewBase=()=> 'http://review.mock.invalid/film';
 return {browserRequests,posts,uploads};
}

describe('mounted DOM snapshot through real review store and native video transport',()=>{
 it('sends the DOM-visible edited endpoint, body, explicit seed and distinct ordered frame bytes once',async()=>{
  const f=fixture(),{browserRequests,posts,uploads}=installTransport(),route=`/shots/${f.shots[0]}/video/generate`;
  const body={provider:'seedance',model:'seedance-2.5',seed:314159,options:{duration:5,last_frame:f.shots[1]}};
  render(<FinalRequestReview/>);
  let prepareFailure;
  const outgoing=window.__fePrepareFinalRequest(route,{method:'POST',body:JSON.stringify(body)}).then(options=>fetch('http://review.mock.invalid/film'+route,options)).catch(error=>{prepareFailure=error;return error;});
  await waitFor(()=>{if(prepareFailure)throw prepareFailure;expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByRole('heading',{name:'Are you ready to generate the video?'})).toBeTruthy();});expect(posts).toHaveLength(0);expect(uploads).toHaveLength(0);
  const initial=JSON.parse(screen.getByLabelText('Exact resolved provider request').textContent);
  const editedPrompt='The visible final motion prompt. Preserve the ordered first and last frames.';
  fireEvent.change(screen.getByLabelText('Resolved provider fields'),{target:{value:JSON.stringify({...initial.body,prompt:editedPrompt,seed:271828})}});
  fireEvent.click(screen.getByRole('button',{name:'Resolve edits and update final review'}));
  await waitFor(()=>expect(JSON.parse(screen.getByLabelText('Exact resolved provider request').textContent).body.seed).toBe(271828));
  const visible=JSON.parse(screen.getByLabelText('Exact resolved provider request').textContent);
  expect(visible.body.prompt).toBe(editedPrompt);expect(visible.endpoint).toContain('first-last-frame');
  expect(visible.references.map(ref=>ref.wire_role)).toEqual(['images_list[0]','images_list[1]']);expect(visible.references.map(ref=>ref.order)).toEqual([1,2]);expect(visible.references.map(ref=>ref.role)).toEqual(['image_reference','image_reference']);
  expect(visible.references.map(ref=>ref.sha256)).toEqual(f.bytes.map(hash));expect(new Set(visible.references.map(ref=>ref.sha256)).size).toBe(2);
  visible.references.forEach((ref,i)=>{expect(screen.getByAltText(`Resolved reference ${i+1}`).getAttribute('src')).toBe(ref.data);expect(visible.body.images_list[i]).toBe(ref.data);});
  const visibleFingerprint=screen.getByText(/Approved request fingerprint:/).textContent.replace('Approved request fingerprint: ','');
  expect(posts).toHaveLength(0);expect(uploads).toHaveLength(0);
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Send exact reviewed request'}));
  const result=await outgoing;expect(result.status).toBe(400);
  const approval=browserRequests.find(request=>request.route.endsWith('/approve'));expect(approval.body.fingerprint).toBe(visibleFingerprint);
  const generation=browserRequests.find(request=>request.route===route);expect(generation.body.final_request_approvals).toEqual([{id:approval.route.split('/')[2],fingerprint:visibleFingerprint}]);
  expect(posts).toHaveLength(1);expect(posts[0].url).toBe(visible.endpoint);expect(uploads).toHaveLength(visible.references.length);
  const expected={...visible.body,images_list:visible.references.map(ref=>`https://uploaded.mock.invalid/${ref.sha256}`)};
  expect(posts[0].body).toEqual(expected);expect(posts[0].serialized).toBe(JSON.stringify(expected));expect(posts[0].body.seed).toBe(271828);
  uploads.forEach((upload,i)=>{expect(upload.sha256).toBe(visible.references[i].sha256);expect(upload.bytes).toEqual(f.bytes[i]);expect(posts[0].body.images_list[i]).toBe(upload.url);});
 });
 it('cancels durable original and edited batch reviews when the later mounted item is cancelled, with no native submission',async()=>{
  const f=fixture(),{browserRequests,posts,uploads}=installTransport(),route=`/projects/${f.project}/video/batch`;
  render(<FinalRequestReview/>);
  const outcome=window.__fePrepareFinalRequest(route,{method:'POST',body:JSON.stringify({provider:'seedance',model:'seedance-2.5',seed:12345})}).then(options=>fetch('http://review.mock.invalid/film'+route,options)).catch(error=>error);
  await screen.findByRole('dialog');const originalFingerprint=screen.getByText(/Approved request fingerprint:/).textContent.replace('Approved request fingerprint: ','');
  fireEvent.change(screen.getByLabelText('Full prompt'),{target:{value:'Edited first batch item exact final prompt.'}});fireEvent.click(screen.getByRole('button',{name:'Resolve edits and update final review'}));
  await waitFor(()=>expect(screen.getByText(/Approved request fingerprint:/).textContent).not.toContain(originalFingerprint));
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve item and review next'}));await screen.findByText(/\(2 of 2\)/);
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect((await outcome).code).toBe('FINAL_REQUEST_CANCELLED');
  const rows=db.prepare('SELECT id,state FROM film_final_request_reviews WHERE json_extract(editable_json,\'$.provenance.project_id\')=?').all(f.project);
  expect(rows).toHaveLength(3);expect(rows.every(row=>row.state==='cancelled')).toBe(true);
  const approved=browserRequests.find(request=>request.route.endsWith('/approve'));
  expect(browserRequests.map(request=>request.route)).toContain(approved.route.replace('/approve','/cancel'));
  expect(browserRequests.some(request=>request.route===route)).toBe(false);expect(posts).toHaveLength(0);expect(uploads).toHaveLength(0);
 });
});
