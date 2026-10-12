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
 it('hands over the DOM-visible edited prompt, settings and distinct ordered frame bytes and sends nothing',async()=>{
  const f=fixture(),{browserRequests,posts,uploads}=installTransport(),route=`/shots/${f.shots[0]}/video/generate`;
  const body={provider:'seedance',model:'seedance-2.5',seed:314159,options:{duration:5,last_frame:f.shots[1]}};
  render(<FinalRequestReview/>);
  let prepareFailure;
  const outgoing=window.__fePrepareFinalRequest(route,{method:'POST',body:JSON.stringify(body)}).then(options=>fetch('http://review.mock.invalid/film'+route,options)).catch(error=>{prepareFailure=error;return error;});
  await waitFor(()=>{if(prepareFailure)throw prepareFailure;expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByRole('heading',{name:'Prompt and assets for Seedance'})).toBeTruthy();});expect(posts).toHaveLength(0);expect(uploads).toHaveLength(0);
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
  expect(screen.getByLabelText('Prompt to copy').textContent).toBe(editedPrompt);
  expect(screen.getByRole('list',{name:'Assets to upload'}).querySelectorAll('li')).toHaveLength(2);
  expect(screen.queryByRole('button',{name:/Send|Approve/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  expect((await outgoing).code).toBe('FINAL_REQUEST_CANCELLED');
  expect(browserRequests.some(request=>request.route.endsWith('/approve')||request.route===route)).toBe(false);
  expect(posts).toHaveLength(0);expect(uploads).toHaveLength(0);
 });
 it('Close cancels durable original, edited and remaining batch reviews, with no native submission',async()=>{
  const f=fixture(),{browserRequests,posts,uploads}=installTransport(),route=`/projects/${f.project}/video/batch`;
  render(<FinalRequestReview/>);
  const outcome=window.__fePrepareFinalRequest(route,{method:'POST',body:JSON.stringify({provider:'seedance',model:'seedance-2.5',seed:12345})}).then(options=>fetch('http://review.mock.invalid/film'+route,options)).catch(error=>error);
  await screen.findByRole('dialog');const original=screen.getByRole('dialog').dataset.review;
  fireEvent.change(screen.getByLabelText('Full prompt'),{target:{value:'Edited first batch item exact final prompt.'}});fireEvent.click(screen.getByRole('button',{name:'Resolve edits and update final review'}));
  await waitFor(()=>expect(screen.getByRole('dialog').dataset.review).not.toBe(original));
  fireEvent.click(screen.getByRole('button',{name:'Close'}));expect((await outcome).code).toBe('FINAL_REQUEST_CANCELLED');
  const rows=db.prepare('SELECT id,state FROM film_final_request_reviews WHERE json_extract(editable_json,\'$.provenance.project_id\')=?').all(f.project);
  expect(rows).toHaveLength(3);expect(rows.every(row=>row.state==='cancelled')).toBe(true);
  expect(browserRequests.some(request=>request.route.endsWith('/approve'))).toBe(false);
  expect(browserRequests.some(request=>request.route===route)).toBe(false);expect(posts).toHaveLength(0);expect(uploads).toHaveLength(0);
 });
});
