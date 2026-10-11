const crypto=require('node:crypto'),path=require('node:path');
const {Worker}=require('node:worker_threads');
const MAX_BYTES=5*1024*1024, FORMATS=['txt','md','fountain','docx','fdx'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
function createAIUploads(db,conversation) {
 const jobs=new Map();
 db.prepare("UPDATE film_application_ai_uploads SET status='interrupted',error='Film restarted during extraction. Upload the file again.' WHERE status IN ('queued','extracting')").run();
 function get(cid,id) {conversation(cid);const row=db.prepare('SELECT id,conversation_id,filename,format,original_sha,bytes,status,progress,text,text_sha,provenance,error,approved_sha,created_at FROM film_application_ai_uploads WHERE id=? AND conversation_id=?').get(id,cid);if(!row)fail(404,'Upload not found in this application conversation');return {...row,provenance:JSON.parse(row.provenance),approved:!!row.approved_sha&&row.approved_sha===row.text_sha};}
 function list(cid) {conversation(cid);return db.prepare('SELECT id FROM film_application_ai_uploads WHERE conversation_id=? ORDER BY rowid').all(cid).map(x=>get(cid,x.id));}
 function upload(cid,b) {
  conversation(cid);
  if(typeof b.filename!=='string'||b.filename.length>180||b.filename!==path.basename(b.filename)||/[\\/\x00-\x1f]/.test(b.filename)||b.path||b.url)fail(400,'Choose a local filename; paths and URLs are not accepted');
  const format=path.extname(b.filename).slice(1).toLowerCase();
  if(!FORMATS.includes(format))fail(415,'Supported local formats: TXT, Markdown, Fountain, DOCX and FDX. PDF, DOC, RTF and Pages extraction is unavailable; save as DOCX or UTF-8 text.');
  if(typeof b.base64!=='string'||b.base64.length>Math.ceil(MAX_BYTES/3)*4||!b.base64.length||b.base64.length%4||/[^A-Za-z0-9+/=]/.test(b.base64))fail(413,'Choose a file up to 5 MB, encoded as base64');
  const bytes=Buffer.from(b.base64,'base64');if(!bytes.length||bytes.length>MAX_BYTES)fail(413,'File exceeds the 5 MB limit');
  if(bytes.toString('base64')!==b.base64)fail(400,'The upload must contain canonical base64 bytes');
  const id=crypto.randomUUID(),sha=hash(bytes);
  db.prepare('INSERT INTO film_application_ai_uploads(id,conversation_id,filename,format,original,original_sha,bytes,provenance) VALUES(?,?,?,?,?,?,?,?)').run(id,cid,b.filename,format,bytes,sha,bytes.length,JSON.stringify({origin:'owner_selected_local_file',original_sha:sha,filename:b.filename}));
  // Queue one turn so a just-uploaded file can be cancelled before extraction.
  const record={worker:null};jobs.set(id,record);
  setImmediate(()=>{
   if(!jobs.has(id))return;
   db.prepare("UPDATE film_application_ai_uploads SET status='extracting',progress=10 WHERE id=?").run(id);
   const failed=error=>{if(!jobs.has(id))return;jobs.delete(id);db.prepare("UPDATE film_application_ai_uploads SET status='failed',error=? WHERE id=?").run(String(error).slice(0,1000),id);};
   let worker;try{worker=new Worker(path.join(__dirname,'ai-upload-worker.cjs'),{workerData:{bytes,format}});record.worker=worker;}catch(e){failed(e.message);return;}
   worker.on('message',m=>{
    if(!jobs.has(id))return;
    if(m.error)return failed(m.error);
    if(m.text!==undefined){const prior=get(cid,id);db.prepare("UPDATE film_application_ai_uploads SET status='ready',progress=100,text=?,text_sha=?,provenance=? WHERE id=?").run(m.text,hash(m.text),JSON.stringify({...prior.provenance,...m.details}),id);jobs.delete(id);}
    else if(m.progress)db.prepare('UPDATE film_application_ai_uploads SET progress=? WHERE id=?').run(m.progress,id);
   });worker.on('error',failed);worker.on('exit',code=>{if(jobs.has(id))failed('Extraction worker exited before producing readable text (status '+code+').');});
  });return get(cid,id);
 }
 function approve(cid,id,b){const u=get(cid,id);if(u.status!=='ready'||b.human_confirmed!==true||b.text_sha!==u.text_sha||b.original_sha!==u.original_sha)fail(409,'Review the extracted text and confirm its current source hashes first');db.prepare('UPDATE film_application_ai_uploads SET approved_sha=? WHERE id=?').run(u.text_sha,id);return get(cid,id);}
 function cancel(cid,id){const u=get(cid,id);if(u.status==='cancelled')return u;const job=jobs.get(id);jobs.delete(id);job?.worker?.terminate();db.prepare("UPDATE film_application_ai_uploads SET status='cancelled',approved_sha='',text='',text_sha='',original=X'',error='Cancelled by owner; nothing from this file can be sent.' WHERE id=?").run(id);return get(cid,id);}
 function excerpt(cid,a){const u=get(cid,a.id);if(u.status!=='ready'||!u.approved||a.text_sha!==u.text_sha||a.original_sha!==u.original_sha)fail(409,'Upload must have reviewed, approved extracted text before inclusion');if(!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<0||a.end<=a.start||a.end>u.text.length)fail(400,'Select a valid extracted-text character range');return {id:u.id,filename:u.filename,original_sha:u.original_sha,text_sha:u.text_sha,range:{start:a.start,end:a.end},text:u.text.slice(a.start,a.end),provenance:u.provenance,omitted_characters:u.text.length-(a.end-a.start)};}
 return {get,list,upload,approve,cancel,excerpt,capabilities:{formats:FORMATS,max_bytes:MAX_BYTES,max_text_characters:100000,unsupported:['pdf','doc','rtf','pages']}};
}
module.exports={createAIUploads};
