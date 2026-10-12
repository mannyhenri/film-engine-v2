const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fe-origin-'));
process.env.FILM_DATA_DIR=dir;
const Database=require('better-sqlite3');
const migration=name=>fs.readFileSync(path.join(__dirname,'../db/migrations',name),'utf8');
const {createFinalRequestStore}=require('../lib/final-request-review');
const transport=require('../lib/generation-transport');
const lineage=require('../lib/production-lineage');
function fixture(){
 const db=new Database(':memory:');db.exec(migration('141_final_request_reviews.sql'));
 db.exec('CREATE TABLE film_assets(id TEXT PRIMARY KEY,project_id TEXT,shot_id TEXT,file_path TEXT,metadata TEXT); CREATE TABLE film_generation_jobs(id TEXT PRIMARY KEY,project_id TEXT,shot_id TEXT,provider TEXT,request_id TEXT,asset_id TEXT,meta TEXT);');
 const bytes=Buffer.from('approved audio bytes'),uri='data:audio/wav;base64,'+bytes.toString('base64');
 const snapshot={provider:'seedance',capability:'video',model:'seedance-2.5',endpoint:'https://provider.invalid/generate',body:{prompt:'exact',audios_list:[uri]},references:[{role:'dialogue',wire_role:'audios_list[0]',order:1,mime:'audio/wav',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),byte_length:bytes.length,data:uri}],adapterVersion:'test'};
 const store=createFinalRequestStore(db,{resolve:async()=>structuredClone(snapshot),provenance:spec=>({spec,digest:'stable'}),quote:()=>({amount:0,credits:0,pricing_digest:'stable'})});
 return{db,store,snapshot,bytes,uri};
}
test('unrecordable attempt and unproven hosted substitution dispatch nothing',async()=>{
 const f=fixture(),request={url:f.snapshot.endpoint,body:{prompt:'exact',audios_list:['https://cdn.invalid/unproven']}};transport.attach(request,{store:f.store,reviewId:'absent',snapshot:f.snapshot});let calls=0;const old=global.fetch;global.fetch=async()=>{calls++;};
 try{await assert.rejects(()=>transport.dispatch(request,request.url,{method:'POST',body:JSON.stringify(request.body)}),/hosted|record|review|prove/i);assert.equal(calls,0);}finally{global.fetch=old;f.db.close();}
});
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
