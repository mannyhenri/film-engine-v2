'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-tests-'));process.env.FILM_DATA_DIR=temp;
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const {createHandoffStore,targetFor}=require('../lib/image-handoff'),desktop=require('../../electron/image-handoff.cjs');
const png=require('../lib/png-raster').encode({width:2,height:2,pixels:Buffer.alloc(16,255)}),data='data:image/png;base64,'+png.toString('base64');
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64');
const reviews=new Map();let validations=0;
const reviewStore={get:id=>reviews.get(id),validate:id=>{validations++;return reviews.get(id).snapshot;},cancel:id=>{reviews.get(id).state='cancelled';}};
const handoffs=createHandoffStore(db,reviewStore);
function fixture(kind='character') {
 const project=crypto.randomUUID(),id=crypto.randomUUID(),reviewId=crypto.randomUUID();
 db.prepare('INSERT INTO film_projects (id,title) VALUES (?,?)').run(project,'Fixture');
 let provenance;
 if(kind==='storyboard') {const scene=crypto.randomUUID();db.prepare('INSERT INTO film_scenes (id,project_id,scene_number) VALUES (?,?,1)').run(scene,project);db.prepare("INSERT INTO film_shots (id,scene_id,shot_code,scene_card_yaml) VALUES (?,?,?,'{}')").run(id,scene,'1A');provenance={project_id:project,shot_id:id};}
 else {db.prepare('INSERT INTO film_characters (id,project_id,name,appearance_prompt,description) VALUES (?,?,?,?,?)').run(id,project,'Lead','Distinct appearance','Biography');provenance={project_id:project,subject_kind:'character',subject_id:id,view:'front'};}
 const file=path.join(temp,reviewId+'.png');fs.writeFileSync(file,png);provenance.source_paths=[file];
 const snapshot={provider:'openai',capability:'image',model:'gpt-image-1',endpoint:'https://api.openai.com/v1/images/edits',adapterVersion:'fixture',body:{prompt:'Exact reviewed prompt\nWith a second line.',model:'gpt-image-1',n:1,size:'1024x1024'},references:[{data,mime:'image/png',sha256:crypto.createHash('sha256').update(png).digest('hex'),role:'identity'}]};
 const review={id:reviewId,fingerprint:crypto.randomUUID(),state:'preview',snapshot,editable:{provider:'openai',capability:'image',payload:{prompt:'Unresolved draft must never be copied',n:1},provenance}};
 reviews.set(reviewId,review);
 db.prepare('INSERT INTO film_final_request_reviews (id,fingerprint,snapshot_json,editable_json,provenance_json) VALUES (?,?,?,?,?)').run(reviewId,review.fingerprint,JSON.stringify(snapshot),JSON.stringify(review.editable),'{}');
 return {project,id,review,file};
}
function prepare(f){return handoffs.create(f.review.id,{fingerprint:f.review.fingerprint,human_confirmed:true});}
function unzip(buffer) {let offset=0;const files={};while(buffer.readUInt32LE(offset)===0x04034b50){const size=buffer.readUInt32LE(offset+18),nameSize=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28),name=buffer.subarray(offset+30,offset+30+nameSize).toString();const start=offset+30+nameSize+extra;const bytes=buffer.subarray(start,start+size);assert.equal(require('../lib/handoff-zip').crc32(bytes),buffer.readUInt32LE(offset+14));files[name]=bytes;offset=start+size;}return files;}
test.after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true});});
test('manual approval freezes exact prompt/settings/ordered bytes/target; disables API reuse and exports a valid ZIP',()=>{
 const f=fixture(),h=prepare(f);assert.equal(h.prompt,f.review.snapshot.body.prompt);assert.notEqual(h.prompt,f.review.editable.payload.prompt);assert.equal(f.review.state,'cancelled');assert.equal(h.target.subject_id,f.id);
 assert.equal(prepare(f).id,h.id);assert.throws(()=>handoffs.create(f.review.id,{fingerprint:'wrong',human_confirmed:true}),/fingerprint/);
 const exported=handoffs.packageFor(h.id),files=unzip(Buffer.from(exported.data.split(',')[1],'base64'));
 assert.deepEqual(files['references/01.png'],png);assert.equal(files['prompt.txt'].toString(),h.prompt);
 const manifest=JSON.parse(files['manifest.json']);assert.equal(manifest.target.subject_id,f.id);assert.deepEqual(manifest.snapshot,f.review.snapshot);assert.equal(manifest.references[0].order,1);
});
test('subject import is an immutable new version; repeated import is idempotent and old unique text survives',()=>{
 const f=fixture();const prior=crypto.randomUUID(),file=path.join(temp,prior+'.png');fs.writeFileSync(file,png);
 db.prepare("INSERT INTO film_assets (id,project_id,character_id,asset_type,file_path,file_name,version,metadata) VALUES (?,?,?,'character_sheet',?,?,1,?)").run(prior,f.project,f.id,file,path.basename(file),JSON.stringify({view:'front',plate_role:'reference'}));
 const original=db.prepare('SELECT * FROM film_characters WHERE id=?').get(f.id),h=prepare(f),result=handoffs.importResult(h.id,{data});
 assert.equal(result.version,2);assert.notEqual(result.asset_id,prior);assert.deepEqual(fs.readFileSync(file),png);assert.equal(require('../lib/subject-gallery').roleOf(db.prepare('SELECT * FROM film_assets WHERE id=?').get(prior)),'superseded');
 assert.deepEqual(db.prepare('SELECT * FROM film_characters WHERE id=?').get(f.id),original);assert.deepEqual(handoffs.importResult(h.id,{data}),result);
});
test('changed character/slot, deleted source and new storyboard selections reject import rather than redirecting it',()=>{
 const f=fixture(),h=prepare(f);db.prepare('UPDATE film_characters SET appearance_prompt=? WHERE id=?').run('Changed appearance',f.id);
 assert.throws(()=>handoffs.importResult(h.id,{data}),/changed/);
 const d=fixture(),hd=prepare(d);fs.unlinkSync(d.file);assert.throws(()=>handoffs.importResult(hd.id,{data}),/changed/);
 const b=fixture('storyboard'),hb=prepare(b);db.prepare('UPDATE film_shots SET current_frame_version=3 WHERE id=?').run(b.id);assert.throws(()=>handoffs.importResult(hb.id,{data}),/changed/);
});
test('expression handoff imports into its captured slot; stale, deleted and competing slot imports cannot overwrite newer history',()=>{
 function expressionFixture(){const f=fixture(),anchor=crypto.randomUUID();db.prepare("INSERT INTO film_assets (id,project_id,character_id,asset_type,file_path,file_name,metadata) VALUES (?,?,?,'character_sheet',?,?,?)").run(anchor,f.project,f.id,f.file,path.basename(f.file),JSON.stringify({view:'front',plate_role:'reference'}));f.review.editable.provenance.expression={slot_id:'slot-3',revision:0,label:'Anger',direction:'Tight mouth',identity_asset_id:anchor,reference_role:'expression',framing:'face_closeup'};return f;}
 const f=expressionFixture(),h=prepare(f),out=handoffs.importResult(h.id,{data});
 assert.equal(h.target.kind,'expression');assert.equal(h.target.expression.direction,'Tight mouth');
 assert.equal(require('../lib/character-expressions').store().slot(f.id,'slot-3').active_asset_id,out.asset_id);
 const stale=expressionFixture(),hs=prepare(stale);require('../lib/character-expressions').store().importImage(stale.id,'slot-3',{revision:0,data});
 assert.throws(()=>handoffs.importResult(hs.id,{data}),/changed/);assert.equal(require('../lib/character-expressions').store().history(stale.id,'slot-3').length,1);
 const d=expressionFixture(),hd=prepare(d);db.prepare('DELETE FROM film_characters WHERE id=?').run(d.id);assert.throws(()=>handoffs.importResult(hd.id,{data}),/deleted/);
});
test('competing handoffs for one subject preserve the first new version and refuse a stale second import',()=>{
 const f=fixture(),a=prepare(f),secondId=crypto.randomUUID(),second={...f.review,id:secondId,fingerprint:crypto.randomUUID(),state:'preview'};
 reviews.set(secondId,second);db.prepare('INSERT INTO film_final_request_reviews (id,fingerprint,snapshot_json,editable_json,provenance_json) VALUES (?,?,?,?,?)').run(secondId,second.fingerprint,JSON.stringify(second.snapshot),JSON.stringify(second.editable),'{}');
 const b=handoffs.create(secondId,{fingerprint:second.fingerprint,human_confirmed:true}),one=handoffs.importResult(a.id,{data});
 assert.throws(()=>handoffs.importResult(b.id,{data}),/changed/);assert.deepEqual(handoffs.importResult(a.id,{data}),one);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM film_assets WHERE character_id=?").get(f.id).n,1);
 db.prepare("UPDATE film_image_handoffs SET state='cancelled' WHERE id=?").run(b.id);assert.throws(()=>handoffs.importResult(b.id,{data}),/cancelled/);
});
test('storyboard import pins a new unique version and preserves prior frame bytes',()=>{
 const f=fixture('storyboard'),prior=crypto.randomUUID(),file=path.join(temp,prior+'.png');fs.writeFileSync(file,png);
 db.prepare("INSERT INTO film_assets (id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES (?,?,?,'storyboard',?,?,1)").run(prior,f.project,f.id,file,path.basename(file));
 const h=prepare(f),out=handoffs.importResult(h.id,{data});assert.equal(out.version,2);assert.equal(require('../lib/selected-frame').selectedFrame(db,f.id).id,out.asset_id);assert.deepEqual(fs.readFileSync(file),png);
});
function mismatchedBoard() {
 const f=fixture('storyboard'),storage=require('../lib/file-storage');
 f.live=storage.getFilePath(f.project,'storyboards','1A.png');fs.mkdirSync(path.dirname(f.live),{recursive:true});
 f.old=require('../lib/png-raster').encode({width:2,height:2,pixels:Buffer.alloc(16,30)});fs.writeFileSync(f.live,f.old);
 f.prior=crypto.randomUUID();f.selected=crypto.randomUUID();f.selectedFile=storage.getFilePath(f.project,'storyboards',`chatgpt_${f.selected}.png`);fs.writeFileSync(f.selectedFile,png);
 for(const [id,file,version] of [[f.prior,f.live,4],[f.selected,f.selectedFile,5]])db.prepare("INSERT INTO film_assets (id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES (?,?,?,'storyboard',?,?,?)").run(id,f.project,f.id,file,path.basename(file),version);
 db.prepare('UPDATE film_shots SET current_frame_version=5 WHERE id=?').run(f.id);return f;
}
test('guarded handoff activates served pixels and preserves the actual live v4 owner with v5 still selected',()=>{
 const f=mismatchedBoard(),original=db.prepare('SELECT * FROM film_shots WHERE id=?').get(f.id),h=prepare(f),out=handoffs.importResult(h.id,{data});
 assert.equal(out.version,6);assert.deepEqual(fs.readFileSync(f.live),png);assert.deepEqual(fs.readFileSync(f.selectedFile),png);
 const prior=db.prepare('SELECT * FROM film_assets WHERE id=?').get(f.prior);assert.deepEqual(fs.readFileSync(prior.file_path),f.old);assert.match(prior.file_path,/1A_v4\.png$/);
 assert.deepEqual({...db.prepare('SELECT * FROM film_shots WHERE id=?').get(f.id),current_frame_version:original.current_frame_version,status:original.status},original);
 assert.deepEqual(handoffs.importResult(h.id,{data}),out);assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.id).n,3);
 const later=require('../lib/media-imports').importMedia('storyboard-image',{shotId:f.id,bytes:f.old,mime:'image/png'});
 assert.deepEqual(handoffs.importResult(h.id,{data}),out);assert.equal(require('../lib/selected-frame').selectedFrame(db,f.id).id,later.asset_id);assert.deepEqual(fs.readFileSync(f.live),f.old);
});
test('handoff receipt failure after activation rolls back originals and prepared state; the same handoff retries once',()=>{
 const f=mismatchedBoard(),before=db.prepare('SELECT * FROM film_assets WHERE shot_id=? ORDER BY id').all(f.id),h=prepare(f);
 db.exec(`CREATE TRIGGER handoff_failure BEFORE UPDATE OF state ON film_image_handoffs WHEN NEW.id='${h.id}' AND NEW.state='imported' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END;`);
 assert.throws(()=>handoffs.importResult(h.id,{data}),/fixture receipt failure/);
 assert.deepEqual(db.prepare('SELECT * FROM film_assets WHERE shot_id=? ORDER BY id').all(f.id),before);assert.deepEqual(fs.readFileSync(f.live),f.old);assert.deepEqual(fs.readFileSync(f.selectedFile),png);assert.equal(handoffs.get(h.id).state,'prepared');
 assert.equal(fs.readdirSync(path.dirname(f.live)).filter(name=>name.startsWith('chatgpt_')).length,1);
 db.exec('DROP TRIGGER handoff_failure');const result=handoffs.importResult(h.id,{data});assert.equal(result.version,6);assert.deepEqual(fs.readFileSync(f.live),png);
});
test('live bytes changing independently of the selected immutable asset reject a prepared handoff',()=>{
 const f=mismatchedBoard(),h=prepare(f);fs.writeFileSync(f.live,png);
 assert.throws(()=>handoffs.importResult(h.id,{data}),/captured target.*changed/);assert.equal(handoffs.get(h.id).state,'prepared');assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.id).n,2);
});
test('a live edit after handoff validation and before activation is retained with no imported receipt',()=>{
 const f=mismatchedBoard(),h=prepare(f),before=db.prepare('SELECT * FROM film_assets WHERE shot_id=? ORDER BY id').all(f.id),rename=fs.renameSync;
 let injected=false;const external=require('../lib/png-raster').encode({width:2,height:2,pixels:Buffer.alloc(16,180)});
 fs.renameSync=(from,to)=>{rename(from,to);if(path.basename(to).startsWith('chatgpt_') && !injected){injected=true;fs.writeFileSync(f.live,external);}};
 try {assert.throws(()=>handoffs.importResult(h.id,{data}),error=>error.status===409 && /Live storyboard changed/.test(error.message));}finally {fs.renameSync=rename;}
 assert.equal(injected,true);assert.deepEqual(fs.readFileSync(f.live),external);assert.deepEqual(fs.readFileSync(f.selectedFile),png);
 assert.deepEqual(db.prepare('SELECT * FROM film_assets WHERE shot_id=? ORDER BY id').all(f.id),before);assert.equal(handoffs.get(h.id).state,'prepared');
 assert.equal(fs.readdirSync(path.dirname(f.live)).filter(name=>name.startsWith('chatgpt_')).length,1);
});
test('an already locked board cannot activate a manual handoff',()=>{
 const f=mismatchedBoard();db.prepare('UPDATE film_projects SET board_locked_at=CURRENT_TIMESTAMP WHERE id=?').run(f.project);const h=prepare(f);
 assert.throws(()=>handoffs.importResult(h.id,{data}),error=>error.status===423 && /locked/.test(error.message));
 assert.deepEqual(fs.readFileSync(f.live),f.old);assert.equal(handoffs.get(h.id).state,'prepared');
});
test('retrying an old imported receipt reconciles its still-selected live mismatch without creating a duplicate',()=>{
 const f=mismatchedBoard(),h=prepare(f),result={asset_id:f.selected,version:5,activated:true,target:h.target};
 db.prepare("UPDATE film_image_handoffs SET state='imported',result_json=? WHERE id=?").run(JSON.stringify(result),h.id);
 assert.deepEqual(handoffs.importResult(h.id,{data}),result);assert.deepEqual(fs.readFileSync(f.live),png);assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.id).n,2);
 assert.deepEqual(fs.readFileSync(db.prepare('SELECT file_path FROM film_assets WHERE id=?').get(f.prior).file_path),f.old);
});
test('an imported receipt cannot reconcile a locked mismatch; genuine no-op retries remain idempotent when locked',()=>{
 const f=mismatchedBoard(),h=prepare(f),result={asset_id:f.selected,version:5,activated:true,target:h.target};
 db.prepare("UPDATE film_image_handoffs SET state='imported',result_json=? WHERE id=?").run(JSON.stringify(result),h.id);
 db.prepare('UPDATE film_projects SET board_locked_at=CURRENT_TIMESTAMP WHERE id=?').run(f.project);
 assert.throws(()=>handoffs.importResult(h.id,{data}),error=>error.status===423 && /locked/.test(error.message));
 assert.deepEqual(fs.readFileSync(f.live),f.old);assert.equal(db.prepare('SELECT file_path FROM film_assets WHERE id=?').get(f.prior).file_path,f.live);
 db.prepare('UPDATE film_projects SET board_locked_at=NULL WHERE id=?').run(f.project);assert.deepEqual(handoffs.importResult(h.id,{data}),result);
 db.prepare('UPDATE film_projects SET board_locked_at=CURRENT_TIMESTAMP WHERE id=?').run(f.project);
 assert.deepEqual(handoffs.importResult(h.id,{data}),result);assert.deepEqual(fs.readFileSync(f.live),png);assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.id).n,2);
});
test('non-PNG storyboard handoffs reject before writing any asset or live bytes',()=>{
 const f=mismatchedBoard(),h=prepare(f),before=db.prepare('SELECT * FROM film_assets WHERE shot_id=? ORDER BY id').all(f.id);
 require('../lib/media-imports').validateBytes({kind:'image',mimes:['image/jpeg']},'image/jpeg',jpeg);
 assert.throws(()=>handoffs.importResult(h.id,{bytes:jpeg,mime:'image/jpeg'}),error=>error.status===400 && /re-export.*PNG/.test(error.message));
 assert.deepEqual(db.prepare('SELECT * FROM film_assets WHERE shot_id=? ORDER BY id').all(f.id),before);assert.deepEqual(fs.readFileSync(f.live),f.old);assert.equal(handoffs.get(h.id).state,'prepared');
});
test('subject JPEG handoffs preserve supported JPEG bytes and subject text',()=>{
 const f=fixture(),before=db.prepare('SELECT * FROM film_characters WHERE id=?').get(f.id),h=prepare(f),out=handoffs.importResult(h.id,{bytes:jpeg,mime:'image/jpeg'});
 const asset=db.prepare('SELECT * FROM film_assets WHERE id=?').get(out.asset_id);
 assert.equal(asset.mime_type,'image/jpeg');assert.equal(asset.format,'jpg');assert.deepEqual(fs.readFileSync(asset.file_path),jpeg);assert.deepEqual(db.prepare('SELECT * FROM film_characters WHERE id=?').get(f.id),before);
});
test('captured immutable source changes during final persistence reject a fresh import and preserve the external edit',()=>{
 const f=mismatchedBoard(),h=prepare(f),before=db.prepare('SELECT * FROM film_assets WHERE shot_id=? ORDER BY id').all(f.id),journal=path.join(path.dirname(f.live),`.activation-${f.id}.json`),rename=fs.renameSync;
 let injected=false;const external=require('../lib/png-raster').encode({width:2,height:2,pixels:Buffer.alloc(16,180)});
 fs.renameSync=(from,to)=>{rename(from,to);if(to===journal && JSON.parse(fs.readFileSync(journal,'utf8')).afterDatabase && !injected){injected=true;fs.writeFileSync(f.selectedFile,external);}};
 try {assert.throws(()=>handoffs.importResult(h.id,{data}),error=>error.status===409 && /source changed before activation commit/.test(error.message));}finally {fs.renameSync=rename;}
 assert.equal(injected,true);assert.deepEqual(db.prepare('SELECT * FROM film_assets WHERE shot_id=? ORDER BY id').all(f.id),before);
 assert.deepEqual(fs.readFileSync(f.live),f.old);assert.deepEqual(fs.readFileSync(f.selectedFile),external);assert.equal(handoffs.get(h.id).state,'prepared');assert.equal(fs.existsSync(journal),false);
});
test('video/audio/3D/upscale/dependent station targets and malformed imports are excluded',()=>{
 for(const capability of ['video','image-upscale','audio','threed'])assert.throws(()=>targetFor({snapshot:{capability},editable:{provenance:{shot_id:'s'}}}),/image generation only/);
 assert.throws(()=>targetFor({snapshot:{capability:'image'},editable:{provenance:{shot_id:'s',station_index:1}}}),/dependent/);
 const f=fixture(),h=prepare(f);assert.throws(()=>handoffs.importResult(h.id,{data:'data:image/png;base64,bm90YW5pbWFnZQ=='}),/not a PNG/);assert.equal(handoffs.get(h.id).state,'prepared');
});
test('desktop availability and launch are truthful; exact copy is verified and fixed arguments prohibit injected commands',async()=>{
 const f=fixture(),h=prepare(f);let text='',launches=[];
 const deps={platform:'darwin',exists:()=>true,clipboard:{writeText:t=>{text=t;},readText:()=>text},readHandoff:async()=>h,execFile:(cmd,args,opts,done)=>{launches.push([cmd,args]);done(null);}};
 const d=desktop.createDesktopHandoff(deps),out=await d.copyAndOpen(h.id);
 assert(out.copied&&out.opened);assert.equal(text,h.prompt);assert.deepEqual(launches,[['/usr/bin/open',['-a','/Applications/ChatGPT.app']]]);
 await assert.rejects(()=>d.copyAndOpen('id; touch /tmp/pwn'),/Invalid/);
 for(const extra of [{platform:'linux'},{exists:()=>false},{disabled:true}]){const missing=desktop.createDesktopHandoff({...deps,...extra});assert.equal(missing.availability().available,false);assert.equal((await missing.copyAndOpen(h.id)).available,false);}
 const failed=desktop.createDesktopHandoff({...deps,clipboard:{writeText(){throw new Error('Clipboard unavailable');},readText:()=>''}});assert.equal((await failed.copyAndOpen(h.id)).copied,false);assert.equal(launches.length,1);
 const launchFail=desktop.createDesktopHandoff({...deps,execFile:(c,a,o,done)=>done(new Error('Launch failed'))});const partial=await launchFail.copyAndOpen(h.id);assert.equal(partial.copied,true);assert.equal(partial.opened,false);
});
