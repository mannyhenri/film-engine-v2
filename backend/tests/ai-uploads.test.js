const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const Database=require('better-sqlite3');
const {createAIUploads}=require('../lib/ai-uploads');
const pause=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'film-upload-lifecycle-test-'));process.env.FILM_DATA_DIR=dir;
 const db=new Database(path.join(dir,'fixture.db'));db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/153_application_ai.sql'),'utf8'));
 const cid=crypto.randomUUID();db.prepare('INSERT INTO film_application_ai_conversations(id,title) VALUES(?,?)').run(cid,'Fixture');
 const workers=[],writes=[];let failure='';
 const wrapped={prepare(sql){const s=db.prepare(sql);return {...s,get:(...a)=>s.get(...a),all:(...a)=>s.all(...a),run:(...a)=>{writes.push(sql);if(failure&&sql.includes(failure))throw Error('fixture database full');return s.run(...a);}};}};
 class FixtureWorker extends EventEmitter{constructor(){super();this.terminated=0;workers.push(this);}terminate(){this.terminated++;return Promise.resolve(1);}}
 const uploads=createAIUploads(wrapped,()=>{}, {WorkerClass:FixtureWorker});
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {uploads,cid,workers,writes,setFailure:s=>failure=s,upload:()=>uploads.upload(cid,{filename:'source.txt',base64:Buffer.from('Fixture source').toString('base64')})};
}
test('extraction start persistence failure is contained without a worker or repeated writes',async t=>{
 const f=fixture(t),u=f.upload();f.setFailure("status='extracting'");await pause();const row=f.uploads.get(f.cid,u.id);assert.equal(row.status,'failed');assert.match(row.error,/could not be saved/);assert.equal(f.workers.length,0);assert.equal(f.writes.filter(s=>s.includes("status='extracting'")).length,1);
});
test('progress, result and extraction-error persistence failures reap workers and never report ready',async t=>{
 for(const [sql,message] of [['SET progress=',{progress:35}],["status='ready'",{text:'Extracted text',details:{parser:'fixture'}}],["status='failed'",{error:'fixture extraction failed'}]]){
  const f=fixture(t),u=f.upload();await pause();assert.equal(f.workers.length,1);f.setFailure(sql);const worker=f.workers[0];assert.doesNotThrow(()=>worker.emit('message',message));const count=f.writes.length;worker.emit('message',{text:'Late result',details:{}});worker.emit('error',Error('Late worker error'));worker.emit('exit',1);assert.equal(f.writes.length,count);assert.equal(worker.terminated,1);assert.equal(f.uploads.get(f.cid,u.id).status,'failed');assert.equal(f.uploads.get(f.cid,u.id).approved,false);
 }
});
test('cancellation persistence failure still reaps extraction and prevents stale approval from being sent',async t=>{
 const f=fixture(t),u=f.upload();await pause();f.setFailure("status='cancelled'");assert.throws(()=>f.uploads.cancel(f.cid,u.id),/database full/);assert.equal(f.workers[0].terminated,1);const count=f.writes.length;f.workers[0].emit('message',{text:'Late result',details:{}});assert.equal(f.writes.length,count);assert.equal(f.uploads.get(f.cid,u.id).status,'failed');assert.throws(()=>f.uploads.excerpt(f.cid,{id:u.id}),/approved/);
});
test('successful extraction remains durable and approved excerpts retain exact hashes',async t=>{
 const f=fixture(t),u=f.upload();await pause();f.workers[0].emit('message',{progress:35});f.workers[0].emit('message',{text:'Extracted source',details:{parser:'fixture'}});const ready=f.uploads.get(f.cid,u.id);assert.equal(ready.status,'ready');f.uploads.approve(f.cid,u.id,{human_confirmed:true,text_sha:ready.text_sha,original_sha:ready.original_sha});assert.equal(f.uploads.excerpt(f.cid,{id:u.id,text_sha:ready.text_sha,original_sha:ready.original_sha,start:0,end:9}).text,'Extracted');
});
