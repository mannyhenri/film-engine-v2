const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const media=require('./depth-media');
const {verifyInput,plateFilters,exactVideo}=require('./composite-render');
const CONTRACT='film-resolve-layers-v1';
async function planLayers({project_id,version_id,metadata,outputs}){
 if(metadata.node_type!=='composite'||!metadata.inputs)throw media.fail('Layered export requires an immutable Composite version');
 const inputs=metadata.inputs,files=[];
 for(const [role,entry] of Object.entries(outputs)){
  if(role==='manifest')continue;
  const info=metadata.outputs[role];if(!info)throw media.fail('Output provenance is incomplete');
  await verifyInput({file_path:entry.path,sha256:info.sha256});
  const names={video:'Reference/composite-preview.mp4',foreground:'Layers/subject-alpha.mov',alpha:'Data/refined-alpha.f32'};
  files.push({role:{video:'composite_reference',foreground:'foreground_layer',alpha:'refined_alpha'}[role],name:names[role],file_path:entry.path,sha256:info.sha256,bytes:entry.size});
 }
 if(await media.hashFile(outputs.manifest.path)!==metadata.manifest_sha256)throw media.fail('Composite manifest changed after publication',409);
 files.push({role:'composite_provenance',name:'Data/composite-manifest.json',file_path:outputs.manifest.path,sha256:metadata.manifest_sha256,bytes:outputs.manifest.size});
 for(const [role,a] of Object.entries(inputs).filter(([k])=>['source','alpha','background','foreground','depth'].includes(k))){
  await verifyInput(a);const ext=path.extname(a.file_path).slice(1).toLowerCase();if(!/^[a-z0-9]{1,8}$/.test(ext))throw media.fail('Layer input extension is unsupported');
  const names={source:'Source/original.'+ext,alpha:'Data/source-alpha.f32',background:'Layers/background-original.'+ext,foreground:'Layers/foreground-plate.'+ext,depth:'Data/depth.f32'};
  files.push({role:{source:'original_source',alpha:'source_alpha',background:'background_plate',foreground:'foreground_plate',depth:'depth'}[role],name:names[role],file_path:a.file_path,sha256:a.sha256,bytes:fs.statSync(a.file_path).size});
 }
 const blockers=[];if(metadata.timing.variable_frame_rate)blockers.push('VFR media retains exact timestamps; Resolve requires a separately reviewed timeline conform');if(inputs.foreground)blockers.push('Foreground plate and depth ordering require manual layer setup using the composite reference');
 const plan={contract:CONTRACT,project_id,version_id,fixture:metadata.fixture===true,quality_status:metadata.quality_status,frame_count:metadata.timing.frame_count,timing:metadata.timing,orientation:metadata.orientation,settings:metadata.settings,source_sha256:metadata.source_sha256,native_import_ready:blockers.length===0,native_import_blockers:blockers,files,source_audio:'Preserved in original source; previews and processed layers are silent',grain:'Grain is in the composite reference; add a post-composite grain effect in Resolve',alpha_precision:'Foreground MOV: 8-bit straight alpha. Refined f32 alpha is authoritative',paid:false,uploads:false};
 return {...plan,plan_fingerprint:media.digest(plan)};
}
async function writeLayers(plan,root){
 const id=crypto.randomUUID(),pending=path.join(root,'.resolve-layers-'+id),destination=path.join(root,'resolve-layers-'+id),disk=await fs.promises.statfs(root);
 const size=plan.files.reduce((n,f)=>n+f.bytes,0),t=plan.timing,pixels=plan.orientation.coded_width*plan.orientation.coded_height;
 if(size+pixels*3*t.frame_count*2+32*1024*1024>disk.bavail*disk.bsize)throw media.fail('Insufficient disk for the reviewed layer package',507);
 await fs.promises.mkdir(pending);
 try{
  const files=[];
  for(const f of plan.files){await verifyInput(f);const target=path.join(pending,f.name);await fs.promises.mkdir(path.dirname(target),{recursive:true});await fs.promises.copyFile(f.file_path,target,fs.constants.COPYFILE_EXCL);if(await media.hashFile(target)!==f.sha256)throw media.fail('Input changed during layer export',409);files.push({role:f.role,name:f.name,sha256:f.sha256,bytes:f.bytes});}
  const ff=require('./ffmpeg').resolveFfmpeg();if(!ff.available)throw media.fail('FFmpeg unavailable for the fitted background layer',503);
  const work=path.join(pending,'.background-work');await fs.promises.mkdir(work);
  const raw=path.join(work,'plate.rgb'),sequence=path.join(work,'sequence.rgb');
  const background=plan.files.find(f=>f.role==='background_plate');
  await media.processOutput(ff.bin,['-nostdin','-v','error','-y','-i',path.join(pending,background.name),'-vf',plateFilters(plan),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',raw]);
  const frame=await fs.promises.readFile(raw);if(frame.length!==pixels*3)throw media.fail('Background geometry differs from the reviewed output');
  const stream=await fs.promises.open(sequence,'wx');try{for(let i=0;i<t.frame_count;i++){let at=0;while(at<frame.length){const r=await stream.write(frame,at,frame.length-at);if(!r.bytesWritten)throw media.fail('Background frame could not be written');at+=r.bytesWritten;}}}finally{await stream.close();}
  const video=path.join(pending,'Layers/background.mp4');await exactVideo(ff.bin,sequence,video,{timing:t,orientation:plan.orientation,settings:plan.settings});
  files.push({role:'background_layer',name:'Layers/background.mp4',sha256:await media.hashFile(video),bytes:fs.statSync(video).size});await fs.promises.rm(work,{recursive:true});
  const helper=fs.readFileSync(path.join(__dirname,'resolve-layer-import.py'));await fs.promises.writeFile(path.join(pending,'Import reviewed layers.py'),helper);files.push({role:'guarded_import_helper',name:'Import reviewed layers.py',sha256:crypto.createHash('sha256').update(helper).digest('hex'),bytes:helper.length});
  const readme=Buffer.from(`${plan.fixture?'SYNTHETIC TEST PACKAGE — no subject-matte quality claim.\n\n':''}Film Engine Resolve layers\n\nOriginal source bytes are preserved in Source/. Subject foreground carries 8-bit straight alpha; Data/refined-alpha.f32 retains authoritative float alpha. Background video is fitted and oriented exactly as the composite. Original plate, alpha and optional foreground/depth are separate. Reference/ contains the reviewed composite; colour corrections are baked into the subject foreground. Grain is applied only to the composite reference. Source audio is retained in the original; align it manually.\n\nTiming and source frame correspondence remain exact in manifest.json. ${plan.native_import_blockers.join('. ')}\n\nNothing in this package connects to Resolve or changes its settings. Import media manually into a backed-up project and a duplicate timeline. The optional Python helper accepts an already authorized Resolve object; inspect_current(resolve) returns the exact project/timeline identities. Call import_reviewed(resolve, package_directory, expected_project_id, expected_timeline_id, expected_manifest_sha256=the_reviewed_manifest_checksum) only after reviewing those identities and permissions. It verifies package hashes, matching timeline rate/dimensions, a saved project backup and a separate duplicate before appending two video layers; the original timeline is restored. Synthetic packages require explicit allow_fixture=True. VFR and foreground/depth packages require manual conform and are refused by the helper. No renderer or native-import success is claimed by export.\n`);
  await fs.promises.writeFile(path.join(pending,'READ ME.txt'),readme);files.push({role:'instructions',name:'READ ME.txt',sha256:crypto.createHash('sha256').update(readme).digest('hex'),bytes:readme.length});
  const {files:inputs,...pub}=plan,manifest={...pub,package_id:id,files,native_import_status:'not_attempted',requires_project_backup:true,requires_duplicate_timeline:true};
  await fs.promises.writeFile(path.join(pending,'manifest.json'),JSON.stringify(manifest,null,2));
  for(const f of plan.files)await verifyInput(f);
  await fs.promises.rename(pending,destination);return {id,directory:destination,manifest_sha256:await media.hashFile(path.join(destination,'manifest.json')),manifest};
 }catch(e){await fs.promises.rm(pending,{recursive:true,force:true});throw e;}
}
module.exports={CONTRACT,planLayers,writeLayers};
